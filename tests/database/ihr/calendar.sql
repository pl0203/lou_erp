-- Fictional-only calendar suite. Load helpers.sql first through the guarded runner.
-- Owner fixture/calculation blocks are NOT permission/RLS evidence. App assertions use real roles.
\ir calendar-timezone-shadow.sql
BEGIN;
\ir seed.sql
INSERT INTO private.ihr_leave_calendar_registry(id,version) VALUES('73000000-0000-0000-0000-000000000001',1);
INSERT INTO public.ihr_leave_calendars(id,calendar_id,version,name,effective_from,effective_until,timezone,holidays_confirmed,sunday_minutes,created_by)
VALUES('73000000-0000-0000-0000-000000000011','73000000-0000-0000-0000-000000000001',1,'Fictional calculation calendar','2026-10-01','2026-11-01','Etc/UTC',true,0,'71000000-0000-0000-0000-000000000006');
INSERT INTO public.ihr_saturday_groups(id,calendar_id,name) VALUES
 ('74000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000001','Fictional A'),
 ('74000000-0000-0000-0000-000000000002','73000000-0000-0000-0000-000000000001','Fictional B');
UPDATE public.ihr_leave_members SET active_calendar_id='73000000-0000-0000-0000-000000000001',timezone='Etc/UTC' WHERE user_id IN('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000008');
INSERT INTO public.ihr_saturday_memberships(id,employee_id,group_id,effective_from,effective_until,created_by) VALUES
 ('75000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','74000000-0000-0000-0000-000000000001','2026-10-01','2026-10-17','71000000-0000-0000-0000-000000000006'),
 ('75000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000001','74000000-0000-0000-0000-000000000002','2026-10-17','2026-11-01','71000000-0000-0000-0000-000000000006'),
 ('75000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000002','74000000-0000-0000-0000-000000000002','2026-10-01','2026-11-01','71000000-0000-0000-0000-000000000006');
INSERT INTO public.ihr_saturday_roster(calendar_version_id,group_id,version,day,capacity_minutes,anchor,on_anchor,effective_from,effective_until,published_by)
SELECT '73000000-0000-0000-0000-000000000011',g.id,1,date '2026-10-03'+n*7,
 CASE WHEN (mod(n,2)=0)=g.on_anchor THEN 225 ELSE 0 END,'2026-10-03',g.on_anchor,'2026-10-03','2026-10-24','71000000-0000-0000-0000-000000000006'
FROM (VALUES ('74000000-0000-0000-0000-000000000001'::uuid,true),('74000000-0000-0000-0000-000000000002'::uuid,false))g(id,on_anchor) CROSS JOIN generate_series(0,2)n;
INSERT INTO public.ihr_leave_calendar_exceptions(calendar_version_id,day,kind) VALUES('73000000-0000-0000-0000-000000000011','2026-10-06','holiday');
-- OWNER-ONLY deterministic private calculations. Null-sensitive checks ensure missing results fail.
DO $$ DECLARE a uuid:='71000000-0000-0000-0000-000000000001';b uuid:='71000000-0000-0000-0000-000000000002';BEGIN
 IF private.ihr_working_day_v1(a,'2026-10-03')->>'capacity_minutes' IS DISTINCT FROM '225' THEN RAISE EXCEPTION 'A works anchor Saturday';END IF;
 IF private.ihr_working_day_v1(b,'2026-10-03')->>'capacity_minutes' IS DISTINCT FROM '0' THEN RAISE EXCEPTION 'B off anchor Saturday';END IF;
 IF private.ihr_working_day_v1(a,'2026-10-10')->>'capacity_minutes' IS DISTINCT FROM '0' THEN RAISE EXCEPTION 'A off next Saturday';END IF;
 IF private.ihr_working_day_v1(b,'2026-10-10')->>'capacity_minutes' IS DISTINCT FROM '225' THEN RAISE EXCEPTION 'B works next Saturday';END IF;
 IF private.ihr_working_day_v1(a,'2026-10-17')->>'capacity_minutes' IS DISTINCT FROM '0' THEN RAISE EXCEPTION 'Transfer on exact Saturday boundary';END IF;
 IF private.ihr_working_day_v1(a,'2026-10-05')->>'capacity_minutes' IS DISTINCT FROM '450' THEN RAISE EXCEPTION 'Monday is 450';END IF;
 IF private.ihr_working_day_v1(a,'2026-10-06')->>'exclusion' IS DISTINCT FROM 'holiday' OR private.ihr_working_day_v1(a,'2026-10-06')->>'capacity_minutes' IS DISTINCT FROM '0' THEN RAISE EXCEPTION 'Confirmed holiday is zero';END IF;
 IF private.ihr_working_day_v1(a,'2026-10-04')->>'exclusion' IS DISTINCT FROM 'off_duty' THEN RAISE EXCEPTION 'Sunday explicitly off-duty';END IF;
 IF private.ihr_working_day_v1(a,'2026-10-31')->>'error' IS DISTINCT FROM 'ROSTER_COVERAGE_MISSING' THEN RAISE EXCEPTION 'Missing roster is not off duty';END IF;
 IF private.ihr_working_day_v1('71000000-0000-0000-0000-000000000008','2026-10-03')->>'error' IS DISTINCT FROM 'MEMBERSHIP_COVERAGE_MISSING' THEN RAISE EXCEPTION 'Missing group is not off duty';END IF;
 BEGIN
  INSERT INTO public.ihr_saturday_memberships(employee_id,group_id,effective_from,effective_until,created_by) VALUES(a,'74000000-0000-0000-0000-000000000002','2026-10-10','2026-10-20','71000000-0000-0000-0000-000000000006');
  RAISE EXCEPTION 'Overlapping membership accepted';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
