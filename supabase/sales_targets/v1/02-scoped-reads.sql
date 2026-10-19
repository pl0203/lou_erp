-- Scoped aggregate boundaries. No client grants; never exposes raw source documents.
BEGIN;
SET LOCAL search_path='';
SET LOCAL lock_timeout='5s';
CREATE FUNCTION private.sales_target_facts_v1(from_month date,until_month date,include_legacy boolean DEFAULT false)
RETURNS TABLE(kind text,fact_date date,customer_id uuid,person_id uuid,source_id uuid,amount numeric)
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT 'po_order',p.order_date,p.customer_id,p.sales_person_id_at_creation,p.id,p.total_value::numeric
 FROM public.purchase_orders p WHERE p.status::text IN('confirm','in_progress','complete') AND (p.sales_attribution_state IN('assigned','unassigned') OR (include_legacy AND p.sales_attribution_state='legacy')) AND p.order_date>=from_month AND p.order_date<until_month
 UNION ALL
 SELECT 'po_delivery',s.sj_date,p.customer_id,p.sales_person_id_at_creation,p.id,d.quantity_delivered::numeric*l.unit_price
 FROM public.purchase_orders p JOIN public.surat_jalan s ON s.purchase_order_id=p.id AND s.voided_at IS NULL
 JOIN public.sj_line_items d ON d.surat_jalan_id=s.id AND d.quantity_delivered>0
 JOIN public.po_line_items l ON l.id=d.po_line_item_id AND l.purchase_order_id=p.id
 WHERE (p.sales_attribution_state IN('assigned','unassigned') OR (include_legacy AND p.sales_attribution_state='legacy')) AND s.sj_date>=from_month AND s.sj_date<until_month
 UNION ALL
 SELECT 'co_shipment',r.sj_date,h.customer_id,b.sales_person_id_at_creation,h.co_id,l.quantity::numeric*b.unit_price
 FROM private.co_delivery_heads h JOIN private.co_delivery_revisions r ON r.id=h.current_revision_id AND r.head_id=h.id AND NOT r.is_void
 JOIN private.co_delivery_revision_lines l ON l.revision_id=r.id AND l.customer_id=h.customer_id AND l.co_id=h.co_id
 JOIN private.co_stock_batches b ON b.id=l.batch_id AND b.customer_id=h.customer_id
 WHERE r.sj_date>=from_month AND r.sj_date<until_month
 UNION ALL
 SELECT 'co_sale',h.report_month,a.customer_id,a.sales_person_id_at_creation,b.co_id,a.amount
 FROM private.co_customer_state cs JOIN private.co_sale_allocations a ON a.generation_id=cs.effective_generation_id AND a.customer_id=cs.customer_id
 JOIN private.co_report_heads h ON h.current_revision_id=a.report_revision_id AND h.customer_id=a.customer_id
 JOIN private.co_stock_batches b ON b.id=a.batch_id AND b.customer_id=a.customer_id
 WHERE a.quantity>0 AND h.report_month>=from_month AND h.report_month<until_month
$$;
CREATE FUNCTION private.sales_target_cell_quality_v1(customer uuid,month date,metric text) RETURNS text
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN metric IN('po_order_value','po_delivery_value') THEN
 CASE WHEN EXISTS(SELECT 1 FROM private.sales_target_history_coverage c WHERE c.metric=sales_target_cell_quality_v1.metric AND c.complete_from<=month AND c.complete_until>=month+interval '1 month') THEN 'complete' ELSE 'missing' END
 ELSE CASE WHEN EXISTS(SELECT 1 FROM private.co_report_heads h JOIN private.co_report_revisions r ON r.id=h.current_revision_id AND r.customer_id=h.customer_id
 JOIN private.co_customer_state cs ON cs.customer_id=h.customer_id AND cs.effective_generation_id IS NOT NULL
 WHERE h.customer_id=customer AND h.report_month=month AND NOT r.is_partial_month AND r.coverage_through_date>=month+interval '1 month'-interval '1 day') THEN 'complete' ELSE 'missing' END END
$$;
CREATE FUNCTION private.sales_target_transfer_v1(customer uuid,cutoff date) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.customer_manager_assignments a WHERE a.customer_id=customer AND (
 EXISTS(SELECT 1 FROM private.sales_target_facts_v1((cutoff-interval '6 months')::date,cutoff,true)f WHERE f.customer_id=customer AND f.person_id IS DISTINCT FROM a.manager_id)
 OR EXISTS(SELECT 1 FROM public.purchase_orders p WHERE p.customer_id=customer AND p.status::text IN('confirm','in_progress') AND p.sales_attribution_state IN('assigned','unassigned','legacy') AND p.sales_person_id_at_creation IS DISTINCT FROM a.manager_id)
 OR EXISTS(SELECT 1 FROM private.co_customer_state cs JOIN private.co_stock_movements m ON m.customer_id=cs.customer_id AND m.generation_id=cs.effective_generation_id JOIN private.co_stock_batches b ON b.id=m.batch_id AND b.customer_id=cs.customer_id
 WHERE cs.customer_id=customer AND b.sales_person_id_at_creation IS DISTINCT FROM a.manager_id GROUP BY b.id HAVING sum(m.quantity_delta)>0)))
