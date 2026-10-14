-- BEGIN AUTHORITY PREAMBLE: integrate before either master receives new columns.
-- This fragment has no transaction boundary. Its caller must apply the preamble,
-- foundation schema/guards and post-column authority together in one transaction.
-- Preserve observed privileges, including inherited paths, rather than replacing
-- them with a form-field allowlist. The checked metadata manifest is documentary;
-- this locked same-session snapshot is the effective runtime conversion contract.
LOCK TABLE public.customers, public.products IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE catalog_legacy_columns_v1 ON COMMIT DROP AS
SELECT c.oid AS relation_oid, c.relowner AS owner_oid,
  pg_catalog.format('%I.%I', n.nspname, c.relname) AS relation_name,
  a.attnum, a.attname AS column_name
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE n.nspname = 'public' AND c.relname IN ('customers', 'products');
CREATE TEMP TABLE catalog_legacy_column_privileges_v1 ON COMMIT DROP AS
SELECT r.oid AS principal_oid, r.rolname AS principal, c.relation_oid,
  c.relation_name, c.attnum, c.column_name, p.privilege,
  pg_catalog.has_column_privilege(r.oid, c.relation_oid, c.attnum, p.privilege) AS allowed
FROM pg_catalog.pg_roles r CROSS JOIN pg_temp.catalog_legacy_columns_v1 c
CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('SELECT'), ('REFERENCES'),
  ('INSERT WITH GRANT OPTION'), ('UPDATE WITH GRANT OPTION'),
  ('SELECT WITH GRANT OPTION'), ('REFERENCES WITH GRANT OPTION')) p(privilege);
CREATE TEMP TABLE catalog_legacy_other_table_privileges_v1 ON COMMIT DROP AS
SELECT r.oid AS principal_oid, c.relation_oid, p.privilege,
  pg_catalog.has_table_privilege(r.oid, c.relation_oid, p.privilege) AS allowed
