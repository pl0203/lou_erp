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

DO $co_fifo_orders_by_sj_then_original_creation_then_batch_id$
DECLARE c uuid:=co_test.monthly_customer('fifo'); m date:=(date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '1 month')::date;
 a uuid; b uuid; d uuid; k uuid; v bigint; p jsonb; preview jsonb; r jsonb; g uuid;
BEGIN
 a:=co_test.monthly_delivery(c,'MONTHLY-A','SAME',60,'10000.00',m+1);
 b:=co_test.monthly_delivery(c,'MONTHLY-B','SAME',40,'12000.00',m+2);
 SELECT version INTO v FROM private.co_customer_state WHERE customer_id=c;
 d:=co_test.report_init(c,m); SELECT stock_key_id INTO k FROM private.co_report_draft_lines WHERE draft_id=d;
 PERFORM co_test.assert((SELECT version=v FROM private.co_customer_state WHERE customer_id=c),'draft initialization has no customer-state effect');
 PERFORM co_test.assert((SELECT sold_quantity IS NULL FROM private.co_report_draft_lines WHERE draft_id=d),'blank is not zero');
 preview:=public.pilot_co_preview_v1('post_report',co_test.report_input(d));
 PERFORM co_test.assert(preview->>'can_post'='false' AND preview->'counts'->>'issue'='1','null blocks complete statement');
 p:=co_test.report_input(d)||jsonb_build_object('action','upsert_lines','lines',jsonb_build_array(jsonb_build_object('stock_key_id',k,'sold_quantity',70)));
 r:=public.pilot_co_transaction_v1(md5('monthly-chunk')::uuid,'save_report_draft',p);
 PERFORM co_test.assert(r->>'id'=d::text AND r->>'version'='2' AND r->>'customer_version'=v::text,'draft receipt identity/version');
 PERFORM co_test.assert(public.pilot_co_transaction_v1(md5('monthly-chunk')::uuid,'save_report_draft',p)=r,'exact stale chunk retry returns receipt');
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'save_report_draft',p),'PT409','new stale chunk request conflicts');
 p:=co_test.report_input(d); preview:=public.pilot_co_preview_v1('post_report',p);
 PERFORM co_test.assert(preview->>'can_post'='true' AND preview->'after'->>'revenue'='720000.00' AND preview->'after'->>'remaining_quantity'='30','mixed-price FIFO preview');
 PERFORM co_test.assert(public.pilot_co_preview_v1('post_report',p)->>'preview_fingerprint'=preview->>'preview_fingerprint','semantic fingerprint deterministic');
 PERFORM co_test.assert(NOT preview ?| ARRAY['allocations','rows','issues','impacts'],'preview header bounded');
 r:=public.pilot_co_preview_impacts_v1('post_report',p,preview->>'preview_fingerprint','report',1,100);
 PERFORM co_test.assert(r->'rows'->0->>'before_sold_quantity'='0' AND r->'rows'->0->>'after_sold_quantity'='70' AND r->'rows'->0->>'after_revenue'='720000.00','report impact exposes exact period before/after totals');
 r:=public.pilot_co_transaction_v1(md5('monthly-post')::uuid,'post_report',p||jsonb_build_object('preview_fingerprint',preview->>'preview_fingerprint'));
 PERFORM co_test.assert(r->>'version'='1' AND r->>'customer_version'=(v+1)::text AND EXISTS(SELECT 1 FROM private.co_report_heads WHERE id=(r->>'id')::uuid),'post receipt is report head');
 SELECT effective_generation_id INTO g FROM private.co_customer_state WHERE customer_id=c;
 PERFORM co_test.assert((SELECT sum(x.quantity)=60 FROM private.co_sale_allocations x JOIN private.co_stock_batches s ON s.id=x.batch_id WHERE x.generation_id=g AND s.co_id=a),'oldest A60');
 PERFORM co_test.assert((SELECT sum(x.quantity)=10 FROM private.co_sale_allocations x JOIN private.co_stock_batches s ON s.id=x.batch_id WHERE x.generation_id=g AND s.co_id=b),'next B10');
 PERFORM co_test.assert((SELECT sum(amount)=720000 FROM private.co_sale_allocations WHERE generation_id=g),'exact posted revenue');
 PERFORM co_test.assert((SELECT sum(x.quantity_delta)=30 FROM private.co_stock_movements x JOIN private.co_stock_batches s ON s.id=x.batch_id WHERE x.generation_id=g AND s.co_id=b),'B remaining30');
 PERFORM co_test.assert(public.pilot_co_transaction_v1(md5('monthly-post')::uuid,'post_report',p||jsonb_build_object('preview_fingerprint',preview->>'preview_fingerprint'))=r,'post exact retry');
 -- A normal later delivery must retain sold evidence in its complete generation.
 PERFORM co_test.monthly_delivery(c,'MONTHLY-C','SAME',5,'999.00',(date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC'))::date);
 SELECT effective_generation_id INTO g FROM private.co_customer_state WHERE customer_id=c;
 PERFORM co_test.assert((SELECT sum(amount)=720000 FROM private.co_sale_allocations WHERE generation_id=g),'later delivery preserves settled revenue');
 PERFORM co_test.assert((SELECT sum(quantity_delta)=35 FROM private.co_stock_movements WHERE generation_id=g),'later delivery never resurrects sales');
END $co_fifo_orders_by_sj_then_original_creation_then_batch_id$;

DO $co_statement_601_skus_posts_every_stored_row$
DECLARE c uuid:=co_test.monthly_customer('large'); m date:=(date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '1 month')::date;
 lines jsonb; o uuid; sj uuid; d uuid; r jsonb; p jsonb; preview jsonb; g uuid; page jsonb; n integer:=0; i integer;
BEGIN
 SELECT jsonb_agg(jsonb_build_object('id',md5('monthly-large-line-'||x)::uuid,'sku','LARGE-'||x,'product_name','Large '||x,'ordered_quantity',2,'unit_price','1.01') ORDER BY x DESC) INTO lines FROM generate_series(1,601)x;
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'create_co',jsonb_build_object('customer_id',c,'expected_customer_version','1','co_number','MONTHLY-LARGE','order_date',m,'lines',lines)); o:=(r->>'id')::uuid;
 SELECT jsonb_agg(jsonb_build_object('co_line_id',id,'quantity',2) ORDER BY id DESC) INTO lines FROM private.co_order_lines WHERE co_id=o;
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',jsonb_build_object('co_id',o,'expected_co_version','1','expected_customer_version',r->>'customer_version','sj_number','SJ-LARGE','sj_date',m,'lines',lines)); sj:=(r->>'id')::uuid;
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'post_sj',jsonb_build_object('draft_id',sj,'expected_draft_version','1','expected_co_version','1','expected_customer_version',r->>'customer_version'));
 d:=co_test.report_init(c,m);
 PERFORM co_test.assert((SELECT count(*)=601 AND count(sold_quantity)=0 FROM private.co_report_draft_lines WHERE draft_id=d),'all601 server rows start null');
 p:=co_test.report_input(d); preview:=public.pilot_co_preview_v1('post_report',p);
 PERFORM co_test.assert(preview->'counts'->>'issue'='601','all601 missing rows counted, not loaded page');
 page:=public.pilot_co_preview_impacts_v1('post_report',p,preview->>'preview_fingerprint','issue',7,100);
 PERFORM co_test.assert(page->>'total'='601' AND jsonb_array_length(page->'rows')=1,'missing row601 remains visible through issue paging');
 SELECT jsonb_agg(jsonb_build_object('stock_key_id',stock_key_id,'sold_quantity',0)) INTO lines FROM private.co_report_draft_lines WHERE draft_id=d;
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'save_report_draft',p||jsonb_build_object('action','upsert_lines','lines',lines)),'22023','transport chunk over500 rejected without statement cap');
 FOR i IN 0..1 LOOP
  IF i=1 THEN
   PERFORM co_test.report_zero(d);
   PERFORM co_test.assert((SELECT count(*) FILTER(WHERE sold_quantity=1)=500 AND count(*) FILTER(WHERE sold_quantity=0)=101 FROM private.co_report_draft_lines WHERE draft_id=d),'bulk zero preserves loaded500 and fills unloaded101');
  END IF;
  SELECT jsonb_agg(jsonb_build_object('stock_key_id',stock_key_id,'sold_quantity',1) ORDER BY stock_key_id DESC) INTO lines FROM (SELECT stock_key_id FROM private.co_report_draft_lines WHERE draft_id=d ORDER BY stock_key_id LIMIT 500 OFFSET i*500)x;
  PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',co_test.report_input(d)||jsonb_build_object('action','upsert_lines','lines',lines));
 END LOOP;
 p:=co_test.report_input(d); preview:=public.pilot_co_preview_v1('post_report',p);
 PERFORM co_test.assert(preview->'after'->>'sold_quantity'='601' AND preview->'after'->>'revenue'='607.01','complete601 totals beyond write transport');
 FOR i IN 1..7 LOOP
  page:=public.pilot_co_preview_impacts_v1('post_report',p,preview->>'preview_fingerprint','stock',i,100);
  PERFORM co_test.assert(page->>'total'='601','exact paged total'); n:=n+jsonb_array_length(page->'rows');
 END LOOP;
 PERFORM co_test.assert(n=601,'paged stock impacts beyond500 complete');
 PERFORM co_test.report_post(d); SELECT effective_generation_id INTO g FROM private.co_customer_state WHERE customer_id=c;
 PERFORM co_test.assert((SELECT count(*)=601 FROM private.co_report_revision_lines WHERE customer_id=c),'all601 rows published');
 PERFORM co_test.assert((SELECT count(*)=601 AND sum(amount)=607.01 FROM private.co_sale_allocations WHERE generation_id=g),'all601 allocations published');
