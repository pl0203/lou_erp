-- Same psql connection, real authenticated RLS, one statement per RPC invocation.
-- Acceptance regression, not API/browser latency or hosted capacity evidence.
-- Requires the unchanged disposable 6k fixture and reviewed read migrations.
-- Expected rows come from owner-created fixture snapshots and explicit actor
-- cohorts, never from another RPC or from application RLS predicates.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL plan_cache_mode=auto;
DO $guard$ BEGIN
 IF current_user<>'postgres' OR current_database()<>'pilot_test'
 OR current_setting('session_replication_role')<>'origin'
 OR (SELECT count(*) FROM public.pilot_fixture_marker)<>1
 OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci')
 OR (SELECT count(*) FROM public.pilot_scale_manifest)<>1
 OR (SELECT manifest->'base'->>'purchase_orders' FROM public.pilot_scale_manifest) IS DISTINCT FROM '6000'
 OR (SELECT count(*) FROM public.purchase_orders)<>6007
 OR (SELECT count(*) FROM public.po_line_items)<>60007
 OR (SELECT count(*) FROM public.surat_jalan)<>12005
 OR (SELECT count(*) FROM public.sj_line_items)<>120005
 OR (SELECT count(*) FROM public.girard_orders)<>6007
 OR (SELECT count(*) FROM public.customers)<>101
 OR (SELECT count(*) FROM public.users)<>8
 OR EXISTS(SELECT 1 FROM public.outlet_visits)
 THEN RAISE EXCEPTION 'Unchanged disposable 6k fixture required'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('authenticated','anon') AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'Application role must enforce RLS'; END IF;
 IF EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name='pooled_read') THEN RAISE EXCEPTION 'Unexpected existing pooled statement'; END IF;
END $guard$;

CREATE TEMP TABLE pooled_actors AS
SELECT n,('84000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid AS id,
 CASE n WHEN 1 THEN 'executive' WHEN 2 THEN 'sales_manager' WHEN 3 THEN 'sales_manager'
 WHEN 4 THEN 'sales_person' WHEN 5 THEN 'sales_person' WHEN 6 THEN 'po_admin'
 WHEN 7 THEN 'sales_head' ELSE 'executive' END AS role,
 CASE WHEN n IN(2,4) THEN 'A' WHEN n IN(3,5) THEN 'B' ELSE 'all' END AS scope,
 CASE n WHEN 4 THEN 2 WHEN 5 THEN 3 END AS manager_n
FROM generate_series(1,8) n;
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_temp.pooled_actors a LEFT JOIN public.users u ON u.id=a.id
 WHERE u.role::text IS DISTINCT FROM a.role OR u.is_active IS DISTINCT FROM (a.n<>8)
 OR u.manager_id IS DISTINCT FROM (SELECT id FROM pg_temp.pooled_actors WHERE n=a.manager_n)) THEN
  RAISE EXCEPTION 'Synthetic role/manager identity mismatch'; END IF;
END $guard$;
CREATE TEMP TABLE pooled_customers AS
SELECT c.*,n,CASE WHEN n%2=1 THEN 'A' ELSE 'B' END AS scope,
 CASE WHEN n%2=1 THEN 2 ELSE 3 END AS manager_n
FROM public.customers c JOIN generate_series(1,101) n ON c.id=md5('scale-customer-'||n)::uuid;
CREATE TEMP TABLE pooled_lines AS
SELECT l.*,coalesce(d.delivered,0) AS delivered,coalesce(d.history,false) AS history
FROM public.po_line_items l LEFT JOIN (
 SELECT d.po_line_item_id,sum(d.quantity_delivered) FILTER(WHERE h.voided_at IS NULL) AS delivered,true AS history
 FROM public.sj_line_items d JOIN public.surat_jalan h ON h.id=d.surat_jalan_id GROUP BY d.po_line_item_id
) d ON d.po_line_item_id=l.id;
CREATE TEMP TABLE pooled_pos AS
SELECT p.*,c.scope,c.name AS customer_name,
 l.delivered,l.remaining_qty,l.remaining_value,h.purchase_order_id IS NOT NULL AS history
FROM public.purchase_orders p JOIN pg_temp.pooled_customers c ON c.id=p.customer_id
JOIN (SELECT purchase_order_id,sum(delivered*unit_price) AS delivered,sum(greatest(0,quantity-delivered)) AS remaining_qty,
 sum(greatest(0,quantity-delivered)*unit_price) AS remaining_value FROM pg_temp.pooled_lines GROUP BY purchase_order_id) l ON l.purchase_order_id=p.id
