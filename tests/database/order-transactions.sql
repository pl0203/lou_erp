-- Synthetic serial tests. Requires observed schema/functions + security migration.
-- Single-user PostgreSQL bypasses RLS and cannot establish concurrency or real JWT/PostgREST behavior.
-- Explicit function checks and catalog ACL assertions only; not an RLS enforcement test.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('public.pilot_order_transaction(uuid,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Transaction RPC is missing';
  END IF;
END $$;
INSERT INTO auth.users(id) VALUES ('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002'),('10000000-0000-0000-0000-000000000003');
INSERT INTO public.users(id,full_name,email,role) VALUES
('10000000-0000-0000-0000-000000000001','Pilot admin','pilot-admin@example.invalid','po_admin'),
('10000000-0000-0000-0000-000000000002','Pilot sales','pilot-sales@example.invalid','sales_person'),
('10000000-0000-0000-0000-000000000003','Other sales','pilot-other@example.invalid','sales_person');
INSERT INTO public.customers(id,name) VALUES ('20000000-0000-0000-0000-000000000001','Synthetic customer');
INSERT INTO public.sales_schedules(id,outlet_id,sales_person_id,assigned_by,scheduled_date) VALUES ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',CURRENT_DATE);
INSERT INTO public.outlet_visits(id,outlet_id,sales_person_id,schedule_id) VALUES ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001');
CREATE FUNCTION public.pilot_test_fail_line() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.product_name='FAULT_INJECT' THEN RAISE EXCEPTION 'injected write failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER pilot_test_fail_line BEFORE INSERT ON public.po_line_items FOR EACH ROW EXECUTE FUNCTION public.pilot_test_fail_line();
CREATE FUNCTION public.pilot_test_fail_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM public.surat_jalan WHERE id=NEW.surat_jalan_id AND sj_number='FAULT-SJ') THEN RAISE EXCEPTION 'injected delivery failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER pilot_test_fail_delivery BEFORE INSERT ON public.sj_line_items FOR EACH ROW EXECUTE FUNCTION public.pilot_test_fail_delivery();
CREATE TEMP TABLE po_audit_log (LIKE public.po_audit_log INCLUDING ALL);
GRANT SELECT ON pg_temp.po_audit_log TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
DO $$
DECLARE
  result jsonb; replay jsonb; po uuid; line1 uuid; line2 uuid; sj uuid; full_sj uuid; sales uuid; stale_version timestamptz;
  version timestamptz; header jsonb; payload jsonb; before_count bigint; req uuid;
