-- Unpublished scoped administration. No actual grants, bootstrap, approvals or setup rows.
-- Requires composed Task 7–8 request assignment resolver and cancellation policy columns.
BEGIN;
ALTER TABLE public.ihr_leave_policies ADD COLUMN calendar_audience_confirmed boolean NOT NULL DEFAULT false,
 ADD CONSTRAINT ihr_explicit_calendar_audience CHECK(NOT calendar_audience_confirmed OR calendar_audience='explicit_grants');
CREATE TABLE private.ihr_leave_policy_owners (
 policy_id uuid PRIMARY KEY REFERENCES public.ihr_leave_policies(id), employee_id uuid NOT NULL REFERENCES public.ihr_leave_members(user_id),
 predecessor_id uuid REFERENCES public.ihr_leave_policies(id)
);
-- Owner-provisioned evidence only. The application cannot write, confirm or fabricate it.
CREATE TABLE private.ihr_leave_access_manifests (
 id uuid PRIMARY KEY, grant_id uuid NOT NULL UNIQUE, actor_id uuid NOT NULL REFERENCES public.users(id),
 grantor_id uuid NOT NULL REFERENCES public.users(id), capability text NOT NULL CHECK(capability IN('configure','adjust','read_private','calendar','manage_access')),
 scope_kind text NOT NULL CHECK(scope_kind IN('employee','all_policy_members')),employee_id uuid REFERENCES public.users(id),
 effective_from timestamptz NOT NULL,effective_until timestamptz,approved_by uuid REFERENCES public.users(id),approved_at timestamptz,
 approval_reference text,confirmed boolean NOT NULL DEFAULT false,
 CHECK(actor_id<>grantor_id),CHECK(effective_until IS NULL OR effective_until>effective_from),
 CHECK((scope_kind='employee' AND employee_id IS NOT NULL) OR (scope_kind='all_policy_members' AND employee_id IS NULL))
);
CREATE TABLE private.ihr_leave_governance_approvals (
 id uuid PRIMARY KEY,employee_id uuid NOT NULL REFERENCES public.ihr_leave_members(user_id),kind text NOT NULL CHECK(kind IN('retention','access_review')),
 rule_id uuid,rule_version bigint,rule_document jsonb,approved_by uuid REFERENCES public.users(id),approved_at timestamptz,
 accountable_owner uuid REFERENCES public.users(id),cadence text,capabilities text[],grant_ids uuid[],audience_ids uuid[],confirmed boolean NOT NULL DEFAULT false
);
CREATE TABLE private.ihr_leave_governance_references (
 employee_id uuid NOT NULL REFERENCES public.ihr_leave_members(user_id),kind text NOT NULL CHECK(kind IN('retention','access_review')),
 version bigint NOT NULL CHECK(version>0),approval_id uuid NOT NULL REFERENCES private.ihr_leave_governance_approvals(id),
 created_by uuid NOT NULL REFERENCES public.users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(employee_id,kind,version)
);
CREATE TABLE private.ihr_leave_request_reassignments (
 request_id uuid NOT NULL REFERENCES public.ihr_leave_requests(id),request_version bigint NOT NULL CHECK(request_version>1),
 assignment_source jsonb NOT NULL,created_by uuid NOT NULL REFERENCES public.users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),PRIMARY KEY(request_id,request_version)
);
ALTER TABLE private.ihr_leave_policy_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.ihr_leave_access_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.ihr_leave_governance_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.ihr_leave_governance_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.ihr_leave_request_reassignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.ihr_leave_policy_owners FROM PUBLIC,anon,authenticated;
REVOKE ALL ON private.ihr_leave_access_manifests FROM PUBLIC,anon,authenticated;
REVOKE ALL ON private.ihr_leave_governance_approvals FROM PUBLIC,anon,authenticated;
REVOKE ALL ON private.ihr_leave_governance_references FROM PUBLIC,anon,authenticated;
REVOKE ALL ON private.ihr_leave_request_reassignments FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ihr_leave_policy_owners','ihr_leave_access_manifests','ihr_leave_governance_approvals','ihr_leave_governance_references','ihr_leave_request_reassignments'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON private.%I FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_immutable_audit()',t||'_immutable',t);
  EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON private.%I FOR EACH STATEMENT EXECUTE FUNCTION private.ihr_leave_immutable_audit()',t||'_no_truncate',t);
  EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON private.%I FOR EACH STATEMENT EXECUTE FUNCTION private.ihr_leave_bump_scope()',t||'_scope',t);
 END LOOP;