END $co_statement_601_skus_posts_every_stored_row$;

DO $co_draft_freshness_metadata_and_multiple_months$
DECLARE c uuid:=co_test.monthly_customer('drafts'); m date:=(date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '2 months')::date;
 d uuid; later uuid; key uuid; other uuid; p jsonb; old_p jsonb; preview jsonb; r jsonb; v bigint; g uuid; head uuid; old_revision uuid; context jsonb; bad jsonb;
BEGIN
 PERFORM co_test.monthly_delivery(c,'DRAFTS-A','A',100,'2.00',m);
 SELECT version,effective_generation_id INTO v,g FROM private.co_customer_state WHERE customer_id=c;
 d:=co_test.report_init(c,m); later:=co_test.report_init(c,(m+interval '1 month')::date);
 SELECT stock_key_id INTO key FROM private.co_report_draft_lines WHERE draft_id=d;
 p:=co_test.report_input(d)||jsonb_build_object('action','upsert_lines','lines',jsonb_build_array(jsonb_build_object('stock_key_id',key,'sold_quantity',70)));
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',p);
 PERFORM co_test.report_zero(later);
 PERFORM co_test.assert((SELECT version=v AND effective_generation_id=g FROM private.co_customer_state WHERE customer_id=c),'multiple completed drafts leave customer state unchanged');
 PERFORM co_test.assert(public.pilot_co_preview_v1('post_report',co_test.report_input(later))->>'can_post'='false','later draft cannot invent missing previous report');
 p:=co_test.report_input(d); preview:=public.pilot_co_preview_v1('post_report',p);
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',(p-'eligible_set_fingerprint')||jsonb_build_object('action','set_metadata','report_reference','Monthly receipt','notes','Original','received_date',(clock_timestamp() AT TIME ZONE 'UTC')::date+1));
 old_p:=p;
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'post_report',p||jsonb_build_object('preview_fingerprint',preview->>'preview_fingerprint')),'PT409','metadata save invalidates old preview version');
 preview:=public.pilot_co_preview_v1('post_report',co_test.report_input(d));
 PERFORM co_test.assert(preview->>'can_post'='false','future receipt retained but blocks posting');
 PERFORM co_test.report_code(format('SELECT co_test.report_post(%L)',d),'23514','CO_FUTURE_RECEIVED_DATE');
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',(co_test.report_input(d)-'eligible_set_fingerprint')||jsonb_build_object('action','set_metadata','received_date',NULL));
 -- Every malformed row must fail atomically, without saving the first row.
 FOREACH bad IN ARRAY ARRAY['-1','1.5','2147483648','"1"','true']::jsonb[] LOOP
  PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'save_report_draft',co_test.report_input(d)||jsonb_build_object('action','upsert_lines','lines',jsonb_build_array(jsonb_build_object('stock_key_id',key,'sold_quantity',bad)))),'22023','invalid sold quantity');
 END LOOP;
 p:=co_test.report_input(d)||jsonb_build_object('action','upsert_lines','lines',jsonb_build_array(jsonb_build_object('stock_key_id',key,'sold_quantity',1),jsonb_build_object('stock_key_id',key,'sold_quantity',2)));
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'save_report_draft',p),'22023','duplicate chunk key rejected');
 PERFORM co_test.assert((SELECT sold_quantity=70 FROM private.co_report_draft_lines WHERE draft_id=d AND stock_key_id=key),'failed chunk rolls back earlier row');
 SELECT stock_key_id INTO other FROM private.co_report_draft_lines WHERE customer_id<>c LIMIT 1;
 p:=co_test.report_input(d)||jsonb_build_object('action','upsert_lines','lines',jsonb_build_array(jsonb_build_object('stock_key_id',other,'sold_quantity',0)));
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'save_report_draft',p),'22023','foreign stock key rejected');
 p:=co_test.report_input(d); preview:=public.pilot_co_preview_v1('post_report',p);
 PERFORM co_test.monthly_delivery(c,'DRAFTS-B','NEW',2,'3.00',m+1);
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,%L,%L)',gen_random_uuid(),'post_report',p||jsonb_build_object('preview_fingerprint',preview->>'preview_fingerprint')),'PT409','new eligible SKU invalidates preview');
 PERFORM co_test.report_code(format('SELECT public.pilot_co_preview_v1(%L,%L)','post_report',co_test.report_input(d)),'PT409','CO_ELIGIBLE_SET_STALE');
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',jsonb_build_object('action','initialize','customer_id',c,'report_month',m,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'draft_id',d,'expected_draft_version',(SELECT version::text FROM private.co_drafts WHERE id=d)));
 PERFORM co_test.assert((SELECT count(*)=2 AND count(sold_quantity)=1 AND max(sold_quantity)=70 FROM private.co_report_draft_lines WHERE draft_id=d),'refresh preserves70 and adds new null');
 PERFORM co_test.report_zero(d); r:=co_test.report_post(d); head:=(r->>'id')::uuid;
 SELECT current_revision_id INTO old_revision FROM private.co_report_heads WHERE id=head;
 PERFORM co_test.assert((SELECT report_reference='Monthly receipt' AND notes='Original' AND received_date IS NULL FROM private.co_report_revisions WHERE id=old_revision),'metadata snapshotted in immutable revision');
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',jsonb_build_object('action','initialize','customer_id',c,'report_month',m,'expected_customer_version',r->>'customer_version','draft_id',d,'expected_draft_version',(SELECT version::text FROM private.co_drafts WHERE id=d)));
 context:=private.co_report_context_v1(c,m,d);
 PERFORM co_test.assert((SELECT (x->>'eligible_quantity')::numeric=100 FROM jsonb_array_elements(context->'eligible_rows') x WHERE x->>'stock_key_id'=key::text),'revision eligibility is100 before existing70 sales');
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',co_test.report_input(d)||jsonb_build_object('action','upsert_lines','lines',jsonb_build_array(jsonb_build_object('stock_key_id',key,'sold_quantity',90))));
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',(co_test.report_input(d)-'eligible_set_fingerprint')||jsonb_build_object('action','set_metadata','notes','Proposed revision'));
 PERFORM co_test.report_code(format('SELECT co_test.report_post(%L)',d),'23514','CO_REPORT_REVISION_REQUIRED');
 PERFORM co_test.assert((SELECT current_revision_id=old_revision FROM private.co_report_heads WHERE id=head),'revision preparation leaves original effective');
 PERFORM co_test.assert((SELECT notes='Original' FROM private.co_report_revisions WHERE id=old_revision),'revision draft metadata does not rewrite posted metadata');
 -- Source binding must detect revision pointer changes even if a corrupt caller forgets to bump customer version.
 INSERT INTO private.co_report_revisions(head_id,customer_id,revision_no,coverage_through_date,is_partial_month,reason,created_by)
 SELECT head_id,customer_id,2,coverage_through_date,is_partial_month,'synthetic revision binding',created_by FROM private.co_report_revisions WHERE id=old_revision RETURNING id INTO old_revision;
 UPDATE private.co_report_heads SET version=2,current_revision_id=old_revision WHERE id=head;
 PERFORM co_test.report_code(format('SELECT public.pilot_co_preview_v1(%L,%L)','post_report',co_test.report_input(d)),'PT409','CO_ELIGIBLE_SET_STALE');
