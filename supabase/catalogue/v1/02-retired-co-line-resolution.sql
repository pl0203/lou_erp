-- Bounded pure resolver, not a reference-event extractor or an installed tracker.
-- The trusted owner must supply complete, authenticated, source-profile-validated
-- frozen observations, including both audit states and retained immutable keys.
-- It must never expose this history argument to an API caller. This helper cannot
-- authenticate collection provenance/completeness. Its success proves only the
-- requested retired-line tuple, not all references in the enclosing event.
-- Ancillary SourcesSnapshot collections are type-checked, never searched; their
-- nested reference grammars remain the responsibility of the trusted extractor.
-- Public producer profile: CO stages 01/02/03/04/08 at
-- 5559e35e19191db13b7150fed34c0b2797f36b6d. No historical migration is changed.

CREATE OR REPLACE FUNCTION private.catalog_rcl_fail_v1(p_code text,p_path text) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
 RAISE EXCEPTION USING ERRCODE='PCL01', MESSAGE=p_code, DETAIL=p_path;
END $$;

CREATE OR REPLACE FUNCTION private.catalog_rcl_keys_v1(p_value jsonb,p_keys text[],p_path text) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' THEN
  PERFORM private.catalog_rcl_fail_v1('UNKNOWN_SHAPE',p_path);
 END IF;
 IF NOT p_value ?& p_keys OR p_value-p_keys <> '{}'::jsonb THEN
  PERFORM private.catalog_rcl_fail_v1('UNKNOWN_SHAPE',p_path);
 END IF;
END $$;

