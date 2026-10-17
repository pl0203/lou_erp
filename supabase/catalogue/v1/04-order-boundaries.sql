-- Inactive integrated PO candidate, not an activation migration.
-- Foundation remains generation 1 / tracking false. Other writers and global drain are pending.
-- The caller's reviewed transaction owns installation/rollback and all session bounds.
DO $preflight$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='public.pilot_order_transaction(uuid,text,jsonb)'::regprocedure)
   IS DISTINCT FROM '0b1e19441a499ae9c864b2d21aef28ba' THEN
  RAISE EXCEPTION 'Final post-stage07 PO body drift; refused' USING ERRCODE='55000';
 END IF;
 IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='private.pilot_insert_po(uuid,jsonb,jsonb)'::regprocedure)
   IS DISTINCT FROM 'd6edd5e662edf989af8e2b3cfa3e7bac' THEN RAISE EXCEPTION 'Final credit insert drift; refused' USING ERRCODE='55000'; END IF;
END $preflight$;
LOCK TABLE private.pilot_order_requests IN SHARE ROW EXCLUSIVE MODE NOWAIT;
ALTER TABLE private.pilot_order_requests DROP CONSTRAINT pilot_order_requests_execution_version_check;
ALTER TABLE private.pilot_order_requests ADD CONSTRAINT pilot_order_requests_execution_version_check CHECK(execution_version IN(0,1,2));
-- Default remains 0. Already-loaded demo bodies still explicitly write 1.
CREATE OR REPLACE FUNCTION private.demo_order_execution_fence() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.operation IN ('submit_sales','create_po','approve_sales','reject_sales','edit_po','save_delivery','void_delivery','cancel_po','edit_sj_returned_date')
 AND (NEW.operation='submit_sales' OR NEW.execution_version=0 OR
  (NEW.execution_version=1 AND EXISTS(SELECT 1 FROM private.catalog_cutover_v1 WHERE execution_generation=2)))
 AND NOT EXISTS(SELECT 1 FROM private.pilot_order_requests r WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id
  AND r.operation=NEW.operation AND r.payload=NEW.payload AND r.result IS NOT NULL AND NOT r.abandoned)
 THEN RAISE EXCEPTION 'Old order execution retired at cutover' USING ERRCODE='42501',DETAIL='CATALOG_GENERATION_RETIRED'; END IF;
 RETURN NEW;
END $$;
-- A private core event scope, not a raw-DML or legacy-generation bypass.
-- No default, GUC, JSON flag or externally callable routine can establish it.
CREATE TABLE private.catalog_po_active_v2(backend_pid integer NOT NULL,transaction_id bigint NOT NULL,PRIMARY KEY(backend_pid,transaction_id));
ALTER TABLE private.catalog_po_active_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.catalog_po_active_v2 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.catalog_po_active_v2() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM private.catalog_po_active_v2 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current())
$$;
CREATE FUNCTION private.catalog_po_context_empty_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM private.catalog_po_active_v2 WHERE backend_pid=NEW.backend_pid AND transaction_id=NEW.transaction_id) THEN
  RAISE EXCEPTION 'PO core context cannot survive commit' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER catalog_po_context_empty_v2 AFTER INSERT ON private.catalog_po_active_v2
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.catalog_po_context_empty_v2();
CREATE FUNCTION private.catalog_po_assert_ref_v2(kind text,key uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF key IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private.catalog_identity_v1 i WHERE i.kind=catalog_po_assert_ref_v2.kind AND i.id=key AND i.lifetime_state='used') THEN
  RAISE EXCEPTION 'Actual PO reference was not marked used' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
END $$;
CREATE FUNCTION private.catalog_po_assert_items_v2(items jsonb,require_product_key boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb;
BEGIN
 IF items IS NULL OR items='null'::jsonb THEN RETURN; END IF;
 IF jsonb_typeof(items)<>'array' THEN RAISE EXCEPTION 'Malformed PO item snapshot' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
  IF jsonb_typeof(item)<>'object' OR (require_product_key AND NOT item ? 'product_id') OR (item ? 'product_id' AND jsonb_typeof(item->'product_id') NOT IN ('string','null')) THEN RAISE EXCEPTION 'Malformed PO item reference' USING ERRCODE='22023'; END IF;
  PERFORM private.catalog_po_assert_ref_v2('product',(item->>'product_id')::uuid);
 END LOOP;
END $$;
CREATE FUNCTION private.catalog_po_assert_event_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row_data jsonb; rows jsonb:='[]'; relation text:=TG_TABLE_SCHEMA||'.'||TG_TABLE_NAME; parent uuid; key uuid;
BEGIN
 -- WHEN was evaluated at the row event. Never consult the now-cleared context.
 IF TG_OP<>'INSERT' THEN rows:=rows||jsonb_build_array(to_jsonb(OLD)); END IF;
 IF TG_OP<>'DELETE' THEN rows:=rows||jsonb_build_array(to_jsonb(NEW)); END IF;
 FOR row_data IN SELECT value FROM jsonb_array_elements(rows) LOOP
  IF relation IN ('public.purchase_orders','public.girard_orders') THEN
   PERFORM private.catalog_po_assert_ref_v2('customer',(row_data->>'customer_id')::uuid);
  ELSIF relation IN ('public.po_line_items','private.pilot_promo_slices','public.promotions') THEN
   PERFORM private.catalog_po_assert_ref_v2('product',(row_data->>'product_id')::uuid);
  ELSIF relation='private.pilot_order_requests' THEN
   IF row_data->>'operation' IN ('create_po','edit_po') THEN
    IF jsonb_typeof(row_data->'payload')<>'object' OR jsonb_typeof(row_data->'payload'->'items')<>'array' THEN RAISE EXCEPTION 'Malformed PO request snapshot' USING ERRCODE='22023'; END IF;
    PERFORM private.catalog_po_assert_ref_v2('customer',(row_data->'payload'->>'customer_id')::uuid);
    PERFORM private.catalog_po_assert_items_v2(row_data->'payload'->'items');
   ELSIF row_data->>'operation' NOT IN ('approve_sales','reject_sales','save_delivery','void_delivery','cancel_po','edit_sj_returned_date') THEN
    RAISE EXCEPTION 'Unexpected scoped request operation' USING ERRCODE='22023'; END IF;
  ELSIF relation='public.po_audit_log' THEN
   IF row_data->>'field_changed'='po_items_revised' THEN
    PERFORM private.catalog_po_assert_items_v2((row_data->>'old_value')::jsonb,true);
    PERFORM private.catalog_po_assert_items_v2((row_data->>'new_value')::jsonb,true);
   END IF;
  -- Combined bounded-core proof, not an exact indirect event snapshot:
  -- parent rows are held by existing order/campaign locks; supported later
  -- parent changes queue their own direct OLD/NEW reference events above.
  -- In particular, replacing SJ lines then editing a now-unreferenced PO
  -- line is covered by that line UPDATE's OLD product plus the original mark.
  -- Raw/service writes outside this core remain outside the proof.
  ELSIF relation='private.pilot_promo_movements' THEN
   SELECT p.product_id INTO key FROM public.promotions p WHERE p.id=(row_data->>'promotion_id')::uuid;
   IF NOT FOUND THEN RAISE EXCEPTION 'Missing promotion lineage' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
   PERFORM private.catalog_po_assert_ref_v2('product',key);
  ELSIF relation='public.surat_jalan' THEN
   SELECT p.customer_id INTO key FROM public.purchase_orders p WHERE p.id=(row_data->>'purchase_order_id')::uuid;
   IF NOT FOUND THEN RAISE EXCEPTION 'Missing PO lineage' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
   PERFORM private.catalog_po_assert_ref_v2('customer',key);
  ELSIF relation='public.sj_line_items' THEN
   SELECT l.product_id INTO key FROM public.po_line_items l WHERE l.id=(row_data->>'po_line_item_id')::uuid;
   IF NOT FOUND THEN RAISE EXCEPTION 'Missing PO line lineage' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
   PERFORM private.catalog_po_assert_ref_v2('product',key);
  ELSE RAISE EXCEPTION 'Unexpected PO tracking event' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NULL;
END $$;
-- All actual core-written reference-bearing tables, including early request
-- snapshots. Early INSERT queues checks only; it never takes a master/evidence lock.
DO $triggers$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['private.pilot_order_requests','public.purchase_orders','public.po_line_items',
 'public.girard_orders','public.po_audit_log','private.pilot_promo_slices','private.pilot_promo_movements',
 'public.promotions','public.surat_jalan','public.sj_line_items'] LOOP
  EXECUTE format('CREATE CONSTRAINT TRIGGER catalog_po_assert_v2 AFTER INSERT OR UPDATE OR DELETE ON %s DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (private.catalog_po_active_v2()) EXECUTE FUNCTION private.catalog_po_assert_event_v2()',relation);
 END LOOP;
END $triggers$;
REVOKE ALL ON FUNCTION private.catalog_po_active_v2(),private.catalog_po_context_empty_v2(),private.catalog_po_assert_ref_v2(text,uuid),
 private.catalog_po_assert_items_v2(jsonb,boolean),private.catalog_po_assert_event_v2() FROM PUBLIC,anon,authenticated,service_role;
-- Authority/assignment/order locks have already been acquired. All master locks
-- precede all lifetime evidence, and products start in promotion-compatible mode.
CREATE FUNCTION private.catalog_po_master_phase_v2(po uuid,old_customer uuid,new_customer uuid,old_lines jsonb,new_lines jsonb) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE key uuid; ref record; state text; customer_ids uuid[]; product_ids uuid[];
BEGIN
 SELECT array_agg(DISTINCT x ORDER BY x) INTO customer_ids FROM (SELECT x FROM unnest(ARRAY[old_customer,new_customer]) x UNION SELECT g.customer_id FROM public.girard_orders g WHERE g.po_id=po) q WHERE x IS NOT NULL;
 SELECT array_agg(DISTINCT x ORDER BY x) INTO product_ids FROM (
 SELECT (j->>'product_id')::uuid x FROM jsonb_array_elements(coalesce(old_lines,'[]')) j UNION ALL
 SELECT (j->>'product_id')::uuid FROM jsonb_array_elements(coalesce(new_lines,'[]')) j UNION ALL
 SELECT s.product_id FROM private.pilot_promo_slices s WHERE s.purchase_order_id=po) q WHERE x IS NOT NULL;
 FOREACH key IN ARRAY coalesce(customer_ids,'{}'::uuid[]) LOOP
  PERFORM 1 FROM public.customers c WHERE c.id=key FOR SHARE;
 END LOOP;
 FOREACH key IN ARRAY coalesce(product_ids,'{}'::uuid[]) LOOP
  PERFORM 1 FROM public.products p WHERE p.id=key FOR NO KEY UPDATE;
 END LOOP;
 LOCK TABLE private.catalog_identity_v1 IN ROW EXCLUSIVE MODE NOWAIT;
 FOR ref IN SELECT 'customer'::text kind,x id FROM unnest(customer_ids) x
  UNION ALL SELECT 'product',x FROM unnest(product_ids) x ORDER BY 1,2 LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('catalog_identity_v1:'||ref.kind||':'||ref.id::text,1801427913)) THEN
   RAISE EXCEPTION 'Catalogue identity is busy' USING ERRCODE='55P03',DETAIL='CATALOG_IDENTITY_BUSY'; END IF;
  SELECT i.lifetime_state INTO state FROM private.catalog_identity_v1 i WHERE i.kind=ref.kind AND i.id=ref.id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Catalogue tracking incomplete' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
  IF state<>'used' THEN UPDATE private.catalog_identity_v1 i SET lifetime_state='used' WHERE i.kind=ref.kind AND i.id=ref.id; END IF;
 END LOOP;
