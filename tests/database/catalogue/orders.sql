SELECT pg_temp.foundation_assert((SELECT md5(prosrc)='0b1e19441a499ae9c864b2d21aef28ba' FROM pg_proc WHERE oid='private.catalog_po_legacy_transaction_v1(uuid,text,jsonb)'::regprocedure),'legacy final composed body remains exact');
-- Fictional, rollback-only actual-role tests of an inactive private PO core.
-- This test adapter is not installed by the candidate and grants no production escape hatch.
CREATE FUNCTION pg_temp.catalog_po_test_call(request uuid,operation text,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RETURN private.catalog_po_transaction_core_v2(request,operation,payload); END $$;
CREATE FUNCTION pg_temp.catalog_po_test_gate(request uuid,operation text,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RETURN private.catalog_po_transaction_v2(request,operation,payload); END $$;
REVOKE ALL ON FUNCTION pg_temp.catalog_po_test_call(uuid,text,jsonb),pg_temp.catalog_po_test_gate(uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.catalog_po_test_call(uuid,text,jsonb),pg_temp.catalog_po_test_gate(uuid,text,jsonb) TO authenticated;
CREATE TEMP TABLE catalogue_po_results(label text PRIMARY KEY,payload jsonb,result jsonb) ON COMMIT DROP;
GRANT SELECT,INSERT,UPDATE ON pg_temp.catalogue_po_results TO authenticated;
INSERT INTO public.customers(id,name,customer_category) VALUES(md5('orders-customer')::uuid,'Fictional order customer','perorangan');
INSERT INTO public.products(id,name,sku) VALUES(md5('orders-product')::uuid,'Fictional order product','ORDERS-SKU');
INSERT INTO public.promotions(id,product_id,start_date,end_date,created_by,stock_managed,remaining_quantity,image_path) VALUES(md5('orders-promo')::uuid,md5('orders-product')::uuid,'2030-01-01','2030-12-31',md5('catalogue-foundation-actor-2')::uuid,true,20,'fictional-only/promotion.png');
SELECT set_config('request.jwt.claim.sub',md5('catalogue-foundation-actor-2')::uuid::text,true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.foundation_raises($q$SELECT private.catalog_po_transaction_core_v2(md5('denied-core')::uuid,'create_po','{}')$q$,'42501','actual authenticated cannot bypass production gate');
SELECT pg_temp.foundation_assert(NOT private.catalog_po_active_v2(),'own-context predicate is callable and false outside core');
SELECT pg_temp.foundation_raises($q$SELECT * FROM private.catalog_po_active_v2$q$,'42501','actual authenticated cannot access private context');
SELECT pg_temp.foundation_raises($q$SELECT pg_temp.catalog_po_test_gate(md5('orders-gate')::uuid,'create_po','{}')$q$,'55000','production generation two remains unavailable');
DO $$ DECLARE payload jsonb; result jsonb; BEGIN
 payload:=jsonb_build_object('customer_id',md5('orders-customer')::uuid,'po_number','FICTIONAL-CORE-PO',
 'items',jsonb_build_array(jsonb_build_object('product_id',md5('orders-product')::uuid,'product_name','Agreed document label','sku','ORDERS-SKU','quantity',4,'unit_price',0)));
 result:=pg_temp.catalog_po_test_call(md5('orders-create')::uuid,'create_po',payload);
 INSERT INTO pg_temp.catalogue_po_results VALUES('create',payload,result);
 PERFORM pg_temp.foundation_assert(result->>'id' IS NOT NULL,'private core creates actual PO');
 PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_po_test_call(%L::uuid,%L,%L::jsonb)',md5('orders-null')::uuid,'create_po',jsonb_set(payload,'{items,0,product_id}','null')),'22023','new null product refused');
 PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_po_test_call(%L::uuid,%L,%L::jsonb)',md5('orders-missing-product')::uuid,'create_po',jsonb_set(payload,'{items,0,product_id}',to_jsonb(md5('missing-product')::uuid))),'23514','missing new product refused');
 PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_po_test_call(%L::uuid,%L,%L::jsonb)',md5('orders-missing-customer')::uuid,'create_po',jsonb_set(payload,'{customer_id}',to_jsonb(md5('missing-customer')::uuid))),'23514','missing new customer refused');
 PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_po_test_call(%L::uuid,%L,%L::jsonb)',md5('orders-sku')::uuid,'create_po',jsonb_set(payload,'{items,0,sku}','"FOREIGN"')),'22023','canonical SKU mismatch refused');
 PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_po_test_call(%L::uuid,%L,%L::jsonb)',md5('orders-fabricated')::uuid,'create_po',jsonb_set(payload,'{items,0,id}',to_jsonb(md5('invented-line')::uuid))),'22023','fabricated persisted identity refused');
 PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_po_test_call(%L::uuid,%L,%L::jsonb)',md5('orders-create')::uuid,'create_po',payload||'{"notes":"different"}'::jsonb),'22023','exact payload mismatch refused');
END $$;
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT execution_version=2 FROM private.pilot_order_requests WHERE request_id=md5('orders-create')::uuid),'private core explicitly writes generation two');
SELECT pg_temp.foundation_assert((SELECT unit_price=0 AND product_name='Agreed document label' FROM public.po_line_items WHERE purchase_order_id=(SELECT (result->>'id')::uuid FROM pg_temp.catalogue_po_results WHERE label='create')),'agreed zero prices and document labels retained');
SELECT pg_temp.foundation_assert((SELECT count(*)=2 AND bool_and(lifetime_state='used') FROM private.catalog_identity_v1 WHERE (kind='customer' AND id=md5('orders-customer')::uuid) OR (kind='product' AND id=md5('orders-product')::uuid)),'final master phase marks both references used');
SELECT pg_temp.foundation_assert((SELECT remaining_quantity=16 FROM public.promotions WHERE id=md5('orders-promo')::uuid),'real promotion allocation is preserved');
UPDATE public.products SET is_enabled=false,sku='RENAMED-AFTER-ORDER' WHERE id=md5('orders-product')::uuid;
UPDATE public.customers SET is_enabled=false WHERE id=md5('orders-customer')::uuid;
SET LOCAL ROLE authenticated;
SELECT pg_temp.foundation_assert((SELECT pg_temp.catalog_po_test_call(md5('orders-create')::uuid,'create_po',payload)=result FROM pg_temp.catalogue_po_results WHERE label='create'),'exact replay ignores later disabled targets');
SELECT pg_temp.foundation_assert((SELECT public.pilot_order_transaction(md5('orders-create')::uuid,'create_po',payload)=result FROM pg_temp.catalogue_po_results WHERE label='create'),'public wrapper returns exact committed receipt before generation dispatch');
DO $$ DECLARE payload jsonb; row record; po uuid; BEGIN
 SELECT (result->>'id')::uuid INTO po FROM pg_temp.catalogue_po_results WHERE label='create';
 SELECT l.* INTO row FROM public.po_line_items l WHERE l.purchase_order_id=po;
 payload:=jsonb_build_object('po_id',po,'customer_id',md5('orders-customer')::uuid,'expected_updated_at',(SELECT p.updated_at FROM public.purchase_orders p WHERE p.id=po),
 'items',jsonb_build_array(jsonb_build_object('id',row.id,'product_id',row.product_id,'product_name',row.product_name,'sku',row.sku,'quantity',4,'unit_price',0)));
 PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_po_test_call(%L::uuid,%L,%L::jsonb)',md5('orders-cap')::uuid,'edit_po',jsonb_set(payload,'{items,0,quantity}','5')),'23514','disabled customer caps each persisted line');
 PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_po_test_call(%L::uuid,%L,%L::jsonb)',md5('orders-relabel')::uuid,'edit_po',jsonb_set(payload,'{items,0,product_name}','"Replacement"')),'23514','disabled customer forbids identity replacement');
 INSERT INTO pg_temp.catalogue_po_results VALUES('edit',payload,pg_temp.catalog_po_test_call(md5('orders-edit')::uuid,'edit_po',payload));
END $$;
RESET ROLE;
-- Enabled customer does not remove the disabled product's own per-line cap.
UPDATE public.customers SET is_enabled=true WHERE id=md5('orders-customer')::uuid;
SET LOCAL ROLE authenticated;
DO $$ DECLARE payload jsonb; BEGIN
 SELECT c.payload||jsonb_build_object('expected_updated_at',(SELECT p.updated_at FROM public.purchase_orders p WHERE p.id=(c.result->>'po_id')::uuid)) INTO payload FROM pg_temp.catalogue_po_results c WHERE label='edit';
 PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_po_test_call(%L::uuid,%L,%L::jsonb)',md5('product-own-cap')::uuid,'edit_po',jsonb_set(payload,'{items,0,quantity}','5')),'23514','disabled product retains its own cap with enabled customer');
END $$;
RESET ROLE;
-- Seed a genuine pre-catalogue manual historical line. It is never a client exception.
UPDATE public.customers SET is_enabled=true WHERE id=md5('orders-customer')::uuid;
INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number,status) VALUES(md5('manual-po')::uuid,md5('orders-customer')::uuid,md5('catalogue-foundation-actor-2')::uuid,'FICTIONAL-MANUAL','confirm');
INSERT INTO public.po_line_items(id,purchase_order_id,product_id,product_name,sku,quantity,unit_price) VALUES(md5('manual-line')::uuid,md5('manual-po')::uuid,NULL,'Saved manual label',NULL,2,0);
SET LOCAL ROLE authenticated;
DO $$ DECLARE payload jsonb; BEGIN
 payload:=jsonb_build_object('po_id',md5('manual-po')::uuid,'customer_id',md5('orders-customer')::uuid,'expected_updated_at',(SELECT updated_at FROM public.purchase_orders WHERE id=md5('manual-po')::uuid),
 'items',jsonb_build_array(jsonb_build_object('id',md5('manual-line')::uuid,'product_id',NULL,'product_name','Saved manual label','sku',NULL,'quantity',3,'unit_price',0)));
 PERFORM pg_temp.catalog_po_test_call(md5('manual-edit')::uuid,'edit_po',payload);
END $$;
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT quantity=3 AND product_id IS NULL AND unit_price=0 FROM public.po_line_items WHERE id=md5('manual-line')::uuid),'manual history preserves zero price');
UPDATE public.customers SET is_enabled=false WHERE id=md5('orders-customer')::uuid;
SET LOCAL ROLE authenticated;
DO $$ DECLARE payload jsonb; BEGIN
 payload:=jsonb_build_object('po_id',md5('manual-po')::uuid,'customer_id',md5('orders-customer')::uuid,'expected_updated_at',(SELECT updated_at FROM public.purchase_orders WHERE id=md5('manual-po')::uuid),
 'items',jsonb_build_array(jsonb_build_object('id',md5('manual-line')::uuid,'product_id',NULL,'product_name','Saved manual label','sku',NULL,'quantity',4,'unit_price',0)));
 PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_po_test_call(%L::uuid,%L,%L::jsonb)',md5('manual-disabled-cap')::uuid,'edit_po',payload),'23514','disabled customer caps persisted manual line');
