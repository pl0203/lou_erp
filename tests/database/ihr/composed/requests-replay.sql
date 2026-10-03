BEGIN;
\ir quote-seed.sql
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT jsonb_build_object('input',pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()),'quote_fingerprint',public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()))->>'fingerprint') replay_payload \gset
SELECT public.leave_transaction_v1('80000000-0000-0000-0000-000000000040','submit_request',:'replay_payload') replay_receipt \gset
SELECT pg_temp.assert_true(public.leave_reconcile_request_v1('80000000-0000-0000-0000-000000000041',true)='{"state":"abandoned"}'::jsonb,'abandon absent command records terminal outcome');
SELECT pg_temp.assert_true(public.leave_reconcile_request_v1('80000000-0000-0000-0000-000000000041',false)='{"state":"abandoned"}'::jsonb,'abandonment persists on reload');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','80000000-0000-0000-0000-000000000041','submit_request',:'replay_payload'::jsonb),'55000');
SELECT pg_temp.assert_denied($s$SELECT public.leave_reconcile_request_v1('80000000-0000-0000-0000-000000000042',false)$s$,'55000');
RESET ROLE;
-- Read-only owner invocation isolates the replay authority contract at a later authorization instant.
-- Public replay below also proves changed policy/source state cannot break receipt recovery.
SELECT private.ihr_leave_authorize_command('71000000-0000-0000-0000-000000000001','submit_request',:'replay_payload',clock_timestamp()+interval '500 days');
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.ihr_leave_members SET annual_policy_confirmed=false WHERE user_id='71000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(public.leave_transaction_v1('80000000-0000-0000-0000-000000000040','submit_request',:'replay_payload')=:'replay_receipt'::jsonb,'committed result survives changed calculation eligibility');
SELECT pg_temp.assert_true(public.leave_reconcile_request_v1('80000000-0000-0000-0000-000000000040',true)->'result'=:'replay_receipt'::jsonb,'recovery bypasses only new-submit calculation validation');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.ihr_leave_members SET active=false WHERE user_id='71000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','80000000-0000-0000-0000-000000000040','submit_request',:'replay_payload'::jsonb),'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_reconcile_request_v1('80000000-0000-0000-0000-000000000040',true)$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_own_history_v1()$s$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.ihr_leave_members SET active=true WHERE user_id='71000000-0000-0000-0000-000000000001';
UPDATE public.users SET is_active=false WHERE id='71000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_reconcile_request_v1('80000000-0000-0000-0000-000000000040',true)$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_reconcile_request_v1('80000000-0000-0000-0000-000000000041',true)$s$,'42501');
RESET ROLE;
ROLLBACK;
