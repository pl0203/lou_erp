-- STAGING-ONLY until reviewed backend + compatible client rollout is approved.
-- Requires 202609300001_pilot_security.sql and the verified existing public schema.
BEGIN;
ALTER TABLE public.girard_orders DROP CONSTRAINT girard_orders_status_check;
ALTER TABLE public.girard_orders ADD CONSTRAINT girard_orders_status_check CHECK(status IN ('pending','approved','rejected','cancelled'));
ALTER TABLE public.surat_jalan ADD COLUMN voided_at timestamptz, ADD COLUMN voided_by uuid REFERENCES public.users(id), ADD COLUMN void_reason text;
ALTER TABLE public.surat_jalan ADD CONSTRAINT pilot_void_metadata CHECK ((voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL) OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND length(btrim(void_reason)) > 0));
CREATE TABLE private.pilot_order_requests (
  actor_id uuid NOT NULL REFERENCES public.users(id), request_id uuid NOT NULL,
  operation text NOT NULL, payload jsonb NOT NULL, result jsonb, abandoned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(actor_id,request_id)
);
ALTER TABLE private.pilot_order_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.pilot_order_requests FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.pilot_validate_order_lines(items jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE item jsonb; normalized jsonb := '[]'; q numeric; price numeric; total numeric := 0;
BEGIN
 IF jsonb_typeof(items) IS DISTINCT FROM 'array' OR jsonb_array_length(items)=0 THEN RAISE EXCEPTION 'At least one item is required' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
  IF jsonb_typeof(item->'product_name') IS DISTINCT FROM 'string' OR btrim(item->>'product_name')='' OR jsonb_typeof(item->'quantity') IS DISTINCT FROM 'number' OR jsonb_typeof(item->'unit_price') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid item fields' USING ERRCODE='22023'; END IF;
  q := (item->>'quantity')::numeric; price := (item->>'unit_price')::numeric;
  IF q<=0 OR q<>trunc(q) OR q>2147483647 OR price<0 OR price<>round(price,2) OR price>999999999999.99 THEN RAISE EXCEPTION 'Invalid quantity or price precision' USING ERRCODE='22023'; END IF;
  total := total+q*price;
  IF total>999999999999.99 THEN RAISE EXCEPTION 'Order total exceeds supported precision' USING ERRCODE='22023'; END IF;
  normalized := normalized || jsonb_build_array(jsonb_build_object('id',nullif(item->>'id','')::uuid,'product_id',nullif(item->>'product_id','')::uuid,'product_name',btrim(item->>'product_name'),'sku',nullif(btrim(item->>'sku'),''),'quantity',q::integer,'unit_price',price,'is_promo',coalesce((item->>'is_promo')::boolean,false),'promotion_id',nullif(item->>'promotion_id','')::uuid));
 END LOOP;
 IF (SELECT count(*) FROM jsonb_array_elements(normalized) x WHERE x->>'id' IS NOT NULL) <> (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(normalized) x WHERE x->>'id' IS NOT NULL) THEN RAISE EXCEPTION 'Duplicate item IDs' USING ERRCODE='22023'; END IF;
 RETURN normalized;
END $$;

CREATE FUNCTION private.pilot_insert_po(actor uuid,payload jsonb,items jsonb) RETURNS uuid
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE po uuid;
BEGIN
 IF nullif(btrim(payload->>'po_number'),'') IS NULL THEN RAISE EXCEPTION 'PO number required' USING ERRCODE='22023'; END IF;
 INSERT INTO public.purchase_orders(customer_id,created_by,po_number,status,order_date,expected_delivery_date,notes)
 VALUES ((payload->>'customer_id')::uuid,actor,btrim(payload->>'po_number'),'confirm',coalesce((payload->>'order_date')::date,(clock_timestamp() AT TIME ZONE 'UTC')::date),(payload->>'expected_delivery_date')::date,nullif(payload->>'notes','')) RETURNING id INTO po;
 INSERT INTO public.po_line_items(purchase_order_id,product_name,sku,quantity,unit_price)
 SELECT po,x->>'product_name',x->>'sku',(x->>'quantity')::integer,(x->>'unit_price')::numeric FROM jsonb_array_elements(items) x;
 RETURN po;
END $$;

-- Correct completion per ordered line; voided deliveries never count as active fulfillment.
CREATE FUNCTION private.pilot_reconcile_po(po uuid) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE target public.po_status; current_status public.po_status;
BEGIN
 SELECT status INTO current_status FROM public.purchase_orders WHERE id=po FOR UPDATE;
 IF current_status IS NULL OR current_status NOT IN ('confirm','in_progress','complete') THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.po_line_items l WHERE l.purchase_order_id=po)
 AND NOT EXISTS(SELECT 1 FROM public.po_line_items l WHERE l.purchase_order_id=po AND l.quantity<>(SELECT coalesce(sum(s.quantity_delivered),0) FROM public.sj_line_items s JOIN public.surat_jalan h ON h.id=s.surat_jalan_id WHERE s.po_line_item_id=l.id AND h.purchase_order_id=po AND h.voided_at IS NULL)) THEN target:='complete';
 ELSIF EXISTS(SELECT 1 FROM public.sj_line_items s JOIN public.surat_jalan h ON h.id=s.surat_jalan_id WHERE h.purchase_order_id=po AND h.voided_at IS NULL AND s.quantity_delivered>0) THEN target:='in_progress';
 ELSE target:='confirm'; END IF;
 UPDATE public.purchase_orders SET status=target,completed_at=CASE WHEN target='complete' THEN coalesce(completed_at,clock_timestamp()) ELSE NULL END WHERE id=po AND (status IS DISTINCT FROM target OR (target<>'complete' AND completed_at IS NOT NULL));
