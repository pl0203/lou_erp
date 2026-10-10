-- Synthetic fixtures only; normal PostgreSQL sessions and actual authenticated role.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users VALUES('de000000-0000-0000-0000-000000000001'),('de000000-0000-0000-0000-000000000002'),('de000000-0000-0000-0000-000000000003'),('de000000-0000-0000-0000-000000000004');
INSERT INTO public.users(id,full_name,email,role) VALUES
('de000000-0000-0000-0000-000000000001','Demo admin','demo-admin@synthetic.invalid','po_admin'),
('de000000-0000-0000-0000-000000000002','Demo sales','demo-sales@synthetic.invalid','sales_person'),
('de000000-0000-0000-0000-000000000003','Demo head','demo-head@synthetic.invalid','sales_head'),
('de000000-0000-0000-0000-000000000004','Demo other','demo-other@synthetic.invalid','sales_person');
INSERT INTO public.customers(id,name) VALUES('de100000-0000-0000-0000-000000000001','Demo assigned'),('de100000-0000-0000-0000-000000000002','Demo unassigned');
INSERT INTO public.products(id,name,sku) VALUES('de200000-0000-0000-0000-000000000001','Demo product','DEMO-1'),('de200000-0000-0000-0000-000000000002','Demo other','DEMO-2');
INSERT INTO public.customer_sales_rep_assignments(customer_id,sales_rep_id) VALUES('de100000-0000-0000-0000-000000000001','de000000-0000-0000-0000-000000000002');
INSERT INTO public.sales_schedules(id,outlet_id,sales_person_id,assigned_by,scheduled_date) VALUES('de300000-0000-0000-0000-000000000001','de100000-0000-0000-0000-000000000001','de000000-0000-0000-0000-000000000002','de000000-0000-0000-0000-000000000001',current_date);
INSERT INTO public.outlet_visits(id,outlet_id,sales_person_id,schedule_id) VALUES('de400000-0000-0000-0000-000000000001','de100000-0000-0000-0000-000000000001','de000000-0000-0000-0000-000000000002','de300000-0000-0000-0000-000000000001');
INSERT INTO public.girard_orders(id,customer_id,visit_id,submitted_by,status,total_value) VALUES('de700000-0000-0000-0000-000000000001','de100000-0000-0000-0000-000000000001','de400000-0000-0000-0000-000000000001','de000000-0000-0000-0000-000000000002','pending',0);
-- Trusted fixture restoration of pre-cutover historical ledger rows only.
SET LOCAL session_replication_role='replica';
INSERT INTO private.pilot_order_requests(actor_id,request_id,operation,payload,result) VALUES
('de000000-0000-0000-0000-000000000002','de800000-0000-0000-0000-000000000001','submit_sales','{"customer_id":"de100000-0000-0000-0000-000000000001","visit_id":"de400000-0000-0000-0000-000000000001"}','{"id":"de700000-0000-0000-0000-000000000001"}'),
('de000000-0000-0000-0000-000000000002','de800000-0000-0000-0000-000000000002','submit_sales','{"customer_id":"de100000-0000-0000-0000-000000000001","visit_id":"de400000-0000-0000-0000-000000000001"}',NULL);
SET LOCAL session_replication_role='origin';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','de000000-0000-0000-0000-000000000002',true);
DO $$ BEGIN
 IF public.pilot_reconcile_request('de800000-0000-0000-0000-000000000003',true)->>'state'<>'abandoned' OR public.pilot_reconcile_request('de800000-0000-0000-0000-000000000003',false)->>'state'<>'abandoned' THEN RAISE EXCEPTION 'ASSERT durable sales abandonment'; END IF;
 IF public.pilot_reconcile_request('de800000-0000-0000-0000-000000000001',false)->>'state'<>'committed' THEN RAISE EXCEPTION 'ASSERT legacy recovery'; END IF;
 IF public.pilot_order_transaction('de800000-0000-0000-0000-000000000001','submit_sales','{"customer_id":"de100000-0000-0000-0000-000000000001","visit_id":"de400000-0000-0000-0000-000000000001"}')->>'id'<>'de700000-0000-0000-0000-000000000001' THEN RAISE EXCEPTION 'ASSERT legacy replay'; END IF;
 BEGIN PERFORM public.pilot_order_transaction('de800000-0000-0000-0000-000000000002','submit_sales','{"customer_id":"de100000-0000-0000-0000-000000000001","visit_id":"de400000-0000-0000-0000-000000000001"}'); RAISE EXCEPTION 'ASSERT delayed submission'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.pilot_order_transaction(gen_random_uuid(),'submit_sales','{"customer_id":"de100000-0000-0000-0000-000000000001","visit_id":"de400000-0000-0000-0000-000000000001","items":[{"product_name":"Demo","quantity":1,"unit_price":0}]}');
  RAISE EXCEPTION 'ASSERT: retired submit_sales executed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;


