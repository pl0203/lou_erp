-- Same identity-bound, rollback-only session as before-foundation.sql.
DO $$ DECLARE expected record; actual boolean; BEGIN
  FOR expected IN SELECT * FROM pg_temp.catalogue_legacy_column_privileges_v1 LOOP
    SELECT has_column_privilege(expected.principal, expected.relation, expected.column_name, expected.privilege) INTO actual;
    PERFORM pg_temp.foundation_assert(actual IS NOT DISTINCT FROM expected.allowed,
      'CATALOG_LEGACY_COLUMN_PRIVILEGE_DRIFT: ' || expected.principal || ' ' || expected.relation || '.' || expected.column_name || ' ' || expected.privilege);
  END LOOP;
  FOR expected IN SELECT * FROM pg_temp.catalogue_legacy_delete_privileges_v1 LOOP
    PERFORM pg_temp.foundation_assert(has_table_privilege(expected.principal, expected.relation, 'DELETE') IS NOT DISTINCT FROM expected.allowed,
      'Legacy DELETE grant changed: ' || expected.principal || ' ' || expected.relation);
  END LOOP;
END $$;
SELECT pg_temp.foundation_assert(NOT has_table_privilege('authenticated', 'public.customers', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.customers', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.products', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.products', 'UPDATE'), 'client writes use exact column grants');
SELECT pg_temp.foundation_assert(NOT EXISTS(
  SELECT 1 FROM unnest(ARRAY['anon','authenticated']) r
  CROSS JOIN unnest(ARRAY['public.customers','public.products']) t
  CROSS JOIN unnest(ARRAY['is_enabled','catalog_version']) c
  CROSS JOIN unnest(ARRAY['INSERT','UPDATE']) p WHERE has_column_privilege(r,t,c,p)), 'server-owned columns unavailable to clients');
SELECT pg_temp.foundation_assert(NOT EXISTS(
 SELECT 1 FROM pg_temp.catalogue_target_topology_v1 expected
 LEFT JOIN pg_class c ON c.oid=expected.oid
 LEFT JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.oid IS NULL OR n.nspname IS DISTINCT FROM expected.schema_name OR c.relname IS DISTINCT FROM expected.relation_name
 OR c.relacl IS DISTINCT FROM expected.relacl OR c.relrowsecurity IS DISTINCT FROM expected.relrowsecurity
 OR c.relforcerowsecurity IS DISTINCT FROM expected.relforcerowsecurity
 OR (to_jsonb(c)-ARRAY['relpages','reltuples','relallvisible','relallfrozen']) IS DISTINCT FROM expected.relation_metadata
 OR (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM pg_rewrite r WHERE r.ev_class=c.oid) IS DISTINCT FROM expected.rules
 OR (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.classid,d.objid,d.objsubid,d.refclassid,d.refobjid,d.refobjsubid,d.deptype) FROM pg_depend d WHERE (d.classid='pg_class'::regclass AND d.objid=c.oid) OR (d.refclassid='pg_class'::regclass AND d.refobjid=c.oid)) IS DISTINCT FROM expected.dependencies
 OR (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid) IS DISTINCT FROM expected.policies
 OR (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid) IS DISTINCT FROM expected.columns
 OR (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid) IS DISTINCT FROM expected.triggers
 OR (SELECT jsonb_agg(to_jsonb(k) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=c.oid OR k.confrelid=c.oid) IS DISTINCT FROM expected.constraints
 OR (SELECT jsonb_agg(jsonb_build_object('metadata',to_jsonb(i),'definition',pg_get_indexdef(i.indexrelid)) ORDER BY i.indexrelid) FROM pg_index i WHERE i.indrelid=c.oid) IS DISTINCT FROM expected.indexes
 OR (SELECT jsonb_agg(jsonb_build_object('column',d.adnum,'definition',pg_get_expr(d.adbin,d.adrelid)) ORDER BY d.adnum) FROM pg_attrdef d WHERE d.adrelid=c.oid) IS DISTINCT FROM expected.defaults), 'target API/ACL/policy topology untouched');
SELECT pg_temp.foundation_assert((SELECT count(*)=2 FROM pg_temp.catalogue_target_topology_v1 expected
 JOIN pg_class c ON c.oid=expected.oid),'both original target relation OIDs retained');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM pg_temp.catalogue_target_column_privileges_v1 expected
 WHERE has_column_privilege(expected.principal,expected.relation,expected.column_name,expected.privilege) IS DISTINCT FROM expected.allowed), 'effective target column privileges unchanged');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM pg_temp.catalogue_target_table_privileges_v1 expected
 WHERE has_table_privilege(expected.principal,expected.relation,expected.privilege) IS DISTINCT FROM expected.allowed),'effective target table privileges unchanged');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM pg_temp.catalogue_foundation_function_topology_v1 expected
 LEFT JOIN pg_proc p ON p.oid=expected.oid WHERE p.oid IS NULL OR to_jsonb(p) IS DISTINCT FROM expected.metadata
 OR pg_get_functiondef(p.oid) IS DISTINCT FROM expected.definition),'foundation preserves all unrelated existing helper bodies and ACLs');
