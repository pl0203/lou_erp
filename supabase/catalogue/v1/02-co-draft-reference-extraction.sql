-- Bounded full-row SJ and return draft extraction. Dependencies: 02-promotion-owner-extraction.sql,
-- 02-co-reference-extraction.sql. Public grammar: CO stages 01/02/04/07/08.
-- Report drafts, SourcesSnapshot and source_context are explicitly unsupported.
-- Historical evidence omission is admitted only by the explicit stage04 profile.
-- Pure source extraction, NOT a collector, resolver, transition guard or readiness proof.
CREATE FUNCTION private.catalog_extract_co_draft_event_v1(p_relation regclass,p_op text,p_old jsonb,p_new jsonb,p_profile text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE r jsonb; payload jsonb; line jsonb; side text; kind text; customer text; draft text; ord text;
 key text; line_id text; head text; revision text; evidence text; path text; index_n integer;
 keys text[]; seen text[]; map_seen text[]; map_key text; map_value jsonb;
 refs jsonb := '[]'; edges jsonb := '[]'; origins jsonb := '[]'; ref jsonb; scope jsonb;
 error_code text; error_path text;
BEGIN
 PERFORM private.catalog_po_require_v1(p_relation='private.co_drafts'::regclass,'UNKNOWN_RELATION','relation');
 PERFORM private.catalog_po_require_v1(p_profile IN ('source-stage08','source-stage04-pre-evidence'),'UNSUPPORTED_LEGACY_PROFILE','profile');
 PERFORM private.catalog_po_require_v1(
  (p_op='INSERT' AND p_old IS NULL AND p_new IS NOT NULL AND p_new<>'null'::jsonb)
  OR (p_op='UPDATE' AND p_old IS NOT NULL AND p_new IS NOT NULL AND p_old<>'null'::jsonb AND p_new<>'null'::jsonb)
  OR (p_op='DELETE' AND p_old IS NOT NULL AND p_old<>'null'::jsonb AND p_new IS NULL),'INVALID_EVENT','event');
 FOREACH side IN ARRAY ARRAY['OLD','NEW'] LOOP
  r:=CASE side WHEN 'OLD' THEN p_old ELSE p_new END;
  IF r IS NULL THEN CONTINUE; END IF;
  keys:=ARRAY['id','customer_id','kind','co_id','version','report_month','payload','eligible_set_fingerprint','created_by','created_at'];
  IF p_profile='source-stage08' THEN keys:=keys||ARRAY['evidence_id']; END IF;
  PERFORM private.catalog_po_require_v1(private.catalog_po_keys_v1(r,keys),'UNKNOWN_SHAPE',side);
  draft:=private.catalog_po_uuid_v1(r->'id',side||'.id');
  customer:=private.catalog_po_uuid_v1(r->'customer_id',side||'.customer_id');
  PERFORM private.catalog_po_uuid_v1(r->'created_by',side||'.created_by');
  PERFORM private.catalog_po_number_v1(r->'version',1,9223372036854775807,true,'UNKNOWN_VERSION',side||'.version');
  PERFORM private.catalog_po_require_v1(jsonb_typeof(r->'created_at')='string','UNKNOWN_SHAPE',side||'.created_at');
  kind:=r->>'kind';
  PERFORM private.catalog_po_require_v1(kind IN ('sj','return'),'UNKNOWN_OPERATION',side||'.kind');
  PERFORM private.catalog_po_require_v1(r->'report_month'='null'::jsonb AND r->'eligible_set_fingerprint'='null'::jsonb,'UNKNOWN_SHAPE',side);
  ord:=private.catalog_po_uuid_v1(r->'co_id',side||'.co_id',kind='return');
  scope:=jsonb_build_object('customerId',customer);
  IF ord IS NOT NULL THEN
   edges:=edges||jsonb_build_array(scope||jsonb_build_object('kind','co_order','id',ord,'expect','{}'::jsonb,'origin',side||'.co_id'));
   scope:=scope||jsonb_build_object('orderId',ord);
  END IF;
  ref:=jsonb_build_object('kind','customer','id',customer);
  refs:=refs||jsonb_build_array(ref);
  origins:=origins||jsonb_build_array(jsonb_build_object('ref',ref,'rowSide',side,'path',side||'.customer_id'));
  IF p_profile='source-stage08' THEN
   evidence:=private.catalog_po_uuid_v1(r->'evidence_id',side||'.evidence_id',true);
   IF evidence IS NOT NULL THEN
    edges:=edges||jsonb_build_array(jsonb_build_object('kind','co_evidence','id',evidence,'customerId',customer,'expect',jsonb_build_object('draftId',draft),'origin',side||'.evidence_id'));
   END IF;
  END IF;
  payload:=r->'payload'; path:=side||'.payload';
  IF kind='sj' THEN
   keys:=ARRAY['sj_number','sj_date','received_date','notes','lines','bound_co_version','bound_customer_version','candidate_batch_ids'];
   IF payload?'bound_delivery_head_id' OR payload?'bound_delivery_revision_id' OR payload?'bound_delivery_version' THEN
    keys:=keys||ARRAY['bound_delivery_head_id','bound_delivery_revision_id','bound_delivery_version'];
   END IF;
   IF payload?'posted_delivery_head_id' THEN keys:=keys||ARRAY['posted_delivery_head_id']; END IF;
  ELSE
   keys:=ARRAY['return_date','reference','reason','notes','lines','bound_customer_version'];
   IF payload?'posted_return_head_id' THEN keys:=keys||ARRAY['posted_return_head_id']; END IF;
  END IF;
  PERFORM private.catalog_po_require_v1(private.catalog_po_keys_v1(payload,keys),'UNKNOWN_SHAPE',path);
  PERFORM private.catalog_co_decimal_version_v1(payload->'bound_customer_version',path||'.bound_customer_version');
  FOREACH key IN ARRAY CASE kind WHEN 'sj' THEN ARRAY['sj_number','sj_date'] ELSE ARRAY['return_date'] END LOOP
   PERFORM private.catalog_po_require_v1(jsonb_typeof(payload->key)='string' AND length(btrim(payload->>key))>0,'UNKNOWN_SHAPE',path||'.'||key);
  END LOOP;
  FOREACH key IN ARRAY CASE kind WHEN 'sj' THEN ARRAY['received_date','notes'] ELSE ARRAY['reference','reason','notes'] END LOOP
   PERFORM private.catalog_po_require_v1(payload->key='null'::jsonb OR jsonb_typeof(payload->key)='string','UNKNOWN_SHAPE',path||'.'||key);
  END LOOP;
  FOREACH key IN ARRAY CASE kind WHEN 'sj' THEN ARRAY['sj_date','received_date'] ELSE ARRAY['return_date'] END LOOP
   IF payload->key='null'::jsonb THEN CONTINUE; END IF;
   PERFORM private.catalog_po_require_v1(payload->>key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$','UNKNOWN_SHAPE',path||'.'||key);
   BEGIN
    PERFORM make_date(substring(payload->>key,1,4)::integer,substring(payload->>key,6,2)::integer,substring(payload->>key,9,2)::integer);
   EXCEPTION WHEN datetime_field_overflow THEN
    PERFORM private.catalog_po_require_v1(false,'UNKNOWN_SHAPE',path||'.'||key);
   END;
  END LOOP;
  IF kind='return' THEN
   PERFORM private.catalog_po_require_v1(coalesce(length(btrim(payload->>'reference')),0)>0 OR coalesce(length(btrim(payload->>'reason')),0)>0,'UNKNOWN_SHAPE',path);
  ELSE
   PERFORM private.catalog_co_decimal_version_v1(payload->'bound_co_version',path||'.bound_co_version');
   IF payload?'bound_delivery_head_id' THEN
    head:=private.catalog_po_uuid_v1(payload->'bound_delivery_head_id',path||'.bound_delivery_head_id');
    revision:=private.catalog_po_uuid_v1(payload->'bound_delivery_revision_id',path||'.bound_delivery_revision_id');
    PERFORM private.catalog_co_decimal_version_v1(payload->'bound_delivery_version',path||'.bound_delivery_version');
    edges:=edges||jsonb_build_array(scope||jsonb_build_object('kind','co_delivery_head','id',head,'expect','{}'::jsonb,'origin',path||'.bound_delivery_head_id'),
     scope||jsonb_build_object('kind','co_delivery_revision','id',revision,'expect',jsonb_build_object('headId',head),'origin',path||'.bound_delivery_revision_id'));
   END IF;
  END IF;
  key:=CASE kind WHEN 'sj' THEN 'posted_delivery_head_id' ELSE 'posted_return_head_id' END;
  IF payload?key THEN
   head:=private.catalog_po_uuid_v1(payload->key,path||'.'||key);
   edges:=edges||jsonb_build_array(scope||jsonb_build_object('kind',CASE kind WHEN 'sj' THEN 'co_delivery_head' ELSE 'co_return_head' END,'id',head,'expect','{}'::jsonb,'origin',path||'.'||key));
  END IF;
  PERFORM private.catalog_po_require_v1(jsonb_typeof(payload->'lines')='array','UNKNOWN_SHAPE',path||'.lines');
  PERFORM private.catalog_po_require_v1(jsonb_array_length(payload->'lines')>0,'UNKNOWN_SHAPE',path||'.lines');
  seen:='{}'; index_n:=0; key:=CASE kind WHEN 'sj' THEN 'co_line_id' ELSE 'batch_id' END;
  FOR line IN SELECT value FROM jsonb_array_elements(payload->'lines') LOOP
   PERFORM private.catalog_po_require_v1(private.catalog_po_keys_v1(line,ARRAY[key,'quantity']),'UNKNOWN_SHAPE',path||'.lines['||index_n||']');
   line_id:=private.catalog_po_uuid_v1(line->key,path||'.lines['||index_n||'].'||key);
   PERFORM private.catalog_po_require_v1(NOT line_id=ANY(seen),'CONTRADICTORY_LINEAGE',path||'.lines['||index_n||'].'||key);
   seen:=array_append(seen,line_id);
   PERFORM private.catalog_po_number_v1(line->'quantity',1,2147483647,true,'UNKNOWN_SHAPE',path||'.lines['||index_n||'].quantity');
   edges:=edges||jsonb_build_array(scope||jsonb_build_object('kind',CASE kind WHEN 'sj' THEN 'co_line' ELSE 'co_batch' END,'id',line_id,'expect','{}'::jsonb,'origin',path||'.lines['||index_n||'].'||key));
   index_n:=index_n+1;
  END LOOP;
  IF kind='sj' THEN
   PERFORM private.catalog_po_require_v1(jsonb_typeof(payload->'candidate_batch_ids')='object','UNKNOWN_SHAPE',path||'.candidate_batch_ids');
   map_seen:='{}';
   FOR map_key,map_value IN SELECT entry.key,entry.value FROM jsonb_each(payload->'candidate_batch_ids') AS entry LOOP
    line_id:=private.catalog_po_uuid_v1(to_jsonb(map_key),path||'.candidate_batch_ids.key');
    PERFORM private.catalog_po_uuid_v1(map_value,path||'.candidate_batch_ids.'||map_key);
    PERFORM private.catalog_po_require_v1(line_id=ANY(seen) AND NOT line_id=ANY(map_seen),'CONTRADICTORY_LINEAGE',path||'.candidate_batch_ids.'||map_key);
    map_seen:=array_append(map_seen,line_id);
    -- Map keys are CO lines; values reserve future batches and MUST NOT become lookup edges.
    edges:=edges||jsonb_build_array(scope||jsonb_build_object('kind','co_line','id',line_id,'expect','{}'::jsonb,'origin',path||'.candidate_batch_ids.key['||map_key||']'));
   END LOOP;
   PERFORM private.catalog_po_require_v1(cardinality(map_seen)=cardinality(seen),'CONTRADICTORY_LINEAGE',path||'.candidate_batch_ids');
  END IF;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'extraction',jsonb_build_object('refs',private.catalog_po_sorted_refs_v1(refs),'edges',edges,'historicalNulls','[]'::jsonb,'origins',origins));
EXCEPTION WHEN SQLSTATE 'PCE02' THEN
 GET STACKED DIAGNOSTICS error_code=MESSAGE_TEXT,error_path=PG_EXCEPTION_DETAIL;
 RETURN jsonb_build_object('ok',false,'code',error_code,'path',error_path);
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_extract_co_draft_event_v1(regclass,text,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
DO $owner_acl$
DECLARE f record;
BEGIN
 SELECT p.* INTO STRICT f FROM pg_catalog.pg_proc p WHERE p.oid='private.catalog_extract_co_draft_event_v1(regclass,text,jsonb,jsonb,text)'::regprocedure;
 IF f.proowner<>'postgres'::regrole OR f.prosecdef OR f.provolatile<>'i' OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']
 OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a WHERE a.grantee<>f.proowner) THEN
  RAISE EXCEPTION 'CATALOGUE_CO_DRAFT_ACL_DRIFT' USING ERRCODE='42501';
 END IF;
END $owner_acl$;
