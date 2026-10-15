-- Inactive integrated remaining-writer candidate. No activation or global-readiness claim.
-- Requires 01, 04, new06 and the exact promotion-owner / visit pure extractors.
-- The caller owns installation transaction, timeouts, identity gate and rollback.
-- Production remains generation 1 / tracking false. Base service ACL/FK parity is
-- not reconstructible from this public repository, so raw gen2 readiness is BLOCKED.
DO $preflight$ DECLARE entry record; BEGIN
 FOR entry IN SELECT * FROM (VALUES
 ('public.pilot_promotion_transaction_v1(uuid,text,jsonb)','e1253899543a3f1426972e25402d3921b6c196efcd97b6b7088c2765571fc3f7')
,('public.pilot_assign_store_owner_v1(uuid,uuid,uuid,bigint)','e1cbbd75ab17e37c5712e2a84ff80c8ad8fa67a1c04a2dffbc37b52e941defb4')
,('public.pilot_schedule_transaction_v1(uuid,text,jsonb)','fecb08d548db4bb61c57b767cb20a763425bbc89188e961003d0aa642e2f48cc')
,('public.pilot_finalize_visit(uuid,text,jsonb)','0df84efa4a1b82d552f16772b1fe5a562fa0acd10ede6b84fdfd69e63d929260')
,('public.pilot_co_evidence_transaction_v1(uuid,text,jsonb)','09b0bece164b911bb6a25114ab76b5ef5ba2ff1a46020c9747a88e9141dd6fb7')
,('public.pilot_co_evidence_attest_v1(uuid,uuid,uuid,text,bigint,text,text)','7e9a6d0ed5d73d716c47f0bd4b697668dc9aca5fb1097925e5899be2f5d8a4df')
 ) x(signature,body_hash) LOOP
  IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_catalog.pg_proc WHERE oid=entry.signature::regprocedure) IS DISTINCT FROM entry.body_hash THEN
   RAISE EXCEPTION 'Final remaining-writer source drift; refused' USING ERRCODE='55000'; END IF;
 END LOOP;
 IF to_regprocedure('private.catalog_extract_promotion_owner_event_v1(regclass,text,jsonb,jsonb)') IS NULL
 OR to_regprocedure('private.catalog_extract_visit_reference_event_v1(regclass,text,jsonb,jsonb)') IS NULL THEN
  RAISE EXCEPTION 'Pinned pure reference extractors required' USING ERRCODE='55000'; END IF;
END $preflight$;
-- Admission-only drain is also used by raw public DML. It preserves the caller's
-- existing grants, RLS, FK actions and direct PO/Executive product deletion.
-- This does NOT upgrade a raw writer or certify its complete lock order.
CREATE FUNCTION private.catalog_writer_drain_v2() RETURNS smallint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE generation smallint;
BEGIN
 SELECT execution_generation INTO generation FROM private.catalog_cutover_v1 WHERE singleton FOR SHARE;
 IF generation IS NULL THEN RAISE EXCEPTION 'Catalogue admission state missing' USING ERRCODE='55000',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
 RETURN generation;
END $$;
CREATE FUNCTION private.catalog_writer_admit_v2() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE generation smallint;
BEGIN
 generation:=private.catalog_writer_drain_v2();
 IF generation<>2 OR NOT (SELECT tracking_ready FROM private.catalog_cutover_v1 WHERE singleton) THEN
  RAISE EXCEPTION 'Catalogue generation not admitted' USING ERRCODE='55000',DETAIL='CATALOG_GENERATION_RETIRED'; END IF;
END $$;
CREATE TABLE private.catalog_writer_active_v2(backend_pid integer NOT NULL,transaction_id bigint NOT NULL,family text NOT NULL,
 CHECK(family IN('promotion','owner','schedule','visit','evidence','attest')),PRIMARY KEY(backend_pid,transaction_id));
ALTER TABLE private.catalog_writer_active_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.catalog_writer_active_v2 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.catalog_writer_active_v2() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM private.catalog_writer_active_v2 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current())
$$;
CREATE FUNCTION private.catalog_writer_enter_v2(family text,admit boolean) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF admit THEN PERFORM private.catalog_writer_admit_v2(); ELSE PERFORM private.catalog_writer_drain_v2(); END IF;
 INSERT INTO private.catalog_writer_active_v2 VALUES(pg_backend_pid(),txid_current(),family);
END $$;
CREATE FUNCTION private.catalog_writer_leave_v2() RETURNS void LANGUAGE sql SET search_path='' AS $$
 DELETE FROM private.catalog_writer_active_v2 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current()
$$;
CREATE FUNCTION private.catalog_writer_context_empty_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM private.catalog_writer_active_v2 WHERE backend_pid=NEW.backend_pid AND transaction_id=NEW.transaction_id) THEN
  RAISE EXCEPTION 'Remaining writer context cannot survive commit' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER catalog_writer_context_empty_v2 AFTER INSERT ON private.catalog_writer_active_v2
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.catalog_writer_context_empty_v2();

-- Repair PO legacy admission without changing its default, old bodies or replay.
CREATE OR REPLACE FUNCTION private.demo_order_execution_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE generation smallint;
BEGIN
 IF NEW.operation NOT IN('submit_sales','create_po','approve_sales','reject_sales','edit_po','save_delivery','void_delivery','cancel_po','edit_sj_returned_date') THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM private.pilot_order_requests r WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id
  AND r.operation=NEW.operation AND r.payload=NEW.payload AND r.result IS NOT NULL AND NOT r.abandoned) THEN RETURN NEW; END IF;
 generation:=private.catalog_writer_drain_v2();
 IF NEW.operation='submit_sales' OR NEW.execution_version=0 OR (NEW.execution_version=1 AND generation<>1)
 OR (NEW.execution_version=2 AND NOT private.catalog_po_active_v2()) THEN
  RAISE EXCEPTION 'Old order execution retired at cutover' USING ERRCODE='42501',DETAIL='CATALOG_GENERATION_RETIRED'; END IF;
 RETURN NEW;
END $$;
-- Evidence has its own family. Never broaden the order replay allowlist.
CREATE OR REPLACE FUNCTION private.catalog_co_execution_fence_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE generation smallint; family text;
BEGIN
 IF NEW.status='abandoned' THEN RETURN NEW; END IF;
 generation:=private.catalog_writer_drain_v2();
 IF NEW.execution_version=1 THEN
  IF generation<>1 THEN RAISE EXCEPTION 'Old CO execution retired at cutover' USING ERRCODE='42501',DETAIL='CATALOG_GENERATION_RETIRED'; END IF;
 ELSE
  SELECT w.family INTO family FROM private.catalog_writer_active_v2 w WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
  IF ((NEW.operation IN('register_evidence','finalize_evidence') AND family='evidence')
    OR (NEW.operation NOT IN('register_evidence','finalize_evidence') AND private.catalog_co_active_v2())) IS NOT TRUE THEN
   RAISE EXCEPTION 'Private command-family context required' USING ERRCODE='42501',DETAIL='CATALOG_GENERATION_RETIRED'; END IF;
 END IF;
 RETURN NEW;
END $$;
LOCK TABLE private.pilot_promotion_requests,private.pilot_schedule_requests,private.pilot_visit_requests IN SHARE ROW EXCLUSIVE MODE NOWAIT;
ALTER TABLE private.pilot_promotion_requests ADD COLUMN execution_version smallint NOT NULL DEFAULT 1 CHECK(execution_version IN(1,2));
ALTER TABLE private.pilot_schedule_requests ADD COLUMN execution_version smallint NOT NULL DEFAULT 1 CHECK(execution_version IN(1,2));
ALTER TABLE private.pilot_visit_requests ADD COLUMN execution_version smallint NOT NULL DEFAULT 1 CHECK(execution_version IN(1,2));
CREATE FUNCTION private.catalog_family_execution_fence_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior jsonb; generation smallint; family text;
BEGIN
 IF NEW.abandoned THEN RETURN NEW; END IF;
 -- Legacy promotion uses INSERT ON CONFLICT before recognizing replay. Do not
 -- turn that discarded attempt into fresh admission or lifetime use.
 EXECUTE format('SELECT to_jsonb(r) FROM %I.%I r WHERE actor_id=$1 AND request_id=$2',TG_TABLE_SCHEMA,TG_TABLE_NAME)
 INTO prior USING NEW.actor_id,NEW.request_id;
 IF prior->'result'<>'null'::jsonb AND (prior->>'abandoned')::boolean=false
 AND prior->>'operation'=NEW.operation AND prior->'payload'=NEW.payload THEN RETURN NEW; END IF;
 generation:=private.catalog_writer_drain_v2();
 IF NEW.execution_version=1 THEN
  IF generation<>1 THEN RAISE EXCEPTION 'Old writer execution retired at cutover' USING ERRCODE='42501',DETAIL='CATALOG_GENERATION_RETIRED'; END IF;
 ELSE
  SELECT w.family INTO family FROM private.catalog_writer_active_v2 w WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
  IF family IS DISTINCT FROM TG_ARGV[0] THEN RAISE EXCEPTION 'Private writer-family context required' USING ERRCODE='42501',DETAIL='CATALOG_GENERATION_RETIRED'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER catalog_family_execution_fence_v2 BEFORE INSERT ON private.pilot_promotion_requests FOR EACH ROW EXECUTE FUNCTION private.catalog_family_execution_fence_v2('promotion');
