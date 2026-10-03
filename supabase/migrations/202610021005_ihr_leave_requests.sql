-- Unpublished annual requests candidate. No actual employees, policies, grants or openings.
BEGIN;
CREATE TABLE public.ihr_leave_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 employee_id uuid NOT NULL REFERENCES public.ihr_leave_members(user_id),
 status text NOT NULL CHECK(status IN('submitted','approved','rejected','withdrawn','cancellation_pending','cancelled')),
 start_date date NOT NULL,end_date date NOT NULL, duration jsonb NOT NULL, total_minutes integer NOT NULL CHECK(total_minutes>0),
 reason text NOT NULL CHECK(length(reason)<=1000),approver_id uuid NOT NULL REFERENCES public.ihr_leave_members(user_id),
 approver_name text NOT NULL,assignment_id uuid NOT NULL REFERENCES public.ihr_leave_approvers(id),assignment_version bigint NOT NULL,
 policy_id uuid NOT NULL REFERENCES public.ihr_leave_policies(id),policy_version bigint NOT NULL,
 member_version bigint NOT NULL,quote_fingerprint text,source_snapshot jsonb NOT NULL,
 source_kind text NOT NULL CHECK(source_kind IN('submission','opening')),source_id uuid NOT NULL,
 submitted_at timestamptz NOT NULL,created_by uuid NOT NULL REFERENCES public.users(id),version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(source_kind,source_id),CHECK(start_date<=end_date AND end_date-start_date<=365),CHECK(employee_id<>approver_id),
 CHECK(quote_fingerprint IS NULL OR quote_fingerprint ~ '^[0-9a-f]{64}$')
);
CREATE TABLE public.ihr_leave_request_days (
 request_id uuid NOT NULL REFERENCES public.ihr_leave_requests(id),day date NOT NULL,
 scheduled_minutes integer NOT NULL CHECK(scheduled_minutes IN(0,225,450)),charged_minutes integer NOT NULL CHECK(charged_minutes>=0 AND charged_minutes<=scheduled_minutes),
 exclusion text CHECK(exclusion IN('holiday','off_duty')),account_id uuid REFERENCES public.ihr_leave_accounts(id),
 source_snapshot jsonb NOT NULL,PRIMARY KEY(request_id,day),CHECK((charged_minutes>0)=(account_id IS NOT NULL))
);
CREATE TABLE public.ihr_leave_request_allocations (
 request_id uuid NOT NULL REFERENCES public.ihr_leave_requests(id),account_id uuid NOT NULL REFERENCES public.ihr_leave_accounts(id),
 year integer NOT NULL,period_start date NOT NULL,period_end date NOT NULL,timezone text NOT NULL,
 charged_minutes integer NOT NULL CHECK(charged_minutes>0),account_version bigint NOT NULL,
 PRIMARY KEY(request_id,account_id),CHECK(period_start=make_date(year,1,1) AND period_end=make_date(year+1,1,1))
);
CREATE TABLE public.ihr_leave_occupancy (
 employee_id uuid NOT NULL REFERENCES public.ihr_leave_members(user_id),day date NOT NULL,
 request_id uuid NOT NULL,PRIMARY KEY(employee_id,day),
 FOREIGN KEY(request_id,day) REFERENCES public.ihr_leave_request_days(request_id,day)
);
CREATE TABLE private.ihr_leave_request_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid NOT NULL REFERENCES public.ihr_leave_requests(id),
 actor_id uuid NOT NULL REFERENCES public.users(id),event text NOT NULL,at_time timestamptz NOT NULL,
 data jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX ihr_leave_own_request_page ON public.ihr_leave_requests(employee_id,sequence DESC);
CREATE INDEX ihr_leave_request_dates ON public.ihr_leave_request_days(day,request_id);
ALTER TABLE public.ihr_leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ihr_leave_request_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ihr_leave_request_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ihr_leave_occupancy ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.ihr_leave_request_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ihr_leave_requests FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.ihr_leave_request_days FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.ihr_leave_request_allocations FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.ihr_leave_occupancy FROM PUBLIC,anon,authenticated;
REVOKE ALL ON private.ihr_leave_request_events FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE public.ihr_leave_requests_sequence_seq FROM PUBLIC,anon,authenticated;
-- Task7/8 deliberately replace this fail-closed transition gate. Snapshots are never updated.
CREATE TRIGGER ihr_request_immutable BEFORE UPDATE OR DELETE ON public.ihr_leave_requests FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_immutable_audit();
CREATE TRIGGER ihr_request_no_truncate BEFORE TRUNCATE ON public.ihr_leave_requests FOR EACH STATEMENT EXECUTE FUNCTION private.ihr_leave_immutable_audit();
CREATE TRIGGER ihr_request_days_immutable BEFORE UPDATE OR DELETE ON public.ihr_leave_request_days FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_immutable_audit();
CREATE TRIGGER ihr_request_days_no_truncate BEFORE TRUNCATE ON public.ihr_leave_request_days FOR EACH STATEMENT EXECUTE FUNCTION private.ihr_leave_immutable_audit();
CREATE TRIGGER ihr_request_allocations_immutable BEFORE UPDATE OR DELETE ON public.ihr_leave_request_allocations FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_immutable_audit();
CREATE TRIGGER ihr_request_allocations_no_truncate BEFORE TRUNCATE ON public.ihr_leave_request_allocations FOR EACH STATEMENT EXECUTE FUNCTION private.ihr_leave_immutable_audit();
CREATE TRIGGER ihr_request_events_immutable BEFORE UPDATE OR DELETE ON private.ihr_leave_request_events FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_immutable_audit();
CREATE TRIGGER ihr_request_events_no_truncate BEFORE TRUNCATE ON private.ihr_leave_request_events FOR EACH STATEMENT EXECUTE FUNCTION private.ihr_leave_immutable_audit();

CREATE FUNCTION private.ihr_leave_require_personal_actor() RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ihr_leave_members m WHERE m.user_id=actor AND m.active AND m.member_kind IN('employee','manager')) THEN
  RAISE EXCEPTION 'Personal leave unavailable' USING ERRCODE='42501',DETAIL='{"code":"PERSONAL_LEAVE_DENIED"}'; END IF;
 RETURN actor;
END;
$$;
-- Replay must keep current active identity and personal capability but must NOT re-quote:
-- its own committed reservation changes account versions; booking cutoffs may also have passed.
ALTER FUNCTION private.ihr_leave_authorize_command(uuid,text,jsonb,timestamptz) RENAME TO ihr_leave_authorize_account_command;
CREATE FUNCTION private.ihr_leave_authorize_command(p_actor uuid,p_operation text,p_payload jsonb,p_authorized_at timestamptz) RETURNS void
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE input jsonb;starts date;ends date;
BEGIN
 IF p_operation<>'submit_request' THEN PERFORM private.ihr_leave_authorize_account_command(p_actor,p_operation,p_payload,p_authorized_at);RETURN; END IF;
 IF p_authorized_at IS NULL OR p_actor IS DISTINCT FROM private.ihr_leave_require_actor()
  OR NOT EXISTS(SELECT 1 FROM public.ihr_leave_members m WHERE m.user_id=p_actor AND m.active AND m.member_kind IN('employee','manager')) THEN
  RAISE EXCEPTION 'Personal leave unavailable' USING ERRCODE='42501',DETAIL='{"code":"PERSONAL_LEAVE_DENIED"}'; END IF;
 PERFORM private.ihr_leave_validate_payload(p_payload,ARRAY['input','quote_fingerprint'],ARRAY['input','quote_fingerprint']);
 input:=p_payload->'input';
 PERFORM private.ihr_leave_validate_payload(input,ARRAY['start_date','end_date','duration','reason'],ARRAY['start_date','end_date','duration','reason']);
 IF jsonb_typeof(p_payload->'quote_fingerprint') IS DISTINCT FROM 'string' OR p_payload->>'quote_fingerprint' !~ '^[0-9a-f]{64}$'
  OR jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' OR length(input->>'reason')>1000
  OR jsonb_typeof(input->'start_date') IS DISTINCT FROM 'string' OR input->>'start_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  OR jsonb_typeof(input->'end_date') IS DISTINCT FROM 'string' OR input->>'end_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
  RAISE EXCEPTION 'Invalid request payload' USING ERRCODE='22023',DETAIL='{"code":"INVALID_REQUEST_INPUT"}'; END IF;
 starts:=(input->>'start_date')::date;ends:=(input->>'end_date')::date;
 IF extract(year FROM starts) NOT BETWEEN 1 AND 9998 OR extract(year FROM ends) NOT BETWEEN 1 AND 9998 OR starts>ends OR ends-starts>365
  OR (input->'duration'=jsonb_build_object('mode','full_scheduled_day') OR
   (input->'duration'->>'mode'='fixed_minutes' AND input->'duration'->'minutes' IN('60'::jsonb,'120'::jsonb,'180'::jsonb,'225'::jsonb,'240'::jsonb,'300'::jsonb,'360'::jsonb)
    AND (SELECT count(*) FROM jsonb_object_keys(input->'duration'))=2)) IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Invalid request payload' USING ERRCODE='22023',DETAIL='{"code":"INVALID_REQUEST_INPUT"}'; END IF;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Invalid request payload' USING ERRCODE='22023',DETAIL='{"code":"INVALID_REQUEST_INPUT"}';
