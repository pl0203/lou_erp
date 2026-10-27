-- Run only through scripts/test-co-workspace-db.mjs against independently marked
-- disposable PG17. These are actual SQL assertions, not static or mocked acceptance.
BEGIN;
DO $$
DECLARE sample jsonb; actual text;
BEGIN
 FOR sample IN SELECT value FROM jsonb_array_elements('[
  {"value":null,"canonical":"n"}, {"value":true,"canonical":"t"},
  {"value":false,"canonical":"f"}, {"value":12,"canonical":"i12;"},
  {"value":"é","canonical":"s2:é"},
  {"value":["0",null],"canonical":"a2:s1:0n"},
  {"value":{"b":"02","a":"1.00"},"canonical":"o2:s1:as4:1.00s1:bs2:02"},
  {"value":{"😀":1,"":2},"canonical":"o2:s3:i2;s4:😀i1;"}
 ]'::jsonb) LOOP
  actual:=private.co_manifest_canonical_v1(sample->'value');
  IF actual IS DISTINCT FROM sample->>'canonical' THEN RAISE EXCEPTION 'CO-CV1 vector mismatch'; END IF;
 END LOOP;
 IF encode(sha256(convert_to(E'co-import-manifest-v1\n'||private.co_manifest_canonical_v1('null'::jsonb),'UTF8')),'hex')<>'aefc719815fb4f53cdad443be146bac1fe5a8a3c2ded917a07ed2b7cdde004f3'
 OR encode(sha256(convert_to(E'co-import-manifest-v1\n'||private.co_manifest_canonical_v1('"é"'::jsonb),'UTF8')),'hex')<>'b7b83cb422f768b0b94c52da2386a00fb79e35cf7e1b26569f2c5460b6983d06'
 OR encode(sha256(convert_to(E'co-import-manifest-v1\n'||private.co_manifest_canonical_v1('{"b":"02","a":"1.00"}'::jsonb),'UTF8')),'hex')<>'42330bf18dfe89880f9e456780e71e0f3de8da68f0989c7828a635a5c55ce8d8'
 THEN RAISE EXCEPTION 'CO-CV1 digest vector mismatch'; END IF;
END $$;
ROLLBACK;
SELECT 'CO_IMPORT_CANONICAL_VECTORS_PASSED';
-- Full prepare/unit/permissions/return/race acceptance belongs below once authored.
-- No task-level acceptance marker is emitted by this vector-only fixture.

BEGIN;
DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true); END $$;
DO $$
DECLARE c uuid:=md5('import-unit-customer')::uuid; k uuid:=md5('import-unit-key')::uuid; req uuid:=gen_random_uuid(); p jsonb; r jsonb; got text;
BEGIN
 INSERT INTO public.customers(id,name) VALUES(c,'Synthetic import unit');
 INSERT INTO private.co_customer_state(customer_id) VALUES(c);
 INSERT INTO private.co_stock_keys(id,customer_id,display_sku,product_name) VALUES(k,c,'SYNTHETIC-UNIT','Synthetic');
 p:=jsonb_build_object('customer_id',c,'stock_key_id',k,'expected_customer_version','1','expected_unit_version',null,'unit','PCS','reason','Explicit fixture confirmation of existing counter','confirmed',true);
 IF (public.pilot_co_stock_key_units_v1(c,ARRAY[k],'1')->'rows'->0->>'state')<>'unknown' THEN RAISE EXCEPTION 'Unknown unit not explicit'; END IF;
 BEGIN PERFORM public.pilot_co_declare_stock_key_unit_v1(req,p||'{"confirmed":false}'); RAISE EXCEPTION 'Accepted unconfirmed unit'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.pilot_co_declare_stock_key_unit_v1(gen_random_uuid(),p||jsonb_build_object('customer_id',md5('co-customer-2')::uuid,'expected_customer_version',coalesce((SELECT version::text FROM private.co_customer_state WHERE customer_id=md5('co-customer-2')::uuid),'1'))); RAISE EXCEPTION 'Cross-customer unit accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.pilot_co_declare_stock_key_unit_v1(gen_random_uuid(),p||'{"expected_customer_version":"2"}'); RAISE EXCEPTION 'Stale unit version accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 r:=public.pilot_co_declare_stock_key_unit_v1(req,p);
 IF r->>'operation'<>'declare_stock_key_unit' OR r->>'customer_version'<>'2' OR r->>'version'<>'1' OR (SELECT count(*) FROM jsonb_object_keys(r))<>5 THEN RAISE EXCEPTION 'Unit receipt contract'; END IF;
 IF public.pilot_co_declare_stock_key_unit_v1(req,p)<>r THEN RAISE EXCEPTION 'Unit retry changed'; END IF;
 BEGIN PERFORM public.pilot_co_declare_stock_key_unit_v1(req,p||'{"unit":"BOX"}'); RAISE EXCEPTION 'Changed request accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.pilot_co_declare_stock_key_unit_v1(gen_random_uuid(),p||'{"expected_customer_version":"2"}'); RAISE EXCEPTION 'Redeclaration accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 BEGIN UPDATE private.co_stock_key_unit_declarations SET unit='BOX' WHERE stock_key_id=k; RAISE EXCEPTION 'Mutable unit'; EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 BEGIN DELETE FROM private.co_stock_key_unit_declarations WHERE stock_key_id=k; RAISE EXCEPTION 'Deletable unit'; EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 IF EXISTS(SELECT 1 FROM private.co_replay_generations WHERE customer_id=c) OR EXISTS(SELECT 1 FROM private.co_stock_movements WHERE customer_id=c) THEN RAISE EXCEPTION 'Unit declaration touched ledger'; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.co_audit_events WHERE customer_id=c AND operation='declare_stock_key_unit' AND request_id=req) THEN RAISE EXCEPTION 'Unit audit absent'; END IF;
 IF has_table_privilege('authenticated','private.co_stock_key_unit_declarations','INSERT') OR has_table_privilege('authenticated','private.co_stock_key_unit_declarations','UPDATE') OR has_table_privilege('authenticated','private.co_stock_key_unit_declarations','DELETE') THEN RAISE EXCEPTION 'Unit direct grants widened'; END IF;
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-3')::uuid::text,true);
 BEGIN PERFORM public.pilot_co_declare_stock_key_unit_v1(gen_random_uuid(),p); RAISE EXCEPTION 'Read-only role mutated unit'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-4')::uuid::text,true);
 BEGIN PERFORM public.pilot_co_declare_stock_key_unit_v1(gen_random_uuid(),p); RAISE EXCEPTION 'Inactive actor mutated unit'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
SELECT 'CO_IMPORT_UNIT_DECLARATIONS_PASSED';

