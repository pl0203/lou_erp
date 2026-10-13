-- Actual non-bypass roles. Runner loads helpers first; all fixture writes roll back.
BEGIN;
\ir quote-seed.sql
SET LOCAL ROLE anon;
SELECT pg_temp.assert_denied($s$SELECT public.leave_own_history_v1()$s$,'42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_denied($s$SELECT * FROM public.ihr_leave_requests$s$,'42501');
SELECT pg_temp.assert_denied($s$INSERT INTO public.ihr_leave_occupancy VALUES('71000000-0000-0000-0000-000000000001',current_date,'80000000-0000-0000-0000-000000000001')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT private.ihr_leave_submit_request('71000000-0000-0000-0000-000000000001','{}',now())$s$,'42501');
SELECT jsonb_build_object('input',pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+2),'quote_fingerprint',public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+2))->>'fingerprint') payload \gset
SELECT public.leave_transaction_v1('80000000-0000-0000-0000-000000000001','submit_request',:'payload') receipt \gset
SELECT pg_temp.assert_true(:'receipt'::jsonb->>'operation'='submit_request' AND (SELECT count(*) FROM jsonb_object_keys(:'receipt'::jsonb))=3,'minimal submit receipt only');
SELECT pg_temp.assert_true(public.leave_own_request_v1((:'receipt'::jsonb->>'id')::uuid)->>'totalMinutes'='675','request freezes 450 plus 225 and excludes Sunday');
SELECT pg_temp.assert_true(jsonb_array_length(public.leave_own_request_v1((:'receipt'::jsonb->>'id')::uuid)->'days')=3,'detail retains excluded day');
SELECT pg_temp.assert_true(public.leave_own_request_v1((:'receipt'::jsonb->>'id')::uuid)->>'reason'='Fictional private reason','own private detail');
SELECT pg_temp.assert_true(NOT (public.leave_own_request_v1((:'receipt'::jsonb->>'id')::uuid) ? 'source_snapshot'),'private raw sources never projected');
SELECT pg_temp.assert_true(public.leave_transaction_v1('80000000-0000-0000-0000-000000000001','submit_request',:'payload')=:'receipt'::jsonb,'same payload replays after its reservation changed the account version');
SELECT pg_temp.assert_true(public.leave_reconcile_request_v1('80000000-0000-0000-0000-000000000001',true)=jsonb_build_object('state','committed','result',:'receipt'::jsonb),'reconcile returns original minimal receipt');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','80000000-0000-0000-0000-000000000001','submit_request',jsonb_set(:'payload'::jsonb,'{input,reason}','"Changed private reason"')),'55000');
SELECT jsonb_build_object('input',pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()),'quote_fingerprint',public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()))->>'fingerprint') duplicate_date \gset
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','80000000-0000-0000-0000-000000000002','submit_request',:'duplicate_date'::jsonb),'55000');
-- Invalid fixed 300 over Friday/Saturday fails atomically, even with an arbitrary correctly shaped hash.
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','80000000-0000-0000-0000-000000000003','submit_request',jsonb_build_object('input',pg_temp.quote_input(pg_temp.quote_friday()+14,pg_temp.quote_friday()+15,'{"mode":"fixed_minutes","minutes":300}'),'quote_fingerprint',repeat('a',64))),'22023');
SELECT pg_temp.assert_true(jsonb_array_length(public.leave_own_history_v1()->'rows')=1,'invalid and occupied requests leave no partial history');
SELECT jsonb_build_object('input',pg_temp.quote_input(pg_temp.quote_friday()+3,pg_temp.quote_friday()+3),'quote_fingerprint',public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday()+3,pg_temp.quote_friday()+3))->>'fingerprint') second_payload \gset
SELECT public.leave_transaction_v1('80000000-0000-0000-0000-000000000004','submit_request',:'second_payload') second_receipt \gset
SELECT jsonb_build_object('input',pg_temp.quote_input(pg_temp.quote_friday()+4,pg_temp.quote_friday()+4),'quote_fingerprint',public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday()+4,pg_temp.quote_friday()+4))->>'fingerprint') third_payload \gset
SELECT public.leave_transaction_v1('80000000-0000-0000-0000-000000000005','submit_request',:'third_payload') third_receipt \gset
SELECT public.leave_own_history_v1(NULL,2) history \gset
SELECT pg_temp.assert_true(jsonb_array_length(:'history'::jsonb->'rows')=2 AND :'history'::jsonb->>'nextBefore' IS NOT NULL,'history page bounded');
SELECT pg_temp.assert_true(NOT ((:'history'::jsonb->'rows'->0) ? 'reason'),'history omits reason');
SELECT pg_temp.assert_true(public.leave_own_history_v1((:'history'::jsonb->>'nextBefore')::bigint,2)->'rows'->0->>'id'=:'receipt'::jsonb->>'id','keyset continuation returns original oldest request');
SELECT pg_temp.assert_true(public.leave_own_history_v1((:'history'::jsonb->>'nextBefore')::bigint,2)->>'nextBefore' IS NULL,'last page has no next cursor');
SELECT pg_temp.assert_denied($s$SELECT public.leave_own_history_v1(NULL,101)$s$,'22023');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert_true(jsonb_array_length(public.leave_own_history_v1()->'rows')=0,'peer list contains only own requests');
SELECT pg_temp.assert_denied(format('SELECT public.leave_own_request_v1(%L)',:'receipt'::jsonb->>'id'),'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_own_request_v1('80000000-0000-0000-0000-000000000099')$s$,'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_own_history_v1()$s$,'42501');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','80000000-0000-0000-0000-000000000001','submit_request',:'payload'::jsonb),'42501');
RESET ROLE;
-- Owner-only observation is not permission evidence. Assertions still execute as authenticated.
CREATE TEMP TABLE request_observations AS SELECT
 (SELECT count(*)=3 FROM private.ihr_leave_commands WHERE operation='submit_request') command_atomic,
 (SELECT count(*)=4 FROM public.ihr_leave_occupancy) occupancy_atomic,
 (SELECT sum(reserved_delta)=1575 AND sum(used_delta)=0 FROM public.ihr_leave_ledger WHERE kind='reservation') reservation_atomic,
 (SELECT count(*)=3 FROM private.ihr_leave_request_events) audit_atomic,
 (SELECT bool_and(source_snapshot->'calendar'->>'timezone'='Pacific/Kiritimati') FROM public.ihr_leave_request_days) source_frozen;
GRANT SELECT ON request_observations TO authenticated;
UPDATE public.users SET full_name='Changed fictional approver name' WHERE id='71000000-0000-0000-0000-000000000003';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(command_atomic AND occupancy_atomic AND reservation_atomic AND audit_atomic AND source_frozen,'atomic state and full source snapshots') FROM request_observations;
SELECT pg_temp.assert_true(public.leave_own_request_v1((:'receipt'::jsonb->>'id')::uuid)->>'approverName'='Fictional iHR 3','approver name frozen');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000009',true);
SELECT pg_temp.assert_true(public.leave_admin_setup_v1('members',1,100)->'rows'->0->'impacts'=jsonb_build_object('available',true,'pendingCount',3,'approvedCount',0),'scoped setup count reveals no request identifiers');
RESET ROLE;
ROLLBACK;
\ir requests-opening.sql
\ir requests-replay.sql
\echo IHR_REQUESTS_ATOMIC_SUBMISSION_PASSED