CREATE OR REPLACE FUNCTION private.catalog_rcl_uuid_v1(p_value jsonb,p_path text,p_nullable boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
 IF p_nullable AND p_value='null'::jsonb THEN RETURN NULL; END IF;
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' THEN
  PERFORM private.catalog_rcl_fail_v1('INVALID_UUID',p_path);
 END IF;
 -- Native PostgreSQL UUID lexical forms are normalized; labels are never used.
 RETURN (p_value#>>'{}')::uuid;
EXCEPTION WHEN invalid_text_representation THEN
 PERFORM private.catalog_rcl_fail_v1('INVALID_UUID',p_path);
END $$;

CREATE OR REPLACE FUNCTION private.catalog_rcl_text_v1(p_value jsonb,p_path text,p_nullable boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
 IF p_nullable AND p_value='null'::jsonb THEN RETURN NULL; END IF;
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' THEN
  PERFORM private.catalog_rcl_fail_v1('UNKNOWN_SHAPE',p_path);
 END IF;
 RETURN p_value#>>'{}';
END $$;

CREATE OR REPLACE FUNCTION private.catalog_rcl_number_v1(
 p_value jsonb,p_min numeric,p_max numeric,p_integer boolean,p_path text
) RETURNS numeric LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE n numeric;
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'number' THEN
  PERFORM private.catalog_rcl_fail_v1('UNKNOWN_SHAPE',p_path);
 END IF;
 n:=(p_value#>>'{}')::numeric;
 IF n<p_min OR n>p_max OR (p_integer AND n<>trunc(n)) THEN
  PERFORM private.catalog_rcl_fail_v1('UNKNOWN_SHAPE',p_path);
 END IF;
 RETURN n;
END $$;

CREATE OR REPLACE FUNCTION private.catalog_rcl_version_v1(p_value jsonb,p_path text) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE s text;
BEGIN
 s:=private.catalog_rcl_text_v1(p_value,p_path);
 IF s!~'^[1-9][0-9]*$' OR length(s)>19 THEN
  PERFORM private.catalog_rcl_fail_v1('UNKNOWN_SHAPE',p_path);
 END IF;
 IF s::numeric>9223372036854775807::numeric THEN
  PERFORM private.catalog_rcl_fail_v1('UNKNOWN_SHAPE',p_path);
 END IF;
END $$;

CREATE OR REPLACE FUNCTION private.catalog_resolve_retired_co_line_v1(
 p_customer uuid,p_order uuid,p_line uuid,p_history jsonb
) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
 entry record; item record; order_item record; stock_item record;
 row_value jsonb; before_value jsonb; after_value jsonb; snapshot jsonb; order_value jsonb; line_value jsonb;
 draft jsonb; stock jsonb; ref_customer jsonb; ref_product jsonb;
 refs jsonb; origins jsonb:='[]'::jsonb; nulls jsonb:='[]'::jsonb;
 audit_customer uuid; order_customer uuid; order_id uuid; line_customer uuid; line_order uuid; line_id uuid;
 key_id uuid; resolved_key uuid; stock_id uuid; stock_customer uuid; product_id uuid; resolved_product uuid;
 seen_line boolean:=false; seen_stock boolean:=false;
 source_kind text; operation text; form text; state_name text; side text; field text;
 base_path text; state_path text; order_path text; line_path text; stock_path text; origin_path text;
 member_orders uuid[]; seen_ids uuid[]; fields text[];
 quantity numeric; unit_price numeric; error_code text; error_path text;
BEGIN
 IF p_customer IS NULL OR p_order IS NULL OR p_line IS NULL THEN
  PERFORM private.catalog_rcl_fail_v1('INVALID_UUID','input');
 END IF;
 ref_customer:=jsonb_build_object('kind','customer','id',p_customer::text);
 PERFORM private.catalog_rcl_keys_v1(p_history,ARRAY['snapshots'],'history');
 IF jsonb_typeof(p_history->'snapshots') IS DISTINCT FROM 'array' THEN
  PERFORM private.catalog_rcl_fail_v1('UNKNOWN_SHAPE','history.snapshots');
 END IF;
 FOR entry IN SELECT value,ordinality FROM jsonb_array_elements(p_history->'snapshots') WITH ORDINALITY LOOP
  base_path:='history.snapshots['||(entry.ordinality-1)::text||']';
  PERFORM private.catalog_rcl_keys_v1(entry.value,ARRAY['source','row'],base_path);
  source_kind:=private.catalog_rcl_text_v1(entry.value->'source',base_path||'.source');
  IF source_kind NOT IN ('private.co_audit_events','private.co_stock_keys') THEN
   PERFORM private.catalog_rcl_fail_v1('UNKNOWN_RELATION',base_path||'.source');
  END IF;
  row_value:=entry.value->'row'; base_path:=base_path||'.row';
  IF source_kind='private.co_stock_keys' THEN CONTINUE; END IF;
  PERFORM private.catalog_rcl_keys_v1(row_value,ARRAY['id','customer_id','actor_id','request_id','operation','reason',
   'before_state','after_state','delivery_revision_id','report_revision_id','return_revision_id','generation_id','created_at'],base_path);
  FOREACH field IN ARRAY ARRAY['id','actor_id'] LOOP
   PERFORM private.catalog_rcl_uuid_v1(row_value->field,base_path||'.'||field);
  END LOOP;
  FOREACH field IN ARRAY ARRAY['request_id','delivery_revision_id','report_revision_id','return_revision_id','generation_id'] LOOP
   PERFORM private.catalog_rcl_uuid_v1(row_value->field,base_path||'.'||field,true);
  END LOOP;
  audit_customer:=private.catalog_rcl_uuid_v1(row_value->'customer_id',base_path||'.customer_id');
  PERFORM private.catalog_rcl_text_v1(row_value->'reason',base_path||'.reason',true);
  PERFORM private.catalog_rcl_text_v1(row_value->'created_at',base_path||'.created_at');
  operation:=private.catalog_rcl_text_v1(row_value->'operation',base_path||'.operation');
  before_value:=row_value->'before_state'; after_value:=row_value->'after_state';
  IF operation IN ('create_co','edit_co','cancel_co','resolve_undelivered','close_co') THEN
   form:='order';
   IF operation='create_co' AND before_value IS DISTINCT FROM 'null'::jsonb THEN
    PERFORM private.catalog_rcl_fail_v1('UNKNOWN_SHAPE',base_path||'.before_state');
   END IF;
   IF operation<>'create_co' THEN
    PERFORM private.catalog_rcl_keys_v1(before_value,ARRAY['order','lines'],base_path||'.before_state');
   END IF;
   PERFORM private.catalog_rcl_keys_v1(after_value,ARRAY['order','lines'],base_path||'.after_state');
  ELSIF operation='post_sj' AND before_value?'co' THEN
   form:='ordinary';
   PERFORM private.catalog_rcl_keys_v1(before_value,ARRAY['co','draft'],base_path||'.before_state');
   PERFORM private.catalog_rcl_keys_v1(after_value,ARRAY['co','delivery_head_id','delivery_revision_id','generation_id'],base_path||'.after_state');
   FOREACH field IN ARRAY ARRAY['delivery_head_id','delivery_revision_id','generation_id'] LOOP
    PERFORM private.catalog_rcl_uuid_v1(after_value->field,base_path||'.after_state.'||field);
   END LOOP;
   draft:=before_value->'draft';
   IF jsonb_typeof(draft)='object' AND NOT draft?'evidence_id' THEN
    PERFORM private.catalog_rcl_fail_v1('UNSUPPORTED_LEGACY_PROFILE',base_path||'.before_state.draft');
   END IF;
   PERFORM private.catalog_rcl_keys_v1(draft,ARRAY['id','customer_id','kind','co_id','version','report_month','payload',
    'eligible_set_fingerprint','created_by','created_at','evidence_id'],base_path||'.before_state.draft');
   PERFORM private.catalog_rcl_uuid_v1(draft->'id',base_path||'.before_state.draft.id');
   PERFORM private.catalog_rcl_uuid_v1(draft->'created_by',base_path||'.before_state.draft.created_by');
   PERFORM private.catalog_rcl_uuid_v1(draft->'evidence_id',base_path||'.before_state.draft.evidence_id',true);
   IF private.catalog_rcl_uuid_v1(draft->'customer_id',base_path||'.before_state.draft.customer_id')<>audit_customer THEN
    PERFORM private.catalog_rcl_fail_v1('CROSS_CUSTOMER_LINEAGE',base_path||'.before_state.draft.customer_id');
   END IF;
   IF private.catalog_rcl_uuid_v1(draft->'co_id',base_path||'.before_state.draft.co_id') IS DISTINCT FROM
      private.catalog_rcl_uuid_v1(before_value#>'{co,order,id}',base_path||'.before_state.co.order.id') THEN
    PERFORM private.catalog_rcl_fail_v1('CROSS_ORDER_LINEAGE',base_path||'.before_state.draft.co_id');
   END IF;
   IF draft->>'kind' IS DISTINCT FROM 'sj' OR draft->'report_month' IS DISTINCT FROM 'null'::jsonb
      OR jsonb_typeof(draft->'payload') IS DISTINCT FROM 'object' THEN
    PERFORM private.catalog_rcl_fail_v1('UNKNOWN_SHAPE',base_path||'.before_state.draft');
   END IF;
   PERFORM private.catalog_rcl_number_v1(draft->'version',1,9223372036854775807,true,base_path||'.before_state.draft.version');
   PERFORM private.catalog_rcl_text_v1(draft->'created_at',base_path||'.before_state.draft.created_at');
   PERFORM private.catalog_rcl_text_v1(draft->'eligible_set_fingerprint',base_path||'.before_state.draft.eligible_set_fingerprint',true);
  ELSIF operation IN ('post_sj','post_return','correct_sj','correct_report','correct_return') THEN
   form:='sources';
   PERFORM private.catalog_rcl_keys_v1(after_value,ARRAY['sources','reopened','preview_fingerprint','source_context_fingerprint'],base_path||'.after_state');
   IF jsonb_typeof(after_value->'reopened') IS DISTINCT FROM 'array' THEN
    PERFORM private.catalog_rcl_fail_v1('UNKNOWN_SHAPE',base_path||'.after_state.reopened');
   END IF;
   FOREACH field IN ARRAY ARRAY['preview_fingerprint','source_context_fingerprint'] LOOP
    IF private.catalog_rcl_text_v1(after_value->field,base_path||'.after_state.'||field)!~'^[a-f0-9]{64}$' THEN
     PERFORM private.catalog_rcl_fail_v1('UNKNOWN_SHAPE',base_path||'.after_state.'||field);
    END IF;
   END LOOP;
  ELSE
   PERFORM private.catalog_rcl_fail_v1('UNKNOWN_OPERATION',base_path||'.operation');
  END IF;
  FOREACH state_name IN ARRAY ARRAY['before_state','after_state'] LOOP
   snapshot:=row_value->state_name;
   IF operation='create_co' AND state_name='before_state' THEN CONTINUE; END IF;
   side:=CASE state_name WHEN 'before_state' THEN 'OLD' ELSE 'NEW' END;
   state_path:=base_path||'.'||state_name;
   IF form='ordinary' THEN snapshot:=snapshot->'co'; state_path:=state_path||'.co'; END IF;
   IF form='sources' AND state_name='after_state' THEN snapshot:=snapshot->'sources'; state_path:=state_path||'.sources'; END IF;
   member_orders:='{}'::uuid[];
   IF form='sources' THEN
    PERFORM private.catalog_rcl_keys_v1(snapshot,ARRAY['customer_version','orders','delivery_heads','return_heads','deliveries','returns','reports','order_lines'],state_path);
    PERFORM private.catalog_rcl_version_v1(snapshot->'customer_version',state_path||'.customer_version');
    FOREACH field IN ARRAY ARRAY['orders','delivery_heads','return_heads','deliveries','returns','reports','order_lines'] LOOP
     IF jsonb_typeof(snapshot->field) IS DISTINCT FROM 'array' THEN
      PERFORM private.catalog_rcl_fail_v1('UNKNOWN_SHAPE',state_path||'.'||field);
     END IF;
    END LOOP;
    FOR order_item IN SELECT value,ordinality FROM jsonb_array_elements(snapshot->'orders') WITH ORDINALITY LOOP
     order_path:=state_path||'.orders['||(order_item.ordinality-1)::text||']';
     PERFORM private.catalog_rcl_keys_v1(order_item.value,ARRAY['id','version','status'],order_path);
     order_id:=private.catalog_rcl_uuid_v1(order_item.value->'id',order_path||'.id');
     PERFORM private.catalog_rcl_version_v1(order_item.value->'version',order_path||'.version');
     IF order_item.value->>'status' NOT IN ('active','closed','cancelled') OR jsonb_typeof(order_item.value->'status') IS DISTINCT FROM 'string'
       OR order_id=ANY(member_orders) THEN PERFORM private.catalog_rcl_fail_v1('UNKNOWN_SHAPE',order_path); END IF;
     member_orders:=array_append(member_orders,order_id);
    END LOOP;
    field:='order_lines';
   ELSE
    PERFORM private.catalog_rcl_keys_v1(snapshot,ARRAY['order','lines'],state_path);
    order_value:=snapshot->'order'; order_path:=state_path||'.order';
    PERFORM private.catalog_rcl_keys_v1(order_value,ARRAY['id','customer_id','version','status','co_number','order_date',
     'expected_delivery_date','notes','created_by','created_at','sales_person_id_at_creation','sales_assignment_source_id',
     'sales_attributed_at','sales_attribution_state'],order_path);
    order_id:=private.catalog_rcl_uuid_v1(order_value->'id',order_path||'.id');
    order_customer:=private.catalog_rcl_uuid_v1(order_value->'customer_id',order_path||'.customer_id');
    IF order_customer<>audit_customer THEN PERFORM private.catalog_rcl_fail_v1('CROSS_CUSTOMER_LINEAGE',order_path||'.customer_id'); END IF;
    PERFORM private.catalog_rcl_number_v1(order_value->'version',1,9223372036854775807,true,order_path||'.version');
    PERFORM private.catalog_rcl_uuid_v1(order_value->'created_by',order_path||'.created_by');
    PERFORM private.catalog_rcl_uuid_v1(order_value->'sales_person_id_at_creation',order_path||'.sales_person_id_at_creation',true);
    PERFORM private.catalog_rcl_uuid_v1(order_value->'sales_assignment_source_id',order_path||'.sales_assignment_source_id',true);
    FOREACH field IN ARRAY ARRAY['co_number','order_date','created_at','sales_attributed_at','sales_attribution_state'] LOOP
     PERFORM private.catalog_rcl_text_v1(order_value->field,order_path||'.'||field);
    END LOOP;
    FOREACH field IN ARRAY ARRAY['expected_delivery_date','notes'] LOOP
     PERFORM private.catalog_rcl_text_v1(order_value->field,order_path||'.'||field,true);
    END LOOP;
    IF order_value->>'status' NOT IN ('active','closed','cancelled') OR jsonb_typeof(order_value->'status') IS DISTINCT FROM 'string' THEN
     PERFORM private.catalog_rcl_fail_v1('UNKNOWN_SHAPE',order_path||'.status');
    END IF;
    IF NOT ((order_value->>'sales_attribution_state'='assigned' AND order_value->'sales_person_id_at_creation'<>'null'::jsonb AND order_value->'sales_assignment_source_id'<>'null'::jsonb)
      OR (order_value->>'sales_attribution_state'='unassigned' AND order_value->'sales_person_id_at_creation'='null'::jsonb AND order_value->'sales_assignment_source_id'='null'::jsonb)) THEN
     PERFORM private.catalog_rcl_fail_v1('UNKNOWN_SHAPE',order_path||'.sales_attribution_state');
    END IF;
    member_orders:=ARRAY[order_id]; field:='lines';
   END IF;
   IF jsonb_typeof(snapshot->field) IS DISTINCT FROM 'array' THEN
    PERFORM private.catalog_rcl_fail_v1('UNKNOWN_SHAPE',state_path||'.'||field);
   END IF;
   seen_ids:='{}'::uuid[];
   FOR item IN SELECT value,ordinality FROM jsonb_array_elements(snapshot->field) WITH ORDINALITY LOOP
    line_value:=item.value; line_path:=state_path||'.'||field||'['||(item.ordinality-1)::text||']';
    PERFORM private.catalog_rcl_keys_v1(line_value,ARRAY['id','co_id','customer_id','stock_key_id','ordered_quantity',
     'resolved_undelivered_quantity','unit_price','created_at'],line_path);
    line_id:=private.catalog_rcl_uuid_v1(line_value->'id',line_path||'.id');
    line_customer:=private.catalog_rcl_uuid_v1(line_value->'customer_id',line_path||'.customer_id');
    line_order:=private.catalog_rcl_uuid_v1(line_value->'co_id',line_path||'.co_id');
    key_id:=private.catalog_rcl_uuid_v1(line_value->'stock_key_id',line_path||'.stock_key_id');
    IF line_id=ANY(seen_ids) THEN PERFORM private.catalog_rcl_fail_v1('UNKNOWN_SHAPE',line_path||'.id'); END IF;
    seen_ids:=array_append(seen_ids,line_id);
    quantity:=private.catalog_rcl_number_v1(line_value->'ordered_quantity',1,2147483647,true,line_path||'.ordered_quantity');
    PERFORM private.catalog_rcl_number_v1(line_value->'resolved_undelivered_quantity',0,quantity,true,line_path||'.resolved_undelivered_quantity');
    unit_price:=private.catalog_rcl_number_v1(line_value->'unit_price',0,999999999999.99,false,line_path||'.unit_price');
    IF scale(unit_price)>2 THEN PERFORM private.catalog_rcl_fail_v1('UNKNOWN_SHAPE',line_path||'.unit_price'); END IF;
    PERFORM private.catalog_rcl_text_v1(line_value->'created_at',line_path||'.created_at');
    IF line_customer<>audit_customer THEN PERFORM private.catalog_rcl_fail_v1('CROSS_CUSTOMER_LINEAGE',line_path||'.customer_id'); END IF;
    IF NOT line_order=ANY(member_orders) THEN PERFORM private.catalog_rcl_fail_v1('CROSS_ORDER_LINEAGE',line_path||'.co_id'); END IF;
    IF line_id<>p_line THEN CONTINUE; END IF;
    IF audit_customer<>p_customer THEN PERFORM private.catalog_rcl_fail_v1('CROSS_CUSTOMER_LINEAGE',base_path||'.customer_id'); END IF;
    IF line_order<>p_order THEN PERFORM private.catalog_rcl_fail_v1('CROSS_ORDER_LINEAGE',line_path||'.co_id'); END IF;
    IF seen_line AND key_id IS DISTINCT FROM resolved_key THEN
     PERFORM private.catalog_rcl_fail_v1('CONTRADICTORY_LINEAGE',line_path||'.stock_key_id');
    END IF;
    seen_line:=true; resolved_key:=key_id;
    origins:=origins||jsonb_build_array(jsonb_build_object('ref',ref_customer,'rowSide',side,'path',base_path||'.customer_id'));
    IF form<>'sources' THEN
     origins:=origins||jsonb_build_array(jsonb_build_object('ref',ref_customer,'rowSide',side,'path',order_path||'.customer_id'));
    END IF;
    origins:=origins||jsonb_build_array(jsonb_build_object('ref',ref_customer,'rowSide',side,'path',line_path||'.customer_id'));
   END LOOP;
  END LOOP;
 END LOOP;
 IF NOT seen_line THEN PERFORM private.catalog_rcl_fail_v1('MISSING_LINEAGE','history.snapshots'); END IF;
 -- Resolve only the exact retained stock-key identity. Never use a live row,
 -- display_sku, normalized_sku, product_name or candidate batch ID to fill gaps.
 FOR stock_item IN SELECT value,ordinality FROM jsonb_array_elements(p_history->'snapshots') WITH ORDINALITY LOOP
  IF stock_item.value->>'source'<>'private.co_stock_keys' THEN CONTINUE; END IF;
  stock:=stock_item.value->'row'; stock_path:='history.snapshots['||(stock_item.ordinality-1)::text||'].row';
  PERFORM private.catalog_rcl_keys_v1(stock,ARRAY['id','customer_id','display_sku','normalized_sku','product_id','product_name','created_at'],stock_path);
  stock_id:=private.catalog_rcl_uuid_v1(stock->'id',stock_path||'.id');
  stock_customer:=private.catalog_rcl_uuid_v1(stock->'customer_id',stock_path||'.customer_id');
  product_id:=private.catalog_rcl_uuid_v1(stock->'product_id',stock_path||'.product_id',true);
  FOREACH field IN ARRAY ARRAY['display_sku','normalized_sku','product_name','created_at'] LOOP
   PERFORM private.catalog_rcl_text_v1(stock->field,stock_path||'.'||field);
  END LOOP;
  IF stock_id<>resolved_key THEN CONTINUE; END IF;
  IF stock_customer<>p_customer THEN PERFORM private.catalog_rcl_fail_v1('CROSS_CUSTOMER_LINEAGE',stock_path||'.customer_id'); END IF;
  IF seen_stock AND product_id IS DISTINCT FROM resolved_product THEN
   PERFORM private.catalog_rcl_fail_v1('CONTRADICTORY_LINEAGE',stock_path||'.product_id');
  END IF;
  seen_stock:=true; resolved_product:=product_id;
  -- Retained immutable relation observations use OLD; audit origins above retain
  -- their exact before/after side. Preserve every observation, dedup only refs.
  origins:=origins||jsonb_build_array(jsonb_build_object('ref',ref_customer,'rowSide','OLD','path',stock_path||'.customer_id'));
  IF product_id IS NULL THEN nulls:=nulls||jsonb_build_array(stock_path||'.product_id');
  ELSE
   ref_product:=jsonb_build_object('kind','product','id',product_id::text);
   origins:=origins||jsonb_build_array(jsonb_build_object('ref',ref_product,'rowSide','OLD','path',stock_path||'.product_id'));
  END IF;
 END LOOP;
 IF NOT seen_stock THEN PERFORM private.catalog_rcl_fail_v1('MISSING_LINEAGE','history.stock_key'); END IF;
 refs:=jsonb_build_array(ref_customer);
 IF resolved_product IS NOT NULL THEN refs:=refs||jsonb_build_array(jsonb_build_object('kind','product','id',resolved_product::text)); END IF;
 RETURN jsonb_build_object('ok',true,'extraction',jsonb_build_object('refs',refs,'edges','[]'::jsonb,'historicalNulls',nulls,'origins',origins));
EXCEPTION WHEN SQLSTATE 'PCL01' THEN
 GET STACKED DIAGNOSTICS error_code=MESSAGE_TEXT,error_path=PG_EXCEPTION_DETAIL;
 RETURN jsonb_build_object('ok',false,'code',error_code,'path',error_path);
END $$;

REVOKE ALL ON FUNCTION private.catalog_rcl_fail_v1(text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.catalog_rcl_keys_v1(jsonb,text[],text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.catalog_rcl_uuid_v1(jsonb,text,boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.catalog_rcl_text_v1(jsonb,text,boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.catalog_rcl_number_v1(jsonb,numeric,numeric,boolean,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.catalog_rcl_version_v1(jsonb,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.catalog_resolve_retired_co_line_v1(uuid,uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
