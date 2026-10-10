BEGIN;
DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true); END $$;
SELECT co_test.assert('co_admin'::public.user_role::text='co_admin','enum stage committed');

DO $co_freeform_sku_has_stable_customer_identity$
DECLARE a uuid; b uuid; catalog uuid; before_count bigint;
BEGIN
 PERFORM co_test.assert(private.co_normalize_sku_v1(' SKU-A ')=private.co_normalize_sku_v1('sku-a'),'normalized identity');
 a:=private.co_stock_key_v1(md5('co-customer-1')::uuid,' SKU-A ','Freeform A',NULL,NULL);
 b:=private.co_stock_key_v1(md5('co-customer-1')::uuid,'sku-a','Freeform A',NULL,a);
 PERFORM co_test.assert(a=b,'same customer and normalized SKU reuse stable key');
 PERFORM co_test.assert(a<>private.co_stock_key_v1(md5('co-customer-2')::uuid,'sku-a','Other customer A',NULL,NULL),'customer isolation');
 PERFORM co_test.assert((SELECT product_id IS NULL FROM private.co_stock_keys WHERE id=a),'freeform does not need catalog');
 SELECT count(*) INTO before_count FROM private.co_stock_keys;
 PERFORM co_test.raises(format('SELECT private.co_stock_key_v1(%L,%L,%L,%L,%L)',md5('co-customer-1')::uuid,'sku-a','Bad bind',md5('co-product-1')::uuid,a),'22023','existing freeform cannot rebind to catalog');
 PERFORM co_test.raises(format('SELECT private.co_stock_key_v1(%L,%L,%L,NULL,%L)',md5('co-customer-2')::uuid,'other','Wrong scope',a),'22023','explicit key customer mismatch');
 PERFORM co_test.assert((SELECT count(*)=before_count FROM private.co_stock_keys),'identity failures have no partial rows');
 PERFORM co_test.raises(format('SELECT private.co_stock_key_v1(%L,%L,%L,%L,NULL)',md5('co-customer-1')::uuid,'wrong-sku','Bad catalog',md5('co-product-1')::uuid),'22023','catalog SKU must match at capture');
 catalog:=private.co_stock_key_v1(md5('co-customer-1')::uuid,'CAT-A','Original catalog A',md5('co-product-1')::uuid,NULL);
 UPDATE public.products SET sku='RENAMED',name='Renamed catalog',unit_price=99 WHERE id=md5('co-product-1')::uuid;
 PERFORM co_test.assert(catalog=private.co_stock_key_v1(md5('co-customer-1')::uuid,'CAT-A','Original catalog A',md5('co-product-1')::uuid,catalog),'explicit reuse survives catalog rename');
 DELETE FROM public.products WHERE id=md5('co-product-1')::uuid;
 PERFORM co_test.assert((SELECT product_id=md5('co-product-1')::uuid AND product_name='Original catalog A' AND display_sku='CAT-A' FROM private.co_stock_keys WHERE id=catalog),'catalog deletion retains original identity');
 PERFORM co_test.raises(format('UPDATE private.co_stock_keys SET product_name=%L WHERE id=%L','Rewritten',a),'55000','stock identity immutable');
END $co_freeform_sku_has_stable_customer_identity$;

