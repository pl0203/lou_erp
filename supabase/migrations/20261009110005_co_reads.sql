-- Checked, bounded CO read surfaces. No table grants or existing business contents change.
BEGIN;
SET LOCAL search_path='';
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
CREATE FUNCTION private.co_read_actor_v1() RETURNS void LANGUAGE plpgsql STABLE SET search_path='' AS $$
BEGIN IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND is_active AND role IN('co_admin','executive')) THEN RAISE EXCEPTION 'CO authority required' USING ERRCODE='42501'; END IF; END $$;
CREATE FUNCTION private.co_read_customer_v1(c uuid,expected text DEFAULT NULL) RETURNS text LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE v text;
BEGIN PERFORM private.co_read_actor_v1();IF c IS NULL OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=c) THEN RAISE EXCEPTION 'Invalid CO customer' USING ERRCODE='22023'; END IF;
 SELECT coalesce((SELECT version::text FROM private.co_customer_state WHERE customer_id=c),'1') INTO v;
 IF expected IS NOT NULL THEN PERFORM private.co_input_version_v1(to_jsonb(expected));IF expected<>v THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;END IF;RETURN v;END $$;
-- Planner-backed reads share the existing serialization order but never initialize state.
CREATE FUNCTION private.co_read_lock_v1(c uuid,expected text DEFAULT NULL) RETURNS text LANGUAGE plpgsql SET search_path='' AS $$
BEGIN PERFORM private.co_actor_v1();PERFORM 1 FROM private.co_customer_state WHERE customer_id=c FOR SHARE;RETURN private.co_read_customer_v1(c,expected);END $$;
CREATE FUNCTION private.co_read_page_v1(rows jsonb,p integer,s integer,extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE items jsonb;
BEGIN IF p IS NULL OR p<1 OR s IS NULL OR s NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid CO page' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(value ORDER BY ordinal),'[]') INTO items FROM (SELECT value,ordinal FROM jsonb_array_elements(rows) WITH ORDINALITY x(value,ordinal) ORDER BY ordinal LIMIT s OFFSET (p::bigint-1)*s)q;
 RETURN jsonb_build_object('version','1','as_of',statement_timestamp(),'total',jsonb_array_length(rows)::text,'page',p,'page_size',s,'rows',items)||extra;END $$;
CREATE FUNCTION private.co_read_date_v1(d date) RETURNS void LANGUAGE plpgsql STABLE SET search_path='' AS $$
BEGIN IF d IS NOT NULL AND (NOT isfinite(d) OR d>(statement_timestamp() AT TIME ZONE 'UTC')::date OR d<>(date_trunc('month',d)+interval '1 month' - interval '1 day')::date) THEN RAISE EXCEPTION 'CO history requires completed calendar month end' USING ERRCODE='22023';END IF;END $$;
CREATE FUNCTION private.co_read_month_v1(m text) RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE d date:=private.co_input_date_v1(to_jsonb(m));BEGIN IF extract(day FROM d)<>1 THEN RAISE EXCEPTION 'Invalid CO month' USING ERRCODE='22023';END IF;RETURN d;END $$;
-- Customer-report freshness is derived from effective recorded history at the cutoff.
-- The shared required-month helper skips settled gaps and requires final month-end coverage.
CREATE FUNCTION private.co_read_freshness_v1(c uuid,cutoff date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE
 boundary date:=coalesce(cutoff,(statement_timestamp() AT TIME ZONE 'UTC')::date);
 current_month date:=date_trunc('month',boundary)::date;
 reports jsonb; movements jsonb; pending jsonb; next_report jsonb;
 next_month date; next_ending date; overdue_count bigint; closing_quantity numeric;
 latest_month date; latest_coverage date; freshness_status text;
BEGIN
 SELECT coalesce(jsonb_agg(jsonb_build_object('month',h.report_month,'coverage',r.coverage_through_date,'head_id',h.id) ORDER BY h.report_month),'[]'),
        max(h.report_month),max(r.coverage_through_date)
 INTO reports,latest_month,latest_coverage
 FROM private.co_report_heads h
 JOIN private.co_report_revisions r ON r.id=h.current_revision_id
 WHERE h.customer_id=c AND r.coverage_through_date<=boundary;

 SELECT coalesce(jsonb_agg(jsonb_build_object('effective_date',m.effective_date,'quantity_delta',m.quantity_delta::text) ORDER BY m.effective_date,m.id),'[]'),
        coalesce(sum(m.quantity_delta),0)
 INTO movements,closing_quantity
 FROM private.co_stock_movements m
 JOIN private.co_customer_state cs ON cs.effective_generation_id=m.generation_id
 WHERE cs.customer_id=c AND m.effective_date<=boundary;

 pending:=private.co_required_months_v1(jsonb_build_object('reports',reports),jsonb_build_object('movements',movements),current_month,true);
 next_report:=pending->0;
 next_month:=(next_report->>'report_month')::date;
 next_ending:=(next_month+interval '1 month -1 day')::date;
 SELECT count(*) INTO overdue_count FROM jsonb_array_elements(pending) x
 WHERE ((x->>'report_month')::date+interval '1 month -1 day')::date<=boundary;

 IF jsonb_array_length(pending)=0 THEN
  freshness_status:=CASE WHEN jsonb_array_length(movements)=0 AND jsonb_array_length(reports)=0 THEN 'no_recorded_activity' ELSE 'complete' END;
 ELSIF overdue_count>0 THEN
  freshness_status:='missing_completed_period';
 ELSIF next_report->>'reason'='partial_coverage' THEN
  freshness_status:='current_partial';
 ELSE
  freshness_status:='current_unreported';
 END IF;
 RETURN jsonb_build_object(
  'last_report_month',latest_month,'coverage_through_date',latest_coverage,
  'reporting_freshness',jsonb_build_object(
   'cutoff_date',boundary,'next_required_report_month',next_month,
   'pending_report_month_count',jsonb_array_length(pending)::text,
   'overdue_report_month_count',overdue_count::text,'next_required_month_end',next_ending,
   'days_since_pending_month_end',CASE WHEN next_month IS NULL THEN NULL ELSE greatest(0,boundary-next_ending)::text END,
   'status',freshness_status,'zero_stock_reporting_pending',closing_quantity=0 AND jsonb_array_length(pending)>0));
END $$;
CREATE FUNCTION private.co_read_order_summary_v1(o uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 WITH l AS (SELECT coalesce(sum(ordered_quantity::numeric),0) ordered,coalesce(sum(resolved_undelivered_quantity::numeric),0) resolved,coalesce(sum(ordered_quantity::numeric*unit_price),0) planned FROM private.co_order_lines WHERE co_id=o),
 d AS (SELECT coalesce(sum(x.quantity::numeric),0) delivered FROM private.co_delivery_heads h JOIN private.co_delivery_revisions r ON r.id=h.current_revision_id JOIN private.co_delivery_revision_lines x ON x.revision_id=r.id WHERE h.co_id=o AND NOT r.is_void),
 m AS (SELECT coalesce(sum(x.quantity_delta),0) remaining,-coalesce(sum(x.quantity_delta) FILTER(WHERE x.kind='return'),0) returned FROM private.co_stock_movements x JOIN private.co_customer_state s ON s.effective_generation_id=x.generation_id JOIN private.co_stock_batches b ON b.id=x.batch_id WHERE b.co_id=o),
 a AS (SELECT coalesce(sum(x.quantity::numeric),0) sold,coalesce(sum(x.amount),0) revenue FROM private.co_sale_allocations x JOIN private.co_customer_state s ON s.effective_generation_id=x.generation_id JOIN private.co_stock_batches b ON b.id=x.batch_id WHERE b.co_id=o)
 SELECT jsonb_build_object('ordered_quantity',ordered::text,'resolved_undelivered_quantity',resolved::text,'delivered_quantity',delivered::text,'pending_quantity',(ordered-resolved-delivered)::text,'delivery_progress',CASE WHEN delivered+resolved=ordered THEN 'complete' WHEN delivered=0 THEN 'not_started' ELSE 'partial' END,'planned_value',private.co_money_v1(planned),'sold_quantity',sold::text,'revenue',private.co_money_v1(revenue),'returned_quantity',returned::text,'remaining_quantity',remaining::text) FROM l,d,m,a;$$;
CREATE FUNCTION private.co_read_order_v1(o uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',x.id,'customer_id',x.customer_id,'customer_name',c.name,'co_number',x.co_number,'status',x.status,'order_date',x.order_date,'expected_delivery_date',x.expected_delivery_date,'notes',x.notes,'co_version',x.version::text,'customer_version',s.version::text,'generation_id',s.effective_generation_id,'sales_person_name',(SELECT full_name FROM public.users WHERE id=x.sales_person_id_at_creation),'sales_person_id_at_creation',x.sales_person_id_at_creation,'sales_assignment_source_id',x.sales_assignment_source_id,'sales_attributed_at',x.sales_attributed_at,'sales_attribution_state',x.sales_attribution_state,'summary',private.co_read_order_summary_v1(x.id))||private.co_read_freshness_v1(x.customer_id) FROM private.co_orders x JOIN public.customers c ON c.id=x.customer_id JOIN private.co_customer_state s ON s.customer_id=x.customer_id WHERE x.id=o;$$;
CREATE FUNCTION public.pilot_co_page_v1(p_status text,p_search text,p_page integer,p_page_size integer,p_customer_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rows jsonb;summary jsonb;
BEGIN PERFORM private.co_read_actor_v1();IF p_status IS NULL OR p_status NOT IN('all','active','closed','cancelled') OR p_search IS NULL THEN RAISE EXCEPTION 'Invalid CO filter' USING ERRCODE='22023';END IF;IF p_customer_id IS NOT NULL THEN PERFORM private.co_read_customer_v1(p_customer_id);END IF;
 SELECT coalesce(jsonb_agg(private.co_read_order_v1(o.id) ORDER BY o.created_at DESC,o.id),'[]') INTO rows FROM private.co_orders o JOIN public.customers c ON c.id=o.customer_id WHERE (p_status='all' OR o.status=p_status) AND (p_customer_id IS NULL OR o.customer_id=p_customer_id) AND (btrim(p_search)='' OR strpos(lower(o.co_number),lower(btrim(p_search)))>0 OR strpos(lower(c.name),lower(btrim(p_search)))>0);
 SELECT jsonb_build_object('order_count',count(*)::text,'planned_value',private.co_money_v1(coalesce(sum((value->'summary'->>'planned_value')::numeric),0)),'revenue',private.co_money_v1(coalesce(sum((value->'summary'->>'revenue')::numeric),0)),'remaining_quantity',coalesce(sum((value->'summary'->>'remaining_quantity')::numeric),0)::text) INTO summary FROM jsonb_array_elements(rows);
 RETURN private.co_read_page_v1(rows,p_page,p_page_size,jsonb_build_object('customer_id',p_customer_id,'summary',summary));END $$;
CREATE FUNCTION public.pilot_co_detail_v1(p_co_id uuid,p_expected_version text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o private.co_orders%ROWTYPE;c text;s jsonb;r jsonb;f jsonb;ops jsonb:='[]';history boolean;
BEGIN PERFORM private.co_read_actor_v1();SELECT * INTO o FROM private.co_orders WHERE id=p_co_id;IF o.id IS NULL THEN RAISE EXCEPTION 'Invalid CO identity' USING ERRCODE='22023';END IF;c:=private.co_read_lock_v1(o.customer_id);SELECT * INTO o FROM private.co_orders WHERE id=p_co_id;
 IF p_expected_version IS NOT NULL THEN PERFORM private.co_input_version_v1(to_jsonb(p_expected_version));IF p_expected_version<>o.version::text THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409';END IF;END IF;
 s:=private.co_sources_v1(o.customer_id);r:=private.co_replay_v1(s);IF NOT private.co_evidence_matches_v1(o.customer_id,r) THEN RAISE EXCEPTION 'CO_EFFECTIVE_EVIDENCE_MISMATCH' USING ERRCODE='23514';END IF;f:=private.co_closure_facts_v1(o.customer_id,o.id,s,r);
 history:=EXISTS(SELECT 1 FROM private.co_delivery_heads WHERE co_id=o.id);
 IF o.status='active' THEN ops:='["edit_co","save_sj_draft","post_sj","save_report_draft"]';IF NOT history THEN ops:=ops||'"cancel_co"'::jsonb;END IF;IF (f->>'pending_quantity')::numeric>0 THEN ops:=ops||'"resolve_undelivered"'::jsonb;END IF;IF (f->>'remaining_quantity')::numeric>0 THEN ops:=ops||'"save_return_draft"'::jsonb;END IF;IF f->>'pending_quantity'='0' AND f->>'remaining_quantity'='0' AND f->>'missing_month_count'='0' THEN ops:=ops||'"close_co"'::jsonb;END IF;END IF;
 -- Existing reviewed source mutation supports active or closed orders, never cancelled.
 -- correct_sj also governs bound correction-draft preparation; it is not ordinary save_sj_draft.
 IF o.status<>'cancelled' AND history THEN ops:=ops||'"correct_sj"'::jsonb;END IF;
 RETURN jsonb_build_object('version','1','as_of',statement_timestamp(),'co',private.co_read_order_v1(o.id),'allowed_operations',ops,'close_blockers',jsonb_build_object('stock_remains',(f->>'remaining_quantity')::numeric<>0,'undelivered_remains',(f->>'pending_quantity')::numeric<>0,'missing_month_count',f->>'missing_month_count'));END $$;
CREATE FUNCTION private.co_read_batches_v1(c uuid,k uuid DEFAULT NULL,o uuid DEFAULT NULL) RETURNS SETOF jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',b.id,'customer_id',b.customer_id,'co_id',b.co_id,'co_number',x.co_number,'co_line_id',b.co_line_id,'stock_key_id',b.stock_key_id,'delivery_head_id',h.id,'delivery_revision_id',r.id,'sj_number',r.sj_number,'sj_date',r.sj_date,'display_sku',s.display_sku,'product_name',s.product_name,'available_quantity',v.quantity::text,'unit_price',private.co_money_v1(b.unit_price),'sales_person_name',(SELECT full_name FROM public.users WHERE id=b.sales_person_id_at_creation),'sales_person_id_at_creation',b.sales_person_id_at_creation,'sales_assignment_source_id',b.sales_assignment_source_id,'sales_attributed_at',b.sales_attributed_at,'sales_attribution_state',b.sales_attribution_state)
 FROM private.co_stock_batches b JOIN private.co_orders x ON x.id=b.co_id JOIN private.co_stock_keys s ON s.id=b.stock_key_id JOIN private.co_delivery_heads h ON h.id=b.delivery_head_id JOIN private.co_delivery_revisions r ON r.id=h.current_revision_id
 CROSS JOIN LATERAL(SELECT coalesce(sum(m.quantity_delta),0) quantity FROM private.co_stock_movements m JOIN private.co_customer_state cs ON cs.effective_generation_id=m.generation_id WHERE m.batch_id=b.id)v
 WHERE b.customer_id=c AND (k IS NULL OR b.stock_key_id=k) AND (o IS NULL OR b.co_id=o) AND v.quantity>0 ORDER BY r.sj_date,b.original_delivery_created_order,b.id;$$;
CREATE FUNCTION public.pilot_co_customer_batches_v1(p_customer_id uuid,p_stock_key_id uuid,p_expected_customer_version text,p_page integer,p_page_size integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v text;rows jsonb;BEGIN IF p_expected_customer_version IS NULL THEN RAISE EXCEPTION 'Customer version required' USING ERRCODE='22023';END IF;v:=private.co_read_customer_v1(p_customer_id,p_expected_customer_version);IF p_stock_key_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private.co_stock_keys WHERE id=p_stock_key_id AND customer_id=p_customer_id) THEN RAISE EXCEPTION 'Invalid CO stock key' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(x),'[]') INTO rows FROM private.co_read_batches_v1(p_customer_id,p_stock_key_id)x;RETURN private.co_read_page_v1(rows,p_page,p_page_size,jsonb_build_object('customer_id',p_customer_id,'customer_version',v,'generation_id',(SELECT effective_generation_id FROM private.co_customer_state WHERE customer_id=p_customer_id),'stock_key_id',p_stock_key_id));END $$;
CREATE FUNCTION public.pilot_co_customer_stock_v1(p_customer_id uuid,p_as_of date,p_search text,p_expected_customer_version text,p_page integer,p_page_size integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v text;g uuid;rows jsonb;summary jsonb;cutoff date:=coalesce(p_as_of,(statement_timestamp() AT TIME ZONE 'UTC')::date);month_start date:=date_trunc('month',coalesce(p_as_of,(statement_timestamp() AT TIME ZONE 'UTC')::date))::date;
BEGIN PERFORM private.co_read_actor_v1();PERFORM private.co_read_date_v1(p_as_of);IF p_search IS NULL OR (p_expected_customer_version IS NOT NULL AND p_customer_id IS NULL) THEN RAISE EXCEPTION 'Invalid stock filter' USING ERRCODE='22023';END IF;IF p_customer_id IS NOT NULL THEN v:=private.co_read_customer_v1(p_customer_id,p_expected_customer_version);SELECT effective_generation_id INTO g FROM private.co_customer_state WHERE customer_id=p_customer_id;END IF;
 WITH customer_freshness AS MATERIALIZED (
  SELECT cs.customer_id,private.co_read_freshness_v1(cs.customer_id,cutoff) facts
  FROM private.co_customer_state cs WHERE p_customer_id IS NULL OR cs.customer_id=p_customer_id
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',k.id,'customer_id',k.customer_id,'customer_version',s.version::text,'normalized_sku',k.normalized_sku,'display_sku',k.display_sku,'product_id',k.product_id,'product_name',k.product_name,'recorded_quantity',q.quantity::text,'opening_quantity',q.opening::text,'delivered_quantity',q.delivered::text,'sold_quantity',q.sold::text,'returned_quantity',q.returned::text,'generation_id',s.effective_generation_id,'has_delivery_history',EXISTS(SELECT 1 FROM private.co_stock_batches WHERE stock_key_id=k.id))||f.facts ORDER BY k.customer_id,k.id),'[]') INTO rows
 FROM private.co_stock_keys k JOIN private.co_customer_state s ON s.customer_id=k.customer_id JOIN customer_freshness f ON f.customer_id=k.customer_id CROSS JOIN LATERAL(SELECT coalesce(sum(m.quantity_delta),0) quantity,coalesce(sum(m.quantity_delta) FILTER(WHERE m.effective_date<month_start),0) opening,coalesce(sum(m.quantity_delta) FILTER(WHERE m.effective_date>=month_start AND m.kind='delivery'),0) delivered,-coalesce(sum(m.quantity_delta) FILTER(WHERE m.effective_date>=month_start AND m.kind='sold'),0) sold,-coalesce(sum(m.quantity_delta) FILTER(WHERE m.effective_date>=month_start AND m.kind='return'),0) returned,count(*) movements FROM private.co_stock_movements m WHERE m.generation_id=s.effective_generation_id AND m.stock_key_id=k.id AND m.effective_date<=cutoff)q
 WHERE (p_customer_id IS NULL OR k.customer_id=p_customer_id) AND (p_as_of IS NULL OR q.movements>0) AND (btrim(p_search)='' OR strpos(k.normalized_sku,lower(btrim(p_search)))>0 OR strpos(lower(k.product_name),lower(btrim(p_search)))>0);
 SELECT jsonb_build_object('recorded_quantity',coalesce(sum((value->>'recorded_quantity')::numeric),0)::text,'opening_quantity',coalesce(sum((value->>'opening_quantity')::numeric),0)::text,'delivered_quantity',coalesce(sum((value->>'delivered_quantity')::numeric),0)::text,'sold_quantity',coalesce(sum((value->>'sold_quantity')::numeric),0)::text,'returned_quantity',coalesce(sum((value->>'returned_quantity')::numeric),0)::text) INTO summary FROM jsonb_array_elements(rows);
 RETURN private.co_read_page_v1(rows,p_page,p_page_size,jsonb_build_object('customer_id',p_customer_id,'customer_version',v,'generation_id',g,'stock_as_of',p_as_of,'period_start',month_start,'coverage_date',cutoff,'normalized_search',lower(btrim(p_search)),'summary',summary,'reporting_freshness',CASE WHEN p_customer_id IS NULL THEN NULL ELSE private.co_read_freshness_v1(p_customer_id,cutoff)->'reporting_freshness' END));END $$;
CREATE FUNCTION public.pilot_co_stock_movements_v1(p_customer_id uuid,p_stock_key_id uuid,p_as_of date,p_page integer,p_page_size integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v text;g uuid;rows jsonb;BEGIN v:=private.co_read_customer_v1(p_customer_id);PERFORM private.co_read_date_v1(p_as_of);IF NOT EXISTS(SELECT 1 FROM private.co_stock_keys WHERE id=p_stock_key_id AND customer_id=p_customer_id) THEN RAISE EXCEPTION 'Invalid CO stock key' USING ERRCODE='22023';END IF;SELECT effective_generation_id INTO g FROM private.co_customer_state WHERE customer_id=p_customer_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'customer_id',m.customer_id,'stock_key_id',m.stock_key_id,'generation_id',m.generation_id,'batch_id',m.batch_id,'co_id',b.co_id,'co_line_id',b.co_line_id,'kind',m.kind,'quantity_delta',m.quantity_delta::text,'effective_date',m.effective_date,'delivery_revision_line_id',m.delivery_revision_line_id,'return_revision_line_id',m.return_revision_line_id,'report_revision_line_id',m.report_revision_line_id) ORDER BY m.effective_date,m.id),'[]') INTO rows FROM private.co_stock_movements m JOIN private.co_stock_batches b ON b.id=m.batch_id WHERE m.generation_id=g AND m.stock_key_id=p_stock_key_id AND (p_as_of IS NULL OR m.effective_date<=p_as_of);
 RETURN private.co_read_page_v1(rows,p_page,p_page_size,jsonb_build_object('customer_id',p_customer_id,'customer_version',v,'stock_key_id',p_stock_key_id,'generation_id',g,'stock_as_of',p_as_of));END $$;
CREATE FUNCTION private.co_read_revision_generation_v1(r uuid) RETURNS uuid LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN h.current_revision_id=r THEN s.effective_generation_id ELSE (SELECT g.id FROM private.co_replay_generations g WHERE g.customer_id=h.customer_id AND (EXISTS(SELECT 1 FROM private.co_sale_allocations a WHERE a.generation_id=g.id AND a.report_revision_id=r) OR EXISTS(SELECT 1 FROM private.co_audit_events e WHERE e.generation_id=g.id AND e.report_revision_id=r)) ORDER BY g.version DESC LIMIT 1) END FROM private.co_report_revisions x JOIN private.co_report_heads h ON h.id=x.head_id JOIN private.co_customer_state s ON s.customer_id=h.customer_id WHERE x.id=r;$$;
CREATE FUNCTION private.co_read_context_link_v1(payload jsonb) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN payload?'source_context' THEN jsonb_build_object('operation',payload->'source_context'->'operation','target_id',coalesce(payload->'source_context'->'payload'->'delivery_head_id',payload->'source_context'->'payload'->'report_head_id',payload->'source_context'->'payload'->'return_head_id'),'draft_id',payload->'source_context'->'payload'->'draft_id','original_revision_id',payload->'source_context'->'payload'->'original_revision_id','expected_source_version',coalesce(payload->'source_context'->'payload'->'expected_delivery_version',payload->'source_context'->'payload'->'expected_report_version',payload->'source_context'->'payload'->'expected_return_version'),'expected_co_version',payload->'source_context'->'payload'->'expected_co_version','expected_customer_version',payload->'source_context'->'payload'->'expected_customer_version','expected_draft_version',payload->'source_context'->'payload'->'expected_draft_version') ELSE NULL END;$$;
CREATE FUNCTION private.co_read_report_header_v1(target uuid,view text) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE d private.co_drafts%ROWTYPE;r private.co_report_revisions%ROWTYPE;h private.co_report_heads%ROWTYPE;c uuid;v text;rows_count bigint;entered bigint;sold numeric;revenue numeric;g uuid;result jsonb;
BEGIN
 IF view='draft' THEN
 SELECT * INTO d FROM private.co_drafts WHERE id=target AND kind='report';IF d.id IS NULL THEN RAISE EXCEPTION 'Invalid report draft' USING ERRCODE='22023';END IF;c:=d.customer_id;
 SELECT count(*),count(sold_quantity),coalesce(sum(sold_quantity::numeric),0) INTO rows_count,entered,sold FROM private.co_report_draft_lines WHERE draft_id=d.id;
 result:=jsonb_build_object('id','draft:'||d.id,'customer_id',c,'report_month',d.report_month,'status','draft','draft_id',d.id,'report_head_id',d.payload->'bound_report_head_id','revision_id',d.payload->'bound_report_revision_id','draft_version',d.version::text,'report_version',NULL,'coverage_through_date',d.payload->'coverage_through_date','is_partial_month',d.payload->'is_partial_month','report_reference',d.payload->'report_reference','received_date',d.payload->'received_date','notes',d.payload->'notes','revenue',NULL,'eligible_set_fingerprint',d.eligible_set_fingerprint,'source_context_fingerprint',d.payload->'source_context'->'source_context_fingerprint','source_context_link',private.co_read_context_link_v1(d.payload),'context_issue',CASE WHEN d.payload?'source_context' THEN 'CO_CONTEXT_REQUIRES_CHECK' WHEN d.payload->>'bound_customer_version'<>(SELECT version::text FROM private.co_customer_state WHERE customer_id=c) THEN 'CO_ELIGIBLE_SET_STALE' ELSE NULL END,'consumed',d.payload?'posted_report_head_id');
 ELSE
 SELECT * INTO r FROM private.co_report_revisions WHERE id=target;IF r.id IS NULL THEN RAISE EXCEPTION 'Invalid report revision' USING ERRCODE='22023';END IF;SELECT * INTO h FROM private.co_report_heads WHERE id=r.head_id;c:=r.customer_id;g:=private.co_read_revision_generation_v1(r.id);
 SELECT count(*),coalesce(sum(sold_quantity::numeric),0) INTO rows_count,sold FROM private.co_report_revision_lines WHERE revision_id=r.id;entered:=rows_count;SELECT coalesce(sum(amount),0) INTO revenue FROM private.co_sale_allocations WHERE report_revision_id=r.id AND generation_id=g;
 result:=jsonb_build_object('id','revision:'||r.id,'customer_id',c,'report_month',h.report_month,'status','posted','draft_id',NULL,'report_head_id',h.id,'revision_id',r.id,'draft_version',NULL,'report_version',r.revision_no::text,'coverage_through_date',r.coverage_through_date,'is_partial_month',r.is_partial_month,'report_reference',r.report_reference,'received_date',r.received_date,'notes',r.notes,'revenue',private.co_money_v1(revenue),'eligible_set_fingerprint',NULL,'source_context_fingerprint',NULL,'source_context_link',NULL,'context_issue',NULL,'consumed',false);
 END IF;
 SELECT version::text INTO v FROM private.co_customer_state WHERE customer_id=c;IF view='draft' THEN SELECT effective_generation_id INTO g FROM private.co_customer_state WHERE customer_id=c;END IF;
 RETURN result||jsonb_build_object('customer_name',(SELECT name FROM public.customers WHERE id=c),'customer_version',v,'generation_id',g,'reporting_freshness',private.co_read_freshness_v1(c)->'reporting_freshness','row_count',rows_count::text,'entered_count',entered::text,'missing_count',(rows_count-entered)::text,'sold_quantity',sold::text,'complete',entered=rows_count);END $$;
CREATE FUNCTION private.co_read_report_context_v1(d uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE x private.co_drafts%ROWTYPE;c jsonb;BEGIN SELECT * INTO x FROM private.co_drafts WHERE id=d AND kind='report';IF x.id IS NULL THEN RAISE EXCEPTION 'Invalid report draft' USING ERRCODE='22023';END IF;
 BEGIN c:=private.co_report_context_v1(x.customer_id,x.report_month,x.id);IF x.payload->>'bound_customer_version'<>(SELECT version::text FROM private.co_customer_state WHERE customer_id=x.customer_id) OR c->>'eligible_set_fingerprint' IS DISTINCT FROM x.eligible_set_fingerprint OR c->'bound_report_revision_id' IS DISTINCT FROM x.payload->'bound_report_revision_id' THEN RETURN jsonb_build_object('context_issue','CO_ELIGIBLE_SET_STALE','eligible_rows',NULL);END IF;
 EXCEPTION WHEN SQLSTATE 'PT409' THEN RETURN jsonb_build_object('context_issue',SQLERRM,'eligible_rows',NULL);END;
 RETURN c||jsonb_build_object('context_issue',NULL);END $$;
CREATE FUNCTION public.pilot_co_reports_page_v1(p_customer_id uuid,p_month text,p_status text,p_page integer,p_page_size integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rows jsonb;m date;BEGIN PERFORM private.co_read_actor_v1();IF p_customer_id IS NOT NULL THEN PERFORM private.co_read_customer_v1(p_customer_id);END IF;IF p_month IS NOT NULL THEN m:=private.co_read_month_v1(p_month);END IF;IF p_status IS NULL OR p_status NOT IN('all','draft','posted') THEN RAISE EXCEPTION 'Invalid report filter' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(item ORDER BY period_day DESC,customer,id),'[]') INTO rows FROM (
 SELECT d.report_month period_day,d.customer_id customer,d.id,private.co_read_report_header_v1(d.id,'draft') item FROM private.co_drafts d WHERE d.kind='report' AND NOT d.payload?'posted_report_head_id' AND (p_customer_id IS NULL OR d.customer_id=p_customer_id) AND (m IS NULL OR d.report_month=m) AND p_status IN('all','draft')
 UNION ALL SELECT h.report_month,h.customer_id,h.id,private.co_read_report_header_v1(h.current_revision_id,'revision') FROM private.co_report_heads h WHERE (p_customer_id IS NULL OR h.customer_id=p_customer_id) AND (m IS NULL OR h.report_month=m) AND p_status IN('all','posted'))x;
 RETURN private.co_read_page_v1(rows,p_page,p_page_size,jsonb_build_object('customer_id',p_customer_id,'report_month',m,'status',p_status));END $$;
CREATE FUNCTION public.pilot_co_report_months_v1(p_customer_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v text;first_month date;last_month date;BEGIN v:=private.co_read_customer_v1(p_customer_id);
 SELECT min(m),max(m) INTO first_month,last_month FROM(SELECT date_trunc('month',r.sj_date)::date m FROM private.co_delivery_heads h JOIN private.co_delivery_revisions r ON r.id=h.current_revision_id WHERE h.customer_id=p_customer_id AND NOT r.is_void UNION SELECT report_month FROM private.co_report_heads WHERE customer_id=p_customer_id UNION SELECT report_month FROM private.co_drafts WHERE customer_id=p_customer_id AND kind='report')x;
 RETURN jsonb_build_object('version','1','as_of',statement_timestamp(),'customer_id',p_customer_id,'customer_version',v,'first_month',first_month,'last_month',last_month)||private.co_read_freshness_v1(p_customer_id);END $$;
CREATE FUNCTION public.pilot_co_report_v1(p_customer_id uuid,p_month text,p_expected_customer_version text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v text;m date;d uuid;r uuid;draft jsonb;context jsonb;BEGIN v:=private.co_read_lock_v1(p_customer_id,p_expected_customer_version);m:=private.co_read_month_v1(p_month);SELECT id INTO d FROM private.co_drafts WHERE customer_id=p_customer_id AND report_month=m AND kind='report';SELECT current_revision_id INTO r FROM private.co_report_heads WHERE customer_id=p_customer_id AND report_month=m;
 IF d IS NOT NULL THEN draft:=private.co_read_report_header_v1(d,'draft');context:=private.co_read_report_context_v1(d);draft:=draft||jsonb_build_object('context_issue',context->'context_issue');END IF;
 RETURN jsonb_build_object('version','1','as_of',statement_timestamp(),'customer_id',p_customer_id,'customer_version',v,'generation_id',(SELECT effective_generation_id FROM private.co_customer_state WHERE customer_id=p_customer_id),'report_month',m,'draft',draft,'effective',CASE WHEN r IS NULL THEN NULL ELSE private.co_read_report_header_v1(r,'revision') END)||private.co_read_freshness_v1(p_customer_id);END $$;
CREATE FUNCTION public.pilot_co_report_rows_v1(p_customer_id uuid,p_month text,p_view text,p_expected_draft_version text,p_expected_customer_version text,p_page integer,p_page_size integer,p_revision_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v text;m date;d private.co_drafts%ROWTYPE;r uuid;g uuid;context jsonb;rows jsonb;
BEGIN IF p_expected_customer_version IS NULL OR p_view IS NULL OR p_view NOT IN('draft','effective','revision') OR (p_view='revision')<>(p_revision_id IS NOT NULL) OR (p_view='draft')<>(p_expected_draft_version IS NOT NULL) THEN RAISE EXCEPTION 'Invalid report row view or binding' USING ERRCODE='22023';END IF;
 v:=private.co_read_lock_v1(p_customer_id,p_expected_customer_version);m:=private.co_read_month_v1(p_month);
 IF p_view='draft' THEN
 SELECT * INTO d FROM private.co_drafts WHERE customer_id=p_customer_id AND report_month=m AND kind='report';IF d.id IS NULL THEN RAISE EXCEPTION 'Invalid report draft' USING ERRCODE='22023';END IF;PERFORM private.co_input_version_v1(to_jsonb(p_expected_draft_version));IF d.version::text<>p_expected_draft_version THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409';END IF;context:=private.co_read_report_context_v1(d.id);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.stock_key_id,'stock_key_id',l.stock_key_id,'customer_id',l.customer_id,'report_month',m,'display_sku',k.display_sku,'product_name',k.product_name,'product_id',k.product_id,'sold_quantity',l.sold_quantity::text,'eligible_quantity',CASE WHEN context->>'context_issue' IS NOT NULL THEN NULL ELSE coalesce((SELECT e->>'eligible_quantity' FROM jsonb_array_elements(context->'eligible_rows')e WHERE e->>'stock_key_id'=l.stock_key_id::text),'0') END,'revision_line_id',NULL) ORDER BY l.stock_key_id),'[]') INTO rows FROM private.co_report_draft_lines l JOIN private.co_stock_keys k ON k.id=l.stock_key_id WHERE l.draft_id=d.id;
 ELSE
 SELECT x.id INTO r FROM private.co_report_heads h JOIN private.co_report_revisions x ON x.head_id=h.id AND x.id=CASE WHEN p_view='effective' THEN h.current_revision_id ELSE p_revision_id END WHERE h.customer_id=p_customer_id AND h.report_month=m;IF r IS NULL THEN RAISE EXCEPTION 'Invalid report revision' USING ERRCODE='22023';END IF;g:=private.co_read_revision_generation_v1(r);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.stock_key_id,'stock_key_id',l.stock_key_id,'customer_id',l.customer_id,'report_month',m,'display_sku',k.display_sku,'product_name',k.product_name,'product_id',k.product_id,'sold_quantity',l.sold_quantity::text,'eligible_quantity',(l.sold_quantity::numeric+coalesce((SELECT sum(x.quantity_delta) FROM private.co_stock_movements x WHERE x.generation_id=g AND x.stock_key_id=l.stock_key_id AND x.effective_date<=(SELECT coverage_through_date FROM private.co_report_revisions WHERE id=r)),0))::text,'revision_line_id',l.id) ORDER BY l.stock_key_id),'[]') INTO rows FROM private.co_report_revision_lines l JOIN private.co_stock_keys k ON k.id=l.stock_key_id WHERE l.revision_id=r;
 END IF;
 RETURN private.co_read_page_v1(rows,p_page,p_page_size,jsonb_build_object('customer_id',p_customer_id,'customer_version',v,'generation_id',coalesce(g,(SELECT effective_generation_id FROM private.co_customer_state WHERE customer_id=p_customer_id)),'report_month',m,'view',p_view,'draft_id',d.id,'draft_version',d.version::text,'revision_id',r,'eligible_set_fingerprint',d.eligible_set_fingerprint,'source_context_fingerprint',d.payload->'source_context'->'source_context_fingerprint','source_context_link',private.co_read_context_link_v1(d.payload),'context_issue',context->'context_issue'));END $$;
CREATE FUNCTION private.co_read_allocations_v1(c uuid,r uuid,g uuid) RETURNS SETOF jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 -- Evaluate the selected generation's allocations and immutable source links once.
 -- A fresh-statistics plan must not rescan this subtree for every display line.
 WITH selected AS MATERIALIZED (
  SELECT a.*,h.report_month,b.co_id,b.co_line_id,b.delivery_head_id,
    b.original_delivery_created_order,m.delivery_revision_line_id
  FROM private.co_sale_allocations a
  JOIN private.co_report_revisions rr ON rr.id=a.report_revision_id
  JOIN private.co_report_heads h ON h.id=rr.head_id
  JOIN private.co_stock_batches b ON b.id=a.batch_id
  JOIN private.co_stock_movements m ON m.batch_id=b.id AND m.generation_id=g AND m.kind='delivery'
  WHERE a.customer_id=c AND a.report_revision_id=r AND a.generation_id=g
 )
 SELECT jsonb_build_object('id',a.id,'customer_id',a.customer_id,'report_revision_id',a.report_revision_id,'report_month',a.report_month,'stock_key_id',a.stock_key_id,'batch_id',a.batch_id,'co_id',a.co_id,'co_number',o.co_number,'co_line_id',a.co_line_id,'delivery_head_id',a.delivery_head_id,'delivery_revision_id',dr.id,'sj_number',dr.sj_number,'sj_date',dr.sj_date,'quantity',a.quantity::text,'unit_price',private.co_money_v1(a.unit_price),'amount',private.co_money_v1(a.amount),'sales_person_name',(SELECT full_name FROM public.users WHERE id=a.sales_person_id_at_creation),'sales_person_id_at_creation',a.sales_person_id_at_creation,'sales_assignment_source_id',a.sales_assignment_source_id,'sales_attributed_at',a.sales_attributed_at,'sales_attribution_state',a.sales_attribution_state)
 FROM selected a
 JOIN private.co_orders o ON o.id=a.co_id
 JOIN private.co_delivery_revision_lines dl ON dl.id=a.delivery_revision_line_id
 JOIN private.co_delivery_revisions dr ON dr.id=dl.revision_id
 ORDER BY a.stock_key_id,dr.sj_date,a.original_delivery_created_order,a.batch_id;
$$;
CREATE FUNCTION public.pilot_co_report_allocations_v1(p_customer_id uuid,p_month text,p_revision_id uuid,p_expected_customer_version text,p_page integer,p_page_size integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v text;m date;g uuid;rows jsonb;summary jsonb;effective boolean;BEGIN IF p_expected_customer_version IS NULL THEN RAISE EXCEPTION 'Customer version required' USING ERRCODE='22023';END IF;v:=private.co_read_customer_v1(p_customer_id,p_expected_customer_version);m:=private.co_read_month_v1(p_month);
 SELECT h.current_revision_id=r.id INTO effective FROM private.co_report_revisions r JOIN private.co_report_heads h ON h.id=r.head_id WHERE r.id=p_revision_id AND h.customer_id=p_customer_id AND h.report_month=m;IF NOT FOUND THEN RAISE EXCEPTION 'Invalid report revision' USING ERRCODE='22023';END IF;g:=private.co_read_revision_generation_v1(p_revision_id);
 SELECT coalesce(jsonb_agg(x),'[]') INTO rows FROM private.co_read_allocations_v1(p_customer_id,p_revision_id,g)x;SELECT jsonb_build_object('quantity',coalesce(sum((value->>'quantity')::numeric),0)::text,'amount',private.co_money_v1(coalesce(sum((value->>'amount')::numeric),0))) INTO summary FROM jsonb_array_elements(rows);
 RETURN private.co_read_page_v1(rows,p_page,p_page_size,jsonb_build_object('customer_id',p_customer_id,'customer_version',v,'report_month',m,'revision_id',p_revision_id,'generation_id',g,'is_effective',effective,'summary',summary));END $$;
CREATE FUNCTION private.co_read_sj_draft_v1(d uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',x.id,'co_id',x.co_id,'customer_id',x.customer_id,'draft_version',x.version::text,'mode',CASE WHEN x.payload?'bound_delivery_head_id' THEN 'delivery_correction' ELSE 'new_delivery' END,'sj_number',x.payload->'sj_number','sj_date',x.payload->'sj_date','received_date',x.payload->'received_date','notes',x.payload->'notes','bound_co_version',x.payload->'bound_co_version','bound_customer_version',x.payload->'bound_customer_version','bound_delivery_head_id',x.payload->'bound_delivery_head_id','bound_delivery_revision_id',x.payload->'bound_delivery_revision_id','bound_delivery_version',x.payload->'bound_delivery_version','posted_delivery_head_id',x.payload->'posted_delivery_head_id','line_count',jsonb_array_length(x.payload->'lines')::text,'consumed',x.payload?'posted_delivery_head_id','bindings_current',x.payload->>'bound_co_version'=o.version::text AND x.payload->>'bound_customer_version'=s.version::text AND (NOT x.payload?'bound_delivery_head_id' OR EXISTS(SELECT 1 FROM private.co_delivery_heads h WHERE h.id=(x.payload->>'bound_delivery_head_id')::uuid AND h.current_revision_id::text=x.payload->>'bound_delivery_revision_id' AND h.version::text=x.payload->>'bound_delivery_version')),'preparation_ready',x.payload?'candidate_batch_ids') FROM private.co_drafts x JOIN private.co_orders o ON o.id=x.co_id JOIN private.co_customer_state s ON s.customer_id=x.customer_id WHERE x.id=d AND x.kind='sj';$$;
CREATE FUNCTION private.co_read_delivery_v1(r uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',x.id,'head_id',x.head_id,'customer_id',x.customer_id,'co_id',x.co_id,'head_version',h.version::text,'revision_no',x.revision_no::text,'current_revision_id',h.current_revision_id,'sj_number',x.sj_number,'sj_date',x.sj_date,'received_date',x.received_date,'notes',x.notes,'is_void',x.is_void,'reason',x.reason,'created_at',x.created_at,'line_count',(SELECT count(*)::text FROM private.co_delivery_revision_lines WHERE revision_id=x.id),'is_effective',x.id=h.current_revision_id) FROM private.co_delivery_revisions x JOIN private.co_delivery_heads h ON h.id=x.head_id WHERE x.id=r;$$;
CREATE FUNCTION private.co_read_return_header_v1(target uuid,view text) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE d private.co_drafts%ROWTYPE;r private.co_return_revisions%ROWTYPE;h private.co_return_heads%ROWTYPE;BEGIN
 IF view='draft' THEN SELECT * INTO d FROM private.co_drafts WHERE id=target AND kind='return';IF d.id IS NULL THEN RAISE EXCEPTION 'Invalid return draft' USING ERRCODE='22023';END IF;
 RETURN jsonb_build_object('id',d.id,'customer_id',d.customer_id,'target_kind','draft','draft_version',d.version::text,'head_id',d.payload->'posted_return_head_id','head_version',NULL,'revision_id',NULL,'revision_no',NULL,'return_date',d.payload->'return_date','reference',d.payload->'reference','reason',d.payload->'reason','notes',d.payload->'notes','consumed',d.payload?'posted_return_head_id','bound_customer_version',d.payload->'bound_customer_version','bindings_current',d.payload->>'bound_customer_version'=(SELECT version::text FROM private.co_customer_state WHERE customer_id=d.customer_id),'line_count',jsonb_array_length(d.payload->'lines')::text);
 ELSE SELECT * INTO r FROM private.co_return_revisions WHERE id=target;IF r.id IS NULL THEN RAISE EXCEPTION 'Invalid return revision' USING ERRCODE='22023';END IF;SELECT * INTO h FROM private.co_return_heads WHERE id=r.head_id;
 RETURN jsonb_build_object('id',r.id,'customer_id',r.customer_id,'target_kind','revision','draft_version',NULL,'head_id',r.head_id,'head_version',h.version::text,'revision_id',r.id,'revision_no',r.revision_no::text,'return_date',r.return_date,'reference',r.reference,'reason',r.reason,'notes',r.notes,'consumed',false,'bound_customer_version',NULL,'bindings_current',r.id=h.current_revision_id,'line_count',(SELECT count(*)::text FROM private.co_return_revision_lines WHERE revision_id=r.id),'is_void',r.is_void);
 END IF;END $$;
CREATE FUNCTION public.pilot_co_return_v1(p_customer_id uuid,p_target_id uuid,p_view text,p_expected_customer_version text,p_expected_draft_version text,p_page integer,p_page_size integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v text;d private.co_drafts%ROWTYPE;r uuid;header jsonb;rows jsonb;
BEGIN IF p_expected_customer_version IS NULL OR p_view IS NULL OR p_view NOT IN('draft','effective','revision') OR (p_view='draft')<>(p_expected_draft_version IS NOT NULL) THEN RAISE EXCEPTION 'Invalid return view or binding' USING ERRCODE='22023';END IF;v:=private.co_read_customer_v1(p_customer_id,p_expected_customer_version);
 IF p_view='draft' THEN SELECT * INTO d FROM private.co_drafts WHERE id=p_target_id AND customer_id=p_customer_id AND kind='return';IF d.id IS NULL THEN RAISE EXCEPTION 'Invalid return target' USING ERRCODE='22023';END IF;PERFORM private.co_input_version_v1(to_jsonb(p_expected_draft_version));IF d.version::text<>p_expected_draft_version THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409';END IF;header:=private.co_read_return_header_v1(d.id,'draft');
 ELSE SELECT x.id INTO r FROM private.co_return_heads h JOIN private.co_return_revisions x ON x.head_id=h.id AND x.id=CASE WHEN p_view='effective' THEN h.current_revision_id ELSE p_target_id END WHERE h.customer_id=p_customer_id AND (p_view<>'effective' OR h.id=p_target_id);IF r IS NULL THEN RAISE EXCEPTION 'Invalid return target' USING ERRCODE='22023';END IF;header:=private.co_read_return_header_v1(r,'revision');END IF;
 WITH lines AS(SELECT (x->>'batch_id')::uuid id,(x->>'batch_id')::uuid batch_id,(x->>'quantity')::integer quantity FROM jsonb_array_elements(coalesce(d.payload->'lines','[]'))x UNION ALL SELECT id,batch_id,quantity FROM private.co_return_revision_lines WHERE revision_id=r)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'customer_id',b.customer_id,'co_id',b.co_id,'co_number',o.co_number,'co_line_id',b.co_line_id,'stock_key_id',b.stock_key_id,'batch_id',b.id,'revision_id',r,'draft_id',d.id,'quantity',l.quantity::text,'unit_price',private.co_money_v1(b.unit_price),'display_sku',k.display_sku,'product_name',k.product_name) ORDER BY b.co_id,b.id),'[]') INTO rows FROM lines l JOIN private.co_stock_batches b ON b.id=l.batch_id AND b.customer_id=p_customer_id JOIN private.co_orders o ON o.id=b.co_id JOIN private.co_stock_keys k ON k.id=b.stock_key_id;
 IF jsonb_array_length(rows)::text<>header->>'line_count' THEN RAISE EXCEPTION 'Incomplete return sources' USING ERRCODE='23514';END IF;
 RETURN private.co_read_page_v1(rows,p_page,p_page_size,jsonb_build_object('customer_id',p_customer_id,'customer_version',v,'target_id',p_target_id,'view',p_view,'draft_version',d.version::text,'header',header));END $$;
CREATE FUNCTION private.co_read_audit_matches_v1(e private.co_audit_events,o uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT e.customer_id=(SELECT customer_id FROM private.co_orders WHERE id=o) AND(e.report_revision_id IS NOT NULL OR e.before_state->'order'->>'id'=o::text OR e.after_state->'order'->>'id'=o::text OR e.before_state->>'co_id'=o::text OR e.after_state->>'co_id'=o::text OR EXISTS(SELECT 1 FROM private.co_delivery_revisions WHERE id=e.delivery_revision_id AND co_id=o) OR EXISTS(SELECT 1 FROM private.co_return_revision_lines l JOIN private.co_stock_batches b ON b.id=l.batch_id WHERE l.revision_id=e.return_revision_id AND b.co_id=o) OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(e.after_state->'payload'->'lines','[]'))x JOIN private.co_stock_batches b ON b.id=(x->>'batch_id')::uuid WHERE b.co_id=o));$$;
CREATE FUNCTION private.co_read_audit_leaves_v1(value jsonb) RETURNS TABLE(path text,value_text text) LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 WITH RECURSIVE leaves(path,v) AS(SELECT ''::text,value UNION ALL SELECT l.path||'/'||x.key,x.v FROM leaves l CROSS JOIN LATERAL(SELECT replace(replace(key,'~','~0'),'/','~1') key,value v FROM jsonb_each(CASE WHEN jsonb_typeof(l.v)='object' THEN l.v ELSE '{}' END) UNION ALL SELECT (ordinal-1)::text,value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(l.v)='array' THEN l.v ELSE '[]' END) WITH ORDINALITY a(value,ordinal))x) SELECT path,CASE WHEN v='null'::jsonb THEN NULL ELSE v#>>'{}' END FROM leaves WHERE jsonb_typeof(v) NOT IN('array','object');$$;
CREATE FUNCTION public.pilot_co_detail_section_v1(p_co_id uuid,p_section text,p_parent_id uuid,p_expected_version text,p_expected_customer_version text,p_page integer,p_page_size integer,p_expected_draft_version text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE o private.co_orders%ROWTYPE;v text;rows jsonb;extra jsonb;d private.co_drafts%ROWTYPE;
BEGIN PERFORM private.co_read_actor_v1();SELECT * INTO o FROM private.co_orders WHERE id=p_co_id;IF o.id IS NULL OR p_expected_version IS NULL OR p_expected_customer_version IS NULL THEN RAISE EXCEPTION 'CO identity and versions required' USING ERRCODE='22023';END IF;v:=private.co_read_customer_v1(o.customer_id,p_expected_customer_version);PERFORM private.co_input_version_v1(to_jsonb(p_expected_version));IF o.version::text<>p_expected_version THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409';END IF;
 IF p_section IS NULL OR p_section NOT IN('lines','deliveries','delivery_lines','reports','returns','return_lines','return_drafts','audit','audit_changes','available_batches','sj_drafts','sj_draft_lines') OR (p_section='sj_draft_lines')<>(p_expected_draft_version IS NOT NULL) OR (p_section IN('delivery_lines','return_lines','audit_changes','sj_draft_lines') AND p_parent_id IS NULL) OR (p_section NOT IN('deliveries','delivery_lines','returns','return_lines','audit_changes','sj_drafts','sj_draft_lines','return_drafts') AND p_parent_id IS NOT NULL) THEN RAISE EXCEPTION 'Invalid CO section' USING ERRCODE='22023';END IF;
 extra:=jsonb_build_object('co_id',o.id,'customer_id',o.customer_id,'co_version',o.version::text,'customer_version',v,'section',p_section,'parent_id',p_parent_id);
 CASE p_section
 WHEN 'lines' THEN SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'co_id',l.co_id,'customer_id',l.customer_id,'stock_key_id',l.stock_key_id,'display_sku',k.display_sku,'product_name',k.product_name,'product_id',k.product_id,'ordered_quantity',l.ordered_quantity::text,'resolved_undelivered_quantity',l.resolved_undelivered_quantity::text,'delivered_quantity',q.delivered::text,'pending_quantity',(l.ordered_quantity-l.resolved_undelivered_quantity-q.delivered)::text,'unit_price',private.co_money_v1(l.unit_price),'removable',NOT EXISTS(SELECT 1 FROM private.co_delivery_revision_lines WHERE co_line_id=l.id)) ORDER BY l.id),'[]') INTO rows FROM private.co_order_lines l JOIN private.co_stock_keys k ON k.id=l.stock_key_id CROSS JOIN LATERAL(SELECT coalesce(sum(x.quantity::numeric),0) delivered FROM private.co_delivery_revision_lines x JOIN private.co_delivery_heads h ON h.current_revision_id=x.revision_id JOIN private.co_delivery_revisions r ON r.id=x.revision_id WHERE x.co_line_id=l.id AND NOT r.is_void)q WHERE l.co_id=o.id;
 WHEN 'deliveries' THEN IF p_parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private.co_delivery_heads WHERE id=p_parent_id AND co_id=o.id) THEN RAISE EXCEPTION 'Invalid delivery target' USING ERRCODE='22023';END IF;SELECT coalesce(jsonb_agg(private.co_read_delivery_v1(r.id) ORDER BY r.created_at DESC,r.id),'[]') INTO rows FROM private.co_delivery_revisions r WHERE r.co_id=o.id AND (p_parent_id IS NULL OR r.head_id=p_parent_id);
 WHEN 'delivery_lines' THEN IF NOT EXISTS(SELECT 1 FROM private.co_delivery_revisions WHERE id=p_parent_id AND co_id=o.id) THEN RAISE EXCEPTION 'Invalid delivery revision' USING ERRCODE='22023';END IF;SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'revision_id',l.revision_id,'customer_id',l.customer_id,'co_id',l.co_id,'co_line_id',l.co_line_id,'stock_key_id',l.stock_key_id,'batch_id',l.batch_id,'quantity',l.quantity::text,'unit_price',private.co_money_v1(b.unit_price),'display_sku',k.display_sku,'product_name',k.product_name) ORDER BY l.id),'[]') INTO rows FROM private.co_delivery_revision_lines l JOIN private.co_stock_batches b ON b.id=l.batch_id JOIN private.co_stock_keys k ON k.id=l.stock_key_id WHERE l.revision_id=p_parent_id;
 WHEN 'sj_drafts' THEN IF p_parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private.co_drafts WHERE id=p_parent_id AND co_id=o.id AND kind='sj') THEN RAISE EXCEPTION 'Invalid SJ draft' USING ERRCODE='22023';END IF;SELECT coalesce(jsonb_agg(private.co_read_sj_draft_v1(x.id) ORDER BY x.created_at DESC,x.id),'[]') INTO rows FROM private.co_drafts x WHERE x.co_id=o.id AND x.kind='sj' AND (p_parent_id IS NULL OR x.id=p_parent_id);
 WHEN 'sj_draft_lines' THEN SELECT * INTO d FROM private.co_drafts WHERE id=p_parent_id AND co_id=o.id AND kind='sj';IF d.id IS NULL THEN RAISE EXCEPTION 'Invalid SJ draft' USING ERRCODE='22023';END IF;PERFORM private.co_input_version_v1(to_jsonb(p_expected_draft_version));IF d.version::text<>p_expected_draft_version THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x->>'co_line_id','co_line_id',x->>'co_line_id','co_id',o.id,'customer_id',o.customer_id,'draft_id',d.id,'source_available',l.id IS NOT NULL,'source_issue',CASE WHEN l.id IS NULL THEN 'CO_SJ_SOURCE_UNAVAILABLE' ELSE NULL END,'stock_key_id',l.stock_key_id,'display_sku',k.display_sku,'product_name',k.product_name,'unit_price',CASE WHEN l.id IS NULL THEN NULL ELSE private.co_money_v1(l.unit_price) END,'quantity',x->>'quantity') ORDER BY x->>'co_line_id'),'[]') INTO rows FROM jsonb_array_elements(d.payload->'lines')x LEFT JOIN private.co_order_lines l ON l.id=(x->>'co_line_id')::uuid AND l.co_id=o.id LEFT JOIN private.co_stock_keys k ON k.id=l.stock_key_id;extra:=extra||jsonb_build_object('draft_id',d.id,'draft_version',d.version::text);
 WHEN 'reports' THEN SELECT coalesce(jsonb_agg(private.co_read_report_header_v1(r.id,'revision') ORDER BY h.report_month DESC,r.revision_no DESC,r.id),'[]') INTO rows FROM private.co_report_heads h JOIN private.co_report_revisions r ON r.head_id=h.id WHERE h.customer_id=o.customer_id;
 WHEN 'returns' THEN IF p_parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private.co_return_revision_lines l JOIN private.co_stock_batches b ON b.id=l.batch_id WHERE l.head_id=p_parent_id AND b.co_id=o.id) THEN RAISE EXCEPTION 'Invalid return target' USING ERRCODE='22023';END IF;SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'head_id',r.head_id,'customer_id',r.customer_id,'head_version',h.version::text,'revision_no',r.revision_no::text,'current_revision_id',h.current_revision_id,'return_date',r.return_date,'reference',r.reference,'notes',r.notes,'reason',r.reason,'is_void',r.is_void,'created_at',r.created_at,'line_count',(SELECT count(*)::text FROM private.co_return_revision_lines WHERE revision_id=r.id),'is_effective',r.id=h.current_revision_id) ORDER BY r.created_at DESC,r.id),'[]') INTO rows FROM private.co_return_revisions r JOIN private.co_return_heads h ON h.id=r.head_id WHERE (p_parent_id IS NULL OR r.head_id=p_parent_id) AND EXISTS(SELECT 1 FROM private.co_return_revision_lines l JOIN private.co_stock_batches b ON b.id=l.batch_id WHERE l.head_id=h.id AND b.co_id=o.id);
 WHEN 'return_lines' THEN IF NOT EXISTS(SELECT 1 FROM private.co_return_revision_lines l JOIN private.co_stock_batches b ON b.id=l.batch_id WHERE l.revision_id=p_parent_id AND b.co_id=o.id) THEN RAISE EXCEPTION 'Invalid return revision' USING ERRCODE='22023';END IF;SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'revision_id',l.revision_id,'customer_id',l.customer_id,'co_id',b.co_id,'co_line_id',b.co_line_id,'stock_key_id',l.stock_key_id,'batch_id',l.batch_id,'quantity',l.quantity::text,'unit_price',private.co_money_v1(b.unit_price),'display_sku',k.display_sku,'product_name',k.product_name) ORDER BY l.id),'[]') INTO rows FROM private.co_return_revision_lines l JOIN private.co_stock_batches b ON b.id=l.batch_id JOIN private.co_stock_keys k ON k.id=l.stock_key_id WHERE l.revision_id=p_parent_id AND b.co_id=o.id;
 WHEN 'return_drafts' THEN SELECT coalesce(jsonb_agg(private.co_read_return_header_v1(x.id,'draft') ORDER BY x.created_at DESC,x.id),'[]') INTO rows FROM private.co_drafts x WHERE x.customer_id=o.customer_id AND x.kind='return' AND (p_parent_id IS NULL OR x.id=p_parent_id) AND EXISTS(SELECT 1 FROM jsonb_array_elements(x.payload->'lines')l JOIN private.co_stock_batches b ON b.id=(l->>'batch_id')::uuid WHERE b.co_id=o.id);IF p_parent_id IS NOT NULL AND jsonb_array_length(rows)<>1 THEN RAISE EXCEPTION 'Invalid return draft' USING ERRCODE='22023';END IF;
 WHEN 'available_batches' THEN SELECT coalesce(jsonb_agg(x),'[]') INTO rows FROM private.co_read_batches_v1(o.customer_id,NULL,o.id)x;
 WHEN 'audit' THEN SELECT coalesce(jsonb_agg(to_jsonb(e)-ARRAY['before_state','after_state'] ORDER BY e.created_at DESC,e.id),'[]') INTO rows FROM private.co_audit_events e WHERE private.co_read_audit_matches_v1(e,o.id);
 WHEN 'audit_changes' THEN IF NOT EXISTS(SELECT 1 FROM private.co_audit_events e WHERE e.id=p_parent_id AND private.co_read_audit_matches_v1(e,o.id)) THEN RAISE EXCEPTION 'Invalid audit event' USING ERRCODE='22023';END IF;SELECT coalesce(jsonb_agg(jsonb_build_object('id',p_parent_id||':'||side||':'||path,'audit_id',p_parent_id,'side',side,'path',path,'value',value_text) ORDER BY side,path),'[]') INTO rows FROM(SELECT 'before' side,l.* FROM private.co_audit_events e CROSS JOIN LATERAL private.co_read_audit_leaves_v1(e.before_state)l WHERE e.id=p_parent_id UNION ALL SELECT 'after',l.* FROM private.co_audit_events e CROSS JOIN LATERAL private.co_read_audit_leaves_v1(e.after_state)l WHERE e.id=p_parent_id)x;
 END CASE;RETURN private.co_read_page_v1(rows,p_page,p_page_size,extra);END $$;
