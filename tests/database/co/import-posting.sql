-- Guarded disposable fixture only. AUTHORED, NOT EXECUTED on PostgreSQL.
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


SELECT co_test.assert(to_regclass('private.co_evidence') IS NOT NULL,'private evidence lifecycle exists');
CREATE FUNCTION co_test.evidence_register(d uuid, request uuid DEFAULT gen_random_uuid(), hash text DEFAULT repeat('a',64)) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.pilot_co_evidence_transaction_v1(request,'register_evidence',jsonb_build_object('draft_id',d,'expected_draft_version',x.version::text,'expected_customer_version',s.version::text,'filename','original.pdf','mime_type','application/pdf','byte_size',100,'sha256',hash))
 FROM private.co_drafts x JOIN private.co_customer_state s USING(customer_id) WHERE x.id=d;
$$;
CREATE FUNCTION co_test.attest(e uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE ctx jsonb; oid uuid;
BEGIN
 ctx:=public.pilot_co_evidence_context_v1(e,'upload');
 INSERT INTO storage.objects(bucket_id,name,metadata,version) VALUES('co-evidence',ctx->>'path',jsonb_build_object('size',100,'mimetype','application/pdf'),'synthetic-v1') RETURNING id INTO oid;
 PERFORM public.pilot_co_evidence_attest_v1((ctx->>'actor_id')::uuid,e,oid,'synthetic-v1',100,'application/pdf',(SELECT sha256 FROM private.co_evidence WHERE id=e));
END $$;
CREATE FUNCTION co_test.evidence_finalize(e uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.pilot_co_evidence_transaction_v1(gen_random_uuid(),'finalize_evidence',jsonb_build_object('evidence_id',e,'expected_evidence_version',x.version::text,'expected_draft_version',x.draft_version::text,'expected_customer_version',x.customer_version::text)) FROM private.co_evidence x WHERE id=e;
$$;

-- One synthetic reviewed source reused by the lifecycle and publication fixtures.
CREATE FUNCTION co_test.import_manifest(c uuid,m date,e uuid,k uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE source_row jsonb; manifest jsonb;
BEGIN
 source_row:=jsonb_build_object('id','r1','ref',jsonb_build_object('fileSha256',repeat('a',64),'page',1,'sheet',null,'row','1','section','s1'),'sourceSku','SYNTHETIC','name','Synthetic','transactionDate',null,'transactionReference',null,'quantity',jsonb_build_object('raw','2','decimal','2','convention','decimal_dot'),'returned',null,'unit','PCS','unitPrice',jsonb_build_object('raw','3','decimal','3','convention','decimal_dot'),'discount',null,'discountBasis',null,'netUnitPrice',null,'amount',jsonb_build_object('raw','6','decimal','6','convention','decimal_dot'),'currency','IDR','priceBasisLabel',null,'flags','[]'::jsonb);
 manifest:=jsonb_build_object('schemaVersion',1,'evidenceId',e,'digest','', 'input',jsonb_build_object('scope',jsonb_build_object('actorId',auth.uid(),'customerId',c,'reportMonth',m,'epoch',1),'extracted',jsonb_build_object('sha256',repeat('a',64),'format','pdf','parserVersion','synthetic','sourceRows',jsonb_build_array(source_row),'sections',jsonb_build_array(jsonb_build_object('id','s1','label','Synthetic','rowIds',jsonb_build_array('r1'),'printedTotal',jsonb_build_object('raw','6','decimal','6','convention','decimal_dot'))),'periodCandidates',jsonb_build_array(m),'customerCandidates','[]'::jsonb,'warnings','[]'::jsonb),'mappings',jsonb_build_array(jsonb_build_object('rowId','r1','stockKeyId',k,'ledgerUnit','PCS','quantity','2','conversion',null,'included',true,'exclusionReason',null,'confirmed',true)),'returns','[]'::jsonb,'includedSectionIds',jsonb_build_array('s1'),'completenessConfirmed',true,'omittedZeroStockKeyIds','[]'::jsonb,'currency','IDR','reason',null));
 manifest:=jsonb_set(manifest,'{digest}',to_jsonb(private.co_manifest_digest_v1(manifest)));
 RETURN manifest;
END $$;
CREATE FUNCTION co_test.import_quantity(manifest jsonb,q integer,reason text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
 manifest:=jsonb_set(manifest,'{input,extracted,sourceRows,0,quantity}',jsonb_build_object('raw',q::text,'decimal',q::text,'convention','decimal_dot'));
 manifest:=jsonb_set(manifest,'{input,mappings,0,quantity}',to_jsonb(q::text));
 manifest:=jsonb_set(manifest,'{input,extracted,sourceRows,0,amount}',jsonb_build_object('raw',(q*3)::text,'decimal',(q*3)::text,'convention','decimal_dot'));
 manifest:=jsonb_set(manifest,'{input,extracted,sections,0,printedTotal}',jsonb_build_object('raw',(q*3)::text,'decimal',(q*3)::text,'convention','decimal_dot'));
 manifest:=jsonb_set(manifest,'{input,reason}',coalesce(to_jsonb(reason),'null'));
 RETURN jsonb_set(manifest,'{digest}',to_jsonb(private.co_manifest_digest_v1(manifest)));
END $$;
CREATE FUNCTION co_test.import_prepare(d uuid,q integer,selection uuid DEFAULT NULL,reason text DEFAULT NULL,evidence_hash text DEFAULT repeat('a',64)) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE e uuid; c uuid; month date; k uuid; m jsonb; p jsonb;
BEGIN
 SELECT customer_id,report_month INTO c,month FROM private.co_drafts WHERE id=d;
 SELECT id INTO k FROM private.co_stock_keys WHERE customer_id=c;
 e:=(co_test.evidence_register(d,gen_random_uuid(),evidence_hash)->>'id')::uuid;PERFORM co_test.attest(e);PERFORM co_test.evidence_finalize(e);
 m:=co_test.import_quantity(co_test.import_manifest(c,month,e,k),q,reason);
 m:=jsonb_set(jsonb_set(m,'{input,extracted,sha256}',to_jsonb(evidence_hash)),'{input,extracted,sourceRows,0,ref,fileSha256}',to_jsonb(evidence_hash));
 m:=jsonb_set(m,'{digest}',to_jsonb(private.co_manifest_digest_v1(m)));
 p:=jsonb_build_object('manifest',m,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'expected_draft_version',(SELECT version::text FROM private.co_drafts WHERE id=d),'expected_evidence_version','2');
 IF selection IS NOT NULL THEN p:=p||jsonb_build_object('expected_selection_id',selection); END IF;
 RETURN public.pilot_co_import_prepare_v1(gen_random_uuid(),p);
END $$;
CREATE FUNCTION co_test.import_setup(label text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c uuid:=co_test.monthly_customer(label); m date:=(date_trunc('month',now())-interval '1 month')::date; k uuid; d uuid; binding jsonb;
BEGIN
 INSERT INTO auth.users(id) VALUES(md5(label||'-pic-a')::uuid),(md5(label||'-pic-b')::uuid);
 INSERT INTO public.users(id,full_name,email,role) VALUES(md5(label||'-pic-a')::uuid,'Import A',label||'-a@example.invalid','sales_person'),(md5(label||'-pic-b')::uuid,'Import B',label||'-b@example.invalid','sales_person');
 INSERT INTO public.customer_manager_assignments(customer_id,manager_id,assigned_by) VALUES(c,md5(label||'-pic-a')::uuid,auth.uid());
 PERFORM co_test.monthly_delivery(c,label||'-A','SYNTHETIC',4,'100',m);
 UPDATE public.customer_manager_assignments SET manager_id=md5(label||'-pic-b')::uuid WHERE customer_id=c;
 PERFORM co_test.monthly_delivery(c,label||'-B','SYNTHETIC',6,'200',m+1);
 SELECT id INTO k FROM private.co_stock_keys WHERE customer_id=c;
 PERFORM public.pilot_co_declare_stock_key_unit_v1(gen_random_uuid(),jsonb_build_object('customer_id',c,'stock_key_id',k,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'expected_unit_version',NULL,'unit','PCS','reason','Synthetic explicit counter','confirmed',true));
 d:=co_test.report_init(c,m);binding:=co_test.import_prepare(d,5);
 RETURN jsonb_build_object('customerId',c,'draftId',d,'month',m,'binding',binding);
END $$;
CREATE FUNCTION co_test.import_post_payload(binding jsonb,mode text DEFAULT 'post',reason text DEFAULT NULL,request uuid DEFAULT gen_random_uuid()) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('binding',binding,'previewFingerprint',public.pilot_co_import_preview_v1((binding->>'importId')::uuid,binding->>'importVersion')->>'previewFingerprint','requestId',request,'mode',mode,'reason',reason);
$$;
CREATE FUNCTION co_test.import_review_payload(d uuid,action text DEFAULT 'open') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('draft_id',d,'expected_draft_version',s->>'draftVersion','expected_customer_version',s->>'customerVersion','expected_selection_id',s->>'selectionId','original_revision_id',s->'originalRevisionId','expected_report_version',s->'reportVersion','action',action,'reason','Synthetic edit/review') FROM (SELECT public.pilot_co_import_selection_v1(d) s) q;
$$;
CREATE FUNCTION co_test.import_snapshot(c uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('state',(SELECT to_jsonb(x) FROM private.co_customer_state x WHERE customer_id=c),
 'heads',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.co_report_heads x WHERE customer_id=c),
 'drafts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.co_drafts x WHERE customer_id=c),
 'revisions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.co_report_revisions x WHERE customer_id=c),
 'allocations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.co_sale_allocations x WHERE customer_id=c),
 'movements',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.co_stock_movements x WHERE customer_id=c),
 'contexts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY request_id) FROM private.co_import_post_requests x WHERE customer_id=c),
 'selections',(SELECT jsonb_agg(to_jsonb(x) ORDER BY sequence) FROM private.co_import_selections x WHERE customer_id=c),
 'coverage',(SELECT jsonb_agg(to_jsonb(x) ORDER BY import_id,source_row_id,return_line_id) FROM private.co_import_return_coverage x WHERE customer_id=c),
 'reportLines',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.co_report_revision_lines x WHERE customer_id=c),
 'draftLines',(SELECT jsonb_agg(to_jsonb(x) ORDER BY draft_id,stock_key_id) FROM private.co_report_draft_lines x WHERE customer_id=c),
 'links',(SELECT jsonb_agg(to_jsonb(x) ORDER BY report_revision_id) FROM private.co_report_imports x WHERE customer_id=c),
 'evidence',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.co_evidence x WHERE customer_id=c),
 'evidenceLinks',(SELECT jsonb_agg(to_jsonb(x) ORDER BY report_revision_id) FROM private.co_report_evidence x WHERE customer_id=c),
 'manifests',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.co_import_manifests x WHERE customer_id=c),
 'generations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.co_replay_generations x WHERE customer_id=c),
 'audit',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.co_audit_events x WHERE customer_id=c),
 'commands',(SELECT jsonb_agg(to_jsonb(x) ORDER BY request_id) FROM private.co_commands x WHERE actor_id=auth.uid()));
