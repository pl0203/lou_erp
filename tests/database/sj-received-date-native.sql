-- Rollback-only native-SJ-hook characterization, not hosted mutation or cutover.
-- The runner has already applied the exact native SJ audit fixture.
-- Native graph/history incompatibility is inherited and must remain fail closed.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$ BEGIN
 IF current_database()<>'pilot_co_test' OR session_user<>'postgres' OR current_user<>'postgres'
 OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci')
 OR NOT EXISTS(SELECT 1 FROM private.catalog_cutover_v1 WHERE singleton AND execution_generation=1 AND NOT tracking_ready)
 THEN RAISE EXCEPTION 'Disposable installed-catalogue owner fixture required'; END IF;
END $guard$;
CREATE FUNCTION pg_temp.sj_native_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Native SJ assertion: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.sj_native_raises(command text,expected_state text,expected_detail text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE caught text; detail text;
BEGIN
 BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS caught=RETURNED_SQLSTATE,detail=PG_EXCEPTION_DETAIL; END;
 IF caught IS DISTINCT FROM expected_state OR (expected_detail IS NOT NULL AND detail IS DISTINCT FROM expected_detail)
 THEN RAISE EXCEPTION 'Native SJ %: expected %/%, got %/%',label,expected_state,expected_detail,coalesce(caught,'success'),detail; END IF;
END $$;
SELECT pg_temp.sj_native_assert((SELECT md5(prosrc)='6384834bc48bd11189b3d4387fa76a1f'
 AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']
 FROM pg_proc WHERE oid='public.log_sj_changes()'::regprocedure),'exact native audit producer retained');
SELECT pg_temp.sj_native_assert((SELECT count(*)=1 AND bool_and(tgname='trg_log_sj_changes' AND tgenabled='O' AND tgtype=29)
 FROM pg_trigger WHERE tgrelid='public.surat_jalan'::regclass AND tgfoid='public.log_sj_changes()'::regprocedure AND NOT tgisinternal),'native audit hook is actually connected');
SELECT pg_temp.sj_native_raises('SELECT private.catalog_assert_checked_graph_v2()','55000','CATALOG_TRACKING_INCOMPLETE','inherited native trigger graph refusal');
SELECT pg_temp.sj_native_raises('SELECT private.catalog_history_producers_v1()','23514','CATALOG_TRACKING_INCOMPLETE','inherited native history producer refusal');

INSERT INTO auth.users(id) VALUES(md5('sj-native-po-admin')::uuid);
INSERT INTO public.users(id,full_name,email,role)
 VALUES(md5('sj-native-po-admin')::uuid,'Native SJ synthetic operator','sj-native@example.invalid','po_admin');
CREATE TEMP TABLE sj_native_state(k text PRIMARY KEY,v jsonb) ON COMMIT DROP;
GRANT ALL ON pg_temp.sj_native_state TO authenticated;
SELECT set_config('request.jwt.claim.sub',md5('sj-native-po-admin')::uuid::text,true);
SET LOCAL ROLE authenticated;
DO $legacy_success$
DECLARE customer jsonb; product jsonb; edited jsonb; r jsonb; po uuid; line uuid; sj uuid; payload jsonb;
BEGIN
 -- Catalogue form writes keep their native reviewed policy/auth contracts.
 customer:=public.pilot_catalog_transaction_v1(md5('sj-native-create-customer')::uuid,'create',jsonb_build_object('kind','customer','values',jsonb_build_object(
  'name','Native SJ synthetic customer','address',NULL,'city',NULL,'phone',NULL,'email',NULL,'pricing_tier','luar_kota','customer_category','perorangan')));
 edited:=public.pilot_catalog_transaction_v1(md5('sj-native-edit-customer')::uuid,'edit',jsonb_build_object('kind','customer','id',customer->>'id','expected_version','1','values',jsonb_build_object('name','Native SJ edited customer')));
 PERFORM pg_temp.sj_native_assert(edited->'after'->>'catalog_version'='2','catalogue customer create/edit remains available');
 product:=public.pilot_catalog_transaction_v1(md5('sj-native-create-product')::uuid,'create',jsonb_build_object('kind','product','values',jsonb_build_object(
  'name','Native SJ synthetic product','sku','SJ-NATIVE-PRODUCT','size',NULL,'harga_pokok',NULL,'luar_kota',10,'dalam_kota',NULL,'depo_bangunan',NULL)));
 edited:=public.pilot_catalog_transaction_v1(md5('sj-native-edit-product')::uuid,'edit',jsonb_build_object('kind','product','id',product->>'id','expected_version','1','values',jsonb_build_object('name','Native SJ edited product')));
 PERFORM pg_temp.sj_native_assert(edited->'after'->>'catalog_version'='2','catalogue product create/edit remains available');
 r:=public.pilot_order_transaction(md5('sj-native-create-po')::uuid,'create_po',jsonb_build_object('customer_id',customer->>'id','po_number','SJ-NATIVE-PO','items',jsonb_build_array(jsonb_build_object(
  'product_id',product->>'id','product_name','Native SJ agreed label','sku','SJ-NATIVE-PRODUCT','quantity',2,'unit_price',10))));
 po:=(r->>'id')::uuid;
 SELECT id INTO STRICT line FROM public.po_line_items WHERE purchase_order_id=po;
 r:=public.pilot_order_transaction(md5('sj-native-edit-po')::uuid,'edit_po',jsonb_build_object('po_id',po,'customer_id',customer->>'id','expected_updated_at',r->>'updated_at','notes','Ordinary PO edit retained','items',jsonb_build_array(jsonb_build_object(
  'id',line,'product_id',product->>'id','product_name','Native SJ agreed label','sku','SJ-NATIVE-PRODUCT','quantity',2,'unit_price',10))));
 PERFORM pg_temp.sj_native_assert((SELECT notes='Ordinary PO edit retained' FROM public.purchase_orders WHERE id=po),'ordinary PO create/edit succeeds');
 r:=public.pilot_order_transaction(md5('sj-native-create-delivery')::uuid,'save_delivery',jsonb_build_object('po_id',po,'expected_updated_at',r->>'updated_at',
  'sj_number','SJ-NATIVE-1','sj_date','2026-10-01','sj_date_received','2026-10-02','sj_date_returned','2026-10-03',
  'lines',jsonb_build_array(jsonb_build_object('po_line_item_id',line,'quantity_delivered',1))));
 sj:=(r->>'id')::uuid;
 payload:=jsonb_build_object('po_id',po,'sj_id',sj,'expected_updated_at',r->>'updated_at','sj_number','SJ-NATIVE-1','sj_date','2026-10-01',
  'sj_date_received','2026-10-02','sj_date_returned','2026-10-03','lines',jsonb_build_array(jsonb_build_object('po_line_item_id',line,'quantity_delivered',2)));
 r:=public.pilot_order_transaction(md5('sj-native-full-save')::uuid,'save_delivery',payload);
 PERFORM pg_temp.sj_native_assert((SELECT quantity_delivered=2 FROM public.sj_line_items WHERE surat_jalan_id=sj),'ordinary full delivery save succeeds');
 INSERT INTO pg_temp.sj_native_state VALUES('delivery',r),('full-payload',payload);
END $legacy_success$;
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
UPDATE public.purchase_orders SET completed_at=clock_timestamp()-interval '12 days' WHERE po_number='SJ-NATIVE-PO';
SET LOCAL ROLE authenticated;
DO $returned_success$ DECLARE r jsonb; BEGIN
 r:=public.pilot_order_transaction(md5('sj-native-returned-date')::uuid,'edit_sj_returned_date',jsonb_build_object(
  'sj_id',(SELECT v->>'id' FROM pg_temp.sj_native_state WHERE k='delivery'),'expected_updated_at',(SELECT updated_at FROM public.purchase_orders WHERE po_number='SJ-NATIVE-PO'),'sj_date_returned','2026-10-05'));
 PERFORM pg_temp.sj_native_assert((SELECT sj_date_returned='2026-10-05' FROM public.surat_jalan WHERE id=(r->>'id')::uuid),'returned date retains fourteen-day window');
 PERFORM pg_temp.sj_native_raises(format('SELECT public.pilot_order_transaction(%L,%L,%L::jsonb)',md5('sj-native-late-full')::uuid,'save_delivery',
  (SELECT v FROM pg_temp.sj_native_state WHERE k='full-payload')||jsonb_build_object('expected_updated_at',r->>'updated_at')),'55000',NULL,'full-save correction still closes after seven days');
END $returned_success$;
RESET ROLE;
INSERT INTO pg_temp.sj_native_state SELECT 'po-before',to_jsonb(p)-'updated_at' FROM public.purchase_orders p WHERE po_number='SJ-NATIVE-PO';
INSERT INTO pg_temp.sj_native_state SELECT 'sj-before',to_jsonb(s)-'sj_date_received' FROM public.surat_jalan s WHERE sj_number='SJ-NATIVE-1';
INSERT INTO pg_temp.sj_native_state SELECT 'lines-before',jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.sj_line_items l WHERE surat_jalan_id=(SELECT (v->>'id')::uuid FROM pg_temp.sj_native_state WHERE k='delivery');
INSERT INTO pg_temp.sj_native_state SELECT 'native-count-before',to_jsonb(count(*)) FROM public.po_audit_log WHERE purchase_order_id=(SELECT (v->>'po_id')::uuid FROM pg_temp.sj_native_state WHERE k='delivery') AND field_changed='sj_updated';
SET LOCAL ROLE authenticated;
DO $received_success$
DECLARE req uuid:=md5('sj-native-received-date')::uuid; payload jsonb; r jsonb;
BEGIN
 payload:=jsonb_build_object('sj_id',(SELECT v->>'id' FROM pg_temp.sj_native_state WHERE k='delivery'),
  'expected_updated_at',(SELECT updated_at FROM public.purchase_orders WHERE po_number='SJ-NATIVE-PO'),'sj_date_received','2026-10-07');
 r:=public.pilot_order_transaction(req,'edit_sj_received_date',payload);
 PERFORM pg_temp.sj_native_assert(public.pilot_order_transaction(req,'edit_sj_received_date',payload)=r,'native generation-one terminal replay');
 PERFORM pg_temp.sj_native_assert(public.pilot_reconcile_request(req,false)=jsonb_build_object('state','committed','operation','edit_sj_received_date','result',r),'native generation-one recovery');
 INSERT INTO pg_temp.sj_native_state VALUES('committed',jsonb_build_object('request',req,'payload',payload,'result',r));
 PERFORM pg_temp.sj_native_assert((SELECT count(*)=1 AND bool_and(changed_by=auth.uid() AND old_value='2026-10-02' AND new_value='2026-10-07')
  FROM public.po_audit_log WHERE purchase_order_id=(r->>'po_id')::uuid AND field_changed='sj_date_received'),'exactly one explicit actor/old/new date audit');
 PERFORM pg_temp.sj_native_assert((SELECT count(*)=((SELECT v FROM pg_temp.sj_native_state WHERE k='native-count-before')#>>'{}')::bigint+1
  FROM public.po_audit_log WHERE purchase_order_id=(r->>'po_id')::uuid AND field_changed='sj_updated'),'exactly one additional native generic sj_updated event, none for replay');
 PERFORM pg_temp.sj_native_assert((SELECT bool_and(changed_by=auth.uid() AND old_value='SJ SJ-NATIVE-1 (2026-10-01)' AND new_value='SJ SJ-NATIVE-1 (2026-10-01)')
  FROM public.po_audit_log WHERE purchase_order_id=(r->>'po_id')::uuid AND field_changed='sj_updated'),'native generic text remains unchanged and does not claim date detail');
 PERFORM pg_temp.sj_native_assert((SELECT to_jsonb(p)-'updated_at'=(SELECT v FROM pg_temp.sj_native_state WHERE k='po-before') FROM public.purchase_orders p WHERE id=(r->>'po_id')::uuid),'received-only edit preserves PO status, completion and value');
 PERFORM pg_temp.sj_native_assert((SELECT to_jsonb(s)-'sj_date_received'=(SELECT v FROM pg_temp.sj_native_state WHERE k='sj-before') FROM public.surat_jalan s WHERE id=(r->>'id')::uuid),'received-only edit preserves every other SJ field');
 PERFORM pg_temp.sj_native_assert((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id)=(SELECT v FROM pg_temp.sj_native_state WHERE k='lines-before') FROM public.sj_line_items l WHERE surat_jalan_id=(r->>'id')::uuid),'received-only edit preserves line identities and quantities');
END $received_success$;
RESET ROLE;
SELECT pg_temp.sj_native_assert((SELECT execution_version=1 FROM private.pilot_order_requests WHERE request_id=md5('sj-native-received-date')::uuid),'native command is stored as generation one');

CREATE FUNCTION pg_temp.sj_native_snapshot() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
  'po',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.purchase_orders p),
  'sj',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.surat_jalan s),
  'lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.sj_line_items l),
  'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.po_audit_log a),
  'requests',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_id,request_id) FROM private.pilot_order_requests r),
  'identities',(SELECT jsonb_agg(to_jsonb(i) ORDER BY kind,id) FROM private.catalog_identity_v1 i),
  'active',(SELECT jsonb_agg(to_jsonb(a) ORDER BY backend_pid,transaction_id) FROM private.catalog_po_active_v2 a),
  'checked',(SELECT jsonb_agg(to_jsonb(c) ORDER BY backend_pid,transaction_id) FROM private.catalog_checked_scope_v2 c));