END $$;
RESET ROLE;
UPDATE public.customers SET is_enabled=true WHERE id=md5('orders-customer')::uuid;
INSERT INTO public.girard_orders(id,customer_id,submitted_by,status) VALUES(md5('trusted-so')::uuid,md5('orders-customer')::uuid,md5('catalogue-foundation-actor-4')::uuid,'pending');
INSERT INTO public.girard_order_items(order_id,product_id,product_name,sku,quantity,unit_price) VALUES(md5('trusted-so')::uuid,md5('orders-product')::uuid,'Saved Girard name','Saved old SKU',1,0);
SET LOCAL ROLE authenticated;
SELECT pg_temp.foundation_raises($q$SELECT pg_temp.catalog_po_test_call(md5('approve-po-denied')::uuid,'approve_sales',jsonb_build_object('order_id',md5('trusted-so')::uuid,'po_number','FICTIONAL-TRUSTED'))$q$,'42501','post-stage07 executive review remains required');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',md5('catalogue-foundation-actor-3')::uuid::text,true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.foundation_raises($q$SELECT pg_temp.catalog_po_test_call(md5('approve-disabled')::uuid,'approve_sales',jsonb_build_object('order_id',md5('trusted-so')::uuid,'po_number','FICTIONAL-TRUSTED'))$q$,'23514','trusted conversion refuses disabled product');
RESET ROLE;
UPDATE public.products SET is_enabled=true,sku='ORDERS-SKU' WHERE id=md5('orders-product')::uuid;
SET LOCAL ROLE authenticated;
INSERT INTO pg_temp.catalogue_po_results SELECT 'approval','{}',pg_temp.catalog_po_test_call(md5('approve-enabled')::uuid,'approve_sales',jsonb_build_object('order_id',md5('trusted-so')::uuid,'po_number','FICTIONAL-TRUSTED'));
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT product_name='Saved Girard name' AND sku='Saved old SKU' AND unit_price=0 FROM public.po_line_items WHERE purchase_order_id=(SELECT (result->>'id')::uuid FROM pg_temp.catalogue_po_results WHERE label='approval')),'trusted conversion retains saved identity and price');
SELECT pg_temp.foundation_assert((SELECT execution_generation=1 AND NOT tracking_ready FROM private.catalog_cutover_v1),'private core tests never activate foundation');
SELECT pg_temp.foundation_assert(NOT has_function_privilege('authenticated','private.catalog_po_transaction_core_v2(uuid,text,jsonb)','EXECUTE'),'private core has no application bypass');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.pilot_order_requests WHERE request_id IN(md5('orders-null')::uuid,md5('orders-cap')::uuid,md5('approve-disabled')::uuid)),'failed guards leave no request admission');

