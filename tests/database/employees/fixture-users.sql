-- Exact fictional users, always invocation-owned or rollback-only.
INSERT INTO auth.users(id) SELECT ('95000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid FROM unnest(ARRAY[1,2,3,4,7,13,14,16])n;
INSERT INTO public.users(id,full_name,email,role,is_active)
SELECT ('95000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'Synthetic recovery '||n,'recovery-'||n||'@example.invalid',
 (CASE n WHEN 1 THEN 'sales_person' WHEN 2 THEN 'po_admin' WHEN 3 THEN 'sales_manager' WHEN 13 THEN 'co_admin' WHEN 16 THEN 'sales_head' ELSE 'executive' END)::public.user_role,n<>7
FROM unnest(ARRAY[1,2,3,4,7,13,14,16])n;
