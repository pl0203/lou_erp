-- Requires visit-legacy-recovery-seed.sql before the demo migration.
BEGIN;
DO $$ BEGIN
 IF to_regclass('private.pilot_visit_requests') IS NULL OR to_regprocedure('private.demo_order_actor()') IS NULL
 OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='pilot_order_requests' AND column_name='execution_version')
 THEN RAISE EXCEPTION 'Actual order and visit family composition required'; END IF;
END $$;
CREATE TEMP TABLE legacy_receipt_snapshot AS SELECT to_jsonb(r) AS original FROM private.pilot_order_requests r WHERE actor_id='a3300000-0000-0000-0000-000000000001' AND request_id='e3300000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a3300000-0000-0000-0000-000000000001',true);
DO $$ DECLARE req uuid:='e3300000-0000-0000-0000-000000000002'; order_req uuid:=gen_random_uuid(); unbound uuid:=gen_random_uuid(); result jsonb; old_receipt jsonb; payload jsonb; BEGIN
 payload:=jsonb_build_object('schedule_id','53300000-0000-0000-0000-000000000002','expected_schedule_version',1,'customer_id','c3300000-0000-0000-0000-000000000001','scheduled_date',current_date,'storage_path','visits/53300000-0000-0000-0000-000000000002/proof.webp','notes','new bound visit');
 PERFORM public.pilot_reconcile_request(req,true);
 result:=public.pilot_finalize_visit(req,'finalize_visit',payload);
 IF result IS NULL OR public.pilot_reconcile_visit(req,true)->'result'<>result THEN RAISE EXCEPTION 'Wrong order recovery affected bound visit'; END IF;
 IF public.pilot_finalize_visit(req,'finalize_visit',payload)<>result THEN RAISE EXCEPTION 'Bound visit replay changed receipt'; END IF;
 PERFORM public.pilot_reconcile_visit(order_req,true);
 result:=public.pilot_order_transaction(order_req,'create_po',jsonb_build_object('customer_id','c3300000-0000-0000-0000-000000000001','po_number','VISIT-FAMILY-'||order_req::text,'order_date',current_date,'items',jsonb_build_array(jsonb_build_object('product_name','Noncatalog item','quantity',1,'unit_price',10))));
 IF result IS NULL OR public.pilot_reconcile_request(order_req,true)->'result'<>result THEN RAISE EXCEPTION 'Wrong visit recovery affected future order'; END IF;
 BEGIN PERFORM public.pilot_reconcile_visit(order_req,true); RAISE EXCEPTION 'Known order receipt exposed via visit recovery'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 old_receipt:=public.pilot_reconcile_visit('e3300000-0000-0000-0000-000000000001',true)->'result';
 IF old_receipt IS NULL OR public.pilot_finalize_visit('e3300000-0000-0000-0000-000000000001','finalize_visit','{"schedule_id":"53300000-0000-0000-0000-000000000001","storage_path":"visits/53300000-0000-0000-0000-000000000001/proof.webp"}')<>old_receipt THEN RAISE EXCEPTION 'Committed legacy unbound visit lost recovery'; END IF;
 BEGIN PERFORM public.pilot_reconcile_request('e3300000-0000-0000-0000-000000000001',true); RAISE EXCEPTION 'Known legacy visit exposed via order recovery'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM private.pilot_test_legacy_finalize(gen_random_uuid(),'finalize_visit','{"schedule_id":"53300000-0000-0000-0000-000000000003","storage_path":"visits/53300000-0000-0000-0000-000000000003/proof.webp"}'); RAISE EXCEPTION 'Delayed legacy function body executed after cutover'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.outlet_visits WHERE schedule_id='53300000-0000-0000-0000-000000000003') THEN RAISE EXCEPTION 'Delayed legacy body left visit evidence'; END IF;
 PERFORM public.pilot_reconcile_request(unbound,true);
 BEGIN PERFORM public.pilot_finalize_visit(unbound,'finalize_visit','{"schedule_id":"53300000-0000-0000-0000-000000000003","storage_path":"visits/53300000-0000-0000-0000-000000000003/proof.webp"}'); RAISE EXCEPTION 'Ambiguous old unbound request executed'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT to_jsonb(r) FROM private.pilot_order_requests r WHERE actor_id='a3300000-0000-0000-0000-000000000001' AND request_id='e3300000-0000-0000-0000-000000000001')<>(SELECT original FROM legacy_receipt_snapshot) THEN RAISE EXCEPTION 'Legacy ledger row was rewritten'; END IF;
 BEGIN
  INSERT INTO private.pilot_order_requests(actor_id,request_id,operation,payload) VALUES('a3300000-0000-0000-0000-000000000001',gen_random_uuid(),'finalize_visit','{}');
  RAISE EXCEPTION 'Delayed old finalize can still claim legacy ledger';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.users SET role='sales_manager' WHERE id='a3300000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a3300000-0000-0000-0000-000000000001',true);
DO $$ BEGIN
 BEGIN PERFORM public.pilot_reconcile_visit('e3300000-0000-0000-0000-000000000001',true); RAISE EXCEPTION 'Legacy receipt ignored current store authority'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.pilot_reconcile_visit('e3300000-0000-0000-0000-000000000002',true); RAISE EXCEPTION 'New receipt ignored current store authority'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.users SET is_active=false WHERE id='a3300000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a3300000-0000-0000-0000-000000000001',true);
DO $$ BEGIN
 BEGIN PERFORM public.pilot_reconcile_visit('e3300000-0000-0000-0000-000000000001',true); RAISE EXCEPTION 'Deactivated actor recovered legacy visit'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'DEMO_ACTUAL_ORDER_VISIT_RECOVERY_COMPOSITION_PASSED' AS result;
