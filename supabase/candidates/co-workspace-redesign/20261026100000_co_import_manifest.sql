-- CANDIDATE ONLY: future destination supabase/migrations/20261026100000_co_import_manifest.sql.
-- Promotion requires completed review/execution gates and separate rollout authorization.
-- Exact composed-baseline runtime verification required before promotion.
-- Additive immutable import evidence; never modifies historical quantity meaning.
BEGIN;
SET LOCAL search_path='';
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';

-- The workspace supports the historical bare engine and the complete catalogue
-- generation-one profile only. Generation-two engines and public routers remain
-- unchanged. Fresh workspace work holds the cutover drain lock; receipt recovery
-- deliberately runs before this guard. A partial catalogue is never a bare engine.
CREATE FUNCTION private.co_workspace_generation_guard_v1() RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE catalogue boolean:=to_regclass('private.catalog_cutover_v1') IS NOT NULL; signature text; relation text; present boolean; generation smallint;
BEGIN
 FOREACH relation IN ARRAY ARRAY['private.catalog_identity_v1','private.catalog_requests_v1','private.catalog_co_active_v2','private.catalog_writer_active_v2'] LOOP
  IF (to_regclass(relation) IS NOT NULL) IS DISTINCT FROM catalogue THEN RAISE EXCEPTION 'Partial catalogue workspace profile' USING ERRCODE='55000'; END IF;
 END LOOP;
 FOREACH signature IN ARRAY ARRAY[
  'private.catalog_co_legacy_transaction_v1(uuid,text,jsonb)',
  'private.catalog_co_transaction_v2(uuid,text,jsonb)',
  'private.catalog_co_dispatch_v2(uuid,text,jsonb)',
  'private.catalog_co_monthly_transaction_v2(uuid,text,jsonb)',
  'private.catalog_evidence_legacy_v1(uuid,text,jsonb)',
  'private.catalog_evidence_core_v2(uuid,text,jsonb,boolean)',
  'private.catalog_history_producers_v1()',
  'private.catalog_history_foreign_keys_v1()'
 ] LOOP
  present:=to_regprocedure(signature) IS NOT NULL;
  IF present IS DISTINCT FROM catalogue THEN RAISE EXCEPTION 'Partial catalogue workspace profile' USING ERRCODE='55000'; END IF;
 END LOOP;
 IF NOT catalogue THEN RETURN; END IF;
 EXECUTE 'SELECT execution_generation FROM private.catalog_cutover_v1 WHERE singleton FOR SHARE' INTO STRICT generation;
 IF generation IS DISTINCT FROM 1 THEN
  RAISE EXCEPTION 'CO workspace supports catalogue generation one only' USING ERRCODE='55000',DETAIL='CO_WORKSPACE_GENERATION_UNSUPPORTED';
 END IF;
END $$;
REVOKE ALL ON FUNCTION private.co_workspace_generation_guard_v1() FROM PUBLIC,anon,authenticated,service_role;
DO $workspace_profile$ BEGIN PERFORM private.co_workspace_generation_guard_v1(); END $workspace_profile$;

-- Complete current-profile hook preimages, authored from public catalogue sources
-- new06/new07 and the immutable 110008 evidence hook's reviewed result hash.
-- Never learn an expected pin from the destination. Unknown pg_proc metadata fails.
DO $workspace_current_preimages$
DECLARE x record; original text; semantic_meta jsonb; reviewed_meta jsonb;
BEGIN
 IF to_regclass('private.catalog_cutover_v1') IS NULL THEN RETURN; END IF;
 FOR x IN SELECT * FROM (VALUES
  ('catalog_co_legacy_transaction_v1','2fe1a0188e2d64eaadce590c947e4358ac6e620117b5470abde87eb8dd6fdace'),
  ('catalog_evidence_legacy_v1','09b0bece164b911bb6a25114ab76b5ef5ba2ff1a46020c9747a88e9141dd6fb7'),
  ('co_monthly_transaction_v1','0442408fd2b5cee0326495e155f75f62ae96a30bd02e1888fcebdb3204ddf61f')
 ) AS pins(name,body_sha256) LOOP
  SELECT prosrc INTO STRICT original FROM pg_proc WHERE oid=('private.'||x.name||'(uuid,text,jsonb)')::regprocedure;
  IF encode(sha256(convert_to(original,'UTF8')),'hex') IS DISTINCT FROM x.body_sha256 THEN RAISE EXCEPTION 'Unreviewed workspace hook body: %',x.name; END IF;
  reviewed_meta:='{"probin":null,"procost":100,"prokind":"f","prorows":0,"proconfig":["search_path=\"\""],"proretset":false,"prosqlbody":null,"prosupport":"-","proargmodes":null,"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0,"proowner":"postgres","pronamespace":"private","prolang":"plpgsql","prorettype":"jsonb","proacl":[{"grantor":"postgres","grantee":"postgres","privilege":"EXECUTE","grantable":false}],"pronargs":3,"prosecdef":true,"proargnames":["p_request_id","p_operation","p_payload"],"proargtypes":["uuid","text","jsonb"]}'::jsonb || jsonb_build_object('proname',x.name);
  SELECT (to_jsonb(p)-ARRAY['oid','prosrc','proowner','pronamespace','prolang','prorettype','proargtypes','proacl'])
   || jsonb_build_object('proowner',pg_get_userbyid(p.proowner),'pronamespace',n.nspname,'prolang',l.lanname,'prorettype',p.prorettype::regtype::text,
    'proargtypes',(SELECT jsonb_agg(t::regtype::text ORDER BY ord) FROM unnest(p.proargtypes) WITH ORDINALITY a(t,ord)),
    'proacl',(SELECT jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.grantee::regrole::text,a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a))
   INTO STRICT semantic_meta FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=('private.'||x.name||'(uuid,text,jsonb)')::regprocedure;
  IF semantic_meta IS DISTINCT FROM reviewed_meta THEN RAISE EXCEPTION 'Unreviewed workspace hook metadata: %',x.name; END IF;
 END LOOP;
END $workspace_current_preimages$;

