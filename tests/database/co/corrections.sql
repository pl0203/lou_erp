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
-- Ordinary re-save must not discard a correction target while retaining its batch IDs.
DO $correction_sj_draft_cannot_become_ordinary$
DECLARE c uuid:=co_test.monthly_customer('sj-draft-mode'); o uuid; l uuid; batch uuid; p jsonb; saved jsonb; ordinary jsonb; bound jsonb; snap jsonb; evidence jsonb; receipt jsonb; request uuid:=gen_random_uuid(); h private.co_delivery_heads%ROWTYPE;
BEGIN
 o:=co_test.monthly_delivery(c,'SJ-DRAFT-MODE','S',10,'2.00',current_date);
 SELECT id INTO l FROM private.co_order_lines WHERE co_id=o; SELECT id INTO batch FROM private.co_stock_batches WHERE co_id=o;
 -- Leave enough remainder that ordinary quantity validation cannot mask the mode error.
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'edit_co',(co_test.order_input(o)-'reason')||jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('id',l,'ordered_quantity',20))));
 p:=co_test.sj_correction(o,current_date,8); SELECT to_jsonb(d) INTO saved FROM private.co_drafts d WHERE id=(p->>'draft_id')::uuid;
 SELECT * INTO h FROM private.co_delivery_heads WHERE co_id=o;
 PERFORM co_test.assert(saved->'payload'->>'bound_delivery_head_id'=h.id::text AND saved->'payload'->'candidate_batch_ids'->>(l::text)=batch::text,'correction draft retains target and original batch');
 ordinary:=(co_test.order_input(o)-'reason')||jsonb_build_object('draft_id',p->>'draft_id','expected_draft_version',p->>'expected_draft_version','sj_number','ORDINARY-RESAVE','sj_date',current_date,'lines',jsonb_build_array(jsonb_build_object('co_line_id',l,'quantity',8)));
 snap:=co_test.snapshot(c);
 SELECT jsonb_build_object('movements',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM private.co_stock_movements x WHERE customer_id=c),'allocations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM private.co_sale_allocations x WHERE customer_id=c)) INTO evidence;
 PERFORM co_test.report_code(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',request,'save_sj_draft',ordinary),'22023','Correction draft requires correction bindings');
 PERFORM co_test.assert(co_test.snapshot(c)=snap AND (SELECT to_jsonb(d)=saved FROM private.co_drafts d WHERE id=(p->>'draft_id')::uuid),'ordinary re-save rejection preserves draft, versions, pointers, audit and commands');
 PERFORM co_test.assert(evidence=jsonb_build_object('movements',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM private.co_stock_movements x WHERE customer_id=c),'allocations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM private.co_sale_allocations x WHERE customer_id=c)) AND co_test.stock(c)=10,'ordinary re-save rejection preserves effective evidence');
 PERFORM co_test.assert(NOT EXISTS(SELECT 1 FROM private.co_commands WHERE request_id=request),'rejected ordinary save leaves no receipt');
 bound:=ordinary||jsonb_build_object('delivery_head_id',h.id,'original_revision_id',h.current_revision_id,'expected_delivery_version',h.version::text,'sj_number','SJ-DRAFT-MODE','lines',jsonb_build_array(jsonb_build_object('co_line_id',l,'quantity',9)));
 receipt:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',bound);
 PERFORM co_test.assert(receipt->>'id'=p->>'draft_id' AND (receipt->>'version')::bigint=(p->>'expected_draft_version')::bigint+1 AND (SELECT payload->>'bound_delivery_head_id'=h.id::text AND payload->'candidate_batch_ids'->>(l::text)=batch::text FROM private.co_drafts WHERE id=(p->>'draft_id')::uuid),'correctly bound re-save advances only the draft and retains identities');
 p:=p||jsonb_build_object('expected_draft_version',receipt->>'version'); PERFORM co_test.review_post('correct_sj',p);
 PERFORM co_test.assert(co_test.stock(c)=9 AND (SELECT count(*)=1 AND min(id::text)=batch::text FROM private.co_stock_batches WHERE co_id=o) AND (SELECT version=2 FROM private.co_delivery_heads WHERE id=h.id) AND (SELECT count(*)=2 FROM private.co_delivery_revisions WHERE head_id=h.id),'correctly bound correction still publishes using the original batch');
END $correction_sj_draft_cannot_become_ordinary$;

DO $downstream_correction$
DECLARE c uuid:=co_test.monthly_customer('correct'); m date:=(date_trunc('month',current_date)-interval '2 months')::date; n date:=(m+interval '1 month')::date; a uuid; b uuid; d uuid; p jsonb; v jsonb; oldg uuid;
BEGIN
 a:=co_test.monthly_delivery(c,'CORRECT-A','SAME',10,'10.00',m); b:=co_test.monthly_delivery(c,'CORRECT-B','SAME',8,'20.00',m+1);
 d:=co_test.report_init(c,m); PERFORM co_test.set_sold(d,12); PERFORM co_test.report_post(d);
 d:=co_test.report_init(c,n); PERFORM co_test.set_sold(d,4); PERFORM co_test.report_post(d);
 PERFORM co_test.assert(co_test.revenue(c,m)=140 AND co_test.revenue(c,n)=80,'original 140 and80');
 SELECT effective_generation_id INTO oldg FROM private.co_customer_state WHERE customer_id=c;
 d:=co_test.refresh_report(c,m); PERFORM co_test.set_sold(d,8); p:=co_test.report_correction(d); v:=public.pilot_co_preview_v1('correct_report',p);
 PERFORM co_test.assert(v->>'can_post'='true' AND v->'counts'->>'report'='2' AND v->>'draft_version'=(SELECT version::text FROM private.co_drafts WHERE id=d),'correction previews both reports');
 PERFORM co_test.review_post('correct_report',p);
 PERFORM co_test.assert(co_test.revenue(c,m)=80 AND co_test.revenue(c,n)=60 AND co_test.stock(c)=6,'corrected80/60/B6');
 PERFORM co_test.assert((SELECT sum(amount)=220 FROM private.co_sale_allocations WHERE generation_id=oldg),'old allocation220 retained');
 PERFORM co_test.assert((SELECT count(*)=2 FROM private.co_report_heads WHERE customer_id=c) AND (SELECT count(*)=4 FROM private.co_report_revisions WHERE customer_id=c),'two events and four immutable revisions');
 PERFORM co_test.raises(format('SELECT public.pilot_co_preview_v1(%L,%L)','correct_report',p),'PT409','stale original version refused');
END $downstream_correction$;

DO $source_specific_returns_and_atomic_refusal$
DECLARE c uuid:=co_test.monthly_customer('returns'); m date:=(date_trunc('month',current_date)-interval '2 months')::date; n date:=(m+interval '1 month')::date; a uuid; b uuid; batch uuid; d uuid; rd uuid; p jsonb; snapshot jsonb; v bigint;
BEGIN
 a:=co_test.monthly_delivery(c,'RETURN-A','SAME',10,'10.00',m); b:=co_test.monthly_delivery(c,'RETURN-B','SAME',8,'20.00',m+1); SELECT id INTO batch FROM private.co_stock_batches WHERE co_id=b;
 SELECT version INTO v FROM private.co_customer_state WHERE customer_id=c;
 rd:=co_test.return_draft(c,batch,9,n+1); PERFORM co_test.assert((SELECT version=v FROM private.co_customer_state WHERE customer_id=c) AND co_test.stock(c)=18,'draft changes no effective state');
 PERFORM co_test.report_code(format('SELECT co_test.review_post(%L,%L)','post_return',co_test.return_input(rd)),'23514','CO_SOURCE_STOCK_NEGATIVE');
 rd:=co_test.return_draft(c,batch,1,m); PERFORM co_test.report_code(format('SELECT co_test.review_post(%L,%L)','post_return',co_test.return_input(rd)),'23514','CO_SOURCE_STOCK_NEGATIVE');
 d:=co_test.report_init(c,m); PERFORM co_test.set_sold(d,12); PERFORM co_test.report_post(d);
 rd:=co_test.return_draft(c,batch,2,n+1); PERFORM co_test.review_post('post_return',co_test.return_input(rd));
 d:=co_test.report_init(c,n); PERFORM co_test.set_sold(d,4); PERFORM co_test.report_post(d);
 PERFORM co_test.assert(co_test.stock(c)=0 AND co_test.revenue(c,n)=80,'unsold return zero revenue, October80 stock0');
 d:=co_test.refresh_report(c,m); PERFORM co_test.set_sold(d,17); p:=co_test.report_correction(d); snapshot:=co_test.snapshot(c);
 PERFORM co_test.report_code(format('SELECT co_test.review_post(%L,%L)','correct_report',p),'23514','CO_SOURCE_STOCK_NEGATIVE');
 PERFORM co_test.assert(co_test.snapshot(c)=snapshot,'failed return chronology rolls back every source/audit/receipt/generation/draft');
END $source_specific_returns_and_atomic_refusal$;

DO $closure_and_exact_reopening$
DECLARE c uuid:=co_test.monthly_customer('close'); m date:=(date_trunc('month',current_date)-interval '1 month')::date; o uuid; d uuid; p jsonb; v jsonb; snap jsonb;
BEGIN
 o:=co_test.monthly_delivery(c,'CLOSE-A','CLOSE',18,'10.00',m);
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'close_co',co_test.order_input(o)),'23514','positive stock blocks closure');
 d:=co_test.report_init(c,m); PERFORM co_test.set_sold(d,18); PERFORM co_test.report_post(d);
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'close_co',co_test.order_input(o));
 d:=co_test.refresh_report(c,m); PERFORM co_test.set_sold(d,14); p:=co_test.report_correction(d); v:=public.pilot_co_preview_v1('correct_report',p);
 PERFORM co_test.assert(v->'counts'->>'reopen'='1' AND v->>'can_post'='false','four units require explicit reopening');
 snap:=co_test.snapshot(c); PERFORM co_test.raises(format('SELECT co_test.review_post(%L,%L)','correct_report',p),'23514','missing acknowledgement refuses'); PERFORM co_test.assert(co_test.snapshot(c)=snap,'reopen refusal atomic');
 p:=p||jsonb_build_object('acknowledged_reopen_orders',jsonb_build_array(jsonb_build_object('co_id',o,'expected_co_version',(SELECT version::text FROM private.co_orders WHERE id=o))));
 PERFORM co_test.raises(format('SELECT co_test.review_post(%L,%L)','correct_report',p||jsonb_build_object('acknowledged_reopen_orders',(p->'acknowledged_reopen_orders')||jsonb_build_array(jsonb_build_object('co_id',gen_random_uuid(),'expected_co_version','1')))),'23514','extra acknowledgement rejected');
 PERFORM co_test.raises(format('SELECT public.pilot_co_preview_v1(%L,%L)','correct_report',p||jsonb_build_object('acknowledged_reopen_orders',(p->'acknowledged_reopen_orders')||(p->'acknowledged_reopen_orders'))),'22023','duplicate acknowledgement rejected');
 PERFORM co_test.review_post('correct_report',p);
 PERFORM co_test.assert(co_test.stock(c)=4 AND (SELECT status='active' FROM private.co_orders WHERE id=o),'acknowledged stock4 reopens atomically');
