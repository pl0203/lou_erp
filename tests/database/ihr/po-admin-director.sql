-- FICTIONAL ONLY: execute against the guarded disposable pilot_test database.
-- Every fixture and workflow effect rolls back; permission assertions use non-bypass roles.
\set ON_ERROR_STOP on
\ir helpers.sql
BEGIN;
SELECT set_config('request.jwt.claim.sub','',true);
\ir composed/quote-seed.sql
-- Fictional user 2 is already po_admin + employee with a complete annual account.
-- Replace only its synthetic manager assignment with an explicitly named director.
UPDATE public.ihr_leave_approvers SET revoked_at=statement_timestamp(),revoked_by='71000000-0000-0000-0000-000000000006'
WHERE employee_id='71000000-0000-0000-0000-000000000002' AND revoked_at IS NULL;
INSERT INTO public.ihr_leave_approvers(id,employee_id,approver_id,effective_from,assigned_by)
VALUES('8b000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000004','2020-01-01','71000000-0000-0000-0000-000000000006');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert_true(public.leave_context_v1()->>'memberKind'='employee' AND public.leave_context_v1()->'capabilities'='{"request":true,"approve":false,"configure":false,"adjust":false,"readPrivate":false,"manageAccess":false}'::jsonb,'PO Admin stays employee with own-leave only');
SELECT pg_temp.assert_true(public.leave_context_v1()->'setup'->>'ready'='true','PO Admin existing explicit test setup is ready');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_setup_v1('members',1,20)$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_own_request_v1('8b000000-0000-0000-0000-000000000099')$s$,'42501');
SELECT public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday())) quote \gset
SELECT pg_temp.assert_true(:'quote'::jsonb->'approver'->>'id'='71000000-0000-0000-0000-000000000004','PO Admin quote resolves only its assigned director');
SELECT jsonb_build_object('input',pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()),'quote_fingerprint',:'quote'::jsonb->>'fingerprint') payload \gset
SELECT public.leave_transaction_v1('8b000000-0000-0000-0000-000000000002','submit_request',:'payload') submitted \gset
SELECT :'submitted'::jsonb->>'id' request_id \gset
SELECT jsonb_build_object('request_id',:'request_id','expected_version',1) decision_payload \gset
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','8b000000-0000-0000-0000-000000000003','approve_request',:'decision_payload'),'42501');
-- An unassigned director and the old manager cannot read or approve this request.
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000017',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_assigned_request_v1(%L)',:'request_id'),'42501');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','8b000000-0000-0000-0000-000000000004','approve_request',:'decision_payload'),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_assigned_request_v1(%L)',:'request_id'),'42501');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','8b000000-0000-0000-0000-000000000005','approve_request',:'decision_payload'),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true(public.leave_assigned_inbox_v1()->'rows'->0->>'id'=:'request_id','assigned director sees the pending PO Admin request');
SELECT pg_temp.assert_true(public.leave_context_v1()->'capabilities'='{"request":false,"approve":true,"configure":false,"adjust":false,"readPrivate":false,"manageAccess":false}'::jsonb,'Director remains approval-only');
SELECT pg_temp.assert_true(public.leave_assigned_request_v1(:'request_id')->>'reason'='Fictional private reason','assigned director can review only the request detail');
SELECT public.leave_context_v1()->>'scopeVersion' director_scope \gset
-- Removing po_admin status immediately removes this exceptional route and bumps scope.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.users SET role='sales_person' WHERE id='71000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true(public.leave_context_v1()->>'scopeVersion'<>:'director_scope','application role change invalidates leave scope');
SELECT pg_temp.assert_denied(format('SELECT public.leave_assigned_request_v1(%L)',:'request_id'),'42501');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','8b000000-0000-0000-0000-000000000006','approve_request',:'decision_payload'),'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.users SET role='po_admin' WHERE id='71000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT public.leave_transaction_v1('8b000000-0000-0000-0000-000000000007','approve_request',:'decision_payload') approved \gset
SELECT pg_temp.assert_true(:'approved'::jsonb->>'version'='2','assigned director approves PO Admin request');
SELECT pg_temp.assert_true(public.leave_transaction_v1('8b000000-0000-0000-0000-000000000007','approve_request',:'decision_payload')=:'approved'::jsonb,'approval replay stays idempotent');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
SELECT public.leave_transaction_v1('8b000000-0000-0000-0000-000000000008','request_cancellation',jsonb_build_object('request_id',:'request_id','expected_version',2,'reason','Fictional cancellation'));
SELECT public.leave_request_transition_state_v1(:'request_id')->>'activeAttemptId' cancellation_attempt \gset
SELECT jsonb_build_object('request_id',:'request_id','expected_version',3,'attempt_id',:'cancellation_attempt') cancellation_payload \gset
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','8b000000-0000-0000-0000-000000000009','approve_cancellation',:'cancellation_payload'),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT public.leave_transaction_v1('8b000000-0000-0000-0000-000000000010','approve_cancellation',:'cancellation_payload') cancelled \gset
SELECT pg_temp.assert_true(:'cancelled'::jsonb->>'version'='4','same assigned director approves cancellation');
SELECT pg_temp.assert_true(public.leave_transaction_v1('8b000000-0000-0000-0000-000000000010','approve_cancellation',:'cancellation_payload')=:'cancelled'::jsonb,'cancellation replay refunds once');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','8b000000-0000-0000-0000-000000000011','approve_cancellation',:'cancellation_payload'),'55000');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
CREATE TEMP TABLE po_refund_observation AS SELECT
 (SELECT count(*)=1 AND sum(used_delta)=-450 FROM public.ihr_leave_ledger WHERE source_id=:'request_id' AND kind='cancellation') refund_once,
 NOT EXISTS(SELECT 1 FROM public.ihr_leave_occupancy WHERE request_id=:'request_id') occupancy_cleared,
 (SELECT member_kind='employee' FROM public.ihr_leave_members WHERE user_id='71000000-0000-0000-0000-000000000002') employee_preserved;
