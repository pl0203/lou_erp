-- Pure supplied-frozen-history resolver, NOT a trusted collector or authenticity proof.
-- Bounded support: schedule, visit_request, visit. Every other edge kind refuses,
-- including PO/promotion/CO extensions; no caller may strip those constraints.
-- Dependency: reviewed new02-visit-reference-extraction.sql snapshot validators.
-- Input extraction is the extraction object, not its {ok,extraction} wrapper.
-- History is {snapshots:[{source,row}]}; rows are exact public native profiles.
-- OLD/deleted retained observations are equally eligible; no current-row preference.
-- Unversioned edges conservatively include ALL supplied matching history versions.
-- Different versions may legitimately have different customers; an exact supplied
-- customer/version/date constraint is conjunctive, never inferred from origin text.
-- This does not prove history completeness, persisted provenance, writer ordering,
-- catalogue usage, authenticated authority, target parity, or cutover readiness.
CREATE FUNCTION private.catalog_resolve_nonco_frozen_v1(p_extraction jsonb,p_history jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE
 ex jsonb:=p_extraction; entry jsonb; r jsonb; parsed jsonb; self_edge jsonb;
 observations jsonb:='[]'; observation jsonb; previous jsonb; queue jsonb;
 edge jsonb; child jsonb; ref jsonb; origin jsonb; constraint_row record;
 refs jsonb:='[]'; origins jsonb; nulls jsonb; resolved jsonb:='[]';
 kind text; identity text; source text; path text; side text; key text;
 version_key text; version_value text; id_value text; allowed text[];
 ix integer:=0; head integer:=0; matches integer; error_code text; error_path text;
BEGIN
 PERFORM private.catalog_vr_require_v1(private.catalog_vr_keys_v1(ex,ARRAY['refs','edges','historicalNulls','origins']),'UNKNOWN_SHAPE','extraction');
 FOREACH key IN ARRAY ARRAY['refs','edges','historicalNulls','origins'] LOOP
  PERFORM private.catalog_vr_require_v1(jsonb_typeof(ex->key)='array','UNKNOWN_SHAPE','extraction.'||key);
 END LOOP;
 origins:=ex->'origins'; nulls:=ex->'historicalNulls'; queue:=ex->'edges';
 FOR entry IN SELECT value FROM jsonb_array_elements(nulls) LOOP
  PERFORM private.catalog_vr_require_v1(jsonb_typeof(entry)='string','UNKNOWN_SHAPE','extraction.historicalNulls');
 END LOOP;
 FOR ref IN SELECT value FROM jsonb_array_elements(ex->'refs') LOOP
  PERFORM private.catalog_vr_require_v1(private.catalog_vr_keys_v1(ref,ARRAY['kind','id']) AND ref->>'kind' IN('customer','product'),'UNKNOWN_SHAPE','extraction.refs');
  id_value:=private.catalog_vr_uuid_v1(ref->'id','extraction.refs.id');
  PERFORM private.catalog_vr_require_v1(ref->>'id'=id_value,'UNKNOWN_SHAPE','extraction.refs.id');
  refs:=refs||jsonb_build_array(ref);
 END LOOP;
 FOR origin IN SELECT value FROM jsonb_array_elements(origins) LOOP
  PERFORM private.catalog_vr_require_v1(private.catalog_vr_keys_v1(origin,ARRAY['ref','rowSide','path']) AND origin->>'rowSide' IN('OLD','NEW')
   AND jsonb_typeof(origin->'path')='string' AND left(origin->>'path',4)=(origin->>'rowSide')||'.' AND refs @> jsonb_build_array(origin->'ref'),'UNKNOWN_SHAPE','extraction.origins');
 END LOOP;
 FOR ref IN SELECT value FROM jsonb_array_elements(refs) LOOP
  PERFORM private.catalog_vr_require_v1(EXISTS(SELECT 1 FROM jsonb_array_elements(origins) o WHERE o->'ref'=ref),'CONTRADICTORY_LINEAGE','extraction.origins');
 END LOOP;
 PERFORM private.catalog_vr_require_v1(private.catalog_vr_keys_v1(p_history,ARRAY['snapshots']) AND jsonb_typeof(p_history->'snapshots')='array','UNKNOWN_SHAPE','history');
 -- Validate EVERY supplied observation, even if no input edge happens to use it.
 FOR entry IN SELECT value FROM jsonb_array_elements(p_history->'snapshots') LOOP
  path:='history.snapshots['||ix::text||']';
  PERFORM private.catalog_vr_require_v1(private.catalog_vr_keys_v1(entry,ARRAY['source','row']),'UNKNOWN_SHAPE',path);
  source:=entry->>'source';
  kind:=CASE source WHEN 'public.sales_schedules' THEN 'schedule' WHEN 'public.outlet_visits' THEN 'visit' WHEN 'public.visit_requests' THEN 'visit_request' END;
  PERFORM private.catalog_vr_require_v1(kind IS NOT NULL,'UNKNOWN_RELATION',path||'.source');
  r:=entry->'row'; parsed:=private.catalog_vr_snapshot_v1(kind,r,path||'.row','OLD');
  self_edge:=parsed->'edges'->0; identity:=self_edge->>'id';
  version_key:=CASE kind WHEN 'schedule' THEN 'scheduleVersion' WHEN 'visit' THEN 'noteVersion' ELSE 'requestVersion' END;
  -- Native SQL numeric only. Canonicalize integer scale without JavaScript Number.
  version_value:=trunc((self_edge->'expect'->>version_key)::numeric)::text;
  self_edge:=jsonb_set(self_edge,ARRAY['expect',version_key],to_jsonb(version_value));
  IF self_edge->'expect' ? 'baseVersion' THEN
   self_edge:=jsonb_set(self_edge,'{expect,baseVersion}',to_jsonb(trunc((self_edge->'expect'->>'baseVersion')::numeric)::text));
  END IF;
  FOR previous IN SELECT value FROM jsonb_array_elements(observations) WHERE value->>'kind'=kind AND value->>'id'=identity LOOP
   PERFORM private.catalog_vr_require_v1(previous->>'version'<>version_value OR previous->'row'=r,'AMBIGUOUS_LINEAGE',path);
   -- Visit linkage cannot move during note edits; contradictory retained history refuses.
   IF kind='visit' THEN
    PERFORM private.catalog_vr_require_v1(((previous->'row') - ARRAY['notes','note_version']) = (r - ARRAY['notes','note_version']),'CONTRADICTORY_LINEAGE',path);
   ELSIF kind='schedule' THEN
    PERFORM private.catalog_vr_require_v1(previous->'row'->'assigned_by'=r->'assigned_by'
     AND previous->'row'->'created_at'=r->'created_at','CONTRADICTORY_LINEAGE',path);
   END IF;
  END LOOP;
  observations:=observations||jsonb_build_array(jsonb_build_object('kind',kind,'id',identity,'version',version_value,'row',r,'self',self_edge,'parsed',parsed,'source',source,'index',ix));
  ix:=ix+1;
 END LOOP;
 WHILE head<jsonb_array_length(queue) LOOP
  edge:=queue->head; path:='extraction.edges['||head::text||']'; head:=head+1;
  PERFORM private.catalog_vr_require_v1(jsonb_typeof(edge)='object' AND edge ?& ARRAY['kind','id','origin','expect']
   AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(edge) k WHERE NOT k=ANY(ARRAY['kind','id','origin','expect','customerId','orderId'])),'UNKNOWN_SHAPE',path);
  kind:=edge->>'kind';
  PERFORM private.catalog_vr_require_v1(kind IN('schedule','visit_request','visit'),'UNSUPPORTED_LINEAGE_KIND',path||'.kind');
  -- There is no owning-PO relation in these profiles. Even a valid orderId refuses.
  PERFORM private.catalog_vr_require_v1(NOT edge ? 'orderId','UNSUPPORTED_CONSTRAINT',path||'.orderId');
  identity:=private.catalog_vr_uuid_v1(edge->'id',path||'.id');
  PERFORM private.catalog_vr_require_v1(edge->>'id'=identity,'UNKNOWN_SHAPE',path||'.id');
  IF edge ? 'customerId' THEN
   id_value:=private.catalog_vr_uuid_v1(edge->'customerId',path||'.customerId');
   PERFORM private.catalog_vr_require_v1(edge->>'customerId'=id_value,'UNKNOWN_SHAPE',path||'.customerId');
  END IF;
  -- The prefix supplies provenance side only. No identity/binding comes from text.
  PERFORM private.catalog_vr_require_v1(jsonb_typeof(edge->'origin')='string' AND (edge->>'origin') ~ '^(OLD|NEW)\.', 'UNKNOWN_SHAPE',path||'.origin');
  side:=left(edge->>'origin',3);
  allowed:=CASE kind WHEN 'schedule' THEN ARRAY['scheduleVersion','scheduledDate']
   WHEN 'visit' THEN ARRAY['scheduleId','noteVersion'] ELSE ARRAY['requestVersion','requestKind','requestStatus','sourceScheduleId','baseVersion','approvedScheduleId'] END;
  PERFORM private.catalog_vr_require_v1(jsonb_typeof(edge->'expect')='object','UNKNOWN_SHAPE',path||'.expect');
  FOR constraint_row IN SELECT * FROM jsonb_each(edge->'expect') LOOP
   key:=constraint_row.key;
   PERFORM private.catalog_vr_require_v1(key=ANY(allowed) AND jsonb_typeof(constraint_row.value)='string','UNSUPPORTED_CONSTRAINT',path||'.expect.'||key);
   IF key IN('scheduleId','sourceScheduleId','approvedScheduleId') THEN
    id_value:=private.catalog_vr_uuid_v1(constraint_row.value,path||'.expect.'||key);
    PERFORM private.catalog_vr_require_v1(constraint_row.value=to_jsonb(id_value),'UNKNOWN_SHAPE',path||'.expect.'||key);
   ELSIF key IN('scheduleVersion','requestVersion','baseVersion','noteVersion') THEN
    version_value:=constraint_row.value#>>'{}';
    PERFORM private.catalog_vr_require_v1(version_value ~ '^[1-9][0-9]{0,9}$','UNKNOWN_VERSION',path||'.expect.'||key);
    PERFORM private.catalog_vr_require_v1(version_value::numeric<=2147483647,'UNKNOWN_VERSION',path||'.expect.'||key);
   ELSIF key='scheduledDate' THEN PERFORM private.catalog_vr_date_v1(constraint_row.value,path||'.expect.'||key);
   ELSIF key='requestKind' THEN PERFORM private.catalog_vr_require_v1(constraint_row.value#>>'{}' IN('new','amendment'),'UNKNOWN_SHAPE',path||'.expect.'||key);
   ELSIF key='requestStatus' THEN PERFORM private.catalog_vr_require_v1(constraint_row.value#>>'{}' IN('pending','approved','rejected','withdrawn'),'UNKNOWN_SHAPE',path||'.expect.'||key);
   END IF;
  END LOOP;
  matches:=0;
  FOR observation IN SELECT value FROM jsonb_array_elements(observations) WHERE value->>'kind'=kind AND value->>'id'=identity LOOP
   self_edge:=observation->'self';
   IF edge ? 'customerId' AND edge->'customerId'<>self_edge->'customerId' THEN CONTINUE; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_each(edge->'expect') c WHERE self_edge->'expect'->c.key IS DISTINCT FROM c.value) THEN CONTINUE; END IF;
   matches:=matches+1;
   parsed:=observation->'parsed';
   -- V2 amendment source tuple: one exact retained version/person witness.
   -- Requested customer may legitimately differ from the source customer.
   IF kind='visit_request' AND observation->'row'->>'kind'='amendment' THEN
    PERFORM private.catalog_vr_require_v1(EXISTS(SELECT 1 FROM jsonb_array_elements(observations) s
     WHERE s->>'kind'='schedule' AND s->>'id'=observation->'row'->>'source_schedule_id'
     AND (s->>'version')::numeric=(observation->'row'->>'base_version')::numeric
     AND s->'row'->'sales_person_id'=observation->'row'->'requester_id'), 'MISSING_LINEAGE',path||'.sourceSchedule');
   END IF;
   -- A request's approval captures requester/day/customer together. Require a
   -- single frozen schedule observation satisfying that tuple, never independent
   -- witnesses for each field or a convenient same-customer schedule.
   IF kind='visit_request' AND observation->'row'->>'approved_schedule_id' IS NOT NULL THEN
    PERFORM private.catalog_vr_require_v1(EXISTS(SELECT 1 FROM jsonb_array_elements(observations) s
     WHERE s->>'kind'='schedule' AND s->>'id'=observation->'row'->>'approved_schedule_id'
     AND s->'row'->'outlet_id'=observation->'row'->'customer_id'
     AND s->'row'->'sales_person_id'=observation->'row'->'requester_id'
     AND s->'row'->'scheduled_date'=observation->'row'->'scheduled_date'), 'MISSING_LINEAGE',path||'.approvedSchedule');
   ELSIF kind='visit' AND observation->'row'->>'schedule_id' IS NOT NULL THEN
    PERFORM private.catalog_vr_require_v1(EXISTS(SELECT 1 FROM jsonb_array_elements(observations) s
     WHERE s->>'kind'='schedule' AND s->>'id'=observation->'row'->>'schedule_id'
     AND s->'row'->'outlet_id'=observation->'row'->'outlet_id'
     AND s->'row'->'sales_person_id'=observation->'row'->'sales_person_id'), 'MISSING_LINEAGE',path||'.visitSchedule');
   END IF;
   FOR ref IN SELECT value FROM jsonb_array_elements(parsed->'refs') LOOP
    refs:=refs||jsonb_build_array(ref);
    origins:=origins||jsonb_build_array(jsonb_build_object('ref',ref,'rowSide',side,'path',edge->>'origin'));
   END LOOP;
   -- Snapshot validator's first edge is self; only following dependency edges recurse.
   FOR child IN SELECT value FROM jsonb_array_elements(parsed->'edges') WITH ORDINALITY e(value,ordinality) WHERE ordinality>1 LOOP
    child:=jsonb_set(child,'{origin}',to_jsonb((edge->>'origin')||'.frozenDependency'));
    IF child->'expect' ? 'scheduleVersion' THEN child:=jsonb_set(child,'{expect,scheduleVersion}',to_jsonb(trunc((child->'expect'->>'scheduleVersion')::numeric)::text)); END IF;
    queue:=queue||jsonb_build_array(child);
   END LOOP;
   resolved:=resolved||jsonb_build_array(jsonb_build_object('edge',edge,'snapshotIndex',observation->'index'));
  END LOOP;
  -- Wrong scope/binding and absent identity both fail closed, not an empty result.
  PERFORM private.catalog_vr_require_v1(matches>0,'MISSING_LINEAGE',path);
 END LOOP;
 SELECT coalesce(jsonb_agg(value ORDER BY CASE value->>'kind' WHEN 'customer' THEN 0 ELSE 1 END,(value->>'id')::uuid),'[]'::jsonb)
 INTO refs FROM (SELECT DISTINCT value FROM jsonb_array_elements(refs)) distinct_refs;
 RETURN jsonb_build_object('ok',true,'extraction',jsonb_build_object('refs',refs,'edges','[]'::jsonb,'historicalNulls',nulls,'origins',origins),'resolved',resolved);
EXCEPTION WHEN SQLSTATE 'PCV02' THEN
 GET STACKED DIAGNOSTICS error_code=MESSAGE_TEXT,error_path=PG_EXCEPTION_DETAIL;
 RETURN jsonb_build_object('ok',false,'code',error_code,'path',error_path);
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_resolve_nonco_frozen_v1(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
