-- Additive Sales v2. Existing v1 history/fields and all business evidence stay unchanged.
BEGIN;
SET LOCAL search_path='';
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

CREATE FUNCTION private.co_sales_scope_v2() RETURNS text
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE caller_role public.user_role;
BEGIN
 SELECT u.role INTO caller_role FROM public.users u WHERE u.id=auth.uid() AND u.is_active;
 IF caller_role IS NULL OR caller_role NOT IN('sales_person','sales_manager','sales_head','executive') THEN
  RAISE EXCEPTION 'Active Sales metrics audience required' USING ERRCODE='42501';
 END IF;
 RETURN CASE caller_role WHEN 'sales_person' THEN 'own' WHEN 'sales_manager' THEN 'team' ELSE 'leadership' END;
END $$;

-- Internal only: dates/source identities never cross the aggregate public boundary.
-- Null date bounds are reserved for authorized earliest-month discovery.
CREATE FUNCTION private.co_sales_metric_facts_v2(p_manager_id uuid,p_month_from date,p_month_until date,p_order_type text)
RETURNS TABLE(kind text,fact_date date,customer_id uuid,person_id uuid,source_id uuid,report_head_id uuid,amount numeric)
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE scope text:=private.co_sales_scope_v2(); actor uuid:=auth.uid();
BEGIN
 IF p_order_type IS NULL OR p_order_type NOT IN('po','co','all') THEN
  RAISE EXCEPTION 'Invalid Sales order type' USING ERRCODE='22023';
 END IF;
 RETURN QUERY
 WITH raw_facts AS (
  SELECT 'po_order'::text AS kind,p.order_date AS fact_date,p.customer_id,p.sales_person_id_at_creation AS person_id,p.id AS source_id,NULL::uuid AS report_head_id,p.total_value::numeric AS amount
  FROM public.purchase_orders p
  WHERE p_order_type IN('po','all') AND p.status IN('confirm','in_progress','complete')
   AND p.sales_attribution_state IN('assigned','unassigned')
   AND (p_month_from IS NULL OR p.order_date>=p_month_from) AND (p_month_until IS NULL OR p.order_date<p_month_until)
  UNION ALL
  SELECT 'po_delivery',s.sj_date,p.customer_id,p.sales_person_id_at_creation,p.id,NULL::uuid,d.quantity_delivered::numeric*l.unit_price
  FROM public.purchase_orders p
  JOIN public.surat_jalan s ON s.purchase_order_id=p.id AND s.voided_at IS NULL
  JOIN public.sj_line_items d ON d.surat_jalan_id=s.id AND d.quantity_delivered>0
  JOIN public.po_line_items l ON l.id=d.po_line_item_id AND l.purchase_order_id=p.id
  WHERE p_order_type IN('po','all') AND p.sales_attribution_state IN('assigned','unassigned')
   AND (p_month_from IS NULL OR s.sj_date>=p_month_from) AND (p_month_until IS NULL OR s.sj_date<p_month_until)
  UNION ALL
  SELECT 'co_sale',h.report_month,a.customer_id,a.sales_person_id_at_creation,b.co_id,h.id,a.amount
  FROM private.co_customer_state cs
  JOIN private.co_sale_allocations a ON a.generation_id=cs.effective_generation_id AND a.customer_id=cs.customer_id
  JOIN private.co_report_heads h ON h.current_revision_id=a.report_revision_id AND h.customer_id=a.customer_id
  JOIN private.co_stock_batches b ON b.id=a.batch_id AND b.customer_id=a.customer_id
  WHERE p_order_type IN('co','all') AND a.quantity>0
   AND (p_month_from IS NULL OR h.report_month>=p_month_from) AND (p_month_until IS NULL OR h.report_month<p_month_until)
 ), scoped AS (
  SELECT f.* FROM raw_facts f LEFT JOIN public.users u ON u.id=f.person_id
  WHERE (scope='leadership' OR f.person_id=actor OR (scope='team' AND u.manager_id=actor))
   AND (p_manager_id IS NULL OR f.person_id=p_manager_id OR u.manager_id=p_manager_id)
 ), report_events AS (
  SELECT 'co_report'::text AS kind,h.report_month AS fact_date,h.customer_id,NULL::uuid AS person_id,NULL::uuid AS source_id,h.id AS report_head_id,0::numeric AS amount
  FROM private.co_report_heads h
  JOIN private.co_report_revisions r ON r.id=h.current_revision_id AND r.customer_id=h.customer_id
  JOIN private.co_customer_state cs ON cs.customer_id=h.customer_id AND cs.effective_generation_id IS NOT NULL
  WHERE p_order_type IN('co','all')
   AND (p_month_from IS NULL OR h.report_month>=p_month_from) AND (p_month_until IS NULL OR h.report_month<p_month_until)
   AND ((scope='leadership' AND p_manager_id IS NULL) OR EXISTS (
    SELECT b.id
    FROM private.co_stock_batches b
    LEFT JOIN public.users u ON u.id=b.sales_person_id_at_creation
    JOIN private.co_stock_movements m ON m.batch_id=b.id AND m.customer_id=b.customer_id
     AND m.generation_id=cs.effective_generation_id AND m.effective_date<=r.coverage_through_date
    WHERE b.customer_id=h.customer_id
     AND (scope='leadership' OR b.sales_person_id_at_creation=actor OR (scope='team' AND u.manager_id=actor))
     AND (p_manager_id IS NULL OR b.sales_person_id_at_creation=p_manager_id OR u.manager_id=p_manager_id)
    GROUP BY b.id
    HAVING coalesce(sum(m.quantity_delta) FILTER(WHERE m.effective_date<h.report_month),0)>0
     OR bool_or(m.effective_date>=h.report_month)
   ))
 )
 SELECT f.* FROM scoped f UNION ALL SELECT e.* FROM report_events e;
