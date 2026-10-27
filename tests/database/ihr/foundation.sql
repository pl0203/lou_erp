-- Requires the marker-verified disposable fixture and candidate foundation migration.
-- Assertion helpers are loaded by test-ihr-db.mjs in this same session.
BEGIN;
\ir seed.sql
SET LOCAL ROLE anon;
SELECT pg_temp.assert_denied('SELECT public.leave_context_v1()','42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_setup_v1('people',1,20)$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('72000000-0000-0000-0000-000000000001','anything','{}')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_reconcile_request_v1('72000000-0000-0000-0000-000000000001',true)$s$,'42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT pg_temp.assert_denied('SELECT public.leave_context_v1()','42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000007',true);
SELECT pg_temp.assert_denied('SELECT public.leave_context_v1()','42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_setup_v1('people',1,20)$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('72000000-0000-0000-0000-000000000001','anything','{}')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_reconcile_request_v1('72000000-0000-0000-0000-000000000001',true)$s$,'42501');
DO $$ DECLARE n int; BEGIN
 FOREACH n IN ARRAY ARRAY[14,15,16] LOOP
  PERFORM set_config('request.jwt.claim.sub','71000000-0000-0000-0000-' || lpad(n::text,12,'0'),true);
  PERFORM pg_temp.assert_true(public.leave_context_v1()->'capabilities'='{"request":false,"approve":false,"configure":false,"adjust":false,"readPrivate":false,"manageAccess":false}'::jsonb,'no implicit executive/PO/sales-head HR authority');
  PERFORM pg_temp.assert_denied($s$SELECT public.leave_admin_setup_v1('people',1,20)$s$,'42501');
 END LOOP;
END $$;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true(public.leave_context_v1()->'capabilities'->>'request'='false','director cannot request');
SELECT pg_temp.assert_true(public.leave_context_v1()->'capabilities'->>'approve'='true','assigned director approves manager');
SELECT pg_temp.assert_true(public.leave_context_v1()->'balances'='[]'::jsonb,'director has no balances');
SELECT public.leave_context_v1()->>'scopeVersion' AS assigned_scope \gset
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000017',true);
SELECT pg_temp.assert_true(public.leave_context_v1()->'capabilities'->>'approve'='false','unassigned director has no approval');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(public.leave_context_v1()->'setup'->'blockers' @> '[{"code":"SCHEMA_NOT_READY"}]'::jsonb,'unimplemented submission is blocked');
SELECT pg_temp.assert_true(public.leave_context_v1()->'balances'='[]'::jsonb,'missing balance is not zero allowance');
SELECT pg_temp.assert_denied($s$SELECT * FROM public.ihr_leave_members WHERE user_id='71000000-0000-0000-0000-000000000002'$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_setup_v1('people',1,20)$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('72000000-0000-0000-0000-000000000001','grant_access','{"actor_id":"forged"}')$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('72000000-0000-0000-0000-000000000001','private.any_function','{}')$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.leave_transaction_v1(NULL,'anything','{}')$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('72000000-0000-0000-0000-000000000001','anything','[]')$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.leave_reconcile_request_v1('72000000-0000-0000-0000-000000000001',false)$s$,'55000');
SELECT pg_temp.assert_true(public.leave_reconcile_request_v1('72000000-0000-0000-0000-000000000001',true)='{"state":"abandoned"}'::jsonb,'abandon creates terminal fence');
SELECT pg_temp.assert_true(public.leave_reconcile_request_v1('72000000-0000-0000-0000-000000000001',false)='{"state":"abandoned"}'::jsonb,'abandon recovery is idempotent');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_reconcile_request_v1('72000000-0000-0000-0000-000000000001',false)$s$,'55000');

-- Separate scoped HR capabilities, exact directory fields and no full directory exposure.
DO $$ DECLARE n int; BEGIN
 FOREACH n IN ARRAY ARRAY[5,6,9,10,11,12,13] LOOP
  PERFORM set_config('request.jwt.claim.sub','71000000-0000-0000-0000-' || lpad(n::text,12,'0'),true);
  PERFORM pg_temp.assert_true(public.leave_context_v1()->'capabilities'->>'approve'='false','HR grants never imply approval');
 END LOOP;
END $$;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000009',true);
SELECT pg_temp.assert_true(public.leave_admin_setup_v1('people',1,20)->'rows'='[{"id":"71000000-0000-0000-0000-000000000001","name":"Fictional iHR 1","applicationRole":"sales_person","active":true}]'::jsonb,'configure directory has exact four fields and named audience');
SELECT pg_temp.assert_true(public.leave_context_v1()->'capabilities'->>'manageAccess'='false','configure is not manage access');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_setup_v1('medical',1,20)$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_setup_v1('people',0,1000)$s$,'22023');
DO $$ DECLARE n int; BEGIN
 FOREACH n IN ARRAY ARRAY[10,11,12] LOOP
  PERFORM set_config('request.jwt.claim.sub','71000000-0000-0000-0000-' || lpad(n::text,12,'0'),true);
  PERFORM pg_temp.assert_denied($s$SELECT public.leave_admin_setup_v1('people',1,20)$s$,'42501');
 END LOOP;
