-- LOCAL REVIEW CANDIDATE ONLY; not an applied/generated migration.
-- Requires deployed generation-1 import/unit candidate and existing CO kernel.
BEGIN;
SET LOCAL search_path='';
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';

DO $return_dependency_guard$
DECLARE signature text;fn regprocedure;
BEGIN
 PERFORM private.co_workspace_generation_guard_v1();
 FOREACH signature IN ARRAY ARRAY[
  'private.co_actor_v1()','private.co_read_actor_v1()',
  'private.co_lock_customer_v1(uuid,bigint)','private.co_read_lock_v1(uuid,text)',
  'private.co_read_batches_v1(uuid,uuid,uuid)','private.co_build_plan_v1(uuid,text,jsonb)',
  'private.co_allocation_signature_v1(jsonb)','private.co_effective_allocation_signature_v1(uuid)'
 ] LOOP
  fn:=to_regprocedure(signature);
  IF fn IS NULL OR (SELECT proowner FROM pg_proc WHERE oid=fn)<>'postgres'::regrole
   OR has_function_privilege('anon',fn,'EXECUTE') OR has_function_privilege('authenticated',fn,'EXECUTE')
   OR has_function_privilege('service_role',fn,'EXECUTE') THEN
   RAISE EXCEPTION 'Unreviewed return dependency authority: %',signature USING ERRCODE='42501';
  END IF;
 END LOOP;
 fn:=to_regprocedure('public.pilot_co_transaction_v1(uuid,text,jsonb)');
 IF fn IS NULL OR (SELECT proowner FROM pg_proc WHERE oid=fn)<>'postgres'::regrole
  OR has_function_privilege('anon',fn,'EXECUTE') OR NOT has_function_privilege('authenticated',fn,'EXECUTE') THEN
  RAISE EXCEPTION 'Unreviewed return public router authority' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='private.co_stock_key_unit_declarations'::regclass AND relrowsecurity)
  OR has_table_privilege('authenticated','private.co_stock_key_unit_declarations','SELECT,INSERT,UPDATE,DELETE') THEN
  RAISE EXCEPTION 'Unreviewed return unit authority' USING ERRCODE='42501';
 END IF;
END $return_dependency_guard$;

CREATE TABLE private.co_return_workspace_requests (
 actor_id uuid NOT NULL REFERENCES public.users(id),request_id uuid NOT NULL,
 payload_fingerprint text NOT NULL,result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,request_id),CHECK(jsonb_typeof(result)='object')
);
ALTER TABLE private.co_return_workspace_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.co_return_workspace_requests FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.co_return_workspace_page_v1(p_search text,p_page integer,p_page_size integer) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF p_search IS NULL OR length(p_search)>200 OR p_page IS NULL OR p_page<1 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'Invalid return workspace filter' USING ERRCODE='22023';
 END IF;
END $$;

