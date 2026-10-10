-- Rollback-only final authority tests in the guarded normal PostgreSQL service.
\ir ../ihr/helpers.sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true);
SELECT pg_temp.assert_true(to_regprocedure('public.pilot_procurement_access_v1()') IS NOT NULL,'procurement capability RPC exists');
SELECT pg_temp.assert_true(row_security_active('public.customers'),'real customer RLS is active');
SELECT pg_temp.assert_true(public.pilot_procurement_access_v1()->>'customer_create'='false','CO customer create denied');
SELECT pg_temp.assert_true((SELECT count(*)>=2 FROM public.customers),'CO can select customers');
SELECT pg_temp.assert_true((SELECT count(*)>=2 FROM public.products),'CO can select products');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.customer_manager_assignments),'CO did not inherit customer assignments');
SELECT pg_temp.assert_denied('INSERT INTO public.customers(name,customer_category) VALUES(''CO forbidden'',''perorangan'')','42501');
SELECT pg_temp.assert_denied('INSERT INTO public.products(name,sku) VALUES(''CO forbidden'',''CO-FORBIDDEN'')','42501');
WITH changes AS (UPDATE public.customers SET name='forbidden' RETURNING id) SELECT pg_temp.assert_true(count(*)=0,'CO customer update no rows') FROM changes;
WITH changes AS (UPDATE public.products SET name='forbidden' RETURNING id) SELECT pg_temp.assert_true(count(*)=0,'CO product update no rows') FROM changes;
WITH changes AS (DELETE FROM public.products RETURNING id) SELECT pg_temp.assert_true(count(*)=0,'CO product delete no rows') FROM changes;
SELECT pg_temp.assert_denied('DELETE FROM public.customers','42501');
SELECT pg_temp.assert_denied('SELECT * FROM private.co_orders','42501');
SELECT pg_temp.assert_denied('SELECT * FROM private.co_commands','42501');
SELECT pg_temp.assert_denied('SELECT public.pilot_list_users()','42501');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.users),'CO safe directory stays self only');
SELECT pg_temp.assert_true(public.leave_context_v1()->'setup'->'blockers' @> '[{"code":"member_missing"}]','HR missing does not derive membership');
SELECT public.pilot_co_transaction_v1(md5('access-create-co')::uuid,'create_co',jsonb_build_object('customer_id',md5('co-customer-2')::uuid,'expected_customer_version','1','co_number','ACCESS-CO','order_date','2026-09-01','lines',jsonb_build_array(jsonb_build_object('id',md5('access-co-line')::uuid,'sku','ACCESS-CO-SKU','product_name','Freeform','ordered_quantity',2,'unit_price','1.00'))));
SELECT pg_temp.assert_true(public.pilot_co_page_v1('all','ACCESS-CO',1,20)->>'total'='1','CO works without HR setup');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
-- Historic own Sales rows exercise the generic actor-self path after role changes.
INSERT INTO public.girard_orders(customer_id,submitted_by) SELECT md5('co-customer-1')::uuid,md5('co-user-'||n)::uuid FROM unnest(ARRAY[1,3]) n;
INSERT INTO public.sales_targets(user_id,year_month,set_by) SELECT md5('co-user-'||n)::uuid,'2026-09',md5('co-user-2')::uuid FROM unnest(ARRAY[1,3]) n;
-- Retained legacy authority results, including an old generic tombstone.
SET LOCAL session_replication_role='replica';
INSERT INTO private.pilot_order_requests(actor_id,request_id,operation,payload,result,abandoned)
SELECT md5('co-user-'||n)::uuid,md5('access-old-'||op||n)::uuid,op,'{}',CASE WHEN op='recovery_abandoned' THEN NULL ELSE '{"id":"00000000-0000-4000-8000-000000000001"}'::jsonb END,op='recovery_abandoned'
FROM unnest(ARRAY[1,2,3]) n CROSS JOIN unnest(ARRAY['approve_sales','reject_sales','recovery_abandoned']) op;
SET LOCAL session_replication_role='origin';
CREATE TEMP TABLE denied_rpc(sql text);
INSERT INTO denied_rpc VALUES
('SELECT public.pilot_athel_summary_v1(current_date,current_date,current_date,''all'',''all'')'),
('SELECT public.pilot_athel_daily_v1(current_date,current_date,current_date,''all'',''all'',1,20)'),
('SELECT public.pilot_promotions_v1(false)'),('SELECT public.pilot_promotions_v1(true)'),
('SELECT public.pilot_promotion_image_v1(gen_random_uuid())'),
('SELECT public.pilot_promotion_transaction_v1(gen_random_uuid(),''set_active'',''{}'')'),
('SELECT public.pilot_reconcile_promotion_v1(gen_random_uuid(),false)'),
('SELECT public.pilot_reconcile_promotion_v1(gen_random_uuid(),true)'),
('SELECT public.pilot_sales_order_page_v1(''all'',false,1,20,NULL,NULL)'),
('SELECT public.pilot_customer_stats_v1(ARRAY[]::uuid[],current_date,3)'),
('SELECT public.pilot_revenue_v1(now(),now(),1,20)'),
('SELECT public.pilot_customer_performance_v1(NULL,''2026-09'',now(),now()+interval ''1 day'',1,20)'),
('SELECT public.pilot_sales_performance_v1(NULL,current_date,current_date,now(),now(),''2026-09'',1,20)'),
('SELECT public.pilot_sales_report_months_v1(NULL)'),
('SELECT public.pilot_team_activity_v1(ARRAY[]::uuid[],current_date,now(),now(),now())'),
('SELECT public.pilot_manager_customers_v1(gen_random_uuid(),now(),now(),1,20)'),
('SELECT public.pilot_store_po_context_v1(md5(''co-customer-1'')::uuid,1,20)'),
('SELECT * FROM private.pilot_admin_sales_source_v1(now(),now())'),
('SELECT * FROM private.pilot_canonical_sales_source_v1(now(),now())'),
('SELECT private.pilot_admin_sales_start_v1(NULL)'),
('SELECT private.pilot_performance_scope_v1(NULL,''2026-09'')'),
('SELECT public.pilot_sales_metrics_v2(NULL,''2026-09-01'',''2026-10-01'',''customer'',''all'',1,20)'),
('SELECT public.pilot_sales_metric_months_v2(NULL,''all'')');
GRANT SELECT ON denied_rpc TO authenticated,anon;
SET LOCAL ROLE authenticated;
DO $$ DECLARE n int; q text; op text; t text; visible bigint; BEGIN
 FOR n IN SELECT unnest(ARRAY[1,3]) LOOP
  PERFORM set_config('request.jwt.claim.sub',md5('co-user-'||n)::uuid::text,true);
  FOR q IN SELECT sql FROM denied_rpc LOOP PERFORM pg_temp.assert_denied(q,'42501'); END LOOP;
  FOREACH t IN ARRAY ARRAY['customer_manager_assignments','customer_sales_rep_assignments','customer_targets','sales_targets','sales_schedules','visit_requests','outlet_visits','visit_photos','girard_orders','girard_order_items','orders','order_line_items','outlets','promotions'] LOOP
   PERFORM pg_temp.assert_true(row_security_active(('public.'||t)::regclass),'non-bypass RLS on '||t);
   EXECUTE format('SELECT count(*) FROM public.%I',t) INTO visible;
   PERFORM pg_temp.assert_true(visible=0,'no standalone Sales reads from '||t);
   BEGIN
    EXECUTE format('WITH changed AS (UPDATE public.%I SET id=id RETURNING id) SELECT count(*) FROM changed',t) INTO visible;
    PERFORM pg_temp.assert_true(visible=0,'no standalone Sales updates on '||t);
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   BEGIN
    EXECUTE format('WITH changed AS (DELETE FROM public.%I RETURNING id) SELECT count(*) FROM changed',t) INTO visible;
    PERFORM pg_temp.assert_true(visible=0,'no standalone Sales deletes on '||t);
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  PERFORM pg_temp.assert_true((SELECT count(*)=0 FROM public.girard_orders),'admins cannot read historical own Sales');
  PERFORM pg_temp.assert_true((SELECT count(*)=0 FROM public.sales_targets),'admins cannot read historical own targets');
  PERFORM pg_temp.assert_true((SELECT count(*)=0 FROM public.promotions),'admins cannot directly read promotions');
  PERFORM pg_temp.assert_true((SELECT count(*)=0 FROM storage.objects WHERE bucket_id='promotion-images'),'admins cannot read raw promotion storage');
  PERFORM pg_temp.assert_denied('INSERT INTO public.promotions(product_id) VALUES(gen_random_uuid())','42501');
  PERFORM pg_temp.assert_true(NOT private.pilot_store_in_manager_scope_v1(md5('co-customer-1')::uuid,auth.uid()),'shared manager helper is not an admin grant');
  PERFORM pg_temp.assert_true(NOT private.demo_can_upload_promotion('promotions/'||auth.uid()||'/'||md5('access-promotion')::uuid||'/'||md5('access-image')::uuid||'.webp',auth.uid()::text),'admin upload helper false');
  PERFORM pg_temp.assert_denied(format('INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES(''promotion-images'',%L,%L,''{"size":128,"mimetype":"image/webp"}'')','promotions/'||auth.uid()||'/'||md5('access-promotion')::uuid||'/'||md5('access-image')::uuid||'.webp',auth.uid()::text),'42501');
  FOREACH op IN ARRAY ARRAY['approve_sales','reject_sales'] LOOP
   PERFORM pg_temp.assert_denied(format('SELECT public.pilot_order_transaction(%L,%L,''{}'')',md5('access-old-'||op||n)::uuid,op),'42501');
   PERFORM pg_temp.assert_denied(format('SELECT public.pilot_reconcile_request(%L,false)',md5('access-old-'||op||n)::uuid),'42501');
   PERFORM pg_temp.assert_denied(format('SELECT public.pilot_reconcile_request(%L,true)',md5('access-old-'||op||n)::uuid),'42501');
  END LOOP;
 END LOOP;
