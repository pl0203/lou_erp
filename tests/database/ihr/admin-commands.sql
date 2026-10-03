-- Included in admin.sql's transaction. No standalone marker or independent fixture ownership.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
CREATE TEMP TABLE admin_request_frozen AS SELECT id,to_jsonb(r)-'version'-'status' source,
 (SELECT jsonb_agg(to_jsonb(d) ORDER BY day) FROM public.ihr_leave_request_days d WHERE d.request_id=r.id) days,
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY account_id) FROM public.ihr_leave_request_allocations a WHERE a.request_id=r.id) allocations
 FROM public.ihr_leave_requests r WHERE id=(:'receipt'::jsonb->>'id')::uuid;
GRANT SELECT ON admin_request_frozen TO authenticated;
INSERT INTO public.ihr_leave_members(user_id,member_kind,active) VALUES('71000000-0000-0000-0000-000000000016','manager',true);
UPDATE public.ihr_leave_approvers SET revoked_at=clock_timestamp(),revoked_by='71000000-0000-0000-0000-000000000006' WHERE employee_id='71000000-0000-0000-0000-000000000001' AND revoked_at IS NULL;
INSERT INTO public.ihr_leave_approvers(id,employee_id,approver_id,effective_from,assigned_by) VALUES('81000000-0000-0000-0000-000000000020','71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000016',clock_timestamp()-interval '1 minute','71000000-0000-0000-0000-000000000006');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000009',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','81000000-0000-0000-0000-000000000005','reassign_request',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','request_id',:'receipt'::jsonb->>'id','assignment_id','81000000-0000-0000-0000-000000000020','expected_version',1,'reason','Fictional configure cannot read request')),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT clock_timestamp() reassign_started_at \gset
SELECT public.leave_transaction_v1('81000000-0000-0000-0000-000000000006','reassign_request',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','request_id',:'receipt'::jsonb->>'id','assignment_id','81000000-0000-0000-0000-000000000020','expected_version',1,'reason','Fictional explicit reassignment')) reassigned \gset
SELECT clock_timestamp() reassign_finished_at \gset
SELECT pg_temp.assert_true(:'reassigned'::jsonb->>'version'='2','reassignment advances exact request version');
SELECT pg_temp.assert_true((SELECT count(*)=1 AND bool_and(e->>'atTime' IS NOT NULL AND (e->>'atTime')::timestamptz BETWEEN :'reassign_started_at'::timestamptz AND :'reassign_finished_at'::timestamptz)
 FROM jsonb_array_elements(public.leave_hr_request_history_v1('71000000-0000-0000-0000-000000000001',(:'receipt'::jsonb->>'id')::uuid,NULL,NULL,50)->'rows') e WHERE e->>'event'='reassigned'),
 'reassignment history records exactly one event at the current command instant');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','81000000-0000-0000-0000-000000000007','reassign_request',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','request_id',:'receipt'::jsonb->>'id','assignment_id','81000000-0000-0000-0000-000000000020','expected_version',1,'reason','Fictional stale reassignment')),'55000');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_assigned_request_v1(%L)',:'receipt'::jsonb->>'id'),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000016',true);
