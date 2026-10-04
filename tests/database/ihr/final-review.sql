-- Allowed ordinary business/configuration regressions only. Every fictional fixture rolls back.
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('request.jwt.claim.sub','',true);
\ir quote-seed.sql
\ir admin-governance-seed.sql
INSERT INTO public.ihr_leave_members(user_id,member_kind,active) VALUES('71000000-0000-0000-0000-000000000016','manager',true);
SELECT id original_assignment FROM public.ihr_leave_approvers WHERE employee_id='71000000-0000-0000-0000-000000000001' AND revoked_at IS NULL \gset
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT jsonb_build_object('input',pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1,'{"mode":"fixed_minutes","minutes":225}'),
 'quote_fingerprint',public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1,'{"mode":"fixed_minutes","minutes":225}'))->>'fingerprint') wave_input \gset
SELECT public.leave_transaction_v1('89000000-0000-0000-0000-000000000001','submit_request',:'wave_input') wave_receipt \gset
SELECT :'wave_receipt'::jsonb->>'id' wave_request \gset
SELECT set_config('ihr.test.wave_request',:'wave_request',true);
SELECT pg_temp.assert_true(:'wave_request'<>'89000000-0000-0000-0000-000000000001','subject UUID is independent of command UUID');
SELECT pg_temp.assert_true(public.leave_reconcile_request_v1('89000000-0000-0000-0000-000000000001',true)->'result'=:'wave_receipt'::jsonb,'reconciliation binds exact command to original subject receipt');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT public.leave_assigned_request_v1(:'wave_request') wave_detail \gset
SELECT pg_temp.assert_true(:'wave_detail'::jsonb->'duration'='{"mode":"fixed_minutes","minutes":225}'::jsonb AND :'wave_detail'::jsonb->'days'->0->>'scheduledMinutes'='450' AND :'wave_detail'::jsonb->'days'->1->>'scheduledMinutes'='225','partial request preserves weekday and Saturday capacity');
SELECT pg_temp.assert_true(:'wave_detail'::jsonb->'balanceContext'->>'basis'='current' AND jsonb_array_length(:'wave_detail'::jsonb->'balanceContext'->'periods')=1 AND :'wave_detail'::jsonb->'balanceContext'->'periods'->0->>'reservedMinutes'='450','fresh assigned balance is only this request period');
SELECT pg_temp.assert_true(NOT (:'wave_detail'::jsonb->'balanceContext'->'periods'->0 ? 'accountId'),'balance projection has no account handle or unrelated request');
SELECT pg_temp.assert_denied($s$SELECT public.leave_balance_accounts_v1('71000000-0000-0000-0000-000000000001')$s$,'42501');
SELECT public.leave_transaction_v1(gen_random_uuid(),'approve_request',jsonb_build_object('request_id',:'wave_request','expected_version',1));
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT public.leave_transaction_v1(gen_random_uuid(),'request_cancellation',jsonb_build_object('request_id',:'wave_request','expected_version',2,'reason','Fictional recoverable cancellation'));
SELECT public.leave_request_transition_state_v1(:'wave_request')->>'activeAttemptId' wave_attempt \gset
SELECT set_config('ihr.test.wave_attempt',:'wave_attempt',true);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
CREATE TEMP TABLE wave_original AS SELECT to_jsonb(ca) attempt,(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.account_id) FROM public.ihr_leave_request_allocations a WHERE a.request_id=ca.request_id) allocations FROM private.ihr_leave_cancellation_attempts ca WHERE ca.id=:'wave_attempt';

