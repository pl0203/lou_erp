-- Forward-only demo cutover. No historical allocation or credit backfill.
BEGIN;
SET LOCAL search_path='';
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
-- Fail closed, without lock-order waits, if any old ledger-writing transaction is in flight.
-- Calls not yet at INSERT are fenced by the trigger installed in this same transaction.
LOCK TABLE private.pilot_order_requests IN SHARE ROW EXCLUSIVE MODE NOWAIT;
CREATE TEMP TABLE demo_function_metadata ON COMMIT DROP AS
 SELECT p.oid,to_jsonb(p)-'prosrc' AS metadata FROM pg_proc p
 WHERE p.oid IN ('public.pilot_order_transaction(uuid,text,jsonb)'::regprocedure,
 'public.pilot_po_lines_v1(uuid,integer,integer,timestamptz)'::regprocedure,
 'private.pilot_insert_po(uuid,jsonb,jsonb)'::regprocedure,
 'public.pilot_reconcile_request(uuid,boolean)'::regprocedure);
DO $preflight$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.pilot_order_transaction(uuid,text,jsonb)'::regprocedure)<>'2fa378a5be5bfbed7dfdabfe8c6c420c'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.pilot_po_lines_v1(uuid,integer,integer,timestamptz)'::regprocedure)<>'d7b04bc2c54b075cda9dc5de7911d60d'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.pilot_insert_po(uuid,jsonb,jsonb)'::regprocedure)<>'42c5e9ddc229877dfcc3ebe193684bca'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.pilot_reconcile_request(uuid,boolean)'::regprocedure)<>'ef6e4bbebc4ebcb62ec634b94046e9b8'
 THEN RAISE EXCEPTION 'Demo order source drift; migration refused'; END IF;
 IF EXISTS(SELECT 1 FROM pg_temp.demo_function_metadata m JOIN pg_proc p ON p.oid=m.oid
 WHERE p.proowner<>'postgres'::regrole OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
 OR has_function_privilege('anon',p.oid,'EXECUTE'))
 OR NOT has_function_privilege('authenticated','public.pilot_order_transaction(uuid,text,jsonb)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.pilot_po_lines_v1(uuid,integer,integer,timestamptz)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.pilot_reconcile_request(uuid,boolean)','EXECUTE')
 OR has_function_privilege('authenticated','private.pilot_insert_po(uuid,jsonb,jsonb)','EXECUTE')
 OR EXISTS(SELECT 1 FROM pg_temp.demo_function_metadata m JOIN pg_proc p ON p.oid=m.oid JOIN pg_language l ON l.oid=p.prolang
 WHERE l.lanname<>'plpgsql' OR p.prosecdef IS DISTINCT FROM (p.oid IN ('public.pilot_order_transaction(uuid,text,jsonb)'::regprocedure,'public.pilot_reconcile_request(uuid,boolean)'::regprocedure))
 OR p.provolatile<>CASE WHEN p.oid='public.pilot_po_lines_v1(uuid,integer,integer,timestamptz)'::regprocedure THEN 's'::"char" ELSE 'v'::"char" END
 OR p.proisstrict OR p.proparallel<>'u' OR p.proleakproof OR pg_get_function_result(p.oid)<>CASE WHEN p.oid='private.pilot_insert_po(uuid,jsonb,jsonb)'::regprocedure THEN 'uuid' ELSE 'jsonb' END)
 OR EXISTS(SELECT 1 FROM pg_temp.demo_function_metadata m JOIN pg_proc p ON p.oid=m.oid CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE NOT coalesce(a.grantee=ANY(ARRAY[p.proowner,'authenticated'::regrole::oid,'service_role'::regrole::oid]),false)
 OR a.grantor<>p.proowner OR a.privilege_type<>'EXECUTE' OR (a.grantee<>p.proowner AND a.is_grantable))
 OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='storage.objects'::regclass AND attname='metadata' AND atttypid='jsonb'::regtype AND NOT attisdropped)
 THEN RAISE EXCEPTION 'Demo metadata or storage contract drift; migration refused'; END IF;
END $preflight$;
-- Server-owned execution version fences already-entered old RPC bodies; never read from JSON/GUC.
ALTER TABLE private.pilot_order_requests ADD COLUMN execution_version smallint NOT NULL DEFAULT 0 CHECK(execution_version IN (0,1));
ALTER TABLE public.po_line_items ADD COLUMN product_id uuid REFERENCES public.products(id);
ALTER TABLE public.purchase_orders
 ADD COLUMN sales_person_id_at_creation uuid REFERENCES public.users(id),
 ADD COLUMN sales_assignment_source_id uuid,
 ADD COLUMN sales_attributed_at timestamptz,
 ADD COLUMN sales_attribution_state text NOT NULL DEFAULT 'legacy',
 ADD CONSTRAINT demo_sales_credit_state CHECK (
 (sales_attribution_state='legacy' AND sales_person_id_at_creation IS NULL AND sales_assignment_source_id IS NULL AND sales_attributed_at IS NULL)
 OR (sales_attribution_state='unassigned' AND sales_person_id_at_creation IS NULL AND sales_assignment_source_id IS NULL AND sales_attributed_at IS NOT NULL)
 OR (sales_attribution_state='assigned' AND sales_person_id_at_creation IS NOT NULL AND sales_assignment_source_id IS NOT NULL AND sales_attributed_at IS NOT NULL));
