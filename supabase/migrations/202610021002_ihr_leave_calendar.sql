-- Unpublished candidate; no people, grants, policy rows, dates, timezone or groups are seeded.
BEGIN;
CREATE TABLE public.ihr_leave_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),version bigint NOT NULL CHECK(version>0),
 effective_from date NOT NULL,effective_until date,
 annual_allowance_minutes integer NOT NULL DEFAULT 5400 CHECK(annual_allowance_minutes=5400),
 weekday_minutes integer NOT NULL DEFAULT 450 CHECK(weekday_minutes=450),
 saturday_minutes integer NOT NULL DEFAULT 225 CHECK(saturday_minutes=225),
 annual_policy_confirmed boolean NOT NULL DEFAULT false,
 notice_rule jsonb,cancellation_rule jsonb,calendar_audience text,
 reserve_pending_accepted boolean,single_date_rule_accepted boolean,
 created_by uuid NOT NULL REFERENCES public.users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(effective_until IS NULL OR effective_until>effective_from)
);
CREATE TABLE private.ihr_leave_calendar_registry(id uuid PRIMARY KEY,version bigint NOT NULL CHECK(version>0));
CREATE TABLE public.ihr_leave_calendars (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),calendar_id uuid NOT NULL REFERENCES private.ihr_leave_calendar_registry(id),
 version bigint NOT NULL CHECK(version>0),name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
 effective_from date NOT NULL,effective_until date,timezone text,
 holidays_confirmed boolean NOT NULL DEFAULT false,sunday_minutes integer CHECK(sunday_minutes=0),
 created_by uuid NOT NULL REFERENCES public.users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(calendar_id,version),CHECK(effective_until IS NULL OR effective_until>effective_from)
);
CREATE INDEX ihr_calendar_lookup ON public.ihr_leave_calendars(calendar_id,version DESC);
CREATE TABLE public.ihr_leave_calendar_exceptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),calendar_version_id uuid NOT NULL REFERENCES public.ihr_leave_calendars(id),
 day date NOT NULL,kind text NOT NULL CHECK(kind='holiday'),UNIQUE(calendar_version_id,day)
);
CREATE TABLE public.ihr_saturday_groups (
 id uuid PRIMARY KEY,calendar_id uuid NOT NULL REFERENCES private.ihr_leave_calendar_registry(id),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 80),version bigint NOT NULL DEFAULT 1 CHECK(version>0),UNIQUE(calendar_id,name)
);
CREATE TABLE public.ihr_saturday_memberships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),employee_id uuid NOT NULL REFERENCES public.ihr_leave_members(user_id),
 group_id uuid NOT NULL REFERENCES public.ihr_saturday_groups(id),effective_from date NOT NULL,effective_until date,
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),created_by uuid NOT NULL REFERENCES public.users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(effective_until IS NULL OR effective_until>effective_from)
);
CREATE INDEX ihr_membership_lookup ON public.ihr_saturday_memberships(employee_id,effective_from);
-- Each publication materializes explicit dated duty/off rows. A missing row is never zero capacity.
CREATE TABLE public.ihr_saturday_roster (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),calendar_version_id uuid NOT NULL REFERENCES public.ihr_leave_calendars(id),
 group_id uuid NOT NULL REFERENCES public.ihr_saturday_groups(id),version bigint NOT NULL CHECK(version>0),
 day date NOT NULL CHECK(extract(isodow FROM day)=6),capacity_minutes integer NOT NULL CHECK(capacity_minutes IN(0,225)),
 anchor date NOT NULL CHECK(extract(isodow FROM anchor)=6),on_anchor boolean NOT NULL,
 effective_from date NOT NULL,effective_until date NOT NULL,
 published_by uuid NOT NULL REFERENCES public.users(id),published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(group_id,day,version),CHECK(effective_until>effective_from AND day>=effective_from AND day<effective_until)
);
CREATE INDEX ihr_roster_lookup ON public.ihr_saturday_roster(group_id,day,version DESC);
ALTER TABLE public.ihr_leave_members ADD CONSTRAINT ihr_member_calendar_fk FOREIGN KEY(active_calendar_id) REFERENCES private.ihr_leave_calendar_registry(id);
ALTER TABLE public.ihr_leave_members ADD CONSTRAINT ihr_member_policy_fk FOREIGN KEY(active_policy_id) REFERENCES public.ihr_leave_policies(id);
ALTER TABLE public.ihr_leave_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ihr_leave_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ihr_leave_calendar_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ihr_saturday_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ihr_saturday_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ihr_saturday_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.ihr_leave_calendar_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ihr_leave_policies FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.ihr_leave_calendars FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.ihr_leave_calendar_exceptions FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.ihr_saturday_groups FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.ihr_saturday_memberships FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.ihr_saturday_roster FROM PUBLIC,anon,authenticated;
REVOKE ALL ON private.ihr_leave_calendar_registry FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.ihr_leave_global_config(p_actor uuid,p_at timestamptz DEFAULT statement_timestamp()) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT private.ihr_leave_has_grant(p_actor,'configure',NULL,p_at) AND EXISTS(
  SELECT 1 FROM public.ihr_leave_access_grants g WHERE g.actor_id=p_actor AND g.capability='configure' AND g.scope_kind='all_policy_members'
   AND g.revoked_at IS NULL AND g.effective_from<=p_at AND (g.effective_until IS NULL OR g.effective_until>p_at));
$$;
CREATE FUNCTION private.ihr_leave_calendar_timezone(p_calendar_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT timezone FROM public.ihr_leave_calendars WHERE calendar_id=p_calendar_id AND timezone IS NOT NULL ORDER BY version DESC LIMIT 1;
$$;
CREATE FUNCTION private.ihr_leave_calendar_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-setup',0));
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Source version is immutable' USING ERRCODE='55000',DETAIL='{"code":"PAST_VERSION_IMMUTABLE"}'; END IF;
 IF NEW.timezone IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.timezone) THEN
  RAISE EXCEPTION 'Invalid timezone' USING ERRCODE='22023',DETAIL='{"code":"INVALID_TIMEZONE"}';
 END IF;
 IF NEW.timezone IS NOT NULL AND EXISTS(SELECT 1 FROM public.ihr_leave_calendars c WHERE c.calendar_id=NEW.calendar_id AND c.timezone IS NOT NULL AND c.timezone<>NEW.timezone) THEN
  RAISE EXCEPTION 'Confirmed lineage timezone cannot change' USING ERRCODE='22023',DETAIL='{"code":"TIMEZONE_CHANGE_UNSUPPORTED"}';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER ihr_calendar_guard BEFORE INSERT OR UPDATE ON public.ihr_leave_calendars FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_calendar_guard();