END $co_draft_freshness_metadata_and_multiple_months$;

DO $co_missing_month_zero_partial_coverage_and_gap_rules$
DECLARE c uuid:=co_test.monthly_customer('required'); gap uuid:=co_test.monthly_customer('gap'); m date:=(date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '3 months')::date;
 d uuid; first_d uuid; p jsonb; preview jsonb; r jsonb; h uuid; revision uuid; key uuid; later_month date:=(m+interval '2 months')::date;
BEGIN
 PERFORM co_test.monthly_delivery(c,'REQUIRED-A','R',10,'1.00',m);
 d:=co_test.report_init(c,(m+interval '1 month')::date); PERFORM co_test.report_zero(d);
 p:=co_test.report_input(d); preview:=public.pilot_co_preview_v1('post_report',p);
 PERFORM co_test.assert(preview->'counts'->>'missing_month'='1','opening-stock missing month flagged');
 PERFORM co_test.report_code(format('SELECT co_test.report_post(%L)',d),'23514','CO_MISSING_REQUIRED_MONTH');
 first_d:=co_test.report_init(c,m); PERFORM co_test.report_zero(first_d); PERFORM co_test.report_post(first_d);
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',jsonb_build_object('action','initialize','customer_id',c,'report_month',(m+interval '1 month')::date,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'draft_id',d,'expected_draft_version',(SELECT version::text FROM private.co_drafts WHERE id=d)));
 PERFORM co_test.assert(public.pilot_co_preview_v1('post_report',co_test.report_input(d))->>'can_post'='true','explicit zero closes missing period');
 PERFORM co_test.report_post(d);
 -- An active zero-stock gap is not a reporting obligation.
 PERFORM co_test.monthly_delivery(gap,'GAP-A','G',1,'1.00',m);
 first_d:=co_test.report_init(gap,m); SELECT stock_key_id INTO key FROM private.co_report_draft_lines WHERE draft_id=first_d;
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',co_test.report_input(first_d)||jsonb_build_object('action','upsert_lines','lines',jsonb_build_array(jsonb_build_object('stock_key_id',key,'sold_quantity',1))));
 PERFORM co_test.report_post(first_d);
 PERFORM co_test.monthly_delivery(gap,'GAP-B','G',1,'1.00',later_month);
 d:=co_test.report_init(gap,later_month); PERFORM co_test.report_zero(d);
 PERFORM co_test.assert(public.pilot_co_preview_v1('post_report',co_test.report_input(d))->'counts'->>'missing_month'='0','movement-free zero-stock month not required despite active CO');
 -- Fixed historical partial coverage cannot become complete because the calendar advances.
 c:=co_test.monthly_customer('partial'); PERFORM co_test.monthly_delivery(c,'PARTIAL-A','P',1,'1.00',m);
 SELECT stock_key_id INTO key FROM private.co_order_lines WHERE customer_id=c;
 INSERT INTO private.co_report_heads(customer_id,report_month,created_by) VALUES(c,m,auth.uid()) RETURNING id INTO h;
 INSERT INTO private.co_report_revisions(head_id,customer_id,revision_no,coverage_through_date,is_partial_month,created_by) VALUES(h,c,1,m+8,true,auth.uid()) RETURNING id INTO revision;
 INSERT INTO private.co_report_revision_lines(revision_id,head_id,customer_id,stock_key_id,sold_quantity) VALUES(revision,h,c,key,1);
 UPDATE private.co_report_heads SET current_revision_id=revision WHERE id=h;
 d:=co_test.report_init(c,(m+interval '1 month')::date); PERFORM co_test.report_zero(d);
 p:=co_test.report_input(d); preview:=public.pilot_co_preview_v1('post_report',p);
 PERFORM co_test.assert(preview->>'can_post'='false' AND preview->'counts'->>'missing_month'='1','partial coverage remains incomplete after sold-to-zero');
 PERFORM co_test.report_code(format('SELECT co_test.report_post(%L)',d),'23514','CO_PARTIAL_MONTH_INCOMPLETE');
