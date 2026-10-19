-- Coherent SOURCE-FIXTURE generation-two proof, not native hosted cutover parity.
-- Every temporary cutover, fixture row and receipt is rolled back.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'pilot_co_test' OR session_user<>'postgres'
 OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci')
 OR NOT EXISTS(SELECT 1 FROM private.catalog_cutover_v1 WHERE execution_generation=1 AND NOT tracking_ready)
 THEN RAISE EXCEPTION 'Disposable inactive catalogue fixture required'; END IF;
END $$;
CREATE FUNCTION pg_temp.sjc_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'SJ catalogue assertion: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.sjc_raises(command text,expected text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE caught text;
BEGIN BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS caught=RETURNED_SQLSTATE; END;
 IF caught IS DISTINCT FROM expected THEN RAISE EXCEPTION 'SJ catalogue %: expected %, got %',label,expected,coalesce(caught,'success'); END IF;
END $$;
SELECT private.catalog_assert_checked_graph_v2();
SELECT private.catalog_history_producers_v1();
INSERT INTO auth.users(id) VALUES(md5('sj-catalogue-admin')::uuid);
INSERT INTO public.users(id,full_name,email,role,is_active) VALUES(md5('sj-catalogue-admin')::uuid,'SJ catalogue admin','sj-catalogue@example.invalid','po_admin',true);
INSERT INTO public.customers(id,name) VALUES(md5('sj-catalogue-customer')::uuid,'SJ catalogue synthetic customer');
CREATE TEMP TABLE sjc_state(k text PRIMARY KEY,v jsonb);
GRANT ALL ON pg_temp.sjc_state TO authenticated;
SELECT set_config('request.jwt.claim.sub',md5('sj-catalogue-admin')::uuid::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; po uuid; line uuid; BEGIN
 r:=public.pilot_order_transaction(gen_random_uuid(),'create_po',jsonb_build_object('customer_id',md5('sj-catalogue-customer')::uuid,'po_number','SJ-CATALOGUE-PO','items',jsonb_build_array(jsonb_build_object('product_name','Synthetic date-only line','quantity',1,'unit_price',123))));
 po:=(r->>'id')::uuid;
 SELECT id INTO STRICT line FROM public.po_line_items WHERE purchase_order_id=po;
 r:=public.pilot_order_transaction(gen_random_uuid(),'save_delivery',jsonb_build_object('po_id',po,'expected_updated_at',r->>'updated_at','sj_number','SJ-CATALOGUE-1','sj_date','2026-10-01','sj_date_received','2026-10-02','sj_date_returned','2026-10-03','lines',jsonb_build_array(jsonb_build_object('po_line_item_id',line,'quantity_delivered',1))));
 INSERT INTO pg_temp.sjc_state VALUES('target',r);
END $$;
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
UPDATE public.purchase_orders SET completed_at=clock_timestamp()-interval '12 days' WHERE po_number='SJ-CATALOGUE-PO';
CREATE FUNCTION pg_temp.sjc_payload(value jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('sj_id',s.id,'expected_updated_at',p.updated_at,'sj_date_received',value)
 FROM public.surat_jalan s JOIN public.purchase_orders p ON p.id=s.purchase_order_id WHERE p.po_number='SJ-CATALOGUE-PO'
$$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE req uuid:=gen_random_uuid(); p jsonb:=pg_temp.sjc_payload('"2026-10-06"'); r jsonb; BEGIN
 r:=public.pilot_order_transaction(req,'edit_sj_received_date',p);
 INSERT INTO pg_temp.sjc_state VALUES('generation-one',jsonb_build_object('request',req,'payload',p,'result',r));
END $$;
RESET ROLE;
-- Exact retained receipt grammar adds no new identity or lineage shortcuts.
DO $$ DECLARE r jsonb; actual jsonb; equivalent jsonb; bad jsonb;
 profile jsonb:='{"sourceCommit":"c38b14fd122fc5dd08080f9a48adce254e4c3e52","schemaProfile":"public-po-source-20261014","producerPinsSha256":"8085f8784fb1071ef91f994bb962af9731ea8c9a2aa61023fcf88b7b8be20cb1"}';
BEGIN
 SELECT to_jsonb(q) INTO STRICT r FROM private.pilot_order_requests q WHERE request_id=((SELECT v FROM pg_temp.sjc_state WHERE k='generation-one')->>'request')::uuid;
 actual:=private.catalog_history_extract_v1('private.pilot_order_requests',r);
 PERFORM pg_temp.sjc_assert(actual->'ok'='true','retained generation-one request history accepted');
 equivalent:=jsonb_set(jsonb_set(r,'{operation}','"edit_sj_returned_date"'),'{payload}',((r->'payload')-'sj_date_received')||jsonb_build_object('sj_date_returned',r->'payload'->'sj_date_received'));
 PERFORM pg_temp.sjc_assert(actual=private.catalog_history_extract_v1('private.pilot_order_requests',equivalent),'delivery and parent lineage edges identical to returned-date operation');
 bad:=jsonb_set(r,'{execution_version}','0');
 PERFORM pg_temp.sjc_assert(private.catalog_por_extract_event_v1('private.pilot_order_requests','INSERT',NULL,bad,profile)->>'code'='UNSUPPORTED_LEGACY_PROFILE','received-date execution zero remains unsupported');
 bad:=jsonb_set(r,'{payload}',r->'payload'||'{"lines":[]}');
 PERFORM pg_temp.sjc_assert(private.catalog_por_extract_event_v1('private.pilot_order_requests','INSERT',NULL,bad,profile)->>'code'='UNKNOWN_SHAPE','history exact payload allowlist');
 bad:=jsonb_set(r,'{result,id}',to_jsonb(gen_random_uuid()::text));
 PERFORM pg_temp.sjc_assert(private.catalog_por_extract_event_v1('private.pilot_order_requests','INSERT',NULL,bad,profile)->>'code'='CONTRADICTORY_LINEAGE','history receipt cannot change delivery identity');
 SELECT to_jsonb(a) INTO STRICT r FROM public.po_audit_log a WHERE purchase_order_id=((SELECT v FROM pg_temp.sjc_state WHERE k='target')->>'po_id')::uuid AND field_changed='sj_date_received';
 actual:=private.catalog_history_extract_v1('public.po_audit_log',r);
 PERFORM pg_temp.sjc_assert(actual->'ok'='true','explicit received-date audit accepted');
 equivalent:=jsonb_set(r,'{field_changed}','"sj_date_returned"');
 PERFORM pg_temp.sjc_assert(actual=private.catalog_history_extract_v1('public.po_audit_log',equivalent),'audit preserves identical parent lineage');
END $$;
-- This isolated synthetic graph is coherent. Native staging still refuses this
-- cutover because of inherited audit hook pin/topology differences, tested apart.
ALTER TABLE private.catalog_cutover_v1 DROP CONSTRAINT catalog_foundation_generation_one,DROP CONSTRAINT catalog_foundation_not_ready;
UPDATE private.catalog_cutover_v1 SET execution_generation=2,tracking_ready=true WHERE singleton;
INSERT INTO pg_temp.sjc_state SELECT 'po-before',to_jsonb(p)-'updated_at' FROM public.purchase_orders p WHERE po_number='SJ-CATALOGUE-PO';
INSERT INTO pg_temp.sjc_state SELECT 'sj-before',to_jsonb(s)-'sj_date_received' FROM public.surat_jalan s WHERE sj_number='SJ-CATALOGUE-1';
INSERT INTO pg_temp.sjc_state SELECT 'lines-before',jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.sj_line_items l WHERE surat_jalan_id=((SELECT v FROM pg_temp.sjc_state WHERE k='target')->>'id')::uuid;
SET LOCAL ROLE authenticated;
DO $$ DECLARE req uuid:=gen_random_uuid(); p jsonb:=pg_temp.sjc_payload('"2026-10-07"'); r jsonb; old jsonb:=(SELECT v FROM pg_temp.sjc_state WHERE k='generation-one'); BEGIN
 PERFORM pg_temp.sjc_assert(public.pilot_order_transaction((old->>'request')::uuid,'edit_sj_received_date',old->'payload')=old->'result','generation-one replay survives cutover');
 PERFORM pg_temp.sjc_assert(public.pilot_reconcile_request((old->>'request')::uuid,false)->>'state'='committed','generation-one recovery survives cutover');
 r:=public.pilot_order_transaction(req,'edit_sj_received_date',p);
 INSERT INTO pg_temp.sjc_state VALUES('generation-two',jsonb_build_object('request',req,'payload',p,'result',r));
 PERFORM pg_temp.sjc_assert(public.pilot_order_transaction(req,'edit_sj_received_date',p)=r,'generation-two exact replay');
 PERFORM pg_temp.sjc_assert(public.pilot_reconcile_request(req,false)->>'state'='committed','generation-two recovery');
 PERFORM pg_temp.sjc_raises(format('SELECT public.pilot_order_transaction(%L,%L,%L)',gen_random_uuid(),'edit_sj_received_date',p),'PT409','generation-two stale conflict');
 PERFORM pg_temp.sjc_assert((SELECT to_jsonb(po_row)-'updated_at'=(SELECT v FROM pg_temp.sjc_state WHERE k='po-before') FROM public.purchase_orders po_row WHERE po_number='SJ-CATALOGUE-PO'),'generation-two date does not reconcile completion or quantities');
 PERFORM pg_temp.sjc_assert((SELECT to_jsonb(s)-'sj_date_received'=(SELECT v FROM pg_temp.sjc_state WHERE k='sj-before') FROM public.surat_jalan s WHERE sj_number='SJ-CATALOGUE-1'),'generation-two date changes no other header');
 PERFORM pg_temp.sjc_assert((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id)=(SELECT v FROM pg_temp.sjc_state WHERE k='lines-before') FROM public.sj_line_items l WHERE surat_jalan_id=(r->>'id')::uuid),'generation-two leaves line rows identical');
 PERFORM pg_temp.sjc_assert((SELECT count(*)=1 FROM public.po_audit_log WHERE purchase_order_id=(r->>'po_id')::uuid AND field_changed='sj_date_received' AND old_value='2026-10-06' AND new_value='2026-10-07' AND changed_by=auth.uid()),'generation-two one explicit old/new audit');
 PERFORM pg_temp.sjc_raises(format('SELECT public.pilot_order_transaction(%L,%L,%L)',gen_random_uuid(),'edit_sj_received_date',pg_temp.sjc_payload('"2026-02-30"')),'22023','generation-two real-calendar validation');
 PERFORM public.pilot_order_transaction(gen_random_uuid(),'edit_sj_received_date',pg_temp.sjc_payload('null'));
END $$;
RESET ROLE;
-- Queue admission, checked capabilities and history producers all remain active.
SET CONSTRAINTS ALL IMMEDIATE;
SELECT private.catalog_assert_checked_graph_v2();
SELECT private.catalog_history_producers_v1();
DO $$ DECLARE r jsonb; normalized jsonb; BEGIN
 SELECT to_jsonb(q) INTO STRICT r FROM private.pilot_order_requests q WHERE request_id=((SELECT v FROM pg_temp.sjc_state WHERE k='generation-two')->>'request')::uuid;
 PERFORM pg_temp.sjc_assert(r->>'execution_version'='2','generation-two receipt carries version two');
 normalized:=jsonb_set(r,'{execution_version}','1');
 PERFORM pg_temp.sjc_assert(private.catalog_history_extract_v1('private.pilot_order_requests',r)=private.catalog_history_extract_v1('private.pilot_order_requests',normalized),'generation-two history normalizes only execution version');
 PERFORM pg_temp.sjc_assert(NOT EXISTS(SELECT 1 FROM private.catalog_po_active_v2),'PO execution context fully cleaned');
END $$;
ROLLBACK;
SELECT 'SJ_RECEIVED_DATE_COHERENT_SYNTHETIC_V2_PASSED';
