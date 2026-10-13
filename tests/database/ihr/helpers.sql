-- Load in the same psql session as a synthetic suite. Never install persistent test helpers.
-- Call assertions after SET LOCAL ROLE anon/authenticated and the synthetic JWT claim.
CREATE OR REPLACE FUNCTION pg_temp.assert_true(actual boolean, message text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'iHR assertions require an actual non-bypass application role session';
  END IF;
  IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'iHR assertion failed: %', message; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_denied(statement text, expected_sqlstate text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actual_sqlstate text;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'iHR assertions require an actual non-bypass application role session';
  END IF;
  IF expected_sqlstate IS NULL OR expected_sqlstate !~ '^[0-9A-Z]{5}$' OR expected_sqlstate = '00000' THEN
    RAISE EXCEPTION 'iHR denial assertion requires an expected failure SQLSTATE';
  END IF;
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_sqlstate = RETURNED_SQLSTATE;
  END;
  IF actual_sqlstate IS NULL THEN RAISE EXCEPTION 'iHR expected denial did not occur'; END IF;
  IF actual_sqlstate <> expected_sqlstate THEN
    RAISE EXCEPTION 'iHR denial SQLSTATE mismatch: expected %, received %', expected_sqlstate, actual_sqlstate;
  END IF;
END;
$$;

-- The schema alias is accepted for function resolution, not GRANT ON SCHEMA.
DO $grants$
DECLARE temporary_schema text;
BEGIN
  SELECT nspname INTO STRICT temporary_schema FROM pg_catalog.pg_namespace
    WHERE oid = pg_catalog.pg_my_temp_schema();
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon, authenticated', temporary_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.assert_true(boolean, text), %I.assert_denied(text, text) FROM PUBLIC',
    temporary_schema, temporary_schema);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.assert_true(boolean, text), %I.assert_denied(text, text) TO anon, authenticated',
    temporary_schema, temporary_schema);
END;
$grants$;
