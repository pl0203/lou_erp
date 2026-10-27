-- PREPARED LOCAL CANDIDATE ONLY. No staging execution/deployment authorization.
-- Apply inside reviewed atomic transaction after 01/02, together with 04.
-- Current captured source, NOT an assumption of historical/live equivalence.
-- Exact source + security/configuration/ACL preimages fail closed; no grants added.
SET LOCAL search_path=pg_catalog,pg_temp;
DO $preimages$ DECLARE entry record; BEGIN
 IF to_regprocedure('private.employee_account_allowed(uuid)') IS NULL THEN RAISE EXCEPTION 'EMPLOYEE_ACCESS_GATE_REQUIRED'; END IF;
 FOR entry IN SELECT * FROM (VALUES
('private.co_read_actor_v1()','88f1490763ec558a8e12863530fe6ceb10a200b814a52367d5cc6ece9d6542c7','a14817d1d3fe9d307bac233f17f02977b135fdac5d5e3eb1d5a62e30155d1686',false,ARRAY['search_path=""']::text[],'{postgres=X/postgres}'),
('private.co_sales_scope_v2()','b4e299697c04ea1ef4fa4ce3c7bd849a87ea9733a41acb10405d3e597b34cb88','2a909fbcef95e48dca2de27f31072a5f826cddb6500e899c34f592e2f2e915f5',false,ARRAY['search_path=""']::text[],'{postgres=X/postgres}'),
('private.demo_order_actor()','be49a56547f0c101fa0b6183aa7867d23ad1d063dc6b16368691d8512df85cba','89dadac6f035492d622b760910bd34e0db387117414d0cdd0e0dfb21c7c6f90e',true,ARRAY['search_path=""']::text[],'{postgres=X/postgres}'),
('private.ihr_leave_assignment_active(uuid,uuid,uuid,timestamp with time zone)','84d1683e9cc210b88eb62a85958ed917b9946788bcd8ab3741b2f81e86d5fc92','78c58e19d708bb21e4d10c733c7b3ea584b0d3d9d2c71975b105c72a0b0b3af5',false,ARRAY['search_path=pg_catalog, pg_temp']::text[],'{postgres=X/postgres}'),
('private.ihr_leave_calendar_can_read(uuid,uuid,text,timestamp with time zone)','d223aa0bdec4c5b14b479c2d03281a7d69e837f6f1402c37bbe891a164c265cd','4f4b41dee352fbb9a2fdafcd5c19212e91133ee02b165e85e293fa453e55e3ca',true,ARRAY['search_path=pg_catalog, pg_temp']::text[],'{postgres=X/postgres}'),
('private.ihr_leave_can_read_employee(uuid,uuid,timestamp with time zone)','b293a84f211c3a60427813d74ba6198732b383c8b26aa65d58e4cb19c40e79fc','d998a7cf5239004d4b60faacbaa008bfa88368403545e8d34a732af681787777',true,ARRAY['search_path=pg_catalog, pg_temp']::text[],'{postgres=X/postgres}'),
('private.ihr_leave_evidenced_access(uuid,uuid,timestamp with time zone)','47f94f03b3ff36c769599784dcd30ba72ed0d51d36fe15ccb364dfec0a18d24a','3d95a4b725a715c854d824b469cb004983fa503b8828e64503a45cf76f790327',true,ARRAY['search_path=pg_catalog, pg_temp']::text[],'{postgres=X/postgres}'),
('private.ihr_leave_has_grant(uuid,text,uuid,timestamp with time zone)','10bf42c7cf4bb76bf76be83e0e3a7954fa3e15161338dc9536eef53c5b7349a6','3f66c06f44d9c08a37a167dd54e6deacb53d9af5b99cc0e467bca80f741c09b1',true,ARRAY['search_path=pg_catalog, pg_temp']::text[],'{postgres=X/postgres}'),
('private.ihr_leave_is_approver(uuid,uuid,timestamp with time zone)','bc1f095282a6199fbd9ee5a4850c277e25eba562b44a3aa5112da57e2c85ef5f','43524b7cee6a9bb9546ee6daf9c751dc723ef09ffea1ef05c539c561ee3eae41',true,ARRAY['search_path=pg_catalog, pg_temp']::text[],'{postgres=X/postgres}'),
('private.ihr_leave_require_actor()','921aec820a63874f53de61149eb667089bf93103fd1c1efdfd6fe2cc2f45460b','71f1f50ebc756b64176f0a2738ae7d5673deba102c6d3086789c082e667a91b2',true,ARRAY['search_path=pg_catalog, pg_temp']::text[],'{postgres=X/postgres}')
 ) x(signature,before_sha256,after_sha256,security_definer,configuration,privileges) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure(entry.signature)
   AND p.proowner='postgres'::regrole AND p.prosecdef=entry.security_definer
   AND p.proconfig=entry.configuration AND p.proacl::text=entry.privileges
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IN(entry.before_sha256,entry.after_sha256)) THEN
   RAISE EXCEPTION 'EMPLOYEE_PROTECTED_GATE_PREIMAGE_MISMATCH: %',entry.signature;
  END IF;
 END LOOP;