FROM pg_catalog.pg_roles r CROSS JOIN (
  SELECT DISTINCT relation_oid FROM pg_temp.catalog_legacy_columns_v1
) c CROSS JOIN (VALUES ('SELECT'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN'),
  ('SELECT WITH GRANT OPTION'), ('DELETE WITH GRANT OPTION'), ('TRUNCATE WITH GRANT OPTION'),
  ('REFERENCES WITH GRANT OPTION'), ('TRIGGER WITH GRANT OPTION'), ('MAINTAIN WITH GRANT OPTION')) p(privilege);
CREATE TEMP TABLE catalog_legacy_memberships_v1 ON COMMIT DROP AS
SELECT to_jsonb(m) AS metadata FROM pg_catalog.pg_auth_members m;
CREATE TEMP TABLE catalog_legacy_master_policies_v1 ON COMMIT DROP AS
SELECT p.oid, to_jsonb(p) AS metadata FROM pg_catalog.pg_policy p
WHERE p.polrelid IN (SELECT DISTINCT relation_oid FROM pg_temp.catalog_legacy_columns_v1);
CREATE TEMP TABLE catalog_legacy_table_acl_v1 ON COMMIT DROP AS
SELECT c.oid AS relation_oid, c.relowner AS owner_oid, a.grantor,
  a.grantee, a.privilege_type, a.is_grantable
FROM pg_catalog.pg_class c
CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
WHERE c.oid IN (SELECT DISTINCT relation_oid FROM pg_temp.catalog_legacy_columns_v1);
-- Save both sources before REVOKE: PostgreSQL table privilege revocation also
-- removes corresponding column grants for that grantee. Replaying only the table
-- edges would silently discard a stronger pre-existing column grant option.
CREATE TEMP TABLE catalog_legacy_write_acl_v1 ON COMMIT DROP AS
SELECT c.relation_oid, c.owner_oid, c.relation_name, c.attnum, c.column_name,
  a.grantor, a.grantee, a.privilege_type, bool_or(a.is_grantable) AS is_grantable
FROM pg_temp.catalog_legacy_columns_v1 c
JOIN (
  SELECT t.relation_oid, NULL::smallint AS attnum, t.grantor, t.grantee, t.privilege_type, t.is_grantable
  FROM pg_temp.catalog_legacy_table_acl_v1 t WHERE t.privilege_type IN ('INSERT', 'UPDATE')
  UNION ALL
  SELECT p.attrelid, p.attnum, a.grantor, a.grantee, a.privilege_type, a.is_grantable
  FROM pg_catalog.pg_attribute p
  CROSS JOIN LATERAL pg_catalog.aclexplode(p.attacl) a
  WHERE p.attrelid IN (SELECT DISTINCT relation_oid FROM pg_temp.catalog_legacy_columns_v1)
    AND p.attnum > 0 AND NOT p.attisdropped AND a.privilege_type IN ('INSERT', 'UPDATE')
) a ON a.relation_oid = c.relation_oid AND (a.attnum IS NULL OR a.attnum = c.attnum)
WHERE a.grantee <> c.owner_oid
GROUP BY c.relation_oid, c.owner_oid, c.relation_name, c.attnum, c.column_name,
  a.grantor, a.grantee, a.privilege_type;

DO $catalog_authority_preflight$
BEGIN
  IF (SELECT count(DISTINCT relation_oid) FROM pg_temp.catalog_legacy_columns_v1) <> 2
    OR EXISTS (SELECT 1 FROM pg_temp.catalog_legacy_columns_v1
      WHERE column_name IN ('is_enabled', 'catalog_version')) THEN
    RAISE EXCEPTION 'CATALOG_LEGACY_COLUMN_PRIVILEGE_DRIFT: preamble must precede both server-owned columns';
  END IF;
  -- The reviewed synthetic source ACLs contain owner-issued grants only.
  -- Preserve arbitrary grantees, PUBLIC, grant options and inherited membership;
  -- fail before mutation on an unreviewed delegated grantor graph. Never CASCADE
  -- away downstream grants or flatten inheritance into direct authenticated ACLs.
  IF EXISTS (SELECT 1 FROM pg_temp.catalog_legacy_write_acl_v1 WHERE grantor <> owner_oid)
    OR EXISTS (SELECT 1 FROM pg_temp.catalog_legacy_table_acl_v1
      WHERE privilege_type IN ('INSERT', 'UPDATE') AND grantor <> owner_oid) THEN
    RAISE EXCEPTION 'CATALOG_LEGACY_ACL_TOPOLOGY_UNSUPPORTED: delegated grantor requires separate review';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid IN (SELECT DISTINCT relation_oid FROM pg_temp.catalog_legacy_columns_v1)
      AND NOT c.relrowsecurity) THEN
    RAISE EXCEPTION 'CATALOG_LEGACY_COLUMN_PRIVILEGE_DRIFT: master RLS must be enabled';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) <> 3
    OR pg_catalog.has_table_privilege('authenticated', 'public.customers', 'DELETE') THEN
    RAISE EXCEPTION 'CATALOG_LEGACY_COLUMN_PRIVILEGE_DRIFT: required client roles or customer delete boundary';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_policy p
    WHERE (p.polrelid, p.polname, p.polcmd) IN (
      ('public.customers'::regclass, 'co_customer_no_insert_v1', 'a'),
      ('public.customers'::regclass, 'co_customer_no_update_v1', 'w'),
      ('public.products'::regclass, 'co_product_no_insert_v1', 'a'),
      ('public.products'::regclass, 'co_product_no_update_v1', 'w'))
      AND NOT p.polpermissive AND p.polroles = ARRAY['authenticated'::regrole::oid]) <> 4 THEN
    RAISE EXCEPTION 'CATALOG_LEGACY_COLUMN_PRIVILEGE_DRIFT: expected four restrictive CO write denials';
  END IF;
END $catalog_authority_preflight$;
-- END AUTHORITY PREAMBLE.


-- First foundation slice only. Apply inside the reviewed transaction harness.
-- Tracking stays unavailable; this is not a complete rollout or a cutover.
-- Lifetime evidence is server-owned and survives master deletion/recreation.

ALTER TABLE public.customers
  ADD COLUMN is_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN catalog_version bigint NOT NULL DEFAULT 1 CHECK (catalog_version > 0);
ALTER TABLE public.products
  ADD COLUMN is_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN catalog_version bigint NOT NULL DEFAULT 1 CHECK (catalog_version > 0);

