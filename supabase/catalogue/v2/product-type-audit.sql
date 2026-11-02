-- Private immutable event record; no public read API or end-user table grants.
CREATE TABLE private.catalog_product_type_audit_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  actor_id uuid,
  old_type text,
  new_type text NOT NULL,
  old_catalog_version bigint,
  new_catalog_version bigint NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
REVOKE ALL ON private.catalog_product_type_audit_v2 FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE private.catalog_product_type_audit_v2 ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION private.catalog_record_product_type_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.product_type IS DISTINCT FROM OLD.product_type THEN
    INSERT INTO private.catalog_product_type_audit_v2(product_id,actor_id,old_type,new_type,old_catalog_version,new_catalog_version)
      VALUES(NEW.id,auth.uid(),CASE WHEN TG_OP='UPDATE' THEN OLD.product_type END,NEW.product_type,
        CASE WHEN TG_OP='UPDATE' THEN OLD.catalog_version END,NEW.catalog_version);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.catalog_record_product_type_v2() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER catalog_record_product_type_v2 AFTER INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION private.catalog_record_product_type_v2();
CREATE FUNCTION private.catalog_product_type_audit_immutable_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Tipe audit events are immutable' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION private.catalog_product_type_audit_immutable_v2() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER catalog_product_type_audit_immutable_v2 BEFORE UPDATE OR DELETE ON private.catalog_product_type_audit_v2
  FOR EACH ROW EXECUTE FUNCTION private.catalog_product_type_audit_immutable_v2();
CREATE TRIGGER catalog_product_type_audit_no_truncate_v2 BEFORE TRUNCATE ON private.catalog_product_type_audit_v2
  FOR EACH STATEMENT EXECUTE FUNCTION private.catalog_product_type_audit_immutable_v2();
