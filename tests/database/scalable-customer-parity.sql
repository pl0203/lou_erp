-- Exact untouched002 customer-query oracle, all active roles and edge populations.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL plan_cache_mode='force_generic_plan';
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN IF current_database()<>'pilot_test' OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') OR EXISTS(SELECT 1 FROM auth.users) THEN RAISE EXCEPTION 'Empty disposable fixture required'; END IF; END $$;
CREATE FUNCTION pg_temp.baseline_customer(p_manager_id uuid,p_year_month text,p_visit_from timestamptz,p_visit_until timestamptz,p_page integer,p_page_size integer) RETURNS jsonb
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
SET LOCAL session_replication_role='replica';
INSERT INTO auth.users(id) SELECT ('93000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid FROM generate_series(1,8)i;
INSERT INTO public.users(id,full_name,email,role,is_active,manager_id)
SELECT ('93000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'Synthetic parity user '||i,'parity-'||i||'@example.invalid',
 (CASE i WHEN 1 THEN 'executive' WHEN 2 THEN 'sales_manager' WHEN 3 THEN 'sales_manager' WHEN 4 THEN 'sales_person' WHEN 5 THEN 'sales_person' WHEN 6 THEN 'po_admin' WHEN 7 THEN 'sales_head' ELSE 'executive' END)::public.user_role,i<>8,
 CASE i WHEN 4 THEN '93000000-0000-0000-0000-000000000002'::uuid WHEN 5 THEN '93000000-0000-0000-0000-000000000003'::uuid END FROM generate_series(1,8)i;
INSERT INTO public.customers(id,name) VALUES(md5('parity-customer-a')::uuid,'Synthetic A'),(md5('parity-customer-b')::uuid,'Synthetic B');
INSERT INTO public.customer_manager_assignments(customer_id,manager_id,assigned_by)
VALUES(md5('parity-customer-a')::uuid,'93000000-0000-0000-0000-000000000002','93000000-0000-0000-0000-000000000001'),(md5('parity-customer-b')::uuid,'93000000-0000-0000-0000-000000000003','93000000-0000-0000-0000-000000000001');
INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number,status,order_date,total_value)
SELECT md5('parity-po-'||i)::uuid,md5(CASE WHEN i%2=1 AND i<>1 THEN 'parity-customer-a' ELSE 'parity-customer-b' END)::uuid,'93000000-0000-0000-0000-000000000006','PARITY-'||i,
 (CASE i%6 WHEN 0 THEN 'draft' WHEN 1 THEN 'confirm' WHEN 2 THEN 'in_progress' WHEN 3 THEN 'complete' WHEN 4 THEN 'cancelled' ELSE 'confirmed' END)::public.po_status,
 (CASE i%4 WHEN 0 THEN '2024-01-01' WHEN 1 THEN '2026-07-01' WHEN 2 THEN '2026-09-30' ELSE '2026-10-01' END)::date,CASE WHEN i%5=0 THEN 0 ELSE 1000 END FROM generate_series(1,30)i;
INSERT INTO public.girard_orders(id,customer_id,submitted_by,status,po_id,total_value)
SELECT md5('parity-order-'||i)::uuid,p.customer_id,('93000000-0000-0000-0000-'||CASE WHEN i%2=1 THEN '000000000004' ELSE '000000000005' END)::uuid,'approved',p.id,p.total_value FROM generate_series(1,30)i JOIN public.purchase_orders p ON p.id=md5('parity-po-'||i)::uuid;
INSERT INTO public.po_line_items(id,purchase_order_id,product_name,sku,quantity,unit_price)
SELECT md5('parity-line-'||i||'-'||j)::uuid,md5('parity-po-'||i)::uuid,'Synthetic mixed item','MIX',10,CASE WHEN j=2 OR i%5=0 THEN 0 ELSE 100 END FROM generate_series(1,30)i CROSS JOIN generate_series(1,2)j;
INSERT INTO public.surat_jalan(id,purchase_order_id,sj_number,sj_date,created_by,voided_at,voided_by,void_reason)
SELECT md5('parity-sj-'||i)::uuid,md5('parity-po-'||i)::uuid,'PARITY-SJ-'||i,'2026-09-15','93000000-0000-0000-0000-000000000006',CASE WHEN i%7=0 THEN '2026-09-16'::timestamptz END,CASE WHEN i%7=0 THEN '93000000-0000-0000-0000-000000000006'::uuid END,CASE WHEN i%7=0 THEN 'Synthetic void' END FROM generate_series(1,30)i WHERE i%6<>0;
INSERT INTO public.sj_line_items(surat_jalan_id,po_line_item_id,quantity_delivered)
SELECT md5('parity-sj-'||i)::uuid,md5('parity-line-'||i||'-'||j)::uuid,CASE WHEN i%3=0 THEN 10 ELSE 5 END FROM generate_series(1,30)i CROSS JOIN generate_series(1,2)j WHERE i%6<>0;
-- Separate cross-period oracle: an August order delivered in September plus
-- a September zero-price promotion. Future visit/target must not rewrite month counts.
INSERT INTO public.customers(id,name) VALUES(md5('customer-parity-cross')::uuid,'Synthetic cross-period customer');
INSERT INTO public.customer_manager_assignments(customer_id,manager_id,assigned_by) VALUES(md5('customer-parity-cross')::uuid,'93000000-0000-0000-0000-000000000002','93000000-0000-0000-0000-000000000001');
INSERT INTO public.customer_sales_rep_assignments(customer_id,sales_rep_id,assigned_by) VALUES(md5('customer-parity-cross')::uuid,'93000000-0000-0000-0000-000000000004','93000000-0000-0000-0000-000000000001');
INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number,status,order_date,total_value)
SELECT md5('customer-parity-po-'||i)::uuid,md5('customer-parity-cross')::uuid,'93000000-0000-0000-0000-000000000006','CUSTOMER-PARITY-'||i,'in_progress',CASE WHEN i=1 THEN '2026-08-01'::date ELSE '2026-09-01'::date END,CASE WHEN i=1 THEN 100 ELSE 0 END FROM generate_series(1,2)i;
INSERT INTO public.girard_orders(customer_id,submitted_by,status,po_id,total_value)
SELECT customer_id,'93000000-0000-0000-0000-000000000004','approved',id,total_value FROM public.purchase_orders WHERE po_number LIKE 'CUSTOMER-PARITY-%';
INSERT INTO public.po_line_items(id,purchase_order_id,product_name,sku,quantity,unit_price)
SELECT md5('customer-parity-line-'||i)::uuid,md5('customer-parity-po-'||i)::uuid,'Synthetic item','CROSS',10,CASE WHEN i=1 THEN 10 ELSE 0 END FROM generate_series(1,2)i;
INSERT INTO public.surat_jalan(id,purchase_order_id,sj_number,sj_date,created_by)
SELECT md5('customer-parity-sj-'||i)::uuid,md5('customer-parity-po-'||i)::uuid,'CUSTOMER-PARITY-SJ-'||i,'2026-09-15','93000000-0000-0000-0000-000000000006' FROM generate_series(1,2)i;
INSERT INTO public.sj_line_items(surat_jalan_id,po_line_item_id,quantity_delivered)
SELECT md5('customer-parity-sj-'||i)::uuid,md5('customer-parity-line-'||i)::uuid,CASE WHEN i=1 THEN 4 ELSE 3 END FROM generate_series(1,2)i;
INSERT INTO public.customer_targets(customer_id,year_month,target_value,set_by)
SELECT md5('customer-parity-cross')::uuid,m,value,'93000000-0000-0000-0000-000000000001' FROM (VALUES('2026-07',10),('2026-09',20),('2026-10',30))t(m,value);
INSERT INTO public.outlet_visits(outlet_id,sales_person_id,checked_in_at)
SELECT md5('customer-parity-cross')::uuid,'93000000-0000-0000-0000-000000000004',stamp::timestamptz FROM (VALUES('2026-09-01T00:00:00Z'),('2026-09-30T23:59:59.999999Z'),('2026-10-02T00:00:00Z'))t(stamp);
SET LOCAL session_replication_role='origin';
CREATE FUNCTION pg_temp.check_customer_parity() RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE month_key text; manager uuid; page_number integer; base jsonb; candidate jsonb; from_day date; until_day date;
BEGIN
 IF NOT row_security_active('public.customers') OR NOT row_security_active('public.sj_line_items') THEN RAISE EXCEPTION 'Actual customer role RLS required'; END IF;
 manager:=CASE WHEN public.current_user_role()='sales_manager' THEN auth.uid() ELSE NULL END;
 FOREACH month_key IN ARRAY ARRAY['2026-07','2026-09','2026-10'] LOOP
  from_day:=(month_key||'-01')::date;until_day:=(from_day+interval '1 month')::date;
  FOREACH page_number IN ARRAY ARRAY[1,2] LOOP
   base:=pg_temp.baseline_customer(manager,month_key,from_day::timestamptz,until_day::timestamptz,page_number,1)-'as_of';
   candidate:=public.pilot_customer_performance_v1(manager,month_key,from_day::timestamptz,until_day::timestamptz,page_number,1)-'as_of';
   IF base IS DISTINCT FROM candidate THEN RAISE EXCEPTION 'Customer parity mismatch actor%,month%,page%',auth.uid(),month_key,page_number; END IF;
  END LOOP;
 END LOOP;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.check_customer_parity();
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.check_customer_parity();
DO $$ DECLARE r jsonb; item jsonb; BEGIN
 r:=public.pilot_customer_performance_v1(auth.uid(),'2026-09','2026-09-01','2026-10-01',1,100);
 SELECT value INTO item FROM jsonb_array_elements(r->'items') WHERE value->>'id'=md5('customer-parity-cross')::uuid::text;
 IF item IS NULL OR (item->>'order_count')::integer<>1 OR (item->>'total_sales')::numeric<>40 OR (item->>'actual_visits')::integer<>2 OR (item->>'sales_target')::numeric<>20 OR (item->>'last_visit_date')::timestamptz<>'2026-10-02T00:00:00Z'::timestamptz THEN RAISE EXCEPTION 'Cross-period/zero-price/target/latest-visit oracle failed: %',item; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.check_customer_parity();
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.check_customer_parity();
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.check_customer_parity();
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000006',true);
SELECT pg_temp.check_customer_parity();
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000007',true);
SELECT pg_temp.check_customer_parity();
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000008',true);
DO $$ BEGIN BEGIN PERFORM public.pilot_customer_performance_v1(NULL,'2026-09','2026-09-01','2026-10-01',1,10); RAISE EXCEPTION 'Inactive report unexpectedly allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
RESET ROLE;
ROLLBACK;
SELECT 'SCALABLE_CUSTOMER_PARITY_VERIFIED' AS result;
