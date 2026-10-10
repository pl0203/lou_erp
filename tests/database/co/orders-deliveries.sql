BEGIN;
DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true); END $$;
-- Missing operations are the first expected RED, before any test setup can call them.
SELECT co_test.assert(to_regprocedure('public.pilot_co_transaction_v1(uuid,text,jsonb)') IS NOT NULL,'CO transaction entrypoint exists');

INSERT INTO auth.users(id) VALUES(md5('co-alice')::uuid),(md5('co-bob')::uuid);
INSERT INTO public.users(id,full_name,email,role) VALUES
 (md5('co-alice')::uuid,'Alice','co-alice@example.invalid','sales_person'),
 (md5('co-bob')::uuid,'Bob','co-bob@example.invalid','sales_person');
UPDATE public.customer_manager_assignments SET manager_id=md5('co-alice')::uuid,assigned_by=md5('co-user-1')::uuid WHERE customer_id=md5('co-customer-1')::uuid;
INSERT INTO public.promotions(id,product_id,start_date,end_date,created_by,remaining_quantity)
VALUES(md5('co-promo')::uuid,md5('co-product-1')::uuid,'2020-01-01','2099-12-31',md5('co-user-1')::uuid,50);

CREATE TEMP TABLE co_protected_before AS
SELECT 'public.'||tablename AS name, NULL::text AS fingerprint FROM pg_tables WHERE schemaname='public' AND tablename IN
 ('purchase_orders','po_line_items','po_audit_log','surat_jalan','sj_line_items','girard_orders','girard_order_items','promotions')
UNION ALL SELECT 'private.'||tablename,NULL FROM pg_tables WHERE schemaname='private' AND tablename IN
 ('pilot_promo_slices','pilot_promo_movements','pilot_promotion_requests','pilot_store_credit_corrections_v1','pilot_store_owner_audit_v1');
