-- Candidate fragment only. Assemble after the reviewed foundation in the same
-- atomic rollout; this file does not change SELECT policies or activate writes.
CREATE FUNCTION public.pilot_catalog_page_v1(
  p_kind text, p_purpose text, p_status text, p_search text,
  p_page integer, p_page_size integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  actor_role text := public.current_user_role()::text;
  search_pattern text;
  page_offset bigint;
  total_count bigint;
  page_rows jsonb;
BEGIN
  IF actor IS NULL OR actor_role IS NULL OR actor_role NOT IN
    ('co_admin', 'po_admin', 'executive', 'sales_person', 'sales_manager', 'sales_head') THEN
    RAISE EXCEPTION 'Active catalogue profile required' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('customer', 'product')
    OR p_purpose IS NULL OR p_purpose NOT IN ('enabled-for-order', 'all-for-history', 'catalogue')
    OR p_status IS NULL OR p_status NOT IN ('all', 'enabled', 'disabled')
    OR (p_purpose = 'enabled-for-order' AND p_status <> 'enabled')
    OR (p_purpose = 'all-for-history' AND p_status <> 'all')
    OR p_search IS NULL OR p_page IS NULL OR p_page < 1
    OR p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 250 THEN
    RAISE EXCEPTION 'Invalid catalogue page scope' USING ERRCODE = '22023';
  END IF;
  -- Literal substring search: %, _ and backslash are data, not wildcards.
  search_pattern := '%' || replace(replace(replace(p_search, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
  page_offset := (p_page::bigint - 1) * p_page_size::bigint;
  IF p_kind = 'customer' THEN
    WITH visible AS MATERIALIZED (
      SELECT c.id, c.name, c.address, c.city, c.phone, c.email, c.pricing_tier,
        c.customer_category, c.is_enabled, c.catalog_version
      FROM public.customers c
      WHERE (p_status = 'all' OR c.is_enabled = (p_status = 'enabled'))
        AND (p_search = '' OR c.name ILIKE search_pattern ESCAPE E'\\'
          OR c.city ILIKE search_pattern ESCAPE E'\\')
    ), page AS (
      SELECT c.id, c.name, c.address, c.city, c.phone, c.email, c.pricing_tier,
        c.customer_category, c.is_enabled, c.catalog_version
      FROM visible c ORDER BY c.id LIMIT p_page_size OFFSET page_offset
    )
    SELECT (SELECT count(*) FROM visible), coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'address', c.address, 'city', c.city, 'phone', c.phone,
      'email', c.email, 'pricing_tier', c.pricing_tier, 'customer_category', c.customer_category,
      'is_enabled', c.is_enabled, 'catalog_version', c.catalog_version::text) ORDER BY c.id) FROM page c), '[]'::jsonb)
    INTO total_count, page_rows;
  ELSE
    WITH visible AS MATERIALIZED (
      SELECT p.id, p.name, p.sku, p.size, p.unit_price, p.harga_pokok,
        p.luar_kota, p.dalam_kota, p.depo_bangunan, p.is_enabled, p.catalog_version
      FROM public.products p
      WHERE (p_status = 'all' OR p.is_enabled = (p_status = 'enabled'))
        AND (p_search = '' OR p.name ILIKE search_pattern ESCAPE E'\\'
          OR p.sku ILIKE search_pattern ESCAPE E'\\' OR p.size ILIKE search_pattern ESCAPE E'\\')
    ), page AS (
      SELECT p.id, p.name, p.sku, p.size, p.unit_price, p.harga_pokok,
        p.luar_kota, p.dalam_kota, p.depo_bangunan, p.is_enabled, p.catalog_version
      FROM visible p ORDER BY p.id LIMIT p_page_size OFFSET page_offset
    )
    SELECT (SELECT count(*) FROM visible), coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'sku', p.sku, 'size', p.size, 'unit_price', p.unit_price,
      'harga_pokok', p.harga_pokok, 'luar_kota', p.luar_kota, 'dalam_kota', p.dalam_kota,
      'depo_bangunan', p.depo_bangunan, 'is_enabled', p.is_enabled,
      'catalog_version', p.catalog_version::text) ORDER BY p.id) FROM page p), '[]'::jsonb)
    INTO total_count, page_rows;
  END IF;
  RETURN jsonb_build_object('version', 1, 'actor_id', actor, 'role', actor_role,
    'kind', p_kind, 'purpose', p_purpose, 'status', p_status, 'search', p_search,
    'page', p_page, 'page_size', p_page_size, 'total_count', total_count::text, 'rows', page_rows);
END $$;
REVOKE ALL ON FUNCTION public.pilot_catalog_page_v1(text,text,text,text,integer,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pilot_catalog_page_v1(text,text,text,text,integer,integer) TO authenticated;
