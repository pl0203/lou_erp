-- LOCAL REVIEW CANDIDATE ONLY. Depends on the import candidate; not autodiscovered.
BEGIN;
SET LOCAL search_path='';
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';

CREATE FUNCTION public.pilot_co_reports_page_v2(p_customer_id uuid,p_month text,p_status text,p_page integer,p_page_size integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE selected_month date; result jsonb;
BEGIN
 PERFORM private.co_read_actor_v1();
 IF p_customer_id IS NOT NULL THEN PERFORM private.co_read_customer_v1(p_customer_id); END IF;
 IF p_month IS NOT NULL THEN selected_month:=private.co_read_month_v1(p_month); END IF;
 IF p_status IS NULL OR p_status NOT IN('all','posted','historical_pending') OR p_page IS NULL OR p_page<1 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid workspace report filters' USING ERRCODE='22023'; END IF;
 WITH pending AS MATERIALIZED (
  SELECT d.id,d.customer_id,d.report_month,d.created_at updated_at FROM private.co_drafts d
  WHERE d.kind='report' AND NOT d.payload?'posted_report_head_id'
   AND NOT EXISTS(SELECT 1 FROM private.co_draft_import_origins i WHERE i.draft_id=d.id AND i.customer_id=d.customer_id)
   AND (p_customer_id IS NULL OR d.customer_id=p_customer_id) AND (selected_month IS NULL OR d.report_month=selected_month)
 ), combined AS (
  SELECT h.id,h.customer_id,h.report_month,'posted'::text status,r.id revision_id,h.id report_head_id,
   EXISTS(SELECT 1 FROM pending d WHERE d.customer_id=h.customer_id AND d.report_month=h.report_month) legacy_pending,
   r.created_at updated_at,e.filename source_filename
  FROM private.co_report_heads h JOIN private.co_report_revisions r ON r.id=h.current_revision_id AND r.head_id=h.id AND r.customer_id=h.customer_id
  LEFT JOIN private.co_report_evidence l ON l.report_revision_id=r.id AND l.customer_id=h.customer_id
  LEFT JOIN private.co_evidence e ON e.id=l.evidence_id AND e.customer_id=h.customer_id
  WHERE (p_customer_id IS NULL OR h.customer_id=p_customer_id) AND (selected_month IS NULL OR h.report_month=selected_month)
  UNION ALL
  SELECT d.id,d.customer_id,d.report_month,'historical_pending',NULL::uuid,NULL::uuid,true,d.updated_at,NULL::text
  FROM pending d WHERE NOT EXISTS(SELECT 1 FROM private.co_report_heads h WHERE h.customer_id=d.customer_id AND h.report_month=d.report_month)
 ), filtered AS MATERIALIZED(SELECT * FROM combined x WHERE p_status='all' OR x.status=p_status),
 selected AS(SELECT * FROM filtered ORDER BY report_month DESC,customer_id,id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size)
 SELECT jsonb_build_object('version','2','as_of',statement_timestamp(),'customer_id',p_customer_id,'report_month',selected_month,'status',p_status,'page',p_page,'page_size',p_page_size,'total',(SELECT count(*)::text FROM filtered),'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'customer_id',s.customer_id,'customer_name',c.name,'report_month',s.report_month,'status',s.status,'revision_id',s.revision_id,'report_head_id',s.report_head_id,'legacy_pending',s.legacy_pending,'source_filename',s.source_filename,'updated_at',s.updated_at) ORDER BY s.report_month DESC,s.customer_id,s.id) FROM selected s JOIN public.customers c ON c.id=s.customer_id),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;

-- A requested old revision must never fall through to today's source. No storage
-- path, URL or bytes are returned: downloads retain the checked private endpoint.
CREATE FUNCTION public.pilot_co_report_import_v1(p_customer_id uuid,p_month date,p_revision_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r private.co_report_revisions%ROWTYPE; h private.co_report_heads%ROWTYPE; m private.co_import_manifests%ROWTYPE; filename text; selected_evidence uuid;
BEGIN
 PERFORM private.co_read_customer_v1(p_customer_id);
 IF p_month IS NULL OR NOT isfinite(p_month) OR extract(day FROM p_month)<>1 OR p_revision_id IS NULL THEN RAISE EXCEPTION 'Invalid report source identity' USING ERRCODE='22023'; END IF;
 SELECT x.* INTO r FROM private.co_report_revisions x JOIN private.co_report_heads y ON y.id=x.head_id AND y.customer_id=x.customer_id WHERE x.id=p_revision_id AND y.customer_id=p_customer_id AND y.report_month=p_month;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Invalid report revision' USING ERRCODE='22023'; END IF;
 SELECT * INTO h FROM private.co_report_heads WHERE id=r.head_id AND customer_id=p_customer_id;
 SELECT x.* INTO m FROM private.co_report_imports l JOIN private.co_import_manifests x ON x.id=l.import_id AND x.customer_id=l.customer_id WHERE l.report_revision_id=r.id AND l.report_head_id=h.id AND l.customer_id=p_customer_id;
 SELECT e.id,private.co_evidence_json_v1(e)->>'filename' INTO selected_evidence,filename FROM private.co_report_evidence l JOIN private.co_evidence e ON e.id=l.evidence_id AND e.customer_id=l.customer_id WHERE l.report_revision_id=r.id AND l.report_head_id=h.id AND l.customer_id=p_customer_id;
 IF m.id IS NOT NULL AND (m.report_month<>p_month OR m.evidence_id IS DISTINCT FROM selected_evidence OR m.digest IS DISTINCT FROM private.co_manifest_digest_v1(m.canonical_json)) THEN RAISE EXCEPTION 'Immutable source binding mismatch' USING ERRCODE='55000'; END IF;
 RETURN jsonb_build_object('version','1','as_of',statement_timestamp(),'customer_id',p_customer_id,'report_month',p_month,'revision_id',r.id,'report_head_id',h.id,'effective_revision_id',h.current_revision_id,
 'manifest',m.canonical_json,'unit_declarations',coalesce(m.validation->'unitDeclarations','{}'::jsonb),'source_amount',m.validation->'sourceAmount','currency',m.validation->'currency','source_filename',filename,
 'created_at',r.created_at,'created_by',r.created_by,'author_name',(SELECT full_name FROM public.users WHERE id=r.created_by),'reason',r.reason,'report_version',r.revision_no::text,'previous_revision_id',(SELECT id FROM private.co_report_revisions WHERE head_id=h.id AND customer_id=p_customer_id AND revision_no<r.revision_no ORDER BY revision_no DESC LIMIT 1))||CASE WHEN m.validation?'returnProofs' THEN jsonb_build_object('return_proofs',m.validation->'returnProofs') ELSE '{}'::jsonb END;
END $$;

CREATE FUNCTION public.pilot_co_report_history_v1(p_customer_id uuid,p_month text,p_page integer,p_page_size integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE selected_month date; result jsonb;
BEGIN
 PERFORM private.co_read_customer_v1(p_customer_id);selected_month:=private.co_read_month_v1(p_month);
 IF p_page IS NULL OR p_page<1 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid history page' USING ERRCODE='22023'; END IF;
 WITH revisions AS MATERIALIZED(SELECT r.*,h.current_revision_id FROM private.co_report_revisions r JOIN private.co_report_heads h ON h.id=r.head_id AND h.customer_id=r.customer_id WHERE h.customer_id=p_customer_id AND h.report_month=selected_month),
 selected AS(SELECT * FROM revisions ORDER BY revision_no DESC,id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size)
 SELECT jsonb_build_object('version','1','as_of',statement_timestamp(),'customer_id',p_customer_id,'report_month',selected_month,'page',p_page,'page_size',p_page_size,'total',(SELECT count(*)::text FROM revisions),'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('revision_id',s.id,'report_version',s.revision_no::text,'created_at',s.created_at,'created_by',s.created_by,'author_name',(SELECT full_name FROM public.users WHERE id=s.created_by),'reason',s.reason,'is_effective',s.id=s.current_revision_id) ORDER BY s.revision_no DESC,s.id) FROM selected s),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.pilot_co_report_revision_delta_v1(p_customer_id uuid,p_month text,p_revision_id uuid,p_page integer,p_page_size integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE selected_month date; head uuid; previous uuid; selected_no bigint; result jsonb;
BEGIN
 PERFORM private.co_read_customer_v1(p_customer_id); selected_month:=private.co_read_month_v1(p_month);
 IF p_page IS NULL OR p_page<1 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid delta page' USING ERRCODE='22023'; END IF;
 SELECT h.id,r.revision_no INTO head,selected_no FROM private.co_report_heads h JOIN private.co_report_revisions r ON r.head_id=h.id AND r.customer_id=h.customer_id WHERE h.customer_id=p_customer_id AND h.report_month=selected_month AND r.id=p_revision_id;
 IF head IS NULL THEN RAISE EXCEPTION 'Invalid report revision' USING ERRCODE='22023'; END IF;
 SELECT id INTO previous FROM private.co_report_revisions WHERE head_id=head AND customer_id=p_customer_id AND revision_no<selected_no ORDER BY revision_no DESC LIMIT 1;
 WITH changes AS MATERIALIZED(
  SELECT coalesce(a.stock_key_id,b.stock_key_id) stock_key_id,b.sold_quantity::text before_quantity,a.sold_quantity::text after_quantity
  FROM (SELECT * FROM private.co_report_revision_lines WHERE revision_id=p_revision_id AND customer_id=p_customer_id) a
  FULL JOIN (SELECT * FROM private.co_report_revision_lines WHERE revision_id=previous AND customer_id=p_customer_id) b ON b.stock_key_id=a.stock_key_id
  WHERE a.sold_quantity IS DISTINCT FROM b.sold_quantity
 ),selected AS(SELECT * FROM changes ORDER BY stock_key_id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size)
 SELECT jsonb_build_object('version','1','as_of',statement_timestamp(),'customer_id',p_customer_id,'report_month',selected_month,'revision_id',p_revision_id,'previous_revision_id',previous,'page',p_page,'page_size',p_page_size,'total',(SELECT count(*)::text FROM changes),'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('stock_key_id',s.stock_key_id,'display_sku',k.display_sku,'product_name',k.product_name,'before_quantity',s.before_quantity,'after_quantity',s.after_quantity) ORDER BY s.stock_key_id) FROM selected s JOIN private.co_stock_keys k ON k.id=s.stock_key_id AND k.customer_id=p_customer_id),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;

-- Read-only fresh import plan, bound to the same outer preview and explicit
-- acknowledgment set as commit. Private ordinary payload never reaches clients.
CREATE FUNCTION public.pilot_co_import_impacts_v1(p_binding jsonb,p_preview_fingerprint text,p_acknowledged_reopen_orders jsonb,p_kind text,p_page integer,p_page_size integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE fresh jsonb; result jsonb; acknowledged jsonb; c uuid; labeled_rows jsonb;
BEGIN
 PERFORM private.co_actor_v1();
 IF p_kind IS NULL OR p_kind NOT IN('report','stock','revenue','credit','reopen','issue','missing_month') OR p_page IS NULL OR p_page<1 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 OR p_preview_fingerprint IS NULL OR p_preview_fingerprint!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid import impact page' USING ERRCODE='22023'; END IF;
 PERFORM private.co_input_object_v1(p_binding,ARRAY['importId','importVersion','customerVersion','draftId','draftVersion','manifestDigest'],ARRAY['importId','importVersion','customerVersion','draftId','draftVersion','manifestDigest']);
 acknowledged:=private.co_import_acknowledgements_v1(p_acknowledged_reopen_orders);
 fresh:=private.co_import_fresh_v1(private.co_input_uuid_v1(p_binding->'importId'),p_binding->>'importVersion',acknowledged);
 IF fresh->'binding' IS DISTINCT FROM p_binding OR fresh->>'previewFingerprint' IS DISTINCT FROM p_preview_fingerprint THEN RAISE EXCEPTION 'CO_PREVIEW_STALE' USING ERRCODE='PT409'; END IF;
 result:=public.pilot_co_preview_impacts_v1(fresh->>'operation',(fresh->'payload')-'preview_fingerprint',fresh->'existingPreview'->>'preview_fingerprint',p_kind,p_page,p_page_size);
 -- Narrow human identities for exactly this authorized, version-bound impact page.
 -- SKU snapshots and original SJ revisions are immutable; CO uses the checked
 -- customer snapshot (and the exact reopen version). PIC is the name attached to
 -- the original attribution ID in this statement, never the customer's current PIC.
 c:=(fresh->'existingPreview'->>'customer_id')::uuid;
 SELECT coalesce(jsonb_agg(r.value||jsonb_build_object('labels',jsonb_build_object(
  'sku',k.display_sku,'productName',k.product_name,'coNumber',o.co_number,
  'sjNumber',dr.sj_number,'picName',u.full_name)) ORDER BY r.ordinality),'[]'::jsonb)
 INTO labeled_rows
 FROM jsonb_array_elements(result->'rows') WITH ORDINALITY r(value,ordinality)
 LEFT JOIN private.co_stock_keys k ON k.id=(r.value->>'stock_key_id')::uuid AND k.customer_id=c
 LEFT JOIN private.co_stock_batches b ON b.id=(r.value->>'batch_id')::uuid AND b.customer_id=c
  AND (r.value->>'stock_key_id' IS NULL OR b.stock_key_id=(r.value->>'stock_key_id')::uuid)
 LEFT JOIN private.co_orders o ON o.id=coalesce((r.value->>'co_id')::uuid,b.co_id) AND o.customer_id=c
  AND (p_kind<>'reopen' OR o.version::text=r.value->>'expected_co_version')
 LEFT JOIN private.co_delivery_revision_lines dl ON dl.id=b.original_delivery_line_id AND dl.customer_id=c AND dl.batch_id=b.id
 LEFT JOIN private.co_delivery_revisions dr ON dr.id=dl.revision_id AND dr.customer_id=c AND dr.co_id=b.co_id
 LEFT JOIN public.users u ON p_kind='credit' AND u.id=(r.value->>'sales_person_id_at_creation')::uuid
  AND EXISTS(SELECT 1 FROM private.co_stock_batches attributed WHERE attributed.customer_id=c AND attributed.sales_person_id_at_creation=u.id);
 result:=jsonb_set(result,'{rows}',labeled_rows);
 RETURN (result-'preview_fingerprint')||jsonb_build_object('binding',fresh->'binding','preview_fingerprint',p_preview_fingerprint,'acknowledged_reopen_orders',p_acknowledged_reopen_orders);
END $$;
REVOKE ALL ON FUNCTION public.pilot_co_import_impacts_v1(jsonb,text,jsonb,text,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pilot_co_import_impacts_v1(jsonb,text,jsonb,text,integer,integer) TO authenticated;

REVOKE ALL ON FUNCTION public.pilot_co_reports_page_v2(uuid,text,text,integer,integer),public.pilot_co_report_import_v1(uuid,date,uuid),public.pilot_co_report_history_v1(uuid,text,integer,integer),public.pilot_co_report_revision_delta_v1(uuid,text,uuid,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pilot_co_reports_page_v2(uuid,text,text,integer,integer),public.pilot_co_report_import_v1(uuid,date,uuid),public.pilot_co_report_history_v1(uuid,text,integer,integer),public.pilot_co_report_revision_delta_v1(uuid,text,uuid,integer,integer) TO authenticated;

-- Stock v2 deliberately has no scalar quantity summary across incompatible units.
-- One statement snapshot: predicate -> count/ordered page -> bounded enrichment.
-- Historical history is the effective restated generation, not a revision snapshot.
CREATE FUNCTION public.pilot_co_customer_stock_v2(p_customer_id uuid,p_sku text,p_search text,p_as_of date,p_sort text,p_direction text,p_page integer,p_page_size integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 cutoff date:=coalesce(p_as_of,(statement_timestamp() AT TIME ZONE 'UTC')::date);
 month_start date:=date_trunc('month',cutoff::timestamp)::date;
 normalized_sku_filter text:=lower(btrim(p_sku)); normalized_search text:=lower(btrim(p_search));
 selected_version text; selected_generation uuid; result jsonb;
BEGIN
 PERFORM private.co_read_actor_v1(); PERFORM private.co_read_date_v1(p_as_of);
 IF p_customer_id IS NOT NULL THEN
  selected_version:=private.co_read_customer_v1(p_customer_id);
  SELECT cs.effective_generation_id INTO selected_generation FROM private.co_customer_state cs WHERE cs.customer_id=p_customer_id;
 END IF;
 IF (p_sku IS NOT NULL AND normalized_sku_filter='') OR p_search IS NULL
  OR p_sort IS NULL OR p_sort NOT IN('sku','customer','balance') OR p_direction IS NULL OR p_direction NOT IN('asc','desc')
  OR p_page IS NULL OR p_page<1 OR p_page_size IS NULL OR p_page_size NOT IN(25,50,100)
 THEN RAISE EXCEPTION 'Invalid stock v2 filters' USING ERRCODE='22023'; END IF;
 WITH keys AS MATERIALIZED (
  SELECT k.*,c.name customer_name,cs.version::text customer_version,cs.effective_generation_id generation_id
  FROM private.co_stock_keys k JOIN private.co_customer_state cs ON cs.customer_id=k.customer_id JOIN public.customers c ON c.id=k.customer_id
  WHERE (p_customer_id IS NULL OR k.customer_id=p_customer_id)
   AND (p_sku IS NULL OR k.normalized_sku=normalized_sku_filter)
   AND (normalized_search='' OR strpos(k.normalized_sku,normalized_search)>0 OR strpos(lower(k.product_name),normalized_search)>0)
 ), measured AS MATERIALIZED (
  SELECT k.*,q.* FROM keys k CROSS JOIN LATERAL (
   SELECT coalesce(sum(m.quantity_delta),0) recorded,
    coalesce(sum(m.quantity_delta) FILTER(WHERE m.effective_date<month_start),0) opening,
    coalesce(sum(m.quantity_delta) FILTER(WHERE m.effective_date>=month_start AND m.kind='delivery'),0) delivered,
    -coalesce(sum(m.quantity_delta) FILTER(WHERE m.effective_date>=month_start AND m.kind='sold'),0) sold,
    -coalesce(sum(m.quantity_delta) FILTER(WHERE m.effective_date>=month_start AND m.kind='return'),0) returned,
    count(*) movement_count
   FROM private.co_stock_movements m
   WHERE m.customer_id=k.customer_id AND m.generation_id=k.generation_id AND m.stock_key_id=k.id AND m.effective_date<=cutoff
  ) q
 ), filtered AS MATERIALIZED (
  SELECT * FROM measured WHERE p_as_of IS NULL OR movement_count>0
 ), selected AS MATERIALIZED (
  SELECT f.*,row_number() OVER(ORDER BY
   CASE WHEN p_sort='sku' AND p_direction='asc' THEN f.normalized_sku END COLLATE "C" ASC,
   CASE WHEN p_sort='sku' AND p_direction='desc' THEN f.normalized_sku END COLLATE "C" DESC,
   CASE WHEN p_sort='customer' AND p_direction='asc' THEN f.customer_name END COLLATE "C" ASC,
   CASE WHEN p_sort='customer' AND p_direction='desc' THEN f.customer_name END COLLATE "C" DESC,
   CASE WHEN p_sort='balance' AND p_direction='asc' THEN f.recorded END ASC,
   CASE WHEN p_sort='balance' AND p_direction='desc' THEN f.recorded END DESC,
   f.customer_id,f.id) ordinal
  FROM filtered f ORDER BY ordinal LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size
 ), relevant_customers AS (
  SELECT s.customer_id FROM selected s UNION SELECT p_customer_id WHERE p_customer_id IS NOT NULL
 ), freshness AS MATERIALIZED (
  SELECT c.customer_id,private.co_read_freshness_v1(c.customer_id,cutoff) facts FROM relevant_customers c
 ), batch_balances AS MATERIALIZED (
  SELECT s.id stock_key_id,s.customer_id,m.batch_id,sum(m.quantity_delta) quantity
  FROM selected s JOIN private.co_stock_movements m ON m.customer_id=s.customer_id AND m.stock_key_id=s.id AND m.generation_id=s.generation_id AND m.effective_date<=cutoff
  GROUP BY s.id,s.customer_id,m.batch_id
 ), batch_basis AS (
  SELECT b.stock_key_id,b.customer_id,sum(b.quantity) quantity,bool_and(b.quantity>=0) nonnegative,
   sum(b.quantity*x.unit_price) FILTER(WHERE b.quantity>0) value,
   count(DISTINCT x.unit_price) FILTER(WHERE b.quantity>0) price_count,
   min(x.unit_price) FILTER(WHERE b.quantity>0) single_price
  FROM batch_balances b JOIN private.co_stock_batches x ON x.id=b.batch_id AND x.customer_id=b.customer_id AND x.stock_key_id=b.stock_key_id
  GROUP BY b.stock_key_id,b.customer_id
 ), enriched AS (
  SELECT s.*,f.facts,d.id declaration_id,d.version declaration_version,d.unit declared_unit,d.declared_at,
   d.id IS NOT NULL AND (p_as_of IS NULL OR d.declared_at < ((cutoff+1)::timestamp AT TIME ZONE 'UTC')) unit_known,
   coalesce(b.quantity,0)=s.recorded AND coalesce(b.nonnegative,true) batch_known,
   coalesce(b.value,0) stock_value,coalesce(b.price_count,0) price_count,b.single_price
  FROM selected s JOIN freshness f ON f.customer_id=s.customer_id
  LEFT JOIN private.co_stock_key_unit_declarations d ON d.customer_id=s.customer_id AND d.stock_key_id=s.id
  LEFT JOIN batch_basis b ON b.customer_id=s.customer_id AND b.stock_key_id=s.id
 )
 SELECT jsonb_build_object('version','2','as_of',statement_timestamp(),'customer_id',p_customer_id,'customer_version',selected_version,'generation_id',selected_generation,
  'sku',normalized_sku_filter,'normalized_search',normalized_search,'stock_as_of',p_as_of,'period_start',month_start,'coverage_date',cutoff,
  'sort',p_sort,'direction',p_direction,'page',p_page,'page_size',p_page_size,'total',(SELECT count(*)::text FROM filtered),
  'reporting_freshness',(SELECT f.facts->'reporting_freshness' FROM freshness f WHERE f.customer_id=p_customer_id),
  'rows',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',s.id,'stock_key_id',s.id,'customer_id',s.customer_id,'customer_name',s.customer_name,'customer_version',s.customer_version,'generation_id',s.generation_id,
   'normalized_sku',s.normalized_sku,'display_sku',s.display_sku,'product_id',s.product_id,'product_name',s.product_name,
   'unit',CASE WHEN s.unit_known THEN s.declared_unit ELSE NULL END,
   'unit_basis',CASE WHEN s.declaration_id IS NULL THEN 'unknown' WHEN s.unit_known THEN 'declared_by_cutoff' ELSE 'declared_after_cutoff' END,
   'unit_declaration',CASE WHEN s.declaration_id IS NULL THEN NULL ELSE jsonb_build_object('id',s.declaration_id,'version',s.declaration_version::text,'unit',s.declared_unit,'declared_at',s.declared_at) END,
   'opening_quantity',s.opening::text,'delivered_quantity',s.delivered::text,'sold_quantity',s.sold::text,'returned_quantity',s.returned::text,'recorded_quantity',s.recorded::text,
   'has_delivery_history',EXISTS(SELECT 1 FROM private.co_stock_batches b WHERE b.customer_id=s.customer_id AND b.stock_key_id=s.id),
   'last_report_month',s.facts->'last_report_month','coverage_through_date',s.facts->'coverage_through_date','reporting_freshness',s.facts->'reporting_freshness',
   -- Fixed IDR retained CO-price contract predates this redesign (b37ab09).
   -- Source report amounts/currency never participate in this valuation.
   'contract_stock_value',CASE WHEN s.unit_known AND s.batch_known THEN private.co_money_v1(s.stock_value) ELSE NULL END,
   'contract_currency',CASE WHEN s.unit_known AND s.batch_known THEN 'IDR' ELSE NULL END,
   'contract_unit_price',CASE WHEN s.unit_known AND s.batch_known AND s.price_count=1 THEN private.co_money_v1(s.single_price) ELSE NULL END,
   'price_state',CASE WHEN NOT(s.unit_known AND s.batch_known) OR s.price_count=0 THEN 'unknown' WHEN s.price_count=1 THEN 'single' ELSE 'mixed' END,
   'valuation_basis',CASE WHEN s.unit_known AND s.batch_known THEN 'retained_co_batch' ELSE NULL END
  ) ORDER BY s.ordinal) FROM enriched s),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.pilot_co_customer_stock_v2(uuid,text,text,date,text,text,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pilot_co_customer_stock_v2(uuid,text,text,date,text,text,integer,integer) TO authenticated;

-- Bounded Task10 handoff: distinct persisted order SKU count and real date/text
-- sorting. Existing detail/price/PIC semantics and v1 remain unchanged. CO number
-- ordering is case-sensitive C-collated text, deliberately not natural-numeric.
CREATE FUNCTION public.pilot_co_page_v2(p_customer_id uuid,p_status text,p_search text,p_sort text,p_direction text,p_page integer,p_page_size integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM private.co_read_actor_v1();
 IF p_customer_id IS NOT NULL THEN PERFORM private.co_read_customer_v1(p_customer_id); END IF;
 IF p_status IS NULL OR p_status NOT IN('all','active','closed','cancelled') OR p_search IS NULL
  OR p_sort IS NULL OR p_sort NOT IN('order_date','co_number') OR p_direction IS NULL OR p_direction NOT IN('asc','desc')
  OR p_page IS NULL OR p_page<1 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100
 THEN RAISE EXCEPTION 'Invalid order v2 filters' USING ERRCODE='22023'; END IF;
 WITH filtered AS MATERIALIZED (
  SELECT o.* FROM private.co_orders o JOIN public.customers c ON c.id=o.customer_id
  WHERE (p_customer_id IS NULL OR o.customer_id=p_customer_id) AND (p_status='all' OR o.status=p_status)
   AND (btrim(p_search)='' OR strpos(lower(o.co_number),lower(btrim(p_search)))>0 OR strpos(lower(c.name),lower(btrim(p_search)))>0)
 ), selected AS MATERIALIZED (
  SELECT o.*,row_number() OVER(ORDER BY
   CASE WHEN p_sort='order_date' AND p_direction='asc' THEN o.order_date END ASC,
   CASE WHEN p_sort='order_date' AND p_direction='desc' THEN o.order_date END DESC,
   CASE WHEN p_sort='co_number' AND p_direction='asc' THEN o.co_number END COLLATE "C" ASC,
   CASE WHEN p_sort='co_number' AND p_direction='desc' THEN o.co_number END COLLATE "C" DESC,o.id) ordinal
  FROM filtered o ORDER BY ordinal LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size
 ), sku_counts AS (
  SELECT s.id,count(DISTINCT l.stock_key_id)::text sku_count FROM selected s
  LEFT JOIN private.co_order_lines l ON l.co_id=s.id AND l.customer_id=s.customer_id GROUP BY s.id
 )
 SELECT jsonb_build_object('version','2','as_of',statement_timestamp(),'customer_id',p_customer_id,'status',p_status,'normalized_search',lower(btrim(p_search)),
  'sort',p_sort,'direction',p_direction,'page',p_page,'page_size',p_page_size,'total',(SELECT count(*)::text FROM filtered),
  'rows',coalesce((SELECT jsonb_agg(private.co_read_order_v1(s.id)||jsonb_build_object('sku_count',c.sku_count) ORDER BY s.ordinal) FROM selected s JOIN sku_counts c ON c.id=s.id),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.pilot_co_page_v2(uuid,text,text,text,text,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pilot_co_page_v2(uuid,text,text,text,text,integer,integer) TO authenticated;

-- Exact source-owned proposal return. This reads retained source-only context,
-- never the lossy public link and never refreshes/replaces a source draft.
CREATE FUNCTION public.pilot_co_report_source_proposal_v1(p_customer_id uuid,p_month text,p_draft_id uuid,p_expected_draft_version text,p_expected_customer_version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cv text; selected_month date; d private.co_drafts%ROWTYPE; context jsonb; proposal jsonb; primary_owner jsonb; source_draft private.co_drafts%ROWTYPE; owner_kind text; co_id uuid; primary_month date;
BEGIN
 IF p_expected_customer_version IS NULL OR p_expected_draft_version IS NULL OR p_draft_id IS NULL THEN RAISE EXCEPTION 'Source proposal identity required' USING ERRCODE='22023'; END IF;
 cv:=private.co_read_lock_v1(p_customer_id,p_expected_customer_version);
 selected_month:=private.co_read_month_v1(p_month);
 PERFORM private.co_input_version_v1(to_jsonb(p_expected_draft_version));
 SELECT * INTO d FROM private.co_drafts WHERE id=p_draft_id AND customer_id=p_customer_id AND kind='report' AND report_month=selected_month FOR SHARE;
 IF d.id IS NULL OR d.version::text<>p_expected_draft_version OR d.payload?'posted_report_head_id' OR d.payload->>'bound_customer_version' IS DISTINCT FROM cv THEN RAISE EXCEPTION 'CO_SOURCE_PROPOSAL_UNAVAILABLE' USING ERRCODE='PT409'; END IF;
 context:=d.payload->'source_context';
 -- Return one honest limitation for malformed/unsupported/nonreconstructible
 -- context. Authorization/version checks stay outside this guarded parse block.
 BEGIN
  PERFORM private.co_input_object_v1(context,ARRAY['operation','payload','source_context_fingerprint'],ARRAY['operation','payload','source_context_fingerprint']);
  IF context IS NULL OR octet_length(context::text)>1048576 OR context->>'operation' NOT IN('post_sj','post_return','correct_sj','correct_return','correct_report')
   OR coalesce(context->>'source_context_fingerprint','') !~ '^[a-f0-9]{64}$'
   OR nullif(btrim(private.co_input_text_v1(context->'payload'->'reason')),'') IS NULL
   OR length(context->'payload'->>'reason')>10000 THEN RAISE EXCEPTION 'Unavailable'; END IF;
  IF context->'payload'?'lines' AND (jsonb_typeof(context->'payload'->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(context->'payload'->'lines') NOT BETWEEN 1 AND 1000) THEN RAISE EXCEPTION 'Unavailable'; END IF;
  IF context->'payload'?'draft_id' THEN
   SELECT * INTO source_draft FROM private.co_drafts WHERE id=private.co_input_uuid_v1(context->'payload'->'draft_id') AND customer_id=p_customer_id FOR SHARE;
   IF source_draft.id IS NULL OR octet_length(source_draft.payload::text)>1048576 THEN RAISE EXCEPTION 'Unavailable'; END IF;
   IF source_draft.kind='report' THEN
    -- Report input is relational, not a fabricated payload.lines projection.
    IF (SELECT count(*) FROM private.co_report_draft_lines WHERE draft_id=source_draft.id)>1000 THEN RAISE EXCEPTION 'Unavailable'; END IF;
    -- An ordinary source-only core cannot reconstruct the immutable import commit
    -- binding. Keep that original import publication guard, never re-prepare it.
    IF EXISTS(SELECT 1 FROM private.co_draft_import_origins WHERE draft_id=source_draft.id AND customer_id=p_customer_id) THEN RAISE EXCEPTION 'Unavailable'; END IF;
   ELSIF jsonb_typeof(source_draft.payload->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(source_draft.payload->'lines') NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Unavailable'; END IF;
  END IF;
  -- Existing operation-specific strict parser validates exact allowed fields,
  -- current source/customer/draft versions, consumed state and source ownership.
  -- The actor is part of this recomputed fingerprint: created_by/link equality
  -- alone is not reconstruction, and another actor cannot inherit this proposal.
  proposal:=private.co_source_proposal_v1(p_customer_id,context->>'operation',context->'payload');
  IF proposal->>'source_context_fingerprint' IS DISTINCT FROM context->>'source_context_fingerprint' THEN RAISE EXCEPTION 'Unavailable'; END IF;
  primary_owner:=proposal->'primary';owner_kind:=primary_owner->>'kind';
  IF owner_kind='delivery' THEN
   co_id:=private.co_input_uuid_v1(primary_owner->'co_id');
   IF NOT EXISTS(SELECT 1 FROM private.co_orders WHERE id=co_id AND customer_id=p_customer_id) THEN RAISE EXCEPTION 'Unavailable'; END IF;
  ELSIF owner_kind='report' THEN primary_month:=private.co_read_month_v1(primary_owner->'report'->>'month');
  ELSIF owner_kind IS DISTINCT FROM 'return' THEN RAISE EXCEPTION 'Unavailable'; END IF;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CO_SOURCE_PROPOSAL_UNAVAILABLE' USING ERRCODE='PT409';
 END;
 RETURN jsonb_build_object('version','1','customer_id',p_customer_id,'report_month',selected_month,'draft_id',d.id,'draft_version',d.version::text,'customer_version',cv,'source_context',context,
  'owner',jsonb_build_object('kind',owner_kind,'co_id',co_id,'report_month',primary_month));
END $$;
REVOKE ALL ON FUNCTION public.pilot_co_report_source_proposal_v1(uuid,text,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pilot_co_report_source_proposal_v1(uuid,text,uuid,text,text) TO authenticated;

-- A5: restated composition, NOT a knowledge-time snapshot. No current-balance
-- helper or latest delivery head can substitute for the pinned movement basis.
CREATE FUNCTION public.pilot_co_customer_batches_v2(p_customer_id uuid,p_stock_key_id uuid,p_as_of date,p_expected_customer_version text,p_expected_generation_id uuid,p_page integer,p_page_size integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cv text; generation uuid; result jsonb; valid boolean;
BEGIN
 IF p_customer_id IS NULL OR p_stock_key_id IS NULL OR p_expected_customer_version IS NULL OR p_expected_generation_id IS NULL
  OR p_as_of IS NULL OR NOT isfinite(p_as_of) OR p_as_of>(statement_timestamp() AT TIME ZONE 'UTC')::date
  OR p_page IS NULL OR p_page<1 OR p_page_size IS NULL OR p_page_size NOT IN(25,50,100)
 THEN RAISE EXCEPTION 'Invalid batch v2 pins' USING ERRCODE='22023'; END IF;
 cv:=private.co_read_lock_v1(p_customer_id,p_expected_customer_version);
 SELECT effective_generation_id INTO generation FROM private.co_customer_state WHERE customer_id=p_customer_id;
 IF generation IS DISTINCT FROM p_expected_generation_id THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.co_stock_keys WHERE id=p_stock_key_id AND customer_id=p_customer_id) THEN RAISE EXCEPTION 'Invalid stock key customer' USING ERRCODE='22023'; END IF;
 WITH retained AS MATERIALIZED (
  SELECT m.* FROM private.co_stock_movements m
  WHERE m.customer_id=p_customer_id AND m.stock_key_id=p_stock_key_id AND m.generation_id=generation AND m.effective_date<=p_as_of
 ), balances AS MATERIALIZED (
  SELECT m.batch_id,sum(m.quantity_delta) quantity FROM retained m GROUP BY m.batch_id
 ), sources AS MATERIALIZED (
  -- Identity is the revision represented by THIS generation's retained delivery
  -- movement. An absent label stays NULL; never join a mutable current head.
  SELECT m.batch_id,count(DISTINCT l.revision_id) source_count,min(r.id::text)::uuid delivery_revision_id,min(r.sj_number) sj_number,min(r.sj_date) sj_date
  FROM retained m
  LEFT JOIN private.co_delivery_revision_lines l ON l.id=m.delivery_revision_line_id AND l.customer_id=m.customer_id AND l.stock_key_id=m.stock_key_id AND l.batch_id=m.batch_id
  LEFT JOIN private.co_delivery_revisions r ON r.id=l.revision_id AND r.customer_id=l.customer_id AND r.head_id=l.head_id AND r.co_id=l.co_id
  WHERE m.kind='delivery' GROUP BY m.batch_id
 ), basis AS MATERIALIZED (
  SELECT q.batch_id,q.quantity,b.id checked_batch,b.co_id,o.co_number,b.delivery_head_id,b.original_delivery_created_order,b.unit_price,
   s.delivery_revision_id,s.sj_number,s.sj_date,coalesce(s.source_count,0) source_count
  FROM balances q LEFT JOIN private.co_stock_batches b ON b.id=q.batch_id AND b.customer_id=p_customer_id AND b.stock_key_id=p_stock_key_id
  LEFT JOIN private.co_orders o ON o.id=b.co_id AND o.customer_id=b.customer_id
  LEFT JOIN sources s ON s.batch_id=q.batch_id
 ), filtered AS MATERIALIZED (
  SELECT * FROM basis WHERE quantity>0
 ), totals AS MATERIALIZED (
  -- Full prepage quantity/value/count, in the same statement as the selected rows.
  SELECT count(*) total,coalesce(sum(quantity),0) quantity,coalesce(sum(quantity*unit_price),0) value FROM filtered
 ), selected AS MATERIALIZED (
  SELECT f.*,row_number() OVER(ORDER BY sj_date NULLS LAST,original_delivery_created_order,batch_id) ordinal
  FROM filtered f ORDER BY sj_date NULLS LAST,original_delivery_created_order,batch_id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size
 )
 SELECT jsonb_build_object('version','2','as_of',statement_timestamp(),'customer_id',p_customer_id,'stock_key_id',p_stock_key_id,
  'customer_version',cv,'generation_id',generation,'stock_as_of',p_as_of,'coverage_date',p_as_of,'page',p_page,'page_size',p_page_size,
  'total',t.total::text,'recorded_quantity',t.quantity::text,'contract_stock_value',private.co_money_v1(t.value),'contract_currency','IDR',
  'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.batch_id,'co_id',s.co_id,'co_number',s.co_number,'delivery_head_id',s.delivery_head_id,
   'delivery_revision_id',s.delivery_revision_id,'sj_number',s.sj_number,'sj_date',s.sj_date,'available_quantity',s.quantity::text,
   'unit_price',private.co_money_v1(s.unit_price),'contract_value',private.co_money_v1(s.quantity*s.unit_price)) ORDER BY s.ordinal) FROM selected s),'[]'::jsonb)),
  NOT EXISTS(SELECT 1 FROM basis WHERE quantity<0 OR checked_batch IS NULL OR co_number IS NULL OR source_count>1)
  AND t.quantity=(SELECT coalesce(sum(quantity_delta),0) FROM retained)
  AND EXISTS(SELECT 1 FROM private.co_stock_key_unit_declarations d WHERE d.customer_id=p_customer_id AND d.stock_key_id=p_stock_key_id AND d.declared_at < ((p_as_of+1)::timestamp AT TIME ZONE 'UTC'))
 INTO result,valid FROM totals t;
 IF NOT coalesce(valid,false) THEN RAISE EXCEPTION 'CO_BATCH_VALUATION_UNAVAILABLE' USING ERRCODE='PT409'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.pilot_co_customer_batches_v2(uuid,uuid,date,text,uuid,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pilot_co_customer_batches_v2(uuid,uuid,date,text,uuid,integer,integer) TO authenticated;

-- Ordinary correction identities use the same narrow projection as import review.
-- Exact source payload, customer/version and fingerprint remain ordinary authority.
CREATE FUNCTION public.pilot_co_preview_labeled_impacts_v1(p_operation text,p_payload jsonb,p_customer_id uuid,p_expected_customer_version text,p_preview_fingerprint text,p_kind text,p_page integer,p_page_size integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE fresh jsonb; result jsonb; c uuid; labeled_rows jsonb;
BEGIN
 PERFORM private.co_actor_v1();
 fresh:=public.pilot_co_preview_v1(p_operation,p_payload);
 IF p_customer_id IS NULL OR p_expected_customer_version IS NULL OR p_preview_fingerprint IS NULL
  OR fresh->>'customer_id' IS DISTINCT FROM p_customer_id::text
  OR fresh->>'customer_version' IS DISTINCT FROM p_expected_customer_version
  OR fresh->>'preview_fingerprint' IS DISTINCT FROM p_preview_fingerprint
 THEN RAISE EXCEPTION 'CO_PREVIEW_STALE' USING ERRCODE='PT409'; END IF;
 result:=public.pilot_co_preview_impacts_v1(p_operation,p_payload,p_preview_fingerprint,p_kind,p_page,p_page_size);
 c:=p_customer_id;
 SELECT coalesce(jsonb_agg(r.value||jsonb_build_object('labels',jsonb_build_object(
  'sku',k.display_sku,'productName',k.product_name,'coNumber',o.co_number,
  'sjNumber',dr.sj_number,'picName',u.full_name)) ORDER BY r.ordinality),'[]'::jsonb)
 INTO labeled_rows
 FROM jsonb_array_elements(result->'rows') WITH ORDINALITY r(value,ordinality)
 LEFT JOIN private.co_stock_keys k ON k.id=(r.value->>'stock_key_id')::uuid AND k.customer_id=c
 LEFT JOIN private.co_stock_batches b ON b.id=(r.value->>'batch_id')::uuid AND b.customer_id=c
  AND (r.value->>'stock_key_id' IS NULL OR b.stock_key_id=(r.value->>'stock_key_id')::uuid)
 LEFT JOIN private.co_orders o ON o.id=coalesce((r.value->>'co_id')::uuid,b.co_id) AND o.customer_id=c
  AND (p_kind<>'reopen' OR o.version::text=r.value->>'expected_co_version')
 LEFT JOIN private.co_delivery_revision_lines dl ON dl.id=b.original_delivery_line_id AND dl.customer_id=c AND dl.batch_id=b.id
 LEFT JOIN private.co_delivery_revisions dr ON dr.id=dl.revision_id AND dr.customer_id=c AND dr.co_id=b.co_id
 LEFT JOIN public.users u ON p_kind='credit' AND u.id=(r.value->>'sales_person_id_at_creation')::uuid
  AND EXISTS(SELECT 1 FROM private.co_stock_batches attributed WHERE attributed.customer_id=c AND attributed.sales_person_id_at_creation=u.id);
 result:=jsonb_set(result,'{rows}',labeled_rows);
 RETURN result||jsonb_build_object('operation',p_operation,'payload',p_payload,'customer_id',c,'customer_version',p_expected_customer_version);
END $$;
REVOKE ALL ON FUNCTION public.pilot_co_preview_labeled_impacts_v1(text,jsonb,uuid,text,text,text,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pilot_co_preview_labeled_impacts_v1(text,jsonb,uuid,text,text,text,integer,integer) TO authenticated;

COMMIT;