DO $co_command_identity_and_tombstone$
DECLARE request uuid:=md5('co-request-1')::uuid; payload jsonb; first_receipt jsonb; v bigint;
BEGIN
 payload:=jsonb_build_object('customer_id',md5('co-customer-1')::uuid,'note','one');
 first_receipt:=co_test.execute(request,payload);
 SELECT version INTO v FROM private.co_customer_state WHERE customer_id=md5('co-customer-1')::uuid;
 PERFORM co_test.assert(first_receipt=co_test.execute(request,payload),'identical retry returns exact receipt');
 PERFORM co_test.assert((SELECT version=v FROM private.co_customer_state WHERE customer_id=md5('co-customer-1')::uuid),'retry changes nothing');
 PERFORM co_test.raises(format('SELECT co_test.execute(%L,%L)',request,payload||'{"note":"two"}'::jsonb),'22023','same UUID changed payload');
 PERFORM co_test.raises(format('SELECT private.co_command_begin_v1(%L,%L,%L)',request,'cancel_co',payload),'22023','same UUID changed operation');
 PERFORM co_test.raises(format('INSERT INTO private.co_commands(actor_id,request_id,operation,status) VALUES(%L,%L,%L,%L)',md5('co-user-1')::uuid,md5('co-invalid-envelope')::uuid,'edit_co','pending'),'23514','pending envelope requires fingerprint');
 PERFORM co_test.raises(format('INSERT INTO private.co_commands(actor_id,request_id,operation,payload_fingerprint,status) VALUES(%L,%L,%L,%L,%L)',md5('co-user-1')::uuid,md5('co-invalid-envelope')::uuid,'edit_co',repeat('a',64),'committed'),'23514','committed envelope requires receipt');
 PERFORM co_test.raises(format('SELECT co_test.complete(%L,%L)',md5('co-invalid-receipt')::uuid,first_receipt||'{"version":1}'::jsonb),'22023','numeric receipt version refused');
 PERFORM co_test.raises(format('SELECT co_test.complete(%L,%L)',md5('co-invalid-receipt')::uuid,first_receipt||'{"version":"9223372036854775808"}'::jsonb),'22023','receipt bigint overflow refused');
 PERFORM co_test.raises(format('SELECT co_test.complete(%L,%L)',md5('co-invalid-receipt')::uuid,first_receipt||'{"payload":{"price":"20"}}'::jsonb),'22023','receipt cannot retain payload');
 PERFORM co_test.raises(format('SELECT co_test.complete(%L,%L)',md5('co-invalid-receipt')::uuid,first_receipt||'{"id":"not-a-uuid"}'::jsonb),'22023','receipt UUID validation');
 PERFORM co_test.assert(NOT EXISTS(SELECT 1 FROM private.co_commands WHERE request_id=md5('co-invalid-receipt')::uuid),'invalid completion has no partial envelope');
 PERFORM co_test.raises(format('SELECT private.co_command_begin_v1(%L,%L,%L); SET CONSTRAINTS ALL IMMEDIATE',md5('co-unfinished')::uuid,'edit_co','{}'),'55000','pending request cannot escape transaction without receipt');
 PERFORM co_test.assert(private.co_command_reconcile_v1(request,false)=jsonb_build_object('status','committed','operation','edit_co','receipt',first_receipt),'committed recovery');
 PERFORM co_test.assert(private.co_command_reconcile_v1(md5('co-never-seen')::uuid,false)='{"status":"unknown"}'::jsonb,'unknown is not terminal');
 PERFORM co_test.assert(private.co_command_reconcile_v1(md5('co-abandoned')::uuid,true)='{"status":"abandoned"}'::jsonb,'durable abandonment');
 PERFORM co_test.raises(format('SELECT co_test.execute(%L,%L)',md5('co-abandoned')::uuid,payload),'55000','abandoned request cannot execute');
 PERFORM co_test.assert(private.co_command_reconcile_v1(request,true)->>'status'='committed','abandon cannot overwrite committed receipt');
 PERFORM co_test.raises(format('DELETE FROM private.co_commands WHERE request_id=%L',request),'55000','terminal command retained');
 PERFORM co_test.raises(format('UPDATE private.co_commands SET receipt=%L WHERE request_id=%L','{}',request),'55000','terminal receipt immutable');
 PERFORM co_test.raises(format('SELECT private.co_lock_customer_v1(%L,1)',md5('co-customer-1')::uuid),'PT409','customer optimistic version');
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-2')::uuid::text,true);
 PERFORM co_test.assert(private.co_command_reconcile_v1(request,false)->>'status'='unknown','actor scoped recovery');
 PERFORM co_test.execute(request,payload);
 PERFORM co_test.assert((SELECT count(*)=2 FROM private.co_commands WHERE request_id=request),'same request UUID has distinct actor identities');
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-3')::uuid::text,true);
 PERFORM co_test.raises(format('SELECT co_test.execute(%L,%L)',md5('co-denied')::uuid,payload),'42501','PO admin denied CO envelope');
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-4')::uuid::text,true);
 PERFORM co_test.raises(format('SELECT private.co_command_reconcile_v1(%L,false)',request),'42501','inactive CO actor denied recovery');
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true);
END $co_command_identity_and_tombstone$;

DO $co_posted_evidence_and_credit_are_immutable$
DECLARE c uuid:=md5('co-customer-1')::uuid; actor uuid:=md5('co-user-1')::uuid; k uuid; credit jsonb;
 o uuid:=md5('co-order')::uuid; l uuid:=md5('co-line')::uuid; h uuid:=md5('co-sj')::uuid;
 r uuid:=md5('co-sj-rev')::uuid; dl uuid:=md5('co-sj-line')::uuid; batch uuid:=md5('co-batch')::uuid;
 rh uuid:=md5('co-report')::uuid; rr uuid:=md5('co-report-rev')::uuid; rl uuid:=md5('co-report-line')::uuid;
 g uuid:=md5('co-generation')::uuid; t text; n bigint;