BEGIN;
DO $$
DECLARE m jsonb; bad jsonb; invalid_case record;
BEGIN
 m:='{"schemaVersion":1,"evidenceId":"11111111-1111-1111-1111-111111111111","digest":"","input":{"scope":{"actorId":"11111111-1111-1111-1111-111111111111","customerId":"11111111-1111-1111-1111-111111111111","reportMonth":"2026-08-01","epoch":1},"extracted":{"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","format":"pdf","parserVersion":"synthetic","sourceRows":[],"sections":[],"periodCandidates":[],"customerCandidates":[],"warnings":[]},"mappings":[],"returns":[],"includedSectionIds":[],"completenessConfirmed":true,"omittedZeroStockKeyIds":[],"currency":"IDR","reason":null}}';
 m:=jsonb_set(m,'{digest}',to_jsonb(private.co_manifest_digest_v1(m)));
 PERFORM private.co_import_decode_v1(m); -- shape-only, never business clearance
 bad:=m||'{"extra":true}';bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)));
 BEGIN PERFORM private.co_import_decode_v1(bad); RAISE EXCEPTION 'Extra manifest field accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 bad:=jsonb_set(m,'{input,scope,reportMonth}','"0000-01-01"');bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)));
 BEGIN PERFORM private.co_import_decode_v1(bad); RAISE EXCEPTION 'Year zero accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 bad:=jsonb_set(m,'{digest}',to_jsonb(repeat('b',64)));
 BEGIN PERFORM private.co_import_decode_v1(bad); RAISE EXCEPTION 'Forged source digest accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM private.co_manifest_canonical_v1('1.5'); RAISE EXCEPTION 'Fractional canonical number accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM private.co_import_integer_v1('"1.5"'); RAISE EXCEPTION 'Fractional source integer accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

 -- Regression for SQLSTATE 42702 in co_import_shape_v1: object-schema keys and
 -- values must be read from jsonb_each, not its local scalar-text variable.
 -- Nonempty collections also execute recursive array/object/nullable branches.
 -- This fixture is shape-only: it does not establish import business clearance.
 m:=$nonempty_shape_manifest${
  "schemaVersion":1,
  "evidenceId":"11111111-1111-1111-1111-111111111111",
  "digest":"",
  "input":{
   "scope":{"actorId":"11111111-1111-1111-1111-111111111111","customerId":"11111111-1111-1111-1111-111111111111","reportMonth":"2026-08-01","epoch":1},
   "extracted":{
    "sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "format":"pdf",
    "parserVersion":"synthetic-shape-regression",
    "sourceRows":[{
     "id":"row-1",
     "ref":{"fileSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","page":1,"sheet":null,"row":"1","section":"section-1"},
     "sourceSku":"SYNTHETIC-1","name":"Synthetic row",
     "transactionDate":"2026-08-01","transactionReference":"SYNTHETIC",
     "quantity":{"raw":"2","decimal":"2"},
     "returned":{"raw":"1","decimal":"1"},"unit":"PCS",
     "unitPrice":{"raw":"1.00","decimal":"1.00"},
     "discount":null,"discountBasis":null,"netUnitPrice":null,
     "amount":{"raw":"2.00","decimal":"2.00"},"currency":"IDR","priceBasisLabel":null,
     "flags":["formula_cache_requires_confirmation"],
     "physicalReturnDate":{
      "date":"2026-08-02","raw":"2026-08-02",
      "ref":{"fileSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","page":1,"sheet":null,"row":"1","section":"section-1"}
     }
    }],
    "sections":[
     {"id":"section-1","label":"Synthetic section","rowIds":["row-1"],"printedTotal":{"raw":"2.00","decimal":"2.00"}},
     {"id":"section-2","label":"No printed total","rowIds":["row-1"],"printedTotal":null}
    ],
    "periodCandidates":["2026-08-01"],"customerCandidates":["Synthetic customer"],"warnings":["Synthetic warning"]
   },
   "mappings":[{"rowId":"row-1","stockKeyId":"22222222-2222-2222-2222-222222222222","ledgerUnit":"PCS","quantity":"2","conversion":{"numerator":"1","denominator":"1","reason":"Same declared counter"},"included":true,"exclusionReason":null,"confirmed":true}],
   "returns":[{"rowId":"row-1","state":"linked","links":[{"returnRevisionId":"33333333-3333-3333-3333-333333333333","quantity":"1","confirmation":{"physicalReturnDate":"2026-08-02","basis":"source_return_date","confirmed":true,"note":"Explicit source return field"}}],"stockImpact":"clear","note":"Synthetic return decision"}],
   "includedSectionIds":["section-1"],"completenessConfirmed":true,
   "omittedZeroStockKeyIds":["44444444-4444-4444-4444-444444444444"],"currency":"IDR","reason":null,
   "sourceConfirmations":[{"rowId":"row-1","flag":"formula_cache_requires_confirmation","confirmed":true,"reason":"Reviewed synthetic source"}]
  }
 }$nonempty_shape_manifest$::jsonb;
 m:=jsonb_set(m,'{digest}',to_jsonb(private.co_manifest_digest_v1(m)));
 PERFORM private.co_import_decode_v1(m);

 -- Recompute each digest so rejection must come from the recursive shape,
 -- not the final digest check. A wrong type in a later array member must fail.
 FOR invalid_case IN SELECT cases.name,cases.payload FROM (VALUES
  ('missing section field',m#-'{input,extracted,sections,0,id}'),
  ('extra section field',jsonb_set(m,'{input,extracted,sections,0,extra}','true')),
  ('non-text row id in second section',jsonb_set(m,'{input,extracted,sections,1,rowIds,0}','7')),
  ('non-array row ids',jsonb_set(m,'{input,extracted,sections,0,rowIds}','"row-1"')),
  ('non-text printed-total raw',jsonb_set(m,'{input,extracted,sections,0,printedTotal,raw}','2')),
  ('non-text return-link quantity',jsonb_set(m,'{input,returns,0,links,0,quantity}','1')),
  ('non-text optional confirmation reason',jsonb_set(m,'{input,sourceConfirmations,0,reason}','false'))
 ) AS cases(name,payload) LOOP
  bad:=jsonb_set(invalid_case.payload,'{digest}',to_jsonb(private.co_manifest_digest_v1(invalid_case.payload)));
  BEGIN
   PERFORM private.co_import_decode_v1(bad);
   RAISE EXCEPTION 'Malformed nested shape accepted: %',invalid_case.name;
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
 END LOOP;
END $$;
ROLLBACK;
SELECT 'CO_IMPORT_SHAPE_PRIMITIVES_PASSED';

-- Shared immutable-unit Unicode/whitespace/full-length vectors (same named
-- values in tests/co/import/units.test.ts); these test exact shared SQL predicates.
BEGIN;
DO $$
DECLARE item record; accepted boolean;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('64 supplementary characters',repeat('😀',64),'reason',true),
  ('65 supplementary characters',repeat('😀',65),'reason',false),
  ('full reason length overflow','PCS',repeat(' ',2000)||'x',false),
  ('full reason boundary','PCS',repeat(' ',1999)||'x',true),
  ('NBSP unit',chr(160),'reason',false),
  ('NBSP unit padding',chr(160)||'PCS','reason',false),
  ('tab-only reason','PCS',chr(9),false),
  ('BOM-only reason','PCS',chr(65279),false)
 ) vectors(name,unit,reason,expected) LOOP
  accepted:=private.co_unit_label_valid_v1(item.unit) AND private.co_unit_reason_valid_v1(item.reason);
  IF accepted IS DISTINCT FROM item.expected THEN RAISE EXCEPTION 'Unit parity vector failed: %',item.name; END IF;
 END LOOP;
 PERFORM private.co_import_shape_v1('1.0','"count"');
 PERFORM private.co_import_shape_v1('1.0','"page"');
 PERFORM co_test.assert(private.co_import_text_units_v1('😀é')=3,'UTF16 text units');
 PERFORM co_test.assert(private.co_import_budget_v1('"é"')=4194304-9,'conservative BMP string charge');
 PERFORM co_test.assert(private.co_import_budget_v1('"😀"')=4194304-15,'conservative supplementary string charge');
 PERFORM co_test.assert(private.co_import_budget_v1('{"x":[true,null,"0"]}')=4194304-(2+10+2+32+32+9),'nested conservative budget parity');
 BEGIN
  PERFORM private.co_import_shape_v1(to_jsonb(chr(9)),'"label"');
  RAISE EXCEPTION 'Tab-only source label accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
 BEGIN
  PERFORM private.co_import_shape_v1(to_jsonb(chr(65279)),'"note"');
  RAISE EXCEPTION 'BOM-only source note accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
 BEGIN
  PERFORM private.co_import_budget_v1((SELECT jsonb_agg(repeat('x',1024)) FROM generate_series(1,1000)));
  RAISE EXCEPTION 'Conservative result overflow accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
