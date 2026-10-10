-- Untouched001 sales-page oracle: roles, ties, exact counts, hidden labels and filters.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL plan_cache_mode='force_generic_plan';
DO $$ BEGIN IF current_database()<>'pilot_test' OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') OR EXISTS(SELECT 1 FROM auth.users) THEN RAISE EXCEPTION 'Empty disposable fixture required'; END IF; END $$;
CREATE FUNCTION pg_temp.baseline_sales(p_status text,p_own_only boolean,p_page integer,p_page_size integer,p_customer_id uuid DEFAULT NULL,p_visit_id uuid DEFAULT NULL) RETURNS jsonb
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
INSERT INTO public.outlet_visits(id,outlet_id,sales_person_id)
VALUES(md5('sales-parity-visit-a')::uuid,md5('parity-customer-a')::uuid,'93000000-0000-0000-0000-000000000004'),(md5('sales-parity-visit-b')::uuid,md5('parity-customer-b')::uuid,'93000000-0000-0000-0000-000000000005');
UPDATE public.girard_orders o SET status=CASE i%4 WHEN 0 THEN 'pending' WHEN 1 THEN 'approved' WHEN 2 THEN 'rejected' ELSE 'cancelled' END,
 created_at='2026-09-15T12:00:00Z',rejection_note=CASE WHEN i%4=2 THEN 'Synthetic rejection %_ quote''' END,
 visit_id=CASE i%3 WHEN 1 THEN md5('sales-parity-visit-a')::uuid WHEN 2 THEN md5('sales-parity-visit-b')::uuid END,
 submitted_by=CASE i WHEN 5 THEN '93000000-0000-0000-0000-000000000002'::uuid WHEN 6 THEN '93000000-0000-0000-0000-000000000003'::uuid ELSE submitted_by END
FROM generate_series(1,30)i WHERE o.id=md5('parity-order-'||i)::uuid;
SET LOCAL session_replication_role='origin';
-- Test-only restrictive visibility creates an authorized order with a hidden
-- submitter label. It grants nothing and rolls back with the synthetic fixture.
CREATE POLICY sales_parity_hidden_label ON public.users AS RESTRICTIVE FOR SELECT TO authenticated USING(id<>'93000000-0000-0000-0000-000000000004'::uuid);
CREATE FUNCTION pg_temp.check_sales_parity() RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE status_filter text; own_filter boolean; customer_filter uuid; visit_filter uuid; page_number integer; base jsonb; candidate jsonb;
BEGIN
 IF NOT row_security_active('public.girard_orders') OR NOT row_security_active('public.customers') OR NOT row_security_active('public.users') THEN RAISE EXCEPTION 'Actual sales role RLS required'; END IF;
 FOREACH status_filter IN ARRAY ARRAY['all','pending','approved','rejected','cancelled'] LOOP
  FOREACH own_filter IN ARRAY ARRAY[false,true] LOOP
   FOREACH customer_filter IN ARRAY ARRAY[NULL::uuid,md5('parity-customer-a')::uuid] LOOP
    FOREACH visit_filter IN ARRAY ARRAY[NULL::uuid,md5('sales-parity-visit-a')::uuid] LOOP
     FOREACH page_number IN ARRAY ARRAY[1,2,99] LOOP
      base:=pg_temp.baseline_sales(status_filter,own_filter,page_number,3,customer_filter,visit_filter)-'as_of';
      candidate:=public.pilot_sales_order_page_v1(status_filter,own_filter,page_number,3,customer_filter,visit_filter)-'as_of';
      IF base IS DISTINCT FROM candidate THEN RAISE EXCEPTION 'Sales exact parity mismatch actor%,status%,own%,customer%,visit%,page%',auth.uid(),status_filter,own_filter,customer_filter,visit_filter,page_number; END IF;
     END LOOP;
    END LOOP;
   END LOOP;
  END LOOP;
 END LOOP;
 BEGIN PERFORM public.pilot_sales_order_page_v1('all%_'' OR true',false,1,10,NULL,NULL); RAISE EXCEPTION 'Invalid status accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.check_sales_parity();
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.check_sales_parity();
DO $$ DECLARE r jsonb; item jsonb; actual_ids jsonb; expected_ids jsonb; BEGIN
 r:=public.pilot_sales_order_page_v1('all',false,1,100,NULL,NULL);
 SELECT value INTO item FROM jsonb_array_elements(r->'items') WHERE value->>'id'=md5('parity-order-1')::uuid::text;
 IF item IS NULL OR item->'customers' IS DISTINCT FROM 'null'::jsonb OR item->'users' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Authorized order with hidden labels was lost or exposed'; END IF;
 IF (r->>'total')::integer<>15 OR r->'status_counts'<>jsonb_build_object('pending',0,'approved',8,'rejected',0,'cancelled',7) THEN RAISE EXCEPTION 'Independent full-scope count/status oracle failed'; END IF;
 SELECT jsonb_agg(value->>'id' ORDER BY n) INTO actual_ids FROM jsonb_array_elements(r->'items') WITH ORDINALITY a(value,n);
 SELECT jsonb_agg(id::text ORDER BY id DESC) INTO expected_ids FROM (SELECT md5('parity-order-'||i)::uuid id FROM generate_series(1,30)i WHERE i%2=1)t;
 IF actual_ids IS DISTINCT FROM expected_ids THEN RAISE EXCEPTION 'Stable tie sort oracle failed'; END IF;
 r:=public.pilot_sales_order_page_v1('all',false,99,3,NULL,NULL);
 IF (r->>'total')::integer<>15 OR r->'items'<>'[]'::jsonb THEN RAISE EXCEPTION 'Empty page lost exact total'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.check_sales_parity();
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.check_sales_parity();
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.check_sales_parity();
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000006',true);
SELECT pg_temp.check_sales_parity();
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000007',true);
SELECT pg_temp.check_sales_parity();
SELECT set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000008',true);
DO $$ BEGIN BEGIN PERFORM public.pilot_sales_order_page_v1('all',false,1,10,NULL,NULL); RAISE EXCEPTION 'Inactive sales read allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
RESET ROLE;
ROLLBACK;
SELECT 'SCALABLE_SALES_PAGE_PARITY_VERIFIED' AS result;
