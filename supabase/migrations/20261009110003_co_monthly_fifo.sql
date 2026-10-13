-- Monthly CO statements: complete stored drafts, one deterministic replay, atomic publication.
BEGIN;
SET LOCAL search_path='';
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
ALTER TABLE private.co_report_revisions ADD COLUMN report_reference text, ADD COLUMN received_date date CHECK(isfinite(received_date)), ADD COLUMN notes text;

CREATE FUNCTION private.co_hash_v1(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT encode(sha256(convert_to(value::text,'UTF8')),'hex');
$$;
CREATE FUNCTION private.co_money_v1(value numeric) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$ SELECT round(value,2)::text; $$;
CREATE FUNCTION private.co_sold_input_v1(value jsonb) RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE q numeric;
BEGIN
 IF value='null'::jsonb THEN RETURN NULL; END IF;
 IF jsonb_typeof(value) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid CO sold quantity' USING ERRCODE='22023'; END IF;
 q:=(value#>>'{}')::numeric;
 IF q<0 OR q>2147483647 OR q<>trunc(q) THEN RAISE EXCEPTION 'Invalid CO sold quantity' USING ERRCODE='22023'; END IF;
 RETURN q::integer;
END $$;

-- Caller serializes the customer. No writes, actor locks, random IDs, or paging here.
CREATE FUNCTION private.co_sources_v1(c uuid) RETURNS jsonb LANGUAGE sql SET search_path='' AS $$
 SELECT jsonb_build_object('customer_version',s.version::text,
 'orders',coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id,'version',o.version::text,'status',o.status) ORDER BY o.id) FROM private.co_orders o WHERE o.customer_id=c),'[]'::jsonb),
 'delivery_heads',coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM private.co_delivery_heads h WHERE h.customer_id=c),'[]'::jsonb),
 'return_heads',coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM private.co_return_heads h WHERE h.customer_id=c),'[]'::jsonb),
 'deliveries',coalesce((SELECT jsonb_agg(jsonb_build_object('batch_id',b.id,'stock_key_id',b.stock_key_id,'co_id',b.co_id,
  'date',r.sj_date,'quantity',l.quantity::text,'line_ref',l.id,'revision_id',r.id,'original_creation_order',b.original_delivery_created_order::text,
  'unit_price',private.co_money_v1(b.unit_price),'sales_person_id_at_creation',b.sales_person_id_at_creation,'sales_assignment_source_id',b.sales_assignment_source_id,
  'sales_attributed_at',b.sales_attributed_at,'sales_attribution_state',b.sales_attribution_state) ORDER BY r.sj_date,b.original_delivery_created_order,b.id)
  FROM private.co_delivery_heads h JOIN private.co_delivery_revisions r ON r.id=h.current_revision_id JOIN private.co_delivery_revision_lines l ON l.revision_id=r.id
  JOIN private.co_stock_batches b ON b.id=l.batch_id WHERE h.customer_id=c AND NOT r.is_void),'[]'::jsonb),
 'returns',coalesce((SELECT jsonb_agg(jsonb_build_object('batch_id',l.batch_id,'stock_key_id',l.stock_key_id,'date',r.return_date,'quantity',l.quantity::text,'line_ref',l.id,'revision_id',r.id) ORDER BY r.return_date,l.id)
  FROM private.co_return_heads h JOIN private.co_return_revisions r ON r.id=h.current_revision_id JOIN private.co_return_revision_lines l ON l.revision_id=r.id WHERE h.customer_id=c AND NOT r.is_void),'[]'::jsonb),
 'reports',coalesce((SELECT jsonb_agg(jsonb_build_object('ref',r.id::text,'head_id',h.id,'head_version',h.version::text,'revision_id',r.id,'month',h.report_month,
  'coverage',r.coverage_through_date,'is_partial_month',r.is_partial_month,'report_reference',r.report_reference,'received_date',r.received_date,'notes',r.notes,
  'lines',coalesce((SELECT jsonb_agg(jsonb_build_object('ref',l.id::text,'stock_key_id',l.stock_key_id,'sold_quantity',l.sold_quantity) ORDER BY l.stock_key_id)
   FROM private.co_report_revision_lines l WHERE l.revision_id=r.id),'[]'::jsonb)) ORDER BY h.report_month,h.id)
  FROM private.co_report_heads h JOIN private.co_report_revisions r ON r.id=h.current_revision_id WHERE h.customer_id=c),'[]'::jsonb))
 FROM private.co_customer_state s WHERE s.customer_id=c;
$$;

