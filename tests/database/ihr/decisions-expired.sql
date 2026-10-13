-- Explicit fictional permission to cancel past leave; no actual rule selected.
BEGIN;
SELECT set_config('request.jwt.claim.sub','',true);
\ir quote-seed.sql
INSERT INTO public.ihr_leave_policies SELECT (jsonb_populate_record(NULL::public.ihr_leave_policies,to_jsonb(p)||jsonb_build_object(
 'id','84000000-0000-0000-0000-000000000090','version',2,'cancellation_rules_confirmed',true,'cancellation_mode','whole_request',
 'cancellation_allow_past',true,'cancellation_allow_repeat_declined',false,'cancellation_reason_required',false))).*
 FROM public.ihr_leave_policies p WHERE id='79000000-0000-0000-0000-000000000001';
UPDATE public.ihr_leave_members SET active_policy_id='84000000-0000-0000-0000-000000000090' WHERE user_id='71000000-0000-0000-0000-000000000001';
-- Build a prior-period opening import equivalent, with linked original charge and frozen allocation.
DO $$DECLARE a public.ihr_leave_accounts%ROWTYPE;ar public.ihr_leave_approvers%ROWTYPE;p public.ihr_leave_policies%ROWTYPE;m public.ihr_leave_members%ROWTYPE;yr integer;day date;BEGIN
 yr:=extract(year FROM statement_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::integer-1;
 day:=make_date(yr,6,2);
 a:=private.ihr_leave_prepare_account('71000000-0000-0000-0000-000000000001',make_date(yr,1,2)::timestamp AT TIME ZONE 'Pacific/Kiritimati');
 UPDATE public.ihr_leave_accounts SET opening_reconciled=true,opening_as_of=make_date(yr,1,1),opening_source_id='84000000-0000-0000-0000-000000000080' WHERE id=a.id;
 INSERT INTO public.ihr_leave_ledger(account_id,effective_date,kind,used_delta,source_kind,source_id,source_event,actor_id)
 VALUES(a.id,make_date(yr,1,1),'opening',450,'opening','84000000-0000-0000-0000-000000000080','reconciled','71000000-0000-0000-0000-000000000006');
 SELECT * INTO m FROM public.ihr_leave_members WHERE user_id=a.employee_id;SELECT * INTO p FROM public.ihr_leave_policies WHERE id=m.active_policy_id;
 SELECT * INTO ar FROM public.ihr_leave_approvers WHERE employee_id=a.employee_id;
 INSERT INTO public.ihr_leave_requests(id,employee_id,status,start_date,end_date,duration,total_minutes,reason,approver_id,approver_name,assignment_id,assignment_version,policy_id,policy_version,member_version,source_snapshot,source_kind,source_id,submitted_at,created_by)
 VALUES('84000000-0000-0000-0000-000000000001',a.employee_id,'approved',day,day,'{"mode":"full_scheduled_day"}',450,'Fictional historical opening',ar.approver_id,'Fictional manager',ar.id,ar.version,p.id,p.version,m.version,
 jsonb_build_object('openingSourceId','84000000-0000-0000-0000-000000000080','member',to_jsonb(m),'policy',to_jsonb(p),'assignment',to_jsonb(ar)),'opening','84000000-0000-0000-0000-000000000081',make_date(yr,1,1)::timestamp AT TIME ZONE 'Pacific/Kiritimati','71000000-0000-0000-0000-000000000006');
 INSERT INTO public.ihr_leave_request_days VALUES('84000000-0000-0000-0000-000000000001',day,450,450,NULL,a.id,'{}');
 INSERT INTO public.ihr_leave_request_allocations VALUES('84000000-0000-0000-0000-000000000001',a.id,a.year,a.period_start,a.period_end,a.timezone,450,a.version);
 INSERT INTO public.ihr_leave_occupancy VALUES(a.employee_id,day,'84000000-0000-0000-0000-000000000001');
END $$;
INSERT INTO public.ihr_leave_policies SELECT (jsonb_populate_record(NULL::public.ihr_leave_policies,to_jsonb(p)||jsonb_build_object('id','84000000-0000-0000-0000-000000000091','version',3,'cancellation_allow_past',false))).*
 FROM public.ihr_leave_policies p WHERE id='84000000-0000-0000-0000-000000000090';
UPDATE public.ihr_leave_members SET active_policy_id='84000000-0000-0000-0000-000000000091' WHERE user_id='71000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(public.leave_request_transition_state_v1('84000000-0000-0000-0000-000000000001')->>'cancellationBlocker'='CANCELLATION_PAST_DATE_BLOCKED','past leave blocked by explicit confirmed fictional rule');
SELECT pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('84000000-0000-0000-0000-000000000004','request_cancellation','{"request_id":"84000000-0000-0000-0000-000000000001","expected_version":1,"reason":""}')$s$,'55000');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.ihr_leave_members SET active_policy_id='84000000-0000-0000-0000-000000000090' WHERE user_id='71000000-0000-0000-0000-000000000001';
CREATE TEMP TABLE current_before AS SELECT id,used_minutes,allowance_minutes,reserved_minutes,version FROM public.ihr_leave_accounts WHERE employee_id='71000000-0000-0000-0000-000000000001' AND year=extract(year FROM statement_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::integer;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT public.leave_transaction_v1('84000000-0000-0000-0000-000000000002','request_cancellation','{"request_id":"84000000-0000-0000-0000-000000000001","expected_version":1,"reason":""}');
SELECT public.leave_request_transition_state_v1('84000000-0000-0000-0000-000000000001')->>'activeAttemptId' attempt \gset
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT public.leave_transaction_v1('84000000-0000-0000-0000-000000000003','approve_cancellation',jsonb_build_object('request_id','84000000-0000-0000-0000-000000000001','expected_version',2,'attempt_id',:'attempt'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
CREATE TEMP TABLE expired_observation AS SELECT
 (SELECT bool_and(a.used_minutes=b.used_minutes AND a.allowance_minutes=b.allowance_minutes AND a.reserved_minutes=b.reserved_minutes AND a.version=b.version) FROM current_before b JOIN public.ihr_leave_accounts a USING(id)) current_untouched,
 (SELECT (private.ihr_leave_balance_json(a,statement_timestamp())->>'availableMinutes')::integer=0 AND (private.ihr_leave_balance_json(a,statement_timestamp())->>'expiredMinutes')::integer=5400
 FROM public.ihr_leave_accounts a JOIN public.ihr_leave_request_allocations ra ON ra.account_id=a.id WHERE ra.request_id='84000000-0000-0000-0000-000000000001') original_expired;
GRANT SELECT ON expired_observation TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(current_untouched AND original_expired,'prior-year original credit remains expired and current allowance is unchanged') FROM expired_observation;
RESET ROLE;
ROLLBACK;