END $$;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname LIKE 'ihr_leave_%' AND has_function_privilege(current_user,p.oid,'EXECUTE')),'all private helpers reject direct execution');
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['public.ihr_leave_members','public.ihr_leave_access_grants','public.ihr_leave_approvers','public.ihr_leave_admin_events','private.ihr_leave_commands','private.ihr_leave_scope_revision'] LOOP
  PERFORM pg_temp.assert_denied('SELECT * FROM ' || t,'42501');
  PERFORM pg_temp.assert_denied('INSERT INTO ' || t || ' DEFAULT VALUES','42501');
  PERFORM pg_temp.assert_denied('DELETE FROM ' || t,'42501');
  PERFORM pg_temp.assert_denied('TRUNCATE ' || t,'42501');
  PERFORM pg_temp.assert_denied('UPDATE ' || t || CASE t
   WHEN 'public.ihr_leave_members' THEN ' SET active=true'
   WHEN 'public.ihr_leave_access_grants' THEN ' SET capability=''manage_access'''
   WHEN 'public.ihr_leave_approvers' THEN ' SET revoked_at=clock_timestamp()'
   WHEN 'public.ihr_leave_admin_events' THEN ' SET reason=''forged'''
   WHEN 'private.ihr_leave_commands' THEN ' SET abandoned=true'
   WHEN 'private.ihr_leave_scope_revision' THEN ' SET version=2' END,'42501');
 END LOOP;
END $$;