CREATE TABLE private.catalog_cutover_v1 (
  singleton boolean PRIMARY KEY CHECK (singleton),
  execution_generation smallint NOT NULL CHECK (execution_generation IN (1, 2)),
  tracking_ready boolean NOT NULL,
  CONSTRAINT catalog_foundation_generation_one CHECK (execution_generation = 1),
  CONSTRAINT catalog_foundation_not_ready CHECK (NOT tracking_ready)
);
INSERT INTO private.catalog_cutover_v1(singleton, execution_generation, tracking_ready)
VALUES (true, 1, false);
ALTER TABLE private.catalog_cutover_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.catalog_cutover_v1 FROM PUBLIC, anon, authenticated;

CREATE TABLE private.catalog_identity_v1 (
  kind text NOT NULL CHECK (kind IN ('customer', 'product')),
  id uuid NOT NULL,
  lifetime_state text NOT NULL CHECK (lifetime_state IN ('unknown', 'unused', 'used')),
  last_version bigint NOT NULL CHECK (last_version > 0),
  deleted_at timestamptz,
  PRIMARY KEY (kind, id)
);
ALTER TABLE private.catalog_identity_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.catalog_identity_v1 FROM PUBLIC, anon, authenticated;

INSERT INTO private.catalog_identity_v1(kind, id, lifetime_state, last_version, deleted_at)
SELECT 'customer', id, 'unknown', catalog_version, NULL FROM public.customers
UNION ALL
SELECT 'product', id, 'unknown', catalog_version, NULL FROM public.products;

CREATE FUNCTION private.catalog_identity_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Catalogue identity evidence is retained' USING ERRCODE = '23514', DETAIL = 'CATALOG_IDENTITY_CONFLICT';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifetime_state = 'unused' THEN
      RAISE EXCEPTION 'Catalogue tracking is incomplete' USING ERRCODE = '23514', DETAIL = 'CATALOG_TRACKING_INCOMPLETE';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.last_version < OLD.last_version
     OR (OLD.lifetime_state = 'used' AND NEW.lifetime_state <> 'used')
     OR (OLD.lifetime_state = 'unknown' AND NEW.lifetime_state NOT IN ('unknown', 'used'))
     OR (OLD.lifetime_state = 'unused' AND NEW.lifetime_state NOT IN ('unused', 'used'))
     OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
    RAISE EXCEPTION 'Catalogue identity evidence cannot regress' USING ERRCODE = '23514', DETAIL = 'CATALOG_IDENTITY_CONFLICT';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.catalog_identity_guard_v1() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER catalog_identity_guard_v1 BEFORE INSERT OR UPDATE OR DELETE ON private.catalog_identity_v1
FOR EACH ROW EXECUTE FUNCTION private.catalog_identity_guard_v1();
CREATE TRIGGER catalog_identity_no_truncate_v1 BEFORE TRUNCATE ON private.catalog_identity_v1
FOR EACH STATEMENT EXECUTE FUNCTION private.catalog_identity_guard_v1();

