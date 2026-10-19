-- Retained HR equality only. No row output or destructive recovery.
CREATE OR REPLACE FUNCTION pg_temp.employee_retained_data() RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE t text; result jsonb:='{}'; v jsonb; BEGIN
 FOREACH t IN ARRAY pg_temp.employee_tables() LOOP
 EXECUTE format('SELECT jsonb_build_object(''count'',count(*),''sha256'',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(r)::text,E''\\n'' ORDER BY to_jsonb(r)::text COLLATE "C"),''''),''UTF8'')),''hex'')) FROM %s r',t) INTO v;
 result:=result||jsonb_build_object(t,v); END LOOP; RETURN result;
END $$;
