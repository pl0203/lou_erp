-- UNPUBLISHED CANDIDATE. DO NOT RUN DIRECTLY. Transaction-neutral.
-- Loaded after schema + commands by the fixed disposable test wrappers.
-- Reporting is recorded history only, never operational access or approval routing.
SET LOCAL search_path = pg_catalog, pg_temp;

-- Pure request normalization: preserve explicit null managers and unknown gaps.
-- Sorting is canonical, but equivalent adjacent segments need not be coalesced.
CREATE FUNCTION private.employee_reporting_request(p_employee_id uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE item jsonb; manager uuid; raw text; from_day date; until_day date; intervals jsonb:='[]';
BEGIN
 IF jsonb_typeof(p_payload->'mode') IS DISTINCT FROM 'string' OR p_payload->>'mode' NOT IN('schedule','correction')
  OR jsonb_typeof(p_payload->'intervals') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'intervals') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF NOT item?&ARRAY['managerEmployeeId','from','until'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN('managerEmployeeId','from','until'))
   OR jsonb_typeof(item->'managerEmployeeId') NOT IN('string','null') THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  raw:=item->>'managerEmployeeId'; manager:=NULL;
  IF raw IS NOT NULL THEN
   IF raw!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
   manager:=raw::uuid;
  END IF;
  IF manager=p_employee_id THEN RAISE EXCEPTION 'REPORTING_SELF_REFERENCE' USING ERRCODE='22023'; END IF;
  from_day:=private.employee_date(item->'from'); until_day:=private.employee_date(item->'until');
  IF from_day IS NULL OR until_day<=from_day THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  intervals:=intervals||jsonb_build_array(jsonb_build_object('managerEmployeeId',manager,'from',to_char(from_day,'YYYY-MM-DD'),'until',to_char(until_day,'YYYY-MM-DD')));
 END LOOP;
 -- Compare each start with the maximum previous end, including an unbounded end.
 IF EXISTS(SELECT 1 FROM (SELECT (value->>'from')::date start_day,
    max(coalesce((value->>'until')::date,'infinity'::date)) OVER(ORDER BY (value->>'from')::date,(value->>'until')::date ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) prior_end
   FROM jsonb_array_elements(intervals)) ordered WHERE start_day<prior_end) THEN
  RAISE EXCEPTION 'REPORTING_OVERLAP' USING ERRCODE='22023';
 END IF;
 SELECT coalesce(jsonb_agg(value ORDER BY value->>'from'),'[]') INTO intervals FROM jsonb_array_elements(intervals);
 RETURN jsonb_build_object('mode',p_payload->>'mode','intervals',intervals);
END;
$$;