END $$;

CREATE FUNCTION public.pilot_sales_metrics_v2(p_manager_id uuid,p_month_from date,p_month_until date,p_group_by text,p_order_type text,p_page integer,p_page_size integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE scope text:=private.co_sales_scope_v2(); result jsonb;
BEGIN
 IF p_month_from IS NULL OR p_month_until IS NULL OR NOT isfinite(p_month_from) OR NOT isfinite(p_month_until)
 OR p_month_from::text !~ '^[0-9]{4}-(0[1-9]|1[0-2])-01$' OR p_month_until::text !~ '^[0-9]{4}-(0[1-9]|1[0-2])-01$'
 OR p_month_from>=p_month_until OR p_group_by IS NULL OR p_group_by NOT IN('customer','person')
 OR p_order_type IS NULL OR p_order_type NOT IN('po','co','all') OR p_page IS NULL OR p_page<1
 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'Invalid Sales metrics bounds or filters' USING ERRCODE='22023';
 END IF;
 WITH facts AS MATERIALIZED (
  SELECT * FROM private.co_sales_metric_facts_v2(p_manager_id,p_month_from,p_month_until,p_order_type)
 ), grouped AS (
  SELECT CASE p_group_by WHEN 'customer' THEN f.customer_id ELSE f.person_id END AS group_id,
   jsonb_build_object(
    'po_order_value',round(coalesce(sum(f.amount) FILTER(WHERE kind='po_order'),0),2)::text,
    'po_order_count',(count(DISTINCT source_id) FILTER(WHERE kind='po_order'))::text,
    'po_delivered_revenue',round(coalesce(sum(f.amount) FILTER(WHERE kind='po_delivery'),0),2)::text,
    'po_delivered_order_count',(count(DISTINCT source_id) FILTER(WHERE kind='po_delivery'))::text,
    'co_sold_revenue',round(coalesce(sum(f.amount) FILTER(WHERE kind='co_sale'),0),2)::text,
    'co_sold_order_count',(count(DISTINCT source_id) FILTER(WHERE kind='co_sale'))::text,
    CASE p_group_by WHEN 'customer' THEN 'co_report_event_count' ELSE 'co_contributing_report_count' END,
    (count(DISTINCT report_head_id) FILTER(WHERE kind=CASE p_group_by WHEN 'customer' THEN 'co_report' ELSE 'co_sale' END))::text
   ) AS metrics
  FROM facts f WHERE p_group_by='customer' OR kind<>'co_report' GROUP BY 1
 ), rows AS MATERIALIZED (
  SELECT g.group_id,CASE p_group_by WHEN 'customer' THEN coalesce(c.name,'Unknown customer')
   ELSE CASE WHEN g.group_id IS NULL THEN 'Unassigned' ELSE coalesce(u.full_name,'Unknown salesperson') END END AS name,
   (p_group_by='person' AND g.group_id IS NULL) AS is_unassigned,
   g.metrics||CASE p_group_by WHEN 'customer' THEN jsonb_build_object('customer_id',g.group_id,'customer_name',coalesce(c.name,'Unknown customer'))
    ELSE jsonb_build_object('person_id',g.group_id,'person_name',CASE WHEN g.group_id IS NULL THEN 'Unassigned' ELSE coalesce(u.full_name,'Unknown salesperson') END,'is_unassigned',g.group_id IS NULL) END AS data
  FROM grouped g LEFT JOIN public.customers c ON p_group_by='customer' AND c.id=g.group_id
  LEFT JOIN public.users u ON p_group_by='person' AND u.id=g.group_id
 ), page_rows AS (
  SELECT * FROM rows ORDER BY is_unassigned,name,group_id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size
 )
 SELECT jsonb_build_object(
  'version',2,'as_of',statement_timestamp(),'scope',scope,'manager_id',p_manager_id,
  'month_from',p_month_from,'month_until',p_month_until,'group_by',p_group_by,'order_type',p_order_type,
  'page',p_page,'page_size',p_page_size,'total',(SELECT count(*)::text FROM rows),
  'items',coalesce((SELECT jsonb_agg(data ORDER BY is_unassigned,name,group_id) FROM page_rows),'[]'::jsonb),
  'summary',(SELECT jsonb_build_object(
    'po_order_value',round(coalesce(sum(amount) FILTER(WHERE kind='po_order'),0),2)::text,
    'po_order_count',(count(DISTINCT source_id) FILTER(WHERE kind='po_order'))::text,
    'po_delivered_revenue',round(coalesce(sum(amount) FILTER(WHERE kind='po_delivery'),0),2)::text,
    'po_delivered_order_count',(count(DISTINCT source_id) FILTER(WHERE kind='po_delivery'))::text,
    'co_sold_revenue',round(coalesce(sum(amount) FILTER(WHERE kind='co_sale'),0),2)::text,
    'co_sold_order_count',(count(DISTINCT source_id) FILTER(WHERE kind='co_sale'))::text,
    'co_report_event_count',(count(DISTINCT report_head_id) FILTER(WHERE kind='co_report'))::text
  ) FROM facts)) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.pilot_sales_metric_months_v2(p_manager_id uuid,p_order_type text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE scope text:=private.co_sales_scope_v2(); first_month date;
BEGIN
 SELECT date_trunc('month',min(f.fact_date)::timestamp)::date INTO first_month
 FROM private.co_sales_metric_facts_v2(p_manager_id,NULL,NULL,p_order_type) f;
 RETURN jsonb_build_object('version',2,'as_of',statement_timestamp(),'scope',scope,'manager_id',p_manager_id,'order_type',p_order_type,'earliest_month',first_month);
END $$;

REVOKE ALL ON FUNCTION private.co_sales_scope_v2(),private.co_sales_metric_facts_v2(uuid,date,date,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pilot_sales_metrics_v2(uuid,date,date,text,text,integer,integer),public.pilot_sales_metric_months_v2(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pilot_sales_metrics_v2(uuid,date,date,text,text,integer,integer),public.pilot_sales_metric_months_v2(uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
