-- Fixed synthetic source-manifest generation, rollback only.
BEGIN;
DO $$ BEGIN IF current_database()<>'pilot_test' OR current_user<>'postgres' OR inet_server_addr() NOT IN('127.0.0.1'::inet,'::1'::inet)
 OR (SELECT count(*)<>1 FROM public.pilot_fixture_marker) OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci')
 THEN RAISE EXCEPTION 'Synthetic marker required'; END IF; END $$;
\ir ../../../sql/employee-foundation-schema.sql
\ir ../../../sql/employee-foundation-commands.sql
\ir ../../../sql/employee-foundation-reporting.sql
\ir ../../../sql/employee-foundation/topology.sql
\ir ../../../sql/employee-foundation/catalog.sql
SELECT 'EMPLOYEE_CATALOG|'||pg_temp.employee_catalog(true)::text;
SELECT 'EMPLOYEE_ACTIVE_DIGEST|'||encode(sha256(convert_to(pg_temp.employee_catalog(true)::text,'UTF8')),'hex');
REVOKE ALL ON FUNCTION public.employee_context_v1() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.employee_context_impl_v1() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.employee_page_v1(text,text,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.employee_page_impl_v1(text,text,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.employee_detail_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.employee_detail_impl_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.employee_audit_v1(uuid,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.employee_audit_impl_v1(uuid,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.employee_account_candidates_v1(text,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.employee_account_candidates_impl_v1(text,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.employee_preview_v1(uuid,bigint,text,jsonb,text,date,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.employee_preview_impl_v1(uuid,bigint,text,jsonb,text,date,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.employee_command_v1(uuid,uuid,bigint,text,jsonb,text,date,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.employee_command_impl_v1(uuid,uuid,bigint,text,jsonb,text,date,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.employee_operation_v1(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.employee_operation_impl_v1(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
SELECT 'EMPLOYEE_DISABLED_DIGEST|'||encode(sha256(convert_to(pg_temp.employee_catalog(true)::text,'UTF8')),'hex');
ROLLBACK;
\echo EMPLOYEE_CATALOG_ROLLED_BACK