$$;
-- Synthetic rollback-only routing switch. This cannot certify native readiness.
ALTER TABLE private.catalog_cutover_v1 DROP CONSTRAINT catalog_foundation_generation_one;
ALTER TABLE private.catalog_cutover_v1 DROP CONSTRAINT catalog_foundation_not_ready;
UPDATE private.catalog_cutover_v1 SET execution_generation=2,tracking_ready=true WHERE singleton;
INSERT INTO pg_temp.sj_native_state VALUES('refusal-before',pg_temp.sj_native_snapshot());
SET LOCAL ROLE authenticated;
SELECT pg_temp.sj_native_raises(format('SELECT public.pilot_order_transaction(%L,%L,%L::jsonb)',md5('sj-native-gen2-refused')::uuid,'edit_sj_received_date',
 jsonb_build_object('sj_id',(SELECT v->>'id' FROM pg_temp.sj_native_state WHERE k='delivery'),'expected_updated_at',(SELECT updated_at FROM public.purchase_orders WHERE po_number='SJ-NATIVE-PO'),'sj_date_received','2026-10-08')),
 '55000','CATALOG_TRACKING_INCOMPLETE','fresh native generation-two command refuses inherited graph');
SELECT pg_temp.sj_native_assert(public.pilot_order_transaction((v->>'request')::uuid,'edit_sj_received_date',v->'payload')=v->'result','terminal generation-one replay survives generation-two selection') FROM pg_temp.sj_native_state WHERE k='committed';
SELECT pg_temp.sj_native_assert(public.pilot_reconcile_request((v->>'request')::uuid,false)=jsonb_build_object('state','committed','operation','edit_sj_received_date','result',v->'result'),'terminal generation-one recovery survives generation-two selection') FROM pg_temp.sj_native_state WHERE k='committed';
RESET ROLE;
SELECT pg_temp.sj_native_assert(pg_temp.sj_native_snapshot()=(SELECT v FROM pg_temp.sj_native_state WHERE k='refusal-before'),'native generation-two refusal and terminal replay change no business row, audit, ledger or active scope');
SELECT pg_temp.sj_native_assert(NOT EXISTS(SELECT 1 FROM private.pilot_order_requests WHERE request_id=md5('sj-native-gen2-refused')::uuid),'refused generation-two request leaves no receipt');
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
SELECT 'SJ_RECEIVED_DATE_NATIVE_LIMITS_PASSED';