END $$;
CREATE FUNCTION private.ihr_leave_evidenced_access(p_actor uuid,p_employee uuid,p_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(
 SELECT 1 FROM public.ihr_leave_access_grants g JOIN private.ihr_leave_access_manifests m ON m.grant_id=g.id
 JOIN public.users u ON u.id=g.actor_id AND u.is_active
 WHERE g.actor_id=p_actor AND g.capability='manage_access' AND g.revoked_at IS NULL AND g.effective_from<=p_at AND (g.effective_until IS NULL OR g.effective_until>p_at)
 AND NOT EXISTS(SELECT 1 FROM public.ihr_leave_members am WHERE am.user_id=p_actor AND am.member_kind='director')
 AND ((g.scope_kind='employee' AND g.employee_id=p_employee) OR (g.scope_kind='all_policy_members' AND EXISTS(SELECT 1 FROM public.ihr_leave_members em WHERE em.user_id=p_employee AND em.member_kind IN('employee','manager'))))
 AND ROW(g.actor_id,g.granted_by,g.capability,g.scope_kind,g.employee_id,g.effective_from,g.effective_until)
 IS NOT DISTINCT FROM ROW(m.actor_id,m.grantor_id,m.capability,m.scope_kind,m.employee_id,m.effective_from,m.effective_until)
 AND m.confirmed AND m.approved_by IS NOT NULL AND m.approved_at<=p_at AND length(btrim(m.approval_reference))>0);
$$;
CREATE FUNCTION private.ihr_leave_governance_valid(p_employee uuid,p_kind text,p_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM private.ihr_leave_governance_references r JOIN private.ihr_leave_governance_approvals a ON a.id=r.approval_id
 WHERE r.employee_id=p_employee AND r.kind=p_kind AND r.version=(SELECT max(x.version) FROM private.ihr_leave_governance_references x WHERE x.employee_id=p_employee AND x.kind=p_kind)
 AND a.employee_id=p_employee AND a.kind=p_kind AND a.confirmed AND a.rule_id IS NOT NULL AND a.rule_version>0
 AND jsonb_typeof(a.rule_document)='object' AND a.rule_document<>'{}'::jsonb AND a.approved_by IS NOT NULL AND a.approved_at<=p_at AND a.accountable_owner IS NOT NULL
 AND a.capabilities @> ARRAY['configure','adjust','read_private','calendar','manage_access']::text[]
 AND a.audience_ids @> ARRAY[p_employee] AND a.grant_ids IS NOT NULL AND array_position(a.grant_ids,NULL) IS NULL AND array_position(a.audience_ids,NULL) IS NULL AND array_position(a.capabilities,NULL) IS NULL
 AND (p_kind='retention' OR length(btrim(a.cadence))>0)
 AND NOT EXISTS(SELECT 1 FROM public.ihr_leave_access_grants g WHERE g.revoked_at IS NULL AND g.effective_from<=p_at AND (g.effective_until IS NULL OR g.effective_until>p_at)
  AND (g.employee_id=p_employee OR g.scope_kind='all_policy_members') AND (NOT coalesce(g.id=ANY(a.grant_ids),false) OR (g.scope_kind='all_policy_members' AND EXISTS(SELECT 1 FROM public.ihr_leave_members covered WHERE covered.member_kind IN('employee','manager') AND NOT coalesce(covered.user_id=ANY(a.audience_ids),false))))));
$$;
CREATE FUNCTION private.ihr_leave_readiness(p_employee uuid,p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.ihr_leave_members%ROWTYPE;p public.ihr_leave_policies%ROWTYPE;z text;today date;codes text[]:='{}';code text;blockers jsonb:='[]';
BEGIN
 SELECT * INTO m FROM public.ihr_leave_members WHERE user_id=p_employee;
 SELECT * INTO p FROM public.ihr_leave_policies WHERE id=m.active_policy_id;
 z:=private.ihr_leave_calendar_timezone(m.active_calendar_id);IF z IS NOT NULL THEN today:=(p_at AT TIME ZONE z)::date; END IF;
 IF m.user_id IS NULL OR NOT m.active OR m.member_kind NOT IN('employee','manager') OR m.employment_start IS NULL OR m.eligibility_date IS NULL
  OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_employee AND is_active) OR m.cycle_state<>'established_calendar'
  OR (today IS NOT NULL AND m.eligibility_date>make_date(extract(year FROM today)::int,1,1)) THEN codes:=array_append(codes,'PEOPLE_UNCONFIRMED'); END IF;
 IF p.id IS NULL OR NOT m.annual_policy_confirmed OR NOT p.annual_policy_confirmed OR today IS NULL OR NOT(daterange(p.effective_from,p.effective_until,'[)') @> today) THEN codes:=array_append(codes,'POLICY_UNCONFIRMED'); END IF;
 IF z IS NULL OR EXISTS(SELECT 1 FROM generate_series(0,coalesce(p.booking_horizon_days,14)) n WHERE private.ihr_working_day_v1(p_employee,today+n) ? 'error') THEN codes:=array_append(codes,'CALENDAR_UNCONFIRMED'); END IF;
 IF today IS NULL OR NOT EXISTS(SELECT 1 FROM public.ihr_leave_accounts a WHERE a.employee_id=p_employee AND a.leave_type='annual' AND a.year=extract(year FROM today)::int AND a.opening_reconciled) THEN codes:=array_append(codes,'OPENING_UNCONFIRMED'); END IF;
 IF p.request_rules_confirmed IS DISTINCT FROM true OR p.minimum_notice_days IS NULL OR p.booking_horizon_days IS NULL OR p.reason_required IS NULL
  OR p.reserve_pending_accepted IS DISTINCT FROM true OR p.single_date_rule_accepted IS DISTINCT FROM true OR NOT m.reserve_pending_accepted OR NOT m.single_date_rule_accepted THEN codes:=array_append(codes,'REQUEST_RULES_UNCONFIRMED'); END IF;
 IF p.cancellation_rules_confirmed IS DISTINCT FROM true OR p.cancellation_mode IS DISTINCT FROM 'whole_request' OR p.cancellation_allow_past IS NULL
  OR p.cancellation_allow_repeat_declined IS NULL OR p.cancellation_reason_required IS NULL THEN codes:=array_append(codes,'CANCELLATION_RULES_UNCONFIRMED'); END IF;
 IF p.calendar_audience_confirmed IS DISTINCT FROM true OR p.calendar_audience IS DISTINCT FROM 'explicit_grants' THEN codes:=array_append(codes,'AUDIENCE_UNCONFIRMED'); END IF;
 IF NOT private.ihr_leave_governance_valid(p_employee,'retention',p_at) THEN codes:=array_append(codes,'RETENTION_UNCONFIRMED'); END IF;
 IF NOT private.ihr_leave_governance_valid(p_employee,'access_review',p_at) THEN codes:=array_append(codes,'ACCESS_REVIEW_UNCONFIRMED'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ihr_leave_approvers a WHERE a.employee_id=p_employee AND private.ihr_leave_is_approver(a.approver_id,p_employee,p_at)) THEN codes:=array_append(codes,'APPROVER_UNCONFIRMED'); END IF;
 FOREACH code IN ARRAY codes LOOP blockers:=blockers||jsonb_build_array(jsonb_build_object('code',code,'message',CASE code
 WHEN 'PEOPLE_UNCONFIRMED' THEN 'Klasifikasi, tanggal kerja dan kelayakan belum dikonfirmasi.' WHEN 'POLICY_UNCONFIRMED' THEN 'Kebijakan tahunan belum dikonfirmasi.'
 WHEN 'CALENDAR_UNCONFIRMED' THEN 'Zona waktu, hari libur atau cakupan rota belum dikonfirmasi.' WHEN 'OPENING_UNCONFIRMED' THEN 'Saldo awal belum diverifikasi.'
 WHEN 'REQUEST_RULES_UNCONFIRMED' THEN 'Aturan pengajuan belum dikonfirmasi.' WHEN 'CANCELLATION_RULES_UNCONFIRMED' THEN 'Aturan pembatalan belum dikonfirmasi.'
 WHEN 'AUDIENCE_UNCONFIRMED' THEN 'Lingkup pembaca kalender belum dikonfirmasi.' WHEN 'RETENTION_UNCONFIRMED' THEN 'Aturan retensi dan persetujuan belum lengkap.'
 WHEN 'ACCESS_REVIEW_UNCONFIRMED' THEN 'Aturan, pemilik, jadwal dan lingkup tinjauan akses belum disetujui.' ELSE 'Penyetuju eksplisit belum tersedia.' END));END LOOP;
 RETURN jsonb_build_object('ready',cardinality(codes)=0,'blockers',blockers);
END;
$$;
ALTER FUNCTION private.ihr_leave_quote_v1(uuid,jsonb,timestamptz) RENAME TO ihr_leave_quote_before_admin_v1;

-- Surface the same mandatory blockers to personal setup without changing historical reads.
ALTER FUNCTION public.leave_context_v1() RENAME TO ihr_leave_context_before_admin;
ALTER FUNCTION public.ihr_leave_context_before_admin() SET SCHEMA private;
CREATE FUNCTION public.leave_context_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();result jsonb;readiness jsonb;
BEGIN
 result:=private.ihr_leave_context_before_admin();
 IF result->>'memberKind' IN('employee','manager') THEN
  readiness:=private.ihr_leave_readiness(actor,statement_timestamp());
  result:=jsonb_set(result,'{setup}',jsonb_build_object('ready',coalesce((result->'setup'->>'ready')::boolean,false) AND (readiness->>'ready')::boolean,'blockers',coalesce(result->'setup'->'blockers','[]'::jsonb)||readiness->'blockers'));
 END IF;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION private.ihr_leave_context_before_admin(),public.leave_context_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.leave_context_v1() TO authenticated;
CREATE FUNCTION private.ihr_leave_admin_authorize(p_actor uuid,p_operation text,p jsonb,p_at timestamptz) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE target uuid;keys text[];mf private.ihr_leave_access_manifests%ROWTYPE;g public.ihr_leave_access_grants%ROWTYPE;
BEGIN
 IF p_actor IS DISTINCT FROM private.ihr_leave_require_actor() OR p_at IS NULL THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';END IF;
 CASE p_operation
 WHEN 'save_policy_version' THEN keys:=ARRAY['employee_id','expected_version','reason','effective_from','effective_until','annual_policy_confirmed','request_rules_confirmed','minimum_notice_days','booking_horizon_days','reason_required','reserve_pending_accepted','single_date_rule_accepted','cancellation_rules_confirmed','cancellation_mode','cancellation_allow_past','cancellation_allow_repeat_declined','cancellation_reason_required','calendar_audience','calendar_audience_confirmed'];
 WHEN 'activate_member_policy' THEN keys:=ARRAY['employee_id','policy_id','expected_version','reason','established_eligibility_confirmed'];
 WHEN 'set_governance_reference' THEN keys:=ARRAY['employee_id','kind','approval_id','expected_version','reason'];
 WHEN 'grant_leave_access' THEN keys:=ARRAY['manifest_id','expected_version','reason'];
 WHEN 'revoke_leave_access' THEN keys:=ARRAY['grant_id','expected_version','reason'];
 WHEN 'reassign_request' THEN keys:=ARRAY['employee_id','request_id','assignment_id','expected_version','reason'];
 ELSE RAISE EXCEPTION 'Unsupported command' USING ERRCODE='22023';END CASE;
 PERFORM private.ihr_leave_validate_payload(p,keys,keys);
 IF jsonb_typeof(p->'expected_version') IS DISTINCT FROM 'number' OR p->>'expected_version' !~ '^[0-9]+$' OR jsonb_typeof(p->'reason') IS DISTINCT FROM 'string' OR length(btrim(p->>'reason')) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023';END IF;
 IF p_operation='grant_leave_access' THEN
  SELECT * INTO mf FROM private.ihr_leave_access_manifests WHERE id=(p->>'manifest_id')::uuid;target:=mf.employee_id;
  IF mf.id IS NULL OR mf.actor_id=p_actor OR mf.grantor_id<>p_actor OR mf.scope_kind<>'employee' OR NOT mf.confirmed OR mf.approved_by IS NULL OR mf.approved_at IS NULL OR mf.approved_at>p_at OR coalesce(length(btrim(mf.approval_reference)),0)=0 OR NOT private.ihr_leave_evidenced_access(p_actor,target,p_at) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';END IF;
 ELSIF p_operation='revoke_leave_access' THEN
  SELECT * INTO g FROM public.ihr_leave_access_grants WHERE id=(p->>'grant_id')::uuid;target:=g.employee_id;
  IF g.id IS NULL OR g.actor_id=p_actor OR g.scope_kind<>'employee' OR NOT private.ihr_leave_evidenced_access(p_actor,target,p_at) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';END IF;
 ELSE
  target:=(p->>'employee_id')::uuid;
  IF target IS NULL OR NOT EXISTS(SELECT 1 FROM public.ihr_leave_members WHERE user_id=target) OR NOT private.ihr_leave_has_grant(p_actor,'configure',target,p_at) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';END IF;
  IF p_operation='reassign_request' AND (NOT private.ihr_leave_has_grant(p_actor,'read_private',target,p_at) OR NOT EXISTS(SELECT 1 FROM public.ihr_leave_requests WHERE id=(p->>'request_id')::uuid AND employee_id=target)) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';END IF;
 END IF;
 IF target=p_actor THEN RAISE EXCEPTION 'Independent administrator required' USING ERRCODE='42501',DETAIL='{"code":"SELF_ADMIN_DENIED"}';END IF;
 RETURN target;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023';
END;
$$;
ALTER FUNCTION private.ihr_leave_authorize_command(uuid,text,jsonb,timestamptz) RENAME TO ihr_leave_authorize_before_admin;
CREATE FUNCTION private.ihr_leave_authorize_command(p_actor uuid,p_operation text,p_payload jsonb,p_authorized_at timestamptz) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_operation IN('save_policy_version','activate_member_policy','set_governance_reference','grant_leave_access','revoke_leave_access','reassign_request') THEN PERFORM private.ihr_leave_admin_authorize(p_actor,p_operation,p_payload,p_authorized_at);
 ELSE PERFORM private.ihr_leave_authorize_before_admin(p_actor,p_operation,p_payload,p_authorized_at);END IF;
END;
$$;
CREATE FUNCTION private.ihr_leave_policy_json(p public.ihr_leave_policies) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',p.id,'version',p.version,'effectiveFrom',p.effective_from,'effectiveUntil',p.effective_until,'annualPolicyConfirmed',p.annual_policy_confirmed,
 'requestRulesConfirmed',p.request_rules_confirmed,'minimumNoticeDays',p.minimum_notice_days,'bookingHorizonDays',p.booking_horizon_days,'reasonRequired',p.reason_required,
 'reservePendingAccepted',p.reserve_pending_accepted,'singleDateRuleAccepted',p.single_date_rule_accepted,'cancellationRulesConfirmed',p.cancellation_rules_confirmed,
 'cancellationMode',p.cancellation_mode,'cancellationAllowPast',p.cancellation_allow_past,'cancellationAllowRepeatDeclined',p.cancellation_allow_repeat_declined,'cancellationReasonRequired',p.cancellation_reason_required,
 'calendarAudience',p.calendar_audience,'calendarAudienceConfirmed',p.calendar_audience_confirmed);
