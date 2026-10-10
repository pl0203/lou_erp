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
 PERFORM public.pilot_co_evidence_attest_v1((ctx->>'actor_id')::uuid,e,oid,'synthetic-v1',100,'application/pdf',repeat('a',64));
END $$;
CREATE FUNCTION co_test.evidence_finalize(e uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.pilot_co_evidence_transaction_v1(gen_random_uuid(),'finalize_evidence',jsonb_build_object('evidence_id',e,'expected_evidence_version',x.version::text,'expected_draft_version',x.draft_version::text,'expected_customer_version',x.customer_version::text)) FROM private.co_evidence x WHERE id=e;
$$;
-- A duplicate is usable only by its registering actor. An authorized second actor
-- receives a transactionally rolled-back conflict, never someone else's success.
DO $actor_duplicates$
DECLARE c uuid:=co_test.monthly_customer('evidence-actor-duplicate');
 m date:=(date_trunc('month',now())-interval '1 month')::date;
 d uuid; e uuid; req uuid:=gen_random_uuid(); other_req uuid; receipt jsonb;
 before_e jsonb; before_a bigint; state text;
BEGIN
 PERFORM co_test.monthly_delivery(c,'EVIDENCE-ACTOR','DUP',2,'1',m);
 d:=co_test.report_init(c,m);
 receipt:=co_test.evidence_register(d,req); e:=(receipt->>'id')::uuid;
 PERFORM co_test.assert(co_test.evidence_register(d,req)=receipt,'same actor exact registration retry');
 FOREACH state IN ARRAY ARRAY['pending','verified'] LOOP
  IF state='verified' THEN PERFORM co_test.attest(e); END IF;
  SELECT to_jsonb(x) INTO before_e FROM private.co_evidence x WHERE id=e;
  SELECT count(*) INTO before_a FROM private.co_audit_events WHERE customer_id=c;
  PERFORM set_config('request.jwt.claim.sub',md5('co-user-2')::uuid::text,true);
  PERFORM co_test.assert(private.co_actor_v1()=md5('co-user-2')::uuid,'second operator has current CO authority');
  other_req:=gen_random_uuid();
  PERFORM co_test.report_code(format('SELECT co_test.evidence_register(%L,%L)',d,other_req),
   'PT409','CO_EVIDENCE_REGISTERED_BY_OTHER_ACTOR');
  PERFORM co_test.assert(NOT EXISTS(SELECT 1 FROM private.co_commands WHERE actor_id=md5('co-user-2')::uuid AND request_id=other_req),state||' duplicate cannot commit unusable success');
  PERFORM co_test.assert((SELECT count(*)=before_a FROM private.co_audit_events WHERE customer_id=c),state||' conflict preserves original audit');
  PERFORM co_test.assert((SELECT to_jsonb(x)=before_e FROM private.co_evidence x WHERE id=e),state||' conflict preserves original evidence');
  PERFORM co_test.raises(format('SELECT public.pilot_co_evidence_context_v1(%L,''upload'')',e),'42501','duplicate does not broaden creator upload');
  PERFORM co_test.raises(format('SELECT co_test.evidence_finalize(%L)',e),'42501','duplicate does not broaden creator finalize');
  PERFORM set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true);
  PERFORM co_test.assert(co_test.evidence_register(d,req)=receipt,state||' original request remains exactly retryable');
 END LOOP;
 PERFORM co_test.evidence_finalize(e);
 PERFORM co_test.assert((SELECT evidence_id=e FROM private.co_drafts WHERE id=d),'original creator remains able to finalize');
END $actor_duplicates$;
DO $lifecycle$
DECLARE c uuid:=co_test.monthly_customer('evidence'); m date:=(date_trunc('month',now())-interval '2 months')::date;
 d uuid; e uuid; r jsonb; req uuid:=gen_random_uuid(); before_version bigint; rev uuid; next_d uuid; next_e uuid; previous uuid; p jsonb; plan jsonb; old_post jsonb; downstream_e uuid; downstream_rev uuid;
