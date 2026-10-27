-- LOCAL REVIEW DELTA. Apply only after verified baseline in an authorized atomic transaction.
SET LOCAL search_path=pg_catalog,pg_temp;
ALTER TABLE private.employee_records ADD COLUMN first_name text, ADD COLUMN last_name text;
ALTER TABLE private.employee_records DROP CONSTRAINT employee_records_name_check;
ALTER TABLE private.employee_records ADD CONSTRAINT employee_records_name_check CHECK(name=btrim(name) AND char_length(name) BETWEEN 1 AND 321);
ALTER TABLE private.employee_records DROP CONSTRAINT employee_records_recorded_status_check;
ALTER TABLE private.employee_records ADD CONSTRAINT employee_records_recorded_status_check CHECK(recorded_status IN('draft','active','inactive','ended'));
ALTER TABLE private.employee_records ALTER COLUMN recorded_status SET DEFAULT 'active';
ALTER TABLE private.employee_records ADD CONSTRAINT employee_name_parts CHECK(
 (first_name IS NULL AND last_name IS NULL) OR
 (first_name IS NOT NULL AND first_name=private.employee_trim(first_name) AND char_length(first_name) BETWEEN 1 AND 160
 AND (last_name IS NULL OR (last_name=private.employee_trim(last_name) AND char_length(last_name) BETWEEN 1 AND 160))
 AND name=first_name||coalesce(' '||last_name,'')));
-- No legacy backfill. Existing generated numbers require explicit review, never reuse.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM private.employee_number_claims WHERE normalized_number~'^p[0-9]{5}$')
 OR EXISTS(SELECT 1 FROM private.employee_records WHERE employee_number~*'^p[0-9]{5}$') THEN
 RAISE EXCEPTION 'EMPLOYEE_NUMBER_BOOTSTRAP_REVIEW_REQUIRED'; END IF; END $$;
CREATE TABLE private.employee_number_counter(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),last_value integer NOT NULL CHECK(last_value BETWEEN 0 AND 99999));
INSERT INTO private.employee_number_counter VALUES(true,0);
ALTER TABLE private.employee_number_counter ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.employee_number_counter FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.employee_number_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 IF TG_TABLE_NAME='employee_number_claims' THEN RAISE EXCEPTION 'EMPLOYEE_NUMBER_CLAIM_PERMANENT' USING ERRCODE='55000'; END IF;
 IF NEW.employee_number IS DISTINCT FROM OLD.employee_number THEN RAISE EXCEPTION 'EMPLOYEE_NUMBER_IMMUTABLE' USING ERRCODE='55000'; END IF; RETURN NEW; END $$;
CREATE TRIGGER employee_number_immutable BEFORE UPDATE OF employee_number ON private.employee_records FOR EACH ROW EXECUTE FUNCTION private.employee_number_immutable();
CREATE TRIGGER employee_number_claim_permanent BEFORE UPDATE OR DELETE ON private.employee_number_claims FOR EACH ROW EXECUTE FUNCTION private.employee_number_immutable();
CREATE FUNCTION private.employee_fields_v2(p_row private.employee_records) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT private.employee_fields(p_row)||jsonb_build_object('firstName',p_row.first_name,'lastName',p_row.last_name); $$;


CREATE FUNCTION private.employee_request_v2(p_employee_id uuid,p_expected_version bigint,p_action text,p_payload jsonb,
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
 keys:=CASE WHEN p_action IN('create_employee','edit_employee') THEN ARRAY['firstName','lastName','jobTitle','team','status']
  WHEN p_action='save_initial_episode' THEN ARRAY['startDate','endDate','sourceReference']
  WHEN p_action='save_reporting' THEN ARRAY['mode','intervals'] ELSE ARRAY['userId'] END;
 IF NOT p_payload?&keys OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE NOT k=ANY(keys)) THEN
  RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 FOREACH key IN ARRAY keys LOOP
  IF p_action<>'save_reporting' AND jsonb_typeof(p_payload->key) NOT IN('string','null') THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF p_action IN('create_employee','edit_employee') THEN
  normalized:=jsonb_build_object('firstName',private.employee_text(p_payload->>'firstName',160,true),
   'lastName',private.employee_text(p_payload->>'lastName',160),'jobTitle',private.employee_text(p_payload->>'jobTitle',120),
   'team',private.employee_text(p_payload->>'team',120),'status',p_payload->>'status');
  IF p_payload->>'status' IS NULL OR p_payload->>'status' NOT IN('active','inactive') THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
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

