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

SELECT co_test.assert(to_regprocedure('public.pilot_sales_metrics_v2(uuid,date,date,text,text,integer,integer)') IS NOT NULL,'explicit v2 metrics RPC exists');
SELECT co_test.assert(to_regprocedure('public.pilot_sales_metric_months_v2(uuid,text)') IS NOT NULL,'explicit v2 months RPC exists');

CREATE TEMP TABLE sales_metric_fixtures(seq integer GENERATED ALWAYS AS IDENTITY,label text UNIQUE,name text,args jsonb,data jsonb,expected jsonb);
CREATE FUNCTION co_test.metric_actor(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5('sales-metric-actor-'||n)::uuid; $$;
INSERT INTO auth.users(id) SELECT co_test.metric_actor(n) FROM generate_series(1,15)n;
INSERT INTO public.users(id,full_name,email,role,is_active)
SELECT co_test.metric_actor(n),'Metric person '||n,'metric-'||n||'@example.invalid',
 (CASE n WHEN 1 THEN 'executive' WHEN 2 THEN 'sales_head' WHEN 3 THEN 'sales_manager' WHEN 6 THEN 'sales_manager' WHEN 9 THEN 'co_admin' WHEN 10 THEN 'po_admin' ELSE 'sales_person' END)::public.user_role,n<>8
FROM generate_series(1,15)n;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.users SET manager_id=co_test.metric_actor(CASE WHEN id=co_test.metric_actor(7) THEN 6 ELSE 3 END)
WHERE id IN(SELECT co_test.metric_actor(n) FROM generate_series(4,15)n WHERE n NOT IN(6,9,10));
SELECT set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true);
CREATE FUNCTION co_test.metric_owner(c uuid,n integer) RETURNS void LANGUAGE sql AS $$
 INSERT INTO public.customer_manager_assignments(customer_id,manager_id,assigned_by)
 VALUES(c,co_test.metric_actor(n),auth.uid())
 ON CONFLICT(customer_id) DO UPDATE SET manager_id=excluded.manager_id;