GRANT SELECT ON po_refund_observation TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert_true(refund_once AND occupancy_cleared AND employee_preserved,'cancellation preserves employee classification and returns exactly the original charge') FROM po_refund_observation;
RESET ROLE;
ROLLBACK;

-- The normal independent administrator command accepts this one additional route.
BEGIN;
SELECT set_config('request.jwt.claim.sub','',true);
\ir composed/quote-seed.sql
INSERT INTO public.ihr_leave_access_grants(actor_id,capability,scope_kind,employee_id,effective_from,granted_by,reason)
SELECT '71000000-0000-0000-0000-000000000006','configure','employee',target,'2020-01-01','71000000-0000-0000-0000-000000000005','Fictional scoped setup choice verification'
FROM unnest(ARRAY['71000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000015']::uuid[]) target;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000006',true);
SELECT pg_temp.assert_true(value->'allowedApproverKinds'=CASE value->>'id'
 WHEN '71000000-0000-0000-0000-000000000002' THEN '["manager","director"]'::jsonb
 WHEN '71000000-0000-0000-0000-000000000003' THEN '["director"]'::jsonb ELSE '[]'::jsonb END,
 'server scopes PO Admin, manager, director and unset member route choices')
FROM jsonb_array_elements(public.leave_admin_setup_v1('members',1,100)->'rows');
SELECT value member FROM jsonb_array_elements(public.leave_admin_setup_v1('members',1,100)->'rows')
WHERE value->>'id'='71000000-0000-0000-0000-000000000002' \gset
SELECT jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000002',
 'approver_id','71000000-0000-0000-0000-000000000004','effective_from','2035-01-01','effective_until','2036-01-01',
 'replace_assignment_id',:'member'::jsonb->'assignments'->0->>'id','expected_version',(:'member'::jsonb->>'version')::bigint,
 'reason','Fictional explicit PO Admin director assignment') assignment_payload \gset
