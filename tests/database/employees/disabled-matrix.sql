-- Real-role ACL denial, including private implementations and service_role.
-- No app authority helper is weakened for service_role; this separate fixed probe
-- asserts ACL SQLSTATE and effective privilege independently of RLS bypass.
BEGIN;
\ir ../../../sql/employee-foundation/topology.sql
CREATE FUNCTION pg_temp.employee_expect_acl(statement text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE code text; BEGIN
 IF current_user NOT IN('authenticated','anon','service_role') OR (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) THEN RAISE EXCEPTION 'Actual application role required'; END IF;
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE; END;
 IF code IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'EMPLOYEE_DISABLED_CALL_NOT_DENIED: % returned %',statement,code; END IF;
END $$;
CREATE TEMP TABLE employee_disabled_calls(statement text);
INSERT INTO employee_disabled_calls VALUES
 ('SELECT public.employee_context_v1()'),('SELECT private.employee_context_impl_v1()'),
 ($q$SELECT public.employee_page_v1('',NULL,1,25)$q$),($q$SELECT private.employee_page_impl_v1('',NULL,1,25)$q$),
 ($q$SELECT public.employee_detail_v1('97000000-0000-0000-0000-000000000001')$q$),($q$SELECT private.employee_detail_impl_v1('97000000-0000-0000-0000-000000000001')$q$),
 ($q$SELECT public.employee_audit_v1('97000000-0000-0000-0000-000000000001',1,25)$q$),($q$SELECT private.employee_audit_impl_v1('97000000-0000-0000-0000-000000000001',1,25)$q$),
 ($q$SELECT public.employee_account_candidates_v1('',1,25)$q$),($q$SELECT private.employee_account_candidates_impl_v1('',1,25)$q$),
 ($q$SELECT public.employee_preview_v1('97000000-0000-0000-0000-000000000001',8,'edit_employee','{"name":"Synthetic","employeeNumber":null,"jobTitle":null,"team":null,"recordedStatus":"draft"}','Synthetic',NULL,NULL)$q$),
 ($q$SELECT private.employee_preview_impl_v1('97000000-0000-0000-0000-000000000001',8,'edit_employee','{"name":"Synthetic","employeeNumber":null,"jobTitle":null,"team":null,"recordedStatus":"draft"}','Synthetic',NULL,NULL)$q$),
 ($q$SELECT public.employee_command_v1('98000000-0000-0000-0000-000000000100','97000000-0000-0000-0000-000000000001',8,'edit_employee','{"name":"Synthetic","employeeNumber":null,"jobTitle":null,"team":null,"recordedStatus":"draft"}','Synthetic',NULL,NULL,repeat('a',64))$q$),
 ($q$SELECT private.employee_command_impl_v1('98000000-0000-0000-0000-000000000100','97000000-0000-0000-0000-000000000001',8,'edit_employee','{"name":"Synthetic","employeeNumber":null,"jobTitle":null,"team":null,"recordedStatus":"draft"}','Synthetic',NULL,NULL,repeat('a',64))$q$),
 ($q$SELECT public.employee_operation_v1('98000000-0000-0000-0000-000000000001','read')$q$),($q$SELECT private.employee_operation_impl_v1('98000000-0000-0000-0000-000000000001','read')$q$),
 ($q$SELECT public.employee_operation_v1('98000000-0000-0000-0000-000000000099','abandon')$q$),($q$SELECT private.employee_operation_impl_v1('98000000-0000-0000-0000-000000000099','abandon')$q$),
 ('SELECT private.employee_require_director()'),('SELECT private.employee_lock_actor()'),
 ($q$SELECT private.employee_lock_operation('95000000-0000-0000-0000-000000000004','98000000-0000-0000-0000-000000000001')$q$),
 ($q$SELECT private.employee_prepare('{}')$q$),($q$SELECT private.employee_reporting_prepare('{}')$q$),
 ($q$SELECT private.employee_reporting_apply('97000000-0000-0000-0000-000000000001','{}','95000000-0000-0000-0000-000000000004','Synthetic')$q$);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY pg_temp.employee_tables() LOOP
 INSERT INTO employee_disabled_calls VALUES('SELECT * FROM '||t),('INSERT INTO '||t||' DEFAULT VALUES'),('DELETE FROM '||t),('TRUNCATE '||t);
 INSERT INTO employee_disabled_calls SELECT format('SELECT %I FROM %s',attname,t) FROM pg_attribute WHERE attrelid=t::regclass AND attnum>0 AND NOT attisdropped;
 INSERT INTO employee_disabled_calls SELECT format('UPDATE %s SET %I=%I',t,attname,attname) FROM pg_attribute WHERE attrelid=t::regclass AND attnum>0 AND NOT attisdropped;
 END LOOP;
END $$;
GRANT SELECT ON employee_disabled_calls TO authenticated,anon,service_role;
DO $$ DECLARE ns text; r text; f text; t text; BEGIN
 SELECT nspname INTO ns FROM pg_namespace WHERE oid=pg_my_temp_schema();
 EXECUTE format('GRANT USAGE ON SCHEMA %I TO authenticated,anon,service_role',ns);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %I.employee_expect_acl(text) TO authenticated,anon,service_role',ns);
 FOREACH r IN ARRAY ARRAY['authenticated','anon','service_role'] LOOP
 FOREACH f IN ARRAY pg_temp.employee_entrypoints()||pg_temp.employee_helpers() LOOP
 IF has_function_privilege(r,f,'EXECUTE') THEN RAISE EXCEPTION 'EMPLOYEE_EFFECTIVE_FUNCTION_GRANT: % %',r,f; END IF; END LOOP;
 FOREACH t IN ARRAY pg_temp.employee_tables() LOOP
 IF has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(r,t,'SELECT,INSERT,UPDATE,REFERENCES') THEN RAISE EXCEPTION 'EMPLOYEE_EFFECTIVE_TABLE_GRANT: % %',r,t; END IF; END LOOP;
 END LOOP;
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE id text; call text; BEGIN
 FOREACH id IN ARRAY ARRAY['95000000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000002','95000000-0000-0000-0000-000000000003','95000000-0000-0000-0000-000000000004','95000000-0000-0000-0000-000000000013','95000000-0000-0000-0000-000000000016','95000000-0000-0000-0000-000000000007','95000000-0000-0000-0000-000000000099',''] LOOP
 PERFORM set_config('request.jwt.claim.sub',id,true); PERFORM set_config('request.jwt.claims','{"app_metadata":{"role":"executive"}}',true);
 FOR call IN SELECT statement FROM employee_disabled_calls LOOP PERFORM pg_temp.employee_expect_acl(call); END LOOP;
 END LOOP;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.employee_expect_acl(statement) FROM employee_disabled_calls;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.employee_expect_acl(statement) FROM employee_disabled_calls;
RESET ROLE;
ROLLBACK;
\echo EMPLOYEE_DISABLED_ALL_ROLE_SURFACES_DENIED
