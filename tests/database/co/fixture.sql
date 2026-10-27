-- Only synthetic data and wrappers. This file is never a migration or hosted seed.
DO $$ BEGIN
 IF current_database()<>'pilot_co_test' OR current_user<>'postgres'
 OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci')
 THEN RAISE EXCEPTION 'Fresh CO fixture required'; END IF;
END $$;
CREATE SCHEMA co_test;
CREATE FUNCTION co_test.assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',label; END IF; END $$;
CREATE FUNCTION co_test.raises(sql text, expected_state text, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE caught text;
BEGIN
 BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS caught=RETURNED_SQLSTATE; END;
 IF caught IS DISTINCT FROM expected_state THEN RAISE EXCEPTION '%: expected SQLSTATE %, got %',label,expected_state,coalesce(caught,'success'); END IF;
END $$;
INSERT INTO auth.users(id) SELECT md5('co-user-'||n)::uuid FROM generate_series(1,4)n;
INSERT INTO public.users(id,full_name,email,role,is_active)
SELECT md5('co-user-'||n)::uuid,'CO fixture '||n,'co-'||n||'@example.invalid',
 (CASE n WHEN 1 THEN 'co_admin' WHEN 2 THEN 'executive' WHEN 3 THEN 'po_admin' ELSE 'co_admin' END)::public.user_role,n<>4
FROM generate_series(1,4)n;
INSERT INTO public.customers(id,name) SELECT md5('co-customer-'||n)::uuid,'CO customer '||n FROM generate_series(1,2)n;
INSERT INTO public.products(id,sku,name) VALUES(md5('co-product-1')::uuid,'CAT-A','Original catalog A'),(md5('co-product-2')::uuid,'CAT-B','Original catalog B');
INSERT INTO public.customer_manager_assignments(customer_id,manager_id,assigned_by)
VALUES(md5('co-customer-1')::uuid,md5('co-user-2')::uuid,md5('co-user-2')::uuid);

-- Exercises production envelope helpers without introducing a production test operation.
CREATE FUNCTION co_test.execute(request uuid, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; customer uuid:=(payload->>'customer_id')::uuid; v bigint;
BEGIN
 result:=private.co_command_begin_v1(request,'edit_co',payload);
 IF result IS NOT NULL THEN RETURN result; END IF;
 PERFORM private.co_lock_customer_v1(customer,NULL);
 UPDATE private.co_customer_state SET version=version+1 WHERE customer_id=customer RETURNING version INTO v;
 result:=jsonb_build_object('id',customer,'operation','edit_co','version','1','customer_id',customer,'customer_version',v::text);
 RETURN private.co_command_commit_v1(request,result);
END $$;
CREATE FUNCTION co_test.complete(request uuid, receipt jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 PERFORM private.co_command_begin_v1(request,'edit_co','{}'::jsonb);
 RETURN private.co_command_commit_v1(request,receipt);
END $$;
REVOKE ALL ON SCHEMA co_test FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA co_test FROM PUBLIC,anon,authenticated;
