-- Disposable synthetic fixture only. Requires a normal PostgreSQL backend with effective RLS.
-- This suite never writes business records outside its rollback transaction.
BEGIN;
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF current_database()<>'pilot_test' OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') THEN
  RAISE EXCEPTION 'Disposable pilot_test marker required';
 END IF;
END $$;
CREATE FUNCTION pg_temp.assert_true(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%',message; END IF; END $$;
CREATE FUNCTION pg_temp.expect_error(statement text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected THEN RETURN; ELSE RAISE; END IF; END;
 RAISE EXCEPTION 'Expected SQLSTATE %, statement succeeded',expected;
END $$;
-- Fixture setup is privileged and synthetic; replica mode avoids unrelated audit/transaction triggers.
SET LOCAL session_replication_role='replica';
INSERT INTO auth.users(id) SELECT ('81000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid FROM generate_series(1,8) i;
INSERT INTO public.users(id,full_name,email,role,is_active,manager_id)
SELECT ('81000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'Synthetic read user '||i,'scale-read-'||i||'@example.invalid',
 (CASE i WHEN 1 THEN 'executive' WHEN 2 THEN 'sales_manager' WHEN 3 THEN 'sales_manager' WHEN 4 THEN 'sales_person' WHEN 5 THEN 'sales_person' WHEN 6 THEN 'po_admin' WHEN 7 THEN 'sales_head' ELSE 'executive' END)::public.user_role,
 i<>8,CASE i WHEN 4 THEN '81000000-0000-0000-0000-000000000002'::uuid WHEN 5 THEN '81000000-0000-0000-0000-000000000003'::uuid END
FROM generate_series(1,8) i;
INSERT INTO public.customers(id,name)
SELECT md5('scale-read-customer-'||i)::uuid,CASE WHEN i<=101 THEN 'Literal 100%_, quote'' slash\\ '||i ELSE 'Hidden different team' END FROM generate_series(1,102) i;
INSERT INTO public.customer_manager_assignments(customer_id,manager_id,assigned_by)
SELECT md5('scale-read-customer-'||i)::uuid,CASE WHEN i<=101 THEN '81000000-0000-0000-0000-000000000002'::uuid ELSE '81000000-0000-0000-0000-000000000003'::uuid END,'81000000-0000-0000-0000-000000000001' FROM generate_series(1,102) i;
INSERT INTO public.customer_sales_rep_assignments(customer_id,sales_rep_id,assigned_by)
VALUES(md5('scale-read-customer-1')::uuid,'81000000-0000-0000-0000-000000000004','81000000-0000-0000-0000-000000000001'),
 (md5('scale-read-customer-102')::uuid,'81000000-0000-0000-0000-000000000005','81000000-0000-0000-0000-000000000001');
INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number,status,order_date,total_value,created_at,updated_at)
SELECT md5('scale-read-po-'||i)::uuid,md5('scale-read-customer-'||i)::uuid,'81000000-0000-0000-0000-000000000006','SYNTHETIC-READ-'||i,'in_progress','2026-09-01',100,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z' FROM generate_series(1,102) i;
INSERT INTO public.girard_orders(id,customer_id,submitted_by,status,po_id,total_value,created_at)
SELECT md5('scale-read-sales-'||i)::uuid,md5('scale-read-customer-'||i)::uuid,CASE WHEN i<=101 THEN '81000000-0000-0000-0000-000000000004'::uuid ELSE '81000000-0000-0000-0000-000000000005'::uuid END,'approved',md5('scale-read-po-'||i)::uuid,100,'2026-09-01T00:00:00Z' FROM generate_series(1,102) i;
INSERT INTO public.po_line_items(id,purchase_order_id,product_name,sku,quantity,unit_price)
SELECT md5('scale-read-line-'||i)::uuid,md5('scale-read-po-'||i)::uuid,'Synthetic item','TEST',10,10 FROM generate_series(1,102) i;
INSERT INTO public.surat_jalan(id,purchase_order_id,sj_number,sj_date,created_by,voided_at,voided_by,void_reason)
SELECT md5('scale-read-sj-'||n)::uuid,md5('scale-read-po-1')::uuid,'Literal 100%_, quote'' slash\\ '||n,'2026-09-02','81000000-0000-0000-0000-000000000006',CASE WHEN n=3 THEN '2026-09-03T00:00:00Z'::timestamptz END,CASE WHEN n=3 THEN '81000000-0000-0000-0000-000000000006'::uuid END,CASE WHEN n=3 THEN 'Synthetic void' END FROM generate_series(1,3) n;
INSERT INTO public.sj_line_items(surat_jalan_id,po_line_item_id,quantity_delivered)
SELECT md5('scale-read-sj-'||n)::uuid,md5('scale-read-line-1')::uuid,CASE n WHEN 1 THEN 2 WHEN 2 THEN 3 ELSE 4 END FROM generate_series(1,3) n;
INSERT INTO public.surat_jalan(purchase_order_id,sj_number,sj_date,created_by)
SELECT md5('scale-read-po-'||i)::uuid,'SJ-only %_, match','2026-09-03','81000000-0000-0000-0000-000000000006' FROM generate_series(1,101) i;
UPDATE public.purchase_orders SET status='delayed' WHERE id=md5('scale-read-po-102')::uuid;
SET LOCAL session_replication_role='origin';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(row_security_active('public.purchase_orders'),'Normal PostgreSQL RLS enforcement is required');
-- These calls intentionally fail with undefined_function before migration 202610010001.
SELECT pg_temp.assert_true((public.pilot_po_page_v1('all','',1,10)->>'total')::integer=102,'Complete authorized PO count');
SELECT pg_temp.assert_true(jsonb_array_length(public.pilot_po_page_v1('all','',1,10)->'items')=10,'Default-size page is bounded');
SELECT pg_temp.assert_true((public.pilot_po_page_v1('all','100%_,',1,100)->>'total')::integer=101,'Literal punctuation customer search crosses 100 matches');
SELECT pg_temp.assert_true((public.pilot_po_page_v1('all','SJ-only %_,',1,100)->>'total')::integer=101,'SJ EXISTS search crosses 100 matches without fanout');
SELECT pg_temp.assert_true((public.pilot_po_page_v1('all','quote',1,100)->>'total')::integer=101,'Multiple matching headers do not duplicate a parent');
SELECT pg_temp.assert_true((public.pilot_po_page_v1('all','absent synthetic phrase',1,10)->>'total')::integer=0,'No-match is exact empty');
SELECT pg_temp.assert_true(jsonb_array_length(public.pilot_po_page_v1('all','',99,10)->'items')=0 AND (public.pilot_po_page_v1('all','',99,10)->>'total')::integer=102,'Out-of-range page keeps true total');
SELECT pg_temp.assert_true(public.pilot_po_page_v1('all','',1,10)->'items'->0->>'id'=(SELECT id::text FROM public.purchase_orders ORDER BY created_at DESC,id DESC LIMIT 1),'Timestamp ties use deterministic ID order');
SELECT pg_temp.assert_true(jsonb_typeof(public.pilot_po_page_v1('all','',1,10)->'items'->0->'total_value')='string','Money serialized as decimal text');
SELECT pg_temp.assert_true(public.pilot_po_page_v1('all','SYNTHETIC-READ-102',1,10)->'items'->0->>'status'='delayed','All-status output preserves legacy enum');
SELECT pg_temp.expect_error($q$SELECT public.pilot_po_page_v1('all','',0,10)$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT public.pilot_po_page_v1('all','',1,101)$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT public.pilot_po_page_v1('delayed','',1,10)$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT public.pilot_po_page_v1('all',NULL,1,10)$q$,'22023');
SELECT pg_temp.assert_true((public.pilot_sales_order_page_v1('approved',false,1,10)->'status_counts'->>'approved')::integer=102,'Sales counts cover whole filtered set');
SELECT pg_temp.assert_true((public.pilot_sales_order_page_v1('rejected',false,1,10)->'status_counts'->>'approved')::integer=0,'Selected-status scope retained for pills');
SELECT pg_temp.assert_true((public.pilot_po_lines_v1(md5('scale-read-po-1')::uuid,1,10)->'items'->0->>'delivered_quantity')::integer=5,'Active delivery quantities preaggregated excluding void');
SELECT pg_temp.assert_true((public.pilot_po_lines_v1(md5('scale-read-po-1')::uuid,1,10)->'items'->0->>'has_delivery_history')::boolean,'Historical line flag retained');
SELECT pg_temp.assert_true((public.pilot_po_lines_v1(md5('scale-read-po-1')::uuid,1,10)->>'po_has_delivery_history')::boolean,'Header history flag retained');
SELECT pg_temp.expect_error($q$SELECT public.pilot_po_lines_v1(md5('scale-read-po-1')::uuid,1,10,'2020-01-01T00:00:00Z')$q$,'PT409');
SELECT pg_temp.expect_error($q$SELECT public.pilot_po_lines_v1(md5('scale-read-po-1')::uuid,2,10)$q$,'22023');
SELECT pg_temp.assert_true(jsonb_array_length(public.pilot_po_lines_v1(md5('scale-read-po-1')::uuid,2,10,'2026-09-01T00:00:00Z')->'items')=0,'Later page accepts consistent version');
-- Real role scope, with hidden customer metadata retained as null on historical actor-visible orders.
SELECT set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true((public.pilot_po_page_v1('all','',1,100)->>'total')::integer=101,'Sales actor sees own historical linked POs only');
SELECT pg_temp.assert_true(public.pilot_po_page_v1('all','SYNTHETIC-READ-2',1,100)->'items'->0->'customers'='null'::jsonb,'Hidden related customer never removes an authorized parent');
SELECT pg_temp.assert_true((public.pilot_po_page_v1('all','Hidden different team',1,10)->>'total')::integer=0,'Search never leaks hidden team');
SELECT pg_temp.assert_true((public.pilot_sales_order_page_v1('all',true,1,10)->>'total')::integer=101,'Own-only narrows actor rows');
SELECT pg_temp.expect_error($q$SELECT public.pilot_po_lines_v1(md5('scale-read-po-102')::uuid,1,10)$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT public.pilot_po_lines_v1(md5('no-such-po')::uuid,1,10)$q$,'22023');
SELECT set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert_true((public.pilot_po_page_v1('all','',1,10)->>'total')::integer=101,'Manager sees own team only');
SELECT pg_temp.assert_true((public.pilot_sales_order_page_v1('all',true,1,10)->>'total')::integer=0,'Manager own-only does not include subordinates');
SELECT set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_true((public.pilot_po_page_v1('all','',1,10)->>'total')::integer=1,'Other salesperson only sees other team record');
SELECT set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000006',true);
SELECT pg_temp.assert_true((public.pilot_po_page_v1('all','',1,10)->>'total')::integer=102,'PO admin retains operational order scope');
SELECT set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000007',true);
SELECT pg_temp.assert_true((public.pilot_po_page_v1('all','',1,10)->>'total')::integer=102,'Head retains full visible order scope');
SELECT set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000008',true);
SELECT pg_temp.expect_error($q$SELECT public.pilot_po_page_v1('all','',1,10)$q$,'42501');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT pg_temp.expect_error($q$SELECT public.pilot_sales_order_page_v1('all',false,1,10)$q$,'42501');
SELECT set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true(public.pilot_sales_order_page_v1('all',false,1,100,md5('scale-read-customer-2')::uuid)->'items'->0->'customers'='null'::jsonb,'Sales parent survives hidden customer label');
SELECT pg_temp.assert_true(jsonb_array_length(public.pilot_po_page_v1('all','',1,1)->'items')=1 AND jsonb_array_length(public.pilot_po_page_v1('all','',1,100)->'items')=100,'Accepted size boundaries');
SELECT pg_temp.expect_error($q$SELECT public.pilot_po_page_v1('all','',NULL,10)$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT public.pilot_po_page_v1('all','',1,NULL)$q$,'22023');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=3 AND bool_and(NOT prosecdef AND provolatile='s' AND 'search_path=""'=ANY(proconfig) AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('pilot_po_page_v1','pilot_sales_order_page_v1','pilot_po_lines_v1')),'Read functions are invoker/stable with empty search path');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.pilot_po_page_v1(text,text,integer,integer)','EXECUTE'),'Anonymous execute revoked');
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error($q$SELECT public.pilot_po_page_v1('all','',1,10)$q$,'42501');
RESET ROLE;
SELECT 'SCALABLE_ORDER_READS_VERIFIED' AS result;
ROLLBACK;