LEFT JOIN (SELECT DISTINCT purchase_order_id FROM public.surat_jalan) h ON h.purchase_order_id=p.id;
CREATE TEMP TABLE pooled_delivery AS
SELECT h.id,h.purchase_order_id,h.sj_date,sum(d.quantity_delivered*l.unit_price) AS value
FROM public.surat_jalan h JOIN public.sj_line_items d ON d.surat_jalan_id=h.id
JOIN public.po_line_items l ON l.id=d.po_line_item_id WHERE h.voided_at IS NULL
GROUP BY h.id,h.purchase_order_id,h.sj_date;
CREATE TEMP TABLE pooled_orders AS
SELECT o.*,a.scope,a.n AS actor_n,c.name AS customer_name
FROM public.girard_orders o JOIN pg_temp.pooled_actors a ON a.id=o.submitted_by
JOIN pg_temp.pooled_customers c ON c.id=o.customer_id;
CREATE INDEX ON pooled_lines(purchase_order_id);
CREATE INDEX ON pooled_pos(id);
CREATE INDEX ON pooled_delivery(purchase_order_id);
CREATE INDEX ON pooled_orders(customer_id);
ANALYZE pooled_lines; ANALYZE pooled_pos; ANALYZE pooled_delivery; ANALYZE pooled_orders;
DO $guard$ BEGIN
 IF (SELECT count(*) FROM pg_temp.pooled_pos WHERE scope='A')<>3007
 OR (SELECT count(*) FROM pg_temp.pooled_pos WHERE scope='B')<>3000
 OR (SELECT count(*) FROM pg_temp.pooled_customers WHERE scope='A')<>51
 OR (SELECT count(*) FROM pg_temp.pooled_orders WHERE scope='A')<>3007
 OR (SELECT sum(total_value) FROM pg_temp.pooled_pos)<>6000600
 OR (SELECT sum(value) FROM pg_temp.pooled_delivery)<>3000180 THEN
  RAISE EXCEPTION 'Independent fixture cohort/totals mismatch'; END IF;
END $guard$;