CREATE FUNCTION private.catalog_master_before_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  identity_kind text;
  prior_version bigint;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME NOT IN ('customers', 'products') THEN
    RAISE EXCEPTION 'Unexpected catalogue master' USING ERRCODE = '23514';
  END IF;
  identity_kind := CASE TG_TABLE_NAME WHEN 'customers' THEN 'customer' ELSE 'product' END;
  IF TG_OP = 'INSERT' THEN
    -- A discarded INSERT attempt must not lock or write lifetime evidence.
    LOCK TABLE private.catalog_identity_v1 IN ACCESS SHARE MODE NOWAIT;
    SELECT last_version INTO prior_version FROM private.catalog_identity_v1
      WHERE kind = identity_kind AND id = NEW.id;
    IF FOUND THEN
      IF prior_version = 9223372036854775807 THEN
        -- Leave discarded conflicts untouched; an actual insertion fails below.
        NEW.catalog_version := prior_version;
      ELSE
        NEW.catalog_version := prior_version + 1;
      END IF;
    ELSE
      NEW.catalog_version := 1;
    END IF;
    NEW.is_enabled := true;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Catalogue identity cannot be reassigned' USING ERRCODE = '23514', DETAIL = 'CATALOG_IDENTITY_CONFLICT';
  END IF;
  IF (to_jsonb(NEW) - 'catalog_version') IS DISTINCT FROM (to_jsonb(OLD) - 'catalog_version') THEN
    IF OLD.catalog_version = 9223372036854775807 THEN
      RAISE EXCEPTION 'Catalogue version exhausted' USING ERRCODE = '22003', DETAIL = 'CATALOG_VERSION_CONFLICT';
    END IF;
    NEW.catalog_version := OLD.catalog_version + 1;
  ELSE
    NEW.catalog_version := OLD.catalog_version;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.catalog_master_before_v1() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.catalog_master_after_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  identity_kind text;
  identity_id uuid;
  prior private.catalog_identity_v1%ROWTYPE;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME NOT IN ('customers', 'products') THEN
    RAISE EXCEPTION 'Unexpected catalogue master' USING ERRCODE = '23514';
  END IF;
  identity_kind := CASE TG_TABLE_NAME WHEN 'customers' THEN 'customer' ELSE 'product' END;
  identity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  -- The real master row event has completed its existing row/FK work. Never
  -- reserve or mutate evidence in BEFORE INSERT: ON CONFLICT may discard it.
  -- Both present and absent identities share a try-only reservation. Hash
  -- collisions cause a safe retryable refusal, never an identity equivalence.
  IF NOT pg_try_advisory_xact_lock(hashtextextended(
      'catalog_identity_v1:' || identity_kind || ':' || identity_id::text, 1801427913)) THEN
    RAISE EXCEPTION 'Catalogue identity is busy' USING ERRCODE = '55P03', DETAIL = 'CATALOG_IDENTITY_BUSY';
  END IF;
  LOCK TABLE private.catalog_identity_v1 IN ROW EXCLUSIVE MODE NOWAIT;
  SELECT * INTO prior FROM private.catalog_identity_v1
    WHERE kind = identity_kind AND id = identity_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    IF TG_OP <> 'INSERT' THEN
      RAISE EXCEPTION 'Catalogue identity evidence missing' USING ERRCODE = '23514', DETAIL = 'CATALOG_TRACKING_INCOMPLETE';
    END IF;
    -- All foundation creation paths hold the same try-only reservation. There
    -- is no INSERT-conflict wait against another compliant evidence allocator.
    INSERT INTO private.catalog_identity_v1(kind, id, lifetime_state, last_version, deleted_at)
      VALUES (identity_kind, identity_id, 'unknown', NEW.catalog_version, NULL);
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF prior.last_version = 9223372036854775807 THEN
      RAISE EXCEPTION 'Catalogue version exhausted' USING ERRCODE = '22003', DETAIL = 'CATALOG_VERSION_CONFLICT';
    END IF;
    IF prior.last_version >= NEW.catalog_version THEN
      RAISE EXCEPTION 'Catalogue identity changed during insert' USING ERRCODE = '40001', DETAIL = 'CATALOG_VERSION_CONFLICT';
    END IF;
    UPDATE private.catalog_identity_v1 SET last_version = NEW.catalog_version
      WHERE kind = identity_kind AND id = identity_id;
    RETURN NEW;
  END IF;
  IF prior.last_version <> OLD.catalog_version THEN
    RAISE EXCEPTION 'Catalogue identity version drift' USING ERRCODE = '23514', DETAIL = 'CATALOG_IDENTITY_CONFLICT';
  END IF;
  IF TG_OP = 'DELETE' THEN
    UPDATE private.catalog_identity_v1 SET deleted_at = coalesce(deleted_at, statement_timestamp())
      WHERE kind = identity_kind AND id = identity_id;
    RETURN OLD;
  END IF;
  UPDATE private.catalog_identity_v1 SET last_version = NEW.catalog_version
    WHERE kind = identity_kind AND id = identity_id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.catalog_master_after_v1() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER catalog_master_before_v1 BEFORE INSERT OR UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION private.catalog_master_before_v1();
CREATE TRIGGER catalog_master_before_v1 BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION private.catalog_master_before_v1();
CREATE TRIGGER catalog_master_after_v1 AFTER INSERT OR UPDATE OR DELETE ON public.customers
FOR EACH ROW EXECUTE FUNCTION private.catalog_master_after_v1();
CREATE TRIGGER catalog_master_after_v1 AFTER INSERT OR UPDATE OR DELETE ON public.products
FOR EACH ROW EXECUTE FUNCTION private.catalog_master_after_v1();