$$;
CREATE FUNCTION private.ihr_leave_apply_admin(p_actor uuid,p_operation text,p jsonb,p_at timestamptz,target uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE m public.ihr_leave_members%ROWTYPE;policy public.ihr_leave_policies%ROWTYPE;mf private.ihr_leave_access_manifests%ROWTYPE;g public.ihr_leave_access_grants%ROWTYPE;
 approval private.ihr_leave_governance_approvals%ROWTYPE;r public.ihr_leave_requests%ROWTYPE;assignment public.ihr_leave_approvers%ROWTYPE;previous jsonb;
 id uuid;version bigint;zone text;today date;k text;
BEGIN
 SELECT * INTO m FROM public.ihr_leave_members WHERE user_id=target;
 IF p_operation IN('save_policy_version','activate_member_policy') AND m.version IS DISTINCT FROM (p->>'expected_version')::bigint THEN RAISE EXCEPTION 'Stale member' USING ERRCODE='55000',DETAIL='{"code":"STALE_VERSION"}';END IF;
 IF p_operation='save_policy_version' THEN
  FOREACH k IN ARRAY ARRAY['annual_policy_confirmed','request_rules_confirmed','cancellation_rules_confirmed','calendar_audience_confirmed'] LOOP
   IF jsonb_typeof(p->k) IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Explicit confirmation required' USING ERRCODE='22023';END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['reason_required','reserve_pending_accepted','single_date_rule_accepted','cancellation_allow_past','cancellation_allow_repeat_declined','cancellation_reason_required'] LOOP
   IF jsonb_typeof(p->k) NOT IN('boolean','null') THEN RAISE EXCEPTION 'Invalid rule' USING ERRCODE='22023';END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['minimum_notice_days','booking_horizon_days'] LOOP
   IF p->k<>'null'::jsonb AND (jsonb_typeof(p->k)<>'number' OR p->>k !~ '^[0-9]+$') THEN RAISE EXCEPTION 'Invalid rule' USING ERRCODE='22023';END IF;
  END LOOP;
  IF p->>'calendar_audience' IS NOT NULL AND p->>'calendar_audience'<>'explicit_grants' THEN RAISE EXCEPTION 'Explicit audience required' USING ERRCODE='22023';END IF;
  zone:=private.ihr_leave_calendar_timezone(m.active_calendar_id);IF zone IS NULL THEN RAISE EXCEPTION 'Timezone required' USING ERRCODE='55000';END IF;today:=(p_at AT TIME ZONE zone)::date;
  IF p->>'effective_from' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR (p->>'effective_from')::date<today OR (p->>'effective_until' IS NOT NULL AND p->>'effective_until' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') THEN RAISE EXCEPTION 'Future effective policy required' USING ERRCODE='22023';END IF;
  SELECT coalesce(max(x.version),0)+1 INTO version FROM public.ihr_leave_policies x JOIN private.ihr_leave_policy_owners o ON o.policy_id=x.id WHERE o.employee_id=target;
  INSERT INTO public.ihr_leave_policies(version,effective_from,effective_until,annual_policy_confirmed,created_by,minimum_notice_days,booking_horizon_days,reason_required,request_rules_confirmed,reserve_pending_accepted,single_date_rule_accepted,cancellation_rules_confirmed,cancellation_mode,cancellation_allow_past,cancellation_allow_repeat_declined,cancellation_reason_required,calendar_audience,calendar_audience_confirmed)
  VALUES(version,(p->>'effective_from')::date,(p->>'effective_until')::date,(p->>'annual_policy_confirmed')::boolean,p_actor,(p->>'minimum_notice_days')::int,(p->>'booking_horizon_days')::int,(p->>'reason_required')::boolean,(p->>'request_rules_confirmed')::boolean,(p->>'reserve_pending_accepted')::boolean,(p->>'single_date_rule_accepted')::boolean,(p->>'cancellation_rules_confirmed')::boolean,p->>'cancellation_mode',(p->>'cancellation_allow_past')::boolean,(p->>'cancellation_allow_repeat_declined')::boolean,(p->>'cancellation_reason_required')::boolean,p->>'calendar_audience',(p->>'calendar_audience_confirmed')::boolean) RETURNING public.ihr_leave_policies.id INTO id;
  INSERT INTO private.ihr_leave_policy_owners(policy_id,employee_id,predecessor_id) VALUES(id,target,m.active_policy_id);
 ELSIF p_operation='activate_member_policy' THEN
  SELECT x.* INTO policy FROM public.ihr_leave_policies x JOIN private.ihr_leave_policy_owners o ON o.policy_id=x.id AND o.employee_id=target WHERE x.id=(p->>'policy_id')::uuid;
  zone:=private.ihr_leave_calendar_timezone(m.active_calendar_id);IF zone IS NOT NULL THEN today:=(p_at AT TIME ZONE zone)::date;END IF;
  IF NOT EXISTS(SELECT 1 FROM private.ihr_leave_policy_owners o WHERE o.policy_id=policy.id AND o.employee_id=target AND o.predecessor_id IS NOT DISTINCT FROM m.active_policy_id) OR policy.id IS NULL OR today IS NULL OR NOT(daterange(policy.effective_from,policy.effective_until,'[)') @> today) OR m.member_kind NOT IN('employee','manager') OR NOT m.active OR m.employment_start IS NULL OR m.eligibility_date IS NULL OR m.eligibility_date>make_date(extract(year FROM today)::int,1,1) OR p->'established_eligibility_confirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Established eligibility requires confirmation' USING ERRCODE='55000',DETAIL='{"code":"FIRST_GRANT_BLOCKED"}';END IF;
  IF NOT private.ihr_leave_governance_valid(target,'retention',p_at) OR NOT private.ihr_leave_governance_valid(target,'access_review',p_at) OR NOT policy.calendar_audience_confirmed THEN RAISE EXCEPTION 'Setup approval required' USING ERRCODE='55000';END IF;
  UPDATE public.ihr_leave_members SET active_policy_id=policy.id,annual_policy_confirmed=policy.annual_policy_confirmed,cycle_state='established_calendar',reserve_pending_accepted=coalesce(policy.reserve_pending_accepted,false),single_date_rule_accepted=coalesce(policy.single_date_rule_accepted,false) WHERE user_id=target RETURNING user_id,public.ihr_leave_members.version INTO id,version;
 ELSIF p_operation='set_governance_reference' THEN
  IF p->>'kind' NOT IN('retention','access_review') THEN RAISE EXCEPTION 'Invalid governance kind' USING ERRCODE='22023';END IF;
  SELECT * INTO approval FROM private.ihr_leave_governance_approvals WHERE private.ihr_leave_governance_approvals.id=(p->>'approval_id')::uuid AND employee_id=target AND kind=p->>'kind';
  IF approval.id IS NULL THEN RAISE EXCEPTION 'Approval unavailable' USING ERRCODE='42501';END IF;
  SELECT coalesce(max(x.version),0) INTO version FROM private.ihr_leave_governance_references x WHERE employee_id=target AND kind=p->>'kind';
  IF version<>(p->>'expected_version')::bigint THEN RAISE EXCEPTION 'Stale governance reference' USING ERRCODE='55000';END IF;version:=version+1;id:=approval.id;
  INSERT INTO private.ihr_leave_governance_references(employee_id,kind,version,approval_id,created_by) VALUES(target,p->>'kind',version,id,p_actor);
 ELSIF p_operation='grant_leave_access' THEN
  SELECT * INTO STRICT mf FROM private.ihr_leave_access_manifests WHERE private.ihr_leave_access_manifests.id=(p->>'manifest_id')::uuid;
  IF (p->>'expected_version')::bigint<>0 OR EXISTS(SELECT 1 FROM public.ihr_leave_access_grants WHERE public.ihr_leave_access_grants.id=mf.grant_id) THEN RAISE EXCEPTION 'Grant already exists' USING ERRCODE='55000';END IF;
  INSERT INTO public.ihr_leave_access_grants(id,actor_id,capability,scope_kind,employee_id,effective_from,effective_until,granted_by,reason) VALUES(mf.grant_id,mf.actor_id,mf.capability,mf.scope_kind,mf.employee_id,mf.effective_from,mf.effective_until,p_actor,p->>'reason') RETURNING public.ihr_leave_access_grants.id,public.ihr_leave_access_grants.version INTO id,version;
 ELSIF p_operation='revoke_leave_access' THEN
  SELECT * INTO STRICT g FROM public.ihr_leave_access_grants WHERE public.ihr_leave_access_grants.id=(p->>'grant_id')::uuid FOR UPDATE;
  PERFORM private.ihr_leave_admin_authorize(private.ihr_leave_require_actor(),p_operation,p,clock_timestamp());
  IF g.version<>(p->>'expected_version')::bigint OR g.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Stale grant' USING ERRCODE='55000';END IF;
  UPDATE public.ihr_leave_access_grants SET revoked_at=clock_timestamp(),revoked_by=p_actor WHERE public.ihr_leave_access_grants.id=g.id RETURNING public.ihr_leave_access_grants.id,public.ihr_leave_access_grants.version INTO id,version;
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('ihr-occupancy:'||target::text,0));
  PERFORM private.ihr_leave_admin_authorize(private.ihr_leave_require_actor(),p_operation,p,clock_timestamp());
  SELECT * INTO r FROM public.ihr_leave_requests WHERE public.ihr_leave_requests.id=(p->>'request_id')::uuid AND employee_id=target FOR UPDATE;
  p_at:=clock_timestamp();PERFORM private.ihr_leave_admin_authorize(private.ihr_leave_require_actor(),p_operation,p,p_at);
  SELECT * INTO assignment FROM public.ihr_leave_approvers WHERE public.ihr_leave_approvers.id=(p->>'assignment_id')::uuid AND employee_id=target AND revoked_at IS NULL AND effective_from<=p_at AND (effective_until IS NULL OR effective_until>p_at);
  previous:=private.ihr_leave_request_assignment(r);
  IF r.version IS DISTINCT FROM (p->>'expected_version')::bigint OR r.status<>'submitted' THEN RAISE EXCEPTION 'Request changed' USING ERRCODE='55000';END IF;
  IF assignment.id IS NULL OR assignment.approver_id=p_actor OR previous->>'approverId'=p_actor::text OR NOT private.ihr_leave_is_approver(assignment.approver_id,target,p_at) THEN RAISE EXCEPTION 'Independent assignment required' USING ERRCODE='42501';END IF;
  version:=r.version+1;id:=r.id;
  INSERT INTO private.ihr_leave_request_reassignments(request_id,request_version,assignment_source,created_by,reason) VALUES(r.id,version,to_jsonb(assignment)||jsonb_build_object('approver_name',(SELECT full_name FROM public.users WHERE public.users.id=assignment.approver_id)),p_actor,p->>'reason');
  UPDATE public.ihr_leave_requests AS req SET version=req.version+1 WHERE req.id=r.id;
  INSERT INTO private.ihr_leave_request_events(request_id,actor_id,event,at_time,data) VALUES(r.id,p_actor,'reassigned',p_at,jsonb_build_object('assignmentId',assignment.id,'requestVersion',version));
 END IF;
 INSERT INTO public.ihr_leave_admin_events(actor_id,operation,target_user_id,after_data,reason) VALUES(p_actor,p_operation,target,jsonb_build_object('id',id,'version',version),p->>'reason');
 RETURN jsonb_build_object('id',id,'version',version,'operation',p_operation);
END;
$$;
ALTER FUNCTION private.ihr_leave_dispatch_command(uuid,text,jsonb,timestamptz) RENAME TO ihr_leave_dispatch_before_admin;
CREATE FUNCTION private.ihr_leave_dispatch_command(p_actor uuid,p_operation text,p_payload jsonb,p_authorized_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE actor uuid;at_time timestamptz;target uuid;
BEGIN
 IF p_operation NOT IN('save_policy_version','activate_member_policy','set_governance_reference','grant_leave_access','revoke_leave_access','reassign_request') THEN RETURN private.ihr_leave_dispatch_before_admin(p_actor,p_operation,p_payload,p_authorized_at);END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-setup',0));
 SELECT private.ihr_leave_require_actor(),clock_timestamp() INTO actor,at_time;target:=private.ihr_leave_admin_authorize(actor,p_operation,p_payload,at_time);
 IF actor IS DISTINCT FROM p_actor OR p_authorized_at IS NULL THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-approver:'||target::text,0));
 SELECT private.ihr_leave_require_actor(),clock_timestamp() INTO actor,at_time;PERFORM private.ihr_leave_admin_authorize(actor,p_operation,p_payload,at_time);
 PERFORM version FROM private.ihr_leave_scope_revision WHERE singleton;
 SELECT private.ihr_leave_require_actor(),clock_timestamp() INTO actor,at_time;PERFORM private.ihr_leave_admin_authorize(actor,p_operation,p_payload,at_time);
 RETURN private.ihr_leave_apply_admin(actor,p_operation,p_payload,at_time,target);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range OR check_violation OR not_null_violation OR foreign_key_violation OR unique_violation THEN RAISE EXCEPTION 'Invalid settings' USING ERRCODE='22023',DETAIL='{"code":"INVALID_ADMIN_INPUT"}';
END;
$$;
CREATE OR REPLACE FUNCTION private.ihr_leave_request_assignment(r public.ihr_leave_requests) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN a.assignment_source IS NULL THEN jsonb_build_object('id',r.assignment_id,'version',r.assignment_version,'approverId',r.approver_id,'approverName',r.approver_name,'source',r.source_snapshot->'assignment')
 ELSE jsonb_build_object('id',a.assignment_source->'id','version',a.assignment_source->'version','approverId',a.assignment_source->'approver_id','approverName',a.assignment_source->'approver_name','source',a.assignment_source-'approver_name') END
 FROM (SELECT 1) seed LEFT JOIN LATERAL(SELECT assignment_source FROM private.ihr_leave_request_reassignments WHERE request_id=r.id AND request_version<=r.version ORDER BY request_version DESC LIMIT 1)a ON true;
$$;
CREATE OR REPLACE FUNCTION private.ihr_leave_request_transition_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP<>'UPDATE' OR (to_jsonb(NEW)-'status'-'version') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'version') OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'Request history is immutable' USING ERRCODE='42501',DETAIL='{"code":"REQUEST_IMMUTABLE"}';END IF;
 IF OLD.status='submitted' AND NEW.status='submitted' THEN
  IF NOT EXISTS(SELECT 1 FROM private.ihr_leave_request_reassignments a WHERE a.request_id=OLD.id AND a.request_version=NEW.version AND a.created_by=private.ihr_leave_require_actor()) THEN RAISE EXCEPTION 'Audited reassignment required' USING ERRCODE='42501';END IF;
 ELSIF NOT ((OLD.status='submitted' AND NEW.status IN('approved','rejected','withdrawn')) OR (OLD.status='approved' AND NEW.status='cancellation_pending') OR (OLD.status='cancellation_pending' AND NEW.status IN('approved','cancelled'))) THEN
  RAISE EXCEPTION 'Request history is immutable' USING ERRCODE='42501',DETAIL='{"code":"REQUEST_IMMUTABLE"}';END IF;
 RETURN NEW;
END;
$$;
CREATE FUNCTION private.ihr_leave_admin_authority_key(p_actor uuid,p_employee uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('actor',p_actor,'employee',p_employee,'grants',coalesce(jsonb_agg(jsonb_build_object('id',g.id,'version',g.version) ORDER BY g.id),'[]'))::text,'UTF8')),'hex')
 FROM public.ihr_leave_access_grants g WHERE g.actor_id=p_actor AND g.revoked_at IS NULL AND g.effective_from<=statement_timestamp() AND (g.effective_until IS NULL OR g.effective_until>statement_timestamp()) AND (g.employee_id=p_employee OR g.scope_kind='all_policy_members');