-- Decimal values are compared numerically without losing integer precision.
-- Wire-type/format validation remains in the existing contract test suites.
CREATE FUNCTION pg_temp.pooled_normalize(v jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $fn$
 SELECT CASE jsonb_typeof(v)
 WHEN 'object' THEN coalesce((SELECT jsonb_object_agg(key,pg_temp.pooled_normalize(value)) FROM jsonb_each(v)),'{}'::jsonb)
 WHEN 'array' THEN coalesce((SELECT jsonb_agg(pg_temp.pooled_normalize(value) ORDER BY ord) FROM jsonb_array_elements(v) WITH ORDINALITY a(value,ord)),'[]'::jsonb)
 WHEN 'string' THEN CASE WHEN (v#>>'{}') ~ '^-?[0-9]+([.][0-9]+)?$' THEN to_jsonb((v#>>'{}')::numeric) ELSE v END
 ELSE v END
$fn$;
CREATE FUNCTION pg_temp.pooled_user_visible(requester integer,target integer) RETURNS boolean LANGUAGE sql IMMUTABLE AS $fn$
 SELECT requester IN(1,6,7) OR requester=target OR (requester=2 AND target=4)
 OR (requester=3 AND target=5) OR (requester=4 AND target=2) OR (requester=5 AND target=3)
$fn$;

-- The oracle uses independently materialized facts plus fixture invariants:
-- zero visits; September schedules on the30th; targets1000 before August and
-- 2000 from August; odd/even customers belong to manager A/B respectively.
CREATE FUNCTION pg_temp.pooled_expected(actor integer,rpc text,narrow boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER AS $expected$
DECLARE scope_name text; from_day date:=CASE WHEN narrow THEN '2026-07-01'::date ELSE '2026-09-01'::date END;
 until_day date:=(from_day+interval '1 month')::date; result jsonb; po_id uuid; manager integer;
BEGIN
 SELECT scope INTO scope_name FROM pg_temp.pooled_actors WHERE n=actor;
 manager:=CASE WHEN actor IN(3,5) THEN 3 ELSE 2 END;
 IF rpc='po' THEN
  WITH rows AS (SELECT * FROM pg_temp.pooled_pos WHERE (scope_name='all' OR scope=scope_name) AND (NOT narrow OR status='cancelled'))
  SELECT jsonb_build_object('page',1,'page_size',10,'total',(SELECT count(*) FROM rows),'items',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',id,'po_number',po_number,'status',status,'order_date',order_date,'expected_delivery_date',expected_delivery_date,'total_value',total_value,
   'customer_id',customer_id,'customers',jsonb_build_object('name',customer_name)) ORDER BY created_at DESC,id DESC)
   FROM (SELECT * FROM rows ORDER BY created_at DESC,id DESC LIMIT 10) page),'[]'::jsonb)) INTO result;
 ELSIF rpc='sales' THEN
  WITH rows AS (SELECT * FROM pg_temp.pooled_orders WHERE (scope_name='all' OR scope=scope_name) AND (NOT narrow OR (status='approved' AND actor_n=actor)))
  SELECT jsonb_build_object('page',1,'page_size',10,'total',(SELECT count(*) FROM rows),
   'status_counts',(SELECT jsonb_build_object('pending',count(*) FILTER(WHERE status='pending'),'approved',count(*) FILTER(WHERE status='approved'),'rejected',count(*) FILTER(WHERE status='rejected'),'cancelled',count(*) FILTER(WHERE status='cancelled')) FROM rows),
   'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'status',status,'total_value',total_value,'created_at',created_at,
   'rejection_note',rejection_note,'customers',jsonb_build_object('name',customer_name),'users',jsonb_build_object('full_name','SCALE USER '||actor_n)) ORDER BY created_at DESC,id DESC)
   FROM (SELECT * FROM rows ORDER BY created_at DESC,id DESC LIMIT 10) page),'[]'::jsonb)) INTO result;
 ELSIF rpc='lines' THEN
  po_id:=CASE WHEN narrow AND scope_name<>'B' THEN md5('scale-edge-void_history')::uuid
   ELSE md5('scale-po-'||CASE WHEN scope_name='B' THEN CASE WHEN narrow THEN 4 ELSE 2 END ELSE 1 END)::uuid END;
  SELECT jsonb_build_object('page',1,'page_size',CASE WHEN narrow THEN 5 ELSE 10 END,'total',(SELECT count(*) FROM pg_temp.pooled_lines WHERE purchase_order_id=po_id),
   'po_updated_at',p.updated_at,'po_has_delivery_history',p.history,'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'product_name',product_name,
   'sku',sku,'quantity',quantity,'unit_price',unit_price,'line_total',line_total,'delivered_quantity',delivered,'has_delivery_history',history) ORDER BY id)
   FROM (SELECT * FROM pg_temp.pooled_lines WHERE purchase_order_id=po_id ORDER BY id LIMIT CASE WHEN narrow THEN 5 ELSE 10 END) page),'[]'::jsonb))
   INTO result FROM pg_temp.pooled_pos p WHERE p.id=po_id;
 ELSIF rpc='summary' THEN
  -- Compare all six card metrics, exact status buckets and all12 monthly buckets.
  -- Existing small-data summary parity tests cover ranking/label DTOs separately.
  WITH history AS (SELECT * FROM pg_temp.pooled_pos WHERE (scope_name='all' OR scope=scope_name)
   AND order_date BETWEEN '2025-10-01' AND '2026-09-30' AND (NOT narrow OR status='confirm')),
  selected AS (SELECT * FROM history WHERE order_date>=CASE WHEN narrow THEN '2026-09-01'::date ELSE '2026-07-01'::date END AND (NOT narrow OR delivered=0)),
  month_keys AS (SELECT ('2025-10-01'::date+i*interval '1 month')::date AS day FROM generate_series(0,11) i)
  SELECT jsonb_build_object('metrics',(SELECT jsonb_build_object('totalPOCount',count(*),'totalPOValue',coalesce(sum(total_value),0),
   'deliveredValue',coalesce(sum(delivered),0),'outstandingValue',coalesce(sum(remaining_value),0),'averagePOValue',coalesce(avg(total_value),0),
   'completedPOCount',count(*) FILTER(WHERE status='complete')) FROM selected),
   'statusBreakdown',coalesce((SELECT jsonb_agg(jsonb_build_object('status',status,'value',n) ORDER BY status::text) FROM (SELECT status,count(*) n FROM selected GROUP BY status) s),'[]'::jsonb),
   'monthlySeries',(SELECT jsonb_agg(jsonb_build_object('key',to_char(day,'YYYY-MM'),'poValue',
    (SELECT coalesce(sum(total_value),0) FROM selected WHERE order_date>=day AND order_date<day+interval '1 month'),
    'deliveredValue',(SELECT coalesce(sum(d.value),0) FROM pg_temp.pooled_delivery d JOIN history h ON h.id=d.purchase_order_id WHERE d.sj_date>=day AND d.sj_date<day+interval '1 month')) ORDER BY day) FROM month_keys)) INTO result;
 ELSIF rpc='daily' THEN
  WITH days AS (SELECT '2026-09-01'::date+i AS day FROM generate_series(0,CASE WHEN narrow THEN 14 ELSE 29 END) i),
  deliveries AS (SELECT d.* FROM pg_temp.pooled_delivery d JOIN pg_temp.pooled_pos p ON p.id=d.purchase_order_id
   WHERE (scope_name='all' OR p.scope=scope_name) AND p.order_date BETWEEN '2025-10-01' AND CASE WHEN narrow THEN '2026-09-15'::date ELSE '2026-09-30'::date END
   AND (NOT narrow OR p.status='cancelled'))
  SELECT jsonb_build_object('page',1,'page_size',30,'total',CASE WHEN narrow THEN 15 ELSE 30 END,'items',
   (SELECT jsonb_agg(jsonb_build_object('key',day,'deliveredValue',(SELECT coalesce(sum(value),0) FROM deliveries WHERE sj_date=day),
    'sjCount',(SELECT count(*) FROM deliveries WHERE sj_date=day)) ORDER BY day) FROM days)) INTO result;
 ELSIF rpc='stats' THEN
  WITH customers AS (SELECT * FROM pg_temp.pooled_customers WHERE (scope_name='all' OR scope=scope_name) AND n IN(CASE WHEN narrow THEN 3 ELSE 1 END,CASE WHEN narrow THEN 4 ELSE 2 END))
  SELECT jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('customer_id',c.id,
   'first_order_date',(SELECT min(order_date) FROM pg_temp.pooled_pos WHERE customer_id=c.id),
   'order_count',(SELECT count(*) FROM pg_temp.pooled_pos WHERE customer_id=c.id AND order_date>=CASE WHEN narrow THEN '2026-09-01'::date ELSE '2026-07-01'::date END),
   'total_sales',(SELECT coalesce(sum(d.value),0) FROM pg_temp.pooled_delivery d JOIN pg_temp.pooled_pos p ON p.id=d.purchase_order_id
     WHERE p.customer_id=c.id AND p.status IN('in_progress','complete') AND d.sj_date>=CASE WHEN narrow THEN '2026-09-01'::date ELSE '2026-07-01'::date END),
   'top_items',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',product_name,'revenue',value) ORDER BY value DESC,product_name),'[]'::jsonb)
    FROM (SELECT l.product_name,sum(l.line_total) value FROM pg_temp.pooled_lines l JOIN pg_temp.pooled_pos p ON p.id=l.purchase_order_id WHERE p.customer_id=c.id
     GROUP BY l.product_name ORDER BY value DESC,l.product_name LIMIT CASE WHEN narrow THEN 1 ELSE 3 END) top_items)
   ) ORDER BY c.id),'[]'::jsonb)) INTO result FROM customers c;
 ELSIF rpc='revenue' THEN
  WITH totals AS (SELECT customer_id,count(*) order_count,sum(total_value) total_sales,max(created_at) last_order_date
   FROM pg_temp.pooled_orders WHERE (scope_name='all' OR scope=scope_name) AND status='approved' AND created_at>=from_day::timestamptz
   AND created_at<=(until_day::timestamptz-interval '1 second') GROUP BY customer_id),
  rows AS (SELECT t.*,jsonb_build_object('customer_id',c.id,'customer_name',c.name,'manager_name','SCALE USER '||c.manager_n,
   'order_count',order_count,'total_sales',total_sales,'last_order_date',last_order_date) data FROM totals t JOIN pg_temp.pooled_customers c ON c.id=t.customer_id)
  SELECT jsonb_build_object('page',1,'page_size',10,'total',(SELECT count(*) FROM rows),
   'items',coalesce((SELECT jsonb_agg(data ORDER BY total_sales DESC,customer_id) FROM (SELECT * FROM rows ORDER BY total_sales DESC,customer_id LIMIT 10) page),'[]'::jsonb),
   'summary',(SELECT jsonb_build_object('total_sales',coalesce(sum(total_sales),0),'total_orders',coalesce(sum(order_count),0),'active_customers',count(*),
    'top_customer',(SELECT data FROM rows ORDER BY total_sales DESC,customer_id LIMIT 1)) FROM rows)) INTO result;
 ELSIF rpc='customers' THEN
  WITH rows AS (SELECT c.*,jsonb_build_object('id',c.id,'name',c.name,'manager_name',CASE WHEN actor IN(2,3) THEN NULL ELSE 'SCALE USER '||c.manager_n END,
   'actual_visits',0,'target_visits',5,'last_visit_date',NULL,
   'order_count',(SELECT count(*) FROM pg_temp.pooled_pos p WHERE p.customer_id=c.id AND order_date>=from_day AND order_date<until_day),
   'total_sales',(SELECT coalesce(sum(d.value),0) FROM pg_temp.pooled_delivery d JOIN pg_temp.pooled_pos p ON p.id=d.purchase_order_id
    WHERE p.customer_id=c.id AND p.status IN('in_progress','complete') AND d.sj_date>=from_day AND d.sj_date<until_day),
   'sales_target',CASE WHEN narrow THEN 1000 ELSE 2000 END) data
   FROM pg_temp.pooled_customers c WHERE scope_name='all' OR c.scope=scope_name)
  SELECT jsonb_build_object('page',1,'page_size',10,'total',(SELECT count(*) FROM rows),
   'items',coalesce((SELECT jsonb_agg(data ORDER BY name,id) FROM (SELECT * FROM rows ORDER BY name,id LIMIT 10) page),'[]'::jsonb),
   'summary',(SELECT jsonb_build_object('total_sales',coalesce(sum((data->>'total_sales')::numeric),0),'active_customers',count(*) FILTER(WHERE (data->>'order_count')::integer>0),
    'total_customers',count(*),'total_visits',0,'total_target_visits',count(*)*5,'visit_percent',0,
    'top_customer',(SELECT data FROM rows ORDER BY (data->>'total_sales')::numeric DESC,id LIMIT 1)) FROM rows)) INTO result;
 ELSIF rpc='performance' THEN
  WITH rows AS (SELECT a.*,jsonb_build_object('id',a.id,'full_name','SCALE USER '||a.n,
   'scheduled',CASE WHEN narrow THEN 0 WHEN a.n=4 THEN 51 WHEN a.n=5 THEN 50 ELSE 0 END,'visited',0,'missed',0,
   'orders',(SELECT count(*) FROM pg_temp.pooled_orders o WHERE o.actor_n=a.n AND (scope_name='all' OR o.scope=scope_name) AND created_at>=from_day::timestamptz AND created_at<=until_day::timestamptz-interval '1 second'),
   'total_sales',(SELECT coalesce(sum(total_value),0) FROM pg_temp.pooled_orders o WHERE o.actor_n=a.n AND (scope_name='all' OR o.scope=scope_name) AND created_at>=from_day::timestamptz AND created_at<=until_day::timestamptz-interval '1 second'),
   'visit_rate',0,'sales_target',CASE WHEN a.n IN(2,3,4,5) AND (actor NOT IN(4,5) OR actor=a.n) THEN CASE WHEN narrow THEN 1000 ELSE 2000 END ELSE NULL END) data
   FROM pg_temp.pooled_actors a WHERE pg_temp.pooled_user_visible(actor,a.n) AND a.n NOT IN(6,8))
  SELECT jsonb_build_object('page',1,'page_size',10,'total',(SELECT count(*) FROM rows),'items',coalesce((SELECT jsonb_agg(data ORDER BY n) FROM rows),'[]'::jsonb),
   'summary',(SELECT jsonb_build_object('total_visited',0,'total_scheduled',coalesce(sum((data->>'scheduled')::integer),0),'total_orders',coalesce(sum((data->>'orders')::integer),0),
    'total_sales',coalesce(sum((data->>'total_sales')::numeric),0),'average_visit_rate',0) FROM rows)) INTO result;
 ELSIF rpc='activity' THEN
  SELECT jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('sales_person_id',a.id,
   'total_scheduled',CASE WHEN narrow THEN 0 WHEN a.n=4 THEN 51 WHEN a.n=5 THEN 50 ELSE 0 END,'total_visited',0,
   'total_orders',(SELECT count(*) FROM pg_temp.pooled_orders o WHERE o.actor_n=a.n AND (scope_name='all' OR o.scope=scope_name) AND created_at>=from_day::timestamptz AND created_at<=until_day::timestamptz-interval '1 second'),
   'weekly_visits',0) ORDER BY a.id),'[]'::jsonb)) INTO result
   FROM pg_temp.pooled_actors a WHERE pg_temp.pooled_user_visible(actor,a.n) AND (NOT narrow OR a.n=5);
 ELSIF rpc='manager_customers' THEN
  IF narrow THEN manager:=CASE WHEN manager=2 THEN 3 ELSE 2 END; END IF;
  WITH rows AS (SELECT * FROM pg_temp.pooled_customers c WHERE (scope_name='all' OR scope=scope_name) AND manager_n=manager)
  SELECT jsonb_build_object('page',1,'page_size',10,'total',(SELECT count(*) FROM rows),'items',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',id,'name',name,'address',address,'city',city,'last_visit_date',last_visit_date,'visit_frequency_days',7,'visits_this_period',0,'target_visits',5,'on_track',false) ORDER BY name,id)
    FROM (SELECT * FROM rows ORDER BY name,id LIMIT 10) page),'[]'::jsonb),
   'summary',(SELECT jsonb_build_object('on_track',0,'overdue',count(*),'total',count(*)) FROM rows)) INTO result;
 ELSE RAISE EXCEPTION 'Unknown pooled RPC oracle'; END IF;
 RETURN pg_temp.pooled_normalize(result);
