-- Unpublished iHR candidate. No people, employment dates, policy settings or bootstrap grants.
-- Dedicated authority; application roles and pilot business-data helpers confer no HR rights.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE public.ihr_leave_members (
  user_id uuid PRIMARY KEY REFERENCES public.users(id),
  member_kind text NOT NULL CHECK (member_kind IN ('employee','manager','director')),
  active boolean NOT NULL DEFAULT false,
  employment_start date,
  eligibility_date date,
  cycle_state text NOT NULL DEFAULT 'first_grant_blocked' CHECK (cycle_state IN ('established_calendar','first_grant_blocked')),
  timezone text,
  -- Owning domain migrations add the referenced policy/calendar tables and foreign keys.
  active_policy_id uuid,
  active_calendar_id uuid,
  first_grant_policy_id uuid,
  annual_policy_confirmed boolean NOT NULL DEFAULT false,
  opening_reconciled boolean NOT NULL DEFAULT false,
  reserve_pending_accepted boolean NOT NULL DEFAULT false,
  single_date_rule_accepted boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 1 CHECK (version>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (eligibility_date IS NULL OR (employment_start IS NOT NULL AND eligibility_date>=employment_start)),
  CHECK (timezone IS NULL OR length(btrim(timezone))>0),
  CHECK (member_kind<>'director' OR (active_policy_id IS NULL AND active_calendar_id IS NULL AND first_grant_policy_id IS NULL AND NOT annual_policy_confirmed))
);
CREATE TABLE public.ihr_leave_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.users(id),
  capability text NOT NULL CHECK (capability IN ('configure','adjust','read_private','calendar','manage_access')),
  scope_kind text NOT NULL CHECK (scope_kind IN ('employee','all_policy_members')),
  employee_id uuid REFERENCES public.users(id),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  granted_by uuid NOT NULL REFERENCES public.users(id),
  reason text NOT NULL CHECK (length(btrim(reason))>0),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((scope_kind='employee' AND employee_id IS NOT NULL) OR (scope_kind='all_policy_members' AND employee_id IS NULL)),
  CHECK (effective_until IS NULL OR effective_until>effective_from),
  CHECK ((revoked_at IS NULL)=(revoked_by IS NULL)),
  CHECK (actor_id<>granted_by)
);
CREATE INDEX ihr_leave_grants_actor_idx ON public.ihr_leave_access_grants(actor_id,capability) WHERE revoked_at IS NULL;
CREATE TABLE public.ihr_leave_approvers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.ihr_leave_members(user_id),
  approver_id uuid NOT NULL REFERENCES public.ihr_leave_members(user_id),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  assigned_by uuid NOT NULL REFERENCES public.users(id),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (employee_id<>approver_id),
  CHECK (effective_until IS NULL OR effective_until>effective_from),
  CHECK ((revoked_at IS NULL)=(revoked_by IS NULL))
);
CREATE INDEX ihr_leave_approvers_employee_idx ON public.ihr_leave_approvers(employee_id) WHERE revoked_at IS NULL;
CREATE INDEX ihr_leave_approvers_actor_idx ON public.ihr_leave_approvers(approver_id) WHERE revoked_at IS NULL;
CREATE TABLE public.ihr_leave_admin_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.users(id),
  operation text NOT NULL CHECK (length(btrim(operation))>0),
  target_user_id uuid REFERENCES public.users(id),
  command_request_id uuid,
  before_data jsonb,
  after_data jsonb,
  reason text NOT NULL CHECK (length(btrim(reason))>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE private.ihr_leave_commands (
  actor_id uuid NOT NULL REFERENCES public.users(id),
  request_id uuid NOT NULL,
  operation text,
  payload jsonb,
  result jsonb,
  abandoned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(actor_id,request_id),
  CHECK (payload IS NULL OR jsonb_typeof(payload)='object'),
  CHECK (result IS NULL OR jsonb_typeof(result)='object'),
  CHECK (NOT abandoned OR result IS NULL),
  CHECK (abandoned OR (operation IS NOT NULL AND payload IS NOT NULL))
);
-- Transactional metadata only. A sequence could expose an uncommitted revision prematurely.
CREATE TABLE private.ihr_leave_scope_revision (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version bigint NOT NULL CHECK (version>0)
);
INSERT INTO private.ihr_leave_scope_revision(singleton,version) VALUES(true,1);
ALTER TABLE public.ihr_leave_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ihr_leave_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ihr_leave_approvers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ihr_leave_admin_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.ihr_leave_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.ihr_leave_scope_revision ENABLE ROW LEVEL SECURITY;
-- No permissive client policies, including for scoped HR administrators.
REVOKE ALL ON public.ihr_leave_members,public.ihr_leave_access_grants,public.ihr_leave_approvers,
 public.ihr_leave_admin_events,private.ihr_leave_commands,private.ihr_leave_scope_revision FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.ihr_leave_bump_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 UPDATE private.ihr_leave_scope_revision SET version=version+1 WHERE singleton;
 RETURN NULL;
END;
$$;
CREATE TRIGGER ihr_leave_members_scope AFTER INSERT OR UPDATE OR DELETE ON public.ihr_leave_members FOR EACH STATEMENT EXECUTE FUNCTION private.ihr_leave_bump_scope();
CREATE TRIGGER ihr_leave_grants_scope AFTER INSERT OR UPDATE OR DELETE ON public.ihr_leave_access_grants FOR EACH STATEMENT EXECUTE FUNCTION private.ihr_leave_bump_scope();
CREATE TRIGGER ihr_leave_approvers_scope AFTER INSERT OR UPDATE OR DELETE ON public.ihr_leave_approvers FOR EACH STATEMENT EXECUTE FUNCTION private.ihr_leave_bump_scope();
CREATE TRIGGER ihr_leave_user_active_scope AFTER UPDATE OF is_active ON public.users FOR EACH STATEMENT EXECUTE FUNCTION private.ihr_leave_bump_scope();
CREATE FUNCTION private.ihr_leave_version_row() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.version:=1; ELSE NEW.version:=OLD.version+1; END IF;
 NEW.updated_at:=clock_timestamp(); RETURN NEW;
END;
$$;
CREATE TRIGGER ihr_leave_member_version BEFORE INSERT OR UPDATE ON public.ihr_leave_members FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_version_row();
CREATE TRIGGER ihr_leave_grant_version BEFORE INSERT OR UPDATE ON public.ihr_leave_access_grants FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_version_row();
CREATE TRIGGER ihr_leave_approver_version BEFORE INSERT OR UPDATE ON public.ihr_leave_approvers FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_version_row();
CREATE FUNCTION private.ihr_leave_require_actor() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id=actor AND u.is_active) THEN
  RAISE EXCEPTION 'Leave access denied' USING ERRCODE='42501',DETAIL='{"code":"ACTIVE_ACTOR_REQUIRED"}';
 END IF;
 RETURN actor;