RESET ROLE;
-- Storage provider metadata is synthesized here; no real object bytes are claimed.
INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) SELECT 'promotion-images',
 'promotions/de000000-0000-0000-0000-000000000001/'||id||'/de900000-0000-0000-0000-000000000001.webp',
 'de000000-0000-0000-0000-000000000001','{"size":128,"mimetype":"image/webp"}'::jsonb
 FROM unnest(ARRAY['de500000-0000-0000-0000-000000000001','de500000-0000-0000-0000-000000000002','de500000-0000-0000-0000-000000000003']) id;
CREATE TEMP TABLE demo_test_values(key text PRIMARY KEY,value jsonb);
GRANT ALL ON pg_temp.demo_test_values TO authenticated;
CREATE FUNCTION pg_temp.assert_true(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT: %',message; END IF; END $$;
CREATE FUNCTION pg_temp.promotion_payload(id uuid,quantity integer) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('id',id,'product_id','de200000-0000-0000-0000-000000000001','opening_quantity',quantity,'image_path','promotions/de000000-0000-0000-0000-000000000001/'||id||'/de900000-0000-0000-0000-000000000001.webp','harga_pokok',0,'luar_kota',NULL,'dalam_kota',20,'depo_bangunan',10,'is_active',true) $$;
CREATE FUNCTION pg_temp.stock(id uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT (x->>'remaining_quantity')::bigint FROM jsonb_array_elements(public.pilot_promotions_v1(true)->'items') x WHERE x->>'id'=id::text $$;
CREATE FUNCTION pg_temp.version(id uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT (x->>'stock_version')::bigint FROM jsonb_array_elements(public.pilot_promotions_v1(true)->'items') x WHERE x->>'id'=id::text $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','de000000-0000-0000-0000-000000000001',true);
DO $$
DECLARE campaign uuid:='de500000-0000-0000-0000-000000000001'; second uuid:='de500000-0000-0000-0000-000000000002';
 payload jsonb; r jsonb; original jsonb; receipt jsonb; ack jsonb; details text; line jsonb; po uuid; req uuid; stale_req uuid;
BEGIN
 req:=gen_random_uuid(); payload:=pg_temp.promotion_payload(campaign,5);
 r:=public.pilot_promotion_transaction_v1(req,'create_promotion',payload);
 PERFORM pg_temp.assert_true(r->>'id'=campaign::text,'campaign receipt');
 PERFORM pg_temp.assert_true(public.pilot_promotion_transaction_v1(req,'create_promotion',payload)=r,'campaign replay');
 PERFORM pg_temp.assert_true(public.pilot_reconcile_promotion_v1(req,false)->>'state'='committed','campaign recovery');
 BEGIN PERFORM public.pilot_promotion_transaction_v1(req,'create_promotion',payload||'{"opening_quantity":9}'); RAISE EXCEPTION 'ASSERT mismatch accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.pilot_promotion_transaction_v1(gen_random_uuid(),'create_promotion',pg_temp.promotion_payload(second,5)); RAISE EXCEPTION 'ASSERT duplicate enabled campaign'; EXCEPTION WHEN unique_violation THEN NULL; END;
 payload:='{"customer_id":"de100000-0000-0000-0000-000000000001","po_number":"DEMO-STOCK","items":[{"product_id":"de200000-0000-0000-0000-000000000001","product_name":"Demo product","sku":"DEMO-1","quantity":10,"unit_price":0}]}';
 req:=gen_random_uuid();
 BEGIN PERFORM public.pilot_order_transaction(req,'create_po',payload); RAISE EXCEPTION 'ASSERT missing shortage';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN GET STACKED DIAGNOSTICS details=PG_EXCEPTION_DETAIL; ack:=(details::jsonb)->'ack';
 PERFORM pg_temp.assert_true(details::jsonb->>'code'='PROMO_STOCK_WARNING','typed stock warning');
 PERFORM pg_temp.assert_true(details::jsonb->'shortages'->0->>'remaining_quantity'='5','remaining 5');
 PERFORM pg_temp.assert_true(details::jsonb->'shortages'->0->>'incremental_quantity'='10','incremental 10'); END;
 PERFORM pg_temp.assert_true(public.pilot_reconcile_request(req,false)->>'state'='unknown','warning rolls back claim');
 PERFORM pg_temp.assert_true(pg_temp.stock(campaign)=5,'warning rolls back stock');
 stale_req:=gen_random_uuid();
 BEGIN PERFORM public.pilot_order_transaction(stale_req,'create_po',payload||jsonb_build_object('notes','changed','promo_stock_ack',ack)); RAISE EXCEPTION 'ASSERT changed-payload ack'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 req:=gen_random_uuid(); payload:=payload||jsonb_build_object('promo_stock_ack',ack);
 r:=public.pilot_order_transaction(req,'create_po',payload); po:=(r->>'id')::uuid; original:=r;
 PERFORM pg_temp.assert_true(public.pilot_order_transaction(req,'create_po',payload)=r,'PO replay');
 PERFORM pg_temp.assert_true(pg_temp.stock(campaign)=0,'allocation floors at zero');
 SELECT to_jsonb(p) INTO receipt FROM public.purchase_orders p WHERE p.id=po;
 PERFORM pg_temp.assert_true(receipt->>'sales_person_id_at_creation'='de000000-0000-0000-0000-000000000002','credit derived from assignment');
 PERFORM pg_temp.assert_true(receipt->>'sales_attribution_state'='assigned','assigned state');
 line:=public.pilot_po_lines_v1(po,1,20)->'items'->0;
 PERFORM pg_temp.assert_true(line->>'product_id'='de200000-0000-0000-0000-000000000001','catalog identity readback');
 line:=line||'{"quantity":6,"unit_price":0}';
 payload:=jsonb_build_object('po_id',po,'expected_updated_at',r->>'updated_at','customer_id','de100000-0000-0000-0000-000000000001','items',jsonb_build_array(line));
 r:=public.pilot_order_transaction(gen_random_uuid(),'edit_po',payload);
 PERFORM pg_temp.assert_true(pg_temp.stock(campaign)=0,'10 to 6 releases no allocated stock');
 line:=line||'{"quantity":4}'; payload:=payload||jsonb_build_object('expected_updated_at',r->>'updated_at','items',jsonb_build_array(line));
 r:=public.pilot_order_transaction(gen_random_uuid(),'edit_po',payload);
 PERFORM pg_temp.assert_true(pg_temp.stock(campaign)=1,'6 to 4 releases exactly one');
 PERFORM public.pilot_promotion_transaction_v1(gen_random_uuid(),'set_active',jsonb_build_object('promotion_id',campaign,'expected_stock_version',pg_temp.version(campaign),'is_active',false));
 PERFORM public.pilot_promotion_transaction_v1(gen_random_uuid(),'create_promotion',pg_temp.promotion_payload(second,7));
 line:=line||'{"quantity":6}'; payload:=payload||jsonb_build_object('expected_updated_at',r->>'updated_at','items',jsonb_build_array(line));
 r:=public.pilot_order_transaction(gen_random_uuid(),'edit_po',payload);
 PERFORM pg_temp.assert_true(pg_temp.stock(second)=5,'replacement receives only incremental two');
 line:=line||'{"quantity":3}'; payload:=payload||jsonb_build_object('expected_updated_at',r->>'updated_at','items',jsonb_build_array(line));
 r:=public.pilot_order_transaction(gen_random_uuid(),'edit_po',payload);
 PERFORM pg_temp.assert_true(pg_temp.stock(second)=7 AND pg_temp.stock(campaign)=2,'newest slices release to original campaigns');
 req:=gen_random_uuid(); payload:=jsonb_build_object('po_id',po,'expected_updated_at',r->>'updated_at','reason','Synthetic cancellation');
 r:=public.pilot_order_transaction(req,'cancel_po',payload);
 PERFORM pg_temp.assert_true(pg_temp.stock(campaign)=5 AND pg_temp.stock(second)=7,'cancellation releases all slices');
 PERFORM pg_temp.assert_true(public.pilot_order_transaction(req,'cancel_po',payload)=r,'cancellation replay');
 PERFORM pg_temp.assert_true(pg_temp.stock(campaign)=5,'cancellation replay releases once');
 INSERT INTO pg_temp.demo_test_values VALUES('cancelled_po',to_jsonb(po));
 -- Normalized exact SKU resolution and manual lines; no assignment is explicitly unassigned.
 r:=public.pilot_order_transaction(gen_random_uuid(),'create_po','{"customer_id":"de100000-0000-0000-0000-000000000002","po_number":"DEMO-IDENTITY","items":[{"product_name":"Demo other","sku":" demo-2 ","quantity":2,"unit_price":0},{"product_name":"Manual","sku":"MANUAL","quantity":1,"unit_price":10}]}');
 po:=(r->>'id')::uuid;
 PERFORM pg_temp.assert_true((SELECT sales_attribution_state='unassigned' FROM public.purchase_orders WHERE id=po),'explicit unassigned');
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.po_line_items WHERE purchase_order_id=po AND product_id='de200000-0000-0000-0000-000000000002'),'unique normalized sku resolved');
 BEGIN PERFORM public.pilot_order_transaction(gen_random_uuid(),'create_po','{"customer_id":"de100000-0000-0000-0000-000000000002","po_number":"DEMO-BAD-ID","items":[{"product_id":"de200000-0000-0000-0000-000000000001","product_name":"Bad","sku":"DEMO-2","quantity":1,"unit_price":0}]}'); RAISE EXCEPTION 'ASSERT inconsistent product accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 INSERT INTO pg_temp.demo_test_values VALUES('identity_po',r);
END $$;
RESET ROLE;
-- Durable movement conservation is checked by the owner, not through a browser grant.
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.promotions p WHERE p.stock_managed AND p.remaining_quantity<>(SELECT coalesce(sum(m.quantity_delta),0) FROM private.pilot_promo_movements m WHERE m.promotion_id=p.id)),'ledger conserves balances');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.pilot_promo_slices s WHERE s.purchase_order_id=(SELECT (value#>>'{}')::uuid FROM pg_temp.demo_test_values WHERE key='cancelled_po') AND s.quantity<>0),'cancelled allocations zero');
-- A failure after stock mutation rolls back balances, PO, audit, and request receipt together.
CREATE FUNCTION pg_temp.fail_demo_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.payload->>'notes'='DEMO-FAIL-RECEIPT' THEN RAISE EXCEPTION 'Synthetic receipt failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER demo_test_receipt_failure BEFORE UPDATE ON private.pilot_order_requests FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_demo_receipt();
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','de000000-0000-0000-0000-000000000001',true);
DO $$ DECLARE before_stock bigint; r jsonb; p jsonb; line jsonb; req uuid:=gen_random_uuid(); promo uuid:='de500000-0000-0000-0000-000000000002'; BEGIN
 before_stock:=pg_temp.stock(promo);
 BEGIN PERFORM public.pilot_order_transaction(req,'create_po','{"customer_id":"de100000-0000-0000-0000-000000000001","po_number":"DEMO-ROLLBACK","notes":"DEMO-FAIL-RECEIPT","items":[{"product_id":"de200000-0000-0000-0000-000000000001","sku":"DEMO-1","product_name":"Demo","quantity":2,"unit_price":10}]}'); RAISE EXCEPTION 'ASSERT fault missing'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Synthetic receipt failure' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_true(pg_temp.stock(promo)=before_stock AND NOT EXISTS(SELECT 1 FROM public.purchase_orders WHERE po_number='DEMO-ROLLBACK'),'post-allocation failure is atomic');
 PERFORM pg_temp.assert_true(public.pilot_reconcile_request(req,false)->>'state'='unknown','failed receipt claim rolled back');
 -- Duplicate lines aggregate before the quote; remove one, then change remaining product.
 p:='{"customer_id":"de100000-0000-0000-0000-000000000001","po_number":"DEMO-REMOVE","items":[{"product_id":"de200000-0000-0000-0000-000000000001","sku":"DEMO-1","product_name":"Duplicate A","quantity":2,"unit_price":10},{"product_id":"de200000-0000-0000-0000-000000000001","sku":"DEMO-1","product_name":"Duplicate B","quantity":1,"unit_price":10}]}';
 r:=public.pilot_order_transaction(gen_random_uuid(),'create_po',p);
 PERFORM pg_temp.assert_true(pg_temp.stock(promo)=before_stock-3,'duplicate lines allocate aggregate three');
 -- Replenishment must reserve numeric headroom for the eventual return of allocated units.
 BEGIN PERFORM public.pilot_promotion_transaction_v1(gen_random_uuid(),'adjust_stock',jsonb_build_object('promotion_id',promo,'expected_stock_version',pg_temp.version(promo),'quantity_delta',2147483647-pg_temp.stock(promo),'reason','Overflow returns')); RAISE EXCEPTION 'ASSERT replenishment prevents future release'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 line:=public.pilot_po_lines_v1((r->>'id')::uuid,1,20)->'items'->0;
 p:=jsonb_build_object('po_id',r->>'id','expected_updated_at',r->>'updated_at','customer_id','de100000-0000-0000-0000-000000000001','items',jsonb_build_array(line||'{"unit_price":10}'));
 r:=public.pilot_order_transaction(gen_random_uuid(),'edit_po',p);
 PERFORM pg_temp.assert_true(pg_temp.stock(promo)=before_stock-(line->>'quantity')::integer,'line removal returns original allocation');
 p:=p||jsonb_build_object('expected_updated_at',r->>'updated_at','items',jsonb_build_array(line||'{"product_id":"de200000-0000-0000-0000-000000000002","sku":"DEMO-2","unit_price":10}'));
 PERFORM public.pilot_order_transaction(gen_random_uuid(),'edit_po',p);
 PERFORM pg_temp.assert_true(pg_temp.stock(promo)=before_stock,'eligible product change releases old slices');
 BEGIN PERFORM public.pilot_promotion_transaction_v1(gen_random_uuid(),'adjust_stock',jsonb_build_object('promotion_id',promo,'expected_stock_version',pg_temp.version(promo),'quantity_delta',-100,'reason','Invalid negative')); RAISE EXCEPTION 'ASSERT negative stock'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.pilot_promotion_transaction_v1(gen_random_uuid(),'set_active',jsonb_build_object('promotion_id',promo,'expected_stock_version',0,'is_active',false)); RAISE EXCEPTION 'ASSERT stale campaign'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 BEGIN PERFORM public.pilot_promotion_transaction_v1(gen_random_uuid(),'create_promotion',pg_temp.promotion_payload('de500000-0000-0000-0000-000000000003',1)||jsonb_build_object('image_path','promotions/de000000-0000-0000-0000-000000000001/de500000-0000-0000-0000-000000000002/de900000-0000-0000-0000-000000000001.webp')); RAISE EXCEPTION 'ASSERT wrong image linkage'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 -- The upload policy refuses another actor's owner/prefix even for an administrator.
 BEGIN INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('promotion-images','promotions/de000000-0000-0000-0000-000000000004/de500000-0000-0000-0000-000000000002/de900000-0000-0000-0000-000000000002.webp','de000000-0000-0000-0000-000000000004','{"size":128,"mimetype":"image/webp"}'); RAISE EXCEPTION 'ASSERT wrong upload owner'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('promotion-images','promotions/de000000-0000-0000-0000-000000000001/de500000-0000-0000-0000-000000000002/de900000-0000-0000-0000-000000000002.webp','de000000-0000-0000-0000-000000000001','{"size":128,"mimetype":"image/webp"}');
END $$;
RESET ROLE;
DROP TRIGGER demo_test_receipt_failure ON private.pilot_order_requests;
-- Replenishment does not retroactively allocate old excess, and notes-only edits need no new quote.
SET LOCAL ROLE authenticated;
DO $$ DECLARE campaign uuid:='de500000-0000-0000-0000-000000000002'; p jsonb; r jsonb; line jsonb; ack jsonb; details text; before_stock bigint; po uuid; sj uuid; version timestamptz; BEGIN
 before_stock:=pg_temp.stock(campaign);
 p:=jsonb_build_object('customer_id','de100000-0000-0000-0000-000000000001','po_number','DEMO-EXCESS','items',jsonb_build_array(jsonb_build_object('product_id','de200000-0000-0000-0000-000000000001','sku','DEMO-1','product_name','Demo excess','quantity',before_stock+3,'unit_price',17)));
 BEGIN PERFORM public.pilot_order_transaction(gen_random_uuid(),'create_po',p); RAISE EXCEPTION 'ASSERT excess needs warning'; EXCEPTION WHEN SQLSTATE 'PT409' THEN GET STACKED DIAGNOSTICS details=PG_EXCEPTION_DETAIL; ack:=(details::jsonb)->'ack'; END;
 r:=public.pilot_order_transaction(gen_random_uuid(),'create_po',p||jsonb_build_object('promo_stock_ack',ack)); po:=(r->>'id')::uuid;
 PERFORM public.pilot_promotion_transaction_v1(gen_random_uuid(),'adjust_stock',jsonb_build_object('promotion_id',campaign,'expected_stock_version',pg_temp.version(campaign),'quantity_delta',3,'reason','Synthetic refill'));
 line:=public.pilot_po_lines_v1(po,1,20)->'items'->0;
 p:=jsonb_build_object('po_id',po,'expected_updated_at',r->>'updated_at','customer_id','de100000-0000-0000-0000-000000000001','notes','Notes only','items',jsonb_build_array(line||'{"unit_price":17}'));
 r:=public.pilot_order_transaction(gen_random_uuid(),'edit_po',p);
 PERFORM pg_temp.assert_true(pg_temp.stock(campaign)=3,'replenishment and notes-only leave old excess unallocated');
 PERFORM pg_temp.assert_true((SELECT total_value=(before_stock+3)*17 FROM public.purchase_orders WHERE id=po),'promo accounting does not reprice excess');
 r:=public.pilot_order_transaction(gen_random_uuid(),'save_delivery',jsonb_build_object('po_id',po,'expected_updated_at',r->>'updated_at','sj_number','DEMO-NO-DOUBLE','sj_date',current_date,'lines',jsonb_build_array(jsonb_build_object('po_line_item_id',line->>'id','quantity_delivered',1))));
 sj:=(r->>'id')::uuid;
 PERFORM pg_temp.assert_true(pg_temp.stock(campaign)=3,'SJ never deducts a second time');
 r:=public.pilot_order_transaction(gen_random_uuid(),'edit_sj_returned_date',jsonb_build_object('sj_id',sj,'expected_updated_at',r->>'updated_at','sj_date_returned',current_date));
 PERFORM pg_temp.assert_true(pg_temp.stock(campaign)=3,'returned date never restocks');
 r:=public.pilot_order_transaction(gen_random_uuid(),'void_delivery',jsonb_build_object('sj_id',sj,'expected_updated_at',r->>'updated_at','reason','Synthetic correction'));
 PERFORM pg_temp.assert_true(pg_temp.stock(campaign)=3,'voided evidence never implies a physical return');
 BEGIN PERFORM public.pilot_order_transaction(gen_random_uuid(),'edit_po',p||jsonb_build_object('expected_updated_at',r->>'updated_at','items',jsonb_build_array(line||'{"product_id":"de200000-0000-0000-0000-000000000002","sku":"DEMO-2","unit_price":17}'))); RAISE EXCEPTION 'ASSERT voided identity changed'; EXCEPTION WHEN check_violation THEN NULL; END;
 PERFORM public.pilot_order_transaction(gen_random_uuid(),'cancel_po',jsonb_build_object('po_id',po,'expected_updated_at',r->>'updated_at','reason','Synthetic cancel'));
 PERFORM pg_temp.assert_true(pg_temp.stock(campaign)=before_stock+3,'cancel returns only original slices after refill');
END $$;
RESET ROLE;
-- Construct genuine completed evidence, then vary only the stored completion instant.
SELECT set_config('request.jwt.claim.sub','de000000-0000-0000-0000-000000000001',true);
INSERT INTO public.surat_jalan(id,purchase_order_id,sj_number,sj_date,created_by)
SELECT 'de600000-0000-0000-0000-000000000001',(value->>'id')::uuid,'DEMO-SJ',current_date,'de000000-0000-0000-0000-000000000001' FROM pg_temp.demo_test_values WHERE key='identity_po';
INSERT INTO public.sj_line_items(surat_jalan_id,po_line_item_id,quantity_delivered) SELECT 'de600000-0000-0000-0000-000000000001',id,quantity FROM public.po_line_items WHERE purchase_order_id=(SELECT (value->>'id')::uuid FROM pg_temp.demo_test_values WHERE key='identity_po');
SET CONSTRAINTS ALL IMMEDIATE;
UPDATE public.purchase_orders SET completed_at=statement_timestamp()-interval '10 days' WHERE id=(SELECT (value->>'id')::uuid FROM pg_temp.demo_test_values WHERE key='identity_po');
SET LOCAL ROLE authenticated;
DO $$ DECLARE po uuid; version timestamptz; completed timestamptz; r jsonb; payload jsonb; req uuid; BEGIN
 SELECT id,updated_at,completed_at INTO po,version,completed FROM public.purchase_orders WHERE po_number='DEMO-IDENTITY';
 payload:=jsonb_build_object('sj_id','de600000-0000-0000-0000-000000000001','expected_updated_at',version,'sj_date_returned',current_date);
 req:=gen_random_uuid(); r:=public.pilot_order_transaction(req,'edit_sj_returned_date',payload);
 PERFORM pg_temp.assert_true(r->>'id'='de600000-0000-0000-0000-000000000001' AND r->>'po_id'=po::text,'returned date receipt identifies SJ and PO');
 PERFORM pg_temp.assert_true(public.pilot_order_transaction(req,'edit_sj_returned_date',payload)=r,'returned date replay');
 PERFORM pg_temp.assert_true((SELECT completed_at=completed AND status='complete' FROM public.purchase_orders WHERE id=po),'returned date does not reopen completion');
 BEGIN PERFORM public.pilot_order_transaction(gen_random_uuid(),'edit_sj_returned_date',payload); RAISE EXCEPTION 'ASSERT stale returned date'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 BEGIN PERFORM public.pilot_order_transaction(gen_random_uuid(),'void_delivery',payload||jsonb_build_object('expected_updated_at',r->>'updated_at','reason','late')); RAISE EXCEPTION 'ASSERT late full correction'; EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 BEGIN PERFORM public.pilot_order_transaction(gen_random_uuid(),'edit_po',jsonb_build_object('po_id',po,'expected_updated_at',r->>'updated_at')); RAISE EXCEPTION 'ASSERT completed PO editable'; EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.purchase_orders SET completed_at=statement_timestamp()-interval '14 days 1 second' WHERE po_number='DEMO-IDENTITY';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.pilot_order_transaction(gen_random_uuid(),'edit_sj_returned_date',jsonb_build_object('sj_id','de600000-0000-0000-0000-000000000001','expected_updated_at',(SELECT updated_at FROM public.purchase_orders WHERE po_number='DEMO-IDENTITY'),'sj_date_returned',current_date)); RAISE EXCEPTION 'ASSERT after day 14 accepted'; EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;
RESET ROLE;
-- Inclusive cutoff is tested deterministically; RPC uses the wall clock after resource locks.
SELECT pg_temp.assert_true(private.demo_returned_date_open('2026-10-01T00:00:00Z','2026-10-14T23:59:59.999999Z'),'immediately before day 14');
SELECT pg_temp.assert_true(private.demo_returned_date_open('2026-10-01T00:00:00Z','2026-10-15T00:00:00Z'),'exactly day 14');
SELECT pg_temp.assert_true(NOT private.demo_returned_date_open('2026-10-01T00:00:00Z','2026-10-15T00:00:00.000001Z'),'immediately after day 14');
SELECT pg_temp.assert_true(NOT private.demo_returned_date_open(NULL,clock_timestamp()),'missing completion fails closed');
UPDATE public.purchase_orders SET completed_at=NULL WHERE po_number='DEMO-IDENTITY';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.pilot_order_transaction(gen_random_uuid(),'edit_sj_returned_date',jsonb_build_object('sj_id','de600000-0000-0000-0000-000000000001','expected_updated_at',(SELECT updated_at FROM public.purchase_orders WHERE po_number='DEMO-IDENTITY'),'sj_date_returned',current_date)); RAISE EXCEPTION 'ASSERT missing completion'; EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;
RESET ROLE;
-- Legacy NULL identity remains NULL even if the stored SKU now matches a catalog product.
INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number,status) VALUES('dea00000-0000-0000-0000-000000000001','de100000-0000-0000-0000-000000000001','de000000-0000-0000-0000-000000000001','DEMO-LEGACY-NULL','confirm');
INSERT INTO public.po_line_items(id,purchase_order_id,product_name,sku,quantity,unit_price) VALUES('deb00000-0000-0000-0000-000000000001','dea00000-0000-0000-0000-000000000001','Historical snapshot','DEMO-1',3,10);
INSERT INTO public.surat_jalan(id,purchase_order_id,sj_number,sj_date,created_by) VALUES('dec00000-0000-0000-0000-000000000001','dea00000-0000-0000-0000-000000000001','DEMO-LEGACY-SJ',current_date,'de000000-0000-0000-0000-000000000001');
INSERT INTO public.sj_line_items(surat_jalan_id,po_line_item_id,quantity_delivered) VALUES('dec00000-0000-0000-0000-000000000001','deb00000-0000-0000-0000-000000000001',1);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; p jsonb; before_stock bigint; BEGIN
 before_stock:=pg_temp.stock('de500000-0000-0000-0000-000000000002');
 p:=jsonb_build_object('po_id','dea00000-0000-0000-0000-000000000001','customer_id','de100000-0000-0000-0000-000000000001','expected_updated_at',(SELECT updated_at FROM public.purchase_orders WHERE po_number='DEMO-LEGACY-NULL'),'items',jsonb_build_array(jsonb_build_object('id','deb00000-0000-0000-0000-000000000001','product_id',NULL,'product_name','Historical snapshot','sku','DEMO-1','quantity',4,'unit_price',10)));
 r:=public.pilot_order_transaction(gen_random_uuid(),'edit_po',p);
 PERFORM pg_temp.assert_true((SELECT product_id IS NULL AND quantity=4 FROM public.po_line_items WHERE id='deb00000-0000-0000-0000-000000000001'),'unchanged delivered legacy identity stays NULL');
 PERFORM pg_temp.assert_true(pg_temp.stock('de500000-0000-0000-0000-000000000002')=before_stock,'unlinked legacy increase invents no allocation');
 BEGIN PERFORM public.pilot_order_transaction(gen_random_uuid(),'edit_po',p||jsonb_build_object('expected_updated_at',r->>'updated_at','items',jsonb_build_array((p->'items'->0)||'{"product_id":"de200000-0000-0000-0000-000000000001"}'))); RAISE EXCEPTION 'ASSERT delivered identity backfilled'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET ROLE;
-- An existing catalog-linked snapshot survives a later catalog SKU rename on an unrelated edit.
INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number,status) VALUES('dea00000-0000-0000-0000-000000000002','de100000-0000-0000-0000-000000000001','de000000-0000-0000-0000-000000000001','DEMO-LEGACY-SKU','confirm');
INSERT INTO public.po_line_items(id,purchase_order_id,product_id,product_name,sku,quantity,unit_price) VALUES('deb00000-0000-0000-0000-000000000002','dea00000-0000-0000-0000-000000000002','de200000-0000-0000-0000-000000000002','Old name','DEMO-2',3,10);
UPDATE public.products SET sku='DEMO-2-RENAMED' WHERE id='de200000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM public.pilot_order_transaction(gen_random_uuid(),'edit_po',jsonb_build_object('po_id','dea00000-0000-0000-0000-000000000002','customer_id','de100000-0000-0000-0000-000000000001','expected_updated_at',(SELECT updated_at FROM public.purchase_orders WHERE po_number='DEMO-LEGACY-SKU'),'notes','Unrelated edit','items','[{"id":"deb00000-0000-0000-0000-000000000002","product_id":"de200000-0000-0000-0000-000000000002","product_name":"Old name","sku":"DEMO-2","quantity":3,"unit_price":10}]'::jsonb));
 PERFORM pg_temp.assert_true((SELECT sku='DEMO-2' FROM public.po_line_items WHERE id='deb00000-0000-0000-0000-000000000002'),'historical SKU snapshot preserved');
