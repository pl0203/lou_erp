-- Explicitly assigned Directors may approve PO Admin employees without changing their membership kind.
-- Existing manager routes, actor/target activity, effective windows, ownership and private ACLs stay intact.
-- No members, assignments, balances or administrative grants are created by this migration.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

CREATE OR REPLACE FUNCTION private.ihr_leave_is_approver(p_actor uuid,p_employee uuid DEFAULT NULL,p_authorized_at timestamptz DEFAULT statement_timestamp()) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.ihr_leave_approvers a
  JOIN public.users actor ON actor.id=a.approver_id AND actor.is_active
  JOIN public.users employee ON employee.id=a.employee_id AND employee.is_active
  JOIN public.ihr_leave_members am ON am.user_id=a.approver_id AND am.active
  JOIN public.ihr_leave_members em ON em.user_id=a.employee_id AND em.active
  WHERE a.approver_id=p_actor AND a.employee_id<>p_actor AND (p_employee IS NULL OR a.employee_id=p_employee)
   AND a.revoked_at IS NULL AND a.effective_from <= p_authorized_at AND (a.effective_until IS NULL OR a.effective_until > p_authorized_at)
   AND ((am.member_kind='manager' AND em.member_kind='employee') OR (am.member_kind='director' AND em.member_kind='manager') OR (am.member_kind='director' AND em.member_kind='employee' AND employee.role='po_admin'))
 );
$$;

CREATE OR REPLACE FUNCTION private.ihr_leave_guard_approver() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
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
   AND ((em.member_kind='employee' AND am.member_kind='manager') OR (em.member_kind='manager' AND am.member_kind='director') OR (em.member_kind='employee' AND am.member_kind='director' AND eu.role='po_admin'))
 ) THEN RAISE EXCEPTION 'Invalid approval route' USING ERRCODE='22023',DETAIL='{"code":"INVALID_APPROVER_ROUTE"}'; END IF;
 IF NEW.revoked_at IS NULL AND EXISTS (SELECT 1 FROM public.ihr_leave_approvers a
  WHERE a.employee_id=NEW.employee_id AND a.id<>NEW.id AND a.revoked_at IS NULL
   AND tstzrange(a.effective_from,a.effective_until,'[)') && tstzrange(NEW.effective_from,NEW.effective_until,'[)')) THEN
  RAISE EXCEPTION 'Approver intervals overlap' USING ERRCODE='55000',DETAIL='{"code":"APPROVER_OVERLAP"}';
 END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.ihr_leave_set_approver(p_actor uuid,p jsonb,p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
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
   OR NOT ((v_member.member_kind='employee' AND v_approver.member_kind='manager') OR (v_member.member_kind='manager' AND v_approver.member_kind='director') OR (v_member.member_kind='employee' AND v_approver.member_kind='director' AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=v_member.user_id AND u.role='po_admin'))) THEN
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

CREATE OR REPLACE FUNCTION private.ihr_leave_assignment_active(p_actor uuid,p_employee uuid,p_assignment uuid,p_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.ihr_leave_approvers a
  JOIN public.users au ON au.id=a.approver_id AND au.is_active JOIN public.users eu ON eu.id=a.employee_id AND eu.is_active
  JOIN public.ihr_leave_members am ON am.user_id=au.id AND am.active JOIN public.ihr_leave_members em ON em.user_id=eu.id AND em.active
  WHERE a.id=p_assignment AND a.approver_id=p_actor AND a.employee_id=p_employee AND p_actor<>p_employee
   AND a.revoked_at IS NULL AND a.effective_from<=p_at AND (a.effective_until IS NULL OR a.effective_until>p_at)
   AND ((em.member_kind='employee' AND am.member_kind='manager') OR (em.member_kind='manager' AND am.member_kind='director') OR (em.member_kind='employee' AND am.member_kind='director' AND eu.role='po_admin')));
$$;

-- Scoped setup metadata exposes only route choices, with unchanged configuration authority.
CREATE OR REPLACE FUNCTION public.leave_admin_setup_v1(p_section text,p_page int,p_page_size int) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
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
  IF NOT private.ihr_leave_global_config(v_actor) THEN RAISE EXCEPTION 'Global configure required' USING ERRCODE='42501',DETAIL='{"code":"GLOBAL_CONFIG_REQUIRED"}'; END IF;
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

-- Role now participates in this narrow leave route, so readers must discard the old scope.
CREATE OR REPLACE TRIGGER ihr_leave_user_active_scope AFTER UPDATE OF is_active, role ON public.users
FOR EACH STATEMENT EXECUTE FUNCTION private.ihr_leave_bump_scope();
COMMIT;