$$;
CREATE FUNCTION co_test.import_fail_after_generation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM co_test.assert(NEW.customer_id=md5('monthly-customer-import-atomic')::uuid,'failure only synthetic customer');
 PERFORM co_test.assert(NEW.effective_generation_id IS DISTINCT FROM OLD.effective_generation_id,'observed materialized generation before failure');
 RAISE EXCEPTION 'Synthetic post-generation failure' USING ERRCODE='PZ601';
END $$;
CREATE FUNCTION co_test.import_fail_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM co_test.assert(NEW.customer_id=md5('monthly-customer-import-atomic')::uuid,'failure only synthetic customer');
 PERFORM co_test.assert(EXISTS(SELECT 1 FROM private.co_report_revisions WHERE id=NEW.report_revision_id),'failure observes newly inserted revision');
 RAISE EXCEPTION 'Synthetic import link failure' USING ERRCODE='PZ602';
END $$;
CREATE FUNCTION co_test.import_fail_after_downstream() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM co_test.assert(NEW.customer_id=md5('monthly-customer-imported-downstream')::uuid,'failure only synthetic downstream customer');
 PERFORM co_test.assert(NEW.effective_generation_id IS DISTINCT FROM OLD.effective_generation_id,'new replay generation materialized');
 PERFORM co_test.assert((SELECT count(*)=2 AND bool_and(version=2) FROM private.co_report_heads WHERE customer_id=NEW.customer_id),'both primary and downstream heads already republished');
 PERFORM co_test.assert((SELECT count(*)=2 FROM private.co_report_heads h JOIN private.co_report_imports i ON i.report_revision_id=h.current_revision_id JOIN private.co_report_evidence e ON e.report_revision_id=h.current_revision_id WHERE h.customer_id=NEW.customer_id),'both newly published revisions already have import/evidence links');
 PERFORM co_test.assert((SELECT sum(a.amount)=300 FROM private.co_sale_allocations a JOIN private.co_report_heads h ON h.current_revision_id=a.report_revision_id WHERE a.customer_id=NEW.customer_id AND a.generation_id=NEW.effective_generation_id AND h.report_month=(date_trunc('month',now())-interval '1 month')::date),'failure reached changed downstream allocation');
 RAISE EXCEPTION 'Synthetic failure after imported downstream replay' USING ERRCODE='PZ604';
END $$;
-- IMPORT_POSTING_HELPERS_END (race runner installs only preceding synthetic helpers)
DO $atomic_post_edit$
DECLARE setup jsonb:=co_test.import_setup('import-atomic'); c uuid:=(setup->>'customerId')::uuid; d uuid:=(setup->>'draftId')::uuid;
 binding jsonb:=setup->'binding'; p jsonb; r jsonb; before_state jsonb; preview jsonb; old_revision uuid; old_evidence jsonb; selected jsonb; review jsonb; abandoned uuid:=gen_random_uuid(); request uuid;
BEGIN
 SELECT to_jsonb(e) INTO old_evidence FROM private.co_evidence e WHERE id=(SELECT evidence_id FROM private.co_import_manifests WHERE id=(binding->>'importId')::uuid);
 before_state:=co_test.import_snapshot(c);
 preview:=public.pilot_co_import_preview_v1((binding->>'importId')::uuid,'1');
 PERFORM co_test.assert(before_state=co_test.import_snapshot(c),'preview is read-only');
 PERFORM co_test.assert(preview->'existingPreview'->'after'->>'sold_quantity'='5' AND (preview->'existingPreview'->'after'->>'revenue')::numeric=600,'FIFO preview 4 at 100 plus 1 at 200, not source amount 15');
 p:=co_test.import_post_payload(binding);
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(gen_random_uuid(),''post_report'',%L::jsonb)',(co_test.report_input(d)||jsonb_build_object('preview_fingerprint',preview->'existingPreview'->>'preview_fingerprint'))::text),'55000','legacy imported post requires atomic context');
 -- Failure is after materialization/link/head/draft work, not before accounting.
 EXECUTE 'CREATE TRIGGER co_test_import_generation_failure BEFORE UPDATE ON private.co_customer_state FOR EACH ROW WHEN (NEW.customer_id=md5(''monthly-customer-import-atomic'')::uuid AND NEW.effective_generation_id IS DISTINCT FROM OLD.effective_generation_id) EXECUTE FUNCTION co_test.import_fail_after_generation()';
 before_state:=co_test.import_snapshot(c);
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_commit_v1(%L,%L::jsonb)',p->>'requestId',p::text),'PZ601','post-generation failure rolls back');
 PERFORM co_test.assert(before_state=co_test.import_snapshot(c),'no partial context/head/draft/allocation/movement/receipt');
 EXECUTE 'DROP TRIGGER co_test_import_generation_failure ON private.co_customer_state';
 EXECUTE 'CREATE TRIGGER co_test_import_link_failure BEFORE INSERT ON private.co_report_imports FOR EACH ROW WHEN (NEW.customer_id=md5(''monthly-customer-import-atomic'')::uuid) EXECUTE FUNCTION co_test.import_fail_link()';
 before_state:=co_test.import_snapshot(c);
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_commit_v1(%L,%L::jsonb)',p->>'requestId',p::text),'PZ602','import link failure rolls back');
 PERFORM co_test.assert(before_state=co_test.import_snapshot(c),'link failure rolls back revision and immutable request context');
 EXECUTE 'DROP TRIGGER co_test_import_link_failure ON private.co_report_imports';
 r:=public.pilot_co_import_commit_v1((p->>'requestId')::uuid,p);
 PERFORM co_test.assert((SELECT count(*) FROM jsonb_object_keys(r))=5 AND r->>'operation'='post_report','ordinary five-field receipt');
 PERFORM co_test.assert(public.pilot_co_import_commit_v1((p->>'requestId')::uuid,p)=r,'exact committed retry');
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_commit_v1(%L,%L::jsonb)',p->>'requestId',(p||'{"reason":"changed"}')::text),'22023','changed outer payload same UUID rejects');
 PERFORM co_test.raises(format('SELECT public.pilot_reconcile_co_v1(%L,false)',p->>'requestId'),'22023','manual recovery cannot claim import');
 PERFORM co_test.assert(public.pilot_co_import_reconcile_v1((p->>'requestId')::uuid)->'receipt'=r,'import recovery returns original receipt');
 PERFORM co_test.assert((SELECT sum(quantity)=5 AND sum(amount)=600 FROM private.co_sale_allocations WHERE customer_id=c AND generation_id=(SELECT effective_generation_id FROM private.co_customer_state WHERE customer_id=c)),'effective FIFO amount600');
 PERFORM co_test.assert((SELECT sum(quantity)=4 FROM private.co_sale_allocations WHERE customer_id=c AND generation_id=(SELECT effective_generation_id FROM private.co_customer_state WHERE customer_id=c) AND sales_person_id_at_creation=md5('import-atomic-pic-a')::uuid),'PIC A retains4');
 PERFORM co_test.assert((SELECT sum(quantity)=1 FROM private.co_sale_allocations WHERE customer_id=c AND generation_id=(SELECT effective_generation_id FROM private.co_customer_state WHERE customer_id=c) AND sales_person_id_at_creation=md5('import-atomic-pic-b')::uuid),'PIC B retains1');
 SELECT current_revision_id INTO old_revision FROM private.co_report_heads WHERE id=(r->>'id')::uuid;
 selected:=public.pilot_co_import_selection_v1(d);
 review:=public.pilot_co_import_review_v1(gen_random_uuid(),co_test.import_review_payload(d));
 PERFORM co_test.assert((SELECT current_revision_id=old_revision FROM private.co_report_heads WHERE id=(r->>'id')::uuid),'opening Edit preserves prior head');
 binding:=co_test.import_prepare(d,3,(review->>'selectionId')::uuid,'Correct five to three');
 p:=co_test.import_post_payload(binding,'edit','Correct five to three');
 preview:=public.pilot_co_import_preview_v1((binding->>'importId')::uuid,'1');
 PERFORM co_test.assert(preview->'existingPreview'->'after'->>'sold_quantity'='3' AND (preview->'existingPreview'->'after'->>'revenue')::numeric=300,'Edit replaces five by three, never eight');
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(gen_random_uuid(),''correct_report'',%L::jsonb)',((private.co_import_fresh_v1((binding->>'importId')::uuid,'1'))->'payload')::text),'55000','legacy imported correct requires fresh wrapper');
 before_state:=co_test.import_snapshot(c);
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_commit_v1(%L,%L::jsonb)',p->>'requestId',(p||jsonb_build_object('previewFingerprint',repeat('0',64)))::text),'PT409','stale Edit fails');
 PERFORM co_test.assert(before_state=co_test.import_snapshot(c),'failed Edit preserves effective report');
 r:=public.pilot_co_import_commit_v1((p->>'requestId')::uuid,p);
 PERFORM co_test.assert(r->>'operation'='correct_report','Edit uses existing correction executor');
 PERFORM co_test.assert((SELECT sum(quantity)=3 AND sum(amount)=300 FROM private.co_sale_allocations WHERE customer_id=c AND generation_id=(SELECT effective_generation_id FROM private.co_customer_state WHERE customer_id=c)),'Edit effective quantity3 amount300');
 PERFORM co_test.assert((SELECT sold_quantity=5 FROM private.co_report_revision_lines WHERE revision_id=old_revision),'original revision remains immutable');
 PERFORM co_test.assert((SELECT to_jsonb(e)=old_evidence FROM private.co_evidence e WHERE e.id=(old_evidence->>'id')::uuid),'D evidence remains original through Edit');
 review:=public.pilot_co_import_review_v1(gen_random_uuid(),co_test.import_review_payload(d));
 selected:=public.pilot_co_import_review_v1(gen_random_uuid(),co_test.import_review_payload(d,'abandon'));
 PERFORM co_test.assert(selected->>'state'='abandoned' AND (SELECT version::text=r->>'version' FROM private.co_report_heads WHERE id=(r->>'id')::uuid),'cancel review preserves latest report');
 PERFORM co_test.assert(public.pilot_co_import_reconcile_v1(abandoned,true)='{"status":"abandoned"}'::jsonb,'absent request terminal tombstone');
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_commit_v1(%L,%L::jsonb)',abandoned,(p||jsonb_build_object('requestId',abandoned))::text),'55000','late abandoned execution blocked');
END $atomic_post_edit$;