END $$;
ROLLBACK;
SELECT 'CO_IMPORT_DOMAIN_PARITY_PASSED';

-- B2 real prepare lifecycle and bypass fixtures (unexecuted).
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

-- One synthetic reviewed source reused by the lifecycle and publication fixtures.
CREATE FUNCTION co_test.import_manifest(c uuid,m date,e uuid,k uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE source_row jsonb; manifest jsonb;
BEGIN
 source_row:=jsonb_build_object('id','r1','ref',jsonb_build_object('fileSha256',repeat('a',64),'page',1,'sheet',null,'row','1','section','s1'),'sourceSku','SYNTHETIC','name','Synthetic','transactionDate',null,'transactionReference',null,'quantity',jsonb_build_object('raw','2','decimal','2','convention','decimal_dot'),'returned',null,'unit','PCS','unitPrice',jsonb_build_object('raw','3','decimal','3','convention','decimal_dot'),'discount',null,'discountBasis',null,'netUnitPrice',null,'amount',jsonb_build_object('raw','6','decimal','6','convention','decimal_dot'),'currency','IDR','priceBasisLabel',null,'flags','[]'::jsonb);
 manifest:=jsonb_build_object('schemaVersion',1,'evidenceId',e,'digest','', 'input',jsonb_build_object('scope',jsonb_build_object('actorId',auth.uid(),'customerId',c,'reportMonth',m,'epoch',1),'extracted',jsonb_build_object('sha256',repeat('a',64),'format','pdf','parserVersion','synthetic','sourceRows',jsonb_build_array(source_row),'sections',jsonb_build_array(jsonb_build_object('id','s1','label','Synthetic','rowIds',jsonb_build_array('r1'),'printedTotal',jsonb_build_object('raw','6','decimal','6','convention','decimal_dot'))),'periodCandidates',jsonb_build_array(m),'customerCandidates','[]'::jsonb,'warnings','[]'::jsonb),'mappings',jsonb_build_array(jsonb_build_object('rowId','r1','stockKeyId',k,'ledgerUnit','PCS','quantity','2','conversion',null,'included',true,'exclusionReason',null,'confirmed',true)),'returns','[]'::jsonb,'includedSectionIds',jsonb_build_array('s1'),'completenessConfirmed',true,'omittedZeroStockKeyIds','[]'::jsonb,'currency','IDR','reason',null));
 manifest:=jsonb_set(manifest,'{digest}',to_jsonb(private.co_manifest_digest_v1(manifest)));
 RETURN manifest;
END $$;
CREATE FUNCTION co_test.refresh_report(c uuid,m date) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE d private.co_drafts%ROWTYPE; r jsonb;
BEGIN
 SELECT * INTO d FROM private.co_drafts WHERE customer_id=c AND report_month=m AND kind='report';
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',jsonb_build_object('action','initialize','customer_id',c,'report_month',m,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'draft_id',d.id,'expected_draft_version',d.version::text));
 RETURN (r->>'id')::uuid;
END $$;
CREATE FUNCTION co_test.report_correction(d uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT co_test.report_input(d)||jsonb_build_object('reason','Synthetic import guard/replay','completed_report_drafts','[]'::jsonb,'acknowledged_reopen_orders','[]'::jsonb,'report_head_id',h.id,'original_revision_id',h.current_revision_id,'expected_report_version',h.version::text)
 FROM private.co_drafts x JOIN private.co_report_heads h ON h.customer_id=x.customer_id AND h.report_month=x.report_month WHERE x.id=d;
$$;

-- Exact row snapshots, not only counts: a failed command must leave no changed
-- quantities, versions, pointers, source/evidence records, links, audit or receipt.
-- This helper and the synthetic failure trigger exist only inside this rollback.
CREATE FUNCTION co_test.import_state(c uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
  'customer',(SELECT to_jsonb(x) FROM private.co_customer_state x WHERE customer_id=c),
  'orders',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM private.co_orders x WHERE customer_id=c),
  'drafts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM private.co_drafts x WHERE customer_id=c),
  'draftLines',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.draft_id,x.stock_key_id) FROM private.co_report_draft_lines x WHERE customer_id=c),
  'evidence',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM private.co_evidence x WHERE customer_id=c),
  'attestations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.evidence_id) FROM private.co_evidence_verifications x JOIN private.co_evidence e ON e.id=x.evidence_id WHERE e.customer_id=c),
  'manifests',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM private.co_import_manifests x WHERE customer_id=c),
  'origins',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.draft_id) FROM private.co_draft_import_origins x WHERE customer_id=c),
  'prepareResults',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.request_id) FROM private.co_import_prepare_results x WHERE actor_id=auth.uid()),
  'commands',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.request_id) FROM private.co_commands x WHERE actor_id=auth.uid()),
  'audits',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM private.co_audit_events x WHERE customer_id=c),
  'reportHeads',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM private.co_report_heads x WHERE customer_id=c),
  'reportRevisions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM private.co_report_revisions x WHERE customer_id=c),
  'reportLines',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM private.co_report_revision_lines x WHERE customer_id=c),
  'reportImports',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.report_revision_id) FROM private.co_report_imports x WHERE customer_id=c),
  'reportEvidence',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.report_revision_id) FROM private.co_report_evidence x WHERE customer_id=c),
  'generations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM private.co_replay_generations x WHERE customer_id=c),
  'movements',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM private.co_stock_movements x WHERE customer_id=c),
  'allocations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM private.co_sale_allocations x WHERE customer_id=c),
  'returnHeads',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM private.co_return_heads x WHERE customer_id=c),
  'returnRevisions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM private.co_return_revisions x WHERE customer_id=c),
  'returnLines',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM private.co_return_revision_lines x WHERE customer_id=c)
 );
$$;
CREATE FUNCTION co_test.fail_import_after_draft_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE imported private.co_import_manifests%ROWTYPE;
BEGIN
 SELECT * INTO imported FROM private.co_import_manifests WHERE id=NEW.import_id;
 PERFORM co_test.assert(imported.customer_id=md5('monthly-customer-import-prepare')::uuid,'failure fixture synthetic customer only');
 PERFORM co_test.assert((SELECT d.version=imported.draft_version AND imported.draft_version=e.finalized_draft_version+1
  FROM private.co_drafts d JOIN private.co_evidence e ON e.id=imported.evidence_id WHERE d.id=imported.draft_id),
  'failure reached after persisted D+1 to D+2 draft mutation');
 PERFORM co_test.assert((SELECT jsonb_object_agg(l.stock_key_id::text,l.sold_quantity::text)
  FROM private.co_report_draft_lines l WHERE l.draft_id=imported.draft_id)=imported.validation->'quantities',
  'failure reached after all prepared draft quantities were written');
 PERFORM co_test.assert(EXISTS(SELECT 1 FROM private.co_commands WHERE actor_id=imported.created_by AND request_id=NEW.request_id AND status='pending'),
  'failure reached before command completion');
 RAISE EXCEPTION 'Synthetic failure after draft mutation' USING ERRCODE='PZ501';
END $$;

DO $prepare_lifecycle$
DECLARE c uuid:=co_test.monthly_customer('import-prepare'); m date:=(date_trunc('month',now())-interval '1 month')::date;
 k uuid; d uuid; e uuid; req uuid:=gen_random_uuid(); manifest jsonb; payload jsonb; result jsonb; bad jsonb; old_evidence jsonb; ledger_before jsonb; return_draft uuid; return_payload jsonb; return_receipt jsonb; return_revision uuid; batch uuid; original_head uuid; original_revision uuid;
 unsafe_case jsonb; attempt_request uuid; abandoned_request uuid:=gen_random_uuid(); before_state jsonb;
