-- Inactive completion composition. Install after new09 and new10.
-- Preserve foundation identity/version behavior; only actual event hooks differ.
CREATE OR REPLACE FUNCTION private.catalog_master_after_v1() RETURNS trigger
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
  IF TG_OP = 'DELETE' AND identity_kind = 'product' AND private.catalog_product_delete_defer_v2(to_jsonb(OLD)) THEN
    RETURN OLD;
  END IF;
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
      VALUES (identity_kind, identity_id, CASE WHEN private.catalog_create_unused_allowed_v1(identity_kind, identity_id) THEN 'unused' ELSE 'unknown' END, NEW.catalog_version, NULL);
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