END;
$$;
-- NULL employee means capability discovery only, never permission for an unspecified target.
-- Commands MUST pass their captured post-lock authorized_at. Defaults are for STABLE reads.
CREATE FUNCTION private.ihr_leave_has_grant(p_actor uuid,p_capability text,p_employee uuid DEFAULT NULL,p_authorized_at timestamptz DEFAULT statement_timestamp()) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.ihr_leave_access_grants g JOIN public.users u ON u.id=g.actor_id AND u.is_active
  WHERE g.actor_id=p_actor AND g.capability=p_capability AND g.revoked_at IS NULL
   AND g.effective_from <= p_authorized_at AND (g.effective_until IS NULL OR g.effective_until > p_authorized_at)
   AND NOT EXISTS (SELECT 1 FROM public.ihr_leave_members am WHERE am.user_id=p_actor AND am.member_kind='director')
   AND (p_employee IS NULL OR (g.scope_kind='employee' AND g.employee_id=p_employee)
    OR (g.scope_kind='all_policy_members' AND EXISTS (SELECT 1 FROM public.ihr_leave_members m WHERE m.user_id=p_employee AND m.member_kind IN ('employee','manager'))))
 );
$$;
CREATE FUNCTION private.ihr_leave_is_approver(p_actor uuid,p_employee uuid DEFAULT NULL,p_authorized_at timestamptz DEFAULT statement_timestamp()) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.ihr_leave_approvers a
  JOIN public.users actor ON actor.id=a.approver_id AND actor.is_active
  JOIN public.users employee ON employee.id=a.employee_id AND employee.is_active
  JOIN public.ihr_leave_members am ON am.user_id=a.approver_id AND am.active
  JOIN public.ihr_leave_members em ON em.user_id=a.employee_id AND em.active
  WHERE a.approver_id=p_actor AND a.employee_id<>p_actor AND (p_employee IS NULL OR a.employee_id=p_employee)
   AND a.revoked_at IS NULL AND a.effective_from <= p_authorized_at AND (a.effective_until IS NULL OR a.effective_until > p_authorized_at)
   AND ((am.member_kind='manager' AND em.member_kind='employee') OR (am.member_kind='director' AND em.member_kind='manager'))
 );
