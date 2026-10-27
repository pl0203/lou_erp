-- Run after helpers + accepted foundation/calendar/accounts + quote migration. No production data.
BEGIN;
\ir quote-seed.sql
SET LOCAL ROLE anon;
SELECT pg_temp.assert_denied($s$SELECT public.leave_quote_v1('{}')$s$,'42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_denied($s$SELECT private.ihr_leave_quote_v1('71000000-0000-0000-0000-000000000001','{}',now())$s$,'42501');
SELECT pg_temp.assert_true(public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1))->>'totalMinutes'='675','full Friday + working Saturday is exactly 675');
SELECT pg_temp.assert_true(public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1))->>'scopeVersion'=public.leave_context_v1()->>'scopeVersion','quote and context share the complete current actor scope token');
SELECT pg_temp.assert_true(public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+2))->'days'->2->>'exclusion'='off_duty','confirmed Sunday excluded, not missing');
SELECT pg_temp.assert_true(public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1))->'allocations'->0->>'availableAfter'='4725','verified allocation shown');
SELECT pg_temp.assert_true(public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1))->'approver'->>'id'='71000000-0000-0000-0000-000000000003','explicit current assignment');
DO $$ DECLARE minutes integer;v jsonb;BEGIN
 FOREACH minutes IN ARRAY ARRAY[60,120,180,225,240,300,360] LOOP
  v:=public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday(),jsonb_build_object('mode','fixed_minutes','minutes',minutes)));
  PERFORM pg_temp.assert_true((v->>'totalMinutes')::integer=minutes,'every exact weekday preset');
  IF minutes<=225 THEN
   v:=public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1,jsonb_build_object('mode','fixed_minutes','minutes',minutes)));
   PERFORM pg_temp.assert_true((v->>'totalMinutes')::integer=minutes*2,'half-day remains 225 even on Saturday');
  ELSE
   PERFORM pg_temp.assert_denied(format('SELECT public.leave_quote_v1(%L::jsonb)',pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1,jsonb_build_object('mode','fixed_minutes','minutes',minutes))),'22023');
  END IF;
 END LOOP;
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_quote_v1(%L::jsonb)',pg_temp.quote_input(pg_temp.quote_friday()+2,pg_temp.quote_friday()+2)),'22023');
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_quote_v1(%L::jsonb)',pg_temp.quote_input(pg_temp.quote_friday()+1,pg_temp.quote_friday())),'22023');
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_quote_v1(%L::jsonb)',pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday())||'{"reason":""}'::jsonb),'22023');
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_quote_v1(%L::jsonb)',pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday())||'{"start_date":"2026-02-29"}'::jsonb),'22023');
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_quote_v1(%L::jsonb)',pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday())||'{"start_date":"10/03/2026"}'::jsonb),'22023');
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_quote_v1(%L::jsonb)',pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday())||'{"employee_id":"71000000-0000-0000-0000-000000000002"}'::jsonb),'22023');
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_quote_v1(%L::jsonb)',pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday(),'{"mode":"fixed_minutes","minutes":450}')),'22023');
END $$;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert_true(public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1))->'days'->1->>'exclusion'='off_duty','off-rota Saturday distinct from absent roster');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000008',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1))$s$,'55000');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()))$s$,'55000');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000007',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()))$s$,'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000014',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()))$s$,'55000');
RESET ROLE;
ROLLBACK;
\ir quote-boundaries.sql
\echo IHR_QUOTE_PERMISSIONS_AND_CALCULATION_PASSED