END $$;
CREATE OR REPLACE FUNCTION public.check_po_completion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE po uuid;
BEGIN
 SELECT purchase_order_id INTO po FROM public.surat_jalan WHERE id=coalesce(NEW.surat_jalan_id,OLD.surat_jalan_id);
 IF po IS NOT NULL THEN PERFORM private.pilot_reconcile_po(po); END IF;
 RETURN coalesce(NEW,OLD);
END $$;
DROP TRIGGER trg_check_po_completion ON public.sj_line_items;
CREATE CONSTRAINT TRIGGER trg_check_po_completion AFTER INSERT OR UPDATE OR DELETE ON public.sj_line_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_po_completion();

-- Existing audit/recalculation functions use public relations; public CREATE is revoked in migration 1.
ALTER FUNCTION public.log_line_item_changes() SET search_path=pg_catalog,public,pg_temp;
ALTER FUNCTION public.log_sj_changes() SET search_path=pg_catalog,public,pg_temp;
ALTER FUNCTION public.recalculate_po_total() SET search_path=pg_catalog,public,pg_temp;
CREATE OR REPLACE FUNCTION public.log_po_changes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); field text; old_data jsonb:=to_jsonb(OLD); new_data jsonb:=to_jsonb(NEW);
BEGIN
 FOREACH field IN ARRAY ARRAY['status','customer_id','expected_delivery_date','notes'] LOOP
  IF old_data->field IS DISTINCT FROM new_data->field THEN
   INSERT INTO public.po_audit_log(purchase_order_id,changed_by,field_changed,old_value,new_value) VALUES(NEW.id,actor,CASE WHEN field='customer_id' THEN 'customer' ELSE field END,old_data->>field,new_data->>field);
  END IF;
 END LOOP;
 NEW.updated_at:=greatest(clock_timestamp(),OLD.updated_at+interval '1 microsecond');
 RETURN NEW;
END $$;