SAVEPOINT wave_revoked;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.ihr_leave_approvers SET revoked_at=clock_timestamp(),revoked_by='71000000-0000-0000-0000-000000000006' WHERE id=:'original_assignment';
INSERT INTO public.ihr_leave_approvers(employee_id,approver_id,effective_from,assigned_by) VALUES('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000016',clock_timestamp(),'71000000-0000-0000-0000-000000000006') RETURNING id recovery_assignment \gset
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)',gen_random_uuid(),'approve_cancellation',jsonb_build_object('request_id',:'wave_request','expected_version',3,'attempt_id',:'wave_attempt')),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000016',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_assigned_request_v1(%L)',:'wave_request'),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)',gen_random_uuid(),'request_cancellation',jsonb_build_object('request_id',:'wave_request','expected_version',3,'reason','Cannot duplicate pending attempt')),'55000');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000009',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)',gen_random_uuid(),'reassign_request',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','request_id',:'wave_request','assignment_id',:'recovery_assignment','attempt_id',:'wave_attempt','expected_version',3,'reason','Configure alone denied')),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_true(public.leave_admin_requests_v1('71000000-0000-0000-0000-000000000001')->'rows'->0->>'cancellationAttemptId'=:'wave_attempt','recovery list names exact attempt without private reason');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)',gen_random_uuid(),'reassign_request',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','request_id',:'wave_request','assignment_id',:'recovery_assignment','expected_version',3,'reason','Missing exact attempt')),'55000');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)',gen_random_uuid(),'reassign_request',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','request_id',:'wave_request','assignment_id',:'recovery_assignment','attempt_id',:'wave_attempt','expected_version',2,'reason','Stale request')),'55000');
SELECT public.leave_transaction_v1(gen_random_uuid(),'reassign_request',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','request_id',:'wave_request','assignment_id',:'recovery_assignment','attempt_id',:'wave_attempt','expected_version',3,'reason','Explicit independent recovery'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
-- Owner-only bookkeeping of immutable rows/configuration; application assertions keep their guarded helper.
DO $$ BEGIN
 IF ((SELECT to_jsonb(ca)=original.attempt FROM private.ihr_leave_cancellation_attempts ca CROSS JOIN wave_original original WHERE ca.id=current_setting('ihr.test.wave_attempt')::uuid) AND (SELECT count(*)=2 FROM public.ihr_leave_occupancy WHERE request_id=current_setting('ihr.test.wave_request')::uuid)) IS DISTINCT FROM true THEN RAISE EXCEPTION 'route recovery preserves original attempt and occupied dates';END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000016',true);
SELECT pg_temp.assert_true(public.leave_assigned_request_v1(:'wave_request')->'cancellation'->>'id'=:'wave_attempt','current explicit replacement receives only routed attempt');
SELECT public.leave_transaction_v1('89000000-0000-0000-0000-000000000002','approve_cancellation',jsonb_build_object('request_id',:'wave_request','expected_version',4,'attempt_id',:'wave_attempt'));
SELECT public.leave_transaction_v1('89000000-0000-0000-0000-000000000002','approve_cancellation',jsonb_build_object('request_id',:'wave_request','expected_version',4,'attempt_id',:'wave_attempt'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
-- Owner-only bookkeeping of immutable rows/configuration; application assertions keep their guarded helper.
DO $$ BEGIN
 IF ((SELECT count(*)=1 AND sum(charged_minutes)=450 FROM private.ihr_leave_charge_reversals WHERE request_id=current_setting('ihr.test.wave_request')::uuid) AND NOT EXISTS(SELECT 1 FROM public.ihr_leave_occupancy WHERE request_id=current_setting('ihr.test.wave_request')::uuid)) IS DISTINCT FROM true THEN RAISE EXCEPTION 'recovered acceptance refunds original allocation exactly once';END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT public.leave_own_request_history_v1(:'wave_request',NULL,NULL,2) wave_page \gset
SELECT pg_temp.assert_true(jsonb_array_length(:'wave_page'::jsonb->'rows')=2 AND :'wave_page'::jsonb->'nextBefore'<>'null'::jsonb,'owner sees bounded immutable history with a continuation');
SELECT pg_temp.assert_true(:'wave_page'::jsonb->'rows'->0->>'event'='cancellation_accepted' AND :'wave_page'::jsonb->'rows'->1->>'reason'='Explicit independent recovery','owner sees final decision and audited recovery reason');
SELECT pg_temp.assert_true(jsonb_array_length(public.leave_own_request_history_v1(:'wave_request',(:'wave_page'::jsonb->'nextBefore'->>'atTime')::timestamptz,(:'wave_page'::jsonb->'nextBefore'->>'id')::uuid,50)->'rows')=3,'owner tuple cursor omits neither original submission nor cancellation');
SELECT pg_temp.assert_denied(format('SELECT public.leave_own_request_history_v1(%L,NULL,NULL,51)',:'wave_request'),'22023');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_own_request_history_v1(%L)',:'wave_request'),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_own_request_history_v1(%L)',:'wave_request'),'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
ROLLBACK TO SAVEPOINT wave_revoked;
RELEASE SAVEPOINT wave_revoked;

SAVEPOINT wave_expired;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.ihr_leave_approvers SET effective_until=clock_timestamp()-interval '1 second' WHERE id=:'original_assignment';
INSERT INTO public.ihr_leave_approvers(employee_id,approver_id,effective_from,assigned_by) VALUES('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000016',clock_timestamp(),'71000000-0000-0000-0000-000000000006') RETURNING id recovery_assignment \gset
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)',gen_random_uuid(),'approve_cancellation',jsonb_build_object('request_id',:'wave_request','expected_version',3,'attempt_id',:'wave_attempt')),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000016',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_assigned_request_v1(%L)',:'wave_request'),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)',gen_random_uuid(),'request_cancellation',jsonb_build_object('request_id',:'wave_request','expected_version',3,'reason','Cannot duplicate pending attempt')),'55000');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000009',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)',gen_random_uuid(),'reassign_request',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','request_id',:'wave_request','assignment_id',:'recovery_assignment','attempt_id',:'wave_attempt','expected_version',3,'reason','Configure alone denied')),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_true(public.leave_admin_requests_v1('71000000-0000-0000-0000-000000000001')->'rows'->0->>'cancellationAttemptId'=:'wave_attempt','recovery list names exact attempt without private reason');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)',gen_random_uuid(),'reassign_request',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','request_id',:'wave_request','assignment_id',:'recovery_assignment','expected_version',3,'reason','Missing exact attempt')),'55000');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)',gen_random_uuid(),'reassign_request',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','request_id',:'wave_request','assignment_id',:'recovery_assignment','attempt_id',:'wave_attempt','expected_version',2,'reason','Stale request')),'55000');
SELECT public.leave_transaction_v1(gen_random_uuid(),'reassign_request',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','request_id',:'wave_request','assignment_id',:'recovery_assignment','attempt_id',:'wave_attempt','expected_version',3,'reason','Explicit independent recovery'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
-- Owner-only bookkeeping of immutable rows/configuration; application assertions keep their guarded helper.
DO $$ BEGIN
 IF ((SELECT to_jsonb(ca)=original.attempt FROM private.ihr_leave_cancellation_attempts ca CROSS JOIN wave_original original WHERE ca.id=current_setting('ihr.test.wave_attempt')::uuid) AND (SELECT count(*)=2 FROM public.ihr_leave_occupancy WHERE request_id=current_setting('ihr.test.wave_request')::uuid)) IS DISTINCT FROM true THEN RAISE EXCEPTION 'route recovery preserves original attempt and occupied dates';END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000016',true);
SELECT pg_temp.assert_true(public.leave_assigned_request_v1(:'wave_request')->'cancellation'->>'id'=:'wave_attempt','current explicit replacement receives only routed attempt');
SELECT public.leave_transaction_v1('89000000-0000-0000-0000-000000000002','approve_cancellation',jsonb_build_object('request_id',:'wave_request','expected_version',4,'attempt_id',:'wave_attempt'));
SELECT public.leave_transaction_v1('89000000-0000-0000-0000-000000000002','approve_cancellation',jsonb_build_object('request_id',:'wave_request','expected_version',4,'attempt_id',:'wave_attempt'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
-- Owner-only bookkeeping of immutable rows/configuration; application assertions keep their guarded helper.
DO $$ BEGIN
 IF ((SELECT count(*)=1 AND sum(charged_minutes)=450 FROM private.ihr_leave_charge_reversals WHERE request_id=current_setting('ihr.test.wave_request')::uuid) AND NOT EXISTS(SELECT 1 FROM public.ihr_leave_occupancy WHERE request_id=current_setting('ihr.test.wave_request')::uuid)) IS DISTINCT FROM true THEN RAISE EXCEPTION 'recovered acceptance refunds original allocation exactly once';END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT public.leave_own_request_history_v1(:'wave_request',NULL,NULL,2) wave_page \gset
SELECT pg_temp.assert_true(jsonb_array_length(:'wave_page'::jsonb->'rows')=2 AND :'wave_page'::jsonb->'nextBefore'<>'null'::jsonb,'owner sees bounded immutable history with a continuation');
SELECT pg_temp.assert_true(:'wave_page'::jsonb->'rows'->0->>'event'='cancellation_accepted' AND :'wave_page'::jsonb->'rows'->1->>'reason'='Explicit independent recovery','owner sees final decision and audited recovery reason');
SELECT pg_temp.assert_true(jsonb_array_length(public.leave_own_request_history_v1(:'wave_request',(:'wave_page'::jsonb->'nextBefore'->>'atTime')::timestamptz,(:'wave_page'::jsonb->'nextBefore'->>'id')::uuid,50)->'rows')=3,'owner tuple cursor omits neither original submission nor cancellation');
SELECT pg_temp.assert_denied(format('SELECT public.leave_own_request_history_v1(%L,NULL,NULL,51)',:'wave_request'),'22023');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_own_request_history_v1(%L)',:'wave_request'),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_own_request_history_v1(%L)',:'wave_request'),'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
ROLLBACK TO SAVEPOINT wave_expired;
RELEASE SAVEPOINT wave_expired;

SAVEPOINT wave_replaced;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.ihr_leave_approvers SET revoked_at=clock_timestamp(),revoked_by='71000000-0000-0000-0000-000000000006' WHERE id=:'original_assignment';
INSERT INTO public.ihr_leave_approvers(employee_id,approver_id,effective_from,assigned_by) VALUES('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000016',clock_timestamp(),'71000000-0000-0000-0000-000000000006') RETURNING id recovery_assignment \gset
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)',gen_random_uuid(),'approve_cancellation',jsonb_build_object('request_id',:'wave_request','expected_version',3,'attempt_id',:'wave_attempt')),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000016',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_assigned_request_v1(%L)',:'wave_request'),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)',gen_random_uuid(),'request_cancellation',jsonb_build_object('request_id',:'wave_request','expected_version',3,'reason','Cannot duplicate pending attempt')),'55000');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000009',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)',gen_random_uuid(),'reassign_request',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','request_id',:'wave_request','assignment_id',:'recovery_assignment','attempt_id',:'wave_attempt','expected_version',3,'reason','Configure alone denied')),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_true(public.leave_admin_requests_v1('71000000-0000-0000-0000-000000000001')->'rows'->0->>'cancellationAttemptId'=:'wave_attempt','recovery list names exact attempt without private reason');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)',gen_random_uuid(),'reassign_request',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','request_id',:'wave_request','assignment_id',:'recovery_assignment','expected_version',3,'reason','Missing exact attempt')),'55000');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)',gen_random_uuid(),'reassign_request',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','request_id',:'wave_request','assignment_id',:'recovery_assignment','attempt_id',:'wave_attempt','expected_version',2,'reason','Stale request')),'55000');
SELECT public.leave_transaction_v1(gen_random_uuid(),'reassign_request',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','request_id',:'wave_request','assignment_id',:'recovery_assignment','attempt_id',:'wave_attempt','expected_version',3,'reason','Explicit independent recovery'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
-- Owner-only bookkeeping of immutable rows/configuration; application assertions keep their guarded helper.
DO $$ BEGIN
 IF ((SELECT to_jsonb(ca)=original.attempt FROM private.ihr_leave_cancellation_attempts ca CROSS JOIN wave_original original WHERE ca.id=current_setting('ihr.test.wave_attempt')::uuid) AND (SELECT count(*)=2 FROM public.ihr_leave_occupancy WHERE request_id=current_setting('ihr.test.wave_request')::uuid)) IS DISTINCT FROM true THEN RAISE EXCEPTION 'route recovery preserves original attempt and occupied dates';END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000016',true);
SELECT pg_temp.assert_true(public.leave_assigned_request_v1(:'wave_request')->'cancellation'->>'id'=:'wave_attempt','current explicit replacement receives only routed attempt');
SELECT public.leave_transaction_v1('89000000-0000-0000-0000-000000000002','approve_cancellation',jsonb_build_object('request_id',:'wave_request','expected_version',4,'attempt_id',:'wave_attempt'));
SELECT public.leave_transaction_v1('89000000-0000-0000-0000-000000000002','approve_cancellation',jsonb_build_object('request_id',:'wave_request','expected_version',4,'attempt_id',:'wave_attempt'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
-- Owner-only bookkeeping of immutable rows/configuration; application assertions keep their guarded helper.
DO $$ BEGIN
 IF ((SELECT count(*)=1 AND sum(charged_minutes)=450 FROM private.ihr_leave_charge_reversals WHERE request_id=current_setting('ihr.test.wave_request')::uuid) AND NOT EXISTS(SELECT 1 FROM public.ihr_leave_occupancy WHERE request_id=current_setting('ihr.test.wave_request')::uuid)) IS DISTINCT FROM true THEN RAISE EXCEPTION 'recovered acceptance refunds original allocation exactly once';END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT public.leave_own_request_history_v1(:'wave_request',NULL,NULL,2) wave_page \gset
SELECT pg_temp.assert_true(jsonb_array_length(:'wave_page'::jsonb->'rows')=2 AND :'wave_page'::jsonb->'nextBefore'<>'null'::jsonb,'owner sees bounded immutable history with a continuation');
SELECT pg_temp.assert_true(:'wave_page'::jsonb->'rows'->0->>'event'='cancellation_accepted' AND :'wave_page'::jsonb->'rows'->1->>'reason'='Explicit independent recovery','owner sees final decision and audited recovery reason');
SELECT pg_temp.assert_true(jsonb_array_length(public.leave_own_request_history_v1(:'wave_request',(:'wave_page'::jsonb->'nextBefore'->>'atTime')::timestamptz,(:'wave_page'::jsonb->'nextBefore'->>'id')::uuid,50)->'rows')=3,'owner tuple cursor omits neither original submission nor cancellation');
SELECT pg_temp.assert_denied(format('SELECT public.leave_own_request_history_v1(%L,NULL,NULL,51)',:'wave_request'),'22023');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_own_request_history_v1(%L)',:'wave_request'),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_own_request_history_v1(%L)',:'wave_request'),'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
ROLLBACK TO SAVEPOINT wave_replaced;
RELEASE SAVEPOINT wave_replaced;

SAVEPOINT wave_future_version;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT version wave_member_version FROM public.ihr_leave_members WHERE user_id='71000000-0000-0000-0000-000000000001' \gset
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT public.leave_transaction_v1(gen_random_uuid(),'set_approver',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','approver_id','71000000-0000-0000-0000-000000000016','effective_from',(clock_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::date+2,'effective_until',NULL,'replace_assignment_id',:'original_assignment','expected_version',:'wave_member_version'::bigint,'reason','Fictional future replacement changes assignment version now'));
SELECT :'original_assignment' recovery_assignment \gset
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)',gen_random_uuid(),'approve_cancellation',jsonb_build_object('request_id',:'wave_request','expected_version',3,'attempt_id',:'wave_attempt')),'55000');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000016',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_assigned_request_v1(%L)',:'wave_request'),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)',gen_random_uuid(),'request_cancellation',jsonb_build_object('request_id',:'wave_request','expected_version',3,'reason','Cannot duplicate pending attempt')),'55000');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000009',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)',gen_random_uuid(),'reassign_request',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','request_id',:'wave_request','assignment_id',:'recovery_assignment','attempt_id',:'wave_attempt','expected_version',3,'reason','Configure alone denied')),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_true(public.leave_admin_requests_v1('71000000-0000-0000-0000-000000000001')->'rows'->0->>'cancellationAttemptId'=:'wave_attempt','recovery list names exact attempt without private reason');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)',gen_random_uuid(),'reassign_request',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','request_id',:'wave_request','assignment_id',:'recovery_assignment','expected_version',3,'reason','Missing exact attempt')),'55000');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)',gen_random_uuid(),'reassign_request',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','request_id',:'wave_request','assignment_id',:'recovery_assignment','attempt_id',:'wave_attempt','expected_version',2,'reason','Stale request')),'55000');
SELECT public.leave_transaction_v1(gen_random_uuid(),'reassign_request',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','request_id',:'wave_request','assignment_id',:'recovery_assignment','attempt_id',:'wave_attempt','expected_version',3,'reason','Explicit independent recovery'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
-- Owner-only bookkeeping of immutable rows/configuration; application assertions keep their guarded helper.
DO $$ BEGIN
 IF ((SELECT to_jsonb(ca)=original.attempt FROM private.ihr_leave_cancellation_attempts ca CROSS JOIN wave_original original WHERE ca.id=current_setting('ihr.test.wave_attempt')::uuid) AND (SELECT count(*)=2 FROM public.ihr_leave_occupancy WHERE request_id=current_setting('ihr.test.wave_request')::uuid)) IS DISTINCT FROM true THEN RAISE EXCEPTION 'route recovery preserves original attempt and occupied dates';END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true(public.leave_assigned_request_v1(:'wave_request')->'cancellation'->>'id'=:'wave_attempt','current explicit replacement receives only routed attempt');
SELECT public.leave_transaction_v1('89000000-0000-0000-0000-000000000002','approve_cancellation',jsonb_build_object('request_id',:'wave_request','expected_version',4,'attempt_id',:'wave_attempt'));
SELECT public.leave_transaction_v1('89000000-0000-0000-0000-000000000002','approve_cancellation',jsonb_build_object('request_id',:'wave_request','expected_version',4,'attempt_id',:'wave_attempt'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
-- Owner-only bookkeeping of immutable rows/configuration; application assertions keep their guarded helper.
DO $$ BEGIN
 IF ((SELECT count(*)=1 AND sum(charged_minutes)=450 FROM private.ihr_leave_charge_reversals WHERE request_id=current_setting('ihr.test.wave_request')::uuid) AND NOT EXISTS(SELECT 1 FROM public.ihr_leave_occupancy WHERE request_id=current_setting('ihr.test.wave_request')::uuid)) IS DISTINCT FROM true THEN RAISE EXCEPTION 'recovered acceptance refunds original allocation exactly once';END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT public.leave_own_request_history_v1(:'wave_request',NULL,NULL,2) wave_page \gset
SELECT pg_temp.assert_true(jsonb_array_length(:'wave_page'::jsonb->'rows')=2 AND :'wave_page'::jsonb->'nextBefore'<>'null'::jsonb,'owner sees bounded immutable history with a continuation');
SELECT pg_temp.assert_true(:'wave_page'::jsonb->'rows'->0->>'event'='cancellation_accepted' AND :'wave_page'::jsonb->'rows'->1->>'reason'='Explicit independent recovery','owner sees final decision and audited recovery reason');
SELECT pg_temp.assert_true(jsonb_array_length(public.leave_own_request_history_v1(:'wave_request',(:'wave_page'::jsonb->'nextBefore'->>'atTime')::timestamptz,(:'wave_page'::jsonb->'nextBefore'->>'id')::uuid,50)->'rows')=3,'owner tuple cursor omits neither original submission nor cancellation');
SELECT pg_temp.assert_denied(format('SELECT public.leave_own_request_history_v1(%L,NULL,NULL,51)',:'wave_request'),'22023');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_own_request_history_v1(%L)',:'wave_request'),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_own_request_history_v1(%L)',:'wave_request'),'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
ROLLBACK TO SAVEPOINT wave_future_version;
RELEASE SAVEPOINT wave_future_version;
-- A different employee is affected by the same calendar but a different Saturday group.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
SELECT public.leave_transaction_v1(gen_random_uuid(),'submit_request',jsonb_build_object('input',pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()),'quote_fingerprint',public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()))->>'fingerprint')) wave_pending \gset
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SAVEPOINT wave_impacts;
INSERT INTO public.ihr_leave_access_grants(actor_id,capability,scope_kind,effective_from,granted_by,reason) VALUES('71000000-0000-0000-0000-000000000009','configure','all_policy_members','2000-01-01','71000000-0000-0000-0000-000000000006','Fictional global impact preview');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000009',true);
SELECT jsonb_build_object('calendar_id','73000000-0000-0000-0000-000000000090','name','Fictional impact proposal','effective_from',pg_temp.quote_friday(),'effective_until',pg_temp.quote_friday()+2,'timezone','Pacific/Kiritimati','holidays_confirmed',true,'sunday_minutes',0,'holidays','[]'::jsonb,'groups','[]'::jsonb,'expected_version',1) wave_proposal \gset
SELECT public.leave_calendar_preview_v1(:'wave_proposal') wave_calendar_preview \gset
SELECT pg_temp.assert_true(:'wave_calendar_preview'::jsonb->'impacts'='{"available":true,"pendingCount":1,"approvedCount":1}'::jsonb,'calendar range counts pending and cancellation-pending exactly');
SELECT public.leave_roster_preview_v1('73000000-0000-0000-0000-000000000090',pg_temp.quote_friday()+1,'[{"id":"79000000-0000-0000-0000-000000000021","on_anchor":false}]',pg_temp.quote_friday()+1,pg_temp.quote_friday()+2) wave_roster_preview \gset
SELECT pg_temp.assert_true(:'wave_roster_preview'::jsonb->'impacts'='{"available":true,"pendingCount":0,"approvedCount":1}'::jsonb,'roster is exact group and Saturday range, never whole directory');
SELECT pg_temp.assert_true(public.leave_calendar_preview_v1(:'wave_proposal'::jsonb||jsonb_build_object('effective_from',pg_temp.quote_friday()+30,'effective_until',pg_temp.quote_friday()+31))->'impacts'='{"available":true,"pendingCount":0,"approvedCount":0}'::jsonb,'outside proposed dates has zero impacts');
SELECT pg_temp.assert_true(NOT(:'wave_calendar_preview'::jsonb->'impacts' ? 'rows') AND NOT(:'wave_roster_preview'::jsonb->'impacts' ? 'sourceFingerprint'),'public impacts expose counts only');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)',gen_random_uuid(),'save_calendar_version',:'wave_proposal'::jsonb||jsonb_build_object('reason','No preview')),'22023');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)',gen_random_uuid(),'save_calendar_version',:'wave_proposal'::jsonb||jsonb_build_object('name','Changed input','reason','Stale proposed input','preview_fingerprint',:'wave_calendar_preview'::jsonb->>'fingerprint')),'55000');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_calendar_preview_v1(%L::jsonb)',:'wave_proposal'),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
SELECT public.leave_transaction_v1(gen_random_uuid(),'withdraw_request',jsonb_build_object('request_id',:'wave_pending'::jsonb->>'id','expected_version',1));
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000009',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)',gen_random_uuid(),'save_calendar_version',:'wave_proposal'::jsonb||jsonb_build_object('reason','Stale source counts','preview_fingerprint',:'wave_calendar_preview'::jsonb->>'fingerprint')),'55000');
SELECT public.leave_transaction_v1(gen_random_uuid(),'save_calendar_version',:'wave_proposal'::jsonb||jsonb_build_object('reason','Fresh preview completed','preview_fingerprint',public.leave_calendar_preview_v1(:'wave_proposal')->>'fingerprint'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
ROLLBACK TO SAVEPOINT wave_impacts;
RELEASE SAVEPOINT wave_impacts;
-- Ordinary catalog configuration proof, not a session shadow/type exploit probe.
-- Owner-only bookkeeping of immutable rows/configuration; application assertions keep their guarded helper.
DO $$ BEGIN
 IF (NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN('public','private') AND (p.proname LIKE 'ihr_%' OR p.proname LIKE 'leave_%')
 AND NOT coalesce('search_path=pg_catalog, pg_temp'=ANY(p.proconfig),false))) IS DISTINCT FROM true THEN RAISE EXCEPTION 'installed HR routine namespace is trusted catalog first and temporary schema last';END IF;
END $$;
ROLLBACK;
\echo IHR_FINAL_REVIEW_BUSINESS_CONFIG_PASSED