$$;
CREATE FUNCTION co_test.metric_expect(d jsonb,e jsonb,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE k text; v jsonb;
BEGIN FOR k,v IN SELECT * FROM jsonb_each(e) LOOP
 PERFORM co_test.assert((d#>string_to_array(k,'.'))=v,label||' '||k||': expected '||v||', got '||coalesce((d#>string_to_array(k,'.'))::text,'missing'));
END LOOP; END $$;
CREATE FUNCTION co_test.metric(label text,actor integer,manager integer,f date,u date,g text,t text,e jsonb DEFAULT '{}',pg integer DEFAULT 1,sz integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE d jsonb; a jsonb; manager_uuid uuid:=co_test.metric_actor(manager); previous text:=current_setting('request.jwt.claim.sub',true);
BEGIN
 a:=jsonb_build_object('p_manager_id',co_test.metric_actor(manager),'p_month_from',f,'p_month_until',u,'p_group_by',g,'p_order_type',t,'p_page',pg,'p_page_size',sz);
 PERFORM set_config('request.jwt.claim.sub',co_test.metric_actor(actor)::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 d:=public.pilot_sales_metrics_v2(manager_uuid,f,u,g,t,pg,sz);
 EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claim.sub',previous,true);
 PERFORM co_test.metric_expect(d,e,label);
 INSERT INTO sales_metric_fixtures(label,name,args,data,expected) VALUES(label,'pilot_sales_metrics_v2',a,d,e);
 RETURN d;
END $$;
CREATE FUNCTION co_test.metric_months(label text,actor integer,manager integer,t text,e jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE d jsonb; manager_uuid uuid:=co_test.metric_actor(manager); previous text:=current_setting('request.jwt.claim.sub',true);
BEGIN
 PERFORM set_config('request.jwt.claim.sub',co_test.metric_actor(actor)::text,true); EXECUTE 'SET LOCAL ROLE authenticated';
 d:=public.pilot_sales_metric_months_v2(manager_uuid,t); EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claim.sub',previous,true);
 PERFORM co_test.metric_expect(d,e,label);
 INSERT INTO sales_metric_fixtures(label,name,args,data,expected) VALUES(label,'pilot_sales_metric_months_v2',jsonb_build_object('p_manager_id',co_test.metric_actor(manager),'p_order_type',t),d,e);
 RETURN d;
END $$;

DO $po_facts$
DECLARE c uuid:=co_test.monthly_customer('metric-po');p uuid:=gen_random_uuid();l uuid:=gen_random_uuid();s uuid:=gen_random_uuid();n uuid:=gen_random_uuid();x uuid;z text;d jsonb;
BEGIN
 INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number,status,order_date,created_at,total_value,sales_person_id_at_creation,sales_assignment_source_id,sales_attributed_at,sales_attribution_state)
 VALUES(p,c,md5('co-user-3')::uuid,'METRIC-PO','confirm','2026-09-15','2026-10-02T00:00:00Z',100,co_test.metric_actor(4),gen_random_uuid(),clock_timestamp(),'assigned');
 INSERT INTO public.po_line_items(id,purchase_order_id,product_name,sku,quantity,unit_price) VALUES(l,p,'Agreed item','METRIC-PO',10,10);
 INSERT INTO public.girard_orders(customer_id,submitted_by,status,po_id,total_value,created_at) VALUES(c,co_test.metric_actor(7),'approved',p,999,'2026-08-20T00:00:00Z'),(c,co_test.metric_actor(4),'approved',NULL,777,'2026-07-01T00:00:00Z');
 INSERT INTO public.surat_jalan(id,purchase_order_id,sj_number,sj_date,created_by) VALUES(s,p,'METRIC-OCT','2026-10-03',md5('co-user-3')::uuid),(n,p,'METRIC-NOV','2026-11-02',md5('co-user-3')::uuid);
 INSERT INTO public.sj_line_items(surat_jalan_id,po_line_item_id,quantity_delivered) VALUES(s,l,3),(n,l,2);
 PERFORM co_test.metric('po-september',4,NULL,'2026-09-01','2026-10-01','customer','po','{"scope":"own","summary.po_order_value":"100.00","summary.po_order_count":"1","summary.po_delivered_revenue":"0.00"}');
 PERFORM co_test.metric('po-august',4,NULL,'2026-08-01','2026-09-01','customer','po','{"total":"0","summary.po_order_value":"0.00"}');
 PERFORM co_test.metric('po-october',4,NULL,'2026-10-01','2026-11-01','customer','po','{"summary.po_order_value":"0.00","summary.po_delivered_revenue":"30.00","summary.po_delivered_order_count":"1"}');
 PERFORM co_test.metric('po-november',4,NULL,'2026-11-01','2026-12-01','customer','po','{"summary.po_delivered_revenue":"20.00"}');
 PERFORM co_test.metric('po-distinct-range',4,NULL,'2026-09-01','2026-12-01','customer','po','{"summary.po_order_count":"1","summary.po_delivered_order_count":"1","summary.po_delivered_revenue":"50.00"}');
 UPDATE public.surat_jalan SET voided_at=clock_timestamp(),voided_by=md5('co-user-3')::uuid,void_reason='Synthetic metrics void' WHERE id=s;
 PERFORM co_test.metric('po-void',4,NULL,'2026-10-01','2026-11-01','customer','po','{"total":"0","summary.po_delivered_revenue":"0.00","summary.po_delivered_order_count":"0"}');
 UPDATE public.purchase_orders SET status='cancelled' WHERE id=p;
 PERFORM co_test.metric('po-cancel',4,NULL,'2026-09-01','2026-12-01','customer','po','{"summary.po_order_value":"0.00","summary.po_order_count":"0","summary.po_delivered_revenue":"20.00"}');
 UPDATE public.purchase_orders SET status='draft' WHERE id=p;
 PERFORM co_test.metric('po-draft-evidence',4,NULL,'2026-09-01','2026-12-01','customer','po','{"summary.po_order_count":"0","summary.po_delivered_order_count":"1"}');
 FOREACH z IN ARRAY ARRAY['in_progress','complete','confirmed','shipped','delivered','delayed'] LOOP
  UPDATE public.purchase_orders SET status=z::public.po_status WHERE id=p;
  PERFORM co_test.metric('po-status-'||z,4,NULL,'2026-09-01','2026-12-01','customer','po',jsonb_build_object('summary.po_order_count',CASE WHEN z IN('in_progress','complete') THEN '1' ELSE '0' END,'summary.po_delivered_revenue','20.00'));
 END LOOP;
 UPDATE public.purchase_orders SET status='confirm' WHERE id=p;
 PERFORM co_test.metric_months('months-po',4,NULL,'po','{"earliest_month":"2026-09-01"}');
 INSERT INTO public.purchase_orders(customer_id,created_by,po_number,status,order_date,total_value,sales_person_id_at_creation,sales_assignment_source_id,sales_attributed_at,sales_attribution_state)
 VALUES(c,md5('co-user-3')::uuid,'METRIC-MANAGER-SELF','confirm','2026-07-01',0,co_test.metric_actor(3),gen_random_uuid(),clock_timestamp(),'assigned');
 PERFORM co_test.metric('manager-self',3,NULL,'2026-07-01','2026-08-01','person','po','{"summary.po_order_count":"1","summary.po_order_value":"0.00"}');
 -- Calendar endpoints and positive free delivery count use distinct zero-priced POs.
 FOREACH z IN ARRAY ARRAY['2026-09-01','2026-09-30','2026-10-01'] LOOP
  x:=gen_random_uuid();l:=gen_random_uuid();s:=gen_random_uuid();
  INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number,status,order_date,total_value,sales_person_id_at_creation,sales_assignment_source_id,sales_attributed_at,sales_attribution_state)
  VALUES(x,c,md5('co-user-3')::uuid,'METRIC-BOUND-'||z,'confirm',z::date,0,co_test.metric_actor(7),gen_random_uuid(),clock_timestamp(),'assigned');
  INSERT INTO public.po_line_items(id,purchase_order_id,product_name,quantity,unit_price) VALUES(l,x,'Free',2,0);
  INSERT INTO public.surat_jalan(id,purchase_order_id,sj_number,sj_date,created_by) VALUES(s,x,'METRIC-BOUND-'||z,z::date,md5('co-user-3')::uuid);
  INSERT INTO public.sj_line_items(surat_jalan_id,po_line_item_id,quantity_delivered) VALUES(s,l,1);
 END LOOP;
 s:=gen_random_uuid();
 INSERT INTO public.surat_jalan(id,purchase_order_id,sj_number,sj_date,created_by) VALUES(s,x,'METRIC-ZERO-LINE','2026-09-15',md5('co-user-3')::uuid);
 INSERT INTO public.sj_line_items(surat_jalan_id,po_line_item_id,quantity_delivered) VALUES(s,l,0);
 FOREACH z IN ARRAY ARRAY['UTC','Pacific/Kiritimati','America/Los_Angeles'] LOOP
  PERFORM set_config('TimeZone',z,true);
  PERFORM co_test.metric('boundary-'||z,7,NULL,'2026-09-01','2026-10-01','customer','po','{"summary.po_order_count":"2","summary.po_delivered_order_count":"2","summary.po_delivered_revenue":"0.00"}');
  PERFORM co_test.metric_months('months-boundary-'||z,7,NULL,'po','{"earliest_month":"2026-09-01"}');
 END LOOP; PERFORM set_config('TimeZone','UTC',true);
END $po_facts$;

DO $co_facts$
DECLARE c uuid:=co_test.monthly_customer('metric-mixed');m date:='2026-08-01';n date:='2026-09-01';a uuid;b uuid;d uuid;data jsonb;before jsonb;oldg uuid;
BEGIN
 PERFORM co_test.metric_owner(c,4); a:=co_test.monthly_delivery(c,'METRIC-A','CAT-A',60,'10000.00',m,md5('co-product-1')::uuid);
 PERFORM co_test.metric_owner(c,5); b:=co_test.monthly_delivery(c,'METRIC-B','CAT-A',40,'12000.00',m+1,md5('co-product-1')::uuid);
 d:=co_test.report_init(c,m);PERFORM co_test.set_sold(d,70);PERFORM co_test.report_post(d);
 PERFORM co_test.metric('co-mixed-customer',1,3,m,n,'customer','co','{"scope":"leadership","total":"1","summary.co_sold_revenue":"720000.00","summary.co_sold_order_count":"2","summary.co_report_event_count":"1"}');
 PERFORM co_test.metric('co-mixed-person',1,3,m,n,'person','co','{"total":"2","summary.co_report_event_count":"1","items.0.co_contributing_report_count":"1","items.1.co_contributing_report_count":"1"}');
 PERFORM co_test.metric('co-own-a',4,NULL,m,n,'customer','co','{"summary.co_sold_revenue":"600000.00","summary.co_sold_order_count":"1","summary.co_report_event_count":"1"}');
 PERFORM co_test.metric('co-team',3,NULL,m,n,'customer','co','{"scope":"team","summary.co_sold_revenue":"720000.00","summary.co_report_event_count":"1"}');
 PERFORM co_test.metric('co-peer-hidden',7,NULL,m,n,'customer','co','{"total":"0","summary.co_report_event_count":"0"}');
 PERFORM co_test.metric('co-narrowed-own',4,6,m,n,'customer','co','{"total":"0"}');
 -- Same source CO in a second month is not a new distinct sold order over the range.
 d:=co_test.report_init(c,n);PERFORM co_test.set_sold(d,10);PERFORM co_test.report_post(d);
 PERFORM co_test.metric('co-range-distinct',1,3,m,'2026-10-01','customer','co','{"summary.co_sold_order_count":"2","summary.co_sold_revenue":"840000.00","summary.co_report_event_count":"2"}');
 SELECT effective_generation_id INTO oldg FROM private.co_customer_state WHERE customer_id=c;
 d:=co_test.refresh_report(c,m);PERFORM co_test.set_sold(d,50);PERFORM co_test.review_post('correct_report',co_test.report_correction(d));
 PERFORM co_test.metric('co-corrected',1,3,m,'2026-10-01','customer','co','{"summary.co_sold_revenue":"600000.00","summary.co_sold_order_count":"1","summary.co_report_event_count":"2"}');
 PERFORM co_test.assert((SELECT sum(amount)=840000 FROM private.co_sale_allocations WHERE generation_id=oldg),'old retained generation is not counted');
 -- Source A is sold out, closing it must retain historical sale facts.
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'close_co',co_test.order_input(a));
 PERFORM co_test.metric('co-closed',1,3,m,'2026-10-01','customer','co','{"summary.co_sold_revenue":"600000.00"}');
 -- Catalog/current owner and credited profile changes cannot rewrite the snapshots.
 PERFORM co_test.metric_owner(c,7);UPDATE public.products SET unit_price=1,luar_kota=2 WHERE id=md5('co-product-1')::uuid;
 PERFORM set_config('request.jwt.claim.sub','',true);UPDATE public.users SET is_active=false,role='po_admin' WHERE id=co_test.metric_actor(4);PERFORM set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true);
 PERFORM co_test.metric('co-inactive-credit',1,3,m,'2026-10-01','person','co',jsonb_build_object('summary.co_sold_revenue','600000.00','items.0.person_id',co_test.metric_actor(4)));
 PERFORM co_test.metric('po-inactive-credit',1,4,'2026-09-01','2026-12-01','person','po','{"summary.po_order_value":"100.00","summary.po_delivered_revenue":"20.00"}');
 PERFORM co_test.metric('team-inactive-credit',3,NULL,m,'2026-10-01','person','co','{"summary.co_sold_revenue":"600000.00"}');
 PERFORM co_test.metric_months('months-historical',1,4,'all','{"earliest_month":"2026-08-01"}');
 PERFORM co_test.metric('co-new-owner-hidden',7,NULL,m,'2026-10-01','customer','co','{"total":"0"}');
 PERFORM set_config('request.jwt.claim.sub','',true);UPDATE public.users SET is_active=true,role='sales_person' WHERE id=co_test.metric_actor(4);PERFORM set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true);
END $co_facts$;

DO $zero_and_scope$
DECLARE c uuid:=co_test.monthly_customer('metric-zero');free uuid:=co_test.monthly_customer('metric-free');other uuid:=co_test.monthly_customer('metric-unassigned');m date:='2026-09-01';d uuid;o uuid;data jsonb;
BEGIN
 PERFORM co_test.metric_owner(c,11);o:=co_test.monthly_delivery(c,'METRIC-ZERO','ZERO',5,'4.00','2026-08-01');d:=co_test.report_init(c,'2026-08-01');PERFORM co_test.report_zero(d);PERFORM co_test.report_post(d);
 d:=co_test.report_init(c,m);PERFORM co_test.report_zero(d);PERFORM co_test.report_post(d);
 PERFORM co_test.metric('zero-own',11,NULL,m,'2026-10-01','customer','co','{"summary.co_report_event_count":"1","summary.co_sold_order_count":"0","total":"1"}');
 PERFORM co_test.metric('zero-person',11,NULL,m,'2026-10-01','person','co','{"summary.co_report_event_count":"1","total":"0"}');
 PERFORM co_test.metric_owner(c,7);PERFORM co_test.metric('zero-other',7,NULL,m,'2026-10-01','customer','co','{"summary.co_report_event_count":"0","total":"0"}');
 PERFORM co_test.metric_months('months-zero',11,NULL,'co','{"earliest_month":"2026-08-01"}');
 PERFORM co_test.metric_owner(free,11);PERFORM co_test.monthly_delivery(free,'METRIC-FREE','FREE',1,'0.00',m);d:=co_test.report_init(free,m);PERFORM co_test.set_sold(d,1);PERFORM co_test.report_post(d);
 PERFORM co_test.metric('free-sale',11,NULL,m,'2026-10-01','person','co','{"summary.co_sold_revenue":"0.00","summary.co_sold_order_count":"1","summary.co_report_event_count":"2","items.0.co_contributing_report_count":"1"}');
 PERFORM co_test.monthly_delivery(other,'METRIC-UNASSIGNED','U',1,'3.00',m);d:=co_test.report_init(other,m);PERFORM co_test.set_sold(d,1);PERFORM co_test.report_post(d);
 data:=co_test.metric('unassigned',1,NULL,m,'2026-10-01','person','co','{"summary.co_report_event_count":"4","summary.co_sold_revenue":"100003.00"}');
 PERFORM co_test.assert((SELECT count(*)=1 FROM jsonb_array_elements(data->'items')x WHERE x->'person_id'='null'::jsonb AND x->>'person_name'='Unassigned' AND x->>'co_sold_revenue'='3.00'),'leadership explicit unassigned');
 data:=co_test.metric('unassigned-filtered',1,3,m,'2026-10-01','person','co','{"summary.co_report_event_count":"3","summary.co_sold_revenue":"100000.00"}');PERFORM co_test.assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(data->'items')x WHERE x->'person_id'='null'::jsonb),'manager intersection excludes unassigned');
 PERFORM co_test.metric_months('months-empty',7,NULL,'co','{"earliest_month":null}');