$$;
CREATE FUNCTION public.leave_admin_targets_v1(p_page integer DEFAULT 1,p_page_size integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();rows jsonb;total bigint;
BEGIN
 IF NOT (private.ihr_leave_has_grant(actor,'configure') OR private.ihr_leave_has_grant(actor,'adjust') OR private.ihr_leave_has_grant(actor,'read_private') OR private.ihr_leave_has_grant(actor,'calendar')
  OR EXISTS(SELECT 1 FROM public.users u WHERE private.ihr_leave_evidenced_access(actor,u.id,statement_timestamp()))) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';END IF;
 IF p_page IS NULL OR p_page<1 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
 WITH targets AS (SELECT u.id,u.full_name AS name,jsonb_build_object(
  'configure',u.id<>actor AND private.ihr_leave_has_grant(actor,'configure',u.id),'adjust',u.id<>actor AND private.ihr_leave_has_grant(actor,'adjust',u.id),
  'readPrivate',private.ihr_leave_has_grant(actor,'read_private',u.id),'calendar',private.ihr_leave_has_grant(actor,'calendar',u.id),'manageAccess',u.id<>actor AND private.ihr_leave_evidenced_access(actor,u.id,statement_timestamp())) AS capabilities
  FROM public.users u),allowed AS (SELECT * FROM targets WHERE capabilities @> '{"configure":true}' OR capabilities @> '{"adjust":true}' OR capabilities @> '{"readPrivate":true}' OR capabilities @> '{"calendar":true}' OR capabilities @> '{"manageAccess":true}'),page_rows AS (SELECT * FROM allowed ORDER BY name,id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size)
 SELECT (SELECT count(*) FROM allowed),coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'capabilities',r.capabilities) ORDER BY r.name,r.id),'[]') INTO total,rows FROM page_rows r;
 RETURN jsonb_build_object('rows',rows,'total',total,'page',p_page,'pageSize',p_page_size);
END;
$$;
-- Write prerequisites only: configure/adjust never inherit private history or global calendar reads.
CREATE FUNCTION public.leave_admin_write_context_v1(p_employee_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();can_configure boolean;can_adjust boolean;
 m public.ihr_leave_members%ROWTYPE;a public.ihr_leave_accounts%ROWTYPE;c public.ihr_leave_calendars%ROWTYPE;
 e jsonb;period jsonb;account jsonb;balance_state text:='unavailable';options jsonb;groups jsonb;
BEGIN
 can_configure:=private.ihr_leave_has_grant(actor,'configure',p_employee_id);
 can_adjust:=private.ihr_leave_has_grant(actor,'adjust',p_employee_id);
 IF actor=p_employee_id OR NOT(can_configure OR can_adjust) OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_employee_id)
  OR EXISTS(SELECT 1 FROM public.ihr_leave_members WHERE user_id=p_employee_id AND member_kind='director') THEN
  RAISE EXCEPTION 'Write context denied' USING ERRCODE='42501',DETAIL='{"code":"ADMIN_WRITE_CONTEXT_DENIED"}';END IF;
 SELECT * INTO m FROM public.ihr_leave_members WHERE user_id=p_employee_id;
 BEGIN e:=private.ihr_leave_annual_eligibility(p_employee_id,statement_timestamp());
 EXCEPTION WHEN SQLSTATE '55000' THEN e:=NULL;END;
 IF e IS NOT NULL THEN
  period:=jsonb_build_object('year',(e->>'year')::integer,'startDate',e->>'startDate','endDate',e->>'endDate');
  SELECT ac.* INTO a FROM public.ihr_leave_accounts ac WHERE ac.employee_id=p_employee_id AND ac.leave_type='annual' AND ac.year=(e->>'year')::integer;
  IF a.id IS NULL THEN balance_state:='missing';
  ELSIF a.period_start<>(e->>'startDate')::date OR a.period_end<>(e->>'endDate')::date OR a.timezone<>(e->>'timezone')
   OR NOT private.ihr_leave_policy_account_compatible(p_employee_id,a.policy_id,m.active_policy_id)
   OR NOT EXISTS(SELECT 1 FROM public.ihr_leave_ledger l WHERE l.account_id=a.id AND l.kind='annual_grant' AND l.effective_date=a.period_start AND l.allowance_delta=5400 AND l.used_delta=0 AND l.reserved_delta=0 AND l.source_kind='annual_account' AND l.source_id=a.id AND l.source_event='grant') THEN
   period:=NULL;
  ELSE
   balance_state:=CASE WHEN a.opening_reconciled THEN 'verified' ELSE 'unreconciled' END;
   account:=jsonb_build_object('accountId',a.id,'year',a.year,'version',a.version,'reconciled',a.opening_reconciled);
  END IF;
 END IF;
 IF can_configure THEN
  IF m.active_calendar_id IS NULL THEN options:=jsonb_build_object('state','lineage_unassigned','calendars','[]'::jsonb,'groups','[]'::jsonb);
  ELSE
   SELECT calendar.* INTO c FROM public.ihr_leave_calendars calendar WHERE calendar.calendar_id=m.active_calendar_id ORDER BY calendar.version DESC LIMIT 1;
   IF c.id IS NULL THEN options:=jsonb_build_object('state','unavailable','calendars','[]'::jsonb,'groups','[]'::jsonb);
   ELSE
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) ORDER BY g.name,g.id),'[]') INTO groups FROM public.ihr_saturday_groups g WHERE g.calendar_id=m.active_calendar_id;
    options:=jsonb_build_object('state','available','calendars',jsonb_build_array(jsonb_build_object('id',m.active_calendar_id,'name',c.name)),'groups',groups);
   END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object('employeeId',p_employee_id,'scopeVersion',private.ihr_leave_scope_version(actor),'authorityKey',private.ihr_leave_admin_authority_key(actor,p_employee_id),
  'capabilities',jsonb_build_object('configure',can_configure,'adjust',can_adjust),'balance',jsonb_build_object('state',balance_state,'currentPeriod',period,'account',account),'memberOptions',options);