$$;
CREATE FUNCTION private.ihr_leave_can_read_employee(p_actor uuid,p_employee uuid,p_authorized_at timestamptz DEFAULT statement_timestamp()) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id=p_actor AND u.is_active)
  AND EXISTS (SELECT 1 FROM public.ihr_leave_members m WHERE m.user_id=p_employee AND m.member_kind IN ('employee','manager'))
  AND (p_actor=p_employee OR private.ihr_leave_is_approver(p_actor,p_employee,p_authorized_at)
   OR private.ihr_leave_has_grant(p_actor,'read_private',p_employee,p_authorized_at));
$$;
CREATE FUNCTION private.ihr_leave_guard_member() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=auth.uid(); target uuid; authorized_at timestamptz:=clock_timestamp();
BEGIN
 IF TG_OP='DELETE' THEN target:=OLD.user_id; ELSE target:=NEW.user_id; END IF;
 IF actor IS NOT NULL THEN
  PERFORM private.ihr_leave_require_actor();
  IF actor=target OR NOT private.ihr_leave_has_grant(actor,'configure',target,authorized_at) THEN
   RAISE EXCEPTION 'Leave setup denied' USING ERRCODE='42501',DETAIL='{"code":"MEMBER_SETUP_DENIED"}';
  END IF;
 END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.user_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.user_id,OLD.created_at) THEN
  RAISE EXCEPTION 'Member identity is immutable' USING ERRCODE='55000',DETAIL='{"code":"MEMBER_IDENTITY_IMMUTABLE"}';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$;
CREATE TRIGGER ihr_leave_member_guard BEFORE INSERT OR UPDATE OR DELETE ON public.ihr_leave_members FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_guard_member();
CREATE FUNCTION private.ihr_leave_guard_grant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=auth.uid(); target uuid; scope text;
 -- A separate stricter write boundary; never trust a caller-settable GUC for authority time.
 authorized_at timestamptz := clock_timestamp();
