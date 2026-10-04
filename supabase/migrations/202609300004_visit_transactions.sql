-- STAGING CANDIDATE: deploy only with matching RPC-only check-in client.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.outlet_visits WHERE schedule_id IS NOT NULL GROUP BY schedule_id HAVING count(*)>1)
 OR EXISTS(SELECT 1 FROM public.visit_photos GROUP BY visit_id HAVING count(*)>1)
 OR EXISTS(SELECT 1 FROM public.visit_photos GROUP BY storage_path HAVING count(*)>1) THEN
 RAISE EXCEPTION 'Existing duplicate visit/photo evidence requires reviewed reconciliation; no rows were changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.outlet_visits v WHERE NOT EXISTS(SELECT 1 FROM public.visit_photos p WHERE p.visit_id=v.id)) OR EXISTS(SELECT 1 FROM public.sales_schedules s WHERE s.status='completed' AND NOT EXISTS(SELECT 1 FROM public.outlet_visits v JOIN public.visit_photos p ON p.visit_id=v.id WHERE v.schedule_id=s.id AND v.outlet_id=s.outlet_id AND v.sales_person_id=s.sales_person_id)) THEN RAISE EXCEPTION 'Existing incomplete visit evidence requires reviewed reconciliation; no rows were changed'; END IF;
END $$;
CREATE UNIQUE INDEX pilot_one_visit_per_schedule ON public.outlet_visits(schedule_id) WHERE schedule_id IS NOT NULL;
CREATE UNIQUE INDEX pilot_one_photo_per_visit ON public.visit_photos(visit_id);
CREATE UNIQUE INDEX pilot_one_link_per_photo ON public.visit_photos(storage_path);
-- The old INSERT trigger cannot complete a schedule before the proof row exists.
CREATE OR REPLACE FUNCTION public.update_outlet_last_visit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.visit_photos WHERE visit_id=NEW.id) THEN
 UPDATE public.customers SET last_visit_date=NEW.checked_in_at::date WHERE id=NEW.outlet_id AND (last_visit_date IS NULL OR last_visit_date<NEW.checked_in_at::date);
 UPDATE public.sales_schedules SET status='completed' WHERE id=NEW.schedule_id AND outlet_id=NEW.outlet_id AND sales_person_id=NEW.sales_person_id;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION private.pilot_complete_proven_visit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.outlet_visits%ROWTYPE;
BEGIN
 SELECT * INTO STRICT v FROM public.outlet_visits WHERE id=NEW.visit_id;
 UPDATE public.customers SET last_visit_date=v.checked_in_at::date WHERE id=v.outlet_id AND (last_visit_date IS NULL OR last_visit_date<v.checked_in_at::date);
 UPDATE public.sales_schedules SET status='completed' WHERE id=v.schedule_id AND outlet_id=v.outlet_id AND sales_person_id=v.sales_person_id;
 RETURN NEW;
END $$;
CREATE TRIGGER pilot_complete_proven_visit AFTER INSERT ON public.visit_photos FOR EACH ROW EXECUTE FUNCTION private.pilot_complete_proven_visit();
CREATE FUNCTION private.pilot_freeze_visited_schedule() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP<>'INSERT' AND EXISTS(SELECT 1 FROM public.outlet_visits WHERE schedule_id=OLD.id) THEN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Visited schedule history cannot be deleted' USING ERRCODE='55000'; END IF;
 IF ROW(NEW.id,NEW.outlet_id,NEW.sales_person_id,NEW.scheduled_date) IS DISTINCT FROM ROW(OLD.id,OLD.outlet_id,OLD.sales_person_id,OLD.scheduled_date)
 OR (OLD.status='completed' AND NEW.status IS DISTINCT FROM OLD.status) THEN RAISE EXCEPTION 'Visited schedule identity and completion are immutable' USING ERRCODE='55000'; END IF;
 END IF;
 IF TG_OP<>'DELETE' AND NEW.status='completed' AND NOT EXISTS(SELECT 1 FROM public.outlet_visits v JOIN public.visit_photos p ON p.visit_id=v.id WHERE v.schedule_id=NEW.id AND v.outlet_id=NEW.outlet_id AND v.sales_person_id=NEW.sales_person_id) THEN RAISE EXCEPTION 'Completed schedule requires matching visit and photo' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pilot_freeze_visited_schedule BEFORE INSERT OR UPDATE OR DELETE ON public.sales_schedules FOR EACH ROW EXECUTE FUNCTION private.pilot_freeze_visited_schedule();