CREATE FUNCTION public.pilot_order_transaction(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE
 actor uuid:=auth.uid(); role public.user_role:=public.current_user_role(); prior private.pilot_order_requests%ROWTYPE;
 po public.purchase_orders%ROWTYPE; so public.girard_orders%ROWTYPE; sj public.surat_jalan%ROWTYPE;
 items jsonb; item jsonb; existing public.po_line_items%ROWTYPE; promo public.promotions%ROWTYPE;
 v_result jsonb; id uuid; po_id uuid; customer_id uuid; visit_id uuid; expected timestamptz;
 amount numeric; delivered bigint; qty numeric; price numeric; tier public.pricing_tier;
 old_lines jsonb; new_lines jsonb; reason text;
BEGIN
 IF actor IS NULL OR role IS NULL THEN RAISE EXCEPTION 'Active authenticated profile required' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Request ID and object payload required' USING ERRCODE='22023'; END IF;
 IF p_operation='submit_sales' THEN
  IF role NOT IN ('sales_person','sales_manager','sales_head','executive') THEN RAISE EXCEPTION 'Sales permission required' USING ERRCODE='42501'; END IF;
  customer_id:=(p_payload->>'customer_id')::uuid; visit_id:=(p_payload->>'visit_id')::uuid;
  IF NOT private.pilot_can_access_customer(customer_id) OR NOT EXISTS(SELECT 1 FROM public.outlet_visits v JOIN public.sales_schedules s ON s.id=v.schedule_id WHERE v.id=visit_id AND v.outlet_id=customer_id AND v.sales_person_id=actor AND s.outlet_id=customer_id AND s.sales_person_id=actor) THEN RAISE EXCEPTION 'An assigned customer and actor-owned visit are required' USING ERRCODE='42501'; END IF;
 ELSIF p_operation IN ('create_po','approve_sales','reject_sales','edit_po','save_delivery','void_delivery','cancel_po') THEN
  IF role NOT IN ('po_admin','executive') THEN RAISE EXCEPTION 'PO administration permission required' USING ERRCODE='42501'; END IF;
 ELSE RAISE EXCEPTION 'Unsupported order operation' USING ERRCODE='22023'; END IF;
 -- Serialize execution and reconciliation, including requests which have not arrived yet.
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text || ':' || p_request_id::text,0));
 -- Authorization is checked on every retry before reading a stored result.
 INSERT INTO private.pilot_order_requests(actor_id,request_id,operation,payload) VALUES(actor,p_request_id,p_operation,p_payload) ON CONFLICT DO NOTHING;
 SELECT * INTO prior FROM private.pilot_order_requests r WHERE r.actor_id=actor AND r.request_id=p_request_id FOR UPDATE;
 IF prior.abandoned THEN RAISE EXCEPTION 'Request was safely abandoned; it cannot execute' USING ERRCODE='55000'; END IF;
 IF prior.operation IS DISTINCT FROM p_operation OR prior.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'Request ID already used with different input; reconcile the prior result' USING ERRCODE='22023'; END IF;
 IF prior.result IS NOT NULL THEN RETURN prior.result; END IF;
 IF p_operation='submit_sales' THEN
  items:=private.pilot_validate_order_lines(p_payload->'items');
  SELECT pricing_tier INTO tier FROM public.customers WHERE public.customers.id=customer_id;
  FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
   IF (item->>'is_promo')::boolean THEN
    SELECT * INTO promo FROM public.promotions WHERE public.promotions.id=(item->>'promotion_id')::uuid;
    IF NOT FOUND OR NOT promo.is_active OR promo.product_id IS DISTINCT FROM (item->>'product_id')::uuid OR (clock_timestamp() AT TIME ZONE 'UTC')::date NOT BETWEEN promo.start_date AND promo.end_date THEN RAISE EXCEPTION 'Promotion no longer valid' USING ERRCODE='22023'; END IF;
    price:=CASE tier WHEN 'harga_pokok' THEN promo.harga_pokok WHEN 'dalam_kota' THEN promo.dalam_kota WHEN 'depo_bangunan' THEN promo.depo_bangunan ELSE promo.luar_kota END;
    IF price IS DISTINCT FROM (item->>'unit_price')::numeric THEN RAISE EXCEPTION 'Promotion price changed; refresh the order' USING ERRCODE='22023'; END IF;
   ELSIF item->>'promotion_id' IS NOT NULL THEN RAISE EXCEPTION 'Promotion metadata mismatch' USING ERRCODE='22023'; END IF;
  END LOOP;
  SELECT sum((x->>'quantity')::numeric*(x->>'unit_price')::numeric) INTO amount FROM jsonb_array_elements(items) x;
  INSERT INTO public.girard_orders(customer_id,visit_id,submitted_by,status,source,total_value) VALUES(customer_id,visit_id,actor,'pending','sales_initiated',amount) RETURNING public.girard_orders.id INTO id;
  INSERT INTO public.girard_order_items(order_id,product_id,product_name,sku,quantity,unit_price,is_promo,promotion_id) SELECT id,(x->>'product_id')::uuid,x->>'product_name',x->>'sku',(x->>'quantity')::integer,(x->>'unit_price')::numeric,(x->>'is_promo')::boolean,(x->>'promotion_id')::uuid FROM jsonb_array_elements(items) x;
  v_result:=jsonb_build_object('id',id);
 ELSIF p_operation='create_po' THEN
  items:=private.pilot_validate_order_lines(p_payload->'items');
  po_id:=private.pilot_insert_po(actor,p_payload,items);
  SELECT * INTO po FROM public.purchase_orders WHERE public.purchase_orders.id=po_id;
  v_result:=jsonb_build_object('id',po_id,'updated_at',po.updated_at);
 ELSIF p_operation IN ('approve_sales','reject_sales') THEN
  SELECT * INTO so FROM public.girard_orders WHERE public.girard_orders.id=(p_payload->>'order_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sales order not found' USING ERRCODE='22023'; END IF;
  IF so.status<>'pending' THEN RAISE EXCEPTION 'Sales order is no longer pending' USING ERRCODE='55000'; END IF;
  IF p_operation='approve_sales' THEN
   SELECT jsonb_agg(jsonb_build_object('product_name',l.product_name,'sku',l.sku,'quantity',l.quantity,'unit_price',l.unit_price)) INTO items FROM public.girard_order_items l WHERE l.order_id=so.id;
   items:=private.pilot_validate_order_lines(items);
   po_id:=private.pilot_insert_po(actor,p_payload || jsonb_build_object('customer_id',so.customer_id),items);
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
  IF p_operation='void_delivery' THEN
   SELECT * INTO sj FROM public.surat_jalan WHERE public.surat_jalan.id=(p_payload->>'sj_id')::uuid;
   IF NOT FOUND THEN RAISE EXCEPTION 'Delivery note not found' USING ERRCODE='22023'; END IF;
   po_id:=sj.purchase_order_id;
  ELSE po_id:=(p_payload->>'po_id')::uuid; END IF;
  SELECT * INTO po FROM public.purchase_orders WHERE public.purchase_orders.id=po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PO not found' USING ERRCODE='22023'; END IF;
  expected:=(p_payload->>'expected_updated_at')::timestamptz;
  IF expected IS NULL OR expected IS DISTINCT FROM po.updated_at THEN RAISE EXCEPTION 'PO changed; refresh before saving' USING ERRCODE='40001'; END IF;
  IF po.status NOT IN ('confirm','in_progress','complete') THEN RAISE EXCEPTION 'PO status does not allow this operation' USING ERRCODE='55000'; END IF;
  IF p_operation IN ('save_delivery','void_delivery') AND po.status='complete' AND (po.completed_at IS NULL OR clock_timestamp()>po.completed_at+interval '7 days') THEN RAISE EXCEPTION 'Completed delivery correction window has ended' USING ERRCODE='55000'; END IF;
  IF p_operation='edit_po' THEN
   IF po.status='complete' THEN RAISE EXCEPTION 'Completed PO cannot be edited' USING ERRCODE='55000'; END IF;
   items:=private.pilot_validate_order_lines(p_payload->'items');
   customer_id:=(p_payload->>'customer_id')::uuid;
   IF customer_id IS DISTINCT FROM po.customer_id AND EXISTS(SELECT 1 FROM public.surat_jalan h WHERE h.purchase_order_id=po_id) THEN RAISE EXCEPTION 'Customer is immutable after delivery history' USING ERRCODE='23514'; END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(items) WHERE value->>'id' IS NOT NULL LOOP
    SELECT * INTO existing FROM public.po_line_items WHERE public.po_line_items.id=(item->>'id')::uuid AND purchase_order_id=po_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item does not belong to this PO' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM public.sj_line_items l WHERE l.po_line_item_id=existing.id) AND ROW(existing.product_name,existing.sku,existing.unit_price) IS DISTINCT FROM ROW(item->>'product_name',item->>'sku',(item->>'unit_price')::numeric) THEN RAISE EXCEPTION 'Delivered item identity and price are immutable' USING ERRCODE='23514'; END IF;
    SELECT coalesce(sum(l.quantity_delivered),0) INTO delivered FROM public.sj_line_items l JOIN public.surat_jalan h ON h.id=l.surat_jalan_id WHERE l.po_line_item_id=existing.id AND h.voided_at IS NULL;
    IF (item->>'quantity')::integer<delivered THEN RAISE EXCEPTION 'Quantity is below delivered amount' USING ERRCODE='23514'; END IF;
   END LOOP;
   IF EXISTS(SELECT 1 FROM public.po_line_items l WHERE l.purchase_order_id=po_id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(items) x WHERE (x->>'id')::uuid=l.id) AND EXISTS(SELECT 1 FROM public.sj_line_items s WHERE s.po_line_item_id=l.id)) THEN RAISE EXCEPTION 'Cannot delete an item with delivery history' USING ERRCODE='23514'; END IF;
   SELECT jsonb_agg(to_jsonb(l)) INTO old_lines FROM public.po_line_items l WHERE l.purchase_order_id=po_id;
   UPDATE public.purchase_orders SET customer_id=customer_id,expected_delivery_date=(p_payload->>'expected_delivery_date')::date,notes=nullif(p_payload->>'notes','') WHERE public.purchase_orders.id=po_id;
   DELETE FROM public.po_line_items l WHERE l.purchase_order_id=po_id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(items) x WHERE (x->>'id')::uuid=l.id);
   FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
    IF item->>'id' IS NULL THEN
     INSERT INTO public.po_line_items(purchase_order_id,product_name,sku,quantity,unit_price) VALUES(po_id,item->>'product_name',item->>'sku',(item->>'quantity')::integer,(item->>'unit_price')::numeric);
    ELSE UPDATE public.po_line_items SET product_name=item->>'product_name',sku=item->>'sku',quantity=(item->>'quantity')::integer,unit_price=(item->>'unit_price')::numeric WHERE public.po_line_items.id=(item->>'id')::uuid; END IF;
   END LOOP;
   INSERT INTO public.po_audit_log(purchase_order_id,changed_by,field_changed,old_value,new_value) VALUES(po_id,actor,'po_items_revised',old_lines::text,items::text);
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
   UPDATE public.purchase_orders SET status='cancelled',completed_at=NULL WHERE public.purchase_orders.id=po_id;
   INSERT INTO public.po_audit_log(purchase_order_id,changed_by,field_changed,old_value,new_value) VALUES(po_id,actor,'po_cancelled',NULL,reason);
  END IF;
  PERFORM private.pilot_reconcile_po(po_id);
  UPDATE public.purchase_orders SET updated_at=clock_timestamp() WHERE public.purchase_orders.id=po_id RETURNING * INTO po;
  v_result:=jsonb_build_object('id',CASE WHEN p_operation IN ('save_delivery','void_delivery') THEN id ELSE po_id END,'po_id',po_id,'updated_at',po.updated_at);
 END IF;
 UPDATE private.pilot_order_requests r SET result=v_result WHERE r.actor_id=actor AND r.request_id=p_request_id;
 RETURN v_result;
