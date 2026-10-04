BEGIN;
\ir quote-seed.sql
CREATE TEMP TABLE quote_before AS SELECT private.ihr_leave_quote_v1('71000000-0000-0000-0000-000000000001',pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1),statement_timestamp()) q,
 (SELECT count(*) FROM public.ihr_leave_accounts) accounts,(SELECT count(*) FROM public.ihr_leave_ledger) ledger;
GRANT SELECT ON quote_before TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true((SELECT q->>'fingerprint' FROM quote_before)=public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1))->>'fingerprint','same sources and exact input repeat deterministically');
SELECT pg_temp.assert_true(position('Fictional private reason' IN public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1))::text)=0,'response never echoes private reason');
SELECT pg_temp.assert_true((SELECT q->>'fingerprint' FROM quote_before)<>public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1)||'{"reason":"Another fictional reason"}'::jsonb)->>'fingerprint','reason change changes input fingerprint without echo');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ BEGIN
 IF (SELECT accounts FROM quote_before)<>(SELECT count(*) FROM public.ihr_leave_accounts) OR (SELECT ledger FROM quote_before)<>(SELECT count(*) FROM public.ihr_leave_ledger) THEN RAISE EXCEPTION 'Read-only quote changed balances'; END IF;
END $$;
SAVEPOINT scenario;
INSERT INTO public.ihr_leave_ledger(account_id,effective_date,kind,allowance_delta,source_kind,source_id,source_event,reason)
SELECT id,period_start,'adjustment',60,'fixture','79000000-0000-0000-0000-000000000080','adjust','Fictional test adjustment' FROM public.ihr_leave_accounts WHERE employee_id='71000000-0000-0000-0000-000000000001' AND year=extract(year FROM pg_temp.quote_friday());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true((SELECT q->>'fingerprint' FROM quote_before)<>public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1))->>'fingerprint','account version invalidates quote');
RESET ROLE;
ROLLBACK TO scenario;
UPDATE public.ihr_leave_approvers SET updated_at=clock_timestamp() WHERE employee_id='71000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true((SELECT q->>'fingerprint' FROM quote_before)<>public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1))->>'fingerprint','assignment version invalidates quote');
RESET ROLE;
ROLLBACK TO scenario;
UPDATE public.ihr_leave_members SET updated_at=clock_timestamp() WHERE user_id='71000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true((SELECT q->>'fingerprint' FROM quote_before)<>public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1))->>'fingerprint','member version invalidates quote');
RESET ROLE;
ROLLBACK TO scenario;
-- Immutable new publication; same capacity, different source fingerprint.
INSERT INTO public.ihr_saturday_roster(calendar_version_id,group_id,version,day,capacity_minutes,anchor,on_anchor,effective_from,effective_until,published_by)
SELECT calendar_version_id,group_id,2,day,capacity_minutes,anchor,on_anchor,effective_from,effective_until,published_by FROM public.ihr_saturday_roster WHERE day=pg_temp.quote_friday()+1 AND group_id='79000000-0000-0000-0000-000000000021';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true((SELECT q->>'fingerprint' FROM quote_before)<>public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1))->>'fingerprint','roster version invalidates quote');
RESET ROLE;
ROLLBACK TO scenario;
INSERT INTO public.ihr_leave_calendar_exceptions(calendar_version_id,day,kind) VALUES('73000000-0000-0000-0000-000000000091',pg_temp.quote_friday(),'holiday');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1))->>'totalMinutes'='225','holiday excludes only explicitly covered date');
SELECT pg_temp.assert_true(public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1))->'days'->0->>'exclusion'='holiday','holiday reason is explicit');
RESET ROLE;
ROLLBACK TO scenario;
-- Transfer exactly at next working Saturday changes effective membership and duty.
UPDATE public.ihr_saturday_memberships SET effective_until=pg_temp.quote_friday()+1,version=version+1 WHERE id='79000000-0000-0000-0000-000000000031';
INSERT INTO public.ihr_saturday_memberships(employee_id,group_id,effective_from,effective_until,created_by) VALUES('71000000-0000-0000-0000-000000000001','79000000-0000-0000-0000-000000000022',pg_temp.quote_friday()+1,'2040-01-01','71000000-0000-0000-0000-000000000006');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1))->>'totalMinutes'='450','effective transfer resolves date-specific group');
RESET ROLE;
ROLLBACK TO scenario;
-- A higher calendar without matching roster must not inherit an obsolete publication.
INSERT INTO public.ihr_leave_calendars(id,calendar_id,version,name,effective_from,effective_until,timezone,holidays_confirmed,sunday_minutes,created_by) VALUES
('79000000-0000-0000-0000-000000000050','73000000-0000-0000-0000-000000000090',2,'Fictional replacement',pg_temp.quote_friday(),NULL,'Pacific/Kiritimati',true,0,'71000000-0000-0000-0000-000000000006');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1))$s$,'55000');
RESET ROLE;
ROLLBACK TO scenario;
-- Missing policy answers remain blocked, even if annual eligibility is known.
UPDATE public.ihr_leave_members SET active_policy_id='76000000-0000-0000-0000-000000000090' WHERE user_id='71000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()))$s$,'55000');
RESET ROLE;
ROLLBACK TO scenario;
-- Insufficient allowance rejects the complete otherwise-valid range.
INSERT INTO public.ihr_leave_ledger(account_id,effective_date,kind,allowance_delta,source_kind,source_id,source_event,reason)
SELECT id,period_start,'adjustment',-5400,'fixture','79000000-0000-0000-0000-000000000081','empty','Fictional test adjustment' FROM public.ihr_leave_accounts WHERE employee_id='71000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1))$s$,'55000');
RESET ROLE;
ROLLBACK TO scenario;
-- OWNER deterministic date/period checks are calculation evidence, not permission evidence.
DO $$ DECLARE y integer:=extract(year FROM statement_timestamp() AT TIME ZONE 'Pacific/Kiritimati');q jsonb;before_count bigint;BEGIN
 q:=private.ihr_leave_quote_v1('71000000-0000-0000-0000-000000000001',pg_temp.quote_input(make_date(y,12,31),make_date(y+1,1,1)),make_date(y,12,1)::timestamp AT TIME ZONE 'Pacific/Kiritimati');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(q->'days') d WHERE (d->>'chargedMinutes')::int>0 AND (d->>'year')::int<>extract(year FROM (d->>'date')::date)) THEN RAISE EXCEPTION 'Charges allocated to wrong year'; END IF;
 SELECT count(*) INTO before_count FROM public.ihr_leave_accounts;
 BEGIN
  PERFORM private.ihr_leave_quote_v1('71000000-0000-0000-0000-000000000001',pg_temp.quote_input(make_date(y+2,1,4),make_date(y+2,1,8)),make_date(y+1,12,1)::timestamp AT TIME ZONE 'Pacific/Kiritimati');
  RAISE EXCEPTION 'Future missing account accepted';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 IF before_count<>(SELECT count(*) FROM public.ihr_leave_accounts) THEN RAISE EXCEPTION 'Quote created future account'; END IF;
 BEGIN
  PERFORM private.ihr_leave_quote_v1('71000000-0000-0000-0000-000000000001',pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()),(pg_temp.quote_friday()+1)::timestamp AT TIME ZONE 'Pacific/Kiritimati');RAISE EXCEPTION 'Backdate accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 BEGIN
  PERFORM private.ihr_leave_quote_v1('71000000-0000-0000-0000-000000000001',pg_temp.quote_input(pg_temp.quote_friday()+367,pg_temp.quote_friday()+367),pg_temp.quote_friday()::timestamp AT TIME ZONE 'Pacific/Kiritimati');RAISE EXCEPTION 'Beyond horizon accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;