CREATE FUNCTION public.pilot_finalize_visit(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); role public.user_role:=public.current_user_role(); prior private.pilot_order_requests%ROWTYPE;
 s public.sales_schedules%ROWTYPE; path text; latitude numeric; longitude numeric; moment timestamptz; visit uuid; v_result jsonb;
BEGIN
 IF actor IS NULL OR role IS NULL OR role NOT IN ('sales_person','sales_manager','sales_head','executive') THEN RAISE EXCEPTION 'Active field-sales profile required' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_operation IS DISTINCT FROM 'finalize_visit' OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid visit request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_request_id::text,0));
 SELECT * INTO prior FROM private.pilot_order_requests r WHERE r.actor_id=actor AND r.request_id=p_request_id FOR UPDATE;
 IF FOUND AND prior.abandoned THEN RAISE EXCEPTION 'Request was safely abandoned; it cannot execute' USING ERRCODE='55000'; END IF;
 SELECT * INTO s FROM public.sales_schedules WHERE id=(p_payload->>'schedule_id')::uuid FOR UPDATE;
 IF NOT FOUND OR s.sales_person_id<>actor OR NOT private.pilot_can_access_customer(s.outlet_id) THEN RAISE EXCEPTION 'Own assigned schedule and customer required' USING ERRCODE='42501'; END IF;
 IF prior.request_id IS NOT NULL THEN
 IF prior.operation<>p_operation OR prior.payload<>p_payload THEN RAISE EXCEPTION 'Request already used with another action or payload' USING ERRCODE='22023'; END IF;
 IF prior.result IS NOT NULL THEN RETURN prior.result; END IF;
 END IF;
 IF s.status<>'pending' OR EXISTS(SELECT 1 FROM public.outlet_visits WHERE schedule_id=s.id) THEN RAISE EXCEPTION 'Schedule already visited or no longer pending; refresh its result' USING ERRCODE='55000'; END IF;
 path:=p_payload->>'storage_path';
 IF path IS NULL OR array_length(string_to_array(path,'/'),1)<>3 OR split_part(path,'/',1)<>'visits' OR split_part(path,'/',2)<>s.id::text OR split_part(path,'/',3) IN ('','.','..') OR NOT private.pilot_photo_object_owned(path) THEN RAISE EXCEPTION 'Owned uploaded photo for this schedule required' USING ERRCODE='42501'; END IF;
 IF (p_payload->'lat' IS NOT NULL AND p_payload->'lat'<>'null'::jsonb AND jsonb_typeof(p_payload->'lat')<>'number') OR (p_payload->'lng' IS NOT NULL AND p_payload->'lng'<>'null'::jsonb AND jsonb_typeof(p_payload->'lng')<>'number') THEN RAISE EXCEPTION 'Numeric coordinates required' USING ERRCODE='22023'; END IF;
 latitude:=(p_payload->>'lat')::numeric; longitude:=(p_payload->>'lng')::numeric;
 IF (latitude IS NULL)<>(longitude IS NULL) OR latitude NOT BETWEEN -90 AND 90 OR longitude NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'Coordinates out of bounds' USING ERRCODE='22023'; END IF;
 INSERT INTO private.pilot_order_requests(actor_id,request_id,operation,payload) VALUES(actor,p_request_id,p_operation,p_payload);
 moment:=clock_timestamp();
 INSERT INTO public.outlet_visits(outlet_id,sales_person_id,schedule_id,checked_in_at,lat,lng) VALUES(s.outlet_id,actor,s.id,moment,latitude,longitude) RETURNING id INTO visit;
 INSERT INTO public.visit_photos(visit_id,storage_path,taken_at,lat,lng) VALUES(visit,path,moment,latitude,longitude);
 v_result:=jsonb_build_object('id',visit);
 UPDATE private.pilot_order_requests r SET result=v_result WHERE r.actor_id=actor AND r.request_id=p_request_id;
 RETURN v_result;