BEGIN
 k:=private.co_stock_key_v1(c,'SKU-A','Freeform A',NULL,NULL);
 credit:=private.demo_capture_credit(c);
 INSERT INTO private.co_orders(id,customer_id,co_number,order_date,created_by,sales_person_id_at_creation,sales_assignment_source_id,sales_attributed_at,sales_attribution_state)
 VALUES(o,c,'CO-TEST-1','2026-09-01',actor,(credit->>'sales_person_id_at_creation')::uuid,(credit->>'sales_assignment_source_id')::uuid,(credit->>'sales_attributed_at')::timestamptz,credit->>'sales_attribution_state');
 INSERT INTO private.co_order_lines(id,co_id,customer_id,stock_key_id,ordered_quantity,unit_price) VALUES(l,o,c,k,10,12.50);
 UPDATE private.co_orders SET notes='Allowed plan change' WHERE id=o;
 UPDATE private.co_order_lines SET ordered_quantity=11 WHERE id=l;
 PERFORM co_test.assert((SELECT ordered_quantity=11 FROM private.co_order_lines WHERE id=l),'ordinary quantity edit permitted');
 PERFORM co_test.raises(format('UPDATE private.co_orders SET sales_person_id_at_creation=NULL WHERE id=%L',o),'55000','creation credit immutable');
 PERFORM co_test.raises(format('UPDATE private.co_orders SET customer_id=%L WHERE id=%L',md5('co-customer-2')::uuid,o),'55000','order customer immutable');
 PERFORM co_test.raises(format('UPDATE private.co_order_lines SET unit_price=13 WHERE id=%L',l),'55000','agreed price immutable');
 PERFORM co_test.raises(format('INSERT INTO private.co_order_lines(co_id,customer_id,stock_key_id,ordered_quantity,unit_price) VALUES(%L,%L,%L,1,0.001)',o,c,k),'23514','unit price is rejected instead of rounded');
 INSERT INTO private.co_delivery_heads(id,customer_id,co_id,created_by) VALUES(h,c,o,actor);
 INSERT INTO private.co_delivery_revisions(id,head_id,customer_id,co_id,revision_no,sj_number,sj_date,created_by) VALUES(r,h,c,o,1,'SJ-TEST-1','2026-09-02',actor);
 INSERT INTO private.co_delivery_revision_lines(id,revision_id,head_id,customer_id,co_id,co_line_id,stock_key_id,batch_id,quantity) VALUES(dl,r,h,c,o,l,k,batch,10);
 INSERT INTO private.co_stock_batches(id,customer_id,co_id,co_line_id,stock_key_id,delivery_head_id,original_delivery_line_id,original_delivery_created_order,unit_price,sales_person_id_at_creation,sales_assignment_source_id,sales_attributed_at,sales_attribution_state)
 SELECT batch,c,o,l,k,h,dl,original_creation_order,12.50,(credit->>'sales_person_id_at_creation')::uuid,(credit->>'sales_assignment_source_id')::uuid,(credit->>'sales_attributed_at')::timestamptz,credit->>'sales_attribution_state' FROM private.co_delivery_heads WHERE id=h;
 UPDATE private.co_delivery_heads SET current_revision_id=r WHERE id=h;
 INSERT INTO private.co_report_heads(id,customer_id,report_month,created_by) VALUES(rh,c,'2026-09-01',actor);
 INSERT INTO private.co_report_revisions(id,head_id,customer_id,revision_no,coverage_through_date,is_partial_month,created_by) VALUES(rr,rh,c,1,'2026-09-30',false,actor);
 INSERT INTO private.co_report_revision_lines(id,revision_id,head_id,customer_id,stock_key_id,sold_quantity) VALUES(rl,rr,rh,c,k,3);
 UPDATE private.co_report_heads SET current_revision_id=rr WHERE id=rh;
 INSERT INTO private.co_replay_generations(id,customer_id,version,algorithm_version,created_by) VALUES(g,c,1,'co-v1',actor);
 INSERT INTO private.co_stock_movements(generation_id,customer_id,batch_id,stock_key_id,kind,quantity_delta,effective_date,delivery_revision_line_id) VALUES(g,c,batch,k,'delivery',10,'2026-09-02',dl);
 INSERT INTO private.co_sale_allocations(generation_id,customer_id,report_revision_id,report_revision_line_id,batch_id,stock_key_id,quantity,unit_price,sales_person_id_at_creation,sales_assignment_source_id,sales_attributed_at,sales_attribution_state)
 VALUES(g,c,rr,rl,batch,k,3,12.50,(credit->>'sales_person_id_at_creation')::uuid,(credit->>'sales_assignment_source_id')::uuid,(credit->>'sales_attributed_at')::timestamptz,credit->>'sales_attribution_state');
 INSERT INTO private.co_audit_events(id,customer_id,actor_id,operation,reason,before_state,after_state,generation_id) VALUES(md5('co-audit')::uuid,c,actor,'post_sj','fixture','{}','{}',g);
 INSERT INTO private.co_return_heads(id,customer_id,created_by) VALUES(md5('co-return')::uuid,c,actor);
 INSERT INTO private.co_return_revisions(id,head_id,customer_id,revision_no,return_date,created_by) VALUES(md5('co-return-rev')::uuid,md5('co-return')::uuid,c,1,'2026-09-03',actor);
 INSERT INTO private.co_return_revision_lines(revision_id,head_id,customer_id,batch_id,stock_key_id,quantity) VALUES(md5('co-return-rev')::uuid,md5('co-return')::uuid,c,batch,k,1);
 UPDATE private.co_return_heads SET current_revision_id=md5('co-return-rev')::uuid WHERE id=md5('co-return')::uuid;
 FOR t IN SELECT unnest(ARRAY['co_delivery_revisions','co_delivery_revision_lines','co_stock_batches','co_return_revisions','co_return_revision_lines','co_report_revisions','co_report_revision_lines','co_replay_generations','co_stock_movements','co_sale_allocations','co_audit_events']) LOOP
  EXECUTE format('SELECT count(*) FROM private.%I',t) INTO n;
  PERFORM co_test.assert(n>0,t||' fixture rows exist');
  PERFORM co_test.raises(format('UPDATE private.%I SET id=id',t),'55000',t||' update immutable');
  PERFORM co_test.raises(format('DELETE FROM private.%I',t),'55000',t||' delete immutable');
 END LOOP;
 PERFORM co_test.raises(format('INSERT INTO private.co_report_revision_lines(revision_id,head_id,customer_id,stock_key_id,sold_quantity) VALUES(%L,%L,%L,%L,0)',rr,rh,c,k),'55000','posted revision cannot gain lines');
 PERFORM co_test.raises(format('UPDATE private.co_report_heads SET current_revision_id=NULL WHERE id=%L',rh),'55000','posted head cannot be unsealed');
 PERFORM co_test.raises(format('INSERT INTO private.co_stock_batches SELECT (jsonb_populate_record(NULL::private.co_stock_batches,(SELECT to_jsonb(b)||jsonb_build_object(''id'',%L::uuid,''unit_price'',13) FROM private.co_stock_batches b WHERE id=%L))).*',md5('co-bad-batch')::uuid,batch),'23514','batch price must match source line');
 PERFORM co_test.raises(format('INSERT INTO private.co_sale_allocations(generation_id,customer_id,report_revision_id,report_revision_line_id,batch_id,stock_key_id,quantity,unit_price,sales_person_id_at_creation,sales_assignment_source_id,sales_attributed_at,sales_attribution_state) SELECT generation_id,customer_id,report_revision_id,report_revision_line_id,batch_id,stock_key_id,quantity,13,sales_person_id_at_creation,sales_assignment_source_id,sales_attributed_at,sales_attribution_state FROM private.co_sale_allocations WHERE generation_id=%L',g),'23514','allocation price must match source batch');
 UPDATE private.co_customer_state SET effective_generation_id=g WHERE customer_id=c;
 PERFORM co_test.raises(format('INSERT INTO private.co_stock_movements(generation_id,customer_id,batch_id,stock_key_id,kind,quantity_delta,effective_date,delivery_revision_line_id) VALUES(%L,%L,%L,%L,%L,1,%L,%L)',g,c,batch,k,'delivery','2026-09-02',dl),'55000','effective generation cannot gain movements');
 PERFORM co_test.raises(format('INSERT INTO private.co_sale_allocations(generation_id,customer_id,report_revision_id,report_revision_line_id,batch_id,stock_key_id,quantity,unit_price,sales_person_id_at_creation,sales_assignment_source_id,sales_attributed_at,sales_attribution_state) SELECT generation_id,customer_id,report_revision_id,report_revision_line_id,batch_id,stock_key_id,quantity,unit_price,sales_person_id_at_creation,sales_assignment_source_id,sales_attributed_at,sales_attribution_state FROM private.co_sale_allocations WHERE generation_id=%L',g),'55000','effective generation cannot gain allocations');
 PERFORM co_test.raises(format('UPDATE private.co_customer_state SET effective_generation_id=NULL WHERE customer_id=%L',c),'55000','effective generation cannot be unsealed');
 PERFORM co_test.raises(format('DELETE FROM private.co_order_lines WHERE id=%L',l),'23503','posted source line retained');
 INSERT INTO private.co_order_lines(id,co_id,customer_id,stock_key_id,ordered_quantity,unit_price) VALUES(md5('co-never-posted')::uuid,o,c,k,1,0);
 DELETE FROM private.co_order_lines WHERE id=md5('co-never-posted')::uuid;
 PERFORM co_test.assert(NOT EXISTS(SELECT 1 FROM private.co_order_lines WHERE id=md5('co-never-posted')::uuid),'never-posted line can be removed by an audited operation');
 PERFORM co_test.assert((SELECT amount=37.50 FROM private.co_sale_allocations WHERE generation_id=g),'exact extended amount');
 PERFORM co_test.raises(format('UPDATE private.co_report_heads SET current_revision_id=%L WHERE id=%L',r,rh),'23503','head cannot point to another kind of revision');
 INSERT INTO private.co_report_heads(id,customer_id,report_month,created_by) VALUES(md5('co-report-other')::uuid,c,'2026-08-01',actor);
 PERFORM co_test.raises(format('UPDATE private.co_report_heads SET current_revision_id=%L WHERE id=%L',rr,md5('co-report-other')::uuid),'23503','revision must belong to exact head');
 PERFORM co_test.raises(format('INSERT INTO private.co_report_heads(customer_id,report_month,created_by) VALUES(%L,%L,%L)',c,'2026-09-02',actor),'23514','report month begins on first');
 PERFORM co_test.raises(format('INSERT INTO private.co_report_heads(customer_id,report_month,created_by) VALUES(%L,%L,%L)',c,'2026-09-01',actor),'23505','one customer month');
 INSERT INTO private.co_drafts(id,customer_id,kind,report_month,created_by) VALUES(md5('co-draft')::uuid,c,'report','2026-10-01',actor);
 INSERT INTO private.co_report_draft_lines(draft_id,customer_id,stock_key_id) VALUES(md5('co-draft')::uuid,c,k);
 PERFORM co_test.assert((SELECT sold_quantity IS NULL FROM private.co_report_draft_lines WHERE draft_id=md5('co-draft')::uuid),'blank sold distinct from zero');
 UPDATE private.co_report_draft_lines SET sold_quantity=0 WHERE draft_id=md5('co-draft')::uuid;
 PERFORM co_test.assert((SELECT sold_quantity=0 FROM private.co_report_draft_lines WHERE draft_id=md5('co-draft')::uuid),'explicit zero retained');