END;
$$;
-- Broader private request review requires its own exact read_private grant audience.
CREATE INDEX ihr_leave_hr_history_page ON private.ihr_leave_request_events(request_id,at_time DESC,id DESC);
CREATE FUNCTION private.ihr_leave_require_hr_reader(p_employee_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();
BEGIN
 IF p_employee_id IS NULL OR NOT private.ihr_leave_has_grant(actor,'read_private',p_employee_id)
  OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_employee_id) THEN
  RAISE EXCEPTION 'Request access denied' USING ERRCODE='42501',DETAIL='{"code":"REQUEST_ACCESS_DENIED"}';END IF;
 RETURN actor;
END;
$$;
CREATE FUNCTION public.leave_hr_requests_v1(p_employee_id uuid,p_before bigint DEFAULT NULL,p_limit integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.ihr_leave_require_hr_reader(p_employee_id);rows jsonb;cursor bigint;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR (p_before IS NOT NULL AND p_before<1) THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(private.ihr_leave_request_summary(r) ORDER BY r.sequence DESC),'[]'),min(r.sequence) INTO rows,cursor
 FROM(SELECT * FROM public.ihr_leave_requests WHERE employee_id=p_employee_id AND (p_before IS NULL OR sequence<p_before) ORDER BY sequence DESC LIMIT p_limit)r;
 IF NOT EXISTS(SELECT 1 FROM public.ihr_leave_requests WHERE employee_id=p_employee_id AND sequence<cursor) THEN cursor:=NULL;END IF;
 RETURN jsonb_build_object('employeeId',p_employee_id,'scopeVersion',private.ihr_leave_scope_version(actor),'authorityKey',private.ihr_leave_admin_authority_key(actor,p_employee_id),'rows',rows,'nextBefore',cursor);
END;
$$;
CREATE FUNCTION public.leave_hr_request_v1(p_employee_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.ihr_leave_require_hr_reader(p_employee_id);r public.ihr_leave_requests%ROWTYPE;days jsonb;allocations jsonb;
BEGIN
 SELECT * INTO r FROM public.ihr_leave_requests WHERE id=p_request_id AND employee_id=p_employee_id;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Request access denied' USING ERRCODE='42501',DETAIL='{"code":"REQUEST_ACCESS_DENIED"}';END IF;
 SELECT jsonb_agg(jsonb_build_object('date',d.day,'scheduledMinutes',d.scheduled_minutes,'chargedMinutes',d.charged_minutes,'exclusion',d.exclusion,'groupName',d.source_snapshot->'group'->'name') ORDER BY d.day)
  INTO days FROM public.ihr_leave_request_days d WHERE d.request_id=r.id;
 SELECT jsonb_agg(jsonb_build_object('year',a.year,'startDate',a.period_start,'endDate',a.period_end,'chargedMinutes',a.charged_minutes) ORDER BY a.year)
  INTO allocations FROM public.ihr_leave_request_allocations a WHERE a.request_id=r.id;
 RETURN jsonb_build_object('employeeId',p_employee_id,'scopeVersion',private.ihr_leave_scope_version(actor),'authorityKey',private.ihr_leave_admin_authority_key(actor,p_employee_id),
  'request',private.ihr_leave_request_summary(r)||jsonb_build_object('reason',r.reason,'approverName',r.approver_name,'days',days,'allocations',allocations));
END;
$$;
CREATE FUNCTION public.leave_hr_request_history_v1(p_employee_id uuid,p_request_id uuid,p_before_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.ihr_leave_require_hr_reader(p_employee_id);r public.ihr_leave_requests%ROWTYPE;rows jsonb;cursor jsonb;last_at timestamptz;last_id uuid;
BEGIN
 SELECT * INTO r FROM public.ihr_leave_requests WHERE id=p_request_id AND employee_id=p_employee_id;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Request access denied' USING ERRCODE='42501',DETAIL='{"code":"REQUEST_ACCESS_DENIED"}';END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR (p_before_at IS NULL)<>(p_before_id IS NULL) OR (p_before_at IS NOT NULL AND NOT isfinite(p_before_at)) THEN RAISE EXCEPTION 'Invalid history page' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'event',e.event,'atTime',e.at_time,'actor',jsonb_build_object('id',e.actor_id,'name',u.full_name),
  'reason',CASE WHEN e.event='reassigned' THEN reassignment.reason WHEN e.event IN('rejected','cancellation_requested','cancellation_declined') AND jsonb_typeof(e.data->'reason')='string' THEN e.data->>'reason' ELSE NULL END,
  'approverName',CASE WHEN e.event IN('submitted','opening_imported') THEN r.approver_name WHEN e.event='reassigned' THEN reassignment.assignment_source->>'approver_name'
   WHEN e.event IN('cancellation_requested','cancellation_accepted','cancellation_declined') THEN attempt.approver_name
   WHEN e.event IN('approved','rejected') THEN coalesce(decision_route.assignment_source->>'approver_name',r.approver_name) ELSE NULL END) ORDER BY e.at_time DESC,e.id DESC),'[]') INTO rows
 FROM(SELECT * FROM private.ihr_leave_request_events WHERE request_id=p_request_id AND (p_before_at IS NULL OR (at_time,id)<(p_before_at,p_before_id)) ORDER BY at_time DESC,id DESC LIMIT p_limit)e
 JOIN public.users u ON u.id=e.actor_id
 LEFT JOIN private.ihr_leave_request_reassignments reassignment ON e.event='reassigned' AND reassignment.request_id=r.id AND reassignment.request_version::text=e.data->>'requestVersion'
 LEFT JOIN private.ihr_leave_cancellation_attempts attempt ON attempt.request_id=r.id AND attempt.id::text=e.data->>'attemptId'
 LEFT JOIN LATERAL(SELECT rr.assignment_source FROM private.ihr_leave_request_reassignments rr WHERE rr.request_id=r.id AND rr.created_at<=e.at_time ORDER BY rr.request_version DESC LIMIT 1)decision_route ON e.event IN('approved','rejected');
 IF jsonb_array_length(rows)>0 THEN
  last_at:=(rows->(jsonb_array_length(rows)-1)->>'atTime')::timestamptz;last_id:=(rows->(jsonb_array_length(rows)-1)->>'id')::uuid;
  IF EXISTS(SELECT 1 FROM private.ihr_leave_request_events WHERE request_id=p_request_id AND (at_time,id)<(last_at,last_id)) THEN cursor:=jsonb_build_object('atTime',last_at,'id',last_id);END IF;
 END IF;
 RETURN jsonb_build_object('employeeId',p_employee_id,'requestId',p_request_id,'scopeVersion',private.ihr_leave_scope_version(actor),'authorityKey',private.ihr_leave_admin_authority_key(actor,p_employee_id),'rows',rows,'nextBefore',cursor);
END;
$$;
REVOKE ALL ON FUNCTION private.ihr_leave_require_hr_reader(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.leave_hr_requests_v1(uuid,bigint,integer),public.leave_hr_request_v1(uuid,uuid),public.leave_hr_request_history_v1(uuid,uuid,timestamptz,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.leave_hr_requests_v1(uuid,bigint,integer),public.leave_hr_request_v1(uuid,uuid),public.leave_hr_request_history_v1(uuid,uuid,timestamptz,uuid,integer) TO authenticated;

CREATE FUNCTION public.leave_admin_readiness_v1(p_employee_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT private.ihr_leave_has_grant(private.ihr_leave_require_actor(),'configure',p_employee_id) OR NOT EXISTS(SELECT 1 FROM public.ihr_leave_members WHERE user_id=p_employee_id) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';END IF;
 RETURN private.ihr_leave_readiness(p_employee_id,statement_timestamp());
END;
$$;
CREATE FUNCTION public.leave_admin_settings_v1(p_employee_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.ihr_leave_members%ROWTYPE;result jsonb;readiness jsonb;
BEGIN
 readiness:=public.leave_admin_readiness_v1(p_employee_id);
 SELECT * INTO STRICT m FROM public.ihr_leave_members WHERE user_id=p_employee_id;
 SELECT jsonb_build_object('employeeId',p_employee_id,'authorityKey',private.ihr_leave_admin_authority_key(private.ihr_leave_require_actor(),p_employee_id),'memberVersion',m.version,'policy',(SELECT private.ihr_leave_policy_json(p) FROM public.ihr_leave_policies p WHERE id=m.active_policy_id),
 'policyDrafts',(SELECT coalesce(jsonb_agg(private.ihr_leave_policy_json(p) ORDER BY p.version DESC),'[]') FROM public.ihr_leave_policies p JOIN private.ihr_leave_policy_owners o ON o.policy_id=p.id WHERE o.employee_id=p_employee_id),
 'governance',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'kind',a.kind,'referenceVersion',coalesce(r.version,0),'selected',coalesce(r.approval_id=a.id,false),'confirmed',a.confirmed,
 'ruleId',a.rule_id,'ruleVersion',a.rule_version,'ruleDocument',a.rule_document,'approvedBy',a.approved_by,'approvedAt',a.approved_at,'accountableOwner',a.accountable_owner,'cadence',a.cadence,'capabilities',a.capabilities,'grantIds',a.grant_ids,'audienceIds',a.audience_ids) ORDER BY a.kind,a.id),'[]')
 FROM private.ihr_leave_governance_approvals a LEFT JOIN LATERAL(SELECT x.* FROM private.ihr_leave_governance_references x WHERE x.employee_id=p_employee_id AND x.kind=a.kind ORDER BY x.version DESC LIMIT 1)r ON true WHERE a.employee_id=p_employee_id),
 'readiness',readiness,'impacts',private.ihr_leave_setup_impacts_v1(p_employee_id,NULL,NULL)) INTO result;
 RETURN result;
