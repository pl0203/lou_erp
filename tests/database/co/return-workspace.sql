-- AUTHORED, NOT EXECUTED. Append inside import-posting.sql's rollback fixture.
-- Uses only synthetic co_test helpers and an independently guarded disposable DB.
DO $$ BEGIN
 IF current_database()<>'pilot_co_test' OR current_user<>'postgres' OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') THEN RAISE EXCEPTION 'Disposable fixture required';END IF;
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true);
END $$;
CREATE FUNCTION co_test.return_input(c uuid,day date,qty integer DEFAULT 1) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('customer_id',c,'expected_customer_version',s.version::text,'expected_generation_id',s.effective_generation_id,'return_date',day,'reference',null,'reason','Synthetic unsold goods return','notes',null,'items',
  (SELECT jsonb_agg(jsonb_build_object('stock_key_id',k.id,'quantity',qty,'unit',u.unit,'unit_version',u.version::text,'unit_id',u.id) ORDER BY k.id) FROM private.co_stock_keys k JOIN private.co_stock_key_unit_declarations u ON u.stock_key_id=k.id AND u.customer_id=c WHERE k.customer_id=c))
 FROM private.co_customer_state s WHERE s.customer_id=c;
$$;
CREATE FUNCTION co_test.return_units(c uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE k uuid;BEGIN FOR k IN SELECT id FROM private.co_stock_keys WHERE customer_id=c ORDER BY id LOOP
 PERFORM public.pilot_co_declare_stock_key_unit_v1(gen_random_uuid(),jsonb_build_object('customer_id',c,'stock_key_id',k,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'expected_unit_version',null,'unit','PCS','reason','Explicit synthetic unit','confirmed',true));
END LOOP;END $$;
CREATE FUNCTION co_test.return_snapshot(c uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT co_test.import_snapshot(c)||jsonb_build_object('return_heads',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.co_return_heads x WHERE customer_id=c),'return_revisions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.co_return_revisions x WHERE customer_id=c),'return_lines',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.co_return_revision_lines x WHERE customer_id=c),'requests',(SELECT jsonb_agg(to_jsonb(x) ORDER BY request_id) FROM private.co_return_workspace_requests x WHERE actor_id=auth.uid()));
$$;
DO $create_retry$ DECLARE c uuid;day date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;p jsonb;r jsonb;s jsonb;req uuid:=gen_random_uuid();k uuid;
BEGIN
 c:=co_test.monthly_customer('return-workspace-multi');
 PERFORM co_test.monthly_delivery(c,'RW-A','RW-A',7,'10.00',day);
 PERFORM co_test.monthly_delivery(c,'RW-B','RW-B',9,'20.00',day);
 PERFORM co_test.return_units(c);
 p:=co_test.return_input(c,day,2);
 r:=public.pilot_co_return_items_v1(c,'',p->>'expected_customer_version',1,1);
 PERFORM co_test.assert(r->>'total'='2' AND jsonb_array_length(r->'rows')=1 AND r->>'customer_version'=p->>'expected_customer_version','bounded positive SKU read + version');
 r:=public.pilot_co_return_create_v1(req,p);
 PERFORM co_test.assert(r->>'head_id'<>r->>'revision_id','head and revision preserved as separate identity');
 PERFORM co_test.assert((SELECT count(*)=2 AND sum(quantity)=4 FROM private.co_return_revision_lines WHERE revision_id=(r->>'revision_id')::uuid),'multiSKU single revision atomically records both');
 PERFORM co_test.assert((SELECT count(*)=1 FROM private.co_return_heads WHERE customer_id=c),'one return head');
 PERFORM co_test.assert((SELECT count(*)=0 FROM private.co_drafts WHERE customer_id=c AND kind='return' AND NOT payload?'posted_return_head_id'),'no visible unposted draft');
 s:=co_test.return_snapshot(c);
 PERFORM co_test.assert(public.pilot_co_return_create_v1(req,p)=r,'same exact request returns canonical receipt after stale-version change');
 PERFORM co_test.assert(public.pilot_co_return_create_result_v1(req)->'result'=r,'lost response recovery');
 PERFORM co_test.assert(co_test.return_snapshot(c)=s,'retry has zero writes');
 PERFORM co_test.report_code(format('SELECT public.pilot_co_return_create_v1(%L,%L)',req,jsonb_set(p,'{reason}','"different"')),'PT409','CO_RETURN_REQUEST_CONFLICT');
 PERFORM co_test.assert(co_test.return_snapshot(c)=s,'changed payload rejected without writes');
 r:=public.pilot_co_returns_page_v1(c,day,day,1,10);
 PERFORM co_test.assert(r->>'total'='1' AND r->'rows'->0->>'item_count'='2' AND r->'rows'->0->'quantities'->0->>'quantity'='4','recorded table summary');
 PERFORM co_test.assert(public.pilot_co_return_create_result_v1(gen_random_uuid())->>'status'='not_found','unknown request explicitly not found');
END $create_retry$;

DO $atomic_rejections$ DECLARE c uuid;day date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;p jsonb;bad jsonb;s jsonb;req uuid:=gen_random_uuid();which text;
BEGIN
 c:=co_test.monthly_customer('return-workspace-invalid');
 PERFORM co_test.monthly_delivery(c,'RW-C','RW-C',7,'10.00',day);
 PERFORM co_test.monthly_delivery(c,'RW-D','RW-D',9,'20.00',day);
 PERFORM co_test.return_units(c);p:=co_test.return_input(c,day,2);s:=co_test.return_snapshot(c);
 FOREACH which IN ARRAY ARRAY['oversold','fraction','empty','duplicate','unit','unitid','unitversion','generation','customer','future','reason'] LOOP
  bad:=CASE which
   WHEN 'oversold' THEN jsonb_set(p,'{items,1,quantity}','100')
   WHEN 'fraction' THEN jsonb_set(p,'{items,0,quantity}','1.5')
   WHEN 'empty' THEN jsonb_set(p,'{items}','[]')
   WHEN 'duplicate' THEN jsonb_set(p,'{items}',jsonb_build_array(p->'items'->0,p->'items'->0))
   WHEN 'unit' THEN jsonb_set(p,'{items,0,unit}','"BOX"')
   WHEN 'unitid' THEN jsonb_set(p,'{items,0,unit_id}',to_jsonb(gen_random_uuid()))
   WHEN 'unitversion' THEN jsonb_set(p,'{items,0,unit_version}','"2"')
   WHEN 'generation' THEN jsonb_set(p,'{expected_generation_id}',to_jsonb(gen_random_uuid()))
   WHEN 'customer' THEN jsonb_set(p,'{expected_customer_version}','"1"')
   WHEN 'future' THEN jsonb_set(p,'{return_date}',to_jsonb(day+1))
   WHEN 'reason' THEN jsonb_set(p,'{reason}','" "') END;
  PERFORM co_test.raises(format('SELECT public.pilot_co_return_create_v1(%L,%L)',req,bad),CASE WHEN which IN('unit','unitid','unitversion','generation','customer') THEN 'PT409' WHEN which='oversold' THEN '23514' ELSE '22023' END,which);
  PERFORM co_test.assert(co_test.return_snapshot(c)=s,'atomic no partial draft, command, return, movement or request on '||which);
 END LOOP;
 PERFORM public.pilot_co_return_create_v1(req,p);
 PERFORM co_test.raises(format('SELECT public.pilot_co_return_create_v1(%L,%L)',gen_random_uuid(),p),'PT409','second independent save using stale stock fails');
END $atomic_rejections$;

DO $authorization$ DECLARE c uuid;day date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;p jsonb;r jsonb;req uuid:=gen_random_uuid();actor text;
BEGIN
 c:=co_test.monthly_customer('return-workspace-auth');PERFORM co_test.monthly_delivery(c,'RW-E','RW-E',2,'10.00',day);PERFORM co_test.return_units(c);p:=co_test.return_input(c,day);
 r:=public.pilot_co_return_create_v1(req,p);
 FOREACH actor IN ARRAY ARRAY['co-user-3','co-user-4'] LOOP
  PERFORM set_config('request.jwt.claim.sub',md5(actor)::uuid::text,true);
  PERFORM co_test.raises(format('SELECT public.pilot_co_return_create_v1(%L,%L)',req,p),'42501','wrong or inactive actor cannot retry');
  PERFORM co_test.raises(format('SELECT public.pilot_co_return_create_result_v1(%L)',req),'42501','wrong or inactive actor cannot recover');
  PERFORM co_test.raises('SELECT public.pilot_co_return_customers_v1('''',1,10)','42501','wrong or inactive actor cannot read');
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-2')::uuid::text,true);
 PERFORM co_test.assert(public.pilot_co_return_create_result_v1(req)->>'status'='not_found','different authorized actor sees no receipt');
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true);
END $authorization$;

-- A late exception after internal save proves rollback includes private drafts/commands.
CREATE FUNCTION co_test.return_late_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic late return failure' USING ERRCODE='PZ701'; END $$;
DO $late_rollback$ DECLARE c uuid;day date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;p jsonb;s jsonb;req uuid:=gen_random_uuid();BEGIN
 c:=co_test.monthly_customer('return-workspace-late');PERFORM co_test.monthly_delivery(c,'RW-F','RW-F',4,'10.00',day);PERFORM co_test.return_units(c);p:=co_test.return_input(c,day);s:=co_test.return_snapshot(c);
 EXECUTE 'CREATE TRIGGER co_test_return_fault BEFORE INSERT ON private.co_return_heads FOR EACH ROW EXECUTE FUNCTION co_test.return_late_fault()';
 PERFORM co_test.raises(format('SELECT public.pilot_co_return_create_v1(%L,%L)',req,p),'PZ701','late kernel exception');
 PERFORM co_test.assert(co_test.return_snapshot(c)=s,'late failure restores complete before image including internal draft and idempotency');
 EXECUTE 'DROP TRIGGER co_test_return_fault ON private.co_return_heads';
 PERFORM public.pilot_co_return_create_v1(req,p);
END $late_rollback$;

DO $sales_preserved$ DECLARE c uuid;m date:=(date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '1 month')::date;d uuid;k uuid;p jsonb;before_sales jsonb;before_reports jsonb;s jsonb;state text;BEGIN
 c:=co_test.monthly_customer('return-workspace-sales');PERFORM co_test.monthly_delivery(c,'RW-G','RW-G',10,'17.25',m);
 PERFORM co_test.return_units(c);SELECT id INTO k FROM private.co_stock_keys WHERE customer_id=c;
 d:=co_test.report_init(c,m);
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',co_test.report_input(d)||jsonb_build_object('action','upsert_lines','lines',jsonb_build_array(jsonb_build_object('stock_key_id',k,'sold_quantity',6))));
 PERFORM co_test.report_post(d);
 before_sales:=private.co_effective_allocation_signature_v1(c);SELECT jsonb_agg(to_jsonb(h) ORDER BY id) INTO before_reports FROM private.co_report_heads h WHERE customer_id=c;
 p:=co_test.return_input(c,(clock_timestamp() AT TIME ZONE 'UTC')::date,2);PERFORM public.pilot_co_return_create_v1(gen_random_uuid(),p);
 PERFORM co_test.assert(private.co_effective_allocation_signature_v1(c)=before_sales,'quantity/value/batch/PIC sales signature unchanged');
 PERFORM co_test.assert((SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM private.co_report_heads h WHERE customer_id=c)=before_reports,'report identity/version unchanged');
 -- Backdated/same-date requests may fail closed or succeed ONLY with exact sales invariance.
 p:=co_test.return_input(c,(m+interval '1 month -1 day')::date,1);s:=co_test.return_snapshot(c);
 BEGIN PERFORM public.pilot_co_return_create_v1(gen_random_uuid(),p);EXCEPTION WHEN SQLSTATE '23514' THEN state:='rejected';END;
 PERFORM co_test.assert(private.co_effective_allocation_signature_v1(c)=before_sales,'same-date return never reallocates sales');
 PERFORM co_test.assert((SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM private.co_report_heads h WHERE customer_id=c)=before_reports,'same-date return never republishes report');
 IF state='rejected' THEN PERFORM co_test.assert(co_test.return_snapshot(c)=s,'rejected same-date return atomic');END IF;
END $sales_preserved$;
SELECT 'CO_RETURN_WORKSPACE_BEHAVIOR_PASSED';
DO $large_read$ DECLARE c uuid;empty_customer uuid;day date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;lines jsonb;r jsonb;d jsonb;page1 jsonb;page2 jsonb;v text;k uuid;p jsonb;s jsonb;BEGIN
 c:=co_test.monthly_customer('return-workspace-105-skus');empty_customer:=co_test.monthly_customer('return-workspace-zero-stock');
 SELECT jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'sku','RW-'||lpad(n::text,3,'0'),'product_name','Synthetic item '||n,'product_id',null,'ordered_quantity',1,'unit_price','1.00') ORDER BY n) INTO lines FROM generate_series(1,105)n;
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'create_co',jsonb_build_object('customer_id',c,'expected_customer_version','1','co_number','RW-LARGE','order_date',day,'lines',lines));
 SELECT jsonb_agg(jsonb_build_object('co_line_id',value->'id','quantity',1)) INTO lines FROM jsonb_array_elements(lines);
 d:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',jsonb_build_object('co_id',r->'id','expected_co_version',r->>'version','expected_customer_version',r->>'customer_version','sj_number','RW-SJ-LARGE','sj_date',day,'lines',lines));
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'post_sj',jsonb_build_object('draft_id',d->'id','expected_draft_version',d->>'version','expected_co_version',r->>'version','expected_customer_version',d->>'customer_version'));
 SELECT version::text INTO v FROM private.co_customer_state WHERE customer_id=c;
 page1:=public.pilot_co_return_items_v1(c,'',v,1,100);page2:=public.pilot_co_return_items_v1(c,'',v,2,100);
 PERFORM co_test.assert(page1->>'total'='105' AND jsonb_array_length(page1->'rows')=100 AND jsonb_array_length(page2->'rows')=5,'100+ held SKU pagination');
 PERFORM co_test.assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(page1->'rows')a JOIN jsonb_array_elements(page2->'rows')b ON a->>'stock_key_id'=b->>'stock_key_id'),'stable pages do not overlap');
 PERFORM co_test.assert(page1->'rows'->0->'unit'='null'::jsonb,'unknown unit remains unknown');
 PERFORM co_test.assert(public.pilot_co_return_items_v1(c,'RW-105',v,1,100)->>'total'='1','server SKU search');
 PERFORM co_test.assert(public.pilot_co_return_customers_v1('return-workspace-zero-stock',1,100)->>'total'='0','zero stock customer excluded');
 p:=jsonb_build_object('customer_id',c,'expected_customer_version',v,'expected_generation_id',page1->'generation_id','return_date',day,'reason','Synthetic unknown unit','items',jsonb_build_array(jsonb_build_object('stock_key_id',page1->'rows'->0->'stock_key_id','quantity',1,'unit','PCS','unit_version','1','unit_id',gen_random_uuid())));
 s:=co_test.return_snapshot(c);PERFORM co_test.raises(format('SELECT public.pilot_co_return_create_v1(%L,%L)',gen_random_uuid(),p),'PT409','unknown unit cannot be inferred');PERFORM co_test.assert(co_test.return_snapshot(c)=s,'unknown unit no writes');
END $large_read$;
SELECT 'CO_RETURN_WORKSPACE_LARGE_READ_PASSED';
DO $batch_fifo$ DECLARE c uuid;day date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;m date:=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date;p jsonb;r jsonb;b1 uuid;b2 uuid;BEGIN
 c:=co_test.monthly_customer('return-workspace-multibatch');
 PERFORM co_test.monthly_delivery(c,'RW-MB-1','RW-MB',5,'11.00',m);
 PERFORM co_test.monthly_delivery(c,'RW-MB-2','RW-MB',5,'29.00',least(m+1,day));
 PERFORM co_test.return_units(c);
 SELECT id INTO b1 FROM private.co_stock_batches WHERE customer_id=c AND unit_price=11;
 SELECT id INTO b2 FROM private.co_stock_batches WHERE customer_id=c AND unit_price=29;
 PERFORM co_test.assert(b1 IS NOT NULL AND b2 IS NOT NULL,'two distinct price source batches');
 p:=co_test.return_input(c,day,7);r:=public.pilot_co_return_create_v1(gen_random_uuid(),p);
 PERFORM co_test.assert((SELECT quantity=5 FROM private.co_return_revision_lines WHERE revision_id=(r->>'revision_id')::uuid AND batch_id=b1),'oldest source consumed first');
 PERFORM co_test.assert((SELECT quantity=2 FROM private.co_return_revision_lines WHERE revision_id=(r->>'revision_id')::uuid AND batch_id=b2),'remainder allocated next source without source chooser');
 PERFORM co_test.assert((SELECT sum(l.quantity*b.unit_price)=113 FROM private.co_return_revision_lines l JOIN private.co_stock_batches b ON b.id=l.batch_id WHERE l.revision_id=(r->>'revision_id')::uuid),'return value retains distinct source price, never blended');
END $batch_fifo$;

DO $backdate_multibatch$ DECLARE c uuid;m date:=(date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '1 month')::date;k uuid;d uuid;p jsonb;s jsonb;alloc jsonb;heads jsonb;state text;BEGIN
 c:=co_test.monthly_customer('return-workspace-backdated-sources');
 PERFORM co_test.monthly_delivery(c,'RW-BD-1','RW-BD',5,'11.00',m);
 PERFORM co_test.monthly_delivery(c,'RW-BD-2','RW-BD',5,'29.00',m+1);
 PERFORM co_test.return_units(c);SELECT id INTO k FROM private.co_stock_keys WHERE customer_id=c;
 d:=co_test.report_init(c,m);
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',co_test.report_input(d)||jsonb_build_object('action','upsert_lines','lines',jsonb_build_array(jsonb_build_object('stock_key_id',k,'sold_quantity',3))));
 PERFORM co_test.report_post(d);
 p:=co_test.return_input(c,m+2,3);s:=co_test.return_snapshot(c);alloc:=private.co_effective_allocation_signature_v1(c);
 SELECT jsonb_agg(to_jsonb(h) ORDER BY id) INTO heads FROM private.co_report_heads h WHERE customer_id=c;
 BEGIN PERFORM public.pilot_co_return_create_v1(gen_random_uuid(),p);EXCEPTION WHEN SQLSTATE '23514' THEN state:='rejected';END;
 PERFORM co_test.assert(private.co_effective_allocation_signature_v1(c)=alloc,'earlier than recorded sales never reallocates equal total across different prices');
 PERFORM co_test.assert((SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM private.co_report_heads h WHERE customer_id=c)=heads,'backdated never changes report identity');
 IF state='rejected' THEN PERFORM co_test.assert(co_test.return_snapshot(c)=s,'backdate rejection fully atomic');END IF;
END $backdate_multibatch$;

DO $cross_customer_limits$ DECLARE a uuid;b uuid;day date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;p jsonb;other jsonb;bad jsonb;s jsonb;BEGIN
 a:=co_test.monthly_customer('return-workspace-cross-a');b:=co_test.monthly_customer('return-workspace-cross-b');
 PERFORM co_test.monthly_delivery(a,'RW-X-A','RW-X-A',3,'10.00',day);PERFORM co_test.monthly_delivery(b,'RW-X-B','RW-X-B',3,'10.00',day);
 PERFORM co_test.return_units(a);PERFORM co_test.return_units(b);p:=co_test.return_input(a,day);other:=co_test.return_input(b,day);s:=co_test.return_snapshot(a);
 bad:=jsonb_set(p,'{items}',other->'items');PERFORM co_test.raises(format('SELECT public.pilot_co_return_create_v1(%L,%L)',gen_random_uuid(),bad),'PT409','cross customer stock and unit identity');
 bad:=jsonb_set(p,'{items}',(SELECT jsonb_agg(p->'items'->0) FROM generate_series(1,101)));
 PERFORM co_test.raises(format('SELECT public.pilot_co_return_create_v1(%L,%L)',gen_random_uuid(),bad),'22023','101 submitted items bounded');
 bad:=jsonb_set(p,'{notes}',to_jsonb(repeat('x',262145)));
 PERFORM co_test.raises(format('SELECT public.pilot_co_return_create_v1(%L,%L)',gen_random_uuid(),bad),'22023','payload bytes bounded');
 PERFORM co_test.raises('SELECT public.pilot_co_return_customers_v1('''',1,101)','22023','page size bounded');
 PERFORM co_test.assert(co_test.return_snapshot(a)=s,'cross identity and limit errors write nothing');
END $cross_customer_limits$;
SELECT 'CO_RETURN_WORKSPACE_SOURCE_SAFETY_PASSED';
DO $pic_preserved$ DECLARE setup jsonb;c uuid;p jsonb;signature jsonb;heads jsonb;BEGIN
 -- Existing composed fixture builds different-price batches with different sales PICs.
 setup:=co_test.import_setup('return-workspace-pic');c:=(setup->>'customerId')::uuid;
 p:=co_test.import_post_payload(setup->'binding');PERFORM public.pilot_co_import_commit_v1((p->>'requestId')::uuid,p);
 signature:=private.co_effective_allocation_signature_v1(c);
 PERFORM co_test.assert((SELECT count(DISTINCT sales_person_id_at_creation)=2 FROM private.co_sale_allocations WHERE customer_id=c AND generation_id=(SELECT effective_generation_id FROM private.co_customer_state WHERE customer_id=c)),'fixture spans two PICs');
 SELECT jsonb_agg(to_jsonb(h) ORDER BY id) INTO heads FROM private.co_report_heads h WHERE customer_id=c;
 p:=co_test.return_input(c,(clock_timestamp() AT TIME ZONE 'UTC')::date,2);PERFORM public.pilot_co_return_create_v1(gen_random_uuid(),p);
 PERFORM co_test.assert(private.co_effective_allocation_signature_v1(c)=signature,'return preserves both historical PICs, source quantities and prices');
 PERFORM co_test.assert((SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM private.co_report_heads h WHERE customer_id=c)=heads,'PIC preservation without republishing head');
END $pic_preserved$;

DO $generation_recovery$ DECLARE c uuid;day date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;p jsonb;r jsonb;req uuid:=gen_random_uuid();BEGIN
 IF to_regclass('private.catalog_cutover_v1') IS NULL THEN RETURN;END IF;
 c:=co_test.monthly_customer('return-workspace-generation');PERFORM co_test.monthly_delivery(c,'RW-GEN','RW-GEN',3,'10.00',day);PERFORM co_test.return_units(c);p:=co_test.return_input(c,day);
 r:=public.pilot_co_return_create_v1(req,p);
 -- Owner-only, disposable transaction fault injection, never a cutover rollout.
 -- Raise/catch rolls back the synthetic change and both constraint changes together.
 BEGIN
  ALTER TABLE private.catalog_cutover_v1 DROP CONSTRAINT catalog_foundation_generation_one;
  UPDATE private.catalog_cutover_v1 SET execution_generation=2 WHERE singleton;
  PERFORM co_test.assert(public.pilot_co_return_create_v1(req,p)=r,'generation2 exact old request still replayable');
  PERFORM co_test.assert(public.pilot_co_return_create_result_v1(req)->'result'=r,'generation2 receipt recovery');
  PERFORM co_test.raises(format('SELECT public.pilot_co_return_create_v1(%L,%L)',gen_random_uuid(),p),'55000','generation2 fresh create refused');
  RAISE EXCEPTION 'Synthetic rollback generation branch' USING ERRCODE='PZ703';
 EXCEPTION WHEN SQLSTATE 'PZ703' THEN NULL;
 END;
 PERFORM private.co_workspace_generation_guard_v1();
 PERFORM co_test.assert(EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='private.catalog_cutover_v1'::regclass AND conname='catalog_foundation_generation_one' AND convalidated),'fixture generation constraint restored by rollback');
END $generation_recovery$;
SELECT 'CO_RETURN_WORKSPACE_PIC_GENERATION_PASSED';
DO $history_customer$ DECLARE c uuid;day date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;BEGIN
 c:=co_test.monthly_customer('return-workspace-depleted');PERFORM co_test.monthly_delivery(c,'RW-DEP','RW-DEP',1,'10.00',day);PERFORM co_test.return_units(c);
 PERFORM public.pilot_co_return_create_v1(gen_random_uuid(),co_test.return_input(c,day));
 PERFORM co_test.assert(public.pilot_co_return_customers_v1('return-workspace-depleted',1,100)->>'total'='0','depleted customer absent from new return picker');
 PERFORM co_test.assert(public.pilot_co_return_history_customers_v1('return-workspace-depleted',1,100)->>'total'='1','depleted customer stays in history filter');
END $history_customer$;
SELECT 'CO_RETURN_WORKSPACE_HISTORY_CUSTOMERS_PASSED';