END $closure_and_exact_reopening$;

DO $delivery_shortage_and_context_bundle$
DECLARE c uuid:=co_test.monthly_customer('sj-change'); m date:=(date_trunc('month',current_date)-interval '2 months')::date; o uuid; d uuid; p jsonb; snap jsonb; v jsonb; a uuid; b uuid; av bigint;
BEGIN
 o:=co_test.monthly_delivery(c,'SJ-CHANGE-A','S',10,'10.00',m); PERFORM co_test.monthly_delivery(c,'SJ-CHANGE-B','S',8,'20.00',m+1);
 d:=co_test.report_init(c,m); PERFORM co_test.set_sold(d,12); PERFORM co_test.report_post(d); d:=co_test.report_init(c,(m+interval '1 month')::date); PERFORM co_test.set_sold(d,4); PERFORM co_test.report_post(d);
 p:=co_test.sj_correction(o,m,6); snap:=co_test.snapshot(c); PERFORM co_test.report_code(format('SELECT co_test.review_post(%L,%L)','correct_sj',p),'23514','CO_SOLD_EXCEEDS_ELIGIBLE'); PERFORM co_test.assert(snap=co_test.snapshot(c),'A10 to6 rolls back all evidence');
 p:=co_test.sj_correction(o,(m-interval '2 months')::date,10); v:=public.pilot_co_preview_v1('correct_sj',p); PERFORM co_test.assert(v->'counts'->>'missing_month'='2','new first stock introduces two missing months');
 a:=co_test.context_report(c,(m-interval '2 months')::date,'correct_sj',p); b:=co_test.context_report(c,(m-interval '1 month')::date,'correct_sj',p);
 PERFORM co_test.assert((SELECT count(*)=1 AND count(sold_quantity)=0 FROM private.co_report_draft_lines WHERE draft_id=a),'new earlier SKU is explicit null');
 SELECT version INTO av FROM private.co_customer_state WHERE customer_id=c;
 PERFORM co_test.report_zero(a); PERFORM co_test.report_zero(b);
 PERFORM co_test.assert((SELECT version=av FROM private.co_customer_state WHERE customer_id=c),'independent missing drafts do not stale each other');
 PERFORM co_test.report_code(format('SELECT co_test.report_post(%L)',a),'23514','CO_REVIEWED_CORRECTION_REQUIRED');
 p:=p||jsonb_build_object('completed_report_drafts',jsonb_build_array(co_test.report_input(a)-'expected_customer_version',co_test.report_input(b)-'expected_customer_version'));
 PERFORM co_test.review_post('correct_sj',p);
 PERFORM co_test.assert((SELECT count(*)=4 FROM private.co_report_heads WHERE customer_id=c),'two explicit missing heads added');
 PERFORM co_test.assert(co_test.revenue(c,m)=140 AND co_test.revenue(c,(m+interval '1 month')::date)=80 AND co_test.stock(c)=2,'bundle mapping preserves both zero months and downstream sales');
