-- Rollback-only synthetic regression against the final post-CO baseline.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'pilot_co_test' OR session_user<>'postgres'
 OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci')
 THEN RAISE EXCEPTION 'Disposable post-CO fixture required'; END IF;
END $$;
CREATE FUNCTION pg_temp.sj_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'SJ received assertion: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.sj_raises(command text,expected text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE caught text;
BEGIN
 BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS caught=RETURNED_SQLSTATE; END;
 IF caught IS DISTINCT FROM expected THEN RAISE EXCEPTION 'SJ received %: expected %, got %',label,expected,coalesce(caught,'success'); END IF;
END $$;
INSERT INTO auth.users(id) SELECT md5('sj-date-user-'||n)::uuid FROM generate_series(1,7)n;
INSERT INTO public.users(id,full_name,email,role,is_active)
SELECT md5('sj-date-user-'||n)::uuid,'SJ date fixture '||n,'sj-date-'||n||'@example.invalid',
 (CASE n WHEN 1 THEN 'po_admin' WHEN 2 THEN 'executive' WHEN 3 THEN 'sales_head' WHEN 4 THEN 'co_admin' WHEN 5 THEN 'po_admin' WHEN 6 THEN 'sales_person' ELSE 'sales_manager' END)::public.user_role,n<>5
