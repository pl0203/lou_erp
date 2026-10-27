-- Small calendar/population parity checks. Synthetic data only; always rolled back.
BEGIN;
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF current_database()<>'pilot_test' OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') THEN RAISE EXCEPTION 'Disposable pilot_test marker required'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_true(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%',message; END IF; END $$;
SET LOCAL session_replication_role='replica';
INSERT INTO auth.users(id) VALUES('83000000-0000-0000-0000-000000000001'),('83000000-0000-0000-0000-000000000002');
INSERT INTO public.users(id,full_name,email,role,manager_id) VALUES
 ('83000000-0000-0000-0000-000000000001','Synthetic calendar manager','calendar-manager@example.invalid','sales_manager',NULL),
 ('83000000-0000-0000-0000-000000000002','Synthetic calendar sales','calendar-sales@example.invalid','sales_person','83000000-0000-0000-0000-000000000001');
INSERT INTO public.customers(id,name,visit_frequency_days) VALUES('83000000-0000-0000-0000-000000000003','Synthetic calendar customer',7);
INSERT INTO public.customer_manager_assignments(customer_id,manager_id,assigned_by) VALUES('83000000-0000-0000-0000-000000000003','83000000-0000-0000-0000-000000000001','83000000-0000-0000-0000-000000000001');
DO $$ DECLARE ym text; first_day date; next_month date; day_value date; slot integer; pid uuid; BEGIN
 FOREACH ym IN ARRAY ARRAY['2026-09','2024-02','2025-02','2026-12'] LOOP
  first_day:=(ym||'-01')::date;next_month:=(first_day+interval '1 month')::date;
  FOR slot IN 1..3 LOOP
   day_value:=CASE slot WHEN 1 THEN first_day WHEN 2 THEN next_month-1 ELSE next_month END;
   pid:=md5('calendar-po-'||ym||slot)::uuid;
   INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number,status,order_date,total_value)
   VALUES(pid,'83000000-0000-0000-0000-000000000003','83000000-0000-0000-0000-000000000001','SYNTHETIC-CALENDAR-'||ym||slot,'in_progress',day_value,10);
   INSERT INTO public.girard_orders(customer_id,submitted_by,status,po_id,total_value) VALUES('83000000-0000-0000-0000-000000000003','83000000-0000-0000-0000-000000000002','approved',pid,10);
   INSERT INTO public.po_line_items(id,purchase_order_id,product_name,quantity,unit_price) VALUES(md5(pid::text||'-line')::uuid,pid,'Synthetic dated item',1,10);
   INSERT INTO public.surat_jalan(id,purchase_order_id,sj_number,sj_date,created_by) VALUES(md5(pid::text||'-sj')::uuid,pid,'SYNTHETIC-CALENDAR-SJ',day_value,'83000000-0000-0000-0000-000000000001');
   INSERT INTO public.sj_line_items(surat_jalan_id,po_line_item_id,quantity_delivered) VALUES(md5(pid::text||'-sj')::uuid,md5(pid::text||'-line')::uuid,1);
   INSERT INTO public.outlet_visits(outlet_id,sales_person_id,checked_in_at)
   VALUES('83000000-0000-0000-0000-000000000003','83000000-0000-0000-0000-000000000002',CASE slot WHEN 1 THEN first_day::timestamp AT TIME ZONE 'UTC' WHEN 2 THEN (next_month::timestamp AT TIME ZONE 'UTC')-interval '1 millisecond' ELSE next_month::timestamp AT TIME ZONE 'UTC' END);
  END LOOP;
 END LOOP;
END $$;
-- Future cancelled PO remains part of recent-count and all-time ordered-item populations.
INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number,status,order_date,total_value)
VALUES('83000000-0000-0000-0000-000000000004','83000000-0000-0000-0000-000000000003','83000000-0000-0000-0000-000000000001','SYNTHETIC-FUTURE-CANCELLED','cancelled','2030-06-01',200);
INSERT INTO public.girard_orders(customer_id,submitted_by,status,po_id,total_value) VALUES('83000000-0000-0000-0000-000000000003','83000000-0000-0000-0000-000000000002','cancelled','83000000-0000-0000-0000-000000000004',200);
INSERT INTO public.po_line_items(purchase_order_id,product_name,quantity,unit_price) VALUES('83000000-0000-0000-0000-000000000004','Synthetic future item',20,10);
SET LOCAL session_replication_role='origin';
ANALYZE public.users,public.customers,public.customer_manager_assignments,public.purchase_orders,public.girard_orders,public.po_line_items,public.surat_jalan,public.sj_line_items,public.outlet_visits;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','83000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(row_security_active('public.purchase_orders'),'Normal PostgreSQL manager RLS required');
DO $$ DECLARE ym text; first_day date; next_month date; r jsonb; BEGIN
 FOREACH ym IN ARRAY ARRAY['2026-09','2024-02','2025-02','2026-12'] LOOP
  first_day:=(ym||'-01')::date;next_month:=(first_day+interval '1 month')::date;
  r:=public.pilot_customer_performance_v1(auth.uid(),ym,first_day::timestamp AT TIME ZONE 'UTC',next_month::timestamp AT TIME ZONE 'UTC',1,10);
  PERFORM pg_temp.assert_true((r->'items'->0->>'order_count')::integer=2,'First/last DATE included and next month excluded for '||ym);
  PERFORM pg_temp.assert_true((r->'items'->0->>'total_sales')::numeric=20,'Shipment month boundaries for '||ym);
  PERFORM pg_temp.assert_true((r->'items'->0->>'actual_visits')::integer=2,'Timestamp includes last fractional second and excludes next month for '||ym);
  PERFORM pg_temp.assert_true((r->'items'->0->>'target_visits')::integer=ceil((next_month-first_day)::numeric/7),'Calendar target days for '||ym);
 END LOOP;
 r:=public.pilot_customer_stats_v1(ARRAY['83000000-0000-0000-0000-000000000003'::uuid],'2029-01-01',3);
 PERFORM pg_temp.assert_true((r->'items'->0->>'order_count')::integer=1,'Recent counts preserve future cancelled orders without added upper/status filters');
 PERFORM pg_temp.assert_true(r->'items'->0->'top_items'->0->>'name'='Synthetic future item' AND (r->'items'->0->'top_items'->0->>'revenue')::numeric=200,'Top items preserve all-time cancelled ordered value');
 PERFORM pg_temp.assert_true((r->'items'->0->>'total_sales')::numeric=0,'No delivered value fabricated from cancelled order total');
END $$;
SELECT 'SCALABLE_REPORT_BOUNDARIES_VERIFIED' AS result;
ROLLBACK;