CREATE FUNCTION private.employee_prepare_v2(p_request jsonb) RETURNS jsonb
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
  IF employee.id IS NOT NULL THEN before_data:=jsonb_build_object('fields',private.employee_fields_v2(employee)); END IF;
  after_data:=jsonb_build_object('fields',jsonb_build_object('firstName',payload->'firstName','lastName',payload->'lastName',
   'name',(payload->>'firstName')||coalesce(' '||(payload->>'lastName'),''),'employeeNumber',employee.employee_number,
   'jobTitle',payload->'jobTitle','team',payload->'team','recordedStatus',payload->'status'));
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

CREATE FUNCTION private.employee_preview_impl_v2(p_employee_id uuid,p_expected_version bigint,p_action text,p_payload jsonb,
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
 RETURN private.employee_prepare_v2(private.employee_request_v2(p_employee_id,p_expected_version,p_action,p_payload,p_reason,p_effective_date,p_source_reference));
END;
$$;

CREATE FUNCTION private.employee_command_impl_v2(p_operation_id uuid,p_employee_id uuid,p_expected_version bigint,p_action text,p_payload jsonb,
 p_reason text,p_effective_date date,p_source_reference text,p_preview_fingerprint text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid; request jsonb; fingerprint text; op private.employee_operations%ROWTYPE; preview jsonb; payload jsonb;
 selected_id uuid; claim_owner uuid; audit_id uuid:=gen_random_uuid(); version bigint; result jsonb; number_value integer; assigned text;
BEGIN
 actor:=private.employee_lock_actor();
 request:=private.employee_request_v2(p_employee_id,p_expected_version,p_action,p_payload,p_reason,p_effective_date,p_source_reference);
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
 preview:=private.employee_prepare_v2(request);
 IF preview->>'previewFingerprint'<>p_preview_fingerprint THEN RAISE EXCEPTION 'PREVIEW_CHANGED' USING ERRCODE='40001'; END IF;
 -- Allocation follows authorization, operation replay, state/version and preview checks.
 IF p_action='create_employee' THEN
  UPDATE private.employee_number_counter SET last_value=last_value+1 WHERE singleton AND last_value<99999 RETURNING last_value INTO number_value;
  IF number_value IS NULL THEN RAISE EXCEPTION 'EMPLOYEE_NUMBER_EXHAUSTED' USING ERRCODE='54000'; END IF;
  assigned:='P'||lpad(number_value::text,5,'0');
 ELSIF p_action='edit_employee' THEN SELECT employee_number INTO assigned FROM private.employee_records WHERE id=p_employee_id; END IF;
 IF p_action IN('create_employee','edit_employee') THEN
  payload:=payload||jsonb_build_object('name',(payload->>'firstName')||coalesce(' '||(payload->>'lastName'),''),'recordedStatus',payload->'status','employeeNumber',assigned);
 END IF;
 -- Contain expected unique races; never expose constraint names or raw row details.
 BEGIN
  IF p_action='create_employee' THEN
   INSERT INTO private.employee_records(id,first_name,last_name,name,employee_number,job_title,team,recorded_status)
    VALUES(p_employee_id,payload->>'firstName',payload->>'lastName',payload->>'name',payload->>'employeeNumber',payload->>'jobTitle',payload->>'team',payload->>'recordedStatus');
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
    UPDATE private.employee_records SET first_name=payload->>'firstName',last_name=payload->>'lastName',name=payload->>'name',employee_number=payload->>'employeeNumber',job_title=payload->>'jobTitle',
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
   coalesce(request->>'sourceReference',CASE WHEN p_action='save_initial_episode' THEN payload->>'sourceReference' END),preview->'before',CASE WHEN p_action IN('create_employee','edit_employee') THEN (SELECT jsonb_build_object('fields',private.employee_fields_v2(e)) FROM private.employee_records e WHERE id=p_employee_id) ELSE preview->'after' END);
 result:=jsonb_build_object('operationId',p_operation_id,'employeeId',p_employee_id,'version',version,'auditEventId',audit_id);
 INSERT INTO private.employee_operations(actor_id,operation_id,employee_id,action,expected_version,request_fingerprint,state,result)
  VALUES(actor,p_operation_id,p_employee_id,p_action,p_expected_version,fingerprint,'completed',result);
 RETURN result;
END;
$$;

ALTER FUNCTION private.employee_command_impl_v1(uuid,uuid,bigint,text,jsonb,text,date,text,text) RENAME TO employee_command_legacy_v1;
REVOKE ALL ON FUNCTION private.employee_command_legacy_v1(uuid,uuid,bigint,text,jsonb,text,date,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.employee_command_impl_v1(p_operation_id uuid,p_employee_id uuid,p_expected_version bigint,p_action text,p_payload jsonb,p_reason text,p_effective_date date,p_source_reference text,p_preview_fingerprint text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ DECLARE actor uuid; BEGIN
 actor:=private.employee_lock_actor();
 IF p_action IN('create_employee','edit_employee') THEN
  IF p_operation_id IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  PERFORM private.employee_lock_operation(actor,p_operation_id);
  IF NOT EXISTS(SELECT 1 FROM private.employee_operations WHERE actor_id=actor AND operation_id=p_operation_id AND state='completed') THEN RAISE EXCEPTION 'CLIENT_UPGRADE_REQUIRED' USING ERRCODE='55000'; END IF;
 END IF;
 RETURN private.employee_command_legacy_v1(p_operation_id,p_employee_id,p_expected_version,p_action,p_payload,p_reason,p_effective_date,p_source_reference,p_preview_fingerprint);
END $$;


CREATE OR REPLACE FUNCTION private.employee_preview_impl_v1(p_employee_id uuid,p_expected_version bigint,p_action text,p_payload jsonb,
 p_reason text,p_effective_date date,p_source_reference text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 PERFORM private.employee_lock_actor();
 IF p_action IN('create_employee','edit_employee') THEN RAISE EXCEPTION 'CLIENT_UPGRADE_REQUIRED' USING ERRCODE='55000'; END IF;
 IF p_action='save_reporting' THEN
  -- Keep the reporting preview's graph, configuration and target mutually coherent.
  PERFORM 1 FROM private.employee_settings WHERE singleton FOR SHARE;
  PERFORM 1 FROM private.employee_reporting_guard WHERE singleton FOR SHARE;
  PERFORM 1 FROM private.employee_records WHERE id=p_employee_id FOR SHARE;
 END IF;
 RETURN private.employee_prepare(private.employee_request(p_employee_id,p_expected_version,p_action,p_payload,p_reason,p_effective_date,p_source_reference));
END;
$$;

CREATE FUNCTION private.employee_page_impl_v2(p_query text,p_status text,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE q text; result_rows jsonb; row_total bigint;
BEGIN
 PERFORM private.employee_require_director();
 q:=private.employee_read_guard(p_query,p_page,p_page_size);
 IF p_status IS NOT NULL AND p_status NOT IN('draft','active','inactive','ended') THEN RAISE EXCEPTION 'Invalid employee status' USING ERRCODE='22023'; END IF;
 WITH matches AS MATERIALIZED (SELECT e.* FROM private.employee_records e WHERE (p_status IS NULL OR e.recorded_status=p_status)
  AND (q='' OR strpos(lower(e.name),lower(q))>0 OR strpos(lower(coalesce(e.employee_number,'')),lower(q))>0)),
 page_rows AS (SELECT * FROM matches ORDER BY name COLLATE "C",id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size)
 SELECT (SELECT count(*) FROM matches),coalesce(jsonb_agg(jsonb_build_object('id',r.id,'version',r.version)||private.employee_fields_v2(r::private.employee_records)
  ORDER BY r.name COLLATE "C",r.id),'[]') INTO row_total,result_rows FROM page_rows r;
 RETURN jsonb_build_object('rows',result_rows,'total',row_total,'page',p_page,'pageSize',p_page_size);
END;
$$;

CREATE FUNCTION private.employee_detail_impl_v2(p_employee_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE employee private.employee_records%ROWTYPE; episode jsonb; account jsonb; reporting jsonb; warnings jsonb:='[]';
 linked private.employee_account_links%ROWTYPE; account_user public.users%ROWTYPE; zone text; today date;
 current_manager uuid; manager_user uuid; manager_quarantined boolean; has_interval boolean;
BEGIN
 PERFORM private.employee_require_director();
 IF p_employee_id IS NULL THEN RAISE EXCEPTION 'Employee id required' USING ERRCODE='22023'; END IF;
 SELECT * INTO employee FROM private.employee_records WHERE id=p_employee_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found' USING ERRCODE='P0002'; END IF;
 SELECT jsonb_build_object('startDate',start_date,'endDate',end_date,'sourceReference',source_reference) INTO episode
 FROM private.employee_episodes WHERE employee_id=p_employee_id;
 SELECT * INTO linked FROM private.employee_account_links WHERE employee_id=p_employee_id;
 IF FOUND THEN
  SELECT * INTO account_user FROM public.users WHERE id=linked.user_id;
  account:=jsonb_build_object('userId',account_user.id,'displayName',account_user.full_name,'email',account_user.email,
   'role',account_user.role,'active',account_user.is_active,'operationalManagerId',account_user.manager_id,
   'operationalManagerName',(SELECT full_name FROM public.users WHERE id=account_user.manager_id),'quarantined',linked.quarantined);
  IF employee.recorded_status='ended' AND account_user.is_active THEN warnings:=warnings||'"ENDED_EMPLOYMENT_ACTIVE_LOGIN"'::jsonb; END IF;
  IF employee.recorded_status='active' AND NOT account_user.is_active THEN warnings:=warnings||'"ACTIVE_EMPLOYMENT_INACTIVE_LOGIN"'::jsonb; END IF;
  IF linked.quarantined THEN warnings:=warnings||'"ACCOUNT_LINK_QUARANTINED"'::jsonb; END IF;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('managerEmployeeId',manager_employee_id,'from',from_date,'until',until_date)
  ORDER BY from_date,ordinal),'[]') INTO reporting FROM private.employee_reporting_intervals
 WHERE employee_id=p_employee_id AND revision=employee.reporting_revision;
 IF account IS NOT NULL THEN
  SELECT timezone INTO zone FROM private.employee_settings WHERE singleton;
  IF zone IS NULL THEN warnings:=warnings||'"REPORTING_COMPARISON_UNAVAILABLE"'::jsonb;
  ELSE
   today:=(statement_timestamp() AT TIME ZONE zone)::date;
   SELECT manager_employee_id,true INTO current_manager,has_interval FROM private.employee_reporting_intervals
   WHERE employee_id=p_employee_id AND revision=employee.reporting_revision AND from_date<=today AND (until_date IS NULL OR today<until_date)
   ORDER BY from_date,ordinal LIMIT 1;
   IF NOT coalesce(has_interval,false) THEN warnings:=warnings||'"REPORTING_COMPARISON_UNAVAILABLE"'::jsonb;
   ELSE
    SELECT user_id,quarantined INTO manager_user,manager_quarantined FROM private.employee_account_links WHERE employee_id=current_manager;
    IF linked.quarantined OR (current_manager IS NOT NULL AND (manager_user IS NULL OR manager_quarantined)) THEN
     warnings:=warnings||'"REPORTING_ACCESS_MANAGER_UNCOMPARABLE"'::jsonb;
    ELSIF manager_user IS DISTINCT FROM account_user.manager_id THEN warnings:=warnings||'"REPORTING_ACCESS_MANAGER_MISMATCH"'::jsonb;
    END IF;
   END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object('id',employee.id,'version',employee.version,'fields',private.employee_fields_v2(employee),
  'episode',episode,'account',account,'reportingRevision',employee.reporting_revision,'reporting',reporting,'warnings',warnings);
END;
$$;

CREATE OR REPLACE FUNCTION private.employee_audit_projection(p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE result jsonb:='{}'; section text; keys text[]; projected jsonb;
BEGIN
 FOREACH section IN ARRAY ARRAY['fields','episode','account'] LOOP
  keys:=CASE section WHEN 'fields' THEN ARRAY['firstName','lastName','name','employeeNumber','jobTitle','team','recordedStatus']
   WHEN 'episode' THEN ARRAY['startDate','endDate','sourceReference'] ELSE ARRAY['userId'] END;
  IF jsonb_typeof(p_data->section)='object' THEN
   SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO projected FROM jsonb_each(p_data->section) WHERE key=ANY(keys)
    AND jsonb_typeof(value) IN('string','null');
   result:=result||jsonb_build_object(section,projected);
  END IF;
 END LOOP;
 IF jsonb_typeof(p_data->'reporting')='array' THEN
  SELECT coalesce(jsonb_agg((SELECT coalesce(jsonb_object_agg(key,value),'{}') FROM jsonb_each(item)
   WHERE key IN('managerEmployeeId','from','until') AND jsonb_typeof(value) IN('string','null')) ORDER BY ordinal),'[]')
  INTO projected FROM jsonb_array_elements(p_data->'reporting') WITH ORDINALITY AS items(item,ordinal) WHERE jsonb_typeof(item)='object';
  result:=result||jsonb_build_object('reporting',projected);
 END IF;
 RETURN result;
END;
$$;

CREATE FUNCTION public.employee_preview_v2(p_employee_id uuid,p_expected_version bigint,p_action text,p_payload jsonb,p_reason text,p_effective_date date,p_source_reference text) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$ SELECT private.employee_preview_impl_v2(p_employee_id,p_expected_version,p_action,p_payload,p_reason,p_effective_date,p_source_reference); $$;

CREATE FUNCTION public.employee_command_v2(p_operation_id uuid,p_employee_id uuid,p_expected_version bigint,p_action text,p_payload jsonb,p_reason text,p_effective_date date,p_source_reference text,p_preview_fingerprint text) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$ SELECT private.employee_command_impl_v2(p_operation_id,p_employee_id,p_expected_version,p_action,p_payload,p_reason,p_effective_date,p_source_reference,p_preview_fingerprint); $$;

CREATE FUNCTION public.employee_page_v2(p_query text,p_status text,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp
AS $$ SELECT private.employee_page_impl_v2(p_query,p_status,p_page,p_page_size); $$;

CREATE FUNCTION public.employee_detail_v2(p_employee_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp
AS $$ SELECT private.employee_detail_impl_v2(p_employee_id); $$;

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN('public','private') AND p.proname=ANY(ARRAY['employee_number_immutable','employee_fields_v2','employee_request_v2','employee_prepare_v2',
 'employee_preview_impl_v2','employee_command_impl_v2','employee_page_impl_v2','employee_detail_impl_v2','employee_preview_v2','employee_command_v2','employee_page_v2','employee_detail_v2','employee_command_impl_v1']) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 IF f.proname=ANY(ARRAY['employee_preview_impl_v2','employee_command_impl_v2','employee_page_impl_v2','employee_detail_impl_v2','employee_preview_v2','employee_command_v2','employee_page_v2','employee_detail_v2','employee_command_impl_v1']) THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature); END IF;
 END LOOP;
END $$;