END $$;
SELECT set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true);
SELECT pg_temp.assert_denied('SELECT public.pilot_po_page_v1(''all'','''',1,20)','42501');
SELECT pg_temp.assert_denied('SELECT public.pilot_po_lines_v1(gen_random_uuid(),1,20,NULL)','42501');
SELECT pg_temp.assert_denied(format('SELECT public.pilot_reconcile_request(%L,false)',md5('access-old-recovery_abandoned1')::uuid),'42501');
SELECT pg_temp.assert_denied('SELECT public.pilot_reconcile_request(gen_random_uuid(),true)','42501');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.purchase_orders),'CO no raw PO');
-- PO actual master operations, without a customer-delete grant.
SELECT set_config('request.jwt.claim.sub',md5('co-user-3')::uuid::text,true);
SELECT pg_temp.assert_true(public.pilot_procurement_access_v1() @> '{"customer_create":true,"customer_edit":true,"customer_delete":false,"product_create":true,"product_edit":true,"product_delete":true}','PO actual capabilities');
INSERT INTO public.customers(id,name,customer_category) VALUES(md5('access-master-customer')::uuid,'Allowed customer','perorangan');
UPDATE public.customers SET name='Edited customer' WHERE id=md5('access-master-customer')::uuid;
SELECT pg_temp.assert_true((SELECT name='Edited customer' FROM public.customers WHERE id=md5('access-master-customer')::uuid),'PO customer edit succeeds');
INSERT INTO public.products(id,name,sku) VALUES(md5('access-master-product')::uuid,'Allowed product','ACCESS-MASTER');
UPDATE public.products SET name='Edited product' WHERE id=md5('access-master-product')::uuid;
DELETE FROM public.products WHERE id=md5('access-master-product')::uuid;
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.products WHERE id=md5('access-master-product')::uuid),'PO product delete succeeds');
SELECT pg_temp.assert_denied('DELETE FROM public.customers WHERE id=md5(''access-master-customer'')::uuid','42501');
SELECT pg_temp.assert_true((SELECT count(*)>1 FROM public.users),'PO safe directory for audit/credit preserved');
SELECT pg_temp.assert_denied('SELECT public.pilot_co_page_v1(''all'','''',1,20)','42501');
SELECT pg_temp.assert_denied('SELECT public.pilot_reconcile_co_v1(gen_random_uuid(),false)','42501');
-- Executive creates a campaign; PO can account for it internally without standalone reads.
SELECT set_config('request.jwt.claim.sub',md5('co-user-2')::uuid::text,true);
INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('promotion-images','promotions/'||auth.uid()||'/'||md5('access-promotion')::uuid||'/'||md5('access-image')::uuid||'.webp',auth.uid()::text,'{"size":128,"mimetype":"image/webp"}');
SELECT public.pilot_promotion_transaction_v1(md5('access-promo-create')::uuid,'create_promotion',jsonb_build_object('id',md5('access-promotion')::uuid,'product_id',md5('co-product-1')::uuid,'opening_quantity',10,'image_path','promotions/'||auth.uid()||'/'||md5('access-promotion')::uuid||'/'||md5('access-image')::uuid||'.webp','harga_pokok',0,'luar_kota',1,'dalam_kota',NULL,'depo_bangunan',NULL,'is_active',true));
SELECT pg_temp.assert_true(public.pilot_reconcile_promotion_v1(md5('access-promo-create')::uuid,false)->>'state'='committed','executive promotion recovery');
SELECT pg_temp.assert_true(public.pilot_promotion_image_v1(md5('access-promotion')::uuid)->>'expires_in'='300','executive canonical image');
SELECT pg_temp.assert_true(public.pilot_reconcile_request(md5('access-old-approve_sales2')::uuid,false)->>'state'='committed','executive retained legacy recovery');
SELECT pg_temp.assert_true(public.pilot_order_transaction(md5('access-old-reject_sales2')::uuid,'reject_sales','{}')->>'id' IS NOT NULL,'executive legacy replay');
SELECT set_config('request.jwt.claim.sub',md5('co-user-3')::uuid::text,true);
SELECT public.pilot_order_transaction(md5('access-po-create')::uuid,'create_po',jsonb_build_object('customer_id',md5('co-customer-1')::uuid,'po_number','ACCESS-PO','items',jsonb_build_array(jsonb_build_object('product_id',md5('co-product-1')::uuid,'sku','CAT-A','product_name','Catalog','quantity',4,'unit_price',2)))) receipt \gset
SELECT pg_temp.assert_true(public.pilot_reconcile_request(md5('access-po-create')::uuid,false)->'result'=:'receipt'::jsonb,'PO recovers allowed creation');
SELECT public.pilot_order_transaction(md5('access-po-edit')::uuid,'edit_po',jsonb_build_object('po_id',:'receipt'::jsonb->>'id','customer_id',md5('co-customer-1')::uuid,'expected_updated_at',:'receipt'::jsonb->>'updated_at','items',(SELECT jsonb_agg(jsonb_build_object('id',id,'product_id',product_id,'sku',sku,'product_name',product_name,'quantity',3,'unit_price',unit_price)) FROM public.po_line_items WHERE purchase_order_id=(:'receipt'::jsonb->>'id')::uuid))) edited \gset
SELECT public.pilot_order_transaction(md5('access-sj')::uuid,'save_delivery',jsonb_build_object('po_id',:'receipt'::jsonb->>'id','expected_updated_at',:'edited'::jsonb->>'updated_at','sj_number','ACCESS-SJ','sj_date',current_date,'lines',(SELECT jsonb_agg(jsonb_build_object('po_line_item_id',id,'quantity_delivered',1)) FROM public.po_line_items WHERE purchase_order_id=(:'receipt'::jsonb->>'id')::uuid))) delivered \gset
SELECT public.pilot_order_transaction(md5('access-sj-returned')::uuid,'edit_sj_returned_date',jsonb_build_object('sj_id',:'delivered'::jsonb->>'id','expected_updated_at',:'delivered'::jsonb->>'updated_at','sj_date_returned',current_date)) returned \gset
SELECT public.pilot_order_transaction(md5('access-sj-void')::uuid,'void_delivery',jsonb_build_object('sj_id',:'delivered'::jsonb->>'id','expected_updated_at',:'returned'::jsonb->>'updated_at','reason','Synthetic void')) voided \gset
SELECT public.pilot_order_transaction(md5('access-po-cancel')::uuid,'cancel_po',jsonb_build_object('po_id',:'receipt'::jsonb->>'id','expected_updated_at',:'voided'::jsonb->>'updated_at','reason','Synthetic cancel')) cancelled \gset
SELECT pg_temp.assert_true(public.pilot_reconcile_request(md5('access-po-cancel')::uuid,false)->'result'=:'cancelled'::jsonb,'PO cancellation recovery remains');
SELECT set_config('request.jwt.claim.sub',md5('co-user-2')::uuid::text,true);
SELECT pg_temp.assert_true((SELECT (x->>'remaining_quantity')::int=10 FROM jsonb_array_elements(public.pilot_promotions_v1(true)->'items') x WHERE x->>'id'=md5('access-promotion')::uuid::text),'internal PO allocation/release conserves promotion stock');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO auth.users(id) SELECT md5('access-sales-'||r)::uuid FROM unnest(ARRAY['sales_person','sales_manager','sales_head']) r;
INSERT INTO public.users(id,full_name,email,role) SELECT md5('access-sales-'||r)::uuid,r,r||'@access.invalid',r::public.user_role FROM unnest(ARRAY['sales_person','sales_manager','sales_head']) r;
SET LOCAL ROLE authenticated;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['sales_person','sales_manager','sales_head','executive'] LOOP
  PERFORM set_config('request.jwt.claim.sub',CASE WHEN r='executive' THEN md5('co-user-2')::uuid::text ELSE md5('access-sales-'||r)::uuid::text END,true);
  PERFORM pg_temp.assert_true(jsonb_array_length(public.pilot_promotions_v1(false)->'items')=1,'P1 audience retains active highlights: '||r);
  PERFORM pg_temp.assert_true(public.pilot_promotion_image_v1(md5('access-promotion')::uuid)->>'expires_in'='300','P1 canonical private image: '||r);
  IF r<>'executive' THEN
   PERFORM pg_temp.assert_denied('SELECT public.pilot_promotions_v1(true)','42501');
   PERFORM pg_temp.assert_denied('SELECT public.pilot_promotion_transaction_v1(gen_random_uuid(),''set_active'',''{}'')','42501');
  END IF;
 END LOOP;
