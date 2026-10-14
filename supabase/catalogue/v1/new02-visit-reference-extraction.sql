-- Pure bounded public-source grammar. Trusted dispatch supplies actual OLD/NEW.
-- Edges are unresolved work, not completed lifetime/reference validation.
-- Deliberate expect extension is documented in the review packet. A collector
-- must consume every constraint or refuse; no live/current-master lookup here.
-- Canonical UUID / finite ISO date profiles only; unknown legacy profiles refuse.

CREATE FUNCTION private.catalog_vr_require_v1(p_condition boolean,p_code text,p_path text) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
BEGIN
 IF p_condition IS DISTINCT FROM true THEN RAISE EXCEPTION USING ERRCODE='PCV02',MESSAGE=p_code,DETAIL=p_path; END IF;
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_vr_require_v1(boolean,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_vr_keys_v1(p_value jsonb,p_required text[],p_optional text[] DEFAULT ARRAY[]::text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
 SELECT CASE WHEN jsonb_typeof(p_value)='object' THEN p_value ?& p_required
 AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(p_value) k WHERE NOT k=ANY(p_required||p_optional)) ELSE false END;
$fn$;
REVOKE ALL ON FUNCTION private.catalog_vr_keys_v1(jsonb,text[],text[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_vr_uuid_v1(p_value jsonb,p_path text,p_nullable boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
BEGIN
 IF p_nullable AND p_value='null'::jsonb THEN RETURN NULL; END IF;
 PERFORM private.catalog_vr_require_v1(jsonb_typeof(p_value)='string' AND p_value#>>'{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$','INVALID_UUID',p_path);
 RETURN (p_value#>>'{}')::uuid::text;
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_vr_uuid_v1(jsonb,text,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_vr_version_v1(p_value jsonb,p_path text,p_payload boolean DEFAULT false) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE n numeric;
BEGIN
 -- Native to_jsonb row versions are numbers; the pinned payload ->> integer cast
 -- additionally accepts positive decimal strings. Normalize only this field.
 PERFORM private.catalog_vr_require_v1((jsonb_typeof(p_value)='number' OR (p_payload AND jsonb_typeof(p_value)='string'))
 AND length(p_value#>>'{}')<=10 AND p_value#>>'{}' ~ '^[0-9]+$','UNKNOWN_VERSION',p_path);
 n:=(p_value#>>'{}')::numeric;
 PERFORM private.catalog_vr_require_v1(n BETWEEN 1 AND 2147483647,'UNKNOWN_VERSION',p_path);
 RETURN n;
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_vr_version_v1(jsonb,text,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_vr_text_v1(p_value jsonb,p_path text,p_nullable boolean DEFAULT false,p_max integer DEFAULT NULL) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
BEGIN
 IF p_nullable AND p_value='null'::jsonb THEN RETURN; END IF;
 PERFORM private.catalog_vr_require_v1(jsonb_typeof(p_value)='string' AND (p_max IS NULL OR length(p_value#>>'{}')<=p_max),'UNKNOWN_SHAPE',p_path);
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_vr_text_v1(jsonb,text,boolean,integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_vr_date_v1(p_value jsonb,p_path text) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE s text;
BEGIN
 PERFORM private.catalog_vr_require_v1(jsonb_typeof(p_value)='string' AND p_value#>>'{}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$','UNKNOWN_SHAPE',p_path);
 s:=p_value#>>'{}';
 PERFORM make_date(substr(s,1,4)::integer,substr(s,6,2)::integer,substr(s,9,2)::integer);
EXCEPTION WHEN datetime_field_overflow THEN
 RAISE EXCEPTION USING ERRCODE='PCV02',MESSAGE='UNKNOWN_SHAPE',DETAIL=p_path;
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_vr_date_v1(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_vr_coordinates_v1(p_value jsonb,p_path text) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
BEGIN
 PERFORM private.catalog_vr_require_v1((NOT p_value?'lat' OR p_value->'lat'='null'::jsonb OR jsonb_typeof(p_value->'lat')='number')
 AND (NOT p_value?'lng' OR p_value->'lng'='null'::jsonb OR jsonb_typeof(p_value->'lng')='number'),'UNKNOWN_SHAPE',p_path);
 PERFORM private.catalog_vr_require_v1((p_value->>'lat' IS NULL)=(p_value->>'lng' IS NULL),'UNKNOWN_SHAPE',p_path);
 IF p_value->>'lat' IS NOT NULL THEN
  PERFORM private.catalog_vr_require_v1((p_value->>'lat')::numeric BETWEEN -90 AND 90 AND (p_value->>'lng')::numeric BETWEEN -180 AND 180,'UNKNOWN_SHAPE',p_path);
 END IF;
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_vr_coordinates_v1(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_vr_edge_v1(p_kind text,p_id text,p_path text,p_expect jsonb,p_customer text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
 SELECT jsonb_build_object('kind',p_kind,'id',p_id,'origin',p_path,'expect',p_expect)
 || CASE WHEN p_customer IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('customerId',p_customer) END;
$fn$;
REVOKE ALL ON FUNCTION private.catalog_vr_edge_v1(text,text,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_vr_snapshot_v1(p_kind text,p_row jsonb,p_path text,p_side text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE customer text; identity text; linked text; ref jsonb; edges jsonb:='[]'; expect jsonb:='{}'; key text; version numeric;
BEGIN
 PERFORM private.catalog_vr_require_v1(p_kind IN('schedule','visit_request','visit'),'UNKNOWN_RELATION',p_path);
 PERFORM private.catalog_vr_require_v1(private.catalog_vr_keys_v1(p_row,CASE p_kind
  WHEN 'schedule' THEN ARRAY['id','outlet_id','sales_person_id','assigned_by','scheduled_date','status','notes','created_at','version']
  WHEN 'visit_request' THEN ARRAY['id','requester_id','kind','customer_id','scheduled_date','notes','source_schedule_id','base_version','approved_schedule_id','status','version','reviewer_id','decided_at','created_at']
  WHEN 'visit' THEN ARRAY['id','outlet_id','sales_person_id','schedule_id','checked_in_at','lat','lng','notes','note_version'] END),'UNKNOWN_SHAPE',p_path);
 identity:=private.catalog_vr_uuid_v1(p_row->'id',p_path||'.id');
 key:=CASE WHEN p_kind='visit_request' THEN 'customer_id' ELSE 'outlet_id' END;
 customer:=private.catalog_vr_uuid_v1(p_row->key,p_path||'.'||key);
 PERFORM private.catalog_vr_text_v1(p_row->'notes',p_path||'.notes',true,CASE WHEN p_kind='visit_request' THEN 2000 ELSE NULL END);
 IF p_kind='schedule' THEN
  PERFORM private.catalog_vr_uuid_v1(p_row->'sales_person_id',p_path||'.sales_person_id');
  PERFORM private.catalog_vr_uuid_v1(p_row->'assigned_by',p_path||'.assigned_by');
  PERFORM private.catalog_vr_date_v1(p_row->'scheduled_date',p_path||'.scheduled_date');
  PERFORM private.catalog_vr_text_v1(p_row->'created_at',p_path||'.created_at',true);
  PERFORM private.catalog_vr_require_v1(p_row->>'status' IN('pending','completed','missed'),'UNKNOWN_SHAPE',p_path||'.status');
  version:=private.catalog_vr_version_v1(p_row->'version',p_path||'.version');
  expect:=jsonb_build_object('scheduleVersion',version::text,'scheduledDate',p_row->>'scheduled_date');
 ELSIF p_kind='visit_request' THEN
  PERFORM private.catalog_vr_uuid_v1(p_row->'requester_id',p_path||'.requester_id');
  PERFORM private.catalog_vr_uuid_v1(p_row->'reviewer_id',p_path||'.reviewer_id',true);
  PERFORM private.catalog_vr_text_v1(p_row->'created_at',p_path||'.created_at');
  PERFORM private.catalog_vr_text_v1(p_row->'decided_at',p_path||'.decided_at',true);
  PERFORM private.catalog_vr_date_v1(p_row->'scheduled_date',p_path||'.scheduled_date');
  PERFORM private.catalog_vr_require_v1(p_row->>'kind' IN('new','amendment') AND p_row->>'status' IN('pending','approved','rejected','withdrawn'),'UNKNOWN_SHAPE',p_path);
  version:=private.catalog_vr_version_v1(p_row->'version',p_path||'.version'); expect:=jsonb_build_object('requestVersion',version::text,'requestKind',p_row->>'kind','requestStatus',p_row->>'status');
  linked:=private.catalog_vr_uuid_v1(p_row->'source_schedule_id',p_path||'.source_schedule_id',true);
  IF p_row->>'kind'='new' THEN
   PERFORM private.catalog_vr_require_v1(linked IS NULL AND p_row->'base_version'='null'::jsonb,'CONTRADICTORY_LINEAGE',p_path||'.source_schedule_id');
  ELSE
   PERFORM private.catalog_vr_require_v1(linked IS NOT NULL,'CONTRADICTORY_LINEAGE',p_path||'.source_schedule_id');
   version:=private.catalog_vr_version_v1(p_row->'base_version',p_path||'.base_version');
   expect:=expect||jsonb_build_object('sourceScheduleId',linked,'baseVersion',version::text);
   -- Amendment source customer may differ. Do not invent the target scope.
   edges:=edges||jsonb_build_array(private.catalog_vr_edge_v1('schedule',linked,p_path||'.source_schedule_id',jsonb_build_object('scheduleVersion',version::text)));
  END IF;
  linked:=private.catalog_vr_uuid_v1(p_row->'approved_schedule_id',p_path||'.approved_schedule_id',true);
  IF linked IS NOT NULL THEN
   expect:=expect||jsonb_build_object('approvedScheduleId',linked);
   edges:=edges||jsonb_build_array(private.catalog_vr_edge_v1('schedule',linked,p_path||'.approved_schedule_id','{}',customer));
  END IF;
  PERFORM private.catalog_vr_require_v1((p_row->>'status'='approved')=(linked IS NOT NULL),'CONTRADICTORY_LINEAGE',p_path||'.approved_schedule_id');
 ELSE
  PERFORM private.catalog_vr_uuid_v1(p_row->'sales_person_id',p_path||'.sales_person_id');
  PERFORM private.catalog_vr_text_v1(p_row->'checked_in_at',p_path||'.checked_in_at');
  PERFORM private.catalog_vr_coordinates_v1(p_row,p_path);
  version:=private.catalog_vr_version_v1(p_row->'note_version',p_path||'.note_version'); expect:=jsonb_build_object('noteVersion',version::text);
  linked:=private.catalog_vr_uuid_v1(p_row->'schedule_id',p_path||'.schedule_id',true);
  IF linked IS NOT NULL THEN
   expect:=expect||jsonb_build_object('scheduleId',linked);
   edges:=edges||jsonb_build_array(private.catalog_vr_edge_v1('schedule',linked,p_path||'.schedule_id','{}',customer));
  END IF;
 END IF;
 ref:=jsonb_build_object('kind','customer','id',customer);
 RETURN jsonb_build_object('refs',jsonb_build_array(ref),'edges',jsonb_build_array(private.catalog_vr_edge_v1(p_kind,identity,p_path||'.id',expect,customer))||edges,
 'origins',jsonb_build_array(jsonb_build_object('ref',ref,'rowSide',p_side,'path',p_path||'.'||key)));
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_vr_snapshot_v1(text,jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_vr_workflow_v1(p_operation text,p_before jsonb,p_after jsonb,p_resource text,p_actor text,p_path text,p_side text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE b jsonb:=p_before; a jsonb:=p_after; bs jsonb; ns jsonb; item jsonb; part jsonb; rows jsonb:='[]';
 refs jsonb:='[]'; edges jsonb:='[]'; origins jsonb:='[]'; kind text; absent boolean;
BEGIN
 PERFORM private.catalog_vr_require_v1(p_operation IN('propose_visit','amend_visit','create_schedule','edit_schedule','delete_schedule','approve_request','reject_request','withdraw_request','edit_visit_note'),'UNKNOWN_OPERATION',p_path||'.operation');
 IF p_operation='approve_request' THEN
  PERFORM private.catalog_vr_require_v1(private.catalog_vr_keys_v1(b,ARRAY['request','schedule']),'UNKNOWN_SHAPE',p_path||'.old_value');
  PERFORM private.catalog_vr_require_v1(private.catalog_vr_keys_v1(a,ARRAY['request','schedule']),'UNKNOWN_SHAPE',p_path||'.new_value');
  bs:=b->'schedule'; ns:=a->'schedule'; b:=b->'request'; a:=a->'request';
  -- Pinned native unassigned composite can be JSON null or exact all-null row.
  -- Missing schedule key, partial-null row and null amendment are not absence.
  IF bs='null'::jsonb THEN absent:=true;
  ELSIF private.catalog_vr_keys_v1(bs,ARRAY['id','outlet_id','sales_person_id','assigned_by','scheduled_date','status','notes','created_at','version']) THEN
   absent:=NOT EXISTS(SELECT 1 FROM jsonb_each(bs) e WHERE e.value<>'null'::jsonb);
  ELSE absent:=false; END IF;
  rows:=jsonb_build_array(jsonb_build_object('kind','visit_request','row',b,'path',p_path||'.old_value.request'),
    jsonb_build_object('kind','visit_request','row',a,'path',p_path||'.new_value.request'),
    jsonb_build_object('kind','schedule','row',ns,'path',p_path||'.new_value.schedule'));
  IF NOT absent THEN rows:=rows||jsonb_build_array(jsonb_build_object('kind','schedule','row',bs,'path',p_path||'.old_value.schedule')); END IF;
 ELSE
  kind:=CASE WHEN p_operation IN('propose_visit','reject_request','withdraw_request') THEN 'visit_request'
   WHEN p_operation='edit_visit_note' THEN 'visit' ELSE 'schedule' END;
  IF p_operation IN('propose_visit','create_schedule') THEN
   PERFORM private.catalog_vr_require_v1(b='null'::jsonb,'UNKNOWN_SHAPE',p_path||'.old_value');
  ELSE rows:=rows||jsonb_build_array(jsonb_build_object('kind',kind,'row',b,'path',p_path||'.old_value')); END IF;
  IF p_operation='delete_schedule' THEN
   PERFORM private.catalog_vr_require_v1(a='null'::jsonb,'UNKNOWN_SHAPE',p_path||'.new_value');
  ELSE rows:=rows||jsonb_build_array(jsonb_build_object('kind',CASE WHEN p_operation='amend_visit' THEN 'visit_request' ELSE kind END,'row',a,'path',p_path||'.new_value')); END IF;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(rows) LOOP
  part:=private.catalog_vr_snapshot_v1(item->>'kind',item->'row',item->>'path',p_side);
  refs:=refs||(part->'refs'); edges:=edges||(part->'edges'); origins:=origins||(part->'origins');
 END LOOP;
 -- Bind the operation-typed resource, never infer kind from UUID text.
 PERFORM private.catalog_vr_require_v1(p_resource=private.catalog_vr_uuid_v1(CASE WHEN p_operation='delete_schedule' THEN b->'id' ELSE a->'id' END,p_path||'.resource_id'),'CONTRADICTORY_LINEAGE',p_path||'.resource_id');
 IF p_operation IN('propose_visit','amend_visit') THEN
  PERFORM private.catalog_vr_require_v1(a->>'requester_id'=p_actor AND a->>'status'='pending' AND a->'version'='1'::jsonb
   AND a->'reviewer_id'='null'::jsonb AND a->'decided_at'='null'::jsonb AND a->'approved_schedule_id'='null'::jsonb,'CONTRADICTORY_LINEAGE',p_path||'.new_value');
  IF p_operation='propose_visit' THEN
   PERFORM private.catalog_vr_require_v1(a->>'kind'='new','CONTRADICTORY_LINEAGE',p_path||'.new_value.kind');
  ELSE
   PERFORM private.catalog_vr_require_v1(a->>'kind'='amendment' AND (a->>'source_schedule_id')::uuid=(b->>'id')::uuid
    AND a->'base_version'=b->'version' AND (a->>'requester_id')::uuid=(b->>'sales_person_id')::uuid,'CONTRADICTORY_LINEAGE',p_path||'.new_value.source_schedule_id');
  END IF;
 ELSIF p_operation='create_schedule' THEN
  PERFORM private.catalog_vr_require_v1(a->'version'='1'::jsonb AND a->>'assigned_by'=p_actor,'CONTRADICTORY_LINEAGE',p_path||'.new_value');
 ELSIF p_operation='edit_schedule' THEN
  PERFORM private.catalog_vr_require_v1((a->>'id')::uuid=(b->>'id')::uuid AND a->'assigned_by'=b->'assigned_by' AND a->'created_at'=b->'created_at'
   AND (a->>'version')::numeric=(b->>'version')::numeric+1,'CONTRADICTORY_LINEAGE',p_path||'.new_value');
 ELSIF p_operation='edit_visit_note' THEN
  PERFORM private.catalog_vr_require_v1((a-'notes'-'note_version')=(b-'notes'-'note_version')
   AND (a->>'note_version')::numeric=(b->>'note_version')::numeric+1,'CONTRADICTORY_LINEAGE',p_path||'.new_value');
 ELSIF p_operation IN('approve_request','reject_request','withdraw_request') THEN
  PERFORM private.catalog_vr_require_v1((a-'status'-'reviewer_id'-'decided_at'-'version'-'approved_schedule_id')=(b-'status'-'reviewer_id'-'decided_at'-'version'-'approved_schedule_id')
   AND b->>'status'='pending' AND (a->>'version')::numeric=(b->>'version')::numeric+1
   AND a->>'status'=CASE p_operation WHEN 'approve_request' THEN 'approved' WHEN 'reject_request' THEN 'rejected' ELSE 'withdrawn' END
   AND a->'decided_at'<>'null'::jsonb,'CONTRADICTORY_LINEAGE',p_path||'.new_value');
  PERFORM private.catalog_vr_require_v1(CASE WHEN p_operation='withdraw_request' THEN a->'reviewer_id'='null'::jsonb AND a->>'requester_id'=p_actor ELSE a->>'reviewer_id'=p_actor END,'CONTRADICTORY_LINEAGE',p_path||'.new_value.reviewer_id');
  IF p_operation='approve_request' THEN
   PERFORM private.catalog_vr_require_v1((a->>'approved_schedule_id')::uuid=(ns->>'id')::uuid
    AND (a->>'customer_id')::uuid=(ns->>'outlet_id')::uuid AND (a->>'requester_id')::uuid=(ns->>'sales_person_id')::uuid
    AND a->'scheduled_date'=ns->'scheduled_date' AND a->'notes'=ns->'notes','CONTRADICTORY_LINEAGE',p_path||'.new_value.schedule');
   IF b->>'kind'='new' THEN
    PERFORM private.catalog_vr_require_v1(absent AND ns->'version'='1'::jsonb AND ns->>'assigned_by'=p_actor,'CONTRADICTORY_LINEAGE',p_path||'.old_value.schedule');
   ELSE
    PERFORM private.catalog_vr_require_v1(NOT absent AND (b->>'source_schedule_id')::uuid=(bs->>'id')::uuid
     AND b->'base_version'=bs->'version' AND (b->>'requester_id')::uuid=(bs->>'sales_person_id')::uuid
     AND (ns->>'id')::uuid=(bs->>'id')::uuid AND (ns->>'version')::numeric=(bs->>'version')::numeric+1
     AND ns->'assigned_by'=bs->'assigned_by' AND ns->'created_at'=bs->'created_at','CONTRADICTORY_LINEAGE',p_path||'.old_value.schedule');
   END IF;
  ELSE
   PERFORM private.catalog_vr_require_v1(a->'approved_schedule_id'=b->'approved_schedule_id','CONTRADICTORY_LINEAGE',p_path||'.new_value.approved_schedule_id');
  END IF;
 END IF;
 -- Preserve the audit resource occurrence independently of embedded row IDs.
 kind:=CASE WHEN p_operation IN('create_schedule','edit_schedule','delete_schedule') THEN 'schedule' WHEN p_operation='edit_visit_note' THEN 'visit' ELSE 'visit_request' END;
 part:=private.catalog_vr_snapshot_v1(kind,CASE WHEN p_operation='delete_schedule' THEN b ELSE a END,p_path||CASE WHEN p_operation='delete_schedule' THEN '.old_value' WHEN p_operation='approve_request' THEN '.new_value.request' ELSE '.new_value' END,p_side);
 edges:=edges||jsonb_build_array((part#>'{edges,0}')||jsonb_build_object('origin',p_path||'.resource_id'));
 RETURN jsonb_build_object('refs',refs,'edges',edges,'origins',origins);
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_vr_workflow_v1(text,jsonb,jsonb,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_extract_visit_reference_event_v1(p_relation regclass,p_op text,p_old jsonb,p_new jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE r jsonb; payload jsonb; receipt jsonb; authority jsonb; part jsonb; ref jsonb; expect jsonb; side text; operation text;
 actor text; customer text; source_customer text; person text; target text; result_id text; kind text; key text; path text;
 allowed text[]; required text[]; expected_version numeric; result_version numeric; refs jsonb:='[]'; edges jsonb:='[]'; origins jsonb:='[]';
 error_code text; error_path text;
BEGIN
 PERFORM private.catalog_vr_require_v1(p_relation IN('private.pilot_schedule_requests'::regclass,'private.pilot_visit_requests'::regclass,'private.pilot_visit_workflow_audit'::regclass),'UNKNOWN_RELATION','relation');
 PERFORM private.catalog_vr_require_v1((p_op='INSERT' AND p_old IS NULL AND p_new IS NOT NULL AND p_new<>'null'::jsonb)
 OR (p_op='UPDATE' AND p_old IS NOT NULL AND p_new IS NOT NULL AND p_old<>'null'::jsonb AND p_new<>'null'::jsonb)
 OR (p_op='DELETE' AND p_old IS NOT NULL AND p_old<>'null'::jsonb AND p_new IS NULL),'INVALID_EVENT','event');
 FOREACH side IN ARRAY ARRAY['OLD','NEW'] LOOP
  r:=CASE side WHEN 'OLD' THEN p_old ELSE p_new END;IF r IS NULL THEN CONTINUE; END IF;
  PERFORM private.catalog_vr_require_v1(private.catalog_vr_keys_v1(r,CASE WHEN p_relation='private.pilot_visit_workflow_audit'::regclass
   THEN ARRAY['id','actor_id','request_id','operation','resource_id','old_value','new_value','changed_at']
   WHEN p_relation='private.pilot_schedule_requests'::regclass THEN ARRAY['actor_id','request_id','operation','payload','authority','result','abandoned','created_at']
   ELSE ARRAY['actor_id','request_id','operation','payload','result','abandoned','created_at'] END),'UNKNOWN_SHAPE',side);
  actor:=private.catalog_vr_uuid_v1(r->'actor_id',side||'.actor_id');PERFORM private.catalog_vr_uuid_v1(r->'request_id',side||'.request_id');
  PERFORM private.catalog_vr_text_v1(r->'operation',side||'.operation');operation:=r->>'operation';
  IF p_relation='private.pilot_visit_workflow_audit'::regclass THEN
   PERFORM private.catalog_vr_uuid_v1(r->'id',side||'.id');target:=private.catalog_vr_uuid_v1(r->'resource_id',side||'.resource_id');
   PERFORM private.catalog_vr_text_v1(r->'changed_at',side||'.changed_at');
   part:=private.catalog_vr_workflow_v1(operation,r->'old_value',r->'new_value',target,actor,side,side);
   refs:=refs||(part->'refs');edges:=edges||(part->'edges');origins:=origins||(part->'origins');CONTINUE;
  END IF;
  PERFORM private.catalog_vr_text_v1(r->'created_at',side||'.created_at');
  PERFORM private.catalog_vr_require_v1(jsonb_typeof(r->'abandoned')='boolean','UNKNOWN_SHAPE',side||'.abandoned');
  payload:=r->'payload';receipt:=r->'result';authority:=r->'authority';
  IF operation=(CASE WHEN p_relation='private.pilot_schedule_requests'::regclass THEN 'schedule_recovery_abandoned' ELSE 'visit_recovery_abandoned' END) THEN
   PERFORM private.catalog_vr_require_v1(private.catalog_vr_keys_v1(payload,ARRAY[]::text[]),'UNKNOWN_SHAPE',side||'.payload');
   IF p_relation='private.pilot_schedule_requests'::regclass THEN PERFORM private.catalog_vr_require_v1(private.catalog_vr_keys_v1(authority,ARRAY[]::text[]),'UNKNOWN_SHAPE',side||'.authority'); END IF;
   PERFORM private.catalog_vr_require_v1(r->'abandoned'='true'::jsonb AND receipt='null'::jsonb,'UNKNOWN_SHAPE',side);CONTINUE;
  END IF;
  IF p_relation='private.pilot_visit_requests'::regclass THEN
   PERFORM private.catalog_vr_require_v1(operation='finalize_visit','UNKNOWN_OPERATION',side||'.operation');
   PERFORM private.catalog_vr_require_v1(jsonb_typeof(payload)='object','UNKNOWN_SHAPE',side||'.payload');
   PERFORM private.catalog_vr_require_v1(payload ?& ARRAY['customer_id','scheduled_date','expected_schedule_version'],'UNSUPPORTED_LEGACY_PROFILE',side||'.payload');
   PERFORM private.catalog_vr_require_v1(private.catalog_vr_keys_v1(payload,ARRAY['schedule_id','expected_schedule_version','customer_id','scheduled_date','storage_path'],ARRAY['lat','lng','notes']),'UNKNOWN_SHAPE',side||'.payload');
   target:=private.catalog_vr_uuid_v1(payload->'schedule_id',side||'.payload.schedule_id');customer:=private.catalog_vr_uuid_v1(payload->'customer_id',side||'.payload.customer_id');
   expected_version:=private.catalog_vr_version_v1(payload->'expected_schedule_version',side||'.payload.expected_schedule_version',true);
   PERFORM private.catalog_vr_date_v1(payload->'scheduled_date',side||'.payload.scheduled_date');
   PERFORM private.catalog_vr_text_v1(payload->'storage_path',side||'.payload.storage_path');
   path:=payload->>'storage_path';
   PERFORM private.catalog_vr_require_v1(array_length(string_to_array(path,'/'),1)=3 AND split_part(path,'/',1)='visits'
    AND split_part(path,'/',2)=target AND split_part(path,'/',3) NOT IN('','.','..'),'CONTRADICTORY_LINEAGE',side||'.payload.storage_path');
   IF payload?'notes' THEN PERFORM private.catalog_vr_text_v1(payload->'notes',side||'.payload.notes',true,2000); END IF;
   PERFORM private.catalog_vr_coordinates_v1(payload,side||'.payload');
   ref:=jsonb_build_object('kind','customer','id',customer);refs:=refs||jsonb_build_array(ref);
   origins:=origins||jsonb_build_array(jsonb_build_object('ref',ref,'rowSide',side,'path',side||'.payload.customer_id'));
   expect:=jsonb_build_object('scheduleVersion',expected_version::text,'scheduledDate',payload->>'scheduled_date');
   edges:=edges||jsonb_build_array(private.catalog_vr_edge_v1('schedule',target,side||'.payload.schedule_id',expect,customer));
   IF receipt<>'null'::jsonb THEN
    PERFORM private.catalog_vr_require_v1(private.catalog_vr_keys_v1(receipt,ARRAY['id']),'UNKNOWN_SHAPE',side||'.result');
    result_id:=private.catalog_vr_uuid_v1(receipt->'id',side||'.result.id');
    edges:=edges||jsonb_build_array(private.catalog_vr_edge_v1('visit',result_id,side||'.result.id',jsonb_build_object('scheduleId',target),customer));
   END IF;
  ELSE
   PERFORM private.catalog_vr_require_v1(operation IN('propose_visit','amend_visit','create_schedule','edit_schedule','delete_schedule','approve_request','reject_request','withdraw_request','edit_visit_note'),'UNKNOWN_OPERATION',side||'.operation');
   PERFORM private.catalog_vr_require_v1(private.catalog_vr_keys_v1(authority,ARRAY['sales_person_id','customer_id','source_customer_id']),'UNKNOWN_SHAPE',side||'.authority');
   person:=private.catalog_vr_uuid_v1(authority->'sales_person_id',side||'.authority.sales_person_id');customer:=private.catalog_vr_uuid_v1(authority->'customer_id',side||'.authority.customer_id');
   source_customer:=private.catalog_vr_uuid_v1(authority->'source_customer_id',side||'.authority.source_customer_id',true);
   IF operation IN('amend_visit','edit_schedule','delete_schedule') THEN
    PERFORM private.catalog_vr_require_v1(source_customer IS NOT NULL,'CONTRADICTORY_LINEAGE',side||'.authority.source_customer_id');
   ELSIF operation IN('propose_visit','create_schedule','edit_visit_note') THEN
    PERFORM private.catalog_vr_require_v1(source_customer IS NULL,'CONTRADICTORY_LINEAGE',side||'.authority.source_customer_id');
   END IF;
   IF operation='delete_schedule' THEN PERFORM private.catalog_vr_require_v1(customer=source_customer,'CONTRADICTORY_LINEAGE',side||'.authority.customer_id'); END IF;
   FOREACH key IN ARRAY ARRAY['customer_id','source_customer_id'] LOOP
    result_id:=private.catalog_vr_uuid_v1(authority->key,side||'.authority.'||key,key='source_customer_id');
    IF result_id IS NOT NULL THEN ref:=jsonb_build_object('kind','customer','id',result_id);refs:=refs||jsonb_build_array(ref);
     origins:=origins||jsonb_build_array(jsonb_build_object('ref',ref,'rowSide',side,'path',side||'.authority.'||key)); END IF;
   END LOOP;
   required:=CASE operation
    WHEN 'propose_visit' THEN ARRAY['customer_id','scheduled_date']
    WHEN 'amend_visit' THEN ARRAY['schedule_id','expected_version','customer_id','scheduled_date']
    WHEN 'create_schedule' THEN ARRAY['customer_id','sales_person_id','scheduled_date']
    WHEN 'edit_schedule' THEN ARRAY['schedule_id','expected_version','customer_id','sales_person_id','scheduled_date']
    WHEN 'delete_schedule' THEN ARRAY['schedule_id','expected_version']
    WHEN 'edit_visit_note' THEN ARRAY['visit_id','expected_version'] ELSE ARRAY['request_id','expected_version'] END;
   allowed:=CASE WHEN operation IN('propose_visit','amend_visit','create_schedule','edit_schedule','edit_visit_note') THEN ARRAY['notes'] ELSE ARRAY[]::text[] END;
   PERFORM private.catalog_vr_require_v1(private.catalog_vr_keys_v1(payload,required,allowed),'UNKNOWN_SHAPE',side||'.payload');
   IF payload?'notes' THEN PERFORM private.catalog_vr_text_v1(payload->'notes',side||'.payload.notes',true,2000); END IF;
   IF payload?'customer_id' THEN
    result_id:=private.catalog_vr_uuid_v1(payload->'customer_id',side||'.payload.customer_id');
    PERFORM private.catalog_vr_require_v1(result_id=customer,'CONTRADICTORY_LINEAGE',side||'.payload.customer_id');
    ref:=jsonb_build_object('kind','customer','id',result_id);refs:=refs||jsonb_build_array(ref);
    origins:=origins||jsonb_build_array(jsonb_build_object('ref',ref,'rowSide',side,'path',side||'.payload.customer_id'));
    PERFORM private.catalog_vr_date_v1(payload->'scheduled_date',side||'.payload.scheduled_date');
   END IF;
   IF payload?'sales_person_id' THEN
    result_id:=private.catalog_vr_uuid_v1(payload->'sales_person_id',side||'.payload.sales_person_id');
    PERFORM private.catalog_vr_require_v1(result_id=person,'CONTRADICTORY_LINEAGE',side||'.payload.sales_person_id');
   END IF;
   IF operation IN('propose_visit','amend_visit','withdraw_request','edit_visit_note') THEN
    PERFORM private.catalog_vr_require_v1(person=actor,'CONTRADICTORY_LINEAGE',side||'.authority.sales_person_id');
   END IF;
   expected_version:=NULL;target:=NULL;
   IF payload?'expected_version' THEN expected_version:=private.catalog_vr_version_v1(payload->'expected_version',side||'.payload.expected_version',true); END IF;
   IF operation NOT IN('propose_visit','create_schedule') THEN
    key:=CASE WHEN operation IN('amend_visit','edit_schedule','delete_schedule') THEN 'schedule_id' WHEN operation='edit_visit_note' THEN 'visit_id' ELSE 'request_id' END;
    target:=private.catalog_vr_uuid_v1(payload->key,side||'.payload.'||key);
    kind:=CASE WHEN key='schedule_id' THEN 'schedule' WHEN key='visit_id' THEN 'visit' ELSE 'visit_request' END;
    expect:=jsonb_build_object(CASE kind WHEN 'schedule' THEN 'scheduleVersion' WHEN 'visit' THEN 'noteVersion' ELSE 'requestVersion' END,expected_version::text);
    edges:=edges||jsonb_build_array(private.catalog_vr_edge_v1(kind,target,side||'.payload.'||key,expect,CASE WHEN kind='schedule' THEN source_customer ELSE customer END));
   END IF;
   IF receipt<>'null'::jsonb THEN
    required:=CASE WHEN operation='approve_request' THEN ARRAY['id','version','status','schedule_id','schedule_version']
     WHEN operation IN('propose_visit','amend_visit','reject_request','withdraw_request') THEN ARRAY['id','version','status']
     WHEN operation='delete_schedule' THEN ARRAY['id','version','deleted'] ELSE ARRAY['id','version'] END;
    PERFORM private.catalog_vr_require_v1(private.catalog_vr_keys_v1(receipt,required),'UNKNOWN_SHAPE',side||'.result');
    result_id:=private.catalog_vr_uuid_v1(receipt->'id',side||'.result.id');result_version:=private.catalog_vr_version_v1(receipt->'version',side||'.result.version');
    IF operation NOT IN('propose_visit','amend_visit','create_schedule') THEN PERFORM private.catalog_vr_require_v1(result_id=target,'CONTRADICTORY_LINEAGE',side||'.result.id'); END IF;
    PERFORM private.catalog_vr_require_v1(result_version=CASE WHEN operation IN('propose_visit','amend_visit','create_schedule') THEN 1 ELSE expected_version+1 END,'CONTRADICTORY_LINEAGE',side||'.result.version');
    kind:=CASE WHEN operation IN('create_schedule','edit_schedule','delete_schedule') THEN 'schedule' WHEN operation='edit_visit_note' THEN 'visit' ELSE 'visit_request' END;
    expect:=jsonb_build_object(CASE kind WHEN 'schedule' THEN 'scheduleVersion' WHEN 'visit' THEN 'noteVersion' ELSE 'requestVersion' END,
     CASE WHEN operation='delete_schedule' THEN expected_version::text ELSE result_version::text END);
    IF operation='amend_visit' THEN expect:=expect||jsonb_build_object('requestKind','amendment','sourceScheduleId',private.catalog_vr_uuid_v1(payload->'schedule_id',side||'.payload.schedule_id'),'baseVersion',expected_version::text);
    ELSIF operation='propose_visit' THEN expect:=expect||jsonb_build_object('requestKind','new'); END IF;
    IF kind='visit_request' AND receipt?'status' THEN expect:=expect||jsonb_build_object('requestStatus',receipt->>'status'); END IF;
    IF kind='schedule' AND payload?'scheduled_date' THEN expect:=expect||jsonb_build_object('scheduledDate',payload->>'scheduled_date'); END IF;
    IF receipt?'status' THEN
     PERFORM private.catalog_vr_require_v1(receipt->>'status'=CASE operation WHEN 'approve_request' THEN 'approved' WHEN 'reject_request' THEN 'rejected' WHEN 'withdraw_request' THEN 'withdrawn' ELSE 'pending' END,'CONTRADICTORY_LINEAGE',side||'.result.status');
    END IF;
    IF operation='delete_schedule' THEN PERFORM private.catalog_vr_require_v1(receipt->'deleted'='true'::jsonb,'CONTRADICTORY_LINEAGE',side||'.result.deleted'); END IF;
    IF operation='approve_request' THEN
     target:=private.catalog_vr_uuid_v1(receipt->'schedule_id',side||'.result.schedule_id');
     expect:=expect||jsonb_build_object('approvedScheduleId',target);
     edges:=edges||jsonb_build_array(private.catalog_vr_edge_v1('schedule',target,side||'.result.schedule_id',jsonb_build_object('scheduleVersion',private.catalog_vr_version_v1(receipt->'schedule_version',side||'.result.schedule_version')::text),customer));
    END IF;
    edges:=edges||jsonb_build_array(private.catalog_vr_edge_v1(kind,result_id,side||'.result.id',expect,customer));
   END IF;
  END IF;
  IF receipt<>'null'::jsonb THEN PERFORM private.catalog_vr_require_v1(r->'abandoned'='false'::jsonb,'CONTRADICTORY_LINEAGE',side||'.abandoned'); END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(value ORDER BY (value->>'id')::uuid),'[]'::jsonb) INTO refs FROM (SELECT DISTINCT value FROM jsonb_array_elements(refs)) q;
 RETURN jsonb_build_object('ok',true,'extraction',jsonb_build_object('refs',refs,'edges',edges,'historicalNulls','[]'::jsonb,'origins',origins));
EXCEPTION WHEN SQLSTATE 'PCV02' THEN
 GET STACKED DIAGNOSTICS error_code=MESSAGE_TEXT,error_path=PG_EXCEPTION_DETAIL;
 RETURN jsonb_build_object('ok',false,'code',error_code,'path',error_path);
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_extract_visit_reference_event_v1(regclass,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Installation-only metadata gate. No writer registration or permission widening.
DO $owner_acl$
DECLARE signature text; f record;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
 'private.catalog_vr_require_v1(boolean,text,text)','private.catalog_vr_keys_v1(jsonb,text[],text[])',
 'private.catalog_vr_uuid_v1(jsonb,text,boolean)','private.catalog_vr_version_v1(jsonb,text,boolean)',
 'private.catalog_vr_text_v1(jsonb,text,boolean,integer)','private.catalog_vr_date_v1(jsonb,text)',
 'private.catalog_vr_coordinates_v1(jsonb,text)','private.catalog_vr_edge_v1(text,text,text,jsonb,text)',
 'private.catalog_vr_snapshot_v1(text,jsonb,text,text)','private.catalog_vr_workflow_v1(text,jsonb,jsonb,text,text,text,text)',
 'private.catalog_extract_visit_reference_event_v1(regclass,text,jsonb,jsonb)'] LOOP
  SELECT p.* INTO STRICT f FROM pg_catalog.pg_proc p WHERE p.oid=signature::regprocedure;
  IF f.proowner<>'postgres'::regrole OR f.prosecdef OR f.provolatile<>'i' OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']
   OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a WHERE a.grantee<>f.proowner) THEN
   RAISE EXCEPTION 'CATALOGUE_VISIT_REFERENCE_ACL_DRIFT' USING ERRCODE='42501';
  END IF;
 END LOOP;
END $owner_acl$;
