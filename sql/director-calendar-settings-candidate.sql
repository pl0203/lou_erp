-- Source-only candidate. No setup rows, roles, accounts or grants are installed.
-- Director calendar authority is separate from all employee/policy/balance/access grants.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
CREATE OR REPLACE FUNCTION private.ihr_leave_is_calendar_director(p_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.users u JOIN public.ihr_leave_members m ON m.user_id=u.id
 WHERE u.id=p_actor AND u.is_active AND u.role='executive' AND m.active AND m.member_kind='director');
$$;
CREATE OR REPLACE FUNCTION private.ihr_leave_calendar_config(p_actor uuid,p_at timestamptz DEFAULT statement_timestamp()) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT p_at IS NOT NULL AND (private.ihr_leave_is_calendar_director(p_actor) OR private.ihr_leave_global_config(p_actor,p_at));
$$;
-- Only append the current group, never assign a new group or rewrite its predecessor.
-- Bounds and published coverage are checked again after the existing setup/scope locks.
CREATE OR REPLACE FUNCTION private.ihr_leave_can_continue_roster(p_actor uuid,p_employee uuid,p_group uuid,p_from date,p_to date,p_at timestamptz) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE m public.ihr_leave_members%ROWTYPE;c public.ihr_leave_calendars%ROWTYPE;z text;today date;
BEGIN
 IF NOT private.ihr_leave_is_calendar_director(p_actor) OR p_actor=p_employee OR p_at IS NULL
  OR p_from IS NULL OR p_to IS NULL OR p_to<=p_from OR p_to-p_from>366 THEN RETURN false;END IF;
 SELECT * INTO m FROM public.ihr_leave_members WHERE user_id=p_employee;
 IF m.user_id IS NULL OR NOT m.active OR m.member_kind NOT IN('employee','manager')
  OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_employee AND is_active) THEN RETURN false;END IF;
 z:=private.ihr_leave_calendar_timezone(m.active_calendar_id);IF z IS NULL THEN RETURN false;END IF;
 today:=(p_at AT TIME ZONE z)::date;
 IF p_from<=today OR NOT EXISTS(SELECT 1 FROM public.ihr_saturday_memberships s JOIN public.ihr_saturday_groups g ON g.id=s.group_id
  WHERE s.employee_id=p_employee AND s.group_id=p_group AND g.calendar_id=m.active_calendar_id
  AND daterange(s.effective_from,s.effective_until,'[)') @> today AND s.effective_until=p_from) THEN RETURN false;END IF;
 SELECT * INTO c FROM public.ihr_leave_calendars WHERE calendar_id=m.active_calendar_id ORDER BY version DESC LIMIT 1;
 IF c.id IS NULL OR c.timezone IS DISTINCT FROM z OR NOT c.holidays_confirmed OR c.sunday_minutes IS DISTINCT FROM 0
  OR c.effective_until IS NULL OR p_from<c.effective_from OR p_to>c.effective_until THEN RETURN false;END IF;
 RETURN NOT EXISTS(SELECT 1 FROM generate_series(0,p_to-p_from-1) n WHERE
  (SELECT x.id FROM public.ihr_leave_calendars x WHERE x.calendar_id=m.active_calendar_id AND daterange(x.effective_from,x.effective_until,'[)') @> (p_from+n) ORDER BY x.version DESC LIMIT 1) IS DISTINCT FROM c.id
  OR (extract(isodow FROM p_from+n)=6 AND NOT EXISTS(SELECT 1 FROM public.ihr_saturday_roster sr WHERE sr.calendar_version_id=c.id AND sr.group_id=p_group AND sr.day=p_from+n)));
END;
$$;