-- Shared replay kernel. Every derived quantity comes from these complete source sets.
-- Existing report IDs and candidate draft references are mapped only at materialization.
CREATE FUNCTION private.co_replay_v1(sources jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE state jsonb:='{}'; movements jsonb:='[]'; allocations jsonb:='[]'; eligibility jsonb:='[]'; issues jsonb:='[]';
 e record; row record; b jsonb; r jsonb; line jsonb; key text; batch text; q numeric; available numeric; take numeric; remaining numeric; balance numeric;
BEGIN
 FOR e IN
  SELECT value AS data,(value->>'date')::date AS day,0 AS priority,value->>'batch_id' AS tie FROM jsonb_array_elements(sources->'deliveries')
  UNION ALL SELECT value,(value->>'date')::date,1,value->>'line_ref' FROM jsonb_array_elements(sources->'returns')
  UNION ALL SELECT value,(value->>'coverage')::date,2,value->>'ref' FROM jsonb_array_elements(sources->'reports')
  ORDER BY day,priority,tie
 LOOP
  r:=e.data;
  IF e.priority<2 THEN
   batch:=r->>'batch_id'; balance:=coalesce((state->>batch)::numeric,0); q:=(r->>'quantity')::numeric;
   IF e.priority=1 THEN q:=-q; END IF;
   balance:=balance+q; state:=jsonb_set(state,ARRAY[batch],to_jsonb(balance::text));
   IF balance<0 THEN issues:=issues||jsonb_build_array(jsonb_build_object('code','CO_SOURCE_STOCK_NEGATIVE','stock_key_id',r->>'stock_key_id','batch_id',batch,'date',e.day)); END IF;
   movements:=movements||jsonb_build_array(jsonb_build_object('kind',CASE e.priority WHEN 0 THEN 'delivery' ELSE 'return' END,'batch_id',batch,'stock_key_id',r->>'stock_key_id','quantity_delta',q::text,'effective_date',e.day,'line_ref',r->>'line_ref'));
  ELSE
   -- Positive capacity, period movements, and retained statement rows are all explicit rows.
   FOR row IN
    SELECT k.stock_key_id,coalesce((SELECT sum(coalesce((state->>(x->>'batch_id'))::numeric,0)) FROM jsonb_array_elements(sources->'deliveries') x WHERE x->>'stock_key_id'=k.stock_key_id),0) AS capacity
    FROM (
     SELECT x->>'stock_key_id' AS stock_key_id FROM jsonb_array_elements(sources->'deliveries') x WHERE coalesce((state->>(x->>'batch_id'))::numeric,0)>0
     UNION SELECT x->>'stock_key_id' FROM jsonb_array_elements(movements) x WHERE (x->>'effective_date')::date>=(r->>'month')::date AND (x->>'effective_date')::date<=(r->>'coverage')::date
     UNION SELECT x->>'stock_key_id' FROM jsonb_array_elements(r->'lines') x
    ) k ORDER BY k.stock_key_id
   LOOP
    key:=row.stock_key_id; available:=row.capacity;
    eligibility:=eligibility||jsonb_build_array(jsonb_build_object('report_ref',r->>'ref','report_month',r->>'month','stock_key_id',key,'eligible_quantity',available::text));
    SELECT value INTO line FROM jsonb_array_elements(r->'lines') WHERE value->>'stock_key_id'=key;
    IF line IS NULL OR line->'sold_quantity'='null'::jsonb THEN
     IF NOT coalesce((r->>'probe')::boolean,false) THEN issues:=issues||jsonb_build_array(jsonb_build_object('code','CO_REPORT_INCOMPLETE','report_month',r->>'month','stock_key_id',key)); END IF;
     CONTINUE;
    END IF;
    remaining:=(line->>'sold_quantity')::numeric;
    IF remaining>available THEN issues:=issues||jsonb_build_array(jsonb_build_object('code','CO_SOLD_EXCEEDS_ELIGIBLE','report_month',r->>'month','stock_key_id',key,'sold_quantity',remaining::text,'eligible_quantity',available::text)); END IF;
    FOR b IN SELECT value FROM jsonb_array_elements(sources->'deliveries') WHERE value->>'stock_key_id'=key
     ORDER BY (value->>'date')::date,(value->>'original_creation_order')::bigint,value->>'batch_id'
    LOOP
     EXIT WHEN remaining<=0;
     batch:=b->>'batch_id'; balance:=coalesce((state->>batch)::numeric,0); take:=least(remaining,greatest(balance,0));
     IF take<=0 THEN CONTINUE; END IF;
     state:=jsonb_set(state,ARRAY[batch],to_jsonb((balance-take)::text)); remaining:=remaining-take;
     allocations:=allocations||jsonb_build_array(jsonb_build_object('report_ref',r->>'ref','report_month',r->>'month','line_ref',line->>'ref','stock_key_id',key,'batch_id',batch,
      'quantity',take::text,'unit_price',b->>'unit_price','amount',private.co_money_v1(take*(b->>'unit_price')::numeric),'sales_person_id_at_creation',b->'sales_person_id_at_creation',
      'sales_assignment_source_id',b->'sales_assignment_source_id','sales_attributed_at',b->'sales_attributed_at','sales_attribution_state',b->'sales_attribution_state'));
     movements:=movements||jsonb_build_array(jsonb_build_object('kind','sold','batch_id',batch,'stock_key_id',key,'quantity_delta',(-take)::text,'effective_date',r->>'coverage','report_ref',r->>'ref','line_ref',line->>'ref'));
    END LOOP;
   END LOOP;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('balances',state,'movements',movements,'allocations',allocations,'eligibility',eligibility,'issues',issues);
END $$;

-- One eligibility path for initialization, refresh, save, preview and apply.
CREATE FUNCTION private.co_report_context_v1(c uuid,m date,d uuid DEFAULT NULL,p_sources jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE sources jsonb:=coalesce(p_sources,private.co_sources_v1(c)); original_sources jsonb:=sources; report jsonb; rows jsonb; replay jsonb; eligible jsonb; coverage date;
 today date:=(clock_timestamp() AT TIME ZONE 'UTC')::date; current_report jsonb;
BEGIN
 IF sources IS NULL OR m IS NULL OR extract(day FROM m)<>1 THEN RAISE EXCEPTION 'Invalid CO report target' USING ERRCODE='22023'; END IF;
 coverage:=CASE WHEN m=date_trunc('month',today)::date THEN today ELSE (m+interval '1 month -1 day')::date END;
 SELECT value INTO current_report FROM jsonb_array_elements(sources->'reports') WHERE value->>'month'=m::text;
 SELECT coalesce(jsonb_agg(jsonb_build_object('ref',l.stock_key_id::text,'stock_key_id',l.stock_key_id,'sold_quantity',l.sold_quantity) ORDER BY l.stock_key_id),'[]'::jsonb) INTO rows FROM private.co_report_draft_lines l WHERE l.draft_id=d;
 IF d IS NULL AND current_report IS NOT NULL THEN rows:=current_report->'lines'; END IF;
 report:=jsonb_build_object('ref','probe','month',m,'coverage',coverage,'probe',true,'lines',rows);
 sources:=jsonb_set(sources,'{reports}',coalesce((SELECT jsonb_agg(value ORDER BY value->>'month') FROM jsonb_array_elements(sources->'reports') WHERE value->>'month'<>m::text),'[]'::jsonb)||jsonb_build_array(report));
 replay:=private.co_replay_v1(sources);
 SELECT coalesce(jsonb_agg(value-'report_ref' ORDER BY value->>'stock_key_id'),'[]'::jsonb) INTO eligible FROM jsonb_array_elements(replay->'eligibility') WHERE value->>'report_ref'='probe';
 RETURN jsonb_build_object('coverage_through_date',coverage,'is_partial_month',m=date_trunc('month',today)::date,'eligible_rows',eligible,
 'bound_report_head_id',current_report->'head_id','bound_report_revision_id',current_report->'revision_id',
 'eligible_set_fingerprint',private.co_hash_v1(jsonb_build_object('sources',original_sources,'month',m,'coverage',coverage,'eligible',eligible)));
END $$;

CREATE FUNCTION private.co_plan_summary_v1(replay jsonb,complete boolean) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('sold_quantity',coalesce((SELECT sum((value->>'quantity')::numeric) FROM jsonb_array_elements(replay->'allocations')),0)::text,
 'revenue',private.co_money_v1(coalesce((SELECT sum((value->>'amount')::numeric) FROM jsonb_array_elements(replay->'allocations')),0)),
 'remaining_quantity',coalesce((SELECT sum(value::numeric) FROM jsonb_each_text(replay->'balances')),0)::text,'complete',complete);
$$;

-- Compare semantic allocation evidence, never random ledger row IDs.
CREATE FUNCTION private.co_allocation_signature_v1(replay jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_array(x->>'report_ref',x->>'line_ref',x->>'batch_id',x->>'quantity',x->>'unit_price',x->'sales_person_id_at_creation',x->'sales_assignment_source_id',x->'sales_attributed_at',x->'sales_attribution_state') ORDER BY x->>'report_ref',x->>'line_ref',x->>'batch_id'),'[]'::jsonb)
 FROM jsonb_array_elements(replay->'allocations') x WHERE left(x->>'report_ref',6)<>'draft:';
$$;
CREATE FUNCTION private.co_effective_allocation_signature_v1(c uuid) RETURNS jsonb LANGUAGE sql SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_array(a.report_revision_id::text,a.report_revision_line_id::text,a.batch_id::text,a.quantity::text,private.co_money_v1(a.unit_price),a.sales_person_id_at_creation,a.sales_assignment_source_id,a.sales_attributed_at,a.sales_attribution_state) ORDER BY a.report_revision_id,a.report_revision_line_id,a.batch_id),'[]'::jsonb)
 FROM private.co_sale_allocations a JOIN private.co_customer_state s ON s.effective_generation_id=a.generation_id WHERE s.customer_id=c;