-- The public gen1 route remains the original compatible body, not a client upgrade.
SELECT set_config('request.jwt.claim.sub',md5('catalogue-foundation-actor-2')::uuid::text,true);
SET LOCAL ROLE authenticated;
INSERT INTO pg_temp.catalogue_po_results SELECT 'legacy','{}',public.pilot_order_transaction(md5('legacy-public')::uuid,'create_po',jsonb_build_object('customer_id',md5('orders-customer')::uuid,'po_number','FICTIONAL-LEGACY','execution_version',2,'generation',2,'items',jsonb_build_array(jsonb_build_object('product_id',NULL,'product_name','Legacy manual','quantity',1,'unit_price',0))));
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT execution_version=1 FROM private.pilot_order_requests WHERE request_id=md5('legacy-public')::uuid),'client generation hints cannot upgrade old body');
INSERT INTO public.po_line_items(id,purchase_order_id,product_id,product_name,sku,quantity,unit_price) VALUES(md5('removed-line')::uuid,md5('manual-po')::uuid,NULL,'Removed manual',NULL,1,0);
DELETE FROM public.po_line_items WHERE id=md5('removed-line')::uuid;
SET LOCAL ROLE authenticated;
DO $$ DECLARE payload jsonb; id uuid; BEGIN
 SELECT c.payload||jsonb_build_object('expected_updated_at',(SELECT p.updated_at FROM public.purchase_orders p WHERE p.id=(c.result->>'po_id')::uuid)) INTO payload FROM pg_temp.catalogue_po_results c WHERE label='edit';
 FOREACH id IN ARRAY ARRAY[md5('manual-line')::uuid,md5('removed-line')::uuid] LOOP
  PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_po_test_call(%L::uuid,%L,%L::jsonb)',md5('invalid-identity-'||id)::uuid,'edit_po',jsonb_set(payload,'{items,0,id}',to_jsonb(id))),'22023','foreign and removed persisted line identities refused');
 END LOOP;
