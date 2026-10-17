-- INACTIVE REVIEW CANDIDATE. No hosted installation performed.
-- New read-only endpoints; existing grants, table policies and decisions are unchanged.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
CREATE FUNCTION private.ihr_leave_require_director() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ihr_leave_members m WHERE m.user_id=actor AND m.active AND m.member_kind='director') THEN
  RAISE EXCEPTION 'Director oversight denied' USING ERRCODE='42501';
 END IF;
 RETURN actor;
END;
$$;
CREATE FUNCTION private.ihr_leave_director_target(p_employee uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.ihr_leave_members m JOIN public.users u ON u.id=m.user_id
 WHERE m.user_id=p_employee AND m.active AND u.is_active AND m.member_kind IN('employee','manager'));
$$;
CREATE FUNCTION public.leave_director_calendar_context_v1(p_audience text DEFAULT 'director_all') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid:=private.ihr_leave_require_director(); zone_count bigint;zone_name text;complete boolean;starts date;ends date;range_value jsonb:=NULL;range_state text;
BEGIN
 IF p_audience IS NULL OR p_audience NOT IN('director_all','assigned_team') THEN RAISE EXCEPTION 'Invalid director calendar audience' USING ERRCODE='22023';END IF;
 IF p_audience='assigned_team' THEN
  RETURN jsonb_set(public.leave_reads_context_v1('assigned_team'),'{calendarAudiences}',CASE WHEN private.ihr_leave_is_approver(actor) THEN jsonb_build_array('director_all','assigned_team') ELSE jsonb_build_array('director_all') END);
 END IF;
 SELECT count(DISTINCT zone),min(zone),bool_and(zone IS NOT NULL) INTO zone_count,zone_name,complete FROM (
  SELECT private.ihr_leave_calendar_timezone(m.active_calendar_id) zone FROM public.ihr_leave_members m
  WHERE private.ihr_leave_director_target(m.user_id)
 ) authorized;
 IF complete IS NULL THEN range_state:='unavailable';
 ELSIF NOT complete THEN range_state:='timezone_unconfirmed';
 ELSIF zone_count<>1 THEN range_state:='timezone_mixed';
 ELSE
  range_state:='ready';starts:=date_trunc('month',statement_timestamp() AT TIME ZONE zone_name)::date;
  ends:=(starts+interval '1 month'-interval '1 day')::date;
  range_value:=jsonb_build_object('from',to_char(starts,'YYYY-MM-DD'),'to',to_char(ends,'YYYY-MM-DD'));
 END IF;
 RETURN jsonb_build_object('scopeVersion',private.ihr_leave_scope_version(actor),'calendarAudiences',CASE WHEN private.ihr_leave_is_approver(actor) THEN jsonb_build_array('director_all','assigned_team') ELSE jsonb_build_array('director_all') END,'defaultRange',range_value,'defaultRangeState',range_state);
END;
$$;
CREATE FUNCTION public.leave_director_calendar_v1(p_from date,p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid:=private.ihr_leave_require_director();rows jsonb;
BEGIN
 IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from>p_to OR p_to-p_from>92 THEN
  RAISE EXCEPTION 'Invalid calendar range' USING ERRCODE='22023';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('employeeId',r.employee_id,'employeeName',u.full_name,'date',to_char(d.day,'YYYY-MM-DD'),
  'approvedMinutes',d.charged_minutes,'availabilityLabel',CASE WHEN d.charged_minutes=d.scheduled_minutes THEN 'full_scheduled_absence' ELSE 'partial_absence' END)
  ORDER BY d.day,u.full_name,r.employee_id),'[]'::jsonb) INTO rows
 FROM public.ihr_leave_requests r JOIN public.ihr_leave_request_days d ON d.request_id=r.id JOIN public.users u ON u.id=r.employee_id
 WHERE private.ihr_leave_director_target(r.employee_id) AND r.status IN('approved','cancellation_pending') AND d.charged_minutes>0 AND d.day BETWEEN p_from AND p_to;
 RETURN rows;
END;
$$;
CREATE FUNCTION public.leave_director_requests_v1(p_before bigint DEFAULT NULL,p_limit integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid:=private.ihr_leave_require_director();rows jsonb;cursor bigint;has_more boolean;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR (p_before IS NOT NULL AND p_before<1) THEN RAISE EXCEPTION 'Invalid overview page' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'sequence',r.sequence,'employeeId',r.employee_id,'employeeName',u.full_name,
  'startDate',r.start_date,'endDate',r.end_date,'totalMinutes',r.total_minutes,'status',r.status,'submittedAt',r.submitted_at,
  'approverName',private.ihr_leave_request_assignment(r)->>'approverName') ORDER BY r.sequence DESC),'[]'::jsonb),min(r.sequence) INTO rows,cursor
 FROM (SELECT req.* FROM public.ihr_leave_requests req WHERE private.ihr_leave_director_target(req.employee_id)
  AND (p_before IS NULL OR req.sequence<p_before) ORDER BY req.sequence DESC LIMIT p_limit) r JOIN public.users u ON u.id=r.employee_id;
 SELECT EXISTS(SELECT 1 FROM public.ihr_leave_requests r WHERE r.sequence<cursor AND private.ihr_leave_director_target(r.employee_id)) INTO has_more;
 RETURN jsonb_build_object('rows',rows,'nextBefore',CASE WHEN has_more THEN cursor END);
END;
$$;
REVOKE ALL ON FUNCTION private.ihr_leave_require_director(),private.ihr_leave_director_target(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.leave_director_calendar_context_v1(text),public.leave_director_calendar_v1(date,date),public.leave_director_requests_v1(bigint,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.leave_director_calendar_context_v1(text),public.leave_director_calendar_v1(date,date),public.leave_director_requests_v1(bigint,integer) TO authenticated;
COMMIT;