END $$;

CREATE FUNCTION private.catalog_po_lines_v2(items jsonb,po uuid,request uuid,customer uuid,old_customer uuid,trusted_conversion boolean) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE item jsonb; result jsonb:='[]'; previous public.po_line_items%ROWTYPE; product public.products%ROWTYPE;
 customer_enabled boolean; historical boolean; sequence integer:=0; reserved uuid[]:='{}'; new_id uuid;
BEGIN
 SELECT c.is_enabled INTO customer_enabled FROM public.customers c WHERE c.id=customer;
 IF NOT FOUND OR (NOT customer_enabled AND (po IS NULL OR customer IS DISTINCT FROM old_customer OR trusted_conversion)) THEN
  RAISE EXCEPTION 'Enabled customer required' USING ERRCODE='23514',DETAIL='CATALOG_DISABLED'; END IF;
 SELECT coalesce(array_agg((x->>'id')::uuid) FILTER(WHERE x->>'id' IS NOT NULL),'{}'::uuid[]) INTO reserved FROM jsonb_array_elements(items) x;
 FOR item IN SELECT value FROM jsonb_array_elements(items) ORDER BY value::text LOOP
  sequence:=sequence+1; previous:=NULL; product:=NULL;
  IF NOT trusted_conversion AND item->>'id' IS NOT NULL THEN
   IF po IS NULL THEN RAISE EXCEPTION 'New line cannot claim a persisted identity' USING ERRCODE='22023'; END IF;
   SELECT * INTO previous FROM public.po_line_items l WHERE l.id=(item->>'id')::uuid AND l.purchase_order_id=po;
   IF NOT FOUND THEN RAISE EXCEPTION 'Item does not belong to this PO' USING ERRCODE='22023'; END IF;
  END IF;
  historical:=previous.id IS NOT NULL AND ROW(previous.product_id,previous.sku,previous.product_name)
   IS NOT DISTINCT FROM ROW((item->>'product_id')::uuid,item->>'sku',item->>'product_name');
  SELECT * INTO product FROM public.products p WHERE p.id=(item->>'product_id')::uuid;
  IF trusted_conversion THEN
   -- Loaded only from saved Girard rows; preserve null/manual identities and saved SKU/name/price.
   IF item->>'product_id' IS NOT NULL AND (product.id IS NULL OR NOT product.is_enabled) THEN
    RAISE EXCEPTION 'Enabled conversion product required' USING ERRCODE='23514',DETAIL='CATALOG_DISABLED'; END IF;
  ELSIF NOT historical THEN
   IF item->>'product_id' IS NULL OR product.id IS NULL THEN RAISE EXCEPTION 'Canonical product required' USING ERRCODE='22023'; END IF;
   IF NOT product.is_enabled THEN RAISE EXCEPTION 'Enabled product required' USING ERRCODE='23514',DETAIL='CATALOG_DISABLED'; END IF;
   IF item->>'sku' IS NULL OR lower(btrim(item->>'sku')) IS DISTINCT FROM lower(btrim(product.sku)) THEN
    RAISE EXCEPTION 'Product ID and SKU do not match' USING ERRCODE='22023'; END IF;
  END IF;
  IF NOT customer_enabled AND (NOT historical OR (item->>'quantity')::integer>previous.quantity) THEN
   RAISE EXCEPTION 'Disabled customer historical line cap' USING ERRCODE='23514',DETAIL='CATALOG_DISABLED'; END IF;
  IF historical AND product.id IS NOT NULL AND NOT product.is_enabled AND (item->>'quantity')::integer>previous.quantity THEN
   RAISE EXCEPTION 'Disabled product historical line cap' USING ERRCODE='23514',DETAIL='CATALOG_DISABLED'; END IF;
  IF NOT trusted_conversion AND item->>'id' IS NULL THEN
   new_id:=private.demo_require_new_line_identity(md5(request::text||':'||sequence::text)::uuid,reserved);
   reserved:=array_append(reserved,new_id); item:=item||jsonb_build_object('id',new_id);
  END IF;
  result:=result||jsonb_build_array(item);
 END LOOP;
 RETURN result;
END $$;

