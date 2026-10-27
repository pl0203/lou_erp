-- Forward-only cutover: deploy with the version-bound visit and RPC-only planning client.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
-- Wait for pre-cutover legacy-ledger mutations before installing the delayed-writer guard.
LOCK TABLE private.pilot_order_requests IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF to_regprocedure('public.pilot_finalize_visit(uuid,text,jsonb)') IS NULL
 OR to_regprocedure('private.pilot_freeze_visited_schedule()') IS NULL
 OR to_regprocedure('private.pilot_can_schedule(uuid,uuid)') IS NULL
 OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.sales_schedules'::regclass AND tgname='pilot_guard_actor_fields') THEN
 RAISE EXCEPTION 'Expected pilot visit/security baseline is missing; inspect target metadata before cutover'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.pilot_finalize_visit(uuid,text,jsonb)'::regprocedure AND prosecdef AND md5(prosrc)='8ac9f3b480456e0832354f8f147dc7f3')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='private.pilot_freeze_visited_schedule()'::regprocedure AND prosecdef AND md5(prosrc)='b70fd31b4c17fe7183a4aecfd2eb61d9')
 OR has_function_privilege('anon','public.pilot_finalize_visit(uuid,text,jsonb)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.pilot_finalize_visit(uuid,text,jsonb)','EXECUTE') THEN
 RAISE EXCEPTION 'Visit source or execution ACL drift; review before applying'; END IF;
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid IN('public.sales_schedules'::regclass,'public.outlet_visits'::regclass,'public.visit_photos'::regclass) AND attacl IS NOT NULL) THEN
 RAISE EXCEPTION 'Unexpected column grants require review before visit cutover'; END IF;

END $$;
ALTER TABLE public.sales_schedules ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE public.outlet_visits ADD COLUMN note_version integer NOT NULL DEFAULT 1 CHECK(note_version>0);
-- A dedicated family ledger prevents a wrong endpoint tombstoning even an unknown UUID.
CREATE TABLE private.pilot_schedule_requests(
 actor_id uuid NOT NULL REFERENCES public.users(id), request_id uuid NOT NULL,
 operation text NOT NULL, payload jsonb NOT NULL, authority jsonb NOT NULL DEFAULT '{}',
 result jsonb, abandoned boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,request_id));
CREATE TABLE private.pilot_visit_requests(
 actor_id uuid NOT NULL REFERENCES public.users(id), request_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN('finalize_visit','visit_recovery_abandoned')),
 payload jsonb NOT NULL, result jsonb, abandoned boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(actor_id,request_id));
REVOKE ALL ON private.pilot_visit_requests FROM PUBLIC,anon,authenticated;
-- Already-committed rows are retained. Even an in-flight old function body may no
-- longer claim a legacy finalize request after this guarded cutover commits.
CREATE FUNCTION private.pilot_block_legacy_visit_claim_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.operation='finalize_visit' THEN RAISE EXCEPTION 'New visit requests require the bound visit transaction family' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pilot_block_legacy_visit_claim_v1 BEFORE INSERT ON private.pilot_order_requests
FOR EACH ROW EXECUTE FUNCTION private.pilot_block_legacy_visit_claim_v1();
REVOKE ALL ON FUNCTION private.pilot_block_legacy_visit_claim_v1() FROM PUBLIC,anon,authenticated;

CREATE TABLE public.visit_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), requester_id uuid NOT NULL REFERENCES public.users(id),
 kind text NOT NULL CHECK(kind IN('new','amendment')), customer_id uuid NOT NULL REFERENCES public.customers(id),
 scheduled_date date NOT NULL, notes text CHECK(length(notes)<=2000),
 source_schedule_id uuid, base_version integer, approved_schedule_id uuid,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected','withdrawn')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), reviewer_id uuid REFERENCES public.users(id),
 decided_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((kind='new' AND source_schedule_id IS NULL AND base_version IS NULL) OR(kind='amendment' AND source_schedule_id IS NOT NULL AND base_version>0)));
