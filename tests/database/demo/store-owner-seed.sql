-- Fictional rows for the one-time cutover test, never a hosted seed.
DO $$ BEGIN IF current_database()<>'pilot_test' OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') THEN RAISE EXCEPTION 'Disposable fixture required'; END IF; END $$;
INSERT INTO auth.users(id) SELECT md5('owner-user-'||n)::uuid FROM generate_series(1,7)n;
INSERT INTO public.users(id,full_name,email,role,manager_id,is_active)
SELECT md5('owner-user-'||n)::uuid,'Owner test '||n,'owner-'||n||'@example.invalid',
 (CASE n WHEN 1 THEN 'executive' WHEN 2 THEN 'sales_manager' WHEN 3 THEN 'sales_manager' WHEN 6 THEN 'po_admin' ELSE 'sales_person' END)::public.user_role,
 CASE n WHEN 4 THEN md5('owner-user-2')::uuid WHEN 5 THEN md5('owner-user-3')::uuid END,n<>7 FROM generate_series(1,7)n;
INSERT INTO public.customers(id,name) SELECT md5('owner-store-'||n)::uuid,'Owner store '||n FROM generate_series(1,5)n;
INSERT INTO public.customer_manager_assignments(id,customer_id,manager_id,assigned_by)
SELECT md5('owner-assignment-'||n)::uuid,md5('owner-store-'||n)::uuid,md5('owner-user-'||CASE n WHEN 2 THEN 4 ELSE 2 END)::uuid,md5('owner-user-1')::uuid FROM generate_series(1,2)n;
-- Conflicting unused secondary mapping must not override the current visible field.
INSERT INTO public.customer_sales_rep_assignments(customer_id,sales_rep_id,assigned_by) VALUES(md5('owner-store-1')::uuid,md5('owner-user-5')::uuid,md5('owner-user-1')::uuid);
INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number,status,order_date,total_value,created_at)
SELECT md5('owner-po-'||n)::uuid,md5('owner-store-'||least(n,3))::uuid,md5('owner-user-6')::uuid,'OWNER-TEST-'||n,'confirm','2026-10-01',n*100,'2026-10-01T00:00:00Z' FROM generate_series(1,4)n;
INSERT INTO public.girard_orders(id,customer_id,submitted_by,status,po_id,total_value,created_at)
VALUES(md5('owner-linked')::uuid,md5('owner-store-1')::uuid,md5('owner-user-5')::uuid,'approved',md5('owner-po-1')::uuid,15,'2026-09-30T00:00:00Z');