BEGIN
 PERFORM co_test.monthly_delivery(c,'IMPORT-PREPARE','SYNTHETIC',10,'3',m);
 SELECT id INTO k FROM private.co_stock_keys WHERE customer_id=c;
 PERFORM public.pilot_co_declare_stock_key_unit_v1(gen_random_uuid(),jsonb_build_object('customer_id',c,'stock_key_id',k,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'expected_unit_version',null,'unit','PCS','reason','Confirmed synthetic existing counter','confirmed',true));
 SELECT id INTO batch FROM private.co_stock_batches WHERE customer_id=c;
 return_draft:=(public.pilot_co_transaction_v1(gen_random_uuid(),'save_return_draft',jsonb_build_object('customer_id',c,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'return_date',m+1,'reference','Synthetic unsold return','lines',jsonb_build_array(jsonb_build_object('batch_id',batch,'quantity',2))))->>'id')::uuid;
 return_payload:=jsonb_build_object('draft_id',return_draft,'expected_draft_version','1','expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'reason','Synthetic physical return','completed_report_drafts','[]'::jsonb,'acknowledged_reopen_orders','[]'::jsonb);
 return_receipt:=public.pilot_co_transaction_v1(gen_random_uuid(),'post_return',return_payload||jsonb_build_object('preview_fingerprint',public.pilot_co_preview_v1('post_return',return_payload)->>'preview_fingerprint'));
 SELECT current_revision_id INTO return_revision FROM private.co_return_heads WHERE id=(return_receipt->>'id')::uuid;
 d:=co_test.report_init(c,m);e:=(co_test.evidence_register(d)->>'id')::uuid;
 PERFORM co_test.attest(e);PERFORM co_test.evidence_finalize(e);
 SELECT to_jsonb(x) INTO old_evidence FROM private.co_evidence x WHERE id=e;
 SELECT jsonb_build_object('generation',effective_generation_id,'version',version,'movementCount',(SELECT count(*) FROM private.co_stock_movements WHERE customer_id=c),'allocationCount',(SELECT count(*) FROM private.co_sale_allocations WHERE customer_id=c)) INTO ledger_before FROM private.co_customer_state WHERE customer_id=c;
 manifest:=co_test.import_manifest(c,m,e,k);
 payload:=jsonb_build_object('manifest',manifest,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'expected_draft_version',(SELECT version::text FROM private.co_drafts WHERE id=d),'expected_evidence_version','2');
 bad:=jsonb_set(manifest,'{input,completenessConfirmed}','false');bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)));
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_prepare_v1(gen_random_uuid(),%L::jsonb)',(payload||jsonb_build_object('manifest',bad))::text),'22023','missing completeness blocks atomically');
 bad:=jsonb_set(manifest,'{input,extracted,sha256}',to_jsonb(repeat('b',64)));bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)));
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_prepare_v1(gen_random_uuid(),%L::jsonb)',(payload||jsonb_build_object('manifest',bad))::text),'22023','altered SHA blocks');
 bad:=jsonb_set(manifest,'{input,mappings,0,quantity}','"3"');bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)));
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_prepare_v1(gen_random_uuid(),%L::jsonb)',(payload||jsonb_build_object('manifest',bad))::text),'22023','forged mapped quantity blocks');
 bad:=jsonb_set(manifest,'{input,extracted,sections,0,printedTotal,decimal}','"7"');bad:=jsonb_set(bad,'{input,extracted,sections,0,printedTotal,raw}','"7"');bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)));
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_prepare_v1(gen_random_uuid(),%L::jsonb)',(payload||jsonb_build_object('manifest',bad))::text),'22023','printed total independently validated');
 -- Additional adversarial source decisions are rehashed so digest verification
 -- cannot stand in for the authoritative business reconstruction.
 bad:=jsonb_set(manifest,'{input,scope,customerId}',to_jsonb(md5('co-customer-2')::uuid));bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)));
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_prepare_v1(gen_random_uuid(),%L::jsonb)',(payload||jsonb_build_object('manifest',bad))::text),'22023','cross-customer evidence blocked');
 bad:=jsonb_set(manifest,'{input,mappings,0,ledgerUnit}','null');bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)));
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_prepare_v1(gen_random_uuid(),%L::jsonb)',(payload||jsonb_build_object('manifest',bad))::text),'22023','client missing unit blocked');
 bad:=jsonb_set(manifest,'{input,extracted,sourceRows,0,quantity,decimal}','"1.5"');bad:=jsonb_set(bad,'{input,extracted,sourceRows,0,quantity,raw}','"1.5"');bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)));
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_prepare_v1(gen_random_uuid(),%L::jsonb)',(payload||jsonb_build_object('manifest',bad))::text),'22023','fractional source quantity blocked');
 bad:=jsonb_set(manifest,'{input,extracted,sourceRows,0,flags}','["formula_cache_requires_confirmation"]');bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)));
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_prepare_v1(gen_random_uuid(),%L::jsonb)',(payload||jsonb_build_object('manifest',bad))::text),'22023','source confirmation cannot be silently cleared');
 bad:=jsonb_set(manifest,'{input,extracted,sourceRows,0,returned}','{"raw":"1","decimal":"1","convention":"decimal_dot"}');
 bad:=jsonb_set(bad,'{input,returns}',jsonb_build_array(jsonb_build_object('rowId','r1','state','linked','links',jsonb_build_array(jsonb_build_object('returnRevisionId',gen_random_uuid(),'quantity','1','confirmation',jsonb_build_object('physicalReturnDate',m,'basis','selected_existing_return_evidence','confirmed',true,'note','Forged fixture evidence'))),'stockImpact','clear','note','')));
 bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)));
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_prepare_v1(gen_random_uuid(),%L::jsonb)',(payload||jsonb_build_object('manifest',bad))::text),'22023','forged return clearance blocked');
 bad:=jsonb_set(manifest,'{input,extracted,sourceRows,0,unit}','"BOX"');
 bad:=jsonb_set(bad,'{input,mappings,0,conversion}','{"numerator":"3","denominator":"1","reason":"Explicit source BOX to declared PCS ratio"}');
 bad:=jsonb_set(bad,'{input,mappings,0,quantity}','"6"');bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)));
 PERFORM co_test.assert(private.co_import_validate_review_v1(bad,c,m,private.co_report_context_v1(c,m,d)->'eligible_rows')->'quantities'->>k::text='6','explicit exact source conversion retained');
 bad:=jsonb_set(manifest,'{input,extracted,sourceRows,0,returned}','{"raw":"2","decimal":"2","convention":"decimal_dot"}');
 bad:=jsonb_set(bad,'{input,returns}',jsonb_build_array(jsonb_build_object('rowId','r1','state','linked','links',jsonb_build_array(jsonb_build_object('returnRevisionId',return_revision,'quantity','2','confirmation',jsonb_build_object('physicalReturnDate',m+1,'basis','selected_existing_return_evidence','confirmed',true,'note','Same synthetic existing warehouse return'))),'stockImpact','clear','note','')));
 bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)));
 PERFORM co_test.assert(private.co_import_validate_review_v1(bad,c,m,private.co_report_context_v1(c,m,d)->'eligible_rows')->'returnLinks'->0->>'quantity'='2','existing return evidence positively verified without netting sales');
 -- A3: a recorded physical return and agreeing printed totals alone do not
 -- establish that this exact physical source row was previously committed.
 bad:=jsonb_set(bad,'{input,returns,0}',jsonb_build_object('rowId','r1','state','unresolved','stockImpact','uncertain','links','[]'::jsonb,'note','Request prior coverage checking'));
 bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)));
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_prepare_v1(gen_random_uuid(),%L::jsonb)',(payload||jsonb_build_object('manifest',bad))::text),'22023','novel physical row requires verified previously committed return coverage despite matching totals and spare stock');
 bad:=bad||jsonb_build_object('returnProofs',jsonb_build_array(jsonb_build_object('basis','prior_committed_exact_coverage','rowId','r1')));
 bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)));
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_prepare_v1(gen_random_uuid(),%L::jsonb)',(payload||jsonb_build_object('manifest',bad))::text),'22023','caller cannot select or forge server return proof');
 PERFORM co_test.assert(NOT has_function_privilege('authenticated','private.co_import_prior_return_proof_v1(jsonb,text,uuid,date)','EXECUTE') AND NOT has_function_privilege('service_role','private.co_import_prior_return_proof_v1(jsonb,text,uuid,date)','EXECUTE'),'prior proof is private implementation only');
 -- Restore the ordinary linked case for its original physical-date negatives.
 bad:=jsonb_set(manifest,'{input,extracted,sourceRows,0,returned}','{"raw":"2","decimal":"2","convention":"decimal_dot"}');
 bad:=jsonb_set(bad,'{input,returns}',jsonb_build_array(jsonb_build_object('rowId','r1','state','linked','links',jsonb_build_array(jsonb_build_object('returnRevisionId',return_revision,'quantity','2','confirmation',jsonb_build_object('physicalReturnDate',m+1,'basis','selected_existing_return_evidence','confirmed',true,'note','Same synthetic existing warehouse return'))),'stockImpact','clear','note','')));

 bad:=jsonb_set(bad,'{input,returns,0,links,0,confirmation,physicalReturnDate}',to_jsonb(m));bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)));
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_prepare_v1(gen_random_uuid(),%L::jsonb)',(payload||jsonb_build_object('manifest',bad))::text),'22023','sale/month date cannot replace exact physical return date');
 bad:=jsonb_set(bad,'{input,returns,0,links,0,confirmation,physicalReturnDate}',to_jsonb(m+1));
 bad:=jsonb_set(bad,'{input,returns,0,links,0,quantity}','"3"');bad:=jsonb_set(bad,'{input,extracted,sourceRows,0,returned}','{"raw":"3","decimal":"3","convention":"decimal_dot"}');bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)));
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_prepare_v1(gen_random_uuid(),%L::jsonb)',(payload||jsonb_build_object('manifest',bad))::text),'22023','existing return capacity cannot be exceeded');
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-3')::uuid::text,true);
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_prepare_v1(gen_random_uuid(),%L::jsonb)',payload::text),'42501','read-only audience cannot prepare');
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-4')::uuid::text,true);
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_prepare_v1(gen_random_uuid(),%L::jsonb)',payload::text),'42501','inactive audience cannot prepare');
 PERFORM set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true);
 -- Round5 return rejection matrix: all shape-valid attacks are rehashed, with
 -- confirmed exclusions AND explicit omitted zeros so neither masks the return bug.
 FOR unsafe_case IN SELECT value FROM jsonb_array_elements($unsafe_return_cases$[
  {"label":"included absent none/uncertain blocks","included":true,"returned":null,"decision":{"rowId":"r1","state":"none","links":[],"stockImpact":"uncertain","note":"Unresolved synthetic return evidence"}},
  {"label":"included absent unresolved/clear blocks","included":true,"returned":null,"decision":{"rowId":"r1","state":"unresolved","links":[],"stockImpact":"clear","note":"Unresolved synthetic return evidence"}},
  {"label":"included absent unresolved/uncertain blocks","included":true,"returned":null,"decision":{"rowId":"r1","state":"unresolved","links":[],"stockImpact":"uncertain","note":"Unresolved synthetic return evidence"}},
  {"label":"included absent unexpected linked state blocks","included":true,"returned":null,"decision":{"rowId":"r1","state":"linked","links":[],"stockImpact":"clear","note":""}},
  {"label":"included absent unexpected links block","included":true,"returned":null,"decision":{"rowId":"r1","state":"none","links":[{"returnRevisionId":"11111111-1111-1111-1111-111111111111","quantity":"1","confirmation":{"physicalReturnDate":"2026-08-02","basis":"selected_existing_return_evidence","confirmed":true,"note":"Synthetic shape-valid unexpected link"}}],"stockImpact":"clear","note":""}},
  {"label":"included zero none/uncertain blocks","included":true,"returned":{"raw":"0","decimal":"0","convention":"decimal_dot"},"decision":{"rowId":"r1","state":"none","links":[],"stockImpact":"uncertain","note":"Unresolved synthetic return evidence"}},
  {"label":"included zero unresolved/clear blocks","included":true,"returned":{"raw":"0","decimal":"0","convention":"decimal_dot"},"decision":{"rowId":"r1","state":"unresolved","links":[],"stockImpact":"clear","note":"Unresolved synthetic return evidence"}},
  {"label":"included zero unresolved/uncertain blocks","included":true,"returned":{"raw":"0","decimal":"0","convention":"decimal_dot"},"decision":{"rowId":"r1","state":"unresolved","links":[],"stockImpact":"uncertain","note":"Unresolved synthetic return evidence"}},
  {"label":"included zero unexpected linked state blocks","included":true,"returned":{"raw":"0","decimal":"0","convention":"decimal_dot"},"decision":{"rowId":"r1","state":"linked","links":[],"stockImpact":"clear","note":""}},
  {"label":"included zero unexpected links block","included":true,"returned":{"raw":"0","decimal":"0","convention":"decimal_dot"},"decision":{"rowId":"r1","state":"none","links":[{"returnRevisionId":"11111111-1111-1111-1111-111111111111","quantity":"1","confirmation":{"physicalReturnDate":"2026-08-02","basis":"selected_existing_return_evidence","confirmed":true,"note":"Synthetic shape-valid unexpected link"}}],"stockImpact":"clear","note":""}},
  {"label":"included unresolved number with client clear blocks","included":true,"returned":{"raw":"?","decimal":null,"convention":null},"decision":{"rowId":"r1","state":"none","links":[],"stockImpact":"clear","note":""}},
  {"label":"included unresolved number with no decision blocks","included":true,"returned":{"raw":"?","decimal":null,"convention":null},"decision":null},
  {"label":"included positive return without decision blocks","included":true,"returned":{"raw":"1","decimal":"1","convention":"decimal_dot"},"decision":null},
  {"label":"excluded absent none/uncertain blocks","included":false,"returned":null,"decision":{"rowId":"r1","state":"none","links":[],"stockImpact":"uncertain","note":"Unresolved synthetic return evidence"}},
  {"label":"excluded absent unresolved/clear blocks","included":false,"returned":null,"decision":{"rowId":"r1","state":"unresolved","links":[],"stockImpact":"clear","note":"Unresolved synthetic return evidence"}},
  {"label":"excluded absent unresolved/uncertain blocks","included":false,"returned":null,"decision":{"rowId":"r1","state":"unresolved","links":[],"stockImpact":"uncertain","note":"Unresolved synthetic return evidence"}},
  {"label":"excluded absent unexpected linked state blocks","included":false,"returned":null,"decision":{"rowId":"r1","state":"linked","links":[],"stockImpact":"clear","note":""}},
  {"label":"excluded absent unexpected links block","included":false,"returned":null,"decision":{"rowId":"r1","state":"none","links":[{"returnRevisionId":"11111111-1111-1111-1111-111111111111","quantity":"1","confirmation":{"physicalReturnDate":"2026-08-02","basis":"selected_existing_return_evidence","confirmed":true,"note":"Synthetic shape-valid unexpected link"}}],"stockImpact":"clear","note":""}},
  {"label":"excluded zero none/uncertain blocks","included":false,"returned":{"raw":"0","decimal":"0","convention":"decimal_dot"},"decision":{"rowId":"r1","state":"none","links":[],"stockImpact":"uncertain","note":"Unresolved synthetic return evidence"}},
  {"label":"excluded zero unresolved/clear blocks","included":false,"returned":{"raw":"0","decimal":"0","convention":"decimal_dot"},"decision":{"rowId":"r1","state":"unresolved","links":[],"stockImpact":"clear","note":"Unresolved synthetic return evidence"}},
  {"label":"excluded zero unresolved/uncertain blocks","included":false,"returned":{"raw":"0","decimal":"0","convention":"decimal_dot"},"decision":{"rowId":"r1","state":"unresolved","links":[],"stockImpact":"uncertain","note":"Unresolved synthetic return evidence"}},
  {"label":"excluded zero unexpected linked state blocks","included":false,"returned":{"raw":"0","decimal":"0","convention":"decimal_dot"},"decision":{"rowId":"r1","state":"linked","links":[],"stockImpact":"clear","note":""}},
  {"label":"excluded zero unexpected links block","included":false,"returned":{"raw":"0","decimal":"0","convention":"decimal_dot"},"decision":{"rowId":"r1","state":"none","links":[{"returnRevisionId":"11111111-1111-1111-1111-111111111111","quantity":"1","confirmation":{"physicalReturnDate":"2026-08-02","basis":"selected_existing_return_evidence","confirmed":true,"note":"Synthetic shape-valid unexpected link"}}],"stockImpact":"clear","note":""}},
  {"label":"excluded unresolved number with client clear blocks","included":false,"returned":{"raw":"?","decimal":null,"convention":null},"decision":{"rowId":"r1","state":"none","links":[],"stockImpact":"clear","note":""}},
  {"label":"excluded unresolved number with no decision blocks","included":false,"returned":{"raw":"?","decimal":null,"convention":null},"decision":null},
  {"label":"excluded positive return without decision blocks","included":false,"returned":{"raw":"1","decimal":"1","convention":"decimal_dot"},"decision":null}
 ]$unsafe_return_cases$::jsonb) LOOP
  bad:=jsonb_set(manifest,'{input,extracted,sourceRows,0,returned}',unsafe_case->'returned');
  bad:=jsonb_set(bad,'{input,returns}',CASE WHEN unsafe_case->'decision'='null'::jsonb THEN '[]'::jsonb ELSE jsonb_build_array(unsafe_case->'decision') END);
  bad:=jsonb_set(bad,'{input,mappings,0,included}',unsafe_case->'included');
  IF unsafe_case->'included'='false'::jsonb THEN
   bad:=jsonb_set(bad,'{input,mappings,0,exclusionReason}','"Explicit synthetic exclusion"');
   bad:=jsonb_set(bad,'{input,omittedZeroStockKeyIds}',jsonb_build_array(k));
  END IF;
  bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)));
  PERFORM private.co_import_decode_v1(bad); -- ensure shape/digest is not the rejection
  attempt_request:=gen_random_uuid();before_state:=co_test.import_state(c);
  PERFORM co_test.raises(format('SELECT public.pilot_co_import_prepare_v1(%L::uuid,%L::jsonb)',attempt_request,(payload||jsonb_build_object('manifest',bad))::text),'22023',unsafe_case->>'label');
  PERFORM co_test.assert(co_test.import_state(c)=before_state,(unsafe_case->>'label')||': exact prepare state unchanged');
  PERFORM co_test.assert(NOT EXISTS(SELECT 1 FROM private.co_commands WHERE request_id=attempt_request),'rejected return left no command');
 END LOOP;
 -- Absence of a return column is not itself uncertainty; baseline prepare below
 -- keeps that PDF case. Explicit source zero is also still valid without links.
 bad:=jsonb_set(manifest,'{input,extracted,sourceRows,0,returned}','{"raw":"0","decimal":"0","convention":"decimal_dot"}');
 bad:=jsonb_set(bad,'{input,returns}','[{"rowId":"r1","state":"none","links":[],"stockImpact":"clear","note":""}]');
 bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)));
 PERFORM co_test.assert(private.co_import_validate_review_v1(bad,c,m,private.co_report_context_v1(c,m,d)->'eligible_rows')->'quantities'->>k::text='2','zero returns preserve sold quantity without netting');

 -- Round5 absent-request recovery: unknown is read-only, abandon is terminal,
 -- and a late valid prepare may not mutate anything beyond that tombstone.
 before_state:=co_test.import_state(c);
 PERFORM co_test.assert(public.pilot_reconcile_co_import_prepare_v1(abandoned_request,false)='{"status":"unknown"}'::jsonb,'absent prepare recovery is unknown');
 PERFORM co_test.assert(co_test.import_state(c)=before_state,'unknown recovery has no writes');
 PERFORM co_test.assert(public.pilot_reconcile_co_import_prepare_v1(abandoned_request,true)='{"status":"abandoned"}'::jsonb,'absent prepare request abandoned');
 PERFORM co_test.assert((SELECT status='abandoned' AND operation IS NULL AND receipt IS NULL FROM private.co_commands WHERE actor_id=auth.uid() AND request_id=abandoned_request),'terminal family-neutral tombstone retained');
 before_state:=co_test.import_state(c);
 PERFORM co_test.report_code(format('SELECT public.pilot_co_import_prepare_v1(%L::uuid,%L::jsonb)',abandoned_request,payload::text),'55000','CO request abandoned');
 PERFORM co_test.assert(public.pilot_reconcile_co_import_prepare_v1(abandoned_request,false)='{"status":"abandoned"}'::jsonb,'late prepare cannot revive tombstone');
 PERFORM co_test.assert(co_test.import_state(c)=before_state,'late prepare preserves exact tombstone and all state');

 -- Round5 post-draft failure: synthetic test-only trigger, no product failure
 -- flag and no disabled/bypassed guard. Exact PZ501 proves it observed writes.
 EXECUTE 'CREATE TRIGGER co_test_import_prepare_failure BEFORE INSERT ON private.co_import_prepare_results FOR EACH ROW EXECUTE FUNCTION co_test.fail_import_after_draft_write()';
 attempt_request:=gen_random_uuid();before_state:=co_test.import_state(c);
 PERFORM co_test.report_code(format('SELECT public.pilot_co_import_prepare_v1(%L::uuid,%L::jsonb)',attempt_request,payload::text),'PZ501','Synthetic failure after draft mutation');
 PERFORM co_test.assert(co_test.import_state(c)=before_state,'post-draft failure restores exact draft lines/version, evidence, origin, manifest, result, commands, audit and ledger');
 PERFORM co_test.assert(NOT EXISTS(SELECT 1 FROM private.co_commands WHERE request_id=attempt_request),'post-draft failure left no pending command or receipt');
 EXECUTE 'DROP TRIGGER co_test_import_prepare_failure ON private.co_import_prepare_results';
 result:=public.pilot_co_import_prepare_v1(req,payload);
 PERFORM co_test.assert(public.pilot_co_import_prepare_v1(req,payload)=result,'prepare exact retry returns original binding');
 PERFORM co_test.assert(result->>'draftVersion'=((payload->>'expected_draft_version')::bigint+1)::text,'D+1 evidence to D+2 prepare');
 PERFORM co_test.assert((SELECT sold_quantity=2 FROM private.co_report_draft_lines WHERE draft_id=d AND stock_key_id=k),'review quantity written atomically');
 PERFORM co_test.assert((SELECT to_jsonb(x)=old_evidence FROM private.co_evidence x WHERE id=e),'historical finalized evidence unchanged');
 PERFORM co_test.assert((SELECT jsonb_build_object('generation',effective_generation_id,'version',version,'movementCount',(SELECT count(*) FROM private.co_stock_movements WHERE customer_id=c),'allocationCount',(SELECT count(*) FROM private.co_sale_allocations WHERE customer_id=c))=ledger_before FROM private.co_customer_state WHERE customer_id=c),'prepare has zero ledger/revenue effects');
 PERFORM co_test.assert(public.pilot_co_import_read_v1((result->>'importId')::uuid,'1')->'manifest'=manifest,'read original source manifest');
 PERFORM co_test.raises(format('UPDATE private.co_import_manifests SET canonical_json=''{}'' WHERE id=%L::uuid',result->>'importId'),'55000','unbound manifest immutable');
 PERFORM co_test.raises(format('DELETE FROM private.co_import_manifests WHERE id=%L::uuid',result->>'importId'),'55000','unbound retention immutable');
 PERFORM co_test.raises(format('SELECT co_test.report_zero(%L::uuid)',d),'55000','legacy mutation cannot strip import origin');
 PERFORM co_test.raises(format('SELECT co_test.report_post(%L::uuid)',d),'55000','legacy post cannot bypass future atomic import commit');
 PERFORM co_test.raises(format('SELECT public.pilot_co_transaction_v1(gen_random_uuid(),''save_report_draft'',%L::jsonb)',jsonb_build_object('action','initialize','customer_id',c,'report_month',m,'draft_id',d,'expected_draft_version',result->>'draftVersion','expected_customer_version',result->>'customerVersion')::text),'55000','legacy initialize cannot erase origin');
 PERFORM co_test.assert(public.pilot_reconcile_co_import_prepare_v1(req,false)->'binding'=result,'typed prepare recovery exact immutable binding');
 PERFORM co_test.raises(format('SELECT public.pilot_reconcile_co_v1(%L::uuid,false)',req),'22023','ordinary recovery rejects prepare family');
 PERFORM co_test.raises(format('SELECT public.pilot_co_import_prepare_v1(%L::uuid,%L::jsonb)',req,(payload||'{"expected_draft_version":"999"}')::text),'22023','changed prepare retry payload rejected');
 INSERT INTO private.co_report_heads(customer_id,report_month,created_by) VALUES(c,m,auth.uid()) RETURNING id INTO original_head;
 INSERT INTO private.co_report_revisions(head_id,customer_id,revision_no,coverage_through_date,is_partial_month,created_by) VALUES(original_head,c,1,(m+interval '1 month -1 day')::date,false,auth.uid()) RETURNING id INTO original_revision;
 INSERT INTO private.co_report_imports(report_revision_id,report_head_id,customer_id,import_id) VALUES(original_revision,original_head,c,(result->>'importId')::uuid);
 PERFORM co_test.raises(format('UPDATE private.co_import_manifests SET canonical_json=''{}'' WHERE id=%L::uuid',result->>'importId'),'55000','revision-bound manifest immutable');
 PERFORM co_test.raises(format('DELETE FROM private.co_report_imports WHERE report_revision_id=%L::uuid',original_revision),'55000','revision link append-only');