DO $$ DECLARE t record; digest text; BEGIN
 FOR t IN SELECT name FROM co_protected_before LOOP
 EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(x)::text,''|'' ORDER BY to_jsonb(x)::text),'''')) FROM %s x',t.name) INTO digest;
 UPDATE co_protected_before SET fingerprint=digest WHERE name=t.name;
 END LOOP;
END $$;

CREATE FUNCTION co_test.order_payload(c uuid, ref text, qty integer DEFAULT 10, price text DEFAULT '10.00') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('customer_id',c,'expected_customer_version',coalesce((SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'1'),
 'co_number',ref,'order_date','2026-09-01','lines',jsonb_build_array(jsonb_build_object('id',md5(ref||'-line')::uuid,'sku',ref||'-sku','product_name',ref,'ordered_quantity',qty,'unit_price',price)));
$$;
CREATE FUNCTION co_test.draft_payload(o uuid, qty integer, day date DEFAULT '2026-09-02') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('co_id',o,'expected_co_version',x.version::text,'expected_customer_version',c.version::text,
 'sj_number','SJ-'||x.co_number,'sj_date',day,'lines',jsonb_build_array(jsonb_build_object('co_line_id',(SELECT id FROM private.co_order_lines WHERE co_id=o ORDER BY id LIMIT 1),'quantity',qty)))
 FROM private.co_orders x JOIN private.co_customer_state c ON c.customer_id=x.customer_id WHERE x.id=o;
$$;
CREATE FUNCTION co_test.post_payload(d uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('draft_id',d,'expected_draft_version',x.version::text,'expected_co_version',o.version::text,'expected_customer_version',c.version::text)
 FROM private.co_drafts x JOIN private.co_orders o ON o.id=x.co_id JOIN private.co_customer_state c ON c.customer_id=x.customer_id WHERE x.id=d;
$$;

DO $co_create_snapshots_owner_before_first_delivery$
DECLARE c uuid:=md5('co-customer-1')::uuid; p jsonb; r jsonb; draft jsonb; posted jsonb; o uuid; g uuid;
BEGIN
 p:=co_test.order_payload(c,'CO-ALICE');
 r:=public.pilot_co_transaction_v1(md5('create-alice')::uuid,'create_co',p); o:=(r->>'id')::uuid;
 PERFORM co_test.assert(r=jsonb_build_object('id',o,'operation','create_co','version','1','customer_id',c,'customer_version','2'),'create exact five-field string receipt');
 PERFORM co_test.assert((SELECT customer_id=c FROM private.co_orders WHERE id=o),'receipt targets newly created CO');
 PERFORM co_test.assert(public.pilot_co_transaction_v1(md5('create-alice')::uuid,'create_co',p)=r,'create retry is exact');
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',md5('create-alice')::uuid,'create_co',p||'{"notes":"changed"}'),'22023','changed retry rejected');
 UPDATE public.customer_manager_assignments SET manager_id=md5('co-bob')::uuid WHERE customer_id=c;
 draft:=public.pilot_co_transaction_v1(md5('draft-alice')::uuid,'save_sj_draft',co_test.draft_payload(o,10));
 PERFORM co_test.assert(draft=jsonb_build_object('id',draft->>'id','operation','save_sj_draft','version','1','customer_id',c,'customer_version','3'),'draft exact five-field string receipt');
 PERFORM co_test.assert((SELECT co_id=o AND version=1 FROM private.co_drafts WHERE id=(draft->>'id')::uuid),'draft receipt targets stored draft');
 p:=co_test.post_payload((draft->>'id')::uuid);
 posted:=public.pilot_co_transaction_v1(md5('post-alice')::uuid,'post_sj',p);
 PERFORM co_test.assert(posted=jsonb_build_object('id',posted->>'id','operation','post_sj','version','1','customer_id',c,'customer_version','4'),'post exact five-field string receipt');
 PERFORM co_test.assert((SELECT co_id=o AND current_revision_id IS NOT NULL FROM private.co_delivery_heads WHERE id=(posted->>'id')::uuid),'post receipt targets published delivery head');
 PERFORM co_test.assert(public.pilot_co_transaction_v1(md5('post-alice')::uuid,'post_sj',p)=posted,'post retry has no duplicate effect');
 PERFORM co_test.assert((SELECT count(*)=1 FROM private.co_delivery_heads WHERE co_id=o),'one stable delivery head');
 PERFORM co_test.assert((SELECT sales_person_id_at_creation=md5('co-alice')::uuid FROM private.co_orders WHERE id=o),'creation owner remains Alice');
 PERFORM co_test.assert((SELECT sales_person_id_at_creation=md5('co-alice')::uuid AND unit_price=10 FROM private.co_stock_batches WHERE co_id=o),'batch carries Alice and agreed price');
 SELECT effective_generation_id INTO g FROM private.co_customer_state WHERE customer_id=c;
 PERFORM co_test.assert((SELECT sum(quantity_delta)::text='10' FROM private.co_stock_movements WHERE generation_id=g),'co_delivery_has_stock_but_zero_revenue: stock 10');
 PERFORM co_test.assert((SELECT coalesce(sum(amount),0)::text='0' FROM private.co_sale_allocations WHERE generation_id=g),'co_delivery_has_stock_but_zero_revenue: revenue 0');
 PERFORM co_test.assert((SELECT status='active' AND version=2 FROM private.co_orders WHERE id=o),'co_delivery_progress_does_not_close');
 PERFORM co_test.assert(private.co_delivery_progress_v1(o)='{"delivery_progress":"complete","ordered_quantity":"10","delivered_quantity":"10","resolved_undelivered_quantity":"0","pending_quantity":"0"}'::jsonb,'delivery completion is independent of active status');
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'post_sj',co_test.post_payload((draft->>'id')::uuid)),'55000','consumed draft cannot post under new request');
 PERFORM co_test.assert(public.pilot_reconcile_co_v1(md5('post-alice')::uuid,false)=jsonb_build_object('status','committed','operation','post_sj','receipt',posted),'public recovery receipt');
END $co_create_snapshots_owner_before_first_delivery$;

DO $co_unassigned_draft_and_future_posting$
DECLARE c uuid:=md5('co-customer-2')::uuid; r jsonb; d jsonb; p jsonb; o uuid; before_n bigint;
BEGIN
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'create_co',co_test.order_payload(c,'CO-UNASSIGNED')); o:=(r->>'id')::uuid;
 INSERT INTO public.customer_manager_assignments(customer_id,manager_id,assigned_by) VALUES(c,md5('co-bob')::uuid,md5('co-user-1')::uuid);
 SELECT count(*) INTO before_n FROM private.co_stock_movements;
 d:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',co_test.draft_payload(o,10,(clock_timestamp() AT TIME ZONE 'UTC')::date+1));
 PERFORM co_test.assert((SELECT count(*)=before_n FROM private.co_stock_movements),'draft has zero effects');
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'post_sj',co_test.post_payload((d->>'id')::uuid)),'22023','co_sj_draft_future_date_never_posts');
 p:=co_test.draft_payload(o,10)||jsonb_build_object('draft_id',d->>'id','expected_draft_version',d->>'version');
 d:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',p);
 PERFORM co_test.assert(d->>'version'='2','draft saves advance draft version');
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'post_sj',co_test.post_payload((d->>'id')::uuid));
 PERFORM co_test.assert((SELECT sales_attribution_state='unassigned' AND sales_person_id_at_creation IS NULL FROM private.co_stock_batches WHERE co_id=o),'later ownership never backfills Unassigned');
END $co_unassigned_draft_and_future_posting$;

DO $co_delivery_rejects_cross_order_batch_and_overdelivery$
DECLARE c uuid:=md5('co-customer-1')::uuid; a uuid; b uuid; d jsonb; p jsonb; n bigint;
BEGIN
 a:=(public.pilot_co_transaction_v1(gen_random_uuid(),'create_co',co_test.order_payload(c,'CO-LIMIT'))->>'id')::uuid;
 b:=(public.pilot_co_transaction_v1(gen_random_uuid(),'create_co',co_test.order_payload(c,'CO-FOREIGN'))->>'id')::uuid;
 p:=co_test.draft_payload(a,11);
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'save_sj_draft',p),'23514','ordered 10 cannot draft delivered 11');
 p:=co_test.draft_payload(a,1)||jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('co_line_id',md5('CO-FOREIGN-line')::uuid,'quantity',1)));
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'save_sj_draft',p),'22023','foreign CO line rejected');
 p:=co_test.draft_payload(a,1)||jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('co_line_id',md5('CO-LIMIT-line')::uuid,'quantity',1,'batch_id',(SELECT id FROM private.co_stock_batches LIMIT 1))));
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'save_sj_draft',p),'22023','client foreign batch rejected');
 d:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',co_test.draft_payload(a,6));
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'post_sj',co_test.post_payload((d->>'id')::uuid));
 PERFORM co_test.assert(private.co_delivery_progress_v1(a)->>'delivery_progress'='partial','partial delivery progress');
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'save_sj_draft',co_test.draft_payload(a,5)),'23514','cumulative overdelivery rejected');
 d:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',co_test.draft_payload(a,4)||'{"sj_number":"SJ-LIMIT-2"}');
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'post_sj',co_test.post_payload((d->>'id')::uuid));
 PERFORM co_test.assert((SELECT sum(m.quantity_delta)=10 FROM private.co_stock_movements m JOIN private.co_customer_state s ON s.effective_generation_id=m.generation_id JOIN private.co_stock_batches b ON b.id=m.batch_id WHERE b.co_id=a),'second generation preserves first source stock');
 PERFORM co_test.assert((SELECT count(*)=2 FROM private.co_stock_batches WHERE co_id=a),'separate stable original batches');
END $co_delivery_rejects_cross_order_batch_and_overdelivery$;

DO $co_edit_preserves_identity_and_audits_removal$
DECLARE c uuid:=md5('co-customer-2')::uuid; o uuid; l uuid:=md5('CO-EDIT-line')::uuid; extra uuid:=md5('co-edit-extra')::uuid; r jsonb; d jsonb; p jsonb; old_line jsonb;
BEGIN
 p:=co_test.order_payload(c,'CO-EDIT');
 p:=jsonb_set(p,'{lines}',(p->'lines')||jsonb_build_array(jsonb_build_object('id',extra,'sku','EXTRA','product_name','Extra','ordered_quantity',3,'unit_price','0.00')));
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'create_co',p); o:=(r->>'id')::uuid;
 SELECT to_jsonb(x) INTO old_line FROM private.co_order_lines x WHERE id=extra;
 d:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',co_test.draft_payload(o,1));
 p:=jsonb_build_object('co_id',o,'expected_co_version','1','expected_customer_version',d->>'customer_version','notes','edited','lines',jsonb_build_array(jsonb_build_object('id',l,'ordered_quantity',12)));
 r:=public.pilot_co_transaction_v1(md5('edit-remove')::uuid,'edit_co',p);
 PERFORM co_test.assert(r->>'version'='2','edit advances CO version');
 PERFORM co_test.assert(NOT EXISTS(SELECT 1 FROM private.co_order_lines WHERE id=extra),'unreferenced line removed');
 PERFORM co_test.assert((SELECT before_state->'lines' @> jsonb_build_array(old_line) FROM private.co_audit_events WHERE request_id=md5('edit-remove')::uuid),'removed full before-image is immutable audit');
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'post_sj',co_test.post_payload((d->>'id')::uuid)),'PT409','edit invalidates bound draft even with refreshed caller versions');
 p:=jsonb_set(p,'{expected_co_version}','"2"'); p:=jsonb_set(p,'{expected_customer_version}',r->'customer_version');
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'edit_co',jsonb_set(p,'{lines,0,unit_price}','"99.00"')),'22023','ordinary edit cannot reprice');
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'edit_co',p||jsonb_build_object('customer_id',md5('co-customer-1')::uuid)),'22023','ordinary edit cannot move customer');
 d:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',co_test.draft_payload(o,2));
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'post_sj',co_test.post_payload((d->>'id')::uuid));
 p:=jsonb_build_object('co_id',o,'expected_co_version','3','expected_customer_version',r->>'customer_version','lines',jsonb_build_array(jsonb_build_object('id',md5('co-replacement')::uuid,'sku','REPLACEMENT','product_name','Replacement','ordered_quantity',1,'unit_price','0')));
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'edit_co',p),'23514','posted identity cannot be removed');
 p:=jsonb_set(p,'{lines}',jsonb_build_array(jsonb_build_object('id',l,'ordered_quantity',1)));
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'edit_co',p),'23514','ordered quantity cannot undercut delivery');
END $co_edit_preserves_identity_and_audits_removal$;

DO $co_cancellation_versions_authority_and_validation$
DECLARE c uuid:=md5('co-customer-2')::uuid; o uuid; p jsonb; r jsonb; bad jsonb; field text; actor text;
BEGIN
 p:=co_test.order_payload(c,'CO-CANCEL'); r:=public.pilot_co_transaction_v1(gen_random_uuid(),'create_co',p); o:=(r->>'id')::uuid;
 p:=jsonb_build_object('co_id',o,'expected_co_version','1','expected_customer_version',r->>'customer_version','reason','Customer cancelled before dispatch');
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'cancel_co',p||'{"reason":" "}'),'22023','cancel reason required');
 r:=public.pilot_co_transaction_v1(md5('cancel-once')::uuid,'cancel_co',p);
 PERFORM co_test.assert((SELECT status='cancelled' AND version=2 FROM private.co_orders WHERE id=o),'cancel retains order history');
 PERFORM co_test.assert((SELECT reason='Customer cancelled before dispatch' FROM private.co_audit_events WHERE request_id=md5('cancel-once')::uuid),'cancel reason audited');
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'save_sj_draft',co_test.draft_payload(o,1)),'55000','cancelled order rejects new delivery');
 FOREACH actor IN ARRAY ARRAY['co-user-3','co-user-4'] LOOP
 PERFORM set_config('request.jwt.claim.sub',md5(actor)::uuid::text,true);
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',md5('cancel-once')::uuid,'cancel_co',p),'42501','role and active gate checked on retry');
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true);
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-2')::uuid::text,true);
 UPDATE public.users SET is_active=false WHERE id=md5('co-user-1')::uuid;
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true);
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',md5('cancel-once')::uuid,'cancel_co',p),'42501','same original actor inactive retry denied');
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-2')::uuid::text,true);
 UPDATE public.users SET is_active=true WHERE id=md5('co-user-1')::uuid;
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true);
 p:=co_test.order_payload(c,'CO-INVALID');
 FOREACH field IN ARRAY ARRAY['sales_person_id_at_creation','sales_assignment_source_id','sales_attributed_at','sales_attribution_state','status','promotion_id'] LOOP
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'create_co',p||jsonb_build_object(field,'invented')),'22023','client credit/status/promotion field rejected');
 END LOOP;
 FOR bad IN SELECT value FROM jsonb_array_elements('[null,0,-1,1.5,2147483648,"1"]') LOOP
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'create_co',jsonb_set(p,'{lines,0,ordered_quantity}',bad)),'22023','entered quantity bounds/type');
 END LOOP;
 FOR bad IN SELECT value FROM jsonb_array_elements('[null,10,"-1","1.001","1000000000000.00","NaN"]') LOOP
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'create_co',jsonb_set(p,'{lines,0,unit_price}',bad)),'22023','money remains bounded decimal text');
 END LOOP;
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'create_co',p||'{"expected_customer_version":"1"}'),'PT409','stale customer version');
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'create_co',p||'{"order_date":"not-a-date"}'),'22023','invalid dates have stable input error');
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'create_co',co_test.order_payload(c,'CO-CANCEL')),'22023','duplicate CO number is sanitized input conflict');
 PERFORM co_test.assert(NOT EXISTS(SELECT 1 FROM private.co_commands WHERE status='pending'),'failed commands leave no pending rows');
END $co_cancellation_versions_authority_and_validation$;


DO $co_stale_drafts_and_posted_cancellation$
DECLARE c uuid:=md5('co-customer-1')::uuid; o uuid; d jsonb; p jsonb; r jsonb; original jsonb; request uuid:=md5('co-save-exact-retry')::uuid;
BEGIN
 o:=(public.pilot_co_transaction_v1(gen_random_uuid(),'create_co',co_test.order_payload(c,'CO-STALE'))->>'id')::uuid;
 p:=co_test.draft_payload(o,2); d:=public.pilot_co_transaction_v1(request,'save_sj_draft',p);
 PERFORM co_test.assert(public.pilot_co_transaction_v1(request,'save_sj_draft',p)=d,'same draft request does not advance versions');
 original:=co_test.post_payload((d->>'id')::uuid);
 p:=co_test.draft_payload(o,2)||jsonb_build_object('draft_id',d->>'id','expected_draft_version','1');
 d:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',p);
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'post_sj',original),'PT409','stale customer binding fails');
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'post_sj',co_test.post_payload((d->>'id')::uuid)||'{"expected_draft_version":"1"}'),'PT409','stale draft version fails');
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'post_sj',co_test.post_payload((d->>'id')::uuid)||'{"expected_co_version":"2"}'),'PT409','stale CO version fails');
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'post_sj',co_test.post_payload((d->>'id')::uuid));
 p:=jsonb_build_object('co_id',o,'expected_co_version','2','expected_customer_version',r->>'customer_version','reason','Cannot cancel posted history');
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'cancel_co',p),'23514','posted order cannot be cancelled');
 p:=co_test.draft_payload(o,1); d:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',p);
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'post_sj',co_test.post_payload((d->>'id')::uuid)),'22023','duplicate SJ reference blocked');
 PERFORM co_test.assert(public.pilot_reconcile_co_v1(md5('co-public-abandon')::uuid,true)='{"status":"abandoned"}'::jsonb,'public abandonment');
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',md5('co-public-abandon')::uuid,'save_sj_draft',p),'55000','public abandoned command cannot execute');
END $co_stale_drafts_and_posted_cancellation$;

DO $co_posting_after_settlement_requires_complete_planner$
DECLARE c uuid; o uuid; d jsonb; h uuid; rev uuid; report_line uuid; g uuid; old_g uuid; v bigint; batch private.co_stock_batches%ROWTYPE; before_count bigint; i integer;
BEGIN
 FOR i IN 1..2 LOOP
  c:=md5('co-customer-'||i)::uuid;
  o:=(public.pilot_co_transaction_v1(gen_random_uuid(),'create_co',co_test.order_payload(c,'CO-AFTER-HISTORY-'||i))->>'id')::uuid;
  d:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',co_test.draft_payload(o,1));
  SELECT * INTO batch FROM private.co_stock_batches WHERE customer_id=c ORDER BY id LIMIT 1;
  IF i=1 THEN
   -- A synthetic settled generation proves that a later delivery cannot resurrect sold stock.
   INSERT INTO private.co_report_heads(customer_id,report_month,created_by) VALUES(c,'2026-09-01',auth.uid()) RETURNING id INTO h;
   INSERT INTO private.co_report_revisions(head_id,customer_id,revision_no,coverage_through_date,is_partial_month,created_by) VALUES(h,c,1,'2026-09-30',false,auth.uid()) RETURNING id INTO rev;
   INSERT INTO private.co_report_revision_lines(revision_id,head_id,customer_id,stock_key_id,sold_quantity) VALUES(rev,h,c,batch.stock_key_id,1) RETURNING id INTO report_line;
   UPDATE private.co_report_heads SET current_revision_id=rev WHERE id=h;
   SELECT version,effective_generation_id INTO v,old_g FROM private.co_customer_state WHERE customer_id=c;
   INSERT INTO private.co_replay_generations(customer_id,version,algorithm_version,created_by) VALUES(c,v,'synthetic-settlement-fixture',auth.uid()) RETURNING id INTO g;
   INSERT INTO private.co_stock_movements(generation_id,customer_id,batch_id,stock_key_id,kind,quantity_delta,effective_date,delivery_revision_line_id)
   SELECT g,c,m.batch_id,m.stock_key_id,m.kind,m.quantity_delta,m.effective_date,m.delivery_revision_line_id FROM private.co_stock_movements m WHERE m.generation_id=old_g;
   INSERT INTO private.co_stock_movements(generation_id,customer_id,batch_id,stock_key_id,kind,quantity_delta,effective_date,report_revision_line_id)
   VALUES(g,c,batch.id,batch.stock_key_id,'sold',-1,'2026-09-30',report_line);
   INSERT INTO private.co_sale_allocations(generation_id,customer_id,report_revision_id,report_revision_line_id,batch_id,stock_key_id,quantity,unit_price,sales_person_id_at_creation,sales_assignment_source_id,sales_attributed_at,sales_attribution_state)
   VALUES(g,c,rev,report_line,batch.id,batch.stock_key_id,1,batch.unit_price,batch.sales_person_id_at_creation,batch.sales_assignment_source_id,batch.sales_attributed_at,batch.sales_attribution_state);
   UPDATE private.co_customer_state SET effective_generation_id=g WHERE customer_id=c;
  ELSE
   INSERT INTO private.co_return_heads(customer_id,created_by) VALUES(c,auth.uid()) RETURNING id INTO h;
   INSERT INTO private.co_return_revisions(head_id,customer_id,revision_no,return_date,created_by) VALUES(h,c,1,'2026-09-03',auth.uid()) RETURNING id INTO rev;
   INSERT INTO private.co_return_revision_lines(revision_id,head_id,customer_id,batch_id,stock_key_id,quantity) VALUES(rev,h,c,batch.id,batch.stock_key_id,1);
   UPDATE private.co_return_heads SET current_revision_id=rev WHERE id=h;
  END IF;
  SELECT effective_generation_id INTO old_g FROM private.co_customer_state WHERE customer_id=c;
  SELECT count(*) INTO before_count FROM private.co_delivery_heads;
  PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'post_sj',co_test.post_payload((d->>'id')::uuid)),'23514','history requires complete replay seam');
  PERFORM co_test.assert((SELECT count(*)=before_count FROM private.co_delivery_heads),'blocked delivery rolls back source head too');
  PERFORM co_test.assert((SELECT effective_generation_id=old_g FROM private.co_customer_state WHERE customer_id=c),'blocked delivery retains effective settlement');
  PERFORM co_test.assert((SELECT NOT payload?'posted_delivery_head_id' FROM private.co_drafts WHERE id=(d->>'id')::uuid),'blocked post does not consume draft');
 END LOOP;
END $co_posting_after_settlement_requires_complete_planner$;

DO $co_public_rpc_access$
DECLARE p jsonb; r jsonb; fn record;
BEGIN
 FOR fn IN SELECT p.oid,p.proname,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname LIKE 'co\_%' ESCAPE '\' LOOP
  PERFORM co_test.assert(fn.proconfig=ARRAY['search_path=""'] AND NOT has_function_privilege('authenticated',fn.oid,'EXECUTE') AND NOT has_function_privilege('anon',fn.oid,'EXECUTE'),'private helper access and search path');
 END LOOP;
 PERFORM co_test.assert(NOT has_function_privilege('anon','public.pilot_co_transaction_v1(uuid,text,jsonb)','EXECUTE'),'anonymous transaction denied');
 PERFORM co_test.assert(NOT has_function_privilege('anon','public.pilot_reconcile_co_v1(uuid,boolean)','EXECUTE'),'anonymous recovery denied');
 p:=co_test.order_payload(md5('co-customer-1')::uuid,'CO-AUTHENTICATED');
 SET LOCAL ROLE authenticated;
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'create_co',p);
 RESET ROLE;
 PERFORM co_test.assert(r->>'operation'='create_co','authenticated caller invokes checked definer with no direct private grants');
 PERFORM set_config('request.jwt.claim.sub',md5('co-alice')::uuid::text,true);
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'create_co',p),'42501','Sales actor cannot write raw CO');
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-2')::uuid::text,true);
 p:=co_test.order_payload(md5('co-customer-1')::uuid,'CO-EXECUTIVE');
 PERFORM co_test.assert(public.pilot_co_transaction_v1(gen_random_uuid(),'create_co',p)->>'operation'='create_co','executive CO authority');
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true);
END $co_public_rpc_access$;

DO $co_creation_never_consumes_promo_stock$
DECLARE t record; digest text;
BEGIN
 FOR t IN SELECT * FROM co_protected_before LOOP
 EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(x)::text,''|'' ORDER BY to_jsonb(x)::text),'''')) FROM %s x',t.name) INTO digest;
 PERFORM co_test.assert(digest=t.fingerprint,'protected baseline unchanged: '||t.name);
 END LOOP;
 PERFORM co_test.assert((SELECT remaining_quantity=50 FROM public.promotions WHERE id=md5('co-promo')::uuid),'CO creation and deliveries consume zero promo stock');
END $co_creation_never_consumes_promo_stock$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
SELECT 'CO_ORDERS_DELIVERIES_PASSED';