BEGIN
 PERFORM co_test.monthly_delivery(c,'EVIDENCE','EVIDENCE',10,'2.00',m);
 d:=co_test.report_init(c,m); PERFORM co_test.report_zero(d);
 SELECT version INTO before_version FROM private.co_drafts WHERE id=d;
 old_post:=co_test.report_input(d); plan:=public.pilot_co_preview_v1('post_report',old_post);old_post:=old_post||jsonb_build_object('preview_fingerprint',plan->>'preview_fingerprint');
 r:=co_test.evidence_register(d,req); e:=(r->>'id')::uuid;
 PERFORM co_test.assert(r->>'operation'='register_evidence' AND r->>'version'='1','own supporting receipt');
 PERFORM co_test.assert(co_test.evidence_register(d,req)=r,'lost register response reconciles');
 PERFORM co_test.assert((co_test.evidence_register(d)->>'id')::uuid=e,'same draft/content deduplicates');
 PERFORM co_test.assert((SELECT version=before_version FROM private.co_drafts WHERE id=d),'pending attachment leaves draft untouched');
 PERFORM co_test.raises(format('SELECT public.pilot_reconcile_co_v1(%L,false)',req),'22023','business recovery refuses evidence receipt');
 PERFORM co_test.raises(format('SELECT public.pilot_co_evidence_context_v1(%L,%L)',e,'download'),'55000','pending has no download');
 PERFORM co_test.raises(format('SELECT co_test.evidence_finalize(%L)',e),'55000','browser cannot finalize without attestation');
 PERFORM co_test.attest(e);
 PERFORM co_test.assert(public.pilot_co_evidence_v1(e)->>'state'='verified','actual verifier attestation precedes usable selection');
 r:=co_test.evidence_finalize(e);
 PERFORM co_test.assert(r->>'operation'='finalize_evidence' AND r->>'version'='2','finalize supporting receipt');
 PERFORM co_test.assert(public.pilot_co_evidence_v1(e)->>'finalized_draft_version'=(before_version+1)::text,'exact finalized draft version exposed');
 PERFORM co_test.assert((SELECT version=before_version+1 AND evidence_id=e FROM private.co_drafts WHERE id=d),'finalize increments only draft version');
 PERFORM co_test.assert(public.pilot_co_evidence_selection_v1(d,NULL,(before_version+1)::text)->'evidence'->>'id'=e::text,'draft sidecar exact selection');
 PERFORM co_test.raises(format('SELECT public.pilot_co_evidence_selection_v1(%L,NULL,%L)',d,before_version::text),'PT409','sidecar pins exact draft version');
 PERFORM co_test.raises(format('UPDATE private.co_evidence_verifications SET sha256=%L WHERE evidence_id=%L',repeat('b',64),e),'55000','attestation immutable');
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(gen_random_uuid(),%L,%L)','post_report',old_post),'PT409','finalizing evidence invalidates old preview/draft version');
 PERFORM co_test.report_post(d); SELECT current_revision_id INTO rev FROM private.co_report_heads WHERE customer_id=c AND report_month=m;
 PERFORM co_test.assert(public.pilot_co_evidence_selection_v1(NULL,rev,NULL)->'evidence'->>'id'=e::text,'post snapshot links exact selected evidence');
 PERFORM co_test.raises(format('UPDATE private.co_report_evidence SET evidence_id=%L WHERE report_revision_id=%L',gen_random_uuid(),rev),'55000','revision evidence immutable');
 -- A second report without an attachment posts normally.
 next_d:=co_test.report_init(c,(m+interval '1 month')::date); PERFORM co_test.report_zero(next_d); PERFORM co_test.report_post(next_d);
 PERFORM co_test.assert((SELECT count(*)=1 FROM private.co_report_evidence WHERE customer_id=c),'zero attachment valid');
 -- A later attached report proves automatic replay inherits its original, not a latest draft.
 next_d:=co_test.report_init(c,(m+interval '2 months')::date);PERFORM co_test.report_zero(next_d);
 downstream_e:=(co_test.evidence_register(next_d)->>'id')::uuid;PERFORM co_test.attest(downstream_e);PERFORM co_test.evidence_finalize(downstream_e);PERFORM co_test.report_post(next_d);
 SELECT current_revision_id INTO downstream_rev FROM private.co_report_heads WHERE customer_id=c AND report_month=(m+interval '2 months')::date;
 -- Refresh an existing statement, replace selected evidence, preserve original link.
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',jsonb_build_object('action','initialize','customer_id',c,'report_month',m,'draft_id',d,'expected_draft_version',(SELECT version::text FROM private.co_drafts WHERE id=d),'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c)));
 PERFORM co_test.assert((SELECT evidence_id=e FROM private.co_drafts WHERE id=d),'refresh retains prior finalized selection');
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',co_test.report_input(d)||jsonb_build_object('action','upsert_lines','lines',jsonb_build_array(jsonb_build_object('stock_key_id',(SELECT stock_key_id FROM private.co_report_draft_lines WHERE draft_id=d LIMIT 1),'sold_quantity',1))));
 r:=co_test.evidence_register(d); next_e:=(r->>'id')::uuid; PERFORM co_test.attest(next_e); PERFORM co_test.evidence_finalize(next_e);
 SELECT jsonb_build_object('draft_id',d,'expected_draft_version',x.version::text,'expected_customer_version',s.version::text,'eligible_set_fingerprint',x.eligible_set_fingerprint,'report_head_id',h.id,'original_revision_id',h.current_revision_id,'expected_report_version',h.version::text,'reason','Replace supporting document','completed_report_drafts','[]'::jsonb,'acknowledged_reopen_orders','[]'::jsonb) INTO p FROM private.co_drafts x JOIN private.co_customer_state s USING(customer_id) JOIN private.co_report_heads h ON h.customer_id=x.customer_id AND h.report_month=x.report_month WHERE x.id=d;
 plan:=public.pilot_co_preview_v1('correct_report',p);
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'correct_report',p||jsonb_build_object('preview_fingerprint',plan->>'preview_fingerprint'));
 PERFORM co_test.assert((SELECT evidence_id=e FROM private.co_report_evidence WHERE report_revision_id=rev),'original link retained');
 PERFORM co_test.assert((SELECT e.evidence_id=next_e FROM private.co_report_heads h JOIN private.co_report_evidence e ON e.report_revision_id=h.current_revision_id WHERE h.customer_id=c AND h.report_month=m),'correction takes exact new selection');
 PERFORM co_test.assert((SELECT count(*)=4 FROM private.co_report_evidence WHERE customer_id=c),'revision links append, zero-evidence replay remains zero');
 PERFORM co_test.assert((SELECT evidence_id=downstream_e FROM private.co_report_evidence WHERE report_revision_id=downstream_rev),'downstream original attachment retained');
 PERFORM co_test.assert((SELECT l.evidence_id=downstream_e AND l.report_revision_id<>downstream_rev FROM private.co_report_heads h JOIN private.co_report_evidence l ON l.report_revision_id=h.current_revision_id WHERE h.customer_id=c AND h.report_month=(m+interval '2 months')::date),'automatic downstream revision inherits exact original selection');
