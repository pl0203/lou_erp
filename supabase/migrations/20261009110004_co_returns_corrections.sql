-- Reviewed source changes share the existing replay kernel; history is append-only.
BEGIN;
SET LOCAL search_path='';
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
-- Deferred constraints execute after the checked RPC restores the API role.
-- Read the private command row as the trigger owner, never grant API table access.
ALTER FUNCTION private.co_command_finished_v1() OWNER TO postgres;
ALTER FUNCTION private.co_command_finished_v1() SECURITY DEFINER;

ALTER FUNCTION private.co_sources_v1(uuid) RENAME TO co_monthly_sources_v1;
CREATE FUNCTION private.co_sources_v1(c uuid) RETURNS jsonb LANGUAGE sql SET search_path='' AS $$
 SELECT private.co_monthly_sources_v1(c)||jsonb_build_object('order_lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM private.co_order_lines l WHERE customer_id=c),'[]'::jsonb));
$$;

-- Draft-only IDs make preview FIFO ties identical to eventual immutable batch ties.
CREATE FUNCTION private.co_prepare_sj_draft_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE ids jsonb:='{}'; x jsonb; b uuid;
BEGIN
 IF NEW.kind<>'sj' OR NEW.payload?'posted_delivery_head_id' THEN RETURN NEW; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(NEW.payload->'lines') LOOP
  b:=NULL;
  IF NEW.payload?'bound_delivery_head_id' THEN
   SELECT id INTO b FROM private.co_stock_batches WHERE delivery_head_id=(NEW.payload->>'bound_delivery_head_id')::uuid AND co_line_id=(x->>'co_line_id')::uuid;
  END IF;
  IF b IS NULL AND TG_OP='UPDATE' THEN b:=(OLD.payload->'candidate_batch_ids'->>(x->>'co_line_id'))::uuid; END IF;
  ids:=ids||jsonb_build_object(x->>'co_line_id',coalesce(b,gen_random_uuid()));
 END LOOP;
 NEW.payload:=NEW.payload||jsonb_build_object('candidate_batch_ids',ids); RETURN NEW;
END $$;
CREATE TRIGGER co_prepare_sj_draft BEFORE INSERT OR UPDATE ON private.co_drafts FOR EACH ROW EXECUTE FUNCTION private.co_prepare_sj_draft_v1();

CREATE FUNCTION private.co_validate_return_lines_v1(c uuid,lines jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE x jsonb; b uuid; seen uuid[]:='{}';
BEGIN
 IF jsonb_typeof(lines) IS DISTINCT FROM 'array' OR jsonb_array_length(lines)=0 THEN RAISE EXCEPTION 'Return lines required' USING ERRCODE='22023'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(lines) LOOP
  PERFORM private.co_input_object_v1(x,ARRAY['batch_id','quantity'],ARRAY['batch_id','quantity']); b:=private.co_input_uuid_v1(x->'batch_id'); PERFORM private.co_input_quantity_v1(x->'quantity');
  IF b=ANY(seen) OR NOT EXISTS(SELECT 1 FROM private.co_stock_batches WHERE id=b AND customer_id=c) THEN RAISE EXCEPTION 'Invalid return source' USING ERRCODE='22023'; END IF;
  seen:=array_append(seen,b);
 END LOOP;
END $$;
CREATE FUNCTION private.co_validate_delivery_change_v1(c uuid,o uuid,h uuid,lines jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE x jsonb; l private.co_order_lines%ROWTYPE; seen uuid[]:='{}'; q integer; delivered bigint;
BEGIN
 IF jsonb_typeof(lines) IS DISTINCT FROM 'array' OR jsonb_array_length(lines)=0 THEN RAISE EXCEPTION 'SJ lines required' USING ERRCODE='22023'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(lines) LOOP
  PERFORM private.co_input_object_v1(x,ARRAY['co_line_id','quantity'],ARRAY['co_line_id','quantity']); q:=private.co_input_quantity_v1(x->'quantity');
  SELECT * INTO l FROM private.co_order_lines WHERE id=private.co_input_uuid_v1(x->'co_line_id') AND co_id=o AND customer_id=c;
  IF l.id IS NULL OR l.id=ANY(seen) THEN RAISE EXCEPTION 'Invalid SJ line' USING ERRCODE='22023'; END IF; seen:=array_append(seen,l.id);
  SELECT coalesce(sum(rl.quantity),0) INTO delivered FROM private.co_delivery_heads dh JOIN private.co_delivery_revisions r ON r.id=dh.current_revision_id JOIN private.co_delivery_revision_lines rl ON rl.revision_id=r.id WHERE dh.co_id=o AND dh.id IS DISTINCT FROM h AND rl.co_line_id=l.id AND NOT r.is_void;
  IF delivered+q+l.resolved_undelivered_quantity>l.ordered_quantity THEN RAISE EXCEPTION 'CO_DELIVERY_EXCEEDS_ORDERED' USING ERRCODE='23514'; END IF;
 END LOOP;
END $$;

ALTER FUNCTION private.co_report_context_v1(uuid,date,uuid,jsonb) RENAME TO co_base_report_context_v1;
-- Declared before the overlay helper; PL/pgSQL resolves its calls at execution.
CREATE FUNCTION private.co_report_context_v1(c uuid,m date,d uuid DEFAULT NULL,p_sources jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE context jsonb; proposal jsonb; source jsonb:=p_sources;
BEGIN
 IF source IS NULL AND d IS NOT NULL THEN
  SELECT payload->'source_context' INTO context FROM private.co_drafts WHERE id=d AND customer_id=c AND kind='report';
  IF context IS NOT NULL THEN
   PERFORM private.co_input_object_v1(context,ARRAY['operation','payload','source_context_fingerprint'],ARRAY['operation','payload','source_context_fingerprint']);
   proposal:=private.co_source_proposal_v1(c,context->>'operation',context->'payload');
   IF context->>'source_context_fingerprint' IS DISTINCT FROM proposal->>'source_context_fingerprint' THEN RAISE EXCEPTION 'CO_SOURCE_CONTEXT_STALE' USING ERRCODE='PT409'; END IF;
   source:=proposal->'sources';
  END IF;
 END IF;
 RETURN private.co_base_report_context_v1(c,m,d,source);
END $$;

CREATE FUNCTION private.co_draft_report_v1(c uuid,p jsonb,proposal jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE d private.co_drafts%ROWTYPE; context jsonb; rows jsonb; today date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
 SELECT * INTO d FROM private.co_drafts WHERE id=private.co_input_uuid_v1(p->'draft_id') AND customer_id=c AND kind='report';
 IF d.id IS NULL THEN RAISE EXCEPTION 'Invalid report draft' USING ERRCODE='22023'; END IF;
 IF d.version<>private.co_input_version_v1(p->'expected_draft_version') OR d.payload->>'bound_customer_version' IS DISTINCT FROM (SELECT version::text FROM private.co_customer_state WHERE customer_id=c) THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 IF d.payload?'posted_report_head_id' THEN RAISE EXCEPTION 'Report draft consumed' USING ERRCODE='55000'; END IF;
 IF d.payload?'source_context' THEN
  IF proposal IS NULL OR d.payload->'source_context'->>'source_context_fingerprint' IS DISTINCT FROM proposal->>'source_context_fingerprint' THEN RAISE EXCEPTION 'CO_SOURCE_CONTEXT_STALE' USING ERRCODE='PT409'; END IF;
 END IF;
 context:=private.co_report_context_v1(c,d.report_month,d.id);
 IF d.eligible_set_fingerprint IS DISTINCT FROM p->>'eligible_set_fingerprint' OR d.eligible_set_fingerprint IS DISTINCT FROM context->>'eligible_set_fingerprint' OR d.payload->'bound_report_revision_id' IS DISTINCT FROM context->'bound_report_revision_id' THEN RAISE EXCEPTION 'CO_ELIGIBLE_SET_STALE' USING ERRCODE='PT409'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('ref',stock_key_id::text,'stock_key_id',stock_key_id,'sold_quantity',sold_quantity) ORDER BY stock_key_id),'[]'::jsonb) INTO rows FROM private.co_report_draft_lines WHERE draft_id=d.id;
 RETURN jsonb_build_object('ref','draft:'||d.id,'draft_id',d.id,'draft_version',d.version::text,'head_id',context->'bound_report_head_id','revision_id',NULL,'original_revision_id',context->'bound_report_revision_id','month',d.report_month,'coverage',context->'coverage_through_date','is_partial_month',context->'is_partial_month','report_reference',d.payload->'report_reference','received_date',d.payload->'received_date','notes',d.payload->'notes','lines',rows);
END $$;

-- Source-only proposal hash excludes missing-draft versions and final acknowledgements.
CREATE FUNCTION private.co_source_proposal_v1(c uuid,op text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE s jsonb:=private.co_sources_v1(c); candidate jsonb:=s; primary_info jsonb; d private.co_drafts%ROWTYPE; o private.co_orders%ROWTYPE; h jsonb; old_revision jsonb; x jsonb; l private.co_order_lines%ROWTYPE; b private.co_stock_batches%ROWTYPE;
 lines jsonb:='[]'; batch uuid; head uuid; original uuid; expected bigint; source_kind text; act text; revision jsonb; core text[]; today date:=(clock_timestamp() AT TIME ZONE 'UTC')::date; report jsonb;
BEGIN
 IF s IS NULL THEN RAISE EXCEPTION 'Invalid CO customer' USING ERRCODE='22023'; END IF;
 IF s->>'customer_version' IS DISTINCT FROM private.co_input_version_v1(p->'expected_customer_version')::text THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 IF op IN('post_sj','post_return') THEN
  core:=ARRAY['draft_id','expected_draft_version','expected_customer_version']; IF op='post_sj' THEN core:=core||ARRAY['expected_co_version']; END IF;
  PERFORM private.co_input_object_v1(p,core,core||ARRAY['reason']); source_kind:=CASE op WHEN 'post_sj' THEN 'delivery' ELSE 'return' END;
 ELSIF op IN('correct_sj','correct_return') THEN
  source_kind:=CASE op WHEN 'correct_sj' THEN 'delivery' ELSE 'return' END;
  core:=ARRAY[source_kind||'_head_id','original_revision_id','expected_'||source_kind||'_version','expected_customer_version','action','reason']; IF op='correct_sj' THEN core:=core||ARRAY['expected_co_version']; END IF;
  act:=private.co_input_text_v1(p->'action'); IF act NOT IN('replace','void') THEN RAISE EXCEPTION 'Invalid correction action' USING ERRCODE='22023'; END IF;
  PERFORM private.co_input_object_v1(p,core||CASE WHEN act='replace' THEN CASE WHEN op='correct_sj' THEN ARRAY['draft_id','expected_draft_version'] ELSE ARRAY['return_date','lines'] END ELSE '{}'::text[] END,
    core||CASE WHEN act='replace' THEN CASE WHEN op='correct_sj' THEN ARRAY['draft_id','expected_draft_version'] ELSE ARRAY['return_date','lines','reference','notes'] END ELSE '{}'::text[] END);
  PERFORM private.co_input_text_v1(p->'reason'); head:=private.co_input_uuid_v1(p->(source_kind||'_head_id')); original:=private.co_input_uuid_v1(p->'original_revision_id'); expected:=private.co_input_version_v1(p->('expected_'||source_kind||'_version'));
  IF source_kind='delivery' THEN SELECT to_jsonb(z) INTO h FROM private.co_delivery_heads z WHERE id=head AND customer_id=c; SELECT to_jsonb(z) INTO old_revision FROM private.co_delivery_revisions z WHERE id=(h->>'current_revision_id')::uuid;
  ELSE SELECT to_jsonb(z) INTO h FROM private.co_return_heads z WHERE id=head AND customer_id=c; SELECT to_jsonb(z) INTO old_revision FROM private.co_return_revisions z WHERE id=(h->>'current_revision_id')::uuid; END IF;
  IF h IS NULL THEN RAISE EXCEPTION 'Invalid correction target' USING ERRCODE='22023'; END IF;
  IF h->>'current_revision_id' IS DISTINCT FROM original::text OR (h->>'version')::bigint<>expected THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 ELSIF op='correct_report' THEN
  core:=ARRAY['report_head_id','original_revision_id','expected_report_version','expected_customer_version','draft_id','expected_draft_version','eligible_set_fingerprint','reason']; PERFORM private.co_input_object_v1(p,core,core); PERFORM private.co_input_text_v1(p->'reason');
  SELECT to_jsonb(z) INTO h FROM private.co_report_heads z WHERE id=private.co_input_uuid_v1(p->'report_head_id') AND customer_id=c;
  IF h IS NULL THEN RAISE EXCEPTION 'Invalid correction target' USING ERRCODE='22023'; END IF;
  IF h->>'current_revision_id' IS DISTINCT FROM private.co_input_uuid_v1(p->'original_revision_id')::text OR h->>'version' IS DISTINCT FROM private.co_input_version_v1(p->'expected_report_version')::text THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
  -- A primary draft cannot depend recursively on its own source proposal.
  IF EXISTS(SELECT 1 FROM private.co_drafts WHERE id=private.co_input_uuid_v1(p->'draft_id') AND payload?'source_context') THEN RAISE EXCEPTION 'Primary report requires current-source draft' USING ERRCODE='22023'; END IF;
  report:=private.co_draft_report_v1(c,p); IF report->>'head_id' IS DISTINCT FROM h->>'id' THEN RAISE EXCEPTION 'Invalid report correction draft' USING ERRCODE='22023'; END IF;
  candidate:=jsonb_set(candidate,'{reports}',coalesce((SELECT jsonb_agg(value ORDER BY value->>'month') FROM jsonb_array_elements(s->'reports') WHERE value->>'head_id'<>h->>'id'),'[]')||jsonb_build_array(report));
  primary_info:=jsonb_build_object('kind','report','head_id',h->'id','version',h->'version','original_revision_id',h->'current_revision_id','draft_id',report->'draft_id','report',report);
 ELSE RAISE EXCEPTION 'Invalid reviewed operation' USING ERRCODE='22023'; END IF;
 IF source_kind IN('delivery','return') THEN
  IF p?'draft_id' THEN
   SELECT * INTO d FROM private.co_drafts WHERE id=private.co_input_uuid_v1(p->'draft_id') AND customer_id=c AND co_drafts.kind=CASE source_kind WHEN 'delivery' THEN 'sj' ELSE 'return' END;
   IF d.id IS NULL THEN RAISE EXCEPTION 'Invalid source draft' USING ERRCODE='22023'; END IF;
   IF d.payload?'posted_delivery_head_id' OR d.payload?'posted_return_head_id' THEN RAISE EXCEPTION 'Source draft consumed' USING ERRCODE='55000'; END IF;
   IF d.version<>private.co_input_version_v1(p->'expected_draft_version') OR d.payload->>'bound_customer_version' IS DISTINCT FROM s->>'customer_version' THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
   IF op='correct_sj' AND (d.payload->>'bound_delivery_head_id' IS DISTINCT FROM head::text OR d.payload->>'bound_delivery_revision_id' IS DISTINCT FROM original::text) THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
   IF op='post_sj' AND d.payload?'bound_delivery_head_id' THEN RAISE EXCEPTION 'Correction draft requires correct_sj' USING ERRCODE='22023'; END IF;
  END IF;
  IF source_kind='delivery' THEN
   SELECT * INTO o FROM private.co_orders WHERE id=coalesce(d.co_id,(h->>'co_id')::uuid) AND customer_id=c;
   IF o.id IS NULL OR o.status='cancelled' THEN RAISE EXCEPTION 'Invalid source order' USING ERRCODE='22023'; END IF;
   IF o.version<>private.co_input_version_v1(p->'expected_co_version') OR (d.id IS NOT NULL AND d.payload->>'bound_co_version' IS DISTINCT FROM o.version::text) THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
   revision:=CASE WHEN act='void' THEN old_revision ELSE d.payload END;
   revision:=revision||jsonb_build_object('is_void',coalesce(act='void',false));
   IF (revision->>'sj_date')::date>today OR (revision->>'received_date')::date>today THEN RAISE EXCEPTION 'Future SJ posting is not allowed' USING ERRCODE='22023'; END IF;
   IF act IS DISTINCT FROM 'void' THEN
    IF NOT d.payload?'candidate_batch_ids' THEN RAISE EXCEPTION 'CO_SJ_PREPARATION_REQUIRED' USING ERRCODE='PT409'; END IF;
    PERFORM private.co_validate_delivery_change_v1(c,o.id,head,d.payload->'lines');
    IF EXISTS(SELECT 1 FROM private.co_delivery_heads dh JOIN private.co_delivery_revisions dr ON dr.id=dh.current_revision_id WHERE dh.co_id=o.id AND dh.id IS DISTINCT FROM head AND dr.sj_number=revision->>'sj_number') THEN RAISE EXCEPTION 'Duplicate CO SJ reference' USING ERRCODE='22023'; END IF;
    FOR x IN SELECT value FROM jsonb_array_elements(d.payload->'lines') LOOP
     SELECT * INTO l FROM private.co_order_lines WHERE id=(x->>'co_line_id')::uuid AND co_id=o.id;
     batch:=(d.payload->'candidate_batch_ids'->>(l.id::text))::uuid; IF batch IS NULL THEN RAISE EXCEPTION 'CO_SJ_PREPARATION_REQUIRED' USING ERRCODE='PT409'; END IF;
     lines:=lines||jsonb_build_array(jsonb_build_object('batch_id',batch,'stock_key_id',l.stock_key_id,'co_id',o.id,'co_line_id',l.id,'date',revision->>'sj_date','quantity',(x->>'quantity')::integer::text,'line_ref','source:delivery:'||batch,'revision_id',NULL,
      'original_creation_order',coalesce(h->>'original_creation_order','9223372036854775807'),'unit_price',private.co_money_v1(l.unit_price),'sales_person_id_at_creation',o.sales_person_id_at_creation,'sales_assignment_source_id',o.sales_assignment_source_id,'sales_attributed_at',o.sales_attributed_at,'sales_attribution_state',o.sales_attribution_state));
    END LOOP;
   END IF;
   candidate:=jsonb_set(candidate,'{deliveries}',coalesce((SELECT jsonb_agg(value) FROM jsonb_array_elements(s->'deliveries') WHERE value->>'revision_id' IS DISTINCT FROM original::text),'[]')||lines);
  ELSE
   revision:=CASE WHEN act='void' THEN old_revision WHEN op='post_return' THEN d.payload ELSE p END;
   revision:=revision||jsonb_build_object('is_void',coalesce(act='void',false));
   IF (private.co_input_date_v1(revision->'return_date'))>today THEN RAISE EXCEPTION 'CO_FUTURE_RETURN_DATE' USING ERRCODE='22023'; END IF;
   IF act IS DISTINCT FROM 'void' THEN
    PERFORM private.co_validate_return_lines_v1(c,revision->'lines');
    IF nullif(btrim(private.co_input_text_v1(revision->'reference',true)),'') IS NULL AND nullif(btrim(private.co_input_text_v1(revision->'reason',true)),'') IS NULL THEN RAISE EXCEPTION 'Return reference or reason required' USING ERRCODE='22023'; END IF;
    FOR x IN SELECT value FROM jsonb_array_elements(revision->'lines') LOOP
     SELECT * INTO b FROM private.co_stock_batches WHERE id=(x->>'batch_id')::uuid AND customer_id=c;
     lines:=lines||jsonb_build_array(jsonb_build_object('batch_id',b.id,'stock_key_id',b.stock_key_id,'date',revision->>'return_date','quantity',(x->>'quantity')::integer::text,'line_ref','source:return:'||b.id,'revision_id',NULL));
    END LOOP;
   END IF;
   candidate:=jsonb_set(candidate,'{returns}',coalesce((SELECT jsonb_agg(value) FROM jsonb_array_elements(s->'returns') WHERE value->>'revision_id' IS DISTINCT FROM original::text),'[]')||lines);
  END IF;
  primary_info:=jsonb_build_object('kind',source_kind,'head_id',head,'version',h->'version','original_revision_id',original,'draft_id',d.id,'draft',CASE WHEN d.id IS NULL THEN NULL ELSE to_jsonb(d) END,'co_id',o.id,'revision',revision,'lines',lines);
 END IF;
 RETURN jsonb_build_object('sources',candidate,'primary',primary_info,'source_context_fingerprint',private.co_hash_v1(jsonb_build_object('algorithm','co-reviewed-v1','actor',auth.uid(),'operation',op,'payload',p,'baseline',s,'primary',primary_info,'sources',candidate)));
END $$;

CREATE FUNCTION private.co_required_months_v1(s jsonb,replay jsonb,until_month date,include_last boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE missing jsonb:='[]'; first_day date; m date; ending date; opening numeric; movements bigint; report jsonb;
BEGIN
 SELECT min((value->>'effective_date')::date) INTO first_day FROM jsonb_array_elements(replay->'movements');
 IF first_day IS NULL OR until_month IS NULL THEN RETURN missing; END IF;
 FOR m IN SELECT x::date FROM generate_series(date_trunc('month',first_day)::date,until_month,interval '1 month') x LOOP
  ending:=(m+interval '1 month -1 day')::date;
  SELECT coalesce(sum((value->>'quantity_delta')::numeric),0) INTO opening FROM jsonb_array_elements(replay->'movements') WHERE (value->>'effective_date')::date<m;
  SELECT count(*) INTO movements FROM jsonb_array_elements(replay->'movements') WHERE (value->>'effective_date')::date BETWEEN m AND ending;
  SELECT value INTO report FROM jsonb_array_elements(s->'reports') WHERE value->>'month'=m::text;
  IF (m<until_month OR include_last) AND (opening>0 OR movements>0 OR report IS NOT NULL) AND (report IS NULL OR (report->>'coverage')::date<ending) THEN
   missing:=missing||jsonb_build_array(jsonb_build_object('report_month',m,'reason',CASE WHEN report IS NULL THEN 'missing' ELSE 'partial_coverage' END,'head_id',report->'head_id','coverage_through_date',report->'coverage'));
  END IF;
 END LOOP; RETURN missing;
END $$;

CREATE FUNCTION private.co_closure_facts_v1(c uuid,o uuid,s jsonb,replay jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE batches text[]; remaining numeric; pending numeric; last_month date; missing jsonb;
BEGIN
 SELECT array_agg(id) INTO batches FROM (SELECT id::text FROM private.co_stock_batches WHERE customer_id=c AND co_id=o UNION SELECT value->>'batch_id' FROM jsonb_array_elements(s->'deliveries') WHERE value->>'co_id'=o::text) x;
 SELECT coalesce(sum(value::numeric),0) INTO remaining FROM jsonb_each_text(replay->'balances') WHERE key=ANY(batches);
 SELECT coalesce(sum((value->>'ordered_quantity')::numeric-(value->>'resolved_undelivered_quantity')::numeric),0) - coalesce((SELECT sum((value->>'quantity')::numeric) FROM jsonb_array_elements(s->'deliveries') WHERE value->>'co_id'=o::text),0) INTO pending FROM jsonb_array_elements(s->'order_lines') WHERE value->>'co_id'=o::text;
 SELECT date_trunc('month',max((value->>'effective_date')::date))::date INTO last_month FROM jsonb_array_elements(replay->'movements') WHERE value->>'batch_id'=ANY(batches);
 missing:=private.co_required_months_v1(s,replay,last_month,true);
 RETURN jsonb_build_object('co_id',o,'expected_co_version',(SELECT version::text FROM private.co_orders WHERE id=o),'remaining_quantity',remaining::text,'pending_quantity',pending::text,'missing_month_count',jsonb_array_length(missing)::text);
END $$;

CREATE FUNCTION private.co_period_signature_v1(replay jsonb,m text) RETURNS jsonb LANGUAGE sql SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(x-ARRAY['report_ref','line_ref'] ORDER BY x->>'stock_key_id',x->>'batch_id'),'[]') FROM jsonb_array_elements(replay->'allocations') x WHERE x->>'report_month'=m;
$$;

-- Reject corrupt effective evidence rather than presenting a replayed fiction as the before-state.
CREATE FUNCTION private.co_evidence_matches_v1(c uuid,replay jsonb) RETURNS boolean LANGUAGE sql SET search_path='' AS $$
 SELECT private.co_allocation_signature_v1(replay)=private.co_effective_allocation_signature_v1(c) AND
 coalesce((SELECT jsonb_agg(jsonb_build_array(x->>'kind',x->>'batch_id',x->>'stock_key_id',x->>'quantity_delta',x->>'effective_date',x->>'line_ref',x->>'report_ref') ORDER BY x->>'kind',x->>'batch_id',x->>'line_ref',x->>'effective_date') FROM jsonb_array_elements(replay->'movements') x),'[]'::jsonb)=
 coalesce((SELECT jsonb_agg(jsonb_build_array(m.kind,m.batch_id::text,m.stock_key_id::text,m.quantity_delta::text,m.effective_date::text,coalesce(m.delivery_revision_line_id,m.return_revision_line_id,m.report_revision_line_id)::text,l.revision_id::text) ORDER BY m.kind,m.batch_id::text,coalesce(m.delivery_revision_line_id,m.return_revision_line_id,m.report_revision_line_id)::text,m.effective_date::text)
 FROM private.co_stock_movements m JOIN private.co_customer_state s ON s.effective_generation_id=m.generation_id LEFT JOIN private.co_report_revision_lines l ON l.id=m.report_revision_line_id WHERE s.customer_id=c),'[]'::jsonb);
$$;

ALTER FUNCTION private.co_build_plan_v1(uuid,text,jsonb) RENAME TO co_monthly_plan_v1;
CREATE FUNCTION private.co_build_plan_v1(p_customer_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE s jsonb; proposal jsonb; candidate jsonb; baseline jsonb; replay jsonb; core jsonb; issues jsonb:='[]'; missing jsonb; reopen jsonb:='[]'; publications jsonb:='[]'; reports jsonb:='[]'; stock jsonb; revenue jsonb; credit jsonb; impacts jsonb; counts jsonb; plan jsonb; r jsonb; old jsonb; x jsonb; fact jsonb; acknowledgements jsonb; expected_ack jsonb; context jsonb; max_month date; seen text[]:='{}'; draft_evidence jsonb:='[]';
 today date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
 IF p_operation='post_report' AND EXISTS(SELECT 1 FROM private.co_drafts WHERE id=private.co_input_uuid_v1(p_payload->'draft_id') AND payload?'source_context') THEN RAISE EXCEPTION 'CO_REVIEWED_CORRECTION_REQUIRED' USING ERRCODE='23514'; END IF;
 IF p_operation IN('post_report','replay') THEN RETURN private.co_monthly_plan_v1(p_customer_id,p_operation,p_payload); END IF;
 IF p_operation NOT IN('post_sj','post_return','correct_sj','correct_report','correct_return') THEN RAISE EXCEPTION 'Invalid CO preview operation' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_payload->'completed_report_drafts') IS DISTINCT FROM 'array' OR jsonb_typeof(p_payload->'acknowledged_reopen_orders') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Reviewed report and reopen sets required' USING ERRCODE='22023'; END IF;
 core:=p_payload-ARRAY['completed_report_drafts','acknowledged_reopen_orders'];
 proposal:=private.co_source_proposal_v1(p_customer_id,p_operation,core); s:=private.co_sources_v1(p_customer_id); candidate:=proposal->'sources'; baseline:=private.co_replay_v1(s);
 IF NOT private.co_evidence_matches_v1(p_customer_id,baseline) THEN RAISE EXCEPTION 'CO_EFFECTIVE_EVIDENCE_MISMATCH' USING ERRCODE='23514'; END IF;
 -- Every bundled draft binds the same proposal, never another draft's editable version.
 FOR x IN SELECT value FROM jsonb_array_elements(p_payload->'completed_report_drafts') LOOP
  PERFORM private.co_input_object_v1(x,ARRAY['draft_id','expected_draft_version','eligible_set_fingerprint'],ARRAY['draft_id','expected_draft_version','eligible_set_fingerprint','original_revision_id','expected_report_version']);
  r:=private.co_draft_report_v1(p_customer_id,x,proposal);
  IF r->>'month'=ANY(seen) OR r->>'draft_id'=proposal->'primary'->>'draft_id' THEN RAISE EXCEPTION 'Duplicate bundled report' USING ERRCODE='22023'; END IF; seen:=array_append(seen,r->>'month');
  IF r->>'head_id' IS NOT NULL THEN
   SELECT value INTO old FROM jsonb_array_elements(s->'reports') WHERE value->>'head_id'=r->>'head_id';
   IF old->>'revision_id' IS DISTINCT FROM private.co_input_uuid_v1(x->'original_revision_id')::text OR old->>'head_version' IS DISTINCT FROM private.co_input_version_v1(x->'expected_report_version')::text THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
  ELSIF x?|ARRAY['original_revision_id','expected_report_version'] THEN RAISE EXCEPTION 'New report has no original revision' USING ERRCODE='22023'; END IF;
  candidate:=jsonb_set(candidate,'{reports}',coalesce((SELECT jsonb_agg(value ORDER BY value->>'month') FROM jsonb_array_elements(candidate->'reports') WHERE value->>'month'<>r->>'month'),'[]')||jsonb_build_array(r));
  SELECT draft_evidence||jsonb_build_array(to_jsonb(d)) INTO draft_evidence FROM private.co_drafts d WHERE id=(r->>'draft_id')::uuid;
 END LOOP;
 replay:=private.co_replay_v1(candidate); issues:=replay->'issues';
 SELECT max((value->>'month')::date) INTO max_month FROM jsonb_array_elements(candidate->'reports');
 missing:=private.co_required_months_v1(candidate,replay,max_month);
 FOR x IN SELECT value FROM jsonb_array_elements(missing) LOOP issues:=issues||jsonb_build_array(jsonb_build_object('code',CASE x->>'reason' WHEN 'missing' THEN 'CO_MISSING_REQUIRED_MONTH' ELSE 'CO_PARTIAL_MONTH_INCOMPLETE' END,'report_month',x->'report_month')); END LOOP;
 FOR r IN SELECT value FROM jsonb_array_elements(candidate->'reports') ORDER BY value->>'month' LOOP
  IF (r->>'month')::date>date_trunc('month',today)::date THEN issues:=issues||jsonb_build_array(jsonb_build_object('code','CO_FUTURE_REPORT_MONTH','report_month',r->'month')); END IF;
  IF (r->>'received_date')::date>today THEN issues:=issues||jsonb_build_array(jsonb_build_object('code','CO_FUTURE_RECEIVED_DATE','report_month',r->'month')); END IF;
  SELECT value INTO old FROM jsonb_array_elements(s->'reports') WHERE value->>'month'=r->>'month';
  IF r?'draft_id' OR private.co_period_signature_v1(baseline,r->>'month') IS DISTINCT FROM private.co_period_signature_v1(replay,r->>'month')
   OR (SELECT coalesce(jsonb_agg(value-'report_ref' ORDER BY value->>'stock_key_id'),'[]') FROM jsonb_array_elements(baseline->'eligibility') WHERE value->>'report_month'=r->>'month') IS DISTINCT FROM (SELECT coalesce(jsonb_agg(value-'report_ref' ORDER BY value->>'stock_key_id'),'[]') FROM jsonb_array_elements(replay->'eligibility') WHERE value->>'report_month'=r->>'month') THEN
   publications:=publications||jsonb_build_array(r||jsonb_build_object('original_revision_id',old->'revision_id'));
   reports:=reports||jsonb_build_array(r-ARRAY['lines','draft_id','draft_version','original_revision_id','head_version']||jsonb_build_object('row_count',jsonb_array_length(r->'lines')::text,
    'before_sold_quantity',coalesce((SELECT sum((l->>'sold_quantity')::numeric) FROM jsonb_array_elements(old->'lines') l),0)::text,'after_sold_quantity',coalesce((SELECT sum((l->>'sold_quantity')::numeric) FROM jsonb_array_elements(r->'lines') l),0)::text,
    'before_revenue',private.co_money_v1(coalesce((SELECT sum((a->>'amount')::numeric) FROM jsonb_array_elements(baseline->'allocations') a WHERE a->>'report_month'=r->>'month'),0)),
    'after_revenue',private.co_money_v1(coalesce((SELECT sum((a->>'amount')::numeric) FROM jsonb_array_elements(replay->'allocations') a WHERE a->>'report_month'=r->>'month'),0)),
    'complete',NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'lines') l WHERE l->'sold_quantity'='null'::jsonb)));
  END IF;
 END LOOP;
 IF p_operation IN('post_sj','post_return') AND jsonb_array_length(publications)>0 AND nullif(btrim(private.co_input_text_v1(core->'reason',true)),'') IS NULL THEN issues:=issues||jsonb_build_array(jsonb_build_object('code','CO_CORRECTION_REASON_REQUIRED')); END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(s->'orders') WHERE value->>'status'='closed' ORDER BY value->>'id' LOOP
  fact:=private.co_closure_facts_v1(p_customer_id,(x->>'id')::uuid,candidate,replay);
  IF (fact->>'remaining_quantity')::numeric<>0 OR (fact->>'pending_quantity')::numeric<>0 OR (fact->>'missing_month_count')::numeric<>0 THEN reopen:=reopen||jsonb_build_array(fact); END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(jsonb_build_object('co_id',value->'co_id','expected_co_version',value->'expected_co_version') ORDER BY value->>'co_id'),'[]') INTO expected_ack FROM jsonb_array_elements(reopen);
 seen:='{}'; acknowledgements:='[]';
 FOR x IN SELECT value FROM jsonb_array_elements(p_payload->'acknowledged_reopen_orders') ORDER BY value->>'co_id' LOOP
  PERFORM private.co_input_object_v1(x,ARRAY['co_id','expected_co_version'],ARRAY['co_id','expected_co_version']); PERFORM private.co_input_uuid_v1(x->'co_id'); PERFORM private.co_input_version_v1(x->'expected_co_version');
  IF x->>'co_id'=ANY(seen) THEN RAISE EXCEPTION 'Duplicate reopen acknowledgement' USING ERRCODE='22023'; END IF; seen:=array_append(seen,x->>'co_id'); acknowledgements:=acknowledgements||jsonb_build_array(x);
 END LOOP;
 IF acknowledgements<>expected_ack THEN issues:=issues||jsonb_build_array(jsonb_build_object('code','CO_REOPEN_REQUIRED')); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('stock_key_id',k,'batch_id',b,'before_quantity',coalesce(baseline->'balances'->>b,'0'),'after_quantity',coalesce(replay->'balances'->>b,'0')) ORDER BY k,b),'[]') INTO stock FROM
 (SELECT DISTINCT value->>'stock_key_id' k,value->>'batch_id' b FROM jsonb_array_elements((s->'deliveries')||(candidate->'deliveries'))) keys WHERE coalesce(baseline->'balances'->>b,'0') IS DISTINCT FROM coalesce(replay->'balances'->>b,'0');
 SELECT coalesce(jsonb_agg(jsonb_build_object('report_month',m,'before_amount',private.co_money_v1(before_amount),'after_amount',private.co_money_v1(after_amount)) ORDER BY m),'[]') INTO revenue FROM
 (SELECT value->>'month' m,coalesce((SELECT sum((a->>'amount')::numeric) FROM jsonb_array_elements(baseline->'allocations') a WHERE a->>'report_month'=value->>'month'),0) before_amount,coalesce((SELECT sum((a->>'amount')::numeric) FROM jsonb_array_elements(replay->'allocations') a WHERE a->>'report_month'=value->>'month'),0) after_amount FROM jsonb_array_elements(candidate->'reports')) q WHERE before_amount<>after_amount;
 SELECT coalesce(jsonb_agg(jsonb_build_object('report_month',m,'sales_person_id_at_creation',person,'before_amount',private.co_money_v1(before_amount),'after_amount',private.co_money_v1(after_amount)) ORDER BY m,person NULLS FIRST),'[]') INTO credit FROM
 (SELECT m,person,coalesce((SELECT sum((a->>'amount')::numeric) FROM jsonb_array_elements(baseline->'allocations') a WHERE a->>'report_month'=m AND a->>'sales_person_id_at_creation' IS NOT DISTINCT FROM person),0) before_amount,coalesce((SELECT sum((a->>'amount')::numeric) FROM jsonb_array_elements(replay->'allocations') a WHERE a->>'report_month'=m AND a->>'sales_person_id_at_creation' IS NOT DISTINCT FROM person),0) after_amount FROM (SELECT item->>'report_month' m,item->>'sales_person_id_at_creation' person FROM jsonb_array_elements((baseline->'allocations')||(replay->'allocations')) item GROUP BY 1,2) keys) q WHERE before_amount<>after_amount;
 impacts:=jsonb_build_object('report',reports,'stock',stock,'revenue',revenue,'credit',credit,'reopen',reopen,'issue',issues,'missing_month',missing); SELECT jsonb_object_agg(key,jsonb_array_length(value)::text) INTO counts FROM jsonb_each(impacts);
 plan:=jsonb_build_object('algorithm_version','co-reviewed-v1','operation',p_operation,'customer_id',p_customer_id,'customer_version',s->>'customer_version','draft_version',coalesce(proposal->'primary'->'draft'->>'version',proposal->'primary'->'report'->>'draft_version'),'can_post',jsonb_array_length(issues)=0,'before',private.co_plan_summary_v1(baseline,jsonb_array_length(baseline->'issues')=0),'after',private.co_plan_summary_v1(replay,jsonb_array_length(issues)=0),'counts',counts,'impacts',impacts,'replay',replay,'publish_reports',publications,'proposal',proposal,'source_context_fingerprint',proposal->>'source_context_fingerprint');
 RETURN plan||jsonb_build_object('preview_fingerprint',private.co_hash_v1(jsonb_build_object('actor',auth.uid(),'payload',p_payload,'sources',s,'drafts',draft_evidence,'plan',plan)));
