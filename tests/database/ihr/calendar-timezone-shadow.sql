-- Fictional-only caller-temp regression. Load helpers.sql through the guarded runner first.
-- Session login is postgres; every assertion and temp object creation uses effective authenticated.
-- Owner-only fixture rows establish authority. Product behavior uses only the public command path.
BEGIN;
\ir seed.sql
INSERT INTO public.ihr_leave_access_grants(actor_id,capability,scope_kind,employee_id,effective_from,granted_by,reason)
VALUES('71000000-0000-0000-0000-000000000006','configure','all_policy_members',NULL,'2000-01-01 00:00Z','71000000-0000-0000-0000-000000000005','Fictional timezone fixture authority');
SET LOCAL ROLE authenticated;
SET LOCAL search_path='';
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000006',true);
SELECT pg_temp.assert_true(current_user='authenticated' AND session_user='postgres','effective application role and session login are explicit');
CREATE TEMP TABLE pg_timezone_names(name text NOT NULL);
INSERT INTO pg_temp.pg_timezone_names(name) VALUES('Fictional/Timezone_Shadow');
SELECT pg_temp.assert_true(EXISTS(
 SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_roles r ON r.oid=c.relowner
 WHERE c.oid='pg_temp.pg_timezone_names'::regclass AND c.relpersistence='t' AND r.rolname='authenticated'
),'authenticated caller owns the temporary timezone relation');
SELECT pg_temp.assert_true(pg_catalog.to_regclass('pg_timezone_names')='pg_temp.pg_timezone_names'::regclass
 AND pg_catalog.to_regclass('pg_timezone_names')<>'pg_catalog.pg_timezone_names'::regclass
 AND NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name='Etc/UTC')
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name='Etc/UTC')
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name='Fictional/Timezone_Shadow'),
 'empty search_path still resolves unqualified relation to caller temp instead of the canonical view');
SELECT jsonb_build_object('effectiveRole',current_user,'sessionLogin',session_user,
 'searchPath',current_setting('search_path'),'unqualifiedIsCallerTemp',
 pg_catalog.to_regclass('pg_timezone_names')='pg_temp.pg_timezone_names'::regclass) AS timezone_shadow_identity;
SELECT pg_temp.assert_denied($s$SELECT private.ihr_leave_save_calendar('71000000-0000-0000-0000-000000000006','{}',statement_timestamp())$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT * FROM public.ihr_leave_calendars$s$,'42501');
DO $$
DECLARE p jsonb:='{"calendar_id":"73000000-0000-0000-0000-000000000096","name":"Fictional timezone shadow","effective_from":"2099-10-01","effective_until":null,"timezone":"Etc/UTC","holidays_confirmed":true,"sunday_minutes":0,"holidays":[],"groups":[],"expected_version":0,"reason":"Fictional canonical timezone"}';
 v_result jsonb;v_state text;v_detail text;v_before jsonb;v_after jsonb;
BEGIN
 p:=p||jsonb_build_object('preview_fingerprint',public.leave_calendar_preview_v1(p-'reason')->>'fingerprint');
 BEGIN
  v_result:=public.leave_transaction_v1('78000000-0000-0000-0000-000000000096','save_calendar_version',p);
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_detail=PG_EXCEPTION_DETAIL;
 END;
 RAISE NOTICE 'Fictional canonical timezone command under caller temp: %',jsonb_build_object('sqlstate',v_state,'detail',v_detail,'result',v_result);
 PERFORM pg_temp.assert_true(v_state IS NULL AND v_result->>'version'='1',
  'canonical timezone command must pass both save lookup and calendar INSERT trigger under caller temp');
 PERFORM pg_temp.assert_true(public.leave_transaction_v1('78000000-0000-0000-0000-000000000096','save_calendar_version',p)=v_result,
  'canonical timezone command replay stays idempotent under caller temp');
 SELECT value INTO v_before FROM jsonb_array_elements(public.leave_admin_setup_v1('rota',1,100)->'rows') WHERE value->>'id'=p->>'calendar_id';
 PERFORM pg_temp.assert_true(v_before IS NOT NULL AND v_before->>'timezone'='Etc/UTC' AND v_before->>'version'='1',
  'public setup projection confirms the canonical timezone and exact version');
 p:=p||'{"timezone":"Fictional/Timezone_Shadow","expected_version":1,"reason":"Fictional invalid shadow timezone"}'::jsonb;
 v_state:=NULL;v_detail:=NULL;
 BEGIN
  PERFORM public.leave_transaction_v1('78000000-0000-0000-0000-000000000097','save_calendar_version',p);
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_detail=PG_EXCEPTION_DETAIL;
 END;
 PERFORM pg_temp.assert_true(v_state='22023' AND v_detail='{"code":"INVALID_TIMEZONE"}',
  'caller temp cannot supply a timezone absent from the canonical catalog');
 SELECT value INTO v_after FROM jsonb_array_elements(public.leave_admin_setup_v1('rota',1,100)->'rows') WHERE value->>'id'=p->>'calendar_id';
 PERFORM pg_temp.assert_true(v_before=v_after,'invalid shadow timezone leaves immutable source and registry revision unchanged');
 PERFORM pg_temp.assert_true(NOT EXISTS(
  SELECT 1 FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace n ON n.oid=f.pronamespace
  WHERE n.nspname='private' AND f.proname LIKE 'ihr_%' AND pg_catalog.has_function_privilege(current_user,f.oid,'EXECUTE')
 ),'all private leave helpers remain revoked during caller-temp product checks');
END;
$$;
RESET ROLE;
ROLLBACK;
\echo IHR_CALENDAR_TIMEZONE_SHADOW_PASSED