END $expected$;

CREATE TEMP TABLE pooled_evidence(actor integer,rpc text,narrow boolean,plan_mode text,rpc_elapsed_ms numeric,assertion_elapsed_ms numeric,result text);
CREATE FUNCTION pg_temp.pooled_check(actor integer,rpc text,narrow boolean) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER AS $check$
DECLARE profile pg_temp.pooled_actors%ROWTYPE; r jsonb; wanted jsonb; manager uuid; po_id uuid;
 from_day date:=CASE WHEN narrow THEN '2026-07-01'::date ELSE '2026-09-01'::date END;
 until_day date:=(from_day+interval '1 month')::date; started timestamptz:=clock_timestamp(); rpc_finished timestamptz;
BEGIN
 SELECT * INTO profile FROM pg_temp.pooled_actors WHERE n=actor;
 IF current_user<>'authenticated' OR auth.uid() IS DISTINCT FROM profile.id OR public.current_user_role()::text IS DISTINCT FROM profile.role
 OR (SELECT setting::bigint FROM pg_settings WHERE name='statement_timeout')<>60000
 OR EXISTS(SELECT 1 FROM unnest(ARRAY['purchase_orders','po_line_items','surat_jalan','sj_line_items','customers','users','girard_orders','outlet_visits','sales_schedules']) t(name)
   WHERE NOT row_security_active(('public.'||t.name)::regclass)) THEN RAISE EXCEPTION 'Pooled actor/role/RLS/timeout mismatch'; END IF;
 manager:=CASE WHEN actor IN(2,3) THEN profile.id ELSE NULL END;
 RAISE NOTICE 'POOLED_RPC_START actor=% rpc=% narrow=% plan_mode=%',actor,rpc,narrow,current_setting('plan_cache_mode');
 started:=clock_timestamp();
 -- Each branch is a static PL/pgSQL statement, so PostgreSQL can cache its
 -- plans across these separate top-level calls and cross the sixth-call point.
 CASE rpc
 WHEN 'po' THEN r:=public.pilot_po_page_v1(CASE WHEN narrow THEN 'cancelled' ELSE 'all' END,CASE WHEN narrow THEN 'SCALE' ELSE '' END,1,10);
 WHEN 'sales' THEN r:=public.pilot_sales_order_page_v1(CASE WHEN narrow THEN 'approved' ELSE 'all' END,narrow,1,10,NULL,NULL);
 WHEN 'lines' THEN
  po_id:=CASE WHEN narrow AND profile.scope<>'B' THEN md5('scale-edge-void_history')::uuid
   ELSE md5('scale-po-'||CASE WHEN profile.scope='B' THEN CASE WHEN narrow THEN 4 ELSE 2 END ELSE 1 END)::uuid END;
  r:=public.pilot_po_lines_v1(po_id,1,CASE WHEN narrow THEN 5 ELSE 10 END,NULL);
 WHEN 'summary' THEN r:=public.pilot_athel_summary_v1(CASE WHEN narrow THEN '2026-09-01'::date ELSE '2026-07-01'::date END,'2026-09-30','2025-10-01',CASE WHEN narrow THEN 'confirm' ELSE 'all' END,CASE WHEN narrow THEN 'undelivered' ELSE 'all' END);
 WHEN 'daily' THEN r:=public.pilot_athel_daily_v1('2026-09-01',CASE WHEN narrow THEN '2026-09-15'::date ELSE '2026-09-30'::date END,'2025-10-01',CASE WHEN narrow THEN 'cancelled' ELSE 'all' END,'all',1,30);
 WHEN 'stats' THEN r:=public.pilot_customer_stats_v1(ARRAY[md5('scale-customer-'||CASE WHEN narrow THEN 3 ELSE 1 END)::uuid,md5('scale-customer-'||CASE WHEN narrow THEN 4 ELSE 2 END)::uuid],CASE WHEN narrow THEN '2026-09-01'::date ELSE '2026-07-01'::date END,CASE WHEN narrow THEN 1 ELSE 3 END);
 WHEN 'revenue' THEN r:=public.pilot_revenue_v1(from_day::timestamptz,until_day::timestamptz-interval '1 second',1,10);
 WHEN 'customers' THEN r:=public.pilot_customer_performance_v1(manager,to_char(from_day,'YYYY-MM'),from_day::timestamptz,until_day::timestamptz,1,10);
 WHEN 'performance' THEN r:=public.pilot_sales_performance_v1(manager,from_day,until_day-1,from_day::timestamptz,until_day::timestamptz-interval '1 second',to_char(from_day,'YYYY-MM'),1,10);
 WHEN 'activity' THEN r:=public.pilot_team_activity_v1(CASE WHEN narrow THEN ARRAY['84000000-0000-0000-0000-000000000005'::uuid,'84000000-0000-0000-0000-000000000099'::uuid]
   ELSE ARRAY(SELECT id FROM pg_temp.pooled_actors ORDER BY n) END,until_day-1,from_day::timestamptz,until_day::timestamptz-interval '1 second',from_day::timestamptz);
 WHEN 'manager_customers' THEN
  manager:=(SELECT id FROM pg_temp.pooled_actors WHERE n=CASE WHEN narrow THEN CASE WHEN actor IN(3,5) THEN 2 ELSE 3 END ELSE CASE WHEN actor IN(3,5) THEN 3 ELSE 2 END END);
  r:=public.pilot_manager_customers_v1(manager,'2026-09-01','2026-09-30T23:59:59Z',1,10);
 ELSE RAISE EXCEPTION 'Unknown pooled RPC'; END CASE;
 rpc_finished:=clock_timestamp();
 IF r->>'version' IS DISTINCT FROM '1' OR r->>'as_of' IS NULL THEN RAISE EXCEPTION 'Invalid read envelope'; END IF;
 r:=r-'version'-'as_of';
 IF rpc='summary' THEN r:=jsonb_build_object('metrics',r->'metrics','statusBreakdown',r->'statusBreakdown','monthlySeries',r->'monthlySeries'); END IF;
 wanted:=pg_temp.pooled_expected(actor,rpc,narrow);
 IF pg_temp.pooled_normalize(r) IS DISTINCT FROM wanted THEN
  RAISE EXCEPTION 'Pooled exact result mismatch actor %, rpc %, narrow %: expected %, actual %',actor,rpc,narrow,wanted,r; END IF;
 INSERT INTO pg_temp.pooled_evidence VALUES(actor,rpc,narrow,current_setting('plan_cache_mode'),
  extract(epoch FROM rpc_finished-started)*1000,extract(epoch FROM clock_timestamp()-started)*1000,'verified');
 RETURN format('POOLED_RPC_VERIFIED actor=%s rpc=%s narrow=%s',actor,rpc,narrow);