END $preimages$;

-- Captured staging source 2026-10-24; identity/ACL retained.
CREATE OR REPLACE FUNCTION private.co_read_actor_v1()
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
BEGIN IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND is_active AND private.employee_account_allowed(id) AND role IN('co_admin','executive')) THEN RAISE EXCEPTION 'CO authority required' USING ERRCODE='42501'; END IF; END $function$;

-- Captured staging source 2026-10-24; identity/ACL retained.
CREATE OR REPLACE FUNCTION private.co_sales_scope_v2()
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE caller_role public.user_role;
BEGIN
 SELECT u.role INTO caller_role FROM public.users u WHERE u.id=auth.uid() AND u.is_active AND private.employee_account_allowed(u.id);
 IF caller_role IS NULL OR caller_role NOT IN('sales_person','sales_manager','sales_head','executive') THEN
  RAISE EXCEPTION 'Active Sales metrics audience required' USING ERRCODE='42501';
 END IF;
 RETURN CASE caller_role WHEN 'sales_person' THEN 'own' WHEN 'sales_manager' THEN 'team' ELSE 'leadership' END;
END $function$;

-- Captured staging source 2026-10-24; identity/ACL retained.
CREATE OR REPLACE FUNCTION private.demo_order_actor()
 RETURNS public.user_role
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_role public.user_role;
BEGIN
 -- Acquire before the row lock: profile UPDATE takes ROW EXCLUSIVE before locking its row.
 LOCK TABLE public.users IN SHARE MODE;
 SELECT u.role INTO v_role FROM public.users u WHERE u.id=auth.uid() AND u.is_active AND private.employee_account_allowed(u.id) FOR SHARE;
 IF v_role IS NULL THEN RAISE EXCEPTION 'Active authenticated profile required' USING ERRCODE='42501'; END IF;
 RETURN v_role;
END $function$;

-- Captured staging source 2026-10-24; identity/ACL retained.
CREATE OR REPLACE FUNCTION private.ihr_leave_assignment_active(p_actor uuid, p_employee uuid, p_assignment uuid, p_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.ihr_leave_approvers a
  JOIN public.users au ON au.id=a.approver_id AND au.is_active AND private.employee_account_allowed(au.id) JOIN public.users eu ON eu.id=a.employee_id AND eu.is_active AND private.employee_account_allowed(eu.id)
  JOIN public.ihr_leave_members am ON am.user_id=au.id AND am.active JOIN public.ihr_leave_members em ON em.user_id=eu.id AND em.active
  WHERE a.id=p_assignment AND a.approver_id=p_actor AND a.employee_id=p_employee AND p_actor<>p_employee
   AND a.revoked_at IS NULL AND a.effective_from<=p_at AND (a.effective_until IS NULL OR a.effective_until>p_at)
   AND ((em.member_kind='employee' AND am.member_kind='manager') OR (em.member_kind='manager' AND am.member_kind='director') OR (em.member_kind='employee' AND am.member_kind='director' AND eu.role='po_admin')));
$function$;

-- Captured staging source 2026-10-24; identity/ACL retained.
CREATE OR REPLACE FUNCTION private.ihr_leave_calendar_can_read(p_actor uuid, p_employee uuid, p_audience text, p_at timestamp with time zone DEFAULT statement_timestamp())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.users u WHERE u.id=p_actor AND u.is_active AND private.employee_account_allowed(u.id))
 AND EXISTS(SELECT 1 FROM public.ihr_leave_members m JOIN public.users u ON u.id=m.user_id AND u.is_active AND private.employee_account_allowed(u.id)
  WHERE m.user_id=p_employee AND m.active AND m.member_kind IN('employee','manager'))
 AND CASE p_audience
  WHEN 'own' THEN p_actor=p_employee
  WHEN 'assigned_team' THEN private.ihr_leave_is_approver(p_actor,p_employee,p_at)
  WHEN 'granted' THEN private.ihr_leave_has_grant(p_actor,'calendar',p_employee,p_at)
  ELSE false END;
$function$;

-- Captured staging source 2026-10-24; identity/ACL retained.
CREATE OR REPLACE FUNCTION private.ihr_leave_can_read_employee(p_actor uuid, p_employee uuid, p_authorized_at timestamp with time zone DEFAULT statement_timestamp())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
 SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id=p_actor AND u.is_active AND private.employee_account_allowed(u.id))
  AND EXISTS (SELECT 1 FROM public.ihr_leave_members m WHERE m.user_id=p_employee AND m.member_kind IN ('employee','manager'))
  AND (p_actor=p_employee OR private.ihr_leave_is_approver(p_actor,p_employee,p_authorized_at)
   OR private.ihr_leave_has_grant(p_actor,'read_private',p_employee,p_authorized_at));
$function$;