CREATE OR REPLACE FUNCTION private.ihr_leave_roster_continuation_fingerprint(p_employee uuid,p_group uuid,p_from date,p_to date) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('employee',p_employee,'group',to_jsonb(g),'from',p_from,'until',p_to,
  'registryVersion',k.version,'calendar',to_jsonb(c),
  'predecessor',(SELECT jsonb_agg(to_jsonb(sm) ORDER BY sm.id) FROM public.ihr_saturday_memberships sm WHERE sm.employee_id=p_employee AND sm.group_id=p_group AND sm.effective_until=p_from),
  'roster',(SELECT jsonb_agg(to_jsonb(sr) ORDER BY sr.day) FROM (SELECT DISTINCT ON(day) * FROM public.ihr_saturday_roster WHERE calendar_version_id=c.id AND group_id=p_group AND day>=p_from AND day<p_to ORDER BY day,version DESC) sr))::text,'UTF8')),'hex')
 FROM public.ihr_leave_members m JOIN private.ihr_leave_calendar_registry k ON k.id=m.active_calendar_id
 JOIN public.ihr_saturday_groups g ON g.id=p_group AND g.calendar_id=k.id
 CROSS JOIN LATERAL(SELECT * FROM public.ihr_leave_calendars WHERE calendar_id=k.id ORDER BY version DESC LIMIT 1)c
 WHERE m.user_id=p_employee;
$$;