SELECT public.leave_transaction_v1('8b000000-0000-0000-0000-000000000020','set_approver',:'assignment_payload') route_receipt \gset
SELECT pg_temp.assert_true(:'route_receipt'::jsonb->>'operation'='set_approver','independent configure scope may assign a director to PO Admin employee');
SELECT pg_temp.assert_true(public.leave_transaction_v1('8b000000-0000-0000-0000-000000000020','set_approver',:'assignment_payload')=:'route_receipt'::jsonb,'assignment command remains idempotent');
-- Unchanged salesperson employee must still be routed to a manager, not director.
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_true(public.leave_admin_setup_v1('members',1,100)->'rows'->0->'allowedApproverKinds'='["manager"]'::jsonb,'ordinary employee options remain manager-only');
SELECT value member FROM jsonb_array_elements(public.leave_admin_setup_v1('members',1,100)->'rows')
WHERE value->>'id'='71000000-0000-0000-0000-000000000001' \gset
SELECT jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001',
 'approver_id','71000000-0000-0000-0000-000000000004','effective_from','2035-01-01','effective_until','2036-01-01',
 'replace_assignment_id',:'member'::jsonb->'assignments'->0->>'id','expected_version',(:'member'::jsonb->>'version')::bigint,
 'reason','Fictional unsupported employee director assignment') invalid_assignment_payload \gset
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','8b000000-0000-0000-0000-000000000021','set_approver',:'invalid_assignment_payload'),'22023');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','8b000000-0000-0000-0000-000000000022','set_approver',:'assignment_payload'),'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
-- Owner-only trigger/temporal fixtures; their observations are asserted as authenticated.
CREATE TEMP TABLE po_route_boundaries(label text, allowed boolean);
DO $$ DECLARE v_role public.user_role;BEGIN
 FOREACH v_role IN ARRAY ARRAY['sales_person','sales_head','executive']::public.user_role[] LOOP
  UPDATE public.users SET role=v_role WHERE id='71000000-0000-0000-0000-000000000002';
  INSERT INTO po_route_boundaries VALUES(v_role::text,
   private.ihr_leave_is_approver('71000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000002','2035-02-01')
   OR private.ihr_leave_assignment_active('71000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000002',
    (SELECT id FROM public.ihr_leave_approvers WHERE employee_id='71000000-0000-0000-0000-000000000002' AND approver_id='71000000-0000-0000-0000-000000000004'),'2035-02-01'));
 END LOOP;
 UPDATE public.users SET role='po_admin' WHERE id='71000000-0000-0000-0000-000000000002';
 INSERT INTO po_route_boundaries VALUES('before_start',private.ihr_leave_is_approver('71000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000002','2034-12-30')),
 ('expired',private.ihr_leave_is_approver('71000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000002','2036-02-01'));
 UPDATE public.users SET is_active=false WHERE id='71000000-0000-0000-0000-000000000004';
 INSERT INTO po_route_boundaries VALUES('inactive_director',private.ihr_leave_is_approver('71000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000002','2035-02-01'));
 UPDATE public.users SET is_active=true WHERE id='71000000-0000-0000-0000-000000000004';
 UPDATE public.ihr_leave_members SET active=false WHERE user_id='71000000-0000-0000-0000-000000000002';
 INSERT INTO po_route_boundaries VALUES('inactive_employee',private.ihr_leave_is_approver('71000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000002','2035-02-01'));
 UPDATE public.ihr_leave_members SET active=true WHERE user_id='71000000-0000-0000-0000-000000000002';
 UPDATE public.ihr_leave_approvers SET revoked_at=statement_timestamp(),revoked_by='71000000-0000-0000-0000-000000000006'
 WHERE employee_id='71000000-0000-0000-0000-000000000002' AND approver_id='71000000-0000-0000-0000-000000000004';
 INSERT INTO po_route_boundaries VALUES('revoked',private.ihr_leave_is_approver('71000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000002','2035-02-01'));
END $$;
GRANT SELECT ON po_route_boundaries TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert_true(count(*)=8 AND bool_and(NOT allowed),'new exception retains role, active, expiry and revocation boundaries') FROM po_route_boundaries;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname LIKE 'ihr_%' AND has_function_privilege(current_user,p.oid,'EXECUTE')),'private helpers remain inaccessible to application roles');
RESET ROLE;
ROLLBACK;
\echo IHR_PO_ADMIN_DIRECTOR_APPROVAL_CANCELLATION_PASSED
