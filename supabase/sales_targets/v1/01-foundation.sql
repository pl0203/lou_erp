-- REVIEWED DRAFT CANDIDATE ONLY. Additive and capability-off; no client grants.
-- Apply only in a later separately approved permission bundle, never by app startup.
BEGIN;
SET LOCAL search_path='';
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
-- BEGIN CANONICAL SOURCE GUARD: exact d7 helper bodies and trigger metadata.
-- Read-only and fail closed: migration names/version columns alone prove nothing.
DO $$DECLARE source record; BEGIN
 FOR source IN SELECT * FROM (VALUES
 ('private.pilot_store_owner_guard_v1()','trigger','80a27148324cc5c69404c93ed80f968915ae07791de8d4faa497040eecf0681b'),
 ('private.demo_capture_credit(uuid)','jsonb','4d1f54a6f163d27485824c0de22c3841b247c2344598c15ae9eab31631b9ac7f'),
 ('private.demo_immutable_credit()','trigger','dac78da8d1f0f6acbf3aac9ccf4db87910057aaa205a188146992f9e8d11c479')
 ) s(signature,result_type,body_hash) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
   WHERE p.oid=to_regprocedure(source.signature) AND l.lanname='plpgsql' AND p.prokind='f'
   AND p.prorettype=to_regtype(source.result_type) AND NOT p.prosecdef AND NOT p.proleakproof
   AND p.provolatile='v' AND p.proparallel='u' AND NOT p.proisstrict AND NOT p.proretset
   AND p.proconfig=ARRAY['search_path=""'] AND p.proowner=(SELECT relowner FROM pg_class WHERE oid='public.customer_manager_assignments'::regclass)
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=source.body_hash
   AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE'))
  THEN RAISE EXCEPTION 'Canonical source helper drift: %',source.signature; END IF;
 END LOOP;
 FOR source IN SELECT * FROM (VALUES
 ('public.customer_manager_assignments','store_owner_guard_v1','private.pilot_store_owner_guard_v1()',23),
 ('public.purchase_orders','demo_credit_immutable','private.demo_immutable_credit()',19)
 ) s(relation,trigger_name,signature,trigger_type) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass(source.relation) AND t.tgname=source.trigger_name
   AND t.tgfoid=to_regprocedure(source.signature) AND t.tgtype=source.trigger_type AND t.tgenabled='O'
   AND NOT t.tgisinternal AND NOT t.tgdeferrable AND NOT t.tginitdeferred AND t.tgconstraint=0
   AND t.tgnargs=0 AND t.tgattr=''::int2vector AND t.tgqual IS NULL)
  THEN RAISE EXCEPTION 'Canonical source trigger drift: %.%',source.relation,source.trigger_name; END IF;
 END LOOP;
END$$;
-- END CANONICAL SOURCE GUARD
-- Exact source fields are checked against repository contracts, not guessed aliases.
DO $$DECLARE source record; BEGIN
 FOR source IN SELECT * FROM (VALUES
 ('public.users','manager_id'),('public.users','is_active'),('public.customer_manager_assignments','version'),
 ('public.purchase_orders','sales_person_id_at_creation'),('public.purchase_orders','sales_attribution_state'),('public.purchase_orders','order_date'),
 ('public.surat_jalan','voided_at'),('public.surat_jalan','sj_date'),('private.co_delivery_heads','current_revision_id'),
 ('private.co_delivery_revisions','is_void'),('private.co_delivery_revision_lines','batch_id'),('private.co_stock_batches','sales_person_id_at_creation'),
 ('private.co_report_heads','report_month'),('private.co_report_revisions','coverage_through_date'),('private.co_report_revisions','is_partial_month'),
 ('private.co_sale_allocations','generation_id'),('private.co_customer_state','effective_generation_id'),
 ('public.outlet_visits','schedule_id'),('public.visit_requests','requester_id'),('public.visit_requests','status')) s(relation,column_name) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass(source.relation) AND a.attname=source.column_name AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Source contract drift: %.%',source.relation,source.column_name; END IF;
 END LOOP;