END $delivery_shortage_and_context_bundle$;

DO $return_revision_and_void$
DECLARE c uuid:=co_test.monthly_customer('return-revise'); m date:=(date_trunc('month',current_date)-interval '1 month')::date; o uuid; b uuid; d uuid; receipt jsonb; p jsonb; original uuid;
BEGIN
 o:=co_test.monthly_delivery(c,'RETURN-REVISE','S',10,'10.00',m); SELECT id INTO b FROM private.co_stock_batches WHERE co_id=o; d:=co_test.return_draft(c,b,2,m+1); receipt:=co_test.review_post('post_return',co_test.return_input(d)); SELECT current_revision_id INTO original FROM private.co_return_heads WHERE id=(receipt->>'id')::uuid;
 p:=co_test.review_fields(c)||jsonb_build_object('return_head_id',receipt->>'id','original_revision_id',original,'expected_return_version','1','action','replace','return_date',m+1,'reference','Correction','lines',jsonb_build_array(jsonb_build_object('batch_id',b,'quantity',1)));
 PERFORM co_test.review_post('correct_return',p); PERFORM co_test.assert(co_test.stock(c)=9,'return replacement consumes one');
 p:=co_test.review_fields(c)||jsonb_build_object('return_head_id',receipt->>'id','original_revision_id',original,'expected_return_version','2','action','void');
 PERFORM co_test.raises(format('SELECT public.pilot_co_preview_v1(%L,%L)','correct_return',p),'PT409','current version cannot disguise stale original revision');
 p:=p||jsonb_build_object('original_revision_id',(SELECT current_revision_id FROM private.co_return_heads WHERE id=(receipt->>'id')::uuid)); PERFORM co_test.review_post('correct_return',p);
 PERFORM co_test.assert(co_test.stock(c)=10 AND (SELECT count(*)=3 FROM private.co_return_revisions WHERE customer_id=c),'void retains originals and restores unsold source capacity');
