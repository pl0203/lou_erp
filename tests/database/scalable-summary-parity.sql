-- Independent parity oracle: untouched002 summary function, small synthetic matrix.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL plan_cache_mode='force_generic_plan';
DO $$ BEGIN IF current_database()<>'pilot_test' OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') THEN RAISE EXCEPTION 'Disposable marker required'; END IF; END $$;
CREATE FUNCTION pg_temp.baseline_summary(p_from date,p_to date,p_rolling_from date,p_status text,p_fulfillment text) RETURNS jsonb
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
SET LOCAL session_replication_role='origin';
CREATE FUNCTION pg_temp.check_summary_parity() RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE status_filter text; fulfillment_filter text; date_from date; before_value jsonb; after_value jsonb;
BEGIN
 IF NOT row_security_active('public.purchase_orders') THEN RAISE EXCEPTION 'Actual role RLS required'; END IF;
 FOREACH date_from IN ARRAY ARRAY['2021-01-01'::date,'2026-07-01'::date] LOOP
  FOREACH status_filter IN ARRAY ARRAY['all','draft','confirm','in_progress','complete','cancelled'] LOOP
   FOREACH fulfillment_filter IN ARRAY ARRAY['all','undelivered','partial','complete'] LOOP
    before_value:=pg_temp.baseline_summary(date_from,'2026-09-30','2025-10-01',status_filter,fulfillment_filter)-'as_of';
    after_value:=public.pilot_athel_summary_v1(date_from,'2026-09-30','2025-10-01',status_filter,fulfillment_filter)-'as_of';
    IF before_value IS DISTINCT FROM after_value THEN RAISE EXCEPTION 'Summary parity failed for actor%,from%,status%,fulfillment%',auth.uid(),date_from,status_filter,fulfillment_filter; END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 BEGIN PERFORM public.pilot_athel_summary_v1('2026-07-01','2026-09-30','2025-10-01','all'' OR true --','all'); RAISE EXCEPTION 'Invalid text unexpectedly accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.check_summary_parity();
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.check_summary_parity();
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.check_summary_parity();
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.check_summary_parity();
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.check_summary_parity();
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000006',true);
SELECT pg_temp.check_summary_parity();
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000007',true);
SELECT pg_temp.check_summary_parity();
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000008',true);
DO $$ BEGIN BEGIN PERFORM public.pilot_athel_summary_v1('2026-07-01','2026-09-30','2025-10-01','all','all'); RAISE EXCEPTION 'Inactive unexpectedly accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
RESET ROLE;
SELECT 'SCALABLE_SUMMARY_PARITY_VERIFIED' AS result;
ROLLBACK;