END$$;
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attname='customer_id' WHERE i.indrelid='public.customer_manager_assignments'::regclass AND i.indisunique AND i.indpred IS NULL AND i.indnkeyatts=1 AND i.indkey[0]=a.attnum) THEN RAISE EXCEPTION 'Canonical customer ownership must be unique'; END IF;
END$$;
CREATE TABLE private.sales_target_schema(version integer PRIMARY KEY CHECK(version=1),enabled boolean NOT NULL DEFAULT false);
INSERT INTO private.sales_target_schema VALUES(1,false);
-- Explicit evidence, not an inferred zero: populated only by a separately reviewed
-- source-coverage attestation. The default empty table makes recommendations partial.
CREATE TABLE private.sales_target_history_coverage(
 metric text PRIMARY KEY CHECK(metric IN('po_order_value','po_delivery_value')),
 complete_from date NOT NULL, complete_until date NOT NULL, evidence text NOT NULL CHECK(btrim(evidence)<>''),
 verified_by uuid NOT NULL REFERENCES public.users(id), verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 source_policy text NOT NULL DEFAULT 'po-known-customer-including-legacy-v1' CHECK(source_policy='po-known-customer-including-legacy-v1'),
 CHECK(complete_from<complete_until AND extract(day FROM complete_from)=1 AND extract(day FROM complete_until)=1)
);
-- Canonical owner uniqueness is supplied by 20261009061801_unify_store_owner_credit.
CREATE TABLE private.sales_target_plans(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),month date NOT NULL CHECK(isfinite(month) AND extract(day FROM month)=1),
 manager_id uuid NOT NULL REFERENCES public.users(id),version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN('draft','submitted','returned','published','superseded')),
 currency text NOT NULL DEFAULT 'IDR' CHECK(currency='IDR'),roster_hash text NOT NULL,roster_snapshot jsonb NOT NULL,
 baseline_snapshot jsonb NOT NULL,proposed_by uuid NOT NULL REFERENCES public.users(id),
 published_by uuid REFERENCES public.users(id),published_at timestamptz,
 previous_plan_id uuid REFERENCES private.sales_target_plans(id),reason text,warnings jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((state IN('published','superseded'))=(published_at IS NOT NULL AND published_by IS NOT NULL)),
 CHECK(published_by IS NULL OR published_by<>proposed_by),CHECK(jsonb_typeof(warnings)='array')
);
CREATE UNIQUE INDEX sales_target_one_published_manager_month ON private.sales_target_plans(manager_id,month) WHERE state='published';
CREATE TABLE private.sales_target_lines(
 plan_id uuid NOT NULL REFERENCES private.sales_target_plans(id),person_id uuid NOT NULL REFERENCES public.users(id),
 metric text NOT NULL CHECK(metric IN('po_order_value','po_delivery_value','co_sale_value')),
 amount numeric(26,2),applicability text NOT NULL CHECK(applicability IN('target','not_applicable')),reason text,
 PRIMARY KEY(plan_id,person_id,metric),CHECK(amount IS NULL OR amount>=0),
 CHECK(applicability<>'not_applicable' OR (amount IS NULL AND nullif(btrim(reason),'') IS NOT NULL))
);
CREATE TABLE private.sales_target_roster(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,plan_id uuid NOT NULL REFERENCES private.sales_target_plans(id),
 person_id uuid NOT NULL REFERENCES public.users(id),customer_id uuid REFERENCES public.customers(id),
 ownership text NOT NULL CHECK(ownership IN('direct_report','exclusive_manager')),assignment_id uuid,assignment_version bigint,
 UNIQUE NULLS NOT DISTINCT(plan_id,person_id,customer_id),UNIQUE(plan_id,customer_id)
);
-- Dedicated active projection enforces uniqueness even across overlapping manager plans.
CREATE TABLE private.sales_target_active(
 person_id uuid NOT NULL,month date NOT NULL,metric text NOT NULL,plan_id uuid NOT NULL,
 PRIMARY KEY(person_id,month,metric),FOREIGN KEY(plan_id,person_id,metric) REFERENCES private.sales_target_lines(plan_id,person_id,metric)
);
CREATE TABLE private.sales_target_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,plan_id uuid NOT NULL REFERENCES private.sales_target_plans(id),
 request_id uuid NOT NULL,operation text NOT NULL,actor_id uuid NOT NULL REFERENCES public.users(id),
 before_state jsonb,after_state jsonb NOT NULL,reason text,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX sales_target_event_plan_order ON private.sales_target_events(plan_id,id DESC);
