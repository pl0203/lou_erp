-- Separate HR private review uses actual roles and existing explicit read_private grants only.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SAVEPOINT hr_private_review_fixture;
INSERT INTO public.ihr_leave_access_grants(actor_id,capability,scope_kind,employee_id,effective_from,granted_by,reason) VALUES('71000000-0000-0000-0000-000000000004','read_private','employee','71000000-0000-0000-0000-000000000001','2020-01-01','71000000-0000-0000-0000-000000000006','Fictional director grant still cannot confer HR authority');
SET LOCAL ROLE anon;
SELECT pg_temp.assert_denied($s$SELECT public.leave_hr_requests_v1('71000000-0000-0000-0000-000000000001')$s$,'42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000011',true);
SELECT public.leave_hr_requests_v1('71000000-0000-0000-0000-000000000001',NULL,1) hr_list \gset
SELECT pg_temp.assert_true(jsonb_array_length(:'hr_list'::jsonb->'rows')=1 AND :'hr_list'::jsonb->>'nextBefore' IS NOT NULL,'read-private-only receives bounded target request list');
SELECT pg_temp.assert_true(NOT(:'hr_list'::jsonb->'rows'->0 ? 'reason') AND NOT(:'hr_list'::jsonb->'rows'->0 ? 'source_snapshot'),'summary never contains private reason or raw source');
SELECT pg_temp.assert_true(public.leave_hr_requests_v1('71000000-0000-0000-0000-000000000001',(:'hr_list'::jsonb->>'nextBefore')::bigint,1)->'rows'->0->>'id'=:'receipt'::jsonb->>'id','keyset page includes original approved request independently of current route');
SELECT public.leave_hr_request_v1('71000000-0000-0000-0000-000000000001',(:'receipt'::jsonb->>'id')::uuid) hr_detail \gset
SELECT pg_temp.assert_true(:'hr_detail'::jsonb->'request'->>'reason'='Fictional private reason' AND :'hr_detail'::jsonb->'request'->>'approverName'='Fictional iHR 3','private detail has original frozen reason and route');
SELECT pg_temp.assert_true(:'hr_detail'::jsonb->'request'->'days'->0->>'chargedMinutes'='450' AND :'hr_detail'::jsonb->'request'->'allocations'->0->>'chargedMinutes'='450','charge explanation uses frozen original days and periods');
SELECT pg_temp.assert_true((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'hr_detail'::jsonb->'request')k)=ARRAY['allocations','approverName','days','duration','endDate','id','reason','sequence','sourceKind','startDate','status','submittedAt','totalMinutes','version'],'private detail is the exact existing own projection');
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(public.leave_hr_request_history_v1('71000000-0000-0000-0000-000000000001',(:'receipt'::jsonb->>'id')::uuid)->'rows') e WHERE e->>'event'='reassigned' AND e->>'reason'='Fictional explicit reassignment' AND e->>'approverName'='Fictional iHR 16'),'routing history retains frozen explicit replacement and reason');
SELECT pg_temp.assert_denied($s$SELECT public.leave_hr_requests_v1('71000000-0000-0000-0000-000000000002')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_hr_requests_v1('71000000-0000-0000-0000-000000000001',NULL,51)$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.leave_hr_request_v1('71000000-0000-0000-0000-000000000001','84000000-0000-0000-0000-000000000099')$s$,'42501');
SELECT pg_temp.assert_denied(format('SELECT public.leave_hr_request_v1(%L,%L)','71000000-0000-0000-0000-000000000002',:'receipt'::jsonb->>'id'),'42501');
SELECT pg_temp.assert_denied(format('SELECT public.leave_hr_request_history_v1(%L,%L,NULL,NULL,51)','71000000-0000-0000-0000-000000000001',:'receipt'::jsonb->>'id'),'22023');
SELECT pg_temp.assert_denied(format('SELECT public.leave_hr_request_history_v1(%L,%L,%L,NULL,25)','71000000-0000-0000-0000-000000000001',:'receipt'::jsonb->>'id','2026-10-03T00:00:00+00:00'),'22023');
SELECT pg_temp.assert_denied($s$SELECT * FROM private.ihr_leave_request_events$s$,'42501');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','84000000-0000-0000-0000-000000000001','approve_request',jsonb_build_object('request_id',:'successor_request'::jsonb->>'id','expected_version',1)),'42501');
SELECT pg_temp.assert_true(public.leave_admin_targets_v1()->'rows'->0->'capabilities'='{"configure":false,"adjust":false,"readPrivate":true,"calendar":false,"manageAccess":false}'::jsonb,'private review grants neither command nor calendar audience');
-- Configuration, adjustment, calendar, access management, personal identity and assigned approval do not substitute for read_private.
DO $$ DECLARE n integer;BEGIN
 FOREACH n IN ARRAY ARRAY[9,10,12,13,14,1,16,4] LOOP
  PERFORM set_config('request.jwt.claim.sub',('71000000-0000-0000-0000-'||lpad(n::text,12,'0')),true);
  PERFORM pg_temp.assert_denied($s$SELECT public.leave_hr_requests_v1('71000000-0000-0000-0000-000000000001')$s$,'42501');
 END LOOP;
