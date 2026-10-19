-- Atomic proposal lifecycle. No deployment/client grants included.
BEGIN;
SET LOCAL search_path='';
SET LOCAL lock_timeout='5s';
CREATE FUNCTION private.sales_target_snapshot_roster_v1(plan uuid,roster jsonb) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$BEGIN
 DELETE FROM private.sales_target_roster WHERE plan_id=plan;
 INSERT INTO private.sales_target_roster(plan_id,person_id,customer_id,ownership,assignment_id,assignment_version)
 SELECT plan,(p->>'personId')::uuid,(c->>'customerId')::uuid,p->>'ownership',(c->>'assignmentId')::uuid,(c->>'assignmentVersion')::bigint
 FROM jsonb_array_elements(roster->'people')p LEFT JOIN LATERAL jsonb_array_elements(p->'customers')c ON true;
END$$;
CREATE FUNCTION private.sales_target_write_lines_v1(plan uuid,lines jsonb,submitting boolean) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE x jsonb; target_person uuid; target_metric text; amount numeric; expected integer; baseline numeric; complete boolean; transfer_review boolean; roster jsonb; evidence jsonb;
BEGIN
 IF jsonb_typeof(lines) IS DISTINCT FROM 'array' OR jsonb_array_length(lines)>3000 THEN RAISE EXCEPTION 'Target lines array required' USING ERRCODE='22023'; END IF;
 SELECT roster_snapshot,baseline_snapshot INTO roster,evidence FROM private.sales_target_plans WHERE id=plan;
 expected:=jsonb_array_length(roster->'people')*3;
 IF jsonb_array_length(lines)<>expected OR expected=0 THEN RAISE EXCEPTION 'Exactly three monetary lines per verified roster person required' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(lines)l GROUP BY l->>'personId',l->>'metric' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate target line' USING ERRCODE='22023'; END IF;
 DELETE FROM private.sales_target_lines WHERE plan_id=plan;
 FOR x IN SELECT value FROM jsonb_array_elements(lines) LOOP
  IF jsonb_typeof(x)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(x)k WHERE k NOT IN('personId','metric','amount','applicability','reason')) THEN RAISE EXCEPTION 'Invalid target line keys' USING ERRCODE='22023'; END IF;
  target_person:=(x->>'personId')::uuid;target_metric:=x->>'metric';
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(roster->'people')p WHERE (p->>'personId')::uuid=target_person) OR target_metric IS NULL OR target_metric NOT IN('po_order_value','po_delivery_value','co_sale_value') THEN RAISE EXCEPTION 'Invalid roster target' USING ERRCODE='22023'; END IF;
  IF x->>'applicability' IS NULL OR x->>'applicability' NOT IN('target','not_applicable') OR length(coalesce(x->>'reason',''))>2000 THEN RAISE EXCEPTION 'Invalid applicability or reason' USING ERRCODE='22023'; END IF;
  IF x->'amount' IS NULL OR x->'amount'='null'::jsonb THEN amount:=NULL;
  ELSE
   IF jsonb_typeof(x->'amount')<>'string' OR x->>'amount' !~ '^(0|[1-9][0-9]{0,23})(\.[0-9]{1,2})?$' THEN RAISE EXCEPTION 'Nonnegative decimal-string money required' USING ERRCODE='22023'; END IF;
   amount:=(x->>'amount')::numeric;
  END IF;
  IF x->>'applicability'='not_applicable' AND (amount IS NOT NULL OR nullif(btrim(x->>'reason'),'') IS NULL) THEN RAISE EXCEPTION 'N/A requires reason and no amount' USING ERRCODE='22023'; END IF;
  IF submitting AND x->>'applicability'='target' AND amount IS NULL THEN RAISE EXCEPTION 'Missing target amount' USING ERRCODE='22023'; END IF;
  SELECT count(*)>0 AND bool_and((cell->>'complete')::boolean),sum((cell->>'baseline')::numeric),bool_or(cell->'warningCodes'?'TRANSFER_ACTUALS_REMAIN_PREDECESSOR')
  INTO complete,baseline,transfer_review FROM jsonb_array_elements(evidence->'people')p CROSS JOIN LATERAL jsonb_array_elements(p->'customers')c CROSS JOIN LATERAL jsonb_array_elements(c->'cells')cell WHERE (p->>'personId')::uuid=target_person AND cell->>'metric'=target_metric;
  IF submitting AND x->>'applicability'='target' AND (NOT coalesce(complete,false) OR amount IS DISTINCT FROM baseline OR coalesce(transfer_review,false)) AND nullif(btrim(x->>'reason'),'') IS NULL THEN RAISE EXCEPTION 'Incomplete baseline, adjustment or inherited-credit review requires a reason' USING ERRCODE='22023'; END IF;
  INSERT INTO private.sales_target_lines VALUES(plan,target_person,target_metric,amount,x->>'applicability',nullif(btrim(x->>'reason'),''));
 END LOOP;
