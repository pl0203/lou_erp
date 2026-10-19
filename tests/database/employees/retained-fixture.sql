-- Exact fictional retained history through the real narrow app APIs.
CREATE OR REPLACE FUNCTION pg_temp.employee_fixture_fields(n text,num text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('name',n,'employeeNumber',num,'jobTitle','Synthetic engineer','team','Synthetic team','recordedStatus','active') $$;
CREATE OR REPLACE FUNCTION pg_temp.employee_fixture_save(op integer,e integer,a text,p jsonb,source text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE id uuid:=('97000000-0000-0000-0000-'||lpad(e::text,12,'0'))::uuid; v bigint; preview jsonb; BEGIN
 v:=CASE WHEN a='create_employee' THEN 0 ELSE (public.employee_detail_v1(id)->>'version')::bigint END;
 preview:=public.employee_preview_v1(id,v,a,p,'Synthetic history proof',NULL,source);
 RETURN public.employee_command_v1(('98000000-0000-0000-0000-'||lpad(op::text,12,'0'))::uuid,id,v,a,p,'Synthetic history proof',NULL,source,preview->>'previewFingerprint');
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000004',true);
SELECT public.employee_context_v1() fixture_context \gset
SELECT public.employee_preview_v1('97000000-0000-0000-0000-000000000001',0,'create_employee',pg_temp.employee_fixture_fields('Synthetic retained 李','OLD-01'),'Synthetic history proof',NULL,NULL) fixture_preview \gset
SELECT pg_temp.employee_fixture_save(1,1,'create_employee',pg_temp.employee_fixture_fields('Synthetic retained 李','OLD-01')) fixture_command \gset
SELECT pg_temp.employee_fixture_save(2,2,'create_employee',pg_temp.employee_fixture_fields('Synthetic manager')) fixture_manager \gset
SELECT pg_temp.employee_fixture_save(3,1,'edit_employee',pg_temp.employee_fixture_fields('Synthetic retained corrected','NEW-01')) fixture_edit \gset
SELECT pg_temp.employee_fixture_save(4,1,'save_initial_episode','{"startDate":null,"endDate":null,"sourceReference":null}') fixture_episode \gset
RESET ROLE;
CREATE TEMP TABLE employee_original_episode AS SELECT id FROM private.employee_episodes WHERE employee_id='97000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.employee_fixture_save(5,1,'save_initial_episode','{"startDate":"2026-01-02","endDate":null,"sourceReference":"Synthetic verified source"}') fixture_episode_corrected \gset
SELECT pg_temp.employee_fixture_save(6,1,'link_account','{"userId":"95000000-0000-0000-0000-000000000007"}') fixture_link \gset
SELECT pg_temp.employee_fixture_save(7,1,'quarantine_account_link','{"userId":"95000000-0000-0000-0000-000000000007"}') fixture_quarantine \gset
SELECT pg_temp.employee_fixture_save(8,1,'save_reporting','{"mode":"correction","intervals":[{"managerEmployeeId":"97000000-0000-0000-0000-000000000002","from":"2026-01-01","until":"2026-06-01"}]}','Synthetic correction source') fixture_reporting1 \gset
SELECT pg_temp.employee_fixture_save(9,1,'save_reporting','{"mode":"correction","intervals":[{"managerEmployeeId":null,"from":"2026-01-01","until":"2026-03-01"},{"managerEmployeeId":"97000000-0000-0000-0000-000000000002","from":"2026-04-01","until":null}]}','Synthetic corrected source') fixture_reporting2 \gset
SELECT public.employee_operation_v1('98000000-0000-0000-0000-000000000099','abandon') fixture_abandoned \gset
SELECT public.employee_operation_v1('98000000-0000-0000-0000-000000000001','read') fixture_recovered \gset
SELECT public.employee_page_v1('',NULL,1,25) fixture_page \gset
SELECT public.employee_detail_v1('97000000-0000-0000-0000-000000000001') fixture_detail \gset
SELECT public.employee_audit_v1('97000000-0000-0000-0000-000000000001',1,100) fixture_audit \gset
SELECT public.employee_account_candidates_v1('',1,100) fixture_candidates \gset
SELECT public.employee_operation_v1('98000000-0000-0000-0000-000000000098','read') fixture_absent \gset
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM private.employee_number_claims WHERE employee_id='97000000-0000-0000-0000-000000000001')<>2
 OR NOT EXISTS(SELECT 1 FROM private.employee_account_links WHERE user_id='95000000-0000-0000-0000-000000000007' AND quarantined)
 OR NOT EXISTS(SELECT 1 FROM private.employee_episodes e JOIN employee_original_episode o USING(id))
 OR (SELECT count(*) FROM private.employee_reporting_revisions WHERE employee_id='97000000-0000-0000-0000-000000000001')<>2
 OR (SELECT count(*) FROM private.employee_operations WHERE state='completed')<>9
 OR (SELECT count(*) FROM private.employee_operations WHERE state='abandoned')<>1
 THEN RAISE EXCEPTION 'Incomplete retained identity/history fixture'; END IF;
END $$;
\echo EMPLOYEE_RETAINED_HISTORY_CREATED
