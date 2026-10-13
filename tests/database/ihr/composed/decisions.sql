-- Genuine authenticated calls; synthetic fixture setup only, every effect rolls back.
BEGIN;
SELECT set_config('request.jwt.claim.sub','',true);
\ir quote-seed.sql
SET LOCAL ROLE anon;
SELECT pg_temp.assert_denied($s$SELECT public.leave_assigned_inbox_v1()$s$,'42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_assigned_inbox_v1()$s$,'42501');
SELECT jsonb_build_object('input',pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()),'quote_fingerprint',public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()))->>'fingerprint') payload \gset
SELECT public.leave_transaction_v1('82000000-0000-0000-0000-000000000001','submit_request',:'payload') submitted \gset
SELECT :'submitted'::jsonb->>'id' request_id \gset
SELECT jsonb_build_object('request_id',:'request_id','expected_version',1) decision_payload \gset
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','82000000-0000-0000-0000-000000000002','approve_request',:'decision_payload'),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true(jsonb_array_length(public.leave_assigned_inbox_v1()->'rows')=0,'director cannot see direct employee request');
SELECT pg_temp.assert_denied(format('SELECT public.leave_assigned_request_v1(%L)',:'request_id'),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000011',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_assigned_request_v1(%L)',:'request_id'),'42501');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','82000000-0000-0000-0000-000000000003','approve_request',:'decision_payload'),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true(jsonb_array_length(public.leave_assigned_inbox_v1()->'rows')=1,'explicit manager receives exactly assigned pending');
SELECT pg_temp.assert_true(NOT (public.leave_assigned_inbox_v1()->'rows'->0 ? 'reason'),'summary has no private reason');
SELECT pg_temp.assert_true(public.leave_assigned_request_v1(:'request_id')->>'reason'='Fictional private reason','assigned detail exposes authorized reason');
SELECT pg_temp.assert_denied($s$SELECT public.leave_assigned_request_v1('82000000-0000-0000-0000-000000000099')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT private.ihr_leave_is_assigned_request('71000000-0000-0000-0000-000000000003','82000000-0000-0000-0000-000000000099',now())$s$,'42501');
-- A routing-metadata-only bump must not stale an otherwise identical pending request.
-- Later decisions-authority.sql still proves substantive employment/calendar edits do stale it.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.ihr_leave_members SET version=version WHERE user_id='71000000-0000-0000-0000-000000000001';
CREATE TEMP TABLE decision_metadata_observation AS SELECT m.version>r.member_version AS version_advanced,
 m.updated_at IS DISTINCT FROM ((r.source_snapshot->'member')->>'updated_at')::timestamptz AS timestamp_changed
 FROM public.ihr_leave_members m JOIN public.ihr_leave_requests r ON r.employee_id=m.user_id WHERE r.id=:'request_id';
