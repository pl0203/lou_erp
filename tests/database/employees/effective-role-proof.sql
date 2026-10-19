-- Fixed rollback-only inherited-read probe. No application role or real data changes.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
DO $$ BEGIN
 IF current_user<>'postgres' OR current_database()<>'pilot_test'
 OR inet_server_addr()<>'127.0.0.1'::inet
 OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci')
 OR to_regclass('private.employee_records') IS NULL
 OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='employee_hr_inherited_read_probe_20261019')
 THEN RAISE EXCEPTION 'EMPLOYEE_EFFECTIVE_PROOF_TARGET_OR_COLLISION'; END IF;
END $$;
\ir ../../../sql/employee-foundation/topology.sql
\ir ../../../sql/employee-foundation/catalog.sql
\ir ../../../sql/employee-foundation/effective-access.sql
CREATE TEMP TABLE employee_effective_before ON COMMIT DROP AS SELECT pg_temp.employee_catalog(true) value;
CREATE ROLE employee_hr_inherited_read_probe_20261019 NOLOGIN;
GRANT pg_read_all_data TO employee_hr_inherited_read_probe_20261019 WITH INHERIT TRUE, SET FALSE;
DO $$ BEGIN
 IF NOT pg_has_role('employee_hr_inherited_read_probe_20261019','pg_read_all_data','USAGE')
 OR NOT has_table_privilege('employee_hr_inherited_read_probe_20261019','private.employee_records','SELECT')
 OR NOT has_any_column_privilege('employee_hr_inherited_read_probe_20261019','private.employee_records','SELECT')
 THEN RAISE EXCEPTION 'EMPLOYEE_EFFECTIVE_PROBE_PERMISSION_NOT_ESTABLISHED'; END IF;
 IF (SELECT value IS DISTINCT FROM pg_temp.employee_catalog(true) FROM employee_effective_before)
 THEN RAISE EXCEPTION 'EMPLOYEE_EFFECTIVE_PROBE_CHANGED_DIRECT_ACL'; END IF;
 IF NOT pg_temp.employee_unsafe_table_access('employee_hr_inherited_read_probe_20261019')
 THEN RAISE EXCEPTION 'EMPLOYEE_INHERITED_TABLE_ACCESS_NOT_REJECTED'; END IF;
END $$;
ROLLBACK;
SELECT 'EMPLOYEE_INHERITED_TABLE_ACCESS_REJECTED';
