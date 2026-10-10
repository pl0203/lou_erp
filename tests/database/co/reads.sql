-- Real behavior against the guarded disposable service. All fixtures roll back.
BEGIN;
DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true); END $$;
CREATE FUNCTION co_test.monthly_customer(label text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE c uuid:=md5('monthly-customer-'||label)::uuid;
BEGIN INSERT INTO public.customers(id,name) VALUES(c,label); RETURN c; END $$;
CREATE FUNCTION co_test.monthly_delivery(c uuid,ref text,sku text,q integer,price text,day date,p_product uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE o uuid; d uuid; l uuid:=gen_random_uuid(); r jsonb; v text;
BEGIN
 SELECT coalesce((SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'1') INTO v;
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'create_co',jsonb_build_object('customer_id',c,'expected_customer_version',v,'co_number',ref,'order_date',day,
 'lines',jsonb_build_array(jsonb_build_object('id',l,'sku',sku,'product_name',sku,'product_id',p_product,'ordered_quantity',q,'unit_price',price)))); o:=(r->>'id')::uuid;
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',jsonb_build_object('co_id',o,'expected_co_version','1','expected_customer_version',r->>'customer_version','sj_number','SJ-'||ref,'sj_date',day,'lines',jsonb_build_array(jsonb_build_object('co_line_id',l,'quantity',q)))); d:=(r->>'id')::uuid;
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'post_sj',jsonb_build_object('draft_id',d,'expected_draft_version',r->>'version','expected_co_version','1','expected_customer_version',r->>'customer_version'));
 RETURN o;
END $$;
CREATE FUNCTION co_test.report_init(c uuid,m date) RETURNS uuid LANGUAGE sql AS $$
 SELECT (public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',jsonb_build_object('action','initialize','customer_id',c,'report_month',m,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c)))->>'id')::uuid;
$$;
CREATE FUNCTION co_test.report_input(d uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('draft_id',d,'expected_draft_version',x.version::text,'expected_customer_version',c.version::text,'eligible_set_fingerprint',x.eligible_set_fingerprint)
 FROM private.co_drafts x JOIN private.co_customer_state c ON c.customer_id=x.customer_id WHERE x.id=d;
$$;
CREATE FUNCTION co_test.report_zero(d uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',co_test.report_input(d)||jsonb_build_object('action','fill_remaining_zero'));
$$;
CREATE FUNCTION co_test.report_post(d uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE p jsonb:=co_test.report_input(d); preview jsonb;
BEGIN preview:=public.pilot_co_preview_v1('post_report',p); RETURN public.pilot_co_transaction_v1(gen_random_uuid(),'post_report',p||jsonb_build_object('preview_fingerprint',preview->>'preview_fingerprint')); END $$;
CREATE FUNCTION co_test.report_code(sql text,expected_state text,expected_message text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE state text; message text;
BEGIN BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE,message=MESSAGE_TEXT; END;
 PERFORM co_test.assert(state=expected_state AND message=expected_message,'expected '||expected_state||'/'||expected_message||', got '||coalesce(state,'success')||'/'||coalesce(message,'')); END $$;

-- Removing any public return/correction/closure operation must fail these real SQL fixtures.
CREATE FUNCTION co_test.set_sold(d uuid,q integer) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',co_test.report_input(d)||jsonb_build_object('action','upsert_lines','lines',(SELECT jsonb_agg(jsonb_build_object('stock_key_id',stock_key_id,'sold_quantity',q)) FROM private.co_report_draft_lines WHERE draft_id=d)));
END $$;
CREATE FUNCTION co_test.refresh_report(c uuid,m date) RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE d private.co_drafts%ROWTYPE; r jsonb; BEGIN
 SELECT * INTO d FROM private.co_drafts WHERE customer_id=c AND report_month=m AND kind='report';
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',jsonb_build_object('action','initialize','customer_id',c,'report_month',m,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'draft_id',d.id,'expected_draft_version',d.version::text)); RETURN (r->>'id')::uuid;
END $$;
CREATE FUNCTION co_test.review_fields(c uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'reason','Explicit correction','completed_report_drafts','[]'::jsonb,'acknowledged_reopen_orders','[]'::jsonb); $$;
CREATE FUNCTION co_test.report_correction(d uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT co_test.report_input(d)||co_test.review_fields(x.customer_id)||jsonb_build_object('report_head_id',h.id,'original_revision_id',h.current_revision_id,'expected_report_version',h.version::text) FROM private.co_drafts x JOIN private.co_report_heads h ON h.customer_id=x.customer_id AND h.report_month=x.report_month WHERE x.id=d; $$;
CREATE FUNCTION co_test.review_post(op text,p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE v jsonb; BEGIN v:=public.pilot_co_preview_v1(op,p); RETURN public.pilot_co_transaction_v1(gen_random_uuid(),op,p||jsonb_build_object('preview_fingerprint',v->>'preview_fingerprint')); END $$;
CREATE FUNCTION co_test.return_draft(c uuid,b uuid,q integer,day date) RETURNS uuid LANGUAGE sql AS $$ SELECT (public.pilot_co_transaction_v1(gen_random_uuid(),'save_return_draft',jsonb_build_object('customer_id',c,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'return_date',day,'reference','Returned unsold','lines',jsonb_build_array(jsonb_build_object('batch_id',b,'quantity',q))))->>'id')::uuid; $$;
CREATE FUNCTION co_test.return_input(d uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT co_test.review_fields(x.customer_id)||jsonb_build_object('draft_id',x.id,'expected_draft_version',x.version::text) FROM private.co_drafts x WHERE x.id=d; $$;
CREATE FUNCTION co_test.stock(c uuid) RETURNS numeric LANGUAGE sql AS $$ SELECT coalesce(sum(m.quantity_delta),0) FROM private.co_stock_movements m JOIN private.co_customer_state s ON s.effective_generation_id=m.generation_id WHERE s.customer_id=c; $$;
CREATE FUNCTION co_test.revenue(c uuid,m date) RETURNS numeric LANGUAGE sql AS $$ SELECT coalesce(sum(a.amount),0) FROM private.co_sale_allocations a JOIN private.co_customer_state s ON s.effective_generation_id=a.generation_id JOIN private.co_report_heads h ON h.id=(SELECT head_id FROM private.co_report_revisions WHERE id=a.report_revision_id) WHERE s.customer_id=c AND h.report_month=m; $$;
CREATE FUNCTION co_test.order_input(o uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('co_id',id,'expected_co_version',version::text,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=x.customer_id),'reason','Explicit closure') FROM private.co_orders x WHERE id=o; $$;
CREATE FUNCTION co_test.snapshot(c uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('sources',private.co_sources_v1(c),'state',(SELECT to_jsonb(s) FROM private.co_customer_state s WHERE customer_id=c),'revisions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM private.co_report_revisions r WHERE customer_id=c),'deliveries',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM private.co_delivery_revisions r WHERE customer_id=c),'returns',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM private.co_return_revisions r WHERE customer_id=c),'drafts',(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM private.co_drafts d WHERE customer_id=c),'audits',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM private.co_audit_events a WHERE customer_id=c),'generations',(SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM private.co_replay_generations g WHERE customer_id=c),'commands',(SELECT jsonb_agg(to_jsonb(x) ORDER BY request_id) FROM private.co_commands x)); $$;

CREATE FUNCTION co_test.sj_correction(o uuid,day date,q integer) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE h private.co_delivery_heads%ROWTYPE; r private.co_delivery_revisions%ROWTYPE; d jsonb; p jsonb;
BEGIN SELECT * INTO h FROM private.co_delivery_heads WHERE co_id=o ORDER BY id LIMIT 1; SELECT * INTO r FROM private.co_delivery_revisions WHERE id=h.current_revision_id;
 p:=co_test.order_input(o)-'reason'||jsonb_build_object('delivery_head_id',h.id,'original_revision_id',h.current_revision_id,'expected_delivery_version',h.version::text,'sj_number',r.sj_number,'sj_date',day,'lines',(SELECT jsonb_agg(jsonb_build_object('co_line_id',co_line_id,'quantity',q)) FROM private.co_delivery_revision_lines WHERE revision_id=r.id));
 d:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',p);
 RETURN co_test.review_fields(h.customer_id)||jsonb_build_object('delivery_head_id',h.id,'original_revision_id',h.current_revision_id,'expected_delivery_version',h.version::text,'expected_co_version',(SELECT version::text FROM private.co_orders WHERE id=o),'action','replace','draft_id',d->>'id','expected_draft_version',d->>'version');
END $$;
CREATE FUNCTION co_test.context_report(c uuid,m date,op text,p jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v jsonb:=public.pilot_co_preview_v1(op,p); result jsonb; binding jsonb:='{}'; existing private.co_drafts%ROWTYPE;
BEGIN SELECT * INTO existing FROM private.co_drafts WHERE customer_id=c AND report_month=m AND kind='report'; IF existing.id IS NOT NULL THEN binding:=jsonb_build_object('draft_id',existing.id,'expected_draft_version',existing.version::text); END IF; result:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',binding||jsonb_build_object('action','initialize','customer_id',c,'report_month',m,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'source_context',jsonb_build_object('operation',op,'payload',p-ARRAY['completed_report_drafts','acknowledged_reopen_orders'],'source_context_fingerprint',v->>'source_context_fingerprint'))); RETURN (result->>'id')::uuid; END $$;

CREATE TEMP TABLE co_read_fixtures(seq integer GENERATED ALWAYS AS IDENTITY,name text,args jsonb,data jsonb,expected jsonb);
CREATE FUNCTION co_test.read_fixture(n text,a jsonb,d jsonb,e jsonb DEFAULT '{}') RETURNS void LANGUAGE sql AS $$ INSERT INTO co_read_fixtures(name,args,data,expected) VALUES(n,a,d,e); $$;
SELECT co_test.assert(to_regprocedure('public.pilot_co_page_v1(text,text,integer,integer,uuid)') IS NOT NULL,'CO operational page RPC exists');
DO $reads_large$
DECLARE c uuid:=co_test.monthly_customer('reads-large'); fresh uuid:=co_test.monthly_customer('reads-untouched'); m date:=(date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '1 month')::date; o uuid; d uuid; report_draft uuid; r jsonb; a jsonb; data jsonb; lines jsonb; cv text; ov text; p jsonb; preview jsonb; rev uuid; key uuid; i integer;kind text;parent uuid;
BEGIN
 data:=public.pilot_co_customer_stock_v1(fresh,NULL,'',NULL,1,100);
 PERFORM co_test.assert(data->>'customer_version'='1' AND data->>'total'='0' AND NOT EXISTS(SELECT 1 FROM private.co_customer_state WHERE customer_id=fresh),'untouched read never writes or invents opening state');
 PERFORM co_test.read_fixture('pilot_co_customer_stock_v1',jsonb_build_object('p_customer_id',fresh,'p_as_of',NULL,'p_search','','p_expected_customer_version',NULL,'p_page',1,'p_page_size',100),data,'{"customer_version":"1","total":"0"}');
 SELECT jsonb_agg(jsonb_build_object('id',md5('reads-line-'||x)::uuid,'sku','READ-'||x,'product_name','Read item '||x,'ordered_quantity',2,'unit_price',CASE WHEN x=1 THEN '0.00' ELSE '1.01' END)) INTO lines FROM generate_series(1,601)x;
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'create_co',jsonb_build_object('customer_id',c,'expected_customer_version','1','co_number','READ-LARGE','order_date',m,'lines',lines));o:=(r->>'id')::uuid;cv:=r->>'customer_version';ov:='1';
 SELECT jsonb_agg(jsonb_build_object('co_line_id',id,'quantity',2)) INTO lines FROM private.co_order_lines WHERE co_id=o;
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',jsonb_build_object('co_id',o,'expected_co_version',ov,'expected_customer_version',cv,'sj_number','READ-SJ','sj_date',m,'lines',lines));d:=(r->>'id')::uuid;cv:=r->>'customer_version';
 data:=public.pilot_co_page_v1('all','',1,1,c);PERFORM co_test.assert(data->>'total'='1' AND data->'summary'->>'planned_value'='1212.00','page summaries cover complete601 lines');
 PERFORM co_test.read_fixture('pilot_co_page_v1',jsonb_build_object('p_status','all','p_search','','p_customer_id',c,'p_page',1,'p_page_size',1),data,'{"total":"1","summary.planned_value":"1212.00"}');
 PERFORM co_test.read_fixture('pilot_co_detail_v1',jsonb_build_object('p_co_id',o,'p_expected_version',ov),public.pilot_co_detail_v1(o,ov));
 FOR i IN 1..7 LOOP
  a:=jsonb_build_object('p_co_id',o,'p_section','lines','p_parent_id',NULL,'p_expected_version',ov,'p_expected_customer_version',cv,'p_expected_draft_version',NULL,'p_page',i,'p_page_size',100);
  data:=public.pilot_co_detail_section_v1(o,'lines',NULL,ov,cv,i,100,NULL);PERFORM co_test.assert(data->>'total'='601','all order lines counted');PERFORM co_test.read_fixture('pilot_co_detail_section_v1',a,data,'{"total":"601"}');
  a:=jsonb_build_object('p_customer_id',c,'p_as_of',NULL,'p_search','','p_expected_customer_version',cv,'p_page',i,'p_page_size',100);data:=public.pilot_co_customer_stock_v1(c,NULL,'',cv,i,100);PERFORM co_test.assert(data->>'total'='601' AND data->'summary'->>'recorded_quantity'='0','never-delivered keys visible as recorded zero');PERFORM co_test.read_fixture('pilot_co_customer_stock_v1',a,data,'{"total":"601","summary.recorded_quantity":"0"}');
  a:=jsonb_build_object('p_co_id',o,'p_section','sj_draft_lines','p_parent_id',d,'p_expected_version',ov,'p_expected_customer_version',cv,'p_expected_draft_version','1','p_page',i,'p_page_size',100);PERFORM co_test.read_fixture('pilot_co_detail_section_v1',a,public.pilot_co_detail_section_v1(o,'sj_draft_lines',d,ov,cv,i,100,'1'),' {"total":"601"}');
 END LOOP;
 PERFORM co_test.read_fixture('pilot_co_detail_section_v1',jsonb_build_object('p_co_id',o,'p_section','sj_drafts','p_parent_id',d,'p_expected_version',ov,'p_expected_customer_version',cv,'p_expected_draft_version',NULL,'p_page',1,'p_page_size',100),public.pilot_co_detail_section_v1(o,'sj_drafts',d,ov,cv,1,100,NULL));
 PERFORM co_test.raises(format('SELECT public.pilot_co_detail_section_v1(%L,%L,%L,%L,%L,1,100,%L)',o,'sj_draft_lines',d,ov,cv,'2'),'PT409','draft version required');
 PERFORM co_test.raises(format('SELECT public.pilot_co_detail_section_v1(%L,%L,NULL,%L,%L,1,100,NULL)',o,'lines','99',cv),'PT409','CO version pinned');
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'post_sj',jsonb_build_object('draft_id',d,'expected_draft_version','1','expected_co_version',ov,'expected_customer_version',cv));cv:=(SELECT version::text FROM private.co_customer_state WHERE customer_id=c);ov:='2';
 report_draft:=co_test.report_init(c,m);
 PERFORM co_test.read_fixture('pilot_co_report_v1',jsonb_build_object('p_customer_id',c,'p_month',m,'p_expected_customer_version',cv),public.pilot_co_report_v1(c,m::text,cv));
 FOR i IN 0..1 LOOP
  SELECT jsonb_agg(jsonb_build_object('stock_key_id',stock_key_id,'sold_quantity',1)) INTO lines FROM (SELECT stock_key_id FROM private.co_report_draft_lines WHERE draft_id=report_draft ORDER BY stock_key_id LIMIT 500 OFFSET i*500)x;
  PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',co_test.report_input(report_draft)||jsonb_build_object('action','upsert_lines','lines',lines));
 END LOOP;
 p:=co_test.report_input(report_draft);preview:=public.pilot_co_preview_v1('post_report',p);
 PERFORM co_test.read_fixture('pilot_co_preview_v1',jsonb_build_object('p_operation','post_report','p_payload',p),preview,'{"after.revenue":"606.00"}');
 FOREACH kind IN ARRAY ARRAY['report','stock','revenue','credit','reopen','issue','missing_month'] LOOP PERFORM co_test.read_fixture('pilot_co_preview_impacts_v1',jsonb_build_object('p_operation','post_report','p_payload',p,'p_preview_fingerprint',preview->>'preview_fingerprint','p_kind',kind,'p_page',1,'p_page_size',100),public.pilot_co_preview_impacts_v1('post_report',p,preview->>'preview_fingerprint',kind,1,100));END LOOP;
 FOR i IN 1..7 LOOP
  PERFORM co_test.read_fixture('pilot_co_report_rows_v1',jsonb_build_object('p_customer_id',c,'p_month',m,'p_view','draft','p_expected_draft_version',p->>'expected_draft_version','p_expected_customer_version',cv,'p_page',i,'p_page_size',100,'p_revision_id',NULL),public.pilot_co_report_rows_v1(c,m::text,'draft',p->>'expected_draft_version',cv,i,100,NULL),' {"total":"601"}');
  PERFORM co_test.read_fixture('pilot_co_preview_allocations_v1',jsonb_build_object('p_operation','post_report','p_payload',p,'p_preview_fingerprint',preview->>'preview_fingerprint','p_report_month',m,'p_stock_key_id',NULL,'p_page',i,'p_page_size',100),public.pilot_co_preview_allocations_v1('post_report',p,preview->>'preview_fingerprint',m::text,NULL,i,100),' {"total":"601"}');
 END LOOP;
 PERFORM co_test.raises(format('SELECT public.pilot_co_preview_allocations_v1(%L,%L,%L,%L,NULL,1,100)','post_report',p,repeat('0',64),m),'PT409','allocation fingerprint pinned');
 r:=co_test.report_post(report_draft);cv:=r->>'customer_version';rev:=(SELECT current_revision_id FROM private.co_report_heads WHERE id=(r->>'id')::uuid);key:=(SELECT stock_key_id FROM private.co_report_draft_lines WHERE draft_id=report_draft ORDER BY stock_key_id LIMIT 1);
 PERFORM co_test.read_fixture('pilot_co_report_allocations_v1',jsonb_build_object('p_customer_id',c,'p_month',m,'p_revision_id',rev,'p_expected_customer_version',cv,'p_page',7,'p_page_size',100),public.pilot_co_report_allocations_v1(c,m::text,rev,cv,7,100),' {"total":"601","summary.amount":"606.00"}');
 PERFORM co_test.read_fixture('pilot_co_report_rows_v1',jsonb_build_object('p_customer_id',c,'p_month',m,'p_view','revision','p_revision_id',rev,'p_expected_draft_version',NULL,'p_expected_customer_version',cv,'p_page',7,'p_page_size',100),public.pilot_co_report_rows_v1(c,m::text,'revision',NULL,cv,7,100,rev),' {"total":"601"}');
 PERFORM co_test.read_fixture('pilot_co_reports_page_v1',jsonb_build_object('p_customer_id',c,'p_month',m,'p_status','all','p_page',1,'p_page_size',100),public.pilot_co_reports_page_v1(c,m::text,'all',1,100));
 PERFORM co_test.read_fixture('pilot_co_report_months_v1',jsonb_build_object('p_customer_id',c),public.pilot_co_report_months_v1(c));
 FOREACH kind IN ARRAY ARRAY['deliveries','reports','audit','available_batches','return_drafts','returns'] LOOP PERFORM co_test.read_fixture('pilot_co_detail_section_v1',jsonb_build_object('p_co_id',o,'p_section',kind,'p_parent_id',NULL,'p_expected_version',ov,'p_expected_customer_version',cv,'p_expected_draft_version',NULL,'p_page',1,'p_page_size',100),public.pilot_co_detail_section_v1(o,kind,NULL,ov,cv,1,100,NULL));END LOOP;
 SELECT current_revision_id INTO parent FROM private.co_delivery_heads WHERE co_id=o;
 PERFORM co_test.read_fixture('pilot_co_detail_section_v1',jsonb_build_object('p_co_id',o,'p_section','delivery_lines','p_parent_id',parent,'p_expected_version',ov,'p_expected_customer_version',cv,'p_expected_draft_version',NULL,'p_page',7,'p_page_size',100),public.pilot_co_detail_section_v1(o,'delivery_lines',parent,ov,cv,7,100,NULL),' {"total":"601"}');
 SELECT id INTO parent FROM private.co_audit_events e WHERE e.customer_id=c AND e.operation='create_co';
 data:=public.pilot_co_detail_section_v1(o,'audit_changes',parent,ov,cv,1,100,NULL);PERFORM co_test.assert((data->>'total')::integer>601 AND jsonb_array_length(data->'rows')=100,'audit changes remain fully paginated without raw snapshots');PERFORM co_test.read_fixture('pilot_co_detail_section_v1',jsonb_build_object('p_co_id',o,'p_section','audit_changes','p_parent_id',parent,'p_expected_version',ov,'p_expected_customer_version',cv,'p_expected_draft_version',NULL,'p_page',1,'p_page_size',100),data);

 PERFORM co_test.read_fixture('pilot_co_stock_movements_v1',jsonb_build_object('p_customer_id',c,'p_stock_key_id',key,'p_as_of',NULL,'p_page',1,'p_page_size',100),public.pilot_co_stock_movements_v1(c,key,NULL,1,100));
 PERFORM co_test.read_fixture('pilot_co_customer_batches_v1',jsonb_build_object('p_customer_id',c,'p_stock_key_id',NULL,'p_expected_customer_version',cv,'p_page',7,'p_page_size',100),public.pilot_co_customer_batches_v1(c,NULL,cv,7,100),' {"total":"601"}');
 data:=public.pilot_co_customer_stock_v1(c,(m+interval '1 month' - interval '1 day')::date,'',cv,1,100);PERFORM co_test.assert(data->'summary'->>'recorded_quantity'='601','month-end effective stock');PERFORM co_test.assert(data->'summary'->>'opening_quantity'='0' AND data->'summary'->>'delivered_quantity'='1202' AND data->'summary'->>'sold_quantity'='601' AND data->'summary'->>'returned_quantity'='0','historical month equation is explicit and exact');
 PERFORM co_test.raises(format('SELECT public.pilot_co_customer_stock_v1(%L,%L,%L,NULL,1,100)',c,m+1,''),'22023','arbitrary daily history forbidden');
 PERFORM co_test.raises(format('SELECT public.pilot_co_customer_stock_v1(%L,%L,%L,NULL,1,100)',c,(m+interval '3 months' - interval '1 day')::date,''),'22023','future month end forbidden');
 PERFORM co_test.raises(format('SELECT public.pilot_co_stock_movements_v1(%L,%L,NULL,1,100)',fresh,key),'22023','foreign customer stock identity rejected');
END $reads_large$;
DO $reads_history_and_returns$
DECLARE c uuid:=co_test.monthly_customer('reads-history');m date:=(date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '2 months')::date;n date:=(m+interval '1 month')::date;o uuid;b uuid;d uuid;oldr uuid;newr uuid;v text;p jsonb;preview jsonb;data jsonb;return_draft uuid;return_head uuid;return_revision uuid;a jsonb;
BEGIN
 o:=co_test.monthly_delivery(c,'READ-HISTORY-A','SAME',10,'10.00',m);b:=co_test.monthly_delivery(c,'READ-HISTORY-B','SAME',8,'20.00',m+1);
 d:=co_test.report_init(c,m);PERFORM co_test.set_sold(d,12);PERFORM co_test.report_post(d);SELECT current_revision_id INTO oldr FROM private.co_report_heads WHERE customer_id=c AND report_month=m;
 d:=co_test.report_init(c,n);PERFORM co_test.set_sold(d,4);PERFORM co_test.report_post(d);
 d:=co_test.refresh_report(c,m);PERFORM co_test.set_sold(d,8);p:=co_test.report_correction(d);preview:=public.pilot_co_preview_v1('correct_report',p);
 FOR a IN SELECT jsonb_build_object('p_operation','correct_report','p_payload',p,'p_preview_fingerprint',preview->>'preview_fingerprint','p_report_month',x,'p_stock_key_id',NULL,'p_page',1,'p_page_size',100) FROM unnest(ARRAY[m,n])x LOOP
  data:=public.pilot_co_preview_allocations_v1('correct_report',p,preview->>'preview_fingerprint',a->>'p_report_month',NULL,1,100);PERFORM co_test.read_fixture('pilot_co_preview_allocations_v1',a,data);
 END LOOP;
 PERFORM co_test.review_post('correct_report',p);v:=(SELECT version::text FROM private.co_customer_state WHERE customer_id=c);SELECT current_revision_id INTO newr FROM private.co_report_heads WHERE customer_id=c AND report_month=m;
 a:=jsonb_build_object('p_customer_id',c,'p_month',m,'p_revision_id',oldr,'p_expected_customer_version',v,'p_page',1,'p_page_size',100);data:=public.pilot_co_report_allocations_v1(c,m::text,oldr,v,1,100);PERFORM co_test.assert(data->'summary'->>'amount'='140.00' AND data->>'is_effective'='false','old immutable allocations are140');PERFORM co_test.read_fixture('pilot_co_report_allocations_v1',a,data,'{"summary.amount":"140.00","is_effective":false}');
 PERFORM co_test.read_fixture('pilot_co_report_allocations_v1',a||jsonb_build_object('p_revision_id',newr),public.pilot_co_report_allocations_v1(c,m::text,newr,v,1,100),' {"summary.amount":"80.00","is_effective":true}');
 data:=public.pilot_co_page_v1('all','',1,1,c);PERFORM co_test.assert(data->'summary'->>'revenue'='140.00' AND data->'summary'->>'remaining_quantity'='6','all-record effective totals exclude old220 evidence and page limit');PERFORM co_test.read_fixture('pilot_co_page_v1',jsonb_build_object('p_status','all','p_search','','p_customer_id',c,'p_page',1,'p_page_size',1),data,'{"summary.revenue":"140.00","total":"2"}');
 -- A separate customer permits an actual two-CO saved return without changing settled history.
 c:=co_test.monthly_customer('reads-returns');o:=co_test.monthly_delivery(c,'READ-RETURN-A','SAME',5,'0.00',m);b:=co_test.monthly_delivery(c,'READ-RETURN-B','SAME',5,'2.00',m);v:=(SELECT version::text FROM private.co_customer_state WHERE customer_id=c);
 p:=jsonb_build_object('customer_id',c,'expected_customer_version',v,'return_date',m,'reference','Two CO return','lines',(SELECT jsonb_agg(jsonb_build_object('batch_id',id,'quantity',1)) FROM private.co_stock_batches WHERE customer_id=c));data:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_return_draft',p);return_draft:=(data->>'id')::uuid;
 a:=jsonb_build_object('p_customer_id',c,'p_target_id',return_draft,'p_view','draft','p_expected_customer_version',v,'p_expected_draft_version','1','p_page',1,'p_page_size',100);data:=public.pilot_co_return_v1(c,return_draft,'draft',v,'1',1,100);PERFORM co_test.assert(data->>'total'='2' AND (SELECT count(DISTINCT x->>'co_id')=2 FROM jsonb_array_elements(data->'rows')x),'saved return restores all participating COs');PERFORM co_test.read_fixture('pilot_co_return_v1',a,data,'{"total":"2"}');
 PERFORM co_test.read_fixture('pilot_co_detail_section_v1',jsonb_build_object('p_co_id',o,'p_section','return_drafts','p_parent_id',return_draft,'p_expected_version','2','p_expected_customer_version',v,'p_expected_draft_version',NULL,'p_page',1,'p_page_size',100),public.pilot_co_detail_section_v1(o,'return_drafts',return_draft,'2',v,1,100,NULL),' {"total":"1"}');
 data:=co_test.review_post('post_return',co_test.return_input(return_draft));return_head:=(data->>'id')::uuid;v:=data->>'customer_version';SELECT current_revision_id INTO return_revision FROM private.co_return_heads WHERE id=return_head;
 a:=a||jsonb_build_object('p_target_id',return_head,'p_view','effective','p_expected_customer_version',v,'p_expected_draft_version',NULL);PERFORM co_test.read_fixture('pilot_co_return_v1',a,public.pilot_co_return_v1(c,return_head,'effective',v,NULL,1,100),' {"total":"2"}');
 a:=a||jsonb_build_object('p_target_id',return_revision,'p_view','revision');PERFORM co_test.read_fixture('pilot_co_return_v1',a,public.pilot_co_return_v1(c,return_revision,'revision',v,NULL,1,100),' {"total":"2"}');
 PERFORM co_test.read_fixture('pilot_co_detail_section_v1',jsonb_build_object('p_co_id',o,'p_section','return_lines','p_parent_id',return_revision,'p_expected_version',(SELECT version::text FROM private.co_orders WHERE id=o),'p_expected_customer_version',v,'p_expected_draft_version',NULL,'p_page',1,'p_page_size',100),public.pilot_co_detail_section_v1(o,'return_lines',return_revision,(SELECT version::text FROM private.co_orders WHERE id=o),v,1,100,NULL),'{"total":"1"}');
 PERFORM co_test.raises(format('SELECT public.pilot_co_return_v1(%L,%L,%L,%L,NULL,1,100)',c,return_draft,'effective',v),'22023','draft cannot masquerade as return head');
 -- Explicit zero report input survives immutable revision reads without any allocation row.
 d:=co_test.report_init(c,m);PERFORM co_test.report_zero(d);PERFORM co_test.report_post(d);v:=(SELECT version::text FROM private.co_customer_state WHERE customer_id=c);SELECT current_revision_id INTO oldr FROM private.co_report_heads WHERE customer_id=c AND report_month=m;
 data:=public.pilot_co_report_rows_v1(c,m::text,'revision',NULL,v,1,100,oldr);PERFORM co_test.assert(data->>'total'='1' AND data->'rows'->0->>'sold_quantity'='0','stored explicit zero row exists independently of allocations');PERFORM co_test.read_fixture('pilot_co_report_rows_v1',jsonb_build_object('p_customer_id',c,'p_month',m,'p_view','revision','p_expected_draft_version',NULL,'p_expected_customer_version',v,'p_page',1,'p_page_size',100,'p_revision_id',oldr),data,' {"total":"1","rows.0.sold_quantity":"0"}');
END $reads_history_and_returns$;
DO $reads_proposed_sources$
DECLARE c uuid:=co_test.monthly_customer('reads-proposal');m date:=(date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '1 month')::date;o uuid;l uuid:=gen_random_uuid();d uuid;r jsonb;p jsonb;a uuid;v jsonb;data jsonb;cv text;
BEGIN
 PERFORM co_test.monthly_delivery(c,'READ-PROPOSED-OLD','S',10,'1.00',m);d:=co_test.report_init(c,m);PERFORM co_test.set_sold(d,5);PERFORM co_test.report_post(d);
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'create_co',jsonb_build_object('customer_id',c,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'co_number','READ-PROPOSED-NEW','order_date',(m-interval '1 month')::date,'lines',jsonb_build_array(jsonb_build_object('id',l,'sku','S','product_name','S','ordered_quantity',5,'unit_price','2.00'))));o:=(r->>'id')::uuid;
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',jsonb_build_object('co_id',o,'expected_co_version','1','expected_customer_version',r->>'customer_version','sj_number','READ-PROPOSED-NEW','sj_date',(m-interval '1 month')::date,'lines',jsonb_build_array(jsonb_build_object('co_line_id',l,'quantity',5))));d:=(r->>'id')::uuid;cv:=r->>'customer_version';
 p:=jsonb_build_object('draft_id',d,'expected_draft_version',r->>'version','expected_co_version','1')||co_test.review_fields(c);a:=co_test.context_report(c,(m-interval '1 month')::date,'post_sj',p);
 data:=public.pilot_co_report_rows_v1(c,((m-interval '1 month')::date)::text,'draft','1',cv,1,100,NULL);PERFORM co_test.assert(data->'rows'->0->'sold_quantity'='null'::jsonb AND data->'rows'->0->>'eligible_quantity'='5' AND data->>'source_context_fingerprint' IS NOT NULL,'proposed context has nullable stored input and provisional capacity');PERFORM co_test.read_fixture('pilot_co_report_rows_v1',jsonb_build_object('p_customer_id',c,'p_month',(m-interval '1 month')::date,'p_view','draft','p_expected_draft_version','1','p_expected_customer_version',cv,'p_page',1,'p_page_size',100,'p_revision_id',NULL),data);
 PERFORM co_test.report_zero(a);p:=p||jsonb_build_object('completed_report_drafts',jsonb_build_array(co_test.report_input(a)-'expected_customer_version'));v:=public.pilot_co_preview_v1('post_sj',p);data:=public.pilot_co_preview_allocations_v1('post_sj',p,v->>'preview_fingerprint',m::text,NULL,1,100);PERFORM co_test.assert(data->>'total'='1' AND data->'rows'->0->>'source_state'='proposed' AND data->'rows'->0->'batch_id'='null'::jsonb AND data->'rows'->0->'delivery_head_id'='null'::jsonb AND data->'rows'->0->>'sj_number'='READ-PROPOSED-NEW','candidate allocations do not invent posted identities');PERFORM co_test.read_fixture('pilot_co_preview_allocations_v1',jsonb_build_object('p_operation','post_sj','p_payload',p,'p_preview_fingerprint',v->>'preview_fingerprint','p_report_month',m,'p_stock_key_id',NULL,'p_page',1,'p_page_size',100),data);
 -- Changing the primary stored source invalidates the context but must preserve the entered zero.
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',jsonb_build_object('co_id',o,'expected_co_version','1','expected_customer_version',cv,'draft_id',d,'expected_draft_version','1','sj_number','READ-PROPOSED-NEW','sj_date',(m-interval '1 month')::date,'lines',jsonb_build_array(jsonb_build_object('co_line_id',l,'quantity',4))));cv:=(SELECT version::text FROM private.co_customer_state WHERE customer_id=c);
 data:=public.pilot_co_report_rows_v1(c,((m-interval '1 month')::date)::text,'draft','2',cv,1,100,NULL);PERFORM co_test.assert(data->>'context_issue' IS NOT NULL AND data->'rows'->0->>'sold_quantity'='0' AND data->'rows'->0->'eligible_quantity'='null'::jsonb,'stale context preserves entries and makes capacity unavailable');PERFORM co_test.read_fixture('pilot_co_report_rows_v1',jsonb_build_object('p_customer_id',c,'p_month',(m-interval '1 month')::date,'p_view','draft','p_expected_draft_version','2','p_expected_customer_version',cv,'p_page',1,'p_page_size',100,'p_revision_id',NULL),data);
END $reads_proposed_sources$;
DO $reads_removed_sj_source$
DECLARE c uuid:=co_test.monthly_customer('reads-removed-source');l uuid:=gen_random_uuid();kept uuid:=gen_random_uuid();o uuid;d uuid;r jsonb;v text;a jsonb;data jsonb;
BEGIN
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'create_co',jsonb_build_object('customer_id',c,'expected_customer_version','1','co_number','READ-REMOVED-SOURCE','order_date','2026-01-01','lines',jsonb_build_array(jsonb_build_object('id',l,'sku','REMOVED','product_name','Original','ordered_quantity',2,'unit_price','3.00'),jsonb_build_object('id',kept,'sku','KEPT','product_name','Kept','ordered_quantity',1,'unit_price','0.00'))));o:=(r->>'id')::uuid;
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',jsonb_build_object('co_id',o,'expected_co_version','1','expected_customer_version',r->>'customer_version','sj_number','READ-REMOVED-DRAFT','sj_date','2026-01-01','lines',jsonb_build_array(jsonb_build_object('co_line_id',l,'quantity',2))));d:=(r->>'id')::uuid;
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'edit_co',jsonb_build_object('co_id',o,'expected_co_version','1','expected_customer_version',r->>'customer_version','lines',jsonb_build_array(jsonb_build_object('id',kept,'ordered_quantity',1))));v:=r->>'customer_version';
 a:=jsonb_build_object('p_co_id',o,'p_section','sj_draft_lines','p_parent_id',d,'p_expected_version','2','p_expected_customer_version',v,'p_expected_draft_version','1','p_page',1,'p_page_size',100);
 data:=public.pilot_co_detail_section_v1(o,'sj_draft_lines',d,'2',v,1,100,'1');
 PERFORM co_test.assert(data->>'total'='1' AND data->'rows'->0->>'co_line_id'=l::text AND data->'rows'->0->>'quantity'='2' AND data->'rows'->0->>'source_available'='false' AND data->'rows'->0->'stock_key_id'='null'::jsonb AND data->'rows'->0->>'source_issue'='CO_SJ_SOURCE_UNAVAILABLE','removed source preserves saved SJ identity and quantity without invented match');
 PERFORM co_test.read_fixture('pilot_co_detail_section_v1',a,data,'{"total":"1","rows.0.quantity":"2","rows.0.source_available":false,"rows.0.stock_key_id":null}');
 PERFORM co_test.read_fixture('pilot_co_detail_section_v1',a||jsonb_build_object('p_section','sj_drafts','p_expected_draft_version',NULL),public.pilot_co_detail_section_v1(o,'sj_drafts',d,'2',v,1,100,NULL),'{"total":"1","rows.0.bindings_current":false}');
END $reads_removed_sj_source$;
-- Bounded customer-report freshness uses effective source chronology, not latest delivery.
DO $read_reporting_freshness$
DECLARE
 c uuid; o uuid; d uuid; b uuid; v text; data jsonb; f jsonb;
 today date:=(statement_timestamp() AT TIME ZONE 'UTC')::date;
 current_month date:=date_trunc('month',today)::date;
 old_month date:=(current_month-interval '3 months')::date;
 old_end date:=(old_month+interval '1 month -1 day')::date;
 current_end date:=(current_month+interval '1 month -1 day')::date;
BEGIN
 c:=co_test.monthly_customer('freshness-old-and-new');
 PERFORM co_test.monthly_delivery(c,'FRESH-OLD','S',5,'1.00',old_month);
 PERFORM co_test.monthly_delivery(c,'FRESH-NEW','S',2,'1.00',current_month);
 v:=(SELECT version::text FROM private.co_customer_state WHERE customer_id=c);
 data:=public.pilot_co_customer_stock_v1(c,NULL,'',v,1,100);
 f:=data->'reporting_freshness';
 PERFORM co_test.assert(coalesce(f->>'next_required_report_month'=old_month::text AND f->>'pending_report_month_count'='4' AND f->>'overdue_report_month_count'=CASE WHEN today=current_end THEN '4' ELSE '3' END AND f->>'status'='missing_completed_period',false),'freshness preserves oldest required month despite new delivery');
 PERFORM co_test.read_fixture('pilot_co_customer_stock_v1',jsonb_build_object('p_customer_id',c,'p_as_of',NULL,'p_search','','p_expected_customer_version',v,'p_page',1,'p_page_size',100),data,jsonb_build_object('reporting_freshness.next_required_report_month',old_month,'reporting_freshness.pending_report_month_count','4'));
 data:=public.pilot_co_customer_stock_v1(c,old_end,'',v,1,100);
 PERFORM co_test.read_fixture('pilot_co_customer_stock_v1',jsonb_build_object('p_customer_id',c,'p_as_of',old_end,'p_search','','p_expected_customer_version',v,'p_page',1,'p_page_size',100),data,jsonb_build_object('reporting_freshness.cutoff_date',old_end,'reporting_freshness.pending_report_month_count','1','reporting_freshness.overdue_report_month_count','1','reporting_freshness.days_since_pending_month_end','0'));

 c:=co_test.monthly_customer('freshness-settled-gap');
 o:=co_test.monthly_delivery(c,'FRESH-SETTLED','S',2,'1.00',old_month);
 d:=co_test.report_init(c,old_month); PERFORM co_test.set_sold(d,2); PERFORM co_test.report_post(d);
 data:=public.pilot_co_report_months_v1(c);
 PERFORM co_test.read_fixture('pilot_co_report_months_v1',jsonb_build_object('p_customer_id',c),data,'{"reporting_freshness.status":"complete","reporting_freshness.next_required_report_month":null,"reporting_freshness.pending_report_month_count":"0","reporting_freshness.days_since_pending_month_end":null,"reporting_freshness.zero_stock_reporting_pending":false}');
 PERFORM co_test.monthly_delivery(c,'FRESH-RESUMED','S',3,'1.00',current_month);
 data:=public.pilot_co_report_months_v1(c);
 PERFORM co_test.read_fixture('pilot_co_report_months_v1',jsonb_build_object('p_customer_id',c),data,jsonb_build_object('reporting_freshness.next_required_report_month',current_month,'reporting_freshness.pending_report_month_count','1','reporting_freshness.status',CASE WHEN today=current_end THEN 'missing_completed_period' ELSE 'current_unreported' END));

 c:=co_test.monthly_customer('freshness-current-partial');
 PERFORM co_test.monthly_delivery(c,'FRESH-CURRENT','S',2,'1.00',current_month);
 d:=co_test.report_init(c,current_month); PERFORM co_test.set_sold(d,2); PERFORM co_test.report_post(d);
 v:=(SELECT version::text FROM private.co_customer_state WHERE customer_id=c);
 data:=public.pilot_co_report_v1(c,current_month::text,v);
 PERFORM co_test.read_fixture('pilot_co_report_v1',jsonb_build_object('p_customer_id',c,'p_month',current_month,'p_expected_customer_version',v),data,jsonb_build_object('reporting_freshness.status',CASE WHEN today=current_end THEN 'complete' ELSE 'current_partial' END,'reporting_freshness.overdue_report_month_count','0','reporting_freshness.zero_stock_reporting_pending',today<>current_end));

 c:=co_test.monthly_customer('freshness-zero-needs-final-report');
 PERFORM co_test.monthly_delivery(c,'FRESH-RETURNED','S',2,'1.00',old_month);
 SELECT id INTO b FROM private.co_stock_batches WHERE customer_id=c;
 d:=co_test.return_draft(c,b,2,old_month); PERFORM co_test.review_post('post_return',co_test.return_input(d));
 data:=public.pilot_co_report_months_v1(c);
 PERFORM co_test.read_fixture('pilot_co_report_months_v1',jsonb_build_object('p_customer_id',c),data,jsonb_build_object('reporting_freshness.status','missing_completed_period','reporting_freshness.next_required_report_month',old_month,'reporting_freshness.pending_report_month_count','1','reporting_freshness.zero_stock_reporting_pending',true));
END $read_reporting_freshness$;

-- Membership is the computed report's row universe, not all customer stock keys.
DO $read_preview_key_membership$
DECLARE
 c uuid:=co_test.monthly_customer('preview-key-membership');
 m date:=(date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '2 months')::date;
 o uuid; d uuid; known uuid; absent uuid; r jsonb; p jsonb; preview jsonb; args jsonb; data jsonb;
BEGIN
 o:=co_test.monthly_delivery(c,'MEMBER-OLD','OLD',2,'1.00',m);
 PERFORM co_test.monthly_delivery(c,'MEMBER-SECOND','SECOND',1,'2.00',m);
 PERFORM co_test.monthly_delivery(c,'MEMBER-LATER','LATER',2,'1.00',(m+interval '1 month')::date);
 SELECT id INTO known FROM private.co_stock_keys WHERE customer_id=c AND normalized_sku='old';
 SELECT id INTO absent FROM private.co_stock_keys WHERE customer_id=c AND normalized_sku='later';
 d:=co_test.report_init(c,m); p:=co_test.report_input(d); preview:=public.pilot_co_preview_v1('post_report',p);
 args:=jsonb_build_object('p_operation','post_report','p_payload',p,'p_preview_fingerprint',preview->>'preview_fingerprint','p_report_month',m,'p_stock_key_id',known,'p_page',1,'p_page_size',100);
 data:=public.pilot_co_preview_allocations_v1('post_report',p,preview->>'preview_fingerprint',m::text,known,1,100);
 PERFORM co_test.read_fixture('pilot_co_preview_allocations_v1',args,data,'{"total":"0","report_complete":false,"can_post":false,"selected_row.sold_quantity":null}');
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',co_test.report_input(d)||jsonb_build_object('action','upsert_lines','lines',jsonb_build_array(jsonb_build_object('stock_key_id',known,'sold_quantity',0))));
 p:=co_test.report_input(d); preview:=public.pilot_co_preview_v1('post_report',p);
 args:=args||jsonb_build_object('p_payload',p,'p_preview_fingerprint',preview->>'preview_fingerprint');
 data:=public.pilot_co_preview_allocations_v1('post_report',p,preview->>'preview_fingerprint',m::text,known,1,100);
 PERFORM co_test.read_fixture('pilot_co_preview_allocations_v1',args,data,'{"total":"0","report_complete":false,"can_post":false,"selected_row.sold_quantity":"0"}');
 PERFORM co_test.report_zero(d); p:=co_test.report_input(d); preview:=public.pilot_co_preview_v1('post_report',p);
 args:=args||jsonb_build_object('p_payload',p,'p_preview_fingerprint',preview->>'preview_fingerprint');
 data:=public.pilot_co_preview_allocations_v1('post_report',p,preview->>'preview_fingerprint',m::text,known,1,100);
 PERFORM co_test.read_fixture('pilot_co_preview_allocations_v1',args,data,'{"total":"0","report_complete":true,"can_post":true,"selected_row.sold_quantity":"0"}');
 PERFORM co_test.raises(format('SELECT public.pilot_co_preview_allocations_v1(%L,%L,%L,%L,%L,1,100)','post_report',p,preview->>'preview_fingerprint',m,absent),'22023','same-customer key absent from computed report is not explicit zero');
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'create_co',jsonb_build_object('customer_id',c,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'co_number','MEMBER-NEVER-DELIVERED','order_date',m,'lines',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'sku','NEVER','product_name','Never','ordered_quantity',1,'unit_price','0.00'))));
 d:=co_test.refresh_report(c,m); PERFORM co_test.report_zero(d); p:=co_test.report_input(d); preview:=public.pilot_co_preview_v1('post_report',p);
 SELECT id INTO absent FROM private.co_stock_keys WHERE customer_id=c AND normalized_sku='never';
 PERFORM co_test.raises(format('SELECT public.pilot_co_preview_allocations_v1(%L,%L,%L,%L,%L,1,100)','post_report',p,preview->>'preview_fingerprint',m,absent),'22023','never-delivered persisted key absent from report is not zero');
END $read_preview_key_membership$;
-- Task 9: checked capabilities must make supported SJ workflows reachable without
-- granting ordinary edits to a closed CO. These fixtures use actual commands.
DO $read_sj_capabilities$
DECLARE
 c uuid:=co_test.monthly_customer('read-sj-capabilities');
 cancel_customer uuid:=co_test.monthly_customer('read-sj-capabilities-cancelled');
 o uuid; cancelled uuid; l uuid:=gen_random_uuid(); d uuid; report_draft uuid;
 m date:=(date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '1 month')::date;
 saved jsonb; data jsonb; args jsonb; correction jsonb;
BEGIN
 saved:=public.pilot_co_transaction_v1(gen_random_uuid(),'create_co',jsonb_build_object(
  'customer_id',c,'expected_customer_version','1','co_number','CAPABILITIES','order_date',m,
  'lines',jsonb_build_array(jsonb_build_object('id',l,'sku','CAP','product_name','Capability item','ordered_quantity',1,'unit_price','0.00'))));
 o:=(saved->>'id')::uuid;
 args:=jsonb_build_object('p_co_id',o,'p_expected_version','1');
 data:=public.pilot_co_detail_v1(o,'1');
 PERFORM co_test.assert(data->'allowed_operations' ? 'post_sj' AND NOT(data->'allowed_operations' ? 'correct_sj'),'active without history exposes ordinary Post only');
 PERFORM co_test.read_fixture('pilot_co_detail_v1',args,data,'{"co.status":"active","allowed_operations":["edit_co","save_sj_draft","post_sj","save_report_draft","cancel_co","resolve_undelivered"]}');
 saved:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',jsonb_build_object('co_id',o,'expected_co_version','1','expected_customer_version',saved->>'customer_version','sj_number','CAP-SJ','sj_date',m,'lines',jsonb_build_array(jsonb_build_object('co_line_id',l,'quantity',1))));
 d:=(saved->>'id')::uuid;
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'post_sj',jsonb_build_object('draft_id',d,'expected_draft_version',saved->>'version','expected_co_version','1','expected_customer_version',saved->>'customer_version'));
 args:=jsonb_build_object('p_co_id',o,'p_expected_version',(SELECT version::text FROM private.co_orders WHERE id=o));
 data:=public.pilot_co_detail_v1(o,args->>'p_expected_version');
 PERFORM co_test.assert(data->'allowed_operations' ?& ARRAY['post_sj','save_sj_draft','correct_sj'],'active with history exposes ordinary and reviewed SJ actions');
 PERFORM co_test.read_fixture('pilot_co_detail_v1',args,data,'{"co.status":"active","allowed_operations":["edit_co","save_sj_draft","post_sj","save_report_draft","save_return_draft","correct_sj"]}');
 report_draft:=co_test.report_init(c,m);PERFORM co_test.set_sold(report_draft,1);PERFORM co_test.report_post(report_draft);
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'close_co',co_test.order_input(o));
 args:=jsonb_build_object('p_co_id',o,'p_expected_version',(SELECT version::text FROM private.co_orders WHERE id=o));
 data:=public.pilot_co_detail_v1(o,args->>'p_expected_version');
 PERFORM co_test.assert(data->'allowed_operations'='["correct_sj"]'::jsonb,'closed with history exposes correction only, no ordinary draft/edit/Post');
 PERFORM co_test.read_fixture('pilot_co_detail_v1',args,data,'{"co.status":"closed","allowed_operations":["correct_sj"]}');
 correction:=co_test.sj_correction(o,m,1);
 PERFORM co_test.assert((SELECT payload->>'bound_delivery_head_id'=correction->>'delivery_head_id' AND payload->>'bound_delivery_revision_id'=correction->>'original_revision_id' FROM private.co_drafts WHERE id=(correction->>'draft_id')::uuid),'closed correction preparation retains original head and revision');
 saved:=public.pilot_co_transaction_v1(gen_random_uuid(),'create_co',jsonb_build_object('customer_id',cancel_customer,'expected_customer_version','1','co_number','CAP-CANCEL','order_date',m,'lines',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'sku','CANCEL','product_name','Cancelled capability item','ordered_quantity',1,'unit_price','0.00'))));
 cancelled:=(saved->>'id')::uuid;
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'cancel_co',co_test.order_input(cancelled));
 args:=jsonb_build_object('p_co_id',cancelled,'p_expected_version',(SELECT version::text FROM private.co_orders WHERE id=cancelled));
 data:=public.pilot_co_detail_v1(cancelled,args->>'p_expected_version');
 PERFORM co_test.assert(data->'allowed_operations'='[]'::jsonb,'cancelled CO exposes no SJ mutation');
 PERFORM co_test.read_fixture('pilot_co_detail_v1',args,data,'{"co.status":"cancelled","allowed_operations":[]}');