CREATE FUNCTION private.catalog_po_insert_v2(actor uuid,payload jsonb,items jsonb,credit jsonb) RETURNS uuid
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE po uuid;
BEGIN
 IF nullif(btrim(payload->>'po_number'),'') IS NULL THEN RAISE EXCEPTION 'PO number required' USING ERRCODE='22023'; END IF;
 INSERT INTO public.purchase_orders(customer_id,created_by,po_number,status,order_date,expected_delivery_date,notes,
 sales_person_id_at_creation,sales_assignment_source_id,sales_attributed_at,sales_attribution_state)
 VALUES ((payload->>'customer_id')::uuid,actor,btrim(payload->>'po_number'),'confirm',coalesce((payload->>'order_date')::date,(clock_timestamp() AT TIME ZONE 'UTC')::date),(payload->>'expected_delivery_date')::date,nullif(payload->>'notes',''),
 (credit->>'sales_person_id_at_creation')::uuid,(credit->>'sales_assignment_source_id')::uuid,(credit->>'sales_attributed_at')::timestamptz,coalesce(credit->>'sales_attribution_state','legacy')) RETURNING id INTO po;
 INSERT INTO public.po_line_items(id,purchase_order_id,product_id,product_name,sku,quantity,unit_price)
 SELECT (x->>'id')::uuid,po,(x->>'product_id')::uuid,x->>'product_name',x->>'sku',(x->>'quantity')::integer,(x->>'unit_price')::numeric FROM jsonb_array_elements(items) x;
 RETURN po;