END $co_missing_month_zero_partial_coverage_and_gap_rules$;

DO $co_current_month_and_immutable_coverage$
DECLARE c uuid:=co_test.monthly_customer('current'); today date:=(clock_timestamp() AT TIME ZONE 'UTC')::date; m date:=date_trunc('month',today)::date;
 d uuid; key uuid; r jsonb; source jsonb; replay jsonb; old_date date:='2020-10-09'; old_month date:='2020-10-01'; snapshot jsonb; prior bigint; p jsonb;
BEGIN
 PERFORM co_test.monthly_delivery(c,'CURRENT-A','NOW',10,'1.00',m);
 d:=co_test.report_init(c,m); PERFORM co_test.report_zero(d);
 IF extract(day FROM today)>1 THEN
  -- Persist the exact previous-day binding as if this draft crossed midnight.
  p:=private.co_report_context_v1(c,m,d);
  UPDATE private.co_drafts SET payload=jsonb_set(payload,'{coverage_through_date}',to_jsonb((today-1)::text)),
   eligible_set_fingerprint=private.co_hash_v1(jsonb_build_object('sources',private.co_sources_v1(c),'month',m,'coverage',today-1,'eligible',p->'eligible_rows')) WHERE id=d;
  PERFORM co_test.report_code(format('SELECT public.pilot_co_preview_v1(%L,%L)','post_report',co_test.report_input(d)),'PT409','CO_ELIGIBLE_SET_STALE');
  PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',jsonb_build_object('action','initialize','customer_id',c,'report_month',m,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'draft_id',d,'expected_draft_version',(SELECT version::text FROM private.co_drafts WHERE id=d)));
 END IF;
 r:=co_test.report_post(d);
 PERFORM co_test.assert((SELECT coverage_through_date=today AND is_partial_month FROM private.co_report_revisions WHERE head_id=(r->>'id')::uuid),'current month uses UTC server date and partial flag');
 d:=co_test.report_init(c,(m+interval '1 month')::date); PERFORM co_test.report_zero(d);
 PERFORM co_test.report_code(format('SELECT co_test.report_post(%L)',d),'23514','CO_FUTURE_REPORT_MONTH');
 -- Same kernel, fixed historic period: coverage October9 excludes October10 source forever.
 source:=private.co_sources_v1(c);
 SELECT stock_key_id INTO key FROM private.co_order_lines WHERE customer_id=c;
 source:=jsonb_set(source,'{deliveries}',(SELECT jsonb_agg(jsonb_set(value,'{date}',to_jsonb('2020-10-10'::text))) FROM jsonb_array_elements(source->'deliveries')));
 source:=jsonb_set(source,'{reports}',jsonb_build_array(jsonb_build_object('ref','coverage-fixture','month',old_month,'coverage',old_date,'lines',jsonb_build_array(jsonb_build_object('ref',key,'stock_key_id',key,'sold_quantity',1)))));
 replay:=private.co_replay_v1(source);
 PERFORM co_test.assert(jsonb_array_length(replay->'allocations')=0 AND replay->'issues' @> '[{"code":"CO_SOLD_EXCEEDS_ELIGIBLE"}]','October9 never consumes October10 even when read later');
 source:=jsonb_set(source,'{reports,0,coverage}',to_jsonb('2020-10-10'::text));
 PERFORM co_test.assert(jsonb_array_length(private.co_replay_v1(source)->'allocations')=1,'only explicit revised coverage makes October10 eligible');
 -- New backdated delivery fails closed and rolls back its draft-post side effects.
 c:=co_test.monthly_customer('backdated'); m:=(m-interval '1 month')::date;
 PERFORM co_test.monthly_delivery(c,'BACKDATE-A','B',2,'1.00',m);
 d:=co_test.report_init(c,m); PERFORM co_test.report_zero(d); PERFORM co_test.report_post(d);
 SELECT count(*) INTO prior FROM private.co_delivery_heads;
 PERFORM co_test.report_code(format('SELECT co_test.monthly_delivery(%L,%L,%L,1,%L,%L)',c,'BACKDATE-B','B','1.00',m+1),'23514','CO_REVIEWED_CORRECTION_REQUIRED');
 PERFORM co_test.assert((SELECT count(*)=prior FROM private.co_delivery_heads),'backdated delivery command and sources rollback');
