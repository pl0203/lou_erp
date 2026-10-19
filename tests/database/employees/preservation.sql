-- Rollback-only, synthetic legacy rows plus real HR commands. No live data capture.
\ir snapshot.sql
-- The employee_ prefix is NOT an exclusion. Only the exact owned topology is.
CREATE TABLE private.employee_preservation_probe(id integer, value text DEFAULT 'initial');
INSERT INTO private.employee_preservation_probe VALUES(1,'one'),(1,'one');
CREATE FUNCTION private.employee_preservation_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER preservation_probe BEFORE UPDATE ON private.employee_preservation_probe FOR EACH ROW EXECUTE FUNCTION private.employee_preservation_trigger();
CREATE POLICY preservation_probe ON private.employee_preservation_probe TO authenticated USING (id=1);
CREATE TEMP TABLE snapshot_probe AS SELECT pg_temp.employee_legacy_snapshot() value;
DO $$ BEGIN IF (SELECT value->'rows' ? 'private.employee_preservation_probe' FROM snapshot_probe) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Legacy snapshot must include unrelated employee-prefix rows'; END IF; END $$;
SAVEPOINT row_probe;
UPDATE private.employee_preservation_probe SET value='changed';
DO $$ BEGIN IF (SELECT value=pg_temp.employee_legacy_snapshot() FROM snapshot_probe) THEN RAISE EXCEPTION 'Row mutation escaped preservation fingerprint'; END IF; END $$;
ROLLBACK TO row_probe;
SAVEPOINT trigger_probe;
ALTER TABLE private.employee_preservation_probe DISABLE TRIGGER preservation_probe;
DO $$ BEGIN IF (SELECT value=pg_temp.employee_legacy_snapshot() FROM snapshot_probe) THEN RAISE EXCEPTION 'Trigger enabled state escaped preservation fingerprint'; END IF; END $$;
ROLLBACK TO trigger_probe;
SAVEPOINT policy_probe;
ALTER POLICY preservation_probe ON private.employee_preservation_probe USING (false);
DO $$ BEGIN IF (SELECT value=pg_temp.employee_legacy_snapshot() FROM snapshot_probe) THEN RAISE EXCEPTION 'Policy mutation escaped preservation fingerprint'; END IF; END $$;
ROLLBACK TO policy_probe;
SAVEPOINT column_probe;
GRANT SELECT(value) ON private.employee_preservation_probe TO authenticated;
DO $$ BEGIN IF (SELECT value=pg_temp.employee_legacy_snapshot() FROM snapshot_probe) THEN RAISE EXCEPTION 'Column grant escaped preservation fingerprint'; END IF; END $$;
ROLLBACK TO column_probe;
SAVEPOINT structure_probe;
ALTER TABLE private.employee_preservation_probe ALTER COLUMN value SET DEFAULT 'changed';
DO $$ BEGIN IF (SELECT value=pg_temp.employee_legacy_snapshot() FROM snapshot_probe) THEN RAISE EXCEPTION 'Column definition escaped preservation fingerprint'; END IF; END $$;
ROLLBACK TO structure_probe;
DROP TABLE private.employee_preservation_probe;
DROP FUNCTION private.employee_preservation_trigger();
\ir ../ihr/quote-seed.sql
\ir ../ihr/admin-governance-seed.sql
-- Inactive linked account, operational manager and all six roles remain legacy data.
UPDATE public.users SET manager_id='71000000-0000-0000-0000-000000000003' WHERE id IN('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000007');
UPDATE public.users SET role='co_admin' WHERE id='71000000-0000-0000-0000-000000000013';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT jsonb_build_object('input',pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()),'quote_fingerprint',public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()))->>'fingerprint') request_payload \gset
SELECT public.leave_transaction_v1('96000000-0000-0000-0000-000000000001','submit_request',:'request_payload');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
\ir fixture-users.sql
CREATE TEMP TABLE legacy_before AS SELECT pg_temp.employee_legacy_snapshot() value;
UPDATE private.employee_settings SET timezone='UTC',version=version+1;
\ir retained-fixture.sql
DO $$ BEGIN IF (SELECT value IS DISTINCT FROM pg_temp.employee_legacy_snapshot() FROM legacy_before) THEN RAISE EXCEPTION 'HR commands changed legacy rows, ownership, privileges or structure'; END IF; END $$;
-- Explicit named nonempty histories: not merely equality of empty tables.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ihr_leave_requests WHERE status='submitted') OR NOT EXISTS(SELECT 1 FROM public.ihr_leave_request_days)
 OR NOT EXISTS(SELECT 1 FROM public.ihr_leave_request_allocations) OR NOT EXISTS(SELECT 1 FROM public.ihr_leave_ledger)
 OR NOT EXISTS(SELECT 1 FROM public.ihr_leave_accounts WHERE year=extract(year FROM current_date)) THEN RAISE EXCEPTION 'Representative legacy snapshots missing'; END IF;
END $$;
\echo EMPLOYEE_LEGACY_CATALOG_AND_ROWS_PRESERVED
