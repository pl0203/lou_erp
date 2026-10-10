-- Owner-only cardinality/accounting proof; actual role/RPC proof is capacity-measure.mjs.
CREATE FUNCTION ihr_capacity_fixture.validate() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE counts jsonb;expected jsonb:='{"approved":3500,"cancellation_pending":500,"submitted":1000,"rejected":2000,"withdrawn":1500,"cancelled":1500}';
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Capacity invariant audit is owner-only'; END IF;
 IF (SELECT count(*) FROM public.users u JOIN public.ihr_leave_members m ON m.user_id=u.id WHERE u.is_active AND m.active)<>500 OR (SELECT count(*) FROM public.ihr_leave_members WHERE active AND member_kind='employee')<>480
 OR (SELECT count(*) FROM public.ihr_leave_members WHERE active AND member_kind='manager')<>15 OR (SELECT count(*) FROM public.ihr_leave_members WHERE active AND member_kind='director')<>5
 OR (SELECT count(*) FROM public.ihr_leave_members WHERE NOT active AND member_kind='employee')<>5
 OR (SELECT count(*) FROM public.ihr_leave_accounts)<>1500 OR (SELECT count(*) FROM public.ihr_leave_requests)<>10000 OR (SELECT count(*) FROM public.ihr_leave_request_days)<>60000 THEN
  RAISE EXCEPTION 'Capacity cardinality mismatch'; END IF;
 IF (SELECT min(sequence)<>1 OR max(sequence)<>10000 FROM public.ihr_leave_requests) OR (SELECT min(sequence)<>1 OR max(sequence)<>22000 FROM public.ihr_leave_ledger) THEN RAISE EXCEPTION 'Capacity fixture requires fresh unchanged identity sequences'; END IF;
 SELECT jsonb_object_agg(status,n) INTO counts FROM (SELECT status,count(*) n FROM public.ihr_leave_requests GROUP BY status) s;
 IF counts<>expected THEN RAISE EXCEPTION 'Capacity state count mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.ihr_leave_accounts a LEFT JOIN public.ihr_leave_ledger l ON l.account_id=a.id GROUP BY a.id
 HAVING count(*) FILTER(WHERE l.kind='annual_grant')<>1 OR sum(l.allowance_delta)<>5400 OR a.allowance_minutes<>5400
 OR a.reserved_minutes<>sum(l.reserved_delta) OR a.used_minutes<>sum(l.used_delta) OR a.used_minutes+a.reserved_minutes>5400)
 OR EXISTS(SELECT 1 FROM public.ihr_leave_accounts a JOIN public.ihr_leave_members m ON m.user_id=a.employee_id WHERE m.member_kind='director' OR a.year NOT BETWEEN 2024 AND 2026)
 OR EXISTS(SELECT 1 FROM public.ihr_leave_members m LEFT JOIN public.ihr_leave_accounts a ON a.employee_id=m.user_id WHERE m.member_kind<>'director' GROUP BY m.user_id HAVING count(a.id)<>3) THEN
  RAISE EXCEPTION 'Capacity annual accounting mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.ihr_leave_requests r JOIN public.ihr_leave_request_days d ON d.request_id=r.id GROUP BY r.id HAVING sum(d.charged_minutes)<>r.total_minutes OR count(*)<>r.end_date-r.start_date+1)
 OR EXISTS(SELECT 1 FROM public.ihr_leave_request_allocations a JOIN public.ihr_leave_request_days d ON d.request_id=a.request_id AND d.account_id=a.account_id GROUP BY a.request_id,a.account_id HAVING sum(d.charged_minutes)<>a.charged_minutes)
 OR EXISTS(SELECT 1 FROM public.ihr_leave_accounts a WHERE a.reserved_minutes<>(SELECT coalesce(sum(x.charged_minutes),0) FROM public.ihr_leave_request_allocations x JOIN public.ihr_leave_requests r ON r.id=x.request_id WHERE x.account_id=a.id AND r.status='submitted')
 OR a.used_minutes<>(SELECT coalesce(sum(x.charged_minutes),0) FROM public.ihr_leave_request_allocations x JOIN public.ihr_leave_requests r ON r.id=x.request_id WHERE x.account_id=a.id AND r.status IN('approved','cancellation_pending'))) THEN
  RAISE EXCEPTION 'Capacity request allocations mismatch'; END IF;
 IF EXISTS((SELECT r.employee_id,d.day,r.id FROM public.ihr_leave_requests r JOIN public.ihr_leave_request_days d ON d.request_id=r.id WHERE r.status IN('submitted','approved','cancellation_pending') AND d.charged_minutes>0
 EXCEPT SELECT employee_id,day,request_id FROM public.ihr_leave_occupancy) UNION ALL
 (SELECT employee_id,day,request_id FROM public.ihr_leave_occupancy EXCEPT SELECT r.employee_id,d.day,r.id FROM public.ihr_leave_requests r JOIN public.ihr_leave_request_days d ON d.request_id=r.id WHERE r.status IN('submitted','approved','cancellation_pending') AND d.charged_minutes>0)) THEN
  RAISE EXCEPTION 'Capacity occupancy mismatch'; END IF;
 IF (SELECT count(*) FROM private.ihr_leave_cancellation_attempts)<>2060 OR (SELECT count(*) FROM private.ihr_leave_cancellation_decisions)<>1560
 OR (SELECT count(*) FROM private.ihr_leave_charge_reversals)<>1500 OR (SELECT count(*) FROM public.ihr_leave_ledger)<>22000
 OR (SELECT count(*) FROM private.ihr_leave_request_events)<>22620
 OR EXISTS(SELECT 1 FROM private.ihr_leave_charge_reversals x JOIN public.ihr_leave_ledger original ON original.id=x.original_ledger_id JOIN public.ihr_leave_ledger reversal ON reversal.id=x.reversal_ledger_id
 WHERE original.kind<>'approval' OR reversal.kind<>'cancellation' OR original.used_delta<>x.charged_minutes OR reversal.used_delta<>-x.charged_minutes OR original.account_id<>x.account_id OR reversal.account_id<>x.account_id) THEN
  RAISE EXCEPTION 'Capacity immutable history or refund mismatch'; END IF;
 IF (SELECT count(*) FROM private.ihr_leave_cancellation_decisions WHERE decision='declined')<>60 OR (SELECT count(*) FROM private.ihr_leave_cancellation_decisions WHERE decision='accepted')<>1500
 OR EXISTS(SELECT 1 FROM public.ihr_leave_requests r JOIN private.ihr_leave_request_events e ON e.request_id=r.id GROUP BY r.id HAVING count(*)<>r.version)
 OR (SELECT count(*) FROM (SELECT request_id FROM private.ihr_leave_request_events GROUP BY request_id HAVING count(*)=124) d)<>1 THEN
  RAISE EXCEPTION 'Capacity dense legal cancellation history mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.ihr_saturday_memberships a JOIN public.ihr_saturday_memberships b ON a.employee_id=b.employee_id AND a.id<>b.id AND daterange(a.effective_from,a.effective_until,'[)') && daterange(b.effective_from,b.effective_until,'[)'))
 OR EXISTS(SELECT 1 FROM public.ihr_leave_members m CROSS JOIN generate_series('2024-01-01'::timestamp,'2027-10-04'::timestamp,interval '1 day') d WHERE m.active AND m.member_kind<>'director' AND private.ihr_working_day_v1(m.user_id,d::date) ? 'error') THEN
  RAISE EXCEPTION 'Capacity explicit roster coverage mismatch'; END IF;
 RETURN jsonb_build_object('activePeople',500,'accounts',1500,'requests',10000,'days',60000,'annualGrants',1500,'ledger',22000,'events',22620,
 'occupancy',(SELECT count(*) FROM public.ihr_leave_occupancy),'states',counts,'maxCommittedMinutes',(SELECT max(used_minutes+reserved_minutes) FROM public.ihr_leave_accounts));