END $zero_and_scope$;

DO $event_eligibility$
DECLARE exhausted uuid:=co_test.monthly_customer('metric-exhausted');returned uuid:=co_test.monthly_customer('metric-returned');partial uuid:=co_test.monthly_customer('metric-partial');m date:='2026-08-01';n date:='2026-09-01';d uuid;o uuid;b uuid;data jsonb;rev uuid;g uuid;
BEGIN
 PERFORM co_test.metric_owner(exhausted,12);PERFORM co_test.monthly_delivery(exhausted,'METRIC-EXHAUSTED','E',1,'1.00',m);d:=co_test.report_init(exhausted,m);PERFORM co_test.set_sold(d,1);PERFORM co_test.report_post(d);
 PERFORM co_test.metric_owner(exhausted,5);PERFORM co_test.monthly_delivery(exhausted,'METRIC-OTHER-STOCK','E',1,'1.00',n);d:=co_test.report_init(exhausted,n);PERFORM co_test.report_zero(d);PERFORM co_test.report_post(d);
 PERFORM co_test.metric('exhausted-hidden',12,NULL,n,'2026-10-01','customer','co','{"total":"0","summary.co_report_event_count":"0"}');
 PERFORM co_test.metric_owner(returned,12);o:=co_test.monthly_delivery(returned,'METRIC-RETURNED','R',2,'1.00',n);SELECT id INTO b FROM private.co_stock_batches WHERE co_id=o;d:=co_test.return_draft(returned,b,2,n+1);PERFORM co_test.review_post('post_return',co_test.return_input(d));
 d:=co_test.report_init(returned,n);PERFORM co_test.report_zero(d);PERFORM co_test.report_post(d);
 PERFORM co_test.metric('returned-zero',12,NULL,n,'2026-10-01','customer','co','{"total":"1","summary.co_report_event_count":"1","summary.co_sold_revenue":"0.00"}');
 -- Historical synthetic partial head tests the read boundary without changing the posting clock.
 PERFORM co_test.metric_owner(partial,5);PERFORM co_test.monthly_delivery(partial,'METRIC-PARTIAL-B','P',1,'1.00',n);
 d:=co_test.report_init(partial,n);PERFORM co_test.report_zero(d);PERFORM co_test.report_post(d);
 SELECT current_revision_id INTO rev FROM private.co_report_heads WHERE customer_id=partial;
 -- Append an immutable retained-coverage revision and replay under the same trusted fixture transaction.
 INSERT INTO private.co_report_revisions(head_id,customer_id,revision_no,coverage_through_date,is_partial_month,reason,created_by)
 SELECT head_id,customer_id,revision_no+1,n+8,true,'Synthetic historical partial',created_by FROM private.co_report_revisions WHERE id=rev RETURNING id INTO g;
 INSERT INTO private.co_report_revision_lines(revision_id,head_id,customer_id,stock_key_id,sold_quantity) SELECT g,head_id,customer_id,stock_key_id,0 FROM private.co_report_revision_lines WHERE revision_id=rev;
 UPDATE private.co_report_heads SET current_revision_id=g,version=version+1 WHERE customer_id=partial;
 PERFORM co_test.metric_owner(partial,13);PERFORM co_test.monthly_delivery(partial,'METRIC-PARTIAL-A','P',1,'1.00',n+9);
 PERFORM co_test.metric('partial-cutoff',13,NULL,n,'2026-10-01','customer','co','{"total":"0","summary.co_report_event_count":"0"}');
 PERFORM co_test.metric_months('months-partial-hidden',13,NULL,'co','{"earliest_month":null}');