END $prepare_lifecycle$;

-- Actual public correction/publication flow, with a synthetic original import
-- link seeded only because Task5 deliberately cannot publish imported primaries.
-- No trigger is disabled and no product capability/validated flag is invented.
DO $import_publication_guards$
DECLARE c uuid:=co_test.monthly_customer('import-publication');
 m date:=(date_trunc('month',now())-interval '1 month')::date;
 prior_month date:=(date_trunc('month',now())-interval '2 months')::date;
 k uuid; primary_draft uuid; downstream_draft uuid; e uuid; downstream_head uuid;
 downstream_revision uuid; replayed_revision uuid; primary_revision uuid;
 manifest jsonb; payload jsonb; prepared jsonb; correction jsonb; preview jsonb;
 before_state jsonb; imported_draft_before jsonb; attempt_request uuid:=gen_random_uuid();
BEGIN
 PERFORM co_test.monthly_delivery(c,'IMPORT-PUBLICATION','SYNTHETIC',10,'3',prior_month);
 SELECT id INTO k FROM private.co_stock_keys WHERE customer_id=c;
 PERFORM public.pilot_co_declare_stock_key_unit_v1(gen_random_uuid(),jsonb_build_object('customer_id',c,'stock_key_id',k,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'expected_unit_version',null,'unit','PCS','reason','Synthetic publication counter','confirmed',true));
 primary_draft:=co_test.report_init(c,prior_month);
 PERFORM co_test.report_zero(primary_draft);PERFORM co_test.report_post(primary_draft);
 downstream_draft:=co_test.report_init(c,m);
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',co_test.report_input(downstream_draft)||jsonb_build_object('action','upsert_lines','lines',jsonb_build_array(jsonb_build_object('stock_key_id',k,'sold_quantity',2))));
 PERFORM co_test.report_post(downstream_draft);
 SELECT id,current_revision_id INTO downstream_head,downstream_revision FROM private.co_report_heads WHERE customer_id=c AND report_month=m;

 -- A valid imported Edit draft must reach the same primary publication barrier,
 -- not be rejected merely for malformed input, a stale version or missing head.
 downstream_draft:=co_test.refresh_report(c,m);
 e:=(co_test.evidence_register(downstream_draft)->>'id')::uuid;
 PERFORM co_test.attest(e);PERFORM co_test.evidence_finalize(e);
 manifest:=co_test.import_manifest(c,m,e,k);
 payload:=jsonb_build_object('manifest',manifest,'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'expected_draft_version',(SELECT version::text FROM private.co_drafts WHERE id=downstream_draft),'expected_evidence_version','2');
 prepared:=public.pilot_co_import_prepare_v1(gen_random_uuid(),payload);
 correction:=co_test.report_correction(downstream_draft);
 preview:=public.pilot_co_preview_v1('correct_report',correction);
 PERFORM co_test.assert(preview->>'can_post'='true','valid imported correction reaches publication guard');
 before_state:=co_test.import_state(c);
 PERFORM co_test.report_code(format('SELECT public.pilot_co_transaction_v1(%L::uuid,''correct_report'',%L::jsonb)',attempt_request,(correction||jsonb_build_object('preview_fingerprint',preview->>'preview_fingerprint'))::text),'55000','Atomic import commit required');
 PERFORM co_test.assert(co_test.import_state(c)=before_state,'direct correct_report guard rolls back revisions/lines, heads, drafts, command, audit and ledger');
 PERFORM co_test.assert(NOT EXISTS(SELECT 1 FROM private.co_commands WHERE request_id=attempt_request),'direct correction failure leaves no command');

 -- The only direct import-link insert seeds the original historical revision.
 -- The NEW downstream link must be made by co_publish_reviewed_v1 through
 -- co_link_evidence_v1 -> co_link_import_v1, never by fixture insertion.
 INSERT INTO private.co_report_imports(report_revision_id,report_head_id,customer_id,import_id)
 VALUES(downstream_revision,downstream_head,c,(prepared->>'importId')::uuid);
 SELECT to_jsonb(x) INTO imported_draft_before FROM private.co_drafts x WHERE id=downstream_draft;
 primary_draft:=co_test.refresh_report(c,prior_month);
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',co_test.report_input(primary_draft)||jsonb_build_object('action','upsert_lines','lines',jsonb_build_array(jsonb_build_object('stock_key_id',k,'sold_quantity',1))));
 correction:=co_test.report_correction(primary_draft);
 preview:=public.pilot_co_preview_v1('correct_report',correction);
 PERFORM co_test.assert(preview->>'can_post'='true','manual primary correction can replay imported downstream history');
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'correct_report',correction||jsonb_build_object('preview_fingerprint',preview->>'preview_fingerprint'));
 SELECT current_revision_id INTO replayed_revision FROM private.co_report_heads WHERE id=downstream_head;
 SELECT current_revision_id INTO primary_revision FROM private.co_report_heads WHERE customer_id=c AND report_month=prior_month;
 PERFORM co_test.assert(replayed_revision<>downstream_revision,'public correction actually published a downstream revision');
 PERFORM co_test.assert((SELECT import_id=(prepared->>'importId')::uuid AND report_head_id=downstream_head AND customer_id=c FROM private.co_report_imports WHERE report_revision_id=replayed_revision),'publication hook inherits downstream own-original import');
 PERFORM co_test.assert((SELECT import_id=(prepared->>'importId')::uuid FROM private.co_report_imports WHERE report_revision_id=downstream_revision),'original downstream import link remains unchanged');
 PERFORM co_test.assert((SELECT count(*)=2 FROM private.co_report_imports WHERE customer_id=c),'only original and replayed downstream links exist');
 PERFORM co_test.assert(NOT EXISTS(SELECT 1 FROM private.co_report_imports WHERE report_revision_id=primary_revision),'downstream file is not attached to primary month');
 PERFORM co_test.assert((SELECT to_jsonb(x)=imported_draft_before FROM private.co_drafts x WHERE id=downstream_draft),'system replay does not mutate the prepared downstream draft');