DO $return_line_provenance$
DECLARE setup jsonb:=co_test.import_setup('import-return-lines');c uuid:=(setup->>'customerId')::uuid;d uuid:=(setup->>'draftId')::uuid;m date:=(setup->>'month')::date; k uuid; lines jsonb; ret jsonb; rp jsonb; revision uuid; opened jsonb; e uuid; manifest jsonb; row2 jsonb; binding jsonb; p jsonb; pin jsonb; coverage private.co_import_return_coverage%ROWTYPE; before_returns bigint;
BEGIN
 SELECT id INTO k FROM private.co_stock_keys WHERE customer_id=c;
 SELECT jsonb_agg(jsonb_build_object('batch_id',id,'quantity',1) ORDER BY id) INTO lines FROM private.co_stock_batches WHERE customer_id=c;
 ret:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_return_draft',jsonb_build_object('customer_id',c,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'return_date',m+2,'reference','Synthetic multi-line physical return','lines',lines));
 rp:=jsonb_build_object('draft_id',ret->>'id','expected_draft_version',ret->>'version','expected_customer_version',ret->>'customer_version','completed_report_drafts','[]'::jsonb,'acknowledged_reopen_orders','[]'::jsonb);
 ret:=public.pilot_co_transaction_v1(gen_random_uuid(),'post_return',rp||jsonb_build_object('preview_fingerprint',public.pilot_co_preview_v1('post_return',rp)->>'preview_fingerprint'));
 SELECT current_revision_id INTO revision FROM private.co_return_heads WHERE id=(ret->>'id')::uuid;
 opened:=public.pilot_co_import_review_v1(gen_random_uuid(),co_test.import_review_payload(d));
 e:=(co_test.evidence_register(d)->>'id')::uuid;PERFORM co_test.attest(e);PERFORM co_test.evidence_finalize(e);
 manifest:=co_test.import_manifest(c,m,e,k);
 manifest:=jsonb_set(manifest,'{input,extracted,sourceRows,0,returned}',jsonb_build_object('raw','1','decimal','1','convention','decimal_dot'));
 row2:=manifest->'input'->'extracted'->'sourceRows'->0;
 row2:=jsonb_set(jsonb_set(row2,'{id}','"r2"'),'{ref,row}','"2"');
 manifest:=jsonb_set(manifest,'{input,extracted,sourceRows}',manifest->'input'->'extracted'->'sourceRows'||jsonb_build_array(row2));
 manifest:=jsonb_set(manifest,'{input,extracted,sections,0,rowIds}','["r1","r2"]');
 manifest:=jsonb_set(manifest,'{input,extracted,sections,0,printedTotal}',jsonb_build_object('raw','12','decimal','12','convention','decimal_dot'));
 manifest:=jsonb_set(manifest,'{input,mappings}',manifest->'input'->'mappings'||jsonb_build_array(jsonb_set(manifest->'input'->'mappings'->0,'{rowId}','"r2"')));
 pin:=jsonb_build_object('rowId','r1','state','linked','stockImpact','clear','note','Existing unsold return only','links',jsonb_build_array(jsonb_build_object('returnRevisionId',revision,'quantity','1','confirmation',jsonb_build_object('physicalReturnDate',m+2,'basis','selected_existing_return_evidence','confirmed',true,'note','Exact immutable physical return'))));
 manifest:=jsonb_set(manifest,'{input,returns}',jsonb_build_array(pin,pin||'{"rowId":"r2"}'));
 manifest:=jsonb_set(manifest,'{digest}',to_jsonb(private.co_manifest_digest_v1(manifest)));
 binding:=public.pilot_co_import_prepare_v1(gen_random_uuid(),jsonb_build_object('manifest',manifest,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'expected_draft_version',(SELECT version::text FROM private.co_drafts WHERE id=d),'expected_evidence_version','2','expected_selection_id',opened->>'selectionId'));
 PERFORM co_test.assert((SELECT count(*)=2 AND count(DISTINCT return_line_id)=2 AND sum(covered_quantity)=2 FROM private.co_import_return_coverage WHERE import_id=(binding->>'importId')::uuid),'multi-row deterministic allocation uses each line capacity once');
 SELECT * INTO coverage FROM private.co_import_return_coverage WHERE import_id=(binding->>'importId')::uuid LIMIT 1;
 BEGIN
  INSERT INTO private.co_import_return_coverage(import_id,source_row_id,return_revision_id,return_line_id,batch_id,customer_id,stock_key_id,covered_quantity) VALUES(coverage.import_id,'wrong-batch',coverage.return_revision_id,coverage.return_line_id,gen_random_uuid(),coverage.customer_id,coverage.stock_key_id,1);
  RAISE EXCEPTION 'Wrong batch provenance accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 PERFORM co_test.raises(format('UPDATE private.co_import_return_coverage SET covered_quantity=2 WHERE import_id=%L',binding->>'importId'),'55000','coverage immutable');
 p:=co_test.import_post_payload(binding);
 -- Existing return correction creates a new current revision and invalidates both
 -- customer snapshot and pinned physical-return revision; no netting or new return.
 rp:=jsonb_build_object('return_head_id',ret->>'id','original_revision_id',revision,'expected_return_version',ret->>'version','expected_customer_version',ret->>'customer_version','action','replace','return_date',m+3,'reference','Correct physical date','lines',lines,'reason','Correct date','completed_report_drafts','[]'::jsonb,'acknowledged_reopen_orders','[]'::jsonb);
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'correct_return',rp||jsonb_build_object('preview_fingerprint',public.pilot_co_preview_v1('correct_return',rp)->>'preview_fingerprint'));
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_commit_v1(%L,%L::jsonb)',p->>'requestId',p::text),'PT409','return correction invalidates preview');
 PERFORM co_test.assert(NOT EXISTS(SELECT 1 FROM private.co_report_heads WHERE customer_id=c),'stale return-linked import publishes no report');
END $return_line_provenance$;

DO $explicit_reopen_acknowledgment$
DECLARE setup jsonb:=co_test.import_setup('import-closed-order');c uuid:=(setup->>'customerId')::uuid;d uuid:=(setup->>'draftId')::uuid; p jsonb; r jsonb; o private.co_orders%ROWTYPE; opened jsonb; binding jsonb; preview jsonb; acknowledgments jsonb; prior uuid;
BEGIN
 p:=co_test.import_post_payload(setup->'binding');r:=public.pilot_co_import_commit_v1((p->>'requestId')::uuid,p);
 SELECT * INTO o FROM private.co_orders WHERE customer_id=c AND co_number='import-closed-order-A';
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'close_co',jsonb_build_object('co_id',o.id,'expected_co_version',o.version::text,'expected_customer_version',r->>'customer_version','reason','All four items sold'));
 SELECT current_revision_id INTO prior FROM private.co_report_heads WHERE customer_id=c;
 opened:=public.pilot_co_import_review_v1(gen_random_uuid(),co_test.import_review_payload(d));
 binding:=co_test.import_prepare(d,3,(opened->>'selectionId')::uuid,'Explicit closed-order Edit');
 preview:=public.pilot_co_import_preview_v1((binding->>'importId')::uuid,'1');
 PERFORM co_test.assert(preview->'existingPreview'->'can_post'='false' AND EXISTS(SELECT 1 FROM jsonb_array_elements(preview->'issues') x WHERE x->>'code'='CO_REOPEN_REQUIRED'),'visible preview never auto-accepts reopening');
 acknowledgments:=preview->'requiredReopenOrders';
 PERFORM co_test.assert(jsonb_array_length(acknowledgments)=1 AND acknowledgments->0->>'coId'=o.id::text,'precise closed-order affected version');
 p:=co_test.import_post_payload(binding,'edit','Explicit closed-order Edit');
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_commit_v1(%L,%L::jsonb)',p->>'requestId',p::text),'23514','missing explicit acknowledgment blocks');
 PERFORM co_test.assert((SELECT current_revision_id=prior FROM private.co_report_heads WHERE customer_id=c),'blocked reopening leaves old effective report');
 preview:=public.pilot_co_import_preview_v1((binding->>'importId')::uuid,'1',acknowledgments);
 PERFORM co_test.assert(preview->'existingPreview'->'can_post'='true','explicit exact acknowledgment allows validated preview');
 p:=p||jsonb_build_object('requestId',gen_random_uuid(),'previewFingerprint',preview->>'previewFingerprint','acknowledgedReopenOrders',acknowledgments);
 r:=public.pilot_co_import_commit_v1((p->>'requestId')::uuid,p);
 PERFORM co_test.assert((SELECT status='active' FROM private.co_orders WHERE id=o.id),'existing correction reopens explicitly acknowledged order');