END $check$;

-- Fail-closed checks use the same connection after successful pooled calls.
CREATE FUNCTION pg_temp.pooled_denied(rpc text) RETURNS text LANGUAGE plpgsql SECURITY INVOKER AS $denied$
BEGIN
 IF current_user NOT IN('authenticated','anon') THEN RAISE EXCEPTION 'Denied probe requires an application role'; END IF;
 IF current_user='authenticated' THEN
  IF public.current_user_role() IS NOT NULL THEN RAISE EXCEPTION 'Denied probe requires an inactive/missing identity'; END IF;
 END IF;
 BEGIN
  CASE rpc
  WHEN 'po' THEN PERFORM public.pilot_po_page_v1('all','',1,10);
  WHEN 'sales' THEN PERFORM public.pilot_sales_order_page_v1('all',false,1,10,NULL,NULL);
  WHEN 'lines' THEN PERFORM public.pilot_po_lines_v1(md5('scale-po-1')::uuid,1,10,NULL);
  WHEN 'summary' THEN PERFORM public.pilot_athel_summary_v1('2026-07-01','2026-09-30','2025-10-01','all','all');
  WHEN 'daily' THEN PERFORM public.pilot_athel_daily_v1('2026-09-01','2026-09-30','2025-10-01','all','all',1,30);
  WHEN 'stats' THEN PERFORM public.pilot_customer_stats_v1(ARRAY[md5('scale-customer-1')::uuid],'2026-07-01',3);
  WHEN 'revenue' THEN PERFORM public.pilot_revenue_v1('2026-09-01','2026-09-30T23:59:59Z',1,10);
  WHEN 'customers' THEN PERFORM public.pilot_customer_performance_v1(NULL,'2026-09','2026-09-01','2026-10-01',1,10);
  WHEN 'performance' THEN PERFORM public.pilot_sales_performance_v1(NULL,'2026-09-01','2026-09-30','2026-09-01','2026-09-30T23:59:59Z','2026-09',1,10);
  WHEN 'activity' THEN PERFORM public.pilot_team_activity_v1(ARRAY['84000000-0000-0000-0000-000000000004'::uuid],'2026-09-30','2026-09-01','2026-09-30T23:59:59Z','2026-09-01');
  WHEN 'manager_customers' THEN PERFORM public.pilot_manager_customers_v1('84000000-0000-0000-0000-000000000002','2026-09-01','2026-09-30T23:59:59Z',1,10);
  ELSE RAISE EXCEPTION 'Unknown denied RPC'; END CASE;
 EXCEPTION WHEN insufficient_privilege THEN RETURN 'POOLED_DENIED_VERIFIED '||rpc; END;
 RAISE EXCEPTION 'Inactive/missing/anon RPC unexpectedly succeeded: %',rpc;
