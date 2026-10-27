-- Owner-only fictional fixture for coordinator's reviewed local PG17 race harness.
-- Not included by single-session requests.sql. Apply once to its dedicated disposable snapshot.
BEGIN;
\ir quote-seed.sql
CREATE SCHEMA ihr_request_race_fixture;
REVOKE ALL ON SCHEMA ihr_request_race_fixture FROM PUBLIC,anon,authenticated;
CREATE TABLE ihr_request_race_fixture.cases (
 scenario text PRIMARY KEY,actor_id uuid NOT NULL,command_a uuid NOT NULL,command_b uuid NOT NULL,payload_a jsonb NOT NULL,payload_b jsonb NOT NULL
);
-- Exactly 450 minutes remain for fictional employee 1. Two distinct 450-minute days race.
INSERT INTO public.ihr_leave_ledger(account_id,effective_date,kind,allowance_delta,source_kind,source_id,source_event,actor_id,reason)
SELECT id,period_start,'adjustment',-4950,'fixture','80000000-0000-0000-0000-000000000500','last_allowance','71000000-0000-0000-0000-000000000010','Fictional race balance only'
FROM public.ihr_leave_accounts WHERE employee_id='71000000-0000-0000-0000-000000000001' AND year=extract(year FROM statement_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::integer;
INSERT INTO ihr_request_race_fixture.cases
SELECT scenario,actor_id,command_a,command_b,
 jsonb_build_object('input',input_a,'quote_fingerprint',private.ihr_leave_quote_v1(actor_id,input_a,clock_timestamp())->>'fingerprint'),
 jsonb_build_object('input',input_b,'quote_fingerprint',private.ihr_leave_quote_v1(actor_id,input_b,clock_timestamp())->>'fingerprint')
FROM (VALUES
 ('last_allowance','71000000-0000-0000-0000-000000000001'::uuid,'80000000-0000-0000-0000-000000000501'::uuid,'80000000-0000-0000-0000-000000000502'::uuid,pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()),pg_temp.quote_input(pg_temp.quote_friday()+3,pg_temp.quote_friday()+3)),
 ('same_date','71000000-0000-0000-0000-000000000002'::uuid,'80000000-0000-0000-0000-000000000511'::uuid,'80000000-0000-0000-0000-000000000512'::uuid,pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()),pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday())),
 ('same_key','71000000-0000-0000-0000-000000000008'::uuid,'80000000-0000-0000-0000-000000000521'::uuid,'80000000-0000-0000-0000-000000000521'::uuid,pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()),pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()))
) v(scenario,actor_id,command_a,command_b,input_a,input_b);
COMMIT;
