-- Shared exact preflight predicate, also exercised by the rollback-only role proof.
CREATE OR REPLACE FUNCTION pg_temp.employee_unsafe_app_owner(app_role oid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT rolsuper OR pg_has_role(oid,'postgres','USAGE')
   OR pg_has_role(oid,'postgres','MEMBER')
   FROM pg_roles WHERE oid=app_role),true)
$$;