END $explicit_reopen_acknowledgment$;
DO $explicit_zero_and_chronology$
DECLARE setup jsonb:=co_test.import_setup('import-zero');c uuid:=(setup->>'customerId')::uuid;d uuid:=(setup->>'draftId')::uuid; opened jsonb; binding jsonb;p jsonb;preview jsonb;k uuid;m date:=(date_trunc('month',now())-interval '1 month')::date;
BEGIN
 opened:=public.pilot_co_import_review_v1(gen_random_uuid(),co_test.import_review_payload(d));
 binding:=co_test.import_prepare(d,0,(opened->>'selectionId')::uuid);
 p:=co_test.import_post_payload(binding);PERFORM public.pilot_co_import_commit_v1((p->>'requestId')::uuid,p);
 PERFORM co_test.assert((SELECT sold_quantity=0 FROM private.co_report_revision_lines WHERE customer_id=c),'explicit zero creates coverage, not missing report');
 c:=co_test.monthly_customer('import-missing-month');
 PERFORM co_test.monthly_delivery(c,'IMPORT-GAP','SYNTHETIC',10,'100',(m-interval '1 month')::date);
 SELECT id INTO k FROM private.co_stock_keys WHERE customer_id=c;
 PERFORM public.pilot_co_declare_stock_key_unit_v1(gen_random_uuid(),jsonb_build_object('customer_id',c,'stock_key_id',k,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'expected_unit_version',NULL,'unit','PCS','reason','Explicit synthetic unit','confirmed',true));
 d:=co_test.report_init(c,m);binding:=co_test.import_prepare(d,5);
 preview:=public.pilot_co_import_preview_v1((binding->>'importId')::uuid,'1');
 PERFORM co_test.assert(preview->'existingPreview'->'can_post'='false' AND EXISTS(SELECT 1 FROM jsonb_array_elements(preview->'issues') x WHERE x->>'code'='CO_MISSING_REQUIRED_MONTH'),'import preserves chronology and missing-is-not-zero');
 p:=co_test.import_post_payload(binding);
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_commit_v1(%L,%L::jsonb)',p->>'requestId',p::text),'23514','missing prior month blocks atomic publication');
END $explicit_zero_and_chronology$;

DO $imported_downstream_replay$
DECLARE c uuid:=co_test.monthly_customer('imported-downstream'); first_month date:=(date_trunc('month',now())-interval '2 months')::date;
 second_month date:=(date_trunc('month',now())-interval '1 month')::date; k uuid; primary_draft uuid; downstream_draft uuid;
 primary_binding jsonb; downstream_binding jsonb; edited_binding jsonb; p jsonb; opened jsonb; preview jsonb;
 primary_head uuid; downstream_head uuid; old_primary uuid; old_downstream uuid; new_primary uuid; new_downstream uuid;
 primary_evidence uuid; downstream_evidence uuid; edited_evidence uuid; before_state jsonb; primary_image jsonb; downstream_image jsonb;
BEGIN
 PERFORM co_test.monthly_delivery(c,'IMPORTED-REPLAY-A','SYNTHETIC',4,'100',first_month);
 PERFORM co_test.monthly_delivery(c,'IMPORTED-REPLAY-B','SYNTHETIC',6,'200',first_month+1);
 SELECT id INTO k FROM private.co_stock_keys WHERE customer_id=c;
 PERFORM public.pilot_co_declare_stock_key_unit_v1(gen_random_uuid(),jsonb_build_object('customer_id',c,'stock_key_id',k,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'expected_unit_version',NULL,'unit','PCS','reason','Synthetic replay counter','confirmed',true));
 primary_draft:=co_test.report_init(c,first_month);
 primary_binding:=co_test.import_prepare(primary_draft,3,NULL,NULL,repeat('a',64));
 p:=co_test.import_post_payload(primary_binding);PERFORM public.pilot_co_import_commit_v1((p->>'requestId')::uuid,p);
 downstream_draft:=co_test.report_init(c,second_month);
 downstream_binding:=co_test.import_prepare(downstream_draft,3,NULL,NULL,repeat('b',64));
 p:=co_test.import_post_payload(downstream_binding);PERFORM public.pilot_co_import_commit_v1((p->>'requestId')::uuid,p);
 SELECT id,current_revision_id INTO primary_head,old_primary FROM private.co_report_heads WHERE customer_id=c AND report_month=first_month;
 SELECT id,current_revision_id INTO downstream_head,old_downstream FROM private.co_report_heads WHERE customer_id=c AND report_month=second_month;
 SELECT evidence_id INTO primary_evidence FROM private.co_import_manifests WHERE id=(primary_binding->>'importId')::uuid;
 SELECT evidence_id INTO downstream_evidence FROM private.co_import_manifests WHERE id=(downstream_binding->>'importId')::uuid;
 SELECT to_jsonb(x) INTO primary_image FROM private.co_report_revisions x WHERE id=old_primary;
 SELECT to_jsonb(x) INTO downstream_image FROM private.co_report_revisions x WHERE id=old_downstream;
 PERFORM co_test.assert(primary_binding->>'importId'<>downstream_binding->>'importId' AND primary_evidence<>downstream_evidence,'distinct original manifests and evidence');
 PERFORM co_test.assert((SELECT count(DISTINCT sha256)=2 FROM private.co_evidence WHERE id IN(primary_evidence,downstream_evidence)),'distinct original file hashes');
 PERFORM co_test.assert((SELECT sum(quantity)=3 AND sum(amount)=500 FROM private.co_sale_allocations WHERE customer_id=c AND generation_id=(SELECT effective_generation_id FROM private.co_customer_state WHERE customer_id=c) AND report_revision_id=old_downstream),'downstream initially consumes one at100 and two at200');
 opened:=public.pilot_co_import_review_v1(gen_random_uuid(),co_test.import_review_payload(primary_draft));
 edited_binding:=co_test.import_prepare(primary_draft,1,(opened->>'selectionId')::uuid,'Reduce earlier sales and replay later month',repeat('c',64));
 SELECT evidence_id INTO edited_evidence FROM private.co_import_manifests WHERE id=(edited_binding->>'importId')::uuid;
 preview:=public.pilot_co_import_preview_v1((edited_binding->>'importId')::uuid,'1');
 PERFORM co_test.assert(preview->'existingPreview'->'can_post'='true' AND (preview->'existingPreview'->'counts'->>'report')::integer=2,'preview includes primary and changed downstream publication');
 p:=co_test.import_post_payload(edited_binding,'edit','Reduce earlier sales and replay later month');
 EXECUTE 'CREATE TRIGGER co_test_import_downstream_failure BEFORE UPDATE ON private.co_customer_state FOR EACH ROW WHEN (NEW.customer_id=md5(''monthly-customer-imported-downstream'')::uuid AND NEW.effective_generation_id IS DISTINCT FROM OLD.effective_generation_id) EXECUTE FUNCTION co_test.import_fail_after_downstream()';
 before_state:=co_test.import_snapshot(c);
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_commit_v1(%L,%L::jsonb)',p->>'requestId',p::text),'PZ604','late downstream failure observed');
 PERFORM co_test.assert(before_state=co_test.import_snapshot(c),'downstream failure restores all heads/links/generations/revisions/drafts/commands');
 EXECUTE 'DROP TRIGGER co_test_import_downstream_failure ON private.co_customer_state';
 PERFORM public.pilot_co_import_commit_v1((p->>'requestId')::uuid,p);
 SELECT current_revision_id INTO new_primary FROM private.co_report_heads WHERE id=primary_head;
 SELECT current_revision_id INTO new_downstream FROM private.co_report_heads WHERE id=downstream_head;
 PERFORM co_test.assert(new_primary<>old_primary AND new_downstream<>old_downstream,'both months republished by imported correction');
 PERFORM co_test.assert((SELECT i.import_id=(edited_binding->>'importId')::uuid AND e.evidence_id=edited_evidence FROM private.co_report_imports i JOIN private.co_report_evidence e USING(report_revision_id) WHERE i.report_revision_id=new_primary),'new primary uses newly selected import and evidence');
 PERFORM co_test.assert((SELECT i.import_id=(downstream_binding->>'importId')::uuid AND e.evidence_id=downstream_evidence FROM private.co_report_imports i JOIN private.co_report_evidence e USING(report_revision_id) WHERE i.report_revision_id=new_downstream),'downstream keeps its own original import and evidence');
 PERFORM co_test.assert((SELECT i.import_id=(primary_binding->>'importId')::uuid AND e.evidence_id=primary_evidence FROM private.co_report_imports i JOIN private.co_report_evidence e USING(report_revision_id) WHERE i.report_revision_id=old_primary),'old primary keeps original links');
 PERFORM co_test.assert((SELECT i.import_id=(downstream_binding->>'importId')::uuid AND e.evidence_id=downstream_evidence FROM private.co_report_imports i JOIN private.co_report_evidence e USING(report_revision_id) WHERE i.report_revision_id=old_downstream),'old downstream keeps original links');
 PERFORM co_test.assert((SELECT to_jsonb(x)=primary_image FROM private.co_report_revisions x WHERE id=old_primary) AND (SELECT to_jsonb(x)=downstream_image FROM private.co_report_revisions x WHERE id=old_downstream),'original revision rows retained unchanged');
 PERFORM co_test.assert((SELECT sum(quantity)=3 AND sum(amount)=300 FROM private.co_sale_allocations WHERE customer_id=c AND generation_id=(SELECT effective_generation_id FROM private.co_customer_state WHERE customer_id=c) AND report_revision_id=new_downstream),'downstream allocation changes to three at100');
 PERFORM co_test.assert((SELECT sold_quantity=3 FROM private.co_report_revision_lines WHERE revision_id=old_primary) AND (SELECT sold_quantity=1 FROM private.co_report_revision_lines WHERE revision_id=new_primary),'primary correction replaces old sales');
 PERFORM co_test.assert((SELECT count(*)=2 FROM private.co_report_heads WHERE customer_id=c) AND (SELECT count(*)=4 FROM private.co_report_revisions WHERE customer_id=c),'one effective head each month with append-only history');
