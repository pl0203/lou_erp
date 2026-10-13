-- FICTIONAL disposable fixture only, after the additive migration has committed.
-- Real SET ROLE/RLS assertions; no hosted target, import replay or privilege repair.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL search_path='';
SET LOCAL row_security=off;
DO $guard$
BEGIN
 IF current_database()<>'pilot_test' OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci')
 THEN RAISE EXCEPTION 'Disposable fixture required'; END IF;
 IF current_user<>'postgres' OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('authenticated','anon') AND (rolsuper OR rolbypassrls))
 THEN RAISE EXCEPTION 'Owner setup and genuine non-bypass application roles required'; END IF;
END $guard$;

-- An independent expected relation makes CHECK deparsing portable across PG versions.
CREATE TEMP TABLE customer_categories_expected_definition(
 customer_category text CONSTRAINT customer_categories_expected_check CHECK (
  customer_category IS NULL OR customer_category IN (
   'supermarket_besar','supermarket_sedang','supermarket_kecil','tradisional_market','perorangan'
  )
 )
) ON COMMIT DROP;
DO $schema$
DECLARE category_attribute smallint; actual_definition text; expected_definition text;
BEGIN
 SELECT a.attnum INTO category_attribute FROM pg_catalog.pg_attribute a
 LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid='public.customers'::regclass AND a.attname='customer_category' AND NOT a.attisdropped
  AND pg_catalog.format_type(a.atttypid,a.atttypmod)='text' AND NOT a.attnotnull AND a.attacl IS NULL
  AND a.attidentity='' AND a.attgenerated='' AND coalesce(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'NULL::text')='NULL::text';
 IF category_attribute IS NULL THEN RAISE EXCEPTION 'Exact nullable text/null default category contract missing'; END IF;
 SELECT pg_catalog.pg_get_constraintdef(k.oid) INTO actual_definition FROM pg_catalog.pg_constraint k
 WHERE k.conrelid='public.customers'::regclass AND k.conname='customers_customer_category_check'
  AND k.contype='c' AND k.convalidated AND k.conkey=ARRAY[category_attribute];
 SELECT pg_catalog.pg_get_constraintdef(k.oid) INTO expected_definition FROM pg_catalog.pg_constraint k
 WHERE k.conrelid='pg_temp.customer_categories_expected_definition'::regclass AND k.conname='customer_categories_expected_check';
 IF actual_definition IS DISTINCT FROM expected_definition THEN RAISE EXCEPTION 'Exact five-value validated CHECK definition missing'; END IF;
END $schema$;

INSERT INTO auth.users(id) VALUES
 ('95000000-0000-0000-0000-000000000001'),('95000000-0000-0000-0000-000000000002'),
 ('95000000-0000-0000-0000-000000000003'),('95000000-0000-0000-0000-000000000004'),
 ('95000000-0000-0000-0000-000000000005'),('95000000-0000-0000-0000-000000000006');
INSERT INTO public.users(id,full_name,email,role) VALUES
 ('95000000-0000-0000-0000-000000000001','Synthetic category executive','category-executive@example.invalid','executive'),
 ('95000000-0000-0000-0000-000000000002','Synthetic category head','category-head@example.invalid','sales_head'),
 ('95000000-0000-0000-0000-000000000003','Synthetic category admin','category-admin@example.invalid','po_admin'),
 ('95000000-0000-0000-0000-000000000004','Synthetic assigned category manager','category-manager@example.invalid','sales_manager'),
 ('95000000-0000-0000-0000-000000000005','Synthetic assigned category sales','category-sales@example.invalid','sales_person'),
 ('95000000-0000-0000-0000-000000000006','Synthetic unassigned category manager','category-unassigned@example.invalid','sales_manager');
-- Old-client omission and explicitly reviewed legacy null are both preserved.
INSERT INTO public.customers(id,name,address,city,phone,email,pricing_tier,visit_frequency_days,last_visit_date,created_at) VALUES
 ('95000000-0000-0000-0001-000000000001','Synthetic old-client omission','Fictional Road 1','Synthetic City','000-000','category-customer@example.invalid','others',14,'2026-08-20','2026-08-01T00:00:00Z');
INSERT INTO public.customers(id,name,pricing_tier,customer_category) VALUES
 ('95000000-0000-0000-0001-000000000002','Synthetic explicit legacy null','luar_kota',NULL);
