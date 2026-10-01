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
INSERT INTO public.customers(id,name,visit_frequency_days,last_visit_date) VALUES
 ('82000000-0000-0000-0000-000000000001','Synthetic customer A',7,'2026-09-01'),
 ('82000000-0000-0000-0000-000000000002','Synthetic customer B',7,NULL);
INSERT INTO public.customer_manager_assignments(customer_id,manager_id,assigned_by) VALUES
 ('82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000002','81000000-0000-0000-0000-000000000001'),
 ('82000000-0000-0000-0000-000000000002','81000000-0000-0000-0000-000000000003','81000000-0000-0000-0000-000000000001');
INSERT INTO public.customer_sales_rep_assignments(customer_id,sales_rep_id,assigned_by) VALUES
 ('82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000004','81000000-0000-0000-0000-000000000001'),
 ('82000000-0000-0000-0000-000000000002','81000000-0000-0000-0000-000000000005','81000000-0000-0000-0000-000000000001');
INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number,status,order_date,total_value,created_at,updated_at)
SELECT md5('report-po-'||i)::uuid,'82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000006','SYNTHETIC-REPORT-'||i,'in_progress',CASE WHEN i<=999 THEN '2026-07-01'::date WHEN i=1000 THEN '2026-08-01'::date ELSE '2026-09-01'::date END,100,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z' FROM generate_series(1,1001) i;
INSERT INTO public.girard_orders(id,customer_id,submitted_by,status,po_id,total_value,created_at)
SELECT md5('report-sales-'||i)::uuid,'82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000004','approved',md5('report-po-'||i)::uuid,100,'2026-09-01T00:00:00Z' FROM generate_series(1,1001) i;
INSERT INTO public.po_line_items(id,purchase_order_id,product_name,sku,quantity,unit_price)
SELECT md5('report-line-'||i)::uuid,md5('report-po-'||i)::uuid,'Synthetic item',CASE WHEN i=1 THEN 'MIXED' ELSE 'ORDINARY' END,10,10 FROM generate_series(1,1001) i;
INSERT INTO public.po_line_items(id,purchase_order_id,product_name,sku,quantity,unit_price) VALUES(md5('report-free-line')::uuid,md5('report-po-1')::uuid,'Synthetic gift','MIXED',7,0);
INSERT INTO public.surat_jalan(id,purchase_order_id,sj_number,sj_date,created_by)
SELECT md5('report-sj-'||i||'-'||n)::uuid,md5('report-po-'||i)::uuid,'SYNTHETIC-SJ-'||n,'2026-09-02','81000000-0000-0000-0000-000000000006' FROM generate_series(1,1001) i CROSS JOIN generate_series(1,2) n;
INSERT INTO public.sj_line_items(surat_jalan_id,po_line_item_id,quantity_delivered)
SELECT md5('report-sj-'||i||'-'||n)::uuid,md5('report-line-'||i)::uuid,CASE n WHEN 1 THEN 2 ELSE 3 END FROM generate_series(1,1001) i CROSS JOIN generate_series(1,2) n;
INSERT INTO public.surat_jalan(id,purchase_order_id,sj_number,sj_date,created_by,voided_at,voided_by,void_reason)
VALUES(md5('report-void-sj')::uuid,md5('report-po-1')::uuid,'VOIDED-SYNTHETIC','2026-09-02','81000000-0000-0000-0000-000000000006','2026-09-03','81000000-0000-0000-0000-000000000006','Synthetic cancellation');
INSERT INTO public.sj_line_items(surat_jalan_id,po_line_item_id,quantity_delivered) VALUES(md5('report-void-sj')::uuid,md5('report-line-1')::uuid,4);
-- Other team data must not contribute to the first manager's summaries.
INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number,status,order_date,total_value)
VALUES(md5('report-other-po')::uuid,'82000000-0000-0000-0000-000000000002','81000000-0000-0000-0000-000000000006','SYNTHETIC-OTHER','confirm','2026-09-01',777);
INSERT INTO public.girard_orders(customer_id,submitted_by,status,po_id,total_value,created_at)
VALUES('82000000-0000-0000-0000-000000000002','81000000-0000-0000-0000-000000000005','approved',md5('report-other-po')::uuid,777,'2026-09-01');
-- Three non-approved states remain included only in the submitted-order performance metric.
INSERT INTO public.girard_orders(customer_id,submitted_by,status,total_value,created_at)
SELECT '82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000004',status,value,'2026-09-01' FROM (VALUES('pending',11),('rejected',13),('cancelled',17)) t(status,value);
INSERT INTO public.customer_targets(customer_id,year_month,target_value,set_by) VALUES
 ('82000000-0000-0000-0000-000000000001','2026-07',100,'81000000-0000-0000-0000-000000000001'),
 ('82000000-0000-0000-0000-000000000001','2026-08',200,'81000000-0000-0000-0000-000000000001'),
 ('82000000-0000-0000-0000-000000000001','2026-10',999,'81000000-0000-0000-0000-000000000001');