END $$;
RESET ROLE;

-- Exercise the combined old-parent event proof through real supported writes.
INSERT INTO public.products(id,name,sku) VALUES(md5('chain-b')::uuid,'Chain B','CHAIN-B'),(md5('chain-c')::uuid,'Chain C','CHAIN-C');
SELECT set_config('request.jwt.claim.sub',md5('catalogue-foundation-actor-2')::uuid::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE payload jsonb; result jsonb; po uuid; line_a uuid; line_b uuid; sj uuid; stamp timestamptz; BEGIN
 payload:=jsonb_build_object('customer_id',md5('orders-customer')::uuid,'po_number','FICTIONAL-CHAIN',
 'items',jsonb_build_array(jsonb_build_object('product_id',md5('orders-product')::uuid,'product_name','Chain A','sku','ORDERS-SKU','quantity',4,'unit_price',0),
 jsonb_build_object('product_id',md5('chain-b')::uuid,'product_name','Chain B','sku','CHAIN-B','quantity',4,'unit_price',0)));
 result:=pg_temp.catalog_po_test_call(md5('chain-create')::uuid,'create_po',payload);po:=(result->>'id')::uuid;stamp:=(result->>'updated_at')::timestamptz;
 SELECT id INTO line_a FROM public.po_line_items WHERE purchase_order_id=po AND product_id=md5('orders-product')::uuid;
 SELECT id INTO line_b FROM public.po_line_items WHERE purchase_order_id=po AND product_id=md5('chain-b')::uuid;
 payload:=jsonb_build_object('po_id',po,'expected_updated_at',stamp,'sj_number','FICTIONAL-CHAIN-SJ','sj_date','2030-01-01','lines',jsonb_build_array(jsonb_build_object('po_line_item_id',line_a,'quantity_delivered',1),jsonb_build_object('po_line_item_id',line_b,'quantity_delivered',1)));
 result:=pg_temp.catalog_po_test_call(md5('chain-delivery')::uuid,'save_delivery',payload);sj:=(result->>'id')::uuid;stamp:=(result->>'updated_at')::timestamptz;
 payload:=payload||jsonb_build_object('sj_id',sj,'expected_updated_at',stamp,'lines',jsonb_build_array(jsonb_build_object('po_line_item_id',line_b,'quantity_delivered',1)));
 result:=pg_temp.catalog_po_test_call(md5('chain-replace-delivery')::uuid,'save_delivery',payload);stamp:=(result->>'updated_at')::timestamptz;
 payload:=jsonb_build_object('po_id',po,'customer_id',md5('orders-customer')::uuid,'expected_updated_at',stamp,'items',jsonb_build_array(
 jsonb_build_object('id',line_a,'product_id',md5('chain-c')::uuid,'product_name','Chain C','sku','CHAIN-C','quantity',4,'unit_price',0),
 jsonb_build_object('id',line_b,'product_id',md5('chain-b')::uuid,'product_name','Chain B','sku','CHAIN-B','quantity',4,'unit_price',0)));
 PERFORM pg_temp.catalog_po_test_call(md5('chain-replace-product')::uuid,'edit_po',payload);
 PERFORM pg_temp.foundation_assert((SELECT product_id=md5('chain-c')::uuid FROM public.po_line_items WHERE id=line_a),'removed SJ link is covered by direct OLD product event');
END $$;
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT count(*)=3 AND bool_and(lifetime_state='used') FROM private.catalog_identity_v1 WHERE kind='product' AND id IN(md5('orders-product')::uuid,md5('chain-b')::uuid,md5('chain-c')::uuid)),'combined old new and removed indirect product use stays used');
SELECT set_config('request.jwt.claim.sub',md5('catalogue-foundation-actor-3')::uuid::text,true);

