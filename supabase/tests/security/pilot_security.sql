-- Synthetic role tests. Run only in an isolated metadata fixture, never production.
-- Requires test auth.uid() reading request.jwt.claim.sub and actual authenticated role.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; END $$;
CREATE FUNCTION pg_temp.assert_denied(statement text, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE affected bigint;
BEGIN
  BEGIN
    EXECUTE statement;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected = 0 THEN RETURN; END IF;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN RETURN;
  END;
  RAISE EXCEPTION 'FAIL (write allowed): %', label;
END $$;
INSERT INTO auth.users(id) SELECT ('10000000-0000-0000-0000-00000000000' || n)::uuid FROM generate_series(1,8) n;
INSERT INTO public.users(id,full_name,email,role,manager_id,is_active) VALUES
('10000000-0000-0000-0000-000000000001','Test executive','exec@test.invalid','executive',NULL,true),
('10000000-0000-0000-0000-000000000002','Test head','head@test.invalid','sales_head',NULL,true),
('10000000-0000-0000-0000-000000000003','Test manager','manager@test.invalid','sales_manager',NULL,true),
('10000000-0000-0000-0000-000000000004','Test sales','sales@test.invalid','sales_person','10000000-0000-0000-0000-000000000003',true),
('10000000-0000-0000-0000-000000000005','Other manager','other-manager@test.invalid','sales_manager',NULL,true),
('10000000-0000-0000-0000-000000000006','Other sales','other-sales@test.invalid','sales_person','10000000-0000-0000-0000-000000000005',true),
('10000000-0000-0000-0000-000000000007','Inactive executive','inactive@test.invalid','executive',NULL,false),
('10000000-0000-0000-0000-000000000008','PO admin','po@test.invalid','po_admin',NULL,true);
INSERT INTO public.customers(id,name) VALUES ('20000000-0000-0000-0000-000000000001','Own customer'),('20000000-0000-0000-0000-000000000002','Other customer');
INSERT INTO public.customer_manager_assignments(customer_id,manager_id,assigned_by) VALUES
('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001'),
('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001');
INSERT INTO public.products(id,name,sku) VALUES ('30000000-0000-0000-0000-000000000001','Test product','PILOT-SECURITY-TEST');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number) VALUES
('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','SEC-OWN'),
('50000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','SEC-OTHER');
INSERT INTO public.girard_orders(id,customer_id,submitted_by,po_id) VALUES
('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','50000000-0000-0000-0000-000000000001'),
('60000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000006','50000000-0000-0000-0000-000000000002');
INSERT INTO public.girard_order_items(order_id,product_name,quantity) VALUES
('60000000-0000-0000-0000-000000000001','OWN',1),('60000000-0000-0000-0000-000000000002','OTHER',1);
INSERT INTO public.po_line_items(id,purchase_order_id,product_name,quantity,unit_price) VALUES
('70000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','OWN',1,1),
('70000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002','OTHER',1,1);
INSERT INTO public.surat_jalan(id,purchase_order_id,sj_number,sj_date,created_by) VALUES
('80000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','SEC-OWN',current_date,'10000000-0000-0000-0000-000000000001'),
('80000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002','SEC-OTHER',current_date,'10000000-0000-0000-0000-000000000001');
INSERT INTO public.sj_line_items(surat_jalan_id,po_line_item_id,quantity_delivered) VALUES
('80000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001',1),
('80000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000002',1);
INSERT INTO public.sales_schedules(id,outlet_id,sales_person_id,assigned_by,scheduled_date) VALUES
('40000000-0000-0000-0000-000000000009','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001',current_date);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true(current_user = 'authenticated','tests use non-owner authenticated role');
SELECT pg_temp.assert_true(row_security_active('public.users'),'RLS MUST be active; standalone backend cannot validate these tests');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.customers),'sales sees assigned customer only');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.girard_orders),'sales sees own order only');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.girard_order_items),'sales cannot read other order items directly');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.purchase_orders),'sales sees linked own PO only');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.po_line_items),'sales PO item visibility follows header');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.surat_jalan),'sales SJ visibility follows PO');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.sj_line_items),'sales SJ item visibility follows header');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.po_audit_log WHERE purchase_order_id='50000000-0000-0000-0000-000000000002'),'sales audit cannot reveal other order');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.pilot_my_profile()),'own profile RPC returns exactly self');
SELECT pg_temp.assert_denied($s$SELECT * FROM public.pilot_list_users()$s$,'sales cannot call executive directory');
SELECT pg_temp.assert_denied($s$SELECT * FROM public.pilot_team_directory()$s$,'sales cannot call management contact directory');
SELECT pg_temp.assert_denied($s$SELECT email,phone,birth_date FROM public.users$s$,'raw users private fields denied');
SELECT pg_temp.assert_denied($s$UPDATE public.users SET role='executive' WHERE id=auth.uid()$s$,'sales cannot self-promote');
SELECT pg_temp.assert_denied($s$UPDATE public.users SET manager_id=NULL WHERE id=auth.uid()$s$,'sales cannot change own scope');
SELECT pg_temp.assert_denied($s$UPDATE public.users SET is_active=false WHERE id=auth.uid()$s$,'self status cannot change');
UPDATE public.users SET phone='synthetic phone',full_name='Edited self' WHERE id=auth.uid();
SELECT pg_temp.assert_true((SELECT full_name='Edited self' FROM public.users WHERE id=auth.uid()),'safe self profile edit retained');
SELECT pg_temp.assert_denied($s$UPDATE public.users SET phone='bad' WHERE id='10000000-0000-0000-0000-000000000003'$s$,'sales cannot edit another user');
SELECT pg_temp.assert_denied($s$INSERT INTO public.promotions(product_id,start_date,end_date,created_by) VALUES ('30000000-0000-0000-0000-000000000001',current_date,current_date,auth.uid())$s$,'sales cannot create promotions');
SELECT pg_temp.assert_denied($s$INSERT INTO public.sales_targets(user_id,year_month,set_by) VALUES (auth.uid(),'2026-09',auth.uid())$s$,'sales cannot set own target');
SELECT pg_temp.assert_denied($s$INSERT INTO public.customer_sales_rep_assignments(customer_id,sales_rep_id,assigned_by) VALUES ('20000000-0000-0000-0000-000000000001',auth.uid(),auth.uid())$s$,'sales cannot assign customer scope');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated','public.users','TRUNCATE'),'authenticated cannot truncate');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated','public.users','MAINTAIN'),'authenticated cannot perform database maintenance');
SELECT pg_temp.assert_true(NOT has_table_privilege('anon','public.users','SELECT'),'anonymous table privileges removed');
SELECT pg_temp.assert_true(NOT has_column_privilege('authenticated','public.users','email','SELECT'),'no inherited email read privilege');
SELECT pg_temp.assert_true(NOT has_column_privilege('authenticated','public.users','birth_date','SELECT'),'no inherited birth-date read privilege');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid='public.users'::regclass AND a.grantee=0),'no PUBLIC users-table privilege');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true((SELECT count(*)=8 FROM public.pilot_list_users()),'executive directory allowed');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.girard_orders),'executive all orders allowed');
UPDATE public.users SET full_name='Executive edited',role='sales_person' WHERE id='10000000-0000-0000-0000-000000000006';
SELECT pg_temp.assert_true((SELECT full_name='Executive edited' FROM public.users WHERE id='10000000-0000-0000-0000-000000000006'),'executive can manage another profile');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000007',true);
SELECT pg_temp.assert_true(public.current_user_role() IS NULL,'inactive role helper denies');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.customers),'inactive cannot read business data');
SELECT pg_temp.assert_denied($s$UPDATE public.users SET is_active=true WHERE id=auth.uid()$s$,'inactive cannot reactivate self');
SELECT pg_temp.assert_denied($s$INSERT INTO public.products(name,sku) VALUES ('Bad','BAD')$s$,'inactive executive cannot write');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.customers),'manager sees assigned customer only');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.girard_orders),'manager sees team orders only');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.pilot_team_directory()),'manager contacts restricted to self and direct report');
INSERT INTO public.sales_targets(user_id,year_month,set_by) VALUES ('10000000-0000-0000-0000-000000000004','2026-09',auth.uid());
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.sales_targets WHERE user_id='10000000-0000-0000-0000-000000000004'),'manager own-team target allowed');
SELECT pg_temp.assert_denied($s$INSERT INTO public.sales_targets(user_id,year_month,set_by) VALUES ('10000000-0000-0000-0000-000000000006','2026-09',auth.uid())$s$,'manager cannot target other team');
SELECT pg_temp.assert_denied($s$INSERT INTO public.sales_targets(user_id,year_month,set_by) VALUES ('10000000-0000-0000-0000-000000000003','2026-09','10000000-0000-0000-0000-000000000001')$s$,'cannot spoof target setter');
SELECT pg_temp.assert_denied($s$INSERT INTO public.customer_targets(customer_id,year_month,set_by) VALUES ('20000000-0000-0000-0000-000000000001','2026-09',auth.uid())$s$,'manager customer target blocked to match UI');
INSERT INTO public.sales_schedules(id,outlet_id,sales_person_id,assigned_by,scheduled_date) VALUES ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004',auth.uid(),current_date+3);
SELECT pg_temp.assert_denied($s$INSERT INTO public.sales_schedules(outlet_id,sales_person_id,assigned_by,scheduled_date) VALUES ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000004',auth.uid(),current_date+3)$s$,'manager cannot schedule other customer');
SELECT pg_temp.assert_denied($s$UPDATE public.sales_schedules SET sales_person_id='10000000-0000-0000-0000-000000000006' WHERE id='40000000-0000-0000-0000-000000000001'$s$,'manager cannot reassign outside team');
SELECT pg_temp.assert_denied($s$UPDATE public.sales_schedules SET assigned_by='10000000-0000-0000-0000-000000000001' WHERE id='40000000-0000-0000-0000-000000000001'$s$,'schedule creator immutable');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
INSERT INTO public.promotions(product_id,start_date,end_date,created_by) VALUES ('30000000-0000-0000-0000-000000000001',current_date,current_date,auth.uid());
INSERT INTO public.customer_targets(customer_id,year_month,set_by) VALUES ('20000000-0000-0000-0000-000000000001','2026-09',auth.uid());
SELECT pg_temp.assert_denied($s$UPDATE public.promotions SET created_by='10000000-0000-0000-0000-000000000001'$s$,'promotion creator immutable');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.promotions),'head promotion creation retained');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.customer_targets),'head customer targets retained');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000008',true);
SELECT pg_temp.assert_denied($s$INSERT INTO public.promotions(product_id,start_date,end_date,created_by) VALUES ('30000000-0000-0000-0000-000000000001',current_date,current_date,auth.uid())$s$,'PO admin cannot manage promotions');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000099',true);
SELECT pg_temp.assert_true(public.current_user_role() IS NULL,'missing profile fails closed');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.users),'missing profile cannot read profiles');
SELECT pg_temp.assert_denied($s$SELECT email,phone,birth_date FROM public.users$s$,'private user fields denied');
RESET ROLE;
ROLLBACK;