END $co_posted_evidence_and_credit_are_immutable$;

DO $co_private_access$
DECLARE t record; fn record;
BEGIN
 FOR t IN SELECT c.oid,c.relname,c.relrowsecurity,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='private' AND c.relname LIKE 'co\_%' ESCAPE '\' AND c.relkind IN('r','S') LOOP
  IF t.relkind='r' THEN
   PERFORM co_test.assert(t.relrowsecurity,t.relname||' RLS');
   PERFORM co_test.assert(NOT has_table_privilege('anon',t.oid,'SELECT,INSERT,UPDATE,DELETE') AND NOT has_table_privilege('authenticated',t.oid,'SELECT,INSERT,UPDATE,DELETE'),t.relname||' private ACL');
  ELSE
   PERFORM co_test.assert(NOT has_sequence_privilege('anon',t.oid,'USAGE,SELECT,UPDATE') AND NOT has_sequence_privilege('authenticated',t.oid,'USAGE,SELECT,UPDATE'),t.relname||' private sequence ACL');
  END IF;
 END LOOP;
 FOR fn IN SELECT p.oid,p.proname,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname LIKE 'co\_%' ESCAPE '\' LOOP
  PERFORM co_test.assert(fn.proconfig=ARRAY['search_path=""'],fn.proname||' empty path');
  PERFORM co_test.assert(NOT has_function_privilege('anon',fn.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',fn.oid,'EXECUTE'),fn.proname||' private helper');
 END LOOP;
END $co_private_access$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
SELECT 'CO_FOUNDATION_AND_COMMANDS_PASSED';
