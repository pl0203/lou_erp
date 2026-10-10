-- Synthetic-only real-role test. Run after migration 010 commits its enum addition.
BEGIN;
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF current_database()<>'pilot_test' OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') THEN RAISE EXCEPTION 'Disposable fixture required'; END IF;
 IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.products'::regclass AND attname IN ('unit_price','harga_pokok','luar_kota','dalam_kota','depo_bangunan') AND NOT attnotnull AND NOT atthasdef)<>5 THEN RAISE EXCEPTION 'Catalog null/default contract missing'; END IF;
END $$;
INSERT INTO auth.users(id) VALUES('96000000-0000-0000-0000-000000000001'),('96000000-0000-0000-0000-000000000002');
INSERT INTO public.users(id,full_name,email,role) VALUES
 ('96000000-0000-0000-0000-000000000001','Synthetic catalog admin','catalog-admin@example.invalid','executive'),
 ('96000000-0000-0000-0000-000000000002','Synthetic catalog sales','catalog-sales@example.invalid','sales_person');
INSERT INTO public.customers(id,name,pricing_tier) VALUES
 ('96000000-0000-0000-0001-000000000001','Synthetic Others customer','others'),
 ('96000000-0000-0000-0001-000000000002','Synthetic LK customer','luar_kota');
INSERT INTO public.products(id,sku,name) VALUES('96000000-0000-0000-0002-000000000001','SYNTH-NULL-CATALOG','Synthetic unpriced product');
INSERT INTO public.products(id,sku,name,unit_price,harga_pokok,luar_kota,dalam_kota,depo_bangunan) VALUES('96000000-0000-0000-0002-000000000002','SYNTH-KNOWN-CATALOG','Synthetic existing priced product',10,8,10,11,9);
SELECT set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000001',true);
-- Only setup uses replica mode. Restore normal triggers before every business call.
SET LOCAL session_replication_role=replica;
INSERT INTO public.sales_schedules(id,outlet_id,sales_person_id,assigned_by,scheduled_date,status) VALUES
 ('96000000-0000-0000-0003-000000000001','96000000-0000-0000-0001-000000000001','96000000-0000-0000-0000-000000000002','96000000-0000-0000-0000-000000000001',CURRENT_DATE,'completed'),
 ('96000000-0000-0000-0003-000000000002','96000000-0000-0000-0001-000000000002','96000000-0000-0000-0000-000000000002','96000000-0000-0000-0000-000000000001',CURRENT_DATE,'completed');
INSERT INTO public.outlet_visits(id,outlet_id,sales_person_id,schedule_id) VALUES
 ('96000000-0000-0000-0004-000000000001','96000000-0000-0000-0001-000000000001','96000000-0000-0000-0000-000000000002','96000000-0000-0000-0003-000000000001'),
 ('96000000-0000-0000-0004-000000000002','96000000-0000-0000-0001-000000000002','96000000-0000-0000-0000-000000000002','96000000-0000-0000-0003-000000000002');
SET LOCAL session_replication_role=origin;
INSERT INTO public.promotions(id,product_id,start_date,end_date,is_active,luar_kota,created_by) VALUES
 ('96000000-0000-0000-0005-000000000001','96000000-0000-0000-0002-000000000001',CURRENT_DATE-1,CURRENT_DATE+1,true,0,'96000000-0000-0000-0000-000000000001'),
 ('96000000-0000-0000-0005-000000000002','96000000-0000-0000-0002-000000000002',CURRENT_DATE-1,CURRENT_DATE+1,true,0,'96000000-0000-0000-0000-000000000001');
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF NOT row_security_active('public.products') OR NOT row_security_active('public.customers') THEN RAISE EXCEPTION 'Real RLS required'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000002',true);
DO $$
DECLARE payload jsonb; item jsonb; result jsonb; baseline bigint;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.products WHERE sku='SYNTH-NULL-CATALOG' AND unit_price IS NULL AND harga_pokok IS NULL AND luar_kota IS NULL AND dalam_kota IS NULL AND depo_bangunan IS NULL) THEN RAISE EXCEPTION 'Missing prices became zero'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.products WHERE sku='SYNTH-KNOWN-CATALOG' AND unit_price=10 AND harga_pokok=8 AND luar_kota=10 AND dalam_kota=11 AND depo_bangunan=9) THEN RAISE EXCEPTION 'Existing catalog values changed'; END IF;
 item:=jsonb_build_object('product_id','96000000-0000-0000-0002-000000000001','product_name','Historical description','sku','SYNTH-NULL-CATALOG','quantity',2,'unit_price',42.25);
 payload:=jsonb_build_object('customer_id','96000000-0000-0000-0001-000000000001','visit_id','96000000-0000-0000-0004-000000000001','items',jsonb_build_array(item));
 result:=public.pilot_order_transaction(gen_random_uuid(),'submit_sales',payload);
 IF NOT EXISTS(SELECT 1 FROM public.girard_orders WHERE id=(result->>'id')::uuid AND total_value=84.50) THEN RAISE EXCEPTION 'Explicit regular price or Others classification failed'; END IF;
 SELECT count(*) INTO baseline FROM public.girard_orders;
 BEGIN
  PERFORM public.pilot_order_transaction(gen_random_uuid(),'submit_sales',payload||jsonb_build_object('items',jsonb_build_array(item||'{"unit_price":null}'::jsonb)));
  RAISE EXCEPTION 'Missing price accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 item:=item||jsonb_build_object('is_promo',true,'promotion_id','96000000-0000-0000-0005-000000000001','unit_price',0);
 BEGIN
  PERFORM public.pilot_order_transaction(gen_random_uuid(),'submit_sales',payload||jsonb_build_object('items',jsonb_build_array(item)));
  RAISE EXCEPTION 'Others silently used LK promotion';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 IF (SELECT count(*) FROM public.girard_orders)<>baseline THEN RAISE EXCEPTION 'Rejected order persisted'; END IF;
 payload:=payload||jsonb_build_object('customer_id','96000000-0000-0000-0001-000000000002','visit_id','96000000-0000-0000-0004-000000000002','items',jsonb_build_array(item));
 result:=public.pilot_order_transaction(gen_random_uuid(),'submit_sales',payload);
 IF NOT EXISTS(SELECT 1 FROM public.girard_orders WHERE id=(result->>'id')::uuid AND total_value=0) THEN RAISE EXCEPTION 'Legitimate zero promotion rejected'; END IF;
 item:=item||jsonb_build_object('product_id','96000000-0000-0000-0002-000000000002','promotion_id','96000000-0000-0000-0005-000000000002','unit_price',10);
 BEGIN
  PERFORM public.pilot_order_transaction(gen_random_uuid(),'submit_sales',payload||jsonb_build_object('items',jsonb_build_array(item)));
  RAISE EXCEPTION 'Catalog price incorrectly replaced explicit zero promotion';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000001',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.pilot_order_transaction(gen_random_uuid(),'create_po',jsonb_build_object('customer_id','96000000-0000-0000-0001-000000000001','po_number','SYNTH-MANUAL-PRICE','order_date','2026-08-31','items',jsonb_build_array(jsonb_build_object('product_name','Historical independent line','sku','SYNTH-NULL-CATALOG','quantity',2,'unit_price',12.34))));
 IF NOT EXISTS(SELECT 1 FROM public.purchase_orders WHERE id=(r->>'id')::uuid AND total_value=24.68 AND order_date='2026-08-31') THEN RAISE EXCEPTION 'Historical manual price/date changed'; END IF;
END $$;
ROLLBACK;
SELECT 'NULLABLE_CATALOG_PRICING_VERIFIED' AS result;
