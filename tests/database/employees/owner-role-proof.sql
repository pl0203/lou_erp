-- Fixed synthetic rollback-only proof. Never changes an application role.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
DO $$ BEGIN
 IF current_user<>'postgres' OR current_database()<>'pilot_test'
 OR inet_server_addr()<>'127.0.0.1'::inet
 OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci')
 OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='employee_hr_noinherit_owner_probe_20261019')
 THEN RAISE EXCEPTION 'EMPLOYEE_ROLE_PROOF_TARGET_OR_COLLISION'; END IF;
END $$;
\ir ../../../sql/employee-foundation/owner-roles.sql
CREATE ROLE employee_hr_noinherit_owner_probe_20261019 NOLOGIN NOINHERIT;
GRANT postgres TO employee_hr_noinherit_owner_probe_20261019 WITH INHERIT FALSE, SET TRUE;
DO $$ BEGIN
 IF pg_has_role('employee_hr_noinherit_owner_probe_20261019','postgres','USAGE')
 OR NOT pg_has_role('employee_hr_noinherit_owner_probe_20261019','postgres','SET')
 OR NOT pg_has_role('employee_hr_noinherit_owner_probe_20261019','postgres','MEMBER')
 THEN RAISE EXCEPTION 'EMPLOYEE_ROLE_PROOF_MEMBERSHIP_NOT_ESTABLISHED'; END IF;
 IF NOT pg_temp.employee_unsafe_app_owner('employee_hr_noinherit_owner_probe_20261019'::regrole)
 THEN RAISE EXCEPTION 'EMPLOYEE_NOINHERIT_OWNER_MEMBERSHIP_NOT_REJECTED'; END IF;
END $$;
ROLLBACK;
SELECT 'EMPLOYEE_NOINHERIT_OWNER_MEMBERSHIP_REJECTED';
