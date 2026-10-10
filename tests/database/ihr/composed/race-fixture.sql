-- FICTIONAL ONLY. One fresh, guarded post-1007 database snapshot per selected race.
-- Owner setup supplies exact explicit governance; application calls use authenticated sessions.
BEGIN;
SELECT set_config('request.jwt.claim.sub','',true);
\ir quote-seed.sql
INSERT INTO public.ihr_leave_access_grants(id,actor_id,capability,scope_kind,effective_from,granted_by,reason)
VALUES('87000000-0000-0000-0000-000000000090','71000000-0000-0000-0000-000000000009','configure','all_policy_members','2020-01-01','71000000-0000-0000-0000-000000000006','Fictional global calendar race administrator');
\ir race-governance-seed.sql
CREATE SCHEMA ihr_final_race_fixture;
REVOKE ALL ON SCHEMA ihr_final_race_fixture FROM PUBLIC,anon,authenticated;
CREATE TABLE ihr_final_race_fixture.inputs(name text PRIMARY KEY,actor uuid NOT NULL,input jsonb NOT NULL);
INSERT INTO ihr_final_race_fixture.inputs VALUES
 ('employee1','71000000-0000-0000-0000-000000000001',pg_temp.quote_input(pg_temp.quote_friday()+7,pg_temp.quote_friday()+7)),
 ('employee2','71000000-0000-0000-0000-000000000002',pg_temp.quote_input(pg_temp.quote_friday()+7,pg_temp.quote_friday()+7)),
 ('saturday','71000000-0000-0000-0000-000000000001',pg_temp.quote_input(pg_temp.quote_friday()+14,pg_temp.quote_friday()+15));
CREATE TABLE ihr_final_race_fixture.settings AS SELECT
 (clock_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::date AS as_of,
 pg_temp.quote_friday()+7 AS friday,pg_temp.quote_friday()+15 AS saturday,
 extract(year FROM clock_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::integer AS year;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM ihr_final_race_fixture.settings WHERE extract(year FROM saturday)::integer<>year) THEN
  RAISE EXCEPTION 'Race fixture would cross annual period; prepare a separately reviewed date pin';
 END IF;
END $$;
COMMIT;