END $event_eligibility$;

DO $retained_zero_without_effective_source$
DECLARE c uuid:=co_test.monthly_customer('metric-retained-zero');o uuid;d uuid;data jsonb;h private.co_delivery_heads%ROWTYPE;
BEGIN
 PERFORM co_test.metric_owner(c,13);o:=co_test.monthly_delivery(c,'METRIC-RETAINED','RZ',1,'1.00','2026-08-01');
 d:=co_test.report_init(c,'2026-08-01');PERFORM co_test.report_zero(d);PERFORM co_test.report_post(d);
 SELECT * INTO h FROM private.co_delivery_heads WHERE co_id=o;
 PERFORM co_test.review_post('correct_sj',co_test.review_fields(c)||jsonb_build_object('delivery_head_id',h.id,'original_revision_id',h.current_revision_id,'expected_delivery_version',h.version::text,'expected_co_version',(SELECT version::text FROM private.co_orders WHERE id=o),'action','void'));
 PERFORM co_test.metric('retained-zero-own-hidden',13,NULL,'2026-08-01','2026-09-01','customer','co','{"total":"0","summary.co_report_event_count":"0"}');
 data:=co_test.metric('retained-zero-leadership',1,NULL,'2026-08-01','2026-09-01','customer','co');
 PERFORM co_test.assert(EXISTS(SELECT 1 FROM jsonb_array_elements(data->'items')x WHERE x->>'customer_id'=c::text AND x->>'co_report_event_count'='1' AND x->>'co_sold_revenue'='0.00'),'leadership retains zero head after reviewed source void');