END $$;
RESET ROLE;
-- Every application role is exercised through direct RPC calls, including cached sales clients.
DO $$ DECLARE tested_role public.user_role; succeeded boolean; BEGIN
 FOREACH tested_role IN ARRAY ARRAY['sales_person','sales_manager','sales_head','executive','po_admin']::public.user_role[] LOOP
  PERFORM set_config('request.jwt.claim.sub','',true);
  UPDATE public.users SET role=tested_role WHERE id='de000000-0000-0000-0000-000000000004';
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub','de000000-0000-0000-0000-000000000004',true);
  succeeded:=true;
  BEGIN PERFORM public.pilot_order_transaction(gen_random_uuid(),'create_po',jsonb_build_object('customer_id','de100000-0000-0000-0000-000000000002','po_number','DEMO-ROLE-'||tested_role::text,'items','[{"product_name":"Manual role probe","quantity":1,"unit_price":0}]'::jsonb)); EXCEPTION WHEN insufficient_privilege THEN succeeded:=false; END;
  PERFORM pg_temp.assert_true(succeeded=(tested_role IN ('po_admin','executive')),'Athel creation authority for '||tested_role::text);
  BEGIN PERFORM public.pilot_order_transaction(gen_random_uuid(),'submit_sales','{}'); RAISE EXCEPTION 'ASSERT cached sales role accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  succeeded:=true;
  BEGIN PERFORM public.pilot_promotion_transaction_v1(gen_random_uuid(),'set_active',jsonb_build_object('promotion_id','de500000-0000-0000-0000-000000000002','expected_stock_version',(SELECT (j->>'stock_version')::integer FROM jsonb_array_elements(public.pilot_promotions_v1(false)->'items') j WHERE j->>'id'='de500000-0000-0000-0000-000000000002'),'is_active',true)); EXCEPTION WHEN insufficient_privilege THEN succeeded:=false; END;
  PERFORM pg_temp.assert_true(succeeded=(tested_role IN ('po_admin','executive')),'promotion write authority for '||tested_role::text);
  RESET ROLE;
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub','',true);
 UPDATE public.users SET role='sales_person' WHERE id='de000000-0000-0000-0000-000000000004';
 PERFORM set_config('request.jwt.claim.sub','de000000-0000-0000-0000-000000000001',true);