-- Reuse the exact existing command envelope. Inspect only under its actor/request
-- lock, replay through its unchanged identity checks, and admit fresh workspace
-- work before the existing helper can insert a pending command row.
CREATE FUNCTION private.co_workspace_command_begin_v1(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE actor uuid:=private.co_actor_v1();
BEGIN
 IF p_request_id IS NULL OR p_operation IS NULL OR p_operation NOT IN('declare_stock_key_unit','prepare_import','review_import')
 OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Invalid workspace command' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('co-command:'||actor::text||':'||p_request_id::text,0));
 IF EXISTS(SELECT 1 FROM private.co_commands WHERE actor_id=actor AND request_id=p_request_id) THEN
  RETURN private.co_command_begin_v1(p_request_id,p_operation,p_payload);
 END IF;
 PERFORM private.co_workspace_generation_guard_v1();
 RETURN private.co_command_begin_v1(p_request_id,p_operation,p_payload);
END $$;
REVOKE ALL ON FUNCTION private.co_workspace_command_begin_v1(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.co_manifest_canonical_v1(v jsonb, depth integer DEFAULT 0) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE kind text:=jsonb_typeof(v); result text; x record; n numeric;
BEGIN
 IF depth=0 THEN PERFORM private.co_import_work_v1(v); PERFORM private.co_import_budget_v1(v); END IF;
 IF v IS NULL OR depth>32 THEN RAISE EXCEPTION 'Invalid canonical value' USING ERRCODE='22023'; END IF;
 CASE kind
 WHEN 'null' THEN RETURN 'n';
 WHEN 'boolean' THEN RETURN CASE WHEN v='true'::jsonb THEN 't' ELSE 'f' END;
 WHEN 'number' THEN n:=(v#>>'{}')::numeric;
  IF n<0 OR n>9007199254740991 OR trunc(n)<>n THEN RAISE EXCEPTION 'Invalid canonical integer' USING ERRCODE='22023'; END IF;
  RETURN 'i'||trunc(n)::text||';';
 WHEN 'string' THEN result:=v#>>'{}'; RETURN 's'||octet_length(convert_to(result,'UTF8'))::text||':'||result;
 WHEN 'array' THEN
  IF jsonb_array_length(v)>10000 THEN RAISE EXCEPTION 'Canonical array limit' USING ERRCODE='22023'; END IF;
  result:='a'||jsonb_array_length(v)::text||':';
  FOR x IN SELECT value FROM jsonb_array_elements(v) WITH ORDINALITY a(value,ordinal) ORDER BY ordinal LOOP result:=result||private.co_manifest_canonical_v1(x.value,depth+1); END LOOP;
 WHEN 'object' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(v))>10000 THEN RAISE EXCEPTION 'Canonical key limit' USING ERRCODE='22023'; END IF;
  result:='o'||(SELECT count(*)::text FROM jsonb_object_keys(v))||':';
  FOR x IN SELECT key,value FROM jsonb_each(v) ORDER BY key COLLATE "C" LOOP result:=result||private.co_manifest_canonical_v1(to_jsonb(x.key),depth+1)||private.co_manifest_canonical_v1(x.value,depth+1); END LOOP;
 ELSE RAISE EXCEPTION 'Invalid canonical kind' USING ERRCODE='22023';
 END CASE;
 RETURN result;
END $$;
CREATE FUNCTION private.co_manifest_digest_v1(v jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT encode(sha256(convert_to(E'co-import-manifest-v1\n'||private.co_manifest_canonical_v1(v-'digest'),'UTF8')),'hex');
$$;

-- JavaScript string bounds use UTF-16 code units, not PostgreSQL code points.
CREATE FUNCTION private.co_import_text_units_v1(v text) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT length(v)+coalesce(sum(CASE WHEN ascii(substr(v,i,1))>65535 THEN 1 ELSE 0 END),0)::integer FROM generate_series(1,length(v)) i;
$$;

-- ECMAScript String.trim whitespace, explicitly enumerated rather than locale
-- btrim/[:space:] defaults. Reject invalid declarations; never normalize history.
CREATE FUNCTION private.co_import_trim_v1(v text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT btrim(v,chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||
 chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279));
$$;
CREATE FUNCTION private.co_unit_label_valid_v1(v text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT v IS NOT NULL AND v=private.co_import_trim_v1(v) AND private.co_import_text_units_v1(v) BETWEEN 1 AND 128
 AND v!~('['||chr(1)||'-'||chr(31)||chr(127)||']');
$$;
CREATE FUNCTION private.co_unit_reason_valid_v1(v text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT v IS NOT NULL AND private.co_import_trim_v1(v)<>'' AND private.co_import_text_units_v1(v)<=2000;
$$;

CREATE TABLE private.co_stock_key_unit_declarations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL, stock_key_id uuid NOT NULL,
 version bigint NOT NULL DEFAULT 1 CHECK(version=1), unit text NOT NULL CHECK(private.co_unit_label_valid_v1(unit)),
 declared_by uuid NOT NULL REFERENCES public.users(id), declared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 request_id uuid NOT NULL, reason text NOT NULL CHECK(private.co_unit_reason_valid_v1(reason)),
 FOREIGN KEY(stock_key_id,customer_id) REFERENCES private.co_stock_keys(id,customer_id),
 FOREIGN KEY(declared_by,request_id) REFERENCES private.co_commands(actor_id,request_id),
 UNIQUE(customer_id,stock_key_id), UNIQUE(id,customer_id,stock_key_id,version)
);
CREATE INDEX co_unit_declaration_request ON private.co_stock_key_unit_declarations(declared_by,request_id);
CREATE TRIGGER co_unit_declaration_immutable BEFORE UPDATE OR DELETE ON private.co_stock_key_unit_declarations FOR EACH ROW EXECUTE FUNCTION private.co_immutable_v1();
ALTER TABLE private.co_stock_key_unit_declarations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.co_stock_key_unit_declarations FROM PUBLIC,anon,authenticated,service_role;

-- One existing command envelope and unchanged strict five-field receipt. New
-- operations do not enter ordinary transaction dispatch or evidence recovery.
DO $$
DECLARE definition text; old text:='''resolve_undelivered'',''close_co'')';
BEGIN
 SELECT pg_get_functiondef('private.co_command_begin_v1(uuid,text,jsonb)'::regprocedure) INTO definition;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'Command operation anchor drift'; END IF;
 EXECUTE replace(definition,old,'''resolve_undelivered'',''close_co'',''declare_stock_key_unit'',''prepare_import'',''review_import'')');
 -- Prevent ordinary/evidence recovery from misclassifying the new command families.
 SELECT pg_get_functiondef('private.co_evidence_reconcile_v1(uuid,boolean,boolean)'::regprocedure) INTO definition;
 old:='IF command.operation IS NOT NULL AND';
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'Recovery family anchor drift'; END IF;
 EXECUTE replace(definition,old,'IF command.operation IN(''declare_stock_key_unit'',''prepare_import'',''review_import'') THEN RAISE EXCEPTION ''CO request family mismatch'' USING ERRCODE=''22023''; END IF; '||old);
END $$;
CREATE FUNCTION public.pilot_co_declare_stock_key_unit_v1(p_request_id uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.co_actor_v1(); r jsonb; c uuid; k uuid; cv bigint; u text; why text; declaration private.co_stock_key_unit_declarations%ROWTYPE;
BEGIN
 PERFORM private.co_input_object_v1(p_payload,ARRAY['customer_id','stock_key_id','expected_customer_version','expected_unit_version','unit','reason','confirmed'],ARRAY['customer_id','stock_key_id','expected_customer_version','expected_unit_version','unit','reason','confirmed']);
 IF p_payload->'confirmed' IS DISTINCT FROM 'true'::jsonb OR p_payload->'expected_unit_version' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Explicit first unit declaration required' USING ERRCODE='22023'; END IF;
 c:=private.co_input_uuid_v1(p_payload->'customer_id'); k:=private.co_input_uuid_v1(p_payload->'stock_key_id');
 u:=private.co_input_text_v1(p_payload->'unit'); why:=private.co_input_text_v1(p_payload->'reason');
 IF NOT private.co_unit_label_valid_v1(u) OR NOT private.co_unit_reason_valid_v1(why) THEN RAISE EXCEPTION 'Invalid unit confirmation' USING ERRCODE='22023'; END IF;
 r:=private.co_workspace_command_begin_v1(p_request_id,'declare_stock_key_unit',p_payload); IF r IS NOT NULL THEN RETURN r; END IF;
 PERFORM private.co_workspace_generation_guard_v1();
 cv:=private.co_lock_customer_v1(c,private.co_input_version_v1(p_payload->'expected_customer_version'));
 IF NOT EXISTS(SELECT 1 FROM private.co_stock_keys WHERE id=k AND customer_id=c) THEN RAISE EXCEPTION 'Invalid unit stock identity' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM private.co_stock_key_unit_declarations WHERE customer_id=c AND stock_key_id=k) THEN RAISE EXCEPTION 'CO_UNIT_ALREADY_DECLARED' USING ERRCODE='PT409'; END IF;
 INSERT INTO private.co_stock_key_unit_declarations(customer_id,stock_key_id,unit,declared_by,request_id,reason) VALUES(c,k,u,actor,p_request_id,why) RETURNING * INTO declaration;
 UPDATE private.co_customer_state SET version=version+1 WHERE customer_id=c RETURNING version INTO cv;
 INSERT INTO private.co_audit_events(customer_id,actor_id,request_id,operation,reason,before_state,after_state)
 VALUES(c,actor,p_request_id,'declare_stock_key_unit',why,jsonb_build_object('state','unknown','stock_key_id',k),to_jsonb(declaration));
 RETURN private.co_command_commit_v1(p_request_id,jsonb_build_object('id',declaration.id,'operation','declare_stock_key_unit','version','1','customer_id',c,'customer_version',cv::text));
END $$;
CREATE FUNCTION public.pilot_co_stock_key_units_v1(p_customer_id uuid,p_stock_key_ids uuid[],p_expected_customer_version text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cv text; rows jsonb;
BEGIN
 cv:=private.co_read_lock_v1(p_customer_id,p_expected_customer_version);
 IF p_expected_customer_version IS NULL OR p_stock_key_ids IS NULL OR cardinality(p_stock_key_ids) NOT BETWEEN 1 AND 1000 OR array_position(p_stock_key_ids,NULL) IS NOT NULL
 OR (SELECT count(DISTINCT id) FROM unnest(p_stock_key_ids) id)<>cardinality(p_stock_key_ids)
 OR EXISTS(SELECT 1 FROM unnest(p_stock_key_ids) id WHERE NOT EXISTS(SELECT 1 FROM private.co_stock_keys k WHERE k.id=id AND k.customer_id=p_customer_id)) THEN RAISE EXCEPTION 'Invalid unit read identities' USING ERRCODE='22023'; END IF;
 SELECT jsonb_agg(jsonb_build_object('customerId',p_customer_id,'stockKeyId',ids.id,'state',CASE WHEN d.id IS NULL THEN 'unknown' ELSE 'declared' END,
 'declaration',CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object('id',d.id,'version',d.version::text,'unit',d.unit,'declaredBy',d.declared_by,'declaredAt',d.declared_at,'reason',d.reason) END) ORDER BY ids.ordinal) INTO rows
 FROM unnest(p_stock_key_ids) WITH ORDINALITY ids(id,ordinal) LEFT JOIN private.co_stock_key_unit_declarations d ON d.stock_key_id=ids.id AND d.customer_id=p_customer_id;
 RETURN jsonb_build_object('customerVersion',cv,'rows',rows);
END $$;
CREATE FUNCTION public.pilot_reconcile_co_unit_v1(p_request_id uuid,p_abandon boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.co_actor_v1(); command private.co_commands%ROWTYPE;
BEGIN
 IF p_request_id IS NULL OR p_abandon IS NULL THEN RAISE EXCEPTION 'Invalid unit recovery' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('co-command:'||actor::text||':'||p_request_id::text,0));
 SELECT * INTO command FROM private.co_commands WHERE actor_id=actor AND request_id=p_request_id FOR UPDATE;
 IF command.operation IS NOT NULL AND command.operation<>'declare_stock_key_unit' THEN RAISE EXCEPTION 'CO request family mismatch' USING ERRCODE='22023'; END IF;
 IF command.status='committed' THEN RETURN jsonb_build_object('status','committed','operation',command.operation,'receipt',command.receipt); END IF;
 IF command.status='abandoned' THEN RETURN jsonb_build_object('status','abandoned'); END IF;
 IF command.status='pending' THEN RETURN jsonb_build_object('status','unknown'); END IF;
 IF p_abandon THEN INSERT INTO private.co_commands(actor_id,request_id,status) VALUES(actor,p_request_id,'abandoned'); RETURN jsonb_build_object('status','abandoned'); END IF;
 RETURN jsonb_build_object('status','unknown');
END $$;

-- Small recursive wire-shape decoder, private and bounded. Schema syntax is owned
-- by this migration, never supplied by authenticated callers.
CREATE FUNCTION private.co_import_shape_v1(v jsonb,s jsonb,depth integer DEFAULT 0) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE kind text:=jsonb_typeof(s); rule text; value text; entry record; name text; required text[]:='{}'; allowed text[]:='{}';
BEGIN
 IF depth>32 OR v IS NULL THEN RAISE EXCEPTION 'Invalid import shape' USING ERRCODE='22023'; END IF;
 IF kind='string' THEN
  rule:=s#>>'{}';
  IF left(rule,1)='?' THEN IF v='null'::jsonb THEN RETURN; END IF; rule:=substr(rule,2); END IF;
  IF rule='boolean' THEN IF jsonb_typeof(v)<>'boolean' THEN RAISE EXCEPTION 'Invalid import boolean' USING ERRCODE='22023'; END IF; RETURN; END IF;
  IF rule='page' THEN IF jsonb_typeof(v)<>'number' OR v::numeric<1 OR trunc(v::numeric)<>v::numeric OR v::numeric>9007199254740991 THEN RAISE EXCEPTION 'Invalid import page' USING ERRCODE='22023'; END IF; RETURN; END IF;
  IF rule='count' THEN IF jsonb_typeof(v)<>'number' OR v::numeric<0 OR trunc(v::numeric)<>v::numeric OR v::numeric>9007199254740991 THEN RAISE EXCEPTION 'Invalid import count' USING ERRCODE='22023'; END IF; RETURN; END IF;
  IF jsonb_typeof(v)<>'string' THEN RAISE EXCEPTION 'Invalid import text' USING ERRCODE='22023'; END IF;
  value:=v#>>'{}';
  IF private.co_import_text_units_v1(value)>4096 THEN RAISE EXCEPTION 'Import text limit' USING ERRCODE='22023'; END IF;
  CASE rule
  WHEN 'uuid' THEN IF value!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Invalid import UUID' USING ERRCODE='22023'; END IF;
  WHEN 'hash' THEN IF value!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid import hash' USING ERRCODE='22023'; END IF;
  WHEN 'date' THEN PERFORM private.co_input_date_v1(v);
  WHEN 'month' THEN IF extract(day FROM private.co_input_date_v1(v))<>1 THEN RAISE EXCEPTION 'Invalid import month' USING ERRCODE='22023'; END IF;
  WHEN 'quantity' THEN IF private.co_import_text_units_v1(value)>128 OR value!~'^(0|[1-9][0-9]*)$' THEN RAISE EXCEPTION 'Invalid import quantity text' USING ERRCODE='22023'; END IF;
  WHEN 'decimal' THEN IF private.co_import_text_units_v1(value)>128 OR value!~'^-?(0|[1-9][0-9]*)(\.[0-9]+)?$' THEN RAISE EXCEPTION 'Invalid source decimal' USING ERRCODE='22023'; END IF;
  WHEN 'label' THEN IF private.co_import_text_units_v1(value)>256 OR private.co_import_trim_v1(value)='' THEN RAISE EXCEPTION 'Invalid import label' USING ERRCODE='22023'; END IF;
  WHEN 'note' THEN IF private.co_import_text_units_v1(value)>2000 OR private.co_import_trim_v1(value)='' THEN RAISE EXCEPTION 'Invalid import note' USING ERRCODE='22023'; END IF;
  WHEN 'text' THEN NULL;
  ELSE
   IF left(rule,5)='text:' THEN IF private.co_import_text_units_v1(value)>(substr(rule,6))::integer THEN RAISE EXCEPTION 'Import text limit' USING ERRCODE='22023'; END IF;
   ELSIF left(rule,5)='enum:' THEN IF NOT value=ANY(string_to_array(substr(rule,6),'|')) THEN RAISE EXCEPTION 'Invalid import enum' USING ERRCODE='22023'; END IF;
   ELSE RAISE EXCEPTION 'Unknown private import schema' USING ERRCODE='55000'; END IF;
  END CASE;
 ELSIF kind='array' THEN
  IF jsonb_typeof(v)<>'array' OR jsonb_array_length(v)>(s->>1)::integer THEN RAISE EXCEPTION 'Invalid import list' USING ERRCODE='22023'; END IF;
  FOR entry IN SELECT element.value FROM jsonb_array_elements(v) AS element(value) LOOP
   PERFORM private.co_import_shape_v1(entry.value,s->0,depth+1);
  END LOOP;
 ELSIF kind='object' THEN
  IF s?'$nullable' THEN IF v='null'::jsonb THEN RETURN; END IF; PERFORM private.co_import_shape_v1(v,s->'$nullable',depth+1); RETURN; END IF;
  FOR entry IN SELECT property.key,property.value FROM jsonb_each(s) AS property LOOP
   name:=ltrim(entry.key,'?');
   allowed:=array_append(allowed,name);
   IF left(entry.key,1)<>'?' THEN required:=array_append(required,name); END IF;
  END LOOP;
  PERFORM private.co_input_object_v1(v,required,allowed);
  FOR entry IN SELECT property.key,property.value FROM jsonb_each(s) AS property LOOP
   name:=ltrim(entry.key,'?');
   IF v?name THEN PERFORM private.co_import_shape_v1(v->name,entry.value,depth+1); END IF;
  END LOOP;
 ELSE RAISE EXCEPTION 'Invalid private import schema' USING ERRCODE='55000';
 END IF;
END $$;
-- Human provenance is a statement, never a waiver of unsafe package/quantity checks.
CREATE FUNCTION private.co_import_manual_valid_v1(source jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce((
 (source->>'format'='pdf' AND source->>'parserVersion'='co-human-transcribed-1'
  AND source->'warnings'='["manual_review:unsupported_layout_or_image_only"]'::jsonb
  AND source->'manualTranscription'->'version'='1'::jsonb
  AND source->'manualTranscription'->>'originalParserVersion'='co-searchable-pdf-3')
 OR (source->>'format'='xlsx' AND source->>'parserVersion'='co-human-transcribed-2'
  AND source->'warnings'='["manual_review:safe_unsupported_xlsx_layout"]'::jsonb
  AND source->'manualTranscription'->'version'='2'::jsonb
  AND source->'manualTranscription'->>'originalParserVersion'='co-guarded-xlsx-7'
  AND source?'manualWorkbook' AND source?'manualPrintedControls' AND NOT source?'printedControls'))
 AND source->'manualTranscription'->>'mode'='human_transcribed'
 AND source->'manualTranscription'->'confirmed'='true'::jsonb
 AND source->'manualTranscription'->'originalWarnings'=source->'warnings'
 AND nullif(btrim(source->'manualTranscription'->>'reason'),'') IS NOT NULL
 AND length(source->'manualTranscription'->>'reason')<=2000,false)
$$;
REVOKE ALL ON FUNCTION private.co_import_manual_valid_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.co_import_decode_v1(m jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE num jsonb:='{"raw":"text:512","decimal":"?decimal","?convention":"?enum:decimal_dot|decimal_comma|canonical_integer_text|dash_zero"}'; ref jsonb:='{"fileSha256":"hash","page":"?page","sheet":"?label","row":"label","section":"label"}'; row_schema jsonb; schema jsonb; source_row jsonb; decision jsonb; link jsonb; source_date jsonb;
BEGIN
 IF m IS NULL OR octet_length(m::text)>4194304 THEN RAISE EXCEPTION 'Import manifest budget' USING ERRCODE='22023'; END IF;
 PERFORM private.co_import_work_v1(m);
 PERFORM private.co_import_budget_v1(m);
 -- page has explicit numeric/null shape below, not text.
 ref:=jsonb_set(ref,'{page}','"?page"');
 row_schema:=jsonb_build_object('id','label','ref',ref,'sourceSku','?text:512','name','text:1024','transactionDate','?date','transactionReference','?text:512','quantity',num,
 'returned',jsonb_build_object('$nullable',num),'unit','?text:128','unitPrice',jsonb_build_object('$nullable',num),'discount',jsonb_build_object('$nullable',num),'discountBasis','?enum:line_amount|unit_amount|percent|unknown',
 'netUnitPrice',jsonb_build_object('$nullable',num),'amount',jsonb_build_object('$nullable',num),'currency','?text:16','priceBasisLabel','?text:512','flags','["text:512",100]'::jsonb,
 '?physicalReturnDate',jsonb_build_object('date','date','ref',ref,'raw','text:512'));
 schema:=jsonb_build_object('schemaVersion','count','evidenceId','uuid','digest','hash','input',jsonb_build_object(
 'scope','{"actorId":"uuid","customerId":"uuid","reportMonth":"month","epoch":"count"}'::jsonb,
 'extracted',jsonb_build_object('sha256','hash','format','enum:pdf|xlsx','parserVersion','label','sourceRows',jsonb_build_array(row_schema,10000),
 '?manualWorkbook','{"version":"count","policy":"enum:co-manual-xlsx-values-1","sheets":[{"name":"label","rows":["count",10000]},20]}'::jsonb,
 '?manualPrintedControls',jsonb_build_object('version','count','confirmed','boolean','reviewedSheets','["label",20]'::jsonb,'controls',jsonb_build_array(jsonb_build_object('ref',ref,'rowIds','["label",10000]'::jsonb,'count',jsonb_build_object('$nullable',num),'quantity',jsonb_build_object('$nullable',num),'returned',jsonb_build_object('$nullable',num),'amount',jsonb_build_object('$nullable',num)),1000)),
 '?printedControls',jsonb_build_array(jsonb_build_object('kind','enum:section|sheet','ref',ref,'rowIds','["label",10000]'::jsonb,'count',num,'quantity',num,'returned',num,'amount',num),1000),
 'sections',jsonb_build_array(jsonb_build_object('id','label','label','text:1024','rowIds','["label",10000]'::jsonb,'printedTotal',jsonb_build_object('$nullable',num)),1000),
 'periodCandidates','["month",1000]'::jsonb,'customerCandidates','["text:1024",1000]'::jsonb,'warnings','["text:1024",1000]'::jsonb,
 '?manualTranscription','{"mode":"enum:human_transcribed","version":"count","originalParserVersion":"label","originalWarnings":["text:1024",1000],"reason":"note","confirmed":"boolean"}'::jsonb),
 'mappings','[{"rowId":"label","stockKeyId":"?uuid","ledgerUnit":"?text:128","quantity":"?quantity","conversion":{"$nullable":{"numerator":"quantity","denominator":"quantity","reason":"note"}},"included":"boolean","exclusionReason":"?text:2000","confirmed":"boolean"},10000]'::jsonb,
 'returns','[{"rowId":"label","state":"enum:none|linked|unresolved","links":[{"returnRevisionId":"uuid","quantity":"quantity","confirmation":{"physicalReturnDate":"date","basis":"enum:source_return_date|selected_existing_return_evidence","confirmed":"boolean","note":"note"}},1000],"stockImpact":"enum:clear|uncertain","note":"text:2000"},10000]'::jsonb,
 'includedSectionIds','["label",1000]'::jsonb,'completenessConfirmed','boolean','omittedZeroStockKeyIds','["uuid",10000]'::jsonb,'currency','?text:16','reason','?text:2000',
 '?sourceConfirmations','[{"rowId":"label","flag":"enum:formula_cache_requires_confirmation|source_sku_format_requires_confirmation","confirmed":"boolean","reason":"note"},10000]'::jsonb));
 PERFORM private.co_import_shape_v1(m,schema);
 IF ((m->'input'->'extracted')?'manualTranscription' OR m->'input'->'extracted'->>'parserVersion' IN('co-human-transcribed-1','co-human-transcribed-2')) AND NOT private.co_import_manual_valid_v1(m->'input'->'extracted') THEN RAISE EXCEPTION 'Invalid human transcription provenance' USING ERRCODE='22023'; END IF;
 IF m->'input'->'extracted'->>'parserVersion'='co-human-transcribed-2' THEN
  PERFORM private.co_manual_workbook_physical_v1(m->'input'->'extracted',m->'input'->'extracted'->'manualWorkbook');
 ELSIF m->'input'->'extracted'?'manualPrintedControls' THEN RAISE EXCEPTION 'Manual controls format mismatch' USING ERRCODE='22023'; END IF;
 IF private.co_import_manual_valid_v1(m->'input'->'extracted') AND m->'input'->'extracted'->>'format'='pdf' AND (
 jsonb_array_length(m->'input'->'extracted'->'sourceRows')=0 OR jsonb_array_length(m->'input'->'extracted'->'sections')=0
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(m->'input'->'extracted'->'sourceRows') r WHERE r->'ref'->>'fileSha256' IS DISTINCT FROM m->'input'->'extracted'->>'sha256' OR r->'ref'->'page'='null'::jsonb OR (r->'ref'->>'page')::numeric>50 OR r->'ref'->'sheet'<>'null'::jsonb)
 OR (SELECT count(*) FROM jsonb_array_elements(m->'input'->'extracted'->'sourceRows'))<>(SELECT count(DISTINCT r->'ref') FROM jsonb_array_elements(m->'input'->'extracted'->'sourceRows') r)
 ) THEN RAISE EXCEPTION 'Human transcription physical references required' USING ERRCODE='22023'; END IF;
 FOR source_row IN SELECT value FROM jsonb_array_elements(m->'input'->'extracted'->'sourceRows') LOOP
  IF source_row?'physicalReturnDate' AND (source_row->'physicalReturnDate'->'ref' IS DISTINCT FROM source_row->'ref' OR source_row->'physicalReturnDate'->'ref'->>'fileSha256' IS DISTINCT FROM m->'input'->'extracted'->>'sha256') THEN RAISE EXCEPTION 'Return source identity mismatch' USING ERRCODE='22023'; END IF;
 END LOOP;
 FOR decision IN SELECT value FROM jsonb_array_elements(m->'input'->'returns') LOOP
  FOR link IN SELECT value FROM jsonb_array_elements(decision->'links') LOOP
   IF link->'confirmation'->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Explicit physical return confirmation required' USING ERRCODE='22023'; END IF;
   IF link->'confirmation'->>'basis'='source_return_date' THEN
    SELECT value->'physicalReturnDate' INTO source_date FROM jsonb_array_elements(m->'input'->'extracted'->'sourceRows') WITH ORDINALITY x(value,ordinal) WHERE value->>'id'=decision->>'rowId' ORDER BY ordinal LIMIT 1;
    IF source_date IS NULL OR source_date->>'date' IS DISTINCT FROM link->'confirmation'->>'physicalReturnDate' THEN RAISE EXCEPTION 'Physical return source required' USING ERRCODE='22023'; END IF;
   END IF;
  END LOOP;
 END LOOP;
 IF m->'schemaVersion'<>'1'::jsonb OR private.co_manifest_digest_v1(m) IS DISTINCT FROM m->>'digest' THEN RAISE EXCEPTION 'Import schema or digest mismatch' USING ERRCODE='22023'; END IF;
END $$;
CREATE FUNCTION private.co_import_integer_v1(v jsonb) RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE t text;
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'string' THEN RAISE EXCEPTION 'Resolved integer source required' USING ERRCODE='22023'; END IF;
 t:=v#>>'{}';IF length(t)>128 OR t!~'^(0|[1-9][0-9]*)$' THEN RAISE EXCEPTION 'Resolved integer source required' USING ERRCODE='22023'; END IF;
 RETURN t::numeric;
END $$;
CREATE FUNCTION private.co_import_money_v1(v jsonb) RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE t text;
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' OR jsonb_typeof(v->'decimal') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Resolved source money required' USING ERRCODE='22023'; END IF;
 t:=v->>'decimal';IF length(t)>128 OR t!~'^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' THEN RAISE EXCEPTION 'Resolved source money required' USING ERRCODE='22023'; END IF;
 RETURN t::numeric;
END $$;

-- Mirrors the client descriptor-work allowance over actual JSONB trees. Array
-- length counts as one own key; scalar visits and object keys also consume work.
CREATE FUNCTION private.co_import_work_v1(v jsonb,remaining integer DEFAULT 100000,depth integer DEFAULT 0) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE x record; kind text:=jsonb_typeof(v); count integer;
BEGIN
 remaining:=remaining-1;
 IF v IS NULL OR remaining<0 OR depth>32 THEN RAISE EXCEPTION 'Import work budget' USING ERRCODE='22023'; END IF;
 IF kind='array' THEN
  count:=jsonb_array_length(v);remaining:=remaining-count-1;
  IF count>10000 OR remaining<0 THEN RAISE EXCEPTION 'Import work budget' USING ERRCODE='22023'; END IF;
  FOR x IN SELECT value FROM jsonb_array_elements(v) LOOP remaining:=private.co_import_work_v1(x.value,remaining,depth+1); END LOOP;
 ELSIF kind='object' THEN
  SELECT count(*) INTO count FROM jsonb_object_keys(v);remaining:=remaining-count;
  IF remaining<0 THEN RAISE EXCEPTION 'Import work budget' USING ERRCODE='22023'; END IF;
  FOR x IN SELECT value FROM jsonb_each(v) LOOP remaining:=private.co_import_work_v1(x.value,remaining,depth+1); END LOOP;
 END IF;
 RETURN remaining;
END $$;

-- Exact counterpart of ResultBudget.reserve: strings use six bytes per
-- UTF-16 code unit +3, object keys +4, collections +2, other scalars +32.
CREATE FUNCTION private.co_import_budget_v1(v jsonb,remaining bigint DEFAULT 4194304,depth integer DEFAULT 0) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE kind text:=jsonb_typeof(v); x record;
BEGIN
 IF v IS NULL OR depth>32 THEN RAISE EXCEPTION 'Import result budget' USING ERRCODE='22023'; END IF;
 CASE kind
 WHEN 'string' THEN remaining:=remaining-6::bigint*private.co_import_text_units_v1(v#>>'{}')-3;
 WHEN 'array' THEN remaining:=remaining-2;
 WHEN 'object' THEN remaining:=remaining-2;
 ELSE remaining:=remaining-32;
 END CASE;
 IF remaining<0 THEN RAISE EXCEPTION 'Import result budget' USING ERRCODE='22023'; END IF;
 IF kind='array' THEN
  FOR x IN SELECT value FROM jsonb_array_elements(v) LOOP
   remaining:=private.co_import_budget_v1(x.value,remaining,depth+1);
  END LOOP;
 ELSIF kind='object' THEN
  FOR x IN SELECT key,value FROM jsonb_each(v) LOOP
   remaining:=remaining-6::bigint*private.co_import_text_units_v1(x.key)-4;
   IF remaining<0 THEN RAISE EXCEPTION 'Import result budget' USING ERRCODE='22023'; END IF;
   remaining:=private.co_import_budget_v1(x.value,remaining,depth+1);
  END LOOP;
 END IF;
 RETURN remaining;
END $$;

-- Manual facts prove byte safety/unknown layout and physical membership, NOT human semantic truth.
CREATE FUNCTION private.co_manual_workbook_facts_v1(f jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE s jsonb;
BEGIN
 PERFORM private.co_import_work_v1(f); PERFORM private.co_import_budget_v1(f);
 PERFORM private.co_import_shape_v1(f,'{"version":"count","policy":"enum:co-manual-xlsx-values-1","sheets":[{"name":"label","rows":["count",10000]},20]}'::jsonb);
 IF f->'version'<>'1'::jsonb OR jsonb_array_length(f->'sheets')=0
 OR (SELECT count(DISTINCT value->>'name') FROM jsonb_array_elements(f->'sheets'))<>jsonb_array_length(f->'sheets') THEN RAISE EXCEPTION 'Invalid manual workbook facts' USING ERRCODE='22023'; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(f->'sheets') LOOP
  IF (SELECT count(DISTINCT value) FROM jsonb_array_elements(s->'rows'))<>jsonb_array_length(s->'rows')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(s->'rows') r WHERE (r#>>'{}')::numeric NOT BETWEEN 1 AND 10000) THEN RAISE EXCEPTION 'Invalid manual physical row facts' USING ERRCODE='22023'; END IF;
 END LOOP;
END $$;
CREATE FUNCTION private.co_manual_workbook_physical_v1(source jsonb,facts jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE review jsonb:=source->'manualPrintedControls'; physical_ref jsonb; control jsonb; section jsonb; refs jsonb; control_rows jsonb;
BEGIN
 PERFORM private.co_manual_workbook_facts_v1(facts);
 IF source->'manualWorkbook' IS DISTINCT FROM facts OR source?'printedControls'
 OR review IS NULL OR review->'version' IS DISTINCT FROM '2'::jsonb OR review->'confirmed' IS DISTINCT FROM 'true'::jsonb
 OR jsonb_array_length(source->'sourceRows')=0 OR jsonb_array_length(source->'sections')=0
 OR jsonb_array_length(review->'reviewedSheets')<>jsonb_array_length(facts->'sheets')
 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(review->'reviewedSheets'))<>jsonb_array_length(facts->'sheets')
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(facts->'sheets') s WHERE NOT review->'reviewedSheets'?(s->>'name'))
 THEN RAISE EXCEPTION 'Manual workbook complete review required' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(x->'ref'),'[]') INTO refs FROM (SELECT value x FROM jsonb_array_elements(source->'sourceRows') UNION ALL SELECT value FROM jsonb_array_elements(review->'controls')) all_refs;
 IF (SELECT count(DISTINCT (x->>'sheet',x->>'row')) FROM jsonb_array_elements(refs) x)<>jsonb_array_length(refs)
 OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(source->'sourceRows') x)<>jsonb_array_length(source->'sourceRows')
 THEN RAISE EXCEPTION 'Duplicate manual physical identity' USING ERRCODE='22023'; END IF;
 FOR physical_ref IN SELECT value FROM jsonb_array_elements(refs) LOOP
  IF physical_ref->>'fileSha256' IS DISTINCT FROM source->>'sha256' OR physical_ref->'page' IS DISTINCT FROM 'null'::jsonb
  OR physical_ref->>'sheet' IS NULL OR physical_ref->>'row' !~ '^r[1-9][0-9]*$'
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(facts->'sheets') s CROSS JOIN LATERAL jsonb_array_elements(s->'rows') n
    WHERE s->>'name'=physical_ref->>'sheet' AND 'r'||(n#>>'{}')=physical_ref->>'row')
  THEN RAISE EXCEPTION 'Unattested manual physical reference' USING ERRCODE='22023'; END IF;
 END LOOP;
 FOR control IN SELECT value FROM jsonb_array_elements(review->'controls') LOOP
  IF control->'count'='null'::jsonb AND control->'quantity'='null'::jsonb AND control->'returned'='null'::jsonb AND control->'amount'='null'::jsonb
  THEN RAISE EXCEPTION 'Observed manual control metric required' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(r),'[]') INTO control_rows FROM jsonb_array_elements(source->'sourceRows') r WHERE control->'rowIds'?(r->>'id');
  IF jsonb_array_length(control_rows)=0 OR jsonb_array_length(control_rows)<>jsonb_array_length(control->'rowIds')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(control_rows) r WHERE r->'ref'->>'sheet' IS DISTINCT FROM control->'ref'->>'sheet')
  THEN RAISE EXCEPTION 'Manual control explicit coverage mismatch' USING ERRCODE='22023'; END IF;
 END LOOP;
 FOR section IN SELECT value FROM jsonb_array_elements(source->'sections') LOOP
  IF section->'printedTotal'<>'null'::jsonb AND (SELECT count(*) FROM jsonb_array_elements(review->'controls') c
    WHERE c->'amount'=section->'printedTotal' AND jsonb_array_length(c->'rowIds')=jsonb_array_length(section->'rowIds')
    AND (c->'rowIds') @> (section->'rowIds') AND (section->'rowIds') @> (c->'rowIds')
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source->'sourceRows') r WHERE section->'rowIds'?(r->>'id') AND r->'ref'->>'sheet' IS DISTINCT FROM c->'ref'->>'sheet'))<>1
  THEN RAISE EXCEPTION 'Manual whole-section amount control required' USING ERRCODE='22023'; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.co_manual_workbook_facts_v1(jsonb),private.co_manual_workbook_physical_v1(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE private.co_evidence_manual_workbook_checks (
 evidence_id uuid PRIMARY KEY REFERENCES private.co_evidence(id), customer_id uuid NOT NULL,
 object_id uuid NOT NULL UNIQUE, object_version text, sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),
 verified_by uuid NOT NULL REFERENCES public.users(id), facts jsonb NOT NULL,
 verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(evidence_id,customer_id) REFERENCES private.co_evidence(id,customer_id)
);
ALTER TABLE private.co_evidence_manual_workbook_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.co_evidence_manual_workbook_checks FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER co_manual_workbook_immutable BEFORE UPDATE OR DELETE ON private.co_evidence_manual_workbook_checks FOR EACH ROW EXECUTE FUNCTION private.co_immutable_v1();
CREATE FUNCTION public.pilot_co_evidence_manual_workbook_attest_v1(p_actor_id uuid,p_evidence_id uuid,p_object_id uuid,p_object_version text,p_sha256 text,p_facts jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e private.co_evidence%ROWTYPE; d private.co_drafts%ROWTYPE; a private.co_evidence_verifications%ROWTYPE; receipt private.co_evidence_manual_workbook_checks%ROWTYPE; cv bigint; account_allowed boolean;
BEGIN
 PERFORM 1 FROM public.users WHERE id=p_actor_id AND is_active AND role IN('co_admin','executive') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CO authority required' USING ERRCODE='42501'; END IF;
 -- A service caller's actor must satisfy the same installed employee gate as
 -- the ordinary evidence attestation wrapper; absent bare-baseline HR is explicit.
 IF to_regprocedure('private.employee_account_allowed(uuid)') IS NOT NULL THEN
  EXECUTE 'SELECT private.employee_account_allowed($1)' INTO account_allowed USING p_actor_id;
  IF account_allowed IS DISTINCT FROM true THEN RAISE EXCEPTION 'CO authority required' USING ERRCODE='42501'; END IF;
 ELSIF to_regclass('private.employee_records') IS NOT NULL OR to_regclass('private.employee_access_guard') IS NOT NULL THEN
  RAISE EXCEPTION 'Incomplete employee account authority' USING ERRCODE='42501';
 END IF;
 SELECT * INTO e FROM private.co_evidence WHERE id=p_evidence_id AND created_by=p_actor_id;
 IF e.id IS NULL THEN RAISE EXCEPTION 'Invalid evidence identity' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('co-command:'||p_actor_id::text||':'||e.request_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM private.co_evidence_manual_workbook_checks WHERE evidence_id=e.id) THEN
  PERFORM private.co_workspace_generation_guard_v1();
 END IF;
 SELECT version INTO cv FROM private.co_customer_state WHERE customer_id=e.customer_id FOR UPDATE;
 SELECT * INTO d FROM private.co_drafts WHERE id=e.draft_id FOR UPDATE;
 SELECT * INTO e FROM private.co_evidence WHERE id=p_evidence_id FOR UPDATE;
 SELECT * INTO a FROM private.co_evidence_verifications WHERE evidence_id=e.id;
 PERFORM private.co_manual_workbook_facts_v1(p_facts);
 IF e.mime_type<>'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' OR a.evidence_id IS NULL
 OR (a.object_id,a.object_version,a.sha256,a.verified_by) IS DISTINCT FROM (p_object_id,p_object_version,p_sha256,p_actor_id)
 THEN RAISE EXCEPTION 'Original byte verification required' USING ERRCODE='PT409'; END IF;
 PERFORM private.co_evidence_object_v1(e,p_object_id,p_object_version,a.byte_size,a.mime_type,p_sha256);
 SELECT * INTO receipt FROM private.co_evidence_manual_workbook_checks WHERE evidence_id=e.id;
 IF receipt.evidence_id IS NOT NULL THEN
  IF (receipt.customer_id,receipt.object_id,receipt.object_version,receipt.sha256,receipt.verified_by,receipt.facts) IS DISTINCT FROM (e.customer_id,p_object_id,p_object_version,p_sha256,p_actor_id,p_facts)
  THEN RAISE EXCEPTION 'Immutable manual workbook verification mismatch' USING ERRCODE='PT409'; END IF;
 ELSE
  -- No backfill of finalized old attestations. Reselect/reupload original evidence.
  IF e.version<>1 OR cv<>e.customer_version THEN RAISE EXCEPTION 'Reselect original workbook for manual verification' USING ERRCODE='PT409'; END IF;
  PERFORM private.co_evidence_draft_v1(d,e.draft_version,cv);
  INSERT INTO private.co_evidence_manual_workbook_checks(evidence_id,customer_id,object_id,object_version,sha256,verified_by,facts)
  VALUES(e.id,e.customer_id,p_object_id,p_object_version,p_sha256,p_actor_id,p_facts);
 END IF;
 RETURN jsonb_build_object('id',e.id,'policy','co-manual-xlsx-values-1');
END $$;
REVOKE ALL ON FUNCTION public.pilot_co_evidence_manual_workbook_attest_v1(uuid,uuid,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pilot_co_evidence_manual_workbook_attest_v1(uuid,uuid,uuid,text,text,jsonb) TO service_role;
CREATE FUNCTION private.co_import_manual_receipt_v1(source jsonb,e private.co_evidence,a private.co_evidence_verifications) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE receipt private.co_evidence_manual_workbook_checks%ROWTYPE;
BEGIN
 IF source->>'parserVersion'<>'co-human-transcribed-2' THEN RETURN; END IF;
 SELECT * INTO receipt FROM private.co_evidence_manual_workbook_checks WHERE evidence_id=e.id;
 IF receipt.evidence_id IS NULL OR (receipt.customer_id,receipt.object_id,receipt.object_version,receipt.sha256,receipt.verified_by) IS DISTINCT FROM (e.customer_id,a.object_id,a.object_version,e.sha256,e.created_by)
 OR source->>'sha256' IS DISTINCT FROM e.sha256 OR receipt.facts IS DISTINCT FROM source->'manualWorkbook'
 THEN RAISE EXCEPTION 'Manual workbook byte receipt missing or stale; reselect original' USING ERRCODE='PT409'; END IF;
 PERFORM private.co_evidence_object_v1(e,receipt.object_id,receipt.object_version,a.byte_size,a.mime_type,receipt.sha256);
 PERFORM private.co_manual_workbook_physical_v1(source,receipt.facts);
END $$;
REVOKE ALL ON FUNCTION private.co_import_manual_receipt_v1(jsonb,private.co_evidence,private.co_evidence_verifications) FROM PUBLIC,anon,authenticated,service_role;

-- Explicit, narrow new-object privileges. No blanket grant on private schema,
-- no direct table access, no service-role mutation capability added.
REVOKE ALL ON FUNCTION private.co_manifest_canonical_v1(jsonb,integer), private.co_manifest_digest_v1(jsonb),
 private.co_import_text_units_v1(text), private.co_import_trim_v1(text), private.co_unit_label_valid_v1(text), private.co_unit_reason_valid_v1(text), private.co_import_shape_v1(jsonb,jsonb,integer), private.co_import_decode_v1(jsonb),
 private.co_import_integer_v1(jsonb), private.co_import_money_v1(jsonb), private.co_import_work_v1(jsonb,integer,integer), private.co_import_budget_v1(jsonb,bigint,integer)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pilot_co_declare_stock_key_unit_v1(uuid,jsonb),
 public.pilot_co_stock_key_units_v1(uuid,uuid[],text), public.pilot_reconcile_co_unit_v1(uuid,boolean)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pilot_co_declare_stock_key_unit_v1(uuid,jsonb),
 public.pilot_co_stock_key_units_v1(uuid,uuid[],text), public.pilot_reconcile_co_unit_v1(uuid,boolean) TO authenticated;

-- B2: immutable original manifest and server-reconstructed validation metadata.
CREATE TABLE private.co_import_manifests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL, report_month date NOT NULL,
 draft_id uuid NOT NULL, draft_version bigint NOT NULL CHECK(draft_version>0), customer_version bigint NOT NULL CHECK(customer_version>0),
 evidence_id uuid NOT NULL, version bigint NOT NULL DEFAULT 1 CHECK(version=1),
 canonical_json jsonb NOT NULL, digest text NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),
 validation jsonb NOT NULL, validation_digest text NOT NULL CHECK(validation_digest~'^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES public.users(id), request_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(draft_id,customer_id) REFERENCES private.co_drafts(id,customer_id),
 FOREIGN KEY(evidence_id,draft_id,customer_id) REFERENCES private.co_evidence(id,draft_id,customer_id),
 FOREIGN KEY(created_by,request_id) REFERENCES private.co_commands(actor_id,request_id),
 UNIQUE(id,customer_id), UNIQUE(id,draft_id,customer_id), UNIQUE(draft_id,draft_version)
);
CREATE INDEX co_import_manifest_evidence ON private.co_import_manifests(evidence_id,draft_id,customer_id);
CREATE INDEX co_import_manifest_command ON private.co_import_manifests(created_by,request_id);
CREATE TABLE private.co_draft_import_origins (
 draft_id uuid PRIMARY KEY, customer_id uuid NOT NULL, import_id uuid NOT NULL UNIQUE,
 FOREIGN KEY(import_id,draft_id,customer_id) REFERENCES private.co_import_manifests(id,draft_id,customer_id)
);
CREATE TABLE private.co_import_prepare_results (
 actor_id uuid NOT NULL, request_id uuid NOT NULL, import_id uuid NOT NULL REFERENCES private.co_import_manifests(id), binding jsonb NOT NULL,
 PRIMARY KEY(actor_id,request_id), FOREIGN KEY(actor_id,request_id) REFERENCES private.co_commands(actor_id,request_id)
);
CREATE INDEX co_import_prepare_import ON private.co_import_prepare_results(import_id);
CREATE TABLE private.co_report_imports (
 report_revision_id uuid PRIMARY KEY, report_head_id uuid NOT NULL, customer_id uuid NOT NULL, import_id uuid NOT NULL,
 FOREIGN KEY(report_revision_id,report_head_id,customer_id) REFERENCES private.co_report_revisions(id,head_id,customer_id),
 FOREIGN KEY(import_id,customer_id) REFERENCES private.co_import_manifests(id,customer_id)
);
CREATE INDEX co_report_import_original ON private.co_report_imports(import_id,customer_id);
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['co_import_manifests','co_draft_import_origins','co_import_prepare_results','co_report_imports'] LOOP
  EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER co_import_immutable BEFORE UPDATE OR DELETE ON private.%I FOR EACH ROW EXECUTE FUNCTION private.co_immutable_v1()',t);
 END LOOP;
END $$;

CREATE FUNCTION private.co_report_import_identity_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM private.co_import_manifests m
  JOIN private.co_report_heads h ON h.customer_id=m.customer_id AND h.report_month=m.report_month
  WHERE m.id=NEW.import_id AND m.customer_id=NEW.customer_id AND h.id=NEW.report_head_id
 ) THEN RAISE EXCEPTION 'Import revision customer/month mismatch' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER co_report_import_identity BEFORE INSERT ON private.co_report_imports FOR EACH ROW EXECUTE FUNCTION private.co_report_import_identity_v1();

-- Reparse submitted raw numeric evidence under its explicit supported grammar.
-- This proves manifest consistency, not server re-extraction of original files.
CREATE FUNCTION private.co_import_source_number_v1(v jsonb,allow_dash_zero boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE raw text; convention text; normalized text; integer_part text; fraction text;
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' OR jsonb_typeof(v->'raw') IS DISTINCT FROM 'string'
 OR jsonb_typeof(v->'decimal') IS DISTINCT FROM 'string' OR jsonb_typeof(v->'convention') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Explicit resolved numeric convention required' USING ERRCODE='22023';
 END IF;
 raw:=v->>'raw';convention:=v->>'convention';
 IF private.co_import_text_units_v1(raw)>512 OR private.co_import_text_units_v1(v->>'decimal')>128 THEN RAISE EXCEPTION 'Source number bounds' USING ERRCODE='22023'; END IF;
 IF convention='canonical_integer_text' THEN
  IF raw!~'^(0|[1-9][0-9]*)$' THEN RAISE EXCEPTION 'Unsupported canonical integer text' USING ERRCODE='22023'; END IF;
  normalized:=raw;
 ELSIF convention='dash_zero' THEN
  IF allow_dash_zero IS DISTINCT FROM true OR raw<>'-' THEN RAISE EXCEPTION 'Dash zero discount context required' USING ERRCODE='22023'; END IF;
  normalized:='0';
 ELSIF convention IN('decimal_dot','decimal_comma') THEN
  raw:=private.co_import_trim_v1(raw);
  IF convention='decimal_dot' THEN
   IF raw!~'^([0-9]+|[0-9]{1,3}(,[0-9]{3})+)(\.[0-9]+)?$' THEN RAISE EXCEPTION 'Unsupported dot numeric grammar' USING ERRCODE='22023'; END IF;
   normalized:=replace(raw,',','');
  ELSE
   IF raw!~'^([0-9]+|[0-9]{1,3}(\.[0-9]{3})+)(,[0-9]+)?$' THEN RAISE EXCEPTION 'Unsupported comma numeric grammar' USING ERRCODE='22023'; END IF;
   normalized:=replace(replace(raw,'.',''),',','.');
  END IF;
  integer_part:=coalesce(nullif(ltrim(split_part(normalized,'.',1),'0'),''),'0');
  fraction:=CASE WHEN strpos(normalized,'.')>0 THEN substr(normalized,strpos(normalized,'.')) ELSE '' END;
  normalized:=integer_part||fraction;
 ELSE RAISE EXCEPTION 'Unsupported numeric convention' USING ERRCODE='22023';
 END IF;
 IF normalized IS DISTINCT FROM v->>'decimal' THEN RAISE EXCEPTION 'Raw numeric evidence mismatch' USING ERRCODE='22023'; END IF;
 RETURN normalized;
END $$;
CREATE FUNCTION private.co_import_source_integer_v1(v jsonb) RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT private.co_import_integer_v1(to_jsonb(private.co_import_source_number_v1(v,false)));
$$;
CREATE FUNCTION private.co_import_source_money_v1(v jsonb,allow_dash_zero boolean DEFAULT false) RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 PERFORM private.co_import_source_number_v1(v,allow_dash_zero);
 RETURN private.co_import_money_v1(v);
END $$;

-- Task6: private append-only selection, exact request context and line provenance.
-- Candidate authoring only; this has not been executed on PostgreSQL.
ALTER TABLE private.co_return_revision_lines ADD CONSTRAINT co_return_import_line_identity UNIQUE(id,revision_id,customer_id,stock_key_id,batch_id);
CREATE TABLE private.co_import_return_coverage (
 import_id uuid NOT NULL, source_row_id text NOT NULL, return_revision_id uuid NOT NULL,
 return_line_id uuid NOT NULL, batch_id uuid NOT NULL, customer_id uuid NOT NULL, stock_key_id uuid NOT NULL,
 covered_quantity integer NOT NULL CHECK(covered_quantity>0),
 PRIMARY KEY(import_id,source_row_id,return_line_id),
 FOREIGN KEY(import_id,customer_id) REFERENCES private.co_import_manifests(id,customer_id),
 FOREIGN KEY(return_line_id,return_revision_id,customer_id,stock_key_id,batch_id)
 REFERENCES private.co_return_revision_lines(id,revision_id,customer_id,stock_key_id,batch_id)
);
CREATE TABLE private.co_import_selections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 draft_id uuid NOT NULL, customer_id uuid NOT NULL, customer_version bigint NOT NULL CHECK(customer_version>0), predecessor_id uuid UNIQUE,
 import_id uuid, state text NOT NULL CHECK(state IN('selected','review_open','abandoned')),
 actor_id uuid NOT NULL, request_id uuid NOT NULL, reason text,
 before_draft jsonb NOT NULL, after_draft jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id,draft_id,customer_id),
 CHECK((state='selected')=(import_id IS NOT NULL)),
 FOREIGN KEY(draft_id,customer_id) REFERENCES private.co_drafts(id,customer_id),
 FOREIGN KEY(predecessor_id,draft_id,customer_id) REFERENCES private.co_import_selections(id,draft_id,customer_id),
 FOREIGN KEY(import_id,draft_id,customer_id) REFERENCES private.co_import_manifests(id,draft_id,customer_id),
 FOREIGN KEY(actor_id,request_id) REFERENCES private.co_commands(actor_id,request_id)
);
CREATE UNIQUE INDEX co_import_initial_selection ON private.co_import_selections(draft_id) WHERE predecessor_id IS NULL;
CREATE TABLE private.co_import_post_requests (
 actor_id uuid NOT NULL, request_id uuid NOT NULL, customer_id uuid NOT NULL, import_id uuid NOT NULL,
 import_payload jsonb NOT NULL, import_fingerprint text NOT NULL,
 operation text NOT NULL CHECK(operation IN('post_report','correct_report')),
 ordinary_payload jsonb NOT NULL, ordinary_fingerprint text NOT NULL,
 PRIMARY KEY(actor_id,request_id),
 FOREIGN KEY(import_id,customer_id) REFERENCES private.co_import_manifests(id,customer_id),
 FOREIGN KEY(actor_id,request_id) REFERENCES private.co_commands(actor_id,request_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE FUNCTION private.co_import_selection_v1(d uuid) RETURNS private.co_import_selections LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT s FROM private.co_import_selections s WHERE s.draft_id=d ORDER BY s.sequence DESC LIMIT 1;
$$;
CREATE FUNCTION private.co_import_return_pins_v1(pins jsonb,c uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE pin jsonb; line private.co_return_revision_lines%ROWTYPE; used jsonb:='{}'; allocations jsonb; result jsonb:='[]'; remaining numeric; take numeric; capacity numeric; recorded jsonb;
BEGIN
 FOR pin IN SELECT value FROM jsonb_array_elements(pins) LOOP
  remaining:=(pin->>'quantity')::numeric; allocations:='[]';
  SELECT coalesce(sum(l.quantity),0),coalesce(jsonb_agg(jsonb_build_object('returnLineId',l.id,'batchId',l.batch_id,'recordedQuantity',l.quantity::text) ORDER BY l.id),'[]') INTO capacity,recorded
  FROM private.co_return_revision_lines l WHERE l.revision_id=(pin->>'revisionId')::uuid AND l.customer_id=c AND l.stock_key_id=(pin->>'stockKeyId')::uuid;
  FOR line IN SELECT l.* FROM private.co_return_revision_lines l WHERE l.revision_id=(pin->>'revisionId')::uuid AND l.customer_id=c AND l.stock_key_id=(pin->>'stockKeyId')::uuid ORDER BY l.id LOOP
   take:=least(remaining,line.quantity-coalesce((used->>line.id::text)::numeric,0));
   IF take>0 THEN
    allocations:=allocations||jsonb_build_array(jsonb_build_object('returnLineId',line.id,'batchId',line.batch_id,'coveredQuantity',take::text));
    used:=used||jsonb_build_object(line.id::text,(coalesce((used->>line.id::text)::numeric,0)+take)::text); remaining:=remaining-take;
   END IF;
  END LOOP;
  IF remaining<>0 THEN RAISE EXCEPTION 'Return line capacity exceeded' USING ERRCODE='22023'; END IF;
  result:=result||jsonb_build_array(pin||jsonb_build_object('capacity',capacity::text,'lines',recorded,'allocations',allocations,
   'aggregateCoveredQuantity',(SELECT sum((p->>'quantity')::numeric)::text FROM jsonb_array_elements(pins) p WHERE p->>'revisionId'=pin->>'revisionId' AND p->>'stockKeyId'=pin->>'stockKeyId')));
 END LOOP;
 RETURN result;
END $$;
CREATE FUNCTION private.co_import_save_coverage_v1(m private.co_import_manifests) RETURNS void LANGUAGE sql SET search_path='' AS $$
 INSERT INTO private.co_import_return_coverage(import_id,source_row_id,return_revision_id,return_line_id,batch_id,customer_id,stock_key_id,covered_quantity)
 SELECT m.id,p->>'rowId',(p->>'revisionId')::uuid,(a->>'returnLineId')::uuid,(a->>'batchId')::uuid,m.customer_id,(p->>'stockKeyId')::uuid,(a->>'coveredQuantity')::integer
 FROM jsonb_array_elements(m.validation->'returnLinks') p CROSS JOIN LATERAL jsonb_array_elements(p->'allocations') a;
$$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['co_import_return_coverage','co_import_selections','co_import_post_requests'] LOOP
  EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER co_import_immutable BEFORE UPDATE OR DELETE ON private.%I FOR EACH ROW EXECUTE FUNCTION private.co_immutable_v1()',t);
 END LOOP;
END $$;

-- Original explicit committed witness only. A proof-bearing report is never a
-- witness, so publication cannot change its own validation identity or recurse.
CREATE FUNCTION private.co_import_prior_return_proof_v1(m jsonb,row_id text,c uuid,month date) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE source_row jsonb; mapping jsonb; witness record; pins jsonb; pin jsonb; part jsonb;
 coverage jsonb; expected_coverage jsonb; signature jsonb; agreed jsonb; chosen jsonb;
 declaration private.co_stock_key_unit_declarations%ROWTYPE; revision private.co_return_revisions%ROWTYPE; generation uuid;
BEGIN
 SELECT value INTO source_row FROM jsonb_array_elements(m->'input'->'extracted'->'sourceRows') WHERE value->>'id'=row_id;
 SELECT value INTO mapping FROM jsonb_array_elements(m->'input'->'mappings') WHERE value->>'rowId'=row_id;
 IF source_row IS NULL OR mapping->'included' IS DISTINCT FROM 'true'::jsonb OR mapping->'confirmed' IS DISTINCT FROM 'true'::jsonb
 OR NOT coalesce(m->'input'->'includedSectionIds'?(source_row->'ref'->>'section'),false)
 OR private.co_import_source_integer_v1(source_row->'returned')<=0 THEN RAISE EXCEPTION 'Verified recorded-return coverage required' USING ERRCODE='22023'; END IF;
 SELECT * INTO declaration FROM private.co_stock_key_unit_declarations WHERE customer_id=c AND stock_key_id=(mapping->>'stockKeyId')::uuid;
 SELECT effective_generation_id INTO generation FROM private.co_customer_state WHERE customer_id=c;
 IF declaration.id IS NULL OR generation IS NULL THEN RAISE EXCEPTION 'Verified recorded-return coverage required' USING ERRCODE='22023'; END IF;
 FOR witness IN
  SELECT h.*,l.report_revision_id FROM private.co_import_manifests h
  JOIN private.co_report_imports l ON l.import_id=h.id AND l.customer_id=h.customer_id
  JOIN private.co_report_revisions r ON r.id=l.report_revision_id AND r.head_id=l.report_head_id AND r.customer_id=c
  JOIN private.co_report_heads head ON head.id=r.head_id AND head.customer_id=c AND head.report_month=month
  CROSS JOIN LATERAL jsonb_array_elements(h.canonical_json->'input'->'returns') decision
  WHERE h.customer_id=c AND h.report_month=month AND h.digest<>m->>'digest'
   AND NOT h.validation?'returnProofs' AND decision->>'rowId'=row_id AND decision->>'state'='linked'
   AND decision->>'stockImpact'='clear' AND jsonb_array_length(decision->'links')>0
   AND h.canonical_json->'input'->'extracted'->>'sha256'=m->'input'->'extracted'->>'sha256'
   AND h.canonical_json->'input'->'includedSectionIds'?(source_row->'ref'->>'section')
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(h.canonical_json->'input'->'extracted'->'sourceRows') old_row WHERE old_row=source_row)
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(h.canonical_json->'input'->'mappings') old_mapping WHERE old_mapping=mapping)
  ORDER BY r.created_at,r.id,h.id
 LOOP
  IF witness.digest IS DISTINCT FROM private.co_manifest_digest_v1(witness.canonical_json)
   OR witness.validation_digest IS DISTINCT FROM encode(sha256(convert_to(E'co-import-validation-v1\n'||private.co_manifest_canonical_v1(jsonb_build_object('manifestDigest',witness.digest,'validation',witness.validation)),'UTF8')),'hex')
   OR witness.validation->'unitDeclarations'->(mapping->>'stockKeyId') IS DISTINCT FROM jsonb_build_object('id',declaration.id,'version',declaration.version::text,'unit',declaration.unit)
  THEN RAISE EXCEPTION 'Prior return evidence changed' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(p ORDER BY ord),'[]') INTO pins FROM jsonb_array_elements(witness.validation->'returnLinks') WITH ORDINALITY x(p,ord) WHERE p->>'rowId'=row_id;
  IF pins='[]'::jsonb THEN RAISE EXCEPTION 'Verified recorded-return coverage required' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_array(source_row_id,return_revision_id,return_line_id,batch_id,stock_key_id,covered_quantity::text) ORDER BY return_line_id),'[]') INTO coverage
   FROM private.co_import_return_coverage WHERE import_id=witness.id AND customer_id=c AND source_row_id=row_id;
  SELECT coalesce(jsonb_agg(jsonb_build_array(p->>'rowId',p->>'revisionId',a->>'returnLineId',a->>'batchId',p->>'stockKeyId',a->>'coveredQuantity') ORDER BY a->>'returnLineId'),'[]') INTO expected_coverage
   FROM jsonb_array_elements(pins) p CROSS JOIN LATERAL jsonb_array_elements(p->'allocations') a;
  IF coverage IS DISTINCT FROM expected_coverage OR coverage='[]'::jsonb THEN RAISE EXCEPTION 'Prior persisted return coverage mismatch' USING ERRCODE='22023'; END IF;
  FOR pin IN SELECT value FROM jsonb_array_elements(pins) LOOP
   SELECT r.* INTO revision FROM private.co_return_revisions r JOIN private.co_return_heads h ON h.id=r.head_id AND h.customer_id=r.customer_id AND h.current_revision_id=r.id
    WHERE r.id=(pin->>'revisionId')::uuid AND r.customer_id=c AND NOT r.is_void;
   IF revision.id IS NULL OR pin->>'revisionVersion' IS DISTINCT FROM revision.revision_no::text
    OR pin->'confirmation'->>'physicalReturnDate' IS DISTINCT FROM revision.return_date::text
    OR pin->>'stockKeyId' IS DISTINCT FROM mapping->>'stockKeyId' OR pin->>'declarationId' IS DISTINCT FROM declaration.id::text OR pin->>'unit' IS DISTINCT FROM declaration.unit
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(witness.canonical_json->'input'->'returns') d CROSS JOIN LATERAL jsonb_array_elements(d->'links') l
     WHERE d->>'rowId'=row_id AND l->>'returnRevisionId'=pin->>'revisionId' AND l->>'quantity'=pin->>'quantity' AND l->'confirmation'=pin->'confirmation')
   THEN RAISE EXCEPTION 'Prior current return identity mismatch' USING ERRCODE='22023'; END IF;
   FOR part IN SELECT value FROM jsonb_array_elements(pin->'allocations') LOOP
    -- A physical return line produces exactly one canonical movement in the
    -- current effective generation. No stock-balance/date inference is evidence.
    IF (SELECT count(*) FROM private.co_stock_movements movement JOIN private.co_return_revision_lines line ON line.id=movement.return_revision_line_id
      WHERE movement.generation_id=generation AND movement.customer_id=c AND movement.kind='return'
       AND movement.return_revision_line_id=(part->>'returnLineId')::uuid AND movement.batch_id=(part->>'batchId')::uuid AND movement.stock_key_id=(pin->>'stockKeyId')::uuid
       AND line.revision_id=revision.id AND line.customer_id=c AND line.batch_id=movement.batch_id AND line.stock_key_id=movement.stock_key_id
       AND movement.effective_date=revision.return_date AND movement.quantity_delta=-line.quantity AND (part->>'coveredQuantity')::numeric BETWEEN 1 AND line.quantity)<>1
    THEN RAISE EXCEPTION 'Prior canonical return movement missing' USING ERRCODE='22023'; END IF;
   END LOOP;
  END LOOP;
  -- Human note differences are not different physical coverage. All physical
  -- pins, recorded capacity, declaration and exact line/batch allocations are.
  SELECT jsonb_agg(p-ARRAY['confirmation','aggregateCoveredQuantity'] ORDER BY p->>'revisionId') INTO signature FROM jsonb_array_elements(pins) p;
  IF agreed IS NOT NULL AND agreed IS DISTINCT FROM signature THEN RAISE EXCEPTION 'Prior return coverage ambiguous' USING ERRCODE='22023'; END IF;
  agreed:=signature;
  IF chosen IS NULL THEN chosen:=jsonb_build_object('pins',pins,'proof',jsonb_build_object('basis','prior_committed_exact_coverage','rowId',row_id,
   'priorImportId',witness.id,'priorReportRevisionId',witness.report_revision_id,'priorManifestDigest',witness.digest,'priorValidationDigest',witness.validation_digest)); END IF;
 END LOOP;
 IF chosen IS NULL THEN RAISE EXCEPTION 'Verified recorded-return coverage required' USING ERRCODE='22023'; END IF;
 RETURN chosen;
