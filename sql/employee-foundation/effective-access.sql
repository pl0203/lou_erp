-- Exact shared effective-permission assertions; never repairs a role or grant.
-- PostgreSQL 17 SET includes transitively reachable roles, even without INHERIT.
-- PUBLIC is a pseudo-role and must never be passed to pg_has_role.
CREATE OR REPLACE FUNCTION pg_temp.employee_effective_roles(app_role name)
RETURNS name[] LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE roles name[];
BEGIN
 IF app_role='public' THEN RETURN ARRAY['public']::name[]; END IF;
 IF app_role IS NULL OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=app_role)
 THEN RAISE EXCEPTION 'EMPLOYEE_UNKNOWN_EFFECTIVE_ROLE'; END IF;
 SELECT array_agg(rolname ORDER BY rolname COLLATE "C") INTO roles FROM pg_roles
 WHERE rolname=app_role OR pg_has_role(app_role,oid,'SET');
 RETURN roles;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.employee_unsafe_table_access(app_role name)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT app_role IS NULL OR EXISTS(SELECT 1 FROM unnest(pg_temp.employee_tables()) t
  CROSS JOIN unnest(pg_temp.employee_effective_roles(app_role)) effective_role
  WHERE to_regclass(t) IS NULL
   OR has_table_privilege(effective_role,to_regclass(t),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') IS DISTINCT FROM false
   OR has_any_column_privilege(effective_role,to_regclass(t),'SELECT,INSERT,UPDATE,REFERENCES') IS DISTINCT FROM false)
$$;
-- Exact current-role grant is required only for authenticated's active entrypoints.
-- Switching to a narrower role is harmless; widening a denied surface is not.
CREATE OR REPLACE FUNCTION pg_temp.employee_function_access_safe(app_role name,effective_role name,mode text,is_entrypoint boolean,can_execute boolean)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(app_role IN('public','anon','authenticated','service_role')
  AND effective_role IS NOT NULL AND mode IN('active','disabled')
  AND is_entrypoint IS NOT NULL AND can_execute IS NOT NULL
  AND CASE WHEN is_entrypoint AND mode='active' AND app_role='authenticated'
   THEN effective_role<>app_role OR can_execute
   ELSE NOT can_execute END,false)
$$;
CREATE OR REPLACE FUNCTION pg_temp.employee_assert_effective(mode text)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE r name; effective_role name; f text;
BEGIN
 IF mode NOT IN('active','disabled') OR mode IS NULL THEN RAISE EXCEPTION 'EMPLOYEE_INVALID_EFFECTIVE_MODE'; END IF;
 FOREACH r IN ARRAY ARRAY['public','anon','authenticated','service_role']::name[] LOOP
  IF pg_temp.employee_unsafe_table_access(r) THEN RAISE EXCEPTION 'EMPLOYEE_UNSAFE_EFFECTIVE_TABLE_ACCESS'; END IF;
  FOREACH effective_role IN ARRAY pg_temp.employee_effective_roles(r) LOOP
   FOREACH f IN ARRAY pg_temp.employee_helpers() LOOP
    IF to_regprocedure(f) IS NULL OR NOT pg_temp.employee_function_access_safe(r,effective_role,mode,false,has_function_privilege(effective_role,to_regprocedure(f),'EXECUTE'))
    THEN RAISE EXCEPTION 'EMPLOYEE_UNSAFE_EFFECTIVE_HELPER_ACCESS'; END IF;
   END LOOP;
   FOREACH f IN ARRAY pg_temp.employee_entrypoints() LOOP
    IF to_regprocedure(f) IS NULL OR NOT pg_temp.employee_function_access_safe(r,effective_role,mode,true,has_function_privilege(effective_role,to_regprocedure(f),'EXECUTE'))
    THEN RAISE EXCEPTION 'EMPLOYEE_UNSAFE_EFFECTIVE_ENTRYPOINT_ACCESS'; END IF;
   END LOOP;
  END LOOP;
 END LOOP;
END $$;