END $return_revision_and_void$;

DO $each_closure_blocker_and_resolution$
DECLARE c uuid:=co_test.monthly_customer('resolve'); m date:=(date_trunc('month',current_date)-interval '1 month')::date; o uuid; b uuid; d uuid; p jsonb; l uuid; current_c uuid; current_o uuid;
BEGIN
 o:=co_test.monthly_delivery(c,'RESOLVE-A','S',2,'1.00',m); SELECT id INTO l FROM private.co_order_lines WHERE co_id=o;
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'edit_co',(co_test.order_input(o)-'reason')||jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('id',l,'ordered_quantity',10))));
 SELECT id INTO b FROM private.co_stock_batches WHERE co_id=o; d:=co_test.return_draft(c,b,2,m+1); PERFORM co_test.review_post('post_return',co_test.return_input(d));
 PERFORM co_test.report_code(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'close_co',co_test.order_input(o)),'23514','CO_CLOSE_UNDELIVERED_REMAINS');
 p:=co_test.order_input(o)||jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('co_line_id',l,'quantity',8)));
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'resolve_undelivered',p||'{"reason":" "}'::jsonb),'22023','resolution requires reason');
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'resolve_undelivered',p);
 PERFORM co_test.assert(co_test.stock(c)=0 AND (SELECT resolved_undelivered_quantity=8 FROM private.co_order_lines WHERE id=l),'resolution never fabricates delivery');
 PERFORM co_test.report_code(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'close_co',co_test.order_input(o)),'23514','CO_CLOSE_REPORT_INCOMPLETE');
 d:=co_test.report_init(c,m); PERFORM co_test.report_zero(d); PERFORM co_test.report_post(d); PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'close_co',co_test.order_input(o));
 PERFORM co_test.assert((SELECT reason='Explicit closure' AND before_state->'lines'->0->>'resolved_undelivered_quantity'='0' AND after_state->'lines'->0->>'resolved_undelivered_quantity'='8' FROM private.co_audit_events WHERE customer_id=c AND operation='resolve_undelivered'),'resolution reason and quantity retained');
 current_c:=co_test.monthly_customer('partial-close'); current_o:=co_test.monthly_delivery(current_c,'PARTIAL-CLOSE','S',2,'1.00',date_trunc('month',current_date)::date); d:=co_test.report_init(current_c,date_trunc('month',current_date)::date); PERFORM co_test.set_sold(d,2); PERFORM co_test.report_post(d);
 IF current_date<>(date_trunc('month',current_date)+interval '1 month -1 day')::date THEN PERFORM co_test.report_code(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'close_co',co_test.order_input(current_o)),'23514','CO_CLOSE_REPORT_INCOMPLETE'); END IF;