END $$;
CREATE FUNCTION private.catalog_po_legacy_transaction_v1(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE
 actor uuid:=auth.uid(); role public.user_role; prior private.pilot_order_requests%ROWTYPE;
 po public.purchase_orders%ROWTYPE; so public.girard_orders%ROWTYPE; sj public.surat_jalan%ROWTYPE;
 items jsonb; item jsonb; existing public.po_line_items%ROWTYPE;
 v_result jsonb; id uuid; po_id uuid; customer_id uuid; visit_id uuid; expected timestamptz;
 amount numeric; delivered bigint; qty numeric;
 old_lines jsonb; new_lines jsonb; reason text; supplied_ids uuid[];
BEGIN
 role:=private.demo_order_actor();
 IF role='co_admin' THEN RAISE EXCEPTION 'PO access denied' USING ERRCODE='42501'; END IF;
 IF p_operation IN ('approve_sales','reject_sales') AND role<>'executive' THEN RAISE EXCEPTION 'Executive legacy review required' USING ERRCODE='42501'; END IF;
 IF actor IS NULL OR role IS NULL THEN RAISE EXCEPTION 'Active authenticated profile required' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Request ID and object payload required' USING ERRCODE='22023'; END IF;
 IF p_operation='submit_sales' THEN
  IF role NOT IN ('sales_person','sales_manager','sales_head','executive') THEN RAISE EXCEPTION 'Sales permission required' USING ERRCODE='42501'; END IF;
  customer_id:=(p_payload->>'customer_id')::uuid; visit_id:=(p_payload->>'visit_id')::uuid;
  IF NOT private.pilot_can_access_customer(customer_id) OR NOT EXISTS(SELECT 1 FROM public.outlet_visits v JOIN public.sales_schedules s ON s.id=v.schedule_id WHERE v.id=visit_id AND v.outlet_id=customer_id AND v.sales_person_id=actor AND s.outlet_id=customer_id AND s.sales_person_id=actor) THEN RAISE EXCEPTION 'An assigned customer and actor-owned visit are required' USING ERRCODE='42501'; END IF;
 ELSIF p_operation IN ('create_po','approve_sales','reject_sales','edit_po','save_delivery','void_delivery','cancel_po','edit_sj_returned_date') THEN
  IF role NOT IN ('po_admin','executive') THEN RAISE EXCEPTION 'PO administration permission required' USING ERRCODE='42501'; END IF;
 ELSE RAISE EXCEPTION 'Unsupported order operation' USING ERRCODE='22023'; END IF;
 -- Serialize execution and reconciliation, including requests which have not arrived yet.
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text || ':' || p_request_id::text,0));
 IF p_operation='submit_sales' AND NOT EXISTS(SELECT 1 FROM private.pilot_order_requests r WHERE r.actor_id=actor AND r.request_id=p_request_id AND r.result IS NOT NULL) THEN
  RAISE EXCEPTION 'Sales submission retired; use Athel PO administration' USING ERRCODE='42501'; END IF;
 -- Authorization is checked on every retry before reading a stored result.
 INSERT INTO private.pilot_order_requests(actor_id,request_id,operation,payload,execution_version) VALUES(actor,p_request_id,p_operation,p_payload,1) ON CONFLICT DO NOTHING;
 SELECT * INTO prior FROM private.pilot_order_requests r WHERE r.actor_id=actor AND r.request_id=p_request_id FOR UPDATE;
 IF prior.abandoned THEN RAISE EXCEPTION 'Request was safely abandoned; it cannot execute' USING ERRCODE='55000'; END IF;
 IF prior.operation IS DISTINCT FROM p_operation OR prior.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'Request ID already used with different input; reconcile the prior result' USING ERRCODE='22023'; END IF;
 IF prior.result IS NOT NULL THEN RETURN prior.result; END IF;
 IF p_operation='create_po' THEN
  items:=private.pilot_validate_order_lines(p_payload->'items');
  items:=private.demo_catalog_lines(items,NULL,p_request_id);
  po_id:=private.pilot_insert_po(actor,p_payload||jsonb_build_object('_demo_credit',private.demo_capture_credit((p_payload->>'customer_id')::uuid)),items);
  PERFORM private.demo_account_promo(po_id,'[]',items,actor,p_request_id,p_payload);
  SELECT * INTO po FROM public.purchase_orders WHERE public.purchase_orders.id=po_id;
  v_result:=jsonb_build_object('id',po_id,'updated_at',po.updated_at);
 ELSIF p_operation IN ('approve_sales','reject_sales') THEN
  SELECT * INTO so FROM public.girard_orders WHERE public.girard_orders.id=(p_payload->>'order_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sales order not found' USING ERRCODE='22023'; END IF;
  IF so.status<>'pending' THEN RAISE EXCEPTION 'Sales order is no longer pending' USING ERRCODE='55000'; END IF;
  IF p_operation='approve_sales' THEN
   items:=private.demo_legacy_order_lines(so.id,p_request_id);
   po_id:=private.pilot_insert_po(actor,p_payload || jsonb_build_object('customer_id',so.customer_id,'_demo_credit','{}'::jsonb),items);
   PERFORM private.demo_account_promo(po_id,'[]',items,actor,p_request_id,p_payload);
   UPDATE public.girard_orders SET status='approved',reviewed_by=actor,po_id=po_id,updated_at=clock_timestamp() WHERE public.girard_orders.id=so.id;
   SELECT * INTO po FROM public.purchase_orders WHERE public.purchase_orders.id=po_id;
   v_result:=jsonb_build_object('id',po_id,'updated_at',po.updated_at);
  ELSE
   reason:=nullif(btrim(p_payload->>'reason'),'');
   IF reason IS NULL THEN RAISE EXCEPTION 'Rejection reason required' USING ERRCODE='22023'; END IF;
   UPDATE public.girard_orders SET status='rejected',reviewed_by=actor,rejection_note=reason,updated_at=clock_timestamp() WHERE public.girard_orders.id=so.id;
   v_result:=jsonb_build_object('id',so.id);
  END IF;
 ELSE
  IF p_operation IN ('void_delivery','edit_sj_returned_date') THEN
   SELECT * INTO sj FROM public.surat_jalan WHERE public.surat_jalan.id=(p_payload->>'sj_id')::uuid;
   IF NOT FOUND THEN RAISE EXCEPTION 'Delivery note not found' USING ERRCODE='22023'; END IF;
   po_id:=sj.purchase_order_id;
  ELSE po_id:=(p_payload->>'po_id')::uuid; END IF;
  SELECT * INTO po FROM public.purchase_orders WHERE public.purchase_orders.id=po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PO not found' USING ERRCODE='22023'; END IF;
  expected:=(p_payload->>'expected_updated_at')::timestamptz;
  IF expected IS NULL OR expected IS DISTINCT FROM po.updated_at THEN RAISE EXCEPTION 'PO changed; refresh before saving' USING ERRCODE='PT409'; END IF;
  IF po.status NOT IN ('confirm','in_progress','complete') THEN RAISE EXCEPTION 'PO status does not allow this operation' USING ERRCODE='55000'; END IF;
  IF p_operation IN ('save_delivery','void_delivery') AND po.status='complete' AND (po.completed_at IS NULL OR clock_timestamp()>po.completed_at+interval '7 days') THEN RAISE EXCEPTION 'Completed delivery correction window has ended' USING ERRCODE='55000'; END IF;
  IF p_operation='edit_po' THEN
   IF po.status='complete' THEN RAISE EXCEPTION 'Completed PO cannot be edited' USING ERRCODE='55000'; END IF;
   items:=private.pilot_validate_order_lines(p_payload->'items');
   SELECT array_agg((x->>'id')::uuid) FILTER(WHERE x->>'id' IS NOT NULL) INTO supplied_ids FROM jsonb_array_elements(items) x;
   items:=private.demo_catalog_lines(items,po_id,p_request_id);
   customer_id:=(p_payload->>'customer_id')::uuid;
   IF customer_id IS DISTINCT FROM po.customer_id AND EXISTS(SELECT 1 FROM public.surat_jalan h WHERE h.purchase_order_id=po_id) THEN RAISE EXCEPTION 'Customer is immutable after delivery history' USING ERRCODE='23514'; END IF;
   -- Validate by persisted identity for every normalized item, regardless of its origin.
   FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
    SELECT * INTO existing FROM public.po_line_items l WHERE l.id=(item->>'id')::uuid;
    IF NOT FOUND THEN
     IF coalesce((item->>'id')::uuid=ANY(supplied_ids),false) THEN RAISE EXCEPTION 'Item does not belong to this PO' USING ERRCODE='22023'; END IF;
     CONTINUE;
    END IF;
    IF existing.purchase_order_id<>po_id THEN RAISE EXCEPTION 'Item does not belong to this PO' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM public.sj_line_items l WHERE l.po_line_item_id=existing.id) AND ROW(existing.product_id,existing.product_name,existing.sku,existing.unit_price) IS DISTINCT FROM ROW((item->>'product_id')::uuid,item->>'product_name',item->>'sku',(item->>'unit_price')::numeric) THEN RAISE EXCEPTION 'Delivered item identity and price are immutable' USING ERRCODE='23514'; END IF;
    SELECT coalesce(sum(l.quantity_delivered),0) INTO delivered FROM public.sj_line_items l JOIN public.surat_jalan h ON h.id=l.surat_jalan_id WHERE l.po_line_item_id=existing.id AND h.voided_at IS NULL;
    IF (item->>'quantity')::integer<delivered THEN RAISE EXCEPTION 'Quantity is below delivered amount' USING ERRCODE='23514'; END IF;
    IF NOT coalesce((item->>'id')::uuid=ANY(supplied_ids),false) THEN RAISE EXCEPTION 'New line identity is already persisted' USING ERRCODE='23505'; END IF;
   END LOOP;
   IF EXISTS(SELECT 1 FROM public.po_line_items l WHERE l.purchase_order_id=po_id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(items) x WHERE (x->>'id')::uuid=l.id) AND EXISTS(SELECT 1 FROM public.sj_line_items s WHERE s.po_line_item_id=l.id)) THEN RAISE EXCEPTION 'Cannot delete an item with delivery history' USING ERRCODE='23514'; END IF;
   SELECT jsonb_agg(to_jsonb(l)) INTO old_lines FROM public.po_line_items l WHERE l.purchase_order_id=po_id;
   UPDATE public.purchase_orders SET customer_id=customer_id,expected_delivery_date=(p_payload->>'expected_delivery_date')::date,notes=nullif(p_payload->>'notes','') WHERE public.purchase_orders.id=po_id;
   DELETE FROM public.po_line_items l WHERE l.purchase_order_id=po_id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(items) x WHERE (x->>'id')::uuid=l.id);
   FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
    IF coalesce((item->>'id')::uuid=ANY(supplied_ids),false) THEN
     UPDATE public.po_line_items SET product_id=(item->>'product_id')::uuid,product_name=item->>'product_name',sku=item->>'sku',quantity=(item->>'quantity')::integer,unit_price=(item->>'unit_price')::numeric WHERE public.po_line_items.id=(item->>'id')::uuid AND purchase_order_id=po_id;
     IF NOT FOUND THEN RAISE EXCEPTION 'PO line changed; refresh before saving' USING ERRCODE='PT409'; END IF;
    ELSE
     -- Never fall back to UPDATE if a new ID collides after validation; the PK fails safely.
     INSERT INTO public.po_line_items(id,purchase_order_id,product_id,product_name,sku,quantity,unit_price) VALUES((item->>'id')::uuid,po_id,(item->>'product_id')::uuid,item->>'product_name',item->>'sku',(item->>'quantity')::integer,(item->>'unit_price')::numeric);
    END IF;
   END LOOP;
   PERFORM private.demo_account_promo(po_id,coalesce(old_lines,'[]'),items,actor,p_request_id,p_payload);
   INSERT INTO public.po_audit_log(purchase_order_id,changed_by,field_changed,old_value,new_value) VALUES(po_id,actor,'po_items_revised',old_lines::text,items::text);
  ELSIF p_operation='edit_sj_returned_date' THEN
   IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload) k) IS DISTINCT FROM ARRAY['expected_updated_at','sj_date_returned','sj_id']::text[]
   OR (p_payload->'sj_date_returned'<>'null'::jsonb AND jsonb_typeof(p_payload->'sj_date_returned')<>'string')
   THEN RAISE EXCEPTION 'Returned date payload fields invalid' USING ERRCODE='22023'; END IF;
   SELECT * INTO sj FROM public.surat_jalan h WHERE h.id=sj.id AND h.purchase_order_id=po_id FOR UPDATE;
   IF NOT FOUND OR sj.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Active delivery note required' USING ERRCODE='22023'; END IF;
   IF po.status='complete' AND (NOT private.demo_returned_date_open(po.completed_at,clock_timestamp())) THEN
    RAISE EXCEPTION 'Completed returned-date correction window has ended' USING ERRCODE='55000'; END IF;
   UPDATE public.surat_jalan h SET sj_date_returned=(p_payload->>'sj_date_returned')::date WHERE h.id=sj.id;
   INSERT INTO public.po_audit_log(purchase_order_id,changed_by,field_changed,old_value,new_value)
   VALUES(po_id,actor,'sj_date_returned',sj.sj_date_returned::text,p_payload->>'sj_date_returned');
   id:=sj.id;
  ELSIF p_operation='save_delivery' THEN
   id:=(p_payload->>'sj_id')::uuid;
   IF id IS NOT NULL THEN
    SELECT * INTO sj FROM public.surat_jalan WHERE public.surat_jalan.id=id AND purchase_order_id=po_id;
    IF NOT FOUND OR sj.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Active delivery note for this PO required' USING ERRCODE='22023'; END IF;
   END IF;
   IF nullif(btrim(p_payload->>'sj_number'),'') IS NULL OR p_payload->>'sj_date' IS NULL OR jsonb_typeof(p_payload->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'lines')=0 THEN RAISE EXCEPTION 'Delivery number, date and lines required' USING ERRCODE='22023'; END IF;
   new_lines:='[]'; amount:=0;
   FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'lines') LOOP
    IF jsonb_typeof(item->'quantity_delivered') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid delivery quantity' USING ERRCODE='22023'; END IF;
    qty:=(item->>'quantity_delivered')::numeric;
    IF qty<0 OR qty<>trunc(qty) OR qty>2147483647 THEN RAISE EXCEPTION 'Invalid delivery quantity' USING ERRCODE='22023'; END IF;
    SELECT * INTO existing FROM public.po_line_items WHERE public.po_line_items.id=(item->>'po_line_item_id')::uuid AND purchase_order_id=po_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Delivery item does not belong to PO' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(new_lines) x WHERE x->>'po_line_item_id'=existing.id::text) THEN RAISE EXCEPTION 'Duplicate delivery item' USING ERRCODE='22023'; END IF;
    SELECT coalesce(sum(l.quantity_delivered),0) INTO delivered FROM public.sj_line_items l JOIN public.surat_jalan h ON h.id=l.surat_jalan_id WHERE l.po_line_item_id=existing.id AND h.voided_at IS NULL AND h.id IS DISTINCT FROM id;
    IF delivered+qty>existing.quantity THEN RAISE EXCEPTION 'Delivery exceeds ordered quantity' USING ERRCODE='23514'; END IF;
    new_lines:=new_lines || jsonb_build_array(jsonb_build_object('po_line_item_id',existing.id,'quantity_delivered',qty::integer)); amount:=amount+qty;
   END LOOP;
   IF amount=0 THEN RAISE EXCEPTION 'At least one positive delivery quantity required' USING ERRCODE='22023'; END IF;
   IF id IS NULL THEN
    INSERT INTO public.surat_jalan(purchase_order_id,sj_number,sj_date,sj_date_received,sj_date_returned,created_by) VALUES(po_id,btrim(p_payload->>'sj_number'),(p_payload->>'sj_date')::date,(p_payload->>'sj_date_received')::date,(p_payload->>'sj_date_returned')::date,actor) RETURNING public.surat_jalan.id INTO id;
   ELSE
    SELECT jsonb_agg(to_jsonb(l)) INTO old_lines FROM public.sj_line_items l WHERE l.surat_jalan_id=id;
    UPDATE public.surat_jalan SET sj_number=btrim(p_payload->>'sj_number'),sj_date=(p_payload->>'sj_date')::date,sj_date_received=(p_payload->>'sj_date_received')::date,sj_date_returned=(p_payload->>'sj_date_returned')::date WHERE public.surat_jalan.id=id;
    DELETE FROM public.sj_line_items WHERE surat_jalan_id=id;
   END IF;
   INSERT INTO public.sj_line_items(surat_jalan_id,po_line_item_id,quantity_delivered) SELECT id,(x->>'po_line_item_id')::uuid,(x->>'quantity_delivered')::integer FROM jsonb_array_elements(new_lines) x WHERE (x->>'quantity_delivered')::integer>0;
   INSERT INTO public.po_audit_log(purchase_order_id,changed_by,field_changed,old_value,new_value) VALUES(po_id,actor,'sj_lines_revised',old_lines::text,new_lines::text);
  ELSIF p_operation='void_delivery' THEN
   SELECT * INTO sj FROM public.surat_jalan WHERE public.surat_jalan.id=sj.id FOR UPDATE;
   IF sj.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Delivery is already voided' USING ERRCODE='55000'; END IF;
   reason:=nullif(btrim(p_payload->>'reason'),'');
   IF reason IS NULL THEN RAISE EXCEPTION 'Void reason required' USING ERRCODE='22023'; END IF;
   UPDATE public.surat_jalan SET voided_at=clock_timestamp(),voided_by=actor,void_reason=reason WHERE public.surat_jalan.id=sj.id;
   INSERT INTO public.po_audit_log(purchase_order_id,changed_by,field_changed,old_value,new_value) VALUES(po_id,actor,'sj_voided',sj.sj_number,reason);
   id:=sj.id;
  ELSIF p_operation='cancel_po' THEN
   IF EXISTS(SELECT 1 FROM public.sj_line_items l JOIN public.surat_jalan h ON h.id=l.surat_jalan_id WHERE h.purchase_order_id=po_id AND h.voided_at IS NULL AND l.quantity_delivered>0) THEN RAISE EXCEPTION 'Delivered PO requires reviewed delivery corrections before cancellation' USING ERRCODE='23514'; END IF;
   reason:=nullif(btrim(p_payload->>'reason'),'');
   IF reason IS NULL THEN RAISE EXCEPTION 'Cancellation reason required' USING ERRCODE='22023'; END IF;
   UPDATE public.girard_orders SET status='cancelled',updated_at=clock_timestamp() WHERE public.girard_orders.po_id=po_id AND status='approved';
   SELECT coalesce(jsonb_agg(to_jsonb(l)),'[]') INTO old_lines FROM public.po_line_items l WHERE l.purchase_order_id=po_id;
   PERFORM private.demo_account_promo(po_id,old_lines,'[]',actor,p_request_id,p_payload);
   UPDATE public.purchase_orders SET status='cancelled',completed_at=NULL WHERE public.purchase_orders.id=po_id;
   INSERT INTO public.po_audit_log(purchase_order_id,changed_by,field_changed,old_value,new_value) VALUES(po_id,actor,'po_cancelled',NULL,reason);
  END IF;
  IF p_operation<>'edit_sj_returned_date' THEN PERFORM private.pilot_reconcile_po(po_id); END IF;
  UPDATE public.purchase_orders SET updated_at=clock_timestamp() WHERE public.purchase_orders.id=po_id RETURNING * INTO po;
  v_result:=jsonb_build_object('id',CASE WHEN p_operation IN ('save_delivery','void_delivery','edit_sj_returned_date') THEN id ELSE po_id END,'po_id',po_id,'updated_at',po.updated_at);
 END IF;
 UPDATE private.pilot_order_requests r SET result=v_result WHERE r.actor_id=actor AND r.request_id=p_request_id;
 RETURN v_result;