-- Schedule IDs intentionally do not cascade: removed plans must retain decisions/audit.
CREATE TABLE private.pilot_visit_workflow_audit(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES public.users(id),
 request_id uuid NOT NULL, operation text NOT NULL, resource_id uuid NOT NULL,
 old_value jsonb, new_value jsonb, changed_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX visit_requests_requester_created ON public.visit_requests(requester_id,created_at DESC,id);
CREATE INDEX visit_requests_pending ON public.visit_requests(status,created_at,id);
REVOKE ALL ON private.pilot_schedule_requests,private.pilot_visit_workflow_audit,public.visit_requests FROM PUBLIC,anon,authenticated;
ALTER TABLE public.visit_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.visit_requests TO authenticated;
CREATE POLICY visit_requests_current_scope ON public.visit_requests FOR SELECT TO authenticated USING(
 public.current_user_role() IS NOT NULL AND
 (requester_id=auth.uid() OR (requester_id<>auth.uid() AND private.pilot_can_schedule(customer_id,requester_id))));
REVOKE INSERT,UPDATE,DELETE ON public.sales_schedules FROM PUBLIC,anon,authenticated;
REVOKE UPDATE,DELETE ON public.outlet_visits,public.visit_photos FROM PUBLIC,anon,authenticated;

-- Only replace the schedule's origin trigger, leaving unrelated table guards unchanged.
CREATE FUNCTION private.pilot_schedule_origin_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF auth.uid() IS NOT NULL AND NEW.assigned_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Invalid assigner' USING ERRCODE='42501'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.assigned_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.assigned_by,OLD.created_at) THEN RAISE EXCEPTION 'Schedule origin is immutable' USING ERRCODE='42501'; END IF;
  NEW.version:=OLD.version+1;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER pilot_guard_actor_fields ON public.sales_schedules;
CREATE TRIGGER pilot_guard_actor_fields BEFORE INSERT OR UPDATE ON public.sales_schedules FOR EACH ROW EXECUTE FUNCTION private.pilot_schedule_origin_v1();
CREATE FUNCTION private.pilot_visit_evidence_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF (to_jsonb(NEW)-'notes'-'note_version') IS DISTINCT FROM (to_jsonb(OLD)-'notes'-'note_version') THEN
 RAISE EXCEPTION 'Completed visit evidence is immutable' USING ERRCODE='55000'; END IF;
 NEW.note_version:=OLD.note_version+1; RETURN NEW;
END $$;
CREATE TRIGGER pilot_visit_evidence_v1 BEFORE UPDATE ON public.outlet_visits FOR EACH ROW EXECUTE FUNCTION private.pilot_visit_evidence_v1();

CREATE FUNCTION private.pilot_lock_visit_authority_v1() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Role/manager/assignment changes serialize before each authorized write/recovery.
 -- Short table-level SHARE locks also protect absence of assignment rows.
 LOCK TABLE public.users,public.customer_manager_assignments,public.customer_sales_rep_assignments IN SHARE MODE;
 IF auth.uid() IS NULL OR public.current_user_role() IS NULL THEN RAISE EXCEPTION 'Active profile required' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION private.pilot_schedule_authority_v1(op text, context jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); role public.user_role:=public.current_user_role(); person uuid:=(context->>'sales_person_id')::uuid; customer uuid:=(context->>'customer_id')::uuid; old_customer uuid:=(context->>'source_customer_id')::uuid;
BEGIN
 IF op IN('propose_visit','amend_visit','withdraw_request') THEN
  IF role IS DISTINCT FROM 'sales_person' OR person IS DISTINCT FROM actor OR NOT private.pilot_can_access_customer(customer) THEN RAISE EXCEPTION 'Own accessible visit required' USING ERRCODE='42501'; END IF;
 ELSIF op='edit_visit_note' THEN
  IF role IS NULL OR role NOT IN('sales_person','sales_manager','sales_head','executive') OR person IS DISTINCT FROM actor OR NOT private.pilot_can_access_customer(customer) THEN RAISE EXCEPTION 'Own accessible visit required' USING ERRCODE='42501'; END IF;
 ELSE
  IF role IS NULL OR role NOT IN('sales_manager','sales_head','executive') OR NOT private.pilot_can_schedule(customer,person)
   OR (op IN('approve_request','reject_request') AND actor=person) THEN RAISE EXCEPTION 'Current manager authority required; self approval is forbidden' USING ERRCODE='42501'; END IF;
 END IF;
 IF old_customer IS NOT NULL AND NOT private.pilot_can_access_customer(old_customer) THEN RAISE EXCEPTION 'Current source customer access required' USING ERRCODE='42501'; END IF;
END $$;

CREATE FUNCTION public.pilot_schedule_transaction_v1(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); prior private.pilot_schedule_requests%ROWTYPE; s public.sales_schedules%ROWTYPE; r public.visit_requests%ROWTYPE; v public.outlet_visits%ROWTYPE;
 context jsonb; v_result jsonb; before_value jsonb; resource uuid; person uuid; customer uuid; day date; note text; expected integer; allowed text[];
BEGIN
 PERFORM private.pilot_lock_visit_authority_v1();
 IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_operation IS NULL THEN RAISE EXCEPTION 'Invalid schedule request' USING ERRCODE='22023'; END IF;
 CASE p_operation
 WHEN 'propose_visit' THEN allowed:=ARRAY['customer_id','scheduled_date','notes'];
 WHEN 'amend_visit' THEN allowed:=ARRAY['schedule_id','expected_version','customer_id','scheduled_date','notes'];
 WHEN 'create_schedule' THEN allowed:=ARRAY['customer_id','sales_person_id','scheduled_date','notes'];
 WHEN 'edit_schedule' THEN allowed:=ARRAY['schedule_id','expected_version','customer_id','sales_person_id','scheduled_date','notes'];
 WHEN 'delete_schedule' THEN allowed:=ARRAY['schedule_id','expected_version'];
 WHEN 'edit_visit_note' THEN allowed:=ARRAY['visit_id','expected_version','notes'];
 WHEN 'approve_request','reject_request','withdraw_request' THEN allowed:=ARRAY['request_id','expected_version'];
 ELSE RAISE EXCEPTION 'Unknown schedule operation' USING ERRCODE='22023'; END CASE;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE NOT k=ANY(allowed)) THEN RAISE EXCEPTION 'Unexpected schedule fields' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'notes' AND p_payload->'notes'<>'null'::jsonb AND jsonb_typeof(p_payload->'notes')<>'string' THEN RAISE EXCEPTION 'Plain text notes required' USING ERRCODE='22023'; END IF;
 note:=p_payload->>'notes'; IF length(note)>2000 THEN RAISE EXCEPTION 'Visit notes exceed 2000 characters' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('schedule:'||actor::text||':'||p_request_id::text,0));
 SELECT * INTO prior FROM private.pilot_schedule_requests WHERE actor_id=actor AND request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF prior.abandoned THEN RAISE EXCEPTION 'Request was safely abandoned' USING ERRCODE='55000'; END IF;
  IF prior.operation<>p_operation OR prior.payload<>p_payload THEN RAISE EXCEPTION 'Request already used with another action or payload' USING ERRCODE='22023'; END IF;
  PERFORM private.pilot_schedule_authority_v1(prior.operation,prior.authority);
  IF prior.result IS NOT NULL THEN RETURN prior.result; END IF;
 END IF;
 expected:=(p_payload->>'expected_version')::integer;
 IF p_operation NOT IN('propose_visit','create_schedule') AND (expected IS NULL OR expected<1) THEN RAISE EXCEPTION 'Expected version required' USING ERRCODE='22023'; END IF;
 IF p_operation IN('approve_request','reject_request','withdraw_request') THEN
  SELECT * INTO r FROM public.visit_requests WHERE id=(p_payload->>'request_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501'; END IF;
  person:=r.requester_id; customer:=r.customer_id; day:=r.scheduled_date; note:=r.notes; resource:=r.id; before_value:=to_jsonb(r);
  IF r.source_schedule_id IS NOT NULL THEN SELECT * INTO s FROM public.sales_schedules WHERE id=r.source_schedule_id FOR UPDATE; END IF;
 ELSIF p_operation IN('amend_visit','edit_schedule','delete_schedule') THEN
  SELECT * INTO s FROM public.sales_schedules WHERE id=(p_payload->>'schedule_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Schedule unavailable' USING ERRCODE='42501'; END IF;
  person:=CASE WHEN p_operation='edit_schedule' THEN (p_payload->>'sales_person_id')::uuid ELSE s.sales_person_id END;
  customer:=CASE WHEN p_operation='delete_schedule' THEN s.outlet_id ELSE (p_payload->>'customer_id')::uuid END;
  day:=(p_payload->>'scheduled_date')::date; before_value:=to_jsonb(s); resource:=s.id;
 ELSIF p_operation='edit_visit_note' THEN
  SELECT * INTO v FROM public.outlet_visits WHERE id=(p_payload->>'visit_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Visit unavailable' USING ERRCODE='42501'; END IF;
  person:=v.sales_person_id; customer:=v.outlet_id; resource:=v.id; before_value:=to_jsonb(v);
 ELSE
  person:=CASE WHEN p_operation='propose_visit' THEN actor ELSE (p_payload->>'sales_person_id')::uuid END;
  customer:=(p_payload->>'customer_id')::uuid; day:=(p_payload->>'scheduled_date')::date;
 END IF;
 context:=jsonb_build_object('sales_person_id',person,'customer_id',customer,'source_customer_id',s.outlet_id);
 PERFORM private.pilot_schedule_authority_v1(p_operation,context);
 IF p_operation='edit_schedule' AND NOT private.pilot_can_schedule(s.outlet_id,s.sales_person_id) THEN RAISE EXCEPTION 'Current source team authority required' USING ERRCODE='42501'; END IF;
 IF p_operation IN('propose_visit','amend_visit','create_schedule','edit_schedule') AND (customer IS NULL OR person IS NULL OR day IS NULL OR NOT isfinite(day)) THEN RAISE EXCEPTION 'Store, salesperson and finite date required' USING ERRCODE='22023'; END IF;
 IF p_operation IN('approve_request','reject_request','withdraw_request') AND (r.version<>expected OR r.status<>'pending') THEN RAISE EXCEPTION 'Request changed; refresh' USING ERRCODE='40001'; END IF;
 IF p_operation IN('amend_visit','edit_schedule','delete_schedule') OR (p_operation='approve_request' AND r.kind='amendment') THEN
  IF s.id IS NULL OR s.version IS DISTINCT FROM (CASE WHEN p_operation='approve_request' THEN r.base_version ELSE expected END) THEN RAISE EXCEPTION 'Schedule changed; refresh' USING ERRCODE='40001'; END IF;
  IF s.status='completed' OR EXISTS(SELECT 1 FROM public.outlet_visits WHERE schedule_id=s.id) THEN RAISE EXCEPTION 'Completed visit evidence cannot be amended' USING ERRCODE='55000'; END IF;
  IF p_operation='approve_request' AND s.sales_person_id<>r.requester_id THEN RAISE EXCEPTION 'Source salesperson changed' USING ERRCODE='40001'; END IF;
 END IF;
 IF p_operation='edit_visit_note' AND v.note_version<>expected THEN RAISE EXCEPTION 'Visit notes changed; refresh' USING ERRCODE='40001'; END IF;
 INSERT INTO private.pilot_schedule_requests(actor_id,request_id,operation,payload,authority) VALUES(actor,p_request_id,p_operation,p_payload,context);
 IF p_operation IN('propose_visit','amend_visit') THEN
  INSERT INTO public.visit_requests(requester_id,kind,customer_id,scheduled_date,notes,source_schedule_id,base_version)
  VALUES(actor,CASE WHEN p_operation='propose_visit' THEN 'new' ELSE 'amendment' END,customer,day,note,s.id,CASE WHEN s.id IS NULL THEN NULL ELSE s.version END) RETURNING * INTO r;
  resource:=r.id; v_result:=jsonb_build_object('id',r.id,'version',r.version,'status',r.status);
 ELSIF p_operation IN('create_schedule','edit_schedule') OR p_operation='approve_request' THEN
  IF p_operation='approve_request' THEN before_value:=jsonb_build_object('request',to_jsonb(r),'schedule',to_jsonb(s)); END IF;
  IF p_operation='create_schedule' OR (p_operation='approve_request' AND r.kind='new') THEN
   INSERT INTO public.sales_schedules(outlet_id,sales_person_id,assigned_by,scheduled_date,notes) VALUES(customer,person,actor,day,note) RETURNING * INTO s;
  ELSE UPDATE public.sales_schedules SET status=CASE WHEN s.status='missed' AND ROW(s.outlet_id,s.sales_person_id,s.scheduled_date) IS DISTINCT FROM ROW(customer,person,day) THEN 'pending'::public.schedule_status ELSE s.status END,outlet_id=customer,sales_person_id=person,scheduled_date=day,notes=note WHERE id=s.id RETURNING * INTO s; END IF;
  IF p_operation='approve_request' THEN
   UPDATE public.visit_requests SET status='approved',reviewer_id=actor,decided_at=clock_timestamp(),version=version+1,approved_schedule_id=s.id WHERE id=r.id RETURNING * INTO r;
   v_result:=jsonb_build_object('id',r.id,'version',r.version,'status',r.status,'schedule_id',s.id,'schedule_version',s.version);
  ELSE resource:=s.id; v_result:=jsonb_build_object('id',s.id,'version',s.version); END IF;
 ELSIF p_operation IN('reject_request','withdraw_request') THEN
  UPDATE public.visit_requests SET status=CASE WHEN p_operation='reject_request' THEN 'rejected' ELSE 'withdrawn' END,reviewer_id=CASE WHEN p_operation='reject_request' THEN actor END,decided_at=clock_timestamp(),version=version+1 WHERE id=r.id RETURNING * INTO r;
  v_result:=jsonb_build_object('id',r.id,'version',r.version,'status',r.status);
 ELSIF p_operation='delete_schedule' THEN
  DELETE FROM public.sales_schedules WHERE id=s.id;
  v_result:=jsonb_build_object('id',s.id,'version',s.version+1,'deleted',true);
 ELSE
  UPDATE public.outlet_visits SET notes=note WHERE id=v.id RETURNING * INTO v;
  v_result:=jsonb_build_object('id',v.id,'version',v.note_version);
 END IF;
 INSERT INTO private.pilot_visit_workflow_audit(actor_id,request_id,operation,resource_id,old_value,new_value)
 VALUES(actor,p_request_id,p_operation,resource,before_value,CASE WHEN p_operation='delete_schedule' THEN NULL WHEN p_operation='edit_visit_note' THEN to_jsonb(v) WHEN p_operation='approve_request' THEN jsonb_build_object('request',to_jsonb(r),'schedule',to_jsonb(s)) WHEN p_operation IN('propose_visit','amend_visit','reject_request','withdraw_request') THEN to_jsonb(r) ELSE to_jsonb(s) END);
 UPDATE private.pilot_schedule_requests SET result=v_result WHERE actor_id=actor AND request_id=p_request_id;
 RETURN v_result;
END $$;

CREATE FUNCTION public.pilot_reconcile_schedule_v1(p_request_id uuid,p_abandon boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); prior private.pilot_schedule_requests%ROWTYPE;
BEGIN
 PERFORM private.pilot_lock_visit_authority_v1();
 IF public.current_user_role() NOT IN('sales_person','sales_manager','sales_head','executive') THEN RAISE EXCEPTION 'Active field-sales role required' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Request ID required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('schedule:'||actor::text||':'||p_request_id::text,0));
 SELECT * INTO prior FROM private.pilot_schedule_requests WHERE actor_id=actor AND request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF prior.operation<>'schedule_recovery_abandoned' THEN PERFORM private.pilot_schedule_authority_v1(prior.operation,prior.authority); END IF;
  IF prior.result IS NOT NULL THEN RETURN jsonb_build_object('state','committed','operation',prior.operation,'result',prior.result); END IF;
  IF prior.abandoned THEN RETURN jsonb_build_object('state','abandoned'); END IF;
 END IF;
 IF NOT p_abandon THEN RETURN jsonb_build_object('state','unknown'); END IF;
 INSERT INTO private.pilot_schedule_requests(actor_id,request_id,operation,payload,abandoned) VALUES(actor,p_request_id,'schedule_recovery_abandoned','{}',true) ON CONFLICT(actor_id,request_id) DO UPDATE SET abandoned=true;
 RETURN jsonb_build_object('state','abandoned');
END $$;

CREATE OR REPLACE FUNCTION public.pilot_finalize_visit(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); role public.user_role:=public.current_user_role(); prior private.pilot_visit_requests%ROWTYPE; legacy private.pilot_order_requests%ROWTYPE;
 s public.sales_schedules%ROWTYPE; path text; latitude numeric; longitude numeric; moment timestamptz; visit uuid; v_result jsonb;
BEGIN
 PERFORM private.pilot_lock_visit_authority_v1();
 role:=public.current_user_role();
 IF actor IS NULL OR role IS NULL OR role NOT IN ('sales_person','sales_manager','sales_head','executive') THEN RAISE EXCEPTION 'Active field-sales profile required' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_operation IS DISTINCT FROM 'finalize_visit' OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid visit request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('visit:'||actor::text||':'||p_request_id::text,0));
 SELECT * INTO legacy FROM private.pilot_order_requests r WHERE r.actor_id=actor AND r.request_id=p_request_id;
 IF legacy.request_id IS NOT NULL AND legacy.operation NOT IN('finalize_visit','recovery_abandoned') AND legacy.result IS NOT NULL THEN RAISE EXCEPTION 'Request belongs to another operation' USING ERRCODE='22023'; END IF;
 SELECT * INTO prior FROM private.pilot_visit_requests r WHERE r.actor_id=actor AND r.request_id=p_request_id FOR UPDATE;
 IF FOUND AND prior.abandoned THEN RAISE EXCEPTION 'Request was safely abandoned; it cannot execute' USING ERRCODE='55000'; END IF;
 SELECT * INTO s FROM public.sales_schedules WHERE id=(p_payload->>'schedule_id')::uuid FOR UPDATE;
 IF NOT FOUND OR s.sales_person_id<>actor OR NOT private.pilot_can_access_customer(s.outlet_id) THEN RAISE EXCEPTION 'Own assigned schedule and customer required' USING ERRCODE='42501'; END IF;
 IF legacy.operation='finalize_visit' THEN
  IF legacy.payload<>p_payload THEN RAISE EXCEPTION 'Request already used with another action or payload' USING ERRCODE='22023'; END IF;
  IF legacy.result IS NOT NULL THEN RETURN legacy.result; END IF;
  RAISE EXCEPTION 'Uncommitted legacy visit cannot execute; reconcile and capture again' USING ERRCODE='55000';
 END IF;
 IF prior.request_id IS NOT NULL THEN
 IF prior.operation<>p_operation OR prior.payload<>p_payload THEN RAISE EXCEPTION 'Request already used with another action or payload' USING ERRCODE='22023'; END IF;
 IF prior.result IS NOT NULL THEN RETURN prior.result; END IF;
 END IF;
 IF NOT (p_payload ?& ARRAY['expected_schedule_version','customer_id','scheduled_date']) OR (p_payload->>'expected_schedule_version') IS NULL OR (p_payload->>'customer_id') IS NULL OR (p_payload->>'scheduled_date') IS NULL THEN RAISE EXCEPTION 'Schedule capture binding required; refresh and capture a new photo' USING ERRCODE='22023'; END IF;
 IF s.version IS DISTINCT FROM (p_payload->>'expected_schedule_version')::integer OR s.outlet_id IS DISTINCT FROM (p_payload->>'customer_id')::uuid OR s.scheduled_date IS DISTINCT FROM (p_payload->>'scheduled_date')::date THEN RAISE EXCEPTION 'VISIT_SCHEDULE_CHANGED: Jadwal berubah. Muat ulang dan ambil foto baru.' USING ERRCODE='PVS01'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE NOT k=ANY(ARRAY['schedule_id','expected_schedule_version','customer_id','scheduled_date','storage_path','lat','lng','notes'])) OR (p_payload ? 'notes' AND p_payload->'notes'<>'null'::jsonb AND jsonb_typeof(p_payload->'notes')<>'string') OR length(p_payload->>'notes')>2000 THEN RAISE EXCEPTION 'Invalid visit notes or fields' USING ERRCODE='22023'; END IF;
 IF s.status<>'pending' OR EXISTS(SELECT 1 FROM public.outlet_visits WHERE schedule_id=s.id) THEN RAISE EXCEPTION 'Schedule already visited or no longer pending; refresh its result' USING ERRCODE='55000'; END IF;
 path:=p_payload->>'storage_path';
 IF path IS NULL OR array_length(string_to_array(path,'/'),1)<>3 OR split_part(path,'/',1)<>'visits' OR split_part(path,'/',2)<>s.id::text OR split_part(path,'/',3) IN ('','.','..') OR NOT private.pilot_photo_object_owned(path) THEN RAISE EXCEPTION 'Owned uploaded photo for this schedule required' USING ERRCODE='42501'; END IF;
 IF (p_payload->'lat' IS NOT NULL AND p_payload->'lat'<>'null'::jsonb AND jsonb_typeof(p_payload->'lat')<>'number') OR (p_payload->'lng' IS NOT NULL AND p_payload->'lng'<>'null'::jsonb AND jsonb_typeof(p_payload->'lng')<>'number') THEN RAISE EXCEPTION 'Numeric coordinates required' USING ERRCODE='22023'; END IF;
 latitude:=(p_payload->>'lat')::numeric; longitude:=(p_payload->>'lng')::numeric;
 IF (latitude IS NULL)<>(longitude IS NULL) OR latitude NOT BETWEEN -90 AND 90 OR longitude NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'Coordinates out of bounds' USING ERRCODE='22023'; END IF;
 INSERT INTO private.pilot_visit_requests(actor_id,request_id,operation,payload) VALUES(actor,p_request_id,p_operation,p_payload);
 moment:=clock_timestamp();
 INSERT INTO public.outlet_visits(outlet_id,sales_person_id,schedule_id,checked_in_at,lat,lng,notes) VALUES(s.outlet_id,actor,s.id,moment,latitude,longitude,p_payload->>'notes') RETURNING id INTO visit;
 INSERT INTO public.visit_photos(visit_id,storage_path,taken_at,lat,lng) VALUES(visit,path,moment,latitude,longitude);
 v_result:=jsonb_build_object('id',visit);
 UPDATE private.pilot_visit_requests r SET result=v_result WHERE r.actor_id=actor AND r.request_id=p_request_id;
 RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.pilot_reconcile_visit(p_request_id uuid,p_abandon boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); role public.user_role; prior private.pilot_visit_requests%ROWTYPE; legacy private.pilot_order_requests%ROWTYPE; s public.sales_schedules%ROWTYPE; visit_payload jsonb; visit_result jsonb;
