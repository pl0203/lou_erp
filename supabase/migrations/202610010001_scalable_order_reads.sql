-- Additive read API v1. Apply only through the separately reviewed deployment packet.
-- Every data query runs with caller privileges and existing RLS; no write grants change.
BEGIN;
CREATE FUNCTION private.pilot_read_guard_v1() RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR public.current_user_role() IS NULL THEN
  RAISE EXCEPTION 'Active authenticated profile required' USING ERRCODE='42501';
 END IF;
END $$;
CREATE FUNCTION private.pilot_read_page_guard_v1(p_page integer,p_page_size integer,p_limit integer DEFAULT 100) RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM private.pilot_read_guard_v1();
 IF p_page IS NULL OR p_page<1 OR p_page_size IS NULL OR p_page_size<1 OR p_page_size>p_limit THEN
  RAISE EXCEPTION 'Invalid page or page size' USING ERRCODE='22023';
 END IF;
END $$;
REVOKE ALL ON FUNCTION private.pilot_read_guard_v1(),private.pilot_read_page_guard_v1(integer,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.pilot_read_guard_v1(),private.pilot_read_page_guard_v1(integer,integer,integer) TO authenticated;

CREATE FUNCTION public.pilot_po_page_v1(p_status text,p_search text,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb; term text;
BEGIN
 PERFORM private.pilot_read_page_guard_v1(p_page,p_page_size);
 IF p_status IS NULL OR p_status NOT IN ('all','draft','confirm','in_progress','complete','cancelled') OR p_search IS NULL THEN
  RAISE EXCEPTION 'Invalid PO filter' USING ERRCODE='22023';
 END IF;
 term:=lower(btrim(p_search));
 WITH matching AS MATERIALIZED (
  SELECT p.id,p.po_number,p.status,p.order_date,p.expected_delivery_date,p.total_value,p.customer_id,p.created_at,
   CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('name',c.name) END AS customers
  FROM public.purchase_orders p LEFT JOIN public.customers c ON c.id=p.customer_id
  WHERE (p_status='all' OR p.status::text=p_status)
  AND (term='' OR strpos(lower(p.po_number),term)>0 OR strpos(lower(c.name),term)>0
   OR EXISTS(SELECT 1 FROM public.surat_jalan s WHERE s.purchase_order_id=p.id AND strpos(lower(s.sj_number),term)>0))
 ), page_rows AS (
  SELECT * FROM matching ORDER BY created_at DESC,id DESC LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size
 )
 SELECT jsonb_build_object('version',1,'as_of',statement_timestamp(),'page',p_page,'page_size',p_page_size,
  'total',(SELECT count(*) FROM matching),'items',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',id,'po_number',po_number,'status',status,'order_date',order_date,'expected_delivery_date',expected_delivery_date,
   'total_value',total_value::text,'customer_id',customer_id,'customers',customers) ORDER BY created_at DESC,id DESC) FROM page_rows),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.pilot_sales_order_page_v1(p_status text,p_own_only boolean,p_page integer,p_page_size integer,p_customer_id uuid DEFAULT NULL,p_visit_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM private.pilot_read_page_guard_v1(p_page,p_page_size);
 IF p_status IS NULL OR p_status NOT IN ('all','pending','approved','rejected','cancelled') OR p_own_only IS NULL THEN
  RAISE EXCEPTION 'Invalid sales order filter' USING ERRCODE='22023';
 END IF;
 WITH matching AS MATERIALIZED (
  SELECT o.id,o.status,o.total_value,o.created_at,o.rejection_note,
   CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('name',c.name) END AS customers,
   CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('full_name',u.full_name) END AS users
  FROM public.girard_orders o LEFT JOIN public.customers c ON c.id=o.customer_id LEFT JOIN public.users u ON u.id=o.submitted_by
  WHERE (p_status='all' OR o.status=p_status) AND (NOT p_own_only OR o.submitted_by=auth.uid())
   AND (p_customer_id IS NULL OR o.customer_id=p_customer_id) AND (p_visit_id IS NULL OR o.visit_id=p_visit_id)
 ), page_rows AS (
  SELECT * FROM matching ORDER BY created_at DESC,id DESC LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size
 )
 SELECT jsonb_build_object('version',1,'as_of',statement_timestamp(),'page',p_page,'page_size',p_page_size,
  'total',(SELECT count(*) FROM matching),
  'status_counts',(SELECT jsonb_build_object('pending',count(*) FILTER(WHERE status='pending'),'approved',count(*) FILTER(WHERE status='approved'),'rejected',count(*) FILTER(WHERE status='rejected'),'cancelled',count(*) FILTER(WHERE status='cancelled')) FROM matching),
  'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'status',status,'total_value',total_value::text,
   'created_at',created_at,'rejection_note',rejection_note,'customers',customers,'users',users) ORDER BY created_at DESC,id DESC) FROM page_rows),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.pilot_po_lines_v1(p_po_id uuid,p_page integer,p_page_size integer,p_expected_updated_at timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb; version_time timestamptz;
BEGIN
 PERFORM private.pilot_read_page_guard_v1(p_page,p_page_size);
 IF p_po_id IS NULL OR (p_page>1 AND p_expected_updated_at IS NULL) OR (p_expected_updated_at IS NOT NULL AND NOT isfinite(p_expected_updated_at)) THEN
  RAISE EXCEPTION 'PO ID and consistent page version required' USING ERRCODE='22023';
 END IF;
 SELECT p.updated_at INTO version_time FROM public.purchase_orders p WHERE p.id=p_po_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'PO not found or unavailable' USING ERRCODE='22023'; END IF;
 IF p_expected_updated_at IS NOT NULL AND version_time IS DISTINCT FROM p_expected_updated_at THEN
  RAISE EXCEPTION 'PO changed; refresh before continuing' USING ERRCODE='40001';
 END IF;
 WITH lines AS MATERIALIZED (SELECT l.id,l.product_name,l.sku,l.quantity,l.unit_price,l.line_total FROM public.po_line_items l WHERE l.purchase_order_id=p_po_id),
 delivered AS (
  SELECT d.po_line_item_id,sum(d.quantity_delivered) FILTER(WHERE s.voided_at IS NULL) AS quantity,count(*)>0 AS history
  FROM public.sj_line_items d JOIN public.surat_jalan s ON s.id=d.surat_jalan_id JOIN lines l ON l.id=d.po_line_item_id
  GROUP BY d.po_line_item_id
 ), page_rows AS (
  SELECT l.*,coalesce(d.quantity,0) AS delivered_quantity,coalesce(d.history,false) AS has_delivery_history
  FROM lines l LEFT JOIN delivered d ON d.po_line_item_id=l.id
  ORDER BY l.id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size
 )
 SELECT jsonb_build_object('version',1,'as_of',statement_timestamp(),'page',p_page,'page_size',p_page_size,
  'po_updated_at',version_time,'po_has_delivery_history',EXISTS(SELECT 1 FROM public.surat_jalan s WHERE s.purchase_order_id=p_po_id),
  'total',(SELECT count(*) FROM lines),'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'product_name',product_name,
   'sku',sku,'quantity',quantity,'unit_price',unit_price::text,'line_total',line_total::text,
   'delivered_quantity',delivered_quantity,'has_delivery_history',has_delivery_history) ORDER BY id) FROM page_rows),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.pilot_po_page_v1(text,text,integer,integer),public.pilot_sales_order_page_v1(text,boolean,integer,integer,uuid,uuid),public.pilot_po_lines_v1(uuid,integer,integer,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pilot_po_page_v1(text,text,integer,integer),public.pilot_sales_order_page_v1(text,boolean,integer,integer,uuid,uuid),public.pilot_po_lines_v1(uuid,integer,integer,timestamptz) TO authenticated;
COMMIT;