INSERT INTO public.sales_targets(user_id,year_month,target_value,set_by) VALUES
 ('81000000-0000-0000-0000-000000000004','2026-07',100,'81000000-0000-0000-0000-000000000001'),
 ('81000000-0000-0000-0000-000000000004','2026-08',300,'81000000-0000-0000-0000-000000000001'),
 ('81000000-0000-0000-0000-000000000004','2026-10',999,'81000000-0000-0000-0000-000000000001');
INSERT INTO public.sales_schedules(id,outlet_id,sales_person_id,assigned_by,scheduled_date,status)
SELECT md5('report-schedule-'||i)::uuid,'82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000004','81000000-0000-0000-0000-000000000002','2026-09-01'::date+i-1,CASE WHEN i=3 THEN 'missed'::public.schedule_status ELSE 'pending'::public.schedule_status END FROM generate_series(1,3) i;
-- Repeated customer visits: first two are within September and the latest is October.
INSERT INTO public.outlet_visits(id,outlet_id,sales_person_id,schedule_id,checked_in_at)
SELECT md5('report-visit-'||i)::uuid,'82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000004',CASE WHEN i<=2 THEN md5('report-schedule-'||i)::uuid END,CASE i WHEN 1 THEN '2026-09-01T00:00:00Z'::timestamptz WHEN 2 THEN '2026-09-30T23:59:59.999Z'::timestamptz ELSE '2026-10-01T00:00:00Z'::timestamptz END FROM generate_series(1,3) i;
SET LOCAL session_replication_role='origin';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert_true(row_security_active('public.purchase_orders'),'Normal PostgreSQL RLS enforcement required');
-- These assertions require additive report migration; undefined_function is the pre-migration red state.
DO $$ DECLARE r jsonb; n integer; expected integer; cutoff date; BEGIN
 FOR n IN 1..3 LOOP
  cutoff:=CASE n WHEN 1 THEN '2026-07-31'::date WHEN 2 THEN '2026-08-31'::date ELSE '2026-09-30'::date END; expected:=998+n;
  r:=public.pilot_athel_summary_v1('2026-07-01',cutoff,'2026-07-01','all','all');
  PERFORM pg_temp.assert_true((r->'metrics'->>'totalPOCount')::integer=expected,'PO cap boundary exact count '||expected);
  PERFORM pg_temp.assert_true((r->'metrics'->>'totalPOValue')::numeric=expected*100,'PO values unaffected by delivery join fanout');
 END LOOP;
 r:=public.pilot_athel_summary_v1('2026-09-01','2026-09-30','2026-07-01','all','partial');
 PERFORM pg_temp.assert_true((r->'metrics'->>'totalPOCount')::integer=1,'KPI selected month differs from wider fetch window');
 PERFORM pg_temp.assert_true((r->'metrics'->>'deliveredValue')::numeric=50,'Selected cohort delivery value');
 PERFORM pg_temp.assert_true((SELECT (x->>'poValue')::numeric=0 FROM jsonb_array_elements(r->'monthlySeries') x WHERE x->>'key'='2026-07'),'Monthly PO preserves selected cohort asymmetry');
 PERFORM pg_temp.assert_true((SELECT (x->>'deliveredValue')::numeric=50050 FROM jsonb_array_elements(r->'monthlySeries') x WHERE x->>'key'='2026-09'),'Monthly delivery spans base cohort older POs');
 PERFORM pg_temp.assert_true((SELECT (x->>'outstandingQty')::integer=12 AND (x->>'outstandingValue')::numeric=50 FROM jsonb_array_elements(r->'outstandingItems') x WHERE x->>'sku'='MIXED'),'Zero-price lines contribute to mixed-value grouping quantities');
 PERFORM pg_temp.assert_true(jsonb_array_length(r->'monthlySeries')=12 AND jsonb_array_length(r->'topCustomers')<=10 AND jsonb_array_length(r->'outstandingItems')<=10,'Report arrays remain bounded');
 r:=public.pilot_athel_daily_v1('2026-09-01','2026-09-30','2026-07-01','all','undelivered',1,2);
 PERFORM pg_temp.assert_true((r->>'total')::integer=30 AND jsonb_array_length(r->'items')=2,'Daily exact buckets independently paged');
 PERFORM pg_temp.assert_true((r->'items'->1->>'deliveredValue')::numeric=50050 AND (r->'items'->1->>'sjCount')::integer=2002,'Daily delivery ignores fulfillment but excludes voided headers');
 r:=public.pilot_customer_stats_v1(ARRAY['82000000-0000-0000-0000-000000000001'::uuid],'2026-07-01',3);
 PERFORM pg_temp.assert_true((r->'items'->0->>'order_count')::integer=1001 AND (r->'items'->0->>'total_sales')::numeric=50050,'Stats complete past cap');
 PERFORM pg_temp.assert_true((r->'items'->0->'top_items'->0->>'revenue')::numeric=100100,'Top items use ordered all-time revenue');
 r:=public.pilot_customer_performance_v1(auth.uid(),'2026-09','2026-09-01T00:00:00Z','2026-10-01T00:00:00Z',1,1);
 PERFORM pg_temp.assert_true((r->'items'->0->>'order_count')::integer=1 AND (r->'items'->0->>'total_sales')::numeric=50050,'Customer performance counts current orders plus old-order shipments');
 PERFORM pg_temp.assert_true((r->'items'->0->>'actual_visits')::integer=2 AND (r->'items'->0->>'sales_target')::numeric=200,'Exclusive visit end and latest-effective target preserved');
 PERFORM pg_temp.assert_true((r->'items'->0->>'last_visit_date')::timestamptz='2026-10-01T00:00:00Z','Latest visit may be beyond selected month');
 PERFORM pg_temp.assert_true((r->'summary'->>'visit_percent')::integer=40 AND (r->'summary'->>'active_customers')::integer=1,'Full customer summary ratios and active predicate');
 r:=public.pilot_sales_performance_v1(auth.uid(),'2026-09-01','2026-09-30','2026-09-01T00:00:00Z','2026-09-30T23:59:59Z','2026-09',1,1);
 PERFORM pg_temp.assert_true((r->>'total')::integer=2 AND (r->'summary'->>'total_sales')::numeric=100141,'Sales full totals include all statuses beyond visible page');
 PERFORM pg_temp.assert_true((r->'summary'->>'average_visit_rate')::integer=34,'Rounded mean of rounded member rates: zero and 67');
 r:=public.pilot_revenue_v1('2026-09-01T00:00:00Z','2026-09-30T23:59:59Z',1,1);
 PERFORM pg_temp.assert_true((r->'summary'->>'total_sales')::numeric=100100 AND (r->'summary'->>'total_orders')::integer=1001,'Revenue approved-only full totals');
 r:=public.pilot_team_activity_v1(ARRAY['81000000-0000-0000-0000-000000000004'::uuid],'2026-09-01','2026-09-01T00:00:00Z','2026-09-01T23:59:59Z','2026-09-01T00:00:00Z');
 PERFORM pg_temp.assert_true((r->'items'->0->>'total_visited')::integer=1 AND (r->'items'->0->>'weekly_visits')::integer=3,'Activity keeps schedule-exists and lower-only weekly window');
 r:=public.pilot_manager_customers_v1(auth.uid(),'2026-09-01T00:00:00Z','2026-09-30T00:00:00Z',1,1);
 PERFORM pg_temp.assert_true((r->'items'->0->>'visits_this_period')::integer=3 AND (r->'summary'->>'overdue')::integer=1,'Manager window retains lower-only future visits and independent overdue flag');