CREATE FUNCTION public.pilot_co_return_customers_v1(p_search text,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM private.co_read_actor_v1();PERFORM private.co_workspace_generation_guard_v1();
 PERFORM private.co_return_workspace_page_v1(p_search,p_page,p_page_size);
 WITH positive AS MATERIALIZED (
  SELECT m.customer_id,m.stock_key_id FROM private.co_stock_movements m
  JOIN private.co_customer_state s ON s.customer_id=m.customer_id AND s.effective_generation_id=m.generation_id
  GROUP BY m.customer_id,m.stock_key_id HAVING sum(m.quantity_delta)>0
 ), filtered AS MATERIALIZED (
  SELECT c.id,c.name FROM public.customers c WHERE EXISTS(SELECT 1 FROM positive p WHERE p.customer_id=c.id)
   AND (p_search='' OR strpos(lower(c.name),lower(p_search))>0)
 ), selected AS (SELECT * FROM filtered ORDER BY name COLLATE "C",id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size)
 SELECT jsonb_build_object('version','1','as_of',statement_timestamp(),'search',p_search,'page',p_page,'page_size',p_page_size,'total',(SELECT count(*)::text FROM filtered),
  'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('customer_id',id,'customer_name',name) ORDER BY name COLLATE "C",id) FROM selected),'[]')) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.pilot_co_return_history_customers_v1(p_search text,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM private.co_read_actor_v1();PERFORM private.co_workspace_generation_guard_v1();
 PERFORM private.co_return_workspace_page_v1(p_search,p_page,p_page_size);
 WITH positive AS MATERIALIZED (
  SELECT m.customer_id,m.stock_key_id FROM private.co_stock_movements m
  JOIN private.co_customer_state s ON s.customer_id=m.customer_id AND s.effective_generation_id=m.generation_id
  GROUP BY m.customer_id,m.stock_key_id HAVING sum(m.quantity_delta)>0
 ), filtered AS MATERIALIZED (
  SELECT c.id,c.name FROM public.customers c WHERE (EXISTS(SELECT 1 FROM positive p WHERE p.customer_id=c.id) OR EXISTS(SELECT 1 FROM private.co_return_heads h WHERE h.customer_id=c.id))
   AND (p_search='' OR strpos(lower(c.name),lower(p_search))>0)
 ), selected AS (SELECT * FROM filtered ORDER BY name COLLATE "C",id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size)
 SELECT jsonb_build_object('version','1','as_of',statement_timestamp(),'search',p_search,'page',p_page,'page_size',p_page_size,'total',(SELECT count(*)::text FROM filtered),
  'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('customer_id',id,'customer_name',name) ORDER BY name COLLATE "C",id) FROM selected),'[]')) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.pilot_co_return_items_v1(p_customer_id uuid,p_search text,p_expected_customer_version text,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;v text;g uuid;
BEGIN
 PERFORM private.co_read_actor_v1();PERFORM private.co_workspace_generation_guard_v1();
 PERFORM private.co_return_workspace_page_v1(p_search,p_page,p_page_size);
 v:=private.co_read_lock_v1(p_customer_id,p_expected_customer_version);
 SELECT effective_generation_id INTO g FROM private.co_customer_state WHERE customer_id=p_customer_id;
 WITH positive AS MATERIALIZED (
  SELECT m.stock_key_id,sum(m.quantity_delta) quantity FROM private.co_stock_movements m
  WHERE m.customer_id=p_customer_id AND m.generation_id=g GROUP BY m.stock_key_id HAVING sum(m.quantity_delta)>0
 ), filtered AS MATERIALIZED (
  SELECT k.id,k.display_sku,k.product_name,p.quantity,u.id unit_id,u.version unit_version,u.unit
  FROM positive p JOIN private.co_stock_keys k ON k.id=p.stock_key_id AND k.customer_id=p_customer_id
  LEFT JOIN private.co_stock_key_unit_declarations u ON u.stock_key_id=k.id AND u.customer_id=k.customer_id
  WHERE p_search='' OR strpos(lower(k.display_sku),lower(p_search))>0 OR strpos(lower(k.product_name),lower(p_search))>0
 ), selected AS (SELECT * FROM filtered ORDER BY display_sku COLLATE "C",id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size)
 SELECT jsonb_build_object('version','1','as_of',statement_timestamp(),'customer_id',p_customer_id,'customer_version',v,'generation_id',g,'search',p_search,'page',p_page,'page_size',p_page_size,'total',(SELECT count(*)::text FROM filtered),
  'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('stock_key_id',id,'display_sku',display_sku,'product_name',product_name,'available_quantity',quantity::text,'unit_id',unit_id,'unit_version',unit_version::text,'unit',unit) ORDER BY display_sku COLLATE "C",id) FROM selected),'[]')) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.pilot_co_returns_page_v1(p_customer_id uuid,p_date_from date,p_date_to date,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM private.co_read_actor_v1();PERFORM private.co_workspace_generation_guard_v1();
 PERFORM private.co_return_workspace_page_v1('',p_page,p_page_size);
 IF p_customer_id IS NOT NULL THEN PERFORM private.co_read_customer_v1(p_customer_id);END IF;
 IF (p_date_from IS NOT NULL AND NOT isfinite(p_date_from)) OR (p_date_to IS NOT NULL AND NOT isfinite(p_date_to)) OR p_date_from>p_date_to THEN RAISE EXCEPTION 'Invalid return date range' USING ERRCODE='22023';END IF;
 WITH filtered AS MATERIALIZED (
  SELECT h.id,h.customer_id,r.id revision_id,r.return_date,r.reference,r.reason,r.is_void,c.name customer_name
  FROM private.co_return_heads h JOIN private.co_return_revisions r ON r.id=h.current_revision_id AND r.head_id=h.id AND r.customer_id=h.customer_id
  JOIN public.customers c ON c.id=h.customer_id
  WHERE (p_customer_id IS NULL OR h.customer_id=p_customer_id) AND (p_date_from IS NULL OR r.return_date>=p_date_from) AND (p_date_to IS NULL OR r.return_date<=p_date_to)
 ), selected AS (SELECT * FROM filtered ORDER BY return_date DESC,id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size)
 SELECT jsonb_build_object('version','1','as_of',statement_timestamp(),'customer_id',p_customer_id,'date_from',p_date_from,'date_to',p_date_to,'page',p_page,'page_size',p_page_size,'total',(SELECT count(*)::text FROM filtered),
 'rows',coalesce((SELECT jsonb_agg(to_jsonb(s)||jsonb_build_object('item_count',(SELECT count(DISTINCT l.stock_key_id)::text FROM private.co_return_revision_lines l WHERE l.revision_id=s.revision_id),'quantities',
  coalesce((SELECT jsonb_agg(jsonb_build_object('unit',q.unit,'quantity',q.quantity::text) ORDER BY q.unit NULLS FIRST) FROM (
   SELECT u.unit,sum(l.quantity) quantity FROM private.co_return_revision_lines l LEFT JOIN private.co_stock_key_unit_declarations u ON u.stock_key_id=l.stock_key_id AND u.customer_id=s.customer_id WHERE l.revision_id=s.revision_id GROUP BY u.unit
  ) q),'[]')) ORDER BY s.return_date DESC,s.id) FROM selected s),'[]')) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.pilot_co_return_create_result_v1(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM private.co_read_actor_v1();
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Request identity required' USING ERRCODE='22023';END IF;
 SELECT r.result INTO result FROM private.co_return_workspace_requests r WHERE r.actor_id=auth.uid() AND r.request_id=p_request_id;
 RETURN jsonb_build_object('version','1','status',CASE WHEN result IS NULL THEN 'not_found' ELSE 'committed' END,'result',result);
END $$;

CREATE FUNCTION public.pilot_co_return_create_v1(p_request_id uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid;c uuid;g uuid;v bigint;fp text;saved private.co_return_workspace_requests%ROWTYPE;
 x jsonb;k uuid;seen uuid[]:='{}';q integer;remaining bigint;take integer;b jsonb;day date;u private.co_stock_key_unit_declarations%ROWTYPE;
 lines jsonb:='[]';draft jsonb;post jsonb;plan jsonb;receipt jsonb;result jsonb;before_sales jsonb;rh private.co_return_heads%ROWTYPE;
BEGIN
 -- Authorization remains current even for retries; no JWT metadata/role shortcuts.
 actor:=private.co_actor_v1();
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Request identity required' USING ERRCODE='22023';END IF;
 IF p_payload IS NULL OR octet_length(p_payload::text)>262144 THEN RAISE EXCEPTION 'Invalid return payload' USING ERRCODE='22023';END IF;
 fp:=private.co_hash_v1(p_payload);
 -- A transaction-scoped, actor-bound key serializes identical requests before stock locks.
 -- Hash collisions can only serialize unrelated requests; identity is compared below.
 PERFORM pg_advisory_xact_lock(hashtextextended('co-return-workspace:'||actor::text||':'||p_request_id::text,0));
 SELECT * INTO saved FROM private.co_return_workspace_requests WHERE actor_id=actor AND request_id=p_request_id;
 IF saved.request_id IS NOT NULL THEN
  IF saved.payload_fingerprint<>fp THEN RAISE EXCEPTION 'CO_RETURN_REQUEST_CONFLICT' USING ERRCODE='PT409';END IF;
  RETURN saved.result;
 END IF;
 PERFORM private.co_workspace_generation_guard_v1();
 PERFORM private.co_input_object_v1(p_payload,
  ARRAY['customer_id','expected_customer_version','expected_generation_id','return_date','reason','items'],
  ARRAY['customer_id','expected_customer_version','expected_generation_id','return_date','reference','reason','notes','items']);
 c:=private.co_input_uuid_v1(p_payload->'customer_id');g:=private.co_input_uuid_v1(p_payload->'expected_generation_id');day:=private.co_input_date_v1(p_payload->'return_date');
 PERFORM private.co_input_text_v1(p_payload->'reason');
 IF length(btrim(p_payload->>'reason'))>1000 OR length(coalesce(p_payload->>'reference',''))>200 OR length(coalesce(p_payload->>'notes',''))>4000 THEN RAISE EXCEPTION 'Return text too long' USING ERRCODE='22023';END IF;
 PERFORM private.co_input_text_v1(p_payload->'reference',true);PERFORM private.co_input_text_v1(p_payload->'notes',true);
 IF day>(clock_timestamp() AT TIME ZONE 'UTC')::date THEN RAISE EXCEPTION 'CO_FUTURE_RETURN_DATE' USING ERRCODE='22023';END IF;
 IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Return items required (maximum 100)' USING ERRCODE='22023';END IF;
 v:=private.co_lock_customer_v1(c,private.co_input_version_v1(p_payload->'expected_customer_version'));
 IF g IS DISTINCT FROM (SELECT effective_generation_id FROM private.co_customer_state WHERE customer_id=c) THEN RAISE EXCEPTION 'CO_RETURN_GENERATION_STALE' USING ERRCODE='PT409';END IF;
 -- Same lock order as the existing kernel; stock/version cannot change mid-allocation.
 PERFORM id FROM private.co_orders WHERE customer_id=c ORDER BY id FOR UPDATE;
 PERFORM id FROM private.co_delivery_heads WHERE customer_id=c ORDER BY id FOR UPDATE;
 PERFORM id FROM private.co_return_heads WHERE customer_id=c ORDER BY id FOR UPDATE;
 PERFORM id FROM private.co_report_heads WHERE customer_id=c ORDER BY id FOR UPDATE;
 PERFORM id FROM private.co_drafts WHERE customer_id=c ORDER BY id FOR UPDATE;
 before_sales:=private.co_effective_allocation_signature_v1(c);
 FOR x IN SELECT value FROM jsonb_array_elements(p_payload->'items') ORDER BY value->>'stock_key_id' LOOP
  PERFORM private.co_input_object_v1(x,ARRAY['stock_key_id','quantity','unit','unit_version','unit_id'],ARRAY['stock_key_id','quantity','unit','unit_version','unit_id']);
  k:=private.co_input_uuid_v1(x->'stock_key_id');q:=private.co_input_quantity_v1(x->'quantity');
  IF k=ANY(seen) THEN RAISE EXCEPTION 'Duplicate return item' USING ERRCODE='22023';END IF;seen:=array_append(seen,k);
  SELECT * INTO u FROM private.co_stock_key_unit_declarations WHERE customer_id=c AND stock_key_id=k;
  IF u.id IS NULL OR u.id IS DISTINCT FROM private.co_input_uuid_v1(x->'unit_id') OR u.version IS DISTINCT FROM private.co_input_version_v1(x->'unit_version') OR u.unit IS DISTINCT FROM private.co_input_text_v1(x->'unit') THEN
   RAISE EXCEPTION 'CO_RETURN_UNIT_STALE' USING ERRCODE='PT409';
  END IF;
  remaining:=q;
  -- Existing kernel helper orders by SJ date, original creation order, then batch UUID.
  -- Only unsold CURRENT residual is eligible; never borrow sold quantities.
  FOR b IN SELECT z FROM private.co_read_batches_v1(c,k) z LOOP
   IF (b->>'sj_date')::date>day THEN CONTINUE;END IF;
   take:=least(remaining,(b->>'available_quantity')::bigint)::integer;
   IF take>0 THEN lines:=lines||jsonb_build_array(jsonb_build_object('batch_id',b->>'id','quantity',take));remaining:=remaining-take;END IF;
   EXIT WHEN remaining=0;
  END LOOP;
  IF remaining<>0 THEN RAISE EXCEPTION 'CO_RETURN_INSUFFICIENT_STOCK' USING ERRCODE='23514';END IF;
 END LOOP;
 draft:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_return_draft',jsonb_build_object('customer_id',c,'expected_customer_version',v::text,'return_date',day,'reference',p_payload->'reference','reason',p_payload->'reason','notes',p_payload->'notes','lines',lines));
 post:=jsonb_build_object('draft_id',draft->'id','expected_draft_version',draft->'version','expected_customer_version',v::text,'reason',p_payload->'reason','completed_report_drafts','[]'::jsonb,'acknowledged_reopen_orders','[]'::jsonb);
 plan:=private.co_build_plan_v1(c,'post_return',post);
 -- A normal stock return cannot revise report heads, source allocations, revenue or PIC.
 -- Reject even equal-total source reallocations and metadata/eligibility republication.
 IF private.co_allocation_signature_v1(plan->'replay') IS DISTINCT FROM before_sales OR
  plan->'publish_reports' IS DISTINCT FROM '[]'::jsonb OR plan->'impacts'->'revenue' IS DISTINCT FROM '[]'::jsonb OR plan->'impacts'->'credit' IS DISTINCT FROM '[]'::jsonb OR plan->'impacts'->'reopen' IS DISTINCT FROM '[]'::jsonb THEN
  RAISE EXCEPTION 'CO_RETURN_SALES_CHANGE_FORBIDDEN' USING ERRCODE='23514';
 END IF;
 IF plan->>'can_post' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'CO_RETURN_INVALID_CHRONOLOGY' USING ERRCODE='23514',DETAIL=(plan->'impacts'->'issue')::text;END IF;
 receipt:=public.pilot_co_transaction_v1(gen_random_uuid(),'post_return',post||jsonb_build_object('preview_fingerprint',plan->>'preview_fingerprint'));
 -- Canonical readback and a second invariant check occur in this SAME transaction.
 IF private.co_effective_allocation_signature_v1(c) IS DISTINCT FROM before_sales THEN RAISE EXCEPTION 'CO_RETURN_SALES_CHANGE_FORBIDDEN' USING ERRCODE='23514';END IF;
 SELECT * INTO rh FROM private.co_return_heads WHERE id=(receipt->>'id')::uuid AND customer_id=c;
 IF rh.id IS NULL OR rh.current_revision_id IS NULL THEN RAISE EXCEPTION 'CO_RETURN_CANONICAL_READBACK_FAILED' USING ERRCODE='23514';END IF;
 result:=jsonb_build_object('version','1','request_id',p_request_id,'customer_id',c,'head_id',rh.id,'revision_id',rh.current_revision_id,'customer_version',receipt->>'customer_version','return_version',rh.version::text);
 INSERT INTO private.co_return_workspace_requests(actor_id,request_id,payload_fingerprint,result) VALUES(actor,p_request_id,fp,result);
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION private.co_return_workspace_page_v1(text,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE fn regprocedure; BEGIN
 FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('pilot_co_return_customers_v1','pilot_co_return_history_customers_v1','pilot_co_return_items_v1','pilot_co_returns_page_v1','pilot_co_return_create_v1','pilot_co_return_create_result_v1') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',fn);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',fn);
 END LOOP;
END $$;
COMMIT;
