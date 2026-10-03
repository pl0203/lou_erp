-- Dedicated command prerequisites do not broaden private/history/global-calendar grants.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SAVEPOINT admin_write_context_fixture;
UPDATE public.ihr_leave_members SET cycle_state='first_grant_blocked' WHERE user_id='71000000-0000-0000-0000-000000000018';
INSERT INTO private.ihr_leave_calendar_registry(id,version) VALUES('83000000-0000-0000-0000-000000000090',1);
INSERT INTO public.ihr_leave_calendars(calendar_id,version,name,effective_from,timezone,created_by) VALUES('83000000-0000-0000-0000-000000000090',1,'Fictional unrelated lineage','2020-01-01','UTC','71000000-0000-0000-0000-000000000006');
INSERT INTO public.ihr_leave_access_grants(actor_id,capability,scope_kind,employee_id,effective_from,granted_by,reason)
SELECT ('71000000-0000-0000-0000-'||lpad(actor::text,12,'0'))::uuid,'configure','employee',('71000000-0000-0000-0000-'||lpad(target::text,12,'0'))::uuid,'2020-01-01','71000000-0000-0000-0000-000000000006','Fictional write-context coverage'
FROM (VALUES(9,3),(9,4),(9,5),(9,9),(9,18),(4,1)) cases(actor,target);
SET LOCAL ROLE anon;
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_write_context_v1('71000000-0000-0000-0000-000000000001')$s$,'42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000010',true);
SELECT public.leave_admin_write_context_v1('71000000-0000-0000-0000-000000000001') adjust_context \gset
SELECT pg_temp.assert_true(:'adjust_context'::jsonb->'capabilities'='{"configure":false,"adjust":true}'::jsonb AND :'adjust_context'::jsonb->'memberOptions'='null'::jsonb,'adjust-only has no member/global-calendar options');
SELECT pg_temp.assert_true(:'adjust_context'::jsonb->'balance'->>'state'='verified' AND :'adjust_context'::jsonb->'balance'->'account'->>'reconciled'='true','adjust-only obtains verified current command metadata');
SELECT pg_temp.assert_true((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'adjust_context'::jsonb->'balance'->'account')k)=ARRAY['accountId','reconciled','version','year'],'account write context omits every private amount/history/source');
SELECT pg_temp.assert_true(:'adjust_context'::jsonb->>'scopeVersion'=public.leave_context_v1()->>'scopeVersion' AND (:'adjust_context'::jsonb->>'authorityKey') ~ '^[0-9a-f]{64}$','context binds current actor scope and exact grant fingerprint');
SELECT pg_temp.assert_denied($s$SELECT public.leave_balance_accounts_v1('71000000-0000-0000-0000-000000000001')$s$,'42501');
SELECT pg_temp.assert_denied(format('SELECT public.leave_balance_history_v1(%L)',:'adjust_context'::jsonb->'balance'->'account'->>'accountId'),'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_write_context_v1('71000000-0000-0000-0000-000000000002')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_write_context_v1('83000000-0000-0000-0000-000000000099')$s$,'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000009',true);
SELECT public.leave_admin_write_context_v1('71000000-0000-0000-0000-000000000001') configure_context \gset
SELECT pg_temp.assert_true(:'configure_context'::jsonb->'capabilities'='{"configure":true,"adjust":false}'::jsonb AND :'configure_context'::jsonb->'balance'->>'state'='verified','configure-only obtains independently scoped current account state');
SELECT pg_temp.assert_true(:'configure_context'::jsonb->'memberOptions'->>'state'='available' AND jsonb_array_length(:'configure_context'::jsonb->'memberOptions'->'calendars')=1 AND :'configure_context'::jsonb->'memberOptions'->'calendars'->0->>'id'='73000000-0000-0000-0000-000000000090','scoped configure sees only the already selected target lineage');
SELECT pg_temp.assert_true((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'configure_context'::jsonb->'memberOptions'->'calendars'->0)k)=ARRAY['id','name'] AND jsonb_array_length(:'configure_context'::jsonb->'memberOptions'->'groups')=2,'calendar/group options omit roster dates and private membership');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_setup_v1('rota',1,100)$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_balance_accounts_v1('71000000-0000-0000-0000-000000000001')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_write_context_v1('71000000-0000-0000-0000-000000000004')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_write_context_v1('71000000-0000-0000-0000-000000000009')$s$,'42501');
SELECT pg_temp.assert_true(public.leave_admin_write_context_v1('71000000-0000-0000-0000-000000000003')->'balance'->>'state'='missing','eligible missing account is distinct and is not prepared by a read');
SELECT pg_temp.assert_true(public.leave_admin_write_context_v1('71000000-0000-0000-0000-000000000018')->'balance'='{"state":"unavailable","currentPeriod":null,"account":null}'::jsonb,'unconfirmed first-grant eligibility does not invent period/account');
SELECT pg_temp.assert_true(public.leave_admin_write_context_v1('71000000-0000-0000-0000-000000000005')->'memberOptions'='{"state":"lineage_unassigned","calendars":[],"groups":[]}'::jsonb,'unassigned lineage does not enumerate alternatives');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_write_context_v1('71000000-0000-0000-0000-000000000001')$s$,'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000011',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_write_context_v1('71000000-0000-0000-0000-000000000001')$s$,'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000012',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_write_context_v1('71000000-0000-0000-0000-000000000001')$s$,'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000013',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_write_context_v1('71000000-0000-0000-0000-000000000001')$s$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
-- Owner-only fictional account preparation creates the unreconciled test case explicitly.
SELECT private.ihr_leave_prepare_account('71000000-0000-0000-0000-000000000003',clock_timestamp());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000009',true);
SELECT pg_temp.assert_true(public.leave_admin_write_context_v1('71000000-0000-0000-0000-000000000003')->'balance'->>'state'='unreconciled' AND public.leave_admin_write_context_v1('71000000-0000-0000-0000-000000000003')->'balance'->'account'->>'reconciled'='false','unreconciled is never advertised as verified');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.ihr_leave_access_grants SET revoked_at=clock_timestamp(),revoked_by='71000000-0000-0000-0000-000000000006' WHERE actor_id='71000000-0000-0000-0000-000000000010' AND employee_id='71000000-0000-0000-0000-000000000001' AND capability='adjust';
UPDATE public.users SET is_active=false WHERE id='71000000-0000-0000-0000-000000000009';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000010',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_write_context_v1('71000000-0000-0000-0000-000000000001')$s$,'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000009',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_write_context_v1('71000000-0000-0000-0000-000000000001')$s$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
ROLLBACK TO SAVEPOINT admin_write_context_fixture;
RELEASE SAVEPOINT admin_write_context_fixture;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
