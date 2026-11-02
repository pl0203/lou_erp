-- Additive proposal; apply only within the separately approved atomic migration.
-- No backfill: untouched legacy products intentionally remain NULL.
ALTER TABLE public.products ADD COLUMN product_type text;
ALTER TABLE public.products ADD CONSTRAINT products_product_type_allowed_v2 CHECK (
  product_type IS NULL OR product_type IN ('Bonbon','Bak Cuci Piring','Wastafel','Batu Taman','Granite','Closet','Listello','Mosaic','Meja','Andesit','Pola','House Plint','Rumput Sintetis','Teracotta','Gentong','Air Mancur','Step Nosing')
);

CREATE FUNCTION private.catalog_product_type_required_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.product_type IS NULL AND (
    TG_OP='INSERT' OR OLD.product_type IS NOT NULL
    OR (to_jsonb(NEW)-ARRAY['is_enabled','catalog_version']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['is_enabled','catalog_version'])
  ) THEN
    RAISE EXCEPTION 'Tipe is required; refresh the application before saving this product'
      USING ERRCODE='23514', DETAIL='CATALOG_TYPE_REQUIRED';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.catalog_product_type_required_v2() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER catalog_product_type_required_v2 BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION private.catalog_product_type_required_v2();

-- UPDATE OF detects explicit edit intent even when assigned values are unchanged.
-- Status-only operations do not name these columns and retain legacy NULL rows.
CREATE FUNCTION private.catalog_product_type_edit_required_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.product_type IS NULL THEN
    RAISE EXCEPTION 'Tipe is required for product edits'
      USING ERRCODE='23514', DETAIL='CATALOG_TYPE_REQUIRED';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.catalog_product_type_edit_required_v2() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER catalog_product_type_edit_required_v2
  BEFORE UPDATE OF name,sku,size,unit_price,harga_pokok,luar_kota,dalam_kota,depo_bangunan,product_type
  ON public.products FOR EACH ROW EXECUTE FUNCTION private.catalog_product_type_edit_required_v2();