ALTER TABLE public.promotions
 ADD COLUMN stock_managed boolean NOT NULL DEFAULT false,
 ADD COLUMN remaining_quantity bigint NOT NULL DEFAULT 0 CHECK(remaining_quantity>=0 AND remaining_quantity<=2147483647),
 ADD COLUMN stock_version bigint NOT NULL DEFAULT 1 CHECK(stock_version>0),
 ADD COLUMN image_path text,
 ALTER COLUMN harga_pokok DROP NOT NULL, ALTER COLUMN harga_pokok DROP DEFAULT,
 ALTER COLUMN luar_kota DROP NOT NULL, ALTER COLUMN luar_kota DROP DEFAULT,
 ALTER COLUMN dalam_kota DROP NOT NULL, ALTER COLUMN dalam_kota DROP DEFAULT,
 ALTER COLUMN depo_bangunan DROP NOT NULL, ALTER COLUMN depo_bangunan DROP DEFAULT,
 ADD CONSTRAINT demo_managed_promotion_image CHECK(NOT stock_managed OR image_path IS NOT NULL);
CREATE UNIQUE INDEX demo_one_enabled_campaign ON public.promotions(product_id) WHERE stock_managed AND is_active;
CREATE TABLE private.pilot_promotion_requests (
 actor_id uuid NOT NULL REFERENCES public.users(id),request_id uuid NOT NULL,operation text NOT NULL,
 payload jsonb NOT NULL,result jsonb,abandoned boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,request_id));
CREATE TABLE private.pilot_promo_slices (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,promotion_id uuid NOT NULL REFERENCES public.promotions(id),
 purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id),line_id uuid NOT NULL,
 product_id uuid NOT NULL REFERENCES public.products(id),quantity bigint NOT NULL CHECK(quantity>=0),
 actor_id uuid NOT NULL REFERENCES public.users(id),request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX demo_slices_po_line ON private.pilot_promo_slices(purchase_order_id,line_id,id);