CREATE FUNCTION private.ihr_leave_membership_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-setup',0));
 IF EXISTS(SELECT 1 FROM public.ihr_saturday_memberships m WHERE m.employee_id=NEW.employee_id AND m.id<>NEW.id
  AND daterange(m.effective_from,m.effective_until,'[)') && daterange(NEW.effective_from,NEW.effective_until,'[)')) THEN
  RAISE EXCEPTION 'Membership intervals overlap' USING ERRCODE='55000',DETAIL='{"code":"MEMBERSHIP_OVERLAP"}';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER ihr_membership_guard BEFORE INSERT OR UPDATE ON public.ihr_saturday_memberships FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_membership_guard();
CREATE FUNCTION private.ihr_leave_roster_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ihr_leave_calendars c JOIN public.ihr_saturday_groups g ON g.calendar_id=c.calendar_id
  WHERE c.id=NEW.calendar_version_id AND g.id=NEW.group_id AND NEW.effective_from>=c.effective_from
   AND (c.effective_until IS NULL OR NEW.effective_until<=c.effective_until)) THEN
  RAISE EXCEPTION 'Roster source mismatch' USING ERRCODE='22023',DETAIL='{"code":"ROSTER_CALENDAR_MISMATCH"}';
 END IF;
 IF NEW.capacity_minutes<>(CASE WHEN (mod((NEW.day-NEW.anchor)/7,2)=0)=NEW.on_anchor THEN 225 ELSE 0 END) THEN
  RAISE EXCEPTION 'Roster parity mismatch' USING ERRCODE='22023',DETAIL='{"code":"INVALID_ROSTER_PARITY"}';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER ihr_roster_guard BEFORE INSERT ON public.ihr_saturday_roster FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_roster_guard();
CREATE TRIGGER ihr_calendar_no_delete BEFORE DELETE ON public.ihr_leave_calendars FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_immutable_audit();
CREATE TRIGGER ihr_policy_immutable BEFORE UPDATE OR DELETE ON public.ihr_leave_policies FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_immutable_audit();
CREATE TRIGGER ihr_exception_immutable BEFORE UPDATE OR DELETE ON public.ihr_leave_calendar_exceptions FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_immutable_audit();
CREATE TRIGGER ihr_roster_immutable BEFORE UPDATE OR DELETE ON public.ihr_saturday_roster FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_immutable_audit();
CREATE TRIGGER ihr_calendar_scope AFTER INSERT OR UPDATE OR DELETE ON public.ihr_leave_calendars FOR EACH STATEMENT EXECUTE FUNCTION private.ihr_leave_bump_scope();
CREATE TRIGGER ihr_policy_scope AFTER INSERT OR UPDATE OR DELETE ON public.ihr_leave_policies FOR EACH STATEMENT EXECUTE FUNCTION private.ihr_leave_bump_scope();
CREATE TRIGGER ihr_exception_scope AFTER INSERT OR UPDATE OR DELETE ON public.ihr_leave_calendar_exceptions FOR EACH STATEMENT EXECUTE FUNCTION private.ihr_leave_bump_scope();
CREATE TRIGGER ihr_membership_scope AFTER INSERT OR UPDATE OR DELETE ON public.ihr_saturday_memberships FOR EACH STATEMENT EXECUTE FUNCTION private.ihr_leave_bump_scope();
CREATE TRIGGER ihr_group_scope AFTER INSERT OR UPDATE OR DELETE ON public.ihr_saturday_groups FOR EACH STATEMENT EXECUTE FUNCTION private.ihr_leave_bump_scope();
CREATE TRIGGER ihr_roster_scope AFTER INSERT OR UPDATE OR DELETE ON public.ihr_saturday_roster FOR EACH STATEMENT EXECUTE FUNCTION private.ihr_leave_bump_scope();

