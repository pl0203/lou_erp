-- Additive aggregate API v1; existing caller RLS remains authoritative.
BEGIN;
CREATE FUNCTION private.pilot_report_dates_v1(p_from date,p_to date,p_rolling_from date,p_status text,p_fulfillment text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM private.pilot_read_guard_v1();
 IF p_from IS NULL OR p_to IS NULL OR p_rolling_from IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR NOT isfinite(p_rolling_from) OR p_from>p_to
 OR p_status IS NULL OR p_status NOT IN ('all','draft','confirm','in_progress','complete','cancelled')
 OR p_fulfillment IS NULL OR p_fulfillment NOT IN ('all','undelivered','partial','complete') THEN
  RAISE EXCEPTION 'Invalid report bounds or filters' USING ERRCODE='22023';
 END IF;
END $$;
CREATE FUNCTION private.pilot_performance_scope_v1(p_manager_id uuid,p_year_month text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM private.pilot_read_guard_v1();
 IF p_year_month IS NULL OR p_year_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Invalid report month' USING ERRCODE='22023'; END IF;
 IF public.current_user_role()='sales_manager' THEN
  IF p_manager_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Own manager scope required' USING ERRCODE='42501'; END IF;
 ELSIF p_manager_id IS NOT NULL THEN RAISE EXCEPTION 'All-visible report requires null manager scope' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.pilot_report_dates_v1(date,date,date,text,text),private.pilot_performance_scope_v1(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.pilot_report_dates_v1(date,date,date,text,text),private.pilot_performance_scope_v1(uuid,text) TO authenticated;

CREATE FUNCTION public.pilot_customer_stats_v1(p_customer_ids uuid[],p_cutoff date,p_top_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM private.pilot_read_guard_v1();
 IF p_customer_ids IS NULL OR cardinality(p_customer_ids)>100 OR array_position(p_customer_ids,NULL) IS NOT NULL OR p_cutoff IS NULL OR NOT isfinite(p_cutoff) OR p_top_limit IS NULL OR p_top_limit NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Invalid customer statistics arguments' USING ERRCODE='22023'; END IF;
 WITH cohort AS MATERIALIZED (SELECT c.id FROM public.customers c WHERE c.id=ANY(p_customer_ids)),
 pos AS MATERIALIZED (SELECT p.id,p.customer_id,p.order_date,p.status FROM public.purchase_orders p JOIN cohort c ON c.id=p.customer_id),
 counts AS (SELECT customer_id,min(order_date) AS first_order_date,count(*) FILTER(WHERE order_date>=p_cutoff) AS order_count FROM pos GROUP BY customer_id),
 sales AS (SELECT p.customer_id,sum(d.quantity_delivered::numeric*l.unit_price) AS value
  FROM pos p JOIN public.surat_jalan s ON s.purchase_order_id=p.id AND s.voided_at IS NULL AND s.sj_date>=p_cutoff
  JOIN public.sj_line_items d ON d.surat_jalan_id=s.id JOIN public.po_line_items l ON l.id=d.po_line_item_id
  WHERE p.status IN ('in_progress','complete') GROUP BY p.customer_id),
 item_values AS (SELECT p.customer_id,l.product_name,sum(l.quantity::numeric*l.unit_price) AS value FROM pos p JOIN public.po_line_items l ON l.purchase_order_id=p.id GROUP BY p.customer_id,l.product_name),
 ranked AS (SELECT *,row_number() OVER(PARTITION BY customer_id ORDER BY value DESC,product_name) AS rank FROM item_values),
 top_items AS (SELECT customer_id,jsonb_agg(jsonb_build_object('name',product_name,'revenue',value::text) ORDER BY rank) AS items FROM ranked WHERE rank<=p_top_limit GROUP BY customer_id)
 SELECT jsonb_build_object('version',1,'as_of',statement_timestamp(),'items',coalesce(jsonb_agg(jsonb_build_object('customer_id',c.id,
  'first_order_date',n.first_order_date,'order_count',coalesce(n.order_count,0),'total_sales',coalesce(s.value,0)::text,'top_items',coalesce(t.items,'[]'::jsonb)) ORDER BY c.id),'[]'::jsonb)) INTO result
 FROM cohort c LEFT JOIN counts n ON n.customer_id=c.id LEFT JOIN sales s ON s.customer_id=c.id LEFT JOIN top_items t ON t.customer_id=c.id;
 RETURN result;
END $$;

CREATE FUNCTION public.pilot_revenue_v1(p_from timestamptz,p_to timestamptz,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM private.pilot_read_page_guard_v1(p_page,p_page_size);
 IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from>p_to THEN RAISE EXCEPTION 'Invalid revenue bounds' USING ERRCODE='22023'; END IF;
 WITH totals AS (SELECT o.customer_id,count(*) AS order_count,sum(o.total_value) AS total_sales,max(o.created_at) AS last_order_date
  FROM public.girard_orders o WHERE o.status='approved' AND o.created_at>=p_from AND o.created_at<=p_to GROUP BY o.customer_id),
 rows AS MATERIALIZED (SELECT t.*,jsonb_build_object('customer_id',t.customer_id,'customer_name',coalesce(c.name,'Unknown'),
  'manager_name',u.full_name,'order_count',t.order_count,'total_sales',t.total_sales::text,'last_order_date',t.last_order_date) AS data
  FROM totals t LEFT JOIN public.customers c ON c.id=t.customer_id LEFT JOIN public.customer_manager_assignments a ON a.customer_id=t.customer_id LEFT JOIN public.users u ON u.id=a.manager_id),
 page_rows AS (SELECT * FROM rows ORDER BY total_sales DESC,customer_id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size)
 SELECT jsonb_build_object('version',1,'as_of',statement_timestamp(),'page',p_page,'page_size',p_page_size,
 'total',(SELECT count(*) FROM rows),'items',coalesce((SELECT jsonb_agg(data ORDER BY total_sales DESC,customer_id) FROM page_rows),'[]'::jsonb),
 'summary',(SELECT jsonb_build_object('total_sales',coalesce(sum(total_sales),0)::text,'total_orders',coalesce(sum(order_count),0),'active_customers',count(*),
 'top_customer',(SELECT data FROM rows ORDER BY total_sales DESC,customer_id LIMIT 1)) FROM rows)) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.pilot_customer_performance_v1(p_manager_id uuid,p_year_month text,p_visit_from timestamptz,p_visit_until timestamptz,p_page integer,p_page_size integer) RETURNS jsonb
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
 sales AS (SELECT p.customer_id,sum(d.quantity_delivered::numeric*l.unit_price) AS value FROM public.purchase_orders p JOIN cohort c ON c.id=p.customer_id
  JOIN public.surat_jalan s ON s.purchase_order_id=p.id AND s.voided_at IS NULL AND s.sj_date>=month_from AND s.sj_date<month_until
  JOIN public.sj_line_items d ON d.surat_jalan_id=s.id JOIN public.po_line_items l ON l.id=d.po_line_item_id
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

CREATE FUNCTION public.pilot_sales_performance_v1(p_manager_id uuid,p_date_from date,p_date_to date,p_order_from timestamptz,p_order_to timestamptz,p_year_month text,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM private.pilot_read_page_guard_v1(p_page,p_page_size); PERFORM private.pilot_performance_scope_v1(p_manager_id,p_year_month);
 IF p_date_from IS NULL OR p_date_to IS NULL OR NOT isfinite(p_date_from) OR NOT isfinite(p_date_to) OR p_date_from>p_date_to OR p_order_from IS NULL OR p_order_to IS NULL OR NOT isfinite(p_order_from) OR NOT isfinite(p_order_to) OR p_order_from>p_order_to THEN RAISE EXCEPTION 'Invalid performance bounds' USING ERRCODE='22023'; END IF;
 WITH cohort AS MATERIALIZED (SELECT u.id,u.full_name FROM public.users u WHERE u.is_active AND u.role IN ('sales_person','sales_manager','sales_head','executive') AND (p_manager_id IS NULL OR u.id=p_manager_id OR u.manager_id=p_manager_id)),
 schedule_states AS (SELECT s.id,s.sales_person_id,s.status,EXISTS(SELECT 1 FROM public.outlet_visits v WHERE v.schedule_id=s.id) AS visited FROM public.sales_schedules s JOIN cohort c ON c.id=s.sales_person_id WHERE s.scheduled_date BETWEEN p_date_from AND p_date_to),
 schedules AS (SELECT sales_person_id,count(*) AS scheduled,count(*) FILTER(WHERE visited) AS visited,count(*) FILTER(WHERE NOT visited AND status='missed') AS missed FROM schedule_states GROUP BY sales_person_id),
 orders AS (SELECT o.submitted_by,count(*) AS orders,sum(o.total_value) AS total_sales FROM public.girard_orders o JOIN cohort c ON c.id=o.submitted_by WHERE o.created_at BETWEEN p_order_from AND p_order_to GROUP BY o.submitted_by),
 targets AS (SELECT DISTINCT ON(t.user_id) t.user_id,t.target_value FROM public.sales_targets t JOIN cohort c ON c.id=t.user_id WHERE t.year_month<=p_year_month ORDER BY t.user_id,t.year_month DESC,t.id),
 metrics_rows AS (SELECT c.id,c.full_name,coalesce(s.scheduled,0) AS scheduled,coalesce(s.visited,0) AS visited,coalesce(s.missed,0) AS missed,
  coalesce(o.orders,0) AS orders,coalesce(o.total_sales,0) AS total_sales,CASE WHEN s.scheduled>0 THEN round(100*s.visited::numeric/s.scheduled) ELSE 0 END AS visit_rate,t.target_value AS sales_target
  FROM cohort c LEFT JOIN schedules s ON s.sales_person_id=c.id LEFT JOIN orders o ON o.submitted_by=c.id LEFT JOIN targets t ON t.user_id=c.id),
 rows AS MATERIALIZED (SELECT m.*,jsonb_build_object('id',id,'full_name',full_name,'scheduled',scheduled,'visited',visited,'missed',missed,'orders',orders,'total_sales',total_sales::text,'visit_rate',visit_rate,'sales_target',sales_target::text) AS data FROM metrics_rows m),
 page_rows AS (SELECT * FROM rows ORDER BY full_name,id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size)
 SELECT jsonb_build_object('version',1,'as_of',statement_timestamp(),'page',p_page,'page_size',p_page_size,'total',(SELECT count(*) FROM rows),
  'items',coalesce((SELECT jsonb_agg(data ORDER BY full_name,id) FROM page_rows),'[]'::jsonb),
  'summary',(SELECT jsonb_build_object('total_visited',coalesce(sum(visited),0),'total_scheduled',coalesce(sum(scheduled),0),'total_orders',coalesce(sum(orders),0),'total_sales',coalesce(sum(total_sales),0)::text,'average_visit_rate',coalesce(round(avg(visit_rate)),0)) FROM rows)) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.pilot_team_activity_v1(p_user_ids uuid[],p_day date,p_order_from timestamptz,p_order_to timestamptz,p_week_from timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM private.pilot_read_guard_v1();
 IF p_user_ids IS NULL OR cardinality(p_user_ids)>100 OR array_position(p_user_ids,NULL) IS NOT NULL OR p_day IS NULL OR NOT isfinite(p_day) OR p_order_from IS NULL OR p_order_to IS NULL OR p_week_from IS NULL OR NOT isfinite(p_order_from) OR NOT isfinite(p_order_to) OR NOT isfinite(p_week_from) OR p_order_from>p_order_to THEN RAISE EXCEPTION 'Invalid activity bounds or users' USING ERRCODE='22023'; END IF;
 WITH cohort AS MATERIALIZED (SELECT u.id FROM public.users u WHERE u.id=ANY(p_user_ids)),
 schedule_states AS (SELECT s.id,s.sales_person_id,EXISTS(SELECT 1 FROM public.outlet_visits v WHERE v.schedule_id=s.id) AS visited FROM public.sales_schedules s JOIN cohort c ON c.id=s.sales_person_id WHERE s.scheduled_date=p_day),
 schedules AS (SELECT sales_person_id,count(*) AS scheduled,count(*) FILTER(WHERE visited) AS visited FROM schedule_states GROUP BY sales_person_id),
 orders AS (SELECT o.submitted_by,count(*) AS count FROM public.girard_orders o JOIN cohort c ON c.id=o.submitted_by WHERE o.created_at BETWEEN p_order_from AND p_order_to GROUP BY o.submitted_by),
 visits AS (SELECT v.sales_person_id,count(*) AS count FROM public.outlet_visits v JOIN cohort c ON c.id=v.sales_person_id WHERE v.checked_in_at>=p_week_from GROUP BY v.sales_person_id)
 SELECT jsonb_build_object('version',1,'as_of',statement_timestamp(),'items',coalesce(jsonb_agg(jsonb_build_object('sales_person_id',c.id,
  'total_scheduled',coalesce(s.scheduled,0),'total_visited',coalesce(s.visited,0),'total_orders',coalesce(o.count,0),'weekly_visits',coalesce(v.count,0)) ORDER BY c.id),'[]'::jsonb)) INTO result
 FROM cohort c LEFT JOIN schedules s ON s.sales_person_id=c.id LEFT JOIN orders o ON o.submitted_by=c.id LEFT JOIN visits v ON v.sales_person_id=c.id;
 RETURN result;
END $$;

CREATE FUNCTION public.pilot_manager_customers_v1(p_manager_id uuid,p_visit_from timestamptz,p_as_of timestamptz,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM private.pilot_read_page_guard_v1(p_page,p_page_size);
 IF p_manager_id IS NULL OR p_visit_from IS NULL OR p_as_of IS NULL OR NOT isfinite(p_visit_from) OR NOT isfinite(p_as_of) OR p_visit_from>p_as_of THEN RAISE EXCEPTION 'Invalid manager or visit bounds' USING ERRCODE='22023'; END IF;
 WITH cohort AS MATERIALIZED (SELECT c.id,c.name,c.address,c.city,c.last_visit_date,c.visit_frequency_days FROM public.customers c
  WHERE EXISTS(SELECT 1 FROM public.customer_manager_assignments a WHERE a.customer_id=c.id AND a.manager_id=p_manager_id)),
 visits AS (SELECT v.outlet_id,count(*) AS count FROM public.outlet_visits v JOIN cohort c ON c.id=v.outlet_id WHERE v.checked_in_at>=p_visit_from GROUP BY v.outlet_id),
 metrics_rows AS (SELECT c.*,coalesce(v.count,0) AS visits_this_period,ceil(30::numeric/c.visit_frequency_days)::bigint AS target_visits,
  coalesce(v.count,0)>=ceil(30::numeric/c.visit_frequency_days) AS on_track,
  c.last_visit_date IS NULL OR extract(epoch FROM (p_as_of-(c.last_visit_date::timestamp AT TIME ZONE 'UTC')))/86400>c.visit_frequency_days AS overdue
  FROM cohort c LEFT JOIN visits v ON v.outlet_id=c.id),
 rows AS MATERIALIZED (SELECT m.*,jsonb_build_object('id',id,'name',name,'address',address,'city',city,'last_visit_date',last_visit_date,
  'visit_frequency_days',visit_frequency_days,'visits_this_period',visits_this_period,'target_visits',target_visits,'on_track',on_track) AS data FROM metrics_rows m),
 page_rows AS (SELECT * FROM rows ORDER BY name,id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size)
 SELECT jsonb_build_object('version',1,'as_of',statement_timestamp(),'page',p_page,'page_size',p_page_size,'total',(SELECT count(*) FROM rows),
  'items',coalesce((SELECT jsonb_agg(data ORDER BY name,id) FROM page_rows),'[]'::jsonb),
  'summary',(SELECT jsonb_build_object('on_track',count(*) FILTER(WHERE on_track),'overdue',count(*) FILTER(WHERE overdue),'total',count(*)) FROM rows)) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.pilot_athel_summary_v1(p_from date,p_to date,p_rolling_from date,p_status text,p_fulfillment text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM private.pilot_report_dates_v1(p_from,p_to,p_rolling_from,p_status,p_fulfillment);
 WITH pos AS MATERIALIZED (SELECT p.id,p.customer_id,p.status,p.order_date,p.total_value FROM public.purchase_orders p WHERE p.order_date BETWEEN least(p_from,p_rolling_from) AND p_to AND (p_status='all' OR p.status::text=p_status)),
 lines AS MATERIALIZED (SELECT l.id,l.purchase_order_id,l.product_name,l.sku,l.quantity,l.unit_price FROM public.po_line_items l JOIN pos p ON p.id=l.purchase_order_id),
 headers AS MATERIALIZED (SELECT s.id,s.purchase_order_id,s.sj_date FROM public.surat_jalan s JOIN pos p ON p.id=s.purchase_order_id WHERE s.voided_at IS NULL),
 delivery_lines AS MATERIALIZED (SELECT s.id AS sj_id,s.purchase_order_id,s.sj_date,l.id AS line_id,d.quantity_delivered,d.quantity_delivered::numeric*l.unit_price AS value FROM headers s JOIN public.sj_line_items d ON d.surat_jalan_id=s.id JOIN lines l ON l.id=d.po_line_item_id),
 delivered_line AS (SELECT line_id,sum(quantity_delivered) AS quantity FROM delivery_lines GROUP BY line_id),
 delivered_po AS (SELECT purchase_order_id,sum(value) AS value FROM delivery_lines GROUP BY purchase_order_id),
 remaining AS MATERIALIZED (SELECT l.*,greatest(0,l.quantity-coalesce(d.quantity,0)) AS remaining_quantity,greatest(0,l.quantity-coalesce(d.quantity,0))*l.unit_price AS remaining_value FROM lines l LEFT JOIN delivered_line d ON d.line_id=l.id),
 remaining_po AS (SELECT purchase_order_id,sum(remaining_quantity) AS quantity,sum(remaining_value) AS value FROM remaining GROUP BY purchase_order_id),
 po_values AS MATERIALIZED (SELECT p.*,coalesce(d.value,0) AS delivered_value,coalesce(r.quantity,0) AS outstanding_quantity,coalesce(r.value,0) AS outstanding_value FROM pos p LEFT JOIN delivered_po d ON d.purchase_order_id=p.id LEFT JOIN remaining_po r ON r.purchase_order_id=p.id),
 filtered AS MATERIALIZED (SELECT * FROM po_values WHERE order_date BETWEEN p_from AND p_to AND
  (p_fulfillment='all' OR (p_fulfillment='undelivered' AND delivered_value=0) OR (p_fulfillment='complete' AND outstanding_quantity=0 AND total_value>0) OR (p_fulfillment='partial' AND delivered_value>0 AND outstanding_quantity>0))),
 customers AS (SELECT f.customer_id,coalesce(c.name,'Tanpa Pelanggan') AS name,sum(f.total_value) AS po_value,sum(f.delivered_value) AS delivered_value FROM filtered f LEFT JOIN public.customers c ON c.id=f.customer_id GROUP BY f.customer_id,c.name),
 ranked_customers AS MATERIALIZED (SELECT *,row_number() OVER(ORDER BY po_value DESC,customer_id) AS rank FROM customers),
 shares AS (SELECT rank,name AS label,po_value AS value FROM ranked_customers WHERE rank<=5 UNION ALL SELECT 6,'Lainnya',sum(po_value) FROM ranked_customers WHERE rank>5 HAVING count(*)>0),
 status_counts AS (SELECT status,count(*) AS count FROM filtered GROUP BY status),
 po_months AS (SELECT to_char(order_date,'YYYY-MM') AS month,sum(total_value) AS value FROM filtered WHERE order_date BETWEEN p_rolling_from AND p_to GROUP BY 1),
 delivered_months AS (SELECT to_char(sj_date,'YYYY-MM') AS month,sum(value) AS value FROM delivery_lines WHERE sj_date BETWEEN p_rolling_from AND p_to GROUP BY 1),
 months AS (SELECT to_char(date_trunc('month',p_rolling_from::timestamp)+i*interval '1 month','YYYY-MM') AS key FROM generate_series(0,11) i),
 item_groups AS (SELECT coalesce(sku,product_name) AS key,sum(remaining_quantity) AS quantity,sum(remaining_value) AS value FROM remaining WHERE remaining_quantity>0 GROUP BY coalesce(sku,product_name) HAVING sum(remaining_value)>0),
 item_labels AS (SELECT DISTINCT ON(coalesce(sku,product_name)) coalesce(sku,product_name) AS key,coalesce(sku,'—') AS sku,product_name FROM remaining WHERE remaining_quantity>0 ORDER BY coalesce(sku,product_name),id),
 ranked_items AS (SELECT l.sku,l.product_name,g.quantity,g.value,row_number() OVER(ORDER BY g.value DESC,g.key) AS rank FROM item_groups g JOIN item_labels l ON l.key=g.key)
 SELECT jsonb_build_object('version',1,'as_of',statement_timestamp(),
  'metrics',(SELECT jsonb_build_object('totalPOCount',count(*),'totalPOValue',coalesce(sum(total_value),0)::text,'deliveredValue',coalesce(sum(delivered_value),0)::text,
   'outstandingValue',coalesce(sum(outstanding_value),0)::text,'averagePOValue',coalesce(avg(total_value),0)::text,'completedPOCount',count(*) FILTER(WHERE status='complete')) FROM filtered),
  'customerShare',CASE WHEN (SELECT coalesce(sum(po_value),0) FROM ranked_customers)>0 THEN coalesce((SELECT jsonb_agg(jsonb_build_object('label',label,'value',value::text) ORDER BY rank) FROM shares),'[]'::jsonb) ELSE '[]'::jsonb END,
  'monthlySeries',(SELECT jsonb_agg(jsonb_build_object('key',m.key,'poValue',coalesce(p.value,0)::text,'deliveredValue',coalesce(d.value,0)::text) ORDER BY m.key) FROM months m LEFT JOIN po_months p ON p.month=m.key LEFT JOIN delivered_months d ON d.month=m.key),
  'statusBreakdown',coalesce((SELECT jsonb_agg(jsonb_build_object('status',status,'value',count) ORDER BY status::text) FROM status_counts),'[]'::jsonb),
  'topCustomers',coalesce((SELECT jsonb_agg(jsonb_build_object('rank',rank,'name',name,'poValue',po_value::text,'deliveredValue',delivered_value::text,'fulfillmentRate',CASE WHEN po_value>0 THEN 100*delivered_value/po_value ELSE 0 END) ORDER BY rank) FROM ranked_customers WHERE rank<=10),'[]'::jsonb),
  'outstandingItems',coalesce((SELECT jsonb_agg(jsonb_build_object('rank',rank,'sku',sku,'productName',product_name,'outstandingQty',quantity,'outstandingValue',value::text) ORDER BY rank) FROM ranked_items WHERE rank<=10),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.pilot_athel_daily_v1(p_from date,p_to date,p_rolling_from date,p_status text,p_fulfillment text,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb; total_days integer; page_offset bigint;
BEGIN
 PERFORM private.pilot_read_page_guard_v1(p_page,p_page_size,366);
 PERFORM private.pilot_report_dates_v1(p_from,p_to,p_rolling_from,p_status,p_fulfillment);
 total_days:=p_to-p_from+1; page_offset:=(p_page::bigint-1)*p_page_size;
 WITH pos AS MATERIALIZED (SELECT p.id FROM public.purchase_orders p WHERE p.order_date BETWEEN least(p_from,p_rolling_from) AND p_to AND (p_status='all' OR p.status::text=p_status)),
 lines AS (SELECT l.id,l.unit_price FROM public.po_line_items l JOIN pos p ON p.id=l.purchase_order_id),
 days AS (SELECT p_from+g::integer AS day FROM generate_series(least(page_offset,total_days::bigint),least(page_offset+p_page_size-1,total_days::bigint-1)) g),
 delivery_days AS (SELECT s.sj_date,sum(d.quantity_delivered::numeric*l.unit_price) AS value,count(DISTINCT s.id) AS sj_count
  FROM public.surat_jalan s JOIN pos p ON p.id=s.purchase_order_id JOIN public.sj_line_items d ON d.surat_jalan_id=s.id JOIN lines l ON l.id=d.po_line_item_id
  JOIN days day ON day.day=s.sj_date WHERE s.voided_at IS NULL GROUP BY s.sj_date)
 SELECT jsonb_build_object('version',1,'as_of',statement_timestamp(),'page',p_page,'page_size',p_page_size,'total',total_days,
  'items',coalesce(jsonb_agg(jsonb_build_object('key',d.day,'deliveredValue',coalesce(v.value,0)::text,'sjCount',coalesce(v.sj_count,0)) ORDER BY d.day),'[]'::jsonb)) INTO result FROM days d LEFT JOIN delivery_days v ON v.sj_date=d.day;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.pilot_customer_stats_v1(uuid[],date,integer),public.pilot_revenue_v1(timestamptz,timestamptz,integer,integer),public.pilot_customer_performance_v1(uuid,text,timestamptz,timestamptz,integer,integer),public.pilot_sales_performance_v1(uuid,date,date,timestamptz,timestamptz,text,integer,integer),public.pilot_team_activity_v1(uuid[],date,timestamptz,timestamptz,timestamptz),public.pilot_manager_customers_v1(uuid,timestamptz,timestamptz,integer,integer),public.pilot_athel_summary_v1(date,date,date,text,text),public.pilot_athel_daily_v1(date,date,date,text,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pilot_customer_stats_v1(uuid[],date,integer),public.pilot_revenue_v1(timestamptz,timestamptz,integer,integer),public.pilot_customer_performance_v1(uuid,text,timestamptz,timestamptz,integer,integer),public.pilot_sales_performance_v1(uuid,date,date,timestamptz,timestamptz,text,integer,integer),public.pilot_team_activity_v1(uuid[],date,timestamptz,timestamptz,timestamptz),public.pilot_manager_customers_v1(uuid,timestamptz,timestamptz,integer,integer),public.pilot_athel_summary_v1(date,date,date,text,text),public.pilot_athel_daily_v1(date,date,date,text,text,integer,integer) TO authenticated;
COMMIT;