$$;

CREATE FUNCTION private.co_build_plan_v1(p_customer_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE sources jsonb:=private.co_sources_v1(p_customer_id); candidate jsonb; baseline jsonb; replay jsonb; d private.co_drafts%ROWTYPE; context jsonb;
 report jsonb; rows jsonb; issues jsonb; missing jsonb:='[]'; impacts jsonb; stock jsonb; revenue jsonb; credit jsonb; reopen jsonb; counts jsonb; plan jsonb;
 today date:=(clock_timestamp() AT TIME ZONE 'UTC')::date; first_day date; month_day date; month_end date; max_month date; opening numeric; movements bigint; existing jsonb; before_summary jsonb; after_summary jsonb;
BEGIN
 IF sources IS NULL THEN RAISE EXCEPTION 'Invalid CO customer' USING ERRCODE='22023'; END IF;
 candidate:=sources; baseline:=private.co_replay_v1(sources); issues:='[]';
 IF p_operation='post_report' THEN
  PERFORM private.co_input_object_v1(p_payload,ARRAY['draft_id','expected_draft_version','expected_customer_version','eligible_set_fingerprint'],ARRAY['draft_id','expected_draft_version','expected_customer_version','eligible_set_fingerprint']);
  SELECT * INTO d FROM private.co_drafts WHERE id=private.co_input_uuid_v1(p_payload->'draft_id') AND customer_id=p_customer_id AND kind='report';
  IF d.id IS NULL THEN RAISE EXCEPTION 'Invalid CO report draft' USING ERRCODE='22023'; END IF;
  IF d.version<>private.co_input_version_v1(p_payload->'expected_draft_version') OR sources->>'customer_version'<>private.co_input_version_v1(p_payload->'expected_customer_version')::text THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
  context:=private.co_report_context_v1(p_customer_id,d.report_month,d.id);
  IF d.payload->>'bound_customer_version' IS DISTINCT FROM sources->>'customer_version' OR d.eligible_set_fingerprint IS DISTINCT FROM p_payload->>'eligible_set_fingerprint' OR d.eligible_set_fingerprint IS DISTINCT FROM context->>'eligible_set_fingerprint'
   OR d.payload->'bound_report_revision_id' IS DISTINCT FROM context->'bound_report_revision_id' THEN RAISE EXCEPTION 'CO_ELIGIBLE_SET_STALE' USING ERRCODE='PT409'; END IF;
  IF EXISTS(SELECT 1 FROM private.co_report_heads WHERE customer_id=p_customer_id AND report_month=d.report_month AND current_revision_id IS NOT NULL) THEN issues:=issues||jsonb_build_array(jsonb_build_object('code','CO_REPORT_REVISION_REQUIRED','report_month',d.report_month)); END IF;
  IF d.payload?'posted_report_head_id' THEN RAISE EXCEPTION 'CO report draft already posted' USING ERRCODE='55000'; END IF;
  IF d.report_month>date_trunc('month',today)::date THEN issues:=issues||jsonb_build_array(jsonb_build_object('code','CO_FUTURE_REPORT_MONTH','report_month',d.report_month)); END IF;
  IF (d.payload->>'received_date')::date>today THEN issues:=issues||jsonb_build_array(jsonb_build_object('code','CO_FUTURE_RECEIVED_DATE','report_month',d.report_month)); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('ref',l.stock_key_id::text,'stock_key_id',l.stock_key_id,'sold_quantity',l.sold_quantity) ORDER BY l.stock_key_id),'[]'::jsonb) INTO rows FROM private.co_report_draft_lines l WHERE l.draft_id=d.id;
  report:=jsonb_build_object('ref','draft:'||d.id::text,'head_id',context->'bound_report_head_id','revision_id',NULL,'month',d.report_month,'coverage',context->'coverage_through_date','is_partial_month',context->'is_partial_month',
   'report_reference',d.payload->'report_reference','received_date',d.payload->'received_date','notes',d.payload->'notes','lines',rows);
  candidate:=jsonb_set(candidate,'{reports}',coalesce((SELECT jsonb_agg(value ORDER BY value->>'month') FROM jsonb_array_elements(sources->'reports') WHERE value->>'month'<>d.report_month::text),'[]'::jsonb)||jsonb_build_array(report));
 ELSE
  IF p_operation<>'replay' OR p_payload<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid CO planner operation' USING ERRCODE='22023'; END IF;
 END IF;
 replay:=private.co_replay_v1(candidate); issues:=issues||(replay->'issues');
 -- Calendar gaps are required only with opening book stock or actual movements.
 IF d.id IS NOT NULL THEN
  SELECT min((value->>'effective_date')::date) INTO first_day FROM jsonb_array_elements(replay->'movements');
  max_month:=least(d.report_month,date_trunc('month',today)::date);
  FOR month_day IN SELECT x::date FROM generate_series(date_trunc('month',first_day)::date,max_month,interval '1 month') x LOOP
   month_end:=(month_day+interval '1 month -1 day')::date;
   SELECT coalesce(sum((value->>'quantity_delta')::numeric),0) INTO opening FROM jsonb_array_elements(replay->'movements') WHERE (value->>'effective_date')::date<month_day;
   SELECT count(*) INTO movements FROM jsonb_array_elements(replay->'movements') WHERE (value->>'effective_date')::date BETWEEN month_day AND month_end;
   SELECT value INTO existing FROM jsonb_array_elements(sources->'reports') WHERE value->>'month'=month_day::text;
   IF month_day<d.report_month AND (opening>0 OR movements>0 OR existing IS NOT NULL) THEN
    IF existing IS NULL OR (existing->>'coverage')::date<month_end THEN
     missing:=missing||jsonb_build_array(jsonb_build_object('report_month',month_day,'reason',CASE WHEN existing IS NULL THEN 'missing' ELSE 'partial_coverage' END,'head_id',existing->'head_id','coverage_through_date',existing->'coverage'));
     issues:=issues||jsonb_build_array(jsonb_build_object('code',CASE WHEN existing IS NULL THEN 'CO_MISSING_REQUIRED_MONTH' ELSE 'CO_PARTIAL_MONTH_INCOMPLETE' END,'report_month',month_day));
    END IF;
   END IF;
  END LOOP;
 END IF;
 IF d.id IS NOT NULL AND private.co_allocation_signature_v1(replay) IS DISTINCT FROM private.co_effective_allocation_signature_v1(p_customer_id) THEN
  issues:=issues||jsonb_build_array(jsonb_build_object('code','CO_REVIEWED_CORRECTION_REQUIRED'));
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('co_id',o->>'id','remaining_quantity',q::text) ORDER BY o->>'id'),'[]'::jsonb) INTO reopen FROM
 (SELECT o,coalesce((SELECT sum(coalesce((replay->'balances'->>(b->>'batch_id'))::numeric,0)) FROM jsonb_array_elements(sources->'deliveries') b WHERE b->>'co_id'=o->>'id'),0) q FROM jsonb_array_elements(sources->'orders') o WHERE o->>'status'='closed') x WHERE q>0;
 SELECT issues||coalesce(jsonb_agg(jsonb_build_object('code','CO_REOPEN_REQUIRED','co_id',value->>'co_id')),'[]'::jsonb) INTO issues FROM jsonb_array_elements(reopen);
 SELECT coalesce(jsonb_agg(jsonb_build_object('stock_key_id',b->>'stock_key_id','batch_id',b->>'batch_id','before_quantity',coalesce(baseline->'balances'->>(b->>'batch_id'),'0'),'after_quantity',coalesce(replay->'balances'->>(b->>'batch_id'),'0')) ORDER BY b->>'stock_key_id',b->>'batch_id'),'[]'::jsonb) INTO stock
 FROM jsonb_array_elements(sources->'deliveries') b WHERE baseline->'balances'->>(b->>'batch_id') IS DISTINCT FROM replay->'balances'->>(b->>'batch_id');
 SELECT coalesce(jsonb_agg(jsonb_build_object('report_month',m,'before_amount',private.co_money_v1(before_amount),'after_amount',private.co_money_v1(after_amount)) ORDER BY m),'[]'::jsonb) INTO revenue FROM
 (SELECT m,coalesce((SELECT sum((x->>'amount')::numeric) FROM jsonb_array_elements(baseline->'allocations') x WHERE x->>'report_month'=m),0) before_amount,
 coalesce((SELECT sum((x->>'amount')::numeric) FROM jsonb_array_elements(replay->'allocations') x WHERE x->>'report_month'=m),0) after_amount FROM (SELECT value->>'month' m FROM jsonb_array_elements(candidate->'reports')) months) x WHERE before_amount<>after_amount;
 SELECT coalesce(jsonb_agg(jsonb_build_object('report_month',m,'sales_person_id_at_creation',person,'before_amount',private.co_money_v1(before_amount),'after_amount',private.co_money_v1(after_amount)) ORDER BY m,person NULLS FIRST),'[]'::jsonb) INTO credit FROM
 (SELECT m,person,coalesce((SELECT sum((x->>'amount')::numeric) FROM jsonb_array_elements(baseline->'allocations') x WHERE x->>'report_month'=m AND x->>'sales_person_id_at_creation' IS NOT DISTINCT FROM person),0) before_amount,
 coalesce((SELECT sum((x->>'amount')::numeric) FROM jsonb_array_elements(replay->'allocations') x WHERE x->>'report_month'=m AND x->>'sales_person_id_at_creation' IS NOT DISTINCT FROM person),0) after_amount
 FROM (SELECT x->>'report_month' m,x->>'sales_person_id_at_creation' person FROM jsonb_array_elements((baseline->'allocations')||(replay->'allocations')) x GROUP BY 1,2) keys) x WHERE before_amount<>after_amount;
 impacts:=jsonb_build_object('report',CASE WHEN report IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(report-'lines'||jsonb_build_object('row_count',jsonb_array_length(rows)::text,
 'before_sold_quantity',coalesce((SELECT sum((l->>'sold_quantity')::numeric) FROM jsonb_array_elements(sources->'reports') old CROSS JOIN LATERAL jsonb_array_elements(old->'lines') l WHERE old->>'month'=report->>'month'),0)::text,
 'after_sold_quantity',coalesce((SELECT sum((l->>'sold_quantity')::numeric) FROM jsonb_array_elements(rows) l),0)::text,
 'before_revenue',private.co_money_v1(coalesce((SELECT sum((a->>'amount')::numeric) FROM jsonb_array_elements(baseline->'allocations') a WHERE a->>'report_month'=report->>'month'),0)),
 'after_revenue',private.co_money_v1(coalesce((SELECT sum((a->>'amount')::numeric) FROM jsonb_array_elements(replay->'allocations') a WHERE a->>'report_month'=report->>'month'),0)),
 'complete',NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rows) l WHERE l->'sold_quantity'='null'::jsonb))) END,'stock',stock,'revenue',revenue,'credit',credit,'reopen',reopen,'issue',issues,'missing_month',missing);
 SELECT jsonb_object_agg(key,jsonb_array_length(value)::text) INTO counts FROM jsonb_each(impacts);
 before_summary:=private.co_plan_summary_v1(baseline,jsonb_array_length(baseline->'issues')=0); after_summary:=private.co_plan_summary_v1(replay,jsonb_array_length(issues)=0);
 plan:=jsonb_build_object('algorithm_version','co-monthly-fifo-v1','operation',p_operation,'customer_id',p_customer_id,'customer_version',sources->>'customer_version','draft_version',d.version::text,
 'can_post',jsonb_array_length(issues)=0,'before',before_summary,'after',after_summary,'counts',counts,'impacts',impacts,'candidate_report',report,'replay',replay,'eligible_set_fingerprint',context->'eligible_set_fingerprint');
 RETURN plan||jsonb_build_object('preview_fingerprint',private.co_hash_v1(jsonb_build_object('actor',auth.uid(),'payload',p_payload,'sources',sources,'draft',CASE WHEN d.id IS NULL THEN NULL ELSE to_jsonb(d) END,'plan',plan)));