CREATE TABLE private.sales_target_requests(
 actor_id uuid NOT NULL REFERENCES public.users(id),request_id uuid NOT NULL,operation text NOT NULL,payload jsonb NOT NULL,
 receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,request_id)
);
CREATE FUNCTION private.sales_target_enabled_v1() RETURNS void
LANGUAGE plpgsql STABLE SET search_path='' AS $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.sales_target_schema WHERE version=1 AND enabled) THEN RAISE EXCEPTION 'Sales targets capability disabled' USING ERRCODE='55000'; END IF;
END$$;
CREATE FUNCTION private.sales_target_actor_v1() RETURNS public.users
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE actor public.users;
BEGIN
 SELECT * INTO actor FROM public.users WHERE id=auth.uid() AND is_active;
 IF actor.id IS NULL OR actor.role::text NOT IN('sales_person','sales_manager','sales_head','executive') THEN
  RAISE EXCEPTION 'Active sales actor required' USING ERRCODE='42501';
 END IF;
 RETURN actor;
END$$;
CREATE FUNCTION private.sales_target_calendar_month_v1(at_time timestamptz) RETURNS date
LANGUAGE sql IMMUTABLE SET search_path='' AS $$SELECT date_trunc('month',at_time AT TIME ZONE 'Asia/Jakarta')::date$$;
CREATE FUNCTION private.sales_target_month_v1(month date) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$BEGIN
 IF month IS NULL OR NOT isfinite(month) OR month::text !~ '^[0-9]{4}-(0[1-9]|1[0-2])-01$' THEN
  RAISE EXCEPTION 'Calendar month first day required' USING ERRCODE='22023';
 END IF;
END$$;
CREATE FUNCTION private.sales_target_chain_v1(manager uuid) RETURNS uuid[]
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE node public.users; current_id uuid:=manager; path uuid[]:='{}'; found_head boolean:=false;
BEGIN
 WHILE current_id IS NOT NULL LOOP
  IF current_id=ANY(path) OR cardinality(path)>32 THEN RAISE EXCEPTION 'Hierarchy cycle or depth invalid' USING ERRCODE='23514'; END IF;
  SELECT * INTO node FROM public.users WHERE id=current_id AND is_active;
  IF node.id IS NULL THEN RAISE EXCEPTION 'Inactive or orphaned hierarchy' USING ERRCODE='23514'; END IF;
  IF cardinality(path)=0 AND node.role::text<>'sales_manager' THEN RAISE EXCEPTION 'Manager required' USING ERRCODE='23514'; END IF;
  IF cardinality(path)>0 AND node.role::text NOT IN('sales_manager','sales_head','executive') THEN RAISE EXCEPTION 'Invalid manager hierarchy' USING ERRCODE='23514'; END IF;
  path:=array_append(path,current_id); found_head:=found_head OR node.role::text='sales_head'; current_id:=node.manager_id;
 END LOOP;
 IF NOT found_head THEN RAISE EXCEPTION 'Verified Head ancestor required' USING ERRCODE='23514'; END IF;
 RETURN path;
END$$;
CREATE FUNCTION private.sales_target_authorize_v1(manager uuid,approving boolean DEFAULT false) RETURNS uuid[]
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE actor public.users:=private.sales_target_actor_v1(); chain uuid[];
BEGIN
 chain:=private.sales_target_chain_v1(manager);
 IF NOT ((actor.role::text='sales_manager' AND actor.id=manager AND NOT approving)
  OR actor.role::text='executive' OR (actor.role::text='sales_head' AND actor.id=ANY(chain))) THEN
  RAISE EXCEPTION 'Target scope denied' USING ERRCODE='42501';
 END IF;
 RETURN chain;