END $each_closure_blocker_and_resolution$;

DO $new_sku_in_already_posted_months_requires_explicit_rows$
DECLARE c uuid:=co_test.monthly_customer('new-sku-history'); m date:=(date_trunc('month',current_date)-interval '2 months')::date; o uuid; original_batch uuid; oldline uuid; newline uuid:=gen_random_uuid(); d uuid; e uuid; sd jsonb; p jsonb; v jsonb; h private.co_delivery_heads%ROWTYPE; refs jsonb; saved_batch uuid;
BEGIN
 o:=co_test.monthly_delivery(c,'NEW-SKU-HISTORY','OLD',10,'1.00',m); SELECT id INTO original_batch FROM private.co_stock_batches WHERE co_id=o; SELECT id INTO oldline FROM private.co_order_lines WHERE co_id=o;
 d:=co_test.report_init(c,m); PERFORM co_test.set_sold(d,3); PERFORM co_test.report_post(d); e:=co_test.report_init(c,(m+interval '1 month')::date); PERFORM co_test.set_sold(e,3); PERFORM co_test.report_post(e);
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'edit_co',(co_test.order_input(o)-'reason')||jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('id',oldline,'ordered_quantity',10),jsonb_build_object('id',newline,'sku','NEW','product_name','New','ordered_quantity',5,'unit_price','9.00'))));
 SELECT * INTO h FROM private.co_delivery_heads WHERE co_id=o;
 sd:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',(co_test.order_input(o)-'reason')||jsonb_build_object('delivery_head_id',h.id,'original_revision_id',h.current_revision_id,'expected_delivery_version',h.version::text,'sj_number','SJ-NEW-SKU-HISTORY','sj_date',m,'lines',jsonb_build_array(jsonb_build_object('co_line_id',oldline,'quantity',10),jsonb_build_object('co_line_id',newline,'quantity',5))));
 SELECT (payload->'candidate_batch_ids'->>(newline::text))::uuid INTO saved_batch FROM private.co_drafts WHERE id=(sd->>'id')::uuid;
 p:=co_test.review_fields(c)||jsonb_build_object('delivery_head_id',h.id,'original_revision_id',h.current_revision_id,'expected_delivery_version',h.version::text,'expected_co_version',(SELECT version::text FROM private.co_orders WHERE id=o),'action','replace','draft_id',sd->>'id','expected_draft_version',sd->>'version');
 v:=public.pilot_co_preview_v1('correct_sj',p); PERFORM co_test.assert(v->>'can_post'='false' AND v->'counts'->>'issue'='2','new SKU unreported in both complete months blocks');
 d:=co_test.context_report(c,m,'correct_sj',p); e:=co_test.context_report(c,(m+interval '1 month')::date,'correct_sj',p);
 PERFORM co_test.assert((SELECT count(*)=2 AND count(sold_quantity)=1 AND sum(sold_quantity)=3 FROM private.co_report_draft_lines WHERE draft_id=d),'refresh retains attested3 and adds null new SKU');
 PERFORM co_test.report_zero(d); PERFORM co_test.report_zero(e);
 SELECT jsonb_agg((co_test.report_input(x.id)-'expected_customer_version')||jsonb_build_object('original_revision_id',rh.current_revision_id,'expected_report_version',rh.version::text) ORDER BY x.report_month) INTO refs FROM private.co_drafts x JOIN private.co_report_heads rh ON rh.customer_id=x.customer_id AND rh.report_month=x.report_month WHERE x.id IN(d,e);
 p:=p||jsonb_build_object('completed_report_drafts',refs); PERFORM co_test.review_post('correct_sj',p);
 PERFORM co_test.assert(co_test.stock(c)=9 AND co_test.revenue(c,m)=3 AND co_test.revenue(c,(m+interval '1 month')::date)=3,'explicit new zeros preserve old attested sales and add5 stock');
 PERFORM co_test.assert((SELECT count(*)=2 FROM private.co_stock_batches WHERE co_id=o) AND EXISTS(SELECT 1 FROM private.co_stock_batches WHERE id=original_batch) AND EXISTS(SELECT 1 FROM private.co_stock_batches WHERE id=saved_batch AND co_line_id=newline),'old identity and prepared new batch both preserved');
