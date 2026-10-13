-- Standalone recipe for the already verified owned-local pilot_test setup session.
-- Temporary fictional objects only; no membership, entitlement or access bootstrap.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'pilot_test' OR current_user <> 'postgres' OR
    (SELECT count(*) FROM public.pilot_fixture_marker) <> 1 OR NOT EXISTS (
      SELECT 1 FROM public.pilot_fixture_marker WHERE purpose = 'disposable-pilot-ci'
    ) THEN RAISE EXCEPTION 'Verified disposable pilot_test fixture required'; END IF;
END;
$$;
\ir helpers.sql
CREATE TEMP TABLE ihr_helper_smoke(secret integer);
INSERT INTO ihr_helper_smoke VALUES (225);
REVOKE ALL ON TABLE ihr_helper_smoke FROM PUBLIC, anon, authenticated;

-- Owner calculation checks are separate from application-role permission proof.
DO $$
BEGIN
  IF (SELECT secret FROM ihr_helper_smoke) <> 225 THEN RAISE EXCEPTION 'Owner calculation setup failed'; END IF;
  BEGIN
    PERFORM pg_temp.assert_true(true, 'Owner must be refused');
    RAISE EXCEPTION 'Owner assertion unexpectedly passed';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'iHR assertions require an actual non-bypass application role session' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM pg_temp.assert_denied('SELECT 1', '42501');
    RAISE EXCEPTION 'Owner denial assertion unexpectedly passed';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'iHR assertions require an actual non-bypass application role session' THEN RAISE; END IF;
  END;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(current_user = 'authenticated', 'Must use actual authenticated role');
SELECT pg_temp.assert_denied('SELECT secret FROM pg_temp.ihr_helper_smoke', '42501');
SELECT pg_temp.assert_denied('INSERT INTO pg_temp.ihr_helper_smoke VALUES (450)', '42501');
SELECT pg_temp.assert_denied('SELECT pg_temp.assert_true(false, ''False must fail'')', 'P0001');
SELECT pg_temp.assert_denied('SELECT pg_temp.assert_true(NULL, ''NULL must fail'')', 'P0001');
DO $$
BEGIN
  BEGIN
    PERFORM pg_temp.assert_denied('SELECT 1', '42501');
    RAISE EXCEPTION 'Allowed statement incorrectly counted as denied';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'iHR expected denial did not occur' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM pg_temp.assert_denied('SELECT secret FROM pg_temp.ihr_helper_smoke', '55000');
    RAISE EXCEPTION 'Wrong SQLSTATE incorrectly counted as denied';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'iHR denial SQLSTATE mismatch: expected 55000, received 42501' THEN RAISE; END IF;
  END;
END;
$$;
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.assert_true(current_user = 'anon', 'Must use actual anon role');
SELECT pg_temp.assert_denied('SELECT secret FROM pg_temp.ihr_helper_smoke', '42501');
RESET ROLE;
ROLLBACK;
\echo IHR_HELPER_SMOKE_PASSED