END;
$$;
-- Freeze the complete selected source records; the browser detail projection does not expose them.
CREATE FUNCTION private.ihr_leave_day_snapshot(p_employee uuid,p_day date) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('working',w.value,'calendar',to_jsonb(c),'exception',to_jsonb(e),'membership',to_jsonb(sm),'group',to_jsonb(sg),'roster',to_jsonb(r))
 FROM (SELECT private.ihr_working_day_v1(p_employee,p_day) value) w
 LEFT JOIN public.ihr_leave_calendars c ON c.id=(w.value->>'calendar_id')::uuid
 LEFT JOIN public.ihr_leave_calendar_exceptions e ON e.calendar_version_id=c.id AND e.day=p_day
 LEFT JOIN public.ihr_saturday_memberships sm ON sm.id=(w.value->>'membership_id')::uuid
 LEFT JOIN public.ihr_saturday_groups sg ON sg.id=sm.group_id
 LEFT JOIN public.ihr_saturday_roster r ON r.id=(w.value->>'roster_id')::uuid;
$$;
CREATE FUNCTION private.ihr_leave_submit_request(p_actor uuid,p_payload jsonb,p_authorized_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE actor uuid;at_time timestamptz;quote jsonb;d jsonb;allocation jsonb;yr integer;request_id uuid:=gen_random_uuid();a public.ihr_leave_accounts%ROWTYPE;
BEGIN
 -- Actor/key is held by the original command envelope. Submission lock order:
 -- actor/key -> global setup -> sorted assignment -> sorted employee occupancy
 -- -> fixed account year/id order -> ledger/audit. Never acquire occupancy after accounts.
 -- Setup/assignment locks serialize configured policy/calendar/roster/member/approver writes.
 -- Scope revision is read by the final quote, never locked by submission: the users
 -- is_active trigger must commit its scope bump while we wait on occupancy/accounts.
 -- Current actor/time/authority are reread after each wait and all sources re-quoted last.
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-setup',0));
 SELECT private.ihr_leave_require_personal_actor(),clock_timestamp() INTO actor,at_time;
 PERFORM private.ihr_leave_authorize_command(actor,'submit_request',p_payload,at_time);
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-approver:'||actor::text,0));
 SELECT private.ihr_leave_require_personal_actor(),clock_timestamp() INTO actor,at_time;
 PERFORM private.ihr_leave_authorize_command(actor,'submit_request',p_payload,at_time);
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-occupancy:'||actor::text,0));
 SELECT private.ihr_leave_require_personal_actor(),clock_timestamp() INTO actor,at_time;
 PERFORM private.ihr_leave_authorize_command(actor,'submit_request',p_payload,at_time);
 FOR yr IN SELECT generate_series(extract(year FROM (p_payload->'input'->>'start_date')::date)::integer,extract(year FROM (p_payload->'input'->>'end_date')::date)::integer) LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('ihr-account:'||actor::text||':'||yr::text,0));
  SELECT private.ihr_leave_require_personal_actor(),clock_timestamp() INTO actor,at_time;
  PERFORM private.ihr_leave_authorize_command(actor,'submit_request',p_payload,at_time);
  PERFORM id FROM public.ihr_leave_accounts WHERE employee_id=actor AND leave_type='annual' AND year=yr ORDER BY id FOR UPDATE;
  SELECT private.ihr_leave_require_personal_actor(),clock_timestamp() INTO actor,at_time;
  PERFORM private.ihr_leave_authorize_command(actor,'submit_request',p_payload,at_time);
 END LOOP;
 IF actor IS DISTINCT FROM p_actor OR p_authorized_at IS NULL THEN RAISE EXCEPTION 'Invalid authority' USING ERRCODE='42501'; END IF;
 -- This new VOLATILE query sees committed changes after the last wait, at one fresh clock instant.
 SELECT private.ihr_leave_require_personal_actor(),clock_timestamp() INTO actor,at_time;
 quote:=private.ihr_leave_quote_v1(actor,p_payload->'input',at_time);
 IF quote->>'fingerprint' IS DISTINCT FROM p_payload->>'quote_fingerprint' THEN RAISE EXCEPTION 'Quote changed' USING ERRCODE='55000',DETAIL='{"code":"STALE_QUOTE"}'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(quote->'days') q JOIN public.ihr_leave_occupancy o ON o.employee_id=actor AND o.day=(q->>'date')::date WHERE (q->>'chargedMinutes')::integer>0) THEN
  RAISE EXCEPTION 'A requested date is occupied' USING ERRCODE='55000',DETAIL='{"code":"DATE_OCCUPIED"}'; END IF;
 INSERT INTO public.ihr_leave_requests(id,employee_id,status,start_date,end_date,duration,total_minutes,reason,approver_id,approver_name,assignment_id,assignment_version,
  policy_id,policy_version,member_version,quote_fingerprint,source_snapshot,source_kind,source_id,submitted_at,created_by)
 SELECT request_id,actor,'submitted',(quote->>'startDate')::date,(quote->>'endDate')::date,quote->'duration',(quote->>'totalMinutes')::integer,p_payload->'input'->>'reason',
  (quote->'approver'->>'id')::uuid,quote->'approver'->>'name',(quote->'approver'->>'assignmentId')::uuid,(quote->'approver'->>'assignmentVersion')::bigint,
  (quote->'policy'->>'id')::uuid,(quote->'policy'->>'version')::bigint,(quote->>'memberVersion')::bigint,quote->>'fingerprint',
  jsonb_build_object('quote',quote,'member',to_jsonb(m),'policy',to_jsonb(p),'assignment',to_jsonb(ar)), 'submission',request_id,at_time,actor
 FROM public.ihr_leave_members m JOIN public.ihr_leave_policies p ON p.id=m.active_policy_id
 JOIN public.ihr_leave_approvers ar ON ar.id=(quote->'approver'->>'assignmentId')::uuid WHERE m.user_id=actor;
 FOR d IN SELECT * FROM jsonb_array_elements(quote->'days') LOOP
  INSERT INTO public.ihr_leave_request_days(request_id,day,scheduled_minutes,charged_minutes,exclusion,account_id,source_snapshot)
  VALUES(request_id,(d->>'date')::date,(d->>'scheduledMinutes')::integer,(d->>'chargedMinutes')::integer,d->>'exclusion',(d->>'accountId')::uuid,private.ihr_leave_day_snapshot(actor,(d->>'date')::date));
  IF (d->>'chargedMinutes')::integer>0 THEN INSERT INTO public.ihr_leave_occupancy(employee_id,day,request_id) VALUES(actor,(d->>'date')::date,request_id); END IF;
 END LOOP;
 FOR allocation IN SELECT * FROM jsonb_array_elements(quote->'allocations') LOOP
  SELECT * INTO STRICT a FROM public.ihr_leave_accounts WHERE id=(allocation->>'accountId')::uuid;
  INSERT INTO public.ihr_leave_request_allocations(request_id,account_id,year,period_start,period_end,timezone,charged_minutes,account_version)
  VALUES(request_id,a.id,a.year,a.period_start,a.period_end,a.timezone,(allocation->>'chargedMinutes')::integer,a.version);
  INSERT INTO public.ihr_leave_ledger(account_id,effective_date,kind,reserved_delta,source_kind,source_id,source_event,actor_id)
  VALUES(a.id,greatest(a.period_start,(quote->>'startDate')::date),'reservation',(allocation->>'chargedMinutes')::integer,'request',request_id,'submitted',actor);
 END LOOP;
 INSERT INTO private.ihr_leave_request_events(request_id,actor_id,event,at_time) VALUES(request_id,actor,'submitted',at_time);
 RETURN jsonb_build_object('id',request_id,'version',1,'operation','submit_request');
