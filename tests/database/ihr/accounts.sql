-- FICTIONAL ONLY. Owner fixture/temporal calculations are distinct from actual-role assertions.
BEGIN;
\ir seed.sql
\ir accounts-seed.sql
-- OWNER deterministic calendar-year boundaries, late preparation and immutable retained periods.
DO $$ DECLARE a public.ihr_leave_accounts%ROWTYPE;b public.ihr_leave_accounts%ROWTYPE;e jsonb;BEGIN
 e:=private.ihr_leave_annual_eligibility('71000000-0000-0000-0000-000000000001','2026-12-31 23:30:00+00');
 IF e->>'year' IS DISTINCT FROM '2027' THEN RAISE EXCEPTION 'Confirmed lineage local year, not UTC or stale member timezone'; END IF;
 a:=private.ihr_leave_prepare_account('71000000-0000-0000-0000-000000000001','2026-10-02 12:00:00+00');
 b:=private.ihr_leave_prepare_account('71000000-0000-0000-0000-000000000001','2026-12-01 12:00:00+00');
 IF a.id IS DISTINCT FROM b.id OR b.allowance_minutes<>5400 OR b.period_start<>'2026-01-01' OR b.period_end<>'2027-01-01' OR b.opening_reconciled THEN RAISE EXCEPTION 'Unique annual January grant, no inferred opening'; END IF;
 IF (SELECT count(*) FROM public.ihr_leave_ledger WHERE account_id=a.id AND kind='annual_grant')<>1 THEN RAISE EXCEPTION 'Annual grant duplicated'; END IF;
 IF (SELECT effective_date FROM public.ihr_leave_ledger WHERE account_id=a.id AND kind='annual_grant')<>'2026-01-01' THEN RAISE EXCEPTION 'Delayed preparation must grant at Jan1'; END IF;
 IF private.ihr_leave_balance_json(a,'2026-10-02')->'availableMinutes' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Unverified availability is unknown'; END IF;
 UPDATE public.ihr_leave_accounts SET opening_reconciled=true,opening_as_of='2026-10-02',opening_source_id='78000000-0000-0000-0000-000000000001' WHERE id=a.id RETURNING * INTO a;
 INSERT INTO public.ihr_leave_ledger(account_id,effective_date,kind,used_delta,source_kind,source_id,source_event)
 VALUES(a.id,'2026-10-02','opening',450,'opening','78000000-0000-0000-0000-000000000001','verified');
 SELECT * INTO a FROM public.ihr_leave_accounts WHERE id=a.id;
 e:=private.ihr_leave_balance_json(a,'2027-01-01 00:00:00+00');
 IF e->>'availableMinutes' IS DISTINCT FROM '0' OR e->>'expiredMinutes' IS DISTINCT FROM '4950' THEN RAISE EXCEPTION 'Unused expiry is not next-year spendable'; END IF;
 b:=private.ihr_leave_prepare_account(a.employee_id,'2027-01-01 00:00:00+00');
 IF b.id=a.id OR b.allowance_minutes<>5400 OR b.opening_reconciled THEN RAISE EXCEPTION 'Next-year independent preparation'; END IF;
 BEGIN UPDATE public.ihr_leave_ledger SET used_delta=0 WHERE account_id=a.id;RAISE EXCEPTION 'Mutable ledger';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;
 BEGIN DELETE FROM public.ihr_leave_accounts WHERE id=a.id;RAISE EXCEPTION 'Deleted period';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;
 BEGIN UPDATE public.ihr_leave_accounts SET year=2028 WHERE id=a.id;RAISE EXCEPTION 'Moved original period';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;
 BEGIN PERFORM private.ihr_leave_prepare_account('71000000-0000-0000-0000-000000000018','2026-10-02');RAISE EXCEPTION 'First grant inferred';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
 BEGIN PERFORM private.ihr_leave_prepare_account('71000000-0000-0000-0000-000000000004','2026-10-02');RAISE EXCEPTION 'Director account created';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
END $$;
-- Higher applicable unconfirmed draft does not erase lineage but blocks new preparation.
INSERT INTO public.ihr_leave_calendars(id,calendar_id,version,name,effective_from,effective_until,timezone,holidays_confirmed,sunday_minutes,created_by)
VALUES('73000000-0000-0000-0000-000000000092','73000000-0000-0000-0000-000000000090',2,'Fictional draft','2026-12-31','2028-01-01',NULL,false,NULL,'71000000-0000-0000-0000-000000000006');
DO $$ BEGIN
 IF private.ihr_leave_calendar_timezone('73000000-0000-0000-0000-000000000090') IS DISTINCT FROM 'Pacific/Kiritimati' THEN RAISE EXCEPTION 'Lineage erased by draft'; END IF;
 BEGIN PERFORM private.ihr_leave_annual_eligibility('71000000-0000-0000-0000-000000000001','2026-12-31 23:30:00+00');RAISE EXCEPTION 'Draft prepared';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
END $$;
SET LOCAL ROLE anon;
SELECT pg_temp.assert_denied($s$SELECT public.leave_prepare_self_v1()$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_balance_history_v1('78000000-0000-0000-0000-000000000099')$s$,'42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(public.leave_context_v1()->'currentPeriod'->>'year'=extract(year FROM clock_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::integer::text,'server derives current local year');
DO $$ DECLARE tab text;BEGIN
 FOREACH tab IN ARRAY ARRAY['public.ihr_leave_accounts','public.ihr_leave_ledger'] LOOP
  PERFORM pg_temp.assert_denied('SELECT * FROM '||tab,'42501');PERFORM pg_temp.assert_denied('INSERT INTO '||tab||' DEFAULT VALUES','42501');
  PERFORM pg_temp.assert_denied('UPDATE '||tab||' SET id=id','42501');PERFORM pg_temp.assert_denied('DELETE FROM '||tab,'42501');PERFORM pg_temp.assert_denied('TRUNCATE '||tab,'42501');
 END LOOP;
 PERFORM pg_temp.assert_denied($s$SELECT private.ihr_leave_prepare_account('71000000-0000-0000-0000-000000000001',clock_timestamp())$s$,'42501');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname LIKE 'ihr_%' AND has_function_privilege(current_user,p.oid,'EXECUTE')),'all private helpers remain closed');
END $$;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_prepare_self_v1()$s$,'55000');
SELECT pg_temp.assert_true(public.leave_context_v1()->'currentPeriod'='null'::jsonb AND public.leave_context_v1()->'balances'='[]'::jsonb,'director has no personal period or balances');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000007',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_prepare_self_v1()$s$,'42501');
RESET ROLE;
ROLLBACK;
\ir accounts-commands.sql
\echo IHR_ACCOUNTS_PERMISSIONS_AND_RECONCILIATION_PASSED
