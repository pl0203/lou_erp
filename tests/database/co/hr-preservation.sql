-- All HR setup is fictional, rolled back, and never part of the access migration.
\ir ../ihr/helpers.sql
BEGIN;
SELECT set_config('request.jwt.claim.sub','',true);
\ir ../ihr/composed/quote-seed.sql
UPDATE public.users SET role='co_admin' WHERE id='71000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(public.leave_context_v1()->>'memberKind'='employee' AND public.leave_context_v1()->'setup'->>'ready'='true','explicit CO employee retains ordinary HR setup');
SELECT public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday())) quote \gset
SELECT pg_temp.assert_true(:'quote'::jsonb->'approver'->>'id'='71000000-0000-0000-0000-000000000003','CO uses its explicitly assigned ordinary manager');
SELECT public.leave_transaction_v1('7c000000-0000-4000-8000-000000000001','submit_request',jsonb_build_object('input',pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()),'quote_fingerprint',:'quote'::jsonb->>'fingerprint')) submitted \gset
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_assigned_request_v1(%L)',:'submitted'::jsonb->>'id'),'42501');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''approve_request'',%L::jsonb)','7c000000-0000-4000-8000-000000000002',jsonb_build_object('request_id',:'submitted'::jsonb->>'id','expected_version',1)),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true(public.leave_transaction_v1('7c000000-0000-4000-8000-000000000003','approve_request',jsonb_build_object('request_id',:'submitted'::jsonb->>'id','expected_version',1))->>'version'='2','ordinary manager approves configured CO employee');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_true((SELECT value->'allowedApproverKinds'='["manager"]' FROM jsonb_array_elements(public.leave_admin_setup_v1('members',1,100)->'rows') WHERE value->>'id'='71000000-0000-0000-0000-000000000001'),'CO setup choices do not inherit PO Director exception');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ BEGIN
 BEGIN
  UPDATE public.ihr_leave_approvers SET revoked_at=statement_timestamp(),revoked_by='71000000-0000-0000-0000-000000000006' WHERE employee_id='71000000-0000-0000-0000-000000000001';
  INSERT INTO public.ihr_leave_approvers(employee_id,approver_id,effective_from,assigned_by) VALUES('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000004','2020-01-01','71000000-0000-0000-0000-000000000006');
  RAISE EXCEPTION 'CO Director route unexpectedly accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
ROLLBACK;
-- The original positive/cancellation/refund-once/privacy suite is preserved verbatim.
\ir ../ihr/po-admin-director.sql
SELECT 'CO_HR_PRESERVATION_PASSED';
