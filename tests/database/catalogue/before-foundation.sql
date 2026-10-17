-- Prechange synthetic capture. The runner owns the one transaction and exact identity gate.
CREATE FUNCTION pg_temp.foundation_assert(ok boolean, label text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Foundation assertion failed: %', label; END IF; END $$;
CREATE FUNCTION pg_temp.foundation_raises(statement text, expected_state text, label text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE actual text;
BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual = RETURNED_SQLSTATE; END;
  IF actual IS DISTINCT FROM expected_state THEN RAISE EXCEPTION '%: expected %, got %', label, expected_state, coalesce(actual, 'success'); END IF;
END $$;
-- Every probe rolls back its own attempted write, including successful writes.
CREATE FUNCTION pg_temp.foundation_probe(statement text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE affected bigint; outcome jsonb;
BEGIN
  IF current_user <> 'authenticated' OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Actual application role required';
  END IF;
  IF NOT pg_catalog.row_security_active('public.customers') OR NOT pg_catalog.row_security_active('public.products') THEN
    RAISE EXCEPTION 'Actual application role must have active RLS';
  END IF;
  BEGIN
    BEGIN
      EXECUTE statement;
      GET DIAGNOSTICS affected = ROW_COUNT;
      outcome := jsonb_build_object('state', '00000', 'rows', affected);
    EXCEPTION WHEN OTHERS THEN outcome := jsonb_build_object('state', SQLSTATE); END;
    RAISE EXCEPTION 'Rollback probe' USING ERRCODE = 'PZ001';
  EXCEPTION WHEN SQLSTATE 'PZ001' THEN RETURN outcome; END;
END $$;
DO $$ DECLARE ns text; BEGIN
  SELECT nspname INTO STRICT ns FROM pg_namespace WHERE oid = pg_my_temp_schema();
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO authenticated, anon', ns);
  EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM PUBLIC', ns);
  EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO authenticated, anon', ns);
END $$;

INSERT INTO auth.users(id) SELECT md5('catalogue-foundation-actor-' || n)::uuid FROM generate_series(1, 9) n;
INSERT INTO public.users(id, full_name, email, role, is_active)
SELECT md5('catalogue-foundation-actor-' || n)::uuid, 'Fictional catalogue actor ' || n,
  'catalogue-' || n || '@example.invalid',
  (ARRAY['co_admin', 'po_admin', 'executive', 'sales_person', 'sales_manager', 'sales_head', 'co_admin', NULL, 'sales_person'])[n]::public.user_role, n NOT IN (7,9)
FROM generate_series(1, 9) n WHERE n<>8;
INSERT INTO public.customers(id, name, customer_category) VALUES
  (md5('catalogue-existing-customer')::uuid, 'Fictional prechange customer', 'perorangan');
INSERT INTO public.products(id, name, sku) VALUES
  (md5('catalogue-existing-product')::uuid, 'Fictional prechange product', 'CATALOGUE-EXISTING');

UPDATE public.users SET manager_id=md5('catalogue-foundation-actor-5')::uuid WHERE id=md5('catalogue-foundation-actor-4')::uuid;
INSERT INTO public.customers(id,name,customer_category) VALUES
 (md5('catalogue-salesperson-customer')::uuid,'Fictional salesperson customer','perorangan'),
 (md5('catalogue-manager-customer')::uuid,'Fictional manager customer','perorangan');
INSERT INTO public.customer_manager_assignments(customer_id,manager_id,assigned_by) VALUES
 (md5('catalogue-salesperson-customer')::uuid,md5('catalogue-foundation-actor-4')::uuid,md5('catalogue-foundation-actor-3')::uuid),
 (md5('catalogue-manager-customer')::uuid,md5('catalogue-foundation-actor-5')::uuid,md5('catalogue-foundation-actor-3')::uuid);

INSERT INTO public.customer_targets(customer_id,year_month,target_value,set_by)
VALUES(md5('catalogue-salesperson-customer')::uuid,'2030-02',1,md5('catalogue-foundation-actor-3')::uuid);
INSERT INTO public.sales_targets(user_id,year_month,target_value,set_by)
SELECT md5('catalogue-foundation-actor-'||n)::uuid,'2030-02',1,md5('catalogue-foundation-actor-3')::uuid FROM generate_series(1,7) n;

-- A prechange inherited broad grant must be converted without exposing new
-- server columns, and its legacy column edge must remain independently effective.
CREATE ROLE catalogue_foundation_inherited_probe NOLOGIN;
GRANT catalogue_foundation_inherited_probe TO authenticated WITH INHERIT TRUE;
GRANT UPDATE ON public.products TO catalogue_foundation_inherited_probe;
SELECT pg_temp.foundation_assert(has_table_privilege('catalogue_foundation_inherited_probe','public.products','UPDATE'),'inherited broad prechange grant exists');
CREATE TEMP TABLE catalogue_legacy_column_privileges_v1 ON COMMIT DROP AS
SELECT r.rolname AS principal, n.nspname || '.' || c.relname AS relation,
  a.attname AS column_name, p.privilege,
  has_column_privilege(r.rolname, c.oid, a.attnum, p.privilege) AS allowed
FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('SELECT'), ('REFERENCES')) p(privilege)
WHERE r.rolname IN ('anon', 'authenticated', 'service_role', 'catalogue_foundation_inherited_probe')
  AND n.nspname = 'public' AND c.relname IN ('customers', 'products');
CREATE TEMP TABLE catalogue_legacy_delete_privileges_v1 ON COMMIT DROP AS
SELECT r.rolname AS principal, c.oid::regclass::text AS relation,
  has_table_privilege(r.rolname, c.oid, 'DELETE') AS allowed
FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE r.rolname IN ('anon', 'authenticated', 'service_role', 'catalogue_foundation_inherited_probe') AND n.nspname = 'public' AND c.relname IN ('customers', 'products');
CREATE TEMP TABLE catalogue_target_topology_v1 ON COMMIT DROP AS
SELECT c.oid, n.nspname AS schema_name, c.relname AS relation_name, c.relacl, c.relrowsecurity, c.relforcerowsecurity,
  to_jsonb(c)-ARRAY['relpages','reltuples','relallvisible','relallfrozen'] AS relation_metadata,
  (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM pg_rewrite r WHERE r.ev_class=c.oid) AS rules,
  (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.classid,d.objid,d.objsubid,d.refclassid,d.refobjid,d.refobjsubid,d.deptype) FROM pg_depend d WHERE (d.classid='pg_class'::regclass AND d.objid=c.oid) OR (d.refclassid='pg_class'::regclass AND d.refobjid=c.oid)) AS dependencies,
  (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
  (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid = c.oid) AS columns,
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid = c.oid) AS triggers,
  (SELECT jsonb_agg(to_jsonb(k) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid = c.oid OR k.confrelid = c.oid) AS constraints,
  (SELECT jsonb_agg(jsonb_build_object('metadata',to_jsonb(i),'definition',pg_get_indexdef(i.indexrelid)) ORDER BY i.indexrelid) FROM pg_index i WHERE i.indrelid=c.oid) AS indexes,
  (SELECT jsonb_agg(jsonb_build_object('column',d.adnum,'definition',pg_get_expr(d.adbin,d.adrelid)) ORDER BY d.adnum) FROM pg_attrdef d WHERE d.adrelid=c.oid) AS defaults
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('customer_targets', 'sales_targets');
SELECT pg_temp.foundation_assert((SELECT count(*)=2 FROM catalogue_target_topology_v1),'both baseline target relations required');
CREATE TEMP TABLE catalogue_target_column_privileges_v1 ON COMMIT DROP AS
SELECT r.rolname AS principal,n.nspname||'.'||c.relname AS relation,a.attname AS column_name,p.privilege,
 has_column_privilege(r.rolname,c.oid,a.attnum,p.privilege) AS allowed
FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('SELECT'),('REFERENCES')) p(privilege)
WHERE r.rolname IN ('anon','authenticated','service_role') AND n.nspname='public' AND c.relname IN ('customer_targets','sales_targets');
CREATE TEMP TABLE catalogue_target_table_privileges_v1 ON COMMIT DROP AS
SELECT r.rolname AS principal,n.nspname||'.'||c.relname AS relation,p.privilege,
 has_table_privilege(r.rolname,c.oid,p.privilege) AS allowed
FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('SELECT'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(privilege)
WHERE r.rolname IN ('anon','authenticated','service_role') AND n.nspname='public' AND c.relname IN ('customer_targets','sales_targets');
-- Before the reference-writer phase, foundation may replace only capability v1.
-- Snapshot all other existing helpers conservatively, including PL/pgSQL bodies
-- whose called-function dependencies are not fully represented in pg_depend.
CREATE TEMP TABLE catalogue_foundation_function_topology_v1 ON COMMIT DROP AS
SELECT p.oid,to_jsonb(p) AS metadata,pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','private') AND p.prokind IN ('f','p')
 AND NOT (n.nspname='public' AND p.proname='pilot_procurement_access_v1');
CREATE TEMP TABLE catalogue_v1_metadata_before_v1 ON COMMIT DROP AS
 SELECT p.oid,to_jsonb(p)-'prosrc' AS metadata FROM pg_proc p WHERE p.oid='public.pilot_procurement_access_v1()'::regprocedure;
CREATE TEMP TABLE catalogue_v1_execute_before_v1 ON COMMIT DROP AS
 SELECT r.rolname,has_function_privilege(r.rolname,'public.pilot_procurement_access_v1()','EXECUTE') AS allowed
 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role');
CREATE TEMP TABLE catalogue_legacy_probe_cases_v1(actor integer, case_name text, statement text, baseline jsonb) ON COMMIT DROP;
INSERT INTO catalogue_legacy_probe_cases_v1(actor, case_name, statement)
SELECT actor, test.case_name, test.statement FROM generate_series(1, 9) actor CROSS JOIN (VALUES
 ('raw-customer-assigned-read', $$SELECT id FROM public.customers WHERE id=md5('catalogue-salesperson-customer')::uuid$$),
 ('raw-customer-manager-read', $$SELECT id FROM public.customers WHERE id=md5('catalogue-manager-customer')::uuid$$),
 ('raw-customer-create', $$INSERT INTO public.customers(id,name,visit_frequency_days,customer_category) VALUES(md5('catalogue-legacy-customer-probe')::uuid,'Fictional probe',3,'perorangan')$$),
 ('raw-customer-edit', $$UPDATE public.customers SET name='Fictional edited',visit_frequency_days=14,last_visit_date='2026-01-01' WHERE id=md5('catalogue-existing-customer')::uuid$$),
 ('raw-customer-assigned-edit', $$UPDATE public.customers SET visit_frequency_days=14,last_visit_date='2026-01-01' WHERE id=md5('catalogue-salesperson-customer')::uuid$$),
 ('raw-customer-manager-edit', $$UPDATE public.customers SET visit_frequency_days=14 WHERE id=md5('catalogue-manager-customer')::uuid$$),
 ('raw-customer-target-create', $$INSERT INTO public.customer_targets(customer_id,year_month,target_value,set_by) VALUES(md5('catalogue-salesperson-customer')::uuid,'2030-01',42,auth.uid())$$),
 ('raw-sales-target-create', $$INSERT INTO public.sales_targets(user_id,year_month,target_value,set_by) VALUES(auth.uid(),'2030-01',42,auth.uid())$$),
 ('raw-customer-target-upsert', $$INSERT INTO public.customer_targets(customer_id,year_month,target_value,set_by,updated_at) VALUES(md5('catalogue-salesperson-customer')::uuid,'2030-02',42,auth.uid(),statement_timestamp()) ON CONFLICT(customer_id,year_month) DO UPDATE SET target_value=EXCLUDED.target_value,set_by=EXCLUDED.set_by,updated_at=EXCLUDED.updated_at$$),
 ('raw-sales-target-upsert', $$INSERT INTO public.sales_targets(user_id,year_month,target_value,set_by,updated_at) VALUES(auth.uid(),'2030-02',42,auth.uid(),statement_timestamp()) ON CONFLICT(user_id,year_month) DO UPDATE SET target_value=EXCLUDED.target_value,set_by=EXCLUDED.set_by,updated_at=EXCLUDED.updated_at$$),
 ('raw-product-create', $$INSERT INTO public.products(id,name,sku,unit_price) VALUES(md5('catalogue-legacy-product-probe')::uuid,'Fictional probe','CATALOGUE-LEGACY-PROBE',0)$$),
 ('raw-product-edit', $$UPDATE public.products SET name='Fictional edited',unit_price=0,luar_kota=NULL WHERE id=md5('catalogue-existing-product')::uuid$$),
 ('raw-product-delete', $$DELETE FROM public.products WHERE id=md5('catalogue-existing-product')::uuid$$),
 ('raw-customer-delete', $$DELETE FROM public.customers WHERE id=md5('catalogue-existing-customer')::uuid$$)
) test(case_name, statement);
GRANT SELECT, UPDATE ON catalogue_legacy_probe_cases_v1 TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ DECLARE test record; BEGIN
  FOR test IN SELECT * FROM pg_temp.catalogue_legacy_probe_cases_v1 LOOP
    PERFORM set_config('request.jwt.claim.sub', md5('catalogue-foundation-actor-' || test.actor)::uuid::text, true);
    UPDATE pg_temp.catalogue_legacy_probe_cases_v1 SET baseline = pg_temp.foundation_probe(test.statement)
      WHERE actor = test.actor AND case_name = test.case_name;
  END LOOP;
END $$;
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT count(*)=3 AND bool_and(baseline='{"state":"00000","rows":1}'::jsonb)
 FROM catalogue_legacy_probe_cases_v1 WHERE (actor=4 AND case_name='raw-customer-assigned-edit') OR
 (actor=5 AND case_name IN ('raw-customer-assigned-edit','raw-customer-manager-edit'))), 'positive salesperson/manager baseline writes required');