END $denied$;

CREATE TEMP TABLE pooled_cases(n integer PRIMARY KEY,rpc text UNIQUE);
INSERT INTO pooled_cases VALUES(1,'po'),(2,'sales'),(3,'lines'),(4,'summary'),(5,'daily'),(6,'stats'),(7,'revenue'),(8,'customers'),(9,'performance'),(10,'activity'),(11,'manager_customers');
GRANT SELECT ON pooled_actors,pooled_customers,pooled_lines,pooled_pos,pooled_delivery,pooled_orders,pooled_cases TO authenticated;
GRANT INSERT ON pooled_evidence TO authenticated;
GRANT SELECT ON pooled_cases TO anon;
DO $permissions$ DECLARE temp_schema name; BEGIN
 SELECT nspname INTO temp_schema FROM pg_namespace WHERE oid=pg_my_temp_schema();
 EXECUTE format('GRANT USAGE ON SCHEMA %I TO authenticated,anon',temp_schema);
END $permissions$;
PREPARE pooled_read(integer,text,boolean) AS SELECT pg_temp.pooled_check($1,$2,$3);
SET LOCAL ROLE authenticated;
SET LOCAL row_security=on;
SET LOCAL request.jwt.claim.sub='84000000-0000-0000-0000-000000000002';
SET LOCAL request.jwt.claims='{"sub":"84000000-0000-0000-0000-000000000002","role":"authenticated"}';
-- \gexec sends one cell/statement at a time. Do not fold this into a DO loop or
-- concatenate all statements into one cell: each RPC must get its own60s budget.
SELECT format('EXECUTE pooled_read(2,%L,false);',rpc) FROM pg_temp.pooled_cases CROSS JOIN generate_series(1,6) repeat ORDER BY n,repeat
\gexec