CREATE TRIGGER catalog_family_execution_fence_v2 BEFORE INSERT ON private.pilot_schedule_requests FOR EACH ROW EXECUTE FUNCTION private.catalog_family_execution_fence_v2('schedule');
CREATE TRIGGER catalog_family_execution_fence_v2 BEFORE INSERT ON private.pilot_visit_requests FOR EACH ROW EXECUTE FUNCTION private.catalog_family_execution_fence_v2('visit');

CREATE FUNCTION private.catalog_raw_drain_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM private.catalog_writer_drain_v2(); RETURN NULL; END $$;
DO $raw_drain$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['public.customers','public.products','public.customer_targets','public.customer_manager_assignments','public.customer_sales_rep_assignments',
 'public.purchase_orders','public.po_line_items','public.po_audit_log','public.girard_orders','public.girard_order_items','public.orders','public.order_line_items',
 'public.surat_jalan','public.sj_line_items','public.promotions','public.sales_schedules','public.visit_requests','public.outlet_visits','public.visit_photos'] LOOP
  EXECUTE format('CREATE TRIGGER catalog_raw_drain_v2 BEFORE INSERT OR UPDATE OR DELETE ON %s FOR EACH STATEMENT EXECUTE FUNCTION private.catalog_raw_drain_v2()',relation);
 END LOOP;
END $raw_drain$;
-- Stage08 explicitly denies raw service writes here. Only the attestation API is
-- authorized; a delayed already-loaded v1 body therefore must retire after drain.
CREATE FUNCTION private.catalog_attest_execution_fence_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE generation smallint;
BEGIN
 generation:=private.catalog_writer_drain_v2();
 IF generation<>1 AND NOT EXISTS(SELECT 1 FROM private.catalog_writer_active_v2
  WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND family='attest') THEN
  RAISE EXCEPTION 'Old attestation execution retired at cutover' USING ERRCODE='42501',DETAIL='CATALOG_GENERATION_RETIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER catalog_attest_execution_fence_v2 BEFORE INSERT ON private.co_evidence_verifications FOR EACH ROW EXECUTE FUNCTION private.catalog_attest_execution_fence_v2();

-- All business/authority locks already precede this complete typed master phase.
-- Visit photo completion updates customers.last_visit_date: take its final
-- NO KEY UPDATE mode immediately, never SHARE followed by an upgrade.
CREATE FUNCTION private.catalog_writer_master_phase_v2(customers uuid[],products uuid[],visit_completion boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE key uuid; ref record; state text;
BEGIN
 FOR key IN SELECT DISTINCT x FROM unnest(customers) x WHERE x IS NOT NULL ORDER BY x LOOP
  IF visit_completion THEN PERFORM 1 FROM public.customers c WHERE c.id=key FOR NO KEY UPDATE;
  ELSE PERFORM 1 FROM public.customers c WHERE c.id=key FOR SHARE; END IF;
 END LOOP;
 FOR key IN SELECT DISTINCT x FROM unnest(products) x WHERE x IS NOT NULL ORDER BY x LOOP
  PERFORM 1 FROM public.products p WHERE p.id=key FOR NO KEY UPDATE;
 END LOOP;
 LOCK TABLE private.catalog_identity_v1 IN ROW EXCLUSIVE MODE NOWAIT;
 FOR ref IN SELECT 'customer'::text kind,x id FROM unnest(customers) x WHERE x IS NOT NULL
  UNION SELECT 'product',x FROM unnest(products) x WHERE x IS NOT NULL ORDER BY 1,2 LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('catalog_identity_v1:'||ref.kind||':'||ref.id::text,1801427913)) THEN
   RAISE EXCEPTION 'Catalogue identity is busy' USING ERRCODE='55P03',DETAIL='CATALOG_IDENTITY_BUSY'; END IF;
  SELECT i.lifetime_state INTO state FROM private.catalog_identity_v1 i WHERE i.kind=ref.kind AND i.id=ref.id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Catalogue identity evidence missing' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
  IF state<>'used' THEN UPDATE private.catalog_identity_v1 i SET lifetime_state='used' WHERE i.kind=ref.kind AND i.id=ref.id; END IF;
 END LOOP;
END $$;
-- Evidence customer-state + draft locks precede this phase. Every extant immutable
-- stock key is business evidence already; disabled masters do not block uploads.
CREATE FUNCTION private.catalog_evidence_master_phase_v2(customer uuid) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE products uuid[]; key uuid; ref record; state text;
BEGIN
 SELECT array_agg(DISTINCT k.product_id ORDER BY k.product_id) INTO products FROM private.co_stock_keys k WHERE k.customer_id=customer AND k.product_id IS NOT NULL;
 PERFORM 1 FROM public.customers c WHERE c.id=customer FOR SHARE;
 FOREACH key IN ARRAY coalesce(products,'{}'::uuid[]) LOOP PERFORM 1 FROM public.products p WHERE p.id=key FOR SHARE; END LOOP;
 LOCK TABLE private.catalog_identity_v1 IN ROW EXCLUSIVE MODE NOWAIT;
 FOR ref IN SELECT 'customer'::text kind,customer id UNION ALL SELECT 'product',x FROM unnest(products) x ORDER BY 1,2 LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('catalog_identity_v1:'||ref.kind||':'||ref.id::text,1801427913)) THEN
   RAISE EXCEPTION 'Catalogue identity is busy' USING ERRCODE='55P03',DETAIL='CATALOG_IDENTITY_BUSY'; END IF;
  SELECT i.lifetime_state INTO state FROM private.catalog_identity_v1 i WHERE i.kind=ref.kind AND i.id=ref.id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Catalogue identity evidence missing' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
  IF state<>'used' THEN UPDATE private.catalog_identity_v1 i SET lifetime_state='used' WHERE i.kind=ref.kind AND i.id=ref.id; END IF;
 END LOOP;
END $$;

-- Actual OLD and NEW are queued at each row event. Assertions only read; no
-- deferred locks, repair, current-scope lookup, or inferred request marking.
CREATE FUNCTION private.catalog_writer_assert_event_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_row jsonb; new_row jsonb; extraction jsonb; ref jsonb; row_data jsonb; key uuid;
 relation text:=TG_TABLE_SCHEMA||'.'||TG_TABLE_NAME;
BEGIN
 IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW); END IF;
 IF relation IN('private.pilot_promotion_requests','private.pilot_store_owner_audit_v1') THEN
  extraction:=private.catalog_extract_promotion_owner_event_v1(TG_RELID,TG_OP,old_row-'execution_version',new_row-'execution_version');
 ELSIF relation IN('private.pilot_schedule_requests','private.pilot_visit_requests','private.pilot_visit_workflow_audit') THEN
  extraction:=private.catalog_extract_visit_reference_event_v1(TG_RELID,TG_OP,old_row-'execution_version',new_row-'execution_version');
 END IF;
 IF extraction IS NOT NULL THEN
  IF extraction->'ok' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Unrecognized actual writer snapshot' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
  FOR ref IN SELECT value FROM jsonb_array_elements(extraction->'extraction'->'refs') LOOP
   PERFORM private.catalog_po_assert_ref_v2(ref->>'kind',(ref->>'id')::uuid);
  END LOOP;
  -- Edges remain bounded by the named writer's locked parents and their direct
  -- actual-row assertions, not claimed as a general raw history resolver.
  RETURN NULL;
 END IF;
 FOR row_data IN SELECT x FROM unnest(ARRAY[old_row,new_row]) x WHERE x IS NOT NULL LOOP
  IF relation IN('public.customer_manager_assignments','public.visit_requests','private.co_evidence','private.co_customer_state') THEN
   PERFORM private.catalog_po_assert_ref_v2('customer',(row_data->>'customer_id')::uuid);
  ELSIF relation IN('public.sales_schedules','public.outlet_visits') THEN
   PERFORM private.catalog_po_assert_ref_v2('customer',(row_data->>'outlet_id')::uuid);
  ELSIF relation='public.promotions' THEN PERFORM private.catalog_po_assert_ref_v2('product',(row_data->>'product_id')::uuid);
  ELSIF relation='private.pilot_promo_movements' THEN
   SELECT p.product_id INTO key FROM public.promotions p WHERE p.id=(row_data->>'promotion_id')::uuid;
   IF NOT FOUND THEN RAISE EXCEPTION 'Missing held campaign lineage' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
   PERFORM private.catalog_po_assert_ref_v2('product',key);
  ELSIF relation='public.visit_photos' THEN
   SELECT v.outlet_id INTO key FROM public.outlet_visits v WHERE v.id=(row_data->>'visit_id')::uuid;
   IF NOT FOUND THEN RAISE EXCEPTION 'Missing immutable visit lineage' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
   PERFORM private.catalog_po_assert_ref_v2('customer',key);
  ELSIF relation='private.co_evidence_verifications' THEN
   SELECT e.customer_id INTO key FROM private.co_evidence e WHERE e.id=(row_data->>'evidence_id')::uuid;
   IF NOT FOUND THEN RAISE EXCEPTION 'Missing immutable evidence lineage' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
   PERFORM private.catalog_po_assert_ref_v2('customer',key);
  ELSIF relation IN('private.co_drafts','private.co_audit_events','private.co_commands') THEN
   PERFORM private.catalog_co_assert_json_v2(row_data);
  ELSE RAISE EXCEPTION 'Unexpected remaining-writer event' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NULL;