INSERT INTO public.customer_manager_assignments(id,customer_id,manager_id,assigned_by,assigned_at) VALUES
 ('95000000-0000-0000-0002-000000000001','95000000-0000-0000-0001-000000000001','95000000-0000-0000-0000-000000000004','95000000-0000-0000-0000-000000000001','2026-08-01T00:00:00Z');
INSERT INTO public.customer_sales_rep_assignments(id,customer_id,sales_rep_id,assigned_by) VALUES
 ('95000000-0000-0000-0002-000000000002','95000000-0000-0000-0001-000000000001','95000000-0000-0000-0000-000000000005','95000000-0000-0000-0000-000000000001');
INSERT INTO public.products(id,sku,name,unit_price,harga_pokok,luar_kota,dalam_kota,depo_bangunan) VALUES
 ('95000000-0000-0000-0003-000000000001','SYNTH-CATEGORY-KNOWN','Synthetic distinct catalog prices',10,8,11,12,9),
 ('95000000-0000-0000-0003-000000000002','SYNTH-CATEGORY-UNKNOWN','Synthetic nullable catalog prices',NULL,NULL,NULL,NULL,NULL);
INSERT INTO public.promotions(id,product_id,start_date,end_date,harga_pokok,luar_kota,dalam_kota,depo_bangunan,created_by) VALUES
 ('95000000-0000-0000-0004-000000000001','95000000-0000-0000-0003-000000000001','2026-08-01','2026-08-31',0,4,5,3,'95000000-0000-0000-0000-000000000001');

-- Deterministic fictional history and request records. Normal hooks remain enabled.
SELECT set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000001',true);
INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number,status,order_date,notes) VALUES
 ('95000000-0000-0000-0005-000000000001','95000000-0000-0000-0001-000000000001','95000000-0000-0000-0000-000000000001','SYNTH-CATEGORY-HISTORY','confirm','2026-08-31','Historical manual price');
INSERT INTO public.po_line_items(id,purchase_order_id,product_name,sku,quantity,unit_price) VALUES
 ('95000000-0000-0000-0006-000000000001','95000000-0000-0000-0005-000000000001','Synthetic historical line','SYNTH-CATEGORY-KNOWN',4,42.25);
INSERT INTO public.surat_jalan(id,purchase_order_id,sj_number,sj_date,created_by) VALUES
 ('95000000-0000-0000-0007-000000000001','95000000-0000-0000-0005-000000000001','SYNTH-CATEGORY-DELIVERY','2026-09-01','95000000-0000-0000-0000-000000000001');
INSERT INTO public.sj_line_items(id,surat_jalan_id,po_line_item_id,quantity_delivered) VALUES
 ('95000000-0000-0000-0008-000000000001','95000000-0000-0000-0007-000000000001','95000000-0000-0000-0006-000000000001',2);
SET CONSTRAINTS ALL IMMEDIATE;
INSERT INTO private.pilot_order_requests(actor_id,request_id,operation,payload,result,created_at) VALUES
 ('95000000-0000-0000-0000-000000000001','95000000-0000-0000-0009-000000000001','create_po',
  '{"customer_id":"95000000-0000-0000-0001-000000000001","po_number":"SYNTH-CATEGORY-HISTORY","order_date":"2026-08-31","items":[{"product_name":"Synthetic historical line","sku":"SYNTH-CATEGORY-KNOWN","quantity":4,"unit_price":42.25}]}',
  '{"id":"95000000-0000-0000-0005-000000000001"}','2026-08-31T00:00:00Z');