BEGIN
 PERFORM private.pilot_lock_visit_authority_v1();
 role:=public.current_user_role();
 IF actor IS NULL OR role IS NULL OR role NOT IN ('sales_person','sales_manager','sales_head','executive') THEN RAISE EXCEPTION 'Active field-sales profile required' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Request ID required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('visit:'||actor::text||':'||p_request_id::text,0));
 SELECT * INTO legacy FROM private.pilot_order_requests r WHERE r.actor_id=actor AND r.request_id=p_request_id;
 IF legacy.request_id IS NOT NULL AND legacy.operation NOT IN('finalize_visit','recovery_abandoned') AND legacy.result IS NOT NULL THEN RAISE EXCEPTION 'Request belongs to another operation' USING ERRCODE='22023'; END IF;
 SELECT * INTO prior FROM private.pilot_visit_requests r WHERE r.actor_id=actor AND r.request_id=p_request_id FOR UPDATE;
 IF legacy.operation='finalize_visit' THEN visit_payload:=legacy.payload; visit_result:=legacy.result;
 ELSIF prior.operation='finalize_visit' THEN visit_payload:=prior.payload; visit_result:=prior.result; END IF;
 IF visit_payload IS NOT NULL THEN
  SELECT * INTO s FROM public.sales_schedules WHERE id=(visit_payload->>'schedule_id')::uuid FOR UPDATE;
  IF NOT FOUND OR s.sales_person_id<>actor OR NOT private.pilot_can_access_customer(s.outlet_id) THEN RAISE EXCEPTION 'Current schedule access required' USING ERRCODE='42501'; END IF;
  IF visit_result IS NOT NULL THEN RETURN jsonb_build_object('state','committed','operation','finalize_visit','result',visit_result); END IF;
 END IF;
 IF prior.abandoned OR (legacy.operation='finalize_visit' AND legacy.abandoned) THEN RETURN jsonb_build_object('state','abandoned'); END IF;
 IF NOT p_abandon THEN RETURN jsonb_build_object('state','unknown'); END IF;
 -- Generic legacy tombstones are ambiguous and never imported into this family.
 -- Unbound new calls are rejected by finalize, including delayed legacy clients.
 INSERT INTO private.pilot_visit_requests(actor_id,request_id,operation,payload,abandoned) VALUES(actor,p_request_id,'visit_recovery_abandoned','{}',true) ON CONFLICT(actor_id,request_id) DO UPDATE SET abandoned=true;
 RETURN jsonb_build_object('state','abandoned');