END $$;
DO $assertions$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['private.pilot_promotion_requests','private.pilot_store_owner_audit_v1','private.pilot_schedule_requests','private.pilot_visit_requests','private.pilot_visit_workflow_audit',
 'public.customer_manager_assignments','public.visit_requests','public.sales_schedules','public.outlet_visits','public.visit_photos','public.promotions','private.pilot_promo_movements',
 'private.co_evidence','private.co_evidence_verifications','private.co_drafts','private.co_audit_events','private.co_commands','private.co_customer_state'] LOOP
  EXECUTE format('CREATE CONSTRAINT TRIGGER catalog_writer_assert_v2 AFTER INSERT OR UPDATE OR DELETE ON %s DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (private.catalog_writer_active_v2()) EXECUTE FUNCTION private.catalog_writer_assert_event_v2()',relation);
 END LOOP;
END $assertions$;
CREATE FUNCTION private.catalog_schedule_source_customers_v2(schedule uuid) RETURNS uuid[] LANGUAGE plpgsql SET search_path='' AS $$
DECLARE customers uuid[]:='{}'; snapshot jsonb; parsed jsonb;
BEGIN
 IF schedule IS NULL THEN RETURN customers; END IF;
 FOR snapshot IN
  SELECT to_jsonb(s) FROM public.sales_schedules s WHERE s.id=schedule
  UNION
  SELECT x.snapshot FROM private.pilot_visit_workflow_audit a
   CROSS JOIN LATERAL (VALUES(a.old_value),(a.new_value),(a.old_value->'schedule'),(a.new_value->'schedule')) x(snapshot)
   WHERE x.snapshot->>'id'=schedule::text AND (x.snapshot?'outlet_id' OR a.operation IN('create_schedule','edit_schedule','delete_schedule'))
 LOOP
  -- Validate every relevant known native schedule observation, not merely its UUID.
  parsed:=private.catalog_vr_snapshot_v1('schedule',snapshot,'source_schedule','OLD');
  customers:=array_append(customers,(snapshot->>'outlet_id')::uuid);
 END LOOP;
 IF cardinality(customers)=0 THEN
  RAISE EXCEPTION 'Retained source schedule lineage required' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
 RETURN customers;
END $$;


CREATE FUNCTION private.catalog_promotion_legacy_v1(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE actor uuid:=auth.uid(); role public.user_role; prior private.pilot_promotion_requests%ROWTYPE;
 campaign public.promotions%ROWTYPE; id uuid; product uuid; n numeric; k text; v_result jsonb; is_new boolean;
BEGIN
 -- co_access_boundary_v1: checked before any data read/replay.
 IF public.current_user_role() IS DISTINCT FROM 'executive'::public.user_role THEN RAISE EXCEPTION 'Module access denied' USING ERRCODE='42501'; END IF;
 role:=private.demo_order_actor();
 IF role NOT IN ('po_admin','executive') THEN RAISE EXCEPTION 'Promotion administration required' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_operation NOT IN ('create_promotion','edit_promotion','adjust_stock','set_active') OR p_operation IS NULL THEN RAISE EXCEPTION 'Invalid promotion request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_request_id::text,0));
 INSERT INTO private.pilot_promotion_requests(actor_id,request_id,operation,payload) VALUES(actor,p_request_id,p_operation,p_payload) ON CONFLICT DO NOTHING;
 SELECT * INTO prior FROM private.pilot_promotion_requests r WHERE r.actor_id=actor AND r.request_id=p_request_id FOR UPDATE;
 IF prior.abandoned THEN RAISE EXCEPTION 'Promotion request safely abandoned' USING ERRCODE='55000'; END IF;
 IF prior.operation IS DISTINCT FROM p_operation OR prior.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'Request ID already used with different input' USING ERRCODE='22023'; END IF;
 IF prior.result IS NOT NULL THEN RETURN prior.result; END IF;
 is_new:=p_operation='create_promotion';
 IF is_new THEN
  PERFORM private.demo_payload_keys(p_payload,ARRAY['id','product_id','opening_quantity','image_path','harga_pokok','luar_kota','dalam_kota','depo_bangunan','is_active']);
  id:=(p_payload->>'id')::uuid; product:=(p_payload->>'product_id')::uuid;
 ELSE
  id:=(p_payload->>'promotion_id')::uuid;
  SELECT p.product_id INTO product FROM public.promotions p WHERE p.id=id AND p.stock_managed;
 END IF;
 IF id IS NULL OR product IS NULL THEN RAISE EXCEPTION 'Managed promotion and catalog product required' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.products p WHERE p.id=product FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Catalog product unavailable' USING ERRCODE='22023'; END IF;
 IF NOT is_new THEN
  SELECT * INTO campaign FROM public.promotions p WHERE p.id=id FOR UPDATE;
  IF jsonb_typeof(p_payload->'expected_stock_version') IS DISTINCT FROM 'number' OR (p_payload->>'expected_stock_version')::numeric<>trunc((p_payload->>'expected_stock_version')::numeric) THEN RAISE EXCEPTION 'Expected stock version required' USING ERRCODE='22023'; END IF;
  IF (p_payload->>'expected_stock_version')::numeric IS DISTINCT FROM campaign.stock_version THEN RAISE EXCEPTION 'Promotion changed; refresh before saving' USING ERRCODE='PT409',DETAIL='{"code":"PROMOTION_VERSION_CONFLICT"}'; END IF;
 END IF;
 IF p_operation IN ('create_promotion','edit_promotion') THEN
  IF NOT is_new THEN PERFORM private.demo_payload_keys(p_payload,ARRAY['promotion_id','expected_stock_version','image_path','harga_pokok','luar_kota','dalam_kota','depo_bangunan']); END IF;
  FOREACH k IN ARRAY ARRAY['harga_pokok','luar_kota','dalam_kota','depo_bangunan'] LOOP
   IF p_payload->k='null'::jsonb THEN CONTINUE; END IF;
   IF jsonb_typeof(p_payload->k) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Nullable numeric tier price required' USING ERRCODE='22023'; END IF;
   n:=(p_payload->>k)::numeric;
   IF n<0 OR n>999999999999.99 OR n<>round(n,2) THEN RAISE EXCEPTION 'Invalid tier price' USING ERRCODE='22023'; END IF;
  END LOOP;
  -- An unchanged linked image may have been uploaded by a different administrator.
  IF is_new OR p_payload->>'image_path' IS DISTINCT FROM campaign.image_path THEN
   IF NOT coalesce(private.demo_promotion_object(p_payload->>'image_path',actor,id),false) THEN RAISE EXCEPTION 'Owned valid promotion image required' USING ERRCODE='42501'; END IF;
  END IF;
 END IF;
 IF is_new THEN
  IF jsonb_typeof(p_payload->'opening_quantity') IS DISTINCT FROM 'number' OR jsonb_typeof(p_payload->'is_active') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Opening quantity and active flag required' USING ERRCODE='22023'; END IF;
  n:=(p_payload->>'opening_quantity')::numeric;
  IF n<0 OR n>2147483647 OR n<>trunc(n) THEN RAISE EXCEPTION 'Invalid opening stock' USING ERRCODE='22023'; END IF;
  INSERT INTO public.promotions(id,product_id,start_date,end_date,harga_pokok,luar_kota,dalam_kota,depo_bangunan,created_by,is_active,stock_managed,remaining_quantity,image_path)
  VALUES(id,product,current_date,current_date,(p_payload->>'harga_pokok')::numeric,(p_payload->>'luar_kota')::numeric,(p_payload->>'dalam_kota')::numeric,(p_payload->>'depo_bangunan')::numeric,actor,(p_payload->>'is_active')::boolean,true,n::bigint,p_payload->>'image_path');
  INSERT INTO private.pilot_promo_movements(promotion_id,actor_id,request_id,quantity_delta,event_kind) VALUES(id,actor,p_request_id,n::bigint,'opening');
 ELSIF p_operation='edit_promotion' THEN
  UPDATE public.promotions p SET image_path=p_payload->>'image_path',harga_pokok=(p_payload->>'harga_pokok')::numeric,luar_kota=(p_payload->>'luar_kota')::numeric,dalam_kota=(p_payload->>'dalam_kota')::numeric,depo_bangunan=(p_payload->>'depo_bangunan')::numeric,stock_version=p.stock_version+1 WHERE p.id=id;
 ELSIF p_operation='adjust_stock' THEN
  PERFORM private.demo_payload_keys(p_payload,ARRAY['promotion_id','expected_stock_version','quantity_delta','reason']);
  IF jsonb_typeof(p_payload->'quantity_delta') IS DISTINCT FROM 'number' OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' OR nullif(btrim(p_payload->>'reason'),'') IS NULL OR length(p_payload->>'reason')>1000 THEN RAISE EXCEPTION 'Stock delta and reason required' USING ERRCODE='22023'; END IF;
  n:=(p_payload->>'quantity_delta')::numeric;
  IF n=0 OR n<>trunc(n) OR abs(n)>2147483647 OR campaign.remaining_quantity+n<0 OR campaign.remaining_quantity+n+(SELECT coalesce(sum(s.quantity),0) FROM private.pilot_promo_slices s WHERE s.promotion_id=id)>2147483647 THEN RAISE EXCEPTION 'Stock adjustment outside balance limits' USING ERRCODE='22023'; END IF;
  UPDATE public.promotions p SET remaining_quantity=p.remaining_quantity+n::bigint,stock_version=p.stock_version+1 WHERE p.id=id;
  INSERT INTO private.pilot_promo_movements(promotion_id,actor_id,request_id,quantity_delta,event_kind,reason) VALUES(id,actor,p_request_id,n::bigint,'adjustment',btrim(p_payload->>'reason'));
 ELSE
  PERFORM private.demo_payload_keys(p_payload,ARRAY['promotion_id','expected_stock_version','is_active']);
  IF jsonb_typeof(p_payload->'is_active') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Active flag required' USING ERRCODE='22023'; END IF;
  UPDATE public.promotions p SET is_active=(p_payload->>'is_active')::boolean,stock_version=p.stock_version+1 WHERE p.id=id;
 END IF;
 SELECT jsonb_build_object('id',p.id,'stock_version',p.stock_version) INTO v_result FROM public.promotions p WHERE p.id=id;
 UPDATE private.pilot_promotion_requests r SET result=v_result WHERE r.actor_id=actor AND r.request_id=p_request_id;
 RETURN v_result;
END $$;

CREATE FUNCTION private.catalog_owner_legacy_v1(p_customer_id uuid,p_owner_id uuid,p_expected_assignment_id uuid,p_expected_version bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); previous public.customer_manager_assignments%ROWTYPE; next_row public.customer_manager_assignments%ROWTYPE;
BEGIN
 -- The same ordering as PO capture/visit writes prevents a mutable authority race.
 LOCK TABLE public.users IN SHARE MODE;
 IF actor IS NULL OR public.current_user_role() IS NULL OR public.current_user_role() NOT IN('sales_head','executive') THEN RAISE EXCEPTION 'Sales leadership assignment permission required' USING ERRCODE='42501'; END IF;
 LOCK TABLE public.customer_manager_assignments IN SHARE ROW EXCLUSIVE MODE;
 IF p_customer_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer_id) THEN RAISE EXCEPTION 'Customer required' USING ERRCODE='22023'; END IF;
 IF (p_expected_assignment_id IS NULL)<>(p_expected_version IS NULL) OR p_expected_version<1 THEN RAISE EXCEPTION 'Complete expected assignment version required' USING ERRCODE='22023'; END IF;
 SELECT * INTO previous FROM public.customer_manager_assignments WHERE customer_id=p_customer_id FOR UPDATE;
 IF previous.id IS DISTINCT FROM p_expected_assignment_id OR previous.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Penanggung jawab berubah. Muat ulang sebelum menyimpan.' USING ERRCODE='40001'; END IF;
 IF p_owner_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_owner_id AND is_active AND role IN('sales_person','sales_manager','sales_head','executive')) THEN RAISE EXCEPTION 'Active sales responsible person required' USING ERRCODE='22023'; END IF;
 IF previous.manager_id IS NOT DISTINCT FROM p_owner_id THEN
  RETURN jsonb_build_object('customer_id',p_customer_id,'manager_id',previous.manager_id,'id',previous.id,'version',previous.version);
 END IF;
 IF p_owner_id IS NULL THEN
  -- Keep the row/version after clearing so empty -> assigned -> empty is not an ABA bypass.
  UPDATE public.customer_manager_assignments SET manager_id=NULL,assigned_by=actor,assigned_at=clock_timestamp() WHERE customer_id=p_customer_id RETURNING * INTO next_row;
 ELSIF previous.id IS NULL THEN
  INSERT INTO public.customer_manager_assignments(customer_id,manager_id,assigned_by,assigned_at) VALUES(p_customer_id,p_owner_id,actor,clock_timestamp()) RETURNING * INTO next_row;
 ELSE
  UPDATE public.customer_manager_assignments SET manager_id=p_owner_id,assigned_by=actor,assigned_at=clock_timestamp() WHERE customer_id=p_customer_id RETURNING * INTO next_row;
 END IF;
 INSERT INTO private.pilot_store_owner_audit_v1(customer_id,changed_by,before_assignment,after_assignment)
 VALUES(p_customer_id,actor,CASE WHEN previous.id IS NOT NULL THEN to_jsonb(previous) END,CASE WHEN next_row.id IS NOT NULL THEN to_jsonb(next_row) END);
 RETURN jsonb_build_object('customer_id',p_customer_id,'manager_id',next_row.manager_id,'id',next_row.id,'version',next_row.version);
