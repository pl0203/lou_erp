-- Fictional fixtures, source-derived. Run before and after installation in an
-- explicitly authorized identity-bound synthetic fixture. No server startup here.
DO $preflight$ BEGIN
 IF current_user <> 'postgres' OR to_regclass('private.co_commands') IS NULL THEN
  RAISE EXCEPTION 'CATALOGUE_CO_COMMAND_FIXTURE_INVALID' USING ERRCODE='PCE00';
 END IF;
END $preflight$;
\echo CATALOGUE_CO_COMMAND_FIXTURE_READY
DO $missing$ BEGIN
 IF to_regprocedure('private.catalog_extract_co_command_event_v1(regclass,text,jsonb,jsonb)') IS NULL THEN
  RAISE EXCEPTION 'CATALOGUE_CO_COMMAND_MISSING_FUNCTION' USING ERRCODE='PCE01';
 END IF;
END $missing$;
CREATE FUNCTION pg_temp.cc_equal(actual jsonb, expected jsonb, label text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION '%: actual %, expected %',label,actual,expected; END IF;
END $$;
CREATE FUNCTION pg_temp.cc_row(operation text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('actor_id',md5('fictional-actor')::uuid,'request_id',md5('fictional-request')::uuid,
  'operation',operation,'payload_fingerprint',repeat('a',64),'status','committed','created_at','2026-01-02T03:04:05+00:00',
  'receipt',jsonb_build_object('id',md5('fictional-target')::uuid,'customer_id',md5('fictional-customer')::uuid,
  'operation',operation,'version','9007199254740993','customer_version','9223372036854775807'));
$$;
CREATE FUNCTION pg_temp.cc_expected(operation text, kind text, side text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('ok',true,'extraction',jsonb_build_object(
  'refs',jsonb_build_array(jsonb_build_object('kind','customer','id',md5('fictional-customer')::uuid)),
  'edges',jsonb_build_array(jsonb_build_object('kind',kind,'id',md5('fictional-target')::uuid,
    'customerId',md5('fictional-customer')::uuid,'origin',side||'.receipt.id',
    'expect',CASE operation WHEN 'save_sj_draft' THEN '{"draftKind":"sj"}'::jsonb WHEN 'save_report_draft' THEN '{"draftKind":"report"}'::jsonb WHEN 'save_return_draft' THEN '{"draftKind":"return"}'::jsonb ELSE '{}'::jsonb END)),
  'historicalNulls','[]'::jsonb,'origins',jsonb_build_array(jsonb_build_object('ref',jsonb_build_object('kind','customer','id',md5('fictional-customer')::uuid),'rowSide',side,'path',side||'.receipt.customer_id'))));
$$;
DO $tests$
DECLARE op text; kind text; r jsonb; actual jsonb; expected jsonb; old_expected jsonb; empty_result jsonb;
 k text; v jsonb; role_name text;
BEGIN
 empty_result := '{"ok":true,"extraction":{"refs":[],"edges":[],"historicalNulls":[],"origins":[]}}';
 FOR op,kind IN SELECT * FROM (VALUES
 ('create_co','co_order'),('edit_co','co_order'),('cancel_co','co_order'),('resolve_undelivered','co_order'),('close_co','co_order'),
 ('save_sj_draft','co_draft'),('save_report_draft','co_draft'),('save_return_draft','co_draft'),
 ('post_sj','co_delivery_head'),('correct_sj','co_delivery_head'),('post_report','co_report_head'),('correct_report','co_report_head'),
 ('post_return','co_return_head'),('correct_return','co_return_head'),('register_evidence','co_evidence'),('finalize_evidence','co_evidence')) AS targets(op,kind) LOOP
  r := pg_temp.cc_row(op);
  PERFORM pg_temp.cc_equal(private.catalog_extract_co_command_event_v1('private.co_commands','INSERT',NULL,r),pg_temp.cc_expected(op,kind,'NEW'),'operation target map '||op);
  PERFORM pg_temp.cc_equal(private.catalog_extract_co_command_event_v1('private.co_commands','DELETE',r,NULL),pg_temp.cc_expected(op,kind,'OLD'),'OLD removed receipt '||op);
  r := r || '{"status":"pending","receipt":null}';
  PERFORM pg_temp.cc_equal(private.catalog_extract_co_command_event_v1('private.co_commands','INSERT',NULL,r),empty_result,'pending emits no inferred references');
 END LOOP;
 r := pg_temp.cc_row('create_co') || '{"status":"abandoned","operation":null,"payload_fingerprint":null,"receipt":null}';
 PERFORM pg_temp.cc_equal(private.catalog_extract_co_command_event_v1('private.co_commands','INSERT',NULL,r),empty_result,'abandoned emits no inferred references');
 r := pg_temp.cc_row('save_sj_draft');
 expected := pg_temp.cc_expected('save_sj_draft','co_draft','NEW');
 old_expected := pg_temp.cc_expected('save_sj_draft','co_draft','OLD');
 expected := jsonb_set(expected,'{extraction,edges}',(old_expected#>'{extraction,edges}')||(expected#>'{extraction,edges}'));
 expected := jsonb_set(expected,'{extraction,origins}',(old_expected#>'{extraction,origins}')||(expected#>'{extraction,origins}'));
 PERFORM pg_temp.cc_equal(private.catalog_extract_co_command_event_v1('private.co_commands','UPDATE',r,r),expected,'OLD and NEW constraints retained');
 -- Extraction is not a command-transition validator. Both saved sides survive.
 expected := pg_temp.cc_expected('save_report_draft','co_draft','NEW');
 expected := jsonb_set(expected,'{extraction,edges}',(old_expected#>'{extraction,edges}')||(expected#>'{extraction,edges}'));
 expected := jsonb_set(expected,'{extraction,origins}',(old_expected#>'{extraction,origins}')||(expected#>'{extraction,origins}'));
 PERFORM pg_temp.cc_equal(private.catalog_extract_co_command_event_v1('private.co_commands','UPDATE',r,pg_temp.cc_row('save_report_draft')),expected,'same identity different constraints not deduplicated');
 FOR r,k IN SELECT * FROM (VALUES
 (pg_temp.cc_row('unknown'),'UNKNOWN_OPERATION'), -- unknown operation
 (jsonb_set(pg_temp.cc_row('create_co'),'{receipt,operation}','"edit_co"'),'CONTRADICTORY_LINEAGE'), -- receipt operation mismatch
 (jsonb_set(pg_temp.cc_row('create_co'),'{receipt,version}','1'),'UNKNOWN_VERSION'), -- numeric version refused
 (jsonb_set(pg_temp.cc_row('create_co'),'{receipt,version}','"9223372036854775808"'),'UNKNOWN_VERSION'), -- bigint overflow
 (jsonb_set(pg_temp.cc_row('create_co'),'{receipt,version}','"01"'),'UNKNOWN_VERSION'),
 (jsonb_set(pg_temp.cc_row('create_co'),'{receipt,version}',to_jsonb(repeat('9',10000))),'UNKNOWN_VERSION'),
 (jsonb_set(pg_temp.cc_row('create_co'),'{receipt,version}','null'),'UNKNOWN_VERSION'),
 (jsonb_set(pg_temp.cc_row('create_co'),'{receipt,customer_version}','"0"'),'UNKNOWN_VERSION'),
 (jsonb_set(pg_temp.cc_row('create_co'),'{receipt,extra}','"ignored"'),'UNKNOWN_SHAPE'), -- unknown receipt key
 (pg_temp.cc_row('create_co') #- '{receipt,id}','UNKNOWN_SHAPE'), -- missing receipt key
 (jsonb_set(pg_temp.cc_row('create_co'),'{receipt,id}','"not-uuid"'),'INVALID_UUID'),
 (jsonb_set(pg_temp.cc_row('create_co'),'{payload_fingerprint}','"not-a-digest"'),'UNKNOWN_SHAPE'), -- bad fingerprint
 (pg_temp.cc_row('create_co') || '{"status":"pending"}','UNKNOWN_SHAPE'),
 (pg_temp.cc_row('create_co') || '{"status":"abandoned"}','UNKNOWN_SHAPE'),
 (pg_temp.cc_row('create_co') || '{"status":"unknown"}','UNKNOWN_SHAPE'),
 (pg_temp.cc_row('create_co') - 'receipt','UNKNOWN_SHAPE'),
 (pg_temp.cc_row('create_co') || '{"payload":{"product_id":"00000000-0000-0000-0000-000000000001"}}','UNKNOWN_SHAPE')
 ) AS invalid(row_data,code) LOOP
  actual := private.catalog_extract_co_command_event_v1('private.co_commands','INSERT',NULL,r);
  PERFORM pg_temp.cc_equal(actual->'ok','false', 'refusal');
  PERFORM pg_temp.cc_equal(actual->'code',to_jsonb(k),'refusal '||k);
 END LOOP;
 actual := private.catalog_extract_co_command_event_v1('private.co_drafts','INSERT',NULL,pg_temp.cc_row('create_co'));
 PERFORM pg_temp.cc_equal(actual->'code','"UNKNOWN_RELATION"','unsupported relation');
 actual := private.catalog_extract_co_command_event_v1('private.co_commands','INSERT','null',pg_temp.cc_row('create_co'));
 PERFORM pg_temp.cc_equal(actual->'code','"INVALID_EVENT"','invalid event');
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF has_function_privilege(role_name,'private.catalog_extract_co_command_event_v1(regclass,text,jsonb,jsonb)','EXECUTE') THEN
   RAISE EXCEPTION 'owner-only ACL failed: %',role_name;
  END IF;
 END LOOP;
END $tests$;
\echo CATALOGUE_CO_COMMAND_ASSERTIONS_PASSED