BEGIN
 IF TG_OP='DELETE' THEN target:=OLD.employee_id; scope:=OLD.scope_kind; ELSE target:=NEW.employee_id; scope:=NEW.scope_kind; END IF;
 IF actor IS NOT NULL THEN
  PERFORM private.ihr_leave_require_actor();
  IF (TG_OP<>'INSERT' AND OLD.actor_id=actor) OR (TG_OP<>'DELETE' AND NEW.actor_id=actor) THEN
   RAISE EXCEPTION 'Cannot change own leave access' USING ERRCODE='42501',DETAIL='{"code":"SELF_ESCALATION_DENIED"}';
  END IF;
  IF NOT private.ihr_leave_has_grant(actor,'manage_access',target,authorized_at) OR
   (scope='all_policy_members' AND NOT EXISTS (SELECT 1 FROM public.ihr_leave_access_grants g
    WHERE g.actor_id=actor AND g.capability='manage_access' AND g.scope_kind='all_policy_members' AND g.revoked_at IS NULL
     AND g.effective_from <= authorized_at AND (g.effective_until IS NULL OR g.effective_until > authorized_at))) THEN
   RAISE EXCEPTION 'Leave access denied' USING ERRCODE='42501',DETAIL='{"code":"ACCESS_DENIED"}';
  END IF;
  IF TG_OP='INSERT' AND NEW.granted_by IS DISTINCT FROM actor THEN
   RAISE EXCEPTION 'Invalid grantor' USING ERRCODE='22023',DETAIL='{"code":"INVALID_GRANTOR"}';
  END IF;
 END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.id,NEW.actor_id,NEW.capability,NEW.scope_kind,NEW.employee_id,NEW.granted_by,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.actor_id,OLD.capability,OLD.scope_kind,OLD.employee_id,OLD.granted_by,OLD.created_at) THEN
  RAISE EXCEPTION 'Revoke and replace a grant to change its scope' USING ERRCODE='55000',DETAIL='{"code":"GRANT_IDENTITY_IMMUTABLE"}';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$;
CREATE TRIGGER ihr_leave_access_guard BEFORE INSERT OR UPDATE OR DELETE ON public.ihr_leave_access_grants FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_guard_grant();
CREATE FUNCTION private.ihr_leave_guard_approver() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=auth.uid(); authorized_at timestamptz;
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.id,NEW.employee_id,NEW.approver_id,NEW.assigned_by,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.employee_id,OLD.approver_id,OLD.assigned_by,OLD.created_at) THEN
  RAISE EXCEPTION 'Replace an assignment to change its actors' USING ERRCODE='55000',DETAIL='{"code":"ASSIGNMENT_IDENTITY_IMMUTABLE"}';
 END IF;
 -- Later setup handlers acquire the global setup/assignment locks in documented order first.
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-approver:' || NEW.employee_id::text,0));
 authorized_at:=clock_timestamp();
 IF actor IS NOT NULL THEN
  PERFORM private.ihr_leave_require_actor();
  IF actor=NEW.employee_id OR actor=NEW.approver_id OR NOT private.ihr_leave_has_grant(actor,'configure',NEW.employee_id,authorized_at) THEN
   RAISE EXCEPTION 'Approver setup denied' USING ERRCODE='42501',DETAIL='{"code":"APPROVER_SETUP_DENIED"}';
  END IF;
 END IF;
 IF NEW.revoked_at IS NULL AND NOT EXISTS (
  SELECT 1 FROM public.ihr_leave_members em JOIN public.ihr_leave_members am ON am.user_id=NEW.approver_id
  JOIN public.users eu ON eu.id=em.user_id AND eu.is_active
  JOIN public.users au ON au.id=am.user_id AND au.is_active
  WHERE em.user_id=NEW.employee_id AND em.active AND am.active
   AND ((em.member_kind='employee' AND am.member_kind='manager') OR (em.member_kind='manager' AND am.member_kind='director'))
 ) THEN RAISE EXCEPTION 'Invalid approval route' USING ERRCODE='22023',DETAIL='{"code":"INVALID_APPROVER_ROUTE"}'; END IF;
 IF NEW.revoked_at IS NULL AND EXISTS (SELECT 1 FROM public.ihr_leave_approvers a
  WHERE a.employee_id=NEW.employee_id AND a.id<>NEW.id AND a.revoked_at IS NULL
   AND tstzrange(a.effective_from,a.effective_until,'[)') && tstzrange(NEW.effective_from,NEW.effective_until,'[)')) THEN
  RAISE EXCEPTION 'Approver intervals overlap' USING ERRCODE='55000',DETAIL='{"code":"APPROVER_OVERLAP"}';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER ihr_leave_approver_guard BEFORE INSERT OR UPDATE ON public.ihr_leave_approvers FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_guard_approver();
