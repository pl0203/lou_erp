-- Fixed query text and typed USING parameters: only this statement replans.
-- Redundant membership predicates retain all joins, RLS and metric populations.
CREATE OR REPLACE FUNCTION public.pilot_athel_summary_v1(p_from date,p_to date,p_rolling_from date,p_status text,p_fulfillment text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM private.pilot_report_dates_v1(p_from,p_to,p_rolling_from,p_status,p_fulfillment);

 EXECUTE $summary_query$
WITH pos AS MATERIALIZED (SELECT p.id,p.customer_id,p.status,p.order_date,p.total_value FROM public.purchase_orders p WHERE p.order_date BETWEEN least($1,$3) AND $2 AND ($4='all' OR p.status::text=$4)),
 lines AS MATERIALIZED (SELECT l.id,l.purchase_order_id,l.product_name,l.sku,l.quantity,l.unit_price FROM public.po_line_items l JOIN pos p ON p.id=l.purchase_order_id WHERE l.purchase_order_id=ANY(ARRAY(SELECT id FROM pos))),
 headers AS MATERIALIZED (SELECT s.id,s.purchase_order_id,s.sj_date FROM public.surat_jalan s JOIN pos p ON p.id=s.purchase_order_id WHERE s.voided_at IS NULL),
 delivery_lines AS MATERIALIZED (SELECT s.id AS sj_id,s.purchase_order_id,s.sj_date,l.id AS line_id,d.quantity_delivered,d.quantity_delivered::numeric*l.unit_price AS value FROM headers s JOIN public.sj_line_items d ON d.surat_jalan_id=s.id JOIN lines l ON l.id=d.po_line_item_id WHERE d.surat_jalan_id=ANY(ARRAY(SELECT id FROM headers))),
 delivered_line AS (SELECT line_id,sum(quantity_delivered) AS quantity FROM delivery_lines GROUP BY line_id),
 delivered_po AS (SELECT purchase_order_id,sum(value) AS value FROM delivery_lines GROUP BY purchase_order_id),
 remaining AS MATERIALIZED (SELECT l.*,greatest(0,l.quantity-coalesce(d.quantity,0)) AS remaining_quantity,greatest(0,l.quantity-coalesce(d.quantity,0))*l.unit_price AS remaining_value FROM lines l LEFT JOIN delivered_line d ON d.line_id=l.id),
 remaining_po AS (SELECT purchase_order_id,sum(remaining_quantity) AS quantity,sum(remaining_value) AS value FROM remaining GROUP BY purchase_order_id),
 po_values AS MATERIALIZED (SELECT p.*,coalesce(d.value,0) AS delivered_value,coalesce(r.quantity,0) AS outstanding_quantity,coalesce(r.value,0) AS outstanding_value FROM pos p LEFT JOIN delivered_po d ON d.purchase_order_id=p.id LEFT JOIN remaining_po r ON r.purchase_order_id=p.id),
 filtered AS MATERIALIZED (SELECT * FROM po_values WHERE order_date BETWEEN $1 AND $2 AND
  ($5='all' OR ($5='undelivered' AND delivered_value=0) OR ($5='complete' AND outstanding_quantity=0 AND total_value>0) OR ($5='partial' AND delivered_value>0 AND outstanding_quantity>0))),
 customers AS (SELECT f.customer_id,coalesce(c.name,'Tanpa Pelanggan') AS name,sum(f.total_value) AS po_value,sum(f.delivered_value) AS delivered_value FROM filtered f LEFT JOIN public.customers c ON c.id=f.customer_id GROUP BY f.customer_id,c.name),
 ranked_customers AS MATERIALIZED (SELECT *,row_number() OVER(ORDER BY po_value DESC,customer_id) AS rank FROM customers),
 shares AS (SELECT rank,name AS label,po_value AS value FROM ranked_customers WHERE rank<=5 UNION ALL SELECT 6,'Lainnya',sum(po_value) FROM ranked_customers WHERE rank>5 HAVING count(*)>0),
 status_counts AS (SELECT status,count(*) AS count FROM filtered GROUP BY status),
 po_months AS (SELECT to_char(order_date,'YYYY-MM') AS month,sum(total_value) AS value FROM filtered WHERE order_date BETWEEN $3 AND $2 GROUP BY 1),
 delivered_months AS (SELECT to_char(sj_date,'YYYY-MM') AS month,sum(value) AS value FROM delivery_lines WHERE sj_date BETWEEN $3 AND $2 GROUP BY 1),
 months AS (SELECT to_char(date_trunc('month',$3::timestamp)+i*interval '1 month','YYYY-MM') AS key FROM generate_series(0,11) i),
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
  'outstandingItems',coalesce((SELECT jsonb_agg(jsonb_build_object('rank',rank,'sku',sku,'productName',product_name,'outstandingQty',quantity,'outstandingValue',value::text) ORDER BY rank) FROM ranked_items WHERE rank<=10),'[]'::jsonb));
$summary_query$ INTO result USING p_from,p_to,p_rolling_from,p_status,p_fulfillment;
 RETURN result;
END $$;