END $lifecycle$;
DO $families$
DECLARE req uuid:=gen_random_uuid(); c uuid:=md5('co-customer-1')::uuid; r jsonb; d uuid; e uuid;
BEGIN
 r:=co_test.execute(req,jsonb_build_object('customer_id',c));
 PERFORM co_test.raises(format('SELECT public.pilot_reconcile_co_evidence_v1(%L,false)',req),'22023','supporting recovery refuses business receipt');
 req:=gen_random_uuid(); PERFORM public.pilot_reconcile_co_v1(req,true);
 PERFORM co_test.raises(format('SELECT public.pilot_co_evidence_transaction_v1(%L,%L,%L)',req,'register_evidence','{}'),'55000','business tombstone denies supporting execution');
 req:=gen_random_uuid(); PERFORM public.pilot_reconcile_co_evidence_v1(req,true);
 PERFORM co_test.raises(format('SELECT co_test.execute(%L,%L)',req,jsonb_build_object('customer_id',c)),'55000','supporting tombstone denies business execution');
END $families$;
DO $authority$
DECLARE who uuid;
BEGIN
 FOREACH who IN ARRAY ARRAY[md5('co-user-3')::uuid,md5('co-user-4')::uuid,NULL::uuid] LOOP
  PERFORM set_config('request.jwt.claim.sub',coalesce(who::text,''),true);
  PERFORM co_test.raises('SELECT public.pilot_co_evidence_v1(gen_random_uuid())','42501','authority before identity');
  PERFORM co_test.raises('SELECT public.pilot_co_evidence_context_v1(gen_random_uuid(),''upload'')','42501','unauthorized mint');
  PERFORM co_test.raises('SELECT public.pilot_co_evidence_transaction_v1(gen_random_uuid(),''register_evidence'',''{}'')','42501','unauthorized registration');
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true);
END $authority$;
SELECT co_test.assert(NOT has_function_privilege('authenticated','public.pilot_co_evidence_attest_v1(uuid,uuid,uuid,text,bigint,text,text)','EXECUTE'),'attestation service only');
SELECT co_test.assert(has_function_privilege('service_role','public.pilot_co_evidence_attest_v1(uuid,uuid,uuid,text,bigint,text,text)','EXECUTE'),'service attestation explicit grant');
SELECT co_test.assert(NOT has_table_privilege('authenticated','private.co_evidence','SELECT'),'no private raw table grants');
SELECT co_test.assert((SELECT NOT public AND file_size_limit=10485760 AND allowed_mime_types=ARRAY['application/pdf','image/png','image/jpeg'] FROM storage.buckets WHERE id='co-evidence'),'private constrained bucket');
-- Adversarial declarations, stale binding, attestation facts and composite constraints.
DO $adversarial$
DECLARE c uuid:=co_test.monthly_customer('evidence-adversarial'); c2 uuid:=co_test.monthly_customer('evidence-other'); m date:=(date_trunc('month',now())-interval '1 month')::date; d uuid; d2 uuid; e uuid; other uuid; oid uuid; r jsonb; base jsonb; bad jsonb; req uuid; original_version bigint;
BEGIN
 PERFORM co_test.monthly_delivery(c,'EV-AD','AD',2,'1',m);PERFORM co_test.monthly_delivery(c2,'EV-OTHER','OTHER',2,'1',m);
 d:=co_test.report_init(c,m);d2:=co_test.report_init(c2,m);PERFORM co_test.report_zero(d);
 base:=jsonb_build_object('draft_id',d,'expected_draft_version',(SELECT version::text FROM private.co_drafts WHERE id=d),'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'filename','a.pdf','mime_type','application/pdf','byte_size',100,'sha256',repeat('a',64));
 FOR bad IN SELECT value FROM jsonb_array_elements('[{"byte_size":0},{"byte_size":10485761},{"byte_size":"100"},{"mime_type":"image/svg+xml"},{"mime_type":"text/html"},{"filename":"a.png"},{"filename":"../a.pdf"},{"filename":"a.pdf\r\nHeader: x"},{"verified":true},{"path":"arbitrary"},{"sha256":"bad"}]') LOOP
  PERFORM co_test.raises(format('SELECT public.pilot_co_evidence_transaction_v1(gen_random_uuid(),%L,%L)','register_evidence',base||bad),'22023','strict declarations and no caller path/assertion');
 END LOOP;
 e:=(co_test.evidence_register(d)->>'id')::uuid;other:=(co_test.evidence_register(d2)->>'id')::uuid;
 PERFORM co_test.raises(format('UPDATE private.co_drafts SET evidence_id=%L WHERE id=%L',other,d),'23503','composite evidence draft/customer isolation');
 SELECT version INTO original_version FROM private.co_drafts WHERE id=d;
 INSERT INTO storage.objects(bucket_id,name,metadata,version) SELECT 'co-evidence',private.co_evidence_path_v1(x),'{"size":100,"mimetype":"application/pdf"}','original' FROM private.co_evidence x WHERE id=e RETURNING id INTO oid;
 PERFORM co_test.raises(format('SELECT public.pilot_co_evidence_attest_v1(%L,%L,%L,%L,100,%L,%L)',md5('co-user-1')::uuid,e,oid,'original','application/pdf',repeat('b',64)),'PT409','server digest commitment mismatch');
 PERFORM co_test.raises(format('SELECT public.pilot_co_evidence_attest_v1(%L,%L,%L,%L,100,%L,%L)',md5('co-user-1')::uuid,e,gen_random_uuid(),'original','application/pdf',repeat('a',64)),'PT409','wrong storage identity');
 PERFORM public.pilot_co_evidence_attest_v1(md5('co-user-1')::uuid,e,oid,'original',100,'application/pdf',repeat('a',64));
 PERFORM public.pilot_co_evidence_attest_v1(md5('co-user-1')::uuid,e,oid,'original',100,'application/pdf',repeat('a',64));
 PERFORM co_test.assert((SELECT count(*)=1 FROM private.co_evidence_verifications WHERE evidence_id=e),'attestation replay is immutable');
 UPDATE storage.objects SET version='replacement' WHERE id=oid;
 PERFORM co_test.raises(format('SELECT co_test.evidence_finalize(%L)',e),'PT409','provider metadata replacement blocks finalize');
 UPDATE storage.objects SET version='original' WHERE id=oid;
 req:=gen_random_uuid();base:=jsonb_build_object('evidence_id',e,'expected_evidence_version','1','expected_draft_version',original_version::text,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c));
 r:=public.pilot_co_evidence_transaction_v1(req,'finalize_evidence',base);
 PERFORM co_test.assert(public.pilot_co_evidence_transaction_v1(req,'finalize_evidence',base)=r,'lost finalize replays exactly once');
 PERFORM co_test.assert(public.pilot_reconcile_co_evidence_v1(req,false)->'receipt'=r,'finalized supporting recovery exact receipt');
 PERFORM co_test.assert((SELECT version=original_version+1 FROM private.co_drafts WHERE id=d),'duplicate finalize increments draft once');
 PERFORM co_test.raises(format('DELETE FROM private.co_evidence WHERE id=%L',e),'55000','posted identity cannot be deleted');
 PERFORM co_test.raises(format('DELETE FROM private.co_evidence_verifications WHERE evidence_id=%L',e),'55000','verification cannot be deleted');
 -- A pending object cannot attach after draft editing or customer drift.
 PERFORM co_test.report_zero(d2);
 PERFORM co_test.raises(format('SELECT co_test.attest(%L)',other),'PT409','pending verification never rebinds refreshed/edited draft');
 PERFORM co_test.raises(format('SELECT co_test.evidence_finalize(%L)',other),'PT409','stale finalization does not link');
 PERFORM co_test.assert((SELECT evidence_id IS NULL FROM private.co_drafts WHERE id=d2),'stale pending selection stays absent');
 -- Service callback independently checks the current registering actor.
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-2')::uuid::text,true);
 UPDATE public.users SET is_active=false WHERE id=md5('co-user-1')::uuid;
 PERFORM co_test.raises(format('SELECT public.pilot_co_evidence_attest_v1(%L,%L,%L,%L,100,%L,%L)',md5('co-user-1')::uuid,e,oid,'original','application/pdf',repeat('a',64)),'42501','callback rechecks active actor');
 UPDATE public.users SET is_active=true WHERE id=md5('co-user-1')::uuid;
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true);
END $adversarial$;