END $co_current_month_and_immutable_coverage$;

DO $co_source_returns_zero_capacity_closed_history_and_fifo_ties$
DECLARE c uuid:=co_test.monthly_customer('returns'); m date:=(date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '1 month')::date;
 o uuid; d uuid; b private.co_stock_batches%ROWTYPE; h uuid; rev uuid; source jsonb; a jsonb; key text; original jsonb; context jsonb; empty_customer uuid;
BEGIN
 o:=co_test.monthly_delivery(c,'RETURNED-A','RET',10,'1.00',m);
 SELECT * INTO b FROM private.co_stock_batches WHERE co_id=o;
 INSERT INTO private.co_return_heads(customer_id,created_by) VALUES(c,auth.uid()) RETURNING id INTO h;
 INSERT INTO private.co_return_revisions(head_id,customer_id,revision_no,return_date,created_by) VALUES(h,c,1,m+1,auth.uid()) RETURNING id INTO rev;
 INSERT INTO private.co_return_revision_lines(revision_id,head_id,customer_id,batch_id,stock_key_id,quantity) VALUES(rev,h,c,b.id,b.stock_key_id,10);
 UPDATE private.co_return_heads SET current_revision_id=rev WHERE id=h;
 d:=co_test.report_init(c,m); context:=private.co_report_context_v1(c,m,d);
 PERFORM co_test.assert((SELECT count(*)=1 AND count(sold_quantity)=0 FROM private.co_report_draft_lines WHERE draft_id=d),'fully returned period still asks explicit zero');
 PERFORM co_test.assert(context->'eligible_rows'->0->>'eligible_quantity'='0','return consumes source capacity');
 PERFORM co_test.report_zero(d); PERFORM co_test.report_post(d);
 UPDATE private.co_orders SET status='closed',version=version+1 WHERE id=o;
 PERFORM co_test.assert(jsonb_array_length(private.co_sources_v1(c)->'deliveries')=1,'closed CO sources preserved');
 PERFORM co_test.assert(private.co_build_plan_v1(c,'replay','{}')->'after'->>'remaining_quantity'='0','closed history replayed with unsold return');
 empty_customer:=co_test.monthly_customer('empty');
 PERFORM private.co_lock_customer_v1(empty_customer,1); d:=co_test.report_init(empty_customer,m);
 PERFORM co_test.assert(NOT EXISTS(SELECT 1 FROM private.co_report_draft_lines WHERE draft_id=d),'empty period has no invented SKU rows');
 -- Same date and same original creation order: stable batch ID is final tie-break.
 source:=private.co_sources_v1(c); source:=jsonb_set(source,'{returns}','[]');
 original:=source->'deliveries'->0; key:=original->>'stock_key_id';
 source:=jsonb_set(source,'{deliveries}',jsonb_build_array(original||jsonb_build_object('batch_id','ffffffff-ffff-ffff-ffff-ffffffffffff','quantity','5','unit_price','12.00'),original||jsonb_build_object('batch_id','00000000-0000-0000-0000-000000000001','quantity','5','unit_price','10.00')));
 source:=jsonb_set(source,'{reports}',jsonb_build_array(jsonb_build_object('ref','tie','month',m,'coverage',(m+interval '1 month -1 day')::date,'lines',jsonb_build_array(jsonb_build_object('ref',key,'stock_key_id',key,'sold_quantity',7)))));
 a:=private.co_replay_v1(source)->'allocations';
 PERFORM co_test.assert(a->0->>'batch_id'='00000000-0000-0000-0000-000000000001' AND a->0->>'quantity'='5' AND a->1->>'quantity'='2','batch UUID breaks same-date same-creation ties');
 source:=jsonb_set(source,'{deliveries}',jsonb_build_array(source->'deliveries'->1,source->'deliveries'->0));
 PERFORM co_test.assert(private.co_replay_v1(source)->'allocations'=a,'reversed JSON ordering never changes FIFO');
 source:=jsonb_set(source,'{deliveries,0,original_creation_order}',to_jsonb('9999999'::text));
 PERFORM co_test.assert(private.co_replay_v1(source)->'allocations'->0->>'batch_id'='ffffffff-ffff-ffff-ffff-ffffffffffff','original creation order precedes batch ID');