CREATE FUNCTION private.ihr_leave_immutable_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 RAISE EXCEPTION 'Leave audit is immutable' USING ERRCODE='42501',DETAIL='{"code":"AUDIT_IMMUTABLE"}';
END;
$$;
CREATE TRIGGER ihr_leave_audit_immutable BEFORE UPDATE OR DELETE ON public.ihr_leave_admin_events FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_immutable_audit();
CREATE TRIGGER ihr_leave_audit_no_truncate BEFORE TRUNCATE ON public.ihr_leave_admin_events FOR EACH STATEMENT EXECUTE FUNCTION private.ihr_leave_immutable_audit();
CREATE FUNCTION private.ihr_leave_scope_version(p_actor uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 -- Effective-window transitions must change a token even with no database write/global role change.
 SELECT s.version::text || ':' || md5(jsonb_build_object('actor',p_actor,
  'grants',(SELECT coalesce(jsonb_agg(g.id ORDER BY g.id),'[]'::jsonb) FROM public.ihr_leave_access_grants g
    WHERE g.actor_id=p_actor AND g.revoked_at IS NULL AND g.effective_from<=statement_timestamp() AND (g.effective_until IS NULL OR g.effective_until>statement_timestamp())),
  'assignments',(SELECT coalesce(jsonb_agg(a.id ORDER BY a.id),'[]'::jsonb) FROM public.ihr_leave_approvers a
    WHERE (a.approver_id=p_actor OR a.employee_id=p_actor) AND a.revoked_at IS NULL AND a.effective_from<=statement_timestamp() AND (a.effective_until IS NULL OR a.effective_until>statement_timestamp()))
 )::text) FROM private.ihr_leave_scope_revision s WHERE s.singleton;
$$;
CREATE FUNCTION private.ihr_leave_validate_payload(p_payload jsonb,p_allowed_keys text[],p_required_keys text[] DEFAULT '{}') RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_allowed_keys IS NULL OR p_required_keys IS NULL THEN
  RAISE EXCEPTION 'Invalid payload' USING ERRCODE='22023',DETAIL='{"code":"INVALID_PAYLOAD"}';
 END IF;
 IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) AS keys(key) WHERE NOT (key=ANY(p_allowed_keys)))
  OR EXISTS (SELECT 1 FROM unnest(p_required_keys) AS keys(key) WHERE NOT (p_payload ? key)) THEN
  RAISE EXCEPTION 'Unsupported or missing payload key' USING ERRCODE='22023',DETAIL='{"code":"INVALID_PAYLOAD_KEYS"}';
 END IF;
END;
$$;
-- Later migrations add only their explicit CASE operations, preserving this authority preamble.
-- STABLE authorization shares its fresh calling-query snapshot. Pass p_authorized_at explicitly
-- through every temporal helper. After further relevant waits, refresh actor/time/authority again.
CREATE FUNCTION private.ihr_leave_authorize_command(p_actor uuid,p_operation text,p_payload jsonb,p_authorized_at timestamptz) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
BEGIN
 IF p_authorized_at IS NULL OR p_actor IS DISTINCT FROM private.ihr_leave_require_actor() THEN
  RAISE EXCEPTION 'Invalid command authority' USING ERRCODE='42501',DETAIL='{"code":"COMMAND_AUTHORITY_REQUIRED"}';
 END IF;
 PERFORM private.ihr_leave_validate_payload(p_payload,'{}'::text[]);
 CASE p_operation
  WHEN '' THEN RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023',DETAIL='{"code":"INVALID_OPERATION"}';
  ELSE RAISE EXCEPTION 'Unsupported leave operation' USING ERRCODE='22023',DETAIL='{"code":"UNSUPPORTED_OPERATION"}';
 END CASE;