END $$;
CREATE FUNCTION private.catalog_po_transaction_core_v2(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE
 actor uuid:=auth.uid(); role public.user_role; prior private.pilot_order_requests%ROWTYPE;
 po public.purchase_orders%ROWTYPE; so public.girard_orders%ROWTYPE; sj public.surat_jalan%ROWTYPE;
 items jsonb; item jsonb; existing public.po_line_items%ROWTYPE;
 v_result jsonb; id uuid; po_id uuid; customer_id uuid; visit_id uuid; expected timestamptz;
 amount numeric; delivered bigint; qty numeric;
 old_lines jsonb; new_lines jsonb; reason text; supplied_ids uuid[]; credit jsonb; source_customer uuid;
BEGIN
 role:=private.demo_order_actor();
 IF role='co_admin' THEN RAISE EXCEPTION 'PO access denied' USING ERRCODE='42501'; END IF;
 IF p_operation IN ('approve_sales','reject_sales') AND role<>'executive' THEN RAISE EXCEPTION 'Executive legacy review required' USING ERRCODE='42501'; END IF;
 IF actor IS NULL OR role IS NULL THEN RAISE EXCEPTION 'Active authenticated profile required' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Request ID and object payload required' USING ERRCODE='22023'; END IF;
 IF p_operation='submit_sales' THEN
  IF role NOT IN ('sales_person','sales_manager','sales_head','executive') THEN RAISE EXCEPTION 'Sales permission required' USING ERRCODE='42501'; END IF;
  customer_id:=(p_payload->>'customer_id')::uuid; visit_id:=(p_payload->>'visit_id')::uuid;
  IF NOT private.pilot_can_access_customer(customer_id) OR NOT EXISTS(SELECT 1 FROM public.outlet_visits v JOIN public.sales_schedules s ON s.id=v.schedule_id WHERE v.id=visit_id AND v.outlet_id=customer_id AND v.sales_person_id=actor AND s.outlet_id=customer_id AND s.sales_person_id=actor) THEN RAISE EXCEPTION 'An assigned customer and actor-owned visit are required' USING ERRCODE='42501'; END IF;
 ELSIF p_operation IN ('create_po','approve_sales','reject_sales','edit_po','save_delivery','void_delivery','cancel_po','edit_sj_returned_date') THEN
  IF role NOT IN ('po_admin','executive') THEN RAISE EXCEPTION 'PO administration permission required' USING ERRCODE='42501'; END IF;
 ELSE RAISE EXCEPTION 'Unsupported order operation' USING ERRCODE='22023'; END IF;
 -- Serialize execution and reconciliation, including requests which have not arrived yet.
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text || ':' || p_request_id::text,0));
 IF p_operation='submit_sales' AND NOT EXISTS(SELECT 1 FROM private.pilot_order_requests r WHERE r.actor_id=actor AND r.request_id=p_request_id AND r.result IS NOT NULL) THEN
  RAISE EXCEPTION 'Sales submission retired; use Athel PO administration' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM private.pilot_order_requests r WHERE r.actor_id=actor AND r.request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF prior.abandoned THEN RAISE EXCEPTION 'Request was safely abandoned; it cannot execute' USING ERRCODE='55000'; END IF;
  IF prior.operation IS DISTINCT FROM p_operation OR prior.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'Request ID already used with different input; reconcile the prior result' USING ERRCODE='22023'; END IF;
  IF prior.result IS NOT NULL THEN RETURN prior.result; END IF;
  RAISE EXCEPTION 'Pending request requires recovery' USING ERRCODE='55000';
 END IF;
 IF private.catalog_po_active_v2() THEN RAISE EXCEPTION 'Nested PO core refused' USING ERRCODE='55000'; END IF;
 INSERT INTO private.catalog_po_active_v2 VALUES(pg_backend_pid(),txid_current());
 INSERT INTO private.pilot_order_requests(actor_id,request_id,operation,payload,execution_version) VALUES(actor,p_request_id,p_operation,p_payload,2);
 IF p_operation='create_po' THEN
  items:=private.pilot_validate_order_lines(p_payload->'items');
  credit:=private.demo_capture_credit((p_payload->>'customer_id')::uuid);
  PERFORM private.catalog_po_master_phase_v2(NULL,NULL,(p_payload->>'customer_id')::uuid,'[]',items);
  items:=private.catalog_po_lines_v2(items,NULL,p_request_id,(p_payload->>'customer_id')::uuid,NULL,false);
  po_id:=private.catalog_po_insert_v2(actor,p_payload,items,credit);
  PERFORM private.demo_account_promo(po_id,'[]',items,actor,p_request_id,p_payload);
  SELECT * INTO po FROM public.purchase_orders WHERE public.purchase_orders.id=po_id;
  v_result:=jsonb_build_object('id',po_id,'updated_at',po.updated_at);
 ELSIF p_operation IN ('approve_sales','reject_sales') THEN
  IF p_operation='approve_sales' THEN
   SELECT g.customer_id INTO source_customer FROM public.girard_orders g WHERE g.id=(p_payload->>'order_id')::uuid;
   credit:=private.demo_capture_credit(source_customer);
  END IF;
  SELECT * INTO so FROM public.girard_orders WHERE public.girard_orders.id=(p_payload->>'order_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sales order not found' USING ERRCODE='22023'; END IF;
  IF so.status<>'pending' THEN RAISE EXCEPTION 'Sales order is no longer pending' USING ERRCODE='55000'; END IF;
  IF p_operation='approve_sales' THEN
   items:=private.demo_legacy_order_lines(so.id,p_request_id);
   IF so.customer_id IS DISTINCT FROM source_customer THEN RAISE EXCEPTION 'Source customer changed' USING ERRCODE='40001'; END IF;
   PERFORM private.catalog_po_master_phase_v2(NULL,NULL,so.customer_id,'[]',items);
   items:=private.catalog_po_lines_v2(items,NULL,p_request_id,so.customer_id,NULL,true);
   po_id:=private.catalog_po_insert_v2(actor,p_payload || jsonb_build_object('customer_id',so.customer_id),items,credit);
   PERFORM private.demo_account_promo(po_id,'[]',items,actor,p_request_id,p_payload);
   UPDATE public.girard_orders SET status='approved',reviewed_by=actor,po_id=po_id,updated_at=clock_timestamp() WHERE public.girard_orders.id=so.id;
   SELECT * INTO po FROM public.purchase_orders WHERE public.purchase_orders.id=po_id;
   v_result:=jsonb_build_object('id',po_id,'updated_at',po.updated_at);
  ELSE
   PERFORM private.catalog_po_master_phase_v2(NULL,so.customer_id,so.customer_id,'[]','[]');
   reason:=nullif(btrim(p_payload->>'reason'),'');
   IF reason IS NULL THEN RAISE EXCEPTION 'Rejection reason required' USING ERRCODE='22023'; END IF;
   UPDATE public.girard_orders SET status='rejected',reviewed_by=actor,rejection_note=reason,updated_at=clock_timestamp() WHERE public.girard_orders.id=so.id;
   v_result:=jsonb_build_object('id',so.id);
  END IF;
 ELSE
  IF p_operation IN ('void_delivery','edit_sj_returned_date') THEN
   SELECT * INTO sj FROM public.surat_jalan WHERE public.surat_jalan.id=(p_payload->>'sj_id')::uuid;
   IF NOT FOUND THEN RAISE EXCEPTION 'Delivery note not found' USING ERRCODE='22023'; END IF;
   po_id:=sj.purchase_order_id;
  ELSE po_id:=(p_payload->>'po_id')::uuid; END IF;
  SELECT * INTO po FROM public.purchase_orders WHERE public.purchase_orders.id=po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PO not found' USING ERRCODE='22023'; END IF;
  expected:=(p_payload->>'expected_updated_at')::timestamptz;
  IF expected IS NULL OR expected IS DISTINCT FROM po.updated_at THEN RAISE EXCEPTION 'PO changed; refresh before saving' USING ERRCODE='PT409'; END IF;
  IF po.status NOT IN ('confirm','in_progress','complete') THEN RAISE EXCEPTION 'PO status does not allow this operation' USING ERRCODE='55000'; END IF;
  IF p_operation IN ('save_delivery','void_delivery') AND po.status='complete' AND (po.completed_at IS NULL OR clock_timestamp()>po.completed_at+interval '7 days') THEN RAISE EXCEPTION 'Completed delivery correction window has ended' USING ERRCODE='55000'; END IF;
  IF p_operation<>'edit_po' THEN
   SELECT coalesce(jsonb_agg(to_jsonb(l)),'[]') INTO old_lines FROM public.po_line_items l WHERE l.purchase_order_id=po_id;
   PERFORM private.catalog_po_master_phase_v2(po_id,po.customer_id,po.customer_id,old_lines,'[]');
  END IF;
  IF p_operation='edit_po' THEN
   IF po.status='complete' THEN RAISE EXCEPTION 'Completed PO cannot be edited' USING ERRCODE='55000'; END IF;
   items:=private.pilot_validate_order_lines(p_payload->'items');
   SELECT array_agg((x->>'id')::uuid) FILTER(WHERE x->>'id' IS NOT NULL) INTO supplied_ids FROM jsonb_array_elements(items) x;
   customer_id:=(p_payload->>'customer_id')::uuid;
   SELECT coalesce(jsonb_agg(to_jsonb(l)),'[]') INTO old_lines FROM public.po_line_items l WHERE l.purchase_order_id=po_id;
   PERFORM private.catalog_po_master_phase_v2(po_id,po.customer_id,customer_id,old_lines,items);
   items:=private.catalog_po_lines_v2(items,po_id,p_request_id,customer_id,po.customer_id,false);
   IF customer_id IS DISTINCT FROM po.customer_id AND EXISTS(SELECT 1 FROM public.surat_jalan h WHERE h.purchase_order_id=po_id) THEN RAISE EXCEPTION 'Customer is immutable after delivery history' USING ERRCODE='23514'; END IF;
   -- Validate by persisted identity for every normalized item, regardless of its origin.
   FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
    SELECT * INTO existing FROM public.po_line_items l WHERE l.id=(item->>'id')::uuid;
    IF NOT FOUND THEN
     IF coalesce((item->>'id')::uuid=ANY(supplied_ids),false) THEN RAISE EXCEPTION 'Item does not belong to this PO' USING ERRCODE='22023'; END IF;
     CONTINUE;
    END IF;
    IF existing.purchase_order_id<>po_id THEN RAISE EXCEPTION 'Item does not belong to this PO' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM public.sj_line_items l WHERE l.po_line_item_id=existing.id) AND ROW(existing.product_id,existing.product_name,existing.sku,existing.unit_price) IS DISTINCT FROM ROW((item->>'product_id')::uuid,item->>'product_name',item->>'sku',(item->>'unit_price')::numeric) THEN RAISE EXCEPTION 'Delivered item identity and price are immutable' USING ERRCODE='23514'; END IF;
    SELECT coalesce(sum(l.quantity_delivered),0) INTO delivered FROM public.sj_line_items l JOIN public.surat_jalan h ON h.id=l.surat_jalan_id WHERE l.po_line_item_id=existing.id AND h.voided_at IS NULL;
    IF (item->>'quantity')::integer<delivered THEN RAISE EXCEPTION 'Quantity is below delivered amount' USING ERRCODE='23514'; END IF;
    IF NOT coalesce((item->>'id')::uuid=ANY(supplied_ids),false) THEN RAISE EXCEPTION 'New line identity is already persisted' USING ERRCODE='23505'; END IF;
   END LOOP;
   IF EXISTS(SELECT 1 FROM public.po_line_items l WHERE l.purchase_order_id=po_id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(items) x WHERE (x->>'id')::uuid=l.id) AND EXISTS(SELECT 1 FROM public.sj_line_items s WHERE s.po_line_item_id=l.id)) THEN RAISE EXCEPTION 'Cannot delete an item with delivery history' USING ERRCODE='23514'; END IF;
   SELECT jsonb_agg(to_jsonb(l)) INTO old_lines FROM public.po_line_items l WHERE l.purchase_order_id=po_id;
   UPDATE public.purchase_orders SET customer_id=customer_id,expected_delivery_date=(p_payload->>'expected_delivery_date')::date,notes=nullif(p_payload->>'notes','') WHERE public.purchase_orders.id=po_id;
   DELETE FROM public.po_line_items l WHERE l.purchase_order_id=po_id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(items) x WHERE (x->>'id')::uuid=l.id);
   FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
    IF coalesce((item->>'id')::uuid=ANY(supplied_ids),false) THEN
     UPDATE public.po_line_items SET product_id=(item->>'product_id')::uuid,product_name=item->>'product_name',sku=item->>'sku',quantity=(item->>'quantity')::integer,unit_price=(item->>'unit_price')::numeric WHERE public.po_line_items.id=(item->>'id')::uuid AND purchase_order_id=po_id;
     IF NOT FOUND THEN RAISE EXCEPTION 'PO line changed; refresh before saving' USING ERRCODE='PT409'; END IF;
    ELSE
     -- Never fall back to UPDATE if a new ID collides after validation; the PK fails safely.
     INSERT INTO public.po_line_items(id,purchase_order_id,product_id,product_name,sku,quantity,unit_price) VALUES((item->>'id')::uuid,po_id,(item->>'product_id')::uuid,item->>'product_name',item->>'sku',(item->>'quantity')::integer,(item->>'unit_price')::numeric);
    END IF;
   END LOOP;
   PERFORM private.demo_account_promo(po_id,coalesce(old_lines,'[]'),items,actor,p_request_id,p_payload);
   INSERT INTO public.po_audit_log(purchase_order_id,changed_by,field_changed,old_value,new_value) VALUES(po_id,actor,'po_items_revised',old_lines::text,items::text);
  ELSIF p_operation='edit_sj_returned_date' THEN
   IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload) k) IS DISTINCT FROM ARRAY['expected_updated_at','sj_date_returned','sj_id']::text[]
   OR (p_payload->'sj_date_returned'<>'null'::jsonb AND jsonb_typeof(p_payload->'sj_date_returned')<>'string')
   THEN RAISE EXCEPTION 'Returned date payload fields invalid' USING ERRCODE='22023'; END IF;
   SELECT * INTO sj FROM public.surat_jalan h WHERE h.id=sj.id AND h.purchase_order_id=po_id FOR UPDATE;
   IF NOT FOUND OR sj.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Active delivery note required' USING ERRCODE='22023'; END IF;
   IF po.status='complete' AND (NOT private.demo_returned_date_open(po.completed_at,clock_timestamp())) THEN
    RAISE EXCEPTION 'Completed returned-date correction window has ended' USING ERRCODE='55000'; END IF;
   UPDATE public.surat_jalan h SET sj_date_returned=(p_payload->>'sj_date_returned')::date WHERE h.id=sj.id;
   INSERT INTO public.po_audit_log(purchase_order_id,changed_by,field_changed,old_value,new_value)
   VALUES(po_id,actor,'sj_date_returned',sj.sj_date_returned::text,p_payload->>'sj_date_returned');
   id:=sj.id;
  ELSIF p_operation='save_delivery' THEN
   id:=(p_payload->>'sj_id')::uuid;
   IF id IS NOT NULL THEN
    SELECT * INTO sj FROM public.surat_jalan WHERE public.surat_jalan.id=id AND purchase_order_id=po_id;
    IF NOT FOUND OR sj.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Active delivery note for this PO required' USING ERRCODE='22023'; END IF;
   END IF;
   IF nullif(btrim(p_payload->>'sj_number'),'') IS NULL OR p_payload->>'sj_date' IS NULL OR jsonb_typeof(p_payload->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'lines')=0 THEN RAISE EXCEPTION 'Delivery number, date and lines required' USING ERRCODE='22023'; END IF;
   new_lines:='[]'; amount:=0;
   FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'lines') LOOP
    IF jsonb_typeof(item->'quantity_delivered') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid delivery quantity' USING ERRCODE='22023'; END IF;
    qty:=(item->>'quantity_delivered')::numeric;
    IF qty<0 OR qty<>trunc(qty) OR qty>2147483647 THEN RAISE EXCEPTION 'Invalid delivery quantity' USING ERRCODE='22023'; END IF;
    SELECT * INTO existing FROM public.po_line_items WHERE public.po_line_items.id=(item->>'po_line_item_id')::uuid AND purchase_order_id=po_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Delivery item does not belong to PO' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(new_lines) x WHERE x->>'po_line_item_id'=existing.id::text) THEN RAISE EXCEPTION 'Duplicate delivery item' USING ERRCODE='22023'; END IF;
    SELECT coalesce(sum(l.quantity_delivered),0) INTO delivered FROM public.sj_line_items l JOIN public.surat_jalan h ON h.id=l.surat_jalan_id WHERE l.po_line_item_id=existing.id AND h.voided_at IS NULL AND h.id IS DISTINCT FROM id;
    IF delivered+qty>existing.quantity THEN RAISE EXCEPTION 'Delivery exceeds ordered quantity' USING ERRCODE='23514'; END IF;
    new_lines:=new_lines || jsonb_build_array(jsonb_build_object('po_line_item_id',existing.id,'quantity_delivered',qty::integer)); amount:=amount+qty;
   END LOOP;
   IF amount=0 THEN RAISE EXCEPTION 'At least one positive delivery quantity required' USING ERRCODE='22023'; END IF;
   IF id IS NULL THEN
    INSERT INTO public.surat_jalan(purchase_order_id,sj_number,sj_date,sj_date_received,sj_date_returned,created_by) VALUES(po_id,btrim(p_payload->>'sj_number'),(p_payload->>'sj_date')::date,(p_payload->>'sj_date_received')::date,(p_payload->>'sj_date_returned')::date,actor) RETURNING public.surat_jalan.id INTO id;
   ELSE
    SELECT jsonb_agg(to_jsonb(l)) INTO old_lines FROM public.sj_line_items l WHERE l.surat_jalan_id=id;
    UPDATE public.surat_jalan SET sj_number=btrim(p_payload->>'sj_number'),sj_date=(p_payload->>'sj_date')::date,sj_date_received=(p_payload->>'sj_date_received')::date,sj_date_returned=(p_payload->>'sj_date_returned')::date WHERE public.surat_jalan.id=id;
    DELETE FROM public.sj_line_items WHERE surat_jalan_id=id;
   END IF;
   INSERT INTO public.sj_line_items(surat_jalan_id,po_line_item_id,quantity_delivered) SELECT id,(x->>'po_line_item_id')::uuid,(x->>'quantity_delivered')::integer FROM jsonb_array_elements(new_lines) x WHERE (x->>'quantity_delivered')::integer>0;
   INSERT INTO public.po_audit_log(purchase_order_id,changed_by,field_changed,old_value,new_value) VALUES(po_id,actor,'sj_lines_revised',old_lines::text,new_lines::text);
  ELSIF p_operation='void_delivery' THEN
   SELECT * INTO sj FROM public.surat_jalan WHERE public.surat_jalan.id=sj.id FOR UPDATE;
   IF sj.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Delivery is already voided' USING ERRCODE='55000'; END IF;
   reason:=nullif(btrim(p_payload->>'reason'),'');
   IF reason IS NULL THEN RAISE EXCEPTION 'Void reason required' USING ERRCODE='22023'; END IF;
   UPDATE public.surat_jalan SET voided_at=clock_timestamp(),voided_by=actor,void_reason=reason WHERE public.surat_jalan.id=sj.id;
   INSERT INTO public.po_audit_log(purchase_order_id,changed_by,field_changed,old_value,new_value) VALUES(po_id,actor,'sj_voided',sj.sj_number,reason);
   id:=sj.id;
  ELSIF p_operation='cancel_po' THEN
   IF EXISTS(SELECT 1 FROM public.sj_line_items l JOIN public.surat_jalan h ON h.id=l.surat_jalan_id WHERE h.purchase_order_id=po_id AND h.voided_at IS NULL AND l.quantity_delivered>0) THEN RAISE EXCEPTION 'Delivered PO requires reviewed delivery corrections before cancellation' USING ERRCODE='23514'; END IF;
   reason:=nullif(btrim(p_payload->>'reason'),'');
   IF reason IS NULL THEN RAISE EXCEPTION 'Cancellation reason required' USING ERRCODE='22023'; END IF;
   UPDATE public.girard_orders SET status='cancelled',updated_at=clock_timestamp() WHERE public.girard_orders.po_id=po_id AND status='approved';
   SELECT coalesce(jsonb_agg(to_jsonb(l)),'[]') INTO old_lines FROM public.po_line_items l WHERE l.purchase_order_id=po_id;
   PERFORM private.demo_account_promo(po_id,old_lines,'[]',actor,p_request_id,p_payload);
   UPDATE public.purchase_orders SET status='cancelled',completed_at=NULL WHERE public.purchase_orders.id=po_id;
   INSERT INTO public.po_audit_log(purchase_order_id,changed_by,field_changed,old_value,new_value) VALUES(po_id,actor,'po_cancelled',NULL,reason);
  END IF;
  IF p_operation<>'edit_sj_returned_date' THEN PERFORM private.pilot_reconcile_po(po_id); END IF;
  UPDATE public.purchase_orders SET updated_at=clock_timestamp() WHERE public.purchase_orders.id=po_id RETURNING * INTO po;
  v_result:=jsonb_build_object('id',CASE WHEN p_operation IN ('save_delivery','void_delivery','edit_sj_returned_date') THEN id ELSE po_id END,'po_id',po_id,'updated_at',po.updated_at);
 END IF;
 UPDATE private.pilot_order_requests r SET result=v_result WHERE r.actor_id=actor AND r.request_id=p_request_id;
 DELETE FROM private.catalog_po_active_v2 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 RETURN v_result;