$$;
CREATE FUNCTION private.sales_target_cells_v1(customer uuid,cutoff date) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH facts AS MATERIALIZED(SELECT * FROM private.sales_target_facts_v1((cutoff-interval '6 months')::date,cutoff,true)f WHERE f.customer_id=customer),
 transfer AS MATERIALIZED(SELECT private.sales_target_transfer_v1(customer,cutoff) needed),
 cells AS (
 SELECT metric,month::date,private.sales_target_cell_quality_v1(customer,month::date,metric) quality,
 (SELECT sum(f.amount) FROM facts f WHERE f.customer_id=customer
 AND date_trunc('month',f.fact_date)::date=month::date AND f.kind=CASE metric WHEN 'po_order_value' THEN 'po_order' WHEN 'po_delivery_value' THEN 'po_delivery' ELSE 'co_sale' END) amount
 FROM unnest(ARRAY['po_order_value','po_delivery_value','co_sale_value'])metric CROSS JOIN generate_series(cutoff-interval '6 months',cutoff-interval '1 month',interval '1 month')month
 ), month_values AS (
 SELECT *,jsonb_build_object('month',month,'amount',CASE WHEN quality='complete' THEN round(coalesce(amount,0),2)::text ELSE round(amount,2)::text END,'quality',quality) value FROM cells
 ), metrics AS (
 SELECT metric,jsonb_build_object('metric',metric,'months',jsonb_agg(value ORDER BY month) FILTER(WHERE month>=cutoff-interval '3 months'),
 'contextMonths',jsonb_agg(value ORDER BY month),'complete',bool_and(quality='complete') FILTER(WHERE month>=cutoff-interval '3 months'),
 'baseline',CASE WHEN bool_and(quality='complete') FILTER(WHERE month>=cutoff-interval '3 months') THEN round(sum(coalesce(amount,0)) FILTER(WHERE month>=cutoff-interval '3 months')/3,2)::text ELSE NULL END,
 'warningCodes',(CASE WHEN bool_and(quality='complete') FILTER(WHERE month>=cutoff-interval '3 months') THEN '[]'::jsonb ELSE jsonb_build_array(CASE WHEN metric='co_sale_value' THEN 'CO_REPORTING_INCOMPLETE' ELSE 'SOURCE_COVERAGE_UNVERIFIED' END) END)||CASE WHEN (SELECT needed FROM transfer) THEN '["TRANSFER_ACTUALS_REMAIN_PREDECESSOR"]'::jsonb ELSE '[]'::jsonb END) value FROM month_values GROUP BY metric
 ) SELECT coalesce(jsonb_agg(value ORDER BY metric),'[]') FROM metrics
$$;
CREATE FUNCTION public.pilot_sales_target_baseline_v1(p_month date,p_manager_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE roster jsonb; cutoff date; people jsonb; warnings jsonb:='[]';
BEGIN
 PERFORM private.sales_target_enabled_v1(); PERFORM private.sales_target_month_v1(p_month); PERFORM private.sales_target_authorize_v1(p_manager_id);
 cutoff:=least(p_month,private.sales_target_calendar_month_v1(statement_timestamp()));
 roster:=private.sales_target_roster_v1(p_manager_id);
 SELECT coalesce(jsonb_agg(jsonb_build_object('personId',p->'personId','name',p->'name','ownership',p->'ownership','customers',
 coalesce((SELECT jsonb_agg(jsonb_build_object('customerId',c->'customerId','name',c->'name','cells',private.sales_target_cells_v1((c->>'customerId')::uuid,cutoff)) ORDER BY c->>'customerId') FROM jsonb_array_elements(p->'customers') c),'[]')) ORDER BY p->>'personId'),'[]') INTO people FROM jsonb_array_elements(roster->'people')p;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(people)p CROSS JOIN LATERAL jsonb_array_elements(p->'customers')c CROSS JOIN LATERAL jsonb_array_elements(c->'cells')cell WHERE NOT (cell->>'complete')::boolean) THEN warnings:=warnings||'"INCOMPLETE_BASELINE_MANUAL_REVIEW"'::jsonb; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(people)p CROSS JOIN LATERAL jsonb_array_elements(p->'customers')c WHERE private.sales_target_transfer_v1((c->>'customerId')::uuid,cutoff)) THEN warnings:=warnings||'"TRANSFER_ACTUALS_REMAIN_PREDECESSOR"'::jsonb; END IF;
 RETURN jsonb_build_object('schemaVersion',1,'month',p_month,'managerId',p_manager_id,'rosterHash',private.sales_target_roster_hash_v1(roster),'currency','IDR','people',people,'warnings',warnings);