END $$;

-- Persistence translates semantic candidate refs to the immutable IDs just assembled.
CREATE FUNCTION private.co_materialize_generation_v1(c uuid,next_version bigint,actor uuid,plan jsonb,new_report_revision uuid DEFAULT NULL,new_line_ids jsonb DEFAULT '{}'::jsonb) RETURNS uuid
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE g uuid; x jsonb; line_id uuid; report_id uuid;
BEGIN
 IF actor IS DISTINCT FROM private.co_actor_v1() OR plan->>'customer_id' IS DISTINCT FROM c::text OR plan->>'can_post'<>'true'
 OR NOT EXISTS(SELECT 1 FROM private.co_customer_state WHERE customer_id=c AND version+1=next_version) THEN RAISE EXCEPTION 'Invalid CO materialization context' USING ERRCODE='22023'; END IF;
 INSERT INTO private.co_replay_generations(customer_id,version,algorithm_version,created_by) VALUES(c,next_version,plan->>'algorithm_version',actor) RETURNING id INTO g;
 FOR x IN SELECT value FROM jsonb_array_elements(plan->'replay'->'movements') LOOP
  line_id:=CASE WHEN left(x->>'report_ref',6)='draft:' THEN (new_line_ids->>(x->>'stock_key_id'))::uuid ELSE (x->>'line_ref')::uuid END;
  INSERT INTO private.co_stock_movements(generation_id,customer_id,batch_id,stock_key_id,kind,quantity_delta,effective_date,delivery_revision_line_id,return_revision_line_id,report_revision_line_id)
  VALUES(g,c,(x->>'batch_id')::uuid,(x->>'stock_key_id')::uuid,x->>'kind',(x->>'quantity_delta')::numeric,(x->>'effective_date')::date,
   CASE WHEN x->>'kind'='delivery' THEN line_id END,CASE WHEN x->>'kind'='return' THEN line_id END,CASE WHEN x->>'kind'='sold' THEN line_id END);
 END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(plan->'replay'->'allocations') LOOP
  IF left(x->>'report_ref',6)='draft:' THEN line_id:=(new_line_ids->>(x->>'stock_key_id'))::uuid; report_id:=new_report_revision;
  ELSE line_id:=(x->>'line_ref')::uuid; report_id:=(x->>'report_ref')::uuid; END IF;
  INSERT INTO private.co_sale_allocations(generation_id,customer_id,report_revision_id,report_revision_line_id,batch_id,stock_key_id,quantity,unit_price,
   sales_person_id_at_creation,sales_assignment_source_id,sales_attributed_at,sales_attribution_state)
  VALUES(g,c,report_id,line_id,(x->>'batch_id')::uuid,(x->>'stock_key_id')::uuid,(x->>'quantity')::integer,(x->>'unit_price')::numeric,
   (x->>'sales_person_id_at_creation')::uuid,(x->>'sales_assignment_source_id')::uuid,(x->>'sales_attributed_at')::timestamptz,x->>'sales_attribution_state');
 END LOOP;
 RETURN g;