GRANT SELECT ON decision_metadata_observation TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true(version_advanced AND timestamp_changed,'fixture advances only routing metadata before approval') FROM decision_metadata_observation;
SELECT public.leave_transaction_v1('82000000-0000-0000-0000-000000000004','approve_request',:'decision_payload') approved \gset
SELECT pg_temp.assert_true(:'approved'::jsonb->>'version'='2','own reservation/account-version and routing-metadata changes do not make approval stale');
SELECT pg_temp.assert_true(public.leave_transaction_v1('82000000-0000-0000-0000-000000000004','approve_request',:'decision_payload')=:'approved'::jsonb,'approved command replays without validating old state');
SELECT pg_temp.assert_true(public.leave_reconcile_request_v1('82000000-0000-0000-0000-000000000004',true)->'result'=:'approved'::jsonb,'decision reconciliation is minimal and stable');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','82000000-0000-0000-0000-000000000005','approve_request',:'decision_payload'),'55000');
SELECT pg_temp.assert_true(jsonb_array_length(public.leave_assigned_inbox_v1()->'rows')=0,'completed request is no longer private assigned inbox history');
SELECT pg_temp.assert_denied(format('SELECT public.leave_assigned_request_v1(%L)',:'request_id'),'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
-- A distinct immutable unconfirmed policy is selected only after the initial request is approved.
INSERT INTO public.ihr_leave_policies SELECT (jsonb_populate_record(NULL::public.ihr_leave_policies,to_jsonb(p)||jsonb_build_object(
 'id','86000000-0000-0000-0000-000000000090','version',p.version+1,'cancellation_rules_confirmed',false,'cancellation_mode',NULL,
 'cancellation_allow_past',NULL,'cancellation_allow_repeat_declined',NULL,'cancellation_reason_required',NULL))).*
 FROM public.ihr_leave_policies p WHERE id='86000000-0000-0000-0000-000000000001';
UPDATE public.ihr_leave_members SET active_policy_id='86000000-0000-0000-0000-000000000090' WHERE user_id='71000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(public.leave_request_transition_state_v1(:'request_id')->>'cancellationBlocker'='CANCELLATION_RULES_UNCONFIRMED','actual cancellation rules stay unset');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','82000000-0000-0000-0000-000000000006','request_cancellation',jsonb_build_object('request_id',:'request_id','expected_version',2,'reason','Fictional cancellation')),'55000');
-- Explicit fictional cancellation policy only, with past and repeats deliberately permitted.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO public.ihr_leave_policies SELECT (jsonb_populate_record(NULL::public.ihr_leave_policies,to_jsonb(p)||jsonb_build_object(
 'id','82000000-0000-0000-0000-000000000090','version',2,'cancellation_rules_confirmed',true,'cancellation_mode','whole_request',
 'cancellation_allow_past',true,'cancellation_allow_repeat_declined',true,'cancellation_reason_required',true))).*
 FROM public.ihr_leave_policies p WHERE id='79000000-0000-0000-0000-000000000001';
UPDATE public.ihr_leave_members SET active_policy_id='82000000-0000-0000-0000-000000000090' WHERE user_id='71000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT public.leave_transaction_v1('82000000-0000-0000-0000-000000000007','request_cancellation',jsonb_build_object('request_id',:'request_id','expected_version',2,'reason','Fictional first attempt')) first_cancellation \gset
SELECT public.leave_request_transition_state_v1(:'request_id')->>'activeAttemptId' first_attempt \gset
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','82000000-0000-0000-0000-000000000008','withdraw_request',jsonb_build_object('request_id',:'request_id','expected_version',3)),'55000');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true(public.leave_assigned_request_v1(:'request_id')->'cancellation'->>'reason'='Fictional first attempt','cancellation carries separate private reason and snapshot');
SELECT public.leave_transaction_v1('82000000-0000-0000-0000-000000000009','decline_cancellation',jsonb_build_object('request_id',:'request_id','expected_version',3,'attempt_id',:'first_attempt','reason','Fictional declined once'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO public.ihr_leave_policies SELECT (jsonb_populate_record(NULL::public.ihr_leave_policies,to_jsonb(p)||jsonb_build_object('id','82000000-0000-0000-0000-000000000091','version',3,'cancellation_allow_repeat_declined',false))).*
 FROM public.ihr_leave_policies p WHERE id='82000000-0000-0000-0000-000000000090';
UPDATE public.ihr_leave_members SET active_policy_id='82000000-0000-0000-0000-000000000091' WHERE user_id='71000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(public.leave_request_transition_state_v1(:'request_id')->>'cancellationBlocker'='CANCELLATION_REPEAT_BLOCKED','repeat denied by explicitly confirmed fictional rule');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','82000000-0000-0000-0000-000000000015','request_cancellation',jsonb_build_object('request_id',:'request_id','expected_version',4,'reason','Fictional disallowed repeat')),'55000');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.ihr_leave_members SET active_policy_id='82000000-0000-0000-0000-000000000090' WHERE user_id='71000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT public.leave_transaction_v1('82000000-0000-0000-0000-000000000010','request_cancellation',jsonb_build_object('request_id',:'request_id','expected_version',4,'reason','Fictional second attempt'));
SELECT public.leave_request_transition_state_v1(:'request_id')->>'activeAttemptId' second_attempt \gset
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT public.leave_transaction_v1('82000000-0000-0000-0000-000000000011','decline_cancellation',jsonb_build_object('request_id',:'request_id','expected_version',5,'attempt_id',:'second_attempt','reason','Fictional declined twice'));
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT public.leave_transaction_v1('82000000-0000-0000-0000-000000000012','request_cancellation',jsonb_build_object('request_id',:'request_id','expected_version',6,'reason','Fictional final attempt'));
SELECT public.leave_request_transition_state_v1(:'request_id')->>'activeAttemptId' final_attempt \gset
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
CREATE TEMP TABLE pending_observation AS SELECT (SELECT count(*)=1 FROM public.ihr_leave_occupancy WHERE request_id=:'request_id') occupancy_retained,
 (SELECT sum(used_delta)=450 FROM public.ihr_leave_ledger WHERE source_kind='request' AND source_id=:'request_id') usage_retained,
 (SELECT count(*)=3 FROM private.ihr_leave_cancellation_attempts WHERE request_id=:'request_id') attempts_retained;