END $$;
-- OWNER-ONLY holiday/setup dependency regressions; these are not role/RLS evidence.
INSERT INTO public.ihr_leave_calendar_exceptions(calendar_version_id,day,kind) VALUES
 ('73000000-0000-0000-0000-000000000011','2026-10-03','holiday'),
 ('73000000-0000-0000-0000-000000000011','2026-10-31','holiday');
DO $$ DECLARE a uuid:='71000000-0000-0000-0000-000000000001';unassigned uuid:='71000000-0000-0000-0000-000000000008';v jsonb;roster_id uuid;BEGIN
 IF private.ihr_working_day_v1(unassigned,'2026-10-03')->>'error' IS DISTINCT FROM 'MEMBERSHIP_COVERAGE_MISSING' THEN RAISE EXCEPTION 'Saturday holiday still needs membership';END IF;
 IF private.ihr_working_day_v1(a,'2026-10-31')->>'error' IS DISTINCT FROM 'ROSTER_COVERAGE_MISSING' THEN RAISE EXCEPTION 'Saturday holiday still needs published roster';END IF;
 v:=private.ihr_working_day_v1(a,'2026-10-03');
 SELECT r.id INTO roster_id FROM public.ihr_saturday_roster r WHERE r.group_id='74000000-0000-0000-0000-000000000001' AND r.day='2026-10-03';
 IF v->>'capacity_minutes' IS DISTINCT FROM '0' OR v->>'exclusion' IS DISTINCT FROM 'holiday'
  OR v->>'calendar_id' IS DISTINCT FROM '73000000-0000-0000-0000-000000000011' OR v->>'calendar_version' IS DISTINCT FROM '1'
  OR v->>'membership_id' IS DISTINCT FROM '75000000-0000-0000-0000-000000000001' OR v->>'membership_version' IS DISTINCT FROM '1'
  OR v->>'roster_id' IS DISTINCT FROM roster_id::text OR v->>'roster_version' IS DISTINCT FROM '1'
 THEN RAISE EXCEPTION 'Scheduled Saturday holiday retains all immutable source references';END IF;
 v:=private.ihr_working_day_v1(unassigned,'2026-10-06');
 IF v->>'capacity_minutes' IS DISTINCT FROM '0' OR v->>'exclusion' IS DISTINCT FROM 'holiday'
  OR v->>'membership_id' IS NOT NULL OR v->>'roster_id' IS NOT NULL
 THEN RAISE EXCEPTION 'Weekday holiday does not require Saturday membership or roster';END IF;
END $$;
-- Immutable future-source selection calculation: a holiday overlay cannot inherit a prior source's roster.
INSERT INTO public.ihr_leave_calendars(id,calendar_id,version,name,effective_from,effective_until,timezone,holidays_confirmed,sunday_minutes,created_by)
VALUES('73000000-0000-0000-0000-000000000012','73000000-0000-0000-0000-000000000001',2,'Fictional overlay','2026-10-10','2026-10-11','Etc/UTC',true,0,'71000000-0000-0000-0000-000000000006');
INSERT INTO public.ihr_leave_calendar_exceptions(calendar_version_id,day,kind) VALUES('73000000-0000-0000-0000-000000000012','2026-10-10','holiday');
DO $$ BEGIN
 IF private.ihr_working_day_v1('71000000-0000-0000-0000-000000000001','2026-10-10')->>'error' IS DISTINCT FROM 'ROSTER_COVERAGE_MISSING' THEN RAISE EXCEPTION 'Overlay needs matching roster';END IF;
