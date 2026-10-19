-- Complete synthetic-only snapshots. Never use this fixture tool on real auth data.
SET LOCAL timezone='UTC';
SET LOCAL datestyle='ISO, YMD';
SET LOCAL intervalstyle='iso_8601';
SET LOCAL extra_float_digits=3;
\ir ../../../sql/employee-foundation/topology.sql
\ir ../../../sql/employee-foundation/catalog.sql
CREATE OR REPLACE FUNCTION pg_temp.employee_legacy_snapshot() RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE t record; rows jsonb:='{}'; v jsonb; BEGIN
 FOR t IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN('public','private','auth','storage') AND c.relkind IN('r','p')
 AND NOT pg_temp.employee_owned_object('pg_class'::regclass,c.oid)
 ORDER BY 1,2 LOOP
  EXECUTE format('SELECT jsonb_build_object(''count'',count(*),''sha256'',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(r)::text, E''\\n'' ORDER BY to_jsonb(r)::text COLLATE "C"),''''),''UTF8'')),''hex'')) FROM %I.%I r',t.nspname,t.relname) INTO v;
  rows:=rows||jsonb_build_object(t.nspname||'.'||t.relname,v);
 END LOOP;
 RETURN jsonb_build_object('rows',rows,'catalog',pg_temp.employee_catalog(false),'serialization',jsonb_build_array(current_setting('TimeZone'),current_setting('DateStyle'),current_setting('IntervalStyle'),current_setting('extra_float_digits')));
END $$;
\ir ../../../sql/employee-foundation/retained.sql
