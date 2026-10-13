-- Forward-only canonical sales reporting. No historical credit/value/status changes.
BEGIN;
SET LOCAL search_path='';
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TEMP TABLE demo_sales_report_metadata ON COMMIT DROP AS
 SELECT p.oid,to_jsonb(p)-'prosrc' AS metadata FROM pg_proc p WHERE p.oid IN (
 'public.pilot_revenue_v1(timestamptz,timestamptz,integer,integer)'::regprocedure,
 'public.pilot_sales_performance_v1(uuid,date,date,timestamptz,timestamptz,text,integer,integer)'::regprocedure,
 'public.pilot_team_activity_v1(uuid[],date,timestamptz,timestamptz,timestamptz)'::regprocedure);
DO $preflight$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.pilot_revenue_v1(timestamptz,timestamptz,integer,integer)'::regprocedure)<>'5ec3423e268a22d450f6ffcc0aa0eff1'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.pilot_sales_performance_v1(uuid,date,date,timestamptz,timestamptz,text,integer,integer)'::regprocedure)<>'01f401844812233acbf1ec16e681dd85'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.pilot_team_activity_v1(uuid[],date,timestamptz,timestamptz,timestamptz)'::regprocedure)<>'c8eed1c9bcba0ee99128ff8ff44de189'
 THEN RAISE EXCEPTION 'Demo reporting source drift; migration refused'; END IF;
 IF EXISTS(SELECT 1 FROM pg_temp.demo_sales_report_metadata m JOIN pg_proc p ON p.oid=m.oid
 WHERE p.proowner<>'postgres'::regrole OR p.prosecdef OR p.provolatile<>'s' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
 OR has_function_privilege('anon',p.oid,'EXECUTE') OR NOT has_function_privilege('authenticated',p.oid,'EXECUTE'))
 THEN RAISE EXCEPTION 'Demo reporting metadata drift; migration refused'; END IF;
 IF EXISTS(SELECT 1 FROM (VALUES ('sales_person_id_at_creation','uuid'::regtype),('sales_assignment_source_id','uuid'::regtype),
 ('sales_attributed_at','timestamptz'::regtype),('sales_attribution_state','text'::regtype)) expected(name,type_id)
 WHERE NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.purchase_orders'::regclass AND a.attname=expected.name AND a.atttypid=expected.type_id AND NOT a.attisdropped))
 THEN RAISE EXCEPTION 'Immutable creation-attribution contract missing'; END IF;
END $preflight$;

-- This minimal, date-bounded projection is the only reporting bridge around PO RLS.
-- Authorization is explicit inside the definer; no generic PO, line or audit grant changes.
CREATE FUNCTION private.pilot_admin_sales_source_v1(p_from timestamptz,p_to timestamptz)
RETURNS TABLE(source_id uuid,customer_id uuid,sales_person_id uuid,created_at timestamptz,total_value numeric,revenue_eligible boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_role public.user_role:=public.current_user_role(); actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL OR v_role IS NULL OR v_role NOT IN ('po_admin','sales_head','executive','sales_manager','sales_person') THEN
  RAISE EXCEPTION 'Active sales-report audience required' USING ERRCODE='42501';
 END IF;
 IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from>p_to THEN
  RAISE EXCEPTION 'Invalid canonical sales bounds' USING ERRCODE='22023';
 END IF;
 RETURN QUERY SELECT p.id,p.customer_id,p.sales_person_id_at_creation,p.created_at,p.total_value,
 p.status IN ('confirm','in_progress','complete')
 FROM public.purchase_orders p
 WHERE p.sales_attribution_state IN ('assigned','unassigned') AND p.created_at BETWEEN p_from AND p_to
 -- Deduplication sees all lineage links, even if the original submitter is outside caller scope.
 AND NOT EXISTS(SELECT 1 FROM public.girard_orders o WHERE o.po_id=p.id)
 AND (v_role IN ('po_admin','sales_head','executive')
 OR (p.sales_attribution_state='assigned' AND (p.sales_person_id_at_creation=actor
 OR (v_role='sales_manager' AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=p.sales_person_id_at_creation AND u.manager_id=actor)))));
END $$;
REVOKE ALL ON FUNCTION private.pilot_admin_sales_source_v1(timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.pilot_admin_sales_source_v1(timestamptz,timestamptz) TO authenticated;

-- Legacy submissions retain their caller RLS and their recorded amount, date and status.
CREATE FUNCTION private.pilot_canonical_sales_source_v1(p_from timestamptz,p_to timestamptz)
RETURNS TABLE(source_kind text,source_id uuid,customer_id uuid,sales_person_id uuid,created_at timestamptz,total_value numeric,revenue_eligible boolean)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM private.pilot_read_guard_v1();
 IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from>p_to THEN
  RAISE EXCEPTION 'Invalid canonical sales bounds' USING ERRCODE='22023';
 END IF;
 RETURN QUERY SELECT 'girard'::text,o.id,o.customer_id,o.submitted_by,o.created_at,o.total_value,o.status='approved'
 FROM public.girard_orders o WHERE o.created_at BETWEEN p_from AND p_to
 UNION ALL SELECT 'admin_po'::text,p.source_id,p.customer_id,p.sales_person_id,p.created_at,p.total_value,p.revenue_eligible
 FROM private.pilot_admin_sales_source_v1(p_from,p_to) p;
END $$;
REVOKE ALL ON FUNCTION private.pilot_canonical_sales_source_v1(timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.pilot_canonical_sales_source_v1(timestamptz,timestamptz) TO authenticated;

-- Single aggregate for the earliest authorized admin creation, never a global timestamp.
CREATE FUNCTION private.pilot_admin_sales_start_v1(p_manager_id uuid) RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_role public.user_role:=public.current_user_role(); actor uuid:=auth.uid(); result timestamptz;
BEGIN
 PERFORM private.pilot_performance_scope_v1(p_manager_id,'2000-01');
 SELECT min(p.created_at) INTO result FROM public.purchase_orders p
 WHERE p.sales_attribution_state IN ('assigned','unassigned')
 AND NOT EXISTS(SELECT 1 FROM public.girard_orders o WHERE o.po_id=p.id)
 AND ((p.sales_attribution_state='unassigned' AND v_role IN ('po_admin','sales_head','executive'))
 OR (p.sales_attribution_state='assigned' AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=p.sales_person_id_at_creation
 AND u.is_active AND u.role IN ('sales_person','sales_manager','sales_head','executive')
 AND (p_manager_id IS NULL OR u.id=p_manager_id OR u.manager_id=p_manager_id)
 AND (v_role IN ('po_admin','sales_head','executive') OR u.id=actor OR (v_role='sales_manager' AND u.manager_id=actor)))));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION private.pilot_admin_sales_start_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.pilot_admin_sales_start_v1(uuid) TO authenticated;

CREATE FUNCTION public.pilot_sales_report_months_v1(p_manager_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM private.pilot_performance_scope_v1(p_manager_id,'2000-01');
 WITH cohort AS MATERIALIZED (SELECT u.id FROM public.users u WHERE u.is_active
 AND u.role IN ('sales_person','sales_manager','sales_head','executive')
 AND (p_manager_id IS NULL OR u.id=p_manager_id OR u.manager_id=p_manager_id)),
 schedules AS (SELECT min(s.scheduled_date) AS first_date FROM public.sales_schedules s JOIN cohort c ON c.id=s.sales_person_id),
 legacy AS (SELECT min(o.created_at) AS first_at FROM public.girard_orders o JOIN cohort c ON c.id=o.submitted_by)
 SELECT jsonb_build_object('version',1,'as_of',statement_timestamp(),'earliest_schedule_date',s.first_date,
 'earliest_order_at',least(l.first_at,private.pilot_admin_sales_start_v1(p_manager_id))) INTO result FROM schedules s CROSS JOIN legacy l;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.pilot_sales_report_months_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pilot_sales_report_months_v1(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pilot_revenue_v1(p_from timestamptz,p_to timestamptz,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM private.pilot_read_page_guard_v1(p_page,p_page_size);
 IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from>p_to THEN RAISE EXCEPTION 'Invalid revenue bounds' USING ERRCODE='22023'; END IF;
 WITH totals AS (SELECT o.customer_id,count(*) AS order_count,sum(o.total_value) AS total_sales,max(o.created_at) AS last_order_date
  FROM private.pilot_canonical_sales_source_v1(p_from,p_to) o WHERE o.revenue_eligible GROUP BY o.customer_id),
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

CREATE OR REPLACE FUNCTION public.pilot_sales_performance_v1(p_manager_id uuid,p_date_from date,p_date_to date,p_order_from timestamptz,p_order_to timestamptz,p_year_month text,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM private.pilot_read_page_guard_v1(p_page,p_page_size); PERFORM private.pilot_performance_scope_v1(p_manager_id,p_year_month);
 IF p_date_from IS NULL OR p_date_to IS NULL OR NOT isfinite(p_date_from) OR NOT isfinite(p_date_to) OR p_date_from>p_date_to OR p_order_from IS NULL OR p_order_to IS NULL OR NOT isfinite(p_order_from) OR NOT isfinite(p_order_to) OR p_order_from>p_order_to THEN RAISE EXCEPTION 'Invalid performance bounds' USING ERRCODE='22023'; END IF;
 WITH cohort AS MATERIALIZED (SELECT u.id,u.full_name FROM public.users u WHERE u.is_active AND u.role IN ('sales_person','sales_manager','sales_head','executive') AND (p_manager_id IS NULL OR u.id=p_manager_id OR u.manager_id=p_manager_id)),
 schedule_states AS (SELECT s.id,s.sales_person_id,s.status,EXISTS(SELECT 1 FROM public.outlet_visits v WHERE v.schedule_id=s.id) AS visited FROM public.sales_schedules s JOIN cohort c ON c.id=s.sales_person_id WHERE s.scheduled_date BETWEEN p_date_from AND p_date_to),
 schedules AS (SELECT sales_person_id,count(*) AS scheduled,count(*) FILTER(WHERE visited) AS visited,count(*) FILTER(WHERE NOT visited AND status='missed') AS missed FROM schedule_states GROUP BY sales_person_id),
 canonical AS MATERIALIZED (SELECT * FROM private.pilot_canonical_sales_source_v1(p_order_from,p_order_to)),
 orders AS (SELECT o.sales_person_id,count(*) AS orders,sum(o.total_value) AS total_sales FROM canonical o JOIN cohort c ON c.id=o.sales_person_id GROUP BY o.sales_person_id),
 unassigned AS (SELECT count(*) AS orders,coalesce(sum(total_value),0) AS total_sales FROM canonical WHERE sales_person_id IS NULL),
 targets AS (SELECT DISTINCT ON(t.user_id) t.user_id,t.target_value FROM public.sales_targets t JOIN cohort c ON c.id=t.user_id WHERE t.year_month<=p_year_month ORDER BY t.user_id,t.year_month DESC,t.id),
 metrics_rows AS (SELECT c.id,c.full_name,coalesce(s.scheduled,0) AS scheduled,coalesce(s.visited,0) AS visited,coalesce(s.missed,0) AS missed,
  coalesce(o.orders,0) AS orders,coalesce(o.total_sales,0) AS total_sales,CASE WHEN s.scheduled>0 THEN round(100*s.visited::numeric/s.scheduled) ELSE 0 END AS visit_rate,t.target_value AS sales_target
  FROM cohort c LEFT JOIN schedules s ON s.sales_person_id=c.id LEFT JOIN orders o ON o.sales_person_id=c.id LEFT JOIN targets t ON t.user_id=c.id),
 rows AS MATERIALIZED (SELECT m.*,jsonb_build_object('id',id,'full_name',full_name,'scheduled',scheduled,'visited',visited,'missed',missed,'orders',orders,'total_sales',total_sales::text,'visit_rate',visit_rate,'sales_target',sales_target::text) AS data FROM metrics_rows m),
 page_rows AS (SELECT * FROM rows ORDER BY full_name,id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size)
 SELECT jsonb_build_object('version',1,'as_of',statement_timestamp(),'page',p_page,'page_size',p_page_size,'total',(SELECT count(*) FROM rows),
  'items',coalesce((SELECT jsonb_agg(data ORDER BY full_name,id) FROM page_rows),'[]'::jsonb),
  'summary',(SELECT jsonb_build_object('total_visited',coalesce(sum(visited),0),'total_scheduled',coalesce(sum(scheduled),0),'total_orders',coalesce(sum(orders),0)+(SELECT orders FROM unassigned),'total_sales',(coalesce(sum(total_sales),0)+(SELECT total_sales FROM unassigned))::text,'average_visit_rate',coalesce(round(avg(visit_rate)),0),
  'unassigned_orders',(SELECT orders FROM unassigned),'unassigned_sales',(SELECT total_sales::text FROM unassigned)) FROM rows)) INTO result;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.pilot_team_activity_v1(p_user_ids uuid[],p_day date,p_order_from timestamptz,p_order_to timestamptz,p_week_from timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM private.pilot_read_guard_v1();
 IF p_user_ids IS NULL OR cardinality(p_user_ids)>100 OR array_position(p_user_ids,NULL) IS NOT NULL OR p_day IS NULL OR NOT isfinite(p_day) OR p_order_from IS NULL OR p_order_to IS NULL OR p_week_from IS NULL OR NOT isfinite(p_order_from) OR NOT isfinite(p_order_to) OR NOT isfinite(p_week_from) OR p_order_from>p_order_to THEN RAISE EXCEPTION 'Invalid activity bounds or users' USING ERRCODE='22023'; END IF;
 WITH cohort AS MATERIALIZED (SELECT u.id FROM public.users u WHERE u.id=ANY(p_user_ids)),
 schedule_states AS (SELECT s.id,s.sales_person_id,EXISTS(SELECT 1 FROM public.outlet_visits v WHERE v.schedule_id=s.id) AS visited FROM public.sales_schedules s JOIN cohort c ON c.id=s.sales_person_id WHERE s.scheduled_date=p_day),
 schedules AS (SELECT sales_person_id,count(*) AS scheduled,count(*) FILTER(WHERE visited) AS visited FROM schedule_states GROUP BY sales_person_id),
 orders AS (SELECT o.sales_person_id,count(*) AS count FROM private.pilot_canonical_sales_source_v1(p_order_from,p_order_to) o JOIN cohort c ON c.id=o.sales_person_id GROUP BY o.sales_person_id),
 visits AS (SELECT v.sales_person_id,count(*) AS count FROM public.outlet_visits v JOIN cohort c ON c.id=v.sales_person_id WHERE v.checked_in_at>=p_week_from GROUP BY v.sales_person_id)
 SELECT jsonb_build_object('version',1,'as_of',statement_timestamp(),'items',coalesce(jsonb_agg(jsonb_build_object('sales_person_id',c.id,
  'total_scheduled',coalesce(s.scheduled,0),'total_visited',coalesce(s.visited,0),'total_orders',coalesce(o.count,0),'weekly_visits',coalesce(v.count,0)) ORDER BY c.id),'[]'::jsonb)) INTO result
 FROM cohort c LEFT JOIN schedules s ON s.sales_person_id=c.id LEFT JOIN orders o ON o.sales_person_id=c.id LEFT JOIN visits v ON v.sales_person_id=c.id;
 RETURN result;
END $$;

DO $postflight$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_temp.demo_sales_report_metadata m JOIN pg_proc p ON p.oid=m.oid
 WHERE to_jsonb(p)-'prosrc' IS DISTINCT FROM m.metadata) THEN RAISE EXCEPTION 'Existing reporting metadata changed'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid IN (
 'private.pilot_admin_sales_source_v1(timestamptz,timestamptz)'::regprocedure,
 'private.pilot_canonical_sales_source_v1(timestamptz,timestamptz)'::regprocedure,
 'private.pilot_admin_sales_start_v1(uuid)'::regprocedure,
 'public.pilot_sales_report_months_v1(uuid)'::regprocedure) AND (p.proowner<>'postgres'::regrole
 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] OR p.provolatile<>'s'
 OR has_function_privilege('anon',p.oid,'EXECUTE') OR NOT has_function_privilege('authenticated',p.oid,'EXECUTE')))
 THEN RAISE EXCEPTION 'New reporting function metadata/ACL mismatch'; END IF;
END $postflight$;
COMMIT;