END $$;

-- A terminal tombstone prevents a delayed original request from executing after recovery.
CREATE FUNCTION public.pilot_reconcile_request(p_request_id uuid,p_abandon boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); role public.user_role:=public.current_user_role(); prior private.pilot_order_requests%ROWTYPE;
BEGIN
 IF actor IS NULL OR role IS NULL THEN RAISE EXCEPTION 'Active authenticated profile required' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Request ID required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text || ':' || p_request_id::text,0));
 SELECT * INTO prior FROM private.pilot_order_requests r WHERE r.actor_id=actor AND r.request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
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
REVOKE ALL ON FUNCTION public.pilot_reconcile_request(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_reconcile_request(uuid,boolean) TO authenticated;

-- RPC-only browser writes: old clients must not be used after this migration.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.girard_orders,public.girard_order_items,public.purchase_orders,public.po_line_items,public.surat_jalan,public.sj_line_items FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.pilot_validate_order_lines(jsonb),private.pilot_insert_po(uuid,jsonb,jsonb),private.pilot_reconcile_po(uuid),public.pilot_order_transaction(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_order_transaction(uuid,text,jsonb) TO authenticated;
-- Check-in remains a storage/database saga, but clients cannot forge actor/schedule linkage.
CREATE POLICY pilot_visit_insert_scope ON public.outlet_visits AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (
 sales_person_id=auth.uid() AND private.pilot_can_access_customer(outlet_id)
 AND EXISTS(SELECT 1 FROM public.sales_schedules s WHERE s.id=schedule_id AND s.outlet_id=outlet_visits.outlet_id AND s.sales_person_id=auth.uid()));
CREATE POLICY pilot_photo_insert_scope ON public.visit_photos AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (
 EXISTS(SELECT 1 FROM public.outlet_visits v WHERE v.id=visit_id AND v.sales_person_id=auth.uid()
 AND split_part(storage_path,'/',1)='visits' AND split_part(storage_path,'/',2)=v.schedule_id::text));
REVOKE UPDATE,DELETE ON public.outlet_visits,public.visit_photos FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.update_outlet_last_visit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.customers SET last_visit_date=NEW.checked_in_at::date WHERE id=NEW.outlet_id AND (last_visit_date IS NULL OR last_visit_date<NEW.checked_in_at::date);
 UPDATE public.sales_schedules SET status='completed' WHERE id=NEW.schedule_id AND outlet_id=NEW.outlet_id AND sales_person_id=NEW.sales_person_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.update_outlet_last_visit(),public.check_po_completion(),public.log_po_changes(),public.log_line_item_changes(),public.log_sj_changes(),public.recalculate_po_total() FROM PUBLIC,anon,authenticated;
COMMIT;