END $co_source_returns_zero_capacity_closed_history_and_fifo_ties$;


DO $co_existing_allocations_cannot_be_silently_repaired$
DECLARE c uuid:=co_test.monthly_customer('drift'); m date:=(date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '2 months')::date;
 d uuid; k uuid; g uuid; old_g uuid; preview jsonb;
BEGIN
 PERFORM co_test.monthly_delivery(c,'DRIFT-A','D',2,'1.00',m);
 d:=co_test.report_init(c,m); SELECT stock_key_id INTO k FROM private.co_report_draft_lines WHERE draft_id=d;
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',co_test.report_input(d)||jsonb_build_object('action','upsert_lines','lines',jsonb_build_array(jsonb_build_object('stock_key_id',k,'sold_quantity',1))));
 PERFORM co_test.report_post(d);
 SELECT effective_generation_id INTO old_g FROM private.co_customer_state WHERE customer_id=c;
 -- Synthetic corrupt-generation fixture: posted sources say1 sold, effective evidence says0.
 INSERT INTO private.co_replay_generations(customer_id,version,algorithm_version,created_by) SELECT c,version+1,'fixture-drift',auth.uid() FROM private.co_customer_state WHERE customer_id=c RETURNING id INTO g;
 INSERT INTO private.co_stock_movements(generation_id,customer_id,batch_id,stock_key_id,kind,quantity_delta,effective_date,delivery_revision_line_id)
 SELECT g,c,batch_id,stock_key_id,kind,quantity_delta,effective_date,delivery_revision_line_id FROM private.co_stock_movements WHERE generation_id=old_g AND kind='delivery';
 UPDATE private.co_customer_state SET version=version+1,effective_generation_id=g WHERE customer_id=c;
 d:=co_test.report_init(c,(m+interval '1 month')::date); PERFORM co_test.report_zero(d);
 preview:=public.pilot_co_preview_v1('post_report',co_test.report_input(d));
 PERFORM co_test.assert(preview->>'can_post'='false','new report cannot silently rewrite existing effective allocation evidence');
 PERFORM co_test.report_code(format('SELECT co_test.report_post(%L)',d),'23514','CO_REVIEWED_CORRECTION_REQUIRED');