SELECT pg_temp.foundation_assert((SELECT baseline='{"state":"00000","rows":0}'::jsonb FROM catalogue_legacy_probe_cases_v1
 WHERE actor=4 AND case_name='raw-customer-manager-edit'),'salesperson out-of-scope baseline remains zero rows');
SELECT pg_temp.foundation_assert((SELECT count(*)=4 AND bool_and(baseline='{"state":"00000","rows":1}'::jsonb)
 FROM catalogue_legacy_probe_cases_v1 WHERE actor=3 AND case_name IN ('raw-customer-target-create','raw-sales-target-create','raw-customer-target-upsert','raw-sales-target-upsert')),'positive Executive raw target API baseline required');
SELECT pg_temp.foundation_assert((SELECT count(*)=2 AND bool_and(baseline='{"state":"00000","rows":0}'::jsonb)
 FROM catalogue_legacy_probe_cases_v1 WHERE actor=9 AND case_name IN ('raw-customer-assigned-edit','raw-customer-manager-edit')),'inactive salesperson baseline edits denied');
SELECT pg_temp.foundation_assert((SELECT baseline='{"state":"42501"}'::jsonb FROM catalogue_legacy_probe_cases_v1 WHERE actor=9 AND case_name='raw-customer-create'),'inactive salesperson baseline create denied');
CREATE TEMP TABLE catalogue_memberships_before_v1 ON COMMIT DROP AS SELECT to_jsonb(m) AS metadata FROM pg_auth_members m;
CREATE TEMP TABLE catalogue_roles_before_v1 ON COMMIT DROP AS SELECT to_jsonb(r) AS metadata FROM pg_roles r;
SELECT set_config('request.jwt.claim.sub', '', true);
-- Do not commit. The reviewed harness must next apply its exact candidate and run the postchange suites in this session.
