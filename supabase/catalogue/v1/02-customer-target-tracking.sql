-- SOURCE-ONLY CANDIDATE. Not an activation migration or complete cutover.
-- Requires foundation; install only inside an independently reviewed rollback
-- harness until application-wide writer/lock/shape gates have been proved.
-- No backfill, allocation, readiness change, raw API restriction or policy rewrite.
-- Existing role, RLS, set_by, immutable scope and FK behavior remains authoritative.
-- The bounded guarantee concerns evidence acquisition, not arbitrary master/FK
-- composition. Existing business/FK waits and deadlock rollback remain possible.
-- Installation itself needs its own transaction and complete reviewed drain set.
LOCK TABLE public.customer_targets IN SHARE ROW EXCLUSIVE MODE NOWAIT;
LOCK TABLE private.catalog_identity_v1 IN ROW EXCLUSIVE MODE NOWAIT;

CREATE FUNCTION private.catalog_customer_targets_mark_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ids uuid[] := ARRAY[]::uuid[]; identity_id uuid; prior_state text;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'customer_targets'
    OR TG_WHEN <> 'AFTER' OR TG_LEVEL <> 'ROW'
    OR TG_OP NOT IN ('INSERT', 'UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'Unexpected customer target event' USING ERRCODE = '23514';
  END IF;
  IF TG_OP <> 'INSERT' THEN ids := array_append(ids, OLD.customer_id); END IF;
  IF TG_OP <> 'DELETE' THEN ids := array_append(ids, NEW.customer_id); END IF;
  -- Nullable source variants: NULL is absence, not a fabricated identity. The
  -- existing table constraints remain responsible for rejecting prohibited NULL.
  -- No unchanged-value shortcut: any persisted target event is lifetime use.
  LOCK TABLE private.catalog_identity_v1 IN ROW EXCLUSIVE MODE NOWAIT;
  FOR identity_id IN SELECT DISTINCT x FROM unnest(ids) AS t(x)
    WHERE x IS NOT NULL ORDER BY x LOOP
    -- Exactly the foundation reservation namespace, hash seed and transaction
    -- lifetime. Every other final evidence writer must adopt this protocol too.
    IF NOT pg_try_advisory_xact_lock(hashtextextended(
      'catalog_identity_v1:customer:' || identity_id::text, 1801427913)) THEN
      RAISE EXCEPTION 'Catalogue identity is busy'
        USING ERRCODE = '55P03', DETAIL = 'CATALOG_IDENTITY_BUSY';
    END IF;
    SELECT lifetime_state INTO prior_state FROM private.catalog_identity_v1
      WHERE kind = 'customer' AND id = identity_id FOR UPDATE NOWAIT;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Catalogue identity evidence missing'
        USING ERRCODE = '23514', DETAIL = 'CATALOG_TRACKING_INCOMPLETE';
    END IF;
    -- OLD cascade may run before or after the parent's tombstone update. Never
    -- resolve against the live master or clear/rewrite version/tombstone fields.
    IF prior_state <> 'used' THEN
      UPDATE private.catalog_identity_v1 SET lifetime_state = 'used'
        WHERE kind = 'customer' AND id = identity_id;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.catalog_customer_targets_mark_v1() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER catalog_customer_targets_mark_v1
AFTER INSERT OR UPDATE OR DELETE ON public.customer_targets
FOR EACH ROW EXECUTE FUNCTION private.catalog_customer_targets_mark_v1();

CREATE FUNCTION private.catalog_customer_targets_assert_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ids uuid[] := ARRAY[]::uuid[]; identity_id uuid;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'customer_targets'
    OR TG_WHEN <> 'AFTER' OR TG_LEVEL <> 'ROW'
    OR TG_OP NOT IN ('INSERT', 'UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'Unexpected customer target event' USING ERRCODE = '23514';
  END IF;
  IF TG_OP <> 'INSERT' THEN ids := array_append(ids, OLD.customer_id); END IF;
  IF TG_OP <> 'DELETE' THEN ids := array_append(ids, NEW.customer_id); END IF;
  -- Reads only. The immediate marker already owns the final relation mode.
  -- Validate saved OLD/NEW even if the target was subsequently removed/rebound.
  -- Forcing this constraint before marking is permitted to fail closed.
  FOR identity_id IN SELECT DISTINCT x FROM unnest(ids) AS t(x)
    WHERE x IS NOT NULL ORDER BY x LOOP
    IF NOT EXISTS (SELECT 1 FROM private.catalog_identity_v1
      WHERE kind = 'customer' AND id = identity_id AND lifetime_state = 'used') THEN
      RAISE EXCEPTION 'Customer target evidence is not used'
        USING ERRCODE = '23514', DETAIL = 'CATALOG_TRACKING_INCOMPLETE';
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.catalog_customer_targets_assert_v1() FROM PUBLIC, anon, authenticated, service_role;
CREATE CONSTRAINT TRIGGER catalog_customer_targets_assert_v1
AFTER INSERT OR UPDATE OR DELETE ON public.customer_targets
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION private.catalog_customer_targets_assert_v1();

-- Reject unexpected inherited/default function ACLs rather than publish an
-- externally callable marker. Table privilege and policy graphs are unchanged.
DO $acl$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    WHERE p.oid IN ('private.catalog_customer_targets_mark_v1()'::regprocedure,
      'private.catalog_customer_targets_assert_v1()'::regprocedure)
      AND a.grantee <> p.proowner) THEN
    RAISE EXCEPTION 'Catalogue target unexpected new-function grantee' USING ERRCODE = '42501';
  END IF;
END $acl$;
