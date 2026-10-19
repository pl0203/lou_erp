-- Only included before COMMIT in the fixed synthetic installation proof.
DO $$ BEGIN IF current_database()<>'pilot_test' OR inet_server_addr() NOT IN('127.0.0.1'::inet,'::1'::inet)
 OR (SELECT count(*)<>1 FROM public.pilot_fixture_marker) OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci')
 OR current_setting('employee.proof_owner',true) IS NULL THEN RAISE EXCEPTION 'EMPLOYEE_SYNTHETIC_OWNER_REQUIRED'; END IF; END $$;
CREATE TABLE private.hr_verification_owner(token uuid PRIMARY KEY,users uuid[] NOT NULL,functions text[] NOT NULL,scope_original bigint NOT NULL,scope_delta integer NOT NULL DEFAULT 0,catalog_sha256 text NOT NULL);
REVOKE ALL ON private.hr_verification_owner FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO private.hr_verification_owner(token,users,functions,scope_original,catalog_sha256) SELECT current_setting('employee.proof_owner')::uuid,
 ARRAY(SELECT ('95000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid FROM unnest(ARRAY[1,2,3,4,7,13,14,16])n),
 pg_temp.employee_entrypoints()||pg_temp.employee_helpers(),(SELECT version FROM private.ihr_leave_scope_revision WHERE singleton),
 encode(sha256(convert_to(pg_temp.employee_catalog(true)::text,'UTF8')),'hex');