ROLLBACK TO scenario;
-- A renamed/versioned group has identical duty and charge but is a different source.
UPDATE public.ihr_saturday_groups SET name='Fictional Amber reviewed',version=version+1
WHERE id='79000000-0000-0000-0000-000000000021';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1))->>'totalMinutes'='675','group source change keeps the same scheduled charge');
SELECT pg_temp.assert_true((SELECT q->>'fingerprint' FROM quote_before)<>public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1))->>'fingerprint','group source content/version invalidates the previous fingerprint');
RESET ROLE;
ROLLBACK TO scenario;

-- A one-Friday immutable calendar publication needs no new Saturday roster. All
-- amounts and the Saturday's source stay unchanged; Friday selects the new source.
INSERT INTO public.ihr_leave_calendars(id,calendar_id,version,name,effective_from,effective_until,timezone,holidays_confirmed,sunday_minutes,created_by)
VALUES('79000000-0000-0000-0000-000000000051','73000000-0000-0000-0000-000000000090',2,'Fictional same-capacity Friday',pg_temp.quote_friday(),pg_temp.quote_friday()+1,'Pacific/Kiritimati',true,0,'71000000-0000-0000-0000-000000000006');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1))->>'totalMinutes'='675','calendar source change keeps the same scheduled charge');
SELECT pg_temp.assert_true(public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1))->'days'->0->'sources'->>'calendarId'='79000000-0000-0000-0000-000000000051','Friday selects the new immutable calendar source');
SELECT pg_temp.assert_true(public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1))->'days'->1->'sources'->>'calendarId'='73000000-0000-0000-0000-000000000091','Saturday keeps its original calendar and roster');
SELECT pg_temp.assert_true((SELECT q->>'fingerprint' FROM quote_before)<>public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1))->>'fingerprint','calendar source identity/version invalidates the previous fingerprint');
RESET ROLE;
ROLLBACK TO scenario;