-- Direct authenticated order writes were already revoked; do not invent grants.
SET LOCAL ROLE authenticated;
SELECT pg_temp.foundation_raises($q$UPDATE public.purchase_orders SET notes='raw denied' WHERE id=md5('manual-po')::uuid$q$,'42501','authenticated raw write remains denied');
RESET ROLE;
-- The existing service role retains direct table writes and must not be broken
-- by a revoked WHEN predicate when there is no active private core.
SET LOCAL ROLE service_role;
UPDATE public.purchase_orders SET notes='Fictional existing raw service path' WHERE id=md5('manual-po')::uuid;
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT notes='Fictional existing raw service path' FROM public.purchase_orders WHERE id=md5('manual-po')::uuid),'actual authorized service raw write remains outside core');
-- The assertion trigger must use its actual queued event after context removal.
INSERT INTO public.products(id,name,sku) VALUES(md5('orders-unmarked')::uuid,'Fictional unmarked product','ORDERS-UNMARKED');
INSERT INTO public.po_line_items(id,purchase_order_id,product_id,product_name,sku,quantity,unit_price) VALUES(md5('old-event-line')::uuid,md5('manual-po')::uuid,md5('orders-unmarked')::uuid,'Old event product','ORDERS-UNMARKED',1,0);
CREATE FUNCTION pg_temp.catalog_po_assert_probe(mode text) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE po uuid:=(SELECT (result->>'id')::uuid FROM pg_temp.catalogue_po_results WHERE label='create');
BEGIN
 INSERT INTO private.catalog_po_active_v2 VALUES(pg_backend_pid(),txid_current());
 IF mode='context' THEN SET CONSTRAINTS private.catalog_po_context_empty_v2 IMMEDIATE; RETURN; END IF;
 IF mode='nested' THEN
  PERFORM private.catalog_po_transaction_core_v2(md5('nested-core')::uuid,'create_po',(SELECT payload FROM pg_temp.catalogue_po_results WHERE label='create')); RETURN;
 END IF;
 IF mode='immediate' THEN SET CONSTRAINTS public.catalog_po_assert_v2 IMMEDIATE; END IF;
 IF mode='old-line' THEN
  UPDATE public.po_line_items SET product_id=md5('orders-product')::uuid WHERE id=md5('old-event-line')::uuid;
 ELSIF mode='request' THEN
  INSERT INTO private.pilot_order_requests(actor_id,request_id,operation,payload,execution_version)
  VALUES(auth.uid(),md5('unmarked-request')::uuid,'create_po',jsonb_build_object('customer_id',md5('orders-customer')::uuid,'items',jsonb_build_array(jsonb_build_object('product_id',md5('orders-unmarked')::uuid))),2);
 ELSE
  INSERT INTO public.po_audit_log(purchase_order_id,changed_by,field_changed,old_value,new_value)
  VALUES(po,auth.uid(),'po_items_revised',CASE WHEN mode='malformed' THEN '{broken' ELSE jsonb_build_array(jsonb_build_object('product_id',md5('orders-unmarked')::uuid))::text END,'[]');
 END IF;
 DELETE FROM private.catalog_po_active_v2 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 SET CONSTRAINTS ALL IMMEDIATE;
