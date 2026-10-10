BEGIN;
SELECT set_config('request.jwt.claim.sub','',true);
\ir quote-seed.sql
-- The manager gets a real synthetic authoritative account so directors can approve manager leave.
DO $$DECLARE a public.ihr_leave_accounts%ROWTYPE;BEGIN
 a:=private.ihr_leave_prepare_account('71000000-0000-0000-0000-000000000003',statement_timestamp());
 UPDATE public.ihr_leave_accounts SET opening_reconciled=true,opening_as_of=a.period_start,opening_source_id=gen_random_uuid() WHERE id=a.id;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT jsonb_build_object('input',pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()),'quote_fingerprint',public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()))->>'fingerprint') payload \gset
SELECT public.leave_transaction_v1('83000000-0000-0000-0000-000000000001','submit_request',:'payload') manager_request \gset
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true(jsonb_array_length(public.leave_assigned_inbox_v1()->'rows')=1,'director sees only assigned manager');
SELECT public.leave_transaction_v1('83000000-0000-0000-0000-000000000002','approve_request',jsonb_build_object('request_id',:'manager_request'::jsonb->>'id','expected_version',1));
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT jsonb_build_object('input',pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()),'quote_fingerprint',public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()))->>'fingerprint') payload \gset
SELECT public.leave_transaction_v1('83000000-0000-0000-0000-000000000003','submit_request',:'payload') submitted \gset
SELECT :'submitted'::jsonb->>'id' request_id \gset
-- Relevant member source edit makes pending approval stale, without rewriting history.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.ihr_leave_members SET employment_start='2019-01-01' WHERE user_id='71000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','83000000-0000-0000-0000-000000000004','approve_request',jsonb_build_object('request_id',:'request_id','expected_version',1)),'55000');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','83000000-0000-0000-0000-000000000005','reject_request',jsonb_build_object('request_id',:'request_id','expected_version',1,'reason',' ')),'22023');
-- Revocation immediately removes detail and no historical request assignment grants access.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.ihr_leave_approvers SET revoked_at=clock_timestamp(),revoked_by='71000000-0000-0000-0000-000000000006' WHERE employee_id='71000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true(jsonb_array_length(public.leave_assigned_inbox_v1()->'rows')=0,'removed approver loses inbox immediately');
SELECT pg_temp.assert_denied(format('SELECT public.leave_assigned_request_v1(%L)',:'request_id'),'42501');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','83000000-0000-0000-0000-000000000006','reject_request',jsonb_build_object('request_id',:'request_id','expected_version',1,'reason','No longer assigned')),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT public.leave_transaction_v1('83000000-0000-0000-0000-000000000007','withdraw_request',jsonb_build_object('request_id',:'request_id','expected_version',1));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
CREATE TEMP TABLE withdrawal_observation AS SELECT
 (SELECT count(*)=0 FROM public.ihr_leave_occupancy WHERE request_id=:'request_id') released,
 (SELECT sum(reserved_delta)=0 FROM public.ihr_leave_ledger WHERE source_kind='request' AND source_id=:'request_id') released_once;
GRANT SELECT ON withdrawal_observation TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(released AND released_once,'withdrawal stays possible with stale setup and releases original reservation') FROM withdrawal_observation;
-- A newly selected calendar version stales a different pending request; reject remains available.
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
SELECT jsonb_build_object('input',pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()),'quote_fingerprint',public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()))->>'fingerprint') calendar_payload \gset
SELECT public.leave_transaction_v1('83000000-0000-0000-0000-000000000008','submit_request',:'calendar_payload') calendar_request \gset
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO public.ihr_leave_calendars(id,calendar_id,version,name,effective_from,effective_until,timezone,holidays_confirmed,sunday_minutes,created_by)
 VALUES('83000000-0000-0000-0000-000000000090','73000000-0000-0000-0000-000000000090',2,'Fictional changed calendar','2020-01-01','2040-01-01','Pacific/Kiritimati',true,0,'71000000-0000-0000-0000-000000000006');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','83000000-0000-0000-0000-000000000009','approve_request',jsonb_build_object('request_id',:'calendar_request'::jsonb->>'id','expected_version',1)),'55000');
SELECT public.leave_transaction_v1('83000000-0000-0000-0000-000000000010','reject_request',jsonb_build_object('request_id',:'calendar_request'::jsonb->>'id','expected_version',1,'reason','Fictional calendar changed'));
SELECT pg_temp.assert_true(public.leave_own_request_v1((:'manager_request'::jsonb->>'id')::uuid)->>'totalMinutes'='450','approved manager charge remains frozen after calendar publication');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
CREATE TEMP TABLE rejection_observation AS SELECT
 (SELECT count(*)=0 FROM public.ihr_leave_occupancy WHERE request_id=(:'calendar_request'::jsonb->>'id')::uuid) occupancy_released,
 (SELECT count(*)=1 AND sum(reserved_delta)=-450 AND sum(used_delta)=0 FROM public.ihr_leave_ledger WHERE source_kind='request' AND source_id=(:'calendar_request'::jsonb->>'id')::uuid AND kind='rejection') reservation_released;
GRANT SELECT ON rejection_observation TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert_true(occupancy_released AND reservation_released,'rejection releases reservation and dates once without usage') FROM rejection_observation;
RESET ROLE;
ROLLBACK;