END $$;
REVOKE ALL ON FUNCTION private.co_import_prior_return_proof_v1(jsonb,text,uuid,date) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.co_import_validate_review_v1(m jsonb,c uuid,month date,eligible jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE input jsonb:=m->'input'; source jsonb:=m->'input'->'extracted'; row jsonb; section jsonb; control jsonb; metric text; control_rows jsonb; mapping jsonb; decision jsonb; link jsonb; item jsonb; confirmation jsonb; flag text; id text; zero_key text; k uuid;
 units jsonb:='{}'; quantities jsonb:='{}'; used_returns jsonb:='{}'; return_pins jsonb:='[]'; return_proofs jsonb:='[]'; proven_pins jsonb:='[]'; proof jsonb; final_pins jsonb; result jsonb; declaration private.co_stock_key_unit_declarations%ROWTYPE; return_revision private.co_return_revisions%ROWTYPE;
 q numeric; mapped numeric; n numeric; d numeric; returned numeric; linked numeric; capacity numeric; used numeric; amount numeric; price numeric; discount numeric; expected_amount numeric; printed numeric; section_sum numeric; available numeric; total_amount numeric:=0; currency text:=input->>'currency';
BEGIN
 PERFORM private.co_import_decode_v1(m);
 IF input->'scope'->>'customerId' IS DISTINCT FROM c::text OR input->'scope'->>'reportMonth' IS DISTINCT FROM month::text OR input->'completenessConfirmed' IS DISTINCT FROM 'true'::jsonb OR currency IS NULL OR currency!~'^[A-Z]{3}$' THEN RAISE EXCEPTION 'Import scope or completeness unresolved' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(source->'periodCandidates') x WHERE x<>month::text) OR (EXISTS(SELECT 1 FROM jsonb_array_elements_text(source->'warnings') x WHERE starts_with(x,'manual_review:')) AND NOT private.co_import_manual_valid_v1(source)) THEN RAISE EXCEPTION 'Import source scope unresolved' USING ERRCODE='22023'; END IF;
 -- Duplicate IDs, dangling memberships/decisions and omitted mappings are errors.
 IF (SELECT count(*) FROM jsonb_array_elements(source->'sourceRows'))<>(SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(source->'sourceRows'))
 OR (SELECT count(*) FROM jsonb_array_elements(source->'sections'))<>(SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(source->'sections'))
 OR (SELECT count(*) FROM jsonb_array_elements(input->'mappings'))<>(SELECT count(DISTINCT value->>'rowId') FROM jsonb_array_elements(input->'mappings'))
 OR (SELECT count(*) FROM jsonb_array_elements(input->'returns'))<>(SELECT count(DISTINCT value->>'rowId') FROM jsonb_array_elements(input->'returns'))
 OR (SELECT count(*) FROM jsonb_array_elements_text(input->'includedSectionIds'))<>(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(input->'includedSectionIds'))
 OR (SELECT count(*) FROM jsonb_array_elements_text(input->'omittedZeroStockKeyIds'))<>(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(input->'omittedZeroStockKeyIds')) THEN RAISE EXCEPTION 'Duplicate import identity' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(input->'mappings') a WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source->'sourceRows') b WHERE b->>'id'=a->>'rowId'))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(input->'returns') a WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source->'sourceRows') b WHERE b->>'id'=a->>'rowId'))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(input->'includedSectionIds') a WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source->'sections') b WHERE b->>'id'=a)) THEN RAISE EXCEPTION 'Dangling import decision' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(coalesce(input->'sourceConfirmations','[]')))<>(SELECT count(DISTINCT (value->>'rowId',value->>'flag')) FROM jsonb_array_elements(coalesce(input->'sourceConfirmations','[]')))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(input->'sourceConfirmations','[]')) a WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source->'sourceRows') b WHERE b->>'id'=a->>'rowId' AND b->'flags'?(a->>'flag'))) THEN RAISE EXCEPTION 'Invalid source confirmation identity' USING ERRCODE='22023'; END IF;
 -- Printed XLSX controls reconcile original physical source coverage, independent
 -- of mapped/excluded rows. These sums are never a mixed-unit stock KPI.
 IF source->>'format'='xlsx' AND (source->>'parserVersion' ~ '^co-guarded-xlsx-[1-5]$'
  OR source->>'parserVersion' IN('co-guarded-xlsx-6','co-guarded-xlsx-7') AND (NOT source?'printedControls' OR EXISTS(
   SELECT 1 FROM jsonb_array_elements(source->'sections') s WHERE s->'printedTotal'<>'null'::jsonb AND NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(source->'printedControls') pc WHERE pc->>'kind'='section' AND pc->'ref'->>'section'=s->>'id'))))
 THEN RAISE EXCEPTION 'Source printed controls required; reselect workbook' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(coalesce(source->'printedControls','[]')))<>(SELECT count(DISTINCT (pc->'ref'->>'sheet',pc->'ref'->>'row')) FROM jsonb_array_elements(coalesce(source->'printedControls','[]')) pc)
 THEN RAISE EXCEPTION 'Duplicate printed control reference' USING ERRCODE='22023'; END IF;
 FOR control IN SELECT value FROM jsonb_array_elements(coalesce(source->'printedControls','[]')) LOOP
  IF source->>'format'<>'xlsx' OR control->'ref'->>'fileSha256' IS DISTINCT FROM source->>'sha256' OR control->'ref'->>'sheet' IS NULL
   OR control->'ref'->'page'<>'null'::jsonb OR control->'ref'->>'row' !~ '^r[1-9][0-9]*$'
  THEN RAISE EXCEPTION 'Printed control source reference mismatch' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(r),'[]') INTO control_rows FROM jsonb_array_elements(source->'sourceRows') r
   WHERE CASE WHEN control->>'kind'='sheet' THEN r->'ref'->>'sheet'=control->'ref'->>'sheet' ELSE r->'ref'->>'section'=control->'ref'->>'section' END;
  IF jsonb_array_length(control_rows)=0 OR jsonb_array_length(control->'rowIds')<>jsonb_array_length(control_rows)
   OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(control->'rowIds'))<>jsonb_array_length(control_rows)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(control_rows) r WHERE NOT control->'rowIds'?(r->>'id') OR r->'ref'->>'sheet' IS DISTINCT FROM control->'ref'->>'sheet')
   OR (control->>'kind'='section' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source->'sections') s WHERE s->>'id'=control->'ref'->>'section' AND s->'printedTotal'=control->'amount'))
  THEN RAISE EXCEPTION 'Printed control coverage mismatch' USING ERRCODE='22023'; END IF;
  IF private.co_import_source_number_v1(control->'count')::numeric<>jsonb_array_length(control_rows)
  THEN RAISE EXCEPTION 'Printed control count mismatch' USING ERRCODE='22023'; END IF;
  FOREACH metric IN ARRAY ARRAY['quantity','returned','amount'] LOOP
   SELECT sum(private.co_import_source_number_v1(r->metric)::numeric) INTO section_sum FROM jsonb_array_elements(control_rows) r;
   IF private.co_import_source_number_v1(control->metric)::numeric IS DISTINCT FROM section_sum
   THEN RAISE EXCEPTION 'Printed control % mismatch',metric USING ERRCODE='22023'; END IF;
  END LOOP;
 END LOOP;
 -- Partial manual controls reconcile original explicit coverage, never included mappings.
 IF source->>'parserVersion'='co-human-transcribed-2' THEN
  FOR control IN SELECT value FROM jsonb_array_elements(source->'manualPrintedControls'->'controls') LOOP
   SELECT jsonb_agg(r) INTO control_rows FROM jsonb_array_elements(source->'sourceRows') r WHERE control->'rowIds'?(r->>'id');
   IF control->'count'<>'null'::jsonb AND private.co_import_source_number_v1(control->'count',false)::numeric<>jsonb_array_length(control_rows)
   THEN RAISE EXCEPTION 'Manual control count mismatch' USING ERRCODE='22023'; END IF;
   FOREACH metric IN ARRAY ARRAY['quantity','returned','amount'] LOOP
    IF control->metric<>'null'::jsonb THEN
     -- Explicitly reject null; SQL SUM must never skip an unknown covered metric.
     IF EXISTS(SELECT 1 FROM jsonb_array_elements(control_rows) r WHERE r->metric IS NULL OR r->metric='null'::jsonb)
     THEN RAISE EXCEPTION 'Manual control covered metric unresolved' USING ERRCODE='22023'; END IF;
     SELECT sum(private.co_import_source_number_v1(r->metric,false)::numeric) INTO section_sum FROM jsonb_array_elements(control_rows) r;
     IF private.co_import_source_number_v1(control->metric,false)::numeric IS DISTINCT FROM section_sum
     THEN RAISE EXCEPTION 'Manual control % mismatch',metric USING ERRCODE='22023'; END IF;
    END IF;
   END LOOP;
  END LOOP;
 END IF;
 FOR section IN SELECT value FROM jsonb_array_elements(source->'sections') LOOP
  IF (SELECT count(*) FROM jsonb_array_elements_text(section->'rowIds'))<>(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(section->'rowIds')) THEN RAISE EXCEPTION 'Duplicate source section membership' USING ERRCODE='22023'; END IF;
  section_sum:=0;
  FOR id IN SELECT value FROM jsonb_array_elements_text(section->'rowIds') LOOP
   SELECT value INTO row FROM jsonb_array_elements(source->'sourceRows') WHERE value->>'id'=id;
   IF row IS NULL OR row->'ref'->>'section' IS DISTINCT FROM section->>'id' THEN RAISE EXCEPTION 'Invalid source section membership' USING ERRCODE='22023'; END IF;
   IF input->'includedSectionIds'?(section->>'id') AND section->'printedTotal'<>'null'::jsonb THEN
    section_sum:=section_sum+private.co_import_source_money_v1(row->'amount');
    IF row->>'currency' IS NOT NULL AND row->>'currency'<>currency THEN RAISE EXCEPTION 'Printed section currency mismatch' USING ERRCODE='22023'; END IF;
   END IF;
  END LOOP;
  IF input->'includedSectionIds'?(section->>'id') AND section->'printedTotal'<>'null'::jsonb THEN
   printed:=private.co_import_source_money_v1(section->'printedTotal');IF printed<>section_sum THEN RAISE EXCEPTION 'Printed source total mismatch' USING ERRCODE='22023'; END IF;
  END IF;
 END LOOP;
 FOR row IN SELECT value FROM jsonb_array_elements(source->'sourceRows') LOOP
  id:=row->>'id';
  IF row->'ref'->>'fileSha256' IS DISTINCT FROM source->>'sha256' OR (SELECT count(*) FROM jsonb_array_elements(source->'sections') s CROSS JOIN LATERAL jsonb_array_elements_text(s->'rowIds') member WHERE member=id)<>1 THEN RAISE EXCEPTION 'Source reference mismatch' USING ERRCODE='22023'; END IF;
  SELECT value INTO mapping FROM jsonb_array_elements(input->'mappings') WHERE value->>'rowId'=id;
  IF mapping IS NULL OR mapping->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Explicit mapping required' USING ERRCODE='22023'; END IF;
  -- An absent return column is not an unresolved number. Any present number must
  -- still parse, and explicit uncertainty cannot disappear through exclusion or
  -- the zero/null early exit. Client "clear" is never a harmlessness predicate.
  SELECT value INTO decision FROM jsonb_array_elements(input->'returns') WHERE value->>'rowId'=id;
  returned:=CASE WHEN row->'returned'='null'::jsonb THEN 0 ELSE private.co_import_source_integer_v1(row->'returned') END;
  IF decision IS NOT NULL AND (decision->>'state'='unresolved' OR decision->>'stockImpact'='uncertain') AND NOT
   (decision->>'state'='unresolved' AND decision->>'stockImpact'='uncertain' AND decision->'links'='[]'::jsonb AND returned>0 AND mapping->'included'='true'::jsonb AND input->'includedSectionIds'?(row->'ref'->>'section'))
  THEN RAISE EXCEPTION 'Unresolved return decision' USING ERRCODE='22023'; END IF;
  IF returned=0 AND decision IS NOT NULL AND (decision->>'state'<>'none' OR jsonb_array_length(decision->'links')<>0) THEN RAISE EXCEPTION 'Unexpected return decision' USING ERRCODE='22023'; END IF;
  IF mapping->'included'='false'::jsonb THEN
   IF returned<>0 THEN RAISE EXCEPTION 'Excluded return-bearing source remains unresolved' USING ERRCODE='22023'; END IF;
   IF nullif(private.co_import_trim_v1(mapping->>'exclusionReason'),'') IS NULL THEN RAISE EXCEPTION 'Explicit exclusion reason required' USING ERRCODE='22023'; END IF;
   CONTINUE;
  END IF;
  IF NOT input->'includedSectionIds'?(row->'ref'->>'section') THEN RAISE EXCEPTION 'Included section confirmation required' USING ERRCODE='22023'; END IF;
  k:=private.co_input_uuid_v1(mapping->'stockKeyId');
  SELECT (value->>'eligible_quantity')::numeric INTO available FROM jsonb_array_elements(eligible) WHERE value->>'stock_key_id'=k::text;
  IF available IS NULL THEN RAISE EXCEPTION 'Eligible existing stock key required' USING ERRCODE='22023'; END IF;
  SELECT * INTO declaration FROM private.co_stock_key_unit_declarations WHERE customer_id=c AND stock_key_id=k;
  IF declaration.id IS NULL OR mapping->>'ledgerUnit' IS DISTINCT FROM declaration.unit THEN RAISE EXCEPTION 'Declared ledger unit required' USING ERRCODE='22023'; END IF;
  units:=units||jsonb_build_object(k::text,jsonb_build_object('id',declaration.id,'version',declaration.version::text,'unit',declaration.unit));
  q:=private.co_import_source_integer_v1(row->'quantity');mapped:=private.co_import_integer_v1(mapping->'quantity');n:=1;d:=1;
  IF mapping->'conversion'<>'null'::jsonb THEN
   n:=private.co_import_integer_v1(mapping->'conversion'->'numerator');d:=private.co_import_integer_v1(mapping->'conversion'->'denominator');
   IF n<=0 OR d<=0 OR nullif(private.co_import_trim_v1(mapping->'conversion'->>'reason'),'') IS NULL OR nullif(private.co_import_trim_v1(row->>'unit'),'') IS NULL THEN RAISE EXCEPTION 'Explicit positive conversion required' USING ERRCODE='22023'; END IF;
  ELSIF row->>'unit' IS NOT NULL AND row->>'unit'<>declaration.unit THEN RAISE EXCEPTION 'Explicit source conversion required' USING ERRCODE='22023'; END IF;
  IF mod(q*n,d)<>0 OR q*n/d<>mapped OR mapped>2147483647 THEN RAISE EXCEPTION 'Exact integral quantity mapping required' USING ERRCODE='22023'; END IF;
  mapped:=coalesce((quantities->>k::text)::numeric,0)+mapped;
  IF mapped>2147483647 OR mapped>available THEN RAISE EXCEPTION 'Import quantity exceeds eligible capacity' USING ERRCODE='22023'; END IF;
  quantities:=quantities||jsonb_build_object(k::text,mapped::text);
  IF row->>'currency' IS NOT NULL AND row->>'currency'<>currency THEN RAISE EXCEPTION 'Source currency mismatch' USING ERRCODE='22023'; END IF;
  amount:=private.co_import_source_money_v1(row->'amount');total_amount:=total_amount+amount;
  discount:=CASE WHEN row->'discount'='null'::jsonb THEN 0 ELSE private.co_import_source_money_v1(row->'discount',source->>'format'='pdf' AND row->>'discountBasis'='line_amount') END;
  IF row->'netUnitPrice'<>'null'::jsonb THEN PERFORM private.co_import_source_money_v1(row->'netUnitPrice'); END IF;
  IF discount<>0 AND (row->>'discountBasis' IS NULL OR row->>'discountBasis'='unknown') THEN RAISE EXCEPTION 'Discount basis unresolved' USING ERRCODE='22023'; END IF;
  IF row->'unitPrice'<>'null'::jsonb THEN
   price:=private.co_import_source_money_v1(row->'unitPrice');expected_amount:=q*price;
   IF discount<>0 THEN
    CASE row->>'discountBasis'
    WHEN 'line_amount' THEN expected_amount:=expected_amount-discount;
    WHEN 'unit_amount' THEN expected_amount:=expected_amount-q*discount;
    WHEN 'percent' THEN IF discount>100 OR mod(expected_amount*100*(100-discount),100)<>0 THEN RAISE EXCEPTION 'Inexact source discount arithmetic' USING ERRCODE='22023'; END IF; expected_amount:=expected_amount*(100-discount)/100;
    ELSE RAISE EXCEPTION 'Discount basis unresolved' USING ERRCODE='22023';
    END CASE;
   END IF;
   IF expected_amount<>amount THEN RAISE EXCEPTION 'Source amount mismatch' USING ERRCODE='22023'; END IF;
  END IF;
  FOR flag IN SELECT value FROM jsonb_array_elements_text(row->'flags') LOOP
   IF flag IN('formula_cache_requires_confirmation','source_sku_format_requires_confirmation') THEN
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(input->'sourceConfirmations','[]')) a WHERE a->>'rowId'=id AND a->>'flag'=flag AND a->'confirmed'='true'::jsonb AND nullif(private.co_import_trim_v1(a->>'reason'),'') IS NOT NULL) THEN RAISE EXCEPTION 'Explicit source confirmation required' USING ERRCODE='22023'; END IF;
   ELSIF flag NOT IN('unit_missing','section_scope_requires_review','discount_basis_unknown','currency_requires_confirmation','return_reconciliation_required') AND NOT starts_with(flag,'source_sku_raw:') THEN RAISE EXCEPTION 'Unresolved unsafe source flag' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF returned=0 THEN CONTINUE; END IF;
  IF mod(returned*n,d)<>0 THEN RAISE EXCEPTION 'Exact integral return conversion required' USING ERRCODE='22023'; END IF;
  returned:=returned*n/d;
  IF decision->>'state'='unresolved' THEN
   proof:=private.co_import_prior_return_proof_v1(m,id,c,month);
   return_proofs:=return_proofs||jsonb_build_array(proof->'proof');proven_pins:=proven_pins||(proof->'pins');
   -- Local server baseline only; never replace the immutable unresolved choice.
   SELECT jsonb_build_object('state','linked','stockImpact','clear','links',jsonb_agg(jsonb_build_object('returnRevisionId',p->'revisionId','quantity',p->'quantity','confirmation',p->'confirmation') ORDER BY ord)) INTO decision
    FROM jsonb_array_elements(proof->'pins') WITH ORDINALITY x(p,ord);
  END IF;
  IF decision IS NULL OR decision->>'state'<>'linked' OR decision->>'stockImpact'='uncertain' OR jsonb_array_length(decision->'links')=0 THEN RAISE EXCEPTION 'Existing physical return evidence required' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(decision->'links'))<>(SELECT count(DISTINCT value->>'returnRevisionId') FROM jsonb_array_elements(decision->'links')) THEN RAISE EXCEPTION 'Duplicate row return link' USING ERRCODE='22023'; END IF;
  linked:=0;
  FOR link IN SELECT value FROM jsonb_array_elements(decision->'links') LOOP
   confirmation:=link->'confirmation';q:=private.co_import_integer_v1(link->'quantity');
   SELECT r.* INTO return_revision FROM private.co_return_revisions r JOIN private.co_return_heads h ON h.id=r.head_id AND h.customer_id=r.customer_id AND h.current_revision_id=r.id WHERE r.id=(link->>'returnRevisionId')::uuid AND r.customer_id=c AND NOT r.is_void;
   IF q<=0 OR return_revision.id IS NULL OR confirmation->'confirmed' IS DISTINCT FROM 'true'::jsonb OR confirmation->>'physicalReturnDate' IS DISTINCT FROM return_revision.return_date::text THEN RAISE EXCEPTION 'Return revision/date identity mismatch' USING ERRCODE='22023'; END IF;
   SELECT coalesce(sum(quantity),0) INTO capacity FROM private.co_return_revision_lines WHERE revision_id=return_revision.id AND customer_id=c AND stock_key_id=k;
   used:=coalesce((used_returns->>(return_revision.id::text||':'||k::text))::numeric,0)+q;
   IF used>capacity THEN RAISE EXCEPTION 'Return evidence capacity exceeded' USING ERRCODE='22023'; END IF;
   used_returns:=used_returns||jsonb_build_object(return_revision.id::text||':'||k::text,used::text);linked:=linked+q;
   return_pins:=return_pins||jsonb_build_array(jsonb_build_object('rowId',id,'revisionId',return_revision.id,'revisionVersion',return_revision.revision_no::text,'stockKeyId',k,'declarationId',declaration.id,'unit',declaration.unit,'quantity',q::text,'confirmation',confirmation));
  END LOOP;
  IF linked<>returned THEN RAISE EXCEPTION 'Return source linkage quantity mismatch' USING ERRCODE='22023'; END IF;
  -- Client stockImpact='clear' supplies no authority. All included return-bearing
  -- rows required exact server-verified revision/customer/SKU/unit/date/capacity.
 END LOOP;
 FOR zero_key IN SELECT value FROM jsonb_array_elements_text(input->'omittedZeroStockKeyIds') LOOP
  IF quantities?zero_key OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(eligible) WHERE value->>'stock_key_id'=zero_key) THEN RAISE EXCEPTION 'Invalid explicit omitted zero' USING ERRCODE='22023'; END IF;
  SELECT * INTO declaration FROM private.co_stock_key_unit_declarations WHERE customer_id=c AND stock_key_id=zero_key::uuid;
  IF declaration.id IS NULL THEN RAISE EXCEPTION 'Declared zero-row unit required' USING ERRCODE='22023'; END IF;
  quantities:=quantities||jsonb_build_object(zero_key,'0');units:=units||jsonb_build_object(zero_key,jsonb_build_object('id',declaration.id,'version',declaration.version::text,'unit',declaration.unit));
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(eligible) WHERE NOT quantities?(value->>'stock_key_id')) OR (jsonb_array_length(source->'sourceRows')=0 AND jsonb_array_length(input->'omittedZeroStockKeyIds')=0) THEN RAISE EXCEPTION 'Explicit complete eligible quantities required' USING ERRCODE='22023'; END IF;
 -- One deterministic explicit-linked baseline accounts for ALL rows together.
 -- Never reallocate a proven row to a different line or batch, even when capacity
 -- exists elsewhere. Ordinary explicitly-linked JSON remains byte-compatible.
 final_pins:=private.co_import_return_pins_v1(return_pins,c);
 FOR link IN SELECT value FROM jsonb_array_elements(proven_pins) LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(final_pins) p WHERE p-'aggregateCoveredQuantity'=link-'aggregateCoveredQuantity')
  THEN RAISE EXCEPTION 'Exact prior line allocation differs' USING ERRCODE='22023'; END IF;
 END LOOP;
 result:=jsonb_build_object('quantities',quantities,'unitDeclarations',units,'returnLinks',final_pins,'sourceAmount',total_amount::text,'currency',currency,'stockImpact','clear');
 IF return_proofs<>'[]'::jsonb THEN result:=result||jsonb_build_object('returnProofs',return_proofs); END IF;
 RETURN result;