END $$;
SELECT pg_temp.expect_error($q$SELECT public.pilot_customer_performance_v1(NULL,'2026-09','2026-09-01T00:00:00Z','2026-10-01T00:00:00Z',1,10)$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.pilot_customer_performance_v1('81000000-0000-0000-0000-000000000003','2026-09','2026-09-01T00:00:00Z','2026-10-01T00:00:00Z',1,10)$q$,'42501');
SELECT pg_temp.assert_true((public.pilot_manager_customers_v1('81000000-0000-0000-0000-000000000003','2026-09-01T00:00:00Z','2026-09-30T00:00:00Z',1,10)->>'total')::integer=0,'Manager ID cannot broaden RLS customer scope');
SELECT set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true((public.pilot_revenue_v1('2026-09-01T00:00:00Z','2026-09-30T23:59:59Z',1,1)->'summary'->>'total_sales')::numeric=100877,'Executive summary includes authorized other team despite one-row page');
SELECT pg_temp.assert_true((public.pilot_customer_performance_v1(NULL,'2026-09','2026-09-01T00:00:00Z','2026-10-01T00:00:00Z',1,1)->>'total')::integer=2,'Executive null manager scope includes all visible customers');
SELECT pg_temp.expect_error($q$SELECT public.pilot_customer_performance_v1('81000000-0000-0000-0000-000000000001','2026-09','2026-09-01T00:00:00Z','2026-10-01T00:00:00Z',1,10)$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.pilot_athel_daily_v1('2026-09-01','2026-09-30','2026-07-01','all','all',1,367)$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT public.pilot_customer_stats_v1(ARRAY(SELECT gen_random_uuid() FROM generate_series(1,101)),'2026-09-01',3)$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT public.pilot_revenue_v1('2026-10-01T00:00:00Z','2026-09-01T00:00:00Z',1,10)$q$,'22023');
SELECT set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000008',true);
SELECT pg_temp.expect_error($q$SELECT public.pilot_athel_summary_v1('2026-09-01','2026-09-30','2026-07-01','all','all')$q$,'42501');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=8 AND bool_and(NOT prosecdef AND provolatile='s' AND 'search_path=""'=ANY(proconfig) AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('pilot_athel_summary_v1','pilot_athel_daily_v1','pilot_customer_stats_v1','pilot_customer_performance_v1','pilot_revenue_v1','pilot_sales_performance_v1','pilot_team_activity_v1','pilot_manager_customers_v1')),'All report functions are restricted stable invokers');
-- Independent parent-small/child-large boundaries: each customer has one PO.
SET LOCAL session_replication_role='replica';
DO $$ DECLARE n integer; variant text; cid uuid; pid uuid; BEGIN
 FOREACH n IN ARRAY ARRAY[999,1000,1001] LOOP
  FOREACH variant IN ARRAY ARRAY['lines','headers','delivery_lines'] LOOP
   cid:=md5('independent-cap-'||variant||n)::uuid; pid:=md5('independent-po-'||variant||n)::uuid;
   INSERT INTO public.customers(id,name) VALUES(cid,'Synthetic cap '||variant||n);
   INSERT INTO public.customer_manager_assignments(customer_id,manager_id,assigned_by) VALUES(cid,'81000000-0000-0000-0000-000000000002','81000000-0000-0000-0000-000000000001');
   INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number,status,order_date,total_value) VALUES(pid,cid,'81000000-0000-0000-0000-000000000006','SYNTHETIC-CAP-'||variant||n,'complete','2024-01-01',n);
   INSERT INTO public.girard_orders(customer_id,submitted_by,status,po_id,total_value) VALUES(cid,'81000000-0000-0000-0000-000000000004','approved',pid,n);
   INSERT INTO public.po_line_items(id,purchase_order_id,product_name,quantity,unit_price)
   SELECT md5(pid::text||'-line-'||i)::uuid,pid,'Synthetic cap item',CASE WHEN variant='lines' THEN 1 ELSE n END,1 FROM generate_series(1,CASE WHEN variant='lines' THEN n ELSE 1 END) i;
   INSERT INTO public.surat_jalan(id,purchase_order_id,sj_number,sj_date,created_by)
   SELECT md5(pid::text||'-header-'||i)::uuid,pid,'SYNTHETIC-'||i,'2024-01-01','81000000-0000-0000-0000-000000000006' FROM generate_series(1,CASE WHEN variant='headers' THEN n ELSE 1 END) i;
   INSERT INTO public.sj_line_items(surat_jalan_id,po_line_item_id,quantity_delivered)
   SELECT md5(pid::text||'-header-'||CASE WHEN variant='headers' THEN i ELSE 1 END)::uuid,md5(pid::text||'-line-'||CASE WHEN variant='lines' THEN i ELSE 1 END)::uuid,1 FROM generate_series(1,n) i;
  END LOOP;
 END LOOP;