END $imported_downstream_replay$;
-- A1 authored acceptance only: historical fixture deliberately has no manifest,
-- and predates one currently eligible key. No SQL in this file was executed here.
CREATE FUNCTION co_test.legacy_seed_payload(c uuid,m date,d uuid,r uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('action','initialize','customer_id',c,'report_month',m,'draft_id',d,
 'expected_draft_version',x.version::text,'expected_customer_version',cs.version::text,'seed_effective_revision_id',r)
 FROM private.co_drafts x JOIN private.co_customer_state cs USING(customer_id) WHERE x.id=d AND x.customer_id=c;
$$;
CREATE FUNCTION co_test.legacy_seed_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.customer_id=md5('monthly-customer-legacy-effective-seed')::uuid AND NEW.operation='save_report_draft' THEN
  RAISE EXCEPTION 'Synthetic failure after legacy reseed' USING ERRCODE='PZ611';
 END IF;
 RETURN NEW;
END $$;
DO $legacy_effective_seed_acceptance$
DECLARE c uuid:=co_test.monthly_customer('legacy-effective-seed'); m date:=(date_trunc('month',now())-interval '1 month')::date;
 h uuid; revision uuid; d uuid; k uuid; zero_key uuid; new_key uuid; p jsonb; receipt jsonb; before_state jsonb; before_draft jsonb; request uuid:=gen_random_uuid(); version_before bigint; correction jsonb; preview jsonb;
BEGIN
 PERFORM co_test.monthly_delivery(c,'legacy-one','LEGACY',100,'100',m);
 PERFORM co_test.monthly_delivery(c,'legacy-zero','ZERO',100,'100',m);
 PERFORM co_test.monthly_delivery(c,'legacy-new','NEW',100,'100',m);
 SELECT id INTO k FROM private.co_stock_keys WHERE customer_id=c AND display_sku='LEGACY';
 SELECT id INTO zero_key FROM private.co_stock_keys WHERE customer_id=c AND display_sku='ZERO';
 SELECT id INTO new_key FROM private.co_stock_keys WHERE customer_id=c AND display_sku='NEW';
 -- Synthetic retained legacy history; never mutate it to perform Edit.
 INSERT INTO private.co_report_heads(customer_id,report_month,created_by) VALUES(c,m,auth.uid()) RETURNING id INTO h;
 INSERT INTO private.co_report_revisions(head_id,customer_id,revision_no,coverage_through_date,is_partial_month,report_reference,notes,created_by)
 VALUES(h,c,1,(m+interval '1 month - 1 day')::date,false,'EFFECTIVE','Effective historical metadata',auth.uid()) RETURNING id INTO revision;
 INSERT INTO private.co_report_revision_lines(revision_id,head_id,customer_id,stock_key_id,sold_quantity) VALUES(revision,h,c,k,7),(revision,h,c,zero_key,0);
 UPDATE private.co_report_heads SET current_revision_id=revision WHERE id=h;
 d:=co_test.report_init(c,m);
 -- A stale pending input must not become the correction's initial value.
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',co_test.report_input(d)||jsonb_build_object('action','upsert_lines','lines',jsonb_build_array(jsonb_build_object('stock_key_id',k,'sold_quantity',99),jsonb_build_object('stock_key_id',new_key,'sold_quantity',88))));
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',co_test.report_input(d)-'eligible_set_fingerprint'||jsonb_build_object('action','set_metadata','notes','Stale pending metadata'));
 p:=co_test.legacy_seed_payload(c,m,d,revision);
 SELECT to_jsonb(x)||jsonb_build_object('lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.stock_key_id) FROM private.co_report_draft_lines l WHERE l.draft_id=d)) INTO before_draft FROM private.co_drafts x WHERE x.id=d;
 SELECT version INTO version_before FROM private.co_drafts WHERE id=d;
 before_state:=co_test.import_snapshot(c);
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(gen_random_uuid(),''save_report_draft'',%L::jsonb)',(p||jsonb_build_object('expected_draft_version',(version_before-1)::text))::text),'PT409','stale displayed draft rejects');
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(gen_random_uuid(),''save_report_draft'',%L::jsonb)',(p||jsonb_build_object('expected_customer_version','1'))::text),'PT409','stale customer rejects');
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(gen_random_uuid(),''save_report_draft'',%L::jsonb)',(p||jsonb_build_object('seed_effective_revision_id',gen_random_uuid()))::text),'PT409','stale effective revision rejects');
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(gen_random_uuid(),''save_report_draft'',%L::jsonb)',(p||jsonb_build_object('source_context','{}'::jsonb))::text),'22023','seed plus source context rejects');
 PERFORM co_test.assert(before_state=co_test.import_snapshot(c),'legacy seed guards preserve all original work');
 EXECUTE 'CREATE TRIGGER co_test_legacy_seed_failure BEFORE INSERT ON private.co_audit_events FOR EACH ROW EXECUTE FUNCTION co_test.legacy_seed_fail_audit()';
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(%L,''save_report_draft'',%L::jsonb)',request,p::text),'PZ611','failure after seed mutation observed');
 PERFORM co_test.assert(before_state=co_test.import_snapshot(c),'failed seed rolls back lines metadata versions audit and command');
 EXECUTE 'DROP TRIGGER co_test_legacy_seed_failure ON private.co_audit_events';
 receipt:=public.pilot_co_transaction_v1(request,'save_report_draft',p);
 PERFORM co_test.assert((SELECT sold_quantity=7 FROM private.co_report_draft_lines WHERE draft_id=d AND stock_key_id=k),'effective nonzero replaces pending99');
 PERFORM co_test.assert((SELECT sold_quantity=0 FROM private.co_report_draft_lines WHERE draft_id=d AND stock_key_id=zero_key),'explicit effective zero retained');
 PERFORM co_test.assert((SELECT sold_quantity IS NULL FROM private.co_report_draft_lines WHERE draft_id=d AND stock_key_id=new_key),'new eligible key is null not pending88 or invented zero');
 PERFORM co_test.assert((SELECT payload->>'notes'='Effective historical metadata' AND payload->>'report_reference'='EFFECTIVE' AND evidence_id IS NULL FROM private.co_drafts WHERE id=d),'effective metadata and no invented source attachment');
 PERFORM co_test.assert((SELECT e.before_state=before_draft FROM private.co_audit_events e WHERE e.customer_id=c AND e.request_id=request),'full prior draft and lines retained in existing before-image');
 PERFORM co_test.assert(public.pilot_co_transaction_v1(request,'save_report_draft',p)=receipt AND (SELECT version=version_before+1 FROM private.co_drafts WHERE id=d),'same seed UUID returns original receipt exactly once');
 PERFORM co_test.assert(public.pilot_reconcile_co_v1(request,false)->'receipt'=receipt,'original command recovery family');
 PERFORM co_test.assert((SELECT current_revision_id=revision FROM private.co_report_heads WHERE id=h) AND NOT EXISTS(SELECT 1 FROM private.co_report_imports WHERE customer_id=c),'seeding never posts or invents a manifest');
 PERFORM co_test.report_zero(d);
 correction:=co_test.report_input(d)||jsonb_build_object('report_head_id',h,'original_revision_id',revision,'expected_report_version','1','reason','Correct legacy report','completed_report_drafts','[]'::jsonb,'acknowledged_reopen_orders','[]'::jsonb);
 preview:=public.pilot_co_preview_v1('correct_report',correction);
 before_state:=co_test.import_snapshot(c);
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(gen_random_uuid(),''correct_report'',%L::jsonb)',(correction||jsonb_build_object('preview_fingerprint',repeat('0',64)))::text),'PT409','failed legacy Edit refuses stale preview');
 PERFORM co_test.assert(before_state=co_test.import_snapshot(c),'failed legacy Edit preserves effective revision and history');
 -- A source-owned pending draft is not a manual ledger path.
 UPDATE private.co_drafts SET payload=payload||jsonb_build_object('source_context','{}'::jsonb) WHERE id=d;
 p:=co_test.legacy_seed_payload(c,m,d,revision);before_state:=co_test.import_snapshot(c);
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(gen_random_uuid(),''save_report_draft'',%L::jsonb)',p::text),'55000','source-owned draft seed rejects');
 PERFORM co_test.assert(before_state=co_test.import_snapshot(c),'source-owned guard retains pending input');
END $legacy_effective_seed_acceptance$;
DO $legacy_seed_import_guards$
DECLARE setup jsonb:=co_test.import_setup('legacy-seed-import-guard'); c uuid:=(setup->>'customerId')::uuid; d uuid:=(setup->>'draftId')::uuid;
 m date:=(setup->>'month')::date; p jsonb; r jsonb; revision uuid; before_state jsonb;
BEGIN
 p:=co_test.legacy_seed_payload(c,m,d,gen_random_uuid());before_state:=co_test.import_snapshot(c);
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(gen_random_uuid(),''save_report_draft'',%L::jsonb)',p::text),'55000','ever-imported pending draft cannot seed even without effective report');
 PERFORM co_test.assert(before_state=co_test.import_snapshot(c),'import-origin guard preserves selected input');
 p:=co_test.import_post_payload(setup->'binding');r:=public.pilot_co_import_commit_v1((p->>'requestId')::uuid,p);
 SELECT current_revision_id INTO revision FROM private.co_report_heads WHERE id=(r->>'id')::uuid;
 -- Isolate the independent effective-import guard; helper has no granted API access.
 PERFORM co_test.raises(format('SELECT private.co_legacy_seed_metadata_v1(%L,%L,NULL::private.co_drafts,%L::jsonb)',c,m,jsonb_build_object('seed_effective_revision_id',revision)::text),'55000','linked imported effective revision refuses ledger seed');
END $legacy_seed_import_guards$;
-- Task 3 authored-only: actual prepare/fresh/post paths, not a caller safety boolean.
DO $manual_xlsx$
DECLARE c uuid; d uuid; e uuid; oid uuid; k uuid; m date:=(date_trunc('month',now())-interval '1 month')::date;
 manifest jsonb; source jsonb; facts jsonb:='{"version":1,"policy":"co-manual-xlsx-values-1","sheets":[{"name":"Sheet","rows":[4,10]}]}';
 p jsonb; bad jsonb; binding jsonb; command jsonb; with_receipt boolean; metric text;
 mime text:='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
BEGIN
 FOREACH with_receipt IN ARRAY ARRAY[false,true] LOOP
  c:=co_test.monthly_customer('manual-xlsx-'||with_receipt::text);
  PERFORM co_test.monthly_delivery(c,'MANUAL-'||with_receipt::text,'SYNTHETIC',4,'100',m);
  SELECT id INTO k FROM private.co_stock_keys WHERE customer_id=c;
  PERFORM public.pilot_co_declare_stock_key_unit_v1(gen_random_uuid(),jsonb_build_object('customer_id',c,'stock_key_id',k,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'expected_unit_version',NULL,'unit','PCS','reason','Explicit manual fixture unit','confirmed',true));
  d:=co_test.report_init(c,m);
  e:=(public.pilot_co_evidence_transaction_v1(gen_random_uuid(),'register_evidence',co_test.report_input(d)-'eligible_set_fingerprint'||jsonb_build_object('filename','manual.xlsx','mime_type',mime,'byte_size',100,'sha256',repeat('a',64)))->>'id')::uuid;
  INSERT INTO storage.objects(bucket_id,name,metadata,version) VALUES('co-evidence',e::text||'.xlsx',jsonb_build_object('size',100,'mimetype',mime),'synthetic-manual-v1') RETURNING id INTO oid;
  PERFORM public.pilot_co_evidence_attest_v1(auth.uid(),e,oid,'synthetic-manual-v1',100,mime,repeat('a',64));
  IF with_receipt THEN PERFORM public.pilot_co_evidence_manual_workbook_attest_v1(auth.uid(),e,oid,'synthetic-manual-v1',repeat('a',64),facts); END IF;
  PERFORM co_test.evidence_finalize(e);
  manifest:=co_test.import_manifest(c,m,e,k); source:=manifest->'input'->'extracted';
  source:=source||jsonb_build_object('format','xlsx','parserVersion','co-human-transcribed-2','manualWorkbook',facts,'warnings',jsonb_build_array('manual_review:safe_unsupported_xlsx_layout'),
   'manualTranscription',jsonb_build_object('mode','human_transcribed','version',2,'originalParserVersion','co-guarded-xlsx-7','originalWarnings',jsonb_build_array('manual_review:safe_unsupported_xlsx_layout'),'reason','Explicit all-sheet human review','confirmed',true));
  source:=jsonb_set(source,'{sourceRows,0,ref}',jsonb_build_object('fileSha256',repeat('a',64),'page',null,'sheet','Sheet','row','r4','section','s1'));
  source:=source||jsonb_build_object('manualPrintedControls',jsonb_build_object('version',2,'confirmed',true,'reviewedSheets',jsonb_build_array('Sheet'),'controls',jsonb_build_array(jsonb_build_object('ref',jsonb_build_object('fileSha256',repeat('a',64),'page',null,'sheet','Sheet','row','r10','section','Printed total'),'rowIds',jsonb_build_array('r1'),'count',null,'quantity',null,'returned',null,'amount',source->'sections'->0->'printedTotal'))));
  manifest:=jsonb_set(manifest,'{input,extracted}',source);manifest:=jsonb_set(manifest,'{digest}',to_jsonb(private.co_manifest_digest_v1(manifest)));
  p:=jsonb_build_object('manifest',manifest,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'expected_draft_version',(SELECT version::text FROM private.co_drafts WHERE id=d),'expected_evidence_version','2');
  IF NOT with_receipt THEN
   PERFORM co_test.raises(format('SELECT public.pilot_co_import_prepare_v1(gen_random_uuid(),%L::jsonb)',p),'PT409','client warning/facts cannot replace missing server receipt');
   PERFORM co_test.raises(format('SELECT public.pilot_co_evidence_manual_workbook_attest_v1(%L,%L,%L,''synthetic-manual-v1'',%L,%L::jsonb)',auth.uid(),e,oid,repeat('a',64),facts),'PT409','no old finalized receipt backfill');
   CONTINUE;
  END IF;
  bad:=jsonb_set(manifest,'{input,extracted,manualWorkbook,sheets,0,rows}','[4,10,99]');bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)));
  PERFORM co_test.raises(format('SELECT public.pilot_co_import_prepare_v1(gen_random_uuid(),%L::jsonb)',jsonb_set(p,'{manifest}',bad)),'PT409','forged extra physical facts cannot replace receipt');
  bad:=jsonb_set(manifest,'{input,extracted,manualPrintedControls,controls,0,ref,row}','"r99"');bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)));
  PERFORM co_test.raises(format('SELECT public.pilot_co_import_prepare_v1(gen_random_uuid(),%L::jsonb)',jsonb_set(p,'{manifest}',bad)),'22023','unattested physical control rejected');
  FOREACH metric IN ARRAY ARRAY['count','quantity','returned'] LOOP
   bad:=jsonb_set(manifest,ARRAY['input','extracted','manualPrintedControls','controls','0',metric],'{"raw":"0","decimal":"0","convention":"decimal_dot"}');bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)));
   PERFORM co_test.raises(format('SELECT public.pilot_co_import_prepare_v1(gen_random_uuid(),%L::jsonb)',jsonb_set(p,'{manifest}',bad)),'22023','observed metric independently rejects mismatch or null covered return');
  END LOOP;
  binding:=public.pilot_co_import_prepare_v1(gen_random_uuid(),p);
  command:=co_test.import_post_payload(binding);
  UPDATE storage.objects SET version='changed-original' WHERE id=oid;
  PERFORM co_test.raises(format('SELECT public.pilot_co_import_preview_v1(%L,''1'')',binding->>'importId'),'PT409','fresh preview rechecks original object version');
  PERFORM co_test.raises(format('SELECT public.pilot_co_import_commit_v1(%L::uuid,%L::jsonb)',command->>'requestId',command),'PT409','final post rechecks original object version');
  UPDATE storage.objects SET version='synthetic-manual-v1' WHERE id=oid;
  PERFORM public.pilot_co_import_commit_v1((command->>'requestId')::uuid,command);
 END LOOP;