END $$;
INSERT INTO public.ihr_saturday_roster(calendar_version_id,group_id,version,day,capacity_minutes,anchor,on_anchor,effective_from,effective_until,published_by)
VALUES('73000000-0000-0000-0000-000000000012','74000000-0000-0000-0000-000000000001',3,'2026-10-10',225,'2026-10-10',true,'2026-10-10','2026-10-11','71000000-0000-0000-0000-000000000006');
DO $$ DECLARE v jsonb:=private.ihr_working_day_v1('71000000-0000-0000-0000-000000000001','2026-10-10');BEGIN
 IF v->>'calendar_id' IS DISTINCT FROM '73000000-0000-0000-0000-000000000012' OR v->>'calendar_version' IS DISTINCT FROM '2' OR v->>'roster_version' IS DISTINCT FROM '3' OR v->>'capacity_minutes' IS DISTINCT FROM '0' OR v->>'exclusion' IS DISTINCT FROM 'holiday' OR v->>'roster_id' IS NULL OR v->>'membership_id' IS DISTINCT FROM '75000000-0000-0000-0000-000000000001' THEN RAISE EXCEPTION 'Holiday overlay preserves highest source and matching roster';END IF;
 IF (SELECT count(*) FROM public.ihr_saturday_roster WHERE calendar_version_id='73000000-0000-0000-0000-000000000011')<>6 THEN RAISE EXCEPTION 'Prior sources retained';END IF;
END $$;
-- A touched Sunday still needs explicit Sunday policy, even with a confirmed holiday.
INSERT INTO public.ihr_leave_calendars(id,calendar_id,version,name,effective_from,effective_until,timezone,holidays_confirmed,sunday_minutes,created_by)
VALUES('73000000-0000-0000-0000-000000000013','73000000-0000-0000-0000-000000000001',3,'Fictional Sunday overlay','2026-10-04','2026-10-05','Etc/UTC',true,NULL,'71000000-0000-0000-0000-000000000006');
INSERT INTO public.ihr_leave_calendar_exceptions(calendar_version_id,day,kind) VALUES('73000000-0000-0000-0000-000000000013','2026-10-04','holiday');
DO $$ BEGIN
 IF private.ihr_working_day_v1('71000000-0000-0000-0000-000000000001','2026-10-04')->>'error' IS DISTINCT FROM 'SUNDAY_UNCONFIGURED' THEN RAISE EXCEPTION 'Sunday holiday cannot bypass unconfigured Sunday';END IF;
END $$;
SET LOCAL ROLE anon;
SELECT pg_temp.assert_denied($s$SELECT public.leave_roster_preview_v1('73000000-0000-0000-0000-000000000001','2026-10-03','[]','2026-10-03','2026-10-24')$s$,'42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_setup_v1('rota',1,20)$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_roster_preview_v1('73000000-0000-0000-0000-000000000001','2026-10-03','[]','2026-10-03','2026-10-24')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT private.ihr_working_day_v1('71000000-0000-0000-0000-000000000001','2026-10-03')$s$,'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_setup_v1('rota',1,20)$s$,'42501');
SELECT pg_temp.assert_true(public.leave_admin_setup_v1('people',1,20)->'rows'='[{"id":"71000000-0000-0000-0000-000000000001","name":"Fictional iHR 1","applicationRole":"sales_person","active":true}]'::jsonb,'people directory stays scoped and exact');
SELECT pg_temp.assert_true(public.leave_admin_setup_v1('members',1,20)->'rows'->0->'impacts'='{"available":false,"pendingCount":null,"approvedCount":null}'::jsonb,'configuration impacts are unavailable without false zeroes');
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['public.ihr_leave_policies','public.ihr_leave_calendars','public.ihr_leave_calendar_exceptions','public.ihr_saturday_groups','public.ihr_saturday_memberships','public.ihr_saturday_roster','private.ihr_leave_calendar_registry'] LOOP
  PERFORM pg_temp.assert_denied('SELECT * FROM '||t,'42501');PERFORM pg_temp.assert_denied('INSERT INTO '||t||' DEFAULT VALUES','42501');PERFORM pg_temp.assert_denied('DELETE FROM '||t,'42501');PERFORM pg_temp.assert_denied('TRUNCATE '||t,'42501');
 END LOOP;
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname LIKE 'ihr_%' AND has_function_privilege(current_user,p.oid,'EXECUTE')),'all private leave helpers remain revoked');
END $$;
RESET ROLE;
ROLLBACK;
\ir calendar-commands.sql
\echo IHR_CALENDAR_PERMISSIONS_AND_SETUP_PASSED
