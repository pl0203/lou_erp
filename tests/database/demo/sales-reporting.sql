-- Synthetic data only. Requires disposable PostgreSQL and rolls back all fixtures.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_database()<>'pilot_test' OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') THEN RAISE EXCEPTION 'Disposable pilot_test marker required'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_true(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%',message; END IF; END $$;
CREATE FUNCTION pg_temp.expect_error(statement text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected THEN RETURN; ELSE RAISE; END IF; END; RAISE EXCEPTION 'Expected SQLSTATE %, statement succeeded',expected; END $$;
CREATE FUNCTION pg_temp.performance(manager uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT public.pilot_sales_performance_v1(manager,'2026-10-01','2026-10-31','2026-10-01T00:00:00Z','2026-10-31T23:59:59Z','2026-10',1,10) $$;
CREATE FUNCTION pg_temp.revenue() RETURNS jsonb LANGUAGE sql AS $$ SELECT public.pilot_revenue_v1('2026-10-01T00:00:00Z','2026-10-31T23:59:59Z',1,10) $$;
SET LOCAL session_replication_role='replica';
INSERT INTO auth.users(id) SELECT md5('demo-report-user-'||i)::uuid FROM generate_series(1,8) i;
INSERT INTO public.users(id,full_name,email,role,is_active,manager_id)
SELECT md5('demo-report-user-'||i)::uuid,'Synthetic report user '||i,'demo-report-'||i||'@example.invalid',
 (CASE i WHEN 1 THEN 'executive' WHEN 2 THEN 'sales_manager' WHEN 3 THEN 'sales_manager' WHEN 4 THEN 'sales_person' WHEN 5 THEN 'sales_person' WHEN 6 THEN 'po_admin' WHEN 7 THEN 'sales_head' ELSE 'sales_person' END)::public.user_role,
 i<>8,CASE i WHEN 4 THEN md5('demo-report-user-2')::uuid WHEN 5 THEN md5('demo-report-user-3')::uuid END FROM generate_series(1,8) i;
INSERT INTO public.customers(id,name) VALUES(md5('demo-report-store-a')::uuid,'Synthetic report store A'),(md5('demo-report-store-b')::uuid,'Synthetic report store B');
INSERT INTO public.customer_manager_assignments(customer_id,manager_id,assigned_by) VALUES(md5('demo-report-store-a')::uuid,md5('demo-report-user-2')::uuid,md5('demo-report-user-1')::uuid),(md5('demo-report-store-b')::uuid,md5('demo-report-user-3')::uuid,md5('demo-report-user-1')::uuid);
INSERT INTO public.customer_sales_rep_assignments(id,customer_id,sales_rep_id,assigned_by) VALUES(md5('demo-report-assignment-a')::uuid,md5('demo-report-store-a')::uuid,md5('demo-report-user-4')::uuid,md5('demo-report-user-1')::uuid),(md5('demo-report-assignment-b')::uuid,md5('demo-report-store-b')::uuid,md5('demo-report-user-5')::uuid,md5('demo-report-user-1')::uuid);
INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number,status,order_date,total_value,created_at,sales_person_id_at_creation,sales_assignment_source_id,sales_attributed_at,sales_attribution_state)
SELECT md5('demo-report-po-'||n)::uuid,md5('demo-report-store-'||store)::uuid,md5('demo-report-user-6')::uuid,'SYNTHETIC-REPORT-'||n,status::public.po_status,'2030-01-01',amount,created,
 CASE WHEN state='assigned' THEN md5('demo-report-user-'||actor)::uuid END,CASE WHEN state='assigned' THEN md5('demo-report-assignment-'||store)::uuid END,CASE WHEN state<>'legacy' THEN created END,state
FROM (VALUES
 ('linked','a','complete',900,'2026-10-02T00:00:00Z'::timestamptz,4,'assigned'),
 ('confirm','a','confirm',200,'2026-10-03T00:00:00Z'::timestamptz,4,'assigned'),
 ('progress','a','in_progress',300,'2026-10-04T00:00:00Z'::timestamptz,4,'assigned'),
 ('complete','a','complete',400,'2026-10-05T00:00:00Z'::timestamptz,4,'assigned'),
 ('draft','a','draft',50,'2026-10-06T00:00:00Z'::timestamptz,4,'assigned'),
 ('cancelled','a','cancelled',60,'2026-10-07T00:00:00Z'::timestamptz,4,'assigned'),
 ('unassigned','a','confirm',75,'2026-10-08T00:00:00Z'::timestamptz,0,'unassigned'),
 ('other','b','confirm',700,'2026-10-09T00:00:00Z'::timestamptz,5,'assigned'),
 ('old-other','b','confirm',777,'2026-09-01T00:00:00Z'::timestamptz,5,'assigned'),
 ('fractional','a','confirm',10001,'2026-10-31T23:59:59.5Z'::timestamptz,4,'assigned'),
 ('historical','a','confirm',888,'2019-01-01T00:00:00Z'::timestamptz,0,'legacy')
) t(n,store,status,amount,created,actor,state);
INSERT INTO public.girard_orders(id,customer_id,submitted_by,status,po_id,total_value,created_at)
SELECT md5('demo-report-legacy-'||state)::uuid,md5('demo-report-store-a')::uuid,md5('demo-report-user-4')::uuid,state,
 CASE WHEN state='approved' THEN md5('demo-report-po-linked')::uuid END,amount,'2026-10-01T00:00:00Z'
FROM (VALUES('approved',100),('pending',20),('rejected',30),('cancelled',40)) t(state,amount);
INSERT INTO public.po_line_items(id,purchase_order_id,product_name,quantity,unit_price) VALUES(md5('demo-report-line')::uuid,md5('demo-report-po-confirm')::uuid,'Synthetic hidden line',1,200);
INSERT INTO public.po_audit_log(purchase_order_id,changed_by,field_changed) VALUES(md5('demo-report-po-confirm')::uuid,md5('demo-report-user-6')::uuid,'synthetic-hidden');
SET LOCAL session_replication_role='origin';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('demo-report-user-2')::uuid::text,true);
SELECT pg_temp.assert_true(current_user='authenticated' AND row_security_active('public.purchase_orders'),'Normal-role effective RLS required');
-- Independent ground truth: legacy 100+20+30+40 and new 200+300+400+50+60.
SELECT pg_temp.assert_true((pg_temp.performance(auth.uid())->'summary'->>'total_orders')::int=9,'Performance includes four legacy plus five new assigned orders once');
SELECT pg_temp.assert_true((pg_temp.performance(auth.uid())->'summary'->>'total_sales')::numeric=1200,'Legacy recorded values plus new current values');
SELECT pg_temp.assert_true((pg_temp.revenue()->'summary'->>'total_orders')::int=4 AND (pg_temp.revenue()->'summary'->>'total_sales')::numeric=1000,'Revenue approved legacy plus confirm/in_progress/complete, excluding draft/cancelled');
SELECT pg_temp.assert_true((public.pilot_team_activity_v1(ARRAY[md5('demo-report-user-4')::uuid,md5('demo-report-user-5')::uuid],'2026-10-03','2026-10-01T00:00:00Z','2026-10-31T23:59:59Z','2026-10-01T00:00:00Z')->'items')=jsonb_build_array(jsonb_build_object('sales_person_id',md5('demo-report-user-4')::uuid,'total_scheduled',0,'total_visited',0,'total_orders',9,'weekly_visits',0)),'Team order count includes new POs and denies other team IDs');
SELECT pg_temp.assert_true((SELECT count(*) FROM private.pilot_admin_sales_source_v1('2026-10-01T00:00:00Z','2026-10-31T23:59:59Z') WHERE source_id=md5('demo-report-po-other')::uuid OR customer_id=md5('demo-report-store-b')::uuid OR sales_person_id IS NULL)=0,'Guessed foreign store/order and Unassigned rows denied inside definer');
SELECT pg_temp.assert_true((SELECT count(*) FROM private.pilot_admin_sales_source_v1('2026-10-31T23:59:59Z','2026-10-31T23:59:59.5Z') WHERE source_id=md5('demo-report-po-fractional')::uuid)=1,'Existing inclusive timestamp bound is retained without silently truncating the source');
SELECT pg_temp.assert_true(public.pilot_sales_report_months_v1(auth.uid())->>'earliest_order_at'='2026-10-01T00:00:00+00:00','Only authorized canonical earliest order is exposed');
SELECT pg_temp.assert_true(public.pilot_sales_report_months_v1(auth.uid())->'earliest_schedule_date'='null'::jsonb,'Orders remain selectable with no schedules');
SELECT pg_temp.expect_error(format('SELECT public.pilot_sales_report_months_v1(%L)',md5('demo-report-user-3')::uuid),'42501');
SELECT pg_temp.expect_error(format('SELECT pg_temp.performance(%L)',md5('demo-report-user-3')::uuid),'42501');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.purchase_orders WHERE id=md5('demo-report-po-confirm')::uuid)=0,'Reports do not grant direct new PO access');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.po_line_items WHERE purchase_order_id=md5('demo-report-po-confirm')::uuid)=0 AND (SELECT count(*) FROM public.po_audit_log WHERE purchase_order_id=md5('demo-report-po-confirm')::uuid)=0,'No new PO child or audit visibility');
SELECT set_config('request.jwt.claim.sub',md5('demo-report-user-1')::uuid::text,true);
SELECT pg_temp.assert_true((pg_temp.performance(NULL)->'summary'->>'total_orders')::int=11 AND (pg_temp.performance(NULL)->'summary'->>'total_sales')::numeric=1975,'Leadership authorized total includes Unassigned and other team');
SELECT pg_temp.assert_true((pg_temp.performance(NULL)->'summary'->>'unassigned_orders')::int=1 AND (pg_temp.performance(NULL)->'summary'->>'unassigned_sales')::numeric=75,'Unassigned explicitly reported without fabricated salesperson');
SELECT pg_temp.assert_true((pg_temp.revenue()->'summary'->>'total_sales')::numeric=1775,'Leadership revenue includes authorized Unassigned');
SELECT pg_temp.assert_true(public.pilot_sales_report_months_v1(NULL)->>'earliest_order_at'='2026-09-01T00:00:00+00:00','Historical uncredited PO is excluded from earliest canonical source');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',md5('demo-report-user-1')::uuid::text,true);
-- Later store reassignment does not rewrite captured credit; permitted value/date edits do update new amounts.
UPDATE public.customer_sales_rep_assignments SET sales_rep_id=md5('demo-report-user-5')::uuid WHERE customer_id=md5('demo-report-store-a')::uuid;
UPDATE public.purchase_orders SET total_value=250,order_date='2026-11-15' WHERE id=md5('demo-report-po-confirm')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('demo-report-user-4')::uuid::text,true);
SELECT pg_temp.assert_true((pg_temp.performance(NULL)->'summary'->>'total_sales')::numeric=1250 AND (pg_temp.revenue()->'summary'->>'total_sales')::numeric=1050,'Current PO amount and immutable creation credit/date survive store reassignment');
SELECT pg_temp.assert_true(pg_temp.revenue()->'items'->0->>'customer_name'='Unknown' AND pg_temp.revenue()->'items'->0->'manager_name'='null'::jsonb,'Authorized historical credit never reveals an inaccessible customer or manager label');
SELECT pg_temp.assert_true((pg_temp.performance(NULL)->'summary'->>'unassigned_orders')::int=0,'Salesperson cannot see Unassigned bucket');
SELECT set_config('request.jwt.claim.sub',md5('demo-report-user-5')::uuid::text,true);
SELECT pg_temp.assert_true((pg_temp.performance(NULL)->'summary'->>'total_orders')::int=1 AND (pg_temp.revenue()->'summary'->>'total_sales')::numeric=700,'New store assignee cannot claim another salesperson history');
SELECT pg_temp.assert_true(public.pilot_sales_report_months_v1(NULL)->>'earliest_order_at'='2026-09-01T00:00:00+00:00' AND public.pilot_sales_report_months_v1(NULL)->'earliest_schedule_date'='null'::jsonb,'Earliest month comes from own new admin POs when no legacy submissions or schedules exist');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',md5('demo-report-user-1')::uuid::text,true);
UPDATE public.purchase_orders SET status='cancelled' WHERE id IN(md5('demo-report-po-confirm')::uuid,md5('demo-report-po-linked')::uuid);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('demo-report-user-2')::uuid::text,true);
SELECT pg_temp.assert_true((pg_temp.performance(auth.uid())->'summary'->>'total_sales')::numeric=1250,'Cancelled new PO retains entered-order performance history');
SELECT pg_temp.assert_true((pg_temp.revenue()->'summary'->>'total_sales')::numeric=800,'New cancelled PO excluded; legacy linked PO status never replaces recorded approved status');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',md5('demo-report-user-1')::uuid::text,true);
INSERT INTO public.sales_schedules(id,outlet_id,sales_person_id,assigned_by,scheduled_date) VALUES(md5('demo-report-schedule')::uuid,md5('demo-report-store-a')::uuid,md5('demo-report-user-4')::uuid,md5('demo-report-user-1')::uuid,'2026-08-01');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('demo-report-user-2')::uuid::text,true);
SELECT pg_temp.assert_true(public.pilot_sales_report_months_v1(auth.uid())->>'earliest_schedule_date'='2026-08-01','Earliest authorized schedule is combined with canonical orders');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',md5('demo-report-user-1')::uuid::text,true);
UPDATE public.users SET manager_id=md5('demo-report-user-3')::uuid WHERE id=md5('demo-report-user-4')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('demo-report-user-2')::uuid::text,true);
SELECT pg_temp.assert_true((pg_temp.performance(auth.uid())->'summary'->>'total_orders')::int=0 AND (pg_temp.revenue()->'summary'->>'total_orders')::int=0,'Current team reassignment removes former manager reporting authority');
SELECT pg_temp.assert_true(public.pilot_sales_report_months_v1(auth.uid())->'earliest_order_at'='null'::jsonb,'Former manager cannot retain earliest-order disclosure');
SELECT set_config('request.jwt.claim.sub',md5('demo-report-user-3')::uuid::text,true);
SELECT pg_temp.assert_true((pg_temp.performance(auth.uid())->'summary'->>'total_orders')::int=10,'Current new manager sees fixed historical credit');
SELECT set_config('request.jwt.claim.sub',md5('demo-report-user-6')::uuid::text,true);
SELECT pg_temp.assert_true((pg_temp.performance(NULL)->'summary'->>'unassigned_orders')::int=1,'PO admin sees explicit Unassigned totals');
SELECT set_config('request.jwt.claim.sub',md5('demo-report-user-7')::uuid::text,true);
SELECT pg_temp.assert_true((pg_temp.performance(NULL)->'summary'->>'unassigned_orders')::int=1,'Sales head sees explicit Unassigned totals');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',md5('demo-report-user-1')::uuid::text,true);
UPDATE public.users SET is_active=false WHERE id=md5('demo-report-user-4')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('demo-report-user-4')::uuid::text,true);
SELECT pg_temp.expect_error('SELECT pg_temp.performance(NULL)','42501');
SELECT pg_temp.expect_error('SELECT pg_temp.revenue()','42501');
SELECT pg_temp.expect_error('SELECT public.pilot_sales_report_months_v1(NULL)','42501');
SELECT pg_temp.expect_error($statement$SELECT private.pilot_admin_sales_source_v1('2026-10-01','2026-10-31')$statement$,'42501');
SELECT set_config('request.jwt.claim.sub',md5('demo-report-user-8')::uuid::text,true);
SELECT pg_temp.expect_error('SELECT pg_temp.performance(NULL)','42501');
SELECT pg_temp.expect_error('SELECT pg_temp.revenue()','42501');
SELECT pg_temp.expect_error('SELECT public.pilot_sales_report_months_v1(NULL)','42501');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT pg_temp.expect_error('SELECT public.pilot_sales_report_months_v1(NULL)','42501');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error('SELECT public.pilot_sales_report_months_v1(NULL)','42501');
SELECT pg_temp.expect_error('SELECT pg_temp.revenue()','42501');
RESET ROLE;
SELECT 'DEMO_SALES_REPORTING_VERIFIED' AS result;
ROLLBACK;