-- Rollback-only RPC-shaped probe for the private employee audience predicate. It is not a
-- production detail endpoint. Caller identity still comes from auth.uid(), never a parameter.
RESET ROLE;
CREATE FUNCTION public.ihr_fixture_can_read_employee(p_employee uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT private.ihr_leave_can_read_employee(private.ihr_leave_require_actor(),p_employee);
$$;
REVOKE ALL ON FUNCTION public.ihr_fixture_can_read_employee(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ihr_fixture_can_read_employee(uuid) TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(public.ihr_fixture_can_read_employee('71000000-0000-0000-0000-000000000001'),'own employee audience');
SELECT pg_temp.assert_true(NOT public.ihr_fixture_can_read_employee('71000000-0000-0000-0000-000000000002'),'peer employee denied');
SELECT pg_temp.assert_true(NOT public.ihr_fixture_can_read_employee('71000000-0000-0000-0000-000000009999'),'guessed missing ID denied identically');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true(public.ihr_fixture_can_read_employee('71000000-0000-0000-0000-000000000001'),'explicit assigned manager audience');
SELECT pg_temp.assert_true(NOT public.ihr_fixture_can_read_employee('71000000-0000-0000-0000-000000000002'),'unrelated manager audience denied');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true(public.ihr_fixture_can_read_employee('71000000-0000-0000-0000-000000000003'),'director reads assigned manager only');
SELECT pg_temp.assert_true(NOT public.ihr_fixture_can_read_employee('71000000-0000-0000-0000-000000000004'),'director personal audience denied');
SELECT pg_temp.assert_true(NOT public.ihr_fixture_can_read_employee('71000000-0000-0000-0000-000000000001'),'director no indirect employee audience');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000009',true);
SELECT pg_temp.assert_true(NOT public.ihr_fixture_can_read_employee('71000000-0000-0000-0000-000000000001'),'configure is not private-read permission');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000011',true);
SELECT pg_temp.assert_true(public.ihr_fixture_can_read_employee('71000000-0000-0000-0000-000000000001'),'named private reader audience');
SELECT pg_temp.assert_true(NOT public.ihr_fixture_can_read_employee('71000000-0000-0000-0000-000000000002'),'private reader peer audience denied');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000007',true);
SELECT pg_temp.assert_denied($s$SELECT public.ihr_fixture_can_read_employee('71000000-0000-0000-0000-000000000001')$s$,'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);

-- Isolate RLS as a second boundary: temporary test grants roll back and never enter migrations.
RESET ROLE;
GRANT SELECT,INSERT,UPDATE,DELETE ON private.ihr_leave_commands TO authenticated;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM private.ihr_leave_commands),'RLS hides command rows even with temporary SELECT privilege');
SELECT pg_temp.assert_denied($s$INSERT INTO private.ihr_leave_commands(actor_id,request_id,abandoned) VALUES('71000000-0000-0000-0000-000000000005','72000000-0000-0000-0000-000000000009',true)$s$,'42501');
WITH changed AS (UPDATE private.ihr_leave_commands SET abandoned=true RETURNING actor_id) SELECT pg_temp.assert_true(count(*)=0,'RLS denies command updates') FROM changed;
WITH changed AS (DELETE FROM private.ihr_leave_commands RETURNING actor_id) SELECT pg_temp.assert_true(count(*)=0,'RLS denies command deletes') FROM changed;
RESET ROLE;
REVOKE SELECT,INSERT,UPDATE,DELETE ON private.ihr_leave_commands FROM authenticated;
SELECT set_config('request.jwt.claim.sub','',true);

-- Test-only static command: no migration operation is enabled. All replacements roll back.
CREATE OR REPLACE FUNCTION private.ihr_leave_authorize_command(p_actor uuid,p_operation text,p_payload jsonb,p_authorized_at timestamptz) RETURNS void
LANGUAGE plpgsql STABLE SET search_path='' AS $$
BEGIN
 IF p_authorized_at IS NULL OR p_actor IS DISTINCT FROM private.ihr_leave_require_actor() THEN RAISE EXCEPTION 'Invalid authority' USING ERRCODE='42501'; END IF;
 CASE p_operation WHEN 'fixture_probe' THEN
  PERFORM private.ihr_leave_validate_payload(p_payload,ARRAY['value'],ARRAY['value']);
  IF NOT private.ihr_leave_has_grant(p_actor,'configure','71000000-0000-0000-0000-000000000001',p_authorized_at) THEN RAISE EXCEPTION 'Denied' USING ERRCODE='42501',DETAIL='{"code":"ACCESS_DENIED"}'; END IF;
 ELSE RAISE EXCEPTION 'Unsupported' USING ERRCODE='22023'; END CASE;
END $$;
CREATE OR REPLACE FUNCTION private.ihr_leave_dispatch_command(p_actor uuid,p_operation text,p_payload jsonb,p_authorized_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 CASE p_operation WHEN 'fixture_probe' THEN RETURN jsonb_build_object('id','71000000-0000-0000-0000-000000000001','version',1,'operation',p_operation);
 ELSE RAISE EXCEPTION 'Unsupported' USING ERRCODE='22023'; END CASE;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_true(public.leave_transaction_v1('72000000-0000-0000-0000-000000000003','fixture_probe','{"value":"one"}')='{"id":"71000000-0000-0000-0000-000000000001","version":1,"operation":"fixture_probe"}'::jsonb,'typed command result');
SELECT pg_temp.assert_true(public.leave_transaction_v1('72000000-0000-0000-0000-000000000003','fixture_probe','{"value":"one"}')='{"id":"71000000-0000-0000-0000-000000000001","version":1,"operation":"fixture_probe"}'::jsonb,'same input replay');
SELECT pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('72000000-0000-0000-0000-000000000003','fixture_probe','{"value":"changed"}')$s$,'55000');
SELECT pg_temp.assert_true(public.leave_reconcile_request_v1('72000000-0000-0000-0000-000000000003',true)->>'state'='committed','abandon cannot erase a commit');
SELECT pg_temp.assert_true(public.leave_reconcile_request_v1('72000000-0000-0000-0000-000000000004',true)->>'state'='abandoned','fresh abandonment fence');
SELECT pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('72000000-0000-0000-0000-000000000004','fixture_probe','{"value":"one"}')$s$,'55000');
SELECT pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('72000000-0000-0000-0000-000000000005','fixture_probe','{"value":"one","actor_id":"forged"}')$s$,'22023');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
DELETE FROM public.ihr_leave_approvers WHERE approver_id='71000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true(public.leave_context_v1()->>'scopeVersion'<>:'assigned_scope','assignment revocation changes scope');
SELECT pg_temp.assert_true(public.leave_context_v1()->'capabilities'->>'approve'='false','revocation immediately removes approval');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.ihr_leave_access_grants SET effective_until='2000-01-02 00:00:00+00' WHERE actor_id='71000000-0000-0000-0000-000000000005';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('72000000-0000-0000-0000-000000000003','fixture_probe','{"value":"one"}')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_reconcile_request_v1('72000000-0000-0000-0000-000000000003',false)$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_setup_v1('people',1,20)$s$,'42501');
RESET ROLE;
ROLLBACK;