END $new_sku_in_already_posted_months_requires_explicit_rows$;

DO $reviewed_new_backdated_sj_is_not_permanently_blocked$
DECLARE c uuid:=co_test.monthly_customer('new-backdated'); m date:=(date_trunc('month',current_date)-interval '1 month')::date; o uuid; l uuid:=gen_random_uuid(); d uuid; r jsonb; p jsonb; a uuid; snapshot jsonb; expected_batch uuid; v jsonb;
BEGIN
 PERFORM co_test.monthly_delivery(c,'BACKDATED-OLD','S',10,'1.00',m); d:=co_test.report_init(c,m); PERFORM co_test.set_sold(d,5); PERFORM co_test.report_post(d);
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'create_co',jsonb_build_object('customer_id',c,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'co_number','BACKDATED-NEW','order_date',(m-interval '1 month')::date,'lines',jsonb_build_array(jsonb_build_object('id',l,'sku','S','product_name','S','ordered_quantity',5,'unit_price','2.00')))); o:=(r->>'id')::uuid;
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',jsonb_build_object('co_id',o,'expected_co_version','1','expected_customer_version',r->>'customer_version','sj_number','BACKDATED-NEW','sj_date',(m-interval '1 month')::date,'lines',jsonb_build_array(jsonb_build_object('co_line_id',l,'quantity',5)))); d:=(r->>'id')::uuid;
 SELECT (payload->'candidate_batch_ids'->>(l::text))::uuid INTO expected_batch FROM private.co_drafts WHERE id=d;
 p:=jsonb_build_object('draft_id',d,'expected_draft_version',r->>'version','expected_co_version','1','expected_customer_version',r->>'customer_version'); snapshot:=co_test.snapshot(c);
 PERFORM co_test.report_code(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'post_sj',p),'23514','CO_REVIEWED_CORRECTION_REQUIRED'); PERFORM co_test.assert(snapshot=co_test.snapshot(c),'ordinary backdated delivery rolls back');
 p:=p||co_test.review_fields(c); v:=public.pilot_co_preview_v1('post_sj',p); PERFORM co_test.assert(v->'counts'->>'missing_month'='1','reviewed new SJ exposes earlier month');
 a:=co_test.context_report(c,(m-interval '1 month')::date,'post_sj',p); PERFORM co_test.report_zero(a); p:=p||jsonb_build_object('completed_report_drafts',jsonb_build_array(co_test.report_input(a)-'expected_customer_version'));
 PERFORM co_test.review_post('post_sj',p);
 PERFORM co_test.assert(co_test.stock(c)=10 AND co_test.revenue(c,m)=10 AND EXISTS(SELECT 1 FROM private.co_stock_batches WHERE id=expected_batch),'reviewed backdated new SJ commits exact reserved batch and downstream revision');
END $reviewed_new_backdated_sj_is_not_permanently_blocked$;