-- A table-level purge would bypass row tombstones. It is not a master deletion
-- API, including for privileged callers; use ordinary guarded row events.
CREATE FUNCTION private.catalog_master_truncate_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Catalogue masters require retained row evidence'
    USING ERRCODE = '23514', DETAIL = 'CATALOG_IDENTITY_CONFLICT';
END $$;
REVOKE ALL ON FUNCTION private.catalog_master_truncate_v1() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER catalog_master_no_truncate_v1 BEFORE TRUNCATE ON public.customers
FOR EACH STATEMENT EXECUTE FUNCTION private.catalog_master_truncate_v1();
CREATE TRIGGER catalog_master_no_truncate_v1 BEFORE TRUNCATE ON public.products
FOR EACH STATEMENT EXECUTE FUNCTION private.catalog_master_truncate_v1();

-- BEGIN POST-COLUMN AUTHORITY: integrate after the new columns and master guards.
DO $catalog_convert_write_acl$
DECLARE entry record; recipient text; column_list text;
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_attribute a
    WHERE a.attrelid IN ('public.customers'::regclass, 'public.products'::regclass)
      AND a.attnum > 0 AND NOT a.attisdropped AND a.attname IN ('is_enabled', 'catalog_version')) <> 4 THEN
    RAISE EXCEPTION 'CATALOG_LEGACY_COLUMN_PRIVILEGE_DRIFT: both master server columns required';
  END IF;
  FOR entry IN SELECT a.*, c.relation_name FROM pg_temp.catalog_legacy_table_acl_v1 a
    JOIN (SELECT DISTINCT relation_oid, relation_name FROM pg_temp.catalog_legacy_columns_v1) c USING (relation_oid)
    WHERE a.privilege_type IN ('INSERT', 'UPDATE') AND a.grantee <> a.owner_oid
    ORDER BY a.relation_oid, a.grantee, a.privilege_type LOOP
    recipient := CASE WHEN entry.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(entry.grantee)) END;
    EXECUTE pg_catalog.format('REVOKE %s ON TABLE %s FROM %s RESTRICT', entry.privilege_type, entry.relation_name, recipient);
  END LOOP;
  FOR entry IN SELECT relation_name, grantee, privilege_type, is_grantable,
    string_agg(pg_catalog.quote_ident(column_name), ', ' ORDER BY attnum) AS columns
    FROM pg_temp.catalog_legacy_write_acl_v1
    GROUP BY relation_name, grantee, privilege_type, is_grantable
    ORDER BY relation_name, grantee, privilege_type, is_grantable LOOP
    recipient := CASE WHEN entry.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(entry.grantee)) END;
    column_list := entry.columns;
    EXECUTE pg_catalog.format('GRANT %s (%s) ON TABLE %s TO %s%s', entry.privilege_type,
      column_list, entry.relation_name, recipient, CASE WHEN entry.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
END $catalog_convert_write_acl$;

DROP POLICY co_customer_no_insert_v1 ON public.customers;
DROP POLICY co_customer_no_update_v1 ON public.customers;
DROP POLICY co_product_no_insert_v1 ON public.products;
DROP POLICY co_product_no_update_v1 ON public.products;
CREATE POLICY catalog_co_customer_insert_v1 ON public.customers AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND public.current_user_role() = 'co_admin');
CREATE POLICY catalog_co_customer_update_v1 ON public.customers AS PERMISSIVE FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND public.current_user_role() = 'co_admin')
  WITH CHECK (auth.uid() IS NOT NULL AND public.current_user_role() = 'co_admin');
CREATE POLICY catalog_co_product_insert_v1 ON public.products AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND public.current_user_role() = 'co_admin');
CREATE POLICY catalog_co_product_update_v1 ON public.products AS PERMISSIVE FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND public.current_user_role() = 'co_admin')
  WITH CHECK (auth.uid() IS NOT NULL AND public.current_user_role() = 'co_admin');

-- Replacing the existing signature retains its owner/ACL and its version-1 keys,
-- denial behavior, CO=false flags and transaction-stable function declaration.
-- Every current legacy column is required: this includes caller IDs, visit fields
-- and every schema-defined legacy field. Server-owned fields are the only exclusions.
CREATE OR REPLACE FUNCTION public.pilot_procurement_access_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE r public.user_role := public.current_user_role(); writable boolean;
  customer_create boolean; customer_edit boolean; product_create boolean; product_edit boolean;
