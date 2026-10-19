-- Requires prechange fixture, reviewed full foundation authority changes and the same session.
SELECT pg_temp.foundation_assert((SELECT count(*)=1 AND bool_and((to_jsonb(p)-'prosrc')=expected.metadata)
 FROM pg_temp.catalogue_v1_metadata_before_v1 expected JOIN pg_proc p ON p.oid=expected.oid),'v1 metadata owner ACL signature and configuration preserved');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM pg_temp.catalogue_v1_execute_before_v1 expected
 WHERE has_function_privilege(expected.rolname,'public.pilot_procurement_access_v1()','EXECUTE') IS DISTINCT FROM expected.allowed),'v1 effective execute grants preserved');
SELECT pg_temp.foundation_assert((SELECT count(*)=2 AND bool_and(NOT p.prosecdef AND p.provolatile='s')
 FROM pg_proc p WHERE p.oid IN ('public.pilot_procurement_access_v1()'::regprocedure,'public.pilot_procurement_access_v2()'::regprocedure)),'capabilities use caller privileges');
SELECT pg_temp.foundation_assert(NOT EXISTS(
 SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.oid IN ('private.catalog_master_before_v1()'::regprocedure,'private.catalog_master_after_v1()'::regprocedure,
 'private.catalog_identity_guard_v1()'::regprocedure,'private.catalog_master_truncate_v1()'::regprocedure)
 AND a.grantee<>p.proowner),'private lifecycle helpers grant no execution outside their owner');