END $$;
-- Link-time MIME and byte-size checks reject provider metadata that does not match the image contract.
DO $$ DECLARE invalid_metadata jsonb; BEGIN
 FOREACH invalid_metadata IN ARRAY ARRAY['{"size":128,"mimetype":"application/octet-stream"}'::jsonb,'{"size":5242881,"mimetype":"image/webp"}'::jsonb,'{"size":0,"mimetype":"image/webp"}'::jsonb] LOOP
  UPDATE storage.objects SET metadata=invalid_metadata WHERE bucket_id='promotion-images' AND name='promotions/de000000-0000-0000-0000-000000000001/de500000-0000-0000-0000-000000000003/de900000-0000-0000-0000-000000000001.webp';
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.pilot_promotion_transaction_v1(gen_random_uuid(),'create_promotion',pg_temp.promotion_payload('de500000-0000-0000-0000-000000000003',1)); RAISE EXCEPTION 'ASSERT invalid image metadata linked'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
 END LOOP;
END $$;
SET LOCAL ROLE authenticated;
-- Sales heads cannot mutate. Inactive/anonymous cannot read or mint image authorization.
SELECT set_config('request.jwt.claim.sub','de000000-0000-0000-0000-000000000003',true);
DO $$ BEGIN
 BEGIN PERFORM public.pilot_promotion_transaction_v1(gen_random_uuid(),'adjust_stock','{"promotion_id":"de500000-0000-0000-0000-000000000002","expected_stock_version":1,"quantity_delta":1,"reason":"bad"}'); RAISE EXCEPTION 'ASSERT head mutation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.promotions SET is_active=false; RAISE EXCEPTION 'ASSERT direct mutation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM pg_temp.assert_true((SELECT count(*)=0 FROM storage.objects WHERE bucket_id='promotion-images'),'browser cannot list or sign raw images');
 PERFORM pg_temp.assert_true(public.pilot_promotion_image_v1('de500000-0000-0000-0000-000000000002')->>'expires_in'='300','canonical image bounded lifetime');
 BEGIN PERFORM public.pilot_promotion_image_v1('de500000-0000-0000-0000-000000000003'); RAISE EXCEPTION 'ASSERT orphan signing'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.users SET is_active=false WHERE id='de000000-0000-0000-0000-000000000003';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','de000000-0000-0000-0000-000000000003',true);
DO $$ BEGIN
 BEGIN PERFORM public.pilot_promotions_v1(false); RAISE EXCEPTION 'ASSERT inactive read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.pilot_promotion_image_v1('de500000-0000-0000-0000-000000000002'); RAISE EXCEPTION 'ASSERT inactive signing'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.pilot_promotions_v1(false); RAISE EXCEPTION 'ASSERT anon read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'DEMO_ORDER_PROMOTION_SQL_PASSED' AS result;
ROLLBACK;
