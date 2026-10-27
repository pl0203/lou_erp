-- Task 5C metadata/ACL assertions ONLY. Real ZIP bytes are verified in Edge tests, not SQL.
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
DO $xlsx$
DECLARE c uuid:=co_test.monthly_customer('xlsx-evidence'); m date:=(date_trunc('month',now())-interval '1 month')::date;
 d uuid; e uuid; oid uuid; p jsonb; r jsonb; ctx jsonb; mime text:='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; bad jsonb; v private.co_evidence;
BEGIN
 PERFORM co_test.monthly_delivery(c,'XLSX-EVIDENCE','XLSX',2,'1',m);d:=co_test.report_init(c,m);
 p:=co_test.report_input(d)-'eligible_set_fingerprint'||jsonb_build_object('filename','report.xlsx','mime_type',mime,'byte_size',10485760,'sha256',repeat('a',64));
 FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
  jsonb_build_object('filename','report.xlsm'),jsonb_build_object('filename','report.pdf'),jsonb_build_object('mime_type','application/zip'),
  jsonb_build_object('filename','../report.xlsx'),jsonb_build_object('filename','.report.xlsx'),jsonb_build_object('byte_size',0),jsonb_build_object('byte_size',10485761))) LOOP
  PERFORM co_test.raises(format('SELECT public.pilot_co_evidence_transaction_v1(gen_random_uuid(),''register_evidence'',%L::jsonb)',(p||bad)::text),'22023','invalid XLSX declaration');
 END LOOP;
 -- The lower byte bound is declaration-only too; one byte cannot be attested as a valid XLSX by Edge.
 PERFORM public.pilot_co_evidence_transaction_v1(gen_random_uuid(),'register_evidence',p||jsonb_build_object('byte_size',1,'sha256',repeat('b',64)));
 r:=public.pilot_co_evidence_transaction_v1(gen_random_uuid(),'register_evidence',p);e:=(r->>'id')::uuid;
 ctx:=public.pilot_co_evidence_context_v1(e,'upload');
 PERFORM co_test.assert(ctx->>'path'=e::text||'.xlsx' AND ctx->>'filename'='evidence-'||e::text||'.xlsx' AND ctx->>'mime_type'=mime,'exact XLSX generated path and MIME');
 PERFORM co_test.assert(ctx->>'state'='pending' AND ctx->'object'='null','declaration is not verification');
 SELECT * INTO v FROM private.co_evidence WHERE id=e;
 v.mime_type:='application/pdf';PERFORM co_test.assert(private.co_evidence_path_v1(v)=e::text||'.pdf','PDF historical path stable');
 v.mime_type:='image/png';PERFORM co_test.assert(private.co_evidence_path_v1(v)=e::text||'.png','PNG historical path stable');
 v.mime_type:='image/jpeg';PERFORM co_test.assert(private.co_evidence_path_v1(v)=e::text||'.jpg','JPEG historical path stable');
 -- Synthetic provider metadata is not proof of any actual XLSX bytes.
 INSERT INTO storage.objects(bucket_id,name,metadata,version) VALUES('co-evidence',ctx->>'path',jsonb_build_object('size',10485760,'mimetype',mime),'synthetic-v1') RETURNING id INTO oid;
 PERFORM co_test.raises(format('SELECT public.pilot_co_evidence_attest_v1(%L,%L,%L,''wrong-version'',10485760,%L,%L)',md5('co-user-1')::uuid,e,oid,mime,repeat('a',64)),'PT409','wrong provider version rejected');
 PERFORM co_test.raises(format('SELECT public.pilot_co_evidence_attest_v1(%L,%L,%L,''synthetic-v1'',1,%L,%L)',md5('co-user-1')::uuid,e,oid,mime,repeat('a',64)),'PT409','wrong byte size rejected');
 PERFORM public.pilot_co_evidence_attest_v1(md5('co-user-1')::uuid,e,oid,'synthetic-v1',10485760,mime,repeat('a',64));
 PERFORM co_test.raises(format('SELECT public.pilot_co_evidence_attest_v1(%L,%L,%L,''synthetic-v1'',10485760,%L,%L)',md5('co-user-1')::uuid,e,oid,mime,repeat('b',64)),'PT409','changed verification digest rejected');
 -- Task 3 authored-only manual classifier receipt: fixture facts are synthetic, not byte proof.
 bad:='{"version":1,"policy":"co-manual-xlsx-values-1","sheets":[{"name":"Sheet","rows":[4,10]}]}'::jsonb;
 PERFORM co_test.raises(format('SELECT public.pilot_co_evidence_manual_workbook_attest_v1(%L,%L,%L,''synthetic-v1'',%L,%L::jsonb)',md5('co-user-2')::uuid,e,oid,repeat('a',64),bad),'22023','foreign actor cannot attest receipt');
 PERFORM co_test.raises(format('SELECT public.pilot_co_evidence_manual_workbook_attest_v1(%L,%L,%L,''wrong-version'',%L,%L::jsonb)',md5('co-user-1')::uuid,e,oid,repeat('a',64),bad),'PT409','manual receipt exact object version');
 PERFORM public.pilot_co_evidence_manual_workbook_attest_v1(md5('co-user-1')::uuid,e,oid,'synthetic-v1',repeat('a',64),bad);
 PERFORM public.pilot_co_evidence_manual_workbook_attest_v1(md5('co-user-1')::uuid,e,oid,'synthetic-v1',repeat('a',64),bad);
 PERFORM co_test.assert((SELECT count(*)=1 FROM private.co_evidence_manual_workbook_checks WHERE evidence_id=e),'immutable receipt retry');
 PERFORM co_test.raises(format('SELECT public.pilot_co_evidence_manual_workbook_attest_v1(%L,%L,%L,''synthetic-v1'',%L,%L::jsonb)',md5('co-user-1')::uuid,e,oid,repeat('a',64),jsonb_set(bad,'{sheets,0,rows}','[4,10,99]')),'PT409','changed manual receipt facts rejected');
 PERFORM co_test.raises(format('UPDATE private.co_evidence_manual_workbook_checks SET facts=%L::jsonb WHERE evidence_id=%L',bad,e),'55000','manual receipt append-only');
 PERFORM co_test.evidence_finalize(e);
 PERFORM co_test.assert((public.pilot_co_evidence_v1(e)->>'state')='finalized','XLSX finalizes through unchanged authority/version path');
 PERFORM co_test.raises(format('UPDATE private.co_evidence_verifications SET sha256=%L WHERE evidence_id=%L',repeat('b',64),e),'55000','verification immutable');
 PERFORM co_test.assert((SELECT NOT public AND file_size_limit=10485760 AND allowed_mime_types @> ARRAY[mime] AND cardinality(allowed_mime_types)=4 FROM storage.buckets WHERE id='co-evidence'),'private exact bounded bucket allowlist');
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-3')::uuid::text,true);
 PERFORM co_test.raises(format('SELECT public.pilot_co_evidence_transaction_v1(gen_random_uuid(),''register_evidence'',%L::jsonb)',p::text),'42501','read-only actor cannot register XLSX');