-- Called by the SAME state validator for preview and commit. A reporting preview
-- holds the guard FOR SHARE; commit holds it FOR UPDATE until the outer transaction
-- ends. Re-read latest state after lock waits, never trust a pre-lock graph snapshot.
CREATE FUNCTION private.employee_reporting_prepare(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE target uuid:=(p_request->>'employeeId')::uuid; payload jsonb:=p_request->'payload';
 old_intervals jsonb; proposed jsonb:=payload->'intervals'; zone text; today date; graph_revision bigint; current_revision bigint;
BEGIN
 SELECT timezone INTO zone FROM private.employee_settings WHERE singleton;
 IF zone IS NULL THEN RAISE EXCEPTION 'WORKPLACE_TIMEZONE_UNCONFIRMED' USING ERRCODE='55000'; END IF;
 -- Wall-clock civil date is evaluated after waits, including a midnight boundary.
 today:=(clock_timestamp() AT TIME ZONE zone)::date;
 SELECT employee.reporting_revision INTO current_revision FROM private.employee_records employee WHERE id=target;
 SELECT guard.revision INTO graph_revision FROM private.employee_reporting_guard guard WHERE singleton;
 IF graph_revision IS NULL THEN RAISE EXCEPTION 'REPORTING_GRAPH_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 IF current_revision=9007199254740991 OR graph_revision=9007199254740991 THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('managerEmployeeId',manager_employee_id,'from',to_char(from_date,'YYYY-MM-DD'),'until',to_char(until_date,'YYYY-MM-DD')) ORDER BY from_date,ordinal),'[]')
  INTO old_intervals FROM private.employee_reporting_intervals WHERE employee_id=target AND employee_reporting_intervals.revision=current_revision;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(proposed) i WHERE i->>'managerEmployeeId' IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM private.employee_records e WHERE e.id=(i->>'managerEmployeeId')::uuid)) THEN
  RAISE EXCEPTION 'MANAGER_NOT_FOUND' USING ERRCODE='P0002';
 END IF;
 IF payload->>'mode'='schedule' AND EXISTS(
  -- On each half-open segment of the combined change boundaries, both timelines
  -- are constant. Comparing the boundary point proves the entire past projection.
  -- A matched object with a null manager is DISTINCT from an unmatched (unknown) gap.
  WITH old_rows AS(SELECT value i FROM jsonb_array_elements(old_intervals)),
   new_rows AS(SELECT value i FROM jsonb_array_elements(proposed)),
   boundaries AS(SELECT (i->>'from')::date d FROM old_rows UNION SELECT (i->>'until')::date FROM old_rows
    UNION SELECT (i->>'from')::date FROM new_rows UNION SELECT (i->>'until')::date FROM new_rows)
  SELECT 1 FROM boundaries b
   LEFT JOIN LATERAL(SELECT jsonb_build_object('manager',i->'managerEmployeeId') state FROM old_rows WHERE (i->>'from')::date<=b.d AND (i->>'until' IS NULL OR b.d<(i->>'until')::date)) old_state ON true
   LEFT JOIN LATERAL(SELECT jsonb_build_object('manager',i->'managerEmployeeId') state FROM new_rows WHERE (i->>'from')::date<=b.d AND (i->>'until' IS NULL OR b.d<(i->>'until')::date)) new_state ON true
  WHERE b.d<today AND old_state.state IS DISTINCT FROM new_state.state
 ) THEN RAISE EXCEPTION 'REPORTING_HISTORY_CHANGE' USING ERRCODE='55000'; END IF;
 IF EXISTS(
  WITH RECURSIVE edges AS MATERIALIZED(
   SELECT i.employee_id,i.manager_employee_id,daterange(i.from_date,i.until_date,'[)') span
   FROM private.employee_reporting_intervals i JOIN private.employee_records e ON e.id=i.employee_id AND e.reporting_revision=i.revision
   WHERE i.employee_id<>target AND i.manager_employee_id IS NOT NULL
  ), walk(node,span,visited) AS(
   SELECT (i->>'managerEmployeeId')::uuid,daterange((i->>'from')::date,(i->>'until')::date,'[)'),ARRAY[target,(i->>'managerEmployeeId')::uuid]
    FROM jsonb_array_elements(proposed) i WHERE i->>'managerEmployeeId' IS NOT NULL
   UNION ALL
   SELECT e.manager_employee_id,w.span * e.span,w.visited||e.manager_employee_id
    FROM walk w JOIN edges e ON e.employee_id=w.node
    WHERE w.node<>target AND w.span && e.span AND (e.manager_employee_id=target OR NOT e.manager_employee_id=ANY(w.visited))
  ) SELECT 1 FROM walk WHERE node=target
 ) THEN RAISE EXCEPTION 'REPORTING_CYCLE' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('before',jsonb_build_object('reporting',old_intervals),'after',jsonb_build_object('reporting',proposed),
  'graphRevision',graph_revision,'today',to_char(today,'YYYY-MM-DD'));
END;
$$;

-- Only the common audited command dispatcher invokes this write helper after
-- locked validation. Append a full immutable revision; never rewrite prior rows.
CREATE FUNCTION private.employee_reporting_apply(p_employee_id uuid,p_payload jsonb,p_actor uuid,p_source text) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE new_revision bigint;
BEGIN
 UPDATE private.employee_records SET reporting_revision=reporting_revision+1 WHERE id=p_employee_id RETURNING reporting_revision INTO new_revision;
 INSERT INTO private.employee_reporting_revisions(employee_id,revision,mode,actor_id,source_reference)
  VALUES(p_employee_id,new_revision,p_payload->>'mode',p_actor,p_source);
 INSERT INTO private.employee_reporting_intervals(employee_id,revision,ordinal,manager_employee_id,from_date,until_date)
  SELECT p_employee_id,new_revision,(ordinality-1)::integer,(value->>'managerEmployeeId')::uuid,(value->>'from')::date,(value->>'until')::date
   FROM jsonb_array_elements(p_payload->'intervals') WITH ORDINALITY;
 UPDATE private.employee_reporting_guard SET revision=revision+1 WHERE singleton;
END;
$$;
REVOKE ALL ON FUNCTION private.employee_reporting_request(uuid,jsonb),private.employee_reporting_prepare(jsonb),
 private.employee_reporting_apply(uuid,jsonb,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