DO $corrections_refuse_preexisting_effective_drift$
DECLARE c uuid:=co_test.monthly_customer('correction-drift'); m date:=(date_trunc('month',current_date)-interval '1 month')::date; d uuid; g uuid; oldg uuid; p jsonb; snapshot jsonb;
BEGIN
 PERFORM co_test.monthly_delivery(c,'CORRECTION-DRIFT','S',2,'1.00',m); d:=co_test.report_init(c,m); PERFORM co_test.set_sold(d,1); PERFORM co_test.report_post(d); SELECT effective_generation_id INTO oldg FROM private.co_customer_state WHERE customer_id=c;
 INSERT INTO private.co_replay_generations(customer_id,version,algorithm_version,created_by) SELECT c,version+1,'fixture-drift',auth.uid() FROM private.co_customer_state WHERE customer_id=c RETURNING id INTO g;
 INSERT INTO private.co_stock_movements(generation_id,customer_id,batch_id,stock_key_id,kind,quantity_delta,effective_date,delivery_revision_line_id) SELECT g,c,batch_id,stock_key_id,kind,quantity_delta,effective_date,delivery_revision_line_id FROM private.co_stock_movements WHERE generation_id=oldg AND kind='delivery';
 UPDATE private.co_customer_state SET version=version+1,effective_generation_id=g WHERE customer_id=c; d:=co_test.refresh_report(c,m); p:=co_test.report_correction(d); snapshot:=co_test.snapshot(c);
 PERFORM co_test.report_code(format('SELECT public.pilot_co_preview_v1(%L,%L)','correct_report',p),'23514','CO_EFFECTIVE_EVIDENCE_MISMATCH'); PERFORM co_test.assert(snapshot=co_test.snapshot(c),'unrelated correction cannot silently repair actual effective evidence');
END $corrections_refuse_preexisting_effective_drift$;

DO $reopen_zero_stock_when_undelivered_remainder_returns$
DECLARE c uuid:=co_test.monthly_customer('reopen-pending'); m date:=(date_trunc('month',current_date)-interval '1 month')::date; o uuid; d uuid; p jsonb; refs jsonb; preview jsonb; impact jsonb;
BEGIN
 o:=co_test.monthly_delivery(c,'REOPEN-PENDING','S',10,'1.00',m); d:=co_test.report_init(c,m); PERFORM co_test.set_sold(d,10); PERFORM co_test.report_post(d); PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'close_co',co_test.order_input(o));
 p:=co_test.sj_correction(o,m,8); d:=co_test.context_report(c,m,'correct_sj',p); PERFORM co_test.set_sold(d,8);
 SELECT (co_test.report_input(d)-'expected_customer_version')||jsonb_build_object('original_revision_id',current_revision_id,'expected_report_version',version::text) INTO refs FROM private.co_report_heads WHERE customer_id=c AND report_month=m;
 p:=p||jsonb_build_object('completed_report_drafts',jsonb_build_array(refs)); preview:=public.pilot_co_preview_v1('correct_sj',p); impact:=public.pilot_co_preview_impacts_v1('correct_sj',p,preview->>'preview_fingerprint','reopen',1,100);
 PERFORM co_test.assert(preview->>'can_post'='false' AND impact->'rows'->0->>'remaining_quantity'='0' AND impact->'rows'->0->>'pending_quantity'='2','zero stock still previews renewed pending remainder');
 p:=p||jsonb_build_object('acknowledged_reopen_orders',jsonb_build_array(jsonb_build_object('co_id',o,'expected_co_version',(SELECT version::text FROM private.co_orders WHERE id=o)))); PERFORM co_test.review_post('correct_sj',p);
 PERFORM co_test.assert((SELECT status='active' FROM private.co_orders WHERE id=o) AND co_test.stock(c)=0 AND (SELECT resolved_undelivered_quantity=0 FROM private.co_order_lines WHERE co_id=o),'reopening preserves unresolved quantity instead of inventing resolution');
END $reopen_zero_stock_when_undelivered_remainder_returns$;

