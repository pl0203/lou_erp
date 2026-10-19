-- UNPUBLISHED CANDIDATE. Transaction-neutral; fixed disposable wrappers only.
-- No account access, operational routing, leave, entitlement or invitation writes.
SET LOCAL search_path = pg_catalog, pg_temp;

-- Match ECMAScript String.trim(), then measure Unicode code points (char_length).
CREATE FUNCTION private.employee_trim(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT btrim(p_value, chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||
  chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||
  chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279));
$$;
CREATE FUNCTION private.employee_text(p_value text,p_limit integer,p_required boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE value text:=nullif(private.employee_trim(p_value),'');
BEGIN
 IF (p_required AND value IS NULL) OR char_length(value)>p_limit THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 RETURN value;
END;
$$;
CREATE FUNCTION private.employee_date(p_value jsonb) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE value date; raw text;
BEGIN
 IF p_value='null'::jsonb THEN RETURN NULL; END IF;
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 raw:=p_value#>>'{}';
 IF raw!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 BEGIN value:=raw::date; EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END;
 IF NOT isfinite(value) OR value<'0001-01-01'::date OR value>'9999-12-31'::date OR to_char(value,'YYYY-MM-DD')<>raw THEN
  RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 RETURN value;
END;
$$;
CREATE FUNCTION private.employee_hash(p_value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$ SELECT encode(sha256(convert_to(p_value::text,'UTF8')),'hex'); $$;

-- Pure normalization is deliberately independent of mutable employee/account state.
-- Completed same-ID replay compares this identity before state-dependent validation.
CREATE FUNCTION private.employee_request(p_employee_id uuid,p_expected_version bigint,p_action text,p_payload jsonb,
 p_reason text,p_effective_date date,p_source_reference text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE keys text[]; key text; normalized jsonb:='{}'; value text; start_date date; end_date date; account uuid;
 reason text; source text; episode_source text;
BEGIN
 IF p_action='add_employment_episode' THEN RAISE EXCEPTION 'REHIRE_DEFERRED' USING ERRCODE='22023'; END IF;
 IF p_action IS NULL OR p_action NOT IN('create_employee','edit_employee','save_initial_episode','link_account','quarantine_account_link','save_reporting') THEN
  RAISE EXCEPTION 'INVALID_ACTION' USING ERRCODE='22023'; END IF;
 IF p_employee_id IS NULL OR p_expected_version IS NULL OR p_expected_version NOT BETWEEN 0 AND 9007199254740991
  OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 reason:=private.employee_text(p_reason,500,true); source:=private.employee_text(p_source_reference,500);
 IF p_effective_date IS NOT NULL AND (NOT isfinite(p_effective_date) OR p_effective_date NOT BETWEEN '0001-01-01'::date AND '9999-12-31'::date) THEN
  RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 keys:=CASE WHEN p_action IN('create_employee','edit_employee') THEN ARRAY['name','employeeNumber','jobTitle','team','recordedStatus']
  WHEN p_action='save_initial_episode' THEN ARRAY['startDate','endDate','sourceReference']
  WHEN p_action='save_reporting' THEN ARRAY['mode','intervals'] ELSE ARRAY['userId'] END;
 IF NOT p_payload?&keys OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE NOT k=ANY(keys)) THEN
  RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 FOREACH key IN ARRAY keys LOOP
  IF p_action<>'save_reporting' AND jsonb_typeof(p_payload->key) NOT IN('string','null') THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF p_action IN('create_employee','edit_employee') THEN
  normalized:=jsonb_build_object('name',private.employee_text(p_payload->>'name',160,true),
   'employeeNumber',private.employee_text(p_payload->>'employeeNumber',64),'jobTitle',private.employee_text(p_payload->>'jobTitle',120),
   'team',private.employee_text(p_payload->>'team',120),'recordedStatus',p_payload->>'recordedStatus');
  IF p_payload->>'recordedStatus' IS NULL OR p_payload->>'recordedStatus' NOT IN('draft','active','ended') THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 ELSIF p_action='save_initial_episode' THEN
  start_date:=private.employee_date(p_payload->'startDate'); end_date:=private.employee_date(p_payload->'endDate');
  IF end_date<start_date THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  episode_source:=private.employee_text(p_payload->>'sourceReference',500);
  IF episode_source IS NOT NULL AND source IS NOT NULL AND episode_source<>source THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  normalized:=jsonb_build_object('startDate',to_char(start_date,'YYYY-MM-DD'),'endDate',to_char(end_date,'YYYY-MM-DD'),'sourceReference',episode_source);
 ELSIF p_action='save_reporting' THEN
  normalized:=private.employee_reporting_request(p_employee_id,p_payload);
  IF normalized->>'mode'='correction' AND source IS NULL THEN RAISE EXCEPTION 'CORRECTION_SOURCE_REQUIRED' USING ERRCODE='22023'; END IF;
 ELSE
  value:=p_payload->>'userId';
  IF value IS NULL OR value!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  account:=value::uuid; normalized:=jsonb_build_object('userId',account);
 END IF;
 RETURN jsonb_build_object('employeeId',p_employee_id,'expectedVersion',p_expected_version,'action',p_action,'payload',normalized,
  'reason',reason,'effectiveDate',to_char(p_effective_date,'YYYY-MM-DD'),'sourceReference',source);
END;
$$;
CREATE FUNCTION private.employee_lock_actor() RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid:=auth.uid(); current_actor uuid;
BEGIN
 -- Lock and recheck the actual row after any concurrent deactivation finishes.
 SELECT id INTO current_actor FROM public.users WHERE id=actor AND is_active AND role='executive' FOR SHARE;
 IF current_actor IS NULL THEN RAISE EXCEPTION 'DIRECTOR_REQUIRED' USING ERRCODE='42501'; END IF;
 RETURN current_actor;
END;
$$;
CREATE FUNCTION private.employee_lock_operation(p_actor uuid,p_operation uuid) RETURNS void
LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
 SELECT pg_advisory_xact_lock(hashtextextended('employee-operation:'||p_actor::text||':'||p_operation::text,0));
$$;

-- Shared state-dependent validator and preview composer. Commit calls only after
-- actor -> operation -> settings -> reporting graph (when needed) -> employee
-- -> selected account locks are held. Reporting helpers live in the next candidate.
CREATE FUNCTION private.employee_prepare(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE target uuid:=(p_request->>'employeeId')::uuid; expected bigint:=(p_request->>'expectedVersion')::bigint;
 action text:=p_request->>'action'; payload jsonb:=p_request->'payload'; employee private.employee_records%ROWTYPE;
 config private.employee_settings%ROWTYPE; before_data jsonb:='{}'; after_data jsonb:='{}'; episode jsonb; selected jsonb;
 selected_id uuid; user_row public.users%ROWTYPE; linked private.employee_account_links%ROWTYPE; context jsonb; fingerprint text; reporting jsonb;
BEGIN
 SELECT * INTO config FROM private.employee_settings WHERE singleton;
 SELECT * INTO employee FROM private.employee_records WHERE id=target;
 IF action='create_employee' THEN
  IF employee.id IS NOT NULL THEN RAISE EXCEPTION 'EMPLOYEE_EXISTS' USING ERRCODE='23505'; END IF;
  IF expected<>0 THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
 ELSE
  IF employee.id IS NULL THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF employee.version<>expected OR employee.version=9007199254740991 THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
 END IF;
 IF p_request->>'effectiveDate' IS NOT NULL AND config.timezone IS NULL THEN RAISE EXCEPTION 'WORKPLACE_TIMEZONE_UNCONFIRMED' USING ERRCODE='55000'; END IF;
 IF action IN('create_employee','edit_employee') THEN
  IF EXISTS(SELECT 1 FROM private.employee_number_claims WHERE normalized_number=lower(payload->>'employeeNumber') AND employee_id<>target) THEN
   RAISE EXCEPTION 'NUMBER_CLAIMED' USING ERRCODE='23505'; END IF;
  IF employee.id IS NOT NULL THEN before_data:=jsonb_build_object('fields',private.employee_fields(employee)); END IF;
  after_data:=jsonb_build_object('fields',payload);
 ELSIF action='save_initial_episode' THEN
  SELECT jsonb_build_object('startDate',to_char(start_date,'YYYY-MM-DD'),'endDate',to_char(end_date,'YYYY-MM-DD'),'sourceReference',source_reference)
   INTO episode FROM private.employee_episodes WHERE employee_id=target;
  IF config.timezone IS NULL AND (payload->>'startDate' IS NOT NULL OR payload->>'endDate' IS NOT NULL OR episode->>'startDate' IS NOT NULL OR episode->>'endDate' IS NOT NULL) THEN
   RAISE EXCEPTION 'WORKPLACE_TIMEZONE_UNCONFIRMED' USING ERRCODE='55000'; END IF;
  IF episode IS NOT NULL THEN before_data:=jsonb_build_object('episode',episode); END IF;
  after_data:=jsonb_build_object('episode',payload);
 ELSIF action='save_reporting' THEN
  reporting:=private.employee_reporting_prepare(p_request);
  before_data:=reporting->'before'; after_data:=reporting->'after';
 ELSE
  selected_id:=(payload->>'userId')::uuid;
  SELECT * INTO user_row FROM public.users WHERE id=selected_id;
  IF user_row.id IS NULL THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  SELECT * INTO linked FROM private.employee_account_links WHERE user_id=selected_id;
  selected:=jsonb_build_object('userId',user_row.id,'displayName',user_row.full_name,'email',user_row.email,'role',user_row.role,
   'active',user_row.is_active,'operationalManagerId',user_row.manager_id,
   'employeeId',linked.employee_id,'quarantined',linked.quarantined);
  IF action='link_account' THEN
   IF linked.user_id IS NOT NULL THEN RAISE EXCEPTION 'ACCOUNT_ALREADY_LINKED' USING ERRCODE='23505'; END IF;
   IF EXISTS(SELECT 1 FROM private.employee_account_links WHERE employee_id=target) THEN RAISE EXCEPTION 'EMPLOYEE_ALREADY_LINKED' USING ERRCODE='23505'; END IF;
  ELSE
   IF linked.employee_id IS DISTINCT FROM target THEN RAISE EXCEPTION 'ACCOUNT_LINK_MISMATCH' USING ERRCODE='55000'; END IF;
   IF linked.quarantined THEN RAISE EXCEPTION 'ACCOUNT_LINK_QUARANTINED' USING ERRCODE='55000'; END IF;
   before_data:=jsonb_build_object('account',jsonb_build_object('userId',selected_id));
  END IF;
  after_data:=jsonb_build_object('account',jsonb_build_object('userId',selected_id));
 END IF;
 context:=private.employee_context_impl_v1();
 fingerprint:=private.employee_hash(jsonb_build_object('request',p_request,'before',before_data,'after',after_data,
  'scopeVersion',context->>'scopeVersion','settingsVersion',config.version,'timezone',config.timezone,
  'selectedAccount',selected,'reportingRevision',coalesce(employee.reporting_revision,0))
  || CASE WHEN action='save_reporting' THEN jsonb_build_object('reportingGraphRevision',reporting->'graphRevision','reportingToday',reporting->'today') ELSE '{}'::jsonb END);
 RETURN jsonb_build_object('employeeId',target,'expectedVersion',expected,'action',action,'normalizedPayload',payload,
  'before',before_data,'after',after_data,'scopeVersion',context->>'scopeVersion','timezone',config.timezone,'previewFingerprint',fingerprint);
END;
$$;
CREATE FUNCTION private.employee_preview_impl_v1(p_employee_id uuid,p_expected_version bigint,p_action text,p_payload jsonb,
 p_reason text,p_effective_date date,p_source_reference text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 PERFORM private.employee_lock_actor();
 IF p_action='save_reporting' THEN
  -- Keep the reporting preview's graph, configuration and target mutually coherent.
  PERFORM 1 FROM private.employee_settings WHERE singleton FOR SHARE;
  PERFORM 1 FROM private.employee_reporting_guard WHERE singleton FOR SHARE;
  PERFORM 1 FROM private.employee_records WHERE id=p_employee_id FOR SHARE;
 END IF;
 RETURN private.employee_prepare(private.employee_request(p_employee_id,p_expected_version,p_action,p_payload,p_reason,p_effective_date,p_source_reference));
END;
$$;
CREATE FUNCTION private.employee_command_impl_v1(p_operation_id uuid,p_employee_id uuid,p_expected_version bigint,p_action text,p_payload jsonb,
 p_reason text,p_effective_date date,p_source_reference text,p_preview_fingerprint text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid; request jsonb; fingerprint text; op private.employee_operations%ROWTYPE; preview jsonb; payload jsonb;
 selected_id uuid; claim_owner uuid; audit_id uuid:=gen_random_uuid(); version bigint; result jsonb;
BEGIN
 actor:=private.employee_lock_actor();
 request:=private.employee_request(p_employee_id,p_expected_version,p_action,p_payload,p_reason,p_effective_date,p_source_reference);
 IF p_operation_id IS NULL OR p_preview_fingerprint IS NULL OR p_preview_fingerprint!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 fingerprint:=private.employee_hash(request||jsonb_build_object('previewFingerprint',p_preview_fingerprint));
 PERFORM private.employee_lock_operation(actor,p_operation_id);
 SELECT * INTO op FROM private.employee_operations WHERE actor_id=actor AND operation_id=p_operation_id;
 IF op.state='abandoned' THEN RAISE EXCEPTION 'OPERATION_ABANDONED' USING ERRCODE='55000'; END IF;
 IF op.state='completed' THEN
  IF op.request_fingerprint<>fingerprint THEN RAISE EXCEPTION 'OPERATION_REUSED' USING ERRCODE='22023'; END IF;
  RETURN op.result;
 END IF;
 PERFORM 1 FROM private.employee_settings WHERE singleton FOR SHARE;
 IF p_action='save_reporting' THEN PERFORM 1 FROM private.employee_reporting_guard WHERE singleton FOR UPDATE; END IF;
 PERFORM 1 FROM private.employee_records WHERE id=p_employee_id FOR UPDATE;
 payload:=request->'payload';
 IF p_action IN('link_account','quarantine_account_link') THEN
  selected_id:=(payload->>'userId')::uuid;
  IF selected_id<>actor THEN PERFORM 1 FROM public.users WHERE id=selected_id FOR SHARE; END IF;
 END IF;
 preview:=private.employee_prepare(request);
 IF preview->>'previewFingerprint'<>p_preview_fingerprint THEN RAISE EXCEPTION 'PREVIEW_CHANGED' USING ERRCODE='40001'; END IF;
 -- Contain expected unique races; never expose constraint names or raw row details.
 BEGIN
  IF p_action='create_employee' THEN
   INSERT INTO private.employee_records(id,name,employee_number,job_title,team,recorded_status)
    VALUES(p_employee_id,payload->>'name',payload->>'employeeNumber',payload->>'jobTitle',payload->>'team',payload->>'recordedStatus');
   version:=1;
  ELSE
   UPDATE private.employee_records SET version=employee_records.version+1,updated_at=clock_timestamp() WHERE id=p_employee_id RETURNING employee_records.version INTO version;
  END IF;
  IF p_action IN('create_employee','edit_employee') THEN
   IF payload->>'employeeNumber' IS NOT NULL THEN
    INSERT INTO private.employee_number_claims(normalized_number,employee_id) VALUES(lower(payload->>'employeeNumber'),p_employee_id)
     ON CONFLICT(normalized_number) DO NOTHING;
    SELECT employee_id INTO claim_owner FROM private.employee_number_claims WHERE normalized_number=lower(payload->>'employeeNumber');
    IF claim_owner<>p_employee_id THEN RAISE EXCEPTION 'NUMBER_CLAIMED' USING ERRCODE='23505'; END IF;
   END IF;
   IF p_action='edit_employee' THEN
    UPDATE private.employee_records SET name=payload->>'name',employee_number=payload->>'employeeNumber',job_title=payload->>'jobTitle',
     team=payload->>'team',recorded_status=payload->>'recordedStatus' WHERE id=p_employee_id;
   END IF;
  ELSIF p_action='save_initial_episode' THEN
   INSERT INTO private.employee_episodes(employee_id,start_date,end_date,source_reference)
    VALUES(p_employee_id,(payload->>'startDate')::date,(payload->>'endDate')::date,payload->>'sourceReference')
    ON CONFLICT(employee_id) DO UPDATE SET start_date=EXCLUDED.start_date,end_date=EXCLUDED.end_date,source_reference=EXCLUDED.source_reference;
  ELSIF p_action='save_reporting' THEN
   PERFORM private.employee_reporting_apply(p_employee_id,payload,actor,request->>'sourceReference');
  ELSIF p_action='link_account' THEN
   INSERT INTO private.employee_account_links(user_id,employee_id) VALUES(selected_id,p_employee_id);
  ELSE
   UPDATE private.employee_account_links SET quarantined=true,quarantined_at=clock_timestamp() WHERE user_id=selected_id AND employee_id=p_employee_id;
  END IF;
 EXCEPTION WHEN unique_violation THEN
  IF p_action='save_reporting' THEN RAISE; END IF;
  IF p_action='create_employee' AND EXISTS(SELECT 1 FROM private.employee_records WHERE id=p_employee_id) THEN RAISE EXCEPTION 'EMPLOYEE_EXISTS' USING ERRCODE='23505'; END IF;
  IF p_action IN('create_employee','edit_employee') THEN RAISE EXCEPTION 'NUMBER_CLAIMED' USING ERRCODE='23505'; END IF;
  IF EXISTS(SELECT 1 FROM private.employee_account_links WHERE user_id=selected_id) THEN RAISE EXCEPTION 'ACCOUNT_ALREADY_LINKED' USING ERRCODE='23505'; END IF;
  RAISE EXCEPTION 'EMPLOYEE_ALREADY_LINKED' USING ERRCODE='23505';
 END;
 INSERT INTO private.employee_audit_events(id,employee_id,actor_id,actor_name,effective_date,action,reason,source_reference,before_data,after_data)
  VALUES(audit_id,p_employee_id,actor,(SELECT full_name FROM public.users WHERE id=actor),p_effective_date,p_action,request->>'reason',
   coalesce(request->>'sourceReference',CASE WHEN p_action='save_initial_episode' THEN payload->>'sourceReference' END),preview->'before',preview->'after');
 result:=jsonb_build_object('operationId',p_operation_id,'employeeId',p_employee_id,'version',version,'auditEventId',audit_id);
 INSERT INTO private.employee_operations(actor_id,operation_id,employee_id,action,expected_version,request_fingerprint,state,result)
  VALUES(actor,p_operation_id,p_employee_id,p_action,p_expected_version,fingerprint,'completed',result);
 RETURN result;
END;
$$;
CREATE FUNCTION private.employee_operation_impl_v1(p_operation_id uuid,p_resolution text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid; op private.employee_operations%ROWTYPE;
BEGIN
 actor:=private.employee_lock_actor();
 IF p_operation_id IS NULL OR p_resolution IS NULL OR p_resolution NOT IN('read','abandon') THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 PERFORM private.employee_lock_operation(actor,p_operation_id);
 SELECT * INTO op FROM private.employee_operations WHERE actor_id=actor AND operation_id=p_operation_id;
 IF NOT FOUND AND p_resolution='abandon' THEN
  INSERT INTO private.employee_operations(actor_id,operation_id,state) VALUES(actor,p_operation_id,'abandoned') RETURNING * INTO op;
 END IF;
 RETURN jsonb_build_object('state',coalesce(op.state,'absent'),'result',op.result);
END;
$$;
CREATE FUNCTION public.employee_preview_v1(p_employee_id uuid,p_expected_version bigint,p_action text,p_payload jsonb,p_reason text,p_effective_date date,p_source_reference text) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$ SELECT private.employee_preview_impl_v1(p_employee_id,p_expected_version,p_action,p_payload,p_reason,p_effective_date,p_source_reference); $$;
CREATE FUNCTION public.employee_command_v1(p_operation_id uuid,p_employee_id uuid,p_expected_version bigint,p_action text,p_payload jsonb,p_reason text,p_effective_date date,p_source_reference text,p_preview_fingerprint text) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$ SELECT private.employee_command_impl_v1(p_operation_id,p_employee_id,p_expected_version,p_action,p_payload,p_reason,p_effective_date,p_source_reference,p_preview_fingerprint); $$;
CREATE FUNCTION public.employee_operation_v1(p_operation_id uuid,p_resolution text) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$ SELECT private.employee_operation_impl_v1(p_operation_id,p_resolution); $$;
-- Revoke only the functions owned by this candidate, preserving prior read grants.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN('public','private') AND p.proname=ANY(ARRAY['employee_trim','employee_text','employee_date','employee_hash','employee_request',
 'employee_lock_actor','employee_lock_operation','employee_prepare','employee_preview_impl_v1','employee_command_impl_v1','employee_operation_impl_v1',
 'employee_preview_v1','employee_command_v1','employee_operation_v1']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',f.signature);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION private.employee_preview_impl_v1(uuid,bigint,text,jsonb,text,date,text),
 private.employee_command_impl_v1(uuid,uuid,bigint,text,jsonb,text,date,text,text),private.employee_operation_impl_v1(uuid,text),
 public.employee_preview_v1(uuid,bigint,text,jsonb,text,date,text),public.employee_command_v1(uuid,uuid,bigint,text,jsonb,text,date,text,text),
 public.employee_operation_v1(uuid,text) TO authenticated;