END$$;
CREATE FUNCTION private.sales_target_plan_json_v1(plan uuid,only_person uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',p.id,'month',p.month,'managerId',p.manager_id,'version',p.version,'state',p.state,'rosterHash',p.roster_hash,'currency',p.currency,
 'lines',coalesce((SELECT jsonb_agg(jsonb_build_object('personId',l.person_id,'metric',l.metric,'amount',l.amount::text,'applicability',l.applicability,'reason',l.reason) ORDER BY l.person_id,l.metric) FROM private.sales_target_lines l WHERE l.plan_id=p.id AND (only_person IS NULL OR l.person_id=only_person)),'[]'),
 'proposedBy',p.proposed_by,'publishedBy',p.published_by,'publishedAt',p.published_at,'warnings',p.warnings,'previousPlanId',p.previous_plan_id,'returnReason',CASE WHEN p.state='returned' THEN p.reason ELSE NULL END,'baselineSnapshot',CASE WHEN only_person IS NULL THEN p.baseline_snapshot ELSE NULL END)
 FROM private.sales_target_plans p WHERE p.id=plan
$$;
CREATE FUNCTION private.sales_target_audit_snapshot_v1(snapshot jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN snapshot IS NULL THEN NULL ELSE jsonb_build_object('state',snapshot->'state','version',snapshot->'version','lines',snapshot->'lines',
 'people',coalesce((SELECT jsonb_agg(jsonb_build_object('personId',person->'personId','name',person->'name') ORDER BY person->>'personId') FROM jsonb_array_elements(snapshot#>'{baselineSnapshot,people}')person),'[]')) END
$$;
CREATE FUNCTION public.pilot_sales_target_plan_v1(p_plan_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.users:=private.sales_target_actor_v1(); plan private.sales_target_plans;
BEGIN
 PERFORM private.sales_target_enabled_v1();
 SELECT * INTO plan FROM private.sales_target_plans WHERE id=p_plan_id;
 IF plan.id IS NULL THEN RAISE EXCEPTION 'Plan unavailable' USING ERRCODE='42501'; END IF;
 IF actor.role::text='sales_person' THEN
  IF plan.state<>'published' OR NOT EXISTS(SELECT 1 FROM private.sales_target_lines WHERE plan_id=plan.id AND person_id=actor.id) THEN RAISE EXCEPTION 'Plan unavailable' USING ERRCODE='42501'; END IF;
  RETURN private.sales_target_plan_json_v1(plan.id,actor.id);
 END IF;
 PERFORM private.sales_target_authorize_v1(plan.manager_id);
 RETURN private.sales_target_plan_json_v1(plan.id)||jsonb_build_object(
  'auditEventsTruncated',(SELECT count(*)>100 FROM private.sales_target_events WHERE plan_id=plan.id),
  'auditEvents',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id::text,'operation',e.operation,'actorId',e.actor_id,'actorName',u.full_name,'occurredAt',e.created_at,'reason',e.reason,
   'before',private.sales_target_audit_snapshot_v1(e.before_state),'after',private.sales_target_audit_snapshot_v1(e.after_state)) ORDER BY e.id)
   FROM (SELECT * FROM private.sales_target_events WHERE plan_id=plan.id ORDER BY id DESC LIMIT 100)e JOIN public.users u ON u.id=e.actor_id),'[]'));

END$$;
CREATE FUNCTION private.sales_dashboard_people_v3(month date,scope text,manager uuid,use_snapshot boolean DEFAULT true)
RETURNS TABLE(id uuid,manager_id uuid) LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE actor public.users:=private.sales_target_actor_v1(); m record; chain uuid[];
BEGIN
 IF scope='own' THEN
  IF manager IS NOT NULL AND manager<>actor.id THEN RAISE EXCEPTION 'Own scope cannot select another person' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT actor.id,actor.manager_id; RETURN;
 ELSIF scope='team' THEN
  manager:=coalesce(manager,CASE WHEN actor.role::text='sales_manager' THEN actor.id END);
  PERFORM private.sales_target_authorize_v1(manager);
 ELSIF scope='leadership' THEN
  IF actor.role::text NOT IN('sales_head','executive') THEN RAISE EXCEPTION 'Leadership scope required' USING ERRCODE='42501'; END IF;
  IF manager IS NOT NULL THEN PERFORM private.sales_target_authorize_v1(manager); END IF;
 ELSE RAISE EXCEPTION 'Invalid dashboard scope' USING ERRCODE='22023'; END IF;
 FOR m IN SELECT u.id FROM public.users u WHERE u.is_active AND u.role::text='sales_manager' AND (manager IS NULL OR u.id=manager) ORDER BY u.id LOOP
  BEGIN chain:=private.sales_target_chain_v1(m.id); EXCEPTION WHEN check_violation THEN IF scope='team' THEN RAISE; ELSE CONTINUE; END IF; END;
  IF actor.role::text='sales_head' AND NOT actor.id=ANY(chain) THEN CONTINUE; END IF;
  RETURN QUERY
   SELECT DISTINCT r.person_id,m.id FROM private.sales_target_roster r JOIN private.sales_target_plans p ON p.id=r.plan_id WHERE use_snapshot AND p.manager_id=m.id AND p.month=sales_dashboard_people_v3.month AND p.state='published'
   UNION SELECT (p->>'personId')::uuid,m.id FROM jsonb_array_elements(private.sales_target_roster_v1(m.id)->'people')p
   WHERE (NOT use_snapshot OR NOT EXISTS(SELECT 1 FROM private.sales_target_plans q WHERE q.manager_id=m.id AND q.month=sales_dashboard_people_v3.month AND q.state='published'))
   AND (NOT use_snapshot OR NOT EXISTS(SELECT 1 FROM private.sales_target_active a WHERE a.person_id=(p->>'personId')::uuid AND a.month=sales_dashboard_people_v3.month));
 END LOOP;
END$$;
-- Reporting duty follows immutable credited effective stock, not current assignments.
CREATE FUNCTION private.sales_dashboard_co_exposure_v3(month date,people uuid[],customers uuid[] DEFAULT NULL)
RETURNS TABLE(customer_id uuid) LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT b.customer_id FROM private.co_customer_state cs
 JOIN private.co_stock_batches b ON b.customer_id=cs.customer_id AND b.sales_person_id_at_creation=ANY(people)
 JOIN private.co_stock_movements m ON m.customer_id=cs.customer_id AND m.batch_id=b.id AND m.generation_id=cs.effective_generation_id
 WHERE m.effective_date<month+interval '1 month' AND (customers IS NULL OR b.customer_id=ANY(customers))
 GROUP BY b.customer_id
 HAVING coalesce(sum(m.quantity_delta) FILTER(WHERE m.effective_date<month),0)>0 OR bool_or(m.effective_date>=month)
$$;
CREATE FUNCTION private.sales_dashboard_metrics_v3(month date,people uuid[],customers uuid[] DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH f AS MATERIALIZED(SELECT * FROM private.sales_target_facts_v1(month,(month+interval '1 month')::date) WHERE person_id=ANY(people) AND (customers IS NULL OR customer_id=ANY(customers))),
 cohort AS (SELECT customer_id FROM private.sales_dashboard_co_exposure_v3(month,people,customers)),
 q AS (SELECT true po,true delivery,
 (SELECT coalesce(bool_and(private.sales_target_cell_quality_v1(customer_id,month,'co_sale_value')='complete'),true) FROM cohort) co)
 SELECT jsonb_build_object(
 'poOrderCount',jsonb_build_object('value',CASE WHEN q.po OR count(*) FILTER(WHERE kind='po_order')>0 THEN count(DISTINCT source_id) FILTER(WHERE kind='po_order')::text ELSE NULL END,'quality',CASE WHEN q.po THEN 'complete' WHEN count(*) FILTER(WHERE kind='po_order')>0 THEN 'partial' ELSE 'missing' END),
 'poOrderValue',jsonb_build_object('value',CASE WHEN q.po OR count(*) FILTER(WHERE kind='po_order')>0 THEN round(coalesce(sum(amount) FILTER(WHERE kind='po_order'),0),2)::text ELSE NULL END,'quality',CASE WHEN q.po THEN 'complete' WHEN count(*) FILTER(WHERE kind='po_order')>0 THEN 'partial' ELSE 'missing' END),
 'poDeliveryValue',jsonb_build_object('value',CASE WHEN q.delivery OR count(*) FILTER(WHERE kind='po_delivery')>0 THEN round(coalesce(sum(amount) FILTER(WHERE kind='po_delivery'),0),2)::text ELSE NULL END,'quality',CASE WHEN q.delivery THEN 'complete' WHEN count(*) FILTER(WHERE kind='po_delivery')>0 THEN 'partial' ELSE 'missing' END),
 'coShippedCount',jsonb_build_object('value',count(DISTINCT source_id) FILTER(WHERE kind='co_shipment')::text,'quality','complete'),
 'coSaleValue',jsonb_build_object('value',CASE WHEN q.co THEN round(coalesce(sum(amount) FILTER(WHERE kind='co_sale'),0),2)::text ELSE round(sum(amount) FILTER(WHERE kind='co_sale'),2)::text END,'quality',CASE WHEN q.co THEN 'complete' WHEN count(*) FILTER(WHERE kind='co_sale')>0 THEN 'partial' ELSE 'missing' END)) FROM q LEFT JOIN f ON true GROUP BY q.po,q.delivery,q.co
$$;
CREATE FUNCTION private.sales_dashboard_targets_v3(month date,people uuid[],customer_row boolean DEFAULT false) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH metrics AS(SELECT unnest(ARRAY['po_order_value','po_delivery_value','co_sale_value']) metric), agg AS(
 SELECT m.metric,count(l.person_id) n,count(l.person_id) FILTER(WHERE l.applicability='target') target_n,sum(l.amount) FILTER(WHERE l.applicability='target') amount
 FROM metrics m LEFT JOIN private.sales_target_active a ON a.metric=m.metric AND a.month=sales_dashboard_targets_v3.month AND a.person_id=ANY(people) AND NOT customer_row
 LEFT JOIN private.sales_target_lines l ON l.plan_id=a.plan_id AND l.person_id=a.person_id AND l.metric=a.metric GROUP BY m.metric
 ) SELECT jsonb_object_agg(metric,jsonb_build_object('metric',metric,'month',month,'state',CASE WHEN customer_row OR n=0 THEN 'not_published' WHEN n<cardinality(people) OR (target_n>0 AND target_n<n) THEN 'partial' WHEN target_n=0 THEN 'not_applicable' ELSE 'published' END,
 'amount',CASE WHEN NOT customer_row AND n=cardinality(people) AND target_n=n AND target_n>0 THEN round(amount,2)::text ELSE NULL END)) FROM agg
$$;
CREATE FUNCTION private.sales_dashboard_request_visible_v3(requester uuid,customer uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE actor public.users:=private.sales_target_actor_v1(); person public.users; chain uuid[];
BEGIN
 SELECT * INTO person FROM public.users WHERE id=requester AND is_active;
 IF person.id IS NULL THEN RETURN false; END IF;
 IF person.id=actor.id THEN RETURN true; END IF;
 IF actor.role::text='executive' THEN RETURN person.role::text IN('sales_person','sales_manager','sales_head','executive'); END IF;
 IF actor.role::text='sales_manager' THEN
  RETURN person.role::text='sales_person' AND person.manager_id=actor.id AND EXISTS(SELECT 1 FROM public.customer_manager_assignments a JOIN public.users u ON u.id=a.manager_id AND u.is_active WHERE a.customer_id=customer AND (u.id=actor.id OR (u.role::text='sales_person' AND u.manager_id=actor.id)));
 END IF;
 IF actor.role::text='sales_head' AND person.role::text IN('sales_manager','sales_person') THEN
  chain:=private.sales_target_chain_v1(CASE WHEN person.role::text='sales_manager' THEN person.id ELSE person.manager_id END);RETURN actor.id=ANY(chain);
 END IF;
 RETURN false;
EXCEPTION WHEN check_violation THEN RETURN false;
END$$;
CREATE FUNCTION private.sales_dashboard_pending_v3(people uuid[]) RETURNS text
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT count(*)::text FROM public.visit_requests r WHERE r.status='pending' AND r.requester_id=ANY(people)
 AND (people=ARRAY[auth.uid()] OR r.requester_id<>auth.uid()) AND private.sales_dashboard_request_visible_v3(r.requester_id,r.customer_id)
$$;
CREATE FUNCTION private.sales_dashboard_person_current_v3(person_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE actor public.users:=private.sales_target_actor_v1(); person public.users; chain uuid[];
BEGIN
 SELECT * INTO person FROM public.users WHERE id=person_id AND is_active;
 IF person.id IS NULL THEN RETURN false; END IF;
 IF person.id=actor.id THEN RETURN true; END IF;
 IF actor.role::text='executive' THEN RETURN person.role::text IN('sales_person','sales_manager','sales_head','executive'); END IF;
 IF actor.role::text='sales_manager' THEN RETURN person.role::text='sales_person' AND person.manager_id=actor.id; END IF;
 IF actor.role::text='sales_head' AND person.role::text IN('sales_manager','sales_person') THEN
  chain:=private.sales_target_chain_v1(CASE WHEN person.role::text='sales_manager' THEN person.id ELSE person.manager_id END); RETURN actor.id=ANY(chain);
 END IF; RETURN false;
EXCEPTION WHEN check_violation THEN RETURN false;
END$$;
CREATE FUNCTION private.sales_dashboard_activity_v3(month date,people uuid[],customers uuid[] DEFAULT NULL,daily_people uuid[] DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH daily AS(SELECT coalesce(array_agg(person),'{}'::uuid[]) ids FROM unnest(coalesce(daily_people,people))person WHERE private.sales_dashboard_person_current_v3(person))
 SELECT jsonb_build_object('scheduled',(SELECT count(*)::text FROM public.sales_schedules s WHERE s.sales_person_id=ANY(people) AND (customers IS NULL OR s.outlet_id=ANY(customers)) AND s.scheduled_date>=month AND s.scheduled_date<month+interval '1 month' AND s.scheduled_date<=(statement_timestamp() AT TIME ZONE 'Asia/Jakarta')::date),
 'visited',(SELECT count(DISTINCT (v.sales_person_id,v.outlet_id,(v.checked_in_at AT TIME ZONE 'Asia/Jakarta')::date))::text FROM public.outlet_visits v WHERE v.sales_person_id=ANY(people) AND (customers IS NULL OR v.outlet_id=ANY(customers)) AND (v.checked_in_at AT TIME ZONE 'Asia/Jakarta')::date>=month AND (v.checked_in_at AT TIME ZONE 'Asia/Jakarta')::date<month+interval '1 month' AND (v.checked_in_at AT TIME ZONE 'Asia/Jakarta')::date<=(statement_timestamp() AT TIME ZONE 'Asia/Jakarta')::date),
 'pendingRequests',private.sales_dashboard_pending_v3(daily.ids),'todayScheduled',(SELECT CASE WHEN cardinality(daily.ids)>0 THEN count(*)::text ELSE NULL END FROM public.sales_schedules s WHERE s.sales_person_id=ANY(daily.ids) AND s.scheduled_date=(statement_timestamp() AT TIME ZONE 'Asia/Jakarta')::date),
 'todayVisited',(SELECT CASE WHEN cardinality(daily.ids)>0 THEN count(DISTINCT (v.sales_person_id,v.outlet_id))::text ELSE NULL END FROM public.outlet_visits v WHERE v.sales_person_id=ANY(daily.ids) AND (v.checked_in_at AT TIME ZONE 'Asia/Jakarta')::date=(statement_timestamp() AT TIME ZONE 'Asia/Jakarta')::date),
 'todayMatchedScheduled',(SELECT CASE WHEN cardinality(daily.ids)>0 THEN count(*)::text ELSE NULL END FROM public.sales_schedules s WHERE s.sales_person_id=ANY(daily.ids) AND s.scheduled_date=(statement_timestamp() AT TIME ZONE 'Asia/Jakarta')::date AND EXISTS(SELECT 1 FROM public.outlet_visits v WHERE v.schedule_id=s.id AND v.sales_person_id=s.sales_person_id AND v.outlet_id=s.outlet_id)),
 'asOfDate',(statement_timestamp() AT TIME ZONE 'Asia/Jakarta')::date) FROM daily
$$;
CREATE FUNCTION public.pilot_sales_dashboard_v3(p_month date,p_scope text,p_manager_id uuid,p_page integer,p_page_size integer,p_search text DEFAULT '',p_sort text DEFAULT 'name',p_attention text DEFAULT 'all') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; warnings jsonb:='[]'; trend_end date;
BEGIN
 PERFORM private.sales_target_enabled_v1(); PERFORM private.sales_target_month_v1(p_month); PERFORM private.sales_target_actor_v1();
 PERFORM id FROM private.sales_dashboard_people_v3(p_month,p_scope,p_manager_id);
 IF p_page IS NULL OR p_page<1 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 OR length(coalesce(p_search,''))>200
 OR p_sort IS NULL OR p_sort NOT IN('name','po_order_value_desc','po_delivery_value_desc','co_sale_value_desc')
 OR p_attention IS NULL OR p_attention NOT IN('all','missing_co','unvisited','target_incomplete')
 OR (p_scope='own' AND p_attention='target_incomplete') OR (p_scope<>'own' AND p_attention='unvisited') THEN RAISE EXCEPTION 'Invalid page, search, sort or attention filter' USING ERRCODE='22023'; END IF;
 IF p_scope='leadership' THEN warnings:=warnings||'"UNVERIFIED_HIERARCHIES_EXCLUDED"'::jsonb; END IF;
 warnings:=warnings||jsonb_build_array('ACTIVITY_COUNTS_DISTINCT_CUSTOMER_DAYS','TREND_SAME_SELECTED_COHORT','CURRENT_ACTIVITY_USES_CURRENT_HIERARCHY');
 IF p_scope='own' AND (coalesce(p_search,'')<>'' OR p_attention<>'all') THEN warnings:=warnings||'"FILTERED_CUSTOMERS_NO_COMPARABLE_PERSON_TARGET"'::jsonb; END IF;
 trend_end:=least(p_month,(private.sales_target_calendar_month_v1(statement_timestamp())-interval '1 month')::date);
 WITH persons AS MATERIALIZED(SELECT DISTINCT id,manager_id FROM private.sales_dashboard_people_v3(p_month,p_scope,p_manager_id)),
 current_people AS MATERIALIZED(SELECT DISTINCT id FROM private.sales_dashboard_people_v3(p_month,p_scope,p_manager_id,false)),
 raw_cohort AS MATERIALIZED(
 SELECT c.id,c.name,'customer'::text kind,NULL::uuid manager_id,NULL::text manager_name FROM public.customers c WHERE p_scope='own' AND
 (EXISTS(SELECT 1 FROM public.customer_manager_assignments a WHERE a.customer_id=c.id AND a.manager_id=auth.uid()) OR EXISTS(SELECT 1 FROM private.sales_target_facts_v1(p_month,(p_month+interval '1 month')::date)f WHERE f.customer_id=c.id AND f.person_id=auth.uid()) OR EXISTS(SELECT 1 FROM private.sales_dashboard_co_exposure_v3(p_month,ARRAY[auth.uid()])e WHERE e.customer_id=c.id))
 AND (coalesce(p_search,'')='' OR strpos(lower(c.name),lower(p_search))>0)
 UNION ALL SELECT u.id,u.full_name,'person',s.manager_id,m.full_name FROM persons s JOIN public.users u ON u.id=s.id LEFT JOIN public.users m ON m.id=s.manager_id WHERE p_scope<>'own' AND (coalesce(p_search,'')='' OR strpos(lower(u.full_name),lower(p_search))>0 OR strpos(lower(m.full_name),lower(p_search))>0)
 ), measured AS MATERIALIZED(
 SELECT r.*,private.sales_dashboard_metrics_v3(p_month,CASE WHEN p_scope='own' THEN ARRAY[auth.uid()] ELSE ARRAY[r.id] END,CASE WHEN p_scope='own' THEN ARRAY[r.id] ELSE NULL END) metrics,
 private.sales_dashboard_targets_v3(p_month,CASE WHEN p_scope='own' THEN ARRAY[auth.uid()] ELSE ARRAY[r.id] END,p_scope='own') targets,
 private.sales_dashboard_activity_v3(p_month,CASE WHEN p_scope='own' THEN ARRAY[auth.uid()] ELSE ARRAY[r.id] END,CASE WHEN p_scope='own' THEN ARRAY[r.id] ELSE NULL END) activity FROM raw_cohort r
 ), cohort AS MATERIALIZED(
 SELECT * FROM measured r WHERE p_attention='all' OR (p_attention='missing_co' AND r.metrics->'coSaleValue'->>'quality'<>'complete')
 OR (p_attention='unvisited' AND (r.activity->>'visited')::bigint=0)
 OR (p_attention='target_incomplete' AND EXISTS(SELECT 1 FROM jsonb_each(r.targets)t WHERE t.value->>'state' IN('not_published','partial')))
 ), filter AS(SELECT CASE WHEN p_scope='own' THEN ARRAY[auth.uid()] ELSE coalesce(array_agg(c.id),'{}'::uuid[]) END people,CASE WHEN p_scope='own' THEN coalesce(array_agg(c.id),'{}'::uuid[]) ELSE NULL END customers FROM cohort c),
 ordered AS(SELECT *,row_number() OVER(ORDER BY CASE p_sort WHEN 'po_order_value_desc' THEN (metrics->'poOrderValue'->>'value')::numeric WHEN 'po_delivery_value_desc' THEN (metrics->'poDeliveryValue'->>'value')::numeric WHEN 'co_sale_value_desc' THEN (metrics->'coSaleValue'->>'value')::numeric END DESC NULLS LAST,manager_name NULLS FIRST,name,id) ordinal FROM cohort),
 page_rows AS(SELECT * FROM ordered ORDER BY ordinal LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size)
 SELECT jsonb_build_object('schemaVersion',3,'scope',p_scope,'month',p_month,'asOf',statement_timestamp(),'provisional',p_month>=private.sales_target_calendar_month_v1(statement_timestamp()),
 'page',p_page,'pageSize',p_page_size,'total',(SELECT count(*) FROM cohort),'summary',private.sales_dashboard_metrics_v3(p_month,f.people,f.customers),
 'targets',private.sales_dashboard_targets_v3(p_month,f.people,p_scope='own' AND (coalesce(p_search,'')<>'' OR p_attention<>'all')),
 'activity',private.sales_dashboard_activity_v3(p_month,f.people,f.customers,coalesce((SELECT array_agg(id) FROM current_people),'{}'::uuid[])),'warnings',warnings,
 'trend',jsonb_build_array(jsonb_build_object('month',(trend_end-interval '1 month')::date,'metrics',private.sales_dashboard_metrics_v3((trend_end-interval '1 month')::date,f.people,f.customers)),jsonb_build_object('month',trend_end,'metrics',private.sales_dashboard_metrics_v3(trend_end,f.people,f.customers))),
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'kind',r.kind,'managerId',r.manager_id,'managerName',r.manager_name,'metrics',r.metrics,'targets',r.targets,'activity',r.activity,'warnings','[]'::jsonb) ORDER BY r.ordinal) FROM page_rows r),'[]')) INTO result FROM filter f;
 IF EXISTS(SELECT 1 FROM jsonb_each(result->'targets')t WHERE t.value->>'state'='partial') THEN result:=jsonb_set(result,'{warnings}',result->'warnings'||'"TARGET_COVERAGE_OR_APPLICABILITY_NOT_COMPARABLE"'::jsonb); END IF;
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION private.sales_target_audit_snapshot_v1(jsonb),private.sales_target_facts_v1(date,date,boolean),private.sales_target_cell_quality_v1(uuid,date,text),private.sales_target_cells_v1(uuid,date),private.sales_target_transfer_v1(uuid,date),private.sales_target_plan_json_v1(uuid,uuid),private.sales_dashboard_people_v3(date,text,uuid,boolean),private.sales_dashboard_metrics_v3(date,uuid[],uuid[]),private.sales_dashboard_co_exposure_v3(date,uuid[],uuid[]),private.sales_dashboard_targets_v3(date,uuid[],boolean),private.sales_dashboard_activity_v3(date,uuid[],uuid[],uuid[]),private.sales_dashboard_person_current_v3(uuid),private.sales_dashboard_request_visible_v3(uuid,uuid),private.sales_dashboard_pending_v3(uuid[]) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pilot_sales_target_baseline_v1(date,uuid),public.pilot_sales_target_plan_v1(uuid),public.pilot_sales_dashboard_v3(date,text,uuid,integer,integer,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.sales_target_visible_v1(manager uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path='' AS $$BEGIN
 PERFORM private.sales_target_authorize_v1(manager); RETURN true;
EXCEPTION WHEN insufficient_privilege OR check_violation THEN RETURN false;
END$$;
CREATE FUNCTION public.pilot_sales_target_plans_v1(p_month date,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.users:=private.sales_target_actor_v1(); result jsonb;
BEGIN
 PERFORM private.sales_target_enabled_v1(); PERFORM private.sales_target_month_v1(p_month);
 IF p_page IS NULL OR p_page<1 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid plans page' USING ERRCODE='22023'; END IF;
 WITH eligible AS MATERIALIZED(
 SELECT p.*,u.full_name manager_name FROM private.sales_target_plans p JOIN public.users u ON u.id=p.manager_id WHERE p.month=p_month AND
 CASE WHEN actor.role::text='sales_person' THEN p.state='published' AND EXISTS(SELECT 1 FROM private.sales_target_lines l WHERE l.plan_id=p.id AND l.person_id=actor.id)
 ELSE private.sales_target_visible_v1(p.manager_id) END
 ), page_rows AS(SELECT * FROM eligible ORDER BY created_at DESC,id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size)
 SELECT jsonb_build_object('schemaVersion',1,'month',p_month,'page',p_page,'pageSize',p_page_size,'total',(SELECT count(*) FROM eligible),
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'month',month,'managerId',manager_id,'managerName',manager_name,'version',version,'state',state,'proposedBy',proposed_by,'publishedAt',published_at) ORDER BY created_at DESC,id) FROM page_rows),'[]')) INTO result;
 RETURN result;
END$$;
CREATE FUNCTION public.pilot_sales_targets_capability_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE available boolean;
BEGIN
 PERFORM private.sales_target_actor_v1();
 SELECT s.enabled AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY[
 'public.pilot_sales_dashboard_v3(date,text,uuid,integer,integer,text,text,text)',
 'public.pilot_sales_target_baseline_v1(date,uuid)','public.pilot_sales_target_plan_v1(uuid)',
 'public.pilot_sales_target_plans_v1(date,integer,integer)',
 'public.pilot_sales_target_command_v1(uuid,text,jsonb)','public.pilot_sales_target_reconcile_v1(uuid)'])f WHERE to_regprocedure(f) IS NULL)
 INTO available FROM private.sales_target_schema s WHERE version=1;
 RETURN jsonb_build_object('schemaVersion',1,'available',coalesce(available,false));
END$$;
REVOKE ALL ON FUNCTION private.sales_target_visible_v1(uuid),public.pilot_sales_target_plans_v1(date,integer,integer),public.pilot_sales_targets_capability_v1() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