END $$;

CREATE OR REPLACE FUNCTION private.co_preview_plan_v1(operation text,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE c uuid; v bigint;
BEGIN
 PERFORM private.co_actor_v1();
 IF operation IN('post_report','post_sj','post_return','correct_report') THEN SELECT customer_id INTO c FROM private.co_drafts WHERE id=private.co_input_uuid_v1(co_preview_plan_v1.payload->'draft_id');
 ELSIF operation='correct_sj' THEN SELECT customer_id INTO c FROM private.co_delivery_heads WHERE id=private.co_input_uuid_v1(co_preview_plan_v1.payload->'delivery_head_id');
 ELSIF operation='correct_return' THEN SELECT customer_id INTO c FROM private.co_return_heads WHERE id=private.co_input_uuid_v1(co_preview_plan_v1.payload->'return_head_id');
 ELSE RAISE EXCEPTION 'Invalid CO preview operation' USING ERRCODE='22023'; END IF;
 IF c IS NULL THEN RAISE EXCEPTION 'Invalid CO preview target' USING ERRCODE='22023'; END IF;
 SELECT version INTO v FROM private.co_customer_state WHERE customer_id=c FOR SHARE;
 RETURN private.co_build_plan_v1(c,operation,payload);
END $$;
CREATE OR REPLACE FUNCTION private.co_preview_header_v1(plan jsonb) RETURNS jsonb LANGUAGE sql SET search_path='' AS $$
 SELECT jsonb_build_object('version','1','as_of',clock_timestamp(),'operation',plan->'operation','customer_id',plan->'customer_id','customer_version',plan->'customer_version','draft_version',plan->'draft_version','preview_fingerprint',plan->'preview_fingerprint','can_post',plan->'can_post','before',plan->'before','after',plan->'after','counts',plan->'counts')||CASE WHEN plan?'source_context_fingerprint' THEN jsonb_build_object('source_context_fingerprint',plan->'source_context_fingerprint') ELSE '{}'::jsonb END;
$$;

-- Materialization maps each (report reference, stock key), plus source line refs.
-- It copies the approved replay into the inherited ledger writer without reallocating.
CREATE FUNCTION private.co_publish_reviewed_v1(c uuid,actor uuid,request uuid,op text,plan jsonb,reason text) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE primary_source jsonb:=plan->'proposal'->'primary'; source_kind text:=primary_source->>'kind'; source jsonb:=primary_source->'revision'; head uuid; revision uuid; creation_order bigint; head_version bigint; x jsonb; r jsonb; line_id uuid; batch uuid; co uuid:=(primary_source->>'co_id')::uuid;
 report_map jsonb:='{}'; line_map jsonb:='{}'; source_map jsonb:='{}'; rows_map jsonb; replay jsonb:=plan->'replay'; movements jsonb:='[]'; allocations jsonb:='[]'; before_sources jsonb:=private.co_sources_v1(c); g uuid; v bigint; target uuid; target_version bigint; source_revision uuid; changed uuid[]:='{}'; d uuid;
BEGIN
 v:=(plan->>'customer_version')::bigint;
 IF plan->>'can_post'<>'true' OR actor IS DISTINCT FROM private.co_actor_v1() THEN RAISE EXCEPTION 'Invalid reviewed publication' USING ERRCODE='22023'; END IF;
 head:=(primary_source->>'head_id')::uuid;
 IF source_kind='delivery' THEN
  IF head IS NULL THEN INSERT INTO private.co_delivery_heads(customer_id,co_id,created_by) VALUES(c,co,actor) RETURNING id,original_creation_order,version INTO head,creation_order,head_version;
  ELSE SELECT original_creation_order,version+1 INTO creation_order,head_version FROM private.co_delivery_heads WHERE id=head; END IF;
  INSERT INTO private.co_delivery_revisions(head_id,customer_id,co_id,revision_no,sj_number,sj_date,received_date,notes,is_void,reason,created_by)
  VALUES(head,c,co,head_version,source->>'sj_number',(source->>'sj_date')::date,(source->>'received_date')::date,source->>'notes',(source->>'is_void')::boolean,reason,actor) RETURNING id INTO revision;
  FOR x IN SELECT value FROM jsonb_array_elements(primary_source->'lines') LOOP
   batch:=(x->>'batch_id')::uuid; line_id:=gen_random_uuid();
   IF NOT EXISTS(SELECT 1 FROM private.co_stock_batches WHERE id=batch) THEN
    INSERT INTO private.co_stock_batches(id,customer_id,co_id,co_line_id,stock_key_id,delivery_head_id,original_delivery_line_id,original_delivery_created_order,unit_price,sales_person_id_at_creation,sales_assignment_source_id,sales_attributed_at,sales_attribution_state)
    VALUES(batch,c,co,(x->>'co_line_id')::uuid,(x->>'stock_key_id')::uuid,head,line_id,creation_order,(x->>'unit_price')::numeric,(x->>'sales_person_id_at_creation')::uuid,(x->>'sales_assignment_source_id')::uuid,(x->>'sales_attributed_at')::timestamptz,x->>'sales_attribution_state');
   END IF;
   INSERT INTO private.co_delivery_revision_lines(id,revision_id,head_id,customer_id,co_id,co_line_id,stock_key_id,batch_id,quantity) VALUES(line_id,revision,head,c,co,(x->>'co_line_id')::uuid,(x->>'stock_key_id')::uuid,batch,(x->>'quantity')::integer);
   source_map:=source_map||jsonb_build_object(x->>'line_ref',line_id);
  END LOOP;
  UPDATE private.co_delivery_heads SET version=head_version,current_revision_id=revision WHERE id=head;
  changed:=array_append(changed,co);
 ELSIF source_kind='return' THEN
  IF head IS NULL THEN INSERT INTO private.co_return_heads(customer_id,created_by) VALUES(c,actor) RETURNING id,version INTO head,head_version;
  ELSE SELECT version+1 INTO head_version FROM private.co_return_heads WHERE id=head; END IF;
  INSERT INTO private.co_return_revisions(head_id,customer_id,revision_no,return_date,reference,notes,is_void,reason,created_by)
  VALUES(head,c,head_version,(source->>'return_date')::date,source->>'reference',source->>'notes',(source->>'is_void')::boolean,coalesce(reason,source->>'reason'),actor) RETURNING id INTO revision;
  FOR x IN SELECT value FROM jsonb_array_elements(primary_source->'lines') LOOP
   INSERT INTO private.co_return_revision_lines(revision_id,head_id,customer_id,batch_id,stock_key_id,quantity) VALUES(revision,head,c,(x->>'batch_id')::uuid,(x->>'stock_key_id')::uuid,(x->>'quantity')::integer) RETURNING id INTO line_id;
   source_map:=source_map||jsonb_build_object(x->>'line_ref',line_id);
  END LOOP;
  UPDATE private.co_return_heads SET version=head_version,current_revision_id=revision WHERE id=head;
 END IF;
 IF source_kind IN('delivery','return') THEN
  source_revision:=revision; target:=head; target_version:=head_version;
  d:=(primary_source->>'draft_id')::uuid;
  IF d IS NOT NULL THEN UPDATE private.co_drafts SET version=version+1,payload=payload||jsonb_build_object(CASE source_kind WHEN 'delivery' THEN 'posted_delivery_head_id' ELSE 'posted_return_head_id' END,head) WHERE id=d; END IF;
 END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(plan->'publish_reports') ORDER BY value->>'month' LOOP
  head:=(r->>'head_id')::uuid;
  IF head IS NULL THEN INSERT INTO private.co_report_heads(customer_id,report_month,created_by) VALUES(c,(r->>'month')::date,actor) RETURNING id,version INTO head,head_version;
  ELSE SELECT version+1 INTO head_version FROM private.co_report_heads WHERE id=head; END IF;
  INSERT INTO private.co_report_revisions(head_id,customer_id,revision_no,coverage_through_date,is_partial_month,reason,report_reference,received_date,notes,created_by)
  VALUES(head,c,head_version,(r->>'coverage')::date,(r->>'is_partial_month')::boolean,CASE WHEN source_kind='report' AND head=(primary_source->>'head_id')::uuid THEN reason ELSE 'System replay: '||reason END,r->>'report_reference',(r->>'received_date')::date,r->>'notes',actor) RETURNING id INTO revision;
  rows_map:='{}';
  FOR x IN SELECT value FROM jsonb_array_elements(r->'lines') LOOP
   INSERT INTO private.co_report_revision_lines(revision_id,head_id,customer_id,stock_key_id,sold_quantity) VALUES(revision,head,c,(x->>'stock_key_id')::uuid,(x->>'sold_quantity')::integer) RETURNING id INTO line_id;
   rows_map:=rows_map||jsonb_build_object(x->>'stock_key_id',line_id);
  END LOOP;
  report_map:=report_map||jsonb_build_object(r->>'ref',revision); line_map:=line_map||jsonb_build_object(r->>'ref',rows_map);
  UPDATE private.co_report_heads SET version=head_version,current_revision_id=revision WHERE id=head;
  IF r?'draft_id' THEN UPDATE private.co_drafts SET version=version+1,payload=payload||jsonb_build_object('posted_report_head_id',head,'posted_report_revision_id',revision) WHERE id=(r->>'draft_id')::uuid; END IF;
  IF source_kind='report' AND head=(primary_source->>'head_id')::uuid THEN target:=head; target_version:=head_version; END IF;
 END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(replay->'movements') LOOP
  IF report_map?(x->>'report_ref') THEN x:=x||jsonb_build_object('line_ref',line_map->(x->>'report_ref')->(x->>'stock_key_id'),'report_ref',report_map->(x->>'report_ref'));
  ELSIF source_map?(x->>'line_ref') THEN x:=x||jsonb_build_object('line_ref',source_map->(x->>'line_ref')); END IF;
  movements:=movements||jsonb_build_array(x);
 END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(replay->'allocations') LOOP
  IF report_map?(x->>'report_ref') THEN x:=x||jsonb_build_object('line_ref',line_map->(x->>'report_ref')->(x->>'stock_key_id'),'report_ref',report_map->(x->>'report_ref')); END IF;
  allocations:=allocations||jsonb_build_array(x);
 END LOOP;
 replay:=replay||jsonb_build_object('movements',movements,'allocations',allocations);
 g:=private.co_materialize_generation_v1(c,v+1,actor,plan||jsonb_build_object('replay',replay));
 FOR x IN SELECT value FROM jsonb_array_elements(plan->'impacts'->'reopen') LOOP
  co:=(x->>'co_id')::uuid; changed:=array_append(changed,co); UPDATE private.co_orders SET status='active' WHERE id=co;
 END LOOP;
 UPDATE private.co_orders SET version=version+1 WHERE id=ANY(changed);
 UPDATE private.co_customer_state SET version=version+1,effective_generation_id=g WHERE customer_id=c RETURNING version INTO v;
 FOR r IN SELECT value FROM jsonb_array_elements(plan->'publish_reports') LOOP
  INSERT INTO private.co_audit_events(customer_id,actor_id,request_id,operation,reason,before_state,after_state,report_revision_id,generation_id)
  VALUES(c,actor,request,'system_replay',reason,jsonb_build_object('original_revision_id',r->'original_revision_id'),jsonb_build_object('initiating_operation',op,'report_ref',r->>'ref','report_revision_id',report_map->(r->>'ref')),(report_map->>(r->>'ref'))::uuid,g);
 END LOOP;
 INSERT INTO private.co_audit_events(customer_id,actor_id,request_id,operation,reason,before_state,after_state,delivery_revision_id,return_revision_id,report_revision_id,generation_id)
 VALUES(c,actor,request,op,reason,before_sources,jsonb_build_object('sources',private.co_sources_v1(c),'reopened',plan->'impacts'->'reopen','preview_fingerprint',plan->>'preview_fingerprint','source_context_fingerprint',plan->>'source_context_fingerprint'),CASE source_kind WHEN 'delivery' THEN source_revision END,CASE source_kind WHEN 'return' THEN source_revision END,CASE WHEN source_kind='report' THEN (report_map->>(primary_source->'report'->>'ref'))::uuid END,g);
 RETURN jsonb_build_object('id',target,'operation',op,'version',target_version::text,'customer_id',c,'customer_version',v::text);
END $$;

ALTER FUNCTION public.pilot_co_transaction_v1(uuid,text,jsonb) SET SCHEMA private;
ALTER FUNCTION private.pilot_co_transaction_v1(uuid,text,jsonb) RENAME TO co_monthly_transaction_v1;
CREATE OR REPLACE FUNCTION private.co_monthly_transaction_v1(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE proposed_sources jsonb; proposed_context jsonb; proposal jsonb; actor uuid; result jsonb; action text; c uuid; v bigint; d private.co_drafts%ROWTYPE; did uuid; m date; context jsonb; old_image jsonb; new_image jsonb;
 x jsonb; k uuid; quantity integer; seen uuid[]:='{}'; metadata_key text; plan jsonb; head uuid; revision uuid; line_id uuid; line_ids jsonb:='{}'; g uuid; target uuid; target_version bigint;
BEGIN
 IF p_operation NOT IN('save_report_draft','post_report') THEN RETURN private.co_orders_transaction_v1(p_request_id,p_operation,p_payload); END IF;
 actor:=private.co_actor_v1(); result:=private.co_command_begin_v1(p_request_id,p_operation,p_payload); IF result IS NOT NULL THEN RETURN result; END IF;
 IF p_operation='save_report_draft' THEN action:=private.co_input_text_v1(p_payload->'action'); END IF;
 IF action='initialize' THEN
  PERFORM private.co_input_object_v1(p_payload,ARRAY['action','customer_id','report_month','expected_customer_version'],ARRAY['action','customer_id','report_month','expected_customer_version','draft_id','expected_draft_version','report_reference','received_date','notes','source_context']);
  c:=private.co_input_uuid_v1(p_payload->'customer_id'); m:=private.co_input_date_v1(p_payload->'report_month');
  IF extract(day FROM m)<>1 OR (p_payload?'draft_id')<>(p_payload?'expected_draft_version') THEN RAISE EXCEPTION 'Invalid CO report initialization' USING ERRCODE='22023'; END IF;
 ELSE
  did:=private.co_input_uuid_v1(p_payload->'draft_id'); SELECT customer_id INTO c FROM private.co_drafts WHERE id=did AND kind='report';
  IF c IS NULL THEN RAISE EXCEPTION 'Invalid CO report draft' USING ERRCODE='22023'; END IF;
 END IF;
 v:=private.co_lock_customer_v1(c,private.co_input_version_v1(p_payload->'expected_customer_version'));
 IF action='initialize' THEN
  SELECT * INTO d FROM private.co_drafts WHERE customer_id=c AND report_month=m AND kind='report' FOR UPDATE;
  IF d.id IS NOT NULL THEN
   IF NOT p_payload?'draft_id' OR d.id<>private.co_input_uuid_v1(p_payload->'draft_id') THEN RAISE EXCEPTION 'Existing CO draft requires refresh binding' USING ERRCODE='22023'; END IF;
   IF d.version<>private.co_input_version_v1(p_payload->'expected_draft_version') THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
  ELSIF p_payload?'draft_id' THEN RAISE EXCEPTION 'Invalid CO report refresh target' USING ERRCODE='22023'; END IF;
  old_image:=CASE WHEN d.id IS NULL THEN NULL ELSE to_jsonb(d)||jsonb_build_object('lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.stock_key_id) FROM private.co_report_draft_lines l WHERE l.draft_id=d.id)) END;
  IF p_payload?'source_context' THEN
   proposed_context:=p_payload->'source_context';
   PERFORM private.co_input_object_v1(proposed_context,ARRAY['operation','payload','source_context_fingerprint'],ARRAY['operation','payload','source_context_fingerprint']);
   IF proposed_context->'payload'->>'draft_id'=d.id::text THEN RAISE EXCEPTION 'Recursive report context' USING ERRCODE='22023'; END IF;
   proposal:=private.co_source_proposal_v1(c,proposed_context->>'operation',proposed_context->'payload');
   IF proposed_context->>'source_context_fingerprint' IS DISTINCT FROM proposal->>'source_context_fingerprint' THEN RAISE EXCEPTION 'CO_SOURCE_CONTEXT_STALE' USING ERRCODE='PT409'; END IF;
   proposed_sources:=proposal->'sources';
  END IF;
  context:=private.co_base_report_context_v1(c,m,d.id,proposed_sources);
  new_image:=coalesce(d.payload,'{}')-ARRAY['posted_report_head_id','posted_report_revision_id','source_context'];
  IF proposed_context IS NOT NULL THEN new_image:=new_image||jsonb_build_object('source_context',proposed_context); END IF;
  FOREACH metadata_key IN ARRAY ARRAY['report_reference','received_date','notes'] LOOP
   IF p_payload?metadata_key THEN
    IF metadata_key='received_date' THEN new_image:=new_image||jsonb_build_object(metadata_key,private.co_input_date_v1(p_payload->metadata_key,true));
    ELSE new_image:=new_image||jsonb_build_object(metadata_key,private.co_input_text_v1(p_payload->metadata_key,true)); END IF;
   ELSIF NOT new_image?metadata_key THEN new_image:=new_image||jsonb_build_object(metadata_key,NULL); END IF;
  END LOOP;
  new_image:=new_image||(context-ARRAY['eligible_rows','eligible_set_fingerprint'])||jsonb_build_object('bound_customer_version',v::text);
  IF d.id IS NULL THEN
   INSERT INTO private.co_drafts(customer_id,kind,report_month,payload,eligible_set_fingerprint,created_by) VALUES(c,'report',m,new_image,context->>'eligible_set_fingerprint',actor) RETURNING * INTO d;
   -- A pre-existing effective period may have been published without a draft (legacy fixture).
   INSERT INTO private.co_report_draft_lines(draft_id,customer_id,stock_key_id,sold_quantity)
   SELECT d.id,c,l.stock_key_id,l.sold_quantity FROM private.co_report_revision_lines l WHERE l.revision_id=(context->>'bound_report_revision_id')::uuid;
  ELSE UPDATE private.co_drafts SET version=version+1,payload=new_image,eligible_set_fingerprint=context->>'eligible_set_fingerprint' WHERE id=d.id RETURNING * INTO d; END IF;
  INSERT INTO private.co_report_draft_lines(draft_id,customer_id,stock_key_id) SELECT d.id,c,(value->>'stock_key_id')::uuid FROM jsonb_array_elements(context->'eligible_rows') ON CONFLICT(draft_id,stock_key_id) DO NOTHING;
  -- Newly retained rows are now part of the same complete eligibility fingerprint.
  context:=private.co_report_context_v1(c,m,d.id); UPDATE private.co_drafts SET eligible_set_fingerprint=context->>'eligible_set_fingerprint' WHERE id=d.id RETURNING * INTO d;
 ELSE
  SELECT * INTO d FROM private.co_drafts WHERE id=did AND customer_id=c AND kind='report' FOR UPDATE;
  IF d.version<>private.co_input_version_v1(p_payload->'expected_draft_version') THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
  old_image:=to_jsonb(d)||jsonb_build_object('lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.stock_key_id) FROM private.co_report_draft_lines l WHERE l.draft_id=d.id));
  IF p_operation='post_report' THEN
   IF d.payload?'source_context' THEN RAISE EXCEPTION 'CO_REVIEWED_CORRECTION_REQUIRED' USING ERRCODE='23514'; END IF;
   PERFORM private.co_input_object_v1(p_payload,ARRAY['draft_id','expected_draft_version','expected_customer_version','eligible_set_fingerprint','preview_fingerprint'],ARRAY['draft_id','expected_draft_version','expected_customer_version','eligible_set_fingerprint','preview_fingerprint']);
   plan:=private.co_build_plan_v1(c,'post_report',p_payload-'preview_fingerprint');
   IF p_payload->>'preview_fingerprint' IS DISTINCT FROM plan->>'preview_fingerprint' THEN RAISE EXCEPTION 'CO_PREVIEW_STALE' USING ERRCODE='PT409'; END IF;
   IF plan->>'can_post'<>'true' THEN RAISE EXCEPTION '%',plan->'impacts'->'issue'->0->>'code' USING ERRCODE='23514'; END IF;
   INSERT INTO private.co_report_heads(customer_id,report_month,created_by) VALUES(c,d.report_month,actor) RETURNING id INTO head;
   INSERT INTO private.co_report_revisions(head_id,customer_id,revision_no,coverage_through_date,is_partial_month,report_reference,received_date,notes,created_by)
   VALUES(head,c,1,(plan->'candidate_report'->>'coverage')::date,(plan->'candidate_report'->>'is_partial_month')::boolean,d.payload->>'report_reference',(d.payload->>'received_date')::date,d.payload->>'notes',actor) RETURNING id INTO revision;
   FOR x IN SELECT value FROM jsonb_array_elements(plan->'candidate_report'->'lines') LOOP
    INSERT INTO private.co_report_revision_lines(revision_id,head_id,customer_id,stock_key_id,sold_quantity) VALUES(revision,head,c,(x->>'stock_key_id')::uuid,(x->>'sold_quantity')::integer) RETURNING id INTO line_id;
    line_ids:=line_ids||jsonb_build_object(x->>'stock_key_id',line_id);
   END LOOP;
   g:=private.co_materialize_generation_v1(c,v+1,actor,plan,revision,line_ids);
   UPDATE private.co_report_heads SET current_revision_id=revision WHERE id=head;
   UPDATE private.co_drafts SET version=version+1,payload=payload||jsonb_build_object('posted_report_head_id',head,'posted_report_revision_id',revision) WHERE id=d.id RETURNING * INTO d;
   UPDATE private.co_customer_state SET version=version+1,effective_generation_id=g WHERE customer_id=c RETURNING version INTO v;
   target:=head; target_version:=1;
  ELSE
   IF d.payload?'posted_report_head_id' THEN RAISE EXCEPTION 'CO report draft already posted' USING ERRCODE='55000'; END IF;
   context:=private.co_report_context_v1(c,d.report_month,d.id);
   IF d.payload->>'bound_customer_version' IS DISTINCT FROM v::text OR d.eligible_set_fingerprint IS DISTINCT FROM context->>'eligible_set_fingerprint' OR d.payload->'bound_report_revision_id' IS DISTINCT FROM context->'bound_report_revision_id' THEN RAISE EXCEPTION 'CO_ELIGIBLE_SET_STALE' USING ERRCODE='PT409'; END IF;
   IF action IN('upsert_lines','fill_remaining_zero') THEN
    PERFORM private.co_input_object_v1(p_payload,ARRAY['action','draft_id','expected_draft_version','expected_customer_version','eligible_set_fingerprint']||CASE WHEN action='upsert_lines' THEN ARRAY['lines'] ELSE '{}'::text[] END,
     ARRAY['action','draft_id','expected_draft_version','expected_customer_version','eligible_set_fingerprint']||CASE WHEN action='upsert_lines' THEN ARRAY['lines'] ELSE '{}'::text[] END);
    IF p_payload->>'eligible_set_fingerprint' IS DISTINCT FROM d.eligible_set_fingerprint THEN RAISE EXCEPTION 'CO_ELIGIBLE_SET_STALE' USING ERRCODE='PT409'; END IF;
    IF action='fill_remaining_zero' THEN UPDATE private.co_report_draft_lines SET sold_quantity=0 WHERE draft_id=d.id AND sold_quantity IS NULL;
    ELSE
     IF jsonb_typeof(p_payload->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'lines') NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'CO report chunk requires 1 to 500 rows' USING ERRCODE='22023'; END IF;
     FOR x IN SELECT value FROM jsonb_array_elements(p_payload->'lines') LOOP
      PERFORM private.co_input_object_v1(x,ARRAY['stock_key_id','sold_quantity'],ARRAY['stock_key_id','sold_quantity']); k:=private.co_input_uuid_v1(x->'stock_key_id'); quantity:=private.co_sold_input_v1(x->'sold_quantity');
      IF k=ANY(seen) OR NOT EXISTS(SELECT 1 FROM private.co_report_draft_lines WHERE draft_id=d.id AND stock_key_id=k) THEN RAISE EXCEPTION 'Invalid CO report row identity' USING ERRCODE='22023'; END IF;
      seen:=array_append(seen,k); UPDATE private.co_report_draft_lines SET sold_quantity=quantity WHERE draft_id=d.id AND stock_key_id=k;
     END LOOP;
    END IF;
   ELSIF action='set_metadata' THEN
    PERFORM private.co_input_object_v1(p_payload,ARRAY['action','draft_id','expected_draft_version','expected_customer_version'],ARRAY['action','draft_id','expected_draft_version','expected_customer_version','report_reference','received_date','notes']);
    IF NOT p_payload?|ARRAY['report_reference','received_date','notes'] THEN RAISE EXCEPTION 'CO report metadata field required' USING ERRCODE='22023'; END IF;
    new_image:=d.payload;
    FOREACH metadata_key IN ARRAY ARRAY['report_reference','received_date','notes'] LOOP
     IF p_payload?metadata_key THEN
      IF metadata_key='received_date' THEN new_image:=new_image||jsonb_build_object(metadata_key,private.co_input_date_v1(p_payload->metadata_key,true));
      ELSE new_image:=new_image||jsonb_build_object(metadata_key,private.co_input_text_v1(p_payload->metadata_key,true)); END IF;
     END IF;
    END LOOP;
    UPDATE private.co_drafts SET payload=new_image WHERE id=d.id;
   ELSE RAISE EXCEPTION 'Invalid CO report draft action' USING ERRCODE='22023'; END IF;
   UPDATE private.co_drafts SET version=version+1 WHERE id=d.id RETURNING * INTO d;
  END IF;
 END IF;
 IF target IS NULL THEN target:=d.id; target_version:=d.version; END IF;
 new_image:=to_jsonb(d)||jsonb_build_object('lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.stock_key_id) FROM private.co_report_draft_lines l WHERE l.draft_id=d.id),'report_head_id',head,'report_revision_id',revision,'generation_id',g);
 INSERT INTO private.co_audit_events(customer_id,actor_id,request_id,operation,before_state,after_state,report_revision_id,generation_id) VALUES(c,actor,p_request_id,p_operation,old_image,new_image,revision,g);
 result:=jsonb_build_object('id',target,'operation',p_operation,'version',target_version::text,'customer_id',c,'customer_version',v::text);
 RETURN private.co_command_commit_v1(p_request_id,result);
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Conflicting CO identity' USING ERRCODE='22023';
END $$;

CREATE FUNCTION public.pilot_co_transaction_v1(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; result jsonb; c uuid; v bigint; o private.co_orders%ROWTYPE; d private.co_drafts%ROWTYPE; h private.co_delivery_heads%ROWTYPE; x jsonb; k uuid; q integer; seen uuid[]:='{}'; before_image jsonb; after_image jsonb; reason text; plan jsonb; s jsonb; replay jsonb; facts jsonb; target uuid; target_version bigint;
BEGIN
 -- Authorize before even classifying a draft, including delegated operations/retries.
 PERFORM private.co_actor_v1();
 IF p_operation='post_sj' AND NOT p_payload?'preview_fingerprint' THEN
  IF EXISTS(SELECT 1 FROM private.co_drafts WHERE id=private.co_input_uuid_v1(p_payload->'draft_id') AND payload?'bound_delivery_head_id') THEN RAISE EXCEPTION 'Correction draft requires correct_sj' USING ERRCODE='22023'; END IF;
  RETURN private.co_monthly_transaction_v1(p_request_id,p_operation,p_payload);
 END IF;
 IF p_operation NOT IN('save_return_draft','post_return','correct_sj','correct_report','correct_return','resolve_undelivered','close_co','post_sj') AND NOT(p_operation='save_sj_draft' AND p_payload?'delivery_head_id') THEN RETURN private.co_monthly_transaction_v1(p_request_id,p_operation,p_payload); END IF;
 actor:=private.co_actor_v1(); result:=private.co_command_begin_v1(p_request_id,p_operation,p_payload); IF result IS NOT NULL THEN RETURN result; END IF;
 IF p_operation='save_return_draft' THEN c:=private.co_input_uuid_v1(p_payload->'customer_id');
 ELSIF p_operation IN('save_sj_draft','close_co','resolve_undelivered') THEN SELECT * INTO o FROM private.co_orders WHERE id=private.co_input_uuid_v1(p_payload->'co_id'); c:=o.customer_id;
 ELSIF p_operation IN('post_sj','post_return','correct_report') THEN SELECT customer_id INTO c FROM private.co_drafts WHERE id=private.co_input_uuid_v1(p_payload->'draft_id');
 ELSIF p_operation='correct_sj' THEN SELECT customer_id INTO c FROM private.co_delivery_heads WHERE id=private.co_input_uuid_v1(p_payload->'delivery_head_id');
 ELSE SELECT customer_id INTO c FROM private.co_return_heads WHERE id=private.co_input_uuid_v1(p_payload->'return_head_id'); END IF;
 IF c IS NULL THEN RAISE EXCEPTION 'Invalid CO command target' USING ERRCODE='22023'; END IF;
 v:=private.co_lock_customer_v1(c,private.co_input_version_v1(p_payload->'expected_customer_version'));
 -- One customer serializes the whole chronology. Deterministic entity order follows.
 PERFORM id FROM private.co_orders WHERE customer_id=c ORDER BY id FOR UPDATE;
 PERFORM id FROM private.co_delivery_heads WHERE customer_id=c ORDER BY id FOR UPDATE;
 PERFORM id FROM private.co_return_heads WHERE customer_id=c ORDER BY id FOR UPDATE;
 PERFORM id FROM private.co_report_heads WHERE customer_id=c ORDER BY id FOR UPDATE;
 PERFORM id FROM private.co_drafts WHERE customer_id=c ORDER BY id FOR UPDATE;
 IF o.id IS NOT NULL THEN
  SELECT * INTO o FROM private.co_orders WHERE id=o.id;
  IF o.version<>private.co_input_version_v1(p_payload->'expected_co_version') THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 END IF;
 reason:=private.co_input_text_v1(p_payload->'reason',true);
 IF p_operation IN('save_return_draft','save_sj_draft') THEN
  IF p_operation='save_return_draft' THEN
   PERFORM private.co_input_object_v1(p_payload,ARRAY['customer_id','expected_customer_version','return_date','lines'],ARRAY['customer_id','expected_customer_version','return_date','lines','reference','reason','notes','draft_id','expected_draft_version']);
   PERFORM private.co_validate_return_lines_v1(c,p_payload->'lines');
   IF nullif(btrim(private.co_input_text_v1(p_payload->'reference',true)),'') IS NULL AND nullif(btrim(reason),'') IS NULL THEN RAISE EXCEPTION 'Return reference or reason required' USING ERRCODE='22023'; END IF;
   after_image:=jsonb_build_object('return_date',private.co_input_date_v1(p_payload->'return_date'),'reference',private.co_input_text_v1(p_payload->'reference',true),'reason',reason,'notes',private.co_input_text_v1(p_payload->'notes',true),'lines',p_payload->'lines','bound_customer_version',v::text);
  ELSE
   PERFORM private.co_input_object_v1(p_payload,ARRAY['co_id','expected_co_version','expected_customer_version','delivery_head_id','original_revision_id','expected_delivery_version','sj_number','sj_date','lines'],ARRAY['co_id','expected_co_version','expected_customer_version','delivery_head_id','original_revision_id','expected_delivery_version','sj_number','sj_date','lines','received_date','notes','draft_id','expected_draft_version']);
   SELECT * INTO h FROM private.co_delivery_heads WHERE id=private.co_input_uuid_v1(p_payload->'delivery_head_id') AND co_id=o.id AND customer_id=c;
   IF h.id IS NULL OR o.status='cancelled' THEN RAISE EXCEPTION 'Invalid SJ correction target' USING ERRCODE='22023'; END IF;
   IF h.current_revision_id<>private.co_input_uuid_v1(p_payload->'original_revision_id') OR h.version<>private.co_input_version_v1(p_payload->'expected_delivery_version') THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
   PERFORM private.co_validate_delivery_change_v1(c,o.id,h.id,p_payload->'lines');
   after_image:=jsonb_build_object('sj_number',btrim(private.co_input_text_v1(p_payload->'sj_number')),'sj_date',private.co_input_date_v1(p_payload->'sj_date'),'received_date',private.co_input_date_v1(p_payload->'received_date',true),'notes',private.co_input_text_v1(p_payload->'notes',true),'lines',p_payload->'lines','bound_customer_version',v::text,'bound_co_version',o.version::text,'bound_delivery_head_id',h.id,'bound_delivery_revision_id',h.current_revision_id,'bound_delivery_version',h.version::text);
  END IF;
  IF (p_payload?'draft_id')<>(p_payload?'expected_draft_version') THEN RAISE EXCEPTION 'Draft binding must be paired' USING ERRCODE='22023'; END IF;
  IF p_payload?'draft_id' THEN
   SELECT * INTO d FROM private.co_drafts WHERE id=private.co_input_uuid_v1(p_payload->'draft_id') AND customer_id=c AND kind=CASE p_operation WHEN 'save_return_draft' THEN 'return' ELSE 'sj' END;
   IF d.id IS NULL OR (p_operation='save_sj_draft' AND (d.co_id IS DISTINCT FROM o.id OR d.payload->>'bound_delivery_head_id' IS DISTINCT FROM h.id::text)) THEN RAISE EXCEPTION 'Invalid source draft' USING ERRCODE='22023'; END IF;
   IF d.version<>private.co_input_version_v1(p_payload->'expected_draft_version') THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
   IF d.payload?'posted_return_head_id' OR d.payload?'posted_delivery_head_id' THEN RAISE EXCEPTION 'Source draft consumed' USING ERRCODE='55000'; END IF;
   before_image:=to_jsonb(d); UPDATE private.co_drafts SET version=version+1,payload=after_image WHERE id=d.id RETURNING * INTO d;
  ELSE INSERT INTO private.co_drafts(customer_id,co_id,kind,payload,created_by) VALUES(c,o.id,CASE p_operation WHEN 'save_return_draft' THEN 'return' ELSE 'sj' END,after_image,actor) RETURNING * INTO d; END IF;
  target:=d.id; target_version:=d.version; after_image:=to_jsonb(d);
 ELSIF p_operation IN('resolve_undelivered','close_co') THEN
  PERFORM private.co_input_object_v1(p_payload,ARRAY['co_id','expected_co_version','expected_customer_version','reason']||CASE WHEN p_operation='resolve_undelivered' THEN ARRAY['lines'] ELSE '{}'::text[] END,ARRAY['co_id','expected_co_version','expected_customer_version','reason']||CASE WHEN p_operation='resolve_undelivered' THEN ARRAY['lines'] ELSE '{}'::text[] END);
  reason:=btrim(private.co_input_text_v1(p_payload->'reason')); IF o.status<>'active' THEN RAISE EXCEPTION 'CO must be active' USING ERRCODE='55000'; END IF; before_image:=private.co_order_snapshot_v1(o.id);
  IF p_operation='resolve_undelivered' THEN
   IF jsonb_typeof(p_payload->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'lines')=0 THEN RAISE EXCEPTION 'Resolution quantities required' USING ERRCODE='22023'; END IF;
   FOR x IN SELECT value FROM jsonb_array_elements(p_payload->'lines') LOOP
    PERFORM private.co_input_object_v1(x,ARRAY['co_line_id','quantity'],ARRAY['co_line_id','quantity']); k:=private.co_input_uuid_v1(x->'co_line_id'); q:=private.co_input_quantity_v1(x->'quantity');
    IF k=ANY(seen) OR NOT EXISTS(SELECT 1 FROM private.co_order_lines WHERE id=k AND co_id=o.id) THEN RAISE EXCEPTION 'Invalid resolution source' USING ERRCODE='22023'; END IF; seen:=array_append(seen,k);
    IF EXISTS(SELECT 1 FROM private.co_order_lines WHERE id=k AND private.co_delivered_line_quantity_v1(k)+resolved_undelivered_quantity+q>ordered_quantity) THEN RAISE EXCEPTION 'CO_RESOLUTION_EXCEEDS_PENDING' USING ERRCODE='23514'; END IF;
    UPDATE private.co_order_lines SET resolved_undelivered_quantity=resolved_undelivered_quantity+q WHERE id=k;
   END LOOP;
  ELSE
   s:=private.co_sources_v1(c); replay:=private.co_replay_v1(s); facts:=private.co_closure_facts_v1(c,o.id,s,replay);
   IF jsonb_array_length(replay->'issues')>0 THEN RAISE EXCEPTION 'CO_INVALID_CHRONOLOGY' USING ERRCODE='23514'; END IF;
   IF NOT private.co_evidence_matches_v1(c,replay) THEN RAISE EXCEPTION 'CO_EFFECTIVE_EVIDENCE_MISMATCH' USING ERRCODE='23514'; END IF;
   IF (facts->>'remaining_quantity')::numeric<>0 THEN RAISE EXCEPTION 'CO_CLOSE_STOCK_REMAINS' USING ERRCODE='23514'; END IF;
   IF (facts->>'pending_quantity')::numeric<>0 THEN RAISE EXCEPTION 'CO_CLOSE_UNDELIVERED_REMAINS' USING ERRCODE='23514'; END IF;
   IF (facts->>'missing_month_count')::numeric<>0 THEN RAISE EXCEPTION 'CO_CLOSE_REPORT_INCOMPLETE' USING ERRCODE='23514'; END IF;
   UPDATE private.co_orders SET status='closed' WHERE id=o.id;
  END IF;
  UPDATE private.co_orders SET version=version+1 WHERE id=o.id RETURNING version INTO target_version;
  UPDATE private.co_customer_state SET version=version+1 WHERE customer_id=c RETURNING version INTO v;
  target:=o.id; after_image:=private.co_order_snapshot_v1(o.id);
 ELSE
  PERFORM private.co_input_text_v1(p_payload->'preview_fingerprint');
  plan:=private.co_build_plan_v1(c,p_operation,p_payload-'preview_fingerprint');
  IF plan->>'preview_fingerprint' IS DISTINCT FROM p_payload->>'preview_fingerprint' THEN RAISE EXCEPTION 'CO_PREVIEW_STALE' USING ERRCODE='PT409'; END IF;
  IF plan->>'can_post'<>'true' THEN RAISE EXCEPTION '%',plan->'impacts'->'issue'->0->>'code' USING ERRCODE='23514'; END IF;
  result:=private.co_publish_reviewed_v1(c,actor,p_request_id,p_operation,plan,reason); RETURN private.co_command_commit_v1(p_request_id,result);
 END IF;
 INSERT INTO private.co_audit_events(customer_id,actor_id,request_id,operation,reason,before_state,after_state) VALUES(c,actor,p_request_id,p_operation,reason,before_image,after_image);
 RETURN private.co_command_commit_v1(p_request_id,jsonb_build_object('id',target,'operation',p_operation,'version',target_version::text,'customer_id',c,'customer_version',v::text));
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Conflicting CO identity' USING ERRCODE='22023';
END $$;

-- Preserve ordinary delivery commands; consume reservations without converting correction drafts.
CREATE OR REPLACE FUNCTION private.co_orders_transaction_v1(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; result jsonb; customer uuid; customer_version bigint; co_id uuid; order_row private.co_orders%ROWTYPE;
 draft_row private.co_drafts%ROWTYPE; draft_id uuid; credit jsonb; before_image jsonb; after_image jsonb; reason text;
 target_id uuid; target_version bigint; head_id uuid; revision_id uuid; creation_order bigint; generation_id uuid;
 line jsonb; source_line private.co_order_lines%ROWTYPE; batch_id uuid; delivery_line_id uuid; today date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
 -- Actor helper locks users before assignments/customer state; every retry is reauthorized.
 actor:=private.co_actor_v1();
 result:=private.co_command_begin_v1(p_request_id,p_operation,p_payload);
 IF result IS NOT NULL THEN RETURN result; END IF;
 IF p_operation='create_co' THEN
  PERFORM private.co_input_object_v1(p_payload,ARRAY['customer_id','expected_customer_version','co_number','order_date','lines'],ARRAY['customer_id','expected_customer_version','co_number','order_date','expected_delivery_date','notes','lines']);
  customer:=private.co_input_uuid_v1(p_payload->'customer_id');
  credit:=private.demo_capture_credit(customer);
  customer_version:=private.co_lock_customer_v1(customer,private.co_input_version_v1(p_payload->'expected_customer_version'));
  INSERT INTO private.co_orders(customer_id,co_number,order_date,expected_delivery_date,notes,created_by,
   sales_person_id_at_creation,sales_assignment_source_id,sales_attributed_at,sales_attribution_state)
  VALUES(customer,btrim(private.co_input_text_v1(p_payload->'co_number')),private.co_input_date_v1(p_payload->'order_date'),private.co_input_date_v1(p_payload->'expected_delivery_date',true),private.co_input_text_v1(p_payload->'notes',true),actor,
   (credit->>'sales_person_id_at_creation')::uuid,(credit->>'sales_assignment_source_id')::uuid,(credit->>'sales_attributed_at')::timestamptz,credit->>'sales_attribution_state') RETURNING id,version INTO co_id,target_version;
  PERFORM private.co_write_order_lines_v1(co_id,customer,p_payload->'lines');
  target_id:=co_id; after_image:=private.co_order_snapshot_v1(co_id);
 ELSIF p_operation IN('edit_co','cancel_co','save_sj_draft','post_sj') THEN
  IF p_operation='post_sj' THEN
   PERFORM private.co_input_object_v1(p_payload,ARRAY['draft_id','expected_draft_version','expected_co_version','expected_customer_version'],ARRAY['draft_id','expected_draft_version','expected_co_version','expected_customer_version']);
   draft_id:=private.co_input_uuid_v1(p_payload->'draft_id');
   SELECT * INTO draft_row FROM private.co_drafts WHERE id=draft_id AND kind='sj';
   co_id:=draft_row.co_id;
  ELSE
   co_id:=private.co_input_uuid_v1(p_payload->'co_id');
  END IF;
  -- Identity reads are hints only; reread every mutable row after the customer lock.
  SELECT customer_id INTO customer FROM private.co_orders WHERE id=co_id;
  IF customer IS NULL THEN RAISE EXCEPTION 'Invalid CO target' USING ERRCODE='22023'; END IF;
  customer_version:=private.co_lock_customer_v1(customer,private.co_input_version_v1(p_payload->'expected_customer_version'));
  SELECT * INTO order_row FROM private.co_orders WHERE id=co_id FOR UPDATE;
  IF order_row.version<>private.co_input_version_v1(p_payload->'expected_co_version') THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
  IF order_row.status<>'active' THEN RAISE EXCEPTION 'CO must be active' USING ERRCODE='55000'; END IF;
  before_image:=private.co_order_snapshot_v1(co_id);
  IF p_operation='edit_co' THEN
   PERFORM private.co_input_object_v1(p_payload,ARRAY['co_id','expected_co_version','expected_customer_version','lines'],ARRAY['co_id','expected_co_version','expected_customer_version','co_number','order_date','expected_delivery_date','notes','lines']);
   PERFORM private.co_write_order_lines_v1(co_id,customer,p_payload->'lines');
   UPDATE private.co_orders SET version=version+1,
    co_number=CASE WHEN p_payload?'co_number' THEN btrim(private.co_input_text_v1(p_payload->'co_number')) ELSE co_number END,
    order_date=CASE WHEN p_payload?'order_date' THEN private.co_input_date_v1(p_payload->'order_date') ELSE order_date END,
    expected_delivery_date=CASE WHEN p_payload?'expected_delivery_date' THEN private.co_input_date_v1(p_payload->'expected_delivery_date',true) ELSE expected_delivery_date END,
    notes=CASE WHEN p_payload?'notes' THEN private.co_input_text_v1(p_payload->'notes',true) ELSE notes END
   WHERE id=co_id RETURNING version INTO target_version;
   target_id:=co_id; after_image:=private.co_order_snapshot_v1(co_id);
  ELSIF p_operation='cancel_co' THEN
   PERFORM private.co_input_object_v1(p_payload,ARRAY['co_id','expected_co_version','expected_customer_version','reason'],ARRAY['co_id','expected_co_version','expected_customer_version','reason']);
   reason:=btrim(private.co_input_text_v1(p_payload->'reason'));
   IF EXISTS(SELECT 1 FROM private.co_delivery_revisions r WHERE r.co_id=order_row.id) THEN
    RAISE EXCEPTION 'CO with posted history must be settled and closed' USING ERRCODE='23514';
   END IF;
   UPDATE private.co_orders SET status='cancelled',version=version+1 WHERE id=co_id RETURNING version INTO target_version;
   target_id:=co_id; after_image:=private.co_order_snapshot_v1(co_id);
  ELSIF p_operation='save_sj_draft' THEN
   PERFORM private.co_input_object_v1(p_payload,ARRAY['co_id','expected_co_version','expected_customer_version','sj_number','sj_date','lines'],ARRAY['co_id','expected_co_version','expected_customer_version','draft_id','expected_draft_version','sj_number','sj_date','received_date','notes','lines']);
   PERFORM private.co_validate_sj_lines_v1(co_id,p_payload->'lines');
   after_image:=jsonb_build_object('sj_number',btrim(private.co_input_text_v1(p_payload->'sj_number')),'sj_date',private.co_input_date_v1(p_payload->'sj_date'),
    'received_date',private.co_input_date_v1(p_payload->'received_date',true),'notes',private.co_input_text_v1(p_payload->'notes',true),'lines',p_payload->'lines',
    'bound_co_version',order_row.version::text,'bound_customer_version',(customer_version+1)::text);
   IF p_payload?'draft_id' THEN
    draft_id:=private.co_input_uuid_v1(p_payload->'draft_id');
    SELECT * INTO draft_row FROM private.co_drafts d WHERE d.id=draft_id AND d.co_id=order_row.id AND d.kind='sj' FOR UPDATE;
    IF draft_row.id IS NULL THEN RAISE EXCEPTION 'Invalid SJ draft target' USING ERRCODE='22023'; END IF;
    IF draft_row.payload?'posted_delivery_head_id' THEN RAISE EXCEPTION 'SJ draft already posted' USING ERRCODE='55000'; END IF;
    IF draft_row.version<>private.co_input_version_v1(p_payload->'expected_draft_version') THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
    IF draft_row.payload?'bound_delivery_head_id' THEN RAISE EXCEPTION 'Correction draft requires correction bindings' USING ERRCODE='22023'; END IF;
    before_image:=to_jsonb(draft_row);
    UPDATE private.co_drafts SET payload=after_image,version=version+1 WHERE id=draft_id RETURNING version INTO target_version;
   ELSE
    IF p_payload?'expected_draft_version' THEN RAISE EXCEPTION 'Draft version requires draft identity' USING ERRCODE='22023'; END IF;
    before_image:=NULL;
    INSERT INTO private.co_drafts(customer_id,kind,co_id,payload,created_by) VALUES(customer,'sj',co_id,after_image,actor) RETURNING id,version INTO draft_id,target_version;
   END IF;
   target_id:=draft_id;
   SELECT to_jsonb(d) INTO after_image FROM private.co_drafts d WHERE d.id=draft_id;
  ELSE
   SELECT * INTO draft_row FROM private.co_drafts d WHERE d.id=draft_id AND d.co_id=order_row.id AND d.kind='sj' FOR UPDATE;
   IF draft_row.id IS NULL THEN RAISE EXCEPTION 'Invalid SJ draft target' USING ERRCODE='22023'; END IF;
   IF draft_row.payload?'posted_delivery_head_id' THEN RAISE EXCEPTION 'SJ draft already posted' USING ERRCODE='55000'; END IF;
   IF draft_row.version<>private.co_input_version_v1(p_payload->'expected_draft_version')
   OR draft_row.payload->>'bound_co_version' IS DISTINCT FROM order_row.version::text
   OR draft_row.payload->>'bound_customer_version' IS DISTINCT FROM customer_version::text THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
   IF private.co_input_date_v1(draft_row.payload->'sj_date')>today
   OR private.co_input_date_v1(draft_row.payload->'received_date',true)>today THEN RAISE EXCEPTION 'Future SJ posting is not allowed' USING ERRCODE='22023'; END IF;
   PERFORM private.co_validate_sj_lines_v1(co_id,draft_row.payload->'lines');
   IF EXISTS(SELECT 1 FROM private.co_delivery_heads h JOIN private.co_delivery_revisions r ON r.id=h.current_revision_id WHERE h.co_id=order_row.id AND r.sj_number=draft_row.payload->>'sj_number') THEN
    RAISE EXCEPTION 'Duplicate CO SJ reference' USING ERRCODE='22023';
   END IF;
   INSERT INTO private.co_delivery_heads(customer_id,co_id,created_by) VALUES(customer,co_id,actor) RETURNING id,original_creation_order INTO head_id,creation_order;
   INSERT INTO private.co_delivery_revisions(head_id,customer_id,co_id,revision_no,sj_number,sj_date,received_date,notes,created_by)
   VALUES(head_id,customer,co_id,1,draft_row.payload->>'sj_number',private.co_input_date_v1(draft_row.payload->'sj_date'),private.co_input_date_v1(draft_row.payload->'received_date',true),draft_row.payload->>'notes',actor) RETURNING id INTO revision_id;
   FOR line IN SELECT value FROM jsonb_array_elements(draft_row.payload->'lines') LOOP
    SELECT * INTO source_line FROM private.co_order_lines WHERE id=private.co_input_uuid_v1(line->'co_line_id');
    batch_id:=coalesce((draft_row.payload->'candidate_batch_ids'->>(source_line.id::text))::uuid,gen_random_uuid()); delivery_line_id:=gen_random_uuid();
    INSERT INTO private.co_stock_batches(id,customer_id,co_id,co_line_id,stock_key_id,delivery_head_id,original_delivery_line_id,original_delivery_created_order,
     unit_price,sales_person_id_at_creation,sales_assignment_source_id,sales_attributed_at,sales_attribution_state)
    VALUES(batch_id,customer,co_id,source_line.id,source_line.stock_key_id,head_id,delivery_line_id,creation_order,
     source_line.unit_price,order_row.sales_person_id_at_creation,order_row.sales_assignment_source_id,order_row.sales_attributed_at,order_row.sales_attribution_state);
    INSERT INTO private.co_delivery_revision_lines(id,revision_id,head_id,customer_id,co_id,co_line_id,stock_key_id,batch_id,quantity)
    VALUES(delivery_line_id,revision_id,head_id,customer,co_id,source_line.id,source_line.stock_key_id,batch_id,private.co_input_quantity_v1(line->'quantity'));
   END LOOP;
   UPDATE private.co_delivery_heads SET current_revision_id=revision_id WHERE id=head_id;
   generation_id:=private.co_build_delivery_generation_v1(customer,customer_version+1,actor,revision_id);
   UPDATE private.co_drafts SET version=version+1,payload=payload||jsonb_build_object('posted_delivery_head_id',head_id) WHERE id=draft_id;
   UPDATE private.co_orders SET version=version+1 WHERE id=co_id;
   target_id:=head_id; target_version:=1;
   before_image:=jsonb_build_object('co',before_image,'draft',to_jsonb(draft_row));
   after_image:=jsonb_build_object('co',private.co_order_snapshot_v1(co_id),'delivery_head_id',head_id,'delivery_revision_id',revision_id,'generation_id',generation_id);
  END IF;
 ELSE
  RAISE EXCEPTION 'CO operation not implemented' USING ERRCODE='22023';
 END IF;
 UPDATE private.co_customer_state SET version=version+1,effective_generation_id=coalesce(generation_id,effective_generation_id)
 WHERE customer_id=customer RETURNING version INTO customer_version;
 INSERT INTO private.co_audit_events(customer_id,actor_id,request_id,operation,reason,before_state,after_state,delivery_revision_id,generation_id)
 VALUES(customer,actor,p_request_id,p_operation,reason,before_image,after_image,revision_id,generation_id);
 result:=jsonb_build_object('id',target_id,'operation',p_operation,'version',target_version::text,'customer_id',customer,'customer_version',customer_version::text);
 RETURN private.co_command_commit_v1(p_request_id,result);
EXCEPTION WHEN unique_violation THEN
 RAISE EXCEPTION 'Conflicting CO identity' USING ERRCODE='22023';
END $$;

DO $$ DECLARE fn regprocedure; BEGIN
 FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname LIKE 'co_%' LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',fn); END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.pilot_co_transaction_v1(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pilot_co_transaction_v1(uuid,text,jsonb) TO authenticated;
COMMIT;