END $co_existing_allocations_cannot_be_silently_repaired$;


DO $co_preview_security_bounds_and_trusted_sources$
DECLARE c uuid:=co_test.monthly_customer('security'); m date:=(date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '1 month')::date;
 d uuid; p jsonb; preview jsonb; plan jsonb; before_counts jsonb; after_counts jsonb; k uuid; b private.co_stock_batches%ROWTYPE; fn record; i integer; x jsonb; r jsonb;
BEGIN
 -- Immutable source snapshot survives both current owner and catalog edits.
 INSERT INTO auth.users(id) VALUES(md5('monthly-owner-a')::uuid),(md5('monthly-owner-b')::uuid);
 INSERT INTO public.users(id,full_name,email,role) VALUES(md5('monthly-owner-a')::uuid,'Monthly A','monthly-a@example.invalid','sales_person'),(md5('monthly-owner-b')::uuid,'Monthly B','monthly-b@example.invalid','sales_person');
 INSERT INTO public.customer_manager_assignments(customer_id,manager_id,assigned_by) VALUES(c,md5('monthly-owner-a')::uuid,auth.uid());
 PERFORM co_test.monthly_delivery(c,'SECURE-A','CAT-A',2147483647,'999999999999.99',m,md5('co-product-1')::uuid);
 SELECT * INTO b FROM private.co_stock_batches WHERE customer_id=c;
 UPDATE public.customer_manager_assignments SET manager_id=md5('monthly-owner-b')::uuid WHERE customer_id=c;
 UPDATE public.products SET sku='RENAMED-CAT',name='Changed catalog',unit_price=1.30 WHERE id=md5('co-product-1')::uuid;
 d:=co_test.report_init(c,m); k:=b.stock_key_id;
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',co_test.report_input(d)||jsonb_build_object('action','upsert_lines','lines',jsonb_build_array(jsonb_build_object('stock_key_id',k,'sold_quantity',2147483647))));
 p:=co_test.report_input(d); preview:=public.pilot_co_preview_v1('post_report',p);
 PERFORM co_test.assert(preview->'after'->>'revenue'='2147483646999978525163.53','extended money remains exact beyond JavaScript range');
 plan:=private.co_build_plan_v1(c,'post_report',p);
 PERFORM co_test.assert(plan->'replay'->'allocations'->0->>'sales_person_id_at_creation'=md5('monthly-owner-a')::uuid::text,'creation credit survives owner change');
 PERFORM co_test.assert(plan->'replay'->'allocations'->0->>'unit_price'='999999999999.99','agreed price survives catalog edit');
 SELECT jsonb_build_array((SELECT count(*) FROM private.co_commands),(SELECT count(*) FROM private.co_audit_events),(SELECT count(*) FROM private.co_replay_generations),(SELECT count(*) FROM private.co_stock_movements),(SELECT count(*) FROM private.co_sale_allocations),(SELECT sum(version) FROM private.co_drafts)) INTO before_counts;
 PERFORM private.co_build_plan_v1(c,'post_report',p); PERFORM public.pilot_co_preview_v1('post_report',p);
 SELECT jsonb_build_array((SELECT count(*) FROM private.co_commands),(SELECT count(*) FROM private.co_audit_events),(SELECT count(*) FROM private.co_replay_generations),(SELECT count(*) FROM private.co_stock_movements),(SELECT count(*) FROM private.co_sale_allocations),(SELECT sum(version) FROM private.co_drafts)) INTO after_counts;
 PERFORM co_test.assert(before_counts=after_counts,'planner and preview write no evidence or drafts');
 PERFORM co_test.report_code(format('SELECT public.pilot_co_preview_impacts_v1(%L,%L,%L,%L,1,100)','post_report',p,repeat('0',64),'stock'),'PT409','CO_PREVIEW_STALE');
 FOREACH i IN ARRAY ARRAY[0,101,501] LOOP
  PERFORM co_test.raises(format('SELECT public.pilot_co_preview_impacts_v1(%L,%L,%L,%L,1,%s)','post_report',p,preview->>'preview_fingerprint','stock',i),'22023','page size bounded');
 END LOOP;
 PERFORM co_test.raises(format('SELECT public.pilot_co_preview_impacts_v1(%L,%L,%L,%L,0,100)','post_report',p,preview->>'preview_fingerprint','stock'),'22023','page index positive');
 PERFORM co_test.raises(format('SELECT public.pilot_co_preview_v1(%L,%L)','post_report',p||'{"unit_price":"0.00"}'),'22023','client cannot submit price or arbitrary planning field');
 PERFORM co_test.raises(format('SELECT public.pilot_co_preview_v1(%L,%L)','post_sj',p),'22023','unimplemented mutation preview cannot bypass gate');
 EXECUTE 'SET LOCAL ROLE authenticated'; preview:=public.pilot_co_preview_v1('post_report',p); EXECUTE 'RESET ROLE';
 PERFORM co_test.assert(preview->>'can_post'='true','actual authenticated role can call checked preview');
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-3')::uuid::text,true);
 PERFORM co_test.raises(format('SELECT public.pilot_co_preview_v1(%L,%L)','post_report',p),'42501','PO role cannot preview raw CO');
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-4')::uuid::text,true);
 PERFORM co_test.raises(format('SELECT public.pilot_co_preview_v1(%L,%L)','post_report',p),'42501','inactive CO actor denied');
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true);
 FOR fn IN SELECT p.oid,p.oid::regprocedure name,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname LIKE 'co_%' LOOP
  PERFORM co_test.assert(NOT has_function_privilege('authenticated',fn.oid,'EXECUTE') AND NOT has_function_privilege('anon',fn.oid,'EXECUTE'),'private CO helper denied: '||fn.name);
  PERFORM co_test.assert(fn.proconfig @> ARRAY['search_path=""'],'empty helper search_path: '||fn.name);
 END LOOP;
 PERFORM co_test.assert(NOT has_function_privilege('anon','public.pilot_co_preview_v1(text,jsonb)','EXECUTE'),'anon preview denied');
 r:=co_test.report_post(d);
 PERFORM co_test.raises(format('UPDATE private.co_report_revisions SET notes=%L WHERE head_id=%L','rewrite',r->>'id'),'55000','published report metadata immutable');