END $$;
SELECT pg_temp.foundation_raises($q$SELECT pg_temp.catalog_po_assert_probe('old-line')$q$,'23514','actual OLD product missing mark fails after parent reassignment');
SELECT pg_temp.foundation_raises($q$SELECT pg_temp.catalog_po_assert_probe('old-only')$q$,'23514','actual OLD-only audit snapshot cannot lose missing mark after context cleanup');
SELECT pg_temp.foundation_raises($q$SELECT pg_temp.catalog_po_assert_probe('immediate')$q$,'23514','forced immediate missing mark fails closed');
SELECT pg_temp.foundation_raises($q$SELECT pg_temp.catalog_po_assert_probe('malformed')$q$,'22P02','malformed known snapshot aborts');
SELECT pg_temp.foundation_raises($q$SELECT pg_temp.catalog_po_assert_probe('request')$q$,'23514','early request snapshot queues missing mark assertion');
SELECT pg_temp.foundation_raises($q$SELECT pg_temp.catalog_po_assert_probe('context')$q$,'23514','active context cannot survive commit');
SELECT pg_temp.foundation_raises($q$SELECT pg_temp.catalog_po_assert_probe('nested')$q$,'55000','nested core activation refused');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_po_active_v2),'successful and failed core clean up private scope');
-- Force all queued legitimate events now, rather than rely on rollback to avoid commit checks.
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