SELECT pg_temp.foundation_assert(NOT EXISTS(
 (SELECT metadata FROM pg_temp.catalogue_memberships_before_v1 EXCEPT SELECT to_jsonb(m) FROM pg_auth_members m)
 UNION ALL (SELECT to_jsonb(m) FROM pg_auth_members m EXCEPT SELECT metadata FROM pg_temp.catalogue_memberships_before_v1)), 'role inheritance paths unchanged');
SELECT pg_temp.foundation_assert(NOT EXISTS(
 (SELECT metadata FROM pg_temp.catalogue_roles_before_v1 EXCEPT SELECT to_jsonb(r) FROM pg_roles r)
 UNION ALL (SELECT to_jsonb(r) FROM pg_roles r EXCEPT SELECT metadata FROM pg_temp.catalogue_roles_before_v1)), 'existing role properties unchanged');
SET LOCAL ROLE authenticated;
DO $$ DECLARE test record; actual jsonb; BEGIN
  FOR test IN SELECT * FROM pg_temp.catalogue_legacy_probe_cases_v1 LOOP
    PERFORM set_config('request.jwt.claim.sub', md5('catalogue-foundation-actor-' || test.actor)::uuid::text, true);
    actual := pg_temp.foundation_probe(test.statement);
    IF test.actor=1 AND test.case_name IN ('raw-customer-create','raw-customer-edit','raw-customer-assigned-edit','raw-customer-manager-edit','raw-product-create','raw-product-edit') THEN
      PERFORM pg_temp.foundation_assert(actual = '{"state":"00000","rows":1}'::jsonb, 'active CO authorized legacy create/edit ' || test.case_name);
    ELSE
      PERFORM pg_temp.foundation_assert(actual = test.baseline, 'unchanged legacy role/row scope: actor ' || test.actor || ' ' || test.case_name);
    END IF;
  END LOOP;
END $$;
RESET ROLE;

-- One effective required-column removal at a time. A surviving table/inherited
-- grant is a fixture/probe failure, never evidence that the RPC denied access.
DO $$ DECLARE col record; v1 jsonb; v2 jsonb; capability text; BEGIN
  FOR col IN SELECT * FROM pg_temp.catalogue_legacy_column_privileges_v1
    WHERE principal='authenticated' AND privilege IN ('INSERT','UPDATE') AND allowed LOOP
    BEGIN
      EXECUTE format('REVOKE %s (%I) ON TABLE %s FROM authenticated', col.privilege, col.column_name, col.relation);
      IF col.relation='public.products' AND col.privilege='UPDATE' THEN
        EXECUTE format('REVOKE UPDATE (%I) ON TABLE public.products FROM catalogue_foundation_inherited_probe',col.column_name);
      END IF;
      PERFORM pg_temp.foundation_assert(NOT has_column_privilege('authenticated', col.relation, col.column_name, col.privilege),
        'Probe must remove every effective grant path for ' || col.relation || '.' || col.column_name);
      EXECUTE 'SET LOCAL ROLE authenticated';
      PERFORM set_config('request.jwt.claim.sub',md5('catalogue-foundation-actor-2')::uuid::text,true);
      SELECT public.pilot_procurement_access_v1(), public.pilot_procurement_access_v2() INTO v1,v2;
      capability := CASE col.relation WHEN 'public.customers' THEN 'customer_' ELSE 'product_' END
        || CASE col.privilege WHEN 'INSERT' THEN 'create' ELSE 'edit' END;
      PERFORM pg_temp.foundation_assert(v1->capability='false'::jsonb AND v2->capability='false'::jsonb,
        'Required effective column removal denies ' || capability || ': ' || col.column_name);
      IF col.privilege='UPDATE' THEN
        PERFORM pg_temp.foundation_assert(v2->(CASE col.relation WHEN 'public.customers' THEN 'customer_set_enabled' ELSE 'product_set_enabled' END)='false'::jsonb,
          'Activation follows effective edit permission');
        PERFORM set_config('request.jwt.claim.sub',md5('catalogue-foundation-actor-1')::uuid::text,true);
        SELECT public.pilot_procurement_access_v2() INTO v2;
        PERFORM pg_temp.foundation_assert(v2->>(CASE col.relation WHEN 'public.customers' THEN 'customer_delete_mode' ELSE 'product_delete_mode' END)='none',
          'CO guarded delete eligibility disappears with required edit privilege');
      END IF;
      EXECUTE 'RESET ROLE';
      RAISE EXCEPTION 'Rollback column-grant probe' USING ERRCODE='PZ002';
    EXCEPTION WHEN SQLSTATE 'PZ002' THEN NULL;
    END;
  END LOOP;