DO $values$
DECLARE value text; i integer:=100; stored text; rejected_constraint text;
BEGIN
 IF EXISTS(SELECT 1 FROM public.customers WHERE id IN ('95000000-0000-0000-0001-000000000001','95000000-0000-0000-0001-000000000002') AND customer_category IS NOT NULL)
 THEN RAISE EXCEPTION 'Old-client omission or explicit null changed'; END IF;
 FOREACH value IN ARRAY ARRAY['supermarket_besar','supermarket_sedang','supermarket_kecil','tradisional_market','perorangan'] LOOP
  INSERT INTO public.customers(id,name,customer_category) VALUES
   (('95000000-0000-0000-0001-'||lpad(i::text,12,'0'))::uuid,'Synthetic accepted category '||i,value);
  SELECT customer_category INTO stored FROM public.customers WHERE id=('95000000-0000-0000-0001-'||lpad(i::text,12,'0'))::uuid;
  IF stored IS DISTINCT FROM value THEN RAISE EXCEPTION 'Category did not round-trip: %',value; END IF;
  i:=i+1;
 END LOOP;
 FOREACH value IN ARRAY ARRAY['',' ','unknown','others','Supermarket Besar','SUPERMARKET_BESAR','supermarket_besar ',' supermarket_besar'] LOOP
  BEGIN
   INSERT INTO public.customers(id,name,customer_category) VALUES('95000000-0000-0000-0001-000000000200','Synthetic rejected category',value);
   RAISE EXCEPTION 'Invalid insert category accepted: %',value;
  EXCEPTION WHEN check_violation THEN
   GET STACKED DIAGNOSTICS rejected_constraint=CONSTRAINT_NAME;
   IF rejected_constraint<>'customers_customer_category_check' THEN RAISE; END IF;
  END;
  BEGIN
   UPDATE public.customers SET customer_category=value WHERE id='95000000-0000-0000-0001-000000000001';
   RAISE EXCEPTION 'Invalid update category accepted: %',value;
  EXCEPTION WHEN check_violation THEN
   GET STACKED DIAGNOSTICS rejected_constraint=CONSTRAINT_NAME;
   IF rejected_constraint<>'customers_customer_category_check' THEN RAISE; END IF;
  END;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.customers WHERE id='95000000-0000-0000-0001-000000000200')
 OR (SELECT customer_category FROM public.customers WHERE id='95000000-0000-0000-0001-000000000001') IS NOT NULL
 THEN RAISE EXCEPTION 'Rejected category persisted'; END IF;
END $values$;
SELECT 'CUSTOMER_CATEGORIES_VALUES_VERIFIED' AS result;

-- Owner-only comparison, outside the role tests. This is never a definer bypass.
CREATE FUNCTION pg_temp.customer_categories_unchanged() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $snapshot$
 SELECT jsonb_build_object(
  'customers',(SELECT coalesce(jsonb_agg(to_jsonb(c)-'customer_category' ORDER BY c.id),'[]') FROM public.customers c),
  'products',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.products p),
  'promotions',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.promotions p),
  'purchase_orders',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.purchase_orders p),
  'po_line_items',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]') FROM public.po_line_items l),
  'surat_jalan',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.surat_jalan s),
  'sj_line_items',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]') FROM public.sj_line_items l),
  'po_audit_log',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM public.po_audit_log a),
  'requests',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.actor_id,r.request_id),'[]') FROM private.pilot_order_requests r),
  'users',(SELECT coalesce(jsonb_agg(to_jsonb(u) ORDER BY u.id),'[]') FROM public.users u),
  'auth_users',(SELECT coalesce(jsonb_agg(to_jsonb(u) ORDER BY u.id),'[]') FROM auth.users u),
  'manager_assignments',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM public.customer_manager_assignments a),
  'sales_assignments',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM public.customer_sales_rep_assignments a),
  'girard_orders',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]') FROM public.girard_orders o),
  'girard_items',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id),'[]') FROM public.girard_order_items i),
  'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM pg_catalog.pg_roles r),
  'relations',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity) ORDER BY c.oid)
   FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','auth') AND c.relkind='r'),
  'columns',(SELECT jsonb_agg(jsonb_build_array(a.attrelid,a.attnum,a.attacl) ORDER BY a.attrelid,a.attnum)
   FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ('public','private','auth') AND a.attnum>0 AND NOT a.attisdropped),
  'policies',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.oid),'[]') FROM pg_catalog.pg_policy p)
 )
$snapshot$;
CREATE TEMP TABLE customer_categories_history_before ON COMMIT DROP AS SELECT pg_temp.customer_categories_unchanged() AS baseline;

SET LOCAL row_security=on;
SET LOCAL ROLE authenticated;
DO $editors$
DECLARE i integer; changed bigint; category text; actor uuid;
 categories text[]:=ARRAY['supermarket_besar','supermarket_sedang','supermarket_kecil','tradisional_market','perorangan'];