END $import_publication_guards$;
ROLLBACK;
SELECT 'CO_IMPORT_PREPARE_LIFECYCLE_PASSED';

BEGIN;
DO $$
DECLARE item record; value jsonb;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('dot grouped','1,080.25','decimal_dot','1080.25'),
  ('comma grouped','1.080,25','decimal_comma','1080.25'),
  ('dot explicit ambiguity','1.234','decimal_dot','1.234'),
  ('comma explicit ambiguity','1.234','decimal_comma','1234'),
  ('leading zeros/fraction preserved','001,2300','decimal_comma','1.2300'),
  ('integer text zero','0','canonical_integer_text','0'),
  ('integer text beyond JS precision','9007199254740993','canonical_integer_text','9007199254740993')
 ) vectors(name,raw,convention,decimal) LOOP
  value:=jsonb_build_object('raw',item.raw,'decimal',item.decimal,'convention',item.convention);
  PERFORM co_test.assert(private.co_import_source_number_v1(value,false)=item.decimal,'numeric convention vector '||item.name);
 END LOOP;
 PERFORM co_test.assert(private.co_import_source_number_v1('{"raw":"-","decimal":"0","convention":"dash_zero"}',true)='0','explicit permitted PDF discount dash zero');
 FOR value IN SELECT x FROM jsonb_array_elements('[
  {"raw":"2","decimal":"3","convention":"decimal_dot"},
  {"raw":"2","decimal":"2"},
  {"raw":"2","decimal":"2","convention":null},
  {"raw":"2","decimal":"2","convention":"auto_detect"},
  {"raw":"1.234","decimal":"1234","convention":"decimal_dot"},
  {"raw":"1,080.25","decimal":"1080.25","convention":"decimal_comma"},
  {"raw":" 0","decimal":"0","convention":"canonical_integer_text"},
  {"raw":"1e3","decimal":"1000","convention":"canonical_integer_text"},
  {"raw":"-","decimal":"0","convention":"dash_zero"}
 ]') x LOOP
  BEGIN
   PERFORM private.co_import_source_number_v1(value,false);
   RAISE EXCEPTION 'Unsupported/missing/tampered raw convention accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
 END LOOP;