END;
$$;
CREATE FUNCTION private.ihr_leave_dispatch_command(p_actor uuid,p_operation text,p_payload jsonb,p_authorized_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 CASE p_operation
  WHEN '' THEN RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023',DETAIL='{"code":"INVALID_OPERATION"}';
  ELSE RAISE EXCEPTION 'Unsupported leave operation' USING ERRCODE='22023',DETAIL='{"code":"UNSUPPORTED_OPERATION"}';
 END CASE;
END;
$$;
CREATE FUNCTION public.leave_context_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor(); member public.ihr_leave_members%ROWTYPE;
 blockers jsonb:='[]'::jsonb; can_request boolean:=false;
BEGIN
 SELECT * INTO member FROM public.ihr_leave_members m WHERE m.user_id=actor;
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
CREATE FUNCTION public.leave_admin_setup_v1(p_section text,p_page int,p_page_size int) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor(); v_rows jsonb; v_total bigint;
BEGIN
 IF NOT (private.ihr_leave_has_grant(actor,'configure') OR private.ihr_leave_has_grant(actor,'manage_access')) THEN
  RAISE EXCEPTION 'Leave access denied' USING ERRCODE='42501',DETAIL='{"code":"ACCESS_DENIED"}';
 END IF;
 IF p_section IS DISTINCT FROM 'people' OR p_page IS NULL OR p_page<1 OR p_page_size IS NULL OR p_page_size<1 OR p_page_size>100 THEN
  RAISE EXCEPTION 'Invalid directory page' USING ERRCODE='22023',DETAIL='{"code":"INVALID_DIRECTORY_PAGE"}';
 END IF;
 SELECT count(*) INTO v_total FROM public.users u WHERE private.ihr_leave_has_grant(actor,'configure',u.id) OR private.ihr_leave_has_grant(actor,'manage_access',u.id);
 SELECT coalesce(jsonb_agg(r.person ORDER BY r.name,r.id),'[]'::jsonb) INTO v_rows FROM (
  SELECT u.id,u.full_name AS name,jsonb_build_object('id',u.id,'name',u.full_name,'applicationRole',u.role,'active',u.is_active) AS person
  FROM public.users u WHERE private.ihr_leave_has_grant(actor,'configure',u.id) OR private.ihr_leave_has_grant(actor,'manage_access',u.id)
  ORDER BY u.full_name,u.id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size
 ) r;
 RETURN jsonb_build_object('rows',v_rows,'total',v_total,'page',p_page,'pageSize',p_page_size);
END;
$$;
CREATE FUNCTION private.ihr_leave_require_command_isolation() RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
BEGIN
 IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
  RAISE EXCEPTION 'Unsupported command isolation' USING ERRCODE='55000',DETAIL='{"code":"UNSUPPORTED_COMMAND_ISOLATION"}';
 END IF;
END;
$$;
-- Lock order for later handlers: actor/key command -> global setup (where needed) -> sorted
-- employee assignment -> scope revision -> sorted occupancy -> fixed request/account -> audit.
-- No user/scope row locks are added by these envelopes. Never acquire occupancy after accounts.
CREATE FUNCTION public.leave_transaction_v1(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor(); command private.ihr_leave_commands%ROWTYPE;
 authorized_at timestamptz; v_result jsonb;
BEGIN
 PERFORM private.ihr_leave_require_command_isolation();
 IF p_request_id IS NULL OR p_operation IS NULL OR length(btrim(p_operation))=0 OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023',DETAIL='{"code":"INVALID_COMMAND"}';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-command:' || actor::text || ':' || p_request_id::text,0));
 -- New query in VOLATILE READ COMMITTED: refresh after the wait, never use statement-start time.
 SELECT private.ihr_leave_require_actor(), clock_timestamp() INTO actor, authorized_at;
 PERFORM private.ihr_leave_authorize_command(actor,p_operation,p_payload,authorized_at);
 SELECT * INTO command FROM private.ihr_leave_commands c WHERE c.actor_id=actor AND c.request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF command.abandoned THEN RAISE EXCEPTION 'Command abandoned' USING ERRCODE='55000',DETAIL='{"code":"COMMAND_ABANDONED"}'; END IF;
  IF command.operation IS DISTINCT FROM p_operation OR command.payload IS DISTINCT FROM p_payload THEN
   RAISE EXCEPTION 'Command identity already used' USING ERRCODE='55000',DETAIL='{"code":"IDEMPOTENCY_CONFLICT"}';
  END IF;
  IF command.result IS NULL THEN RAISE EXCEPTION 'Command result unavailable' USING ERRCODE='55000',DETAIL='{"code":"COMMAND_UNRESOLVED"}'; END IF;
  RETURN command.result;
 END IF;
 INSERT INTO private.ihr_leave_commands(actor_id,request_id,operation,payload) VALUES(actor,p_request_id,p_operation,p_payload);
 v_result:=private.ihr_leave_dispatch_command(actor,p_operation,p_payload,authorized_at);
 IF v_result IS NULL THEN RAISE EXCEPTION 'Command result unavailable' USING ERRCODE='55000',DETAIL='{"code":"COMMAND_UNRESOLVED"}'; END IF;
 UPDATE private.ihr_leave_commands c SET result=v_result WHERE c.actor_id=actor AND c.request_id=p_request_id;
 RETURN v_result;
