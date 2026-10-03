-- Unpublished request quote. No actual policy choices, accounts, staff or grants are installed.
BEGIN;
-- Immutable policy versions retain these choices alongside the existing annual policy.
-- The legacy opaque notice_rule is not interpreted as approval of these explicit rules.
ALTER TABLE public.ihr_leave_policies
 ADD COLUMN minimum_notice_days integer CHECK(minimum_notice_days BETWEEN 0 AND 366),
 ADD COLUMN booking_horizon_days integer CHECK(booking_horizon_days BETWEEN 0 AND 366),
 ADD COLUMN reason_required boolean,
 ADD COLUMN request_rules_confirmed boolean NOT NULL DEFAULT false,
 ADD CONSTRAINT ihr_request_rules_complete CHECK(NOT request_rules_confirmed OR
  (minimum_notice_days IS NOT NULL AND booking_horizon_days IS NOT NULL AND reason_required IS NOT NULL AND minimum_notice_days<=booking_horizon_days));

-- Read-only, statement-consistent calculator. Task6 must call this again AFTER its locks with
-- a freshly captured authorization instant. It neither prepares accounts nor grants future years.
CREATE FUNCTION private.ihr_leave_quote_v1(p_employee uuid,p_input jsonb,p_at timestamptz) RETURNS jsonb
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
   IF a.id IS NULL OR NOT a.opening_reconciled OR a.policy_id<>p.id OR a.timezone<>(eligibility->>'timezone')
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
CREATE FUNCTION public.leave_quote_v1(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RETURN private.ihr_leave_quote_v1(private.ihr_leave_require_actor(),p_input,statement_timestamp());
END;
$$;
REVOKE ALL ON FUNCTION private.ihr_leave_quote_v1(uuid,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.leave_quote_v1(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.leave_quote_v1(jsonb) TO authenticated;
COMMIT;
