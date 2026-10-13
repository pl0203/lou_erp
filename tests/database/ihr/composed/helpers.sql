-- Temporary final-schema assertion only. Always called as actual non-bypass application roles.
CREATE OR REPLACE FUNCTION pg_temp.assert_controlled_denied(statement text,expected_state text,expected_code text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actual_state text;detail text;actual_code text;
BEGIN
 PERFORM pg_temp.assert_true(true,'controlled-error assertion uses actual non-bypass role');
 BEGIN EXECUTE statement;EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual_state=RETURNED_SQLSTATE,detail=PG_EXCEPTION_DETAIL;END;
 IF detail IS NOT NULL AND detail<>'' THEN actual_code:=detail::jsonb->>'code';END IF;
 PERFORM pg_temp.assert_true(actual_state=expected_state AND actual_code=expected_code,'exact controlled error code and SQLSTATE');
END;
$$;
DO $$ DECLARE ns text;BEGIN
 SELECT nspname INTO STRICT ns FROM pg_catalog.pg_namespace WHERE oid=pg_catalog.pg_my_temp_schema();
 EXECUTE format('REVOKE ALL ON FUNCTION %I.assert_controlled_denied(text,text,text) FROM PUBLIC',ns);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %I.assert_controlled_denied(text,text,text) TO anon,authenticated',ns);
END $$;