END $retained_zero_without_effective_source$;

DO $large_and_pages$
DECLARE c uuid:=co_test.monthly_customer('metric-huge');m date:='2026-09-01';d uuid;o uuid;i integer;data jsonb;before jsonb;
BEGIN
 PERFORM co_test.metric_owner(c,14);o:=co_test.monthly_delivery(c,'METRIC-HUGE','H',2147483647,'999999999999.99',m);d:=co_test.report_init(c,m);PERFORM co_test.set_sold(d,2147483647);
 PERFORM co_test.metric('draft-no-sales',14,NULL,m,'2026-10-01','customer','co','{"total":"0","summary.co_sold_revenue":"0.00","summary.co_report_event_count":"0"}');
 PERFORM co_test.metric_months('months-draft-hidden',14,NULL,'co','{"earliest_month":null}');PERFORM co_test.report_post(d);
 PERFORM co_test.metric('huge',14,NULL,m,'2026-10-01','customer','co','{"summary.co_sold_revenue":"2147483646999978525163.53","summary.co_sold_order_count":"1"}');
 -- 101 rows are real authorized PO facts, not a synthetic envelope substitute.
 FOR i IN 1..101 LOOP
  c:=co_test.monthly_customer('metric-page-'||lpad(i::text,3,'0'));
  INSERT INTO public.purchase_orders(customer_id,created_by,po_number,status,order_date,total_value,sales_person_id_at_creation,sales_assignment_source_id,sales_attributed_at,sales_attribution_state)
  VALUES(c,md5('co-user-3')::uuid,'METRIC-PAGE-'||i,'confirm',m,1.01,co_test.metric_actor(15),gen_random_uuid(),clock_timestamp(),'assigned');
 END LOOP;
 PERFORM co_test.metric('page-first',15,NULL,m,'2026-10-01','customer','po','{"total":"101","summary.po_order_value":"102.01","summary.po_order_count":"101"}',1,100);
 PERFORM co_test.metric('page-last',15,NULL,m,'2026-10-01','customer','po','{"total":"101","summary.po_order_value":"102.01","items.0.customer_name":"metric-page-101"}',2,100);
 PERFORM co_test.metric('page-empty',15,NULL,m,'2026-10-01','customer','po','{"total":"101","items":[],"summary.po_order_value":"102.01"}',3,100);
