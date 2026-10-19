-- UNPUBLISHED SOURCE PROPOSAL. Do not apply to a hosted database without separate review/approval.
-- Additive read APIs only: no employee changes, reporting bindings, approvals, grants to data tables,
-- leave decisions, calendars, balances or request snapshots. Convert with Supabase CLI when approved.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

-- A team transfer is an authority change, including when no leave record changes.
CREATE OR REPLACE TRIGGER ihr_leave_user_active_scope AFTER UPDATE OF is_active, role, manager_id ON public.users
FOR EACH STATEMENT EXECUTE FUNCTION private.ihr_leave_bump_scope();
CREATE TRIGGER ihr_leave_user_roster_scope AFTER INSERT OR DELETE ON public.users
FOR EACH STATEMENT EXECUTE FUNCTION private.ihr_leave_bump_scope();

CREATE FUNCTION private.ihr_leave_weekly_roster(p_actor uuid,p_audience text,p_at timestamptz)
RETURNS TABLE(employee_id uuid,employee_name text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT employee.id,employee.full_name
 FROM public.users actor CROSS JOIN public.users employee
 WHERE actor.id=p_actor AND actor.is_active AND employee.is_active
 AND CASE p_audience
  WHEN 'own' THEN private.ihr_leave_calendar_can_read(actor.id,employee.id,'own',p_at)
  WHEN 'director_all' THEN EXISTS(SELECT 1 FROM public.ihr_leave_members m WHERE m.user_id=actor.id AND m.active AND m.member_kind='director')
  WHEN 'sales_all' THEN actor.role='sales_head' AND employee.role IN('sales_person','sales_manager','sales_head')
  WHEN 'sales_team' THEN
   (actor.role='sales_manager' AND (employee.id=actor.id OR employee.role='sales_head'
     OR (employee.manager_id=actor.id AND employee.role IN('sales_person','sales_manager','sales_head'))))
   OR (actor.role='sales_person' AND (employee.id=actor.id OR (employee.role='sales_person'
     AND actor.manager_id IS NOT NULL AND employee.manager_id=actor.manager_id
     AND EXISTS(SELECT 1 FROM public.users manager WHERE manager.id=actor.manager_id AND manager.is_active))))
  -- Approved role-defined calendar team. This does NOT assert/configure Director reporting or approval.
  WHEN 'admin_team' THEN actor.role IN('po_admin','co_admin') AND employee.role IN('po_admin','co_admin')
  WHEN 'assigned_team' THEN private.ihr_leave_is_approver(actor.id,employee.id,p_at)
  WHEN 'granted' THEN private.ihr_leave_calendar_can_read(actor.id,employee.id,'granted',p_at)
  ELSE false END;
$$;

CREATE FUNCTION public.leave_team_calendar_context_v1(p_audience text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();at_time timestamptz:=statement_timestamp();
 audiences jsonb:='[]';audience text;selected text;zone_count bigint;zone_name text;complete boolean;
 default_date text;date_state text:='unavailable';
BEGIN
 IF p_audience IS NOT NULL AND p_audience NOT IN('director_all','sales_all','sales_team','admin_team','own','assigned_team','granted') THEN
  RAISE EXCEPTION 'Invalid calendar audience' USING ERRCODE='22023'; END IF;
 FOREACH audience IN ARRAY ARRAY['director_all','sales_all','sales_team','admin_team','own','assigned_team','granted'] LOOP
  IF EXISTS(SELECT 1 FROM private.ihr_leave_weekly_roster(actor,audience,at_time)) THEN audiences:=audiences||jsonb_build_array(audience); END IF;
 END LOOP;
 selected:=coalesce(p_audience,audiences->>0);
 IF p_audience IS NOT NULL AND NOT audiences ? p_audience THEN RAISE EXCEPTION 'Calendar access denied' USING ERRCODE='42501'; END IF;
 SELECT count(DISTINCT zone),min(zone),bool_and(zone IS NOT NULL) INTO zone_count,zone_name,complete
 FROM (SELECT CASE WHEN m.active AND m.member_kind IN('employee','manager') THEN private.ihr_leave_calendar_timezone(m.active_calendar_id) END zone
  FROM private.ihr_leave_weekly_roster(actor,selected,at_time) roster
  LEFT JOIN public.ihr_leave_members m ON m.user_id=roster.employee_id) zones;
 IF complete IS NOT NULL THEN
  IF zone_count=0 THEN date_state:='timezone_unconfirmed';
  ELSIF zone_count<>1 THEN date_state:='timezone_mixed';
  ELSE default_date:=to_char(at_time AT TIME ZONE zone_name,'YYYY-MM-DD');date_state:='ready'; END IF;
 END IF;
 -- Unknown rows remain visible and unconfigured; they never supply an invented timezone.
 RETURN jsonb_build_object('scopeVersion',private.ihr_leave_scope_version(actor),'calendarAudiences',audiences,'defaultDate',default_date,'defaultDateState',date_state);
END;
$$;

CREATE FUNCTION public.leave_team_calendar_v1(p_period_start date,p_view text,p_audience text,p_page integer DEFAULT 1,p_page_size integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();at_time timestamptz:=statement_timestamp();is_director boolean;
 result_rows jsonb;row_total bigint;period_end date;
BEGIN
 IF p_period_start IS NULL OR NOT isfinite(p_period_start) OR extract(year FROM p_period_start) NOT BETWEEN 1 AND 9998
  OR p_view IS NULL OR p_view NOT IN('week','month')
  OR (p_view='week' AND extract(isodow FROM p_period_start)<>1)
  OR (p_view='month' AND extract(day FROM p_period_start)<>1) OR p_page IS NULL OR p_page<1 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100
  OR p_audience IS NULL OR p_audience NOT IN('director_all','sales_all','sales_team','admin_team','own','assigned_team','granted') THEN
  RAISE EXCEPTION 'Invalid team calendar input' USING ERRCODE='22023'; END IF;
 period_end:=CASE p_view WHEN 'week' THEN p_period_start+6 ELSE (p_period_start+interval '1 month'-interval '1 day')::date END;
 SELECT EXISTS(SELECT 1 FROM public.ihr_leave_members m WHERE m.user_id=actor AND m.active AND m.member_kind='director') INTO is_director;
 IF NOT EXISTS(SELECT 1 FROM private.ihr_leave_weekly_roster(actor,p_audience,at_time)) THEN
  RAISE EXCEPTION 'Calendar access denied' USING ERRCODE='42501'; END IF;
 WITH roster AS MATERIALIZED (
  SELECT * FROM private.ihr_leave_weekly_roster(actor,p_audience,at_time)
 ), eligible AS MATERIALIZED (
  SELECT roster.* FROM roster JOIN public.ihr_leave_members m ON m.user_id=roster.employee_id AND m.active AND m.member_kind IN('employee','manager')
 ), visible_absences AS MATERIALIZED (
  SELECT r.employee_id,d.day,d.charged_minutes,d.scheduled_minutes,
   CASE WHEN r.status='cancellation_pending' AND NOT permission.pending THEN 'approved' ELSE r.status END status
  FROM eligible JOIN public.ihr_leave_requests r ON r.employee_id=eligible.employee_id
  JOIN public.ihr_leave_request_days d ON d.request_id=r.id AND d.day BETWEEN p_period_start AND period_end AND d.charged_minutes>0
  CROSS JOIN LATERAL (SELECT (r.employee_id=actor OR is_director OR private.ihr_leave_is_assigned_request(actor,r.id,at_time)) pending) permission
  WHERE r.status IN('approved','cancellation_pending') OR (r.status='submitted' AND permission.pending)
 ), ranked AS MATERIALIZED (
  SELECT roster.*,EXISTS(SELECT 1 FROM visible_absences a WHERE a.employee_id=roster.employee_id AND a.status IN('submitted','cancellation_pending')) pending
  FROM roster
 ), page_rows AS MATERIALIZED (
  SELECT * FROM ranked ORDER BY pending DESC,employee_name COLLATE "C",employee_id
  LIMIT p_page_size OFFSET ((p_page::bigint-1)*p_page_size)
 ), rendered AS (
  SELECT page_rows.*, (SELECT jsonb_agg(jsonb_build_object('date',to_char(p_period_start+day_offset,'YYYY-MM-DD'),
   'schedule',CASE WHEN working.value ? 'error' THEN 'unconfigured'
    WHEN working.value->>'exclusion'='holiday' THEN 'holiday'
    WHEN working.value->>'exclusion'='off_duty' THEN 'off_duty' ELSE 'working' END,
   'scheduledMinutes',CASE WHEN working.value ? 'error' THEN NULL ELSE (working.value->>'capacity_minutes')::integer END,
   'absence',(SELECT jsonb_build_object('status',a.status,'minutes',a.charged_minutes,
    'availabilityLabel',CASE WHEN a.charged_minutes=a.scheduled_minutes THEN 'full_scheduled_absence' ELSE 'partial_absence' END)
    FROM visible_absences a WHERE a.employee_id=page_rows.employee_id AND a.day=p_period_start+day_offset)) ORDER BY day_offset)
   FROM generate_series(0,period_end-p_period_start) day_offset
   CROSS JOIN LATERAL(SELECT private.ihr_working_day_v1(page_rows.employee_id,p_period_start+day_offset) value) working) days
  FROM page_rows
 )
 SELECT (SELECT count(*) FROM roster),coalesce(jsonb_agg(jsonb_build_object('employeeId',employee_id,'employeeName',employee_name,'days',days)
  ORDER BY pending DESC,employee_name COLLATE "C",employee_id),'[]'::jsonb) INTO row_total,result_rows FROM rendered;
 RETURN jsonb_build_object('scopeVersion',private.ihr_leave_scope_version(actor),'view',p_view,'periodStart',to_char(p_period_start,'YYYY-MM-DD'),
  'periodEnd',to_char(period_end,'YYYY-MM-DD'),'rows',result_rows,'total',row_total,'page',p_page,'pageSize',p_page_size);
END;
$$;

REVOKE ALL ON FUNCTION private.ihr_leave_weekly_roster(uuid,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.leave_team_calendar_context_v1(text),public.leave_team_calendar_v1(date,text,text,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.leave_team_calendar_context_v1(text),public.leave_team_calendar_v1(date,text,text,integer,integer) TO authenticated;
COMMIT;
