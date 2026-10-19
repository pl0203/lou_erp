-- Bounded command-row extraction only, after 02-promotion-owner-extraction.sql.
-- Source grammar: CO stages 01/02/03/04/07/08, including evidence receipts.
-- Inputs must be actual trusted OLD/NEW to_jsonb row images. SQL-null row columns
-- become JSON null; absent keys are never admitted as substitutes.
-- Pending rows are transient observations, not valid standalone committed rows.
-- Digests contain no recoverable request references. Receipt target edges remain
-- UNRESOLVED: no current-row lookup, frozen collector, command-transition guard,
-- draft/audit/evidence snapshot validation, lifetime certification or writer hook.
-- Unsupported relations and producer-era shapes refuse. Caller owns transaction.

CREATE FUNCTION private.catalog_co_decimal_version_v1(p_value jsonb,p_path text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE value_text text;
BEGIN
 PERFORM private.catalog_po_require_v1(jsonb_typeof(p_value) = 'string','UNKNOWN_VERSION',p_path);
 value_text := p_value #>> '{}';
 PERFORM private.catalog_po_require_v1(value_text ~ '^[1-9][0-9]*$' AND length(value_text) <= 19,'UNKNOWN_VERSION',p_path);
 -- Only bounded strings reach the native exact numeric conversion.
 PERFORM private.catalog_po_require_v1(value_text::numeric <= 9223372036854775807,'UNKNOWN_VERSION',p_path);
 RETURN value_text;
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_co_decimal_version_v1(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_extract_co_command_event_v1(p_relation regclass,p_op text,p_old jsonb,p_new jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE r jsonb; receipt jsonb; side text; operation text; target_kind text; draft_kind text;
 target_id text; customer text; ref jsonb; expect jsonb;
 refs jsonb := '[]'; edges jsonb := '[]'; origins jsonb := '[]'; error_code text; error_path text;
BEGIN
 PERFORM private.catalog_po_require_v1(p_relation = 'private.co_commands'::regclass,'UNKNOWN_RELATION','relation');
 PERFORM private.catalog_po_require_v1(
  (p_op = 'INSERT' AND p_old IS NULL AND p_new IS NOT NULL AND p_new <> 'null'::jsonb)
  OR (p_op = 'UPDATE' AND p_old IS NOT NULL AND p_new IS NOT NULL AND p_old <> 'null'::jsonb AND p_new <> 'null'::jsonb)
  OR (p_op = 'DELETE' AND p_old IS NOT NULL AND p_old <> 'null'::jsonb AND p_new IS NULL),'INVALID_EVENT','event');
 FOREACH side IN ARRAY ARRAY['OLD','NEW'] LOOP
  r := CASE side WHEN 'OLD' THEN p_old ELSE p_new END;
  IF r IS NULL THEN CONTINUE; END IF;
  PERFORM private.catalog_po_require_v1(private.catalog_po_keys_v1(r,ARRAY['actor_id','request_id','operation','payload_fingerprint','status','receipt','created_at']),'UNKNOWN_SHAPE',side);
  PERFORM private.catalog_po_uuid_v1(r->'actor_id',side||'.actor_id');
  PERFORM private.catalog_po_uuid_v1(r->'request_id',side||'.request_id');
  PERFORM private.catalog_po_require_v1(jsonb_typeof(r->'created_at') = 'string','UNKNOWN_SHAPE',side||'.created_at');
  PERFORM private.catalog_po_require_v1(jsonb_typeof(r->'status') = 'string' AND r->>'status' IN ('pending','committed','abandoned'),'UNKNOWN_SHAPE',side||'.status');
  receipt := r->'receipt';
  IF r->>'status' = 'abandoned' THEN
   PERFORM private.catalog_po_require_v1(r->'operation' = 'null'::jsonb AND r->'payload_fingerprint' = 'null'::jsonb AND receipt = 'null'::jsonb,'UNKNOWN_SHAPE',side);
   CONTINUE;
  END IF;
  PERFORM private.catalog_po_require_v1(jsonb_typeof(r->'operation') = 'string','UNKNOWN_OPERATION',side||'.operation');
  operation := r->>'operation'; draft_kind := NULL;
  CASE operation
   WHEN 'create_co','edit_co','cancel_co','resolve_undelivered','close_co' THEN target_kind := 'co_order';
   WHEN 'save_sj_draft' THEN target_kind := 'co_draft'; draft_kind := 'sj';
   WHEN 'save_report_draft' THEN target_kind := 'co_draft'; draft_kind := 'report';
   WHEN 'save_return_draft' THEN target_kind := 'co_draft'; draft_kind := 'return';
   WHEN 'post_sj','correct_sj' THEN target_kind := 'co_delivery_head';
   WHEN 'post_report','correct_report' THEN target_kind := 'co_report_head';
   WHEN 'post_return','correct_return' THEN target_kind := 'co_return_head';
   WHEN 'register_evidence','finalize_evidence' THEN target_kind := 'co_evidence';
   ELSE PERFORM private.catalog_po_require_v1(false,'UNKNOWN_OPERATION',side||'.operation');
  END CASE;
  PERFORM private.catalog_po_require_v1(jsonb_typeof(r->'payload_fingerprint') = 'string'
   AND r->>'payload_fingerprint' ~ '^[a-f0-9]{64}$','UNKNOWN_SHAPE',side||'.payload_fingerprint');
  IF r->>'status' = 'pending' THEN
   PERFORM private.catalog_po_require_v1(receipt = 'null'::jsonb,'UNKNOWN_SHAPE',side||'.receipt');
   CONTINUE;
  END IF;
  PERFORM private.catalog_po_require_v1(private.catalog_po_keys_v1(receipt,ARRAY['id','operation','version','customer_id','customer_version']),'UNKNOWN_SHAPE',side||'.receipt');
  PERFORM private.catalog_po_require_v1(receipt->'operation' = r->'operation','CONTRADICTORY_LINEAGE',side||'.receipt.operation');
  target_id := private.catalog_po_uuid_v1(receipt->'id',side||'.receipt.id');
  customer := private.catalog_po_uuid_v1(receipt->'customer_id',side||'.receipt.customer_id');
  PERFORM private.catalog_co_decimal_version_v1(receipt->'version',side||'.receipt.version');
  PERFORM private.catalog_co_decimal_version_v1(receipt->'customer_version',side||'.receipt.customer_version');
  ref := jsonb_build_object('kind','customer','id',customer);
  refs := refs || jsonb_build_array(ref);
  origins := origins || jsonb_build_array(jsonb_build_object('ref',ref,'rowSide',side,'path',side||'.receipt.customer_id'));
  expect := CASE WHEN draft_kind IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('draftKind',draft_kind) END;
  -- Retain every constrained OLD/NEW occurrence, including equal target IDs.
  -- Customer scope and kind bindings are data, never reconstructed from origin.
  edges := edges || jsonb_build_array(jsonb_build_object('kind',target_kind,'id',target_id,
   'customerId',customer,'expect',expect,'origin',side||'.receipt.id'));
 END LOOP;
 RETURN jsonb_build_object('ok',true,'extraction',jsonb_build_object('refs',private.catalog_po_sorted_refs_v1(refs),
  'edges',edges,'historicalNulls','[]'::jsonb,'origins',origins));
EXCEPTION WHEN SQLSTATE 'PCE02' THEN
 GET STACKED DIAGNOSTICS error_code = MESSAGE_TEXT, error_path = PG_EXCEPTION_DETAIL;
 RETURN jsonb_build_object('ok',false,'code',error_code,'path',error_path);
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_extract_co_command_event_v1(regclass,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

DO $owner_acl$
DECLARE signature text; f record;
BEGIN
 FOREACH signature IN ARRAY ARRAY['private.catalog_co_decimal_version_v1(jsonb,text)',
  'private.catalog_extract_co_command_event_v1(regclass,text,jsonb,jsonb)'] LOOP
  SELECT p.* INTO STRICT f FROM pg_catalog.pg_proc p WHERE p.oid = signature::regprocedure;
  IF f.proowner <> 'postgres'::regrole OR f.prosecdef OR f.provolatile <> 'i'
   OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']
   OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a WHERE a.grantee <> f.proowner) THEN
   RAISE EXCEPTION 'CATALOGUE_CO_COMMAND_ACL_DRIFT' USING ERRCODE = '42501';
  END IF;
 END LOOP;
END $owner_acl$;