END;
$$;
CREATE FUNCTION public.leave_admin_access_v1(p_employee_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();
BEGIN
 IF NOT private.ihr_leave_evidenced_access(actor,p_employee_id,statement_timestamp()) OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_employee_id) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('employeeId',p_employee_id,'authorityKey',private.ihr_leave_admin_authority_key(actor,p_employee_id),
 'grants',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',g.id,'actorId',g.actor_id,'capability',g.capability,'employeeId',g.employee_id,'effectiveFrom',g.effective_from,'effectiveUntil',g.effective_until,'version',g.version,'revoked',g.revoked_at IS NOT NULL) ORDER BY g.created_at,g.id),'[]') FROM public.ihr_leave_access_grants g WHERE g.scope_kind='employee' AND g.employee_id=p_employee_id),
 'manifests',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'grantId',m.grant_id,'actorId',m.actor_id,'capability',m.capability,'employeeId',m.employee_id,'effectiveFrom',m.effective_from,'effectiveUntil',m.effective_until,'approvedBy',m.approved_by,'approvedAt',m.approved_at,'approvalReference',m.approval_reference) ORDER BY m.id),'[]')
 FROM private.ihr_leave_access_manifests m WHERE m.grantor_id=actor AND m.actor_id<>actor AND m.employee_id=p_employee_id AND m.scope_kind='employee' AND m.confirmed AND m.approved_by IS NOT NULL AND m.approved_at<=statement_timestamp() AND length(btrim(m.approval_reference))>0 AND NOT EXISTS(SELECT 1 FROM public.ihr_leave_access_grants g WHERE g.id=m.grant_id)));
END;
$$;
CREATE FUNCTION public.leave_admin_requests_v1(p_employee_id uuid,p_before bigint DEFAULT NULL,p_limit integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();rows jsonb;cursor bigint;
BEGIN
 IF NOT private.ihr_leave_has_grant(actor,'configure',p_employee_id) OR NOT private.ihr_leave_has_grant(actor,'read_private',p_employee_id) OR NOT EXISTS(SELECT 1 FROM public.ihr_leave_members WHERE user_id=p_employee_id) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR (p_before IS NOT NULL AND p_before<1) THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'sequence',r.sequence,'version',r.version,'startDate',r.start_date,'endDate',r.end_date,'approverName',private.ihr_leave_request_assignment(r)->'approverName','currentAssignmentId',private.ihr_leave_request_assignment(r)->'id') ORDER BY r.sequence DESC),'[]'),min(r.sequence)
 INTO rows,cursor FROM (SELECT * FROM public.ihr_leave_requests WHERE employee_id=p_employee_id AND status='submitted' AND (p_before IS NULL OR sequence<p_before) ORDER BY sequence DESC LIMIT p_limit)r;
 IF NOT EXISTS(SELECT 1 FROM public.ihr_leave_requests WHERE employee_id=p_employee_id AND status='submitted' AND sequence<cursor) THEN cursor:=NULL;END IF;
 RETURN jsonb_build_object('rows',rows,'nextBefore',cursor);
