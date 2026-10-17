-- Bounded pure reference grammar only. No writer hooks or lifetime certification.
-- Inputs are actual trusted OLD/NEW rows and a complete trusted frozen collection.
-- Current promotion/customer/product tables are never queried by these functions.
-- Other relations, producer profiles and lineage families deliberately refuse.
-- The caller applies this forward fragment inside its identity-bound transaction.

CREATE FUNCTION private.catalog_po_require_v1(p_condition boolean, p_code text, p_path text) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
BEGIN
  IF p_condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE = 'PCE02', MESSAGE = p_code, DETAIL = p_path;
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_po_require_v1(boolean,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_po_keys_v1(p_value jsonb, p_keys text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
  SELECT CASE WHEN jsonb_typeof(p_value) = 'object' THEN
    (SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"),ARRAY[]::text[]) FROM jsonb_object_keys(p_value) k)
    = (SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"),ARRAY[]::text[]) FROM unnest(p_keys) k)
  ELSE false END;
$fn$;
REVOKE ALL ON FUNCTION private.catalog_po_keys_v1(jsonb,text[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_po_uuid_v1(p_value jsonb, p_path text, p_nullable boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
BEGIN
  IF p_nullable AND p_value = 'null'::jsonb THEN RETURN NULL; END IF;
  PERFORM private.catalog_po_require_v1(jsonb_typeof(p_value) = 'string'
    AND p_value #>> '{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', 'INVALID_UUID',p_path);
  -- Explicit canonical-hyphenated lexical profile; never infer from display text.
  RETURN (p_value #>> '{}')::uuid::text;
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_po_uuid_v1(jsonb,text,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_po_number_v1(p_value jsonb, p_min numeric, p_max numeric,
  p_integer boolean, p_code text, p_path text, p_nullable boolean DEFAULT false) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE n numeric;
BEGIN
  IF p_nullable AND p_value = 'null'::jsonb THEN RETURN NULL; END IF;
  PERFORM private.catalog_po_require_v1(jsonb_typeof(p_value) = 'number',p_code,p_path);
  n := (p_value #>> '{}')::numeric;
  PERFORM private.catalog_po_require_v1(n BETWEEN p_min AND p_max AND (NOT p_integer OR n = trunc(n)),p_code,p_path);
  RETURN n;
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_po_number_v1(jsonb,numeric,numeric,boolean,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_po_sorted_refs_v1(p_refs jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
  SELECT coalesce(jsonb_agg(ref ORDER BY CASE ref->>'kind' WHEN 'customer' THEN 0 ELSE 1 END,
    (ref->>'id')::uuid),'[]'::jsonb) FROM (SELECT DISTINCT value AS ref FROM jsonb_array_elements(p_refs)) refs;
$fn$;
REVOKE ALL ON FUNCTION private.catalog_po_sorted_refs_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_extract_promotion_owner_event_v1(p_relation regclass,p_op text,p_old jsonb,p_new jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE r jsonb; payload jsonb; receipt jsonb; assignment jsonb; before_row jsonb; after_row jsonb;
  side text; sub text; path text; operation text; campaign text; product text; customer text; actor text;
  value_id text; expected_version numeric; version numeric; amount numeric; key text;
  refs jsonb := '[]'; edges jsonb := '[]'; origins jsonb := '[]'; ref jsonb; expect jsonb;
  error_code text; error_path text;
BEGIN
  PERFORM private.catalog_po_require_v1(p_relation IN ('private.pilot_promotion_requests'::regclass,
    'private.pilot_store_owner_audit_v1'::regclass),'UNKNOWN_RELATION','relation');
  PERFORM private.catalog_po_require_v1(
    (p_op = 'INSERT' AND p_old IS NULL AND p_new IS NOT NULL AND p_new <> 'null'::jsonb)
    OR (p_op = 'UPDATE' AND p_old IS NOT NULL AND p_new IS NOT NULL AND p_old <> 'null'::jsonb AND p_new <> 'null'::jsonb)
    OR (p_op = 'DELETE' AND p_old IS NOT NULL AND p_old <> 'null'::jsonb AND p_new IS NULL),'INVALID_EVENT','event');
  FOREACH side IN ARRAY ARRAY['OLD','NEW'] LOOP
    r := CASE side WHEN 'OLD' THEN p_old ELSE p_new END;
    IF r IS NULL THEN CONTINUE; END IF;
    IF p_relation = 'private.pilot_promotion_requests'::regclass THEN
      PERFORM private.catalog_po_require_v1(private.catalog_po_keys_v1(r,ARRAY['actor_id','request_id','operation','payload','result','abandoned','created_at']),'UNKNOWN_SHAPE',side);
      actor := private.catalog_po_uuid_v1(r->'actor_id',side||'.actor_id');
      PERFORM private.catalog_po_uuid_v1(r->'request_id',side||'.request_id');
      PERFORM private.catalog_po_require_v1(jsonb_typeof(r->'created_at') = 'string','UNKNOWN_SHAPE',side||'.created_at');
      PERFORM private.catalog_po_require_v1(jsonb_typeof(r->'abandoned') = 'boolean','UNKNOWN_SHAPE',side||'.abandoned');
      PERFORM private.catalog_po_require_v1(jsonb_typeof(r->'operation') = 'string','UNKNOWN_OPERATION',side||'.operation');
      operation := r->>'operation'; payload := r->'payload'; receipt := r->'result';
      IF operation = 'promotion_recovery_abandoned' THEN
        PERFORM private.catalog_po_require_v1(private.catalog_po_keys_v1(payload,ARRAY[]::text[]),'UNKNOWN_SHAPE',side||'.payload');
        PERFORM private.catalog_po_require_v1(r->'abandoned' = 'true'::jsonb AND receipt = 'null'::jsonb,'UNKNOWN_SHAPE',side);
        CONTINUE;
      END IF;
      PERFORM private.catalog_po_require_v1(operation IN ('create_promotion','edit_promotion','adjust_stock','set_active'),'UNKNOWN_OPERATION',side||'.operation');
      PERFORM private.catalog_po_require_v1(private.catalog_po_keys_v1(payload,CASE operation
        WHEN 'create_promotion' THEN ARRAY['id','product_id','opening_quantity','image_path','harga_pokok','luar_kota','dalam_kota','depo_bangunan','is_active']
        WHEN 'edit_promotion' THEN ARRAY['promotion_id','expected_stock_version','image_path','harga_pokok','luar_kota','dalam_kota','depo_bangunan']
        WHEN 'adjust_stock' THEN ARRAY['promotion_id','expected_stock_version','quantity_delta','reason']
        WHEN 'set_active' THEN ARRAY['promotion_id','expected_stock_version','is_active'] END),'UNKNOWN_SHAPE',side||'.payload');
      expect := '{}'; expected_version := NULL;
      IF operation = 'create_promotion' THEN
        campaign := private.catalog_po_uuid_v1(payload->'id',side||'.payload.id');
        product := private.catalog_po_uuid_v1(payload->'product_id',side||'.payload.product_id');
        ref := jsonb_build_object('kind','product','id',product);
        refs := refs||jsonb_build_array(ref);
        origins := origins||jsonb_build_array(jsonb_build_object('ref',ref,'rowSide',side,'path',side||'.payload.product_id'));
        expect := jsonb_build_object('productId',product);
        path := side||'.payload.id';
        PERFORM private.catalog_po_number_v1(payload->'opening_quantity',0,2147483647,true,'UNKNOWN_SHAPE',side||'.payload.opening_quantity');
      ELSE
        campaign := private.catalog_po_uuid_v1(payload->'promotion_id',side||'.payload.promotion_id');
        path := side||'.payload.promotion_id';
        expected_version := private.catalog_po_number_v1(payload->'expected_stock_version',1,9223372036854775807,true,'UNKNOWN_VERSION',side||'.payload.expected_stock_version');
      END IF;
      IF operation IN ('create_promotion','edit_promotion') THEN
        PERFORM private.catalog_po_require_v1(jsonb_typeof(payload->'image_path') = 'string','UNKNOWN_SHAPE',side||'.payload.image_path');
        FOREACH key IN ARRAY ARRAY['harga_pokok','luar_kota','dalam_kota','depo_bangunan'] LOOP
          amount := private.catalog_po_number_v1(payload->key,0,999999999999.99,false,'UNKNOWN_SHAPE',side||'.payload.'||key,true);
          PERFORM private.catalog_po_require_v1(amount IS NULL OR amount = round(amount,2),'UNKNOWN_SHAPE',side||'.payload.'||key);
        END LOOP;
      END IF;
      IF operation IN ('create_promotion','set_active') THEN
        PERFORM private.catalog_po_require_v1(jsonb_typeof(payload->'is_active') = 'boolean','UNKNOWN_SHAPE',side||'.payload.is_active');
      ELSIF operation = 'adjust_stock' THEN
        amount := private.catalog_po_number_v1(payload->'quantity_delta',-2147483647,2147483647,true,'UNKNOWN_SHAPE',side||'.payload.quantity_delta');
        PERFORM private.catalog_po_require_v1(amount <> 0,'UNKNOWN_SHAPE',side||'.payload.quantity_delta');
        PERFORM private.catalog_po_require_v1(jsonb_typeof(payload->'reason') = 'string' AND length(btrim(payload->>'reason')) > 0
          AND length(payload->>'reason') <= 1000,'UNKNOWN_SHAPE',side||'.payload.reason');
      END IF;
      edges := edges||jsonb_build_array(jsonb_build_object('kind','promotion','id',campaign,'origin',path,'expect',expect));
      IF receipt <> 'null'::jsonb THEN
        PERFORM private.catalog_po_require_v1(private.catalog_po_keys_v1(receipt,ARRAY['id','stock_version']),'UNKNOWN_SHAPE',side||'.result');
        value_id := private.catalog_po_uuid_v1(receipt->'id',side||'.result.id');
        PERFORM private.catalog_po_require_v1(value_id = campaign,'CONTRADICTORY_LINEAGE',side||'.result.id');
        version := private.catalog_po_number_v1(receipt->'stock_version',1,9223372036854775807,true,'UNKNOWN_VERSION',side||'.result.stock_version');
        PERFORM private.catalog_po_require_v1(version = CASE WHEN operation = 'create_promotion' THEN 1 ELSE expected_version+1 END,'CONTRADICTORY_LINEAGE',side||'.result.stock_version');
        PERFORM private.catalog_po_require_v1(r->'abandoned' = 'false'::jsonb,'CONTRADICTORY_LINEAGE',side||'.abandoned');
        edges := edges||jsonb_build_array(jsonb_build_object('kind','promotion','id',campaign,'origin',side||'.result.id','expect',expect));
      END IF;
    ELSE
      PERFORM private.catalog_po_require_v1(private.catalog_po_keys_v1(r,ARRAY['id','customer_id','changed_by','before_assignment','after_assignment','changed_at']),'UNKNOWN_SHAPE',side);
      PERFORM private.catalog_po_uuid_v1(r->'id',side||'.id');
      customer := private.catalog_po_uuid_v1(r->'customer_id',side||'.customer_id');
      actor := private.catalog_po_uuid_v1(r->'changed_by',side||'.changed_by');
      PERFORM private.catalog_po_require_v1(jsonb_typeof(r->'changed_at') = 'string','UNKNOWN_SHAPE',side||'.changed_at');
      ref := jsonb_build_object('kind','customer','id',customer); refs := refs||jsonb_build_array(ref);
      origins := origins||jsonb_build_array(jsonb_build_object('ref',ref,'rowSide',side,'path',side||'.customer_id'));
      before_row := r->'before_assignment'; after_row := r->'after_assignment';
      PERFORM private.catalog_po_require_v1(after_row <> 'null'::jsonb,'CONTRADICTORY_LINEAGE',side||'.after_assignment');
      FOREACH sub IN ARRAY ARRAY['before_assignment','after_assignment'] LOOP
        assignment := r->sub; path := side||'.'||sub;
        IF sub = 'before_assignment' AND assignment = 'null'::jsonb THEN CONTINUE; END IF;
        PERFORM private.catalog_po_require_v1(private.catalog_po_keys_v1(assignment,ARRAY['id','customer_id','manager_id','assigned_by','assigned_at','version']),'UNKNOWN_SHAPE',path);
        PERFORM private.catalog_po_uuid_v1(assignment->'id',path||'.id');
        value_id := private.catalog_po_uuid_v1(assignment->'customer_id',path||'.customer_id');
        PERFORM private.catalog_po_require_v1(value_id = customer,'CONTRADICTORY_LINEAGE',path||'.customer_id');
        PERFORM private.catalog_po_uuid_v1(assignment->'manager_id',path||'.manager_id',true);
        PERFORM private.catalog_po_uuid_v1(assignment->'assigned_by',path||'.assigned_by');
        PERFORM private.catalog_po_require_v1(jsonb_typeof(assignment->'assigned_at') = 'string'
          OR (sub = 'before_assignment' AND assignment->'assigned_at' = 'null'::jsonb),'UNKNOWN_SHAPE',path||'.assigned_at');
        PERFORM private.catalog_po_number_v1(assignment->'version',1,9223372036854775807,true,'UNKNOWN_VERSION',path||'.version');
        origins := origins||jsonb_build_array(jsonb_build_object('ref',ref,'rowSide',side,'path',path||'.customer_id'));
      END LOOP;
      IF before_row = 'null'::jsonb THEN
        PERFORM private.catalog_po_require_v1((after_row->>'version')::numeric = 1,'CONTRADICTORY_LINEAGE',side||'.after_assignment.version');
        PERFORM private.catalog_po_require_v1(after_row->'manager_id' <> 'null'::jsonb,'CONTRADICTORY_LINEAGE',side||'.after_assignment.manager_id');
      ELSE
        PERFORM private.catalog_po_require_v1((before_row->>'id')::uuid = (after_row->>'id')::uuid,'CONTRADICTORY_LINEAGE',side||'.after_assignment.id');
        PERFORM private.catalog_po_require_v1((after_row->>'version')::numeric = (before_row->>'version')::numeric+1,'CONTRADICTORY_LINEAGE',side||'.after_assignment.version');
        PERFORM private.catalog_po_require_v1((before_row->>'manager_id')::uuid IS DISTINCT FROM (after_row->>'manager_id')::uuid,'CONTRADICTORY_LINEAGE',side||'.after_assignment.manager_id');
      END IF;
      PERFORM private.catalog_po_require_v1((after_row->>'assigned_by')::uuid::text = actor,'CONTRADICTORY_LINEAGE',side||'.after_assignment.assigned_by');
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'extraction',jsonb_build_object('refs',private.catalog_po_sorted_refs_v1(refs),
    'edges',edges,'historicalNulls','[]'::jsonb,'origins',origins));
EXCEPTION WHEN SQLSTATE 'PCE02' THEN
  GET STACKED DIAGNOSTICS error_code = MESSAGE_TEXT, error_path = PG_EXCEPTION_DETAIL;
  RETURN jsonb_build_object('ok',false,'code',error_code,'path',error_path);
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_extract_promotion_owner_event_v1(regclass,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_resolve_promotion_edges_v1(p_extraction jsonb,p_history jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE ex jsonb; entry jsonb; row_data jsonb; edge jsonb; ref jsonb; origin jsonb; expect jsonb; path text; side text; key text;
  campaign text; product text; found_product text; value_id text; amount numeric; ix integer; counterpart jsonb; counterpart_count integer;
  refs jsonb; origins jsonb; snapshots jsonb := '[]'; edges jsonb;
  error_code text; error_path text;
BEGIN
  PERFORM private.catalog_po_require_v1(private.catalog_po_keys_v1(p_history,ARRAY['snapshots'])
    AND jsonb_typeof(p_history->'snapshots') = 'array','UNKNOWN_SHAPE','history');
  PERFORM private.catalog_po_require_v1(private.catalog_po_keys_v1(p_extraction,ARRAY['ok','extraction'])
    AND p_extraction->'ok' = 'true'::jsonb,'UNKNOWN_SHAPE','extraction');
  ex := p_extraction->'extraction';
  PERFORM private.catalog_po_require_v1(private.catalog_po_keys_v1(ex,ARRAY['refs','edges','historicalNulls','origins'])
    AND jsonb_typeof(ex->'refs') = 'array' AND jsonb_typeof(ex->'edges') = 'array'
    AND ex->'historicalNulls' = '[]'::jsonb AND jsonb_typeof(ex->'origins') = 'array','UNKNOWN_SHAPE','extraction');
  refs := '[]'; origins := ex->'origins'; edges := ex->'edges';
  ix := 0;
  FOR ref IN SELECT value FROM jsonb_array_elements(ex->'refs') LOOP
    path := 'extraction.refs['||ix||']';
    PERFORM private.catalog_po_require_v1(private.catalog_po_keys_v1(ref,ARRAY['kind','id']) AND ref->>'kind' IN ('customer','product'),'UNKNOWN_SHAPE',path);
    value_id := private.catalog_po_uuid_v1(ref->'id',path||'.id');
    refs := refs||jsonb_build_array(jsonb_build_object('kind',ref->>'kind','id',value_id)); ix := ix+1;
  END LOOP;
  ix := 0;
  FOR origin IN SELECT value FROM jsonb_array_elements(origins) LOOP
    path := 'extraction.origins['||ix||']';
    PERFORM private.catalog_po_require_v1(private.catalog_po_keys_v1(origin,ARRAY['ref','rowSide','path'])
      AND origin->>'rowSide' IN ('OLD','NEW') AND jsonb_typeof(origin->'path') = 'string'
      AND left(origin->>'path',4) = (origin->>'rowSide')||'.','UNKNOWN_SHAPE',path);
    ref := origin->'ref';
    PERFORM private.catalog_po_require_v1(private.catalog_po_keys_v1(ref,ARRAY['kind','id']) AND ref->>'kind' IN ('customer','product'),'UNKNOWN_SHAPE',path||'.ref');
    value_id := private.catalog_po_uuid_v1(ref->'id',path||'.ref.id');
    PERFORM private.catalog_po_require_v1(ref = jsonb_build_object('kind',ref->>'kind','id',value_id)
      AND refs @> jsonb_build_array(ref),'CONTRADICTORY_LINEAGE',path||'.ref'); ix := ix+1;
  END LOOP;
  -- Every direct reference must carry at least one exact OLD/NEW occurrence.
  FOR ref IN SELECT value FROM jsonb_array_elements(refs) LOOP
    PERFORM private.catalog_po_require_v1(EXISTS(SELECT 1 FROM jsonb_array_elements(origins) o WHERE o->'ref' = ref),'CONTRADICTORY_LINEAGE','extraction.origins');
  END LOOP;
  ix := 0;
  FOR entry IN SELECT value FROM jsonb_array_elements(p_history->'snapshots') LOOP
    path := 'history.snapshots['||ix||']';
    PERFORM private.catalog_po_require_v1(private.catalog_po_keys_v1(entry,ARRAY['source','row']),'UNKNOWN_SHAPE',path);
    PERFORM private.catalog_po_require_v1(entry->>'source' = 'public.promotions','UNKNOWN_RELATION',path||'.source');
    row_data := entry->'row'; path := path||'.row';
    PERFORM private.catalog_po_require_v1(private.catalog_po_keys_v1(row_data,ARRAY['id','product_id','start_date','end_date','harga_pokok','luar_kota','dalam_kota','depo_bangunan','created_by','created_at','is_active','stock_managed','remaining_quantity','stock_version','image_path']),'UNKNOWN_SHAPE',path);
    campaign := private.catalog_po_uuid_v1(row_data->'id',path||'.id');
    product := private.catalog_po_uuid_v1(row_data->'product_id',path||'.product_id');
    PERFORM private.catalog_po_uuid_v1(row_data->'created_by',path||'.created_by');
    PERFORM private.catalog_po_require_v1(jsonb_typeof(row_data->'start_date') = 'string' AND jsonb_typeof(row_data->'end_date') = 'string'
      AND jsonb_typeof(row_data->'created_at') IN ('string','null'),'UNKNOWN_SHAPE',path);
    PERFORM private.catalog_po_require_v1(jsonb_typeof(row_data->'is_active') = 'boolean'
      AND jsonb_typeof(row_data->'stock_managed') = 'boolean','UNKNOWN_SHAPE',path);
    PERFORM private.catalog_po_require_v1(jsonb_typeof(row_data->'image_path') IN ('string','null')
      AND (row_data->'stock_managed' = 'false'::jsonb OR jsonb_typeof(row_data->'image_path') = 'string'),'UNKNOWN_SHAPE',path||'.image_path');
    PERFORM private.catalog_po_number_v1(row_data->'stock_version',1,9223372036854775807,true,'UNKNOWN_VERSION',path||'.stock_version');
    PERFORM private.catalog_po_number_v1(row_data->'remaining_quantity',0,2147483647,true,'UNKNOWN_SHAPE',path||'.remaining_quantity');
    FOREACH key IN ARRAY ARRAY['harga_pokok','luar_kota','dalam_kota','depo_bangunan'] LOOP
      amount := private.catalog_po_number_v1(row_data->key,0,999999999999.99,false,'UNKNOWN_SHAPE',path||'.'||key,true);
      PERFORM private.catalog_po_require_v1(amount IS NULL OR amount = round(amount,2),'UNKNOWN_SHAPE',path||'.'||key);
    END LOOP;
    snapshots := snapshots||jsonb_build_array(jsonb_build_object('id',campaign,'product_id',product)); ix := ix+1;
  END LOOP;
  ix := 0;
  FOR edge IN SELECT value FROM jsonb_array_elements(edges) LOOP
    path := 'extraction.edges['||ix||']';
    PERFORM private.catalog_po_require_v1(private.catalog_po_keys_v1(edge,ARRAY['kind','id','origin','expect']),'UNKNOWN_SHAPE',path);
    PERFORM private.catalog_po_require_v1(edge->>'kind' = 'promotion','UNKNOWN_RELATION',path||'.kind');
    campaign := private.catalog_po_uuid_v1(edge->'id',path||'.id'); expect := edge->'expect';
    PERFORM private.catalog_po_require_v1(private.catalog_po_keys_v1(expect,ARRAY[]::text[])
      OR private.catalog_po_keys_v1(expect,ARRAY['productId']),'UNKNOWN_SHAPE',path||'.expect');
    IF expect ? 'productId' THEN PERFORM private.catalog_po_uuid_v1(expect->'productId',path||'.expect.productId'); END IF;
    PERFORM private.catalog_po_require_v1(jsonb_typeof(edge->'origin') = 'string'
      AND edge->>'origin' IN ('OLD.payload.id','NEW.payload.id','OLD.payload.promotion_id','NEW.payload.promotion_id','OLD.result.id','NEW.result.id'),'UNKNOWN_SHAPE',path||'.origin');
    -- The create payload origin itself requires the known product constraint.
    -- Never treat a dropped expectation as an unconstrained campaign lookup.
    IF edge->>'origin' IN ('OLD.payload.id','NEW.payload.id') THEN
      PERFORM private.catalog_po_require_v1(expect ? 'productId','CONTRADICTORY_LINEAGE',path||'.expect');
    ELSIF edge->>'origin' IN ('OLD.payload.promotion_id','NEW.payload.promotion_id') THEN
      PERFORM private.catalog_po_require_v1(expect = '{}'::jsonb,'CONTRADICTORY_LINEAGE',path||'.expect');
    END IF;
    IF expect ? 'productId' THEN
      PERFORM private.catalog_po_require_v1(EXISTS(SELECT 1 FROM jsonb_array_elements(origins) o
        WHERE o->>'path' = left(edge->>'origin',3)||'.payload.product_id'
          AND o->'ref' = jsonb_build_object('kind','product','id',(expect->>'productId')::uuid::text)),
        'CONTRADICTORY_LINEAGE',path||'.expect');
    END IF;
    IF edge->>'origin' IN ('OLD.result.id','NEW.result.id') THEN
      SELECT count(*),jsonb_agg(value)->0 INTO counterpart_count,counterpart
        FROM jsonb_array_elements(edges)
        WHERE value->>'origin' IN (left(edge->>'origin',3)||'.payload.id',left(edge->>'origin',3)||'.payload.promotion_id');
      PERFORM private.catalog_po_require_v1(counterpart_count = 1,'CONTRADICTORY_LINEAGE',path||'.origin');
      value_id := private.catalog_po_uuid_v1(counterpart->'id',path||'.id');
      PERFORM private.catalog_po_require_v1(value_id = campaign,'CONTRADICTORY_LINEAGE',path||'.id');
      PERFORM private.catalog_po_require_v1(counterpart->'expect' = expect,'CONTRADICTORY_LINEAGE',path||'.expect');
    END IF;
    path := edge->>'origin'; side := left(path,3); found_product := NULL;
    FOR row_data IN SELECT value FROM jsonb_array_elements(snapshots) WHERE value->>'id' = campaign LOOP
      product := row_data->>'product_id';
      PERFORM private.catalog_po_require_v1(found_product IS NULL OR found_product = product,'CONTRADICTORY_LINEAGE',path);
      found_product := product;
    END LOOP;
    PERFORM private.catalog_po_require_v1(found_product IS NOT NULL,'MISSING_LINEAGE',path);
    IF expect ? 'productId' THEN
      PERFORM private.catalog_po_require_v1((expect->>'productId')::uuid::text = found_product,'CONTRADICTORY_LINEAGE',path);
    END IF;
    ref := jsonb_build_object('kind','product','id',found_product); refs := refs||jsonb_build_array(ref);
    origins := origins||jsonb_build_array(jsonb_build_object('ref',ref,'rowSide',side,'path',path)); ix := ix+1;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'extraction',jsonb_build_object('refs',private.catalog_po_sorted_refs_v1(refs),
    'edges','[]'::jsonb,'historicalNulls','[]'::jsonb,'origins',origins));
EXCEPTION WHEN SQLSTATE 'PCE02' THEN
  GET STACKED DIAGNOSTICS error_code = MESSAGE_TEXT, error_path = PG_EXCEPTION_DETAIL;
  RETURN jsonb_build_object('ok',false,'code',error_code,'path',error_path);
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_resolve_promotion_edges_v1(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_validate_promotion_owner_event_v1(p_relation regclass,p_op text,p_old jsonb,p_new jsonb,p_history jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE extraction jsonb;
BEGIN
  extraction := private.catalog_extract_promotion_owner_event_v1(p_relation,p_op,p_old,p_new);
  IF extraction->'ok' = 'false'::jsonb THEN RETURN extraction; END IF;
  RETURN private.catalog_resolve_promotion_edges_v1(extraction,p_history);
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_validate_promotion_owner_event_v1(regclass,text,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Installation metadata gate only; no data or writer topology is inspected.
-- Unexpected default grants are a blocker, not permission to broaden access.
DO $owner_acl$
DECLARE signature text; f record;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'private.catalog_po_require_v1(boolean,text,text)',
    'private.catalog_po_keys_v1(jsonb,text[])',
    'private.catalog_po_uuid_v1(jsonb,text,boolean)',
    'private.catalog_po_number_v1(jsonb,numeric,numeric,boolean,text,text,boolean)',
    'private.catalog_po_sorted_refs_v1(jsonb)',
    'private.catalog_extract_promotion_owner_event_v1(regclass,text,jsonb,jsonb)',
    'private.catalog_resolve_promotion_edges_v1(jsonb,jsonb)',
    'private.catalog_validate_promotion_owner_event_v1(regclass,text,jsonb,jsonb,jsonb)'
  ] LOOP
    SELECT p.* INTO STRICT f FROM pg_catalog.pg_proc p WHERE p.oid = signature::regprocedure;
    IF f.proowner <> 'postgres'::regrole OR f.prosecdef OR f.provolatile <> 'i'
      OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']
      OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a
        WHERE a.grantee <> f.proowner) THEN
      RAISE EXCEPTION 'CATALOGUE_PROMOTION_OWNER_ACL_DRIFT' USING ERRCODE = '42501';
    END IF;
  END LOOP;
END $owner_acl$;
