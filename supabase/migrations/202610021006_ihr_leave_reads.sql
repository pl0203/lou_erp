-- Unpublished minimized read candidate. No real staff, settings or access grants.
-- Counts depend on the Task7/8 canonical predicate composed into unpublished 1005.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
CREATE FUNCTION private.ihr_leave_calendar_can_read(p_actor uuid,p_employee uuid,p_audience text,p_at timestamptz DEFAULT statement_timestamp()) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.users u WHERE u.id=p_actor AND u.is_active)
 AND EXISTS(SELECT 1 FROM public.ihr_leave_members m JOIN public.users u ON u.id=m.user_id AND u.is_active
  WHERE m.user_id=p_employee AND m.active AND m.member_kind IN('employee','manager'))
 AND CASE p_audience
  WHEN 'own' THEN p_actor=p_employee
  WHEN 'assigned_team' THEN private.ihr_leave_is_approver(p_actor,p_employee,p_at)
  WHEN 'granted' THEN private.ihr_leave_has_grant(p_actor,'calendar',p_employee,p_at)
  ELSE false END;
$$;
-- An approver's default month is derived from the exact authorized audience, never a personal entitlement.
CREATE FUNCTION private.ihr_leave_calendar_default_range(p_actor uuid,p_audience text,p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE zone_count bigint;zone_name text;complete boolean;starts date;ends date;
BEGIN
 SELECT count(DISTINCT zone),min(zone),bool_and(zone IS NOT NULL) INTO zone_count,zone_name,complete FROM (
  SELECT private.ihr_leave_calendar_timezone(m.active_calendar_id) zone FROM public.ihr_leave_members m
  WHERE private.ihr_leave_calendar_can_read(p_actor,m.user_id,p_audience,p_at)
 ) authorized;
 IF complete IS NULL THEN RETURN jsonb_build_object('state','unavailable','range',NULL);END IF;
 IF complete IS DISTINCT FROM true THEN RETURN jsonb_build_object('state','timezone_unconfirmed','range',NULL);END IF;
 IF zone_count<>1 THEN RETURN jsonb_build_object('state','timezone_mixed','range',NULL);END IF;
 starts:=date_trunc('month',p_at AT TIME ZONE zone_name)::date;
 ends:=(starts+interval '1 month'-interval '1 day')::date;
 RETURN jsonb_build_object('state','ready','range',jsonb_build_object('from',to_char(starts,'YYYY-MM-DD'),'to',to_char(ends,'YYYY-MM-DD')));
END;
$$;
CREATE FUNCTION public.leave_reads_context_v1(p_audience text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();authorized_at timestamptz:=statement_timestamp();audiences jsonb:='[]';audience text;selected_audience text;defaults jsonb;
BEGIN
 IF p_audience IS NOT NULL AND p_audience NOT IN('own','assigned_team','granted') THEN
  RAISE EXCEPTION 'Invalid calendar audience' USING ERRCODE='22023';END IF;
 FOREACH audience IN ARRAY ARRAY['own','assigned_team','granted'] LOOP
  IF EXISTS(SELECT 1 FROM public.ihr_leave_members m
   WHERE private.ihr_leave_calendar_can_read(actor,m.user_id,audience,authorized_at)) THEN
   audiences:=audiences||jsonb_build_array(audience);
  END IF;
 END LOOP;
 selected_audience:=coalesce(p_audience,audiences->>0);
 defaults:=private.ihr_leave_calendar_default_range(actor,selected_audience,authorized_at);
 RETURN jsonb_build_object('scopeVersion',private.ihr_leave_scope_version(actor),'calendarAudiences',audiences,
  'defaultRange',defaults->'range','defaultRangeState',defaults->>'state');
END;
$$;
CREATE FUNCTION public.leave_calendar_v1(p_from date,p_to date,p_audience text DEFAULT 'own') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();authorized_at timestamptz:=statement_timestamp();rows jsonb;authorized_employees uuid[];
BEGIN
 IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to)
  OR p_from>p_to OR p_to-p_from>92 OR p_audience IS NULL OR p_audience NOT IN('own','assigned_team','granted') THEN
  RAISE EXCEPTION 'Invalid calendar range or audience' USING ERRCODE='22023';
 END IF;
 -- Audience authorization precedes row lookup, so guessed ranges cannot distinguish access.
 SELECT pg_catalog.array_agg(m.user_id) INTO authorized_employees
 FROM public.ihr_leave_members m
 WHERE private.ihr_leave_calendar_can_read(actor,m.user_id,p_audience,authorized_at);
 IF authorized_employees IS NULL THEN
  RAISE EXCEPTION 'Calendar access denied' USING ERRCODE='42501';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'employeeId',r.employee_id,'employeeName',u.full_name,'date',to_char(d.day,'YYYY-MM-DD'),
  'approvedMinutes',d.charged_minutes,'availabilityLabel',
  CASE WHEN d.charged_minutes=d.scheduled_minutes THEN 'full_scheduled_absence' ELSE 'partial_absence' END)
  ORDER BY d.day,u.full_name,r.employee_id),'[]'::jsonb) INTO rows
 FROM public.ihr_leave_requests r JOIN public.ihr_leave_request_days d ON d.request_id=r.id
 JOIN public.users u ON u.id=r.employee_id
 WHERE r.status IN('approved','cancellation_pending') AND d.charged_minutes>0 AND d.day BETWEEN p_from AND p_to
  AND r.employee_id=ANY(authorized_employees);
 RETURN rows;
END;
$$;
CREATE FUNCTION public.leave_approval_counts_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();authorized_at timestamptz:=statement_timestamp();pending_leave bigint;pending_cancellation bigint;
BEGIN
 SELECT count(*) FILTER (WHERE r.status='submitted'),count(*) FILTER (WHERE r.status='cancellation_pending')
 INTO pending_leave,pending_cancellation FROM public.ihr_leave_requests r
 WHERE private.ihr_leave_is_assigned_request(actor,r.id,authorized_at);
 RETURN jsonb_build_object('pendingLeave',pending_leave,'pendingCancellation',pending_cancellation);
END;
$$;
REVOKE ALL ON FUNCTION private.ihr_leave_calendar_default_range(uuid,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.ihr_leave_calendar_can_read(uuid,uuid,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.leave_reads_context_v1(text),public.leave_calendar_v1(date,date,text),public.leave_approval_counts_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.leave_reads_context_v1(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_calendar_v1(date,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_approval_counts_v1() TO authenticated;
COMMIT;