-- Target is EMPLOYEE ID only. Task 6 supplies real minimized counts, never private request IDs.
CREATE FUNCTION private.ihr_leave_setup_impacts_v1(target uuid,"from" date,"to" date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF target IS NULL OR NOT private.ihr_leave_has_grant(private.ihr_leave_require_actor(),'configure',target) THEN
  RAISE EXCEPTION 'Leave access denied' USING ERRCODE='42501',DETAIL='{"code":"ACCESS_DENIED"}';
 END IF;
 RETURN jsonb_build_object('available',false,'pendingCount',NULL,'approvedCount',NULL);
END;
$$;
CREATE FUNCTION private.ihr_working_day_v1(employee uuid,day date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_member public.ihr_leave_members%ROWTYPE;v_calendar public.ihr_leave_calendars%ROWTYPE;
 v_membership public.ihr_saturday_memberships%ROWTYPE;v_roster public.ihr_saturday_roster%ROWTYPE;v_minutes integer;v_exclusion text;
BEGIN
 SELECT * INTO v_member FROM public.ihr_leave_members m WHERE m.user_id=employee;
 IF v_member.user_id IS NULL OR NOT v_member.active OR v_member.member_kind='director' OR NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=employee AND u.is_active) THEN
  RETURN jsonb_build_object('error','MEMBER_INELIGIBLE');
 END IF;
 IF day IS NULL THEN RETURN jsonb_build_object('error','INVALID_DATE'); END IF;
 IF v_member.active_calendar_id IS NULL THEN RETURN jsonb_build_object('error','CALENDAR_COVERAGE_MISSING'); END IF;
 SELECT * INTO v_calendar FROM public.ihr_leave_calendars c WHERE c.calendar_id=v_member.active_calendar_id
  AND daterange(c.effective_from,c.effective_until,'[)') @> day ORDER BY c.version DESC LIMIT 1;
 IF v_calendar.id IS NULL THEN RETURN jsonb_build_object('error','CALENDAR_COVERAGE_MISSING'); END IF;
 IF v_calendar.timezone IS NULL OR private.ihr_leave_calendar_timezone(v_member.active_calendar_id) IS NULL THEN RETURN jsonb_build_object('error','TIMEZONE_UNCONFIRMED'); END IF;
 IF NOT v_calendar.holidays_confirmed THEN RETURN jsonb_build_object('error','HOLIDAYS_UNCONFIRMED'); END IF;
 -- Resolve only this date's required setup before applying a holiday capacity override.
 IF extract(isodow FROM day) BETWEEN 1 AND 5 THEN v_minutes:=450;
 ELSIF extract(isodow FROM day)=7 THEN
  IF v_calendar.sunday_minutes IS NULL THEN RETURN jsonb_build_object('error','SUNDAY_UNCONFIGURED'); END IF;
  v_minutes:=0;
 ELSE
  SELECT m.* INTO v_membership FROM public.ihr_saturday_memberships m JOIN public.ihr_saturday_groups g ON g.id=m.group_id
   WHERE m.employee_id=employee AND g.calendar_id=v_member.active_calendar_id AND daterange(m.effective_from,m.effective_until,'[)') @> day;
  IF v_membership.id IS NULL THEN RETURN jsonb_build_object('error','MEMBERSHIP_COVERAGE_MISSING'); END IF;
  SELECT * INTO v_roster FROM public.ihr_saturday_roster r WHERE r.group_id=v_membership.group_id AND r.day=ihr_working_day_v1.day
   AND r.calendar_version_id=v_calendar.id ORDER BY r.version DESC LIMIT 1;
  IF v_roster.id IS NULL THEN RETURN jsonb_build_object('error','ROSTER_COVERAGE_MISSING'); END IF;
  v_minutes:=v_roster.capacity_minutes;
 END IF;
 IF EXISTS(SELECT 1 FROM public.ihr_leave_calendar_exceptions e WHERE e.calendar_version_id=v_calendar.id AND e.day=ihr_working_day_v1.day) THEN
  v_minutes:=0;v_exclusion:='holiday';
 END IF;
 IF v_minutes=0 AND v_exclusion IS NULL THEN v_exclusion:='off_duty'; END IF;
 RETURN jsonb_build_object('capacity_minutes',v_minutes,'exclusion',v_exclusion,'calendar_id',v_calendar.id,'calendar_version',v_calendar.version,
  'roster_id',v_roster.id,'roster_version',v_roster.version,'membership_id',v_membership.id,'membership_version',v_membership.version);
END;
$$;
CREATE FUNCTION private.ihr_leave_roster_preview(p_calendar_id uuid,p_anchor date,p_groups jsonb,p_from date,p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE v_calendar public.ihr_leave_calendars%ROWTYPE;v_revision bigint;v_groups jsonb;v_rows jsonb;v_group jsonb;
BEGIN
 IF p_anchor IS NULL OR extract(isodow FROM p_anchor)<>6 THEN RAISE EXCEPTION 'Invalid Saturday anchor' USING ERRCODE='22023',DETAIL='{"code":"INVALID_SATURDAY_ANCHOR"}'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_to<=p_from OR p_to-p_from>366 OR jsonb_typeof(p_groups) IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Invalid roster range' USING ERRCODE='22023',DETAIL='{"code":"INVALID_ROSTER_RANGE"}';
 END IF;
 IF jsonb_array_length(p_groups) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid groups' USING ERRCODE='22023',DETAIL='{"code":"INVALID_ROSTER_GROUP"}'; END IF;
 SELECT * INTO v_calendar FROM public.ihr_leave_calendars c WHERE c.calendar_id=p_calendar_id AND daterange(c.effective_from,c.effective_until,'[)') @> p_from ORDER BY c.version DESC LIMIT 1;
 IF v_calendar.id IS NULL OR (v_calendar.effective_until IS NOT NULL AND p_to>v_calendar.effective_until) THEN
  RAISE EXCEPTION 'Calendar coverage missing' USING ERRCODE='22023',DETAIL='{"code":"CALENDAR_COVERAGE_MISSING"}';
 END IF;
 IF EXISTS(SELECT 1 FROM generate_series(0,p_to-p_from-1) n WHERE (SELECT c.id FROM public.ihr_leave_calendars c WHERE c.calendar_id=p_calendar_id
  AND daterange(c.effective_from,c.effective_until,'[)') @> (p_from+n) ORDER BY c.version DESC LIMIT 1) IS DISTINCT FROM v_calendar.id) THEN
  RAISE EXCEPTION 'Split publication at version boundaries' USING ERRCODE='22023',DETAIL='{"code":"CALENDAR_VERSION_BOUNDARY"}';
 END IF;
 IF v_calendar.timezone IS NULL THEN RAISE EXCEPTION 'Timezone unconfirmed' USING ERRCODE='22023',DETAIL='{"code":"TIMEZONE_UNCONFIRMED"}'; END IF;
 FOR v_group IN SELECT value FROM jsonb_array_elements(p_groups) LOOP
  PERFORM private.ihr_leave_validate_payload(v_group,ARRAY['id','on_anchor'],ARRAY['id','on_anchor']);
  IF jsonb_typeof(v_group->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(v_group->'on_anchor') IS DISTINCT FROM 'boolean'
   OR NOT EXISTS(SELECT 1 FROM public.ihr_saturday_groups g WHERE g.id=(v_group->>'id')::uuid AND g.calendar_id=p_calendar_id) THEN
   RAISE EXCEPTION 'Invalid group' USING ERRCODE='22023',DETAIL='{"code":"INVALID_ROSTER_GROUP"}';
  END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_groups))<>jsonb_array_length(p_groups) THEN RAISE EXCEPTION 'Duplicate group' USING ERRCODE='22023',DETAIL='{"code":"DUPLICATE_GROUP"}'; END IF;
 SELECT version INTO v_revision FROM private.ihr_leave_calendar_registry WHERE id=p_calendar_id;
 SELECT jsonb_agg(value ORDER BY value->>'id') INTO v_groups FROM jsonb_array_elements(p_groups);
 SELECT coalesce(jsonb_agg(jsonb_build_object('date',d.day,'groupId',grp.value->>'id','capacityMinutes',
  CASE WHEN (mod((d.day-p_anchor)/7,2)=0)=(grp.value->>'on_anchor')::boolean THEN 225 ELSE 0 END) ORDER BY d.day,grp.value->>'id'),'[]'::jsonb)
 INTO v_rows FROM (SELECT p_from+n AS day FROM generate_series(0,p_to-p_from-1) n WHERE extract(isodow FROM p_from+n)=6) d CROSS JOIN jsonb_array_elements(v_groups) grp;
 IF jsonb_array_length(v_rows)=0 THEN RAISE EXCEPTION 'No Saturdays in range' USING ERRCODE='22023',DETAIL='{"code":"INVALID_ROSTER_RANGE"}'; END IF;
 RETURN jsonb_build_object('calendarId',p_calendar_id,'calendarVersion',v_revision,'rows',v_rows,
  'fingerprint',md5(jsonb_build_array(p_calendar_id,v_revision,v_calendar.id,p_anchor,v_groups,p_from,p_to)::text),
  'impacts',jsonb_build_object('available',false,'pendingCount',NULL,'approvedCount',NULL));
END;
$$;
CREATE FUNCTION public.leave_roster_preview_v1(p_calendar_id uuid,p_anchor date,p_groups jsonb,p_from date,p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT private.ihr_leave_global_config(private.ihr_leave_require_actor()) THEN RAISE EXCEPTION 'Leave access denied' USING ERRCODE='42501',DETAIL='{"code":"GLOBAL_CONFIG_REQUIRED"}'; END IF;
 RETURN private.ihr_leave_roster_preview(p_calendar_id,p_anchor,p_groups,p_from,p_to);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Invalid roster input' USING ERRCODE='22023',DETAIL='{"code":"INVALID_PAYLOAD"}';
END;
$$;

CREATE OR REPLACE FUNCTION private.ihr_leave_authorize_command(p_actor uuid,p_operation text,p_payload jsonb,p_authorized_at timestamptz) RETURNS void
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE v_keys text[];v_target uuid;v_field text;v_null_revoke boolean;
BEGIN
 IF p_authorized_at IS NULL OR p_actor IS DISTINCT FROM private.ihr_leave_require_actor() THEN RAISE EXCEPTION 'Invalid authority' USING ERRCODE='42501',DETAIL='{"code":"COMMAND_AUTHORITY_REQUIRED"}'; END IF;
 CASE p_operation
 WHEN 'set_member' THEN v_keys:=ARRAY['employee_id','member_kind','active','employment_start','eligibility_date','calendar_id','expected_version','reason'];
 WHEN 'set_approver' THEN v_keys:=ARRAY['employee_id','approver_id','effective_from','effective_until','replace_assignment_id','expected_version','reason'];
 WHEN 'save_calendar_version' THEN v_keys:=ARRAY['calendar_id','name','effective_from','effective_until','timezone','holidays_confirmed','sunday_minutes','holidays','groups','expected_version','reason'];
 WHEN 'set_group_membership' THEN v_keys:=ARRAY['employee_id','group_id','effective_from','effective_until','replace_membership_id','expected_version','reason'];
 WHEN 'publish_roster' THEN v_keys:=ARRAY['calendar_id','anchor','groups','effective_from','effective_until','preview_fingerprint','expected_version','reason'];
 ELSE RAISE EXCEPTION 'Unsupported operation' USING ERRCODE='22023',DETAIL='{"code":"UNSUPPORTED_OPERATION"}';
 END CASE;
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
  IF NOT private.ihr_leave_global_config(p_actor,p_authorized_at) THEN RAISE EXCEPTION 'Global configure required' USING ERRCODE='42501',DETAIL='{"code":"GLOBAL_CONFIG_REQUIRED"}'; END IF;
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
CREATE FUNCTION private.ihr_leave_set_member(p_actor uuid,p jsonb,p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_target uuid:=(p->>'employee_id')::uuid;v_old public.ihr_leave_members%ROWTYPE;v_version bigint;v_zone text;
BEGIN
 IF p_actor=v_target THEN RAISE EXCEPTION 'Independent setup required' USING ERRCODE='42501',DETAIL='{"code":"SELF_MEMBER_SETUP_DENIED"}'; END IF;
 SELECT * INTO v_old FROM public.ihr_leave_members m WHERE m.user_id=v_target;
 IF coalesce(v_old.version,0)<>(p->>'expected_version')::bigint THEN RAISE EXCEPTION 'Stale member' USING ERRCODE='55000',DETAIL='{"code":"STALE_VERSION"}'; END IF;
 IF v_old.member_kind='director' AND p->>'member_kind'<>'director' THEN RAISE EXCEPTION 'Director reclassification denied' USING ERRCODE='22023',DETAIL='{"code":"DIRECTOR_RECLASSIFICATION_DENIED"}'; END IF;
 IF jsonb_typeof(p->'active') IS DISTINCT FROM 'boolean' OR coalesce(p->>'member_kind','') NOT IN('employee','manager','director')
  OR NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=v_target) OR ((p->>'eligibility_date')::date IS NOT NULL AND
  ((p->>'employment_start')::date IS NULL OR (p->>'eligibility_date')::date<(p->>'employment_start')::date))
  OR (p->>'member_kind'='director' AND p->>'calendar_id' IS NOT NULL) THEN
  RAISE EXCEPTION 'Invalid member setup' USING ERRCODE='22023',DETAIL='{"code":"INVALID_MEMBER"}';
 END IF;
 IF p->>'calendar_id' IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.ihr_leave_calendars c WHERE c.calendar_id=(p->>'calendar_id')::uuid) THEN RAISE EXCEPTION 'Calendar unavailable' USING ERRCODE='22023',DETAIL='{"code":"CALENDAR_COVERAGE_MISSING"}'; END IF;
  v_zone:=private.ihr_leave_calendar_timezone((p->>'calendar_id')::uuid);
 END IF;
 INSERT INTO public.ihr_leave_members(user_id,member_kind,active,employment_start,eligibility_date,active_calendar_id,timezone)
 VALUES(v_target,p->>'member_kind',(p->>'active')::boolean,(p->>'employment_start')::date,(p->>'eligibility_date')::date,(p->>'calendar_id')::uuid,v_zone)
 ON CONFLICT(user_id) DO UPDATE SET member_kind=excluded.member_kind,active=excluded.active,employment_start=excluded.employment_start,
  eligibility_date=excluded.eligibility_date,active_calendar_id=excluded.active_calendar_id,timezone=excluded.timezone,
  active_policy_id=CASE WHEN excluded.member_kind='director' THEN NULL ELSE public.ihr_leave_members.active_policy_id END,
  first_grant_policy_id=CASE WHEN excluded.member_kind='director' THEN NULL ELSE public.ihr_leave_members.first_grant_policy_id END,
  annual_policy_confirmed=CASE WHEN excluded.member_kind='director' THEN false ELSE public.ihr_leave_members.annual_policy_confirmed END
 RETURNING version INTO v_version;
 INSERT INTO public.ihr_leave_admin_events(actor_id,operation,target_user_id,before_data,after_data,reason) VALUES(p_actor,'set_member',v_target,to_jsonb(v_old),p,p->>'reason');
 RETURN jsonb_build_object('id',v_target,'version',v_version,'operation','set_member');
END;
$$;
CREATE FUNCTION private.ihr_leave_set_approver(p_actor uuid,p jsonb,p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_member public.ihr_leave_members%ROWTYPE;v_approver public.ihr_leave_members%ROWTYPE;v_old public.ihr_leave_approvers%ROWTYPE;
 v_from timestamptz;v_to timestamptz;v_zone text;v_id uuid;v_version bigint;
BEGIN
 SELECT * INTO v_member FROM public.ihr_leave_members m WHERE m.user_id=(p->>'employee_id')::uuid;
 IF v_member.version IS DISTINCT FROM (p->>'expected_version')::bigint THEN RAISE EXCEPTION 'Stale member' USING ERRCODE='55000',DETAIL='{"code":"STALE_VERSION"}'; END IF;
 IF p->>'replace_assignment_id' IS NOT NULL THEN
  SELECT * INTO v_old FROM public.ihr_leave_approvers a WHERE a.id=(p->>'replace_assignment_id')::uuid AND a.employee_id=v_member.user_id AND a.revoked_at IS NULL;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Assignment changed' USING ERRCODE='55000',DETAIL='{"code":"STALE_ASSIGNMENT"}'; END IF;
 END IF;
 IF p_actor=v_member.user_id OR p_actor=(p->>'approver_id')::uuid OR p_actor=v_old.approver_id THEN
  RAISE EXCEPTION 'Independent assignment change required' USING ERRCODE='42501',DETAIL='{"code":"SELF_APPROVER_ASSIGNMENT_DENIED"}';
 END IF;
 IF p->>'approver_id' IS NULL THEN
  IF v_old.id IS NULL OR p->>'effective_from' IS NOT NULL OR p->>'effective_until' IS NOT NULL THEN RAISE EXCEPTION 'Invalid revocation' USING ERRCODE='22023',DETAIL='{"code":"INVALID_REVOCATION"}'; END IF;
  -- No timezone, endpoint-active or future-boundary prerequisite for independently authorized revocation.
  UPDATE public.ihr_leave_approvers SET revoked_at=p_at,revoked_by=p_actor WHERE id=v_old.id RETURNING id INTO v_id;
 ELSE
  SELECT * INTO v_approver FROM public.ihr_leave_members m WHERE m.user_id=(p->>'approver_id')::uuid;
  IF v_approver.user_id IS NULL OR v_member.user_id=v_approver.user_id OR NOT v_member.active OR NOT v_approver.active
   OR NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=v_member.user_id AND u.is_active)
   OR NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=v_approver.user_id AND u.is_active)
   OR NOT ((v_member.member_kind='employee' AND v_approver.member_kind='manager') OR (v_member.member_kind='manager' AND v_approver.member_kind='director')) THEN
   RAISE EXCEPTION 'Invalid approval route' USING ERRCODE='22023',DETAIL='{"code":"INVALID_APPROVER_ROUTE"}';
  END IF;
  v_zone:=private.ihr_leave_calendar_timezone(v_member.active_calendar_id);
  IF v_zone IS NULL THEN RAISE EXCEPTION 'Timezone unconfirmed' USING ERRCODE='22023',DETAIL='{"code":"TIMEZONE_UNCONFIRMED"}'; END IF;
  v_from:=(p->>'effective_from')::date::timestamp AT TIME ZONE v_zone;v_to:=(p->>'effective_until')::date::timestamp AT TIME ZONE v_zone;
  IF v_from IS NULL OR v_from<=p_at OR (v_to IS NOT NULL AND v_to<=v_from) THEN RAISE EXCEPTION 'Invalid effective range' USING ERRCODE='22023',DETAIL='{"code":"INVALID_EFFECTIVE_RANGE"}'; END IF;
  IF v_old.id IS NOT NULL THEN
   IF v_old.effective_from>=v_from OR (v_old.effective_until IS NOT NULL AND v_old.effective_until<v_from) THEN RAISE EXCEPTION 'Assignment changed' USING ERRCODE='55000',DETAIL='{"code":"STALE_ASSIGNMENT"}'; END IF;
   UPDATE public.ihr_leave_approvers SET effective_until=v_from WHERE id=v_old.id;
  END IF;
  INSERT INTO public.ihr_leave_approvers(employee_id,approver_id,effective_from,effective_until,assigned_by)
  VALUES(v_member.user_id,v_approver.user_id,v_from,v_to,p_actor) RETURNING id INTO v_id;
 END IF;
 UPDATE public.ihr_leave_members SET updated_at=p_at WHERE user_id=v_member.user_id RETURNING version INTO v_version;
 INSERT INTO public.ihr_leave_admin_events(actor_id,operation,target_user_id,before_data,after_data,reason) VALUES(p_actor,'set_approver',v_member.user_id,to_jsonb(v_old),p,p->>'reason');
 RETURN jsonb_build_object('id',v_id,'version',v_version,'operation','set_approver');