END $$;

CREATE OR REPLACE FUNCTION private.co_build_delivery_generation_v1(p_customer_id uuid,p_next_customer_version bigint,p_actor_id uuid,p_new_delivery_revision_id uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE plan jsonb; day date; old_allocations jsonb; new_allocations jsonb;
BEGIN
 SELECT r.sj_date INTO day FROM private.co_delivery_heads h JOIN private.co_delivery_revisions r ON r.id=h.current_revision_id WHERE h.customer_id=p_customer_id AND r.id=p_new_delivery_revision_id;
 IF day IS NULL OR NOT EXISTS(SELECT 1 FROM private.co_customer_state WHERE customer_id=p_customer_id AND version+1=p_next_customer_version) OR p_actor_id IS DISTINCT FROM private.co_actor_v1() THEN RAISE EXCEPTION 'Invalid CO generation context' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM private.co_report_heads h JOIN private.co_report_revisions r ON r.id=h.current_revision_id WHERE h.customer_id=p_customer_id AND day<=r.coverage_through_date) THEN
  RAISE EXCEPTION 'CO_REVIEWED_CORRECTION_REQUIRED' USING ERRCODE='23514';
 END IF;
 plan:=private.co_build_plan_v1(p_customer_id,'replay','{}');
 IF plan->>'can_post'<>'true' THEN RAISE EXCEPTION 'CO_REVIEWED_CORRECTION_REQUIRED' USING ERRCODE='23514'; END IF;
 old_allocations:=private.co_effective_allocation_signature_v1(p_customer_id);
 new_allocations:=private.co_allocation_signature_v1(plan->'replay');
 IF old_allocations<>new_allocations THEN RAISE EXCEPTION 'CO_REVIEWED_CORRECTION_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN private.co_materialize_generation_v1(p_customer_id,p_next_customer_version,p_actor_id,plan);
