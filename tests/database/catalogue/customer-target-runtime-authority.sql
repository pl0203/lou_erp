-- Explicit expected role/activity classes, before roles.sql mutates actor 1.
SELECT pg_temp.foundation_assert(NOT EXISTS(
 SELECT 1 FROM (VALUES
 (1,'co_admin',true,true),(2,'po_admin',true,true),(3,'executive',true,true),
 (4,'sales_person',true,true),(5,'sales_manager',true,true),(6,'sales_head',true,true),
 (7,'co_admin',false,true),(8,NULL::text,NULL::boolean,false),(9,'sales_person',false,true)
 ) expected(actor,expected_role,expected_active,profile_exists)
 LEFT JOIN public.users u ON u.id=md5('catalogue-foundation-actor-'||expected.actor)::uuid
 WHERE (u.id IS NOT NULL) IS DISTINCT FROM expected.profile_exists
 OR (expected.profile_exists AND (u.role::text IS DISTINCT FROM expected.expected_role OR u.is_active IS DISTINCT FROM expected.expected_active))
),'actual nine actor role/activity classes retained');
-- Actual-role target write outcomes must match the frozen pre-foundation probes.
SET LOCAL ROLE authenticated;
DO $$ DECLARE test record; actual jsonb; BEGIN
  IF current_user<>'authenticated' OR NOT row_security_active('public.customer_targets') THEN
    RAISE EXCEPTION 'Actual target RLS actor required';
  END IF;
  FOR test IN SELECT * FROM pg_temp.catalogue_legacy_probe_cases_v1 WHERE case_name LIKE 'raw-customer-target-%' LOOP
    PERFORM set_config('request.jwt.claim.sub',md5('catalogue-foundation-actor-'||test.actor)::uuid::text,true);
    actual:=pg_temp.foundation_probe(test.statement);
    PERFORM pg_temp.foundation_assert(actual=test.baseline,'raw target role outcomes unchanged');
  END LOOP;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT pg_temp.foundation_assert((SELECT count(DISTINCT actor)=9 FROM pg_temp.catalogue_legacy_probe_cases_v1 WHERE case_name LIKE 'raw-customer-target-%'),'all nine target actor classes exercised');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM pg_temp.catalogue_target_column_privileges_v1 expected WHERE has_column_privilege(expected.principal,expected.relation,expected.column_name,expected.privilege) IS DISTINCT FROM expected.allowed),'effective target column privileges unchanged');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM pg_temp.catalogue_target_table_privileges_v1 expected WHERE has_table_privilege(expected.principal,expected.relation,expected.privilege) IS DISTINCT FROM expected.allowed),'effective target table privileges unchanged');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) r CROSS JOIN unnest(ARRAY['private.catalog_customer_targets_mark_v1()','private.catalog_customer_targets_assert_v1()']) f WHERE has_function_privilege(r,f,'EXECUTE')),'target functions are not client entrypoints');