END $$;
CREATE FUNCTION ihr_capacity_fixture.fingerprint() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE t text;h text;n bigint;configuration jsonb;state jsonb;log_counter text;log_counters jsonb:='{}';tables jsonb:='{}';sequences jsonb:='{}';payload jsonb;actual text[];expected text[];
 table_names text[]:=ARRAY[
 'auth.users','public.users','public.pilot_fixture_marker','ihr_capacity_fixture.identity',
 'public.ihr_leave_members','public.ihr_leave_access_grants','public.ihr_leave_approvers','public.ihr_leave_admin_events',
 'private.ihr_leave_commands','private.ihr_leave_scope_revision','private.ihr_leave_calendar_registry',
 'public.ihr_leave_policies','public.ihr_leave_calendars','public.ihr_leave_calendar_exceptions','public.ihr_saturday_groups',
 'public.ihr_saturday_memberships','public.ihr_saturday_roster','public.ihr_leave_accounts','public.ihr_leave_ledger',
 'public.ihr_leave_requests','public.ihr_leave_request_days','public.ihr_leave_request_allocations','public.ihr_leave_occupancy',
 'private.ihr_leave_request_events','private.ihr_leave_cancellation_attempts','private.ihr_leave_cancellation_decisions',
 'private.ihr_leave_charge_reversals','private.ihr_leave_policy_owners','private.ihr_leave_access_manifests',
 'private.ihr_leave_governance_approvals','private.ihr_leave_governance_references','private.ihr_leave_request_reassignments'];
 sequence_names text[]:=ARRAY['public.ihr_leave_requests_sequence_seq','public.ihr_leave_ledger_sequence_seq'];
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Capacity materialized hash is owner-only'; END IF;
 IF (SELECT count(*) FROM ihr_capacity_fixture.identity)<>1 OR (SELECT count(*) FROM public.pilot_fixture_marker)<>1 OR (SELECT count(*) FROM private.ihr_leave_scope_revision)<>1 THEN
  RAISE EXCEPTION 'Baseline singleton identity/marker/revision required'; END IF;
 SELECT array_agg(n.nspname||'.'||c.relname ORDER BY n.nspname||'.'||c.relname) INTO actual FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN('public','private') AND c.relkind IN('r','p') AND c.relname LIKE 'ihr_%';
 SELECT array_agg(name ORDER BY name) INTO expected FROM unnest(table_names) name WHERE name LIKE 'public.ihr_%' OR name LIKE 'private.ihr_%';
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Complete iHR table inventory mismatch'; END IF;
 SELECT array_agg(n.nspname||'.'||c.relname ORDER BY n.nspname||'.'||c.relname) INTO actual FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN('public','private') AND c.relkind='S' AND c.relname LIKE 'ihr_%';
 SELECT array_agg(name ORDER BY name) INTO expected FROM unnest(sequence_names) name;
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Complete iHR sequence inventory mismatch'; END IF;
 FOREACH t IN ARRAY table_names LOOP
  -- Full rows are sealed, including empty relations, clocks, commands/tombstones, authority state, audit and nested source JSON.
  EXECUTE format($fingerprint$
   SELECT count(*),encode(sha256(convert_to(coalesce(string_agg(h, '' ORDER BY h), ''),'UTF8')),'hex')
   FROM (SELECT encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h FROM %s r) s
  $fingerprint$,t) INTO n,h;
  tables:=tables||jsonb_build_object(t,jsonb_build_object('rows',n,'sha256',h));
 END LOOP;
 FOREACH t IN ARRAY sequence_names LOOP
  -- Preserve allocation/configuration integers losslessly; only WAL prelogging is diagnostic.
  EXECUTE format($sequence$
   SELECT jsonb_build_object('last_value',s.last_value::text,'is_called',s.is_called),s.log_cnt::text FROM %s s
  $sequence$,t) INTO state,log_counter;
  SELECT jsonb_build_object('seqtypid',s.seqtypid::text,'seqstart',s.seqstart::text,'seqincrement',s.seqincrement::text,
   'seqmax',s.seqmax::text,'seqmin',s.seqmin::text,'seqcache',s.seqcache::text,'seqcycle',s.seqcycle)
  INTO STRICT configuration FROM pg_catalog.pg_sequence s WHERE s.seqrelid=t::regclass;
  sequences:=sequences||jsonb_build_object(t,jsonb_build_object('state',state,'configuration',configuration));
  log_counters:=log_counters||jsonb_build_object(t,log_counter);
 END LOOP;
 payload:=jsonb_build_object('format','ihr-capacity-baseline-v3','tables',tables,'sequences',sequences);
 RETURN payload||jsonb_build_object('sha256',encode(sha256(convert_to(payload::text,'UTF8')),'hex'),
  'diagnostics',jsonb_build_object('sequenceLogCounters',log_counters));
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ihr_capacity_fixture FROM PUBLIC,anon,authenticated;
SELECT ihr_capacity_fixture.validate();
SELECT ihr_capacity_fixture.fingerprint();
