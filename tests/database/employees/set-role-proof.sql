-- Fixed rollback-only SET-chain metadata proof. No application grants or HR row reads.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
DO $$ BEGIN
 IF current_user<>'postgres' OR current_database()<>'pilot_test'
 OR inet_server_addr()<>'127.0.0.1'::inet
 OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci')
 OR to_regclass('private.employee_records') IS NULL
 OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('employee_hr_set_only_probe_20261019','employee_hr_set_bridge_probe_20261019'))
 THEN RAISE EXCEPTION 'EMPLOYEE_SET_PROOF_TARGET_OR_COLLISION'; END IF;
END $$;
\ir ../../../sql/employee-foundation/topology.sql
\ir ../../../sql/employee-foundation/catalog.sql
\ir ../../../sql/employee-foundation/effective-access.sql
CREATE TEMP TABLE employee_set_before ON COMMIT DROP AS SELECT pg_temp.employee_catalog(true) value;
CREATE ROLE employee_hr_set_only_probe_20261019 NOLOGIN NOINHERIT;
CREATE ROLE employee_hr_set_bridge_probe_20261019 NOLOGIN NOINHERIT;
GRANT employee_hr_set_bridge_probe_20261019 TO employee_hr_set_only_probe_20261019 WITH INHERIT FALSE, SET TRUE;
GRANT pg_read_all_data TO employee_hr_set_bridge_probe_20261019 WITH INHERIT FALSE, SET TRUE;
DO $$ BEGIN
 IF pg_has_role('employee_hr_set_only_probe_20261019','pg_read_all_data','USAGE')
 OR has_table_privilege('employee_hr_set_only_probe_20261019','private.employee_records','SELECT')
 OR has_any_column_privilege('employee_hr_set_only_probe_20261019','private.employee_records','SELECT')
 OR NOT pg_has_role('employee_hr_set_only_probe_20261019','pg_read_all_data','SET')
 OR NOT has_table_privilege('pg_read_all_data','private.employee_records','SELECT')
 OR NOT has_any_column_privilege('pg_read_all_data','private.employee_records','SELECT')
 THEN RAISE EXCEPTION 'EMPLOYEE_SET_PROBE_METADATA_NOT_ESTABLISHED'; END IF;
 IF (SELECT value IS DISTINCT FROM pg_temp.employee_catalog(true) FROM employee_set_before)
 THEN RAISE EXCEPTION 'EMPLOYEE_SET_PROBE_CHANGED_DIRECT_ACL'; END IF;
 IF NOT pg_temp.employee_unsafe_table_access('employee_hr_set_only_probe_20261019')
 THEN RAISE EXCEPTION 'EMPLOYEE_SET_REACHABLE_TABLE_ACCESS_NOT_REJECTED'; END IF;
END $$;
DO $$ DECLARE c record; BEGIN
 IF pg_temp.employee_effective_roles('employee_hr_set_only_probe_20261019') IS DISTINCT FROM
 ARRAY['employee_hr_set_bridge_probe_20261019','employee_hr_set_only_probe_20261019','pg_read_all_data']::name[]
 OR pg_temp.employee_effective_roles('public') IS DISTINCT FROM ARRAY['public']::name[]
 OR NOT ('anon'::name=ANY(pg_temp.employee_effective_roles('anon')))
 THEN RAISE EXCEPTION 'EMPLOYEE_SET_CLOSURE_OR_PUBLIC_MISMATCH'; END IF;
 -- Exercise the same pure function-access decision used by the production gate.
 -- No function grants or application memberships are changed for these cases.
 FOR c IN SELECT * FROM (VALUES
  ('public','public','active',true,false,true),
  ('public','public','active',true,true,false),
  ('anon','employee_hr_set_bridge_probe_20261019','active',true,true,false),
  ('anon','employee_hr_set_bridge_probe_20261019','active',true,false,true),
  ('service_role','employee_hr_set_bridge_probe_20261019','active',true,true,false),
  ('service_role','employee_hr_set_bridge_probe_20261019','active',true,false,true),
  ('authenticated','authenticated','active',true,true,true),
  ('authenticated','authenticated','active',true,false,false),
  ('authenticated','employee_hr_set_bridge_probe_20261019','active',true,false,true),
  ('authenticated','employee_hr_set_bridge_probe_20261019','active',true,true,true),
  ('authenticated','authenticated','disabled',true,true,false),
  ('authenticated','authenticated','disabled',true,false,true),
  ('authenticated','employee_hr_set_bridge_probe_20261019','disabled',true,true,false),
  ('authenticated','employee_hr_set_bridge_probe_20261019','disabled',true,false,true),
  ('public','public','disabled',true,true,false),
  ('anon','employee_hr_set_bridge_probe_20261019','disabled',true,true,false),
  ('service_role','employee_hr_set_bridge_probe_20261019','disabled',true,true,false),
  ('authenticated','employee_hr_set_bridge_probe_20261019','active',false,true,false),
  ('authenticated','employee_hr_set_bridge_probe_20261019','active',false,false,true),
  ('authenticated','authenticated','active',false,true,false),
  ('public','public','active',false,true,false),
  ('anon','employee_hr_set_bridge_probe_20261019','active',false,true,false),
  ('service_role','employee_hr_set_bridge_probe_20261019','disabled',false,true,false),
  ('authenticated','authenticated','unknown',true,true,false),
  ('authenticated','authenticated','active',true,NULL,false),
  (NULL,'authenticated','active',true,true,false),
  ('authenticated',NULL,'active',true,true,false)
 ) AS cases(app_role,effective_role,mode,is_entrypoint,can_execute,expected) LOOP
  IF pg_temp.employee_function_access_safe(c.app_role::name,c.effective_role::name,c.mode,c.is_entrypoint,c.can_execute) IS DISTINCT FROM c.expected
  THEN RAISE EXCEPTION 'EMPLOYEE_FUNCTION_CLOSURE_POLICY_MISMATCH: %',row_to_json(c); END IF;
 END LOOP;
END $$;
ROLLBACK;
SELECT 'EMPLOYEE_SET_REACHABLE_TABLE_ACCESS_REJECTED';