END $$;
SELECT set_config('request.jwt.claim.sub','',true);

-- The inherited role existed before migration with a broad UPDATE grant.
-- Conversion must retain its old-column privileges but deny both new fields.
SELECT pg_temp.foundation_assert(NOT has_table_privilege('catalogue_foundation_inherited_probe','public.products','UPDATE')
 AND has_column_privilege('catalogue_foundation_inherited_probe','public.products','name','UPDATE')
 AND NOT has_column_privilege('catalogue_foundation_inherited_probe','public.products','is_enabled','UPDATE')
 AND NOT has_column_privilege('catalogue_foundation_inherited_probe','public.products','catalog_version','UPDATE'),'inherited broad grant converted to legacy columns only');
REVOKE UPDATE(name) ON public.products FROM authenticated;
SELECT pg_temp.foundation_assert(has_column_privilege('authenticated','public.products','name','UPDATE'),'inherited column grant survives direct revoke');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('catalogue-foundation-actor-2')::uuid::text,true);
SELECT pg_temp.foundation_assert(public.pilot_procurement_access_v1()->'product_edit'='true'::jsonb AND public.pilot_procurement_access_v2()->'product_edit'='true'::jsonb,'capability reflects surviving inherited privilege');
RESET ROLE;
REVOKE UPDATE(name) ON public.products FROM catalogue_foundation_inherited_probe;
SELECT pg_temp.foundation_assert(NOT has_column_privilege('authenticated','public.products','name','UPDATE'),'all effective paths removed for inherited denial test');
SET LOCAL ROLE authenticated;
SELECT pg_temp.foundation_assert(public.pilot_procurement_access_v1()->'product_edit'='false'::jsonb AND public.pilot_procurement_access_v2()->'product_edit'='false'::jsonb,'capability refuses after final inherited path removed');
RESET ROLE;
GRANT UPDATE(name) ON public.products TO authenticated,catalogue_foundation_inherited_probe;
SELECT set_config('request.jwt.claim.sub','',true);

-- Direct product deletion is independently gated by the effective DELETE grant.
DO $$ DECLARE actor integer; v1 jsonb; v2 jsonb; BEGIN
 BEGIN
  REVOKE DELETE ON public.products FROM authenticated;
  EXECUTE 'SET LOCAL ROLE authenticated';
  FOR actor IN 2..3 LOOP
   PERFORM set_config('request.jwt.claim.sub',md5('catalogue-foundation-actor-'||actor)::uuid::text,true);
   SELECT public.pilot_procurement_access_v1(),public.pilot_procurement_access_v2() INTO v1,v2;
   PERFORM pg_temp.foundation_assert(v1->'product_delete'='false'::jsonb AND v2->'product_delete'='false'::jsonb
     AND v2->>'product_delete_mode'='none','direct product deletion requires current effective table privilege');
  END LOOP;
  EXECUTE 'RESET ROLE';
  RAISE EXCEPTION 'Rollback DELETE grant probe' USING ERRCODE='PZ003';
 EXCEPTION WHEN SQLSTATE 'PZ003' THEN NULL;
 END;
END $$;
SELECT set_config('request.jwt.claim.sub','',true);
