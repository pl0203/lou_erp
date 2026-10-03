-- Fictional global-configure continuity proof; every fixture mutation rolls back.
SAVEPOINT admin_rota_context_fixture;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE anon;
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_rota_context_v1('73000000-0000-0000-0000-000000000090')$s$,'42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer;BEGIN
 FOREACH n IN ARRAY ARRAY[1,5,6,9,10,11,12,13,14,16,19] LOOP
  PERFORM set_config('request.jwt.claim.sub',('71000000-0000-0000-0000-'||lpad(n::text,12,'0')),true);
  PERFORM pg_temp.assert_denied($s$SELECT public.leave_admin_rota_context_v1('73000000-0000-0000-0000-000000000090')$s$,'42501');
 END LOOP;
END $$;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000009',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_setup_v1('rota',1,100)$s$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
-- Existing global-configure authority is modeled only in this owner-controlled test fixture.
INSERT INTO public.ihr_leave_access_grants(id,actor_id,capability,scope_kind,effective_from,effective_until,granted_by,reason) VALUES
('85000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000005','configure','all_policy_members','2000-01-01',NULL,'71000000-0000-0000-0000-000000000006','Fictional global configure'),
('85000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000004','configure','all_policy_members','2000-01-01',NULL,'71000000-0000-0000-0000-000000000006','Fictional director denied'),
('85000000-0000-0000-0000-000000000007','71000000-0000-0000-0000-000000000007','configure','all_policy_members','2000-01-01',NULL,'71000000-0000-0000-0000-000000000006','Fictional inactive denied'),
('85000000-0000-0000-0000-000000000008','71000000-0000-0000-0000-000000000008','configure','all_policy_members',clock_timestamp()+interval '1 day',NULL,'71000000-0000-0000-0000-000000000006','Fictional future denied'),
('85000000-0000-0000-0000-000000000009','71000000-0000-0000-0000-000000000008','configure','all_policy_members','2000-01-01',clock_timestamp()-interval '1 day','71000000-0000-0000-0000-000000000006','Fictional expired denied');
INSERT INTO private.ihr_leave_calendar_registry(id,version) VALUES('85000000-0000-0000-0000-000000000020',1);
INSERT INTO public.ihr_leave_calendars(calendar_id,version,name,effective_from,timezone,created_by)
VALUES('85000000-0000-0000-0000-000000000020',1,'Fictional separate calendar','2020-01-01',NULL,'71000000-0000-0000-0000-000000000006');
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer;BEGIN
 FOREACH n IN ARRAY ARRAY[4,7,8] LOOP
  PERFORM set_config('request.jwt.claim.sub',('71000000-0000-0000-0000-'||lpad(n::text,12,'0')),true);
  PERFORM pg_temp.assert_denied($s$SELECT public.leave_admin_rota_context_v1('73000000-0000-0000-0000-000000000090')$s$,'42501');
 END LOOP;
END $$;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT public.leave_admin_rota_context_v1('73000000-0000-0000-0000-000000000090') rota_context_before \gset
SELECT pg_temp.assert_true(:'rota_context_before'::jsonb->>'calendarId'='73000000-0000-0000-0000-000000000090'
 AND :'rota_context_before'::jsonb->>'scopeVersion'=public.leave_context_v1()->>'scopeVersion'
 AND (:'rota_context_before'::jsonb->>'authorityKey') ~ '^[0-9a-f]{64}$'
 AND :'rota_context_before'::jsonb->'calendar'=(SELECT c FROM jsonb_array_elements(public.leave_admin_setup_v1('rota',1,100)->'rows') c WHERE c->>'id'='73000000-0000-0000-0000-000000000090'),'global configure sees exactly the existing selected setup projection and current scope');
SELECT pg_temp.assert_true(public.leave_admin_rota_context_v1('85000000-0000-0000-0000-000000000020')->>'authorityKey'<>:'rota_context_before'::jsonb->>'authorityKey','authority proof binds the exact selected calendar');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_rota_context_v1('85000000-0000-0000-0000-000000000099')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_rota_context_v1(NULL)$s$,'42501');
SELECT jsonb_build_object(
 'calendar_id','73000000-0000-0000-0000-000000000090','expected_version',(:'rota_context_before'::jsonb->'calendar'->>'version')::bigint,'reason','Fictional own calendar revision continuity',
 'name','Fictional future calendar','effective_from',(clock_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::date+2,'effective_until',(clock_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::date+32,
 'timezone','Pacific/Kiritimati','holidays_confirmed',true,'sunday_minutes',0,'holidays','[]'::jsonb,
 'groups',(SELECT jsonb_agg(g-'onAnchor') FROM jsonb_array_elements(:'rota_context_before'::jsonb->'calendar'->'groups') g)) rota_save_payload \gset
SELECT public.leave_transaction_v1('85000000-0000-0000-0000-000000000030','save_calendar_version',:'rota_save_payload'::jsonb||jsonb_build_object('preview_fingerprint',public.leave_calendar_preview_v1(:'rota_save_payload'::jsonb-'reason')->>'fingerprint'));
SELECT public.leave_admin_rota_context_v1('73000000-0000-0000-0000-000000000090') rota_context_after \gset
SELECT pg_temp.assert_true(:'rota_context_after'::jsonb->>'authorityKey'=:'rota_context_before'::jsonb->>'authorityKey'
 AND :'rota_context_after'::jsonb->>'scopeVersion'<>:'rota_context_before'::jsonb->>'scopeVersion'
 AND (:'rota_context_after'::jsonb->'calendar'->>'version')::bigint=(:'rota_context_before'::jsonb->'calendar'->>'version')::bigint+1,'own completed calendar save changes data revision while the same qualifying grants preserve authority');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.ihr_leave_access_grants SET reason='Fictional qualifying grant version change' WHERE id='85000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT public.leave_admin_rota_context_v1('73000000-0000-0000-0000-000000000090') rota_context_versioned \gset
SELECT pg_temp.assert_true(:'rota_context_versioned'::jsonb->>'authorityKey'<>:'rota_context_after'::jsonb->>'authorityKey','same qualifying grant ID with a new version invalidates the old proof');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.ihr_leave_access_grants SET revoked_at=clock_timestamp(),revoked_by='71000000-0000-0000-0000-000000000006' WHERE id='85000000-0000-0000-0000-000000000001';
INSERT INTO public.ihr_leave_access_grants(id,actor_id,capability,scope_kind,effective_from,granted_by,reason)
VALUES('85000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000005','configure','all_policy_members','2000-01-01','71000000-0000-0000-0000-000000000006','Fictional replacement authority');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_true(public.leave_admin_rota_context_v1('73000000-0000-0000-0000-000000000090')->>'authorityKey'<>:'rota_context_versioned'::jsonb->>'authorityKey','replacement grant with identical capability and audience invalidates the old proof');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.ihr_leave_access_grants SET revoked_at=clock_timestamp(),revoked_by='71000000-0000-0000-0000-000000000006' WHERE id='85000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_rota_context_v1('73000000-0000-0000-0000-000000000090')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_setup_v1('rota',1,100)$s$,'42501');
ROLLBACK TO SAVEPOINT admin_rota_context_fixture;
RELEASE SAVEPOINT admin_rota_context_fixture;