END$$;
CREATE FUNCTION private.sales_target_roster_v1(manager uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
WITH people AS (
 SELECT u.id,u.full_name,'direct_report'::text ownership FROM public.users u WHERE u.is_active AND u.role::text='sales_person' AND u.manager_id=manager
 UNION ALL SELECT u.id,u.full_name,'exclusive_manager' FROM public.users u WHERE u.id=manager AND EXISTS(
 SELECT 1 FROM public.customer_manager_assignments a WHERE a.manager_id=manager)
), rows AS (
 SELECT p.*,coalesce((SELECT jsonb_agg(jsonb_build_object('customerId',c.id,'name',c.name,'assignmentId',a.id,'assignmentVersion',a.version) ORDER BY c.id)
 FROM public.customer_manager_assignments a JOIN public.customers c ON c.id=a.customer_id
 WHERE a.manager_id=p.id),'[]') customers FROM people p
)
SELECT jsonb_build_object('chain',(SELECT jsonb_agg(jsonb_build_object('id',u.id,'role',u.role,'managerId',u.manager_id,'active',u.is_active) ORDER BY u.id) FROM public.users u WHERE u.id=ANY(private.sales_target_chain_v1(manager))),
 'people',coalesce((SELECT jsonb_agg(jsonb_build_object('personId',id,'name',full_name,'ownership',ownership,'customers',customers) ORDER BY id) FROM rows),'[]'))
$$;
CREATE FUNCTION private.sales_target_roster_hash_v1(roster jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$SELECT encode(sha256(convert_to(roster::text,'UTF8')),'hex')$$;
CREATE FUNCTION private.sales_target_immutable_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$BEGIN
 RAISE EXCEPTION 'Immutable target history' USING ERRCODE='55000';
END$$;
CREATE TRIGGER sales_target_events_immutable BEFORE UPDATE OR DELETE ON private.sales_target_events FOR EACH ROW EXECUTE FUNCTION private.sales_target_immutable_v1();
CREATE TRIGGER sales_target_requests_immutable BEFORE UPDATE OR DELETE ON private.sales_target_requests FOR EACH ROW EXECUTE FUNCTION private.sales_target_immutable_v1();
CREATE FUNCTION private.sales_target_publication_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$BEGIN
 IF TG_TABLE_NAME='sales_target_plans' THEN
  IF TG_OP='DELETE' OR (OLD.state IN('published','superseded') AND
    (TG_OP<>'UPDATE' OR OLD.state<>'published' OR NEW.state<>'superseded' OR
      (to_jsonb(NEW)-ARRAY['state','version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','version','updated_at']))) THEN
   RAISE EXCEPTION 'Published target revision is immutable' USING ERRCODE='55000';
  END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM private.sales_target_plans p WHERE p.id=coalesce(NEW.plan_id,OLD.plan_id) AND p.state IN('published','superseded')) THEN
   RAISE EXCEPTION 'Published target contents are immutable' USING ERRCODE='55000';
  END IF;
 END IF;
 RETURN coalesce(NEW,OLD);
END$$;
CREATE TRIGGER sales_target_plan_publication_guard BEFORE UPDATE OR DELETE ON private.sales_target_plans FOR EACH ROW EXECUTE FUNCTION private.sales_target_publication_guard_v1();
CREATE TRIGGER sales_target_line_publication_guard BEFORE INSERT OR UPDATE OR DELETE ON private.sales_target_lines FOR EACH ROW EXECUTE FUNCTION private.sales_target_publication_guard_v1();
CREATE TRIGGER sales_target_roster_publication_guard BEFORE INSERT OR UPDATE OR DELETE ON private.sales_target_roster FOR EACH ROW EXECUTE FUNCTION private.sales_target_publication_guard_v1();
DO $$DECLARE relation regclass; BEGIN
 FOREACH relation IN ARRAY ARRAY['private.sales_target_schema'::regclass,'private.sales_target_history_coverage'::regclass,'private.sales_target_plans'::regclass,'private.sales_target_lines'::regclass,'private.sales_target_roster'::regclass,'private.sales_target_active'::regclass,'private.sales_target_events'::regclass,'private.sales_target_requests'::regclass] LOOP
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('REVOKE ALL ON %s FROM PUBLIC,anon,authenticated,service_role',relation);
 END LOOP;
END$$;
REVOKE ALL ON FUNCTION private.sales_target_enabled_v1(),private.sales_target_actor_v1(),private.sales_target_month_v1(date),private.sales_target_calendar_month_v1(timestamptz),private.sales_target_chain_v1(uuid),private.sales_target_authorize_v1(uuid,boolean),private.sales_target_roster_v1(uuid),private.sales_target_roster_hash_v1(jsonb),private.sales_target_immutable_v1(),private.sales_target_publication_guard_v1() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE private.sales_target_roster_id_seq,private.sales_target_events_id_seq FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
