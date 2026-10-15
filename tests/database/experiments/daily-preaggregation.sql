CREATE OR REPLACE FUNCTION public.pilot_athel_daily_v1(p_from date,p_to date,p_rolling_from date,p_status text,p_fulfillment text,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb; total_days integer; page_offset bigint;
BEGIN
 PERFORM private.pilot_read_page_guard_v1(p_page,p_page_size,366);
 PERFORM private.pilot_report_dates_v1(p_from,p_to,p_rolling_from,p_status,p_fulfillment);
 total_days:=p_to-p_from+1; page_offset:=(p_page::bigint-1)*p_page_size;
 WITH pos AS MATERIALIZED (SELECT p.id FROM public.purchase_orders p WHERE p.order_date BETWEEN least(p_from,p_rolling_from) AND p_to AND (p_status='all' OR p.status::text=p_status)),
 lines AS (SELECT l.id,l.unit_price FROM public.po_line_items l JOIN pos p ON p.id=l.purchase_order_id),
 days AS (SELECT p_from+g::integer AS day FROM generate_series(least(page_offset,total_days::bigint),least(page_offset+p_page_size-1,total_days::bigint-1)) g),
 delivery_values AS MATERIALIZED (SELECT d.surat_jalan_id,sum(d.quantity_delivered::numeric*l.unit_price) AS value
  FROM public.sj_line_items d JOIN lines l ON l.id=d.po_line_item_id GROUP BY d.surat_jalan_id),
 delivery_days AS (SELECT s.sj_date,sum(v.value) AS value,count(DISTINCT s.id) AS sj_count
  FROM public.surat_jalan s JOIN pos p ON p.id=s.purchase_order_id JOIN delivery_values v ON v.surat_jalan_id=s.id
  JOIN days day ON day.day=s.sj_date WHERE s.voided_at IS NULL GROUP BY s.sj_date)
 SELECT jsonb_build_object('version',1,'as_of',statement_timestamp(),'page',p_page,'page_size',p_page_size,'total',total_days,
  'items',coalesce(jsonb_agg(jsonb_build_object('key',d.day,'deliveredValue',coalesce(v.value,0)::text,'sjCount',coalesce(v.sj_count,0)) ORDER BY d.day),'[]'::jsonb)) INTO result FROM days d LEFT JOIN delivery_days v ON v.sj_date=d.day;
 RETURN result;
END $$;