END;
$$;
CREATE FUNCTION private.ihr_leave_save_calendar(p_actor uuid,p jsonb,p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_key uuid:=(p->>'calendar_id')::uuid;v_version bigint;v_from date:=(p->>'effective_from')::date;v_to date:=(p->>'effective_until')::date;
 v_zone text:=p->>'timezone';v_confirmed_zone text;v_today date;v_id uuid;v_group jsonb;v_holiday jsonb;
BEGIN
 SELECT version INTO v_version FROM private.ihr_leave_calendar_registry WHERE id=v_key;
 IF coalesce(v_version,0)<>(p->>'expected_version')::bigint THEN RAISE EXCEPTION 'Stale calendar' USING ERRCODE='55000',DETAIL='{"code":"STALE_VERSION"}'; END IF;
 IF v_zone IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=v_zone) THEN RAISE EXCEPTION 'Invalid timezone' USING ERRCODE='22023',DETAIL='{"code":"INVALID_TIMEZONE"}'; END IF;
 v_confirmed_zone:=private.ihr_leave_calendar_timezone(v_key);
 IF v_confirmed_zone IS NOT NULL AND v_zone IS NOT NULL AND v_confirmed_zone<>v_zone THEN RAISE EXCEPTION 'Confirmed timezone cannot change' USING ERRCODE='22023',DETAIL='{"code":"TIMEZONE_CHANGE_UNSUPPORTED"}'; END IF;
 -- Known lineage timezone governs even null drafts. An entirely unknown draft uses a conservative
 -- latest-civil-date bound (UTC date + 1); this never configures an organization default timezone.
 v_today:=CASE WHEN coalesce(v_confirmed_zone,v_zone) IS NOT NULL THEN (p_at AT TIME ZONE coalesce(v_confirmed_zone,v_zone))::date ELSE (p_at AT TIME ZONE 'UTC')::date+1 END;
 IF v_from IS NULL OR v_from<=v_today THEN RAISE EXCEPTION 'Past/current source cannot change' USING ERRCODE='55000',DETAIL='{"code":"PAST_VERSION_IMMUTABLE"}'; END IF;
 IF v_key IS NULL OR (v_to IS NOT NULL AND v_to<=v_from) OR jsonb_typeof(p->'holidays_confirmed') IS DISTINCT FROM 'boolean'
  OR jsonb_typeof(p->'holidays') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'groups') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid calendar' USING ERRCODE='22023',DETAIL='{"code":"INVALID_CALENDAR"}'; END IF;
 IF jsonb_array_length(p->'groups')>100 OR jsonb_array_length(p->'holidays')>366 OR jsonb_typeof(p->'name') IS DISTINCT FROM 'string'
  OR coalesce(length(btrim(p->>'name')),0) NOT BETWEEN 1 AND 120 OR (p->>'sunday_minutes' IS NOT NULL AND (jsonb_typeof(p->'sunday_minutes')<>'number' OR p->>'sunday_minutes'<>'0')) THEN
  RAISE EXCEPTION 'Invalid calendar' USING ERRCODE='22023',DETAIL='{"code":"INVALID_CALENDAR"}';
 END IF;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p->'groups'))<>jsonb_array_length(p->'groups') THEN RAISE EXCEPTION 'Duplicate group' USING ERRCODE='22023',DETAIL='{"code":"DUPLICATE_GROUP"}'; END IF;
 v_version:=coalesce(v_version,0)+1;
 INSERT INTO private.ihr_leave_calendar_registry(id,version) VALUES(v_key,v_version) ON CONFLICT(id) DO UPDATE SET version=excluded.version;
 INSERT INTO public.ihr_leave_calendars(calendar_id,version,name,effective_from,effective_until,timezone,holidays_confirmed,sunday_minutes,created_by)
 VALUES(v_key,v_version,p->>'name',v_from,v_to,v_zone,(p->>'holidays_confirmed')::boolean,(p->>'sunday_minutes')::integer,p_actor) RETURNING id INTO v_id;
 FOR v_holiday IN SELECT value FROM jsonb_array_elements(p->'holidays') LOOP
  IF jsonb_typeof(v_holiday) IS DISTINCT FROM 'string' OR (v_holiday#>>'{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR NOT (daterange(v_from,v_to,'[)') @> (v_holiday#>>'{}')::date) THEN RAISE EXCEPTION 'Invalid holiday' USING ERRCODE='22023',DETAIL='{"code":"INVALID_HOLIDAY"}'; END IF;
  INSERT INTO public.ihr_leave_calendar_exceptions(calendar_version_id,day,kind) VALUES(v_id,(v_holiday#>>'{}')::date,'holiday');
 END LOOP;
 FOR v_group IN SELECT value FROM jsonb_array_elements(p->'groups') LOOP
  PERFORM private.ihr_leave_validate_payload(v_group,ARRAY['id','name'],ARRAY['id','name']);
  IF jsonb_typeof(v_group->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(v_group->'name') IS DISTINCT FROM 'string'
   OR EXISTS(SELECT 1 FROM public.ihr_saturday_groups g WHERE g.id=(v_group->>'id')::uuid AND g.calendar_id<>v_key) THEN RAISE EXCEPTION 'Invalid group' USING ERRCODE='22023',DETAIL='{"code":"INVALID_GROUP"}'; END IF;
  INSERT INTO public.ihr_saturday_groups(id,calendar_id,name) VALUES((v_group->>'id')::uuid,v_key,v_group->>'name')
   ON CONFLICT(id) DO UPDATE SET name=excluded.name,version=public.ihr_saturday_groups.version+1;
 END LOOP;
 INSERT INTO public.ihr_leave_admin_events(actor_id,operation,after_data,reason) VALUES(p_actor,'save_calendar_version',p,p->>'reason');
 RETURN jsonb_build_object('id',v_key,'version',v_version,'operation','save_calendar_version');
END;
$$;
CREATE FUNCTION private.ihr_leave_set_membership(p_actor uuid,p jsonb,p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_member public.ihr_leave_members%ROWTYPE;v_old public.ihr_saturday_memberships%ROWTYPE;v_zone text;
 v_from date:=(p->>'effective_from')::date;v_to date:=(p->>'effective_until')::date;v_id uuid;v_version bigint;
BEGIN
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
 UPDATE public.ihr_leave_members SET updated_at=p_at WHERE user_id=v_member.user_id RETURNING version INTO v_version;
 INSERT INTO public.ihr_leave_admin_events(actor_id,operation,target_user_id,before_data,after_data,reason) VALUES(p_actor,'set_group_membership',v_member.user_id,to_jsonb(v_old),p,p->>'reason');
 RETURN jsonb_build_object('id',v_id,'version',v_version,'operation','set_group_membership');
END;
$$;
CREATE FUNCTION private.ihr_leave_publish_roster(p_actor uuid,p jsonb,p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_key uuid:=(p->>'calendar_id')::uuid;v_preview jsonb;v_version bigint;v_calendar public.ihr_leave_calendars%ROWTYPE;
BEGIN
 SELECT version INTO v_version FROM private.ihr_leave_calendar_registry WHERE id=v_key;
 IF v_version IS DISTINCT FROM (p->>'expected_version')::bigint THEN RAISE EXCEPTION 'Stale calendar' USING ERRCODE='55000',DETAIL='{"code":"STALE_VERSION"}'; END IF;
 v_preview:=private.ihr_leave_roster_preview(v_key,(p->>'anchor')::date,p->'groups',(p->>'effective_from')::date,(p->>'effective_until')::date);
 IF v_preview->>'fingerprint' IS DISTINCT FROM p->>'preview_fingerprint' THEN RAISE EXCEPTION 'Preview changed' USING ERRCODE='55000',DETAIL='{"code":"PREVIEW_STALE"}'; END IF;
 SELECT * INTO v_calendar FROM public.ihr_leave_calendars c WHERE c.calendar_id=v_key AND daterange(c.effective_from,c.effective_until,'[)') @> (p->>'effective_from')::date ORDER BY c.version DESC LIMIT 1;
 IF (p->>'effective_from')::date<=(p_at AT TIME ZONE private.ihr_leave_calendar_timezone(v_key))::date THEN RAISE EXCEPTION 'Past/current roster cannot change' USING ERRCODE='55000',DETAIL='{"code":"PAST_VERSION_IMMUTABLE"}'; END IF;
 v_version:=v_version+1;
 INSERT INTO public.ihr_saturday_roster(calendar_version_id,group_id,version,day,capacity_minutes,anchor,on_anchor,effective_from,effective_until,published_by)
 SELECT v_calendar.id,(item->>'groupId')::uuid,v_version,(item->>'date')::date,(item->>'capacityMinutes')::integer,(p->>'anchor')::date,(grp->>'on_anchor')::boolean,
  (p->>'effective_from')::date,(p->>'effective_until')::date,p_actor
 FROM jsonb_array_elements(v_preview->'rows') item JOIN jsonb_array_elements(p->'groups') grp ON grp->>'id'=item->>'groupId';
 UPDATE private.ihr_leave_calendar_registry SET version=v_version WHERE id=v_key;
 INSERT INTO public.ihr_leave_admin_events(actor_id,operation,after_data,reason) VALUES(p_actor,'publish_roster',p,p->>'reason');
 RETURN jsonb_build_object('id',v_key,'version',v_version,'operation','publish_roster');
END;
$$;
CREATE OR REPLACE FUNCTION private.ihr_leave_dispatch_command(p_actor uuid,p_operation text,p_payload jsonb,p_authorized_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE v_actor uuid;v_at timestamptz;
BEGIN
 -- Envelope actor/key -> setup -> employee assignment -> scope revision -> domain rows/audit.
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-setup',0));
 IF p_operation IN('set_member','set_approver','set_group_membership') THEN PERFORM pg_advisory_xact_lock(hashtextextended('ihr-approver:'||(p_payload->>'employee_id'),0)); END IF;
 PERFORM version FROM private.ihr_leave_scope_revision WHERE singleton FOR UPDATE;
 SELECT private.ihr_leave_require_actor(),clock_timestamp() INTO v_actor,v_at;
 IF v_actor IS DISTINCT FROM p_actor OR p_authorized_at IS NULL THEN RAISE EXCEPTION 'Invalid authority' USING ERRCODE='42501',DETAIL='{"code":"COMMAND_AUTHORITY_REQUIRED"}'; END IF;
 PERFORM private.ihr_leave_authorize_command(v_actor,p_operation,p_payload,v_at);
 CASE p_operation
 WHEN 'set_member' THEN RETURN private.ihr_leave_set_member(v_actor,p_payload,v_at);
 WHEN 'set_approver' THEN RETURN private.ihr_leave_set_approver(v_actor,p_payload,v_at);
 WHEN 'save_calendar_version' THEN RETURN private.ihr_leave_save_calendar(v_actor,p_payload,v_at);
 WHEN 'set_group_membership' THEN RETURN private.ihr_leave_set_membership(v_actor,p_payload,v_at);
 WHEN 'publish_roster' THEN RETURN private.ihr_leave_publish_roster(v_actor,p_payload,v_at);
 ELSE RAISE EXCEPTION 'Unsupported operation' USING ERRCODE='22023',DETAIL='{"code":"UNSUPPORTED_OPERATION"}';
 END CASE;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range OR check_violation OR not_null_violation OR foreign_key_violation OR unique_violation THEN
 RAISE EXCEPTION 'Invalid setup input' USING ERRCODE='22023',DETAIL='{"code":"INVALID_PAYLOAD"}';
END;
$$;

-- Member timezone snapshots are not authority after explicit draft confirmation.
CREATE OR REPLACE FUNCTION public.leave_context_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor(); member public.ihr_leave_members%ROWTYPE;
 blockers jsonb:='[]'::jsonb; can_request boolean:=false;
BEGIN
 SELECT * INTO member FROM public.ihr_leave_members m WHERE m.user_id=actor;
 member.timezone:=private.ihr_leave_calendar_timezone(member.active_calendar_id);
 IF member.user_id IS NULL THEN blockers:=jsonb_build_array(jsonb_build_object('code','member_missing','message','Keanggotaan kebijakan cuti belum ditetapkan.','field','memberKind'));
 ELSIF NOT member.active THEN blockers:=jsonb_build_array(jsonb_build_object('code','member_inactive','message','Keanggotaan cuti tidak aktif.','field','active'));
 ELSIF member.member_kind='director' THEN blockers:=jsonb_build_array(jsonb_build_object('code','director_excluded','message','Direktur tidak dapat mengajukan cuti dalam kebijakan ini.','field','memberKind'));
 ELSE
  can_request:=true; blockers:=jsonb_build_array(jsonb_build_object('code','SCHEMA_NOT_READY','message','Layanan cuti belum siap.'));
  IF member.timezone IS NULL THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('code','timezone_missing','message','Zona waktu organisasi belum ditetapkan.','field','timezone')); END IF;
  IF NOT member.annual_policy_confirmed THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('code','annual_policy_unconfirmed','message','Kebijakan jatah tahunan belum dikonfirmasi.','field','annualPolicyConfirmed')); END IF;
  IF NOT member.opening_reconciled THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('code','opening_unreconciled','message','Saldo awal belum direkonsiliasi.','field','openingReconciled')); END IF;
  IF member.cycle_state='first_grant_blocked' THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('code','first_grant_blocked','message','Pemberian jatah pertama memerlukan aturan dan transisi yang disetujui HR.','field','cycleState')); END IF;
  IF NOT member.reserve_pending_accepted THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('code','pending_reservation_unaccepted','message','Reservasi saldo untuk permohonan tertunda belum diterima.','field','reservePendingAccepted')); END IF;
  IF NOT member.single_date_rule_accepted THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('code','single_date_rule_unaccepted','message','Aturan satu permohonan aktif per tanggal belum diterima.','field','singleDateRuleAccepted')); END IF;
 END IF;
 RETURN jsonb_build_object('scopeVersion',private.ihr_leave_scope_version(actor),'memberKind',member.member_kind,
  'capabilities',jsonb_build_object('request',can_request,'approve',private.ihr_leave_is_approver(actor),
   'configure',private.ihr_leave_has_grant(actor,'configure'),'adjust',private.ihr_leave_has_grant(actor,'adjust'),
   'readPrivate',private.ihr_leave_has_grant(actor,'read_private'),'manageAccess',private.ihr_leave_has_grant(actor,'manage_access')),
  'setup',jsonb_build_object('ready',false,'blockers',blockers),'balances','[]'::jsonb,'timezone',member.timezone);
END;
$$;
CREATE OR REPLACE FUNCTION public.leave_admin_setup_v1(p_section text,p_page int,p_page_size int) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=private.ihr_leave_require_actor();v_rows jsonb;v_total bigint;
BEGIN
 IF NOT(private.ihr_leave_has_grant(v_actor,'configure') OR private.ihr_leave_has_grant(v_actor,'manage_access')) THEN RAISE EXCEPTION 'Leave access denied' USING ERRCODE='42501',DETAIL='{"code":"ACCESS_DENIED"}'; END IF;
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
  IF NOT private.ihr_leave_global_config(v_actor) THEN RAISE EXCEPTION 'Global configure required' USING ERRCODE='42501',DETAIL='{"code":"GLOBAL_CONFIG_REQUIRED"}'; END IF;
  SELECT count(*) INTO v_total FROM private.ihr_leave_calendar_registry;
  SELECT coalesce(jsonb_agg(r.calendar ORDER BY r.name,r.id),'[]'::jsonb) INTO v_rows FROM(
   SELECT k.id,c.name,jsonb_build_object('id',k.id,'name',c.name,'version',k.version,'effectiveFrom',c.effective_from,'effectiveUntil',c.effective_until,
    'timezone',c.timezone,'confirmedTimezone',private.ihr_leave_calendar_timezone(k.id),'holidaysConfirmed',c.holidays_confirmed,'sundayMinutes',c.sunday_minutes,
    'holidays',(SELECT coalesce(jsonb_agg(e.day ORDER BY e.day),'[]'::jsonb) FROM public.ihr_leave_calendar_exceptions e WHERE e.calendar_version_id=c.id),
    'groups',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'onAnchor',NULL) ORDER BY g.name,g.id),'[]'::jsonb) FROM public.ihr_saturday_groups g WHERE g.calendar_id=k.id),
    'impacts',jsonb_build_object('available',false,'pendingCount',NULL,'approvedCount',NULL)) AS calendar
   FROM private.ihr_leave_calendar_registry k CROSS JOIN LATERAL(SELECT * FROM public.ihr_leave_calendars c WHERE c.calendar_id=k.id ORDER BY c.version DESC LIMIT 1)c
   ORDER BY c.name,k.id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size)r;
 END IF;
 RETURN jsonb_build_object('rows',v_rows,'total',v_total,'page',p_page,'pageSize',p_page_size);
END;
$$;
REVOKE ALL ON FUNCTION private.ihr_working_day_v1(uuid,date) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.ihr_leave_global_config(uuid,timestamptz),private.ihr_leave_calendar_timezone(uuid),private.ihr_leave_calendar_guard(),
 private.ihr_leave_membership_guard(),private.ihr_leave_roster_guard(),private.ihr_leave_setup_impacts_v1(uuid,date,date),private.ihr_leave_roster_preview(uuid,date,jsonb,date,date),
 private.ihr_leave_set_member(uuid,jsonb,timestamptz),private.ihr_leave_set_approver(uuid,jsonb,timestamptz),private.ihr_leave_save_calendar(uuid,jsonb,timestamptz),
 private.ihr_leave_set_membership(uuid,jsonb,timestamptz),private.ihr_leave_publish_roster(uuid,jsonb,timestamptz),
 private.ihr_leave_authorize_command(uuid,text,jsonb,timestamptz),private.ihr_leave_dispatch_command(uuid,text,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.leave_roster_preview_v1(uuid,date,jsonb,date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.leave_roster_preview_v1(uuid,date,jsonb,date,date) TO authenticated;
COMMIT;