END $$;

CREATE FUNCTION public.pilot_store_po_context_v1(p_customer_id uuid,p_page integer DEFAULT 1,p_page_size integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE through_date date:=current_date; from_date date:=(current_date-interval '2 months')::date; latest date; total bigint; items jsonb;
BEGIN
 IF auth.uid() IS NULL OR public.current_user_role() IS NULL OR NOT private.pilot_can_access_customer(p_customer_id)
 OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer_id) THEN RAISE EXCEPTION 'Store unavailable' USING ERRCODE='42501'; END IF;
 IF p_page IS NULL OR p_page<1 OR p_page_size IS NULL OR p_page_size<1 OR p_page_size>50 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023'; END IF;
 SELECT max(order_date) INTO latest FROM public.purchase_orders WHERE customer_id=p_customer_id;
 SELECT count(*) INTO total FROM public.purchase_orders WHERE customer_id=p_customer_id AND order_date BETWEEN from_date AND through_date;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.order_date DESC,q.id),'[]') INTO items FROM (
 SELECT id,po_number,order_date,status::text FROM public.purchase_orders WHERE customer_id=p_customer_id AND order_date BETWEEN from_date AND through_date
 ORDER BY order_date DESC,id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size) q;
 RETURN jsonb_build_object('version',1,'as_of',statement_timestamp(),'latest_po_date',latest,'range_from',from_date,'range_through',through_date,'items',items,'total',total,'page',p_page,'page_size',p_page_size);
END $$;

REVOKE ALL ON FUNCTION private.pilot_schedule_origin_v1(),private.pilot_visit_evidence_v1(),private.pilot_lock_visit_authority_v1(),private.pilot_schedule_authority_v1(text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pilot_schedule_transaction_v1(uuid,text,jsonb),public.pilot_reconcile_schedule_v1(uuid,boolean),public.pilot_store_po_context_v1(uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_schedule_transaction_v1(uuid,text,jsonb),public.pilot_reconcile_schedule_v1(uuid,boolean),public.pilot_store_po_context_v1(uuid,integer,integer) TO authenticated;
DO $$ BEGIN
 IF has_table_privilege('authenticated','public.sales_schedules','INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated','public.visit_requests','INSERT,UPDATE,DELETE')
 OR has_table_privilege('authenticated','private.pilot_schedule_requests','SELECT,INSERT,UPDATE,DELETE')
 OR has_table_privilege('authenticated','private.pilot_visit_requests','SELECT,INSERT,UPDATE,DELETE')
 OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.sales_schedules'::regclass AND tgname='pilot_freeze_visited_schedule') THEN
 RAISE EXCEPTION 'Visit workflow ACL/evidence postflight failed'; END IF;
END $$;
COMMIT;
