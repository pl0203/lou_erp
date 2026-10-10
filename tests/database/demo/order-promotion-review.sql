-- Review regressions, synthetic PostgreSQL 17 only, actual authenticated sessions.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL TIME ZONE 'UTC';
INSERT INTO auth.users VALUES('fa000000-0000-0000-0000-000000000001'),('fa000000-0000-0000-0000-000000000002');
INSERT INTO public.users(id,full_name,email,role) VALUES('fa000000-0000-0000-0000-000000000001','Review admin','review-admin@synthetic.invalid','po_admin'),('fa000000-0000-0000-0000-000000000002','Review salesperson','review-sales@synthetic.invalid','sales_person');
INSERT INTO public.customers(id,name) VALUES('fa100000-0000-0000-0000-000000000001','Review store');
INSERT INTO public.products(id,name,sku) VALUES('fa200000-0000-0000-0000-000000000001','Review original','REVIEW-ORIGINAL'),('fa200000-0000-0000-0000-000000000002','Review replacement','REVIEW-REPLACEMENT');
SELECT set_config('request.jwt.claim.sub','fa000000-0000-0000-0000-000000000001',true);
INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number,status) VALUES('fa300000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','fa000000-0000-0000-0000-000000000001','REVIEW-DELIVERED','confirm');
INSERT INTO public.po_line_items(id,purchase_order_id,product_id,product_name,sku,quantity,unit_price) VALUES('fa400000-0000-0000-0000-000000000001','fa300000-0000-0000-0000-000000000001','fa200000-0000-0000-0000-000000000001','Review original','REVIEW-ORIGINAL',3,17);
INSERT INTO public.surat_jalan(id,purchase_order_id,sj_number,sj_date,created_by) VALUES('fa500000-0000-0000-0000-000000000001','fa300000-0000-0000-0000-000000000001','REVIEW-SJ',current_date,'fa000000-0000-0000-0000-000000000001');
INSERT INTO public.sj_line_items(surat_jalan_id,po_line_item_id,quantity_delivered) VALUES('fa500000-0000-0000-0000-000000000001','fa400000-0000-0000-0000-000000000001',2);
SET CONSTRAINTS ALL IMMEDIATE;
CREATE FUNCTION pg_temp.review_assert(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT: %',message; END IF; END $$;
CREATE FUNCTION pg_temp.review_refuse(statement text,expected_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected_state THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'ASSERT: expected SQLSTATE %, accepted %',expected_state,statement;
END $$;
CREATE TEMP TABLE review_before AS SELECT (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.purchase_orders p) po,(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.po_line_items l) lines,(SELECT count(*) FROM private.pilot_order_requests) requests,(SELECT count(*) FROM private.pilot_promo_movements) movements;
SET LOCAL ROLE authenticated;
DO $$ DECLARE spelling text; changed jsonb; draft jsonb; original jsonb; BEGIN
 original:='{"id":"fa400000-0000-0000-0000-000000000001","product_id":"fa200000-0000-0000-0000-000000000001","product_name":"Review original","sku":"REVIEW-ORIGINAL","quantity":3,"unit_price":17}';
 FOREACH spelling IN ARRAY ARRAY[upper(original->>'id'),replace(original->>'id','-','')] LOOP
  FOREACH changed IN ARRAY ARRAY['{"unit_price":99}'::jsonb,'{"quantity":1}'::jsonb,'{"product_id":"fa200000-0000-0000-0000-000000000002","product_name":"Review replacement","sku":"REVIEW-REPLACEMENT"}'::jsonb] LOOP
   draft:=jsonb_build_object('po_id','fa300000-0000-0000-0000-000000000001','customer_id','fa100000-0000-0000-0000-000000000001','expected_updated_at',(SELECT updated_at FROM public.purchase_orders WHERE id='fa300000-0000-0000-0000-000000000001'),'items',jsonb_build_array(original||changed||jsonb_build_object('id',spelling)));
   PERFORM pg_temp.review_refuse(format('SELECT public.pilot_order_transaction(%L,%L,%L::jsonb)',gen_random_uuid(),'edit_po',draft),'23514');
  END LOOP;
 END LOOP;
 -- Duplicate textual encodings must still be one typed identity, not two lines.
 draft:=draft||jsonb_build_object('items',jsonb_build_array(original,original||jsonb_build_object('id',upper(original->>'id'))));
 PERFORM pg_temp.review_refuse(format('SELECT public.pilot_order_transaction(%L,%L,%L::jsonb)',gen_random_uuid(),'edit_po',draft),'22023');
 draft:=draft||jsonb_build_object('items',jsonb_build_array(original,original||jsonb_build_object('id',replace(original->>'id','-',''))));
 PERFORM pg_temp.review_refuse(format('SELECT public.pilot_order_transaction(%L,%L,%L::jsonb)',gen_random_uuid(),'edit_po',draft),'22023');
END $$;
RESET ROLE;
SELECT pg_temp.review_assert((SELECT po=(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.purchase_orders p) AND lines=(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.po_line_items l) AND requests=(SELECT count(*) FROM private.pilot_order_requests) AND movements=(SELECT count(*) FROM private.pilot_promo_movements) FROM pg_temp.review_before),'all refused encoded-ID edits leave resource/ledger/receipt unchanged');
-- Canonicalization preserves allowed edits too; it is not a blanket ban on alternative UUID spelling.
SET LOCAL ROLE authenticated;
DO $$ DECLARE spelling text; BEGIN
 FOREACH spelling IN ARRAY ARRAY['FA400000-0000-0000-0000-000000000001','fa400000000000000000000000000001'] LOOP
  PERFORM public.pilot_order_transaction(gen_random_uuid(),'edit_po',jsonb_build_object('po_id','fa300000-0000-0000-0000-000000000001','customer_id','fa100000-0000-0000-0000-000000000001','expected_updated_at',(SELECT updated_at FROM public.purchase_orders WHERE id='fa300000-0000-0000-0000-000000000001'),'items',jsonb_build_array(jsonb_build_object('id',spelling,'product_id','fa200000-0000-0000-0000-000000000001','product_name','Review original','sku','REVIEW-ORIGINAL','quantity',4,'unit_price',17))));
 END LOOP;
END $$;
RESET ROLE;
UPDATE public.surat_jalan SET voided_at=clock_timestamp(),voided_by='fa000000-0000-0000-0000-000000000001',void_reason='Synthetic correction' WHERE id='fa500000-0000-0000-0000-000000000001';
SELECT private.pilot_reconcile_po('fa300000-0000-0000-0000-000000000001');
SET LOCAL ROLE authenticated;
DO $$ DECLARE spelling text; changed jsonb; draft jsonb; original jsonb; BEGIN
 original:='{"id":"fa400000-0000-0000-0000-000000000001","product_id":"fa200000-0000-0000-0000-000000000001","product_name":"Review original","sku":"REVIEW-ORIGINAL","quantity":3,"unit_price":17}';
 FOREACH spelling IN ARRAY ARRAY[upper(original->>'id'),replace(original->>'id','-','')] LOOP
  FOREACH changed IN ARRAY ARRAY['{"unit_price":99}'::jsonb,'{"product_id":"fa200000-0000-0000-0000-000000000002","product_name":"Review replacement","sku":"REVIEW-REPLACEMENT"}'::jsonb] LOOP
   draft:=jsonb_build_object('po_id','fa300000-0000-0000-0000-000000000001','customer_id','fa100000-0000-0000-0000-000000000001','expected_updated_at',(SELECT updated_at FROM public.purchase_orders WHERE id='fa300000-0000-0000-0000-000000000001'),'items',jsonb_build_array(original||changed||jsonb_build_object('id',spelling)));
   PERFORM pg_temp.review_refuse(format('SELECT public.pilot_order_transaction(%L,%L,%L::jsonb)',gen_random_uuid(),'edit_po',draft),'23514');
  END LOOP;
 END LOOP;
END $$;
RESET ROLE;
SELECT 'DEMO_REVIEW_ENCODED_UUID_GUARDS_PASSED' AS result;
-- Authoritative pre-cutover Girard snapshots survive a later catalog SKU rename.
INSERT INTO public.girard_orders(id,customer_id,submitted_by,status,total_value) VALUES('fa600000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','fa000000-0000-0000-0000-000000000002','pending',170);
INSERT INTO public.girard_order_items(order_id,product_id,product_name,sku,quantity,unit_price) VALUES('fa600000-0000-0000-0000-000000000001','fa200000-0000-0000-0000-000000000001','Review original','REVIEW-ORIGINAL',10,17);
UPDATE public.products SET sku='REVIEW-RENAMED' WHERE id='fa200000-0000-0000-0000-000000000001';
INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('promotion-images','promotions/fa000000-0000-0000-0000-000000000001/fa700000-0000-0000-0000-000000000001/fa800000-0000-0000-0000-000000000001.webp','fa000000-0000-0000-0000-000000000001','{"size":128,"mimetype":"image/webp"}');
SET LOCAL ROLE authenticated;
DO $$ DECLARE draft jsonb; req uuid; r jsonb; details text; ack jsonb; BEGIN
 PERFORM public.pilot_promotion_transaction_v1(gen_random_uuid(),'create_promotion','{"id":"fa700000-0000-0000-0000-000000000001","product_id":"fa200000-0000-0000-0000-000000000001","opening_quantity":5,"image_path":"promotions/fa000000-0000-0000-0000-000000000001/fa700000-0000-0000-0000-000000000001/fa800000-0000-0000-0000-000000000001.webp","harga_pokok":0,"luar_kota":null,"dalam_kota":null,"depo_bangunan":null,"is_active":true}');
 draft:='{"order_id":"fa600000-0000-0000-0000-000000000001","po_number":"REVIEW-LEGACY-CONVERSION","items":[{"product_name":"Untrusted replacement","quantity":1,"unit_price":1}]}';
 PERFORM set_config('request.jwt.claim.sub','fa000000-0000-0000-0000-000000000002',true);
 PERFORM pg_temp.review_refuse(format('SELECT public.pilot_order_transaction(%L,%L,%L::jsonb)',gen_random_uuid(),'approve_sales',draft),'42501');
 PERFORM set_config('request.jwt.claim.sub','fa000000-0000-0000-0000-000000000001',true);
 BEGIN PERFORM public.pilot_order_transaction(gen_random_uuid(),'approve_sales',draft); RAISE EXCEPTION 'ASSERT legacy conversion must quote stock'; EXCEPTION WHEN SQLSTATE 'PT409' THEN GET STACKED DIAGNOSTICS details=PG_EXCEPTION_DETAIL; ack:=(details::jsonb)->'ack'; END;
 PERFORM pg_temp.review_assert((details::jsonb)->'shortages'->0->>'requested_quantity'='10','trusted server-loaded quantity wins over client items');
 req:=gen_random_uuid(); draft:=draft||jsonb_build_object('promo_stock_ack',ack);
 r:=public.pilot_order_transaction(req,'approve_sales',draft);
 PERFORM pg_temp.review_assert(public.pilot_order_transaction(req,'approve_sales',draft)=r,'legacy conversion exact replay');
 PERFORM pg_temp.review_refuse(format('SELECT public.pilot_order_transaction(%L,%L,%L::jsonb)',gen_random_uuid(),'approve_sales',draft),'55000');
 PERFORM pg_temp.review_assert((SELECT sales_attribution_state='legacy' AND sales_person_id_at_creation IS NULL AND total_value=170 FROM public.purchase_orders WHERE id=(r->>'id')::uuid),'legacy lineage and entered prices preserved');
 PERFORM pg_temp.review_assert((SELECT product_id='fa200000-0000-0000-0000-000000000001' AND sku='REVIEW-ORIGINAL' AND product_name='Review original' AND quantity=10 AND unit_price=17 FROM public.po_line_items WHERE purchase_order_id=(r->>'id')::uuid),'renamed catalog does not replace legacy snapshots');
 PERFORM pg_temp.review_assert((SELECT submitted_by='fa000000-0000-0000-0000-000000000002' AND status='approved' AND po_id=(r->>'id')::uuid FROM public.girard_orders WHERE id='fa600000-0000-0000-0000-000000000001'),'one original Girard linkage retained');
 PERFORM pg_temp.review_refuse(format('SELECT public.pilot_order_transaction(%L,%L,%L::jsonb)',gen_random_uuid(),'create_po','{"customer_id":"fa100000-0000-0000-0000-000000000001","po_number":"REVIEW-CLIENT-OLD-SKU","items":[{"product_id":"fa200000-0000-0000-0000-000000000001","product_name":"Review original","sku":"REVIEW-ORIGINAL","quantity":1,"unit_price":17}]}'),'22023');
END $$;
RESET ROLE;
SELECT pg_temp.review_assert((SELECT remaining_quantity=0 FROM public.promotions WHERE id='fa700000-0000-0000-0000-000000000001'),'conversion allocates five once at zero floor');
SELECT pg_temp.review_assert((SELECT count(*)=1 AND sum(quantity)=5 FROM private.pilot_promo_slices WHERE promotion_id='fa700000-0000-0000-0000-000000000001'),'conversion replay does not duplicate stock slice');
SELECT 'DEMO_REVIEW_LEGACY_CONVERSION_PASSED' AS result;
-- A stale acknowledgment cannot disappear with its campaign or with its shortage.
INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('promotion-images','promotions/fa000000-0000-0000-0000-000000000001/fa700000-0000-0000-0000-000000000002/fa800000-0000-0000-0000-000000000002.webp','fa000000-0000-0000-0000-000000000001','{"size":128,"mimetype":"image/webp"}');
CREATE FUNCTION pg_temp.review_stock_version(promo uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT (j->>'stock_version')::bigint FROM jsonb_array_elements(public.pilot_promotions_v1(true)->'items') j WHERE j->>'id'=promo::text $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE scenario text; campaign uuid:='fa700000-0000-0000-0000-000000000001'; draft jsonb; old_ack jsonb; fresh_ack jsonb; details text; req uuid; r jsonb; BEGIN
 PERFORM public.pilot_promotion_transaction_v1(gen_random_uuid(),'adjust_stock',jsonb_build_object('promotion_id',campaign,'expected_stock_version',pg_temp.review_stock_version(campaign),'quantity_delta',5,'reason','Reset review availability'));
 FOREACH scenario IN ARRAY ARRAY['pause','replacement','replenishment'] LOOP
  draft:=jsonb_build_object('customer_id','fa100000-0000-0000-0000-000000000001','po_number','REVIEW-QUOTE-'||scenario,'items','[{"product_id":"fa200000-0000-0000-0000-000000000001","product_name":"Review current","sku":"REVIEW-RENAMED","quantity":10,"unit_price":17}]'::jsonb);
  BEGIN PERFORM public.pilot_order_transaction(gen_random_uuid(),'create_po',draft); RAISE EXCEPTION 'ASSERT initial warning absent'; EXCEPTION WHEN SQLSTATE 'PT409' THEN GET STACKED DIAGNOSTICS details=PG_EXCEPTION_DETAIL; old_ack:=(details::jsonb)->'ack'; END;
  IF scenario IN ('pause','replacement') THEN
   PERFORM public.pilot_promotion_transaction_v1(gen_random_uuid(),'set_active',jsonb_build_object('promotion_id',campaign,'expected_stock_version',pg_temp.review_stock_version(campaign),'is_active',false));
  END IF;
  IF scenario='replacement' THEN
   campaign:='fa700000-0000-0000-0000-000000000002';
   PERFORM public.pilot_promotion_transaction_v1(gen_random_uuid(),'create_promotion','{"id":"fa700000-0000-0000-0000-000000000002","product_id":"fa200000-0000-0000-0000-000000000001","opening_quantity":12,"image_path":"promotions/fa000000-0000-0000-0000-000000000001/fa700000-0000-0000-0000-000000000002/fa800000-0000-0000-0000-000000000002.webp","harga_pokok":0,"luar_kota":null,"dalam_kota":null,"depo_bangunan":null,"is_active":true}');
  ELSIF scenario='replenishment' THEN
   PERFORM public.pilot_promotion_transaction_v1(gen_random_uuid(),'adjust_stock',jsonb_build_object('promotion_id',campaign,'expected_stock_version',pg_temp.review_stock_version(campaign),'quantity_delta',20,'reason','Eliminate prior shortage'));
  END IF;
  req:=gen_random_uuid();
  BEGIN PERFORM public.pilot_order_transaction(req,'create_po',draft||jsonb_build_object('promo_stock_ack',old_ack)); RAISE EXCEPTION 'ASSERT stale ack silently committed after %',scenario;
  EXCEPTION WHEN SQLSTATE 'PT409' THEN GET STACKED DIAGNOSTICS details=PG_EXCEPTION_DETAIL; fresh_ack:=(details::jsonb)->'ack'; END;
  PERFORM pg_temp.review_assert(details::jsonb->>'code'='PROMO_STOCK_CHANGED','dedicated changed-quote code for '||scenario);
  PERFORM pg_temp.review_assert(jsonb_array_length(details::jsonb->'shortages')=0,'no obsolete shortages shown after '||scenario);
  PERFORM pg_temp.review_assert(public.pilot_reconcile_request(req,false)->>'state'='unknown' AND NOT EXISTS(SELECT 1 FROM public.purchase_orders WHERE po_number=draft->>'po_number'),'changed-quote refusal rolls back PO and request');
  PERFORM pg_temp.review_assert(details::jsonb->'allocations'->0->>'allocation_quantity'=CASE WHEN scenario='pause' THEN '0' ELSE '10' END,'fresh current allocation shown');
  IF scenario='pause' THEN
   PERFORM pg_temp.review_assert(details::jsonb->'allocations'->0->'promotion_id'='null'::jsonb AND details::jsonb->'allocations'->0->'stock_version'='null'::jsonb,'no enabled campaign explicitly represented');
   -- Initial drafts without any earlier quote remain eligible when no campaign is enabled.
   PERFORM public.pilot_order_transaction(gen_random_uuid(),'create_po',draft||'{"po_number":"REVIEW-NO-CAMPAIGN-INITIAL"}');
  END IF;
  r:=public.pilot_order_transaction(gen_random_uuid(),'create_po',draft||jsonb_build_object('promo_stock_ack',fresh_ack));
  PERFORM pg_temp.review_assert(r->>'id' IS NOT NULL,'fresh explicit acknowledgment can proceed');
  IF scenario='pause' THEN PERFORM public.pilot_promotion_transaction_v1(gen_random_uuid(),'set_active',jsonb_build_object('promotion_id',campaign,'expected_stock_version',pg_temp.review_stock_version(campaign),'is_active',true)); END IF;
 END LOOP;
END $$;
RESET ROLE;
SELECT 'DEMO_REVIEW_CHANGED_QUOTES_PASSED' AS result;
-- Optional later visit-family ledger: own order receipts win; visit tombstones are not global.
DO $$ BEGIN IF to_regclass('private.pilot_visit_requests') IS NULL THEN
 CREATE TABLE private.pilot_visit_requests(actor_id uuid,request_id uuid,operation text,payload jsonb,result jsonb,abandoned boolean DEFAULT false,created_at timestamptz DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,request_id));
 END IF; END $$;
INSERT INTO private.pilot_visit_requests(actor_id,request_id,operation,payload,result,abandoned) VALUES
('fa000000-0000-0000-0000-000000000001','fa900000-0000-0000-0000-000000000001','finalize_visit','{}','{"id":"fa900000-0000-0000-0000-000000000099"}',false),
('fa000000-0000-0000-0000-000000000001','fa900000-0000-0000-0000-000000000002','visit_recovery_abandoned','{}',NULL,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 PERFORM pg_temp.review_refuse($q$SELECT public.pilot_reconcile_request('fa900000-0000-0000-0000-000000000001',true)$q$,'22023');
 r:=public.pilot_order_transaction('fa900000-0000-0000-0000-000000000002','create_po','{"customer_id":"fa100000-0000-0000-0000-000000000001","po_number":"REVIEW-FAMILY-LOCAL","items":[{"product_name":"Manual","quantity":1,"unit_price":0}]}');
 PERFORM pg_temp.review_assert(public.pilot_reconcile_request('fa900000-0000-0000-0000-000000000002',false)->'result'=r,'visit tombstone cannot block valid order or its recovery');
END $$;
RESET ROLE;
SELECT 'DEMO_REVIEW_CROSS_FAMILY_GUARD_PASSED' AS result;
ROLLBACK;