-- Owner-only domain-integrity setup checks, NOT authenticated permission/RLS proof.
-- The app-role assertion helpers deliberately cannot run as this owner. These inline
-- checks exercise the real assignment trigger without granting any application writes.
BEGIN;
\ir seed.sql
SELECT set_config('request.jwt.claim.sub','',true);
DO $integrity$
DECLARE case_name text; endpoint uuid; activity_kind text; attempted_sql text;
 actual_sqlstate text; actual_detail text; changed integer;
 assignment_id uuid:='73000000-0000-0000-0000-000000000001';
BEGIN
 IF current_user IN ('anon','authenticated') OR auth.uid() IS NOT NULL THEN
  RAISE EXCEPTION 'Assignment integrity setup requires the fixture owner without a JWT actor';
 END IF;
 -- Positive controls: active employee -> manager insert and update. The seed also
 -- validates active manager -> director; application roles do not supply these kinds.
 INSERT INTO public.ihr_leave_approvers(id,employee_id,approver_id,effective_from,assigned_by)
 VALUES(assignment_id,'71000000-0000-0000-0000-000000000018','71000000-0000-0000-0000-000000000003','2000-01-01 00:00:00+00','71000000-0000-0000-0000-000000000006');
 UPDATE public.ihr_leave_approvers SET effective_until='2099-01-01 00:00:00+00' WHERE id=assignment_id;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'Owner integrity positive update did not affect one assignment'; END IF;
 FOR case_name,endpoint,activity_kind IN SELECT * FROM (VALUES
  ('inactive employee account','71000000-0000-0000-0000-000000000018'::uuid,'account'),
  ('inactive approver account','71000000-0000-0000-0000-000000000003'::uuid,'account'),
  ('inactive employee membership','71000000-0000-0000-0000-000000000018'::uuid,'membership'),
  ('inactive approver membership','71000000-0000-0000-0000-000000000003'::uuid,'membership')
 ) cases(case_name,endpoint,activity_kind) LOOP
  IF activity_kind='account' THEN UPDATE public.users SET is_active=false WHERE id=endpoint;
  ELSE UPDATE public.ihr_leave_members SET active=false WHERE user_id=endpoint; END IF;
  -- The attempted insert has a disjoint interval, so an overlap rejection cannot
  -- masquerade as the endpoint check. The active-row update must revalidate too.
  FOREACH attempted_sql IN ARRAY ARRAY[
   $statement$INSERT INTO public.ihr_leave_approvers(employee_id,approver_id,effective_from,effective_until,assigned_by)
    VALUES('71000000-0000-0000-0000-000000000018','71000000-0000-0000-0000-000000000003','1900-01-01 00:00:00+00','1999-01-01 00:00:00+00','71000000-0000-0000-0000-000000000006')$statement$,
   $statement$UPDATE public.ihr_leave_approvers SET effective_until='2098-01-01 00:00:00+00' WHERE id='73000000-0000-0000-0000-000000000001'$statement$
  ] LOOP
   actual_sqlstate:=NULL; actual_detail:=NULL;
   BEGIN EXECUTE attempted_sql;
   EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual_sqlstate=RETURNED_SQLSTATE,actual_detail=PG_EXCEPTION_DETAIL; END;
   IF actual_sqlstate IS DISTINCT FROM '22023' OR actual_detail::jsonb->>'code' IS DISTINCT FROM 'INVALID_APPROVER_ROUTE' THEN
    RAISE EXCEPTION 'Owner assignment integrity failure for %: SQLSTATE %, detail %',case_name,actual_sqlstate,actual_detail;
   END IF;
  END LOOP;
  -- Deactivation must not prevent recording revocation or require reactivation.
  UPDATE public.ihr_leave_approvers SET revoked_at=clock_timestamp(),revoked_by='71000000-0000-0000-0000-000000000006' WHERE id=assignment_id;
  IF NOT EXISTS (SELECT 1 FROM public.ihr_leave_approvers WHERE id=assignment_id AND revoked_at IS NOT NULL AND revoked_by='71000000-0000-0000-0000-000000000006') THEN
   RAISE EXCEPTION 'Owner integrity revocation failed for %',case_name;
  END IF;
  actual_sqlstate:=NULL; actual_detail:=NULL;
  BEGIN
   UPDATE public.ihr_leave_approvers SET revoked_at=NULL,revoked_by=NULL WHERE id=assignment_id;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual_sqlstate=RETURNED_SQLSTATE,actual_detail=PG_EXCEPTION_DETAIL; END;
  IF actual_sqlstate IS DISTINCT FROM '22023' OR actual_detail::jsonb->>'code' IS DISTINCT FROM 'INVALID_APPROVER_ROUTE' THEN
   RAISE EXCEPTION 'Owner integrity accepted reopening with %: SQLSTATE %, detail %',case_name,actual_sqlstate,actual_detail;
  END IF;
  IF activity_kind='account' THEN UPDATE public.users SET is_active=true WHERE id=endpoint;
  ELSE UPDATE public.ihr_leave_members SET active=true WHERE user_id=endpoint; END IF;
  UPDATE public.ihr_leave_approvers SET revoked_at=NULL,revoked_by=NULL WHERE id=assignment_id;
 END LOOP;