BEGIN
  IF auth.uid() IS NULL OR r IS NULL OR r NOT IN ('po_admin', 'co_admin', 'executive') THEN
    RAISE EXCEPTION 'Procurement access denied' USING ERRCODE = '42501';
  END IF;
  writable := r IN ('po_admin', 'executive');
  SELECT coalesce(bool_and(has_column_privilege(current_user, a.attrelid, a.attnum, 'INSERT')), false),
    coalesce(bool_and(has_column_privilege(current_user, a.attrelid, a.attnum, 'UPDATE')), false)
    INTO customer_create, customer_edit FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.customers'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname NOT IN ('is_enabled', 'catalog_version');
  SELECT coalesce(bool_and(has_column_privilege(current_user, a.attrelid, a.attnum, 'INSERT')), false),
    coalesce(bool_and(has_column_privilege(current_user, a.attrelid, a.attnum, 'UPDATE')), false)
    INTO product_create, product_edit FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.products'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname NOT IN ('is_enabled', 'catalog_version');
  RETURN jsonb_build_object('version', 1, 'as_of', statement_timestamp(), 'actor_id', auth.uid(), 'role', r,
    'customer_create', writable AND customer_create, 'customer_edit', writable AND customer_edit,
    'customer_delete', false,
    'product_create', writable AND product_create, 'product_edit', writable AND product_edit,
    'product_delete', writable AND has_table_privilege(current_user, 'public.products', 'DELETE'));
END $$;

CREATE FUNCTION public.pilot_procurement_access_v2() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE r public.user_role := public.current_user_role();
  customer_create boolean; customer_edit boolean; product_create boolean; product_edit boolean;
  customer_delete_mode text := 'none'; product_delete_mode text := 'none';
BEGIN
  IF auth.uid() IS NULL OR r IS NULL OR r NOT IN ('po_admin', 'co_admin', 'executive') THEN
    RAISE EXCEPTION 'Procurement access denied' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(bool_and(has_column_privilege(current_user, a.attrelid, a.attnum, 'INSERT')), false),
    coalesce(bool_and(has_column_privilege(current_user, a.attrelid, a.attnum, 'UPDATE')), false)
    INTO customer_create, customer_edit FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.customers'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname NOT IN ('is_enabled', 'catalog_version');
  SELECT coalesce(bool_and(has_column_privilege(current_user, a.attrelid, a.attnum, 'INSERT')), false),
    coalesce(bool_and(has_column_privilege(current_user, a.attrelid, a.attnum, 'UPDATE')), false)
    INTO product_create, product_edit FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.products'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname NOT IN ('is_enabled', 'catalog_version');
  -- Guarded describes command eligibility, not readiness or direct DELETE rights.
  -- Foundation readiness stays false; later commands must recheck current rights.
  IF r = 'co_admin' THEN
    IF customer_edit THEN customer_delete_mode := 'guarded'; END IF;
    IF product_edit THEN product_delete_mode := 'guarded'; END IF;
  ELSIF r IN ('po_admin', 'executive') AND has_table_privilege(current_user, 'public.products', 'DELETE') THEN
    product_delete_mode := 'direct';
  END IF;
  RETURN jsonb_build_object('version', 2, 'as_of', statement_timestamp(), 'actor_id', auth.uid(), 'role', r,
    'customer_create', customer_create, 'customer_edit', customer_edit,
    'customer_delete', customer_delete_mode <> 'none',
    'product_create', product_create, 'product_edit', product_edit,
    'product_delete', product_delete_mode <> 'none',
    'customer_set_enabled', customer_edit, 'product_set_enabled', product_edit,
    'customer_delete_mode', customer_delete_mode, 'product_delete_mode', product_delete_mode);
END $$;
REVOKE ALL ON FUNCTION public.pilot_procurement_access_v2() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pilot_procurement_access_v2() TO authenticated;

