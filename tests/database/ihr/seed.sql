-- FICTIONAL ONLY. Include inside the suite transaction; never install into a real environment.
INSERT INTO auth.users(id) SELECT ('71000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid FROM generate_series(1,18) n;
INSERT INTO public.users(id,full_name,email,role,is_active)
SELECT ('71000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
 'Fictional iHR ' || n,'ihr-fixture-' || n || '@example.invalid',
 (CASE n WHEN 2 THEN 'po_admin' WHEN 3 THEN 'sales_manager' WHEN 4 THEN 'executive' WHEN 14 THEN 'executive' WHEN 15 THEN 'po_admin' WHEN 16 THEN 'sales_head' ELSE 'sales_person' END)::public.user_role,n<>7
FROM generate_series(1,18) n;
INSERT INTO public.ihr_leave_members(user_id,member_kind,active)
SELECT ('71000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
 CASE n WHEN 3 THEN 'manager' WHEN 4 THEN 'director' WHEN 17 THEN 'director' ELSE 'employee' END,true
FROM unnest(ARRAY[1,2,3,4,7,8,17,18]) n;
INSERT INTO public.ihr_leave_approvers(employee_id,approver_id,effective_from,assigned_by)
VALUES ('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000003','2000-01-01 00:00:00+00','71000000-0000-0000-0000-000000000006'),
 ('71000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000004','2000-01-01 00:00:00+00','71000000-0000-0000-0000-000000000006');
INSERT INTO public.ihr_leave_access_grants(actor_id,capability,scope_kind,employee_id,effective_from,granted_by,reason)
SELECT ('71000000-0000-0000-0000-' || lpad(actor::text,12,'0'))::uuid,capability,'employee',
 ('71000000-0000-0000-0000-' || lpad(employee::text,12,'0'))::uuid,'2000-01-01 00:00:00+00',
 ('71000000-0000-0000-0000-' || lpad((CASE actor WHEN 6 THEN 5 ELSE 6 END)::text,12,'0'))::uuid,'Fictional fixture only'
FROM (VALUES (5,1,'configure'),(5,1,'adjust'),(5,1,'read_private'),(5,1,'calendar'),
 (6,2,'configure'),(6,2,'adjust'),(6,2,'read_private'),(6,2,'calendar'),(6,2,'manage_access'),
 (9,1,'configure'),(10,1,'adjust'),(11,1,'read_private'),(12,1,'calendar'),(13,1,'manage_access')) v(actor,employee,capability);
