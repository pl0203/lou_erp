-- FICTIONAL ONLY. Final1007 preparation: real approval blockers, then exact owner-provisioned evidence.
BEGIN;
SELECT set_config('request.jwt.claim.sub','',true);
\ir ../seed.sql
\ir ../accounts-seed.sql
SET LOCAL ROLE anon;
SELECT pg_temp.assert_denied($s$SELECT public.leave_prepare_self_v1()$s$,'42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_controlled_denied($s$SELECT public.leave_prepare_self_v1()$s$,'55000','SETUP_APPROVAL_REQUIRED');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
CREATE TEMP TABLE preparation_unapproved_observation AS SELECT NOT EXISTS(SELECT 1 FROM public.ihr_leave_accounts) AND NOT EXISTS(SELECT 1 FROM public.ihr_leave_ledger) empty;
GRANT SELECT ON preparation_unapproved_observation TO authenticated;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(empty,'missing governance cannot create an account or annual grant') FROM preparation_unapproved_observation;
RESET ROLE;
\ir policy-seed.sql
\ir governance-approvals-seed.sql
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT public.leave_prepare_self_v1() approved_preparation \gset
SELECT pg_temp.assert_true(public.leave_prepare_self_v1()=:'approved_preparation'::jsonb,'approved final-schema preparation is idempotent');
SELECT pg_temp.assert_true(public.leave_balance_history_v1((:'approved_preparation'::jsonb->>'accountId')::uuid)->'balance'->>'allowanceMinutes'='5400','one explicit annual grant');
SELECT pg_temp.assert_true(public.leave_balance_history_v1((:'approved_preparation'::jsonb->>'accountId')::uuid)->'balance'->'availableMinutes'='null'::jsonb,'approval does not infer an opening');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
-- Independent missing-retention case after a successful preparation; immutable evidence is never edited.
INSERT INTO private.ihr_leave_governance_approvals SELECT (jsonb_populate_record(NULL::private.ihr_leave_governance_approvals,to_jsonb(a)||jsonb_build_object('id','86000000-0000-0000-0000-000000000091','confirmed',false))).*
FROM private.ihr_leave_governance_approvals a JOIN private.ihr_leave_governance_references r ON r.approval_id=a.id
WHERE r.employee_id='71000000-0000-0000-0000-000000000001' AND r.kind='retention';
INSERT INTO private.ihr_leave_governance_references VALUES('71000000-0000-0000-0000-000000000001','retention',2,'86000000-0000-0000-0000-000000000091','71000000-0000-0000-0000-000000000006','2020-01-01 00:00:00+00');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_controlled_denied($s$SELECT public.leave_prepare_self_v1()$s$,'55000','SETUP_APPROVAL_REQUIRED');
SELECT pg_temp.assert_denied($s$SELECT * FROM private.ihr_leave_governance_approvals$s$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
CREATE TEMP TABLE preparation_final_observation AS SELECT
 (SELECT count(*)=1 FROM public.ihr_leave_accounts) account_once,
 (SELECT count(*)=1 AND sum(allowance_delta)=5400 FROM public.ihr_leave_ledger WHERE kind='annual_grant') grant_once;
GRANT SELECT ON preparation_final_observation TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(account_once AND grant_once,'later approval denial preserves the original account and single grant') FROM preparation_final_observation;
RESET ROLE;
ROLLBACK;
\echo IHR_FINAL_SCHEMA_PREPARATION_APPROVALS_PASSED
