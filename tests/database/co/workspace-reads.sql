-- Guarded disposable fixture assertions. AUTHORED, NOT EXECUTED.
-- Composed immediately before import-posting.sql's sole ROLLBACK by the fixed runner.
DO $workspace_reads$
DECLARE setup jsonb; c uuid; d uuid; month date; binding jsonb; posted jsonb; review jsonb; original uuid; second uuid; latest uuid; page jsonb; historical jsonb; effective jsonb; snapshot jsonb; legacy_customer uuid; legacy_draft uuid; actor uuid:=auth.uid(); original_preview jsonb; impact_page jsonb;
BEGIN
 setup:=co_test.import_setup('workspace-reads');c:=(setup->>'customerId')::uuid;d:=(setup->>'draftId')::uuid;month:=(setup->>'month')::date;binding:=setup->'binding';
 original_preview:=public.pilot_co_import_preview_v1((binding->>'importId')::uuid,binding->>'importVersion');
 impact_page:=public.pilot_co_import_impacts_v1(binding,original_preview->>'previewFingerprint','[]','report',1,20);
 PERFORM co_test.assert(impact_page->'binding'=binding AND impact_page->>'preview_fingerprint'=original_preview->>'previewFingerprint' AND NOT impact_page?'payload','impact details retain outer binding without private payload');
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_impacts_v1(%L::jsonb,%L,''[]'',''report'',1,20)',binding::text,repeat('f',64)),'PT409','changed outer fingerprint rejected');
 posted:=co_test.import_post_payload(binding);posted:=public.pilot_co_import_commit_v1((posted->>'requestId')::uuid,posted);
 SELECT current_revision_id INTO original FROM private.co_report_heads WHERE customer_id=c AND report_month=month;
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_impacts_v1(%L::jsonb,%L,''[]'',''report'',1,20)',binding::text,original_preview->>'previewFingerprint'),'PT409','consumed preview cannot authorize fresh impact read');
 -- Three append-only immutable revisions, but exactly one visible customer/month.
 review:=public.pilot_co_import_review_v1(gen_random_uuid(),co_test.import_review_payload(d));
 binding:=co_test.import_prepare(d,3,(review->>'selectionId')::uuid,'First Edit',repeat('b',64));
 posted:=co_test.import_post_payload(binding,'edit','First Edit');PERFORM public.pilot_co_import_commit_v1((posted->>'requestId')::uuid,posted);
 SELECT current_revision_id INTO second FROM private.co_report_heads WHERE customer_id=c AND report_month=month;
 review:=public.pilot_co_import_review_v1(gen_random_uuid(),co_test.import_review_payload(d));
 binding:=co_test.import_prepare(d,2,(review->>'selectionId')::uuid,'Second Edit',repeat('c',64));
 posted:=co_test.import_post_payload(binding,'edit','Second Edit');PERFORM public.pilot_co_import_commit_v1((posted->>'requestId')::uuid,posted);
 SELECT current_revision_id INTO latest FROM private.co_report_heads WHERE customer_id=c AND report_month=month;
 -- Keep an internal open review beside the posted head. This is not a second row.
 PERFORM public.pilot_co_import_review_v1(gen_random_uuid(),co_test.import_review_payload(d));
 PERFORM co_test.assert((SELECT count(*)=3 FROM private.co_report_revisions WHERE customer_id=c),'three immutable revisions retained');
 page:=public.pilot_co_reports_page_v2(c,month::text,'all',1,20);
 PERFORM co_test.assert(page->>'total'='1' AND jsonb_array_length(page->'rows')=1 AND page#>>'{rows,0,revision_id}'=latest::text AND page#>>'{rows,0,status}'='posted','posted plus work plus three revisions gives one effective row');
 PERFORM co_test.assert(public.pilot_co_reports_page_v2(c,month::text,'all',2,20)->>'total'='1' AND jsonb_array_length(public.pilot_co_reports_page_v2(c,month::text,'all',2,20)->'rows')=0,'out of range preserves full count');
 historical:=public.pilot_co_report_import_v1(c,month,original);
 PERFORM co_test.assert(historical->>'source_filename'=(SELECT private.co_evidence_json_v1(e)->>'filename' FROM private.co_report_evidence l JOIN private.co_evidence e ON e.id=l.evidence_id AND e.customer_id=l.customer_id WHERE l.report_revision_id=original AND l.customer_id=c),'revision source filename is canonical linked evidence metadata');
 effective:=public.pilot_co_report_import_v1(c,month,latest);
 PERFORM co_test.assert(historical->>'revision_id'=original::text AND historical->>'effective_revision_id'=latest::text,'explicit immutable revision bound separately from current');
 PERFORM co_test.assert(historical#>>'{manifest,input,extracted,sha256}'=repeat('a',64) AND effective#>>'{manifest,input,extracted,sha256}'=repeat('c',64),'historical bytes cannot be replaced with new source');
 PERFORM co_test.assert(historical#>>'{manifest,evidenceId}' IS DISTINCT FROM effective#>>'{manifest,evidenceId}','fresh Edit evidence identity');
 PERFORM co_test.assert((SELECT evidence_id::text=historical#>>'{manifest,evidenceId}' FROM private.co_report_evidence WHERE report_revision_id=original),'historical private evidence link retained');
 PERFORM co_test.assert((historical->>'source_amount')::numeric=15 AND (SELECT sum(amount)=600 FROM private.co_sale_allocations WHERE report_revision_id=original AND generation_id=private.co_read_revision_generation_v1(original)),'source total15 remains separate from FIFO allocation600');
 PERFORM co_test.assert((public.pilot_co_report_history_v1(c,month::text,1,20)->>'total')='3','history remains append-only');
 page:=public.pilot_co_report_revision_delta_v1(c,month::text,second,1,100);
 PERFORM co_test.assert(page->>'previous_revision_id'=original::text AND page#>>'{rows,0,before_quantity}'='5' AND page#>>'{rows,0,after_quantity}'='3','row delta binds immediate previous immutable revision');
 PERFORM co_test.raises(format('SELECT public.pilot_co_report_import_v1(%L,%L,%L)',c,(month-interval '1 month')::date,original),'22023','wrong month cannot read another revision');
 legacy_customer:=co_test.monthly_customer('workspace-legacy');PERFORM co_test.monthly_delivery(legacy_customer,'WORKSPACE-LEGACY','LEGACY',10,'200',month);legacy_draft:=co_test.report_init(legacy_customer,month);
 page:=public.pilot_co_reports_page_v2(legacy_customer,month::text,'all',1,20);
 PERFORM co_test.assert(page->>'total'='1' AND page#>>'{rows,0,status}'='historical_pending' AND (page#>>'{rows,0,legacy_pending}')::boolean,'legacy pending row explicit, not deleted or auto-posted');
 PERFORM co_test.assert(NOT EXISTS(SELECT 1 FROM private.co_report_heads WHERE customer_id=legacy_customer),'pending read never posts');
 -- Ordinary legacy posted source remains absent: no inferred report prices/units.
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',jsonb_build_object('action','fill_remaining_zero','eligible_set_fingerprint',(SELECT eligible_set_fingerprint FROM private.co_drafts WHERE id=legacy_draft),'draft_id',legacy_draft,'expected_draft_version',(SELECT version::text FROM private.co_drafts WHERE id=legacy_draft),'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=legacy_customer)));
 posted:=public.pilot_co_preview_v1('post_report',jsonb_build_object('draft_id',legacy_draft,'expected_draft_version',(SELECT version::text FROM private.co_drafts WHERE id=legacy_draft),'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=legacy_customer),'eligible_set_fingerprint',(SELECT eligible_set_fingerprint FROM private.co_drafts WHERE id=legacy_draft)));
 -- R3 ordinary checked identity read: additive, exact source/version/page; AUTHORED ONLY.
 snapshot:=jsonb_build_object('draft_id',legacy_draft,'expected_draft_version',(SELECT version::text FROM private.co_drafts WHERE id=legacy_draft),'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=legacy_customer),'eligible_set_fingerprint',(SELECT eligible_set_fingerprint FROM private.co_drafts WHERE id=legacy_draft));
 impact_page:=public.pilot_co_preview_labeled_impacts_v1('post_report',snapshot,legacy_customer,posted->>'customer_version',posted->>'preview_fingerprint','report',1,20);
 PERFORM co_test.assert(impact_page->'payload'=snapshot AND impact_page->>'customer_id'=legacy_customer::text AND impact_page->>'customer_version'=posted->>'customer_version' AND impact_page->>'total'=posted#>>'{counts,report}' AND jsonb_array_length(impact_page->'rows')>0,'ordinary-labels-exact-source-page');
 PERFORM co_test.assert((SELECT jsonb_agg(value-'labels') FROM jsonb_array_elements(impact_page->'rows'))=public.pilot_co_preview_impacts_v1('post_report',snapshot,posted->>'preview_fingerprint','report',1,20)->'rows','ordinary-labels-preserve-exact-impact-identities');
 PERFORM co_test.assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(impact_page->'rows') r WHERE NOT ((r->'labels') ?& ARRAY['sku','productName','coNumber','sjNumber','picName'])),'ordinary-labels-explicit-unavailable');
 PERFORM co_test.raises(format('SELECT public.pilot_co_preview_labeled_impacts_v1(''post_report'',%L::jsonb,%L,%L,%L,''report'',1,20)',snapshot::text,legacy_customer,'999',posted->>'preview_fingerprint'),'PT409','ordinary-labels-stale-customer-refused');
 PERFORM co_test.raises(format('SELECT public.pilot_co_preview_labeled_impacts_v1(''post_report'',%L::jsonb,%L,%L,%L,''report'',1,20)',snapshot::text,legacy_customer,posted->>'customer_version',repeat('f',64)),'PT409','ordinary-labels-stale-fingerprint-refused');
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'post_report',jsonb_build_object('draft_id',legacy_draft,'expected_draft_version',(SELECT version::text FROM private.co_drafts WHERE id=legacy_draft),'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=legacy_customer),'eligible_set_fingerprint',(SELECT eligible_set_fingerprint FROM private.co_drafts WHERE id=legacy_draft),'preview_fingerprint',posted->>'preview_fingerprint'));
 SELECT current_revision_id INTO original FROM private.co_report_heads WHERE customer_id=legacy_customer;
 PERFORM public.pilot_co_declare_stock_key_unit_v1(gen_random_uuid(),jsonb_build_object('customer_id',legacy_customer,'stock_key_id',(SELECT id FROM private.co_stock_keys WHERE customer_id=legacy_customer),'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=legacy_customer),'expected_unit_version',NULL,'unit','PCS','reason','Later current counter declaration does not rewrite historical source','confirmed',true));
 historical:=public.pilot_co_report_import_v1(legacy_customer,month,original);
 PERFORM co_test.assert(historical->'manifest'='null'::jsonb AND historical->'source_amount'='null'::jsonb AND historical->'unit_declarations'='{}'::jsonb,'legacy prices and units unavailable even when CO has prices');
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',jsonb_build_object('action','initialize','customer_id',legacy_customer,'report_month',month,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=legacy_customer),'draft_id',legacy_draft,'expected_draft_version',(SELECT version::text FROM private.co_drafts WHERE id=legacy_draft)));
 page:=public.pilot_co_reports_page_v2(legacy_customer,month::text,'all',1,20);
 PERFORM co_test.assert(page->>'total'='1' AND page#>>'{rows,0,status}'='posted' AND (page#>>'{rows,0,legacy_pending}')::boolean,'posted effective wins while legacy pending remains accessible in same row');
 PERFORM co_test.assert(NOT has_function_privilege('anon','public.pilot_co_report_import_v1(uuid,date,uuid)','EXECUTE') AND has_function_privilege('authenticated','public.pilot_co_report_import_v1(uuid,date,uuid)','EXECUTE'),'only existing authenticated audience, never anon');
 snapshot:=co_test.import_snapshot(c);
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-3')::uuid::text,true);
 -- co-user-3's ordinary role must not gain access through new definer reads.
 IF EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND role IN('co_admin','executive') AND is_active) THEN RAISE EXCEPTION 'Fixture ordinary actor identity changed'; END IF;
 PERFORM co_test.raises(format('SELECT public.pilot_co_reports_page_v2(%L,NULL,''all'',1,20)',c),'42501','ordinary actor list denied');
 PERFORM co_test.raises(format('SELECT public.pilot_co_report_import_v1(%L,%L,%L)',c,month,latest),'42501','ordinary actor immutable manifest denied');
 PERFORM co_test.raises(format('SELECT public.pilot_co_evidence_selection_v1(NULL,%L,NULL)',latest),'42501','private evidence remains actor gated');
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM co_test.raises(format('SELECT public.pilot_co_report_import_v1(%L,%L,%L)',c,month,latest),'42501','unauthenticated source denied');
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM co_test.assert(snapshot=co_test.import_snapshot(c),'all workspace reads preserve accounting and private evidence');
END $workspace_reads$;

-- Task11 synthetic assertions. AUTHORED / NOT EXECUTED; no EXPLAIN evidence.
-- Search is a unique fixture namespace so neither customer nor exact-SKU filter
-- sees unrelated stock created by the composed posting fixture.
DO $stock_v2_filters$
DECLARE a uuid:=co_test.monthly_customer('task11-store-a'); b uuid:=co_test.monthly_customer('task11-store-b');
 lines jsonb; r jsonb; p jsonb; q jsonb; first_page jsonb; size integer; sort_key text; dir text; ord uuid;
 actor uuid:=auth.uid(); today date:=(statement_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
 SELECT jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'sku',CASE WHEN x=1 THEN 'TASK11-SCOPE-SHARED' ELSE 'TASK11-SCOPE-'||lpad(x::text,3,'0') END,'product_name','Task11 fixture item','ordered_quantity',1,'unit_price','100') ORDER BY x) INTO lines FROM generate_series(1,100)x;
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'create_co',jsonb_build_object('customer_id',a,'expected_customer_version','1','co_number','TASK11-COUNT-10','order_date',today,'lines',lines));ord:=(r->>'id')::uuid;
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'create_co',jsonb_build_object('customer_id',b,'expected_customer_version','1','co_number','TASK11-COUNT-2','order_date',today-1,'lines',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'sku','TASK11-SCOPE-SHARED','product_name','Task11 fixture item','ordered_quantity',1,'unit_price','200'))));
 p:=public.pilot_co_customer_stock_v2(NULL,NULL,'task11-scope',NULL,'sku','asc',1,100);
 PERFORM co_test.assert(p->>'total'='101' AND jsonb_array_length(p->'rows')=100 AND NOT p?'summary','neither customer nor SKU filter101, bounded page100, no incompatible-unit summary');
 PERFORM co_test.assert(public.pilot_co_customer_stock_v2(a,NULL,'task11-scope',NULL,'sku','asc',1,100)->>'total'='100','store A100 before pagination');
 PERFORM co_test.assert(public.pilot_co_customer_stock_v2(NULL,' TASK11-SCOPE-SHARED ','',NULL,'sku','asc',1,25)->>'total'='2','shared exact SKU across stores2');
 PERFORM co_test.assert(public.pilot_co_customer_stock_v2(a,'TASK11-SCOPE-SHARED','fixture',NULL,'sku','asc',1,25)->>'total'='1','store and exact SKU and name combined1');
 PERFORM co_test.assert(public.pilot_co_customer_stock_v2(a,'TASK11-SCOPE-NO-MATCH','',NULL,'sku','asc',1,25)->>'total'='0','no match0');
 PERFORM co_test.assert(public.pilot_co_customer_stock_v2(a,'TASK11-SCOPE-SHARED','no-match',NULL,'sku','asc',1,25)->>'total'='0','independent search does not erase exact SKU');
 FOREACH size IN ARRAY ARRAY[25,50,100] LOOP
  p:=public.pilot_co_customer_stock_v2(NULL,NULL,'task11-scope',NULL,'sku','asc',1,size);
  q:=public.pilot_co_customer_stock_v2(NULL,NULL,'task11-scope',NULL,'sku','asc',2,size);
  PERFORM co_test.assert(p->>'total'='101' AND q->>'total'='101' AND jsonb_array_length(p->'rows')=size,'exact full relation count across page sizes');
  PERFORM co_test.assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'rows') x JOIN jsonb_array_elements(q->'rows') y ON x->>'stock_key_id'=y->>'stock_key_id'),'no repeated row across pages');
 END LOOP;
 p:=public.pilot_co_customer_stock_v2(a,NULL,'',NULL,'balance','desc',5,25);
 PERFORM co_test.assert(p->>'total'='100' AND p->'rows'='[]'::jsonb,'out of range page retains exact full count');
 FOREACH sort_key IN ARRAY ARRAY['sku','balance'] LOOP FOREACH dir IN ARRAY ARRAY['asc','desc'] LOOP
  p:=public.pilot_co_customer_stock_v2(NULL,'TASK11-SCOPE-SHARED','',NULL,sort_key,dir,1,25);
  PERFORM co_test.assert(p->>'total'='2' AND p#>>'{rows,0,customer_id}'=least(a,b)::text AND p#>>'{rows,1,customer_id}'=greatest(a,b)::text,'equal sort keys always stable customer+stock-key tie break');
 END LOOP; END LOOP;
 -- Customer sort names differ: only SKU/balance are ties. Explicit customer name
 -- ordering is independently asserted below rather than pretending names tie.
 p:=public.pilot_co_customer_stock_v2(NULL,NULL,'task11-scope',NULL,'customer','asc',1,100);
 PERFORM co_test.assert(p#>>'{rows,0,customer_id}'=a::text,'customer sort uses checked store name');
 PERFORM co_test.assert(p#>>'{rows,0,unit}' IS NULL AND p#>>'{rows,0,contract_stock_value}' IS NULL AND p#>>'{rows,0,contract_currency}' IS NULL,'undeclared never-delivered stock has no inferred unit/value/currency');
 PERFORM co_test.assert(p#>>'{rows,0,recorded_quantity}'='0' AND NOT (p#>>'{rows,0,has_delivery_history}')::boolean,'never-delivered is honest zero, not customer-held history');
 FOREACH size IN ARRAY ARRAY[0,20,101] LOOP PERFORM co_test.raises(format('SELECT public.pilot_co_customer_stock_v2(NULL,NULL,'''',NULL,''sku'',''asc'',1,%s)',size),'22023','unsupported page size rejected');END LOOP;
 PERFORM co_test.raises('SELECT public.pilot_co_customer_stock_v2(NULL,NULL,'''',NULL,''price'',''asc'',1,25)','22023','sort allowlist');
 PERFORM co_test.raises('SELECT public.pilot_co_customer_stock_v2(NULL,NULL,'''',NULL,''sku'',''up'',1,25)','22023','direction allowlist');
 PERFORM co_test.raises('SELECT public.pilot_co_customer_stock_v2(NULL,'''','''',NULL,''sku'',''asc'',1,25)','22023','blank exact SKU rejected');
 PERFORM co_test.raises('SELECT public.pilot_co_customer_stock_v2(NULL,NULL,'''',NULL,''sku'',''asc'',0,25)','22023','positive page');
 p:=public.pilot_co_page_v2(NULL,'all','TASK11-COUNT','co_number','asc',1,25);
 PERFORM co_test.assert(p->>'total'='2' AND p#>>'{rows,0,co_number}'='TASK11-COUNT-10' AND p#>>'{rows,1,co_number}'='TASK11-COUNT-2','CO number has meaningful documented text sort, not creation order');
 PERFORM co_test.assert(p#>>'{rows,0,sku_count}'='100' AND p#>>'{rows,1,sku_count}'='1','SKU count from persisted distinct stock keys, never details/quantities');
 p:=public.pilot_co_page_v2(NULL,'all','TASK11-COUNT','order_date','asc',1,1);
 PERFORM co_test.assert(p->>'total'='2' AND p#>>'{rows,0,co_number}'='TASK11-COUNT-2','date ordering occurs before page limit');
 -- Duplicate-key lines are permitted in persisted schema; a fixture-only extra
 -- line proves distinct count, without depending on create-CO duplicate policy.
 INSERT INTO private.co_order_lines(id,co_id,customer_id,stock_key_id,ordered_quantity,unit_price)
 SELECT gen_random_uuid(),ord,a,l.stock_key_id,1,100 FROM private.co_order_lines l WHERE l.co_id=ord ORDER BY l.id LIMIT 1;
 PERFORM co_test.assert(public.pilot_co_page_v2(a,'all','TASK11-COUNT','co_number','asc',1,25)#>>'{rows,0,sku_count}'='100','duplicate-key lines count once even if undelivered');
 -- Synthetic empty persisted order: dimensionless count is zero, not unavailable.
 INSERT INTO private.co_orders(id,customer_id,co_number,order_date,created_by,sales_attributed_at,sales_attribution_state)
 VALUES(gen_random_uuid(),a,'TASK11-ZERO',today,actor,clock_timestamp(),'unassigned');
 PERFORM co_test.assert(public.pilot_co_page_v2(a,'all','TASK11-ZERO','order_date','desc',1,25)#>>'{rows,0,sku_count}'='0','zero persisted lines count0');
 PERFORM co_test.assert(NOT has_function_privilege('anon','public.pilot_co_customer_stock_v2(uuid,text,text,date,text,text,integer,integer)','EXECUTE') AND has_function_privilege('authenticated','public.pilot_co_customer_stock_v2(uuid,text,text,date,text,text,integer,integer)','EXECUTE'),'stock authenticated-only execute');
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-3')::uuid::text,true);
 PERFORM co_test.raises('SELECT public.pilot_co_customer_stock_v2(NULL,NULL,'''',NULL,''sku'',''asc'',1,25)','42501','ordinary PIC stock denied');
 PERFORM co_test.raises('SELECT public.pilot_co_page_v2(NULL,''all'','''',''order_date'',''asc'',1,25)','42501','ordinary PIC order list denied');
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM co_test.raises('SELECT public.pilot_co_customer_stock_v2(NULL,NULL,'''',NULL,''sku'',''asc'',1,25)','42501','unauthenticated stock denied');
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
END $stock_v2_filters$;

DO $stock_v2_batches$
DECLARE c uuid:=co_test.monthly_customer('task11-batch-store'); m date:=(date_trunc('month',statement_timestamp() AT TIME ZONE 'UTC')-interval '1 month')::date;
 first_co uuid; second_co uuid; d uuid; k uuid; ret jsonb; rp jsonb; p jsonb; r jsonb; snap jsonb;
BEGIN
 first_co:=co_test.monthly_delivery(c,'TASK11-BATCH-100','TASK11-BATCH-SKU',10,'100',(m-interval '1 month')::date);
 d:=co_test.report_init(c,(m-interval '1 month')::date);PERFORM co_test.report_zero(d);PERFORM co_test.report_post(d);
 second_co:=co_test.monthly_delivery(c,'TASK11-BATCH-200','TASK11-BATCH-SKU',5,'200',m);
 SELECT id INTO k FROM private.co_stock_keys WHERE customer_id=c;
 ret:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_return_draft',jsonb_build_object('customer_id',c,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'return_date',m+2,'reference','TASK11 unsold physical return','lines',jsonb_build_array(jsonb_build_object('batch_id',(SELECT id FROM private.co_stock_batches WHERE co_id=first_co),'quantity',2))));
 rp:=jsonb_build_object('draft_id',ret->>'id','expected_draft_version',ret->>'version','expected_customer_version',ret->>'customer_version','completed_report_drafts','[]'::jsonb,'acknowledged_reopen_orders','[]'::jsonb);
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'post_return',rp||jsonb_build_object('preview_fingerprint',public.pilot_co_preview_v1('post_return',rp)->>'preview_fingerprint'));
 d:=co_test.report_init(c,m);
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',co_test.report_input(d)||jsonb_build_object('action','upsert_lines','lines',jsonb_build_array(jsonb_build_object('stock_key_id',k,'sold_quantity',4))));
 PERFORM co_test.report_post(d);
 p:=public.pilot_co_customer_stock_v2(c,NULL,'',(m+interval '1 month -1 day')::date,'sku','asc',1,25);r:=p->'rows'->0;
 PERFORM co_test.assert(r->>'opening_quantity'='10' AND r->>'delivered_quantity'='5' AND r->>'sold_quantity'='4' AND r->>'returned_quantity'='2' AND r->>'recorded_quantity'='9','10+5-4-2=9, month flows versus cutoff balance');
 PERFORM co_test.assert(r->>'unit' IS NULL AND r->>'contract_stock_value' IS NULL AND r->>'unit_basis'='unknown','missing declaration is not inferred from CO or source prices');
 PERFORM public.pilot_co_declare_stock_key_unit_v1(gen_random_uuid(),jsonb_build_object('customer_id',c,'stock_key_id',k,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'expected_unit_version',NULL,'unit','PCS','reason','Explicit current integer ledger counter only','confirmed',true));
 snap:=co_test.import_snapshot(c);
 p:=public.pilot_co_customer_stock_v2(c,NULL,'',NULL,'balance','desc',1,25);r:=p->'rows'->0;
 PERFORM co_test.assert(r->>'recorded_quantity'='9' AND (r->>'contract_stock_value')::numeric=1400 AND r->>'contract_currency'='IDR' AND r->>'price_state'='mixed' AND r->>'contract_unit_price' IS NULL,'surviving4@100+5@200=1400, Beragam not9xlatest200');
 PERFORM co_test.assert(r->>'unit'='PCS' AND r->>'unit_basis'='declared_by_cutoff' AND r#>>'{unit_declaration,version}'='1','current declaration immutable provenance');
 p:=public.pilot_co_customer_stock_v2(c,NULL,'',(m+interval '1 month -1 day')::date,'sku','asc',1,25);r:=p->'rows'->0;
 PERFORM co_test.assert(r->>'unit' IS NULL AND r->>'contract_stock_value' IS NULL AND r->>'contract_currency' IS NULL AND r->>'unit_basis'='declared_after_cutoff' AND r#>>'{unit_declaration,unit}'='PCS','later declaration remains provenance only, no historical unit/value backfill');
 p:=public.pilot_co_customer_stock_v2(c,NULL,'',(m-interval '1 day')::date,'sku','asc',1,25);
 PERFORM co_test.assert(p#>>'{rows,0,recorded_quantity}'='10' AND p#>>'{rows,0,delivered_quantity}'='10','historical read excludes later delivery/sale/return, never uses current batch balance');
 PERFORM co_test.assert(snap=co_test.import_snapshot(c),'stock/order reads never mutate ledger/history/private evidence');
END $stock_v2_batches$;

-- UTC temporal predicate truth table independent of server/browser timezone.
SELECT co_test.assert(
 '2026-09-30T23:59:59.999999Z'::timestamptz < ('2026-10-01'::timestamp AT TIME ZONE 'UTC')
 AND NOT ('2026-10-01T00:00:00Z'::timestamptz < ('2026-10-01'::timestamp AT TIME ZONE 'UTC'))
 AND '2026-10-01T06:59:59.999999+07:00'::timestamptz < ('2026-10-01'::timestamp AT TIME ZONE 'UTC'),
 'UTC exclusive next-day declaration cutoff, including microseconds and WIB offset');

-- Future guarded execution captures underlying filter/count/page-core plans, not
-- a misleading EXPLAIN of only the PL/pgSQL RPC wrapper. These are authored plan
-- requests, NOT measured evidence. Full internal valuation/freshness profiling is
-- also outstanding; no speculative index is installed before observing plans.
CREATE TEMP TABLE task11_stock_read_plans(label text,plan jsonb);
DO $stock_v2_explain$
DECLARE a uuid:=(SELECT id FROM public.customers WHERE name='task11-store-a');
 c uuid; sku text; label text; plan jsonb;
 query text:=$plan$
 EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)
 WITH keys AS MATERIALIZED (
  SELECT k.id,k.customer_id,k.normalized_sku,cs.effective_generation_id generation_id
  FROM private.co_stock_keys k JOIN private.co_customer_state cs ON cs.customer_id=k.customer_id
  WHERE ($1::uuid IS NULL OR k.customer_id=$1) AND ($2::text IS NULL OR k.normalized_sku=$2)
   AND strpos(k.normalized_sku,'task11-scope')>0
 ), measured AS MATERIALIZED (
  SELECT k.*,q.recorded FROM keys k CROSS JOIN LATERAL (
   SELECT coalesce(sum(m.quantity_delta),0) recorded FROM private.co_stock_movements m
   WHERE m.customer_id=k.customer_id AND m.stock_key_id=k.id AND m.generation_id=k.generation_id
    AND m.effective_date<=(statement_timestamp() AT TIME ZONE 'UTC')::date
  ) q
 ), selected AS (
  SELECT * FROM measured ORDER BY normalized_sku COLLATE "C",customer_id,id LIMIT 100
 )
 SELECT (SELECT count(*) FROM measured),coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.normalized_sku COLLATE "C",s.customer_id,s.id) FROM selected s),'[]'::jsonb)
 $plan$;
BEGIN
 FOREACH label IN ARRAY ARRAY['neither-page100','customer-page100','sku-page100','both-page100'] LOOP
  c:=CASE WHEN label IN('customer-page100','both-page100') THEN a ELSE NULL END;
  sku:=CASE WHEN label IN('sku-page100','both-page100') THEN 'task11-scope-shared' ELSE NULL END;
  EXECUTE query INTO plan USING c,sku;
  INSERT INTO task11_stock_read_plans VALUES(label,plan);
 END LOOP;
END $stock_v2_explain$;
SELECT label,plan FROM task11_stock_read_plans ORDER BY label;

-- A4 exact source-owner read: real command setup, AUTHORED NOT EXECUTED.
-- No context-link equality substitute: reconstruct the stored full proposal under
-- the current actor and exercise every supported source-only operation.
CREATE FUNCTION co_test.source_proposal_retain(c uuid,m date,op text,core jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE proposal jsonb; result jsonb;
BEGIN
 proposal:=private.co_source_proposal_v1(c,op,core);
 result:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',jsonb_build_object('action','initialize','customer_id',c,'report_month',m,'expected_customer_version',core->>'expected_customer_version',
  'source_context',jsonb_build_object('operation',op,'payload',core,'source_context_fingerprint',proposal->>'source_context_fingerprint')));
 RETURN (result->>'id')::uuid;
END $$;
DO $source_proposal_exact$
DECLARE mode text; op text; c uuid; o uuid; l uuid; b uuid; source_draft uuid; retained uuid; primary_draft uuid; h uuid; original uuid; source_version text; cv text; dv text; core jsonb; proposal jsonb; result jsonb; receipt jsonb; retained_payload jsonb; source_payload jsonb; before_state jsonb; actor uuid:=auth.uid();
 m date:=(date_trunc('month',statement_timestamp() AT TIME ZONE 'UTC')-interval '1 month')::date; retained_month date:=date_trunc('month',statement_timestamp() AT TIME ZONE 'UTC')::date;
 reason text:=E'  exact stored reason\n';
BEGIN
 PERFORM co_test.assert(NOT has_function_privilege('anon','public.pilot_co_report_source_proposal_v1(uuid,text,uuid,text,text)','EXECUTE') AND NOT has_function_privilege('service_role','public.pilot_co_report_source_proposal_v1(uuid,text,uuid,text,text)','EXECUTE') AND has_function_privilege('authenticated','public.pilot_co_report_source_proposal_v1(uuid,text,uuid,text,text)','EXECUTE'),'source-proposal-ACL-authenticated-only');
 FOREACH mode IN ARRAY ARRAY['post_sj','replace_sj','void_sj','post_return','replace_return','void_return','report'] LOOP
  c:=co_test.monthly_customer('source-proposal-'||mode); source_draft:=NULL; primary_draft:=NULL; h:=NULL; original:=NULL;
  IF mode='post_sj' THEN
   l:=gen_random_uuid();receipt:=public.pilot_co_transaction_v1(gen_random_uuid(),'create_co',jsonb_build_object('customer_id',c,'expected_customer_version','1','co_number','A4-'||mode,'order_date',m,'lines',jsonb_build_array(jsonb_build_object('id',l,'sku','A4','product_name','A4','ordered_quantity',10,'unit_price','10'))));o:=(receipt->>'id')::uuid;
   receipt:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',jsonb_build_object('co_id',o,'expected_co_version','1','expected_customer_version',receipt->>'customer_version','sj_number','A4-SJ','sj_date',m,'lines',jsonb_build_array(jsonb_build_object('co_line_id',l,'quantity',10))));source_draft:=(receipt->>'id')::uuid;
   op:='post_sj';core:=jsonb_build_object('draft_id',source_draft,'expected_draft_version',receipt->>'version','expected_co_version','1');
  ELSE
   o:=co_test.monthly_delivery(c,'A4-'||mode,'A4',10,'10',m);SELECT id INTO l FROM private.co_order_lines WHERE co_id=o;SELECT id INTO b FROM private.co_stock_batches WHERE co_id=o;
   IF mode IN('replace_sj','void_sj') THEN
    SELECT id,current_revision_id,version::text INTO h,original,source_version FROM private.co_delivery_heads WHERE co_id=o;
    op:='correct_sj';core:=jsonb_build_object('delivery_head_id',h,'original_revision_id',original,'expected_delivery_version',source_version,'expected_co_version','1','action',CASE mode WHEN 'replace_sj' THEN 'replace' ELSE 'void' END);
    IF mode='replace_sj' THEN
     receipt:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',jsonb_build_object('co_id',o,'expected_co_version','1','expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'delivery_head_id',h,'original_revision_id',original,'expected_delivery_version',source_version,'sj_number','SJ-A4-'||mode,'sj_date',m,'lines',jsonb_build_array(jsonb_build_object('co_line_id',l,'quantity',8))));source_draft:=(receipt->>'id')::uuid;
     core:=core||jsonb_build_object('draft_id',source_draft,'expected_draft_version',receipt->>'version');
    END IF;
   ELSIF mode='report' THEN
    primary_draft:=co_test.report_init(c,m);PERFORM co_test.report_zero(primary_draft);PERFORM co_test.report_post(primary_draft);
    SELECT id,current_revision_id,version::text INTO h,original,source_version FROM private.co_report_heads WHERE customer_id=c AND report_month=m;
    receipt:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',(co_test.report_input(primary_draft)-'eligible_set_fingerprint')||jsonb_build_object('action','initialize','customer_id',c,'report_month',m));
    op:='correct_report';core:=co_test.report_input(primary_draft)||jsonb_build_object('report_head_id',h,'original_revision_id',original,'expected_report_version',source_version);
   ELSE
    receipt:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_return_draft',jsonb_build_object('customer_id',c,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'return_date',m+1,'reference','A4-physical','lines',jsonb_build_array(jsonb_build_object('batch_id',b,'quantity',2))));source_draft:=(receipt->>'id')::uuid;
    core:=jsonb_build_object('draft_id',source_draft,'expected_draft_version',receipt->>'version','expected_customer_version',receipt->>'customer_version','reason',reason);
    IF mode='post_return' THEN op:='post_return';
    ELSE
     proposal:=public.pilot_co_preview_v1('post_return',core||jsonb_build_object('completed_report_drafts','[]'::jsonb,'acknowledged_reopen_orders','[]'::jsonb));
     receipt:=public.pilot_co_transaction_v1(gen_random_uuid(),'post_return',core||jsonb_build_object('completed_report_drafts','[]'::jsonb,'acknowledged_reopen_orders','[]'::jsonb,'preview_fingerprint',proposal->>'preview_fingerprint'));
     SELECT current_revision_id,version::text INTO original,source_version FROM private.co_return_heads WHERE id=(receipt->>'id')::uuid;h:=(receipt->>'id')::uuid;source_draft:=NULL;
     op:='correct_return';core:=jsonb_build_object('return_head_id',h,'original_revision_id',original,'expected_return_version',source_version,'action',CASE mode WHEN 'replace_return' THEN 'replace' ELSE 'void' END);
     IF mode='replace_return' THEN core:=core||jsonb_build_object('return_date',m+1,'reference',' retained ','notes',NULL,'lines',jsonb_build_array(jsonb_build_object('batch_id',b,'quantity',1)));END IF;
    END IF;
   END IF;
  END IF;
  cv:=(SELECT version::text FROM private.co_customer_state WHERE customer_id=c);core:=core||jsonb_build_object('expected_customer_version',cv,'reason',reason);
  retained:=co_test.source_proposal_retain(c,retained_month,op,core);SELECT x.version::text,x.payload INTO dv,retained_payload FROM private.co_drafts x WHERE x.id=retained;
  before_state:=co_test.import_snapshot(c);
  result:=public.pilot_co_report_source_proposal_v1(c,retained_month::text,retained,dv,cv);
  PERFORM co_test.assert(result->'source_context'=retained_payload->'source_context' AND result#>'{source_context,payload}'=core AND result#>>'{source_context,operation}'=op,'source-proposal-current-actor exact full retained context '||mode);
  PERFORM co_test.assert(result#>>'{source_context,payload,reason}'=reason,'source-proposal-reason-byte-exact '||mode);
  IF mode LIKE '%sj' THEN PERFORM co_test.assert(result#>>'{owner,kind}'='delivery' AND result#>>'{owner,co_id}'=o::text AND result#>'{owner,report_month}'='null'::jsonb,'source-proposal-delivery-primary');
  ELSIF mode='report' THEN PERFORM co_test.assert(result#>>'{owner,kind}'='report' AND result#>>'{owner,report_month}'=m::text AND result#>'{owner,co_id}'='null'::jsonb,'source-proposal-report-primary');
  ELSE PERFORM co_test.assert(result#>>'{owner,kind}'='return' AND result#>'{owner,co_id}'='null'::jsonb,'source-proposal-return-primary');END IF;
  PERFORM co_test.raises(format('SELECT public.pilot_co_report_source_proposal_v1(%L,%L,%L,%L,%L)',c,retained_month,retained,(dv::bigint+1)::text,cv),'PT409','source-proposal-stale-draft');
  PERFORM set_config('request.jwt.claim.sub',md5('co-user-2')::uuid::text,true);
  PERFORM co_test.raises(format('SELECT public.pilot_co_report_source_proposal_v1(%L,%L,%L,%L,%L)',c,retained_month,retained,dv,cv),'PT409','source-proposal-other-actor fingerprint includes actor');
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM co_test.raises(format('SELECT public.pilot_co_report_source_proposal_v1(%L,%L,%L,%L,%L)',c,retained_month,retained,dv,(cv::bigint+1)::text),'PT409','source-proposal-stale-customer');
  PERFORM set_config('request.jwt.claim.sub',md5('co-user-3')::uuid::text,true);
  PERFORM co_test.raises(format('SELECT public.pilot_co_report_source_proposal_v1(%L,%L,%L,%L,%L)',c,retained_month,retained,dv,cv),'42501','source-proposal-authority-loss');
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  IF source_draft IS NOT NULL THEN
   SELECT x.payload INTO source_payload FROM private.co_drafts x WHERE x.id=source_draft;
   -- Rollback-only source consumption/version probes with unchanged outer pins.
   UPDATE private.co_drafts SET payload=source_payload||jsonb_build_object(CASE WHEN kind='sj' THEN 'posted_delivery_head_id' ELSE 'posted_return_head_id' END,gen_random_uuid()) WHERE id=source_draft;
   PERFORM co_test.raises(format('SELECT public.pilot_co_report_source_proposal_v1(%L,%L,%L,%L,%L)',c,retained_month,retained,dv,cv),'PT409','source-proposal-consumed-source');
   UPDATE private.co_drafts SET payload=source_payload,version=version+1 WHERE id=source_draft;
   PERFORM co_test.raises(format('SELECT public.pilot_co_report_source_proposal_v1(%L,%L,%L,%L,%L)',c,retained_month,retained,dv,cv),'PT409','source-proposal-stale-source');
   UPDATE private.co_drafts SET version=version-1 WHERE id=source_draft;
  END IF;
  -- Rollback-only corruption probes, never supported writer paths: unchanged
  -- public link cannot conceal edited reason, unsupported operation or consumption.
  UPDATE private.co_drafts SET payload=jsonb_set(payload,'{source_context,payload,reason}',to_jsonb(btrim(reason))) WHERE id=retained;
  PERFORM co_test.raises(format('SELECT public.pilot_co_report_source_proposal_v1(%L,%L,%L,%L,%L)',c,retained_month,retained,dv,cv),'PT409','source-proposal-changed-reason fingerprint refused');
  UPDATE private.co_drafts SET payload=retained_payload WHERE id=retained;
  UPDATE private.co_drafts SET payload=jsonb_set(payload,'{source_context,operation}','"post_report"') WHERE id=retained;
  PERFORM co_test.raises(format('SELECT public.pilot_co_report_source_proposal_v1(%L,%L,%L,%L,%L)',c,retained_month,retained,dv,cv),'PT409','source-proposal-unsupported');
  UPDATE private.co_drafts SET payload=retained_payload||jsonb_build_object('posted_report_head_id',gen_random_uuid()) WHERE id=retained;
  PERFORM co_test.raises(format('SELECT public.pilot_co_report_source_proposal_v1(%L,%L,%L,%L,%L)',c,retained_month,retained,dv,cv),'PT409','source-proposal-consumed');
  UPDATE private.co_drafts SET payload=retained_payload WHERE id=retained;
  PERFORM co_test.assert(before_state=co_test.import_snapshot(c),'source-proposal-read-and-refusals-do-not-mutate');
 END LOOP;
END $source_proposal_exact$;

DO $source_proposal_import_origin$
DECLARE setup jsonb; c uuid; d uuid; retained uuid; m date; core jsonb; posted jsonb; opened jsonb; dv text; cv text; before_state jsonb;
BEGIN
 setup:=co_test.import_setup('source-proposal-import-origin');c:=(setup->>'customerId')::uuid;d:=(setup->>'draftId')::uuid;m:=(setup->>'month')::date;
 posted:=co_test.import_post_payload(setup->'binding');PERFORM public.pilot_co_import_commit_v1((posted->>'requestId')::uuid,posted);
 opened:=public.pilot_co_import_review_v1(gen_random_uuid(),co_test.import_review_payload(d));
 SELECT co_test.report_input(d)||jsonb_build_object('report_head_id',h.id,'original_revision_id',h.current_revision_id,'expected_report_version',h.version::text,'reason','Original ordinary core cannot carry immutable import commit binding') INTO core FROM private.co_report_heads h WHERE customer_id=c AND report_month=m;
 retained:=co_test.source_proposal_retain(c,(m+interval '1 month')::date,'correct_report',core);
 SELECT x.version::text,s.version::text INTO dv,cv FROM private.co_drafts x JOIN private.co_customer_state s ON s.customer_id=x.customer_id WHERE x.id=retained;
 before_state:=co_test.import_snapshot(c);
 PERFORM co_test.raises(format('SELECT public.pilot_co_report_source_proposal_v1(%L,%L,%L,%L,%L)',c,(m+interval '1 month')::date,retained,dv,cv),'PT409','source-proposal-import-origin-primary-unavailable-without-original-binding');
 PERFORM co_test.assert(before_state=co_test.import_snapshot(c),'source-proposal-import-origin-no-reprepare-or-guard-bypass');
END $source_proposal_import_origin$;

-- A5 candidate fixtures: AUTHORED, NOT EXECUTED. These extend the same guarded
-- rollback transaction; no knowledge-time snapshot is created by the reader.
DO $a5_restated_composition$
DECLARE c uuid:=co_test.monthly_customer('A5-batches'); other uuid:=co_test.monthly_customer('A5-foreign');
 m date:=(date_trunc('month',statement_timestamp() AT TIME ZONE 'UTC')-interval '2 months')::date;
 n date; cutoff date; first_co uuid; second_co uuid; first_batch uuid; k uuid; d uuid; p jsonb; parent jsonb; detail jsonb; current_detail jsonb; cv text; g uuid; oldcv text; oldg uuid; core jsonb; original uuid; head uuid; hv text; actor uuid:=auth.uid(); snap jsonb; unit_request uuid:=gen_random_uuid(); unit_id uuid:=gen_random_uuid(); unit_payload jsonb;
BEGIN
 n:=(m+interval '1 month')::date;cutoff:=n-1;
 first_co:=co_test.monthly_delivery(c,'A5-100','A5-SKU',10,'0.01',m);
 second_co:=co_test.monthly_delivery(c,'A5-200','A5-SKU',5,'0.02',m);
 SELECT id INTO k FROM private.co_stock_keys WHERE customer_id=c;SELECT id INTO first_batch FROM private.co_stock_batches WHERE co_id=first_co;
 d:=co_test.report_init(c,m);
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',co_test.report_input(d)||jsonb_build_object('action','upsert_lines','lines',jsonb_build_array(jsonb_build_object('stock_key_id',k,'sold_quantity',6))));PERFORM co_test.report_post(d);
 d:=co_test.report_init(c,n);
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',co_test.report_input(d)||jsonb_build_object('action','upsert_lines','lines',jsonb_build_array(jsonb_build_object('stock_key_id',k,'sold_quantity',4))));PERFORM co_test.report_post(d);
 -- Probe the real current declaration in a rolled-back subtransaction first.
 BEGIN
  PERFORM public.pilot_co_declare_stock_key_unit_v1(gen_random_uuid(),jsonb_build_object('customer_id',c,'stock_key_id',k,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'expected_unit_version',NULL,'unit','PCS','reason','A5 explicit ledger counter','confirmed',true));
  SELECT version::text,effective_generation_id INTO cv,g FROM private.co_customer_state WHERE customer_id=c;
  PERFORM co_test.raises(format('SELECT public.pilot_co_customer_batches_v2(%L,%L,%L,%L,%L,1,25)',c,k,cutoff,cv,g),'PT409','A5-later-unit-unavailable');
  RAISE EXCEPTION 'rollback only the current declaration probe' USING ERRCODE='PZA51';
 EXCEPTION WHEN SQLSTATE 'PZA51' THEN NULL;
 END;
 -- Explicit historical fixture INSERT: there is intentionally no public backdate
 -- writer. Never UPDATE immutable evidence or disable its guards. Complete the
 -- ordinary command envelope around this test-only early declared_at insertion.
 unit_payload:=jsonb_build_object('customer_id',c,'stock_key_id',k,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'expected_unit_version',NULL,'unit','PCS','reason','A5 retained early fixture declaration','confirmed',true);
 PERFORM private.co_command_begin_v1(unit_request,'declare_stock_key_unit',unit_payload);
 INSERT INTO private.co_stock_key_unit_declarations(id,customer_id,stock_key_id,unit,declared_by,declared_at,request_id,reason) VALUES(unit_id,c,k,'PCS',actor,m::timestamp AT TIME ZONE 'UTC',unit_request,'A5 retained early fixture declaration');
 UPDATE private.co_customer_state SET version=version+1 WHERE customer_id=c;
 SELECT version::text,effective_generation_id INTO cv,g FROM private.co_customer_state WHERE customer_id=c;
 INSERT INTO private.co_audit_events(customer_id,actor_id,request_id,operation,reason,before_state,after_state)
 VALUES(c,actor,unit_request,'declare_stock_key_unit','A5 retained early fixture declaration',jsonb_build_object('state','unknown','stock_key_id',k),(SELECT to_jsonb(x) FROM private.co_stock_key_unit_declarations x WHERE id=unit_id));
 PERFORM private.co_command_commit_v1(unit_request,jsonb_build_object('id',unit_id,'operation','declare_stock_key_unit','version','1','customer_id',c,'customer_version',cv));
 snap:=co_test.import_snapshot(c);
 p:=public.pilot_co_customer_stock_v2(c,NULL,'',cutoff,'sku','asc',1,25);parent:=p->'rows'->0;
 detail:=public.pilot_co_customer_batches_v2(c,k,cutoff,cv,g,1,25);
 PERFORM co_test.assert(detail->>'total'='2' AND detail->>'recorded_quantity'='9' AND (detail->>'contract_stock_value')::numeric=0.14 AND detail->>'recorded_quantity'=parent->>'recorded_quantity' AND (detail->>'contract_stock_value')::numeric=(parent->>'contract_stock_value')::numeric,'A5-historical-parent-equality');
 PERFORM co_test.assert((SELECT sum((r->>'available_quantity')::numeric)=9 AND sum((r->>'contract_value')::numeric)=0.14 FROM jsonb_array_elements(detail->'rows') r),'A5-exact-decimal-value');
 current_detail:=public.pilot_co_customer_batches_v2(c,k,(statement_timestamp() AT TIME ZONE 'UTC')::date,cv,g,1,25);
 PERFORM co_test.assert(current_detail->>'total'='1' AND current_detail->>'recorded_quantity'='5' AND current_detail#>>'{rows,0,id}' IS DISTINCT FROM first_batch::text AND (current_detail->>'contract_stock_value')::numeric=0.10,'A5-current-exhausted-filtered-before-page');
 PERFORM co_test.assert(snap=co_test.import_snapshot(c),'A5-reads-no-writes');
 PERFORM co_test.raises(format('SELECT public.pilot_co_customer_batches_v2(%L,%L,%L,%L,%L,1,25)',other,k,cutoff,'1',g),'PT409','A5-wrong-key-customer generation refuses foreign scope');
 PERFORM co_test.raises(format('SELECT public.pilot_co_customer_batches_v2(%L,%L,%L,%L,%L,1,25)',c,gen_random_uuid(),cutoff,cv,g),'22023','A5-wrong-key-customer');
 PERFORM co_test.raises(format('SELECT public.pilot_co_customer_batches_v2(%L,%L,%L,%L,%L,1,20)',c,k,cutoff,cv,g),'22023','A5-invalid-page-size');
 PERFORM co_test.raises(format('SELECT public.pilot_co_customer_batches_v2(%L,%L,%L,%L,%L,1,25)',c,k,(statement_timestamp() AT TIME ZONE 'UTC')::date+1,cv,g),'22023','A5-future-cutoff');
 -- Correct an earlier report using the existing reviewed command and replay.
 oldcv:=cv;oldg:=g;SELECT id INTO d FROM private.co_drafts WHERE customer_id=c AND report_month=m AND kind='report';
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',(co_test.report_input(d)-'eligible_set_fingerprint')||jsonb_build_object('action','initialize','customer_id',c,'report_month',m));
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',co_test.report_input(d)||jsonb_build_object('action','upsert_lines','lines',jsonb_build_array(jsonb_build_object('stock_key_id',k,'sold_quantity',5))));
 SELECT id,current_revision_id,version::text INTO head,original,hv FROM private.co_report_heads WHERE customer_id=c AND report_month=m;
 core:=co_test.report_input(d)||jsonb_build_object('report_head_id',head,'original_revision_id',original,'expected_report_version',hv,'reason','A5 restatement','completed_report_drafts','[]'::jsonb,'acknowledged_reopen_orders','[]'::jsonb);
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'correct_report',core||jsonb_build_object('preview_fingerprint',public.pilot_co_preview_v1('correct_report',core)->>'preview_fingerprint'));
 SELECT version::text,effective_generation_id INTO cv,g FROM private.co_customer_state WHERE customer_id=c;
 PERFORM co_test.raises(format('SELECT public.pilot_co_customer_batches_v2(%L,%L,%L,%L,%L,1,25)',c,k,cutoff,cv,oldg),'PT409','A5-stale-generation');
 PERFORM co_test.raises(format('SELECT public.pilot_co_customer_batches_v2(%L,%L,%L,%L,%L,1,25)',c,k,cutoff,oldcv,g),'PT409','A5-stale-customer-version');
 detail:=public.pilot_co_customer_batches_v2(c,k,cutoff,cv,g,1,25);p:=public.pilot_co_customer_stock_v2(c,NULL,'',cutoff,'sku','asc',1,25);
 PERFORM co_test.assert(g<>oldg AND detail->>'recorded_quantity'='10' AND (detail->>'contract_stock_value')::numeric=0.15 AND detail->>'recorded_quantity'=p#>>'{rows,0,recorded_quantity}' AND (detail->>'contract_stock_value')::numeric=(p#>>'{rows,0,contract_stock_value}')::numeric,'A5-restated-generation');
 PERFORM co_test.assert(NOT has_function_privilege('anon','public.pilot_co_customer_batches_v2(uuid,uuid,date,text,uuid,integer,integer)','EXECUTE') AND NOT has_function_privilege('service_role','public.pilot_co_customer_batches_v2(uuid,uuid,date,text,uuid,integer,integer)','EXECUTE') AND has_function_privilege('authenticated','public.pilot_co_customer_batches_v2(uuid,uuid,date,text,uuid,integer,integer)','EXECUTE'),'A5-batches-ACL');
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-3')::uuid::text,true);
 PERFORM co_test.raises(format('SELECT public.pilot_co_customer_batches_v2(%L,%L,%L,%L,%L,1,25)',c,k,cutoff,cv,g),'42501','A5-authority-denied');
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
END $a5_restated_composition$;

DO $a5_batch_pages_and_labels$
DECLARE c uuid:=co_test.monthly_customer('A5-pages'); day date:=(statement_timestamp() AT TIME ZONE 'UTC')::date;
 o uuid; first_co uuid; k uuid; l uuid; b uuid; h uuid; original uuid; retained uuid; unrepresented uuid; cv text; g uuid; hv text; core jsonb; saved jsonb; p jsonb; q jsonb; expected jsonb; i integer;
BEGIN
 FOR i IN 1..26 LOOP
  o:=co_test.monthly_delivery(c,'A5-PAGE-'||i,'A5-PAGE-SKU',1,CASE WHEN i%2=0 THEN '0.02' ELSE '0.01' END,day);IF i=1 THEN first_co:=o;END IF;
 END LOOP;
 SELECT id INTO k FROM private.co_stock_keys WHERE customer_id=c;
 PERFORM public.pilot_co_declare_stock_key_unit_v1(gen_random_uuid(),jsonb_build_object('customer_id',c,'stock_key_id',k,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'expected_unit_version',NULL,'unit','PCS','reason','A5 page counter','confirmed',true));
 SELECT version::text,effective_generation_id INTO cv,g FROM private.co_customer_state WHERE customer_id=c;
 p:=public.pilot_co_customer_batches_v2(c,k,day,cv,g,1,25);q:=public.pilot_co_customer_batches_v2(c,k,day,cv,g,2,25);
 SELECT jsonb_agg(id::text ORDER BY original_delivery_created_order,id) INTO expected FROM private.co_stock_batches WHERE customer_id=c;
 PERFORM co_test.assert(p->>'total'='26' AND q->>'total'='26' AND p->>'recorded_quantity'='26' AND q->>'recorded_quantity'='26' AND (p->>'contract_stock_value')::numeric=0.39 AND p->>'contract_stock_value'=q->>'contract_stock_value' AND jsonb_array_length(p->'rows')=25 AND jsonb_array_length(q->'rows')=1 AND (SELECT jsonb_agg(r->>'id' ORDER BY ordinal) FROM jsonb_array_elements((p->'rows')||(q->'rows')) WITH ORDINALITY x(r,ordinal))=expected,'A5-page-tie-order');
 -- Publish a genuine SJ replacement. Its retained generation revision must be the
 -- label source even if a rollback-only head-pointer probe points to the old one.
 SELECT id,current_revision_id,version::text INTO h,original,hv FROM private.co_delivery_heads WHERE co_id=first_co;
 SELECT id INTO l FROM private.co_order_lines WHERE co_id=first_co;
 saved:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',jsonb_build_object('co_id',first_co,'expected_co_version','1','expected_customer_version',cv,'delivery_head_id',h,'original_revision_id',original,'expected_delivery_version',hv,'sj_number','A5-RETAINED-REPLACEMENT','sj_date',day,'lines',jsonb_build_array(jsonb_build_object('co_line_id',l,'quantity',1))));
 core:=jsonb_build_object('expected_customer_version',cv,'expected_co_version','1','delivery_head_id',h,'original_revision_id',original,'expected_delivery_version',hv,'action','replace','draft_id',saved->>'id','expected_draft_version',saved->>'version','reason','A5 retained source identity','completed_report_drafts','[]'::jsonb,'acknowledged_reopen_orders','[]'::jsonb);
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'correct_sj',core||jsonb_build_object('preview_fingerprint',public.pilot_co_preview_v1('correct_sj',core)->>'preview_fingerprint'));
 SELECT current_revision_id INTO retained FROM private.co_delivery_heads WHERE id=h;SELECT version::text,effective_generation_id INTO cv,g FROM private.co_customer_state WHERE customer_id=c;
 -- A forward-only, rollback-only pointer probe: the new revision is deliberately
 -- not represented in the pinned generation. Do not move a sealed head backward.
 INSERT INTO private.co_delivery_revisions(head_id,customer_id,co_id,revision_no,sj_number,sj_date,is_void,reason,created_by)
 SELECT head_id,customer_id,co_id,revision_no+1,'A5-UNREPRESENTED-CURRENT',sj_date,false,'A5 pointer-only probe',created_by FROM private.co_delivery_revisions WHERE id=retained RETURNING id INTO unrepresented;
 UPDATE private.co_delivery_heads SET current_revision_id=unrepresented WHERE id=h;
 p:=public.pilot_co_customer_batches_v2(c,k,day,cv,g,1,25);
 PERFORM co_test.assert(p#>>'{rows,0,delivery_revision_id}'=retained::text AND p#>>'{rows,0,sj_number}'='A5-RETAINED-REPLACEMENT','A5-retained-revision-not-current-head');
 -- The entire fixture transaction rolls back; no backward restore is attempted.
END $a5_batch_pages_and_labels$;
