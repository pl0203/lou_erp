-- Included inside reads.sql after its synthetic setup; every case restores its savepoint.
-- Assertions use the real authenticated non-bypass role. No helper replacement or trigger disabling.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT public.leave_calendar_v1(pg_temp.quote_friday(),pg_temp.quote_friday()+92,'assigned_team') calendar_hoist_before \gset
SELECT public.leave_calendar_v1(pg_temp.quote_friday(),pg_temp.quote_friday()+92,'granted') calendar_hoist_granted \gset
SELECT pg_temp.assert_denied($s$SELECT public.leave_calendar_v1(current_date,current_date,NULL)$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.leave_calendar_v1(current_date,NULL,'own')$s$,'22023');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);

SAVEPOINT calendar_inactive_employee_user;
UPDATE public.users SET is_active=false WHERE id='71000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true(public.leave_calendar_v1(pg_temp.quote_friday(),pg_temp.quote_friday()+92,'assigned_team')=(SELECT coalesce(jsonb_agg(item ORDER BY ordinality),'[]') FROM jsonb_array_elements(:'calendar_hoist_before'::jsonb) WITH ORDINALITY AS e(item,ordinality) WHERE item->>'employeeId'<>'71000000-0000-0000-0000-000000000001'),'inactive_employee_user retains exact remaining fields/order');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
ROLLBACK TO SAVEPOINT calendar_inactive_employee_user;
RELEASE SAVEPOINT calendar_inactive_employee_user;

SAVEPOINT calendar_inactive_employee_member;
UPDATE public.ihr_leave_members SET active=false WHERE user_id='71000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true(public.leave_calendar_v1(pg_temp.quote_friday(),pg_temp.quote_friday()+92,'assigned_team')=(SELECT coalesce(jsonb_agg(item ORDER BY ordinality),'[]') FROM jsonb_array_elements(:'calendar_hoist_before'::jsonb) WITH ORDINALITY AS e(item,ordinality) WHERE item->>'employeeId'<>'71000000-0000-0000-0000-000000000001'),'inactive_employee_member retains exact remaining fields/order');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
ROLLBACK TO SAVEPOINT calendar_inactive_employee_member;
RELEASE SAVEPOINT calendar_inactive_employee_member;

SAVEPOINT calendar_inactive_actor_user;
UPDATE public.users SET is_active=false WHERE id='71000000-0000-0000-0000-000000000003';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_calendar_v1(pg_temp.quote_friday(),pg_temp.quote_friday()+92,'assigned_team')$s$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
ROLLBACK TO SAVEPOINT calendar_inactive_actor_user;
RELEASE SAVEPOINT calendar_inactive_actor_user;

SAVEPOINT calendar_inactive_approver_member;
UPDATE public.ihr_leave_members SET active=false WHERE user_id='71000000-0000-0000-0000-000000000003';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_calendar_v1(pg_temp.quote_friday(),pg_temp.quote_friday()+92,'assigned_team')$s$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
ROLLBACK TO SAVEPOINT calendar_inactive_approver_member;
RELEASE SAVEPOINT calendar_inactive_approver_member;

SAVEPOINT calendar_expired_assignment;
UPDATE public.ihr_leave_approvers SET effective_until=statement_timestamp() WHERE employee_id='71000000-0000-0000-0000-000000000001' AND revoked_at IS NULL;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true(public.leave_calendar_v1(pg_temp.quote_friday(),pg_temp.quote_friday()+92,'assigned_team')=(SELECT coalesce(jsonb_agg(item ORDER BY ordinality),'[]') FROM jsonb_array_elements(:'calendar_hoist_before'::jsonb) WITH ORDINALITY AS e(item,ordinality) WHERE item->>'employeeId'<>'71000000-0000-0000-0000-000000000001'),'expired_assignment retains exact remaining fields/order');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
ROLLBACK TO SAVEPOINT calendar_expired_assignment;
RELEASE SAVEPOINT calendar_expired_assignment;

SAVEPOINT calendar_future_assignment;
UPDATE public.ihr_leave_approvers SET effective_from=statement_timestamp()+interval '1 day',effective_until=NULL WHERE employee_id='71000000-0000-0000-0000-000000000001' AND revoked_at IS NULL;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true(public.leave_calendar_v1(pg_temp.quote_friday(),pg_temp.quote_friday()+92,'assigned_team')=(SELECT coalesce(jsonb_agg(item ORDER BY ordinality),'[]') FROM jsonb_array_elements(:'calendar_hoist_before'::jsonb) WITH ORDINALITY AS e(item,ordinality) WHERE item->>'employeeId'<>'71000000-0000-0000-0000-000000000001'),'future_assignment retains exact remaining fields/order');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
ROLLBACK TO SAVEPOINT calendar_future_assignment;
RELEASE SAVEPOINT calendar_future_assignment;

SAVEPOINT calendar_expired_grant;
UPDATE public.ihr_leave_access_grants SET effective_until=statement_timestamp() WHERE actor_id='71000000-0000-0000-0000-000000000003' AND capability='calendar';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_calendar_v1(pg_temp.quote_friday()+90,pg_temp.quote_friday()+92,'granted')$s$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
ROLLBACK TO SAVEPOINT calendar_expired_grant;
RELEASE SAVEPOINT calendar_expired_grant;

SAVEPOINT calendar_future_grant;
UPDATE public.ihr_leave_access_grants SET effective_from=statement_timestamp()+interval '1 day',effective_until=NULL WHERE actor_id='71000000-0000-0000-0000-000000000003' AND capability='calendar';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_calendar_v1(pg_temp.quote_friday()+90,pg_temp.quote_friday()+92,'granted')$s$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
ROLLBACK TO SAVEPOINT calendar_future_grant;
RELEASE SAVEPOINT calendar_future_grant;

SAVEPOINT calendar_revoked_grant;
UPDATE public.ihr_leave_access_grants SET revoked_at=statement_timestamp(),revoked_by='71000000-0000-0000-0000-000000000006' WHERE actor_id='71000000-0000-0000-0000-000000000003' AND capability='calendar';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_calendar_v1(pg_temp.quote_friday()+90,pg_temp.quote_friday()+92,'granted')$s$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
ROLLBACK TO SAVEPOINT calendar_revoked_grant;
RELEASE SAVEPOINT calendar_revoked_grant;

SAVEPOINT calendar_duplicate_calendar_grant;
INSERT INTO public.ihr_leave_access_grants(actor_id,capability,scope_kind,employee_id,effective_from,granted_by,reason) VALUES('71000000-0000-0000-0000-000000000003','calendar','employee','71000000-0000-0000-0000-000000000001','2000-01-01','71000000-0000-0000-0000-000000000006','Fictional duplicate scope regression');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true(public.leave_calendar_v1(pg_temp.quote_friday(),pg_temp.quote_friday()+92,'granted')=:'calendar_hoist_granted'::jsonb,'duplicate grants do not duplicate calendar rows');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
ROLLBACK TO SAVEPOINT calendar_duplicate_calendar_grant;
RELEASE SAVEPOINT calendar_duplicate_calendar_grant;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000011',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_calendar_v1(current_date,current_date,'granted')$s$,'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000007',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_calendar_v1(current_date,current_date,'own')$s$,'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true(public.leave_calendar_v1(pg_temp.quote_friday(),pg_temp.quote_friday()+92,'assigned_team')=:'calendar_hoist_before'::jsonb,'all boundary mutations restored exactly');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
\echo IHR_CALENDAR_AUTHORIZATION_BOUNDARIES_PASSED