SET LOCAL ROLE authenticated;
DO $$ DECLARE actor integer; v1 jsonb; v2 jsonb; r text; keys text[]; BEGIN
  FOR actor IN 1..3 LOOP
    PERFORM set_config('request.jwt.claim.sub',md5('catalogue-foundation-actor-'||actor)::uuid::text,true);
    PERFORM pg_temp.foundation_assert(current_user='authenticated' AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)), 'actual authenticated non-bypass role');
    PERFORM pg_temp.foundation_assert(row_security_active('public.customers') AND row_security_active('public.products'),'master RLS active');
    SELECT public.pilot_procurement_access_v1(),public.pilot_procurement_access_v2() INTO v1,v2;
    r := (ARRAY['co_admin','po_admin','executive'])[actor];
    SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(v1) k;
    PERFORM pg_temp.foundation_assert(keys=ARRAY['actor_id','as_of','customer_create','customer_delete','customer_edit','product_create','product_delete','product_edit','role','version'], 'v1 exact key set');
    PERFORM pg_temp.foundation_assert(v1->>'role'=r AND v1->>'actor_id'=auth.uid()::text AND v1->'version'='1'::jsonb AND v1->'customer_delete'='false'::jsonb,'v1 identity and customer deletion unchanged');
    PERFORM pg_temp.foundation_assert(v1 @> CASE actor WHEN 1 THEN '{"customer_create":false,"customer_edit":false,"product_create":false,"product_edit":false,"product_delete":false}'::jsonb
      ELSE '{"customer_create":true,"customer_edit":true,"product_create":true,"product_edit":true,"product_delete":true}'::jsonb END,'v1 CO remains denied and legacy PO/Executive preserved');
    SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(v2) k;
    PERFORM pg_temp.foundation_assert(keys=ARRAY['actor_id','as_of','customer_create','customer_delete','customer_delete_mode','customer_edit','customer_set_enabled','product_create','product_delete','product_delete_mode','product_edit','product_set_enabled','role','version'],'v2 exact key set');
    PERFORM pg_temp.foundation_assert(jsonb_typeof(v1->'as_of')='string' AND jsonb_typeof(v2->'as_of')='string','capability observation timestamps are strings');
    PERFORM pg_temp.foundation_assert(v2->'version'='2'::jsonb AND v2->>'role'=r AND v2->>'actor_id'=auth.uid()::text,'v2 current identity');
    PERFORM pg_temp.foundation_assert(v2 @> '{"customer_create":true,"customer_edit":true,"product_create":true,"product_edit":true,"customer_set_enabled":true,"product_set_enabled":true}'::jsonb,'active Procurement v2 flags under verified grants');
    PERFORM pg_temp.foundation_assert(v2->>'customer_delete_mode'=CASE actor WHEN 1 THEN 'guarded' ELSE 'none' END AND v2->>'product_delete_mode'=CASE actor WHEN 1 THEN 'guarded' ELSE 'direct' END,'operation-and-kind delete modes');
    PERFORM pg_temp.foundation_assert(v2->'customer_delete'=to_jsonb(v2->>'customer_delete_mode'<>'none') AND v2->'product_delete'=to_jsonb(v2->>'product_delete_mode'<>'none'),'delete booleans match modes');
    PERFORM pg_temp.foundation_raises($q$INSERT INTO public.customers(name,is_enabled) VALUES('Fictional forbidden',false)$q$,'42501','raw activation INSERT denied');
    PERFORM pg_temp.foundation_raises($q$UPDATE public.customers SET is_enabled=false WHERE id=md5('catalogue-existing-customer')::uuid$q$,'42501','raw activation UPDATE denied');
    PERFORM pg_temp.foundation_raises($q$INSERT INTO public.products(name,sku,catalog_version) VALUES('Fictional forbidden','CATALOGUE-FORBIDDEN',42)$q$,'42501','raw version INSERT denied');
    PERFORM pg_temp.foundation_raises($q$UPDATE public.products SET catalog_version=42 WHERE id=md5('catalogue-existing-product')::uuid$q$,'42501','raw version UPDATE denied');
    PERFORM pg_temp.foundation_raises('SELECT * FROM private.catalog_identity_v1','42501','identity evidence private');
    PERFORM pg_temp.foundation_raises('SELECT * FROM private.catalog_cutover_v1','42501','cutover state private');
    PERFORM pg_temp.foundation_raises($q$INSERT INTO private.catalog_identity_v1 VALUES('product',md5('catalogue-forbidden-evidence')::uuid,'unused',1,NULL)$q$,'42501','raw evidence INSERT denied');
    PERFORM pg_temp.foundation_raises($q$UPDATE private.catalog_identity_v1 SET lifetime_state='unused'$q$,'42501','raw evidence UPDATE denied');
    PERFORM pg_temp.foundation_raises('DELETE FROM private.catalog_identity_v1','42501','raw evidence DELETE denied');
    PERFORM pg_temp.foundation_raises('UPDATE private.catalog_cutover_v1 SET tracking_ready=true','42501','raw cutover UPDATE denied');
    PERFORM pg_temp.foundation_raises('TRUNCATE TABLE private.catalog_identity_v1','42501','raw evidence TRUNCATE denied');
    PERFORM pg_temp.foundation_raises($q$INSERT INTO public.customers(name,catalog_version) VALUES('Fictional forbidden',42)$q$,'42501','raw customer version INSERT denied');
    PERFORM pg_temp.foundation_raises($q$UPDATE public.customers SET catalog_version=42 WHERE id=md5('catalogue-existing-customer')::uuid$q$,'42501','raw customer version UPDATE denied');
    PERFORM pg_temp.foundation_raises($q$INSERT INTO public.products(name,sku,is_enabled) VALUES('Fictional forbidden','CATALOGUE-FORBIDDEN',false)$q$,'42501','raw product activation INSERT denied');
    PERFORM pg_temp.foundation_raises($q$UPDATE public.products SET is_enabled=false WHERE id=md5('catalogue-existing-product')::uuid$q$,'42501','raw product activation UPDATE denied');
    PERFORM pg_temp.foundation_assert(NOT has_function_privilege(current_user,'private.catalog_master_before_v1()','EXECUTE')
      AND NOT has_function_privilege(current_user,'private.catalog_master_after_v1()','EXECUTE')
      AND NOT has_function_privilege(current_user,'private.catalog_identity_guard_v1()','EXECUTE')
      AND NOT has_function_privilege(current_user,'private.catalog_master_truncate_v1()','EXECUTE'),'private helper execution unavailable');
    PERFORM pg_temp.foundation_raises('DELETE FROM public.customers','42501','customer raw DELETE stays unavailable');
  END LOOP;
  FOR actor IN 4..9 LOOP
    PERFORM set_config('request.jwt.claim.sub',md5('catalogue-foundation-actor-'||actor)::uuid::text,true);
    PERFORM pg_temp.foundation_raises('SELECT public.pilot_procurement_access_v1()','42501','Sales/inactive/missing profile v1 refused');
    PERFORM pg_temp.foundation_raises('SELECT public.pilot_procurement_access_v2()','42501','Sales/inactive/missing profile v2 refused');
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM pg_temp.foundation_raises('SELECT public.pilot_procurement_access_v2()','42501','anonymous authenticated actor refused');
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.users SET role='po_admin' WHERE id=md5('catalogue-foundation-actor-1')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('catalogue-foundation-actor-1')::uuid::text,true);
SELECT pg_temp.foundation_assert(public.pilot_procurement_access_v2()->>'customer_delete_mode'='none'
  AND public.pilot_procurement_access_v2()->>'product_delete_mode'='direct','current role change invalidates prior CO delete authority');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.users SET is_active=false WHERE id=md5('catalogue-foundation-actor-1')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('catalogue-foundation-actor-1')::uuid::text,true);
SELECT pg_temp.foundation_raises('SELECT public.pilot_procurement_access_v2()','42501','current inactive actor refused');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.foundation_raises('SELECT public.pilot_procurement_access_v1()','42501','anon v1 execute denied');
SELECT pg_temp.foundation_raises('SELECT public.pilot_procurement_access_v2()','42501','anon v2 execute denied');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
-- Marker placement belongs to the verified runner, after every required suite passes.