DO $catalog_authority_postflight$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_temp.catalog_legacy_column_privileges_v1 e
    WHERE pg_catalog.has_column_privilege(e.principal_oid, e.relation_oid, e.attnum, e.privilege) IS DISTINCT FROM e.allowed) THEN
    RAISE EXCEPTION 'CATALOG_LEGACY_COLUMN_PRIVILEGE_DRIFT: effective column permission changed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.catalog_legacy_other_table_privileges_v1 e
    WHERE pg_catalog.has_table_privilege(e.principal_oid, e.relation_oid, e.privilege) IS DISTINCT FROM e.allowed) THEN
    RAISE EXCEPTION 'CATALOG_LEGACY_COLUMN_PRIVILEGE_DRIFT: unrelated table permission changed';
  END IF;
  IF EXISTS (SELECT metadata FROM pg_temp.catalog_legacy_memberships_v1 EXCEPT SELECT to_jsonb(m) FROM pg_catalog.pg_auth_members m)
    OR EXISTS (SELECT to_jsonb(m) FROM pg_catalog.pg_auth_members m EXCEPT SELECT metadata FROM pg_temp.catalog_legacy_memberships_v1) THEN
    RAISE EXCEPTION 'CATALOG_LEGACY_COLUMN_PRIVILEGE_DRIFT: role membership changed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
    WHERE c.oid IN (SELECT DISTINCT relation_oid FROM pg_temp.catalog_legacy_columns_v1)
      AND a.privilege_type IN ('INSERT', 'UPDATE') AND a.grantee <> c.relowner) THEN
    RAISE EXCEPTION 'CATALOG_SERVER_COLUMN_PRIVILEGE_LEAK: broad non-owner master write grant';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
    CROSS JOIN (VALUES ('public.customers'), ('public.products')) t(relation_name)
    CROSS JOIN (VALUES ('is_enabled'), ('catalog_version')) c(column_name)
    CROSS JOIN (VALUES ('INSERT'), ('UPDATE')) p(privilege)
    WHERE r.rolname IN ('anon', 'authenticated')
      AND pg_catalog.has_column_privilege(r.oid, t.relation_name, c.column_name, p.privilege)) THEN
    RAISE EXCEPTION 'CATALOG_SERVER_COLUMN_PRIVILEGE_LEAK: client effective server-field permission';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.catalog_legacy_master_policies_v1 e
    LEFT JOIN pg_catalog.pg_policy p ON p.oid = e.oid
    WHERE e.metadata->>'polname' NOT IN ('co_customer_no_insert_v1', 'co_customer_no_update_v1',
      'co_product_no_insert_v1', 'co_product_no_update_v1') AND to_jsonb(p) IS DISTINCT FROM e.metadata) THEN
    RAISE EXCEPTION 'CATALOG_LEGACY_COLUMN_PRIVILEGE_DRIFT: unrelated master policy changed';
  END IF;
  IF pg_catalog.has_function_privilege('anon', 'public.pilot_procurement_access_v2()', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated', 'public.pilot_procurement_access_v2()', 'EXECUTE') THEN
    RAISE EXCEPTION 'CATALOG_LEGACY_COLUMN_PRIVILEGE_DRIFT: capability execution boundary';
  END IF;
END $catalog_authority_postflight$;
-- END POST-COLUMN AUTHORITY.

-- New-object default ACLs are not assumed safe. Unexpected grants abort this
-- transaction rather than widening the reviewed client/private entry points.
DO $catalog_new_object_acl_postflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    WHERE p.oid IN ('private.catalog_identity_guard_v1()'::regprocedure,
      'private.catalog_master_before_v1()'::regprocedure,
      'private.catalog_master_after_v1()'::regprocedure,
      'private.catalog_master_truncate_v1()'::regprocedure,
      'public.pilot_procurement_access_v2()'::regprocedure)
      AND a.grantee <> p.proowner
      AND NOT (p.oid = 'public.pilot_procurement_access_v2()'::regprocedure
        AND a.grantee = 'authenticated'::regrole::oid
        AND a.privilege_type = 'EXECUTE' AND NOT a.is_grantable)
  ) THEN
    RAISE EXCEPTION 'CATALOG_FOUNDATION_FUNCTION_ACL_DRIFT: unexpected new-function grantee';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
    WHERE c.oid IN ('private.catalog_identity_v1'::regclass, 'private.catalog_cutover_v1'::regclass)
      AND a.grantee <> c.relowner
  ) THEN
    RAISE EXCEPTION 'CATALOG_FOUNDATION_TABLE_ACL_DRIFT: unexpected new-table grantee';
  END IF;
END $catalog_new_object_acl_postflight$;