INSERT INTO auth.users(id) SELECT md5('evidence-role-'||r)::uuid FROM unnest(ARRAY['sales_person','sales_manager','sales_head'])r;
INSERT INTO public.users(id,full_name,email,role) SELECT md5('evidence-role-'||r)::uuid,'Evidence role fixture',r||'@evidence.invalid',r::public.user_role FROM unnest(ARRAY['sales_person','sales_manager','sales_head'])r;
GRANT USAGE ON SCHEMA co_test TO authenticated,anon;
GRANT EXECUTE ON FUNCTION co_test.assert(boolean,text),co_test.raises(text,text,text) TO authenticated,anon;
CREATE POLICY co_test_unrelated_permissive ON storage.objects FOR ALL TO authenticated,anon USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated,anon;
SET LOCAL ROLE authenticated;
DO $all_audiences$
DECLARE who uuid; q text; n bigint;
BEGIN
 FOREACH who IN ARRAY ARRAY[md5('co-user-3')::uuid,md5('co-user-4')::uuid,md5('evidence-role-sales_person')::uuid,md5('evidence-role-sales_manager')::uuid,md5('evidence-role-sales_head')::uuid,NULL::uuid] LOOP
  PERFORM set_config('request.jwt.claim.sub',coalesce(who::text,''),true);
  FOREACH q IN ARRAY ARRAY['SELECT public.pilot_co_evidence_transaction_v1(gen_random_uuid(),''register_evidence'',''{}'')','SELECT public.pilot_co_evidence_transaction_v1(gen_random_uuid(),''finalize_evidence'',''{}'')','SELECT public.pilot_co_evidence_v1(gen_random_uuid())','SELECT public.pilot_co_evidence_selection_v1(gen_random_uuid(),NULL,''1'')','SELECT public.pilot_co_evidence_context_v1(gen_random_uuid(),''upload'')','SELECT public.pilot_co_evidence_context_v1(gen_random_uuid(),''download'')','SELECT public.pilot_reconcile_co_evidence_v1(gen_random_uuid(),false)'] LOOP PERFORM co_test.raises(q,'42501','all unauthorized audiences fail before identity'); END LOOP;
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true);
 PERFORM co_test.assert(row_security_active('storage.objects'),'storage tests use real RLS');
 PERFORM co_test.assert((SELECT count(*)=0 FROM storage.objects WHERE bucket_id='co-evidence'),'no user direct read, even broad permissive policy');
 PERFORM co_test.raises('INSERT INTO storage.objects(bucket_id,name) VALUES(''co-evidence'',''forbidden.pdf'')','42501','no user create');
 WITH changed AS (UPDATE storage.objects SET name='forbidden.pdf' WHERE bucket_id='co-evidence' RETURNING id) SELECT count(*) INTO n FROM changed;PERFORM co_test.assert(n=0,'no user overwrite or move');
 WITH changed AS (DELETE FROM storage.objects WHERE bucket_id='co-evidence' RETURNING id) SELECT count(*) INTO n FROM changed;PERFORM co_test.assert(n=0,'no user delete');
 PERFORM co_test.raises('SELECT public.pilot_co_evidence_attest_v1(NULL,NULL,NULL,NULL,1,''application/pdf'',''a'')','42501','authenticated cannot assert verification');
 PERFORM co_test.raises('SELECT * FROM private.co_evidence','42501','no raw metadata');
END $all_audiences$;
RESET ROLE;
SET LOCAL ROLE anon;
SELECT co_test.raises('SELECT public.pilot_co_evidence_v1(gen_random_uuid())','42501','anonymous RPC has no execute grant');
SELECT co_test.assert((SELECT count(*)=0 FROM storage.objects WHERE bucket_id='co-evidence'),'anonymous raw bytes denied');
RESET ROLE;
ROLLBACK;
SELECT 'CO_EVIDENCE_PASSED';