END;
$$;
CREATE FUNCTION public.leave_reconcile_request_v1(p_request_id uuid,p_abandon boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor(); command private.ihr_leave_commands%ROWTYPE; authorized_at timestamptz;
BEGIN
 PERFORM private.ihr_leave_require_command_isolation();
 IF p_request_id IS NULL OR p_abandon IS NULL THEN RAISE EXCEPTION 'Invalid reconciliation' USING ERRCODE='22023',DETAIL='{"code":"INVALID_RECONCILIATION"}'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-command:' || actor::text || ':' || p_request_id::text,0));
 SELECT private.ihr_leave_require_actor(), clock_timestamp() INTO actor, authorized_at;
 SELECT * INTO command FROM private.ihr_leave_commands c WHERE c.actor_id=actor AND c.request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF command.abandoned THEN RETURN jsonb_build_object('state','abandoned'); END IF;
  PERFORM private.ihr_leave_authorize_command(actor,command.operation,command.payload,authorized_at);
  IF command.result IS NOT NULL THEN RETURN jsonb_build_object('state','committed','result',command.result); END IF;
  RAISE EXCEPTION 'Command result unavailable' USING ERRCODE='55000',DETAIL='{"code":"COMMAND_UNRESOLVED"}';
 END IF;
 IF NOT p_abandon THEN RAISE EXCEPTION 'Command result unavailable' USING ERRCODE='55000',DETAIL='{"code":"COMMAND_UNRESOLVED"}'; END IF;
 INSERT INTO private.ihr_leave_commands(actor_id,request_id,abandoned) VALUES(actor,p_request_id,true);
 RETURN jsonb_build_object('state','abandoned');
END;
$$;
-- Close every private helper, including defaults on PostgreSQL function execution.
REVOKE ALL ON FUNCTION private.ihr_leave_bump_scope(),private.ihr_leave_version_row(),private.ihr_leave_require_actor(),
 private.ihr_leave_has_grant(uuid,text,uuid,timestamptz),private.ihr_leave_is_approver(uuid,uuid,timestamptz),private.ihr_leave_can_read_employee(uuid,uuid,timestamptz),
 private.ihr_leave_guard_member(),private.ihr_leave_guard_grant(),private.ihr_leave_guard_approver(),private.ihr_leave_immutable_audit(),
 private.ihr_leave_scope_version(uuid),private.ihr_leave_validate_payload(jsonb,text[],text[]),
 private.ihr_leave_authorize_command(uuid,text,jsonb,timestamptz),private.ihr_leave_dispatch_command(uuid,text,jsonb,timestamptz),private.ihr_leave_require_command_isolation()
 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.leave_context_v1(),public.leave_admin_setup_v1(text,int,int),public.leave_transaction_v1(uuid,text,jsonb),public.leave_reconcile_request_v1(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.leave_context_v1(),public.leave_admin_setup_v1(text,int,int),public.leave_transaction_v1(uuid,text,jsonb),public.leave_reconcile_request_v1(uuid,boolean) TO authenticated;
COMMIT;