END $$;

CREATE FUNCTION private.co_preview_plan_v1(operation text,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE c uuid; v bigint;
BEGIN
 PERFORM private.co_actor_v1();
 IF operation<>'post_report' THEN RAISE EXCEPTION 'Invalid CO preview operation' USING ERRCODE='22023'; END IF;
 SELECT customer_id INTO c FROM private.co_drafts WHERE id=private.co_input_uuid_v1(co_preview_plan_v1.payload->'draft_id') AND kind='report';
 IF c IS NULL THEN RAISE EXCEPTION 'Invalid CO report draft' USING ERRCODE='22023'; END IF;
 -- All CO and draft writers acquire UPDATE on this row first. This shared lock
 -- keeps all later source/draft reads consistent without creating state or evidence.
 SELECT version INTO v FROM private.co_customer_state WHERE customer_id=c FOR SHARE;
 RETURN private.co_build_plan_v1(c,operation,payload);
END $$;
CREATE FUNCTION private.co_preview_header_v1(plan jsonb) RETURNS jsonb LANGUAGE sql SET search_path='' AS $$
 SELECT jsonb_build_object('version','1','as_of',clock_timestamp(),'operation',plan->'operation','customer_id',plan->'customer_id','customer_version',plan->'customer_version','draft_version',plan->'draft_version',
 'preview_fingerprint',plan->'preview_fingerprint','can_post',plan->'can_post','before',plan->'before','after',plan->'after','counts',plan->'counts');
$$;
CREATE FUNCTION public.pilot_co_preview_v1(p_operation text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RETURN private.co_preview_header_v1(private.co_preview_plan_v1(p_operation,p_payload)); END $$;
CREATE FUNCTION public.pilot_co_preview_impacts_v1(p_operation text,p_payload jsonb,p_preview_fingerprint text,p_kind text,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE plan jsonb; rows jsonb;
BEGIN
 plan:=private.co_preview_plan_v1(p_operation,p_payload);
 IF p_kind IS NULL OR p_kind NOT IN('report','stock','revenue','credit','reopen','issue','missing_month') OR p_page IS NULL OR p_page<1 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid CO preview page' USING ERRCODE='22023'; END IF;
 IF p_preview_fingerprint IS DISTINCT FROM plan->>'preview_fingerprint' THEN RAISE EXCEPTION 'CO_PREVIEW_STALE' USING ERRCODE='PT409'; END IF;
 SELECT coalesce(jsonb_agg(value ORDER BY ordinal),'[]'::jsonb) INTO rows FROM (SELECT value,ordinal FROM jsonb_array_elements(plan->'impacts'->p_kind) WITH ORDINALITY a(value,ordinal) ORDER BY ordinal LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size)x;
 RETURN jsonb_build_object('version','1','as_of',clock_timestamp(),'preview_fingerprint',p_preview_fingerprint,'kind',p_kind,'page',p_page,'page_size',p_page_size,'total',plan->'counts'->p_kind,'rows',rows);
END $$;

-- Retain Task 2 behavior without a second command envelope or copied dispatcher.
ALTER FUNCTION public.pilot_co_transaction_v1(uuid,text,jsonb) SET SCHEMA private;
ALTER FUNCTION private.pilot_co_transaction_v1(uuid,text,jsonb) RENAME TO co_orders_transaction_v1;
REVOKE ALL ON FUNCTION private.co_orders_transaction_v1(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.pilot_co_transaction_v1(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; result jsonb; action text; c uuid; v bigint; d private.co_drafts%ROWTYPE; did uuid; m date; context jsonb; old_image jsonb; new_image jsonb;
 x jsonb; k uuid; quantity integer; seen uuid[]:='{}'; metadata_key text; plan jsonb; head uuid; revision uuid; line_id uuid; line_ids jsonb:='{}'; g uuid; target uuid; target_version bigint;
BEGIN
 IF p_operation NOT IN('save_report_draft','post_report') THEN RETURN private.co_orders_transaction_v1(p_request_id,p_operation,p_payload); END IF;
 actor:=private.co_actor_v1(); result:=private.co_command_begin_v1(p_request_id,p_operation,p_payload); IF result IS NOT NULL THEN RETURN result; END IF;
 IF p_operation='save_report_draft' THEN action:=private.co_input_text_v1(p_payload->'action'); END IF;
 IF action='initialize' THEN
  PERFORM private.co_input_object_v1(p_payload,ARRAY['action','customer_id','report_month','expected_customer_version'],ARRAY['action','customer_id','report_month','expected_customer_version','draft_id','expected_draft_version','report_reference','received_date','notes']);
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
  context:=private.co_report_context_v1(c,m,d.id);
  new_image:=coalesce(d.payload,'{}')-ARRAY['posted_report_head_id','posted_report_revision_id'];
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

DO $$ DECLARE fn regprocedure; BEGIN
 FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname IN(
 'co_allocation_signature_v1','co_effective_allocation_signature_v1','co_hash_v1','co_money_v1','co_sold_input_v1','co_sources_v1','co_replay_v1','co_report_context_v1','co_plan_summary_v1','co_build_plan_v1','co_materialize_generation_v1','co_preview_plan_v1','co_preview_header_v1') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',fn); END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.pilot_co_transaction_v1(uuid,text,jsonb),public.pilot_co_preview_v1(text,jsonb),public.pilot_co_preview_impacts_v1(text,jsonb,text,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pilot_co_transaction_v1(uuid,text,jsonb),public.pilot_co_preview_v1(text,jsonb),public.pilot_co_preview_impacts_v1(text,jsonb,text,text,integer,integer) TO authenticated;
COMMIT;