-- Captured staging source 2026-10-24; identity/ACL retained.
CREATE OR REPLACE FUNCTION private.ihr_leave_evidenced_access(p_actor uuid, p_employee uuid, p_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
 SELECT EXISTS(
 SELECT 1 FROM public.ihr_leave_access_grants g JOIN private.ihr_leave_access_manifests m ON m.grant_id=g.id
 JOIN public.users u ON u.id=g.actor_id AND u.is_active AND private.employee_account_allowed(u.id)
 WHERE g.actor_id=p_actor AND g.capability='manage_access' AND g.revoked_at IS NULL AND g.effective_from<=p_at AND (g.effective_until IS NULL OR g.effective_until>p_at)
 AND NOT EXISTS(SELECT 1 FROM public.ihr_leave_members am WHERE am.user_id=p_actor AND am.member_kind='director')
 AND ((g.scope_kind='employee' AND g.employee_id=p_employee) OR (g.scope_kind='all_policy_members' AND EXISTS(SELECT 1 FROM public.ihr_leave_members em WHERE em.user_id=p_employee AND em.member_kind IN('employee','manager'))))
 AND ROW(g.actor_id,g.granted_by,g.capability,g.scope_kind,g.employee_id,g.effective_from,g.effective_until)
 IS NOT DISTINCT FROM ROW(m.actor_id,m.grantor_id,m.capability,m.scope_kind,m.employee_id,m.effective_from,m.effective_until)
 AND m.confirmed AND m.approved_by IS NOT NULL AND m.approved_at<=p_at AND length(btrim(m.approval_reference))>0);
$function$;

-- Captured staging source 2026-10-24; identity/ACL retained.
CREATE OR REPLACE FUNCTION private.ihr_leave_has_grant(p_actor uuid, p_capability text, p_employee uuid DEFAULT NULL::uuid, p_authorized_at timestamp with time zone DEFAULT statement_timestamp())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
 SELECT EXISTS (
  SELECT 1 FROM public.ihr_leave_access_grants g JOIN public.users u ON u.id=g.actor_id AND u.is_active AND private.employee_account_allowed(u.id)
  WHERE g.actor_id=p_actor AND g.capability=p_capability AND g.revoked_at IS NULL
   AND g.effective_from <= p_authorized_at AND (g.effective_until IS NULL OR g.effective_until > p_authorized_at)
   AND NOT EXISTS (SELECT 1 FROM public.ihr_leave_members am WHERE am.user_id=p_actor AND am.member_kind='director')
   AND (p_employee IS NULL OR (g.scope_kind='employee' AND g.employee_id=p_employee)
    OR (g.scope_kind='all_policy_members' AND EXISTS (SELECT 1 FROM public.ihr_leave_members m WHERE m.user_id=p_employee AND m.member_kind IN ('employee','manager'))))
 );
$function$;

-- Captured staging source 2026-10-24; identity/ACL retained.
CREATE OR REPLACE FUNCTION private.ihr_leave_is_approver(p_actor uuid, p_employee uuid DEFAULT NULL::uuid, p_authorized_at timestamp with time zone DEFAULT statement_timestamp())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
 SELECT EXISTS (
  SELECT 1 FROM public.ihr_leave_approvers a
  JOIN public.users actor ON actor.id=a.approver_id AND actor.is_active AND private.employee_account_allowed(actor.id)
  JOIN public.users employee ON employee.id=a.employee_id AND employee.is_active AND private.employee_account_allowed(employee.id)
  JOIN public.ihr_leave_members am ON am.user_id=a.approver_id AND am.active
  JOIN public.ihr_leave_members em ON em.user_id=a.employee_id AND em.active
  WHERE a.approver_id=p_actor AND a.employee_id<>p_actor AND (p_employee IS NULL OR a.employee_id=p_employee)
   AND a.revoked_at IS NULL AND a.effective_from <= p_authorized_at AND (a.effective_until IS NULL OR a.effective_until > p_authorized_at)
   AND ((am.member_kind='manager' AND em.member_kind='employee') OR (am.member_kind='director' AND em.member_kind='manager') OR (am.member_kind='director' AND em.member_kind='employee' AND employee.role='po_admin'))
 );
$function$;

-- Captured staging source 2026-10-24; identity/ACL retained.
CREATE OR REPLACE FUNCTION private.ihr_leave_require_actor()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id=actor AND u.is_active AND private.employee_account_allowed(u.id)) THEN
  RAISE EXCEPTION 'Leave access denied' USING ERRCODE='42501',DETAIL='{"code":"ACTIVE_ACTOR_REQUIRED"}';
 END IF;
 RETURN actor;
END;
$function$;

-- All authenticated raw-storage operations remain subject to existing narrower
-- policies; service evidence byte paths are separately gated by the original actor.
DROP POLICY IF EXISTS employee_active_account_v2 ON storage.objects;
CREATE POLICY employee_active_account_v2 ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
 USING (public.current_user_role() IS NOT NULL)
 WITH CHECK (public.current_user_role() IS NOT NULL);