END $$;
SELECT set_config('request.jwt.claim.sub',md5('co-user-4')::uuid::text,true);
SELECT pg_temp.assert_denied('SELECT public.pilot_procurement_access_v1()','42501');
DO $$ DECLARE q text; BEGIN FOR q IN SELECT sql FROM denied_rpc LOOP PERFORM pg_temp.assert_denied(q,'42501'); END LOOP; END $$;
SELECT pg_temp.assert_denied('SELECT public.pilot_order_transaction(gen_random_uuid(),''create_po'',''{}'')','42501');
SELECT pg_temp.assert_denied('SELECT public.pilot_reconcile_request(gen_random_uuid(),false)','42501');
SELECT pg_temp.assert_denied('INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES(''promotion-images'',''forbidden'',auth.uid()::text)','42501');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM storage.objects WHERE bucket_id='promotion-images'),'inactive raw promotion storage denied');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.products),'inactive catalog denied');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT pg_temp.assert_denied('SELECT public.pilot_procurement_access_v1()','42501');
SET LOCAL ROLE anon;
DO $$ DECLARE q text; BEGIN FOR q IN SELECT sql FROM denied_rpc LOOP PERFORM pg_temp.assert_denied(q,'42501'); END LOOP; END $$;
SELECT pg_temp.assert_denied('SELECT public.pilot_order_transaction(gen_random_uuid(),''create_po'',''{}'')','42501');
SELECT pg_temp.assert_denied('SELECT public.pilot_reconcile_request(gen_random_uuid(),true)','42501');
SELECT pg_temp.assert_denied('INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES(''promotion-images'',''forbidden'',''anonymous'')','42501');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM storage.objects),'anonymous raw storage denied by RLS');
SELECT pg_temp.assert_denied('SELECT public.pilot_procurement_access_v1()','42501');
SELECT pg_temp.assert_denied('SELECT public.pilot_promotions_v1(false)','42501');
SELECT pg_temp.assert_denied('SELECT * FROM public.customers','42501');
RESET ROLE;
SELECT 'CO_ACCESS_FUNCTION_METADATA|'||jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'security',CASE WHEN p.prosecdef THEN 'definer' ELSE 'invoker' END,'volatility',p.provolatile,'config',p.proconfig,'acl',p.proacl) ORDER BY p.oid::regprocedure::text)::text
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
WHERE n.nspname IN ('public','private') AND p.proname IN ('pilot_procurement_access_v1','pilot_can_read_po','pilot_store_in_manager_scope_v1','demo_can_upload_promotion','pilot_athel_summary_v1','pilot_athel_daily_v1','pilot_promotions_v1','pilot_promotion_image_v1','pilot_promotion_transaction_v1','pilot_reconcile_promotion_v1','pilot_sales_order_page_v1','pilot_customer_stats_v1','pilot_revenue_v1','pilot_customer_performance_v1','pilot_sales_performance_v1','pilot_sales_report_months_v1','pilot_team_activity_v1','pilot_manager_customers_v1','pilot_store_po_context_v1','pilot_admin_sales_source_v1','pilot_canonical_sales_source_v1','pilot_admin_sales_start_v1','pilot_performance_scope_v1','pilot_po_page_v1','pilot_po_lines_v1','pilot_order_transaction','pilot_reconcile_request');
ROLLBACK;
SELECT 'CO_ACCESS_BOUNDARIES_PASSED';
