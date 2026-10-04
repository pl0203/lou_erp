-- Query-only candidate: preserve visibility and all original customer metric populations.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.pilot_customer_performance_v1(uuid,text,timestamptz,timestamptz,integer,integer)'::regprocedure AND md5(prosrc)='76897aa310b4c4c606c5ab2ca8ea3b7c' AND NOT prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=""']) THEN RAISE EXCEPTION 'Unexpected customer report base; review required'; END IF;
END $$;
CREATE TEMP TABLE customer_report_attributes ON COMMIT DROP AS SELECT oid,proowner,prolang,proleakproof,proisstrict,proparallel,proacl,provolatile,prosecdef,proconfig,prorettype,proargtypes,proargnames FROM pg_proc WHERE oid='public.pilot_customer_performance_v1(uuid,text,timestamptz,timestamptz,integer,integer)'::regprocedure;
CREATE OR REPLACE FUNCTION public.pilot_customer_performance_v1(p_manager_id uuid,p_year_month text,p_visit_from timestamptz,p_visit_until timestamptz,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb; month_from date; month_until date;
BEGIN
 PERFORM private.pilot_read_page_guard_v1(p_page,p_page_size); PERFORM private.pilot_performance_scope_v1(p_manager_id,p_year_month);
 IF p_visit_from IS NULL OR p_visit_until IS NULL OR NOT isfinite(p_visit_from) OR NOT isfinite(p_visit_until) OR p_visit_from>=p_visit_until THEN RAISE EXCEPTION 'Invalid visit bounds' USING ERRCODE='22023'; END IF;
 month_from:=(p_year_month||'-01')::date; month_until:=(month_from+interval '1 month')::date;
 WITH cohort AS MATERIALIZED (SELECT c.id,c.name,c.visit_frequency_days FROM public.customers c
  WHERE p_manager_id IS NULL OR EXISTS(SELECT 1 FROM public.customer_manager_assignments a WHERE a.customer_id=c.id AND a.manager_id=p_manager_id)),
 visit_counts AS (SELECT v.outlet_id,count(*) FILTER(WHERE v.checked_in_at>=p_visit_from AND v.checked_in_at<p_visit_until) AS actual_visits,max(v.checked_in_at) AS last_visit_date FROM public.outlet_visits v JOIN cohort c ON c.id=v.outlet_id GROUP BY v.outlet_id),
 order_counts AS (SELECT p.customer_id,count(*) AS order_count FROM public.purchase_orders p JOIN cohort c ON c.id=p.customer_id WHERE p.order_date>=month_from AND p.order_date<month_until GROUP BY p.customer_id),
 delivery_values AS MATERIALIZED (SELECT d.surat_jalan_id,sum(d.quantity_delivered::numeric*l.unit_price) AS value FROM public.sj_line_items d JOIN public.po_line_items l ON l.id=d.po_line_item_id GROUP BY d.surat_jalan_id),
 sales AS (SELECT p.customer_id,sum(d.value) AS value FROM public.purchase_orders p JOIN cohort c ON c.id=p.customer_id
  JOIN public.surat_jalan s ON s.purchase_order_id=p.id AND s.voided_at IS NULL AND s.sj_date>=month_from AND s.sj_date<month_until
  JOIN delivery_values d ON d.surat_jalan_id=s.id
  WHERE p.status IN ('in_progress','complete') GROUP BY p.customer_id),
 targets AS (SELECT DISTINCT ON(t.customer_id) t.customer_id,t.target_value FROM public.customer_targets t JOIN cohort c ON c.id=t.customer_id WHERE t.year_month<=p_year_month ORDER BY t.customer_id,t.year_month DESC,t.id),
 metrics_rows AS (SELECT c.id,c.name,CASE WHEN p_manager_id IS NULL THEN u.full_name ELSE NULL END AS manager_name,
  coalesce(v.actual_visits,0) AS actual_visits,ceil((month_until-month_from)::numeric/c.visit_frequency_days)::bigint AS target_visits,
  v.last_visit_date,coalesce(o.order_count,0) AS order_count,coalesce(s.value,0) AS total_sales,t.target_value AS sales_target
  FROM cohort c LEFT JOIN visit_counts v ON v.outlet_id=c.id LEFT JOIN order_counts o ON o.customer_id=c.id LEFT JOIN sales s ON s.customer_id=c.id
  LEFT JOIN targets t ON t.customer_id=c.id LEFT JOIN public.customer_manager_assignments a ON a.customer_id=c.id LEFT JOIN public.users u ON u.id=a.manager_id),
 rows AS MATERIALIZED (SELECT v.*,jsonb_build_object('id',id,'name',name,'manager_name',manager_name,'actual_visits',actual_visits,'target_visits',target_visits,
  'last_visit_date',last_visit_date,'order_count',order_count,'total_sales',total_sales::text,'sales_target',sales_target::text) AS data FROM metrics_rows v),
 page_rows AS (SELECT * FROM rows ORDER BY name,id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size)
 SELECT jsonb_build_object('version',1,'as_of',statement_timestamp(),'page',p_page,'page_size',p_page_size,
 'total',(SELECT count(*) FROM rows),'items',coalesce((SELECT jsonb_agg(data ORDER BY name,id) FROM page_rows),'[]'::jsonb),
 'summary',(SELECT jsonb_build_object('total_sales',coalesce(sum(total_sales),0)::text,'active_customers',count(*) FILTER(WHERE order_count>0),'total_customers',count(*),
  'total_visits',coalesce(sum(actual_visits),0),'total_target_visits',coalesce(sum(target_visits),0),
  'visit_percent',CASE WHEN sum(target_visits)>0 THEN round(100*sum(actual_visits)::numeric/sum(target_visits)) ELSE 0 END,
  'top_customer',(SELECT data FROM rows ORDER BY total_sales DESC,id LIMIT 1)) FROM rows)) INTO result;
 RETURN result;
END $$;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM customer_report_attributes b LEFT JOIN pg_proc p ON p.oid=b.oid WHERE ROW(b.proowner,b.prolang,b.proleakproof,b.proisstrict,b.proparallel,b.proacl,b.provolatile,b.prosecdef,b.proconfig,b.prorettype,b.proargtypes,b.proargnames) IS DISTINCT FROM ROW(p.proowner,p.prolang,p.proleakproof,p.proisstrict,p.proparallel,p.proacl,p.provolatile,p.prosecdef,p.proconfig,p.prorettype,p.proargtypes,p.proargnames)) THEN RAISE EXCEPTION 'Customer report security/signature attributes changed'; END IF;
END $$;
COMMIT;