CREATE OR REPLACE FUNCTION private.ihr_leave_calendar_impacts(p_calendar_id uuid,p_from date,p_to date,p_roster_groups uuid[] DEFAULT NULL,p_changed_groups uuid[] DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE pending_count bigint;approved_count bigint;sources jsonb;
BEGIN
 IF NOT private.ihr_leave_calendar_config(private.ihr_leave_require_actor()) THEN RAISE EXCEPTION 'Global configure required' USING ERRCODE='42501';END IF;
 IF p_calendar_id IS NULL OR p_from IS NULL OR (p_to IS NOT NULL AND p_to<=p_from) THEN RAISE EXCEPTION 'Invalid impact range' USING ERRCODE='22023';END IF;
 SELECT count(*) FILTER(WHERE r.status='submitted'),count(*) FILTER(WHERE r.status IN('approved','cancellation_pending')),
 coalesce(jsonb_agg(jsonb_build_array(r.id,r.version,r.status) ORDER BY r.id),'[]') INTO pending_count,approved_count,sources
 FROM public.ihr_leave_requests r WHERE r.status IN('submitted','approved','cancellation_pending')
 AND EXISTS(SELECT 1 FROM public.ihr_leave_request_days d WHERE d.request_id=r.id
  AND d.source_snapshot->'calendar'->>'calendar_id'=p_calendar_id::text
  AND ((d.day>=p_from AND (p_to IS NULL OR d.day<p_to) AND (p_roster_groups IS NULL OR (extract(isodow FROM d.day)=6 AND (d.source_snapshot->'group'->>'id')::uuid=ANY(p_roster_groups))))
   OR (d.source_snapshot->'group'->>'id')::uuid=ANY(p_changed_groups)));
 RETURN jsonb_build_object('available',true,'pendingCount',pending_count,'approvedCount',approved_count,'sourceFingerprint',md5(sources::text));
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_roster_preview_v1(p_calendar_id uuid,p_anchor date,p_groups jsonb,p_from date,p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF NOT private.ihr_leave_calendar_config(private.ihr_leave_require_actor()) THEN RAISE EXCEPTION 'Leave access denied' USING ERRCODE='42501',DETAIL='{"code":"GLOBAL_CONFIG_REQUIRED"}'; END IF;
 RETURN private.ihr_leave_roster_preview(p_calendar_id,p_anchor,p_groups,p_from,p_to);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Invalid roster input' USING ERRCODE='22023',DETAIL='{"code":"INVALID_PAYLOAD"}';
END;
$$;

CREATE OR REPLACE FUNCTION private.ihr_leave_authorize_calendar_command(p_actor uuid,p_operation text,p_payload jsonb,p_authorized_at timestamptz) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_keys text[];v_target uuid;v_field text;v_null_revoke boolean;
BEGIN
 IF p_authorized_at IS NULL OR p_actor IS DISTINCT FROM private.ihr_leave_require_actor() THEN RAISE EXCEPTION 'Invalid authority' USING ERRCODE='42501',DETAIL='{"code":"COMMAND_AUTHORITY_REQUIRED"}'; END IF;
 CASE p_operation
 WHEN 'set_member' THEN v_keys:=ARRAY['employee_id','member_kind','active','employment_start','eligibility_date','calendar_id','expected_version','reason'];
 WHEN 'set_approver' THEN v_keys:=ARRAY['employee_id','approver_id','effective_from','effective_until','replace_assignment_id','expected_version','reason'];
 WHEN 'save_calendar_version' THEN v_keys:=ARRAY['calendar_id','name','effective_from','effective_until','timezone','holidays_confirmed','sunday_minutes','holidays','groups','expected_version','reason','preview_fingerprint'];
 WHEN 'set_group_membership' THEN v_keys:=ARRAY['employee_id','group_id','effective_from','effective_until','replace_membership_id','expected_version','reason'];
 WHEN 'publish_roster' THEN v_keys:=ARRAY['calendar_id','anchor','groups','effective_from','effective_until','preview_fingerprint','expected_version','reason'];
 ELSE RAISE EXCEPTION 'Unsupported operation' USING ERRCODE='22023',DETAIL='{"code":"UNSUPPORTED_OPERATION"}';
 END CASE;
 IF p_operation='set_group_membership' AND private.ihr_leave_is_calendar_director(p_actor) THEN v_keys:=v_keys||ARRAY['continuation_fingerprint'];END IF;
 PERFORM private.ihr_leave_validate_payload(p_payload,v_keys,v_keys);
 IF p_operation IN('set_member','set_group_membership') AND p_actor=(p_payload->>'employee_id')::uuid THEN RAISE EXCEPTION 'Independent setup required' USING ERRCODE='42501',DETAIL='{"code":"SELF_MEMBER_SETUP_DENIED"}'; END IF;
 IF p_operation='set_approver' AND (p_actor=(p_payload->>'approver_id')::uuid OR p_actor=(p_payload->>'employee_id')::uuid) THEN
  RAISE EXCEPTION 'Independent assignment required' USING ERRCODE='42501',DETAIL='{"code":"SELF_APPROVER_ASSIGNMENT_DENIED"}';
 END IF;
 v_null_revoke:=p_operation='set_approver' AND p_payload->'approver_id'='null'::jsonb;
 IF v_null_revoke AND (p_payload->'effective_from'<>'null'::jsonb OR p_payload->'effective_until'<>'null'::jsonb OR p_payload->>'replace_assignment_id' IS NULL) THEN
  RAISE EXCEPTION 'Revocation needs an identified assignment and null dates' USING ERRCODE='22023',DETAIL='{"code":"INVALID_REVOCATION"}';
 END IF;
 FOREACH v_field IN ARRAY ARRAY['employment_start','eligibility_date','effective_from','effective_until','anchor'] LOOP
  IF p_payload ? v_field THEN
   IF p_payload->v_field='null'::jsonb AND (v_field IN('employment_start','eligibility_date','effective_until') OR (v_null_revoke AND v_field='effective_from')) THEN CONTINUE; END IF;
   IF jsonb_typeof(p_payload->v_field) IS DISTINCT FROM 'string' OR (p_payload->>v_field) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Invalid date' USING ERRCODE='22023',DETAIL='{"code":"INVALID_DATE"}'; END IF;
   PERFORM (p_payload->>v_field)::date;
  END IF;
 END LOOP;
 IF jsonb_typeof(p_payload->'expected_version') IS DISTINCT FROM 'number' OR (p_payload->>'expected_version') !~ '^[0-9]+$'
  OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' OR length(btrim(p_payload->>'reason')) NOT BETWEEN 1 AND 1000 THEN
  RAISE EXCEPTION 'Invalid version or reason' USING ERRCODE='22023',DETAIL='{"code":"INVALID_PAYLOAD"}';
 END IF;
 IF p_operation IN('save_calendar_version','publish_roster') THEN
  IF NOT private.ihr_leave_calendar_config(p_actor,p_authorized_at) THEN RAISE EXCEPTION 'Global configure required' USING ERRCODE='42501',DETAIL='{"code":"GLOBAL_CONFIG_REQUIRED"}'; END IF;
 ELSIF p_operation='set_group_membership' AND private.ihr_leave_is_calendar_director(p_actor) THEN
  IF p_payload->'replace_membership_id' IS DISTINCT FROM 'null'::jsonb OR jsonb_typeof(p_payload->'continuation_fingerprint') IS DISTINCT FROM 'string' OR p_payload->>'continuation_fingerprint' !~ '^[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'Only a future continuation of the current group is allowed' USING ERRCODE='42501',DETAIL='{"code":"ROSTER_CONTINUATION_DENIED"}';END IF;
 ELSE
  v_target:=(p_payload->>'employee_id')::uuid;
  IF v_target IS NULL OR NOT private.ihr_leave_has_grant(p_actor,'configure',v_target,p_authorized_at) THEN RAISE EXCEPTION 'Leave access denied' USING ERRCODE='42501',DETAIL='{"code":"ACCESS_DENIED"}'; END IF;
  IF p_operation='set_approver' AND EXISTS(SELECT 1 FROM public.ihr_leave_approvers a WHERE a.id=(p_payload->>'replace_assignment_id')::uuid AND a.employee_id=v_target AND a.approver_id=p_actor) THEN
   RAISE EXCEPTION 'Independent assignment change required' USING ERRCODE='42501',DETAIL='{"code":"SELF_APPROVER_ASSIGNMENT_DENIED"}';
  END IF;
 END IF;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Invalid command input' USING ERRCODE='22023',DETAIL='{"code":"INVALID_PAYLOAD"}';
END;
$$;

CREATE OR REPLACE FUNCTION private.ihr_leave_set_membership(p_actor uuid,p jsonb,p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_member public.ihr_leave_members%ROWTYPE;v_old public.ihr_saturday_memberships%ROWTYPE;v_zone text;
 v_from date:=(p->>'effective_from')::date;v_to date:=(p->>'effective_until')::date;v_id uuid;v_version bigint;
BEGIN
 -- Current authority was reacquired after setup, assignment and scope locks. Replays
 -- return their receipt before dispatch, so source changes never hide a committed result.
 IF private.ihr_leave_is_calendar_director(p_actor) THEN
  IF p->'replace_membership_id' IS DISTINCT FROM 'null'::jsonb OR NOT private.ihr_leave_can_continue_roster(p_actor,(p->>'employee_id')::uuid,(p->>'group_id')::uuid,v_from,v_to,p_at) THEN
   RAISE EXCEPTION 'Only a future continuation of the current group is allowed' USING ERRCODE='42501',DETAIL='{"code":"ROSTER_CONTINUATION_DENIED"}';END IF;
  IF p->>'continuation_fingerprint' IS DISTINCT FROM private.ihr_leave_roster_continuation_fingerprint((p->>'employee_id')::uuid,(p->>'group_id')::uuid,v_from,v_to) THEN
   RAISE EXCEPTION 'Published schedule changed' USING ERRCODE='55000',DETAIL='{"code":"PREVIEW_STALE"}';END IF;
 END IF;
 SELECT * INTO v_member FROM public.ihr_leave_members m WHERE m.user_id=(p->>'employee_id')::uuid;
 IF v_member.version IS DISTINCT FROM (p->>'expected_version')::bigint THEN RAISE EXCEPTION 'Stale member' USING ERRCODE='55000',DETAIL='{"code":"STALE_VERSION"}'; END IF;
 v_zone:=private.ihr_leave_calendar_timezone(v_member.active_calendar_id);
 IF v_zone IS NULL THEN RAISE EXCEPTION 'Timezone unconfirmed' USING ERRCODE='22023',DETAIL='{"code":"TIMEZONE_UNCONFIRMED"}'; END IF;
 IF p_actor=v_member.user_id THEN RAISE EXCEPTION 'Independent setup required' USING ERRCODE='42501',DETAIL='{"code":"SELF_MEMBER_SETUP_DENIED"}'; END IF;
 IF v_member.member_kind='director' OR NOT v_member.active OR v_from IS NULL OR v_from<=(p_at AT TIME ZONE v_zone)::date OR (v_to IS NOT NULL AND v_to<=v_from)
  OR NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=v_member.user_id AND u.is_active)
  OR NOT EXISTS(SELECT 1 FROM public.ihr_saturday_groups g WHERE g.id=(p->>'group_id')::uuid AND g.calendar_id=v_member.active_calendar_id) THEN RAISE EXCEPTION 'Invalid membership' USING ERRCODE='22023',DETAIL='{"code":"INVALID_MEMBERSHIP"}'; END IF;
 IF p->>'replace_membership_id' IS NOT NULL THEN
  SELECT * INTO v_old FROM public.ihr_saturday_memberships m WHERE m.id=(p->>'replace_membership_id')::uuid AND m.employee_id=v_member.user_id;
  IF v_old.id IS NULL OR v_old.effective_from>=v_from OR (v_old.effective_until IS NOT NULL AND v_old.effective_until<v_from) THEN RAISE EXCEPTION 'Membership changed' USING ERRCODE='55000',DETAIL='{"code":"STALE_MEMBERSHIP"}'; END IF;
  UPDATE public.ihr_saturday_memberships SET effective_until=v_from,version=version+1 WHERE id=v_old.id;
 END IF;
 INSERT INTO public.ihr_saturday_memberships(employee_id,group_id,effective_from,effective_until,created_by) VALUES(v_member.user_id,(p->>'group_id')::uuid,v_from,v_to,p_actor) RETURNING id INTO v_id;
 v_version:=v_member.version;
 -- Scheduling continuation does not edit any member column. The new membership's
 -- own version and existing scope trigger provide revision/readback metadata.
 IF NOT private.ihr_leave_is_calendar_director(p_actor) THEN
  UPDATE public.ihr_leave_members SET updated_at=p_at WHERE user_id=v_member.user_id RETURNING version INTO v_version;
 END IF;
 INSERT INTO public.ihr_leave_admin_events(actor_id,operation,target_user_id,before_data,after_data,reason) VALUES(p_actor,'set_group_membership',v_member.user_id,to_jsonb(v_old),p,p->>'reason');
 RETURN jsonb_build_object('id',v_id,'version',v_version,'operation','set_group_membership');
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_admin_setup_v1(p_section text,p_page int,p_page_size int) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_actor uuid:=private.ihr_leave_require_actor();v_rows jsonb;v_total bigint;
BEGIN
 IF NOT((p_section='rota' AND private.ihr_leave_calendar_config(v_actor)) OR private.ihr_leave_has_grant(v_actor,'configure') OR private.ihr_leave_has_grant(v_actor,'manage_access')) THEN RAISE EXCEPTION 'Leave access denied' USING ERRCODE='42501',DETAIL='{"code":"ACCESS_DENIED"}'; END IF;
 IF p_section IS NULL OR p_section NOT IN('people','members','approvers','rota') OR p_page IS NULL OR p_page<1 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023',DETAIL='{"code":"INVALID_DIRECTORY_PAGE"}'; END IF;
 IF p_section='people' THEN
  SELECT count(*) INTO v_total FROM public.users u WHERE private.ihr_leave_has_grant(v_actor,'configure',u.id) OR private.ihr_leave_has_grant(v_actor,'manage_access',u.id);
  SELECT coalesce(jsonb_agg(r.person ORDER BY r.name,r.id),'[]'::jsonb) INTO v_rows FROM(
   SELECT u.id,u.full_name AS name,jsonb_build_object('id',u.id,'name',u.full_name,'applicationRole',u.role,'active',u.is_active) AS person FROM public.users u
   WHERE private.ihr_leave_has_grant(v_actor,'configure',u.id) OR private.ihr_leave_has_grant(v_actor,'manage_access',u.id)
   ORDER BY u.full_name,u.id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size) r;
 ELSIF p_section='members' THEN
  SELECT count(*) INTO v_total FROM public.users u WHERE private.ihr_leave_has_grant(v_actor,'configure',u.id);
  SELECT coalesce(jsonb_agg(r.person ORDER BY r.name,r.id),'[]'::jsonb) INTO v_rows FROM(
   SELECT u.id,u.full_name AS name,jsonb_build_object('id',u.id,'name',u.full_name,'memberKind',m.member_kind,'active',coalesce(m.active,false),
    'allowedApproverKinds',CASE WHEN m.member_kind='manager' THEN jsonb_build_array('director')
      WHEN m.member_kind='employee' AND u.role='po_admin' THEN jsonb_build_array('manager','director')
      WHEN m.member_kind='employee' THEN jsonb_build_array('manager') ELSE '[]'::jsonb END,
    'employmentStart',m.employment_start,'eligibilityDate',m.eligibility_date,'calendarId',m.active_calendar_id,'version',coalesce(m.version,0),
    'impacts',private.ihr_leave_setup_impacts_v1(u.id,NULL,NULL),
    'assignments',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'approverId',a.approver_id,'effectiveFrom',a.effective_from,'effectiveUntil',a.effective_until,'version',a.version) ORDER BY a.effective_from),'[]'::jsonb) FROM public.ihr_leave_approvers a WHERE a.employee_id=u.id AND a.revoked_at IS NULL),
    'memberships',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'groupId',s.group_id,'effectiveFrom',s.effective_from,'effectiveUntil',s.effective_until,'version',s.version) ORDER BY s.effective_from),'[]'::jsonb) FROM public.ihr_saturday_memberships s WHERE s.employee_id=u.id)) AS person
   FROM public.users u LEFT JOIN public.ihr_leave_members m ON m.user_id=u.id WHERE private.ihr_leave_has_grant(v_actor,'configure',u.id)
   ORDER BY u.full_name,u.id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size) r;
 ELSIF p_section='approvers' THEN
  IF NOT private.ihr_leave_has_grant(v_actor,'configure') THEN RAISE EXCEPTION 'Leave access denied' USING ERRCODE='42501',DETAIL='{"code":"ACCESS_DENIED"}'; END IF;
  SELECT count(*) INTO v_total FROM public.users u JOIN public.ihr_leave_members m ON m.user_id=u.id WHERE u.is_active AND m.active AND m.member_kind IN('manager','director') AND u.id<>v_actor;
  SELECT coalesce(jsonb_agg(r.person ORDER BY r.name,r.id),'[]'::jsonb) INTO v_rows FROM(
   SELECT u.id,u.full_name AS name,jsonb_build_object('id',u.id,'name',u.full_name,'memberKind',m.member_kind,'active',true) AS person
   FROM public.users u JOIN public.ihr_leave_members m ON m.user_id=u.id WHERE u.is_active AND m.active AND m.member_kind IN('manager','director') AND u.id<>v_actor
   ORDER BY u.full_name,u.id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size) r;
 ELSE
  IF NOT private.ihr_leave_calendar_config(v_actor) THEN RAISE EXCEPTION 'Global configure required' USING ERRCODE='42501',DETAIL='{"code":"GLOBAL_CONFIG_REQUIRED"}'; END IF;
  SELECT count(*) INTO v_total FROM private.ihr_leave_calendar_registry;
  SELECT coalesce(jsonb_agg(r.calendar ORDER BY r.name,r.id),'[]'::jsonb) INTO v_rows FROM(
   SELECT k.id,c.name,jsonb_build_object('id',k.id,'name',c.name,'version',k.version,'effectiveFrom',c.effective_from,'effectiveUntil',c.effective_until,
    'timezone',c.timezone,'confirmedTimezone',private.ihr_leave_calendar_timezone(k.id),'holidaysConfirmed',c.holidays_confirmed,'sundayMinutes',c.sunday_minutes,
    'holidays',(SELECT coalesce(jsonb_agg(e.day ORDER BY e.day),'[]'::jsonb) FROM public.ihr_leave_calendar_exceptions e WHERE e.calendar_version_id=c.id),
    'groups',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'onAnchor',NULL) ORDER BY g.name,g.id),'[]'::jsonb) FROM public.ihr_saturday_groups g WHERE g.calendar_id=k.id),
    'impacts',private.ihr_leave_calendar_impacts(k.id,c.effective_from,c.effective_until)-'sourceFingerprint') AS calendar
   FROM private.ihr_leave_calendar_registry k CROSS JOIN LATERAL(SELECT * FROM public.ihr_leave_calendars c WHERE c.calendar_id=k.id ORDER BY c.version DESC LIMIT 1)c
   ORDER BY c.name,k.id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size)r;
 END IF;
 RETURN jsonb_build_object('rows',v_rows,'total',v_total,'page',p_page,'pageSize',p_page_size);
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_context_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();result jsonb;readiness jsonb;blockers jsonb;
BEGIN
 result:=private.ihr_leave_context_before_admin();
 IF result->>'memberKind' IN('employee','manager') THEN
  readiness:=private.ihr_leave_readiness(actor,statement_timestamp());
  IF jsonb_typeof(result->'setup'->'blockers') IS DISTINCT FROM 'array'
   OR jsonb_typeof(readiness->'blockers') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Leave setup unavailable' USING ERRCODE='55000';
  END IF;
  SELECT coalesce(jsonb_agg(blocker ORDER BY position),'[]'::jsonb) INTO blockers
  FROM jsonb_array_elements(result->'setup'->'blockers') WITH ORDINALITY AS legacy(blocker,position)
  WHERE blocker->>'code' IS DISTINCT FROM 'SCHEMA_NOT_READY';
  blockers:=blockers||(readiness->'blockers');
  result:=jsonb_set(result,'{setup}',jsonb_build_object(
   'ready',coalesce((readiness->>'ready')::boolean,false) AND jsonb_array_length(blockers)=0,
   'blockers',blockers));
 END IF;
 RETURN jsonb_set(result,'{capabilities,calendarConfigure}',to_jsonb(private.ihr_leave_calendar_config(actor)));
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_admin_rota_context_v1(p_calendar_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();at_time timestamptz:=statement_timestamp();calendar jsonb;grants jsonb;
BEGIN
 IF NOT private.ihr_leave_calendar_config(actor,at_time) THEN RAISE EXCEPTION 'Leave access denied' USING ERRCODE='42501',DETAIL='{"code":"GLOBAL_CONFIG_REQUIRED"}';END IF;
 SELECT jsonb_build_object('id',k.id,'name',c.name,'version',k.version,'effectiveFrom',c.effective_from,'effectiveUntil',c.effective_until,
  'timezone',c.timezone,'confirmedTimezone',private.ihr_leave_calendar_timezone(k.id),'holidaysConfirmed',c.holidays_confirmed,'sundayMinutes',c.sunday_minutes,
  'holidays',(SELECT coalesce(jsonb_agg(e.day ORDER BY e.day),'[]'::jsonb) FROM public.ihr_leave_calendar_exceptions e WHERE e.calendar_version_id=c.id),
  'groups',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'onAnchor',NULL) ORDER BY g.name,g.id),'[]'::jsonb) FROM public.ihr_saturday_groups g WHERE g.calendar_id=k.id),
  'impacts',private.ihr_leave_calendar_impacts(k.id,c.effective_from,c.effective_until)-'sourceFingerprint') INTO calendar
 FROM private.ihr_leave_calendar_registry k CROSS JOIN LATERAL(SELECT * FROM public.ihr_leave_calendars c WHERE c.calendar_id=k.id ORDER BY c.version DESC LIMIT 1)c
 WHERE k.id=p_calendar_id;
 IF calendar IS NULL THEN RAISE EXCEPTION 'Leave access denied' USING ERRCODE='42501',DETAIL='{"code":"GLOBAL_CONFIG_REQUIRED"}';END IF;
 SELECT jsonb_agg(jsonb_build_object('id',g.id,'version',g.version,'capability',g.capability,'scopeKind',g.scope_kind,'employeeId',g.employee_id,'effectiveFrom',g.effective_from,'effectiveUntil',g.effective_until) ORDER BY g.id) INTO grants
 FROM public.ihr_leave_access_grants g WHERE g.actor_id=actor AND g.capability='configure' AND g.scope_kind='all_policy_members'
  AND g.revoked_at IS NULL AND g.effective_from<=at_time AND (g.effective_until IS NULL OR g.effective_until>at_time);
 RETURN jsonb_build_object('calendarId',p_calendar_id,'scopeVersion',private.ihr_leave_scope_version(actor),
  'authorityKey',encode(sha256(convert_to(jsonb_build_object('actor',actor,'calendarId',p_calendar_id,'grants',grants,'directorAuthority',(SELECT jsonb_build_object('role',u.role,'userActive',u.is_active,'memberKind',m.member_kind,'memberActive',m.active) FROM public.users u LEFT JOIN public.ihr_leave_members m ON m.user_id=u.id WHERE u.id=actor))::text,'UTF8')),'hex'),'calendar',calendar);