BEGIN
 IF NOT row_security_active('public.customers') THEN RAISE EXCEPTION 'Genuine authenticated customer RLS required'; END IF;
 -- Executive, sales head, PO admin, assigned manager and assigned sales person.
 FOR i IN 1..5 LOOP
  actor:=('95000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid;
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  IF public.current_user_role() IS DISTINCT FROM (ARRAY['executive','sales_head','po_admin','sales_manager','sales_person'])[i]::public.user_role
  THEN RAISE EXCEPTION 'Expected real editor role missing: %',i; END IF;
  UPDATE public.customers SET customer_category=categories[i] WHERE id='95000000-0000-0000-0001-000000000001';
  GET DIAGNOSTICS changed=ROW_COUNT;
  SELECT customer_category INTO category FROM public.customers WHERE id='95000000-0000-0000-0001-000000000001';
  IF changed<>1 OR category IS DISTINCT FROM categories[i] THEN RAISE EXCEPTION 'Existing editor role could not save category: %',i; END IF;
 END LOOP;
 -- A legacy null remains editable through the same existing route.
 UPDATE public.customers SET customer_category=NULL WHERE id='95000000-0000-0000-0001-000000000001';
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'Legacy Unclassified edit was forced to choose'; END IF;
 UPDATE public.customers SET customer_category='perorangan' WHERE id='95000000-0000-0000-0001-000000000001';
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'Category restore was not confirmed'; END IF;
 PERFORM set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000006',true);
 IF EXISTS(SELECT 1 FROM public.customers WHERE id='95000000-0000-0000-0001-000000000001') THEN RAISE EXCEPTION 'Unassigned manager gained visibility'; END IF;
 UPDATE public.customers SET customer_category='supermarket_besar' WHERE id='95000000-0000-0000-0001-000000000001';
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>0 THEN RAISE EXCEPTION 'Unassigned manager edited category'; END IF;
END $editors$;
SET LOCAL row_security=off;
DO $filtered_read$
BEGIN
 BEGIN
  PERFORM id FROM public.customers WHERE id='95000000-0000-0000-0001-000000000001';
  RAISE EXCEPTION 'row_security=off accepted a filtered unassigned manager read';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $filtered_read$;
SET LOCAL row_security=on;
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','',true);
DO $anonymous$
BEGIN
 BEGIN
  PERFORM id FROM public.customers WHERE id='95000000-0000-0000-0001-000000000001';
  RAISE EXCEPTION 'Anonymous customer read succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.customers SET customer_category='supermarket_besar' WHERE id='95000000-0000-0000-0001-000000000001';
  RAISE EXCEPTION 'Anonymous customer edit succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $anonymous$;
RESET ROLE;
SET LOCAL row_security=off;
SELECT 'CUSTOMER_CATEGORIES_ROLES_VERIFIED' AS result;

DO $history$
DECLARE baseline jsonb;
BEGIN
 SELECT b.baseline INTO baseline FROM customer_categories_history_before b;
 IF pg_temp.customer_categories_unchanged() IS DISTINCT FROM baseline THEN RAISE EXCEPTION 'Category edit changed original fields, pricing, history, requests, roles or access metadata'; END IF;
 IF (SELECT customer_category FROM public.customers WHERE id='95000000-0000-0000-0001-000000000001') IS DISTINCT FROM 'perorangan'
 OR (SELECT customer_category FROM public.customers WHERE id='95000000-0000-0000-0001-000000000002') IS NOT NULL
 THEN RAISE EXCEPTION 'Final classified/Unclassified values incorrect'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.purchase_orders WHERE id='95000000-0000-0000-0005-000000000001' AND total_value=169)
 OR NOT EXISTS(SELECT 1 FROM public.po_line_items WHERE id='95000000-0000-0000-0006-000000000001' AND quantity=4 AND unit_price=42.25 AND line_total=169)
 OR NOT EXISTS(SELECT 1 FROM public.sj_line_items WHERE id='95000000-0000-0000-0008-000000000001' AND po_line_item_id='95000000-0000-0000-0006-000000000001' AND quantity_delivered=2)
 THEN RAISE EXCEPTION 'Independent historical identity/price/quantity/total controls failed'; END IF;
END $history$;
SELECT 'CUSTOMER_CATEGORIES_PRICING_HISTORY_VERIFIED' AS result;
ROLLBACK;
SELECT 'CUSTOMER_CATEGORIES_VERIFIED' AS result;