END $$;

CREATE FUNCTION private.catalog_schedule_legacy_v1(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
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

CREATE FUNCTION private.catalog_visit_legacy_v1(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
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

CREATE FUNCTION private.catalog_evidence_legacy_v1(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.co_actor_v1(); r jsonb; d private.co_drafts%ROWTYPE; e private.co_evidence%ROWTYPE; a private.co_evidence_verifications%ROWTYPE; c uuid; cv bigint; filename text; mime text; size bigint; digest text; old_id uuid;
BEGIN
 r:=private.co_evidence_begin_v1(p_request_id,p_operation,p_payload); IF r IS NOT NULL THEN RETURN r; END IF;
 IF p_operation='register_evidence' THEN
  PERFORM private.co_input_object_v1(p_payload,ARRAY['draft_id','expected_draft_version','expected_customer_version','filename','mime_type','byte_size','sha256'],ARRAY['draft_id','expected_draft_version','expected_customer_version','filename','mime_type','byte_size','sha256']);
  SELECT customer_id INTO c FROM private.co_drafts WHERE id=private.co_input_uuid_v1(p_payload->'draft_id') AND kind='report';
 ELSE
  PERFORM private.co_input_object_v1(p_payload,ARRAY['evidence_id','expected_evidence_version','expected_draft_version','expected_customer_version'],ARRAY['evidence_id','expected_evidence_version','expected_draft_version','expected_customer_version']);
  SELECT customer_id INTO c FROM private.co_evidence WHERE id=private.co_input_uuid_v1(p_payload->'evidence_id');
 END IF;
 cv:=private.co_lock_customer_v1(c,private.co_input_version_v1(p_payload->'expected_customer_version'));
 IF p_operation='register_evidence' THEN
  SELECT * INTO d FROM private.co_drafts WHERE id=(p_payload->>'draft_id')::uuid AND customer_id=c FOR UPDATE;
  PERFORM private.co_evidence_draft_v1(d,private.co_input_version_v1(p_payload->'expected_draft_version'),cv);
  filename:=private.co_input_text_v1(p_payload->'filename');mime:=private.co_input_text_v1(p_payload->'mime_type');digest:=private.co_input_text_v1(p_payload->'sha256');
  IF jsonb_typeof(p_payload->'byte_size') IS DISTINCT FROM 'number' OR p_payload->>'byte_size'!~'^[1-9][0-9]{0,7}$' THEN RAISE EXCEPTION 'Invalid evidence size' USING ERRCODE='22023'; END IF;size:=(p_payload->>'byte_size')::bigint;
  IF size>10485760 OR digest!~'^[a-f0-9]{64}$' OR mime NOT IN('application/pdf','image/png','image/jpeg') OR length(filename)>200 OR filename~'[[:cntrl:]/\\]' OR filename!~*(CASE mime WHEN 'application/pdf' THEN '^[^.].*\.pdf$' WHEN 'image/png' THEN '^[^.].*\.png$' ELSE '^[^.].*\.jpe?g$' END) THEN RAISE EXCEPTION 'Invalid evidence declaration' USING ERRCODE='22023'; END IF;
  INSERT INTO private.co_evidence(customer_id,draft_id,draft_version,customer_version,report_month,bound_report_revision_id,source_context_fingerprint,created_by,request_id,mime_type,byte_size,sha256)
  VALUES(c,d.id,d.version,cv,d.report_month,(d.payload->>'bound_report_revision_id')::uuid,d.payload->'source_context'->>'source_context_fingerprint',actor,p_request_id,mime,size,digest)
  ON CONFLICT(draft_id,draft_version,sha256,mime_type,byte_size) DO NOTHING RETURNING * INTO e;
  IF e.id IS NULL THEN
   SELECT * INTO e FROM private.co_evidence
   WHERE draft_id=d.id AND draft_version=d.version AND sha256=digest AND mime_type=mime AND byte_size=size;
   -- Keep the original unique identity and creator-only upload/finalize boundary.
   -- A second authorized operator must not receive an unusable committed success.
   IF e.created_by<>actor THEN
    RAISE EXCEPTION 'CO_EVIDENCE_REGISTERED_BY_OTHER_ACTOR' USING ERRCODE='PT409';
   END IF;
  END IF;
 ELSE
  SELECT * INTO e FROM private.co_evidence WHERE id=(p_payload->>'evidence_id')::uuid;
  SELECT * INTO d FROM private.co_drafts WHERE id=e.draft_id FOR UPDATE;
  SELECT * INTO e FROM private.co_evidence WHERE id=e.id FOR UPDATE;
  IF e.created_by<>actor THEN RAISE EXCEPTION 'Evidence registration actor required' USING ERRCODE='42501'; END IF;
  PERFORM private.co_evidence_draft_v1(d,private.co_input_version_v1(p_payload->'expected_draft_version'),cv);
  IF e.version<>private.co_input_version_v1(p_payload->'expected_evidence_version') OR d.version<>e.draft_version OR cv<>e.customer_version THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
  IF e.version<>1 THEN RAISE EXCEPTION 'Evidence already finalized' USING ERRCODE='55000'; END IF;
  SELECT * INTO a FROM private.co_evidence_verifications WHERE evidence_id=e.id;
  IF a.evidence_id IS NULL THEN RAISE EXCEPTION 'Evidence not verified' USING ERRCODE='55000'; END IF;
  PERFORM private.co_evidence_object_v1(e,a.object_id,a.object_version,a.byte_size,a.mime_type,a.sha256);
  old_id:=d.evidence_id;
  UPDATE private.co_drafts SET evidence_id=e.id,version=version+1 WHERE id=d.id;
  UPDATE private.co_evidence SET version=2,finalized_draft_version=d.version+1 WHERE id=e.id RETURNING * INTO e;
 END IF;
 INSERT INTO private.co_audit_events(customer_id,actor_id,request_id,operation,before_state,after_state) VALUES(c,actor,p_request_id,p_operation,jsonb_build_object('evidence_id',old_id),private.co_evidence_json_v1(e));
 RETURN private.co_command_commit_v1(p_request_id,jsonb_build_object('id',e.id,'operation',p_operation,'version',e.version::text,'customer_id',c,'customer_version',cv::text));
END $$;

CREATE FUNCTION private.catalog_attest_legacy_v1(p_actor_id uuid,p_evidence_id uuid,p_object_id uuid,p_object_version text,p_byte_size bigint,p_mime_type text,p_sha256 text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e private.co_evidence%ROWTYPE; d private.co_drafts%ROWTYPE; a private.co_evidence_verifications%ROWTYPE; cv bigint;
BEGIN
 PERFORM 1 FROM public.users WHERE id=p_actor_id AND is_active AND role IN('co_admin','executive') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CO authority required' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM private.co_evidence WHERE id=p_evidence_id AND created_by=p_actor_id;
 IF e.id IS NULL THEN RAISE EXCEPTION 'Invalid evidence identity' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('co-command:'||p_actor_id::text||':'||e.request_id::text,0));
 SELECT version INTO cv FROM private.co_customer_state WHERE customer_id=e.customer_id FOR UPDATE;
 SELECT * INTO d FROM private.co_drafts WHERE id=e.draft_id FOR UPDATE;
 SELECT * INTO e FROM private.co_evidence WHERE id=p_evidence_id FOR UPDATE;
 SELECT * INTO a FROM private.co_evidence_verifications WHERE evidence_id=e.id;
 PERFORM private.co_evidence_object_v1(e,p_object_id,p_object_version,p_byte_size,p_mime_type,p_sha256);
 IF a.evidence_id IS NOT NULL THEN
  IF (a.object_id,a.object_version,a.byte_size,a.mime_type,a.sha256) IS DISTINCT FROM (p_object_id,p_object_version,p_byte_size,p_mime_type,p_sha256) THEN RAISE EXCEPTION 'Immutable verification mismatch' USING ERRCODE='PT409'; END IF;
  RETURN jsonb_build_object('id',e.id,'state',CASE WHEN e.version=2 THEN 'finalized' ELSE 'verified' END);
 END IF;
 IF cv<>e.customer_version THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 PERFORM private.co_evidence_draft_v1(d,e.draft_version,cv);
 INSERT INTO private.co_evidence_verifications(evidence_id,object_id,object_version,byte_size,mime_type,sha256,verified_by) VALUES(e.id,p_object_id,p_object_version,p_byte_size,p_mime_type,p_sha256,p_actor_id);
 RETURN jsonb_build_object('id',e.id,'state','verified');
END $$;

CREATE FUNCTION private.catalog_evidence_replay_v2(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE actor uuid:=private.co_actor_v1(); command private.co_commands%ROWTYPE; fingerprint text;
BEGIN
 IF p_request_id IS NULL OR p_operation IS NULL OR p_operation NOT IN('register_evidence','finalize_evidence') OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Invalid evidence command' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('co-command:'||actor::text||':'||p_request_id::text,0));
 fingerprint:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 SELECT * INTO command FROM private.co_commands WHERE actor_id=actor AND request_id=p_request_id FOR UPDATE;
 IF command.status='abandoned' THEN RAISE EXCEPTION 'CO request abandoned' USING ERRCODE='55000'; END IF;
 IF command.actor_id IS NOT NULL THEN
  IF command.operation<>p_operation OR command.payload_fingerprint<>fingerprint THEN RAISE EXCEPTION 'CO request identity mismatch' USING ERRCODE='22023'; END IF;
  IF command.status='committed' THEN RETURN command.receipt; END IF;
  RAISE EXCEPTION 'Evidence command executing' USING ERRCODE='55000';
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION private.catalog_evidence_begin_v2(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 result:=private.catalog_evidence_replay_v2(p_request_id,p_operation,p_payload);
 IF result IS NOT NULL THEN RETURN result; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.catalog_writer_active_v2 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND family='evidence') THEN
  RAISE EXCEPTION 'Private evidence command context required' USING ERRCODE='42501'; END IF;
 INSERT INTO private.co_commands(actor_id,request_id,operation,payload_fingerprint,status,execution_version)
 VALUES(auth.uid(),p_request_id,p_operation,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),'pending',2);
 RETURN NULL;
END $$;

CREATE FUNCTION private.catalog_promotion_core_v2(p_request_id uuid,p_operation text,p_payload jsonb,p_admit boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE actor uuid:=auth.uid(); role public.user_role; prior private.pilot_promotion_requests%ROWTYPE;
 campaign public.promotions%ROWTYPE; id uuid; product uuid; n numeric; k text; v_result jsonb; is_new boolean;
BEGIN
 -- co_access_boundary_v1: checked before any data read/replay.
 IF public.current_user_role() IS DISTINCT FROM 'executive'::public.user_role THEN RAISE EXCEPTION 'Module access denied' USING ERRCODE='42501'; END IF;
 role:=private.demo_order_actor();
 IF role NOT IN ('po_admin','executive') THEN RAISE EXCEPTION 'Promotion administration required' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_operation NOT IN ('create_promotion','edit_promotion','adjust_stock','set_active') OR p_operation IS NULL THEN RAISE EXCEPTION 'Invalid promotion request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_request_id::text,0));
 SELECT * INTO prior FROM private.pilot_promotion_requests r WHERE r.actor_id=actor AND r.request_id=p_request_id FOR UPDATE;
 IF prior.abandoned THEN RAISE EXCEPTION 'Promotion request safely abandoned' USING ERRCODE='55000'; END IF;
 IF prior.request_id IS NOT NULL AND (prior.operation IS DISTINCT FROM p_operation OR prior.payload IS DISTINCT FROM p_payload) THEN RAISE EXCEPTION 'Request ID already used with different input' USING ERRCODE='22023'; END IF;
 IF prior.result IS NOT NULL THEN RETURN prior.result; END IF;
 PERFORM private.catalog_writer_enter_v2('promotion',p_admit);
 INSERT INTO private.pilot_promotion_requests(actor_id,request_id,operation,payload,execution_version) VALUES(actor,p_request_id,p_operation,p_payload,2);
 is_new:=p_operation='create_promotion';
 IF is_new THEN
  PERFORM private.demo_payload_keys(p_payload,ARRAY['id','product_id','opening_quantity','image_path','harga_pokok','luar_kota','dalam_kota','depo_bangunan','is_active']);
  id:=(p_payload->>'id')::uuid; product:=(p_payload->>'product_id')::uuid;
 ELSE
  id:=(p_payload->>'promotion_id')::uuid;
  SELECT p.product_id INTO product FROM public.promotions p WHERE p.id=id AND p.stock_managed;
 END IF;
 IF id IS NULL OR product IS NULL THEN RAISE EXCEPTION 'Managed promotion and catalog product required' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.products p WHERE p.id=product FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Catalog product unavailable' USING ERRCODE='22023'; END IF;
 IF NOT is_new THEN
  SELECT * INTO campaign FROM public.promotions p WHERE p.id=id FOR UPDATE;
  IF jsonb_typeof(p_payload->'expected_stock_version') IS DISTINCT FROM 'number' OR (p_payload->>'expected_stock_version')::numeric<>trunc((p_payload->>'expected_stock_version')::numeric) THEN RAISE EXCEPTION 'Expected stock version required' USING ERRCODE='22023'; END IF;
  IF (p_payload->>'expected_stock_version')::numeric IS DISTINCT FROM campaign.stock_version THEN RAISE EXCEPTION 'Promotion changed; refresh before saving' USING ERRCODE='PT409',DETAIL='{"code":"PROMOTION_VERSION_CONFLICT"}'; END IF;
 END IF;
 PERFORM private.catalog_writer_master_phase_v2('{}'::uuid[],ARRAY[product]);
 IF p_operation IN ('create_promotion','edit_promotion') THEN
  IF NOT is_new THEN PERFORM private.demo_payload_keys(p_payload,ARRAY['promotion_id','expected_stock_version','image_path','harga_pokok','luar_kota','dalam_kota','depo_bangunan']); END IF;
  FOREACH k IN ARRAY ARRAY['harga_pokok','luar_kota','dalam_kota','depo_bangunan'] LOOP
   IF p_payload->k='null'::jsonb THEN CONTINUE; END IF;
   IF jsonb_typeof(p_payload->k) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Nullable numeric tier price required' USING ERRCODE='22023'; END IF;
   n:=(p_payload->>k)::numeric;
   IF n<0 OR n>999999999999.99 OR n<>round(n,2) THEN RAISE EXCEPTION 'Invalid tier price' USING ERRCODE='22023'; END IF;
  END LOOP;
  -- An unchanged linked image may have been uploaded by a different administrator.
  IF is_new OR p_payload->>'image_path' IS DISTINCT FROM campaign.image_path THEN
   IF NOT coalesce(private.demo_promotion_object(p_payload->>'image_path',actor,id),false) THEN RAISE EXCEPTION 'Owned valid promotion image required' USING ERRCODE='42501'; END IF;
  END IF;
 END IF;
 IF is_new THEN
  IF jsonb_typeof(p_payload->'opening_quantity') IS DISTINCT FROM 'number' OR jsonb_typeof(p_payload->'is_active') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Opening quantity and active flag required' USING ERRCODE='22023'; END IF;
  n:=(p_payload->>'opening_quantity')::numeric;
  IF n<0 OR n>2147483647 OR n<>trunc(n) THEN RAISE EXCEPTION 'Invalid opening stock' USING ERRCODE='22023'; END IF;
  INSERT INTO public.promotions(id,product_id,start_date,end_date,harga_pokok,luar_kota,dalam_kota,depo_bangunan,created_by,is_active,stock_managed,remaining_quantity,image_path)
  VALUES(id,product,current_date,current_date,(p_payload->>'harga_pokok')::numeric,(p_payload->>'luar_kota')::numeric,(p_payload->>'dalam_kota')::numeric,(p_payload->>'depo_bangunan')::numeric,actor,(p_payload->>'is_active')::boolean,true,n::bigint,p_payload->>'image_path');
  INSERT INTO private.pilot_promo_movements(promotion_id,actor_id,request_id,quantity_delta,event_kind) VALUES(id,actor,p_request_id,n::bigint,'opening');
 ELSIF p_operation='edit_promotion' THEN
  UPDATE public.promotions p SET image_path=p_payload->>'image_path',harga_pokok=(p_payload->>'harga_pokok')::numeric,luar_kota=(p_payload->>'luar_kota')::numeric,dalam_kota=(p_payload->>'dalam_kota')::numeric,depo_bangunan=(p_payload->>'depo_bangunan')::numeric,stock_version=p.stock_version+1 WHERE p.id=id;
 ELSIF p_operation='adjust_stock' THEN
  PERFORM private.demo_payload_keys(p_payload,ARRAY['promotion_id','expected_stock_version','quantity_delta','reason']);
  IF jsonb_typeof(p_payload->'quantity_delta') IS DISTINCT FROM 'number' OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' OR nullif(btrim(p_payload->>'reason'),'') IS NULL OR length(p_payload->>'reason')>1000 THEN RAISE EXCEPTION 'Stock delta and reason required' USING ERRCODE='22023'; END IF;
  n:=(p_payload->>'quantity_delta')::numeric;
  IF n=0 OR n<>trunc(n) OR abs(n)>2147483647 OR campaign.remaining_quantity+n<0 OR campaign.remaining_quantity+n+(SELECT coalesce(sum(s.quantity),0) FROM private.pilot_promo_slices s WHERE s.promotion_id=id)>2147483647 THEN RAISE EXCEPTION 'Stock adjustment outside balance limits' USING ERRCODE='22023'; END IF;
  UPDATE public.promotions p SET remaining_quantity=p.remaining_quantity+n::bigint,stock_version=p.stock_version+1 WHERE p.id=id;
  INSERT INTO private.pilot_promo_movements(promotion_id,actor_id,request_id,quantity_delta,event_kind,reason) VALUES(id,actor,p_request_id,n::bigint,'adjustment',btrim(p_payload->>'reason'));
 ELSE
  PERFORM private.demo_payload_keys(p_payload,ARRAY['promotion_id','expected_stock_version','is_active']);
  IF jsonb_typeof(p_payload->'is_active') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Active flag required' USING ERRCODE='22023'; END IF;
  UPDATE public.promotions p SET is_active=(p_payload->>'is_active')::boolean,stock_version=p.stock_version+1 WHERE p.id=id;
 END IF;
 SELECT jsonb_build_object('id',p.id,'stock_version',p.stock_version) INTO v_result FROM public.promotions p WHERE p.id=id;
 UPDATE private.pilot_promotion_requests r SET result=v_result WHERE r.actor_id=actor AND r.request_id=p_request_id;
 PERFORM private.catalog_writer_leave_v2();
 RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.pilot_promotion_transaction_v1(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE generation smallint;
BEGIN
 SELECT execution_generation INTO generation FROM private.catalog_cutover_v1 WHERE singleton;
 IF generation=1 THEN RETURN private.catalog_promotion_legacy_v1(p_request_id,p_operation,p_payload); END IF;
 RETURN private.catalog_promotion_core_v2(p_request_id,p_operation,p_payload,true);
END $$;

CREATE FUNCTION private.catalog_owner_core_v2(p_customer_id uuid,p_owner_id uuid,p_expected_assignment_id uuid,p_expected_version bigint,p_admit boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); previous public.customer_manager_assignments%ROWTYPE; next_row public.customer_manager_assignments%ROWTYPE;
BEGIN
 -- The same ordering as PO capture/visit writes prevents a mutable authority race.
 LOCK TABLE public.users IN SHARE MODE;
 IF actor IS NULL OR public.current_user_role() IS NULL OR public.current_user_role() NOT IN('sales_head','executive') THEN RAISE EXCEPTION 'Sales leadership assignment permission required' USING ERRCODE='42501'; END IF;
 LOCK TABLE public.customer_manager_assignments IN SHARE ROW EXCLUSIVE MODE;
 IF p_customer_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer_id) THEN RAISE EXCEPTION 'Customer required' USING ERRCODE='22023'; END IF;
 IF (p_expected_assignment_id IS NULL)<>(p_expected_version IS NULL) OR p_expected_version<1 THEN RAISE EXCEPTION 'Complete expected assignment version required' USING ERRCODE='22023'; END IF;
 SELECT * INTO previous FROM public.customer_manager_assignments WHERE customer_id=p_customer_id FOR UPDATE;
 IF previous.id IS DISTINCT FROM p_expected_assignment_id OR previous.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Penanggung jawab berubah. Muat ulang sebelum menyimpan.' USING ERRCODE='40001'; END IF;
 IF p_owner_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_owner_id AND is_active AND role IN('sales_person','sales_manager','sales_head','executive')) THEN RAISE EXCEPTION 'Active sales responsible person required' USING ERRCODE='22023'; END IF;
 IF previous.manager_id IS NOT DISTINCT FROM p_owner_id THEN
  RETURN jsonb_build_object('customer_id',p_customer_id,'manager_id',previous.manager_id,'id',previous.id,'version',previous.version);
 END IF;
 PERFORM private.catalog_writer_enter_v2('owner',p_admit);
 PERFORM private.catalog_writer_master_phase_v2(ARRAY[p_customer_id,previous.customer_id],'{}'::uuid[]);
 IF p_owner_id IS NULL THEN
  -- Keep the row/version after clearing so empty -> assigned -> empty is not an ABA bypass.
  UPDATE public.customer_manager_assignments SET manager_id=NULL,assigned_by=actor,assigned_at=clock_timestamp() WHERE customer_id=p_customer_id RETURNING * INTO next_row;
 ELSIF previous.id IS NULL THEN
  INSERT INTO public.customer_manager_assignments(customer_id,manager_id,assigned_by,assigned_at) VALUES(p_customer_id,p_owner_id,actor,clock_timestamp()) RETURNING * INTO next_row;
 ELSE
  UPDATE public.customer_manager_assignments SET manager_id=p_owner_id,assigned_by=actor,assigned_at=clock_timestamp() WHERE customer_id=p_customer_id RETURNING * INTO next_row;
 END IF;
 INSERT INTO private.pilot_store_owner_audit_v1(customer_id,changed_by,before_assignment,after_assignment)
 VALUES(p_customer_id,actor,CASE WHEN previous.id IS NOT NULL THEN to_jsonb(previous) END,CASE WHEN next_row.id IS NOT NULL THEN to_jsonb(next_row) END);
 PERFORM private.catalog_writer_leave_v2();
 RETURN jsonb_build_object('customer_id',p_customer_id,'manager_id',next_row.manager_id,'id',next_row.id,'version',next_row.version);
END $$;

CREATE OR REPLACE FUNCTION public.pilot_assign_store_owner_v1(p_customer_id uuid,p_owner_id uuid,p_expected_assignment_id uuid,p_expected_version bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE generation smallint;
BEGIN
 SELECT execution_generation INTO generation FROM private.catalog_cutover_v1 WHERE singleton;
 IF generation=1 THEN RETURN private.catalog_owner_legacy_v1(p_customer_id,p_owner_id,p_expected_assignment_id,p_expected_version); END IF;
 RETURN private.catalog_owner_core_v2(p_customer_id,p_owner_id,p_expected_assignment_id,p_expected_version,true);
END $$;

CREATE FUNCTION private.catalog_schedule_core_v2(p_request_id uuid,p_operation text,p_payload jsonb,p_admit boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); prior private.pilot_schedule_requests%ROWTYPE; s public.sales_schedules%ROWTYPE; r public.visit_requests%ROWTYPE; v public.outlet_visits%ROWTYPE;
 context jsonb; v_result jsonb; before_value jsonb; resource uuid; person uuid; customer uuid; day date; note text; expected integer; allowed text[]; catalog_customers uuid[];
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
 PERFORM private.catalog_writer_enter_v2('schedule',p_admit);
 catalog_customers:=ARRAY[customer,s.outlet_id,r.customer_id,v.outlet_id]||private.catalog_schedule_source_customers_v2(r.source_schedule_id);
 PERFORM private.catalog_writer_master_phase_v2(catalog_customers,'{}'::uuid[]);
 INSERT INTO private.pilot_schedule_requests(actor_id,request_id,operation,payload,authority,execution_version) VALUES(actor,p_request_id,p_operation,p_payload,context,2);
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
 PERFORM private.catalog_writer_leave_v2();
 RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.pilot_schedule_transaction_v1(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE generation smallint;
BEGIN
 SELECT execution_generation INTO generation FROM private.catalog_cutover_v1 WHERE singleton;
 IF generation=1 THEN RETURN private.catalog_schedule_legacy_v1(p_request_id,p_operation,p_payload); END IF;
 RETURN private.catalog_schedule_core_v2(p_request_id,p_operation,p_payload,true);
END $$;

CREATE FUNCTION private.catalog_visit_core_v2(p_request_id uuid,p_operation text,p_payload jsonb,p_admit boolean) RETURNS jsonb
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
 PERFORM private.catalog_writer_enter_v2('visit',p_admit);
 PERFORM private.catalog_writer_master_phase_v2(ARRAY[s.outlet_id],'{}'::uuid[],true);
 INSERT INTO private.pilot_visit_requests(actor_id,request_id,operation,payload,execution_version) VALUES(actor,p_request_id,p_operation,p_payload,2);
 moment:=clock_timestamp();
 INSERT INTO public.outlet_visits(outlet_id,sales_person_id,schedule_id,checked_in_at,lat,lng,notes) VALUES(s.outlet_id,actor,s.id,moment,latitude,longitude,p_payload->>'notes') RETURNING id INTO visit;
 INSERT INTO public.visit_photos(visit_id,storage_path,taken_at,lat,lng) VALUES(visit,path,moment,latitude,longitude);
 v_result:=jsonb_build_object('id',visit);
 UPDATE private.pilot_visit_requests r SET result=v_result WHERE r.actor_id=actor AND r.request_id=p_request_id;
 PERFORM private.catalog_writer_leave_v2();
 RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.pilot_finalize_visit(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE generation smallint;
BEGIN
 SELECT execution_generation INTO generation FROM private.catalog_cutover_v1 WHERE singleton;
 IF generation=1 THEN RETURN private.catalog_visit_legacy_v1(p_request_id,p_operation,p_payload); END IF;
 RETURN private.catalog_visit_core_v2(p_request_id,p_operation,p_payload,true);
END $$;

CREATE FUNCTION private.catalog_evidence_core_v2(p_request_id uuid,p_operation text,p_payload jsonb,p_admit boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.co_actor_v1(); r jsonb; d private.co_drafts%ROWTYPE; e private.co_evidence%ROWTYPE; a private.co_evidence_verifications%ROWTYPE; c uuid; cv bigint; filename text; mime text; size bigint; digest text; old_id uuid;
BEGIN
 r:=private.catalog_evidence_replay_v2(p_request_id,p_operation,p_payload); IF r IS NOT NULL THEN RETURN r; END IF;
 PERFORM private.catalog_writer_enter_v2('evidence',p_admit);
 PERFORM private.catalog_evidence_begin_v2(p_request_id,p_operation,p_payload);
 IF p_operation='register_evidence' THEN
  PERFORM private.co_input_object_v1(p_payload,ARRAY['draft_id','expected_draft_version','expected_customer_version','filename','mime_type','byte_size','sha256'],ARRAY['draft_id','expected_draft_version','expected_customer_version','filename','mime_type','byte_size','sha256']);
  SELECT customer_id INTO c FROM private.co_drafts WHERE id=private.co_input_uuid_v1(p_payload->'draft_id') AND kind='report';
 ELSE
  PERFORM private.co_input_object_v1(p_payload,ARRAY['evidence_id','expected_evidence_version','expected_draft_version','expected_customer_version'],ARRAY['evidence_id','expected_evidence_version','expected_draft_version','expected_customer_version']);
  SELECT customer_id INTO c FROM private.co_evidence WHERE id=private.co_input_uuid_v1(p_payload->'evidence_id');
 END IF;
 cv:=private.catalog_co_customer_phase_v2(c,private.co_input_version_v1(p_payload->'expected_customer_version'),'[]'::jsonb);
 IF p_operation='register_evidence' THEN
  SELECT * INTO d FROM private.co_drafts WHERE id=(p_payload->>'draft_id')::uuid AND customer_id=c FOR UPDATE;
  PERFORM private.co_evidence_draft_v1(d,private.co_input_version_v1(p_payload->'expected_draft_version'),cv);
  filename:=private.co_input_text_v1(p_payload->'filename');mime:=private.co_input_text_v1(p_payload->'mime_type');digest:=private.co_input_text_v1(p_payload->'sha256');
  IF jsonb_typeof(p_payload->'byte_size') IS DISTINCT FROM 'number' OR p_payload->>'byte_size'!~'^[1-9][0-9]{0,7}$' THEN RAISE EXCEPTION 'Invalid evidence size' USING ERRCODE='22023'; END IF;size:=(p_payload->>'byte_size')::bigint;
  IF size>10485760 OR digest!~'^[a-f0-9]{64}$' OR mime NOT IN('application/pdf','image/png','image/jpeg') OR length(filename)>200 OR filename~'[[:cntrl:]/\\]' OR filename!~*(CASE mime WHEN 'application/pdf' THEN '^[^.].*\.pdf$' WHEN 'image/png' THEN '^[^.].*\.png$' ELSE '^[^.].*\.jpe?g$' END) THEN RAISE EXCEPTION 'Invalid evidence declaration' USING ERRCODE='22023'; END IF;
  INSERT INTO private.co_evidence(customer_id,draft_id,draft_version,customer_version,report_month,bound_report_revision_id,source_context_fingerprint,created_by,request_id,mime_type,byte_size,sha256)
  VALUES(c,d.id,d.version,cv,d.report_month,(d.payload->>'bound_report_revision_id')::uuid,d.payload->'source_context'->>'source_context_fingerprint',actor,p_request_id,mime,size,digest)
  ON CONFLICT(draft_id,draft_version,sha256,mime_type,byte_size) DO NOTHING RETURNING * INTO e;
  IF e.id IS NULL THEN
   SELECT * INTO e FROM private.co_evidence
   WHERE draft_id=d.id AND draft_version=d.version AND sha256=digest AND mime_type=mime AND byte_size=size;
   -- Keep the original unique identity and creator-only upload/finalize boundary.
   -- A second authorized operator must not receive an unusable committed success.
   IF e.created_by<>actor THEN
    RAISE EXCEPTION 'CO_EVIDENCE_REGISTERED_BY_OTHER_ACTOR' USING ERRCODE='PT409';
   END IF;
  END IF;
 ELSE
  SELECT * INTO e FROM private.co_evidence WHERE id=(p_payload->>'evidence_id')::uuid;
  SELECT * INTO d FROM private.co_drafts WHERE id=e.draft_id FOR UPDATE;
  SELECT * INTO e FROM private.co_evidence WHERE id=e.id FOR UPDATE;
  IF e.created_by<>actor THEN RAISE EXCEPTION 'Evidence registration actor required' USING ERRCODE='42501'; END IF;
  PERFORM private.co_evidence_draft_v1(d,private.co_input_version_v1(p_payload->'expected_draft_version'),cv);
  IF e.version<>private.co_input_version_v1(p_payload->'expected_evidence_version') OR d.version<>e.draft_version OR cv<>e.customer_version THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
  IF e.version<>1 THEN RAISE EXCEPTION 'Evidence already finalized' USING ERRCODE='55000'; END IF;
  SELECT * INTO a FROM private.co_evidence_verifications WHERE evidence_id=e.id;
  IF a.evidence_id IS NULL THEN RAISE EXCEPTION 'Evidence not verified' USING ERRCODE='55000'; END IF;
  PERFORM private.co_evidence_object_v1(e,a.object_id,a.object_version,a.byte_size,a.mime_type,a.sha256);
  old_id:=d.evidence_id;
  UPDATE private.co_drafts SET evidence_id=e.id,version=version+1 WHERE id=d.id;
  UPDATE private.co_evidence SET version=2,finalized_draft_version=d.version+1 WHERE id=e.id RETURNING * INTO e;
 END IF;
 INSERT INTO private.co_audit_events(customer_id,actor_id,request_id,operation,before_state,after_state) VALUES(c,actor,p_request_id,p_operation,jsonb_build_object('evidence_id',old_id),private.co_evidence_json_v1(e));
 r:=private.co_command_commit_v1(p_request_id,jsonb_build_object('id',e.id,'operation',p_operation,'version',e.version::text,'customer_id',c,'customer_version',cv::text));
 PERFORM private.catalog_writer_leave_v2();
 RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.pilot_co_evidence_transaction_v1(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE generation smallint;
BEGIN
 SELECT execution_generation INTO generation FROM private.catalog_cutover_v1 WHERE singleton;
 IF generation=1 THEN RETURN private.catalog_evidence_legacy_v1(p_request_id,p_operation,p_payload); END IF;
 RETURN private.catalog_evidence_core_v2(p_request_id,p_operation,p_payload,true);
END $$;

CREATE FUNCTION private.catalog_attest_core_v2(p_actor_id uuid,p_evidence_id uuid,p_object_id uuid,p_object_version text,p_byte_size bigint,p_mime_type text,p_sha256 text,p_admit boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e private.co_evidence%ROWTYPE; d private.co_drafts%ROWTYPE; a private.co_evidence_verifications%ROWTYPE; cv bigint;
BEGIN
 PERFORM 1 FROM public.users WHERE id=p_actor_id AND is_active AND role IN('co_admin','executive') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CO authority required' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM private.co_evidence WHERE id=p_evidence_id AND created_by=p_actor_id;
 IF e.id IS NULL THEN RAISE EXCEPTION 'Invalid evidence identity' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('co-command:'||p_actor_id::text||':'||e.request_id::text,0));
 SELECT version INTO cv FROM private.co_customer_state WHERE customer_id=e.customer_id FOR UPDATE;
 SELECT * INTO d FROM private.co_drafts WHERE id=e.draft_id FOR UPDATE;
 SELECT * INTO e FROM private.co_evidence WHERE id=p_evidence_id;
 SELECT * INTO a FROM private.co_evidence_verifications WHERE evidence_id=e.id;
 PERFORM private.co_evidence_object_v1(e,p_object_id,p_object_version,p_byte_size,p_mime_type,p_sha256);
 IF a.evidence_id IS NOT NULL THEN
  IF (a.object_id,a.object_version,a.byte_size,a.mime_type,a.sha256) IS DISTINCT FROM (p_object_id,p_object_version,p_byte_size,p_mime_type,p_sha256) THEN RAISE EXCEPTION 'Immutable verification mismatch' USING ERRCODE='PT409'; END IF;
  RETURN jsonb_build_object('id',e.id,'state',CASE WHEN e.version=2 THEN 'finalized' ELSE 'verified' END);
 END IF;
 PERFORM private.catalog_writer_enter_v2('attest',p_admit);
 PERFORM private.catalog_evidence_master_phase_v2(e.customer_id);
 SELECT * INTO e FROM private.co_evidence WHERE id=p_evidence_id FOR UPDATE;
 IF cv<>e.customer_version THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 PERFORM private.co_evidence_draft_v1(d,e.draft_version,cv);
 INSERT INTO private.co_evidence_verifications(evidence_id,object_id,object_version,byte_size,mime_type,sha256,verified_by) VALUES(e.id,p_object_id,p_object_version,p_byte_size,p_mime_type,p_sha256,p_actor_id);
 PERFORM private.catalog_writer_leave_v2();
 RETURN jsonb_build_object('id',e.id,'state','verified');
END $$;

CREATE OR REPLACE FUNCTION public.pilot_co_evidence_attest_v1(p_actor_id uuid,p_evidence_id uuid,p_object_id uuid,p_object_version text,p_byte_size bigint,p_mime_type text,p_sha256 text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE generation smallint;
BEGIN
 SELECT execution_generation INTO generation FROM private.catalog_cutover_v1 WHERE singleton;
 IF generation=1 THEN RETURN private.catalog_attest_legacy_v1(p_actor_id,p_evidence_id,p_object_id,p_object_version,p_byte_size,p_mime_type,p_sha256); END IF;
 RETURN private.catalog_attest_core_v2(p_actor_id,p_evidence_id,p_object_id,p_object_version,p_byte_size,p_mime_type,p_sha256,true);
END $$;

DO $private_acl$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='private' AND (p.proname LIKE 'catalog_writer_%' OR p.proname LIKE 'catalog_evidence_%'
 OR p.proname IN('catalog_raw_drain_v2','catalog_attest_execution_fence_v2','catalog_family_execution_fence_v2','catalog_schedule_source_customers_v2',
 'catalog_promotion_legacy_v1','catalog_owner_legacy_v1','catalog_schedule_legacy_v1','catalog_visit_legacy_v1','catalog_evidence_legacy_v1','catalog_attest_legacy_v1',
 'catalog_promotion_core_v2','catalog_owner_core_v2','catalog_schedule_core_v2','catalog_visit_core_v2','catalog_evidence_core_v2','catalog_attest_core_v2','demo_order_execution_fence','catalog_co_execution_fence_v2')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 END LOOP;
END $private_acl$;
-- Only a zero-argument current-transaction predicate is needed by row WHEN.
GRANT EXECUTE ON FUNCTION private.catalog_writer_active_v2() TO PUBLIC;
DO $complete_acl_postflight$ DECLARE f record; BEGIN
 FOR f IN SELECT p.* FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='private' AND p.proname=ANY(ARRAY['catalog_attest_core_v2','catalog_attest_execution_fence_v2','catalog_attest_legacy_v1','catalog_co_execution_fence_v2','catalog_evidence_begin_v2','catalog_evidence_core_v2','catalog_evidence_legacy_v1','catalog_evidence_master_phase_v2','catalog_evidence_replay_v2','catalog_family_execution_fence_v2','catalog_owner_core_v2','catalog_owner_legacy_v1','catalog_promotion_core_v2','catalog_promotion_legacy_v1','catalog_raw_drain_v2','catalog_schedule_core_v2','catalog_schedule_legacy_v1','catalog_schedule_source_customers_v2','catalog_visit_core_v2','catalog_visit_legacy_v1','catalog_writer_active_v2','catalog_writer_admit_v2','catalog_writer_assert_event_v2','catalog_writer_context_empty_v2','catalog_writer_drain_v2','catalog_writer_enter_v2','catalog_writer_leave_v2','catalog_writer_master_phase_v2','demo_order_execution_fence']) LOOP
  IF f.proowner<>'postgres'::regrole OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']
  OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a
   WHERE a.grantee<>f.proowner AND NOT (f.proname='catalog_writer_active_v2' AND a.grantee=0 AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)) THEN
   RAISE EXCEPTION 'Remaining writer unexpected owner or function grantee' USING ERRCODE='42501'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid='private.catalog_writer_active_v2'::regclass
  AND (c.relowner<>'postgres'::regrole OR NOT c.relrowsecurity OR EXISTS(
   SELECT 1 FROM pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner))) THEN
  RAISE EXCEPTION 'Remaining writer unexpected context-table grantee' USING ERRCODE='42501'; END IF;
END $complete_acl_postflight$;
DO $postflight$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.catalog_cutover_v1 WHERE singleton AND execution_generation=1 AND NOT tracking_ready)
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='private.catalog_cutover_v1'::regclass AND conname='catalog_foundation_generation_one')
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='private.catalog_cutover_v1'::regclass AND conname='catalog_foundation_not_ready') THEN
  RAISE EXCEPTION 'This candidate cannot enable catalogue cutover' USING ERRCODE='55000'; END IF;
END $postflight$;