END $large_and_pages$;

DO $authority_and_inputs$
DECLARE n integer;sql text;v jsonb;fn record;before jsonb;after jsonb;
BEGIN
 FOREACH n IN ARRAY ARRAY[8,9,10] LOOP
  PERFORM set_config('request.jwt.claim.sub',co_test.metric_actor(n)::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.pilot_sales_metrics_v2(NULL,'2026-09-01','2026-10-01','customer','all',1,100);RAISE EXCEPTION 'Unexpected metric authority';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  BEGIN PERFORM public.pilot_sales_metric_months_v2(NULL,'all');RAISE EXCEPTION 'Unexpected months authority';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  EXECUTE 'RESET ROLE';
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub','',true);EXECUTE 'SET LOCAL ROLE authenticated';
 BEGIN PERFORM public.pilot_sales_metric_months_v2(NULL,'all');RAISE EXCEPTION 'Unexpected missing-subject authority';EXCEPTION WHEN insufficient_privilege THEN NULL;END;EXECUTE 'RESET ROLE';
 EXECUTE 'SET LOCAL ROLE anon';
 BEGIN PERFORM public.pilot_sales_metric_months_v2(NULL,'all');RAISE EXCEPTION 'Unexpected anonymous authority';EXCEPTION WHEN insufficient_privilege THEN NULL;END;EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.sub',co_test.metric_actor(1)::text,true);
 FOREACH sql IN ARRAY ARRAY[
 $$SELECT public.pilot_sales_metrics_v2(NULL,'2026-09-02','2026-10-01','customer','all',1,100)$$,
 $$SELECT public.pilot_sales_metrics_v2(NULL,'2026-09-01','2026-09-01','customer','all',1,100)$$,
 $$SELECT public.pilot_sales_metrics_v2(NULL,NULL,'2026-10-01','customer','all',1,100)$$,
 $$SELECT public.pilot_sales_metrics_v2(NULL,'-infinity','2026-10-01','customer','all',1,100)$$,
 $$SELECT public.pilot_sales_metrics_v2(NULL,'2026-09-01','2026-10-01','raw','all',1,100)$$,
 $$SELECT public.pilot_sales_metrics_v2(NULL,'2026-09-01','2026-10-01','customer','girard',1,100)$$,
 $$SELECT public.pilot_sales_metrics_v2(NULL,'2026-09-01','2026-10-01','customer','all',0,100)$$,
 $$SELECT public.pilot_sales_metrics_v2(NULL,'2026-09-01','2026-10-01','customer','all',1,101)$$,
 $$SELECT public.pilot_sales_metric_months_v2(NULL,NULL)$$] LOOP PERFORM co_test.raises(sql,'22023','invalid explicit metric input');END LOOP;
 PERFORM co_test.metric('head-audience',2,3,'2026-09-01','2026-10-01','customer','all');
 FOR fn IN SELECT p.oid,p.proconfig,p.provolatile FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='private' AND p.proname LIKE 'co_sales_%' LOOP
  PERFORM co_test.assert(NOT has_function_privilege('authenticated',fn.oid,'EXECUTE') AND NOT has_function_privilege('anon',fn.oid,'EXECUTE') AND fn.proconfig @> ARRAY['search_path=""'] AND fn.provolatile='s','private sales helper authority/snapshot');
 END LOOP;
 PERFORM co_test.assert(NOT has_function_privilege('anon','public.pilot_sales_metrics_v2(uuid,date,date,text,text,integer,integer)','EXECUTE') AND NOT has_function_privilege('anon','public.pilot_sales_metric_months_v2(uuid,text)','EXECUTE'),'anon cannot execute sales metrics/months');
 SELECT jsonb_build_array((SELECT count(*) FROM private.co_commands),(SELECT count(*) FROM private.co_audit_events),(SELECT count(*) FROM private.co_replay_generations),(SELECT sum(version) FROM private.co_drafts)) INTO before;
 PERFORM public.pilot_sales_metrics_v2(NULL,'2026-01-01','2027-01-01','customer','all',1,100);PERFORM public.pilot_sales_metric_months_v2(NULL,'all');
 SELECT jsonb_build_array((SELECT count(*) FROM private.co_commands),(SELECT count(*) FROM private.co_audit_events),(SELECT count(*) FROM private.co_replay_generations),(SELECT sum(version) FROM private.co_drafts)) INTO after;
 PERFORM co_test.assert(before=after,'metric reads have no source/audit/generation/draft side effects');
END $authority_and_inputs$;
SELECT 'CO_SALES_METRICS_CONTRACT|'||jsonb_build_object('label',label,'name',name,'args',args,'data',data,'expected',expected)::text FROM sales_metric_fixtures ORDER BY seq;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
BEGIN READ ONLY;
SELECT set_config('request.jwt.claim.sub',md5('co-user-2')::uuid::text,true);
SET LOCAL ROLE authenticated;
SELECT public.pilot_sales_metric_months_v2(NULL,'all')->>'version';
ROLLBACK;
SELECT 'CO_SALES_METRICS_PASSED';