-- Policy rows and the original account binding are immutable. A replacement is
-- a new source; an old-policy account must block reuse rather than silently rebind.
INSERT INTO public.ihr_leave_policies(id,version,effective_from,effective_until,annual_policy_confirmed,created_by,
 minimum_notice_days,booking_horizon_days,reason_required,request_rules_confirmed,reserve_pending_accepted,single_date_rule_accepted)
VALUES('79000000-0000-0000-0000-000000000061',2,'2020-01-01','2040-01-01',true,'71000000-0000-0000-0000-000000000006',0,366,false,true,true,true);
UPDATE public.ihr_leave_members SET active_policy_id='79000000-0000-0000-0000-000000000061' WHERE user_id='71000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()+1))$s$,'55000');
RESET ROLE;
ROLLBACK TO scenario;

-- OWNER calculation evidence only: deterministic synthetic as-of time and explicit
-- grant/opening for an established fixture employee. No client clock override.
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ DECLARE a public.ihr_leave_accounts%ROWTYPE;q jsonb;BEGIN
 a:=private.ihr_leave_prepare_account('71000000-0000-0000-0000-000000000001','2028-01-02 00:00:00'::timestamp AT TIME ZONE 'Pacific/Kiritimati');
 UPDATE public.ihr_leave_accounts SET opening_reconciled=true,opening_as_of='2028-01-01',opening_source_id='79000000-0000-0000-0000-000000000071'
 WHERE id=a.id AND NOT opening_reconciled;
 q:=private.ihr_leave_quote_v1('71000000-0000-0000-0000-000000000001',pg_temp.quote_input('2028-02-29','2028-02-29'),'2028-02-01 00:00:00'::timestamp AT TIME ZONE 'Pacific/Kiritimati');
 IF q->>'today'<>'2028-02-01' OR q->>'totalMinutes'<>'450' OR jsonb_array_length(q->'days')<>1
  OR q->'days'->0->>'date'<>'2028-02-29' OR q->'days'->0->>'scheduledMinutes'<>'450'
  OR q->'days'->0->>'chargedMinutes'<>'450' OR q->'days'->0->>'exclusion' IS NOT NULL
  OR q->'allocations'->0->>'year'<>'2028' OR q->'allocations'->0->>'accountId'<>a.id::text THEN
  RAISE EXCEPTION 'Valid leap-day quote must preserve its exact date, charge, and annual allocation';
 END IF;
END $$;
ROLLBACK;