CREATE FUNCTION public.pilot_co_preview_allocations_v1(
 p_operation text,p_payload jsonb,p_preview_fingerprint text,p_report_month text,
 p_stock_key_id uuid,p_page integer,p_page_size integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 plan jsonb; c uuid; m date; s jsonb; report jsonb; selected_row jsonb;
 rows jsonb; complete boolean;
BEGIN
 plan:=private.co_preview_plan_v1(p_operation,p_payload);
 IF p_preview_fingerprint IS DISTINCT FROM plan->>'preview_fingerprint' THEN
  RAISE EXCEPTION 'CO_PREVIEW_STALE' USING ERRCODE='PT409';
 END IF;
 c:=(plan->>'customer_id')::uuid;
 m:=private.co_read_month_v1(p_report_month);
 IF p_stock_key_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM private.co_stock_keys WHERE id=p_stock_key_id AND customer_id=c
 ) THEN
  RAISE EXCEPTION 'Invalid CO stock key' USING ERRCODE='22023';
 END IF;
 s:=coalesce(plan->'proposal'->'sources',private.co_sources_v1(c));
 SELECT x INTO report FROM jsonb_array_elements(coalesce(plan->'publish_reports','[]'))x
 WHERE x->>'month'=m::text;
 IF report IS NULL AND plan->'candidate_report'->>'month'=m::text THEN
  report:=plan->'candidate_report';
 END IF;
 IF report IS NULL THEN
  SELECT x INTO report FROM jsonb_array_elements(s->'reports')x WHERE x->>'month'=m::text;
 END IF;
 IF report IS NULL THEN
  RAISE EXCEPTION 'Report month absent from computed plan' USING ERRCODE='22023';
 END IF;
 IF p_stock_key_id IS NOT NULL THEN
  SELECT jsonb_build_object('stock_key_id',p_stock_key_id,'sold_quantity',x->>'sold_quantity')
  INTO selected_row FROM jsonb_array_elements(report->'lines')x
  WHERE x->>'stock_key_id'=p_stock_key_id::text;
  IF selected_row IS NULL THEN
   RAISE EXCEPTION 'Stock key absent from computed report' USING ERRCODE='22023';
  END IF;
 END IF;
 complete:=NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(report->'lines')x WHERE x->'sold_quantity'='null'::jsonb
 );
 SELECT coalesce(jsonb_agg(jsonb_build_object('allocation_ref',private.co_hash_v1(jsonb_build_array(a->>'report_ref',a->>'line_ref',a->>'batch_id')),
   'report_ref',a->>'report_ref',
   'report_line_ref',a->>'line_ref',
   'report_month',a->>'report_month',
   'stock_key_id',a->>'stock_key_id',
   'source_batch_ref',CASE WHEN b.id IS NULL THEN 'candidate:' ELSE 'batch:' END||(a->>'batch_id'),
   'delivery_ref',CASE WHEN src->>'revision_id' IS NULL THEN CASE WHEN plan->'proposal'->'primary'->>'head_id' IS NULL THEN 'draft:'||(plan->'proposal'->'primary'->>'draft_id') ELSE 'head:'||(plan->'proposal'->'primary'->>'head_id') END ELSE 'head:'||b.delivery_head_id END,
   'source_state',CASE WHEN src->>'revision_id' IS NULL THEN 'proposed' ELSE 'posted' END,
   'batch_id',b.id,
   'delivery_head_id',coalesce(b.delivery_head_id,(plan->'proposal'->'primary'->>'head_id')::uuid),
   'delivery_revision_id',src->'revision_id',
   'co_id',o.id,
   'co_number',o.co_number,
   'co_line_id',coalesce(b.co_line_id,(src->>'co_line_id')::uuid),
   'sj_number',CASE WHEN src->>'revision_id' IS NULL THEN plan->'proposal'->'primary'->'revision'->>'sj_number' ELSE dr.sj_number END,
   'sj_date',src->>'date',
   'quantity',a->>'quantity',
   'unit_price',a->>'unit_price',
   'amount',a->>'amount',
   'sales_person_id_at_creation',a->'sales_person_id_at_creation',
   'sales_assignment_source_id',a->'sales_assignment_source_id',
   'sales_attributed_at',a->'sales_attributed_at',
   'sales_attribution_state',a->'sales_attribution_state',
   'sales_person_name',u.full_name) ORDER BY a->>'stock_key_id',(src->>'date')::date,(src->>'original_creation_order')::bigint,a->>'batch_id'),
   '[]') INTO rows

 FROM jsonb_array_elements(plan->'replay'->'allocations')a
 JOIN jsonb_array_elements(s->'deliveries')src ON src->>'batch_id'=a->>'batch_id'
 JOIN private.co_orders o ON o.id=(src->>'co_id')::uuid
 LEFT JOIN private.co_stock_batches b ON b.id=(a->>'batch_id')::uuid
 LEFT JOIN private.co_delivery_revisions dr ON dr.id=(src->>'revision_id')::uuid
 LEFT JOIN public.users u ON u.id=(a->>'sales_person_id_at_creation')::uuid
 WHERE a->>'report_month'=m::text AND a->>'report_ref'=report->>'ref' AND (p_stock_key_id IS NULL OR a->>'stock_key_id'=p_stock_key_id::text);

 RETURN private.co_read_page_v1(rows,p_page,p_page_size,jsonb_build_object(
  'operation',p_operation,'customer_id',c,'customer_version',plan->>'customer_version',
  'preview_fingerprint',p_preview_fingerprint,'report_month',m,'report_ref',report->>'ref',
  'stock_key_id',p_stock_key_id,'selected_row',selected_row,
  'can_post',plan->'can_post','report_complete',complete));
END $$;
-- Only exact checked public read entrypoints are exposed. Internal helpers remain private.
DO $$ DECLARE fn regprocedure;BEGIN
 FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname IN('co_read_actor_v1','co_read_customer_v1','co_read_lock_v1','co_read_page_v1','co_read_date_v1','co_read_month_v1','co_read_freshness_v1','co_read_order_summary_v1','co_read_order_v1','co_read_batches_v1','co_read_revision_generation_v1','co_read_context_link_v1','co_read_report_header_v1','co_read_report_context_v1','co_read_allocations_v1','co_read_sj_draft_v1','co_read_delivery_v1','co_read_return_header_v1','co_read_audit_matches_v1','co_read_audit_leaves_v1') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',fn);END LOOP;
 FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('pilot_co_page_v1','pilot_co_detail_v1','pilot_co_detail_section_v1','pilot_co_reports_page_v1','pilot_co_report_months_v1','pilot_co_report_v1','pilot_co_report_rows_v1','pilot_co_report_allocations_v1','pilot_co_customer_stock_v1','pilot_co_stock_movements_v1','pilot_co_customer_batches_v1','pilot_co_return_v1','pilot_co_preview_allocations_v1') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon',fn);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',fn);END LOOP;
END $$;
COMMIT;