END $xlsx$;
DO $acl$
DECLARE role_name text; signature text:='public.pilot_co_evidence_attest_v1(uuid,uuid,uuid,text,bigint,text,text)';
BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  PERFORM co_test.assert(NOT has_function_privilege(role_name,'public.pilot_co_evidence_manual_workbook_attest_v1(uuid,uuid,uuid,text,text,jsonb)','EXECUTE'),'manual receipt service-only');
  PERFORM co_test.assert(NOT has_table_privilege(role_name,'private.co_evidence_manual_workbook_checks','SELECT,INSERT,UPDATE,DELETE'),'manual receipt private');
  PERFORM co_test.assert(NOT has_function_privilege(role_name,signature,'EXECUTE'),'attestation remains service-only');
  PERFORM co_test.assert(NOT has_table_privilege(role_name,'private.co_evidence','INSERT,UPDATE,DELETE'),'no direct evidence mutation');
  PERFORM co_test.assert(NOT has_table_privilege(role_name,'private.co_evidence_verifications','INSERT,UPDATE,DELETE'),'no direct verification mutation');
 END LOOP;
 PERFORM co_test.assert(has_function_privilege('service_role','public.pilot_co_evidence_manual_workbook_attest_v1(uuid,uuid,uuid,text,text,jsonb)','EXECUTE'),'manual receipt service ACL');
 PERFORM co_test.assert((SELECT relrowsecurity FROM pg_class WHERE oid='private.co_evidence_manual_workbook_checks'::regclass),'manual receipt RLS enabled');
 PERFORM co_test.assert(has_function_privilege('service_role',signature,'EXECUTE'),'service attestation remains available');
END $acl$;
ROLLBACK;
SELECT 'CO_XLSX_EVIDENCE_METADATA_PASSED';