END;
$$;

-- Minimal paginated schedule-only projection. No policy, balance, grant or approver data.
CREATE OR REPLACE FUNCTION public.leave_roster_continuations_v1(p_calendar_id uuid,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();at_time timestamptz:=statement_timestamp();c public.ihr_leave_calendars%ROWTYPE;rows jsonb;total bigint;
BEGIN
 IF NOT private.ihr_leave_is_calendar_director(actor) THEN RAISE EXCEPTION 'Leave access denied' USING ERRCODE='42501';END IF;
 IF p_calendar_id IS NULL OR p_page IS NULL OR p_page<1 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
 SELECT * INTO c FROM public.ihr_leave_calendars WHERE calendar_id=p_calendar_id ORDER BY version DESC LIMIT 1;
 IF c.id IS NULL THEN RAISE EXCEPTION 'Leave access denied' USING ERRCODE='42501';END IF;
 WITH eligible AS(
  SELECT u.id,u.full_name,m.version,s.group_id,g.name AS group_name,s.effective_until AS starts
  FROM public.ihr_leave_members m JOIN public.users u ON u.id=m.user_id
  JOIN public.ihr_saturday_memberships s ON s.employee_id=m.user_id JOIN public.ihr_saturday_groups g ON g.id=s.group_id
  WHERE m.active_calendar_id=p_calendar_id
   AND private.ihr_leave_can_continue_roster(actor,m.user_id,s.group_id,s.effective_until,c.effective_until,at_time)
   AND NOT EXISTS(SELECT 1 FROM public.ihr_saturday_memberships other WHERE other.employee_id=m.user_id AND daterange(other.effective_from,other.effective_until,'[)') && daterange(s.effective_until,c.effective_until,'[)'))
 ), paged AS(SELECT * FROM eligible ORDER BY full_name,id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size)
 SELECT (SELECT count(*) FROM eligible),coalesce(jsonb_agg(jsonb_build_object('employeeId',id,'employeeName',full_name,'memberVersion',version,'groupId',group_id,'groupName',group_name,'effectiveFrom',starts,'effectiveUntil',c.effective_until,'continuationFingerprint',private.ihr_leave_roster_continuation_fingerprint(id,group_id,starts,c.effective_until)) ORDER BY full_name,id),'[]'::jsonb) INTO total,rows FROM paged;
 RETURN jsonb_build_object('calendarId',p_calendar_id,'scopeVersion',private.ihr_leave_scope_version(actor),'rows',rows,'total',total,'page',p_page,'pageSize',p_page_size);
END;
$$;
REVOKE ALL ON FUNCTION private.ihr_leave_is_calendar_director(uuid),private.ihr_leave_calendar_config(uuid,timestamptz),private.ihr_leave_can_continue_roster(uuid,uuid,uuid,date,date,timestamptz),private.ihr_leave_roster_continuation_fingerprint(uuid,uuid,date,date) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.leave_roster_continuations_v1(uuid,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.leave_roster_continuations_v1(uuid,integer,integer) TO authenticated;
-- Existing public endpoints retain their authenticated-only ACLs; private seams remain inaccessible.
COMMIT;