END $$;
SET LOCAL session_replication_role='origin';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000002',true);
DO $$ DECLARE n integer; variant text; cid uuid; pid uuid; r jsonb; truth numeric; BEGIN
 FOREACH n IN ARRAY ARRAY[999,1000,1001] LOOP
  FOREACH variant IN ARRAY ARRAY['lines','headers','delivery_lines'] LOOP
   cid:=md5('independent-cap-'||variant||n)::uuid;pid:=md5('independent-po-'||variant||n)::uuid;
   SELECT sum(d.quantity_delivered::numeric*l.unit_price) INTO truth FROM public.surat_jalan s JOIN public.sj_line_items d ON d.surat_jalan_id=s.id JOIN public.po_line_items l ON l.id=d.po_line_item_id WHERE s.purchase_order_id=pid AND s.voided_at IS NULL;
   r:=public.pilot_customer_stats_v1(ARRAY[cid],'2024-01-01',3);
   PERFORM pg_temp.assert_true((r->'items'->0->>'order_count')::integer=1 AND (r->'items'->0->>'total_sales')::numeric=truth AND truth=n,'Independent '||variant||' cap boundary '||n);
   r:=public.pilot_po_lines_v1(pid,1,100);
   PERFORM pg_temp.assert_true((r->>'total')::integer=CASE WHEN variant='lines' THEN n ELSE 1 END,'Complete PO-line total at child boundary');
  END LOOP;
 END LOOP;
END $$;
RESET ROLE;
SELECT 'SCALABLE_REPORT_READS_VERIFIED' AS result;
ROLLBACK;