-- Cross identity and filter boundaries without DISCARD, reconnect or reprepare.
-- Every active role gets both parameter sets; then manager A is restored.
SELECT command FROM (
 SELECT step,0 AS sequence,format('SET LOCAL request.jwt.claim.sub=%L;',id::text) AS command FROM (VALUES(1,3),(2,1),(3,4),(4,5),(5,6),(6,7),(7,2)) transitions(step,actor) JOIN pg_temp.pooled_actors a ON a.n=actor
 UNION ALL
 SELECT step,1,format('SET LOCAL request.jwt.claims=%L;',jsonb_build_object('sub',id,'role','authenticated')::text) FROM (VALUES(1,3),(2,1),(3,4),(4,5),(5,6),(6,7),(7,2)) transitions(step,actor) JOIN pg_temp.pooled_actors a ON a.n=actor
 UNION ALL
 SELECT step,2+c.n*2+v.n,format('EXECUTE pooled_read(%s,%L,%s);',actor,rpc,v.flag) FROM (VALUES(1,3),(2,1),(3,4),(4,5),(5,6),(6,7),(7,2)) transitions(step,actor)
 CROSS JOIN pg_temp.pooled_cases c CROSS JOIN (VALUES(0,'true'),(1,'false')) v(n,flag)
) commands ORDER BY step,sequence
\gexec