END $manual_xlsx$;

-- A3: genuine ledger-derived cases. AUTHORED ONLY; no PostgreSQL execution claim.
-- Reuses the real evidence/prepare/return/report commands above, not inserted
-- fake proof rows. Only explicitly labelled corruption probes bypass commands.
CREATE FUNCTION co_test.prior_return_setup(label text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE setup jsonb:=co_test.import_setup(label);c uuid:=(setup->>'customerId')::uuid;d uuid:=(setup->>'draftId')::uuid;m date:=(setup->>'month')::date;
 k uuid;lines jsonb;ret jsonb;rp jsonb;revision uuid;opened jsonb;e uuid;manifest jsonb;row2 jsonb;pin jsonb;binding jsonb;
BEGIN
 SELECT id INTO k FROM private.co_stock_keys WHERE customer_id=c;
 SELECT jsonb_agg(jsonb_build_object('batch_id',id,'quantity',1) ORDER BY id) INTO lines FROM private.co_stock_batches WHERE customer_id=c;
 ret:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_return_draft',jsonb_build_object('customer_id',c,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'return_date',m+2,'reference','Original physical unsold return','lines',lines));
 rp:=jsonb_build_object('draft_id',ret->>'id','expected_draft_version',ret->>'version','expected_customer_version',ret->>'customer_version','completed_report_drafts','[]'::jsonb,'acknowledged_reopen_orders','[]'::jsonb);
 ret:=public.pilot_co_transaction_v1(gen_random_uuid(),'post_return',rp||jsonb_build_object('preview_fingerprint',public.pilot_co_preview_v1('post_return',rp)->>'preview_fingerprint'));
 SELECT current_revision_id INTO revision FROM private.co_return_heads WHERE id=(ret->>'id')::uuid;
 opened:=public.pilot_co_import_review_v1(gen_random_uuid(),co_test.import_review_payload(d));
 e:=(co_test.evidence_register(d)->>'id')::uuid;PERFORM co_test.attest(e);PERFORM co_test.evidence_finalize(e);
 manifest:=co_test.import_manifest(c,m,e,k);
 manifest:=jsonb_set(manifest,'{input,extracted,sourceRows,0,returned}',jsonb_build_object('raw','1','decimal','1','convention','decimal_dot'));
 row2:=jsonb_set(jsonb_set(manifest->'input'->'extracted'->'sourceRows'->0,'{id}','"r2"'),'{ref,row}','"2"');
 manifest:=jsonb_set(manifest,'{input,extracted,sourceRows}',manifest->'input'->'extracted'->'sourceRows'||jsonb_build_array(row2));
 manifest:=jsonb_set(manifest,'{input,extracted,sections,0,rowIds}','["r1","r2"]');
 manifest:=jsonb_set(manifest,'{input,extracted,sections,0,printedTotal}',jsonb_build_object('raw','12','decimal','12','convention','decimal_dot'));
 manifest:=jsonb_set(manifest,'{input,mappings}',manifest->'input'->'mappings'||jsonb_build_array(jsonb_set(manifest->'input'->'mappings'->0,'{rowId}','"r2"')));
 pin:=jsonb_build_object('rowId','r1','state','linked','stockImpact','clear','note','Original explicit match','links',jsonb_build_array(jsonb_build_object('returnRevisionId',revision,'quantity','1','confirmation',jsonb_build_object('physicalReturnDate',m+2,'basis','selected_existing_return_evidence','confirmed',true,'note','Original actual physical return'))));
 manifest:=jsonb_set(manifest,'{input,returns}',jsonb_build_array(pin,pin||'{"rowId":"r2"}'));
 manifest:=jsonb_set(manifest,'{digest}',to_jsonb(private.co_manifest_digest_v1(manifest)));
 binding:=public.pilot_co_import_prepare_v1(gen_random_uuid(),jsonb_build_object('manifest',manifest,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'expected_draft_version',(SELECT version::text FROM private.co_drafts WHERE id=d),'expected_evidence_version','2','expected_selection_id',opened->>'selectionId'));
 RETURN setup||jsonb_build_object('binding',binding,'manifest',manifest,'returnId',ret->'id','returnRevisionId',revision,'returnLines',lines);
END $$;
CREATE FUNCTION co_test.prior_return_candidate(setup jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c uuid:=(setup->>'customerId')::uuid;d uuid:=(setup->>'draftId')::uuid;opened jsonb;e uuid;manifest jsonb:=setup->'manifest';
BEGIN
 opened:=public.pilot_co_import_review_v1(gen_random_uuid(),co_test.import_review_payload(d));
 e:=(co_test.evidence_register(d)->>'id')::uuid;PERFORM co_test.attest(e);PERFORM co_test.evidence_finalize(e);
 manifest:=jsonb_set(manifest,'{evidenceId}',to_jsonb(e));
 manifest:=jsonb_set(manifest,'{input,reason}','"Recheck unchanged source without fresh human return choice"');
 manifest:=jsonb_set(manifest,'{input,returns}',(SELECT jsonb_agg(value||jsonb_build_object('state','unresolved','stockImpact','uncertain','links','[]'::jsonb) ORDER BY n) FROM jsonb_array_elements(manifest->'input'->'returns') WITH ORDINALITY x(value,n)));
 manifest:=jsonb_set(manifest,'{digest}',to_jsonb(private.co_manifest_digest_v1(manifest)));
 RETURN jsonb_build_object('manifest',manifest,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'expected_draft_version',(SELECT version::text FROM private.co_drafts WHERE id=d),'expected_evidence_version','2','expected_selection_id',opened->>'selectionId');
END $$;
CREATE FUNCTION co_test.prior_validate(manifest jsonb,c uuid,m date,d uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT private.co_import_validate_review_v1(jsonb_set(manifest,'{digest}',to_jsonb(private.co_manifest_digest_v1(manifest))),c,m,private.co_report_context_v1(c,m,d)->'eligible_rows');
$$;
CREATE FUNCTION co_test.prior_late_void() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h private.co_return_heads%ROWTYPE;p jsonb;
BEGIN
 SELECT * INTO h FROM private.co_return_heads WHERE customer_id=NEW.customer_id;
 p:=jsonb_build_object('return_head_id',h.id,'original_revision_id',h.current_revision_id,'expected_return_version',h.version::text,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=NEW.customer_id),'action','void','reason','Synthetic late return void','completed_report_drafts','[]'::jsonb,'acknowledged_reopen_orders','[]'::jsonb);
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'correct_return',p||jsonb_build_object('preview_fingerprint',public.pilot_co_preview_v1('correct_return',p)->>'preview_fingerprint'));
 RETURN NEW;
END $$;
CREATE FUNCTION co_test.prior_fail_after_generation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM co_test.assert(NEW.effective_generation_id IS DISTINCT FROM OLD.effective_generation_id,'proof-bearing new generation materialized');
 RAISE EXCEPTION 'Synthetic proof post-generation rollback' USING ERRCODE='PZ643';
END $$;
DO $prior_committed_exact_coverage$
DECLARE setup jsonb:=co_test.prior_return_setup('prior-exact');c uuid:=(setup->>'customerId')::uuid;d uuid:=(setup->>'draftId')::uuid;m date:=(setup->>'month')::date;
 original jsonb;candidate jsonb;manifest jsonb;bad jsonb;binding jsonb;p jsonb;preview jsonb;fresh jsonb;validation jsonb;before_state jsonb;return_sources jsonb;return_movements jsonb;row3 jsonb;key text;generation uuid;initial_revision uuid;
BEGIN
 SELECT h.validation INTO original FROM private.co_import_manifests h WHERE h.id=(setup->'binding'->>'importId')::uuid;
 manifest:=jsonb_set(setup->'manifest','{input,returns}',(SELECT jsonb_agg(value||jsonb_build_object('state','unresolved','stockImpact','uncertain','links','[]'::jsonb)) FROM jsonb_array_elements(setup->'manifest'->'input'->'returns')));
 PERFORM co_test.raises(format('SELECT co_test.prior_validate(%L::jsonb,%L,%L,%L)',manifest,c,m,d),'22023','unposted manifests cannot witness coverage');
 -- Old ordinary linked JSON and digest remain exactly the original v1 shape.
 validation:=co_test.prior_validate(setup->'manifest',c,m,d);
 PERFORM co_test.assert(validation=original AND NOT validation?'returnProofs' AND (SELECT h.validation_digest=encode(sha256(convert_to(E'co-import-validation-v1\n'||private.co_manifest_canonical_v1(jsonb_build_object('manifestDigest',h.digest,'validation',original)),'UTF8')),'hex') FROM private.co_import_manifests h WHERE h.id=(setup->'binding'->>'importId')::uuid),'explicit linked legacy validation digest unchanged');
 p:=co_test.import_post_payload(setup->'binding');PERFORM public.pilot_co_import_commit_v1((p->>'requestId')::uuid,p);
 SELECT current_revision_id INTO initial_revision FROM private.co_report_heads WHERE customer_id=c;
 candidate:=co_test.prior_return_candidate(setup);manifest:=candidate->'manifest';
 validation:=co_test.prior_validate(manifest,c,m,d);
 PERFORM co_test.assert(validation-'returnProofs'=original AND jsonb_array_length(validation->'returnProofs')=2,'genuine same original row and line/batch coverage proven without invented human choice');
 -- Ordinary committed-version manifests still revalidate identically.
 PERFORM co_test.assert(co_test.prior_validate(setup->'manifest',c,m,d)=original,'committed explicit validation fresh regression');
 -- Mixed explicit/proven links share one capacity accumulator.
 bad:=jsonb_set(manifest,'{input,returns,1}',setup->'manifest'->'input'->'returns'->1);
 PERFORM co_test.assert(co_test.prior_validate(bad,c,m,d)->'returnLinks'=original->'returnLinks','mixed proof and explicit preserve exact line allocations');
 row3:=jsonb_set(jsonb_set(manifest->'input'->'extracted'->'sourceRows'->1,'{id}','"r3"'),'{ref,row}','"3"');
 bad:=jsonb_set(bad,'{input,extracted,sourceRows}',bad->'input'->'extracted'->'sourceRows'||jsonb_build_array(row3));
 bad:=jsonb_set(bad,'{input,extracted,sections,0,rowIds}','["r1","r2","r3"]');
 bad:=jsonb_set(bad,'{input,extracted,sections,0,printedTotal}',jsonb_build_object('raw','18','decimal','18','convention','decimal_dot'));
 bad:=jsonb_set(bad,'{input,mappings}',bad->'input'->'mappings'||jsonb_build_array(jsonb_set(bad->'input'->'mappings'->1,'{rowId}','"r3"')));
 bad:=jsonb_set(bad,'{input,returns}',bad->'input'->'returns'||jsonb_build_array(jsonb_set(setup->'manifest'->'input'->'returns'->1,'{rowId}','"r3"')));
 PERFORM co_test.raises(format('SELECT co_test.prior_validate(%L::jsonb,%L,%L,%L)',bad,c,m,d),'22023','combined proof and explicit links cannot exceed line capacity');
 bad:=jsonb_set(manifest,'{input,extracted,sourceRows}',jsonb_build_array(manifest->'input'->'extracted'->'sourceRows'->1,manifest->'input'->'extracted'->'sourceRows'->0));
 PERFORM co_test.report_code(format('SELECT co_test.prior_validate(%L::jsonb,%L,%L,%L)',bad,c,m,d),'22023','Exact prior line allocation differs');
 PERFORM co_test.assert(true,'reordered rows cannot silently change exact prior allocation');
 -- No source similarity, excluded-row, date, spare stock or printed-total escape.
 FOREACH key IN ARRAY ARRAY['hash','raw','physicalRow','excludedRow','excludedSection','unit','conversion','date','forgedClear','newRow','customer','month'] LOOP
  bad:=manifest;
  CASE key
   WHEN 'hash' THEN bad:=jsonb_set(jsonb_set(bad,'{input,extracted,sha256}',to_jsonb(repeat('b',64))),'{input,extracted,sourceRows,0,ref,fileSha256}',to_jsonb(repeat('b',64)));
   WHEN 'raw' THEN bad:=jsonb_set(bad,'{input,extracted,sourceRows,0,name}','"Same totals, different original row"');
   WHEN 'physicalRow' THEN bad:=jsonb_set(bad,'{input,extracted,sourceRows,0,ref,row}','"99"');
   WHEN 'excludedRow' THEN bad:=jsonb_set(jsonb_set(bad,'{input,mappings,0,included}','false'),'{input,mappings,0,exclusionReason}','"Not this month"');
   WHEN 'excludedSection' THEN bad:=jsonb_set(bad,'{input,includedSectionIds}','[]');
   WHEN 'unit' THEN bad:=jsonb_set(bad,'{input,mappings,0,ledgerUnit}','"BOX"');
   WHEN 'conversion' THEN bad:=jsonb_set(bad,'{input,mappings,0,conversion}','{"numerator":"1","denominator":"1","reason":"new conversion"}');
   WHEN 'date' THEN bad:=jsonb_set(bad,'{input,extracted,sourceRows,0,transactionDate}',to_jsonb((m+35)::text));
   WHEN 'forgedClear' THEN bad:=jsonb_set(bad,'{input,returns,0,stockImpact}','"clear"');
   WHEN 'newRow' THEN bad:=jsonb_set(bad,'{input,extracted,sourceRows,0,transactionReference}','"Novel unrecorded physical return"');
   WHEN 'customer' THEN bad:=jsonb_set(bad,'{input,scope,customerId}',to_jsonb(gen_random_uuid()));
   WHEN 'month' THEN bad:=jsonb_set(bad,'{input,scope,reportMonth}',to_jsonb((m-interval '1 month')::date));
  END CASE;
  PERFORM co_test.raises(format('SELECT co_test.prior_validate(%L::jsonb,%L,%L,%L)',bad,c,m,d),'22023','missing authoritative fact: '||key);
 END LOOP;
 -- A deliberately empty effective generation tests canonical movements, not stock.
 BEGIN
  INSERT INTO private.co_replay_generations(customer_id,version,algorithm_version,created_by) SELECT c,max(version)+1,'synthetic-missing-movement',auth.uid() FROM private.co_replay_generations WHERE customer_id=c RETURNING id INTO generation;
  UPDATE private.co_customer_state SET effective_generation_id=generation WHERE customer_id=c;
  PERFORM co_test.report_code(format('SELECT co_test.prior_validate(%L::jsonb,%L,%L,%L)',manifest,c,m,d),'22023','Prior canonical return movement missing');
  RAISE EXCEPTION 'Rollback synthetic missing movement' USING ERRCODE='PZ641';
 EXCEPTION WHEN SQLSTATE 'PZ641' THEN NULL; END;
 -- Explicit corruption probes remain entirely inside rollback subtransactions.
 -- They show that historical digest/JSON is not trusted as current relational
 -- evidence and that a replacement unit identity invalidates historical pins.
 BEGIN
  ALTER TABLE private.co_import_return_coverage DISABLE TRIGGER co_import_immutable;
  DELETE FROM private.co_import_return_coverage WHERE import_id=(setup->'binding'->>'importId')::uuid AND source_row_id='r1';
  PERFORM co_test.report_code(format('SELECT co_test.prior_validate(%L::jsonb,%L,%L,%L)',manifest,c,m,d),'22023','Prior persisted return coverage mismatch');
  RAISE EXCEPTION 'Rollback missing coverage probe' USING ERRCODE='PZ644';
 EXCEPTION WHEN SQLSTATE 'PZ644' THEN NULL; END;
 BEGIN
  ALTER TABLE private.co_stock_key_unit_declarations DISABLE TRIGGER co_unit_declaration_immutable;
  UPDATE private.co_stock_key_unit_declarations SET id=gen_random_uuid() WHERE customer_id=c;
  PERFORM co_test.report_code(format('SELECT co_test.prior_validate(%L::jsonb,%L,%L,%L)',manifest,c,m,d),'22023','Prior return evidence changed');
  RAISE EXCEPTION 'Rollback declaration identity probe' USING ERRCODE='PZ645';
 EXCEPTION WHEN SQLSTATE 'PZ645' THEN NULL; END;
 -- Real corrected and voided returns are not still-current original coverage.
 FOREACH key IN ARRAY ARRAY['replace','void'] LOOP
  BEGIN
   SELECT jsonb_build_object('return_head_id',h.id,'original_revision_id',h.current_revision_id,'expected_return_version',h.version::text,'expected_customer_version',cs.version::text,'action',key,'reason','Synthetic current-return change','completed_report_drafts','[]'::jsonb,'acknowledged_reopen_orders','[]'::jsonb)
    INTO p FROM private.co_return_heads h JOIN private.co_customer_state cs USING(customer_id) WHERE h.customer_id=c;
   IF key='replace' THEN p:=p||jsonb_build_object('return_date',m+3,'lines',setup->'returnLines'); END IF;
   PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'correct_return',p||jsonb_build_object('preview_fingerprint',public.pilot_co_preview_v1('correct_return',p)->>'preview_fingerprint'));
   PERFORM co_test.report_code(format('SELECT private.co_import_prior_return_proof_v1(%L::jsonb,''r1'',%L,%L)',manifest,c,m),'22023','Prior current return identity mismatch');
   RAISE EXCEPTION 'Rollback corrected return branch' USING ERRCODE='PZ646';
  EXCEPTION WHEN SQLSTATE 'PZ646' THEN NULL; END;
 END LOOP;
 -- A real second explicitly-linked committed witness with different line order
 -- must not be arbitrarily selected; rollback this branch before positive commit.
 BEGIN
  bad:=jsonb_set(manifest,'{input,returns}',setup->'manifest'->'input'->'returns');
  bad:=jsonb_set(bad,'{input,extracted,sourceRows}',jsonb_build_array(bad->'input'->'extracted'->'sourceRows'->1,bad->'input'->'extracted'->'sourceRows'->0));
  bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)));
  binding:=public.pilot_co_import_prepare_v1(gen_random_uuid(),candidate||jsonb_build_object('manifest',bad));
  p:=co_test.import_post_payload(binding,'edit',manifest->'input'->>'reason');PERFORM public.pilot_co_import_commit_v1((p->>'requestId')::uuid,p);
  PERFORM co_test.report_code(format('SELECT co_test.prior_validate(%L::jsonb,%L,%L,%L)',manifest,c,m,d),'22023','Prior return coverage ambiguous');
  RAISE EXCEPTION 'conflicting original committed coverage refused' USING ERRCODE='PZ642';
 EXCEPTION WHEN SQLSTATE 'PZ642' THEN NULL; END;
 binding:=public.pilot_co_import_prepare_v1(gen_random_uuid(),candidate);
 fresh:=public.pilot_co_import_preview_v1((binding->>'importId')::uuid,'1');
 PERFORM co_test.assert(fresh->'existingPreview'->'can_post'='true' AND fresh->'existingPreview'->'before'=fresh->'existingPreview'->'after','same business effect as exact linked baseline');
 PERFORM co_test.assert(fresh->'issues'->0->>'code'='return_unresolved_prior_coverage_proven' AND fresh->'issues'->0->'blocking'='false','visible nonblocking server finding');
 PERFORM co_test.assert((SELECT canonical_json->'input'->'returns'->0->>'state'='unresolved' FROM private.co_import_manifests WHERE id=(binding->>'importId')::uuid),'immutable choice remains unresolved');
 p:=co_test.import_post_payload(binding,'edit',manifest->'input'->>'reason');
 return_sources:=private.co_sources_v1(c)->'returns';
 SELECT jsonb_agg(jsonb_build_array(return_revision_line_id,batch_id,stock_key_id,effective_date,quantity_delta::text) ORDER BY return_revision_line_id) INTO return_movements FROM private.co_stock_movements WHERE customer_id=c AND kind='return' AND generation_id=(SELECT effective_generation_id FROM private.co_customer_state WHERE customer_id=c);
 -- Inject an authorized-source command AFTER the wrapper's fresh check, BEFORE
 -- its ordinary final publication guard. The outer failure rolls it all back.
 EXECUTE format('CREATE TRIGGER co_test_prior_late_void BEFORE INSERT ON private.co_import_post_requests FOR EACH ROW WHEN (NEW.customer_id=%L::uuid) EXECUTE FUNCTION co_test.prior_late_void()',c);
 before_state:=co_test.import_snapshot(c);
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_commit_v1(%L,%L::jsonb)',p->>'requestId',p),'PT409','final locked revalidation sees late return mutation');
 PERFORM co_test.assert(before_state=co_test.import_snapshot(c) AND return_sources=private.co_sources_v1(c)->'returns','late return mutation rolls back original request and all ledger changes');
 EXECUTE 'DROP TRIGGER co_test_prior_late_void ON private.co_import_post_requests';
 EXECUTE format('CREATE TRIGGER co_test_prior_generation BEFORE UPDATE ON private.co_customer_state FOR EACH ROW WHEN (NEW.customer_id=%L::uuid AND NEW.effective_generation_id IS DISTINCT FROM OLD.effective_generation_id) EXECUTE FUNCTION co_test.prior_fail_after_generation()',c);
 before_state:=co_test.import_snapshot(c);
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_commit_v1(%L,%L::jsonb)',p->>'requestId',p),'PZ643','late materialization failure');
 PERFORM co_test.assert(before_state=co_test.import_snapshot(c),'proof-bearing rollback restores full snapshot');
 EXECUTE 'DROP TRIGGER co_test_prior_generation ON private.co_customer_state';
 PERFORM public.pilot_co_import_commit_v1((p->>'requestId')::uuid,p);
 PERFORM co_test.assert(return_sources=private.co_sources_v1(c)->'returns','proof posting creates no new return source or physical movement');
 PERFORM co_test.assert(return_movements=(SELECT jsonb_agg(jsonb_build_array(return_revision_line_id,batch_id,stock_key_id,effective_date,quantity_delta::text) ORDER BY return_revision_line_id) FROM private.co_stock_movements WHERE customer_id=c AND kind='return' AND generation_id=(SELECT effective_generation_id FROM private.co_customer_state WHERE customer_id=c)),'current canonical return movements exactly unchanged (normal replay generation copies are not a second physical return)');
 PERFORM co_test.assert(co_test.prior_validate(manifest,c,m,d)=validation,'proof validation stable after its own commit');
 PERFORM co_test.assert((SELECT jsonb_agg(DISTINCT value->>'priorImportId')=jsonb_build_array(setup->'binding'->>'importId') FROM jsonb_array_elements(co_test.prior_validate(manifest,c,m,d)->'returnProofs')),'proof-only report never becomes its own or recursive witness');
 preview:=public.pilot_co_report_import_v1(c,m,(SELECT current_revision_id FROM private.co_report_heads WHERE customer_id=c));
 PERFORM co_test.assert(preview->'return_proofs'=validation->'returnProofs' AND preview->'manifest'->'input'->'returns'->0->>'state'='unresolved','recorded exact revision retains distinct server proof');
 PERFORM co_test.assert(NOT public.pilot_co_report_import_v1(c,m,initial_revision)?'return_proofs','old exact revision never acquires a later proof');
END $prior_committed_exact_coverage$;


ROLLBACK;
SELECT 'CO_IMPORT_ATOMIC_POST_EDIT_PASSED';