END $$;
-- Obtain private cancellation reasons from real existing transition commands, without giving the reader approval authority.
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT public.leave_transaction_v1('84000000-0000-0000-0000-000000000002','request_cancellation',jsonb_build_object('request_id',:'receipt'::jsonb->>'id','expected_version',3,'reason','Fictional private cancellation note')) hr_cancel_receipt \gset
SELECT public.leave_request_transition_state_v1((:'receipt'::jsonb->>'id')::uuid) hr_cancel_state \gset
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000011',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','84000000-0000-0000-0000-000000000003','approve_cancellation',jsonb_build_object('request_id',:'receipt'::jsonb->>'id','expected_version',4,'attempt_id',:'hr_cancel_state'::jsonb->>'activeAttemptId')),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000016',true);
SELECT public.leave_transaction_v1('84000000-0000-0000-0000-000000000004','decline_cancellation',jsonb_build_object('request_id',:'receipt'::jsonb->>'id','expected_version',4,'attempt_id',:'hr_cancel_state'::jsonb->>'activeAttemptId','reason','Fictional private decline note'));
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000011',true);
SELECT public.leave_hr_request_history_v1('71000000-0000-0000-0000-000000000001',(:'receipt'::jsonb->>'id')::uuid) hr_cancellation_history \gset
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(:'hr_cancellation_history'::jsonb->'rows')e WHERE e->>'event'='cancellation_requested' AND e->>'reason'='Fictional private cancellation note' AND e->>'approverName'='Fictional iHR 16') AND EXISTS(SELECT 1 FROM jsonb_array_elements(:'hr_cancellation_history'::jsonb->'rows')e WHERE e->>'event'='cancellation_declined' AND e->>'reason'='Fictional private decline note'),'private history contains authorized cancellation/decision notes and frozen attempt route');
SELECT pg_temp.assert_true((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'hr_cancellation_history'::jsonb->'rows'->0)k)=ARRAY['actor','approverName','atTime','event','id','reason'],'private history never exports raw event or source snapshots');
-- More than50 genuine audited reassignment events; current authority is checked by every command.
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT public.leave_hr_request_v1('71000000-0000-0000-0000-000000000001',(:'successor_request'::jsonb->>'id')::uuid)->'request'->>'version' hr_route_version \gset
SELECT set_config('ihr.test.hr_request',:'successor_request'::jsonb->>'id',true);
SELECT set_config('ihr.test.hr_version',:'hr_route_version',true);
DO $$ DECLARE n integer;v bigint:=current_setting('ihr.test.hr_version')::bigint;r jsonb;BEGIN
 FOR n IN 1..51 LOOP
  r:=public.leave_transaction_v1(gen_random_uuid(),'reassign_request',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','request_id',current_setting('ihr.test.hr_request'),'assignment_id','81000000-0000-0000-0000-000000000020','expected_version',v,'reason','Fictional explicitly repeated route review '||n));v:=(r->>'version')::bigint;
 END LOOP;
END $$;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000011',true);
SELECT public.leave_hr_request_history_v1('71000000-0000-0000-0000-000000000001',(:'successor_request'::jsonb->>'id')::uuid,NULL,NULL,50) hr_history_page \gset
SELECT pg_temp.assert_true(jsonb_array_length(:'hr_history_page'::jsonb->'rows')=50 AND :'hr_history_page'::jsonb->'nextBefore'<>'null'::jsonb,'history is bounded50 even with a longer genuine event stream');
SELECT public.leave_hr_request_history_v1('71000000-0000-0000-0000-000000000001',(:'successor_request'::jsonb->>'id')::uuid,(:'hr_history_page'::jsonb->'nextBefore'->>'atTime')::timestamptz,(:'hr_history_page'::jsonb->'nextBefore'->>'id')::uuid,50) hr_history_last \gset
SELECT pg_temp.assert_true(jsonb_array_length(:'hr_history_last'::jsonb->'rows')=2 AND :'hr_history_last'::jsonb->'nextBefore'='null'::jsonb,'tuple cursor resumes without duplicate/lost events and reaches genuine end');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.ihr_leave_access_grants SET revoked_at=clock_timestamp(),revoked_by='71000000-0000-0000-0000-000000000006' WHERE actor_id='71000000-0000-0000-0000-000000000011' AND capability='read_private' AND employee_id='71000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000011',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_hr_requests_v1('71000000-0000-0000-0000-000000000001')$s$,'42501');
SELECT pg_temp.assert_denied(format('SELECT public.leave_hr_request_v1(%L,%L)','71000000-0000-0000-0000-000000000001',:'receipt'::jsonb->>'id'),'42501');
SELECT pg_temp.assert_denied(format('SELECT public.leave_hr_request_history_v1(%L,%L)','71000000-0000-0000-0000-000000000001',:'receipt'::jsonb->>'id'),'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.users SET is_active=false WHERE id='71000000-0000-0000-0000-000000000005';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_hr_requests_v1('71000000-0000-0000-0000-000000000001')$s$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
ROLLBACK TO SAVEPOINT hr_private_review_fixture;
RELEASE SAVEPOINT hr_private_review_fixture;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