SELECT pg_temp.assert_true(public.leave_assigned_request_v1((:'receipt'::jsonb->>'id')::uuid)->>'version'='2','new explicit approver alone reads reassigned request');
SELECT public.leave_transaction_v1('81000000-0000-0000-0000-000000000008','approve_request',jsonb_build_object('request_id',:'receipt'::jsonb->>'id','expected_version',2));
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(public.leave_own_request_v1((:'receipt'::jsonb->>'id')::uuid)->>'approverName'='Fictional iHR 3','employee original approver history remains frozen');
SELECT public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday()+3,pg_temp.quote_friday()+3)) before_successor_quote \gset
SELECT public.leave_prepare_self_v1() before_successor_account \gset
SELECT pg_temp.assert_denied($s$SELECT public.leave_quote_v1(jsonb_set(pg_temp.quote_input(pg_temp.quote_friday()+3,pg_temp.quote_friday()+3),'{reason}','""'))$s$,'22023');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT public.leave_admin_settings_v1('71000000-0000-0000-0000-000000000001') admin_before \gset
SELECT jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','expected_version',(:'admin_before'::jsonb->>'memberVersion')::bigint,'reason','Fictional rules-only version','effective_from',(clock_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::date,'effective_until',NULL,
 'annual_policy_confirmed',true,'request_rules_confirmed',true,'minimum_notice_days',0,'booking_horizon_days',366,'reason_required',false,'reserve_pending_accepted',true,'single_date_rule_accepted',true,
 'cancellation_rules_confirmed',true,'cancellation_mode','whole_request','cancellation_allow_past',false,'cancellation_allow_repeat_declined',false,'cancellation_reason_required',true,'calendar_audience','explicit_grants','calendar_audience_confirmed',true) new_policy_payload \gset
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','81000000-0000-0000-0000-000000000009','save_policy_version',:'new_policy_payload'::jsonb||'{"annual_allowance_minutes":99999}'),'22023');
SELECT public.leave_transaction_v1('81000000-0000-0000-0000-000000000010','save_policy_version',:'new_policy_payload') policy_receipt \gset
SELECT public.leave_transaction_v1('81000000-0000-0000-0000-000000000011','activate_member_policy',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','expected_version',(:'admin_before'::jsonb->>'memberVersion')::bigint,'reason','Fictional sanctioned activation','policy_id',:'policy_receipt'::jsonb->>'id','established_eligibility_confirmed',true));
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday()+3,pg_temp.quote_friday()+3)) after_successor_quote \gset
SELECT pg_temp.assert_true(:'after_successor_quote'::jsonb->>'totalMinutes'='450' AND :'after_successor_quote'::jsonb->>'fingerprint'<>:'before_successor_quote'::jsonb->>'fingerprint','legitimate midyear successor quotes successfully with changed fingerprint');
SELECT pg_temp.assert_true(public.leave_context_v1()->'currentPeriod'->>'year'=:'before_successor_account'::jsonb->>'year','midyear successor retains current-period context');
SELECT pg_temp.assert_true(public.leave_prepare_self_v1()->>'accountId'=:'before_successor_account'::jsonb->>'accountId','midyear preparation returns original account');
SELECT public.leave_quote_v1(jsonb_set(pg_temp.quote_input(pg_temp.quote_friday()+3,pg_temp.quote_friday()+3),'{reason}','""')) no_reason_quote \gset
SELECT public.leave_transaction_v1('81000000-0000-0000-0000-000000000017','submit_request',jsonb_build_object('input',jsonb_set(pg_temp.quote_input(pg_temp.quote_friday()+3,pg_temp.quote_friday()+3),'{reason}','""'),'quote_fingerprint',:'no_reason_quote'::jsonb->>'fingerprint')) successor_request \gset
SELECT pg_temp.assert_true(public.leave_own_request_v1((:'successor_request'::jsonb->>'id')::uuid)->>'reason'='','changed successor rule permits empty reason in quote and actual submission');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT public.leave_balance_accounts_v1('71000000-0000-0000-0000-000000000001') successor_balances \gset
SELECT pg_temp.assert_true(:'successor_balances'::jsonb->'currentPeriod'->>'year'=:'before_successor_account'::jsonb->>'year','private balance period remains consistent with successor');
SELECT public.leave_transaction_v1('81000000-0000-0000-0000-000000000018','adjust_balance',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','year',(:'before_successor_account'::jsonb->>'year')::integer,'source_id','81000000-0000-0000-0000-000000000019','expected_version',(SELECT (b->>'version')::bigint FROM jsonb_array_elements(:'successor_balances'::jsonb->'balances') b WHERE b->>'accountId'=:'before_successor_account'::jsonb->>'accountId'),'reason','Fictional successor adjustment consistency','delta_minutes',60));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
CREATE TEMP TABLE admin_frozen_observations AS SELECT source=(to_jsonb(r)-'version'-'status') source_unchanged,
 days=(SELECT jsonb_agg(to_jsonb(d) ORDER BY day) FROM public.ihr_leave_request_days d WHERE d.request_id=r.id) days_unchanged,
 allocations=(SELECT jsonb_agg(to_jsonb(a) ORDER BY account_id) FROM public.ihr_leave_request_allocations a WHERE a.request_id=r.id) allocations_unchanged,
 (SELECT count(*)=1 FROM public.ihr_leave_ledger l WHERE l.kind='annual_grant' AND l.account_id IN(SELECT account_id FROM public.ihr_leave_request_allocations WHERE request_id=r.id)) single_grant
 FROM admin_request_frozen f JOIN public.ihr_leave_requests r ON r.id=f.id;
GRANT SELECT ON admin_frozen_observations TO authenticated;
-- Exact externally provisioned manifest for one ordinary grant, plus a forbidden self-grant manifest.
INSERT INTO private.ihr_leave_access_manifests(id,grant_id,actor_id,grantor_id,capability,scope_kind,employee_id,effective_from,approved_by,approved_at,approval_reference,confirmed) VALUES
('81000000-0000-0000-0000-000000000030','81000000-0000-0000-0000-000000000031','71000000-0000-0000-0000-000000000015','71000000-0000-0000-0000-000000000013','calendar','employee','71000000-0000-0000-0000-000000000001',clock_timestamp(),'71000000-0000-0000-0000-000000000014',clock_timestamp()-interval '1 day','Fictional named grant',true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_true(source_unchanged AND days_unchanged AND allocations_unchanged AND single_grant,'reassignment and policy activation preserve approved source, charges, periods and one grant') FROM admin_frozen_observations;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000013',true);
SELECT public.leave_transaction_v1('81000000-0000-0000-0000-000000000012','grant_leave_access','{"manifest_id":"81000000-0000-0000-0000-000000000030","expected_version":0,"reason":"Apply exact fictional named approval"}') grant_receipt \gset
SELECT pg_temp.assert_true(:'grant_receipt'::jsonb->>'id'='81000000-0000-0000-0000-000000000031','manifest determines exact approved grant identity');
SELECT pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('81000000-0000-0000-0000-000000000013','grant_leave_access','{"manifest_id":"81000000-0000-0000-0000-000000000030","expected_version":0,"reason":"cannot expand","capability":"manage_access"}')$s$,'22023');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_true(public.leave_admin_readiness_v1('71000000-0000-0000-0000-000000000001')->>'ready'='false','new grant requires fresh approved coverage; old review cannot silently expand');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000013',true);
SELECT public.leave_transaction_v1('81000000-0000-0000-0000-000000000014','revoke_leave_access','{"grant_id":"81000000-0000-0000-0000-000000000031","expected_version":1,"reason":"Revoke fictional named grant"}');
SELECT pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('81000000-0000-0000-0000-000000000015','revoke_leave_access','{"grant_id":"81000000-0000-0000-0000-000000000031","expected_version":1,"reason":"stale revoke"}')$s$,'55000');
-- Self-management remains denied even to a separately evidenced access manager.
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','81000000-0000-0000-0000-000000000016','revoke_leave_access',jsonb_build_object('grant_id',(SELECT g->>'id' FROM jsonb_array_elements(public.leave_admin_access_v1('71000000-0000-0000-0000-000000000001')->'grants')g WHERE g->>'actorId'='71000000-0000-0000-0000-000000000013'),'expected_version',1,'reason','Fictional own grant change denied')),'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ DECLARE base jsonb;BEGIN
 SELECT to_jsonb(p) INTO base FROM public.ihr_leave_policies p WHERE id=(SELECT active_policy_id FROM public.ihr_leave_members WHERE user_id='71000000-0000-0000-0000-000000000001');
 INSERT INTO public.ihr_leave_policies SELECT (jsonb_populate_record(NULL::public.ihr_leave_policies,jsonb_set(base,'{id}','"81000000-0000-0000-0000-000000000040"'))).*;
 INSERT INTO public.ihr_leave_policies SELECT (jsonb_populate_record(NULL::public.ihr_leave_policies,jsonb_set(base,'{id}','"81000000-0000-0000-0000-000000000041"'))).*;
 INSERT INTO private.ihr_leave_policy_owners VALUES('81000000-0000-0000-0000-000000000040','71000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000041'),('81000000-0000-0000-0000-000000000041','71000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000040');
END $$;
CREATE TEMP TABLE admin_cycle_observation AS SELECT private.ihr_leave_policy_account_compatible('71000000-0000-0000-0000-000000000001','79000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000040') cycle_accepted;
GRANT SELECT ON admin_cycle_observation TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_true(NOT cycle_accepted,'cyclic synthetic predecessor graph fails closed') FROM admin_cycle_observation;