BEGIN
  header := jsonb_build_object('customer_id','20000000-0000-0000-0000-000000000001','po_number','TEST-ATOMIC-1','order_date',CURRENT_DATE,'items',jsonb_build_array(jsonb_build_object('product_name','A','quantity',2,'unit_price',10),jsonb_build_object('product_name','B','quantity',3,'unit_price',0)));
  req := gen_random_uuid();
  result := public.pilot_order_transaction(req,'create_po',header);
  po := (result->>'id')::uuid;
  version := (result->>'updated_at')::timestamptz;
  IF EXISTS(SELECT 1 FROM pg_temp.po_audit_log) THEN RAISE EXCEPTION 'Temporary table hijacked audit writes'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.po_audit_log WHERE purchase_order_id=po) THEN RAISE EXCEPTION 'Authoritative audit records missing'; END IF;
  IF (SELECT total_value FROM public.purchase_orders WHERE id=po) <> 20 THEN RAISE EXCEPTION 'Incorrect computed total'; END IF;
  replay := public.pilot_order_transaction(req,'create_po',header);
  IF replay <> result THEN RAISE EXCEPTION 'Replay was not identical'; END IF;
  IF public.pilot_reconcile_request(req,false)->>'state'<>'committed' THEN RAISE EXCEPTION 'Committed request not recoverable'; END IF;
  replay:=public.pilot_reconcile_request('90000000-0000-0000-0000-000000000001',true);
  IF replay->>'state'<>'abandoned' THEN RAISE EXCEPTION 'Request abandonment missing'; END IF;
  BEGIN
    PERFORM public.pilot_order_transaction('90000000-0000-0000-0000-000000000001','create_po',header || '{"po_number":"DELAYED-REQUEST"}'::jsonb);
    RAISE EXCEPTION 'Delayed abandoned request executed';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  BEGIN
    PERFORM public.pilot_order_transaction(req,'create_po',header || '{"notes":"changed"}'::jsonb);
    RAISE EXCEPTION 'Changed-payload request incorrectly accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  SELECT count(*) INTO before_count FROM public.purchase_orders;
  BEGIN
    PERFORM public.pilot_order_transaction(gen_random_uuid(),'create_po',header || '{"po_number":"TEST-FAIL","items":[{"product_name":"FAULT_INJECT","quantity":1,"unit_price":1}]}'::jsonb);
    RAISE EXCEPTION 'Injected failure was not raised';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'injected write failure' THEN RAISE; END IF; END;
  IF (SELECT count(*) FROM public.purchase_orders) <> before_count THEN RAISE EXCEPTION 'Partial PO survived failed line write'; END IF;
  BEGIN
    PERFORM public.pilot_order_transaction(gen_random_uuid(),'create_po',header || '{"po_number":"TEST-BAD","items":[{"product_name":"A","quantity":1.5,"unit_price":1}]}'::jsonb);
    RAISE EXCEPTION 'Fractional quantity incorrectly accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  SELECT id INTO line1 FROM public.po_line_items WHERE purchase_order_id=po AND product_name='A';
  SELECT id INTO line2 FROM public.po_line_items WHERE purchase_order_id=po AND product_name='B';
  stale_version := version;
  payload := jsonb_build_object('po_id',po,'expected_updated_at',version,'sj_number','SJ-1','sj_date',CURRENT_DATE,'lines',jsonb_build_array(jsonb_build_object('po_line_item_id',line1,'quantity_delivered',2)));
  result := public.pilot_order_transaction(gen_random_uuid(),'save_delivery',payload);
  sj := (result->>'id')::uuid; version := (result->>'updated_at')::timestamptz;
  IF (SELECT status FROM public.purchase_orders WHERE id=po) <> 'in_progress' THEN RAISE EXCEPTION 'Partial delivery marked complete'; END IF;
  BEGIN
    PERFORM public.pilot_order_transaction(gen_random_uuid(),'edit_po',jsonb_build_object('po_id',po,'expected_updated_at',stale_version,'customer_id','20000000-0000-0000-0000-000000000001','items',jsonb_build_array(jsonb_build_object('id',line1,'product_name','A','quantity',2,'unit_price',10))));
    RAISE EXCEPTION 'Stale edit incorrectly accepted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  BEGIN
    PERFORM public.pilot_order_transaction(gen_random_uuid(),'save_delivery',payload || jsonb_build_object('sj_id',sj,'sj_number','FAULT-SJ','expected_updated_at',version,'lines',jsonb_build_array(jsonb_build_object('po_line_item_id',line1,'quantity_delivered',1))));
    RAISE EXCEPTION 'Injected delivery failure was not raised';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'injected delivery failure' THEN RAISE; END IF; END;
  IF (SELECT sj_number FROM public.surat_jalan WHERE id=sj)<>'SJ-1' OR (SELECT sum(quantity_delivered) FROM public.sj_line_items WHERE surat_jalan_id=sj)<>2 THEN RAISE EXCEPTION 'Delivery replacement did not roll back'; END IF;
  result:=public.pilot_order_transaction(gen_random_uuid(),'save_delivery',jsonb_build_object('po_id',po,'expected_updated_at',version,'sj_number','SJ-FULL','sj_date',CURRENT_DATE,'lines',jsonb_build_array(jsonb_build_object('po_line_item_id',line2,'quantity_delivered',3))));
  full_sj:=(result->>'id')::uuid; version:=(result->>'updated_at')::timestamptz;
  IF (SELECT status FROM public.purchase_orders WHERE id=po)<>'complete' THEN RAISE EXCEPTION 'All lines delivered but PO not complete'; END IF;
  result:=public.pilot_order_transaction(gen_random_uuid(),'void_delivery',jsonb_build_object('sj_id',full_sj,'expected_updated_at',version,'reason','test correction'));
  version:=(result->>'updated_at')::timestamptz;
  IF (SELECT status FROM public.purchase_orders WHERE id=po)<>'in_progress' THEN RAISE EXCEPTION 'Void did not reopen partial PO'; END IF;
  BEGIN
    PERFORM public.pilot_order_transaction(gen_random_uuid(),'save_delivery',payload || jsonb_build_object('sj_id',sj,'expected_updated_at',version,'lines',jsonb_build_array(jsonb_build_object('po_line_item_id',line1,'quantity_delivered',5))));
    RAISE EXCEPTION 'Wrong-line overdelivery incorrectly accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF (SELECT sum(quantity_delivered) FROM public.sj_line_items WHERE surat_jalan_id=sj) <> 2 THEN RAISE EXCEPTION 'Failed delivery edit lost original lines'; END IF;
  BEGIN
    PERFORM public.pilot_order_transaction(gen_random_uuid(),'cancel_po',jsonb_build_object('po_id',po,'expected_updated_at',version,'reason','test'));
    RAISE EXCEPTION 'Shipped PO incorrectly cancelled';
  EXCEPTION WHEN check_violation THEN NULL; END;
  result := public.pilot_order_transaction(gen_random_uuid(),'void_delivery',jsonb_build_object('sj_id',sj,'expected_updated_at',version,'reason','entered in error'));
  version := (result->>'updated_at')::timestamptz;
  IF NOT EXISTS(SELECT 1 FROM public.surat_jalan WHERE id=sj AND voided_at IS NOT NULL) OR NOT EXISTS(SELECT 1 FROM public.sj_line_items WHERE surat_jalan_id=sj) THEN RAISE EXCEPTION 'Void erased shipment history'; END IF;
  BEGIN
    PERFORM public.pilot_order_transaction(gen_random_uuid(),'edit_po',jsonb_build_object('po_id',po,'expected_updated_at',version,'customer_id','20000000-0000-0000-0000-000000000001','items',jsonb_build_array(jsonb_build_object('id',line1,'product_name','REWRITTEN HISTORY','quantity',2,'unit_price',10),jsonb_build_object('id',line2,'product_name','B','quantity',3,'unit_price',0))));
    RAISE EXCEPTION 'Voided shipment identity rewritten';
  EXCEPTION WHEN check_violation THEN NULL; END;
  result := public.pilot_order_transaction(gen_random_uuid(),'cancel_po',jsonb_build_object('po_id',po,'expected_updated_at',version,'reason','customer cancelled before dispatch'));
  IF (SELECT status FROM public.purchase_orders WHERE id=po) <> 'cancelled' THEN RAISE EXCEPTION 'PO cancellation failed'; END IF;
  IF has_table_privilege('authenticated','public.purchase_orders','INSERT') THEN RAISE EXCEPTION 'Direct write grant remains'; END IF;
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
  BEGIN
    PERFORM public.pilot_order_transaction(gen_random_uuid(),'submit_sales',jsonb_build_object('customer_id','20000000-0000-0000-0000-000000000001','visit_id','40000000-0000-0000-0000-000000000001','items',jsonb_build_array(jsonb_build_object('product_name','A','quantity',1,'unit_price',10))));
    RAISE EXCEPTION 'Other sales actor submitted another visit';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
  result := public.pilot_order_transaction(gen_random_uuid(),'submit_sales',jsonb_build_object('customer_id','20000000-0000-0000-0000-000000000001','visit_id','40000000-0000-0000-0000-000000000001','items',jsonb_build_array(jsonb_build_object('product_name','A','quantity',1,'unit_price',10))));
  sales := (result->>'id')::uuid;
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
  result := public.pilot_order_transaction(gen_random_uuid(),'approve_sales',jsonb_build_object('order_id',sales,'po_number','TEST-APPROVED'));
  BEGIN
    PERFORM public.pilot_order_transaction(gen_random_uuid(),'approve_sales',jsonb_build_object('order_id',sales,'po_number','TEST-DUPLICATE'));
    RAISE EXCEPTION 'Sales order approved twice';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  BEGIN
    PERFORM public.pilot_order_transaction(gen_random_uuid(),'reject_sales',jsonb_build_object('order_id',sales,'reason','stale screen'));
    RAISE EXCEPTION 'Approved sales order rejected';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END;
$$;
RESET ROLE;
ROLLBACK;