END $read_sj_capabilities$;
DO $read_authority_and_acl$
DECLARE actor uuid:=md5('co-user-1')::uuid;c uuid:=md5('monthly-customer-reads-large')::uuid;fn record;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-3')::uuid::text,true);PERFORM co_test.raises(format('SELECT public.pilot_co_customer_stock_v1(%L,NULL,%L,NULL,1,100)',c,''),'42501','PO role cannot read CO');
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-4')::uuid::text,true);PERFORM co_test.raises(format('SELECT public.pilot_co_customer_stock_v1(%L,NULL,%L,NULL,1,100)',c,''),'42501','inactive profile denied');
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-2')::uuid::text,true);UPDATE public.users SET role='po_admin' WHERE id=actor;PERFORM set_config('request.jwt.claim.sub',actor::text,true);PERFORM co_test.raises(format('SELECT public.pilot_co_customer_stock_v1(%L,NULL,%L,NULL,1,100)',c,''),'42501','live role revocation denies cached identity');PERFORM set_config('request.jwt.claim.sub',md5('co-user-2')::uuid::text,true);UPDATE public.users SET role='co_admin' WHERE id=actor;PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 FOR fn IN SELECT p.oid,p.proname,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname LIKE 'co_read_%' LOOP PERFORM co_test.assert(NOT has_function_privilege('authenticated',fn.oid,'EXECUTE') AND NOT has_function_privilege('anon',fn.oid,'EXECUTE') AND fn.proconfig @> ARRAY['search_path=""'],'private read helper ACL/path');END LOOP;
 PERFORM co_test.assert(NOT has_table_privilege('authenticated','private.co_orders','SELECT'),'no raw operational grants');
END $read_authority_and_acl$;
SET LOCAL ROLE authenticated;
SELECT public.pilot_co_page_v1('all','',1,1,md5('monthly-customer-reads-large')::uuid)->>'total';
RESET ROLE;
SELECT 'CO_READ_FIXTURE|'||jsonb_build_object('name',name,'args',args,'data',data,'expected',expected)::text FROM co_read_fixtures ORDER BY seq;
SELECT 'CO_OPERATIONAL_READS_PASSED';
ROLLBACK;