END $$;

CREATE FUNCTION private.co_import_binding_v1(m private.co_import_manifests) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('importId',m.id,'importVersion',m.version::text,'customerVersion',m.customer_version::text,'draftId',m.draft_id,'draftVersion',m.draft_version::text,'manifestDigest',m.digest);
$$;
CREATE FUNCTION public.pilot_co_import_prepare_v1(p_request_id uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.co_actor_v1(); receipt jsonb; m jsonb; c uuid; cv bigint; d private.co_drafts%ROWTYPE; e private.co_evidence%ROWTYPE; a private.co_evidence_verifications%ROWTYPE;
 ctx jsonb; validation jsonb; binding jsonb; imported private.co_import_manifests%ROWTYPE; selection private.co_import_selections%ROWTYPE; before_draft jsonb;
BEGIN
 PERFORM private.co_input_object_v1(p_payload,ARRAY['manifest','expected_customer_version','expected_draft_version','expected_evidence_version'],ARRAY['manifest','expected_customer_version','expected_draft_version','expected_evidence_version','expected_selection_id']);
 m:=p_payload->'manifest';PERFORM private.co_import_decode_v1(m);
 IF p_payload->'expected_evidence_version' IS DISTINCT FROM '"2"'::jsonb THEN RAISE EXCEPTION 'Finalized evidence version required' USING ERRCODE='22023'; END IF;
 receipt:=private.co_workspace_command_begin_v1(p_request_id,'prepare_import',p_payload);
 IF receipt IS NOT NULL THEN
  SELECT r.binding INTO binding FROM private.co_import_prepare_results r WHERE r.actor_id=actor AND r.request_id=p_request_id AND r.import_id=(receipt->>'id')::uuid;
  IF binding IS NULL THEN RAISE EXCEPTION 'Missing immutable prepare result' USING ERRCODE='55000'; END IF;
  RETURN binding;
 END IF;
 PERFORM private.co_workspace_generation_guard_v1();
 SELECT * INTO e FROM private.co_evidence WHERE id=(m->>'evidenceId')::uuid;
 c:=e.customer_id;
 IF c IS NULL OR m->'input'->'scope'->>'customerId' IS DISTINCT FROM c::text THEN RAISE EXCEPTION 'Import evidence customer mismatch' USING ERRCODE='22023'; END IF;
 cv:=private.co_lock_customer_v1(c,private.co_input_version_v1(p_payload->'expected_customer_version'));
 -- Same customer/entity order as corrections, then draft/evidence. No caller GUC
 -- grants authority, and request metadata is not a persistent validation capability.
 PERFORM id FROM private.co_orders WHERE customer_id=c ORDER BY id FOR UPDATE;
 PERFORM id FROM private.co_delivery_heads WHERE customer_id=c ORDER BY id FOR UPDATE;
 PERFORM id FROM private.co_return_heads WHERE customer_id=c ORDER BY id FOR UPDATE;
 PERFORM id FROM private.co_report_heads WHERE customer_id=c ORDER BY id FOR UPDATE;
 SELECT * INTO d FROM private.co_drafts WHERE id=e.draft_id FOR UPDATE;
 SELECT * INTO e FROM private.co_evidence WHERE id=e.id FOR UPDATE;
 PERFORM private.co_evidence_draft_v1(d,private.co_input_version_v1(p_payload->'expected_draft_version'),cv);
 selection:=private.co_import_selection_v1(d.id);
 IF EXISTS(SELECT 1 FROM private.co_draft_import_origins WHERE draft_id=d.id) THEN
  IF selection.state<>'review_open' OR selection.id IS DISTINCT FROM private.co_input_uuid_v1(p_payload->'expected_selection_id') THEN RAISE EXCEPTION 'Explicit import supersession required' USING ERRCODE='55000'; END IF;
 ELSIF p_payload?'expected_selection_id' THEN RAISE EXCEPTION 'Unexpected import predecessor' USING ERRCODE='22023'; END IF;
 IF e.version<>2 OR e.finalized_draft_version<>d.version OR e.customer_version<>cv OR d.evidence_id IS DISTINCT FROM e.id THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 IF e.report_month<>d.report_month OR m->'input'->'scope'->>'reportMonth' IS DISTINCT FROM d.report_month::text OR m->'input'->'extracted'->>'sha256' IS DISTINCT FROM e.sha256
 OR e.mime_type IS DISTINCT FROM (CASE m->'input'->'extracted'->>'format' WHEN 'pdf' THEN 'application/pdf' WHEN 'xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' END) THEN RAISE EXCEPTION 'Import evidence source mismatch' USING ERRCODE='22023'; END IF;
 SELECT * INTO a FROM private.co_evidence_verifications WHERE evidence_id=e.id;
 IF a.evidence_id IS NULL THEN RAISE EXCEPTION 'Verified evidence object required' USING ERRCODE='55000'; END IF;
 PERFORM private.co_evidence_object_v1(e,a.object_id,a.object_version,a.byte_size,a.mime_type,a.sha256);
 PERFORM private.co_import_manual_receipt_v1(m->'input'->'extracted',e,a);
 ctx:=private.co_report_context_v1(c,d.report_month,d.id);
 validation:=private.co_import_validate_review_v1(m,c,d.report_month,ctx->'eligible_rows');
 before_draft:=to_jsonb(d);
 INSERT INTO private.co_import_manifests(customer_id,report_month,draft_id,draft_version,customer_version,evidence_id,canonical_json,digest,validation,validation_digest,created_by,request_id)
 VALUES(c,d.report_month,d.id,d.version+1,cv,e.id,m,m->>'digest',validation,
 encode(sha256(convert_to(E'co-import-validation-v1\n'||private.co_manifest_canonical_v1(jsonb_build_object('manifestDigest',m->>'digest','validation',validation)),'UTF8')),'hex'),actor,p_request_id) RETURNING * INTO imported;
 IF selection.id IS NULL THEN INSERT INTO private.co_draft_import_origins(draft_id,customer_id,import_id) VALUES(d.id,c,imported.id); END IF;
 INSERT INTO private.co_import_selections(draft_id,customer_id,customer_version,predecessor_id,import_id,state,actor_id,request_id,reason,before_draft,after_draft)
 VALUES(d.id,c,cv,selection.id,imported.id,'selected',actor,p_request_id,m->'input'->>'reason',before_draft,jsonb_set(before_draft,'{version}',to_jsonb(d.version+1)));
 PERFORM private.co_import_save_coverage_v1(imported);
 DELETE FROM private.co_report_draft_lines WHERE draft_id=d.id;
 INSERT INTO private.co_report_draft_lines(draft_id,customer_id,stock_key_id,sold_quantity)
 SELECT d.id,c,key::uuid,value::integer FROM jsonb_each_text(validation->'quantities');
 UPDATE private.co_drafts SET version=version+1 WHERE id=d.id RETURNING * INTO d;
 binding:=private.co_import_binding_v1(imported);
 INSERT INTO private.co_import_prepare_results(actor_id,request_id,import_id,binding) VALUES(actor,p_request_id,imported.id,binding);
 INSERT INTO private.co_audit_events(customer_id,actor_id,request_id,operation,reason,before_state,after_state)
 VALUES(c,actor,p_request_id,'prepare_import',m->'input'->>'reason',jsonb_build_object('draft_id',d.id,'draft_version',p_payload->>'expected_draft_version','evidence_id',e.id),binding||jsonb_build_object('validationDigest',imported.validation_digest));
 PERFORM private.co_command_commit_v1(p_request_id,jsonb_build_object('id',imported.id,'operation','prepare_import','version','1','customer_id',c,'customer_version',cv::text));
 RETURN binding;
END $$;
CREATE FUNCTION public.pilot_co_import_read_v1(p_import_id uuid,p_expected_version text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE imported private.co_import_manifests%ROWTYPE;
BEGIN
 PERFORM private.co_read_actor_v1();PERFORM private.co_input_version_v1(to_jsonb(p_expected_version));
 SELECT * INTO imported FROM private.co_import_manifests WHERE id=p_import_id;
 IF imported.id IS NULL THEN RAISE EXCEPTION 'Invalid import identity' USING ERRCODE='22023'; END IF;
 PERFORM private.co_read_customer_v1(imported.customer_id);
 IF imported.version::text<>p_expected_version THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 RETURN jsonb_build_object('manifest',imported.canonical_json,'binding',private.co_import_binding_v1(imported));
END $$;
CREATE FUNCTION public.pilot_reconcile_co_import_prepare_v1(p_request_id uuid,p_abandon boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.co_actor_v1(); command private.co_commands%ROWTYPE; binding jsonb;
BEGIN
 IF p_request_id IS NULL OR p_abandon IS NULL THEN RAISE EXCEPTION 'Invalid prepare recovery' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('co-command:'||actor::text||':'||p_request_id::text,0));
 SELECT * INTO command FROM private.co_commands WHERE actor_id=actor AND request_id=p_request_id FOR UPDATE;
 IF command.operation IS NOT NULL AND command.operation<>'prepare_import' THEN RAISE EXCEPTION 'CO request family mismatch' USING ERRCODE='22023'; END IF;
 IF command.status='committed' THEN
  SELECT r.binding INTO binding FROM private.co_import_prepare_results r WHERE r.actor_id=actor AND r.request_id=p_request_id AND r.import_id=(command.receipt->>'id')::uuid;
  IF binding IS NULL THEN RAISE EXCEPTION 'Missing immutable prepare result' USING ERRCODE='55000'; END IF;
  RETURN jsonb_build_object('status','committed','operation','prepare_import','binding',binding);
 END IF;
 IF command.status='abandoned' THEN RETURN jsonb_build_object('status','abandoned'); END IF;
 IF command.status='pending' THEN RETURN jsonb_build_object('status','unknown'); END IF;
 IF p_abandon THEN INSERT INTO private.co_commands(actor_id,request_id,status) VALUES(actor,p_request_id,'abandoned'); RETURN jsonb_build_object('status','abandoned'); END IF;
 RETURN jsonb_build_object('status','unknown');
END $$;

-- Task5 intentionally does not enable imported posting. Origin is outside the
-- replaceable draft payload. Imported mutations require Task6's fresh under-lock
-- validation/supersession path; manual legacy drafts remain unchanged.
CREATE FUNCTION private.co_import_draft_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE did uuid;
BEGIN
 IF TG_TABLE_NAME='co_drafts' THEN did:=OLD.id;
 ELSIF TG_OP='INSERT' THEN did:=NEW.draft_id;
 ELSE did:=OLD.draft_id; END IF;
 IF EXISTS(SELECT 1 FROM private.co_draft_import_origins WHERE draft_id=did) THEN
  RAISE EXCEPTION 'Atomic import commit or supersession required' USING ERRCODE='55000';
 END IF;
 IF TG_TABLE_NAME='co_report_draft_lines' AND TG_OP='UPDATE' THEN
  IF EXISTS(SELECT 1 FROM private.co_draft_import_origins WHERE draft_id=NEW.draft_id) THEN
   RAISE EXCEPTION 'Atomic import commit or supersession required' USING ERRCODE='55000';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW;
END $$;
CREATE TRIGGER co_import_draft_origin BEFORE UPDATE OR DELETE ON private.co_drafts FOR EACH ROW EXECUTE FUNCTION private.co_import_draft_guard_v1();
CREATE TRIGGER co_import_lines_origin BEFORE INSERT OR UPDATE OR DELETE ON private.co_report_draft_lines FOR EACH ROW EXECUTE FUNCTION private.co_import_draft_guard_v1();
CREATE FUNCTION private.co_link_import_v1(c uuid,head uuid,revision uuid,did uuid,dv bigint,original uuid) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE chosen uuid;
BEGIN
 IF did IS NOT NULL AND EXISTS(SELECT 1 FROM private.co_draft_import_origins WHERE draft_id=did) THEN RAISE EXCEPTION 'Atomic import commit required' USING ERRCODE='55000'; END IF;
 -- Manual primary publication has no import. A downstream system replay inherits
 -- only its own original revision's immutable link, never another month's file.
 IF did IS NULL AND original IS NOT NULL THEN
  SELECT import_id INTO chosen FROM private.co_report_imports WHERE report_revision_id=original AND report_head_id=head AND customer_id=c;
  IF chosen IS NOT NULL THEN INSERT INTO private.co_report_imports(report_revision_id,report_head_id,customer_id,import_id) VALUES(revision,head,c,chosen); END IF;
 END IF;
END $$;
DO $$
DECLARE definition text; anchor text:='IF chosen IS NOT NULL THEN INSERT INTO private.co_report_evidence';
BEGIN
 SELECT pg_get_functiondef('private.co_link_evidence_v1(uuid,uuid,uuid,uuid,bigint,uuid)'::regprocedure) INTO definition;
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Import publication anchor drift'; END IF;
 EXECUTE replace(definition,anchor,'PERFORM private.co_link_import_v1(c,head,revision,did,dv,original); '||anchor);
END $$;
REVOKE ALL ON FUNCTION private.co_import_source_number_v1(jsonb,boolean), private.co_import_source_integer_v1(jsonb), private.co_import_source_money_v1(jsonb,boolean), private.co_import_validate_review_v1(jsonb,uuid,date,jsonb), private.co_import_binding_v1(private.co_import_manifests),
 private.co_import_draft_guard_v1(), private.co_report_import_identity_v1(), private.co_link_import_v1(uuid,uuid,uuid,uuid,bigint,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pilot_co_import_prepare_v1(uuid,jsonb),public.pilot_co_import_read_v1(uuid,text),public.pilot_reconcile_co_import_prepare_v1(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pilot_co_import_prepare_v1(uuid,jsonb),public.pilot_co_import_read_v1(uuid,text),public.pilot_reconcile_co_import_prepare_v1(uuid,boolean) TO authenticated;

-- Task 5C: XLSX declarations/path only. SQL metadata never proves provider bytes.
-- Discover only the source-defined single-column MIME check; refuse catalog drift.
DO $xlsx_mime_check$
DECLARE constraint_name name; matching integer;
BEGIN
 SELECT count(*), (array_agg(c.conname))[1] INTO matching,constraint_name
 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='mime_type'
 WHERE c.conrelid='private.co_evidence'::regclass AND c.contype='c' AND c.conkey=ARRAY[a.attnum]
 AND pg_get_expr(c.conbin,c.conrelid)='(mime_type = ANY (ARRAY[''application/pdf''::text, ''image/png''::text, ''image/jpeg''::text]))';
 IF matching<>1 THEN RAISE EXCEPTION 'Evidence MIME constraint drift'; END IF;
 EXECUTE format('ALTER TABLE private.co_evidence DROP CONSTRAINT %I',constraint_name);
 EXECUTE format('ALTER TABLE private.co_evidence ADD CONSTRAINT %I CHECK(mime_type IN(''application/pdf'',''image/png'',''image/jpeg'',''application/vnd.openxmlformats-officedocument.spreadsheetml.sheet''))',constraint_name);
END $xlsx_mime_check$;
CREATE OR REPLACE FUNCTION private.co_evidence_path_v1(e private.co_evidence) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT e.id::text||CASE e.mime_type WHEN 'application/pdf' THEN '.pdf' WHEN 'image/png' THEN '.png' WHEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' THEN '.xlsx' ELSE '.jpg' END;
$$;
-- Replace only the two MIME/extension anchors, preserving authority, recovery,
-- locks, versions, immutable bindings and the original function ACL.
DO $xlsx_registration$
DECLARE definition text;
 mime_anchor text:=$anchor$mime NOT IN('application/pdf','image/png','image/jpeg')$anchor$;
 path_anchor text:=$anchor$WHEN 'image/png' THEN '^[^.].*\.png$' ELSE '^[^.].*\.jpe?g$'$anchor$;
BEGIN
 SELECT pg_get_functiondef((CASE WHEN to_regclass('private.catalog_cutover_v1') IS NULL
  THEN 'public.pilot_co_evidence_transaction_v1(uuid,text,jsonb)'
  ELSE 'private.catalog_evidence_legacy_v1(uuid,text,jsonb)' END)::regprocedure) INTO definition;
 IF (length(definition)-length(replace(definition,mime_anchor,'')))/length(mime_anchor)<>1
 OR (length(definition)-length(replace(definition,path_anchor,'')))/length(path_anchor)<>1 THEN RAISE EXCEPTION 'Evidence registration MIME anchor drift'; END IF;
 definition:=replace(definition,mime_anchor,$new$mime NOT IN('application/pdf','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')$new$);
 definition:=replace(definition,path_anchor,$new$WHEN 'image/png' THEN '^[^.].*\.png$' WHEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' THEN '^[^.].*\.xlsx$' ELSE '^[^.].*\.jpe?g$'$new$);
 EXECUTE definition;
END $xlsx_registration$;
DO $xlsx_bucket$
BEGIN
 UPDATE storage.buckets SET allowed_mime_types=ARRAY['application/pdf','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
 WHERE id='co-evidence' AND name='co-evidence' AND public=false AND file_size_limit=10485760
 AND allowed_mime_types=ARRAY['application/pdf','image/png','image/jpeg'];
 IF NOT FOUND THEN RAISE EXCEPTION 'Evidence private bucket drift'; END IF;
END $xlsx_bucket$;
CREATE FUNCTION private.co_import_acknowledgements_v1(input jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE x jsonb; result jsonb:='[]'; ids uuid[]:='{}'; id uuid;
BEGIN
 IF jsonb_typeof(input) IS DISTINCT FROM 'array' OR jsonb_array_length(input)>1000 THEN RAISE EXCEPTION 'Invalid explicit reopen acknowledgments' USING ERRCODE='22023'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(input) LOOP
  PERFORM private.co_input_object_v1(x,ARRAY['coId','expectedCoVersion'],ARRAY['coId','expectedCoVersion']);
  id:=private.co_input_uuid_v1(x->'coId');PERFORM private.co_input_version_v1(x->'expectedCoVersion');
  IF id=ANY(ids) THEN RAISE EXCEPTION 'Duplicate reopen acknowledgement' USING ERRCODE='22023'; END IF;
  ids:=array_append(ids,id);
  result:=result||jsonb_build_array(jsonb_build_object('co_id',id,'expected_co_version',x->>'expectedCoVersion'));
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION private.co_import_acknowledgements_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Fresh reconstruction shared by read-only preview and both legacy publication guards.
CREATE FUNCTION private.co_import_fresh_v1(i uuid,expected text,acknowledged jsonb DEFAULT '[]'::jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE m private.co_import_manifests%ROWTYPE; d private.co_drafts%ROWTYPE; e private.co_evidence%ROWTYPE; a private.co_evidence_verifications%ROWTYPE;
 s private.co_import_selections%ROWTYPE; h private.co_report_heads%ROWTYPE; cv bigint; ctx jsonb; validation jsonb; p jsonb; plan jsonb; op text; fingerprint text; coverage jsonb; expected_coverage jsonb; acknowledgements jsonb; baseline_manifest jsonb; baseline_validation jsonb; baseline_plan jsonb; decisions jsonb; proof_issues jsonb:='[]';
BEGIN
 PERFORM private.co_actor_v1(); PERFORM private.co_input_version_v1(to_jsonb(expected));
 SELECT * INTO m FROM private.co_import_manifests WHERE id=i;
 IF m.id IS NULL THEN RAISE EXCEPTION 'Invalid import identity' USING ERRCODE='22023'; END IF;
 PERFORM private.co_read_customer_v1(m.customer_id);
 SELECT version INTO cv FROM private.co_customer_state WHERE customer_id=m.customer_id FOR SHARE;
 SELECT * INTO d FROM private.co_drafts WHERE id=m.draft_id;
 s:=private.co_import_selection_v1(d.id);
 IF m.version::text<>expected OR s.state IS DISTINCT FROM 'selected' OR s.import_id IS DISTINCT FROM m.id OR d.version<>m.draft_version OR cv<>m.customer_version OR d.evidence_id IS DISTINCT FROM m.evidence_id OR d.payload?'posted_report_head_id' THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 PERFORM private.co_import_decode_v1(m.canonical_json);
 IF m.digest IS DISTINCT FROM private.co_manifest_digest_v1(m.canonical_json) THEN RAISE EXCEPTION 'Import canonical digest mismatch' USING ERRCODE='55000'; END IF;
 SELECT * INTO e FROM private.co_evidence WHERE id=m.evidence_id;
 SELECT * INTO a FROM private.co_evidence_verifications WHERE evidence_id=e.id;
 IF e.version<>2 OR e.finalized_draft_version<>m.draft_version-1 OR e.draft_version<>m.draft_version-2 OR e.customer_version<>cv OR e.draft_id<>d.id OR e.customer_id<>m.customer_id OR e.report_month<>m.report_month OR e.sha256 IS DISTINCT FROM m.canonical_json->'input'->'extracted'->>'sha256' OR a.evidence_id IS NULL THEN RAISE EXCEPTION 'Import evidence binding stale' USING ERRCODE='PT409'; END IF;
 PERFORM private.co_evidence_object_v1(e,a.object_id,a.object_version,a.byte_size,a.mime_type,a.sha256);
 PERFORM private.co_import_manual_receipt_v1(m.canonical_json->'input'->'extracted',e,a);
 ctx:=private.co_report_context_v1(m.customer_id,m.report_month,d.id);
 validation:=private.co_import_validate_review_v1(m.canonical_json,m.customer_id,m.report_month,ctx->'eligible_rows');
 IF validation IS DISTINCT FROM m.validation OR m.validation_digest IS DISTINCT FROM encode(sha256(convert_to(E'co-import-validation-v1\n'||private.co_manifest_canonical_v1(jsonb_build_object('manifestDigest',m.digest,'validation',validation)),'UTF8')),'hex') THEN RAISE EXCEPTION 'Import validation stale' USING ERRCODE='PT409'; END IF;
 IF (SELECT coalesce(jsonb_object_agg(stock_key_id::text,sold_quantity::text),'{}') FROM private.co_report_draft_lines WHERE draft_id=d.id) IS DISTINCT FROM validation->'quantities' THEN RAISE EXCEPTION 'Import draft quantities changed' USING ERRCODE='PT409'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_array(source_row_id,return_revision_id,return_line_id,batch_id,stock_key_id,covered_quantity::text) ORDER BY source_row_id,return_line_id),'[]') INTO coverage FROM private.co_import_return_coverage WHERE import_id=m.id AND customer_id=m.customer_id;
 SELECT coalesce(jsonb_agg(jsonb_build_array(pin->>'rowId',pin->>'revisionId',part->>'returnLineId',part->>'batchId',pin->>'stockKeyId',part->>'coveredQuantity') ORDER BY pin->>'rowId',part->>'returnLineId'),'[]') INTO expected_coverage FROM jsonb_array_elements(validation->'returnLinks') pin CROSS JOIN LATERAL jsonb_array_elements(pin->'allocations') part;
 IF coverage IS DISTINCT FROM expected_coverage THEN RAISE EXCEPTION 'Missing immutable return provenance' USING ERRCODE='55000'; END IF;
 SELECT * INTO h FROM private.co_report_heads WHERE customer_id=m.customer_id AND report_month=m.report_month;
 op:=CASE WHEN h.id IS NULL THEN 'post_report' ELSE 'correct_report' END;
 p:=jsonb_build_object('draft_id',d.id,'expected_draft_version',d.version::text,'expected_customer_version',cv::text,'eligible_set_fingerprint',d.eligible_set_fingerprint);
 IF h.id IS NOT NULL THEN
  IF nullif(private.co_import_trim_v1(m.canonical_json->'input'->>'reason'),'') IS NULL THEN RAISE EXCEPTION 'Edit reason required' USING ERRCODE='22023'; END IF;
  p:=p||jsonb_build_object('report_head_id',h.id,'original_revision_id',h.current_revision_id,'expected_report_version',h.version::text,'reason',m.canonical_json->'input'->>'reason','completed_report_drafts','[]'::jsonb,'acknowledged_reopen_orders',acknowledged);
 ELSIF acknowledged<>'[]'::jsonb THEN RAISE EXCEPTION 'Reopen acknowledgments require Edit' USING ERRCODE='22023';
 END IF;
 plan:=private.co_build_plan_v1(m.customer_id,op,p);
 IF validation?'returnProofs' THEN
  -- Reconstruct the exact explicit-linked alternative in memory. Neither this
  -- baseline nor its human confirmations are written into the current manifest.
  SELECT jsonb_agg(CASE WHEN decision->>'state'='unresolved' THEN decision||jsonb_build_object('state','linked','stockImpact','clear','links',
   (SELECT jsonb_agg(jsonb_build_object('returnRevisionId',pin->'revisionId','quantity',pin->'quantity','confirmation',pin->'confirmation') ORDER BY n)
    FROM jsonb_array_elements(validation->'returnLinks') WITH ORDINALITY x(pin,n) WHERE pin->>'rowId'=decision->>'rowId')) ELSE decision END ORDER BY ord)
   INTO decisions FROM jsonb_array_elements(m.canonical_json->'input'->'returns') WITH ORDINALITY x(decision,ord);
  baseline_manifest:=jsonb_set(m.canonical_json,'{input,returns}',decisions);
  baseline_manifest:=jsonb_set(baseline_manifest,'{digest}',to_jsonb(private.co_manifest_digest_v1(baseline_manifest)));
  baseline_validation:=private.co_import_validate_review_v1(baseline_manifest,m.customer_id,m.report_month,ctx->'eligible_rows');
  IF validation-'returnProofs' IS DISTINCT FROM baseline_validation THEN RAISE EXCEPTION 'Exact-linked validation differs' USING ERRCODE='22023'; END IF;
  -- Both validated quantities must equal the very same locked draft consumed by
  -- the normal planner. Compare its complete business result, not just balances.
  IF baseline_validation->'quantities' IS DISTINCT FROM (SELECT coalesce(jsonb_object_agg(stock_key_id::text,sold_quantity::text),'{}') FROM private.co_report_draft_lines WHERE draft_id=d.id)
  THEN RAISE EXCEPTION 'Exact-linked quantities differ' USING ERRCODE='22023'; END IF;
  baseline_plan:=private.co_build_plan_v1(m.customer_id,op,p);
  IF plan IS DISTINCT FROM baseline_plan OR op<>'correct_report'
   OR plan->'proposal'->'sources'->'returns' IS DISTINCT FROM private.co_sources_v1(m.customer_id)->'returns'
  THEN RAISE EXCEPTION 'Exact-linked business plan differs' USING ERRCODE='22023'; END IF;
  SELECT jsonb_agg(jsonb_build_object('code','return_unresolved_prior_coverage_proven','rowId',proof->>'rowId','message','Pilihan manusia belum dicocokkan; cakupan retur terdahulu dibuktikan server.','blocking',false) ORDER BY ord)
   INTO proof_issues FROM jsonb_array_elements(validation->'returnProofs') WITH ORDINALITY x(proof,ord);
 END IF;
 fingerprint:=encode(sha256(convert_to(E'co-import-preview-v1\n'||private.co_manifest_canonical_v1(jsonb_build_object('binding',private.co_import_binding_v1(m),'selection',s.id,'validationDigest',m.validation_digest,'evidence',to_jsonb(e),'attestation',to_jsonb(a),'eligible',ctx,'reportHead',to_jsonb(h),'preview',plan->>'preview_fingerprint')||CASE WHEN validation?'returnProofs' THEN jsonb_build_object('proofGeneration',(SELECT effective_generation_id FROM private.co_customer_state WHERE customer_id=m.customer_id)) ELSE '{}'::jsonb END),'UTF8')),'hex');
 SELECT coalesce(jsonb_agg(jsonb_build_object('coId',x->'co_id','expectedCoVersion',x->'expected_co_version') ORDER BY x->>'co_id'),'[]') INTO acknowledgements FROM jsonb_array_elements(plan->'impacts'->'reopen') x;
 RETURN jsonb_build_object('requiredReopenOrders',acknowledgements,'binding',private.co_import_binding_v1(m),'previewFingerprint',fingerprint,'existingPreview',private.co_preview_header_v1(plan),'issues',(SELECT coalesce(jsonb_agg(jsonb_build_object('code',issue->>'code','rowId',NULL,'message',issue->>'code','blocking',true)),'[]') FROM jsonb_array_elements(plan->'impacts'->'issue') issue)||proof_issues,'operation',op,'payload',p||jsonb_build_object('preview_fingerprint',plan->>'preview_fingerprint'));
END $$;
CREATE FUNCTION public.pilot_co_import_preview_v1(p_import_id uuid,p_expected_version text,p_acknowledged_reopen_orders jsonb DEFAULT '[]'::jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RETURN private.co_import_fresh_v1(p_import_id,p_expected_version,private.co_import_acknowledgements_v1(p_acknowledged_reopen_orders))-ARRAY['operation','payload'];
END $$;
CREATE FUNCTION private.co_import_publication_guard_v1(request uuid,op text,p jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE d uuid; context private.co_import_post_requests%ROWTYPE; fresh jsonb;
BEGIN
 IF op NOT IN('post_report','correct_report') THEN RETURN; END IF;
 d:=private.co_input_uuid_v1(p->'draft_id');
 IF NOT EXISTS(SELECT 1 FROM private.co_draft_import_origins WHERE draft_id=d) THEN
  IF EXISTS(SELECT 1 FROM private.co_import_post_requests WHERE actor_id=auth.uid() AND request_id=request) THEN RAISE EXCEPTION 'Import context requires imported draft' USING ERRCODE='22023'; END IF;
  RETURN;
 END IF;
 SELECT * INTO context FROM private.co_import_post_requests WHERE actor_id=private.co_actor_v1() AND request_id=request;
 IF context.import_id IS NULL OR context.import_fingerprint<>encode(sha256(convert_to(E'co-import-post-v1\n'||private.co_manifest_canonical_v1(context.import_payload),'UTF8')),'hex') OR context.operation<>op OR context.ordinary_payload IS DISTINCT FROM p OR context.ordinary_fingerprint<>encode(sha256(convert_to(jsonb_build_object('operation',op,'payload',p)::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'Atomic import commit required' USING ERRCODE='55000'; END IF;
 fresh:=private.co_import_fresh_v1(context.import_id,context.import_payload->'binding'->>'importVersion',private.co_import_acknowledgements_v1(coalesce(context.import_payload->'acknowledgedReopenOrders','[]'::jsonb)));
 IF fresh->'binding' IS DISTINCT FROM context.import_payload->'binding' OR fresh->>'previewFingerprint' IS DISTINCT FROM context.import_payload->>'previewFingerprint' OR fresh->>'operation'<>op OR fresh->'payload' IS DISTINCT FROM p THEN RAISE EXCEPTION 'CO_PREVIEW_STALE' USING ERRCODE='PT409'; END IF;
END $$;
CREATE FUNCTION public.pilot_co_import_commit_v1(p_request_id uuid,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.co_actor_v1(); context private.co_import_post_requests%ROWTYPE; fresh jsonb; m private.co_import_manifests%ROWTYPE; op text; p jsonb; command private.co_commands%ROWTYPE;
BEGIN
 PERFORM private.co_input_object_v1(p_payload,ARRAY['binding','previewFingerprint','requestId','mode','reason'],ARRAY['binding','previewFingerprint','requestId','mode','reason','acknowledgedReopenOrders']);
 IF private.co_input_uuid_v1(p_payload->'requestId') IS DISTINCT FROM p_request_id THEN RAISE EXCEPTION 'Import request identity mismatch' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('co-command:'||actor::text||':'||p_request_id::text,0));
 SELECT * INTO context FROM private.co_import_post_requests WHERE actor_id=actor AND request_id=p_request_id;
 IF context.request_id IS NOT NULL THEN
  IF context.import_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'Import request payload mismatch' USING ERRCODE='22023'; END IF;
  RETURN public.pilot_co_transaction_v1(p_request_id,context.operation,context.ordinary_payload);
 END IF;
 PERFORM private.co_workspace_generation_guard_v1();
 SELECT * INTO command FROM private.co_commands WHERE actor_id=actor AND request_id=p_request_id;
 IF command.status='abandoned' THEN RAISE EXCEPTION 'CO request abandoned' USING ERRCODE='55000'; END IF;
 IF command.request_id IS NOT NULL THEN RAISE EXCEPTION 'Import request family mismatch' USING ERRCODE='22023'; END IF;
 SELECT * INTO m FROM private.co_import_manifests WHERE id=private.co_input_uuid_v1(p_payload->'binding'->'importId');
 IF m.id IS NULL THEN RAISE EXCEPTION 'Invalid import identity' USING ERRCODE='22023'; END IF;
 PERFORM private.co_lock_customer_v1(m.customer_id,m.customer_version);
 PERFORM id FROM private.co_orders WHERE customer_id=m.customer_id ORDER BY id FOR UPDATE;
 PERFORM id FROM private.co_delivery_heads WHERE customer_id=m.customer_id ORDER BY id FOR UPDATE;
 PERFORM id FROM private.co_return_heads WHERE customer_id=m.customer_id ORDER BY id FOR UPDATE;
 PERFORM id FROM private.co_report_heads WHERE customer_id=m.customer_id ORDER BY id FOR UPDATE;
 PERFORM id FROM private.co_drafts WHERE customer_id=m.customer_id ORDER BY id FOR UPDATE;
 fresh:=private.co_import_fresh_v1(m.id,p_payload->'binding'->>'importVersion',private.co_import_acknowledgements_v1(coalesce(p_payload->'acknowledgedReopenOrders','[]'::jsonb))); op:=fresh->>'operation';p:=fresh->'payload';
 IF fresh->'binding' IS DISTINCT FROM p_payload->'binding' OR fresh->>'previewFingerprint' IS DISTINCT FROM p_payload->>'previewFingerprint' OR p_payload->>'mode' IS DISTINCT FROM (CASE op WHEN 'post_report' THEN 'post' ELSE 'edit' END) OR p_payload->'reason' IS DISTINCT FROM m.canonical_json->'input'->'reason' THEN RAISE EXCEPTION 'CO_PREVIEW_STALE' USING ERRCODE='PT409'; END IF;
 INSERT INTO private.co_import_post_requests(actor_id,request_id,customer_id,import_id,import_payload,import_fingerprint,operation,ordinary_payload,ordinary_fingerprint)
 VALUES(actor,p_request_id,m.customer_id,m.id,p_payload,encode(sha256(convert_to(E'co-import-post-v1\n'||private.co_manifest_canonical_v1(p_payload),'UTF8')),'hex'),op,p,encode(sha256(convert_to(jsonb_build_object('operation',op,'payload',p)::text,'UTF8')),'hex'));
 -- The existing accounting executor owns the ONLY begin and commit, and the UUID.
 RETURN public.pilot_co_transaction_v1(p_request_id,op,p);
END $$;
CREATE FUNCTION public.pilot_co_import_reconcile_v1(p_request_id uuid,p_abandon boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.co_actor_v1(); command private.co_commands%ROWTYPE; context private.co_import_post_requests%ROWTYPE;
BEGIN
 IF p_request_id IS NULL OR p_abandon IS NULL THEN RAISE EXCEPTION 'Invalid import recovery' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('co-command:'||actor::text||':'||p_request_id::text,0));
 SELECT * INTO command FROM private.co_commands WHERE actor_id=actor AND request_id=p_request_id FOR UPDATE;
 SELECT * INTO context FROM private.co_import_post_requests WHERE actor_id=actor AND request_id=p_request_id;
 IF command.operation IS NOT NULL AND (context.request_id IS NULL OR command.operation<>context.operation) THEN RAISE EXCEPTION 'Import request family mismatch' USING ERRCODE='22023'; END IF;
 IF command.status='committed' THEN RETURN jsonb_build_object('status','committed','operation',command.operation,'receipt',command.receipt); END IF;
 IF command.status='abandoned' THEN RETURN jsonb_build_object('status','abandoned'); END IF;
 IF command.status='pending' THEN RETURN jsonb_build_object('status','unknown'); END IF;
 IF p_abandon THEN INSERT INTO private.co_commands(actor_id,request_id,status) VALUES(actor,p_request_id,'abandoned'); RETURN jsonb_build_object('status','abandoned'); END IF;
 RETURN jsonb_build_object('status','unknown');
END $$;

CREATE FUNCTION private.co_import_review_result_v1(s private.co_import_selections) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('version','1','selectionId',s.id,'state',s.state,'draftId',s.draft_id,'draftVersion',s.after_draft->>'version','customerVersion',s.customer_version::text);
$$;
CREATE FUNCTION public.pilot_co_import_review_v1(p_request_id uuid,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.co_actor_v1(); receipt jsonb; d private.co_drafts%ROWTYPE; s private.co_import_selections%ROWTYPE; next_selection private.co_import_selections%ROWTYPE; h private.co_report_heads%ROWTYPE; cv bigint; ctx jsonb; before_image jsonb; after_image jsonb; next_payload jsonb; action text;
BEGIN
 PERFORM private.co_input_object_v1(p_payload,ARRAY['draft_id','expected_draft_version','expected_customer_version','expected_selection_id','original_revision_id','expected_report_version','action','reason'],ARRAY['draft_id','expected_draft_version','expected_customer_version','expected_selection_id','original_revision_id','expected_report_version','action','reason']);
 action:=private.co_input_text_v1(p_payload->'action');
 IF action NOT IN('open','abandon') OR nullif(private.co_import_trim_v1(private.co_input_text_v1(p_payload->'reason')),'') IS NULL THEN RAISE EXCEPTION 'Explicit review action and reason required' USING ERRCODE='22023'; END IF;
 receipt:=private.co_workspace_command_begin_v1(p_request_id,'review_import',p_payload);
 IF receipt IS NOT NULL THEN
  SELECT * INTO next_selection FROM private.co_import_selections WHERE id=(receipt->>'id')::uuid AND actor_id=actor AND request_id=p_request_id;
  IF next_selection.id IS NULL THEN RAISE EXCEPTION 'Missing review result' USING ERRCODE='55000'; END IF;
  RETURN private.co_import_review_result_v1(next_selection);
 END IF;
 PERFORM private.co_workspace_generation_guard_v1();
 SELECT * INTO d FROM private.co_drafts WHERE id=private.co_input_uuid_v1(p_payload->'draft_id') AND kind='report';
 cv:=private.co_lock_customer_v1(d.customer_id,private.co_input_version_v1(p_payload->'expected_customer_version'));
 PERFORM id FROM private.co_orders WHERE customer_id=d.customer_id ORDER BY id FOR UPDATE;
 PERFORM id FROM private.co_delivery_heads WHERE customer_id=d.customer_id ORDER BY id FOR UPDATE;
 PERFORM id FROM private.co_return_heads WHERE customer_id=d.customer_id ORDER BY id FOR UPDATE;
 PERFORM id FROM private.co_report_heads WHERE customer_id=d.customer_id ORDER BY id FOR UPDATE;
 SELECT * INTO d FROM private.co_drafts WHERE id=d.id FOR UPDATE;
 s:=private.co_import_selection_v1(d.id);
 SELECT * INTO h FROM private.co_report_heads WHERE customer_id=d.customer_id AND report_month=d.report_month;
 IF s.id IS DISTINCT FROM private.co_input_uuid_v1(p_payload->'expected_selection_id') OR d.version<>private.co_input_version_v1(p_payload->'expected_draft_version') OR to_jsonb(h.current_revision_id) IS DISTINCT FROM nullif(p_payload->'original_revision_id','null'::jsonb) OR to_jsonb(h.version::text) IS DISTINCT FROM nullif(p_payload->'expected_report_version','null'::jsonb) THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 IF action='abandon' AND s.state<>'review_open' THEN RAISE EXCEPTION 'Only an open review can be abandoned' USING ERRCODE='55000'; END IF;
 before_image:=to_jsonb(d);after_image:=before_image;
 IF action='open' THEN
  ctx:=private.co_base_report_context_v1(d.customer_id,d.report_month,d.id,NULL);
  next_payload:=(d.payload-ARRAY['posted_report_head_id','posted_report_revision_id','source_context'])||(ctx-ARRAY['eligible_rows','eligible_set_fingerprint'])||jsonb_build_object('bound_customer_version',cv::text);
  after_image:=before_image||jsonb_build_object('version',d.version+1,'evidence_id',NULL,'payload',next_payload,'eligible_set_fingerprint',ctx->>'eligible_set_fingerprint');
 END IF;
 INSERT INTO private.co_import_selections(draft_id,customer_id,customer_version,predecessor_id,state,actor_id,request_id,reason,before_draft,after_draft)
 VALUES(d.id,d.customer_id,cv,s.id,CASE action WHEN 'open' THEN 'review_open' ELSE 'abandoned' END,actor,p_request_id,p_payload->>'reason',before_image,after_image) RETURNING * INTO next_selection;
 IF action='open' THEN UPDATE private.co_drafts SET version=version+1,evidence_id=NULL,payload=next_payload,eligible_set_fingerprint=ctx->>'eligible_set_fingerprint' WHERE id=d.id; END IF;
 INSERT INTO private.co_audit_events(customer_id,actor_id,request_id,operation,reason,before_state,after_state)
 VALUES(d.customer_id,actor,p_request_id,'review_import',p_payload->>'reason',before_image,after_image||jsonb_build_object('selectionId',next_selection.id));
 PERFORM private.co_command_commit_v1(p_request_id,jsonb_build_object('id',next_selection.id,'operation','review_import','version','1','customer_id',d.customer_id,'customer_version',cv::text));
 RETURN private.co_import_review_result_v1(next_selection);
END $$;
CREATE FUNCTION public.pilot_co_import_review_reconcile_v1(p_request_id uuid,p_abandon boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.co_actor_v1(); command private.co_commands%ROWTYPE; selection private.co_import_selections%ROWTYPE;
BEGIN
 IF p_request_id IS NULL OR p_abandon IS NULL THEN RAISE EXCEPTION 'Invalid review recovery' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('co-command:'||actor::text||':'||p_request_id::text,0));
 SELECT * INTO command FROM private.co_commands WHERE actor_id=actor AND request_id=p_request_id FOR UPDATE;
 IF command.operation IS NOT NULL AND command.operation<>'review_import' THEN RAISE EXCEPTION 'Import request family mismatch' USING ERRCODE='22023'; END IF;
 IF command.status='committed' THEN
  SELECT * INTO selection FROM private.co_import_selections WHERE id=(command.receipt->>'id')::uuid AND actor_id=actor AND request_id=p_request_id;
  IF selection.id IS NULL THEN RAISE EXCEPTION 'Missing review result' USING ERRCODE='55000'; END IF;
  RETURN jsonb_build_object('status','committed','operation','review_import','review',private.co_import_review_result_v1(selection));
 END IF;
 IF command.status='abandoned' THEN RETURN jsonb_build_object('status','abandoned'); END IF;
 IF command.status='pending' THEN RETURN jsonb_build_object('status','unknown'); END IF;
 IF p_abandon THEN INSERT INTO private.co_commands(actor_id,request_id,status) VALUES(actor,p_request_id,'abandoned'); RETURN jsonb_build_object('status','abandoned'); END IF;
 RETURN jsonb_build_object('status','unknown');
END $$;
-- Historical bindings stay unchanged. This read exposes current selection separately.
CREATE FUNCTION public.pilot_co_import_selection_v1(p_draft_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d private.co_drafts%ROWTYPE; s private.co_import_selections%ROWTYPE; h private.co_report_heads%ROWTYPE; cv bigint;
BEGIN
 PERFORM private.co_actor_v1(); SELECT * INTO d FROM private.co_drafts WHERE id=p_draft_id AND kind='report';
 IF d.id IS NULL THEN RAISE EXCEPTION 'Invalid report draft' USING ERRCODE='22023'; END IF;
 PERFORM private.co_read_customer_v1(d.customer_id);
 SELECT version INTO cv FROM private.co_customer_state WHERE customer_id=d.customer_id FOR SHARE;
 SELECT * INTO d FROM private.co_drafts WHERE id=p_draft_id;
 s:=private.co_import_selection_v1(d.id);
 SELECT * INTO h FROM private.co_report_heads WHERE customer_id=d.customer_id AND report_month=d.report_month;
 RETURN jsonb_build_object('version','1','selectionId',s.id,'state',s.state,'importId',s.import_id,'draftId',d.id,'draftVersion',d.version::text,'customerVersion',cv::text,'reportHeadId',h.id,'originalRevisionId',h.current_revision_id,'reportVersion',h.version::text);
END $$;

-- The publication postcondition checks newly linked immutable revision, pending
-- exact ordinary command, unchanged draft metadata/quantities and head identity.
CREATE FUNCTION private.co_import_postcondition_v1(old_d private.co_drafts,new_d private.co_drafts) RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $$
DECLARE s private.co_import_selections%ROWTYPE; m private.co_import_manifests%ROWTYPE; x private.co_import_post_requests%ROWTYPE; cmd private.co_commands%ROWTYPE;
BEGIN
 s:=private.co_import_selection_v1(old_d.id);
 SELECT * INTO m FROM private.co_import_manifests WHERE id=s.import_id;
 SELECT r.* INTO x FROM private.co_import_post_requests r JOIN private.co_commands q ON q.actor_id=r.actor_id AND q.request_id=r.request_id AND q.status='pending' WHERE r.actor_id=auth.uid() AND r.import_id=m.id;
 SELECT * INTO cmd FROM private.co_commands WHERE actor_id=x.actor_id AND request_id=x.request_id;
 IF x.request_id IS NULL OR cmd.operation<>x.operation OR cmd.payload_fingerprint<>encode(sha256(convert_to(x.ordinary_payload::text,'UTF8')),'hex') OR old_d.version<>m.draft_version OR new_d.version<>old_d.version+1 THEN RETURN false; END IF;
 IF to_jsonb(new_d)-ARRAY['version','payload'] IS DISTINCT FROM to_jsonb(old_d)-ARRAY['version','payload'] OR new_d.payload-ARRAY['posted_report_head_id','posted_report_revision_id'] IS DISTINCT FROM old_d.payload THEN RETURN false; END IF;
 RETURN EXISTS(SELECT 1 FROM private.co_report_imports l JOIN private.co_report_heads h ON h.id=l.report_head_id AND h.customer_id=l.customer_id AND h.current_revision_id=l.report_revision_id WHERE l.import_id=m.id AND l.customer_id=old_d.customer_id AND h.report_month=old_d.report_month AND l.report_revision_id=(new_d.payload->>'posted_report_revision_id')::uuid AND l.report_head_id=(new_d.payload->>'posted_report_head_id')::uuid)
 AND (SELECT coalesce(jsonb_object_agg(stock_key_id::text,sold_quantity::text),'{}') FROM private.co_report_draft_lines WHERE draft_id=old_d.id)=m.validation->'quantities';
END $$;
CREATE OR REPLACE FUNCTION private.co_import_draft_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE did uuid; s private.co_import_selections%ROWTYPE; m private.co_import_manifests%ROWTYPE; cmd private.co_commands%ROWTYPE; p jsonb; d private.co_drafts%ROWTYPE; e private.co_evidence%ROWTYPE; a private.co_evidence_verifications%ROWTYPE; ctx jsonb; expected jsonb;
BEGIN
 IF TG_TABLE_NAME='co_drafts' THEN did:=OLD.id; ELSIF TG_OP='INSERT' THEN did:=NEW.draft_id; ELSE did:=OLD.draft_id; END IF;
 IF TG_TABLE_NAME='co_report_draft_lines' THEN
  IF TG_OP='UPDATE' THEN
   IF NEW.draft_id<>OLD.draft_id AND EXISTS(SELECT 1 FROM private.co_draft_import_origins WHERE draft_id=NEW.draft_id) THEN RAISE EXCEPTION 'Imported line identity immutable' USING ERRCODE='55000'; END IF;
  END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM private.co_draft_import_origins WHERE draft_id=did) THEN IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW; END IF;
 s:=private.co_import_selection_v1(did);
 SELECT * INTO cmd FROM private.co_commands WHERE actor_id=s.actor_id AND request_id=s.request_id;
 SELECT * INTO d FROM private.co_drafts WHERE id=did;
 IF s.actor_id=private.co_actor_v1() AND cmd.status='pending' THEN
  IF s.state='selected' AND cmd.operation='prepare_import' THEN
   SELECT * INTO m FROM private.co_import_manifests WHERE id=s.import_id AND created_by=s.actor_id AND request_id=s.request_id;
   p:=jsonb_build_object('manifest',m.canonical_json,'expected_customer_version',m.customer_version::text,'expected_draft_version',s.before_draft->>'version','expected_evidence_version','2');
   IF s.predecessor_id IS NOT NULL THEN p:=p||jsonb_build_object('expected_selection_id',s.predecessor_id); END IF;
   -- Prepare freshly validated the complete set under customer/entity locks.
   -- Check exact relational postconditions, not eligibility of a transient half-replaced set.
   IF cmd.payload_fingerprint=encode(sha256(convert_to(p::text,'UTF8')),'hex') AND m.digest=private.co_manifest_digest_v1(m.canonical_json) AND m.customer_version=(SELECT version FROM private.co_customer_state WHERE customer_id=d.customer_id) AND m.draft_version=d.version+1 AND d.evidence_id=m.evidence_id AND d.version=(s.before_draft->>'version')::bigint THEN
    IF TG_TABLE_NAME='co_drafts' THEN
     IF TG_OP='UPDATE' AND to_jsonb(OLD)=s.before_draft AND to_jsonb(NEW)=s.after_draft AND to_jsonb(NEW)-'version'=to_jsonb(OLD)-'version' AND NEW.version=OLD.version+1 THEN RETURN NEW; END IF;
    END IF;
    IF TG_TABLE_NAME='co_report_draft_lines' THEN
     IF TG_OP='DELETE' THEN RETURN OLD; END IF;
     IF TG_OP='INSERT' AND NEW.customer_id=m.customer_id AND NEW.kind='report' AND NEW.sold_quantity::text=m.validation->'quantities'->>NEW.stock_key_id::text THEN RETURN NEW; END IF;
    END IF;
   END IF;
  ELSIF s.state='review_open' AND cmd.operation='review_import' AND TG_TABLE_NAME='co_drafts' AND TG_OP='UPDATE' THEN
   ctx:=private.co_base_report_context_v1(d.customer_id,d.report_month,d.id,NULL);
   expected:=(OLD.payload-ARRAY['posted_report_head_id','posted_report_revision_id','source_context'])||(ctx-ARRAY['eligible_rows','eligible_set_fingerprint'])||jsonb_build_object('bound_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=d.customer_id));
   IF to_jsonb(OLD)=s.before_draft AND to_jsonb(NEW)=s.after_draft AND to_jsonb(NEW)-ARRAY['version','evidence_id','payload','eligible_set_fingerprint']=to_jsonb(OLD)-ARRAY['version','evidence_id','payload','eligible_set_fingerprint'] AND NEW.version=OLD.version+1 AND NEW.evidence_id IS NULL AND NEW.payload=expected AND NEW.eligible_set_fingerprint=ctx->>'eligible_set_fingerprint' THEN RETURN NEW; END IF;
  END IF;
 END IF;
 IF TG_TABLE_NAME='co_drafts' AND TG_OP='UPDATE' THEN
  IF s.state='selected' AND private.co_import_postcondition_v1(OLD,NEW) THEN RETURN NEW; END IF;
  IF s.state='review_open' AND NEW.evidence_id IS NOT NULL AND NEW.version=OLD.version+1 AND to_jsonb(NEW)-ARRAY['evidence_id','version']=to_jsonb(OLD)-ARRAY['evidence_id','version'] THEN
   SELECT * INTO e FROM private.co_evidence WHERE id=NEW.evidence_id AND draft_id=OLD.id AND customer_id=OLD.customer_id AND version=1 AND draft_version=OLD.version AND created_by=auth.uid();
   SELECT * INTO a FROM private.co_evidence_verifications WHERE evidence_id=e.id;
   p:=jsonb_build_object('evidence_id',e.id,'expected_evidence_version','1','expected_draft_version',OLD.version::text,'expected_customer_version',e.customer_version::text);
   IF e.id IS NOT NULL AND a.evidence_id IS NOT NULL AND EXISTS(SELECT 1 FROM private.co_commands WHERE actor_id=auth.uid() AND status='pending' AND operation='finalize_evidence' AND payload_fingerprint=encode(sha256(convert_to(p::text,'UTF8')),'hex')) THEN
    PERFORM private.co_evidence_draft_v1(OLD,OLD.version,e.customer_version);
    PERFORM private.co_evidence_object_v1(e,a.object_id,a.object_version,a.byte_size,a.mime_type,a.sha256);
    RETURN NEW;
   END IF;
  END IF;
 END IF;
 RAISE EXCEPTION 'Atomic import commit or supersession required' USING ERRCODE='55000';
END $$;
CREATE OR REPLACE FUNCTION private.co_link_import_v1(c uuid,head uuid,revision uuid,did uuid,dv bigint,original uuid) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE chosen uuid; s private.co_import_selections%ROWTYPE; x private.co_import_post_requests%ROWTYPE;
BEGIN
 IF did IS NOT NULL AND EXISTS(SELECT 1 FROM private.co_draft_import_origins WHERE draft_id=did) THEN
  PERFORM private.co_workspace_generation_guard_v1();
  s:=private.co_import_selection_v1(did);
  SELECT r.* INTO x FROM private.co_import_post_requests r JOIN private.co_commands q ON q.actor_id=r.actor_id AND q.request_id=r.request_id AND q.status='pending' WHERE r.actor_id=auth.uid() AND r.import_id=s.import_id;
  IF x.request_id IS NULL OR NOT EXISTS(SELECT 1 FROM private.co_import_manifests m JOIN private.co_drafts d ON d.id=m.draft_id AND d.customer_id=m.customer_id JOIN private.co_report_heads h ON h.customer_id=m.customer_id AND h.report_month=m.report_month WHERE m.id=s.import_id AND s.state='selected' AND m.customer_id=c AND m.draft_id=did AND m.draft_version=dv AND d.version=dv AND h.id=head) THEN RAISE EXCEPTION 'Atomic import commit required' USING ERRCODE='55000'; END IF;
  -- Fresh validation already ran under customer/entity locks before publication.
  -- The link verifies precise relational identity while head publication is pending.
  INSERT INTO private.co_report_imports(report_revision_id,report_head_id,customer_id,import_id) VALUES(revision,head,c,s.import_id);
 ELSIF did IS NULL AND original IS NOT NULL THEN
  SELECT import_id INTO chosen FROM private.co_report_imports WHERE report_revision_id=original AND report_head_id=head AND customer_id=c;
  IF chosen IS NOT NULL THEN PERFORM private.co_workspace_generation_guard_v1(); INSERT INTO private.co_report_imports(report_revision_id,report_head_id,customer_id,import_id) VALUES(revision,head,c,chosen); END IF;
 END IF;
END $$;

-- Exact source anchors fail closed on baseline drift; no historical SQL edits.
DO $import_publication_guards$
DECLARE item record; definition text;
BEGIN
 FOR item IN SELECT * FROM (VALUES
 ('private.co_monthly_transaction_v1(uuid,text,jsonb)', '   plan:=private.co_build_plan_v1(c,''post_report'',p_payload-''preview_fingerprint'');', '   PERFORM private.co_import_publication_guard_v1(p_request_id,p_operation,p_payload);'),
 (CASE WHEN to_regclass('private.catalog_cutover_v1') IS NULL THEN 'public.pilot_co_transaction_v1(uuid,text,jsonb)' ELSE 'private.catalog_co_legacy_transaction_v1(uuid,text,jsonb)' END, '  plan:=private.co_build_plan_v1(c,p_operation,p_payload-''preview_fingerprint'');', '  PERFORM private.co_import_publication_guard_v1(p_request_id,p_operation,p_payload);')
 ) AS x(signature,anchor,insertion) LOOP
  SELECT pg_get_functiondef(item.signature::regprocedure) INTO definition;
  IF (length(definition)-length(replace(definition,item.anchor,'')))/length(item.anchor)<>1 THEN RAISE EXCEPTION 'Import publication guard anchor drift'; END IF;
  EXECUTE replace(definition,item.anchor,item.insertion||E'\n'||item.anchor);
 END LOOP;
END $import_publication_guards$;
DO $import_recovery_family$
DECLARE definition text; anchor text:='IF command.status=''committed'' THEN';
BEGIN
 SELECT pg_get_functiondef('private.co_evidence_reconcile_v1(uuid,boolean,boolean)'::regprocedure) INTO definition;
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Import recovery family anchor drift'; END IF;
 EXECUTE replace(definition,anchor,'IF EXISTS(SELECT 1 FROM private.co_import_post_requests WHERE actor_id=actor AND request_id=p_request_id) THEN RAISE EXCEPTION ''Import request family mismatch'' USING ERRCODE=''22023''; END IF; '||anchor);
END $import_recovery_family$;
REVOKE ALL ON FUNCTION private.co_import_selection_v1(uuid),private.co_import_return_pins_v1(jsonb,uuid),private.co_import_save_coverage_v1(private.co_import_manifests),private.co_import_fresh_v1(uuid,text,jsonb),private.co_import_publication_guard_v1(uuid,text,jsonb),private.co_import_review_result_v1(private.co_import_selections),private.co_import_postcondition_v1(private.co_drafts,private.co_drafts) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pilot_co_import_preview_v1(uuid,text,jsonb),public.pilot_co_import_commit_v1(uuid,jsonb),public.pilot_co_import_reconcile_v1(uuid,boolean),public.pilot_co_import_review_v1(uuid,jsonb),public.pilot_co_import_review_reconcile_v1(uuid,boolean),public.pilot_co_import_selection_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pilot_co_import_preview_v1(uuid,text,jsonb),public.pilot_co_import_commit_v1(uuid,jsonb),public.pilot_co_import_reconcile_v1(uuid,boolean),public.pilot_co_import_review_v1(uuid,jsonb),public.pilot_co_import_review_reconcile_v1(uuid,boolean),public.pilot_co_import_selection_v1(uuid) TO authenticated;
-- Task7 prerequisite: complete current eligibility, including keys absent from old
-- draft lines after review-open. Read-only; existing accounting guards stay intact.
CREATE FUNCTION public.pilot_co_import_eligible_v1(p_draft_id uuid,p_expected_draft_version text,p_expected_customer_version text,p_expected_selection_id uuid,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d private.co_drafts%ROWTYPE; selected private.co_import_selections%ROWTYPE; cv text; context jsonb; rows jsonb;
BEGIN
 PERFORM private.co_actor_v1();
 IF p_draft_id IS NULL OR p_expected_draft_version IS NULL OR p_expected_customer_version IS NULL OR p_page IS NULL OR p_page<1 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid import eligible read' USING ERRCODE='22023'; END IF;
 PERFORM private.co_input_version_v1(to_jsonb(p_expected_draft_version));
 SELECT * INTO d FROM private.co_drafts WHERE id=p_draft_id AND kind='report';
 IF d.id IS NULL THEN RAISE EXCEPTION 'Invalid report draft' USING ERRCODE='22023'; END IF;
 cv:=private.co_read_lock_v1(d.customer_id,p_expected_customer_version);
 SELECT * INTO d FROM private.co_drafts WHERE id=p_draft_id AND kind='report' FOR SHARE;
 selected:=private.co_import_selection_v1(d.id);
 IF d.version::text IS DISTINCT FROM p_expected_draft_version OR selected.id IS DISTINCT FROM p_expected_selection_id OR d.payload->>'bound_customer_version' IS DISTINCT FROM cv OR d.payload?'posted_report_head_id' THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 context:=private.co_report_context_v1(d.customer_id,d.report_month,d.id);
 IF context->>'eligible_set_fingerprint' IS DISTINCT FROM d.eligible_set_fingerprint OR context->'bound_report_revision_id' IS DISTINCT FROM d.payload->'bound_report_revision_id' THEN RAISE EXCEPTION 'CO_ELIGIBLE_SET_STALE' USING ERRCODE='PT409'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',k.id,'stock_key_id',k.id,'customer_id',d.customer_id,'report_month',d.report_month,'display_sku',k.display_sku,'product_name',k.product_name,'product_id',k.product_id,'sold_quantity',l.sold_quantity::text,'eligible_quantity',e.value->>'eligible_quantity','revision_line_id',NULL) ORDER BY k.id),'[]'::jsonb) INTO rows
 FROM jsonb_array_elements(context->'eligible_rows') AS e(value)
 JOIN private.co_stock_keys k ON k.id=(e.value->>'stock_key_id')::uuid AND k.customer_id=d.customer_id
 LEFT JOIN private.co_report_draft_lines l ON l.draft_id=d.id AND l.stock_key_id=k.id AND l.customer_id=d.customer_id;
 RETURN private.co_read_page_v1(rows,p_page,p_page_size,jsonb_build_object('customer_id',d.customer_id,'customer_version',cv,'report_month',d.report_month,'view','draft','generation_id',(SELECT effective_generation_id FROM private.co_customer_state WHERE customer_id=d.customer_id),'source_context_link',private.co_read_context_link_v1(d.payload),'draft_id',d.id,'draft_version',d.version::text,'revision_id',NULL,'eligible_set_fingerprint',context->>'eligible_set_fingerprint','source_context_fingerprint',d.payload->'source_context'->>'source_context_fingerprint','context_issue',NULL,'selection_id',selected.id));
END $$;
REVOKE ALL ON FUNCTION public.pilot_co_import_eligible_v1(uuid,text,text,uuid,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pilot_co_import_eligible_v1(uuid,text,text,uuid,integer,integer) TO authenticated;
-- Read-only candidates: factual current matching-SKU quantity, never global citation consumption.
CREATE FUNCTION public.pilot_co_import_return_candidates_v1(p_customer_id uuid,p_stock_key_id uuid,p_expected_customer_version text,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cv text; rows jsonb; total bigint;
BEGIN
 PERFORM private.co_actor_v1();
 IF p_customer_id IS NULL OR p_stock_key_id IS NULL OR p_expected_customer_version IS NULL OR p_page IS NULL OR p_page<1 OR p_page_size IS DISTINCT FROM 25 THEN RAISE EXCEPTION 'Invalid return candidate read' USING ERRCODE='22023'; END IF;
 cv:=private.co_read_lock_v1(p_customer_id,p_expected_customer_version);
 IF NOT EXISTS(SELECT 1 FROM private.co_stock_keys WHERE id=p_stock_key_id AND customer_id=p_customer_id) THEN RAISE EXCEPTION 'Invalid customer stock key' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO total FROM private.co_return_heads h JOIN private.co_return_revisions r ON r.id=h.current_revision_id AND r.head_id=h.id AND r.customer_id=h.customer_id
 WHERE h.customer_id=p_customer_id AND NOT r.is_void AND EXISTS(SELECT 1 FROM private.co_return_revision_lines l WHERE l.revision_id=r.id AND l.customer_id=p_customer_id AND l.stock_key_id=p_stock_key_id);
 IF total>10000 THEN RAISE EXCEPTION 'Return candidate limit' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(value ORDER BY return_date DESC,head_id),'[]'::jsonb) INTO rows FROM (
 SELECT r.return_date,h.id head_id,jsonb_build_object('headId',h.id,'revisionId',r.id,'version',h.version::text,'date',r.return_date,'reference',r.reference,'displaySku',k.display_sku,'productName',k.product_name,'quantity',(SELECT sum(l.quantity)::text FROM private.co_return_revision_lines l WHERE l.revision_id=r.id AND l.customer_id=p_customer_id AND l.stock_key_id=p_stock_key_id),'unit',u.unit) value
 FROM private.co_return_heads h JOIN private.co_return_revisions r ON r.id=h.current_revision_id AND r.head_id=h.id AND r.customer_id=h.customer_id
 JOIN private.co_stock_keys k ON k.id=p_stock_key_id AND k.customer_id=p_customer_id
 LEFT JOIN private.co_stock_key_unit_declarations u ON u.stock_key_id=k.id AND u.customer_id=k.customer_id
 WHERE h.customer_id=p_customer_id AND NOT r.is_void AND EXISTS(SELECT 1 FROM private.co_return_revision_lines l WHERE l.revision_id=r.id AND l.customer_id=p_customer_id AND l.stock_key_id=p_stock_key_id)
 ORDER BY r.return_date DESC,h.id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size) candidates;
 RETURN jsonb_build_object('customerId',p_customer_id,'stockKeyId',p_stock_key_id,'customerVersion',cv,'page',p_page,'pageSize',p_page_size,'total',total::text,'rows',rows);
END $$;
REVOKE ALL ON FUNCTION public.pilot_co_import_return_candidates_v1(uuid,uuid,text,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pilot_co_import_return_candidates_v1(uuid,uuid,text,integer,integer) TO authenticated;
-- A1: explicit ledger-only reseed. Runs inside the existing command family,
-- after customer/draft locks and exact expected versions; never an import bypass.
CREATE FUNCTION private.co_legacy_seed_metadata_v1(c uuid,m date,d private.co_drafts,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE h private.co_report_heads%ROWTYPE; r private.co_report_revisions%ROWTYPE; seed uuid;
BEGIN
 seed:=private.co_input_uuid_v1(p->'seed_effective_revision_id');
 IF p?'source_context' OR p ?| ARRAY['report_reference','received_date','notes'] THEN
  RAISE EXCEPTION 'Ledger seed requires effective metadata without source context' USING ERRCODE='22023';
 END IF;
 IF d.id IS NOT NULL AND (d.payload?'source_context' OR EXISTS(SELECT 1 FROM private.co_draft_import_origins WHERE draft_id=d.id)) THEN
  RAISE EXCEPTION 'Source-owned or imported draft cannot use ledger seed' USING ERRCODE='55000';
 END IF;
 SELECT * INTO h FROM private.co_report_heads WHERE customer_id=c AND report_month=m FOR UPDATE;
 IF h.id IS NULL OR h.current_revision_id IS DISTINCT FROM seed THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 SELECT * INTO r FROM private.co_report_revisions WHERE id=seed AND head_id=h.id AND customer_id=c FOR SHARE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 IF EXISTS(SELECT 1 FROM private.co_report_imports WHERE report_revision_id=seed) THEN
  RAISE EXCEPTION 'Imported effective report cannot use ledger seed' USING ERRCODE='55000';
 END IF;
 RETURN jsonb_build_object('report_reference',r.report_reference,'received_date',r.received_date,'notes',r.notes);
END $$;
REVOKE ALL ON FUNCTION private.co_legacy_seed_metadata_v1(uuid,date,private.co_drafts,jsonb) FROM PUBLIC,anon,authenticated,service_role;
DO $legacy_effective_seed$
DECLARE definition text; item record;
BEGIN
 SELECT pg_get_functiondef('private.co_monthly_transaction_v1(uuid,text,jsonb)'::regprocedure) INTO definition;
 FOR item IN SELECT * FROM (VALUES
  ($anchor$ARRAY['action','customer_id','report_month','expected_customer_version','draft_id','expected_draft_version','report_reference','received_date','notes','source_context']$anchor$,
   $replacement$ARRAY['action','customer_id','report_month','expected_customer_version','draft_id','expected_draft_version','report_reference','received_date','notes','source_context','seed_effective_revision_id']$replacement$),
  ($anchor$  new_image:=coalesce(d.payload,'{}')-ARRAY['posted_report_head_id','posted_report_revision_id','source_context'];$anchor$,
   $replacement$  new_image:=coalesce(d.payload,'{}')-ARRAY['posted_report_head_id','posted_report_revision_id','source_context'];
  IF p_payload?'seed_effective_revision_id' THEN new_image:=new_image||private.co_legacy_seed_metadata_v1(c,m,d,p_payload); END IF;$replacement$),
  ($anchor$  INSERT INTO private.co_report_draft_lines(draft_id,customer_id,stock_key_id) SELECT d.id,c,(value->>'stock_key_id')::uuid FROM jsonb_array_elements(context->'eligible_rows') ON CONFLICT(draft_id,stock_key_id) DO NOTHING;$anchor$,
   $replacement$  IF p_payload?'seed_effective_revision_id' THEN
   -- Keep all historical records. Every non-effective key is unanswered, never zero.
   UPDATE private.co_report_draft_lines SET sold_quantity=NULL WHERE draft_id=d.id AND customer_id=c;
   INSERT INTO private.co_report_draft_lines(draft_id,customer_id,stock_key_id,sold_quantity)
   SELECT d.id,c,l.stock_key_id,l.sold_quantity FROM private.co_report_revision_lines l WHERE l.revision_id=(p_payload->>'seed_effective_revision_id')::uuid AND l.customer_id=c
   ON CONFLICT(draft_id,stock_key_id) DO UPDATE SET sold_quantity=EXCLUDED.sold_quantity;
   -- Do not relabel an unrelated pending attachment as historical source evidence.
   UPDATE private.co_drafts SET evidence_id=NULL WHERE id=d.id RETURNING * INTO d;
  END IF;
  INSERT INTO private.co_report_draft_lines(draft_id,customer_id,stock_key_id) SELECT d.id,c,(value->>'stock_key_id')::uuid FROM jsonb_array_elements(context->'eligible_rows') ON CONFLICT(draft_id,stock_key_id) DO NOTHING;$replacement$)
 ) AS x(anchor,replacement) LOOP
  IF (length(definition)-length(replace(definition,item.anchor,'')))/length(item.anchor)<>1 THEN RAISE EXCEPTION 'Legacy effective seed anchor drift'; END IF;
  definition:=replace(definition,item.anchor,item.replacement);
 END LOOP;
 EXECUTE definition;
END $legacy_effective_seed$;
COMMIT;