END $$;
CREATE FUNCTION public.pilot_reconcile_visit(p_request_id uuid,p_abandon boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); role public.user_role:=public.current_user_role(); prior private.pilot_order_requests%ROWTYPE; s public.sales_schedules%ROWTYPE;
BEGIN
 IF actor IS NULL OR role IS NULL OR role NOT IN ('sales_person','sales_manager','sales_head','executive') THEN RAISE EXCEPTION 'Active field-sales profile required' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Request ID required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_request_id::text,0));
 SELECT * INTO prior FROM private.pilot_order_requests r WHERE r.actor_id=actor AND r.request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
 IF prior.operation NOT IN ('finalize_visit','recovery_abandoned') THEN RAISE EXCEPTION 'Request belongs to another operation' USING ERRCODE='22023'; END IF;
 IF prior.operation='finalize_visit' THEN
 SELECT * INTO s FROM public.sales_schedules WHERE id=(prior.payload->>'schedule_id')::uuid FOR UPDATE;
 IF NOT FOUND OR s.sales_person_id<>actor OR NOT private.pilot_can_access_customer(s.outlet_id) THEN RAISE EXCEPTION 'Current schedule access required' USING ERRCODE='42501'; END IF;
 END IF;
 IF prior.result IS NOT NULL THEN RETURN jsonb_build_object('state','committed','operation',prior.operation,'result',prior.result); END IF;
 IF prior.abandoned THEN RETURN jsonb_build_object('state','abandoned'); END IF;
 END IF;
 IF NOT p_abandon THEN RETURN jsonb_build_object('state','unknown'); END IF;
 INSERT INTO private.pilot_order_requests(actor_id,request_id,operation,payload,abandoned) VALUES(actor,p_request_id,'recovery_abandoned','{}',true) ON CONFLICT(actor_id,request_id) DO UPDATE SET abandoned=true;
 RETURN jsonb_build_object('state','abandoned');
END $$;
REVOKE INSERT ON public.outlet_visits,public.visit_photos FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.pilot_complete_proven_visit(),private.pilot_freeze_visited_schedule(),public.pilot_finalize_visit(uuid,text,jsonb),public.pilot_reconcile_visit(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_finalize_visit(uuid,text,jsonb),public.pilot_reconcile_visit(uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION private.pilot_can_upload_visit_object(object_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE(public.current_user_role() IN ('sales_person','sales_manager','sales_head','executive')
 AND array_length(string_to_array(object_name,'/'),1)=3
 AND split_part(object_name,'/',1)='visits'
 AND split_part(object_name,'/',3) NOT IN ('','.','..')
 AND EXISTS(SELECT 1 FROM public.sales_schedules s WHERE s.id::text=split_part(object_name,'/',2)
   AND s.status='pending' AND NOT EXISTS(SELECT 1 FROM public.outlet_visits v WHERE v.schedule_id=s.id)
   AND s.sales_person_id=auth.uid() AND private.pilot_can_access_customer(s.outlet_id)),false);
$$;

-- A wrong recovery endpoint must not disclose or replace a visit result.
CREATE OR REPLACE FUNCTION public.pilot_reconcile_request(p_request_id uuid,p_abandon boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); role public.user_role:=public.current_user_role(); prior private.pilot_order_requests%ROWTYPE;
BEGIN
 IF actor IS NULL OR role IS NULL THEN RAISE EXCEPTION 'Active authenticated profile required' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Request ID required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text || ':' || p_request_id::text,0));
 SELECT * INTO prior FROM private.pilot_order_requests r WHERE r.actor_id=actor AND r.request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF prior.operation='finalize_visit' THEN RAISE EXCEPTION 'Use visit request recovery for this operation' USING ERRCODE='22023'; END IF;
  IF prior.operation='submit_sales' THEN
   IF NOT private.pilot_can_access_customer((prior.payload->>'customer_id')::uuid) THEN RAISE EXCEPTION 'Current customer access required' USING ERRCODE='42501'; END IF;
  ELSIF prior.operation<>'recovery_abandoned' AND role NOT IN ('po_admin','executive') THEN RAISE EXCEPTION 'Current PO administration access required' USING ERRCODE='42501'; END IF;
  IF prior.result IS NOT NULL THEN RETURN jsonb_build_object('state','committed','operation',prior.operation,'result',prior.result); END IF;
  IF prior.abandoned THEN RETURN jsonb_build_object('state','abandoned'); END IF;
 END IF;
 IF NOT p_abandon THEN RETURN jsonb_build_object('state','unknown'); END IF;
 INSERT INTO private.pilot_order_requests(actor_id,request_id,operation,payload,abandoned) VALUES(actor,p_request_id,'recovery_abandoned','{}',true)
 ON CONFLICT(actor_id,request_id) DO UPDATE SET abandoned=true;
 RETURN jsonb_build_object('state','abandoned');
END $$;
COMMIT;