DO $corrections_refuse_effective_stock_evidence_drift$
DECLARE c uuid:=co_test.monthly_customer('stock-drift'); m date:=(date_trunc('month',current_date)-interval '1 month')::date; o uuid; g uuid; p jsonb;
BEGIN
 o:=co_test.monthly_delivery(c,'STOCK-DRIFT','S',3,'1.00',m);
 INSERT INTO private.co_replay_generations(customer_id,version,algorithm_version,created_by) SELECT c,version+1,'fixture-missing-movement',auth.uid() FROM private.co_customer_state WHERE customer_id=c RETURNING id INTO g;
 UPDATE private.co_customer_state SET version=version+1,effective_generation_id=g WHERE customer_id=c;
 p:=co_test.sj_correction(o,m,3);
 PERFORM co_test.report_code(format('SELECT public.pilot_co_preview_v1(%L,%L)','correct_sj',p),'23514','CO_EFFECTIVE_EVIDENCE_MISMATCH');
END $corrections_refuse_effective_stock_evidence_drift$;

DO $correction_security_and_strict_inputs$
DECLARE c uuid:=co_test.monthly_customer('correction-security'); m date:=(date_trunc('month',current_date)-interval '1 month')::date; o uuid; b uuid; d uuid; p jsonb; preview jsonb; request uuid:=gen_random_uuid(); r jsonb; snapshot jsonb; fn record;
BEGIN
 o:=co_test.monthly_delivery(c,'CORRECTION-SECURITY','S',3,'1.00',m); SELECT id INTO b FROM private.co_stock_batches WHERE co_id=o;
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'save_return_draft',jsonb_build_object('customer_id',c,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'return_date',m,'reference','R','lines',jsonb_build_array(jsonb_build_object('batch_id',b,'quantity',0)))),'22023','return zero rejected');
 d:=co_test.return_draft(c,b,1,m); p:=co_test.return_input(d); preview:=public.pilot_co_preview_v1('post_return',p);
 PERFORM co_test.assert(preview->>'version'='1' AND preview->>'preview_fingerprint'=public.pilot_co_preview_v1('post_return',p)->>'preview_fingerprint','pure reviewed preview deterministic');
 PERFORM co_test.raises(format('SELECT public.pilot_co_preview_v1(%L,%L)','post_return',p||'{"unit_price":"1.00"}'::jsonb),'22023','forged price rejected');
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'post_return',p||'{"preview_fingerprint":"wrong"}'::jsonb),'PT409','stale reviewed token rejected');
 r:=public.pilot_co_transaction_v1(request,'post_return',p||jsonb_build_object('preview_fingerprint',preview->>'preview_fingerprint'));
 PERFORM co_test.assert(r=public.pilot_co_transaction_v1(request,'post_return',p||jsonb_build_object('preview_fingerprint',preview->>'preview_fingerprint')),'exact return receipt remains stable');
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-3')::uuid::text,true); PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',request,'post_return',p||jsonb_build_object('preview_fingerprint',preview->>'preview_fingerprint')),'42501','current role gates retries'); PERFORM set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true);
 p:=co_test.sj_correction(o,m,3);
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-3')::uuid::text,true);
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'post_sj',jsonb_build_object('draft_id',p->'draft_id','expected_draft_version',p->'expected_draft_version','expected_co_version',p->'expected_co_version','expected_customer_version',p->'expected_customer_version')),'42501','authority precedes correction-draft dispatch inspection');
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true);
 FOR fn IN SELECT z.oid,z.proname,z.proconfig FROM pg_proc z JOIN pg_namespace n ON n.oid=z.pronamespace WHERE n.nspname='private' AND z.proname LIKE 'co_%' LOOP
 PERFORM co_test.assert(fn.proconfig=ARRAY['search_path=""'] AND NOT has_function_privilege('authenticated',fn.oid,'EXECUTE') AND NOT has_function_privilege('anon',fn.oid,'EXECUTE'),fn.proname||' private/path'); END LOOP;
 PERFORM co_test.assert(NOT has_table_privilege('authenticated','private.co_commands','SELECT') AND (SELECT prosecdef AND proowner='postgres'::regrole FROM pg_proc WHERE oid='private.co_command_finished_v1()'::regprocedure),'deferred command invariant uses owner without API table grants');
END $correction_security_and_strict_inputs$;

SELECT 'CO_TRIGGER_SECURITY '||jsonb_build_object('owner',pg_get_userbyid(proowner),'security_definer',prosecdef,'config',proconfig,'authenticated_execute',has_function_privilege('authenticated',oid,'EXECUTE'))::text FROM pg_proc WHERE oid='private.co_command_finished_v1()'::regprocedure;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
SELECT 'CO_RETURNS_CORRECTIONS_PASSED';