END $$;
-- Server-only production gate. The foundation makes successful admission
-- impossible today; private-core tests do not prove global cutover or drain.
CREATE FUNCTION private.catalog_po_transaction_v2(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE state private.catalog_cutover_v1%ROWTYPE;
BEGIN
 SELECT * INTO state FROM private.catalog_cutover_v1 WHERE singleton FOR SHARE;
 IF NOT FOUND OR state.execution_generation<>2 OR NOT state.tracking_ready THEN
  RAISE EXCEPTION 'Catalogue generation not admitted' USING ERRCODE='55000',DETAIL='CATALOG_GENERATION_RETIRED'; END IF;
 RETURN private.catalog_po_transaction_core_v2(p_request_id,p_operation,p_payload);
END $$;

CREATE OR REPLACE FUNCTION public.pilot_order_transaction(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); role public.user_role; prior private.pilot_order_requests%ROWTYPE; generation smallint;
BEGIN
 role:=private.demo_order_actor();
 IF role='co_admin' THEN RAISE EXCEPTION 'PO access denied' USING ERRCODE='42501'; END IF;
 IF p_operation IN ('approve_sales','reject_sales') AND role<>'executive' THEN RAISE EXCEPTION 'Executive legacy review required' USING ERRCODE='42501'; END IF;
 IF actor IS NULL OR role IS NULL THEN RAISE EXCEPTION 'Active authenticated profile required' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Request ID and object payload required' USING ERRCODE='22023'; END IF;
 -- Preserve the retired sales family's exact preexisting target/visit authority.
 IF p_operation='submit_sales' THEN RETURN private.catalog_po_legacy_transaction_v1(p_request_id,p_operation,p_payload); END IF;
 IF p_operation NOT IN ('create_po','approve_sales','reject_sales','edit_po','save_delivery','void_delivery','cancel_po','edit_sj_returned_date') OR p_operation IS NULL THEN
  RAISE EXCEPTION 'Unsupported order operation' USING ERRCODE='22023'; END IF;
 IF role NOT IN ('po_admin','executive') THEN RAISE EXCEPTION 'PO administration permission required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_request_id::text,0));
 SELECT * INTO prior FROM private.pilot_order_requests r WHERE r.actor_id=actor AND r.request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF prior.abandoned THEN RAISE EXCEPTION 'Request was safely abandoned; it cannot execute' USING ERRCODE='55000'; END IF;
  IF prior.operation IS DISTINCT FROM p_operation OR prior.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'Request ID already used with different input; reconcile the prior result' USING ERRCODE='22023'; END IF;
  IF prior.result IS NOT NULL THEN RETURN prior.result; END IF;
 END IF;
 -- Exact authorized terminal recovery above takes no mutable target/cutover lock.
 SELECT execution_generation INTO generation FROM private.catalog_cutover_v1 WHERE singleton;
 IF generation=1 THEN RETURN private.catalog_po_legacy_transaction_v1(p_request_id,p_operation,p_payload); END IF;
 RETURN private.catalog_po_transaction_v2(p_request_id,p_operation,p_payload);
END $$;
REVOKE ALL ON FUNCTION private.catalog_po_master_phase_v2(uuid,uuid,uuid,jsonb,jsonb),
 private.catalog_po_lines_v2(jsonb,uuid,uuid,uuid,uuid,boolean),private.catalog_po_insert_v2(uuid,jsonb,jsonb,jsonb),
 private.catalog_po_legacy_transaction_v1(uuid,text,jsonb),private.catalog_po_transaction_core_v2(uuid,text,jsonb),
 private.catalog_po_transaction_v2(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
-- Trigger WHEN runs as the DML caller. This predicate exposes only that
-- caller's own backend/transaction boolean, never the table or another context.
GRANT EXECUTE ON FUNCTION private.catalog_po_active_v2() TO PUBLIC;
-- Default grants or inherited extra principals must not expose owner-only cores.
DO $acl$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
  WHERE n.nspname='private' AND p.proname IN('catalog_po_active_v2','catalog_po_context_empty_v2','catalog_po_assert_ref_v2',
   'catalog_po_assert_items_v2','catalog_po_assert_event_v2','catalog_po_master_phase_v2','catalog_po_lines_v2','catalog_po_insert_v2',
   'catalog_po_legacy_transaction_v1','catalog_po_transaction_core_v2','catalog_po_transaction_v2')
  AND (p.proowner<>'postgres'::regrole OR (a.grantee<>p.proowner AND NOT (p.proname='catalog_po_active_v2' AND a.grantee=0 AND NOT a.is_grantable)) OR a.grantor<>p.proowner OR a.privilege_type<>'EXECUTE'))
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
  WHERE c.oid='private.catalog_po_active_v2'::regclass AND (c.relowner<>'postgres'::regrole OR a.grantee<>c.relowner OR a.grantor<>c.relowner))
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid='private.catalog_po_active_v2'::regclass)
 THEN RAISE EXCEPTION 'Unexpected private PO privilege path' USING ERRCODE='42501'; END IF;
 IF has_function_privilege('authenticated','private.catalog_po_transaction_core_v2(uuid,text,jsonb)','EXECUTE')
 OR has_function_privilege('anon','private.catalog_po_transaction_core_v2(uuid,text,jsonb)','EXECUTE')
 OR has_table_privilege('authenticated','private.catalog_po_active_v2','INSERT,UPDATE,DELETE,SELECT') THEN
  RAISE EXCEPTION 'Private PO core must remain owner-only' USING ERRCODE='42501'; END IF;
END $acl$;