END $$;
ROLLBACK;
SELECT 'CO_IMPORT_NUMERIC_CONVENTIONS_PASSED';

-- Task 3 AUTHORED, NOT EXECUTED: shared strict manual-v2 wire fixture, not receipt permission.
BEGIN;
DO $manual_shape$
DECLARE m jsonb:=$manual_xlsx_shape$
{
  "schemaVersion": 1,
  "evidenceId": "11111111-1111-1111-1111-111111111111",
  "digest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "input": {
    "scope": {
      "actorId": "11111111-1111-1111-1111-111111111111",
      "customerId": "11111111-1111-1111-1111-111111111111",
      "reportMonth": "2026-08-01",
      "epoch": 1
    },
    "extracted": {
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "format": "xlsx",
      "parserVersion": "co-human-transcribed-2",
      "sourceRows": [
        {
          "id": "r4",
          "ref": {
            "fileSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "page": null,
            "sheet": "Sheet",
            "row": "r4",
            "section": "s1"
          },
          "sourceSku": "001",
          "name": "Synthetic",
          "transactionDate": null,
          "transactionReference": null,
          "quantity": {
            "raw": "1",
            "decimal": "1",
            "convention": "canonical_integer_text"
          },
          "returned": null,
          "unit": "PCS",
          "unitPrice": {
            "raw": "10",
            "decimal": "10",
            "convention": "canonical_integer_text"
          },
          "discount": null,
          "discountBasis": null,
          "netUnitPrice": null,
          "amount": {
            "raw": "10",
            "decimal": "10",
            "convention": "canonical_integer_text"
          },
          "currency": "IDR",
          "priceBasisLabel": null,
          "flags": []
        }
      ],
      "sections": [
        {
          "id": "s1",
          "label": "Synthetic",
          "rowIds": [
            "r4"
          ],
          "printedTotal": null
        }
      ],
      "periodCandidates": [],
      "customerCandidates": [],
      "warnings": [
        "manual_review:safe_unsupported_xlsx_layout"
      ],
      "manualWorkbook": {
        "version": 1,
        "policy": "co-manual-xlsx-values-1",
        "sheets": [
          {
            "name": "Sheet",
            "rows": [
              4,
              10
            ]
          },
          {
            "name": "Other",
            "rows": []
          }
        ]
      },
      "manualTranscription": {
        "mode": "human_transcribed",
        "version": 2,
        "originalParserVersion": "co-guarded-xlsx-7",
        "originalWarnings": [
          "manual_review:safe_unsupported_xlsx_layout"
        ],
        "reason": "Read every original sheet",
        "confirmed": true
      },
      "manualPrintedControls": {
        "version": 2,
        "reviewedSheets": [
          "Sheet",
          "Other"
        ],
        "confirmed": true,
        "controls": [
          {
            "ref": {
              "fileSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "page": null,
              "sheet": "Sheet",
              "row": "r10",
              "section": "s1"
            },
            "rowIds": [
              "r4"
            ],
            "count": null,
            "quantity": null,
            "returned": null,
            "amount": {
              "raw": "10",
              "decimal": "10",
              "convention": "canonical_integer_text"
            }
          }
        ]
      }
    },
    "mappings": [],
    "returns": [],
    "includedSectionIds": [],
    "completenessConfirmed": false,
    "omittedZeroStockKeyIds": [],
    "currency": null,
    "reason": null
  }
}
$manual_xlsx_shape$::jsonb; bad jsonb;
BEGIN
 m:=jsonb_set(m,'{digest}',to_jsonb(private.co_manifest_digest_v1(m)));
 PERFORM private.co_import_decode_v1(m);
 FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
  jsonb_set(m,'{input,extracted,manualPrintedControls,reviewedSheets}','["Sheet"]'),
  jsonb_set(m,'{input,extracted,manualPrintedControls,controls,0,amount}','null'),
  jsonb_set(m,'{input,extracted,manualPrintedControls,controls,0,ref,row}','"r4"'),
  jsonb_set(m,'{input,extracted,manualPrintedControls,controls,0,rowIds}','["r4","r4"]'),
  jsonb_set(m,'{input,extracted,manualTranscription,version}','1'),
  m#-'{input,extracted,manualPrintedControls,controls,0,count}',
  jsonb_set(m,'{input,extracted,printedControls}','[]')
 )) LOOP
  bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)));
  BEGIN PERFORM private.co_import_decode_v1(bad); RAISE EXCEPTION 'Invalid manual shape accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 END LOOP;
 -- PDF/automatic manifests must not gain the additive manual control property.
 bad:=jsonb_set(jsonb_set(m,'{input,extracted,parserVersion}','"co-guarded-xlsx-7"'),'{input,extracted,warnings}','[]')#-'{input,extracted,manualTranscription}';
 bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)));
 BEGIN PERFORM private.co_import_decode_v1(bad); RAISE EXCEPTION 'Automatic manual controls accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $manual_shape$;
ROLLBACK;