END $co_preview_security_bounds_and_trusted_sources$;

DO $co_retained_rows_and_source_overlay_contract$
DECLARE c uuid:=co_test.monthly_customer('overlay'); m date:=(date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '1 month')::date;
 d uuid; k uuid; context jsonb; sources jsonb; h uuid; rev uuid; old_v bigint; p jsonb; snapshot jsonb;
BEGIN
 PERFORM co_test.monthly_delivery(c,'OVERLAY-A','OVER',3,'0.00',m);
 d:=co_test.report_init(c,m); SELECT stock_key_id INTO k FROM private.co_report_draft_lines WHERE draft_id=d;
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',co_test.report_input(d)||jsonb_build_object('action','upsert_lines','lines',jsonb_build_array(jsonb_build_object('stock_key_id',k,'sold_quantity',2))));
 sources:=private.co_sources_v1(c); snapshot:=private.co_report_context_v1(c,m,d);
 sources:=jsonb_set(sources,'{deliveries}','[]'); context:=private.co_report_context_v1(c,m,d,sources);
 PERFORM co_test.assert(context->'eligible_rows'->0->>'eligible_quantity'='0','candidate source overlay preserves entered row with zero capacity');
 PERFORM co_test.assert(private.co_report_context_v1(c,m,d)=snapshot,'overlay eligibility is pure and does not replace current source context');
 -- Synthetic reviewed source revision removes the source; refresh must retain sold2, not erase it.
 SELECT id INTO h FROM private.co_delivery_heads WHERE customer_id=c;
 INSERT INTO private.co_delivery_revisions(head_id,customer_id,co_id,revision_no,sj_number,sj_date,is_void,reason,created_by)
 SELECT head_id,customer_id,co_id,2,sj_number,sj_date,true,'synthetic source removal',created_by FROM private.co_delivery_revisions WHERE id=(SELECT current_revision_id FROM private.co_delivery_heads WHERE id=h) RETURNING id INTO rev;
 UPDATE private.co_delivery_heads SET current_revision_id=rev,version=version+1 WHERE id=h;
 UPDATE private.co_customer_state SET version=version+1 WHERE customer_id=c RETURNING version INTO old_v;
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',jsonb_build_object('action','initialize','customer_id',c,'report_month',m,'expected_customer_version',old_v::text,'draft_id',d,'expected_draft_version',(SELECT version::text FROM private.co_drafts WHERE id=d)));
 PERFORM co_test.assert((SELECT sold_quantity=2 FROM private.co_report_draft_lines WHERE draft_id=d AND stock_key_id=k),'refresh never erases disappeared-source entry');
 p:=co_test.report_input(d);
 PERFORM co_test.assert(public.pilot_co_preview_v1('post_report',p)->>'can_post'='false','retained positive quantity at zero capacity blocks posting');
 PERFORM co_test.report_code(format('SELECT co_test.report_post(%L)',d),'23514','CO_SOLD_EXCEEDS_ELIGIBLE');
END $co_retained_rows_and_source_overlay_contract$;


DO $co_zero_price_and_unassigned_credit$
DECLARE c uuid:=co_test.monthly_customer('zero-price'); m date:=(date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '1 month')::date; d uuid; k uuid; g uuid;
BEGIN
 PERFORM co_test.monthly_delivery(c,'ZERO-PRICE','FREE',1,'0.00',m);
 d:=co_test.report_init(c,m); SELECT stock_key_id INTO k FROM private.co_report_draft_lines WHERE draft_id=d;
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',co_test.report_input(d)||jsonb_build_object('action','upsert_lines','lines',jsonb_build_array(jsonb_build_object('stock_key_id',k,'sold_quantity',1))));
 PERFORM co_test.report_post(d); SELECT effective_generation_id INTO g FROM private.co_customer_state WHERE customer_id=c;
 PERFORM co_test.assert((SELECT count(*)=1 AND sum(amount)=0 AND bool_and(sales_attribution_state='unassigned' AND sales_person_id_at_creation IS NULL) FROM private.co_sale_allocations WHERE generation_id=g),'deliberate zero-price sale keeps quantity and unassigned snapshot');
 PERFORM co_test.assert((SELECT sum(quantity_delta)=0 FROM private.co_stock_movements WHERE generation_id=g),'zero-price sale depletes stock');
END $co_zero_price_and_unassigned_credit$;

SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
SELECT 'CO_MONTHLY_FIFO_PASSED';
