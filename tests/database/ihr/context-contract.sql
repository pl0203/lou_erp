-- FICTIONAL ONLY. Final public RPC contract, as actual non-bypass application roles.
-- All fixture changes roll back; JSON export is local CI evidence, never a hosted write.
BEGIN;
SELECT set_config('request.jwt.claim.sub','',true);
\ir quote-seed.sql
-- Employee 2 becomes an explicitly routed manager while keeping its own configured account.
UPDATE public.ihr_leave_approvers SET revoked_at=statement_timestamp(),revoked_by='71000000-0000-0000-0000-000000000006'
WHERE employee_id='71000000-0000-0000-0000-000000000002' AND revoked_at IS NULL;
UPDATE public.ihr_leave_members SET member_kind='manager' WHERE user_id='71000000-0000-0000-0000-000000000002';
INSERT INTO public.ihr_leave_approvers(employee_id,approver_id,effective_from,assigned_by)
VALUES('71000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000004','2000-01-01','71000000-0000-0000-0000-000000000006');
\ir admin-governance-seed.sql
SET LOCAL ROLE anon;
SELECT pg_temp.assert_denied($s$SELECT public.leave_context_v1()$s$,'42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000007',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_context_v1()$s$,'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT public.leave_context_v1() context \gset ready_employee_
SELECT pg_temp.assert_true(:'ready_employee_context'::jsonb->'setup'='{"ready":true,"blockers":[]}'::jsonb,'fully configured employee context is ready');
SELECT pg_temp.assert_true(:'ready_employee_context'::jsonb->>'memberKind'='employee' AND :'ready_employee_context'::jsonb->'capabilities'->>'request'='true' AND jsonb_array_length(:'ready_employee_context'::jsonb->'balances')=2,'ready employee retains own capabilities and historical balances');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
SELECT public.leave_context_v1() context \gset ready_manager_
SELECT pg_temp.assert_true(:'ready_manager_context'::jsonb->'setup'='{"ready":true,"blockers":[]}'::jsonb AND :'ready_manager_context'::jsonb->>'memberKind'='manager','fully configured manager context is ready');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT public.leave_context_v1() context \gset blocked_manager_
SELECT pg_temp.assert_true(:'blocked_manager_context'::jsonb->'setup'->>'ready'='false' AND jsonb_typeof(:'blocked_manager_context'::jsonb->'setup'->'blockers')='array','incomplete manager keeps an array of blockers');
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(:'blocked_manager_context'::jsonb->'setup'->'blockers') b WHERE b->>'code'='OPENING_UNCONFIRMED'),'real missing opening remains blocked');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT public.leave_context_v1() context \gset director_
SELECT pg_temp.assert_true(:'director_context'::jsonb->>'memberKind'='director' AND :'director_context'::jsonb->'capabilities'='{"request":false,"approve":true,"configure":false,"adjust":false,"readPrivate":false,"manageAccess":false}'::jsonb AND :'director_context'::jsonb->'balances'='[]'::jsonb AND :'director_context'::jsonb->'currentPeriod'='null'::jsonb,'director remains approval-only without a personal period or balance');
SELECT pg_temp.assert_true(:'director_context'::jsonb->'setup'->'blockers'->0->>'code'='director_excluded','director exclusion unchanged');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT public.leave_context_v1() context \gset nonmember_
SELECT pg_temp.assert_true(:'nonmember_context'::jsonb->'memberKind'='null'::jsonb AND :'nonmember_context'::jsonb->'capabilities'->>'request'='false' AND :'nonmember_context'::jsonb->'capabilities'->>'configure'='true' AND :'nonmember_context'::jsonb->'balances'='[]'::jsonb,'nonmember admin retains only explicit access and no personal balance');
SELECT pg_temp.assert_true(:'nonmember_context'::jsonb->'setup'->'blockers'->0->>'code'='member_missing','nonmember blocker unchanged');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
-- Supersede one external approval with explicitly unconfirmed evidence; legacy setup remains clean.
INSERT INTO private.ihr_leave_governance_approvals
SELECT (jsonb_populate_record(NULL::private.ihr_leave_governance_approvals,to_jsonb(a)||jsonb_build_object('id','8a000000-0000-0000-0000-000000000091','confirmed',false))).*
FROM private.ihr_leave_governance_approvals a JOIN private.ihr_leave_governance_references r ON r.approval_id=a.id
WHERE r.employee_id='71000000-0000-0000-0000-000000000001' AND r.kind='retention';
INSERT INTO private.ihr_leave_governance_references VALUES('71000000-0000-0000-0000-000000000001','retention',2,'8a000000-0000-0000-0000-000000000091','71000000-0000-0000-0000-000000000006',statement_timestamp());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT public.leave_context_v1() context \gset governance_blocked_
SELECT pg_temp.assert_true(:'governance_blocked_context'::jsonb->'setup'->>'ready'='false' AND jsonb_array_length(:'governance_blocked_context'::jsonb->'setup'->'blockers')=1 AND :'governance_blocked_context'::jsonb->'setup'->'blockers'->0->>'code'='RETENTION_UNCONFIRMED','real governance blocker alone keeps otherwise-complete setup blocked');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.ihr_leave_members SET active=false WHERE user_id='71000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT public.leave_context_v1() context \gset inactive_member_
SELECT pg_temp.assert_true(:'inactive_member_context'::jsonb->'capabilities'->>'request'='false' AND :'inactive_member_context'::jsonb->'setup'->>'ready'='false','inactive HR member remains unable to request');
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(:'inactive_member_context'::jsonb->'setup'->'blockers') b WHERE b->>'code'='member_inactive'),'legacy inactive member blocker preserved');
-- The real RPC JSON is consumed by the unchanged client adapter after the SQL suite.
\pset format unaligned
\pset tuples_only on
\o scale-results/ihr-context-contract.json
SELECT jsonb_build_object('readyEmployee',:'ready_employee_context'::jsonb,'readyManager',:'ready_manager_context'::jsonb,
 'blockedManager',:'blocked_manager_context'::jsonb,'governanceBlocked',:'governance_blocked_context'::jsonb,'director',:'director_context'::jsonb,
 'nonmember',:'nonmember_context'::jsonb,'inactiveMember',:'inactive_member_context'::jsonb);
\o
\pset format aligned
\pset tuples_only off
RESET ROLE;
ROLLBACK;
\echo IHR_FINAL_CONTEXT_CONTRACT_PASSED