END;
$integrity$;
-- Actual authenticated permission assertions: even explicit scoped HR configure
-- authority does not grant direct assignment INSERT/UPDATE. No fixture privilege lift.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_denied($s$INSERT INTO public.ihr_leave_approvers(employee_id,approver_id,effective_from,assigned_by) VALUES('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000003','2000-01-01 00:00:00+00','71000000-0000-0000-0000-000000000005')$s$,'42501');
SELECT pg_temp.assert_denied($s$UPDATE public.ihr_leave_approvers SET revoked_at=clock_timestamp(),revoked_by='71000000-0000-0000-0000-000000000005' WHERE employee_id='71000000-0000-0000-0000-000000000001'$s$,'42501');
RESET ROLE;
ROLLBACK;

BEGIN ISOLATION LEVEL REPEATABLE READ;
\ir seed.sql
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('72000000-0000-0000-0000-000000000011','anything','{}')$s$,'55000');
SELECT pg_temp.assert_denied($s$SELECT public.leave_reconcile_request_v1('72000000-0000-0000-0000-000000000011',true)$s$,'55000');
SELECT pg_temp.assert_true(public.leave_context_v1()->'capabilities'->>'request'='true','read-only consistent context remains available');
RESET ROLE;
ROLLBACK;
BEGIN ISOLATION LEVEL SERIALIZABLE;
\ir seed.sql
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('72000000-0000-0000-0000-000000000012','anything','{}')$s$,'55000');
SELECT pg_temp.assert_denied($s$SELECT public.leave_reconcile_request_v1('72000000-0000-0000-0000-000000000012',true)$s$,'55000');
RESET ROLE;
ROLLBACK;
\echo IHR_FOUNDATION_PERMISSIONS_AND_COMMAND_ENVELOPE_PASSED
