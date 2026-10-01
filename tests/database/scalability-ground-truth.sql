-- Read-only verification after the explicitly permitted disposable scale load.
BEGIN;
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF current_database()<>'pilot_test' OR (SELECT count(*) FROM public.pilot_fixture_marker)<>1 OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') THEN RAISE EXCEPTION 'Disposable pilot_test marker required'; END IF;
 IF (SELECT count(*) FROM public.pilot_scale_manifest)<>1 THEN RAISE EXCEPTION 'One scale manifest is required'; END IF;
 IF (SELECT (manifest->'base'->>'purchase_orders')::integer FROM public.pilot_scale_manifest) NOT IN (6000,30000) THEN RAISE EXCEPTION 'Unrecognized scale fixture size'; END IF;
END $$;
SELECT set_config('pilot.scale_rows',(SELECT manifest->'base'->>'purchase_orders' FROM public.pilot_scale_manifest),true);
CREATE FUNCTION pg_temp.assert_scale(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%',message; END IF; END $$;
SELECT pg_temp.assert_scale((SELECT count(*) FROM public.purchase_orders)=current_setting('pilot.scale_rows')::integer+7,'Exact total PO rows including seven edge cases');
SELECT pg_temp.assert_scale((SELECT count(*) FROM public.po_line_items)=current_setting('pilot.scale_rows')::integer*10+7,'Exact PO line rows');
SELECT pg_temp.assert_scale((SELECT count(*) FROM public.surat_jalan)=current_setting('pilot.scale_rows')::integer*2+5,'Exact delivery headers');
SELECT pg_temp.assert_scale((SELECT count(*) FROM public.sj_line_items)=current_setting('pilot.scale_rows')::integer*20+5,'Exact delivery lines');
SELECT pg_temp.assert_scale((SELECT count(*) FROM public.girard_orders)=current_setting('pilot.scale_rows')::integer+7,'Exact sales order rows');
SELECT pg_temp.assert_scale((SELECT count(*) FROM public.girard_order_items)=current_setting('pilot.scale_rows')::integer*10+7,'Exact sales line rows');
SELECT pg_temp.assert_scale((SELECT count(*) FROM public.po_audit_log)=current_setting('pilot.scale_rows')::integer*2+7,'Exact audit growth rows');
SELECT pg_temp.assert_scale((SELECT count(*) FROM private.pilot_order_requests)=current_setting('pilot.scale_rows')::integer+7,'Exact request history growth rows');
SELECT pg_temp.assert_scale((SELECT count(*) FROM public.purchase_orders WHERE po_number LIKE 'SCALE-PO-%' AND order_date BETWEEN '2026-07-01' AND '2026-09-30')=1500,'Comparable three-month base cohort');
SELECT pg_temp.assert_scale((SELECT count(*) FROM public.purchase_orders WHERE po_number LIKE 'SCALE-PO-%' AND order_date BETWEEN '2025-10-01' AND '2026-09-30')=6000,'Comparable rolling-year base cohort');
SELECT pg_temp.assert_scale((SELECT bool_and(n=500) AND count(*)=current_setting('pilot.scale_rows')::integer/500 FROM (SELECT count(*) AS n FROM public.purchase_orders WHERE po_number LIKE 'SCALE-PO-%' GROUP BY date_trunc('month',order_date::timestamp)) months),'Exactly500 POs in every declared month');
-- Independent sums use ordinary joins and fixture constants, never another read RPC.
SELECT pg_temp.assert_scale((SELECT sum(total_value) FROM public.purchase_orders)=current_setting('pilot.scale_rows')::numeric*1000+600,'All PO numeric value');
SELECT pg_temp.assert_scale((SELECT sum(d.quantity_delivered::numeric*l.unit_price) FROM public.sj_line_items d JOIN public.surat_jalan s ON s.id=d.surat_jalan_id JOIN public.po_line_items l ON l.id=d.po_line_item_id WHERE s.voided_at IS NULL)=current_setting('pilot.scale_rows')::numeric*500+180,'All active delivered numeric value');
CREATE FUNCTION pg_temp.verify_scale_role(base_count integer,include_edges boolean) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE r jsonb; edge_count integer:=CASE WHEN include_edges THEN 7 ELSE 0 END; edge_po integer:=CASE WHEN include_edges THEN 600 ELSE 0 END; edge_delivery integer:=CASE WHEN include_edges THEN 180 ELSE 0 END; edge_outstanding integer:=CASE WHEN include_edges THEN 420 ELSE 0 END; started timestamptz;
BEGIN
 PERFORM pg_temp.assert_scale(row_security_active('public.purchase_orders'),'Real authenticated RLS is mandatory');
 started:=clock_timestamp();RAISE NOTICE 'SCALE_ROLE_COUNT_START actor=%',auth.uid();
 r:=public.pilot_po_page_v1('all','',1,10);
 PERFORM pg_temp.assert_scale((r->>'total')::integer=base_count+edge_count,'Role-scoped exact page count');
 PERFORM pg_temp.assert_scale(jsonb_array_length(r->'items')=10,'Bounded first page');
 RAISE NOTICE 'SCALE_ROLE_COUNT_FINISH actor=% elapsed_ms=%',auth.uid(),extract(epoch FROM clock_timestamp()-started)*1000;
 started:=clock_timestamp();RAISE NOTICE 'SCALE_ROLE_SUMMARY_START actor=%',auth.uid();
 r:=public.pilot_athel_summary_v1('2021-01-01','2026-09-30','2025-10-01','all','all');
 PERFORM pg_temp.assert_scale((r->'metrics'->>'totalPOCount')::integer=base_count+edge_count,'Role-scoped full summary count');
 PERFORM pg_temp.assert_scale((r->'metrics'->>'totalPOValue')::numeric=base_count::numeric*1000+edge_po,'Role-scoped PO total');
 PERFORM pg_temp.assert_scale((r->'metrics'->>'deliveredValue')::numeric=base_count::numeric*500+edge_delivery,'Role-scoped delivery total');
 PERFORM pg_temp.assert_scale((r->'metrics'->>'outstandingValue')::numeric=base_count::numeric*500+edge_outstanding,'Role-scoped outstanding total');
 PERFORM pg_temp.assert_scale(jsonb_typeof(r->'metrics'->'totalPOValue')='string','Exact decimal wire money');
 RAISE NOTICE 'SCALE_ROLE_SUMMARY_FINISH actor=% elapsed_ms=%',auth.uid(),extract(epoch FROM clock_timestamp()-started)*1000;
END $$;
SELECT c.relname AS index_name,pg_relation_size(c.oid) AS index_bytes FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid WHERE i.indrelid IN ('public.girard_orders'::regclass,'public.po_line_items'::regclass,'public.sj_line_items'::regclass);
SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('purchase_orders','girard_orders','po_line_items','surat_jalan','sj_line_items') ORDER BY tablename,indexname;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','84000000-0000-0000-0000-000000000002',true);
-- These ordinary-role plans precede expensive calls and support evidence-based tuning.
EXPLAIN (ANALYZE,BUFFERS,TIMING OFF) SELECT id FROM public.girard_orders WHERE po_id=md5('scale-po-1')::uuid;
EXPLAIN (VERBOSE,COSTS) SELECT l.purchase_order_id,sum(d.quantity_delivered) FROM public.po_line_items l JOIN public.sj_line_items d ON d.po_line_item_id=l.id JOIN public.surat_jalan s ON s.id=d.surat_jalan_id WHERE s.voided_at IS NULL GROUP BY l.purchase_order_id;
SELECT pg_temp.verify_scale_role(current_setting('pilot.scale_rows')::integer/2,true);
SELECT set_config('request.jwt.claim.sub','84000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.verify_scale_role(current_setting('pilot.scale_rows')::integer/2,false);
SELECT set_config('request.jwt.claim.sub','84000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.verify_scale_role(current_setting('pilot.scale_rows')::integer/2,true);
SELECT set_config('request.jwt.claim.sub','84000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.verify_scale_role(current_setting('pilot.scale_rows')::integer/2,false);
SELECT set_config('request.jwt.claim.sub','84000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.verify_scale_role(current_setting('pilot.scale_rows')::integer,true);
SELECT set_config('request.jwt.claim.sub','84000000-0000-0000-0000-000000000006',true);
SELECT pg_temp.verify_scale_role(current_setting('pilot.scale_rows')::integer,true);
SELECT set_config('request.jwt.claim.sub','84000000-0000-0000-0000-000000000007',true);
SELECT pg_temp.verify_scale_role(current_setting('pilot.scale_rows')::integer,true);
SELECT set_config('request.jwt.claim.sub','84000000-0000-0000-0000-000000000008',true);
DO $$ BEGIN
 BEGIN PERFORM public.pilot_po_page_v1('all','',1,10); RAISE EXCEPTION 'Inactive profile unexpectedly accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'SCALABILITY_ROLE_GROUND_TRUTH_VERIFIED' AS result,version() AS postgres_version,pg_database_size(current_database()) AS observed_database_bytes;
ROLLBACK;