-- Make the generic path explicit as well as crossing PostgreSQL's auto threshold.
SET LOCAL plan_cache_mode=force_generic_plan;
SELECT format('EXECUTE pooled_read(2,%L,true);',rpc) FROM pg_temp.pooled_cases ORDER BY n
\gexec
SET LOCAL plan_cache_mode=auto;
SET LOCAL request.jwt.claim.sub='84000000-0000-0000-0000-000000000008';
SET LOCAL request.jwt.claims='{"sub":"84000000-0000-0000-0000-000000000008","role":"authenticated"}';
SELECT format('SELECT pg_temp.pooled_denied(%L);',rpc) FROM pg_temp.pooled_cases ORDER BY n
\gexec
SET LOCAL request.jwt.claim.sub='84000000-0000-0000-0000-000000000099';
SET LOCAL request.jwt.claims='{"sub":"84000000-0000-0000-0000-000000000099","role":"authenticated"}';
SELECT format('SELECT pg_temp.pooled_denied(%L);',rpc) FROM pg_temp.pooled_cases ORDER BY n
\gexec
RESET ROLE;
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claim.sub='';
SET LOCAL request.jwt.claims='{"role":"anon"}';
SELECT format('SELECT pg_temp.pooled_denied(%L);',rpc) FROM pg_temp.pooled_cases ORDER BY n
\gexec
RESET ROLE;
-- Restore a previously authorized actor after all fail-closed transitions.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='84000000-0000-0000-0000-000000000002';
SET LOCAL request.jwt.claims='{"sub":"84000000-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT format('EXECUTE pooled_read(2,%L,false);',rpc) FROM pg_temp.pooled_cases ORDER BY n
\gexec
RESET ROLE;
DO $verified$ BEGIN
 IF (SELECT count(*) FROM pg_temp.pooled_evidence)<>242 THEN RAISE EXCEPTION 'Incomplete same-connection success matrix'; END IF;
 IF EXISTS(SELECT rpc FROM pg_temp.pooled_cases c WHERE (SELECT count(*) FROM pg_temp.pooled_evidence e WHERE e.rpc=c.rpc AND actor=2 AND NOT narrow AND plan_mode='auto')<7) THEN
  RAISE EXCEPTION 'Sixth-call auto-plan coverage missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name='pooled_read' AND generic_plans>0) THEN RAISE EXCEPTION 'Generic prepared wrapper was not exercised'; END IF;
END $verified$;
SELECT actor,rpc,narrow,plan_mode,count(*) AS successful_calls,max(rpc_elapsed_ms) AS maximum_database_rpc_ms,
 max(assertion_elapsed_ms) AS maximum_rpc_plus_oracle_ms
FROM pg_temp.pooled_evidence GROUP BY actor,rpc,narrow,plan_mode ORDER BY actor,rpc,narrow,plan_mode;
DEALLOCATE pooled_read;
ROLLBACK;
SELECT 'SCALABLE_POOLED_READS_VERIFIED' AS result;