FROM generate_series(1,7)n;
INSERT INTO public.customers(id,name) VALUES(md5('sj-date-customer')::uuid,'SJ date synthetic customer');
CREATE TEMP TABLE sj_date_state(k text PRIMARY KEY,v jsonb);
GRANT ALL ON pg_temp.sj_date_state TO authenticated;
SELECT set_config('request.jwt.claim.sub',md5('sj-date-user-1')::uuid::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; po uuid; line uuid; BEGIN
 r:=public.pilot_order_transaction(gen_random_uuid(),'create_po',jsonb_build_object('customer_id',md5('sj-date-customer')::uuid,'po_number','SJ-DATE-PO','items',jsonb_build_array(jsonb_build_object('product_name','Synthetic received-date line','quantity',1,'unit_price',123))));
 po:=(r->>'id')::uuid;
 SELECT id INTO STRICT line FROM public.po_line_items WHERE purchase_order_id=po;
 r:=public.pilot_order_transaction(gen_random_uuid(),'save_delivery',jsonb_build_object('po_id',po,'expected_updated_at',r->>'updated_at','sj_number','SJ-DATE-1','sj_date','2026-10-01','sj_date_received','2026-10-02','sj_date_returned','2026-10-03','lines',jsonb_build_array(jsonb_build_object('po_line_item_id',line,'quantity_delivered',1))));
 INSERT INTO pg_temp.sj_date_state VALUES('receipt',r);
END $$;
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
UPDATE public.purchase_orders SET completed_at=clock_timestamp()-interval '12 days' WHERE po_number='SJ-DATE-PO';
INSERT INTO pg_temp.sj_date_state SELECT 'po-before',to_jsonb(p)-'updated_at' FROM public.purchase_orders p WHERE po_number='SJ-DATE-PO';
INSERT INTO pg_temp.sj_date_state SELECT 'sj-before',to_jsonb(s)-'sj_date_received' FROM public.surat_jalan s WHERE id=((SELECT v FROM pg_temp.sj_date_state WHERE k='receipt')->>'id')::uuid;
INSERT INTO pg_temp.sj_date_state SELECT 'lines-before',jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.sj_line_items l WHERE surat_jalan_id=((SELECT v FROM pg_temp.sj_date_state WHERE k='receipt')->>'id')::uuid;
CREATE FUNCTION pg_temp.sj_payload(value jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('sj_id',s.id,'expected_updated_at',p.updated_at,'sj_date_received',value)
 FROM public.surat_jalan s JOIN public.purchase_orders p ON p.id=s.purchase_order_id WHERE p.po_number='SJ-DATE-PO'
$$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; payload jsonb:=pg_temp.sj_payload('"2026-10-07"'); req uuid:=gen_random_uuid(); bad jsonb; BEGIN
 r:=public.pilot_order_transaction(req,'edit_sj_received_date',payload);
 PERFORM pg_temp.sj_assert(r->>'id'=payload->>'sj_id' AND r->>'po_id'=(SELECT v->>'id' FROM pg_temp.sj_date_state WHERE k='po-before'),'receipt identifies SJ and PO');
 PERFORM pg_temp.sj_assert(public.pilot_order_transaction(req,'edit_sj_received_date',payload)=r,'exact idempotent replay');
 PERFORM pg_temp.sj_assert(public.pilot_reconcile_request(req,false)=jsonb_build_object('state','committed','operation','edit_sj_received_date','result',r),'lost-response recovery');
 INSERT INTO pg_temp.sj_date_state VALUES('committed',jsonb_build_object('request',req,'payload',payload,'result',r));
 PERFORM pg_temp.sj_raises(format('SELECT public.pilot_order_transaction(%L,%L,%L)',req,'edit_sj_received_date',payload||'{"sj_date_received":null}'),'22023','request reuse mismatch');
 PERFORM pg_temp.sj_raises(format('SELECT public.pilot_order_transaction(%L,%L,%L)',gen_random_uuid(),'edit_sj_received_date',payload),'PT409','stale version');
 PERFORM pg_temp.sj_assert((SELECT to_jsonb(p)-'updated_at'=(SELECT v FROM pg_temp.sj_date_state WHERE k='po-before') FROM public.purchase_orders p WHERE po_number='SJ-DATE-PO'),'PO completion/status/quantities unchanged');
 PERFORM pg_temp.sj_assert((SELECT to_jsonb(s)-'sj_date_received'=(SELECT v FROM pg_temp.sj_date_state WHERE k='sj-before') FROM public.surat_jalan s WHERE id=(r->>'id')::uuid),'all other SJ fields unchanged');
 PERFORM pg_temp.sj_assert((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id)=(SELECT v FROM pg_temp.sj_date_state WHERE k='lines-before') FROM public.sj_line_items l WHERE surat_jalan_id=(r->>'id')::uuid),'SJ line identities and quantities unchanged');
 PERFORM pg_temp.sj_assert((SELECT count(*)=1 AND bool_and(changed_by=auth.uid() AND old_value='2026-10-02' AND new_value='2026-10-07') FROM public.po_audit_log WHERE purchase_order_id=(r->>'po_id')::uuid AND field_changed='sj_date_received'),'one explicit actor/old/new audit, replay writes none');
 FOREACH bad IN ARRAY ARRAY['true'::jsonb,'12'::jsonb,'{}'::jsonb,'[]'::jsonb,'""'::jsonb,'"infinity"'::jsonb,'"2026-2-01"'::jsonb,'"2026-02-30"'::jsonb,'"2025-02-29"'::jsonb,'"0000-01-01"'::jsonb,'"2026-10-07T00:00:00Z"'::jsonb] LOOP
  PERFORM pg_temp.sj_raises(format('SELECT public.pilot_order_transaction(%L,%L,%L)',gen_random_uuid(),'edit_sj_received_date',pg_temp.sj_payload(bad)),'22023','strict real calendar date');
 END LOOP;
 FOREACH bad IN ARRAY ARRAY[pg_temp.sj_payload('null')||'{"lines":[]}',pg_temp.sj_payload('null')||'{"sj_date_returned":null}',pg_temp.sj_payload('null')||'{"po_id":"00000000-0000-0000-0000-000000000001"}',pg_temp.sj_payload('null')-'sj_date_received'] LOOP
  PERFORM pg_temp.sj_raises(format('SELECT public.pilot_order_transaction(%L,%L,%L)',gen_random_uuid(),'edit_sj_received_date',bad),'22023','exact payload keys');
 END LOOP;
 PERFORM public.pilot_order_transaction(gen_random_uuid(),'edit_sj_received_date',pg_temp.sj_payload('"2024-02-29"'));
 PERFORM public.pilot_order_transaction(gen_random_uuid(),'edit_sj_received_date',pg_temp.sj_payload('null'));
 PERFORM pg_temp.sj_assert((SELECT sj_date_received IS NULL FROM public.surat_jalan WHERE id=(r->>'id')::uuid),'nullable date clearing');
 PERFORM pg_temp.sj_raises(format('SELECT public.pilot_order_transaction(%L,%L,%L)',gen_random_uuid(),'void_delivery',pg_temp.sj_payload('null')||'{"reason":"late"}'),'55000','full delivery correction stays seven days');
END $$;
RESET ROLE;
-- Boundary is deterministic; actual mutation checks wall clock after both locks.
SELECT pg_temp.sj_assert(private.demo_returned_date_open('2026-10-01T00:00:00Z','2026-10-15T00:00:00Z'),'inclusive fourteen-day boundary');
SELECT pg_temp.sj_assert(NOT private.demo_returned_date_open('2026-10-01T00:00:00Z','2026-10-15T00:00:00.000001Z'),'one microsecond late');
UPDATE public.purchase_orders SET completed_at=clock_timestamp()-interval '15 days' WHERE po_number='SJ-DATE-PO';
SET LOCAL ROLE authenticated;
SELECT pg_temp.sj_raises(format('SELECT public.pilot_order_transaction(%L,%L,%L)',gen_random_uuid(),'edit_sj_received_date',pg_temp.sj_payload('null')),'55000','expired window');
-- Committed recovery does not acquire a mutable deadline or repeat the write.
SELECT pg_temp.sj_assert(public.pilot_order_transaction((v->>'request')::uuid,'edit_sj_received_date',v->'payload')=v->'result','committed replay after window') FROM pg_temp.sj_date_state WHERE k='committed';
RESET ROLE;
UPDATE public.purchase_orders SET completed_at=NULL WHERE po_number='SJ-DATE-PO';
SET LOCAL ROLE authenticated;
SELECT pg_temp.sj_raises(format('SELECT public.pilot_order_transaction(%L,%L,%L)',gen_random_uuid(),'edit_sj_received_date',pg_temp.sj_payload('null')),'55000','missing completion timestamp');
RESET ROLE;
UPDATE public.purchase_orders SET completed_at='infinity'::timestamptz WHERE po_number='SJ-DATE-PO';
SET LOCAL ROLE authenticated;
SELECT pg_temp.sj_raises(format('SELECT public.pilot_order_transaction(%L,%L,%L)',gen_random_uuid(),'edit_sj_received_date',pg_temp.sj_payload('null')),'55000','nonfinite completion timestamp');
RESET ROLE;
UPDATE public.purchase_orders SET status='in_progress',completed_at=NULL WHERE po_number='SJ-DATE-PO';
SET LOCAL ROLE authenticated;
SELECT public.pilot_order_transaction(gen_random_uuid(),'edit_sj_received_date',pg_temp.sj_payload('"2026-10-08"'));
RESET ROLE;
UPDATE public.purchase_orders SET status='confirm' WHERE po_number='SJ-DATE-PO';
SET LOCAL ROLE authenticated;
SELECT public.pilot_order_transaction(gen_random_uuid(),'edit_sj_received_date',pg_temp.sj_payload('"2026-10-08"'));
RESET ROLE;
-- Same ordinary PO authority, including receipt replay after revocation.
DO $$ DECLARE n integer; payload jsonb:=pg_temp.sj_payload('null'); committed jsonb:=(SELECT v FROM pg_temp.sj_date_state WHERE k='committed'); BEGIN
 FOR n IN 3..7 LOOP
  PERFORM set_config('request.jwt.claim.sub',md5('sj-date-user-'||n)::uuid::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM pg_temp.sj_raises(format('SELECT public.pilot_order_transaction(%L,%L,%L)',gen_random_uuid(),'edit_sj_received_date',payload),'42501','non-PO or inactive role');
  EXECUTE 'RESET ROLE';
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub',md5('sj-date-user-2')::uuid::text,true);
 UPDATE public.users SET role='sales_head' WHERE id=md5('sj-date-user-1')::uuid;
 PERFORM set_config('request.jwt.claim.sub',md5('sj-date-user-1')::uuid::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.sj_raises(format('SELECT public.pilot_order_transaction(%L,%L,%L)',committed->>'request','edit_sj_received_date',committed->'payload'),'42501','revoked replay');
 PERFORM pg_temp.sj_raises(format('SELECT public.pilot_reconcile_request(%L,false)',committed->>'request'),'42501','revoked recovery');
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.sub',md5('sj-date-user-2')::uuid::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM public.pilot_order_transaction(gen_random_uuid(),'edit_sj_received_date',payload);
 EXECUTE 'RESET ROLE';
END $$;
-- A late receipt write failure must roll back the date, audit, parent version and request.
CREATE FUNCTION pg_temp.sj_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.operation='edit_sj_received_date' AND NEW.result IS NOT NULL THEN RAISE EXCEPTION 'Synthetic received receipt failure' USING ERRCODE='PST01'; END IF; RETURN NEW; END $$;
CREATE TRIGGER sj_test_receipt_failure BEFORE UPDATE ON private.pilot_order_requests FOR EACH ROW EXECUTE FUNCTION pg_temp.sj_fail_receipt();
INSERT INTO pg_temp.sj_date_state SELECT 'failure-before',jsonb_build_object(
 'po',(SELECT to_jsonb(p) FROM public.purchase_orders p WHERE po_number='SJ-DATE-PO'),
 'sj',(SELECT to_jsonb(s) FROM public.surat_jalan s WHERE sj_number='SJ-DATE-1'),
 'audit',(SELECT count(*) FROM public.po_audit_log),'requests',(SELECT count(*) FROM private.pilot_order_requests));
SET LOCAL ROLE authenticated;
SELECT pg_temp.sj_raises(format('SELECT public.pilot_order_transaction(%L,%L,%L)',gen_random_uuid(),'edit_sj_received_date',pg_temp.sj_payload('"2026-10-09"')),'PST01','late failure rolls back');
RESET ROLE;
SELECT pg_temp.sj_assert((SELECT v FROM pg_temp.sj_date_state WHERE k='failure-before')=jsonb_build_object(
 'po',(SELECT to_jsonb(p) FROM public.purchase_orders p WHERE po_number='SJ-DATE-PO'),
 'sj',(SELECT to_jsonb(s) FROM public.surat_jalan s WHERE sj_number='SJ-DATE-1'),
 'audit',(SELECT count(*) FROM public.po_audit_log),'requests',(SELECT count(*) FROM private.pilot_order_requests)),'atomic late rollback');
DROP TRIGGER sj_test_receipt_failure ON private.pilot_order_requests;
SET LOCAL ROLE authenticated;
DO $$ DECLARE req uuid:=gen_random_uuid(); BEGIN
 PERFORM pg_temp.sj_assert(public.pilot_reconcile_request(req,true)->>'state'='abandoned','unknown request abandoned');
 PERFORM pg_temp.sj_raises(format('SELECT public.pilot_order_transaction(%L,%L,%L)',req,'edit_sj_received_date',pg_temp.sj_payload('null')),'55000','abandoned request cannot execute');
END $$;
RESET ROLE;
UPDATE public.surat_jalan SET voided_at=clock_timestamp(),voided_by=md5('sj-date-user-2')::uuid,void_reason='Synthetic void' WHERE sj_number='SJ-DATE-1';
SET LOCAL ROLE authenticated;
SELECT pg_temp.sj_raises(format('SELECT public.pilot_order_transaction(%L,%L,%L)',gen_random_uuid(),'edit_sj_received_date',pg_temp.sj_payload('null')),'22023','voided SJ refused');
RESET ROLE;
UPDATE public.purchase_orders SET status='cancelled' WHERE po_number='SJ-DATE-PO';
SET LOCAL ROLE authenticated;
SELECT pg_temp.sj_raises(format('SELECT public.pilot_order_transaction(%L,%L,%L)',gen_random_uuid(),'edit_sj_received_date',pg_temp.sj_payload('null')),'55000','cancelled PO refused');
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
SELECT 'SJ_RECEIVED_DATE_DATABASE_PASSED';