END$$;
CREATE FUNCTION public.pilot_sales_target_command_v1(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
<<cmd>>
DECLARE actor public.users; current_plan private.sales_target_plans; prior private.sales_target_requests;
 plan_id uuid; manager uuid; month date; expected bigint; roster jsonb; baseline jsonb; roster_hash text; before_image jsonb; receipt jsonb; old_plan uuid; reason text;
BEGIN
 IF p_request_id IS NULL OR p_operation IS NULL OR p_operation NOT IN('save_draft','submit','return','approve_publish','propose_revision') OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid target command' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload)k WHERE k NOT IN('planId','expectedVersion','month','managerId','rosterHash','lines','reason')) THEN RAISE EXCEPTION 'Unknown target command key' USING ERRCODE='22023'; END IF;
 IF NOT p_payload?'expectedVersion' THEN RAISE EXCEPTION 'Expected version required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(coalesce(auth.uid()::text,'anonymous')||':'||p_request_id::text,781));
 -- Deterministic table SHARE locks prevent membership inserts/updates/deletes while
 -- validating and committing. Correctness first; broad locking cost needs staging load review.
 LOCK TABLE public.users IN SHARE MODE;
 LOCK TABLE public.customer_manager_assignments IN SHARE MODE;
 actor:=private.sales_target_actor_v1();
 PERFORM private.sales_target_enabled_v1();
 SELECT * INTO prior FROM private.sales_target_requests WHERE actor_id=actor.id AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.operation<>p_operation OR prior.payload<>p_payload THEN RAISE EXCEPTION 'Request ID payload mismatch' USING ERRCODE='22023'; END IF;
  PERFORM public.pilot_sales_target_plan_v1((prior.receipt->'plan'->>'id')::uuid);
  RETURN prior.receipt;
 END IF;
 plan_id:=(p_payload->>'planId')::uuid;expected:=(p_payload->>'expectedVersion')::bigint;reason:=nullif(btrim(p_payload->>'reason'),'');
 IF length(coalesce(reason,''))>2000 THEN RAISE EXCEPTION 'Reason too long' USING ERRCODE='22023'; END IF;
 IF plan_id IS NOT NULL THEN
  SELECT * INTO current_plan FROM private.sales_target_plans WHERE id=plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan unavailable' USING ERRCODE='42501'; END IF;
  manager:=current_plan.manager_id;month:=current_plan.month;
 ELSE manager:=(p_payload->>'managerId')::uuid;month:=(p_payload->>'month')::date; END IF;
 PERFORM private.sales_target_month_v1(month);
 PERFORM private.sales_target_authorize_v1(manager,p_operation IN('return','approve_publish'));
 PERFORM pg_advisory_xact_lock(hashtextextended(manager::text||':'||month::text,782));
 IF plan_id IS NOT NULL THEN
  SELECT * INTO current_plan FROM private.sales_target_plans WHERE id=plan_id FOR UPDATE;
  IF expected IS DISTINCT FROM current_plan.version THEN RAISE EXCEPTION 'Stale plan version' USING ERRCODE='40001'; END IF;
  IF (p_payload?'managerId' AND (p_payload->>'managerId')::uuid IS DISTINCT FROM manager) OR (p_payload?'month' AND (p_payload->>'month')::date IS DISTINCT FROM month) THEN RAISE EXCEPTION 'Plan scope immutable' USING ERRCODE='22023'; END IF;
  before_image:=private.sales_target_plan_json_v1(plan_id);
 ELSE
  IF expected IS NOT NULL OR p_operation NOT IN('save_draft','submit') THEN RAISE EXCEPTION 'Invalid plan creation' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM private.sales_target_plans p WHERE p.manager_id=manager AND p.month=month AND p.state='published') THEN RAISE EXCEPTION 'Published month requires a reasoned revision' USING ERRCODE='55000'; END IF;
 END IF;
 roster:=private.sales_target_roster_v1(manager);roster_hash:=private.sales_target_roster_hash_v1(roster);
 IF p_operation IN('save_draft','submit','propose_revision') THEN
  IF actor.role::text<>'sales_manager' OR actor.id<>manager THEN RAISE EXCEPTION 'Only owning manager may propose' USING ERRCODE='42501'; END IF;
  IF plan_id IS NOT NULL AND p_operation<>'propose_revision' AND (current_plan.proposed_by<>actor.id OR current_plan.state NOT IN('draft','returned')) THEN RAISE EXCEPTION 'Editable own draft required' USING ERRCODE='55000'; END IF;
  IF p_operation='propose_revision' THEN
   IF current_plan.state<>'published' OR reason IS NULL THEN RAISE EXCEPTION 'Published plan and revision reason required' USING ERRCODE='22023'; END IF;
   baseline:=public.pilot_sales_target_baseline_v1(month,manager);old_plan:=plan_id;
   INSERT INTO private.sales_target_plans(month,manager_id,roster_hash,roster_snapshot,baseline_snapshot,proposed_by,previous_plan_id,reason,warnings)
   VALUES(month,manager,roster_hash,roster,baseline,actor.id,old_plan,reason,baseline->'warnings') RETURNING id INTO plan_id;
   PERFORM private.sales_target_snapshot_roster_v1(plan_id,roster);
   INSERT INTO private.sales_target_lines
   SELECT plan_id,(p->>'personId')::uuid,m.metric,l.amount,coalesce(l.applicability,'target'),l.reason
   FROM jsonb_array_elements(roster->'people')p CROSS JOIN unnest(ARRAY['po_order_value','po_delivery_value','co_sale_value'])m(metric)
   LEFT JOIN private.sales_target_lines l ON l.plan_id=old_plan AND l.person_id=(p->>'personId')::uuid AND l.metric=m.metric;
  ELSE
   IF p_payload->>'rosterHash' IS DISTINCT FROM roster_hash THEN RAISE EXCEPTION 'Roster changed; review current assignments' USING ERRCODE='40001'; END IF;
   IF p_operation='submit' AND plan_id IS NOT NULL AND current_plan.roster_hash<>roster_hash THEN RAISE EXCEPTION 'Saved roster is stale' USING ERRCODE='40001'; END IF;
   baseline:=public.pilot_sales_target_baseline_v1(month,manager);
   IF plan_id IS NULL THEN
    INSERT INTO private.sales_target_plans(month,manager_id,roster_hash,roster_snapshot,baseline_snapshot,proposed_by,warnings)
    VALUES(month,manager,roster_hash,roster,baseline,actor.id,baseline->'warnings') RETURNING id INTO plan_id;
   ELSE
    UPDATE private.sales_target_plans SET version=version+1,roster_hash=cmd.roster_hash,roster_snapshot=roster,baseline_snapshot=baseline,warnings=baseline->'warnings',updated_at=clock_timestamp() WHERE id=plan_id;
   END IF;
   PERFORM private.sales_target_snapshot_roster_v1(plan_id,roster);
   PERFORM private.sales_target_write_lines_v1(plan_id,p_payload->'lines',p_operation='submit');
   IF p_operation='submit' THEN UPDATE private.sales_target_plans SET state='submitted' WHERE id=plan_id; END IF;
  END IF;
 ELSIF p_operation IN('return','approve_publish') THEN
  IF current_plan.state<>'submitted' THEN RAISE EXCEPTION 'Submitted proposal required' USING ERRCODE='55000'; END IF;
  IF current_plan.proposed_by=actor.id THEN RAISE EXCEPTION 'Self approval or return forbidden' USING ERRCODE='42501'; END IF;
  IF p_operation='approve_publish' AND current_plan.roster_hash<>roster_hash THEN RAISE EXCEPTION 'Roster or hierarchy changed' USING ERRCODE='40001'; END IF;
  IF p_operation='return' THEN
   IF reason IS NULL THEN RAISE EXCEPTION 'Return reason required' USING ERRCODE='22023'; END IF;
   UPDATE private.sales_target_plans SET state='returned',version=version+1,reason=cmd.reason,updated_at=clock_timestamp() WHERE id=plan_id;
  ELSE
   -- Validate stored lines again, without modifying them after publication.
   PERFORM private.sales_target_write_lines_v1(plan_id,before_image->'lines',true);
   SELECT id INTO old_plan FROM private.sales_target_plans p WHERE p.manager_id=manager AND p.month=month AND p.state='published' FOR UPDATE;
   IF old_plan IS NOT NULL AND current_plan.previous_plan_id IS DISTINCT FROM old_plan THEN RAISE EXCEPTION 'Active publication changed; create a fresh revision' USING ERRCODE='40001'; END IF;
   IF old_plan IS NULL AND current_plan.previous_plan_id IS NOT NULL THEN RAISE EXCEPTION 'Revision predecessor no longer active' USING ERRCODE='40001'; END IF;
   IF old_plan IS NOT NULL THEN
    DELETE FROM private.sales_target_active WHERE sales_target_active.plan_id=old_plan;
    UPDATE private.sales_target_plans SET state='superseded',version=version+1,updated_at=clock_timestamp() WHERE id=old_plan;
    INSERT INTO private.sales_target_events(plan_id,request_id,operation,actor_id,before_state,after_state,reason) VALUES(old_plan,p_request_id,'supersede',actor.id,NULL,private.sales_target_plan_json_v1(old_plan),current_plan.reason);
   END IF;
   INSERT INTO private.sales_target_active SELECT person_id,month,metric,plan_id FROM private.sales_target_lines l WHERE l.plan_id=plan_id;
   UPDATE private.sales_target_plans SET state='published',version=version+1,published_by=actor.id,published_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=plan_id;
  END IF;
 END IF;
 receipt:=jsonb_build_object('status','committed','requestId',p_request_id,'plan',private.sales_target_plan_json_v1(plan_id));
 INSERT INTO private.sales_target_events(plan_id,request_id,operation,actor_id,before_state,after_state,reason) VALUES(plan_id,p_request_id,p_operation,actor.id,before_image,receipt->'plan',reason);
 INSERT INTO private.sales_target_requests(actor_id,request_id,operation,payload,receipt) VALUES(actor.id,p_request_id,p_operation,p_payload,receipt);
 RETURN receipt;
END$$;
CREATE FUNCTION public.pilot_sales_target_reconcile_v1(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.users; receipt jsonb;
BEGIN
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Request ID required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(coalesce(auth.uid()::text,'anonymous')||':'||p_request_id::text,781));
 actor:=private.sales_target_actor_v1();
 SELECT r.receipt INTO receipt FROM private.sales_target_requests r WHERE r.actor_id=actor.id AND r.request_id=p_request_id;
 IF receipt IS NULL THEN RETURN jsonb_build_object('status','not_found','requestId',p_request_id); END IF;
 -- Recovery remains readable when rollout is disabled, but is reauthorized to
 -- the current actor/scope and cannot mutate or re-enable the feature.
 PERFORM private.sales_target_authorize_v1((receipt->'plan'->>'managerId')::uuid);
 RETURN receipt;
END$$;
REVOKE ALL ON FUNCTION private.sales_target_snapshot_roster_v1(uuid,jsonb),private.sales_target_write_lines_v1(uuid,jsonb,boolean),public.pilot_sales_target_command_v1(uuid,text,jsonb),public.pilot_sales_target_reconcile_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