CREATE TABLE private.pilot_promo_movements (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,promotion_id uuid NOT NULL REFERENCES public.promotions(id),
 purchase_order_id uuid REFERENCES public.purchase_orders(id),line_id uuid,slice_id bigint REFERENCES private.pilot_promo_slices(id),
 actor_id uuid NOT NULL REFERENCES public.users(id),request_id uuid NOT NULL,quantity_delta bigint NOT NULL,
 event_kind text NOT NULL CHECK(event_kind IN ('opening','adjustment','allocation','release')),
 reason text,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX demo_movements_campaign ON private.pilot_promo_movements(promotion_id,id);
ALTER TABLE private.pilot_promotion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.pilot_promo_slices ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.pilot_promo_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.pilot_promotion_requests,private.pilot_promo_slices,private.pilot_promo_movements FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE private.pilot_promo_slices_id_seq,private.pilot_promo_movements_id_seq FROM PUBLIC,anon,authenticated;
CREATE FUNCTION private.demo_order_execution_fence() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.operation IN ('submit_sales','create_po','approve_sales','reject_sales','edit_po','save_delivery','void_delivery','cancel_po','edit_sj_returned_date')
 AND (NEW.operation='submit_sales' OR NEW.execution_version<>1)
 AND NOT EXISTS(SELECT 1 FROM private.pilot_order_requests r
  WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id AND r.operation=NEW.operation AND r.payload=NEW.payload AND r.result IS NOT NULL AND NOT r.abandoned)
 THEN RAISE EXCEPTION 'Old order execution retired at cutover' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER demo_order_execution_fence BEFORE INSERT ON private.pilot_order_requests FOR EACH ROW EXECUTE FUNCTION private.demo_order_execution_fence();
CREATE FUNCTION private.demo_immutable_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Append-only promotion evidence' USING ERRCODE='42501'; END $$;
CREATE TRIGGER demo_movement_immutable BEFORE UPDATE OR DELETE ON private.pilot_promo_movements FOR EACH ROW EXECUTE FUNCTION private.demo_immutable_evidence();
CREATE FUNCTION private.demo_immutable_credit() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF ROW(NEW.sales_person_id_at_creation,NEW.sales_assignment_source_id,NEW.sales_attributed_at,NEW.sales_attribution_state)
 IS DISTINCT FROM ROW(OLD.sales_person_id_at_creation,OLD.sales_assignment_source_id,OLD.sales_attributed_at,OLD.sales_attribution_state)
 THEN RAISE EXCEPTION 'Creation sales attribution is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER demo_credit_immutable BEFORE UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION private.demo_immutable_credit();
CREATE FUNCTION private.demo_order_actor() RETURNS public.user_role LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_role public.user_role;
BEGIN
 SELECT u.role INTO v_role FROM public.users u WHERE u.id=auth.uid() AND u.is_active FOR SHARE;
 IF v_role IS NULL THEN RAISE EXCEPTION 'Active authenticated profile required' USING ERRCODE='42501'; END IF;
 RETURN v_role;
END $$;
CREATE FUNCTION private.demo_capture_credit(customer uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE assignment record; count_assignments integer:=0; credit jsonb;
BEGIN
 -- A table SHARE lock also serializes an absent assignment with a concurrent insert.
 -- All assignment writers require ROW EXCLUSIVE, including service-side writes.
 LOCK TABLE public.customer_sales_rep_assignments IN SHARE MODE;
 FOR assignment IN SELECT a.id,a.sales_rep_id FROM public.customer_sales_rep_assignments a
 JOIN public.users u ON u.id=a.sales_rep_id WHERE a.customer_id=customer AND u.is_active AND u.role='sales_person'
 ORDER BY a.id FOR SHARE OF u LOOP
  count_assignments:=count_assignments+1;
  credit:=jsonb_build_object('sales_person_id_at_creation',assignment.sales_rep_id,'sales_assignment_source_id',assignment.id);
 END LOOP;
 IF count_assignments<>1 THEN credit:=jsonb_build_object('sales_person_id_at_creation',NULL,'sales_assignment_source_id',NULL); END IF;
 RETURN credit||jsonb_build_object('sales_attribution_state',CASE WHEN count_assignments=1 THEN 'assigned' ELSE 'unassigned' END,'sales_attributed_at',clock_timestamp());
END $$;
-- A generated identifier is never allowed to reclassify an existing line as a new one.
-- The final INSERT remains the concurrency-safe uniqueness boundary after this guard.
CREATE FUNCTION private.demo_require_new_line_identity(candidate uuid,reserved uuid[]) RETURNS uuid
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF candidate IS NULL THEN RAISE EXCEPTION 'New line identity required' USING ERRCODE='22023'; END IF;
 IF candidate=ANY(coalesce(reserved,'{}'::uuid[])) OR EXISTS(SELECT 1 FROM public.po_line_items l WHERE l.id=candidate) THEN
  RAISE EXCEPTION 'New line identity unavailable; retry with a fresh request' USING ERRCODE='23505';
 END IF;
 RETURN candidate;
END $$;
CREATE FUNCTION private.demo_catalog_lines(items jsonb,po uuid,request uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE item jsonb; result jsonb:='[]'; previous public.po_line_items%ROWTYPE; product public.products%ROWTYPE;
 product_id uuid; matches integer; sequence integer:=0; reserved uuid[]:='{}'; new_id uuid;
BEGIN
 IF po IS NOT NULL THEN
  SELECT coalesce(array_agg((x->>'id')::uuid) FILTER(WHERE x->>'id' IS NOT NULL),'{}'::uuid[]) INTO reserved FROM jsonb_array_elements(items) x;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(items) ORDER BY value::text LOOP
  sequence:=sequence+1; previous:=NULL;
  IF item->>'id' IS NOT NULL AND po IS NOT NULL THEN SELECT * INTO previous FROM public.po_line_items l WHERE l.id=(item->>'id')::uuid AND l.purchase_order_id=po; END IF;
  product_id:=(item->>'product_id')::uuid;
  IF previous.id IS NOT NULL AND ROW(previous.product_id,previous.sku) IS NOT DISTINCT FROM ROW(product_id,item->>'sku') THEN
   -- Existing identity is a snapshot, even after a catalog SKU rename.
   NULL;
  ELSIF product_id IS NOT NULL THEN
   SELECT * INTO product FROM public.products p WHERE p.id=product_id;
   IF NOT FOUND OR (item->>'sku' IS NOT NULL AND lower(btrim(item->>'sku'))<>lower(btrim(product.sku))) THEN
    RAISE EXCEPTION 'Product ID and SKU do not match' USING ERRCODE='22023'; END IF;
   IF item->>'sku' IS NULL THEN item:=item||jsonb_build_object('sku',product.sku); END IF;
  ELSIF item->>'sku' IS NOT NULL THEN
   SELECT count(*),(array_agg(p.id ORDER BY p.id))[1] INTO matches,product_id FROM public.products p WHERE lower(btrim(p.sku))=lower(btrim(item->>'sku'));
   IF matches>1 THEN RAISE EXCEPTION 'Ambiguous normalized SKU' USING ERRCODE='22023'; END IF;
  END IF;
  IF item->>'id' IS NULL OR po IS NULL THEN
   new_id:=private.demo_require_new_line_identity(md5(request::text||':'||sequence::text)::uuid,reserved);
   reserved:=array_append(reserved,new_id);
   item:=item||jsonb_build_object('id',new_id);
  END IF;
  result:=result||jsonb_build_array(item||jsonb_build_object('product_id',product_id));
 END LOOP;
 RETURN result;
END $$;
-- This boundary loads its own trusted server history; no client flag can enable it.
CREATE FUNCTION private.demo_legacy_order_lines(order_id uuid,request uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE items jsonb; item jsonb; result jsonb:='[]'; sequence integer:=0; reserved uuid[]:='{}'; new_id uuid;
BEGIN
 SELECT jsonb_agg(jsonb_build_object('source_id',l.id,'product_id',l.product_id,'product_name',l.product_name,'sku',l.sku,'quantity',l.quantity,'unit_price',l.unit_price) ORDER BY l.id)
 INTO items FROM public.girard_order_items l WHERE l.order_id=demo_legacy_order_lines.order_id;
 -- Validate supported quantities/prices without rewriting authoritative historical snapshots.
 PERFORM private.pilot_validate_order_lines(items);
 FOR item IN SELECT value FROM jsonb_array_elements(items) ORDER BY value->>'source_id' LOOP
  sequence:=sequence+1;
  new_id:=private.demo_require_new_line_identity(md5(request::text||':'||sequence::text)::uuid,reserved);
  reserved:=array_append(reserved,new_id);
  result:=result||jsonb_build_array((item-'source_id')||jsonb_build_object('id',new_id));
 END LOOP;
 RETURN result;
END $$;
CREATE FUNCTION private.demo_account_promo(po uuid,old_lines jsonb,new_lines jsonb,actor uuid,request uuid,payload jsonb) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
#variable_conflict use_variable
DECLARE product uuid; promotion public.promotions%ROWTYPE; line jsonb; old_line jsonb; slice record;
 allocated bigint; retained bigint; release_quantity bigint; delta bigint; quantity bigint; demand bigint; requested bigint;
 shortages jsonb:='[]'; allocations jsonb:='[]'; acknowledgment jsonb; new_slice bigint;
BEGIN
 -- PO is already locked. Products and campaigns use the same ordering as campaign writes.
 -- NO KEY UPDATE avoids upgrading the FK KEY SHARE locks already held by line inserts.
 FOR product IN SELECT DISTINCT x FROM (
 SELECT (j->>'product_id')::uuid x FROM jsonb_array_elements(coalesce(old_lines,'[]')) j UNION ALL
 SELECT (j->>'product_id')::uuid FROM jsonb_array_elements(coalesce(new_lines,'[]')) j UNION ALL
 SELECT s.product_id FROM private.pilot_promo_slices s WHERE s.purchase_order_id=po) q WHERE x IS NOT NULL ORDER BY x LOOP
  PERFORM 1 FROM public.products p WHERE p.id=product FOR NO KEY UPDATE;
 END LOOP;
 PERFORM 1 FROM public.promotions p WHERE p.product_id IN (
 SELECT (j->>'product_id')::uuid FROM jsonb_array_elements(coalesce(old_lines,'[]')) j UNION
 SELECT (j->>'product_id')::uuid FROM jsonb_array_elements(coalesce(new_lines,'[]')) j UNION
 SELECT s.product_id FROM private.pilot_promo_slices s WHERE s.purchase_order_id=po) ORDER BY p.id FOR UPDATE;
 -- Releases are evaluated against remaining allocations, never the campaign's displayed balance.
 FOR line IN SELECT value FROM jsonb_array_elements(coalesce(old_lines,'[]')) ORDER BY value->>'id' LOOP
  SELECT value INTO old_line FROM jsonb_array_elements(coalesce(new_lines,'[]')) WHERE value->>'id'=line->>'id';
  retained:=CASE WHEN old_line IS NOT NULL AND old_line->>'product_id' IS NOT DISTINCT FROM line->>'product_id' THEN (old_line->>'quantity')::bigint ELSE 0 END;
  SELECT coalesce(sum(s.quantity),0) INTO allocated FROM private.pilot_promo_slices s WHERE s.purchase_order_id=po AND s.line_id=(line->>'id')::uuid;
  release_quantity:=greatest(allocated-retained,0);
  FOR slice IN SELECT s.* FROM private.pilot_promo_slices s WHERE s.purchase_order_id=po AND s.line_id=(line->>'id')::uuid AND s.quantity>0 ORDER BY s.id DESC LOOP
   EXIT WHEN release_quantity=0;
   delta:=least(slice.quantity,release_quantity);
   UPDATE private.pilot_promo_slices s SET quantity=s.quantity-delta WHERE s.id=slice.id;
   UPDATE public.promotions SET remaining_quantity=remaining_quantity+delta,stock_version=stock_version+1 WHERE id=slice.promotion_id;
   INSERT INTO private.pilot_promo_movements(promotion_id,purchase_order_id,line_id,slice_id,actor_id,request_id,quantity_delta,event_kind)
   VALUES(slice.promotion_id,po,slice.line_id,slice.id,actor,request,delta,'release');
   release_quantity:=release_quantity-delta;
  END LOOP;
 END LOOP;
 -- Quote every incremental catalog product, including absence of an enabled campaign.
 -- Here remaining_quantity means allocatable stock in the enabled campaign, not paused stock.
 FOR product IN SELECT DISTINCT (n->>'product_id')::uuid FROM jsonb_array_elements(coalesce(new_lines,'[]')) n WHERE n->>'product_id' IS NOT NULL ORDER BY 1 LOOP
  demand:=0; requested:=0;
  FOR line IN SELECT value FROM jsonb_array_elements(coalesce(new_lines,'[]')) WHERE value->>'product_id'=product::text LOOP
   SELECT value INTO old_line FROM jsonb_array_elements(coalesce(old_lines,'[]')) WHERE value->>'id'=line->>'id' AND value->>'product_id'=line->>'product_id';
   demand:=demand+greatest((line->>'quantity')::bigint-coalesce((old_line->>'quantity')::bigint,0),0);
   requested:=requested+(line->>'quantity')::bigint;
  END LOOP;
  IF demand=0 THEN CONTINUE; END IF;
  SELECT * INTO promotion FROM public.promotions p WHERE p.product_id=product AND p.stock_managed AND p.is_active;
  allocations:=allocations||jsonb_build_array(jsonb_build_object('promotion_id',promotion.id,'product_id',product,
   'product_name',(SELECT p.name FROM public.products p WHERE p.id=product),'sku',(SELECT p.sku FROM public.products p WHERE p.id=product),
   'remaining_quantity',coalesce(promotion.remaining_quantity,0),'requested_quantity',requested,'incremental_quantity',demand,
   'allocation_quantity',least(demand,coalesce(promotion.remaining_quantity,0)),'stock_version',promotion.stock_version));
  IF promotion.id IS NOT NULL AND demand>promotion.remaining_quantity THEN
   shortages:=shortages||jsonb_build_array(jsonb_build_object('promotion_id',promotion.id,'product_id',product,
   'product_name',(SELECT p.name FROM public.products p WHERE p.id=product),'sku',(SELECT p.sku FROM public.products p WHERE p.id=product),
   'remaining_quantity',promotion.remaining_quantity,'requested_quantity',requested,'incremental_quantity',demand,'shortfall',demand-promotion.remaining_quantity,'stock_version',promotion.stock_version));
  END IF;
 END LOOP;
 acknowledgment:=jsonb_build_object('version',1,'payload_hash',md5((payload-'promo_stock_ack')::text),'po_version',payload->'expected_updated_at','shortages',shortages,'allocations',allocations);
 IF payload ? 'promo_stock_ack' AND payload->'promo_stock_ack' IS DISTINCT FROM acknowledgment THEN
  RAISE EXCEPTION 'Promo allocation facts changed; review before continuing' USING ERRCODE='PT409',DETAIL=jsonb_build_object('code','PROMO_STOCK_CHANGED','shortages',shortages,'allocations',allocations,'ack',acknowledgment)::text;
 ELSIF NOT (payload ? 'promo_stock_ack') AND jsonb_array_length(shortages)>0 THEN
  RAISE EXCEPTION 'Promo stock requires confirmation' USING ERRCODE='PT409',DETAIL=jsonb_build_object('code','PROMO_STOCK_WARNING','shortages',shortages,'ack',acknowledgment)::text;
 END IF;
 -- Stable persisted line identities decide allocation, not UI array order.
 FOR line IN SELECT value FROM jsonb_array_elements(coalesce(new_lines,'[]')) ORDER BY value->>'id' LOOP
  SELECT value INTO old_line FROM jsonb_array_elements(coalesce(old_lines,'[]')) WHERE value->>'id'=line->>'id' AND value->>'product_id'=line->>'product_id';
  demand:=greatest((line->>'quantity')::bigint-coalesce((old_line->>'quantity')::bigint,0),0);
  IF demand=0 OR line->>'product_id' IS NULL THEN CONTINUE; END IF;
  SELECT * INTO promotion FROM public.promotions p WHERE p.product_id=(line->>'product_id')::uuid AND p.stock_managed AND p.is_active;
  IF NOT FOUND THEN CONTINUE; END IF;
  quantity:=least(demand,promotion.remaining_quantity);
  IF quantity=0 THEN CONTINUE; END IF;
  UPDATE public.promotions SET remaining_quantity=remaining_quantity-quantity,stock_version=stock_version+1 WHERE id=promotion.id;
  INSERT INTO private.pilot_promo_slices(promotion_id,purchase_order_id,line_id,product_id,quantity,actor_id,request_id)
  VALUES(promotion.id,po,(line->>'id')::uuid,promotion.product_id,quantity,actor,request) RETURNING id INTO new_slice;
  INSERT INTO private.pilot_promo_movements(promotion_id,purchase_order_id,line_id,slice_id,actor_id,request_id,quantity_delta,event_kind)
  VALUES(promotion.id,po,(line->>'id')::uuid,new_slice,actor,request,-quantity,'allocation');
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION private.pilot_insert_po(actor uuid,payload jsonb,items jsonb) RETURNS uuid
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE po uuid; credit jsonb:=coalesce(payload->'_demo_credit','{}');
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
CREATE FUNCTION private.demo_returned_date_open(completed timestamptz,as_of timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(isfinite(completed) AND isfinite(as_of) AND as_of<=completed+interval '14 days',false);
$$;
CREATE OR REPLACE FUNCTION public.pilot_order_transaction(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
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
CREATE OR REPLACE FUNCTION public.pilot_po_lines_v1(p_po_id uuid,p_page integer,p_page_size integer,p_expected_updated_at timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb; version_time timestamptz;
BEGIN
 PERFORM private.pilot_read_page_guard_v1(p_page,p_page_size);
 IF p_po_id IS NULL OR (p_page>1 AND p_expected_updated_at IS NULL) OR (p_expected_updated_at IS NOT NULL AND NOT isfinite(p_expected_updated_at)) THEN
  RAISE EXCEPTION 'PO ID and consistent page version required' USING ERRCODE='22023';
 END IF;
 SELECT p.updated_at INTO version_time FROM public.purchase_orders p WHERE p.id=p_po_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'PO not found or unavailable' USING ERRCODE='22023'; END IF;
 IF p_expected_updated_at IS NOT NULL AND version_time IS DISTINCT FROM p_expected_updated_at THEN
  RAISE EXCEPTION 'PO changed; refresh before continuing' USING ERRCODE='PT409';
 END IF;
 WITH lines AS MATERIALIZED (SELECT l.id,l.product_id,l.product_name,l.sku,l.quantity,l.unit_price,l.line_total FROM public.po_line_items l WHERE l.purchase_order_id=p_po_id),
 delivered AS (
  SELECT d.po_line_item_id,sum(d.quantity_delivered) FILTER(WHERE s.voided_at IS NULL) AS quantity,count(*)>0 AS history
  FROM public.sj_line_items d JOIN public.surat_jalan s ON s.id=d.surat_jalan_id JOIN lines l ON l.id=d.po_line_item_id
  GROUP BY d.po_line_item_id
 ), page_rows AS (
  SELECT l.*,coalesce(d.quantity,0) AS delivered_quantity,coalesce(d.history,false) AS has_delivery_history
  FROM lines l LEFT JOIN delivered d ON d.po_line_item_id=l.id
  ORDER BY l.id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size
 )
 SELECT jsonb_build_object('version',1,'as_of',statement_timestamp(),'page',p_page,'page_size',p_page_size,
  'po_updated_at',version_time,'po_has_delivery_history',EXISTS(SELECT 1 FROM public.surat_jalan s WHERE s.purchase_order_id=p_po_id),
  'total',(SELECT count(*) FROM lines),'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'product_id',product_id,'product_name',product_name,
   'sku',sku,'quantity',quantity,'unit_price',unit_price::text,'line_total',line_total::text,
   'delivered_quantity',delivered_quantity,'has_delivery_history',has_delivery_history) ORDER BY id) FROM page_rows),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;
CREATE FUNCTION private.demo_promotion_path(path text,actor uuid,promotion uuid DEFAULT NULL) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(path ~ '^promotions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|png|jpg)$'
 AND split_part(path,'/',2)=actor::text AND (promotion IS NULL OR split_part(path,'/',3)=promotion::text),false);
$$;
CREATE FUNCTION private.demo_promotion_object(path text,actor uuid,promotion uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT private.demo_promotion_path(path,actor,promotion) AND EXISTS(SELECT 1 FROM storage.objects o
 WHERE o.bucket_id='promotion-images' AND o.name=path AND o.owner_id=actor::text
 AND jsonb_typeof(o.metadata->'size')='number' AND (o.metadata->>'size')::numeric BETWEEN 1 AND 5242880
 AND o.metadata->>'mimetype'=CASE WHEN path LIKE '%.webp' THEN 'image/webp' WHEN path LIKE '%.png' THEN 'image/png' ELSE 'image/jpeg' END);
$$;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('promotion-images','promotion-images',false,5242880,ARRAY['image/webp','image/png','image/jpeg']);
CREATE FUNCTION private.demo_can_upload_promotion(path text,owner text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(public.current_user_role() IN ('po_admin','executive') AND owner=auth.uid()::text AND private.demo_promotion_path(path,auth.uid(),NULL),false);
$$;
CREATE POLICY demo_promotion_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='promotion-images' AND private.demo_can_upload_promotion(name,owner_id));
CREATE POLICY demo_promotion_insert_guard ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(bucket_id<>'promotion-images' OR private.demo_can_upload_promotion(name,owner_id));
CREATE POLICY demo_promotion_no_raw_read ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING(bucket_id<>'promotion-images');
CREATE POLICY demo_promotion_no_raw_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated USING(bucket_id<>'promotion-images') WITH CHECK(bucket_id<>'promotion-images');
CREATE POLICY demo_promotion_no_raw_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated USING(bucket_id<>'promotion-images');
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.promotions FROM PUBLIC,anon,authenticated;
ALTER POLICY promotions_write ON public.promotions USING(false) WITH CHECK(false);
CREATE FUNCTION public.pilot_promotions_v1(p_include_inactive boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE role public.user_role:=public.current_user_role(); result jsonb;
BEGIN
 IF role NOT IN ('po_admin','executive','sales_head','sales_manager','sales_person') OR role IS NULL THEN RAISE EXCEPTION 'Active promotion audience required' USING ERRCODE='42501'; END IF;
 IF p_include_inactive IS NULL OR (p_include_inactive AND role NOT IN ('po_admin','executive')) THEN RAISE EXCEPTION 'Promotion administration read required' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('version',1,'as_of',statement_timestamp(),'items',coalesce(jsonb_agg(jsonb_build_object(
 'id',p.id,'product_id',p.product_id,'product_name',c.name,'sku',c.sku,'size',c.size,
 'harga_pokok',p.harga_pokok,'luar_kota',p.luar_kota,'dalam_kota',p.dalam_kota,'depo_bangunan',p.depo_bangunan,
 'is_active',p.is_active,'stock_managed',p.stock_managed,'remaining_quantity',CASE WHEN p.stock_managed THEN p.remaining_quantity ELSE NULL END,'stock_version',p.stock_version,
 'image_path',p.image_path,'start_date',p.start_date,'end_date',p.end_date,'created_at',p.created_at) ORDER BY c.name,p.id),'[]')) INTO result
 FROM public.promotions p JOIN public.products c ON c.id=p.product_id WHERE p_include_inactive OR (p.is_active AND p.stock_managed);
 RETURN result;
END $$;
CREATE FUNCTION public.pilot_promotion_image_v1(p_promotion_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE role public.user_role:=public.current_user_role(); path text;
BEGIN
 IF role IS NULL OR role NOT IN ('po_admin','executive','sales_head','sales_manager','sales_person') THEN RAISE EXCEPTION 'Active promotion audience required' USING ERRCODE='42501'; END IF;
 SELECT p.image_path INTO path FROM public.promotions p WHERE p.id=p_promotion_id AND p.stock_managed
 AND (p.is_active OR role IN ('po_admin','executive')) AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='promotion-images' AND o.name=p.image_path);
 IF path IS NULL THEN RAISE EXCEPTION 'Linked promotion image unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('version',1,'promotion_id',p_promotion_id,'bucket','promotion-images','path',path,'expires_in',300);
END $$;
CREATE FUNCTION private.demo_payload_keys(payload jsonb,keys text[]) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(payload) k) IS DISTINCT FROM (SELECT array_agg(k ORDER BY k) FROM unnest(keys) k)
 THEN RAISE EXCEPTION 'Unexpected or missing promotion fields' USING ERRCODE='22023'; END IF;
END $$;
CREATE FUNCTION public.pilot_promotion_transaction_v1(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE actor uuid:=auth.uid(); role public.user_role; prior private.pilot_promotion_requests%ROWTYPE;
 campaign public.promotions%ROWTYPE; id uuid; product uuid; n numeric; k text; v_result jsonb; is_new boolean;
BEGIN
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
CREATE FUNCTION public.pilot_reconcile_promotion_v1(p_request_id uuid,p_abandon boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); role public.user_role; prior private.pilot_promotion_requests%ROWTYPE;
BEGIN
 role:=private.demo_order_actor();
 IF role NOT IN ('po_admin','executive') THEN RAISE EXCEPTION 'Current promotion administration required' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_abandon IS NULL THEN RAISE EXCEPTION 'Request identity required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_request_id::text,0));
 SELECT * INTO prior FROM private.pilot_promotion_requests r WHERE r.actor_id=actor AND r.request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF prior.result IS NOT NULL THEN RETURN jsonb_build_object('state','committed','operation',prior.operation,'result',prior.result); END IF;
  IF prior.abandoned THEN RETURN jsonb_build_object('state','abandoned'); END IF;
 END IF;
 IF NOT p_abandon THEN RETURN jsonb_build_object('state','unknown'); END IF;
 INSERT INTO private.pilot_promotion_requests(actor_id,request_id,operation,payload,abandoned) VALUES(actor,p_request_id,'promotion_recovery_abandoned','{}',true)
 ON CONFLICT(actor_id,request_id) DO UPDATE SET abandoned=true;
 RETURN jsonb_build_object('state','abandoned');
END $$;
CREATE OR REPLACE FUNCTION public.pilot_reconcile_request(p_request_id uuid,p_abandon boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); role public.user_role; prior private.pilot_order_requests%ROWTYPE; known_visit boolean:=false;
BEGIN
 role:=private.demo_order_actor();
 IF p_request_id IS NULL OR p_abandon IS NULL THEN RAISE EXCEPTION 'Request ID required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_request_id::text,0));
 SELECT * INTO prior FROM private.pilot_order_requests r WHERE r.actor_id=actor AND r.request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF prior.operation NOT IN ('submit_sales','create_po','approve_sales','reject_sales','edit_po','save_delivery','void_delivery','cancel_po','edit_sj_returned_date','recovery_abandoned') THEN RAISE EXCEPTION 'Use operation-specific recovery' USING ERRCODE='22023'; END IF;
  IF prior.operation='submit_sales' THEN
   IF role NOT IN ('sales_person','sales_manager','sales_head','executive') OR NOT private.pilot_can_access_customer((prior.payload->>'customer_id')::uuid) THEN RAISE EXCEPTION 'Current sales and customer access required' USING ERRCODE='42501'; END IF;
  ELSIF prior.operation<>'recovery_abandoned' AND role NOT IN ('po_admin','executive') THEN RAISE EXCEPTION 'Current PO administration required' USING ERRCODE='42501'; END IF;
  IF prior.result IS NOT NULL THEN RETURN jsonb_build_object('state','committed','operation',prior.operation,'result',prior.result); END IF;
 ELSIF role NOT IN ('po_admin','executive','sales_person','sales_manager','sales_head') THEN RAISE EXCEPTION 'Order recovery access required' USING ERRCODE='42501'; END IF;
 -- A later migration installs the separate visit ledger. Keep Task 1 independently applicable.
 -- Own committed order results above take precedence; family-local unknown tombstones do not.
 IF to_regclass('private.pilot_visit_requests') IS NOT NULL THEN
  EXECUTE 'SELECT EXISTS(SELECT 1 FROM private.pilot_visit_requests WHERE actor_id=$1 AND request_id=$2 AND operation=''finalize_visit'' AND result IS NOT NULL AND NOT abandoned)'
  INTO known_visit USING actor,p_request_id;
  IF known_visit THEN RAISE EXCEPTION 'Use visit request recovery for this operation' USING ERRCODE='22023'; END IF;
 END IF;
 IF prior.abandoned THEN RETURN jsonb_build_object('state','abandoned'); END IF;
 IF NOT p_abandon THEN RETURN jsonb_build_object('state','unknown'); END IF;
 INSERT INTO private.pilot_order_requests(actor_id,request_id,operation,payload,abandoned) VALUES(actor,p_request_id,'recovery_abandoned','{}',true)
 ON CONFLICT(actor_id,request_id) DO UPDATE SET abandoned=true;
 RETURN jsonb_build_object('state','abandoned');
END $$;
-- New helper functions are private implementation, never browser RPC escape hatches.
DO $acl$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname LIKE 'demo_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
 END LOOP;
END $acl$;
GRANT EXECUTE ON FUNCTION private.demo_can_upload_promotion(text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.pilot_promotions_v1(boolean),public.pilot_promotion_image_v1(uuid),public.pilot_promotion_transaction_v1(uuid,text,jsonb),public.pilot_reconcile_promotion_v1(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_promotions_v1(boolean),public.pilot_promotion_image_v1(uuid),public.pilot_promotion_transaction_v1(uuid,text,jsonb),public.pilot_reconcile_promotion_v1(uuid,boolean) TO authenticated;
DO $postflight$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_temp.demo_function_metadata m JOIN pg_proc p ON p.oid=m.oid WHERE to_jsonb(p)-'prosrc' IS DISTINCT FROM m.metadata) THEN RAISE EXCEPTION 'Existing function metadata changed'; END IF;
 IF has_table_privilege('authenticated','public.promotions','INSERT,UPDATE,DELETE') OR EXISTS(SELECT 1 FROM public.promotions WHERE stock_managed) OR EXISTS(SELECT 1 FROM public.purchase_orders WHERE sales_attribution_state<>'legacy') THEN RAISE EXCEPTION 'Unexpected write grant or historical mutation'; END IF;
END $postflight$;
NOTIFY pgrst,'reload schema';
COMMIT;