END;
$$;
-- Rule-only successors may reuse the exact original account, never another employee or a cycle.
CREATE FUNCTION private.ihr_leave_policy_account_compatible(p_employee uuid,p_account_policy uuid,p_selected_policy uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE current_id uuid:=p_selected_policy;seen uuid[]:='{}';owner private.ihr_leave_policy_owners%ROWTYPE;p public.ihr_leave_policies%ROWTYPE;
BEGIN
 IF p_account_policy IS NULL OR p_selected_policy IS NULL THEN RETURN false;END IF;
 LOOP
  IF current_id=p_account_policy THEN RETURN true;END IF;
  IF current_id IS NULL OR current_id=ANY(seen) OR cardinality(seen)>=1000 THEN RETURN false;END IF;seen:=array_append(seen,current_id);
  SELECT * INTO owner FROM private.ihr_leave_policy_owners WHERE policy_id=current_id AND employee_id=p_employee;
  SELECT * INTO p FROM public.ihr_leave_policies WHERE id=current_id;
  IF owner.policy_id IS NULL OR NOT p.annual_policy_confirmed OR p.annual_allowance_minutes<>5400 OR p.weekday_minutes<>450 OR p.saturday_minutes<>225
   OR NOT p.request_rules_confirmed OR NOT p.cancellation_rules_confirmed OR NOT p.calendar_audience_confirmed THEN RETURN false;END IF;
  current_id:=owner.predecessor_id;
 END LOOP;
END;
$$;

-- Preserve the strict first-account/January 1 path; only an existing original grant
-- can prove entitlement when separately selected booking rules start during the year.
ALTER FUNCTION private.ihr_leave_annual_eligibility(uuid,timestamptz) RENAME TO ihr_leave_annual_eligibility_original;
CREATE FUNCTION private.ihr_leave_annual_eligibility(p_employee uuid,p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.ihr_leave_members%ROWTYPE;current_policy public.ihr_leave_policies%ROWTYPE;original public.ihr_leave_policies%ROWTYPE;a public.ihr_leave_accounts%ROWTYPE;
 detail text;zone text;today date;yr integer;starts date;ends date;
BEGIN
 BEGIN
  RETURN private.ihr_leave_annual_eligibility_original(p_employee,p_at);
 EXCEPTION WHEN SQLSTATE '55000' THEN
  GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL;
  -- Every member, employment/eligibility date, first-grant and current-calendar check
  -- in the original helper precedes this one exact policy failure and still must pass.
  IF detail IS NULL OR detail::jsonb->>'code' IS DISTINCT FROM 'ANNUAL_POLICY_UNCONFIRMED' THEN RAISE;END IF;
 END;
 SELECT * INTO STRICT m FROM public.ihr_leave_members WHERE user_id=p_employee;
 zone:=private.ihr_leave_calendar_timezone(m.active_calendar_id);
 today:=(p_at AT TIME ZONE zone)::date;yr:=extract(year FROM today)::integer;starts:=make_date(yr,1,1);ends:=make_date(yr+1,1,1);
 SELECT * INTO current_policy FROM public.ihr_leave_policies WHERE id=m.active_policy_id;
 IF NOT m.annual_policy_confirmed OR current_policy.id IS NULL OR NOT current_policy.annual_policy_confirmed
  OR current_policy.annual_allowance_minutes<>5400 OR current_policy.weekday_minutes<>450 OR current_policy.saturday_minutes<>225
  OR current_policy.effective_from>today OR (current_policy.effective_until IS NOT NULL AND current_policy.effective_until<=today) THEN
  RAISE EXCEPTION 'Annual policy unconfirmed' USING ERRCODE='55000',DETAIL='{"code":"ANNUAL_POLICY_UNCONFIRMED"}';END IF;
 SELECT ac.* INTO a FROM public.ihr_leave_accounts ac WHERE ac.employee_id=p_employee AND ac.leave_type='annual' AND ac.year=yr
  AND ac.period_start=starts AND ac.period_end=ends AND ac.timezone=zone AND ac.opening_reconciled;
 SELECT * INTO original FROM public.ihr_leave_policies WHERE id=a.policy_id;
 IF a.id IS NULL OR original.id IS NULL OR NOT original.annual_policy_confirmed OR original.annual_allowance_minutes<>5400
  OR original.weekday_minutes<>450 OR original.saturday_minutes<>225 OR original.effective_from>starts
  OR (original.effective_until IS NOT NULL AND original.effective_until<=starts)
  OR NOT private.ihr_leave_policy_account_compatible(p_employee,a.policy_id,current_policy.id)
  OR NOT EXISTS(SELECT 1 FROM public.ihr_leave_ledger l WHERE l.account_id=a.id AND l.kind='annual_grant' AND l.effective_date=starts
   AND l.allowance_delta=5400 AND l.used_delta=0 AND l.reserved_delta=0 AND l.source_kind='annual_account' AND l.source_id=a.id AND l.source_event='grant') THEN
  RAISE EXCEPTION 'Annual policy unconfirmed' USING ERRCODE='55000',DETAIL='{"code":"ANNUAL_POLICY_UNCONFIRMED"}';END IF;
 -- This remains the original entitlement policy. Preparation can only return its
 -- already-existing account; this fallback cannot create another account or grant.
 RETURN jsonb_build_object('year',yr,'startDate',starts,'endDate',ends,'timezone',zone,'policyId',a.policy_id);
END;
$$;
REVOKE ALL ON FUNCTION private.ihr_leave_annual_eligibility_original(uuid,timestamptz),private.ihr_leave_annual_eligibility(uuid,timestamptz) FROM PUBLIC,anon,authenticated;

-- Frozen 1004 calculator; only readiness gate and exact owned predecessor compatibility differ.
CREATE OR REPLACE FUNCTION private.ihr_leave_quote_v1(p_employee uuid,p_input jsonb,p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.ihr_leave_members%ROWTYPE;p public.ihr_leave_policies%ROWTYPE;
 assignment public.ihr_leave_approvers%ROWTYPE;approver_member public.ihr_leave_members%ROWTYPE;
 a public.ihr_leave_accounts%ROWTYPE;g public.ihr_saturday_groups%ROWTYPE;
 eligibility jsonb;working jsonb;balance jsonb;source jsonb;days jsonb:='[]';allocations jsonb:='[]';result jsonb;
 sources jsonb:='[]';account_sources jsonb:='[]';current_calendar jsonb;approver_name text;
 starts date;ends date;v_day date;today date;mode text;fixed integer;capacity integer;charged integer;total integer:=0;
 year_charge integer;scope_version text;reason text;yr integer;
BEGIN
 -- Internal callers cannot use a guessed employee to bypass personal eligibility.
 eligibility:=private.ihr_leave_annual_eligibility(p_employee,p_at);
 IF (private.ihr_leave_readiness(p_employee,p_at)->>'ready')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Setup requires approval' USING ERRCODE='55000',DETAIL='{"code":"SETUP_APPROVAL_REQUIRED"}';END IF;
 SELECT * INTO STRICT m FROM public.ihr_leave_members WHERE user_id=p_employee;
 SELECT * INTO STRICT p FROM public.ihr_leave_policies WHERE id=m.active_policy_id;
 today:=(p_at AT TIME ZONE (eligibility->>'timezone'))::date;
 IF NOT p.request_rules_confirmed OR p.minimum_notice_days IS NULL OR p.booking_horizon_days IS NULL OR p.reason_required IS NULL
  OR p.reserve_pending_accepted IS DISTINCT FROM true OR p.single_date_rule_accepted IS DISTINCT FROM true
  OR NOT m.reserve_pending_accepted OR NOT m.single_date_rule_accepted THEN
  RAISE EXCEPTION 'Request policy requires confirmation' USING ERRCODE='55000',DETAIL='{"code":"REQUEST_RULES_UNCONFIRMED"}'; END IF;
 PERFORM private.ihr_leave_validate_payload(p_input,ARRAY['start_date','end_date','duration','reason'],ARRAY['start_date','end_date','duration','reason']);
 IF jsonb_typeof(p_input->'start_date') IS DISTINCT FROM 'string' OR jsonb_typeof(p_input->'end_date') IS DISTINCT FROM 'string'
  OR p_input->>'start_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR p_input->>'end_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  OR jsonb_typeof(p_input->'reason') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Invalid request input' USING ERRCODE='22023',DETAIL='{"code":"INVALID_QUOTE_INPUT"}'; END IF;
 starts:=(p_input->>'start_date')::date;ends:=(p_input->>'end_date')::date;reason:=p_input->>'reason';
 IF extract(year FROM starts) NOT BETWEEN 1 AND 9998 OR extract(year FROM ends) NOT BETWEEN 1 AND 9998
  OR starts>ends OR ends-starts>365 OR starts<today OR starts<today+p.minimum_notice_days OR ends>today+p.booking_horizon_days THEN
  RAISE EXCEPTION 'Date range is outside request rules' USING ERRCODE='22023',DETAIL='{"code":"INVALID_QUOTE_RANGE"}'; END IF;
 IF length(reason)>1000 OR (p.reason_required AND length(btrim(reason))=0) THEN
  RAISE EXCEPTION 'Request reason is required or too long' USING ERRCODE='22023',DETAIL='{"code":"INVALID_QUOTE_REASON"}'; END IF;
 mode:=p_input->'duration'->>'mode';
 IF mode='full_scheduled_day' THEN
  PERFORM private.ihr_leave_validate_payload(p_input->'duration',ARRAY['mode'],ARRAY['mode']);
 ELSIF mode='fixed_minutes' THEN
  PERFORM private.ihr_leave_validate_payload(p_input->'duration',ARRAY['mode','minutes'],ARRAY['mode','minutes']);
  IF jsonb_typeof(p_input->'duration'->'minutes') IS DISTINCT FROM 'number' OR p_input->'duration'->>'minutes' NOT IN('60','120','180','225','240','300','360') THEN
   RAISE EXCEPTION 'Unsupported duration' USING ERRCODE='22023',DETAIL='{"code":"INVALID_QUOTE_DURATION"}'; END IF;
  fixed:=(p_input->'duration'->>'minutes')::integer;
 ELSE RAISE EXCEPTION 'Unsupported duration' USING ERRCODE='22023',DETAIL='{"code":"INVALID_QUOTE_DURATION"}'; END IF;
 SELECT ar.* INTO assignment FROM public.ihr_leave_approvers ar
 WHERE ar.employee_id=p_employee AND ar.revoked_at IS NULL AND ar.effective_from<=p_at AND (ar.effective_until IS NULL OR ar.effective_until>p_at)
  AND private.ihr_leave_is_approver(ar.approver_id,p_employee,p_at);
 IF assignment.id IS NULL THEN RAISE EXCEPTION 'Current approver unavailable' USING ERRCODE='55000',DETAIL='{"code":"APPROVER_UNAVAILABLE"}'; END IF;
 SELECT * INTO STRICT approver_member FROM public.ihr_leave_members WHERE user_id=assignment.approver_id;
 SELECT full_name INTO approver_name FROM public.users WHERE id=assignment.approver_id;
 SELECT to_jsonb(c) INTO current_calendar FROM public.ihr_leave_calendars c WHERE c.calendar_id=m.active_calendar_id
  AND c.effective_from<=today AND (c.effective_until IS NULL OR c.effective_until>today) ORDER BY c.version DESC LIMIT 1;
 FOR v_day IN SELECT starts+n FROM generate_series(0,ends-starts) n LOOP
  IF v_day<p.effective_from OR (p.effective_until IS NOT NULL AND v_day>=p.effective_until) THEN
   RAISE EXCEPTION 'Policy does not cover requested dates' USING ERRCODE='55000',DETAIL='{"code":"POLICY_COVERAGE_MISSING"}'; END IF;
  working:=private.ihr_working_day_v1(p_employee,v_day);
  IF working ? 'error' THEN
   -- Only controlled setup codes, never input/reason or backend diagnostics.
   RAISE EXCEPTION 'Calendar setup incomplete' USING ERRCODE='55000',DETAIL=jsonb_build_object('code',working->>'error')::text; END IF;
  capacity:=(working->>'capacity_minutes')::integer;charged:=CASE WHEN capacity=0 THEN 0 WHEN mode='full_scheduled_day' THEN capacity ELSE fixed END;
  IF charged>capacity THEN RAISE EXCEPTION 'Selected duration exceeds a scheduled shift' USING ERRCODE='22023',DETAIL='{"code":"DURATION_EXCEEDS_SHIFT"}'; END IF;
  SELECT sg.* INTO g FROM public.ihr_saturday_memberships sm JOIN public.ihr_saturday_groups sg ON sg.id=sm.group_id WHERE sm.id=(working->>'membership_id')::uuid;
  source:=jsonb_build_object('calendarId',working->'calendar_id','calendarVersion',working->'calendar_version',
   'rosterId',working->'roster_id','rosterVersion',working->'roster_version','membershipId',working->'membership_id','membershipVersion',working->'membership_version',
   'groupId',g.id,'groupVersion',g.version,'groupName',g.name);
  -- Full immutable selected calendar content plus dated exception identity participates in the hash.
  sources:=sources||jsonb_build_array(jsonb_build_object('day',v_day,'working',working,'group',to_jsonb(g),
   'calendar',(SELECT to_jsonb(c) FROM public.ihr_leave_calendars c WHERE c.id=(working->>'calendar_id')::uuid),
   'exception',(SELECT to_jsonb(e) FROM public.ihr_leave_calendar_exceptions e WHERE e.calendar_version_id=(working->>'calendar_id')::uuid AND e.day=v_day)));
  yr:=extract(year FROM v_day)::integer;
  a:=NULL;
  IF charged>0 THEN
   SELECT * INTO a FROM public.ihr_leave_accounts WHERE employee_id=p_employee AND leave_type='annual' AND year=yr;
   IF a.id IS NULL OR NOT a.opening_reconciled OR NOT private.ihr_leave_policy_account_compatible(p_employee,a.policy_id,p.id) OR a.timezone<>(eligibility->>'timezone')
    OR v_day<a.period_start OR v_day>=a.period_end OR today>=a.period_end OR m.eligibility_date>a.period_start
    OR NOT EXISTS(SELECT 1 FROM public.ihr_leave_ledger l WHERE l.account_id=a.id AND l.kind='annual_grant' AND l.effective_date=a.period_start AND l.allowance_delta=5400) THEN
    RAISE EXCEPTION 'Verified eligible annual account unavailable' USING ERRCODE='55000',DETAIL='{"code":"ACCOUNT_UNAVAILABLE"}'; END IF;
  END IF;
  days:=days||jsonb_build_array(jsonb_build_object('date',v_day,'scheduledMinutes',capacity,'chargedMinutes',charged,'exclusion',working->'exclusion',
   'year',CASE WHEN charged>0 THEN yr END,'accountId',a.id,'sources',source));
  total:=total+charged;
 END LOOP;
 IF total=0 THEN RAISE EXCEPTION 'No chargeable dates' USING ERRCODE='22023',DETAIL='{"code":"NO_CHARGEABLE_DATES"}'; END IF;
 FOR a IN SELECT ac.* FROM public.ihr_leave_accounts ac WHERE ac.employee_id=p_employee
  AND ac.id IN(SELECT (d->>'accountId')::uuid FROM jsonb_array_elements(days) d WHERE d->>'accountId' IS NOT NULL) ORDER BY ac.year,ac.id LOOP
  SELECT sum((d->>'chargedMinutes')::integer)::integer INTO year_charge FROM jsonb_array_elements(days) d WHERE d->>'accountId'=a.id::text;
  balance:=private.ihr_leave_balance_json(a,p_at);
  IF (balance->>'reconciled')::boolean IS DISTINCT FROM true OR balance->>'availableMinutes' IS NULL OR (balance->>'availableMinutes')::integer<year_charge THEN
   RAISE EXCEPTION 'Available allowance is insufficient' USING ERRCODE='55000',DETAIL='{"code":"INSUFFICIENT_ALLOWANCE"}'; END IF;
  allocations:=allocations||jsonb_build_array(jsonb_build_object('accountId',a.id,'year',a.year,'version',a.version,'chargedMinutes',year_charge,
   'availableBefore',(balance->>'availableMinutes')::integer,'availableAfter',(balance->>'availableMinutes')::integer-year_charge));
  account_sources:=account_sources||jsonb_build_array(to_jsonb(a));
 END LOOP;
 scope_version:=private.ihr_leave_scope_version(p_employee);
 result:=jsonb_build_object('startDate',starts,'endDate',ends,'duration',p_input->'duration','today',today,'totalMinutes',total,'days',days,'allocations',allocations,
  'approver',jsonb_build_object('id',assignment.approver_id,'name',approver_name,'assignmentId',assignment.id,'assignmentVersion',assignment.version),
  'policy',jsonb_build_object('id',p.id,'version',p.version),'memberVersion',m.version,'scopeVersion',scope_version);
 RETURN result||jsonb_build_object('fingerprint',encode(sha256(convert_to(jsonb_build_object('input',p_input,'employee',to_jsonb(m),'policy',to_jsonb(p),
  'currentCalendar',current_calendar,'sources',sources,'accounts',account_sources,'assignment',to_jsonb(assignment),'approver',to_jsonb(approver_member),
  'quote',result-'scopeVersion')::text,'UTF8')),'hex'));
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'Invalid request input' USING ERRCODE='22023',DETAIL='{"code":"INVALID_QUOTE_INPUT"}';
END;
$$;
-- Legacy account entry points acquire no scope latch before account waits.
CREATE OR REPLACE FUNCTION private.ihr_leave_dispatch_account_command(p_actor uuid,p_operation text,p_payload jsonb,p_authorized_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE actor uuid;at_time timestamptz;target uuid;
BEGIN
 IF p_operation NOT IN('reconcile_opening','adjust_balance') THEN RETURN private.ihr_leave_dispatch_calendar_command(p_actor,p_operation,p_payload,p_authorized_at);END IF;
 target:=(p_payload->>'employee_id')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-setup',0));
 SELECT private.ihr_leave_require_actor(),clock_timestamp() INTO actor,at_time;
 IF actor IS DISTINCT FROM p_actor OR p_authorized_at IS NULL THEN RAISE EXCEPTION 'Invalid authority' USING ERRCODE='42501';END IF;
 PERFORM private.ihr_leave_authorize_command(actor,p_operation,p_payload,at_time);
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-approver:'||target::text,0));
 SELECT private.ihr_leave_require_actor(),clock_timestamp() INTO actor,at_time;PERFORM private.ihr_leave_authorize_command(actor,p_operation,p_payload,at_time);
 PERFORM version FROM private.ihr_leave_scope_revision WHERE singleton;
 IF p_operation='reconcile_opening' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('ihr-occupancy:'||target::text,0));
  SELECT private.ihr_leave_require_actor(),clock_timestamp() INTO actor,at_time;PERFORM private.ihr_leave_authorize_command(actor,p_operation,p_payload,at_time);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-account:'||target::text||':'||(p_payload->>'year'),0));
 SELECT private.ihr_leave_require_actor(),clock_timestamp() INTO actor,at_time;PERFORM private.ihr_leave_authorize_command(actor,p_operation,p_payload,at_time);
 PERFORM id FROM public.ihr_leave_accounts WHERE employee_id=target AND year=(p_payload->>'year')::integer FOR UPDATE;
 SELECT private.ihr_leave_require_actor(),clock_timestamp() INTO actor,at_time;PERFORM private.ihr_leave_authorize_command(actor,p_operation,p_payload,at_time);
 CASE p_operation WHEN 'reconcile_opening' THEN RETURN private.ihr_leave_reconcile_opening(actor,p_payload,at_time); WHEN 'adjust_balance' THEN RETURN private.ihr_leave_adjust_balance(actor,p_payload,at_time);END CASE;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_datetime_format OR datetime_field_overflow OR unique_violation THEN RAISE EXCEPTION 'Invalid or duplicate account input' USING ERRCODE='22023',DETAIL='{"code":"INVALID_ACCOUNT_INPUT"}';
END;
$$;
CREATE OR REPLACE FUNCTION public.leave_prepare_self_v1() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();at_time timestamptz;e jsonb;a public.ihr_leave_accounts%ROWTYPE;
BEGIN
 PERFORM private.ihr_leave_require_command_isolation();
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-setup',0));
 SELECT private.ihr_leave_require_actor(),clock_timestamp() INTO actor,at_time;PERFORM private.ihr_leave_annual_eligibility(actor,at_time);
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-approver:'||actor::text,0));
 SELECT private.ihr_leave_require_actor(),clock_timestamp() INTO actor,at_time;e:=private.ihr_leave_annual_eligibility(actor,at_time);
 PERFORM version FROM private.ihr_leave_scope_revision WHERE singleton;
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-account:'||actor::text||':'||(e->>'year'),0));
 SELECT private.ihr_leave_require_actor(),clock_timestamp() INTO actor,at_time;PERFORM private.ihr_leave_annual_eligibility(actor,at_time);
 PERFORM id FROM public.ihr_leave_accounts WHERE employee_id=actor AND year=(e->>'year')::integer FOR UPDATE;
 SELECT private.ihr_leave_require_actor(),clock_timestamp() INTO actor,at_time;PERFORM private.ihr_leave_annual_eligibility(actor,at_time);
 IF NOT private.ihr_leave_governance_valid(actor,'retention',at_time) OR NOT private.ihr_leave_governance_valid(actor,'access_review',at_time)
  OR NOT EXISTS(SELECT 1 FROM public.ihr_leave_members m JOIN public.ihr_leave_policies p ON p.id=m.active_policy_id WHERE m.user_id=actor AND p.calendar_audience_confirmed AND p.calendar_audience='explicit_grants') THEN RAISE EXCEPTION 'Setup approval required' USING ERRCODE='55000',DETAIL='{"code":"SETUP_APPROVAL_REQUIRED"}';END IF;
 a:=private.ihr_leave_prepare_account(actor,at_time);
 RETURN jsonb_build_object('accountId',a.id,'year',a.year,'version',a.version);
END;
$$;
REVOKE ALL ON FUNCTION private.ihr_leave_dispatch_account_command(uuid,text,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.ihr_leave_admin_authority_key(uuid,uuid),private.ihr_leave_evidenced_access(uuid,uuid,timestamptz),private.ihr_leave_governance_valid(uuid,text,timestamptz),private.ihr_leave_readiness(uuid,timestamptz),private.ihr_leave_quote_before_admin_v1(uuid,jsonb,timestamptz),private.ihr_leave_quote_v1(uuid,jsonb,timestamptz),private.ihr_leave_admin_authorize(uuid,text,jsonb,timestamptz),private.ihr_leave_authorize_before_admin(uuid,text,jsonb,timestamptz),private.ihr_leave_authorize_command(uuid,text,jsonb,timestamptz),private.ihr_leave_policy_json(public.ihr_leave_policies),private.ihr_leave_apply_admin(uuid,text,jsonb,timestamptz,uuid),private.ihr_leave_dispatch_before_admin(uuid,text,jsonb,timestamptz),private.ihr_leave_dispatch_command(uuid,text,jsonb,timestamptz),private.ihr_leave_request_assignment(public.ihr_leave_requests),private.ihr_leave_request_transition_guard(),private.ihr_leave_policy_account_compatible(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.leave_admin_write_context_v1(uuid),public.leave_admin_targets_v1(integer,integer),public.leave_admin_readiness_v1(uuid),public.leave_admin_settings_v1(uuid),public.leave_admin_access_v1(uuid),public.leave_admin_requests_v1(uuid,bigint,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.leave_admin_write_context_v1(uuid),public.leave_admin_targets_v1(integer,integer),public.leave_admin_readiness_v1(uuid),public.leave_admin_settings_v1(uuid),public.leave_admin_access_v1(uuid),public.leave_admin_requests_v1(uuid,bigint,integer) TO authenticated;
-- Same global-configure audience and selected-calendar projection as the existing rota setup read.
-- The authority proof excludes data revisions so an own calendar/roster save can prove continuity.
CREATE FUNCTION public.leave_admin_rota_context_v1(p_calendar_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();at_time timestamptz:=statement_timestamp();calendar jsonb;grants jsonb;
BEGIN
 IF NOT private.ihr_leave_global_config(actor,at_time) THEN RAISE EXCEPTION 'Leave access denied' USING ERRCODE='42501',DETAIL='{"code":"GLOBAL_CONFIG_REQUIRED"}';END IF;
 SELECT jsonb_build_object('id',k.id,'name',c.name,'version',k.version,'effectiveFrom',c.effective_from,'effectiveUntil',c.effective_until,
  'timezone',c.timezone,'confirmedTimezone',private.ihr_leave_calendar_timezone(k.id),'holidaysConfirmed',c.holidays_confirmed,'sundayMinutes',c.sunday_minutes,
  'holidays',(SELECT coalesce(jsonb_agg(e.day ORDER BY e.day),'[]'::jsonb) FROM public.ihr_leave_calendar_exceptions e WHERE e.calendar_version_id=c.id),
  'groups',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'onAnchor',NULL) ORDER BY g.name,g.id),'[]'::jsonb) FROM public.ihr_saturday_groups g WHERE g.calendar_id=k.id),
  'impacts',jsonb_build_object('available',false,'pendingCount',NULL,'approvedCount',NULL)) INTO calendar
 FROM private.ihr_leave_calendar_registry k CROSS JOIN LATERAL(SELECT * FROM public.ihr_leave_calendars c WHERE c.calendar_id=k.id ORDER BY c.version DESC LIMIT 1)c
 WHERE k.id=p_calendar_id;
 IF calendar IS NULL THEN RAISE EXCEPTION 'Leave access denied' USING ERRCODE='42501',DETAIL='{"code":"GLOBAL_CONFIG_REQUIRED"}';END IF;
 SELECT jsonb_agg(jsonb_build_object('id',g.id,'version',g.version,'capability',g.capability,'scopeKind',g.scope_kind,'employeeId',g.employee_id,'effectiveFrom',g.effective_from,'effectiveUntil',g.effective_until) ORDER BY g.id) INTO grants
 FROM public.ihr_leave_access_grants g WHERE g.actor_id=actor AND g.capability='configure' AND g.scope_kind='all_policy_members'
  AND g.revoked_at IS NULL AND g.effective_from<=at_time AND (g.effective_until IS NULL OR g.effective_until>at_time);
 RETURN jsonb_build_object('calendarId',p_calendar_id,'scopeVersion',private.ihr_leave_scope_version(actor),
  'authorityKey',encode(sha256(convert_to(jsonb_build_object('actor',actor,'calendarId',p_calendar_id,'grants',grants)::text,'UTF8')),'hex'),'calendar',calendar);
END;
$$;
REVOKE ALL ON FUNCTION public.leave_admin_rota_context_v1(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.leave_admin_rota_context_v1(uuid) TO authenticated;
COMMIT;