END;
$$;
ALTER FUNCTION private.ihr_leave_dispatch_command(uuid,text,jsonb,timestamptz) RENAME TO ihr_leave_dispatch_account_command;
CREATE FUNCTION private.ihr_leave_dispatch_command(p_actor uuid,p_operation text,p_payload jsonb,p_authorized_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
BEGIN
 IF p_operation='submit_request' THEN RETURN private.ihr_leave_submit_request(p_actor,p_payload,p_authorized_at); END IF;
 RETURN private.ihr_leave_dispatch_account_command(p_actor,p_operation,p_payload,p_authorized_at);
END;
$$;

-- Outer reconcile_opening dispatcher already owns setup/assignment/scope/occupancy BEFORE
-- account locks. This helper takes no new locks and never inserts a second usage ledger event.
CREATE OR REPLACE FUNCTION private.ihr_import_opening_absences_v1(p_employee uuid,p_account uuid,p_source uuid,p_as_of date,p_lines jsonb,p_actor uuid,p_at timestamptz) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE a public.ihr_leave_accounts%ROWTYPE;m public.ihr_leave_members%ROWTYPE;p public.ihr_leave_policies%ROWTYPE;
 ar public.ihr_leave_approvers%ROWTYPE;line jsonb;working jsonb;days jsonb;d jsonb;v_day date;starts date;ends date;
 total integer;capacity integer;charge integer;request_id uuid;v_source_id uuid;approver_name text;
BEGIN
 IF p_actor IS DISTINCT FROM private.ihr_leave_require_actor() OR p_actor=p_employee OR p_at IS NULL
  OR NOT private.ihr_leave_has_grant(p_actor,'configure',p_employee,p_at) THEN RAISE EXCEPTION 'Opening import denied' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines)>100 THEN RAISE EXCEPTION 'Invalid opening lines' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_lines)=0 THEN RETURN; END IF;
 SELECT * INTO STRICT a FROM public.ihr_leave_accounts WHERE id=p_account AND employee_id=p_employee;
 SELECT * INTO STRICT m FROM public.ihr_leave_members WHERE user_id=p_employee;
 SELECT * INTO STRICT p FROM public.ihr_leave_policies WHERE id=m.active_policy_id;
 IF a.opening_reconciled OR a.policy_id<>p.id OR p_source IS NULL THEN RAISE EXCEPTION 'Opening import unavailable' USING ERRCODE='55000'; END IF;
 SELECT assignment.* INTO ar FROM public.ihr_leave_approvers assignment WHERE assignment.employee_id=p_employee
  AND assignment.revoked_at IS NULL AND assignment.effective_from<=p_at AND (assignment.effective_until IS NULL OR assignment.effective_until>p_at)
  AND private.ihr_leave_is_approver(assignment.approver_id,p_employee,p_at);
 IF ar.id IS NULL THEN RAISE EXCEPTION 'Current approver unavailable' USING ERRCODE='55000',DETAIL='{"code":"APPROVER_UNAVAILABLE"}'; END IF;
 SELECT full_name INTO STRICT approver_name FROM public.users WHERE id=ar.approver_id;
 FOR line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
  v_source_id:=(line->>'source_id')::uuid;starts:=(line->>'start_date')::date;ends:=(line->>'end_date')::date;
  IF starts<=p_as_of OR starts<a.period_start OR ends>=a.period_end OR starts>ends OR ends-starts>365 THEN
   RAISE EXCEPTION 'Invalid opening dates' USING ERRCODE='22023',DETAIL='{"code":"INVALID_OPENING_DATES"}'; END IF;
  IF EXISTS(SELECT 1 FROM public.ihr_leave_requests r WHERE r.source_kind='opening' AND r.source_id=v_source_id) THEN
   RAISE EXCEPTION 'Opening source already used' USING ERRCODE='55000',DETAIL='{"code":"OPENING_SOURCE_DUPLICATE"}'; END IF;
  total:=0;days:='[]';
  FOR v_day IN SELECT starts+n FROM generate_series(0,ends-starts) n LOOP
   IF v_day<p.effective_from OR (p.effective_until IS NOT NULL AND v_day>=p.effective_until) THEN RAISE EXCEPTION 'Policy coverage missing' USING ERRCODE='55000',DETAIL='{"code":"POLICY_COVERAGE_MISSING"}'; END IF;
   working:=private.ihr_working_day_v1(p_employee,v_day);
   IF working ? 'error' THEN RAISE EXCEPTION 'Calendar setup incomplete' USING ERRCODE='55000',DETAIL=jsonb_build_object('code',working->>'error')::text; END IF;
   capacity:=(working->>'capacity_minutes')::integer;
   charge:=CASE WHEN capacity=0 THEN 0 WHEN line->'duration'->>'mode'='full_scheduled_day' THEN capacity ELSE (line->'duration'->>'minutes')::integer END;
   IF charge IS NULL OR charge>capacity THEN RAISE EXCEPTION 'Duration exceeds scheduled shift' USING ERRCODE='22023',DETAIL='{"code":"DURATION_EXCEEDS_SHIFT"}'; END IF;
   IF charge>0 AND EXISTS(SELECT 1 FROM public.ihr_leave_occupancy o WHERE o.employee_id=p_employee AND o.day=v_day) THEN
    RAISE EXCEPTION 'A requested date is occupied' USING ERRCODE='55000',DETAIL='{"code":"DATE_OCCUPIED"}'; END IF;
   days:=days||jsonb_build_array(jsonb_build_object('day',v_day,'capacity',capacity,'charge',charge,'exclusion',working->'exclusion','source',private.ihr_leave_day_snapshot(p_employee,v_day)));
   total:=total+charge;
  END LOOP;
  IF total<1 OR total<>(line->>'total_minutes')::integer THEN RAISE EXCEPTION 'Opening total does not match dates' USING ERRCODE='22023',DETAIL='{"code":"OPENING_TOTAL_MISMATCH"}'; END IF;
  request_id:=gen_random_uuid();
  INSERT INTO public.ihr_leave_requests(id,employee_id,status,start_date,end_date,duration,total_minutes,reason,approver_id,approver_name,assignment_id,assignment_version,
   policy_id,policy_version,member_version,source_snapshot,source_kind,source_id,submitted_at,created_by)
  VALUES(request_id,p_employee,'approved',starts,ends,line->'duration',total,'',ar.approver_id,approver_name,ar.id,ar.version,p.id,p.version,m.version,
   jsonb_build_object('openingSourceId',p_source,'asOf',p_as_of,'member',to_jsonb(m),'policy',to_jsonb(p),'assignment',to_jsonb(ar)),'opening',v_source_id,p_at,p_actor);
  FOR d IN SELECT * FROM jsonb_array_elements(days) LOOP
   INSERT INTO public.ihr_leave_request_days(request_id,day,scheduled_minutes,charged_minutes,exclusion,account_id,source_snapshot)
   VALUES(request_id,(d->>'day')::date,(d->>'capacity')::integer,(d->>'charge')::integer,d->>'exclusion',CASE WHEN (d->>'charge')::integer>0 THEN a.id END,d->'source');
   IF (d->>'charge')::integer>0 THEN INSERT INTO public.ihr_leave_occupancy(employee_id,day,request_id) VALUES(p_employee,(d->>'day')::date,request_id); END IF;
  END LOOP;
  INSERT INTO public.ihr_leave_request_allocations(request_id,account_id,year,period_start,period_end,timezone,charged_minutes,account_version)
  VALUES(request_id,a.id,a.year,a.period_start,a.period_end,a.timezone,total,a.version);
  INSERT INTO private.ihr_leave_request_events(request_id,actor_id,event,at_time,data)
  VALUES(request_id,p_actor,'opening_imported',p_at,jsonb_build_object('openingSourceId',p_source,'lineSourceId',v_source_id));
 END LOOP;