GRANT SELECT ON pending_observation TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true(occupancy_retained AND usage_retained AND attempts_retained,'repeated declines/pending keep original usage and occupancy') FROM pending_observation;
SELECT jsonb_build_object('request_id',:'request_id','expected_version',7,'attempt_id',:'final_attempt') accept_payload \gset
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.users SET is_active=false WHERE id='71000000-0000-0000-0000-000000000003';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','82000000-0000-0000-0000-000000000017','approve_cancellation',:'accept_payload'),'42501');
SELECT pg_temp.assert_denied(format('SELECT public.leave_assigned_request_v1(%L)',:'request_id'),'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.users SET is_active=true WHERE id='71000000-0000-0000-0000-000000000003';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT public.leave_transaction_v1('82000000-0000-0000-0000-000000000013','approve_cancellation',:'accept_payload') cancelled \gset
SELECT pg_temp.assert_true(public.leave_transaction_v1('82000000-0000-0000-0000-000000000013','approve_cancellation',:'accept_payload')=:'cancelled'::jsonb,'cancellation accept replay has one refund');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','82000000-0000-0000-0000-000000000014','approve_cancellation',:'accept_payload'),'55000');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
CREATE TEMP TABLE refund_observation AS SELECT
 (SELECT count(*)=0 FROM public.ihr_leave_occupancy WHERE request_id=:'request_id') released,
 (SELECT count(*)=1 AND sum(used_delta)=-450 FROM public.ihr_leave_ledger WHERE source_kind='request' AND source_id=:'request_id' AND kind='cancellation') refund_once,
 (SELECT count(*)=1 FROM private.ihr_leave_charge_reversals cr JOIN public.ihr_leave_ledger original ON original.id=cr.original_ledger_id
  JOIN public.ihr_leave_ledger refund ON refund.id=cr.reversal_ledger_id WHERE cr.request_id=:'request_id' AND original.account_id=refund.account_id AND original.used_delta=-refund.used_delta) exact_original,
 (SELECT count(*)=3 FROM private.ihr_leave_cancellation_attempts WHERE request_id=:'request_id') history_kept;
GRANT SELECT ON refund_observation TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(released AND refund_once AND exact_original AND history_kept,'whole cancellation refunds original charge once and keeps immutable attempts') FROM refund_observation;
SELECT public.leave_own_request_history_v1(:'request_id',NULL,NULL,50) owner_attempt_history \gset
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM jsonb_array_elements(:'owner_attempt_history'::jsonb->'rows') e WHERE e->>'event'='cancellation_declined') AND (SELECT count(*)=3 FROM jsonb_array_elements(:'owner_attempt_history'::jsonb->'rows') e WHERE e->>'event'='cancellation_requested') AND :'owner_attempt_history'::jsonb->'rows'->0->>'event'='cancellation_accepted','owner sees each declined attempt, later attempt and final acceptance');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.ihr_leave_members SET active_policy_id='86000000-0000-0000-0000-000000000001' WHERE user_id='71000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT jsonb_build_object('input',pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()),'quote_fingerprint',public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()))->>'fingerprint') replacement_payload \gset
SELECT public.leave_transaction_v1('82000000-0000-0000-0000-000000000016','submit_request',:'replacement_payload') replacement_receipt \gset
SELECT pg_temp.assert_true(:'replacement_receipt'::jsonb->>'id'<>:'request_id','same date can be submitted again only after accepted whole cancellation');
RESET ROLE;
ROLLBACK;
\ir decisions-authority.sql
\ir decisions-expired.sql
\echo IHR_REQUEST_DECISIONS_CANCELLATIONS_PASSED