END;
$$;
CREATE FUNCTION private.ihr_leave_request_summary(r public.ihr_leave_requests) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',r.id,'sequence',r.sequence,'startDate',r.start_date,'endDate',r.end_date,'duration',r.duration,
  'totalMinutes',r.total_minutes,'status',r.status,'version',r.version,'submittedAt',r.submitted_at,'sourceKind',r.source_kind);
$$;
CREATE FUNCTION public.leave_own_history_v1(p_before bigint DEFAULT NULL,p_limit integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.ihr_leave_require_personal_actor();rows jsonb;next_before bigint;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>100 OR (p_before IS NOT NULL AND p_before<1) THEN RAISE EXCEPTION 'Invalid history page' USING ERRCODE='22023',DETAIL='{"code":"INVALID_HISTORY_PAGE"}'; END IF;
 SELECT coalesce(jsonb_agg(s.entry ORDER BY s.sequence DESC),'[]'),min(s.sequence) INTO rows,next_before FROM (
  SELECT r.sequence,private.ihr_leave_request_summary(r) entry FROM public.ihr_leave_requests r
  WHERE r.employee_id=actor AND (p_before IS NULL OR r.sequence<p_before) ORDER BY r.sequence DESC LIMIT p_limit
 ) s;
 IF NOT EXISTS(SELECT 1 FROM public.ihr_leave_requests r WHERE r.employee_id=actor AND r.sequence<next_before) THEN next_before:=NULL; END IF;
 RETURN jsonb_build_object('rows',rows,'nextBefore',next_before);
END;
$$;
CREATE FUNCTION public.leave_own_request_v1(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.ihr_leave_require_personal_actor();r public.ihr_leave_requests%ROWTYPE;days jsonb;allocations jsonb;
BEGIN
 SELECT * INTO r FROM public.ihr_leave_requests WHERE id=p_request_id AND employee_id=actor;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Request access denied' USING ERRCODE='42501',DETAIL='{"code":"REQUEST_ACCESS_DENIED"}'; END IF;
 SELECT jsonb_agg(jsonb_build_object('date',d.day,'scheduledMinutes',d.scheduled_minutes,'chargedMinutes',d.charged_minutes,'exclusion',d.exclusion,
  'groupName',d.source_snapshot->'group'->'name') ORDER BY d.day) INTO days FROM public.ihr_leave_request_days d WHERE d.request_id=r.id;
 SELECT jsonb_agg(jsonb_build_object('year',a.year,'startDate',a.period_start,'endDate',a.period_end,'chargedMinutes',a.charged_minutes) ORDER BY a.year)
 INTO allocations FROM public.ihr_leave_request_allocations a WHERE a.request_id=r.id;
 RETURN private.ihr_leave_request_summary(r)||jsonb_build_object('reason',r.reason,'approverName',r.approver_name,'days',days,'allocations',allocations);
END;
$$;
-- A scoped configurator receives only aggregate impact counts for the specified authorized employee.
-- Unprovable setup remains unavailable/null; no IDs, reasons or peer expansion enter the response.
CREATE OR REPLACE FUNCTION private.ihr_leave_setup_impacts_v1(target uuid,"from" date,"to" date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();pending_count bigint;approved_count bigint;
BEGIN
 IF target IS NULL OR NOT private.ihr_leave_has_grant(actor,'configure',target) THEN
  RAISE EXCEPTION 'Leave access denied' USING ERRCODE='42501',DETAIL='{"code":"ACCESS_DENIED"}'; END IF;
 IF ("from" IS NOT NULL AND "to" IS NOT NULL AND "from">"to") OR NOT EXISTS(
  SELECT 1 FROM public.ihr_leave_members m JOIN public.users u ON u.id=m.user_id AND u.is_active
  WHERE m.user_id=target AND m.active AND m.member_kind IN('employee','manager') AND m.active_policy_id IS NOT NULL
   AND private.ihr_leave_calendar_timezone(m.active_calendar_id) IS NOT NULL) THEN
  RETURN jsonb_build_object('available',false,'pendingCount',NULL,'approvedCount',NULL); END IF;
 SELECT count(*) FILTER(WHERE r.status='submitted'),count(*) FILTER(WHERE r.status IN('approved','cancellation_pending'))
 INTO pending_count,approved_count FROM public.ihr_leave_requests r WHERE r.employee_id=target
  AND EXISTS(SELECT 1 FROM public.ihr_leave_request_days d WHERE d.request_id=r.id AND d.charged_minutes>0 AND ("from" IS NULL OR d.day>="from") AND ("to" IS NULL OR d.day<="to"));
 RETURN jsonb_build_object('available',true,'pendingCount',pending_count,'approvedCount',approved_count);
END;
$$;
REVOKE ALL ON FUNCTION private.ihr_leave_require_personal_actor(),private.ihr_leave_authorize_command(uuid,text,jsonb,timestamptz),private.ihr_leave_day_snapshot(uuid,date),private.ihr_leave_submit_request(uuid,jsonb,timestamptz),private.ihr_leave_dispatch_command(uuid,text,jsonb,timestamptz),private.ihr_import_opening_absences_v1(uuid,uuid,uuid,date,jsonb,uuid,timestamptz),private.ihr_leave_request_summary(public.ihr_leave_requests),private.ihr_leave_setup_impacts_v1(uuid,date,date) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.leave_own_history_v1(bigint,integer),public.leave_own_request_v1(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.leave_own_history_v1(bigint,integer),public.leave_own_request_v1(uuid) TO authenticated;

-- Decisions/cancellations from reviewed nondeployable module, composed atomically in 1005.
-- Nondeployable module: compose after request core inside unpublished migration 1005.
-- No staff, grants or policy values are installed. Source and charge history stay frozen.
ALTER TABLE public.ihr_leave_policies
 ADD COLUMN cancellation_rules_confirmed boolean NOT NULL DEFAULT false,
 ADD COLUMN cancellation_mode text CHECK(cancellation_mode='whole_request'),
 ADD COLUMN cancellation_allow_past boolean,
 ADD COLUMN cancellation_allow_repeat_declined boolean,
 ADD COLUMN cancellation_reason_required boolean,
 ADD CONSTRAINT ihr_cancellation_rules_complete CHECK(NOT cancellation_rules_confirmed OR
  (cancellation_mode IS NOT NULL AND cancellation_allow_past IS NOT NULL AND cancellation_allow_repeat_declined IS NOT NULL AND cancellation_reason_required IS NOT NULL));

CREATE TABLE private.ihr_leave_cancellation_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid NOT NULL REFERENCES public.ihr_leave_requests(id),
 attempt_number integer NOT NULL CHECK(attempt_number>0),requested_by uuid NOT NULL REFERENCES public.users(id),
 requested_at timestamptz NOT NULL,reason text NOT NULL CHECK(length(reason)<=1000),
 approver_id uuid NOT NULL REFERENCES public.ihr_leave_members(user_id),approver_name text NOT NULL,
 assignment_id uuid NOT NULL REFERENCES public.ihr_leave_approvers(id),assignment_version bigint NOT NULL,
 policy_id uuid NOT NULL REFERENCES public.ihr_leave_policies(id),policy_version bigint NOT NULL,source_snapshot jsonb NOT NULL,
 UNIQUE(request_id,attempt_number),CHECK(requested_by<>approver_id)
);
CREATE TABLE private.ihr_leave_cancellation_decisions (
 attempt_id uuid PRIMARY KEY REFERENCES private.ihr_leave_cancellation_attempts(id),
 decision text NOT NULL CHECK(decision IN('accepted','declined')),actor_id uuid NOT NULL REFERENCES public.users(id),
 decided_at timestamptz NOT NULL,reason text,CHECK(decision<>'declined' OR length(btrim(reason)) BETWEEN 1 AND 1000)
);
CREATE TABLE private.ihr_leave_charge_reversals (
 request_id uuid NOT NULL,account_id uuid NOT NULL,
 attempt_id uuid NOT NULL REFERENCES private.ihr_leave_cancellation_attempts(id),
 original_ledger_id uuid NOT NULL REFERENCES public.ihr_leave_ledger(id),
 reversal_ledger_id uuid NOT NULL UNIQUE REFERENCES public.ihr_leave_ledger(id),charged_minutes integer NOT NULL CHECK(charged_minutes>0),
 PRIMARY KEY(request_id,account_id),FOREIGN KEY(request_id,account_id) REFERENCES public.ihr_leave_request_allocations(request_id,account_id)
);
ALTER TABLE private.ihr_leave_cancellation_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.ihr_leave_cancellation_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.ihr_leave_charge_reversals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.ihr_leave_cancellation_attempts,private.ihr_leave_cancellation_decisions,private.ihr_leave_charge_reversals FROM PUBLIC,anon,authenticated;
CREATE TRIGGER ihr_cancellation_attempt_immutable BEFORE UPDATE OR DELETE ON private.ihr_leave_cancellation_attempts FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_immutable_audit();
CREATE TRIGGER ihr_cancellation_attempt_no_truncate BEFORE TRUNCATE ON private.ihr_leave_cancellation_attempts FOR EACH STATEMENT EXECUTE FUNCTION private.ihr_leave_immutable_audit();
CREATE TRIGGER ihr_cancellation_decision_immutable BEFORE UPDATE OR DELETE ON private.ihr_leave_cancellation_decisions FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_immutable_audit();
CREATE TRIGGER ihr_cancellation_decision_no_truncate BEFORE TRUNCATE ON private.ihr_leave_cancellation_decisions FOR EACH STATEMENT EXECUTE FUNCTION private.ihr_leave_immutable_audit();
CREATE TRIGGER ihr_charge_reversal_immutable BEFORE UPDATE OR DELETE ON private.ihr_leave_charge_reversals FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_immutable_audit();
CREATE TRIGGER ihr_charge_reversal_no_truncate BEFORE TRUNCATE ON private.ihr_leave_charge_reversals FOR EACH STATEMENT EXECUTE FUNCTION private.ihr_leave_immutable_audit();

CREATE FUNCTION private.ihr_leave_request_transition_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP<>'UPDATE' OR (to_jsonb(NEW)-'status'-'version') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'version')
  OR NEW.version<>OLD.version+1 OR NOT ((OLD.status='submitted' AND NEW.status IN('approved','rejected','withdrawn'))
   OR (OLD.status='approved' AND NEW.status='cancellation_pending') OR (OLD.status='cancellation_pending' AND NEW.status IN('approved','cancelled'))) THEN
  RAISE EXCEPTION 'Request history is immutable' USING ERRCODE='42501',DETAIL='{"code":"REQUEST_IMMUTABLE"}'; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER ihr_request_immutable ON public.ihr_leave_requests;
CREATE TRIGGER ihr_request_immutable BEFORE UPDATE OR DELETE ON public.ihr_leave_requests FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_request_transition_guard();

CREATE FUNCTION private.ihr_leave_assignment_active(p_actor uuid,p_employee uuid,p_assignment uuid,p_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.ihr_leave_approvers a
  JOIN public.users au ON au.id=a.approver_id AND au.is_active JOIN public.users eu ON eu.id=a.employee_id AND eu.is_active
  JOIN public.ihr_leave_members am ON am.user_id=au.id AND am.active JOIN public.ihr_leave_members em ON em.user_id=eu.id AND em.active
  WHERE a.id=p_assignment AND a.approver_id=p_actor AND a.employee_id=p_employee AND p_actor<>p_employee
   AND a.revoked_at IS NULL AND a.effective_from<=p_at AND (a.effective_until IS NULL OR a.effective_until>p_at)
   AND ((em.member_kind='employee' AND am.member_kind='manager') OR (em.member_kind='manager' AND am.member_kind='director')));
$$;
-- Administrative reassignment may replace this resolver with an audited append-only override.
-- Original request columns and source_snapshot remain immutable.
CREATE FUNCTION private.ihr_leave_request_assignment(r public.ihr_leave_requests) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',r.assignment_id,'version',r.assignment_version,'approverId',r.approver_id,'approverName',r.approver_name,'source',r.source_snapshot->'assignment');
$$;
CREATE FUNCTION private.ihr_leave_is_assigned_request(p_actor uuid,p_request_id uuid,p_at timestamptz DEFAULT statement_timestamp()) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.ihr_leave_requests r WHERE r.id=p_request_id AND
  ((r.status='submitted' AND private.ihr_leave_assignment_active(p_actor,r.employee_id,(private.ihr_leave_request_assignment(r)->>'id')::uuid,p_at))
   OR (r.status='cancellation_pending' AND EXISTS(SELECT 1 FROM private.ihr_leave_cancellation_attempts ca
    WHERE ca.request_id=r.id AND NOT EXISTS(SELECT 1 FROM private.ihr_leave_cancellation_decisions cd WHERE cd.attempt_id=ca.id)
     AND private.ihr_leave_assignment_active(p_actor,r.employee_id,ca.assignment_id,p_at)))));
$$;
CREATE FUNCTION private.ihr_leave_cancellation_blocker(r public.ihr_leave_requests,p_at timestamptz) RETURNS text
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE p public.ihr_leave_policies%ROWTYPE;
BEGIN
 SELECT pol.* INTO p FROM public.ihr_leave_members m JOIN public.ihr_leave_policies pol ON pol.id=m.active_policy_id WHERE m.user_id=r.employee_id;
 IF p.id IS NULL OR NOT p.cancellation_rules_confirmed OR p.cancellation_mode IS DISTINCT FROM 'whole_request'
  OR p.cancellation_allow_past IS NULL OR p.cancellation_allow_repeat_declined IS NULL OR p.cancellation_reason_required IS NULL THEN RETURN 'CANCELLATION_RULES_UNCONFIRMED'; END IF;
 IF NOT p.cancellation_allow_past AND EXISTS(SELECT 1 FROM public.ihr_leave_request_days d JOIN public.ihr_leave_request_allocations a
  ON a.request_id=d.request_id AND a.account_id=d.account_id WHERE d.request_id=r.id AND d.charged_minutes>0 AND d.day<(p_at AT TIME ZONE a.timezone)::date) THEN RETURN 'CANCELLATION_PAST_DATE_BLOCKED'; END IF;
 IF NOT p.cancellation_allow_repeat_declined AND EXISTS(SELECT 1 FROM private.ihr_leave_cancellation_attempts ca JOIN private.ihr_leave_cancellation_decisions cd ON cd.attempt_id=ca.id
  WHERE ca.request_id=r.id AND cd.decision='declined') THEN RETURN 'CANCELLATION_REPEAT_BLOCKED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ihr_leave_approvers a WHERE a.employee_id=r.employee_id AND private.ihr_leave_assignment_active(a.approver_id,r.employee_id,a.id,p_at)) THEN RETURN 'APPROVER_UNAVAILABLE'; END IF;
 RETURN NULL;
END;
$$;
CREATE FUNCTION private.ihr_leave_request_sources_current(r public.ihr_leave_requests) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path='' AS $$
BEGIN
 -- Account versions and balance are intentionally absent: the request's own reservation advances them.
 IF NOT EXISTS(SELECT 1 FROM public.ihr_leave_members m JOIN public.ihr_leave_policies p ON p.id=m.active_policy_id
  JOIN public.ihr_leave_approvers a ON a.id=(private.ihr_leave_request_assignment(r)->>'id')::uuid WHERE m.user_id=r.employee_id
   AND (to_jsonb(m)-'version'-'updated_at')=((r.source_snapshot->'member')-'version'-'updated_at') AND to_jsonb(p)=r.source_snapshot->'policy' AND to_jsonb(a)=private.ihr_leave_request_assignment(r)->'source') THEN RETURN false; END IF;
 RETURN NOT EXISTS(SELECT 1 FROM public.ihr_leave_request_days d WHERE d.request_id=r.id
  AND d.source_snapshot IS DISTINCT FROM private.ihr_leave_day_snapshot(r.employee_id,d.day));
END;
$$;

-- Keep frozen core submission validation and account/calendar delegates unchanged.
ALTER FUNCTION private.ihr_leave_authorize_command(uuid,text,jsonb,timestamptz) RENAME TO ihr_leave_authorize_request_command;
CREATE OR REPLACE FUNCTION private.ihr_leave_authorize_command(p_actor uuid,p_operation text,p_payload jsonb,p_authorized_at timestamptz) RETURNS void
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE r public.ihr_leave_requests%ROWTYPE;ca private.ihr_leave_cancellation_attempts%ROWTYPE;keys text[]:=ARRAY['request_id','expected_version'];
BEGIN
 IF p_operation NOT IN('approve_request','reject_request','withdraw_request','request_cancellation','approve_cancellation','decline_cancellation') THEN
  PERFORM private.ihr_leave_authorize_request_command(p_actor,p_operation,p_payload,p_authorized_at);RETURN; END IF;
 IF p_authorized_at IS NULL OR p_actor IS DISTINCT FROM private.ihr_leave_require_actor() THEN RAISE EXCEPTION 'Request access denied' USING ERRCODE='42501',DETAIL='{"code":"REQUEST_ACCESS_DENIED"}'; END IF;
 IF p_operation IN('reject_request','request_cancellation','decline_cancellation') THEN keys:=keys||ARRAY['reason']; END IF;
 IF p_operation IN('approve_cancellation','decline_cancellation') THEN keys:=keys||ARRAY['attempt_id']; END IF;
 PERFORM private.ihr_leave_validate_payload(p_payload,keys,keys);
 IF jsonb_typeof(p_payload->'request_id') IS DISTINCT FROM 'string' OR p_payload->>'request_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR jsonb_typeof(p_payload->'expected_version') IS DISTINCT FROM 'number' OR p_payload->>'expected_version' !~ '^[1-9][0-9]*$'
  OR (p_payload->>'expected_version')::numeric>9007199254740991 THEN RAISE EXCEPTION 'Invalid transition input' USING ERRCODE='22023'; END IF;
 IF p_operation IN('reject_request','request_cancellation','decline_cancellation') AND
  (jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' OR length(p_payload->>'reason')>1000 OR (p_operation<>'request_cancellation' AND length(btrim(p_payload->>'reason'))=0)) THEN
  RAISE EXCEPTION 'Invalid transition reason' USING ERRCODE='22023'; END IF;
 IF p_operation IN('approve_cancellation','decline_cancellation') AND (jsonb_typeof(p_payload->'attempt_id') IS DISTINCT FROM 'string'
  OR p_payload->>'attempt_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN RAISE EXCEPTION 'Invalid cancellation input' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM public.ihr_leave_requests WHERE id=(p_payload->>'request_id')::uuid;
 IF r.id IS NOT NULL THEN
  IF p_operation IN('withdraw_request','request_cancellation') THEN
   IF r.employee_id=p_actor AND EXISTS(SELECT 1 FROM public.ihr_leave_members m WHERE m.user_id=p_actor AND m.active AND m.member_kind IN('employee','manager')) THEN RETURN; END IF;
  ELSIF p_operation IN('approve_request','reject_request') THEN
   IF private.ihr_leave_assignment_active(p_actor,r.employee_id,(private.ihr_leave_request_assignment(r)->>'id')::uuid,p_authorized_at) THEN RETURN; END IF;
  ELSE
   SELECT * INTO ca FROM private.ihr_leave_cancellation_attempts WHERE id=(p_payload->>'attempt_id')::uuid AND request_id=r.id;
   IF ca.id IS NOT NULL AND private.ihr_leave_assignment_active(p_actor,r.employee_id,ca.assignment_id,p_authorized_at) THEN RETURN; END IF;
  END IF;
 END IF;
 RAISE EXCEPTION 'Request access denied' USING ERRCODE='42501',DETAIL='{"code":"REQUEST_ACCESS_DENIED"}';
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'Invalid transition input' USING ERRCODE='22023';
END;
$$;
CREATE FUNCTION private.ihr_leave_transition_request(p_actor uuid,p_operation text,p_payload jsonb,p_authorized_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE r public.ihr_leave_requests%ROWTYPE;a public.ihr_leave_request_allocations%ROWTYPE;
 ca private.ihr_leave_cancellation_attempts%ROWTYPE;assignment public.ihr_leave_approvers%ROWTYPE;p public.ihr_leave_policies%ROWTYPE;
 actor uuid;at_time timestamptz;target uuid;blocker text;next_status text;event_name text;ledger_kind text;
 original_id uuid;reversal_id uuid;reserved_change integer;used_change integer;
BEGIN
 SELECT employee_id INTO target FROM public.ihr_leave_requests WHERE id=(p_payload->>'request_id')::uuid;
 -- Envelope actor/key -> setup -> assignment -> scope read (no held row lock) -> occupancy -> request -> sorted accounts -> ledger/audit.
 -- Do not lock the scope row across waits: active-user revocation bumps it and must be able to commit.
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-setup',0));
 SELECT private.ihr_leave_require_actor(),clock_timestamp() INTO actor,at_time;
 PERFORM private.ihr_leave_authorize_command(actor,p_operation,p_payload,at_time);
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-approver:'||target::text,0));
 SELECT private.ihr_leave_require_actor(),clock_timestamp() INTO actor,at_time;
 PERFORM private.ihr_leave_authorize_command(actor,p_operation,p_payload,at_time);
 PERFORM version FROM private.ihr_leave_scope_revision WHERE singleton;
 SELECT private.ihr_leave_require_actor(),clock_timestamp() INTO actor,at_time;
 PERFORM private.ihr_leave_authorize_command(actor,p_operation,p_payload,at_time);
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-occupancy:'||target::text,0));
 SELECT private.ihr_leave_require_actor(),clock_timestamp() INTO actor,at_time;
 PERFORM private.ihr_leave_authorize_command(actor,p_operation,p_payload,at_time);
 SELECT * INTO STRICT r FROM public.ihr_leave_requests WHERE id=(p_payload->>'request_id')::uuid FOR UPDATE;
 SELECT private.ihr_leave_require_actor(),clock_timestamp() INTO actor,at_time;
 PERFORM private.ihr_leave_authorize_command(actor,p_operation,p_payload,at_time);
 FOR a IN SELECT * FROM public.ihr_leave_request_allocations WHERE request_id=r.id ORDER BY year,account_id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('ihr-account:'||target::text||':'||a.year::text,0));
  SELECT private.ihr_leave_require_actor(),clock_timestamp() INTO actor,at_time;
  PERFORM private.ihr_leave_authorize_command(actor,p_operation,p_payload,at_time);
  PERFORM id FROM public.ihr_leave_accounts WHERE id=a.account_id FOR UPDATE;
  SELECT private.ihr_leave_require_actor(),clock_timestamp() INTO actor,at_time;
  PERFORM private.ihr_leave_authorize_command(actor,p_operation,p_payload,at_time);
 END LOOP;
 IF actor IS DISTINCT FROM p_actor OR p_authorized_at IS NULL THEN RAISE EXCEPTION 'Request access denied' USING ERRCODE='42501'; END IF;
 IF r.version<>(p_payload->>'expected_version')::bigint THEN RAISE EXCEPTION 'Request changed' USING ERRCODE='55000',DETAIL='{"code":"REQUEST_VERSION_CONFLICT"}'; END IF;
 IF (p_operation IN('approve_request','reject_request','withdraw_request') AND r.status<>'submitted')
  OR (p_operation='request_cancellation' AND r.status<>'approved')
  OR (p_operation IN('approve_cancellation','decline_cancellation') AND r.status<>'cancellation_pending') THEN
  RAISE EXCEPTION 'Request state changed' USING ERRCODE='55000',DETAIL='{"code":"REQUEST_STATE_CONFLICT"}'; END IF;
 IF p_operation='approve_request' AND NOT private.ihr_leave_request_sources_current(r) THEN
  RAISE EXCEPTION 'Request sources changed; withdraw and resubmit' USING ERRCODE='55000',DETAIL='{"code":"STALE_REQUEST_SOURCES"}'; END IF;
 IF p_operation='request_cancellation' THEN
  blocker:=private.ihr_leave_cancellation_blocker(r,at_time);
  IF blocker IS NOT NULL THEN RAISE EXCEPTION 'Cancellation unavailable' USING ERRCODE='55000',DETAIL=jsonb_build_object('code',blocker)::text; END IF;
  SELECT pol.* INTO STRICT p FROM public.ihr_leave_members m JOIN public.ihr_leave_policies pol ON pol.id=m.active_policy_id WHERE m.user_id=r.employee_id;
  IF p.cancellation_reason_required AND length(btrim(p_payload->>'reason'))=0 THEN RAISE EXCEPTION 'Cancellation reason required' USING ERRCODE='22023'; END IF;
  SELECT ar.* INTO STRICT assignment FROM public.ihr_leave_approvers ar WHERE ar.employee_id=r.employee_id AND private.ihr_leave_assignment_active(ar.approver_id,r.employee_id,ar.id,at_time);
  INSERT INTO private.ihr_leave_cancellation_attempts(request_id,attempt_number,requested_by,requested_at,reason,approver_id,approver_name,assignment_id,assignment_version,policy_id,policy_version,source_snapshot)
   SELECT r.id,coalesce((SELECT max(c.attempt_number) FROM private.ihr_leave_cancellation_attempts c WHERE c.request_id=r.id),0)+1,actor,at_time,p_payload->>'reason',assignment.approver_id,u.full_name,assignment.id,assignment.version,p.id,p.version,
    jsonb_build_object('policy',to_jsonb(p),'assignment',to_jsonb(assignment)) FROM public.users u WHERE u.id=assignment.approver_id RETURNING * INTO ca;
  next_status:='cancellation_pending';event_name:='cancellation_requested';
 ELSIF p_operation IN('approve_cancellation','decline_cancellation') THEN
  SELECT * INTO ca FROM private.ihr_leave_cancellation_attempts c WHERE c.id=(p_payload->>'attempt_id')::uuid AND c.request_id=r.id
   AND NOT EXISTS(SELECT 1 FROM private.ihr_leave_cancellation_decisions cd WHERE cd.attempt_id=c.id);
  IF ca.id IS NULL THEN RAISE EXCEPTION 'Cancellation attempt changed' USING ERRCODE='55000',DETAIL='{"code":"REQUEST_STATE_CONFLICT"}'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.ihr_leave_approvers ar WHERE ar.id=ca.assignment_id AND ar.version=ca.assignment_version) THEN
   RAISE EXCEPTION 'Cancellation assignment changed' USING ERRCODE='55000',DETAIL='{"code":"STALE_CANCELLATION_ASSIGNMENT"}'; END IF;
  INSERT INTO private.ihr_leave_cancellation_decisions(attempt_id,decision,actor_id,decided_at,reason)
   VALUES(ca.id,CASE p_operation WHEN 'approve_cancellation' THEN 'accepted' ELSE 'declined' END,actor,at_time,p_payload->>'reason');
  next_status:=CASE p_operation WHEN 'approve_cancellation' THEN 'cancelled' ELSE 'approved' END;
  event_name:=CASE p_operation WHEN 'approve_cancellation' THEN 'cancellation_accepted' ELSE 'cancellation_declined' END;
 ELSE
  next_status:=CASE p_operation WHEN 'approve_request' THEN 'approved' WHEN 'reject_request' THEN 'rejected' ELSE 'withdrawn' END;event_name:=next_status;
 END IF;
 IF p_operation IN('approve_request','reject_request','withdraw_request','approve_cancellation') THEN
  ledger_kind:=CASE p_operation WHEN 'approve_request' THEN 'approval' WHEN 'reject_request' THEN 'rejection' WHEN 'withdraw_request' THEN 'withdrawal' ELSE 'cancellation' END;
  FOR a IN SELECT * FROM public.ihr_leave_request_allocations WHERE request_id=r.id ORDER BY year,account_id LOOP
   reserved_change:=CASE WHEN p_operation='approve_cancellation' THEN 0 ELSE -a.charged_minutes END;
   used_change:=CASE p_operation WHEN 'approve_request' THEN a.charged_minutes WHEN 'approve_cancellation' THEN -a.charged_minutes ELSE 0 END;
   IF p_operation='approve_cancellation' THEN
    -- Opening imports share the immutable opening ledger; the per-request frozen allocation limits this reversal.
    SELECT l.id INTO original_id FROM public.ihr_leave_ledger l WHERE l.account_id=a.account_id AND
     ((r.source_kind='submission' AND l.kind='approval' AND l.source_kind='request' AND l.source_id=r.id AND l.source_event='approved' AND l.used_delta=a.charged_minutes)
      OR (r.source_kind='opening' AND l.kind='opening' AND l.source_id=(r.source_snapshot->>'openingSourceId')::uuid AND l.used_delta>=a.charged_minutes));
    IF original_id IS NULL THEN RAISE EXCEPTION 'Original charge unavailable' USING ERRCODE='55000',DETAIL='{"code":"ORIGINAL_CHARGE_UNAVAILABLE"}'; END IF;
   END IF;
   INSERT INTO public.ihr_leave_ledger(account_id,effective_date,kind,reserved_delta,used_delta,source_kind,source_id,source_event,actor_id)
    VALUES(a.account_id,greatest(a.period_start,r.start_date),ledger_kind,reserved_change,used_change,'request',r.id,next_status,actor) RETURNING id INTO reversal_id;
   IF p_operation='approve_cancellation' THEN
    INSERT INTO private.ihr_leave_charge_reversals(request_id,account_id,attempt_id,original_ledger_id,reversal_ledger_id,charged_minutes)
     VALUES(r.id,a.account_id,ca.id,original_id,reversal_id,a.charged_minutes);
   END IF;
  END LOOP;
 END IF;
 IF next_status IN('rejected','withdrawn','cancelled') THEN DELETE FROM public.ihr_leave_occupancy WHERE request_id=r.id; END IF;
 UPDATE public.ihr_leave_requests SET status=next_status,version=version+1 WHERE id=r.id RETURNING * INTO r;
 INSERT INTO private.ihr_leave_request_events(request_id,actor_id,event,at_time,data)
  VALUES(r.id,actor,event_name,at_time,jsonb_strip_nulls(jsonb_build_object('reason',p_payload->>'reason','attemptId',ca.id)));
 RETURN jsonb_build_object('id',r.id,'version',r.version,'operation',p_operation);
END;
$$;
ALTER FUNCTION private.ihr_leave_dispatch_command(uuid,text,jsonb,timestamptz) RENAME TO ihr_leave_dispatch_request_command;
CREATE OR REPLACE FUNCTION private.ihr_leave_dispatch_command(p_actor uuid,p_operation text,p_payload jsonb,p_authorized_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
BEGIN
 IF p_operation IN('approve_request','reject_request','withdraw_request','request_cancellation','approve_cancellation','decline_cancellation') THEN
  RETURN private.ihr_leave_transition_request(p_actor,p_operation,p_payload,p_authorized_at); END IF;
 RETURN private.ihr_leave_dispatch_request_command(p_actor,p_operation,p_payload,p_authorized_at);
END;
$$;

CREATE FUNCTION private.ihr_leave_assigned_summary(r public.ihr_leave_requests) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT private.ihr_leave_request_summary(r)||jsonb_build_object('employee',jsonb_build_object('id',r.employee_id,'name',u.full_name),
  'cancellationAttemptId',ca.id,'cancellationRequestedAt',ca.requested_at)
 FROM public.users u LEFT JOIN private.ihr_leave_cancellation_attempts ca ON ca.request_id=r.id
  AND NOT EXISTS(SELECT 1 FROM private.ihr_leave_cancellation_decisions cd WHERE cd.attempt_id=ca.id)
 WHERE u.id=r.employee_id;
$$;
CREATE FUNCTION public.leave_assigned_inbox_v1(p_before bigint DEFAULT NULL,p_limit integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();rows jsonb;cursor bigint;has_more boolean;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR (p_before IS NOT NULL AND p_before<1) THEN RAISE EXCEPTION 'Invalid inbox page' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ihr_leave_members WHERE user_id=actor AND active AND member_kind IN('manager','director')) THEN
  RAISE EXCEPTION 'Request access denied' USING ERRCODE='42501',DETAIL='{"code":"REQUEST_ACCESS_DENIED"}'; END IF;
 SELECT coalesce(jsonb_agg(private.ihr_leave_assigned_summary(r) ORDER BY r.sequence DESC),'[]'),min(r.sequence) INTO rows,cursor
 FROM (SELECT req.* FROM public.ihr_leave_requests req WHERE (p_before IS NULL OR req.sequence<p_before)
  AND private.ihr_leave_is_assigned_request(actor,req.id,statement_timestamp()) ORDER BY req.sequence DESC LIMIT p_limit) r;
 SELECT EXISTS(SELECT 1 FROM public.ihr_leave_requests req WHERE req.sequence<cursor AND private.ihr_leave_is_assigned_request(actor,req.id,statement_timestamp())) INTO has_more;
 RETURN jsonb_build_object('rows',rows,'nextBefore',CASE WHEN has_more THEN cursor END);
END;
$$;
CREATE FUNCTION public.leave_assigned_request_v1(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();r public.ihr_leave_requests%ROWTYPE;days jsonb;allocations jsonb;cancellation jsonb;
BEGIN
 SELECT * INTO r FROM public.ihr_leave_requests WHERE id=p_request_id AND private.ihr_leave_is_assigned_request(actor,id,statement_timestamp());
 IF r.id IS NULL THEN RAISE EXCEPTION 'Request access denied' USING ERRCODE='42501',DETAIL='{"code":"REQUEST_ACCESS_DENIED"}'; END IF;
 SELECT jsonb_agg(jsonb_build_object('date',d.day,'scheduledMinutes',d.scheduled_minutes,'chargedMinutes',d.charged_minutes,'exclusion',d.exclusion,'groupName',d.source_snapshot->'group'->'name') ORDER BY d.day)
  INTO days FROM public.ihr_leave_request_days d WHERE d.request_id=r.id;
 SELECT jsonb_agg(jsonb_build_object('year',a.year,'startDate',a.period_start,'endDate',a.period_end,'chargedMinutes',a.charged_minutes) ORDER BY a.year)
  INTO allocations FROM public.ihr_leave_request_allocations a WHERE a.request_id=r.id;
 SELECT jsonb_build_object('id',ca.id,'requestedAt',ca.requested_at,'reason',ca.reason,'approverName',ca.approver_name) INTO cancellation
 FROM private.ihr_leave_cancellation_attempts ca WHERE ca.request_id=r.id AND NOT EXISTS(SELECT 1 FROM private.ihr_leave_cancellation_decisions cd WHERE cd.attempt_id=ca.id);
 RETURN private.ihr_leave_assigned_summary(r)||jsonb_build_object('reason',r.reason,'approverName',private.ihr_leave_request_assignment(r)->>'approverName','days',days,'allocations',allocations,'cancellation',cancellation);
END;
$$;
CREATE FUNCTION public.leave_request_transition_state_v1(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.ihr_leave_require_personal_actor();r public.ihr_leave_requests%ROWTYPE;blocker text;attempt uuid;
BEGIN
 SELECT * INTO r FROM public.ihr_leave_requests WHERE id=p_request_id AND employee_id=actor;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Request access denied' USING ERRCODE='42501',DETAIL='{"code":"REQUEST_ACCESS_DENIED"}'; END IF;
 IF r.status='approved' THEN blocker:=private.ihr_leave_cancellation_blocker(r,statement_timestamp()); END IF;
 SELECT ca.id INTO attempt FROM private.ihr_leave_cancellation_attempts ca WHERE ca.request_id=r.id AND NOT EXISTS(SELECT 1 FROM private.ihr_leave_cancellation_decisions cd WHERE cd.attempt_id=ca.id);
 RETURN jsonb_build_object('id',r.id,'version',r.version,'status',r.status,'canWithdraw',r.status='submitted',
  'canRequestCancellation',r.status='approved' AND blocker IS NULL,'cancellationBlocker',blocker,'activeAttemptId',attempt);
END;
$$;
REVOKE ALL ON FUNCTION private.ihr_leave_request_assignment(public.ihr_leave_requests),private.ihr_leave_request_transition_guard(),private.ihr_leave_assignment_active(uuid,uuid,uuid,timestamptz),private.ihr_leave_is_assigned_request(uuid,uuid,timestamptz),private.ihr_leave_cancellation_blocker(public.ihr_leave_requests,timestamptz),private.ihr_leave_request_sources_current(public.ihr_leave_requests),private.ihr_leave_authorize_command(uuid,text,jsonb,timestamptz),private.ihr_leave_transition_request(uuid,text,jsonb,timestamptz),private.ihr_leave_dispatch_command(uuid,text,jsonb,timestamptz),private.ihr_leave_assigned_summary(public.ihr_leave_requests) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.leave_assigned_inbox_v1(bigint,integer),public.leave_assigned_request_v1(uuid),public.leave_request_transition_state_v1(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.leave_assigned_inbox_v1(bigint,integer),public.leave_assigned_request_v1(uuid),public.leave_request_transition_state_v1(uuid) TO authenticated;
COMMIT;
