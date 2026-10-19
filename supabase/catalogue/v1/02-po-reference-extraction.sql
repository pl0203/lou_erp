-- Pure, bounded PUBLIC source grammar, not a lifetime-use validator or cutover.
-- Trusted table dispatch supplies actual OLD/NEW and a server-selected profile.
-- Edges remain unresolved. No current-master lookup, lineage collector, caller
-- replay exemption, business mutation, locks, hooks or readiness certification.
-- Named historical grammars: pilot_order_transaction@202609300002 (version 0),
-- pilot_finalize_visit@202609300004 (version 0), and raw item normalization
-- pilot_validate_order_lines@202609300002 (both admitted execution versions).
-- Canonical-hyphenated UUID strings are the admitted lexical profile; other
-- PostgreSQL UUID spellings refuse for separate historical classification.
-- Raw extra keys remain unclassified and refuse even where old writers kept them.

CREATE FUNCTION private.catalog_por_require_v1(p_ok boolean,p_code text,p_path text) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
BEGIN
 IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION USING ERRCODE='PCE03',MESSAGE=p_code,DETAIL=p_path; END IF;
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_por_require_v1(boolean,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_por_allowed_v1(p_value jsonb,p_required text[],p_optional text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
 SELECT CASE WHEN jsonb_typeof(p_value)='object' THEN p_value ?& p_required
 AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(p_value) k WHERE NOT k=ANY(p_required||p_optional)) ELSE false END;
$fn$;
REVOKE ALL ON FUNCTION private.catalog_por_allowed_v1(jsonb,text[],text[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_por_keys_v1(p_value jsonb,p_keys text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
 SELECT private.catalog_por_allowed_v1(p_value,p_keys,ARRAY[]::text[]);
$fn$;
REVOKE ALL ON FUNCTION private.catalog_por_keys_v1(jsonb,text[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_por_uuid_v1(p_value jsonb,p_path text,p_nullable boolean DEFAULT false,p_raw boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
BEGIN
 IF p_nullable AND (p_value IS NULL OR p_value='null'::jsonb OR (p_raw AND p_value='""'::jsonb)) THEN RETURN NULL; END IF;
 PERFORM private.catalog_por_require_v1(jsonb_typeof(p_value)='string' AND p_value#>>'{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$','INVALID_UUID',p_path);
 RETURN (p_value#>>'{}')::uuid::text;
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_por_uuid_v1(jsonb,text,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_por_number_v1(p_value jsonb,p_min numeric,p_max numeric,p_integer boolean,p_path text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE n numeric;
BEGIN
 PERFORM private.catalog_por_require_v1(jsonb_typeof(p_value)='number','UNKNOWN_SHAPE',p_path);
 n:=(p_value#>>'{}')::numeric;
 PERFORM private.catalog_por_require_v1(n BETWEEN p_min AND p_max AND (NOT p_integer OR n=trunc(n)),'UNKNOWN_SHAPE',p_path);
 RETURN n;
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_por_number_v1(jsonb,numeric,numeric,boolean,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_por_ref_v1(p_state jsonb,p_kind text,p_id text,p_side text,p_path text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
 SELECT jsonb_set(jsonb_set(p_state,'{refs}',(p_state->'refs')||jsonb_build_array(jsonb_build_object('kind',p_kind,'id',p_id))),
 '{origins}',(p_state->'origins')||jsonb_build_array(jsonb_build_object('ref',jsonb_build_object('kind',p_kind,'id',p_id),'rowSide',p_side,'path',p_path)));
$fn$;
REVOKE ALL ON FUNCTION private.catalog_por_ref_v1(jsonb,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_por_edge_v1(p_state jsonb,p_kind text,p_id text,p_path text,p_customer text DEFAULT NULL,p_order text DEFAULT NULL,p_expect jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
 SELECT jsonb_set(p_state,'{edges}',(p_state->'edges')||jsonb_build_array(
 jsonb_build_object('kind',p_kind,'id',p_id,'origin',p_path,'expect',p_expect)
 ||CASE WHEN p_customer IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('customerId',p_customer) END
 ||CASE WHEN p_order IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('orderId',p_order) END));
$fn$;
REVOKE ALL ON FUNCTION private.catalog_por_edge_v1(jsonb,text,text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_por_items_v1(p_state jsonb,p_items jsonb,p_profile text,p_side text,p_path text,p_customer text,p_order text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE state jsonb:=p_state; item jsonb; pos bigint; path text; product text; line text; promotion text; owner text; amount numeric; price numeric; total numeric:=0; expect jsonb; key text;
BEGIN
 PERFORM private.catalog_por_require_v1(p_profile IN ('raw-create','raw-edit','raw-sales','saved-po','normalized-po','saved-sj','normalized-sj','raw-sj'),'UNSUPPORTED_LEGACY_PROFILE',p_path);
 PERFORM private.catalog_por_require_v1(jsonb_typeof(p_items)='array','UNKNOWN_SHAPE',p_path);
 IF p_profile LIKE 'raw-%' THEN PERFORM private.catalog_por_require_v1(jsonb_array_length(p_items)>0,'UNKNOWN_SHAPE',p_path); END IF;
 FOR item,pos IN SELECT value,ordinality-1 FROM jsonb_array_elements(p_items) WITH ORDINALITY LOOP
  path:=p_path||'['||pos::text||']';
  IF p_profile IN ('saved-sj','normalized-sj','raw-sj') THEN
   PERFORM private.catalog_por_require_v1(private.catalog_por_keys_v1(item,CASE WHEN p_profile='saved-sj' THEN ARRAY['id','surat_jalan_id','po_line_item_id','quantity_delivered'] ELSE ARRAY['po_line_item_id','quantity_delivered'] END),'UNKNOWN_SHAPE',path);
   line:=private.catalog_por_uuid_v1(item->'po_line_item_id',path||'.po_line_item_id');
   state:=private.catalog_por_edge_v1(state,'po_line',line,path||'.po_line_item_id',p_customer,p_order);
   amount:=private.catalog_por_number_v1(item->'quantity_delivered',0,2147483647,true,path||'.quantity_delivered');
   IF p_profile='saved-sj' THEN
    PERFORM private.catalog_por_uuid_v1(item->'id',path||'.id');
    owner:=private.catalog_por_uuid_v1(item->'surat_jalan_id',path||'.surat_jalan_id');
    state:=private.catalog_por_edge_v1(state,'delivery',owner,path||'.surat_jalan_id',p_customer,p_order);
   END IF;
   CONTINUE;
  END IF;
  IF p_profile='saved-po' THEN
   -- Named pre-product-column row omits only product_id; all other row columns required.
   PERFORM private.catalog_por_require_v1(private.catalog_por_allowed_v1(item,ARRAY['id','purchase_order_id','product_name','sku','quantity','unit_price','line_total'],ARRAY['product_id']),'UNKNOWN_SHAPE',path);
   owner:=private.catalog_por_uuid_v1(item->'purchase_order_id',path||'.purchase_order_id');
   PERFORM private.catalog_por_require_v1(owner=p_order,'CROSS_ORDER_LINEAGE',path||'.purchase_order_id');
  ELSIF p_profile='normalized-po' THEN
   PERFORM private.catalog_por_require_v1(private.catalog_por_keys_v1(item,ARRAY['id','product_id','product_name','sku','quantity','unit_price','is_promo','promotion_id']),'UNKNOWN_SHAPE',path);
  ELSE
   PERFORM private.catalog_por_require_v1(private.catalog_por_allowed_v1(item,ARRAY['product_name','quantity','unit_price'],ARRAY['id','product_id','sku','is_promo','promotion_id']),'UNKNOWN_SHAPE',path);
  END IF;
  PERFORM private.catalog_por_require_v1(jsonb_typeof(item->'product_name')='string' AND length(btrim(item->>'product_name'))>0,'UNKNOWN_SHAPE',path||'.product_name');
  IF item ? 'sku' THEN PERFORM private.catalog_por_require_v1(jsonb_typeof(item->'sku')='string' OR item->'sku'='null'::jsonb,'UNKNOWN_SHAPE',path||'.sku'); END IF;
  amount:=private.catalog_por_number_v1(item->'quantity',1,2147483647,true,path||'.quantity');
  price:=private.catalog_por_number_v1(item->'unit_price',0,999999999999.99,false,path||'.unit_price');
  PERFORM private.catalog_por_require_v1(price=round(price,2),'UNKNOWN_SHAPE',path||'.unit_price');
  total:=total+amount*price;
  IF p_profile LIKE 'raw-%' OR p_profile='normalized-po' THEN PERFORM private.catalog_por_require_v1(total<=999999999999.99,'UNKNOWN_SHAPE',p_path); END IF;
  IF p_profile='saved-po' THEN
   PERFORM private.catalog_por_require_v1(private.catalog_por_number_v1(item->'line_total',0,999999999999.99,false,path||'.line_total')=amount*price,'UNKNOWN_SHAPE',path||'.line_total');
  END IF;
  product:=private.catalog_por_uuid_v1(item->'product_id',path||'.product_id',true,p_profile LIKE 'raw-%');
  IF product IS NULL THEN
   state:=jsonb_set(state,'{historicalNulls}',(state->'historicalNulls')||jsonb_build_array(path||'.product_id'));
  ELSE state:=private.catalog_por_ref_v1(state,'product',product,p_side,path||'.product_id'); END IF;
  expect:=CASE WHEN product IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('productId',product) END;
  line:=private.catalog_por_uuid_v1(item->'id',path||'.id',p_profile<>'saved-po',p_profile LIKE 'raw-%');
  -- A create item id is regenerated, not a persisted PO-line identity.
  IF line IS NOT NULL AND p_profile IN ('saved-po','normalized-po','raw-edit') THEN
   state:=private.catalog_por_edge_v1(state,'po_line',line,path||'.id',p_customer,p_order,expect);
  END IF;
  IF p_profile<>'saved-po' THEN
   IF item ? 'is_promo' THEN PERFORM private.catalog_por_require_v1(jsonb_typeof(item->'is_promo')='boolean' OR (p_profile LIKE 'raw-%' AND item->'is_promo'='null'::jsonb),'UNKNOWN_SHAPE',path||'.is_promo'); END IF;
   promotion:=private.catalog_por_uuid_v1(item->'promotion_id',path||'.promotion_id',true,p_profile LIKE 'raw-%');
   IF promotion IS NOT NULL THEN state:=private.catalog_por_edge_v1(state,'promotion',promotion,path||'.promotion_id',NULL,NULL,expect); END IF;
   IF p_profile='raw-sales' THEN
    PERFORM private.catalog_por_require_v1(CASE WHEN item->'is_promo'='true'::jsonb THEN product IS NOT NULL AND promotion IS NOT NULL ELSE promotion IS NULL END,'CONTRADICTORY_LINEAGE',path||'.promotion_id');
   END IF;
  END IF;
 END LOOP;
 RETURN state;
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_por_items_v1(jsonb,jsonb,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_por_ack_v1(p_state jsonb,p_ack jsonb,p_side text,p_path text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE state jsonb:=p_state; collection text; item jsonb; pos bigint; path text; product text; promotion text; key text; n numeric;
BEGIN
 PERFORM private.catalog_por_require_v1(private.catalog_por_keys_v1(p_ack,ARRAY['version','payload_hash','po_version','shortages','allocations']),'UNKNOWN_SHAPE',p_path);
 PERFORM private.catalog_por_require_v1(p_ack->'version'='1'::jsonb,'UNKNOWN_VERSION',p_path||'.version');
 PERFORM private.catalog_por_require_v1(jsonb_typeof(p_ack->'payload_hash')='string' AND (jsonb_typeof(p_ack->'po_version')='string' OR p_ack->'po_version'='null'::jsonb),'UNKNOWN_SHAPE',p_path);
 FOREACH collection IN ARRAY ARRAY['shortages','allocations'] LOOP
  PERFORM private.catalog_por_require_v1(jsonb_typeof(p_ack->collection)='array','UNKNOWN_SHAPE',p_path||'.'||collection);
  FOR item,pos IN SELECT value,ordinality-1 FROM jsonb_array_elements(p_ack->collection) WITH ORDINALITY LOOP
   path:=p_path||'.'||collection||'['||pos::text||']';
   PERFORM private.catalog_por_require_v1(private.catalog_por_keys_v1(item,ARRAY['promotion_id','product_id','product_name','sku','remaining_quantity','requested_quantity','incremental_quantity','stock_version']||CASE collection WHEN 'shortages' THEN ARRAY['shortfall'] ELSE ARRAY['allocation_quantity'] END),'UNKNOWN_SHAPE',path);
   product:=private.catalog_por_uuid_v1(item->'product_id',path||'.product_id');
   promotion:=private.catalog_por_uuid_v1(item->'promotion_id',path||'.promotion_id',collection='allocations');
   state:=private.catalog_por_ref_v1(state,'product',product,p_side,path||'.product_id');
   IF promotion IS NOT NULL THEN
    state:=private.catalog_por_edge_v1(state,'promotion',promotion,path||'.promotion_id',NULL,NULL,jsonb_build_object('productId',product));
    PERFORM private.catalog_por_number_v1(item->'stock_version',1,9223372036854775807,true,path||'.stock_version');
   ELSE PERFORM private.catalog_por_require_v1(item->'stock_version'='null'::jsonb,'CONTRADICTORY_LINEAGE',path||'.stock_version'); END IF;
   FOREACH key IN ARRAY ARRAY['product_name','sku'] LOOP
    PERFORM private.catalog_por_require_v1(jsonb_typeof(item->key)='string' OR item->key='null'::jsonb,'UNKNOWN_SHAPE',path||'.'||key);
   END LOOP;
   FOREACH key IN ARRAY ARRAY['remaining_quantity','requested_quantity','incremental_quantity',CASE collection WHEN 'shortages' THEN 'shortfall' ELSE 'allocation_quantity' END] LOOP
    n:=private.catalog_por_number_v1(item->key,0,9223372036854775807,true,path||'.'||key);
   END LOOP;
  END LOOP;
 END LOOP;
 RETURN state;
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_por_ack_v1(jsonb,jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_por_text_array_v1(p_value jsonb,p_path text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE parsed jsonb;
BEGIN
 PERFORM private.catalog_por_require_v1(jsonb_typeof(p_value)='string','INVALID_TEXT_JSON',p_path);
 BEGIN parsed:=(p_value#>>'{}')::jsonb;
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR untranslatable_character THEN
  RAISE EXCEPTION USING ERRCODE='PCE03',MESSAGE='INVALID_TEXT_JSON',DETAIL=p_path;
 END;
 PERFORM private.catalog_por_require_v1(jsonb_typeof(parsed)='array','INVALID_TEXT_JSON',p_path);
 RETURN parsed;
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_por_text_array_v1(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_por_extract_event_v1(p_relation regclass,p_op text,p_old jsonb,p_new jsonb,p_profile jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE
 state jsonb:='{"refs":[],"edges":[],"historicalNulls":[],"origins":[]}';
 r jsonb; payload jsonb; receipt jsonb; value jsonb; refs jsonb; required text[]; optional text[];
 side text; sub text; operation text; path text; key text; field text; customer text; po text; target text; result_id text; result_po text;
 version numeric; latitude numeric; longitude numeric; error_code text; error_path text;
BEGIN
 -- This constant is a local public-source admission profile, never target parity.
 PERFORM private.catalog_por_require_v1(p_profile='{"sourceCommit":"c38b14fd122fc5dd08080f9a48adce254e4c3e52","schemaProfile":"public-po-source-20261014","producerPinsSha256":"8085f8784fb1071ef91f994bb962af9731ea8c9a2aa61023fcf88b7b8be20cb1"}'::jsonb,'UNVERIFIED_SCHEMA','profile');
 PERFORM private.catalog_por_require_v1(p_relation IN ('private.pilot_order_requests'::regclass,'public.po_audit_log'::regclass),'UNKNOWN_RELATION','relation');
 PERFORM private.catalog_por_require_v1(
  (p_op='INSERT' AND p_old IS NULL AND p_new IS NOT NULL AND p_new<>'null'::jsonb)
  OR (p_op='UPDATE' AND p_old IS NOT NULL AND p_new IS NOT NULL AND p_old<>'null'::jsonb AND p_new<>'null'::jsonb)
  OR (p_op='DELETE' AND p_old IS NOT NULL AND p_old<>'null'::jsonb AND p_new IS NULL),'INVALID_EVENT','event');
 FOREACH side IN ARRAY ARRAY['OLD','NEW'] LOOP
  r:=CASE side WHEN 'OLD' THEN p_old ELSE p_new END;
  IF r IS NULL THEN CONTINUE; END IF;
  customer:=NULL; po:=NULL; target:=NULL; result_id:=NULL; result_po:=NULL;
  IF p_relation='private.pilot_order_requests'::regclass THEN
   PERFORM private.catalog_por_require_v1(private.catalog_por_keys_v1(r,ARRAY['actor_id','request_id','operation','payload','result','abandoned','created_at','execution_version']),'UNKNOWN_SHAPE',side);
   PERFORM private.catalog_por_uuid_v1(r->'actor_id',side||'.actor_id');
   PERFORM private.catalog_por_uuid_v1(r->'request_id',side||'.request_id');
   PERFORM private.catalog_por_require_v1(jsonb_typeof(r->'created_at')='string' AND jsonb_typeof(r->'abandoned')='boolean','UNKNOWN_SHAPE',side);
   PERFORM private.catalog_por_require_v1(r->'execution_version' IN ('0'::jsonb,'1'::jsonb),'UNKNOWN_VERSION',side||'.execution_version');
   version:=(r->>'execution_version')::numeric; operation:=r->>'operation'; payload:=r->'payload'; receipt:=r->'result';
   PERFORM private.catalog_por_require_v1(jsonb_typeof(r->'operation')='string' AND operation IN ('create_po','edit_po','submit_sales','approve_sales','reject_sales','save_delivery','void_delivery','cancel_po','edit_sj_returned_date','finalize_visit','recovery_abandoned'),'UNKNOWN_OPERATION',side||'.operation');
   IF operation='recovery_abandoned' THEN
    -- Public recovery INSERT uses the column's default execution_version=0.
    PERFORM private.catalog_por_require_v1(version=0,'UNSUPPORTED_LEGACY_PROFILE',side||'.execution_version');
    PERFORM private.catalog_por_require_v1(private.catalog_por_keys_v1(payload,ARRAY[]::text[]),'UNKNOWN_SHAPE',side||'.payload');
    PERFORM private.catalog_por_require_v1(r->'abandoned'='true'::jsonb AND receipt='null'::jsonb,'CONTRADICTORY_LINEAGE',side);
    CONTINUE;
   END IF;
   IF operation IN ('submit_sales','finalize_visit') THEN
    PERFORM private.catalog_por_require_v1(version=0,'UNSUPPORTED_LEGACY_PROFILE',side||'.execution_version');
   ELSIF operation='edit_sj_returned_date' THEN
    PERFORM private.catalog_por_require_v1(version=1,'UNSUPPORTED_LEGACY_PROFILE',side||'.execution_version');
   END IF;
   -- A pending or abandoned original operation still protects its original payload.
   PERFORM private.catalog_por_require_v1(receipt='null'::jsonb OR r->'abandoned'='false'::jsonb,'CONTRADICTORY_LINEAGE',side||'.abandoned');
   required:=CASE operation
    WHEN 'create_po' THEN ARRAY['customer_id','po_number','items']
    WHEN 'edit_po' THEN ARRAY['po_id','customer_id','items','expected_updated_at']
    WHEN 'submit_sales' THEN ARRAY['customer_id','visit_id','items']
    WHEN 'approve_sales' THEN ARRAY['order_id','po_number']
    WHEN 'reject_sales' THEN ARRAY['order_id','reason']
    WHEN 'save_delivery' THEN ARRAY['po_id','expected_updated_at','sj_number','sj_date','lines']
    WHEN 'void_delivery' THEN ARRAY['sj_id','expected_updated_at','reason']
    WHEN 'cancel_po' THEN ARRAY['po_id','expected_updated_at','reason']
    WHEN 'edit_sj_returned_date' THEN ARRAY['sj_id','expected_updated_at','sj_date_returned']
    WHEN 'finalize_visit' THEN ARRAY['schedule_id','storage_path'] END;
   optional:=CASE operation
    WHEN 'create_po' THEN ARRAY['order_date','expected_delivery_date','notes']
    WHEN 'edit_po' THEN ARRAY['expected_delivery_date','notes']
    WHEN 'approve_sales' THEN ARRAY['order_date','expected_delivery_date','notes']
    WHEN 'save_delivery' THEN ARRAY['sj_id','sj_date_received','sj_date_returned']
    WHEN 'finalize_visit' THEN ARRAY['lat','lng'] ELSE ARRAY[]::text[] END;
   IF version=1 AND operation IN ('create_po','edit_po','approve_sales') THEN optional:=optional||ARRAY['promo_stock_ack']; END IF;
   PERFORM private.catalog_por_require_v1(private.catalog_por_allowed_v1(payload,required,optional),'UNKNOWN_SHAPE',side||'.payload');
   -- Validate the saved receipt before constructing edges. Known cross-resource
   -- bindings must be data on those edges, never reconstructed from origin text.
   IF receipt<>'null'::jsonb THEN
    required:=CASE WHEN operation IN ('submit_sales','reject_sales','finalize_visit') THEN ARRAY['id']
     WHEN operation IN ('create_po','approve_sales') THEN ARRAY['id','updated_at'] ELSE ARRAY['id','po_id','updated_at'] END;
    PERFORM private.catalog_por_require_v1(private.catalog_por_keys_v1(receipt,required),'UNKNOWN_SHAPE',side||'.result');
    result_id:=private.catalog_por_uuid_v1(receipt->'id',side||'.result.id');
    IF receipt ? 'updated_at' THEN PERFORM private.catalog_por_require_v1(jsonb_typeof(receipt->'updated_at')='string','UNKNOWN_SHAPE',side||'.result.updated_at'); END IF;
    IF receipt ? 'po_id' THEN result_po:=private.catalog_por_uuid_v1(receipt->'po_id',side||'.result.po_id'); END IF;
   END IF;
   FOREACH key IN ARRAY ARRAY['po_number','sj_number','sj_date','expected_updated_at','reason','storage_path'] LOOP
    IF payload ? key THEN PERFORM private.catalog_por_require_v1(jsonb_typeof(payload->key)='string' AND length(btrim(payload->>key))>0,'UNKNOWN_SHAPE',side||'.payload.'||key); END IF;
   END LOOP;
   FOREACH key IN ARRAY ARRAY['order_date','expected_delivery_date','notes','sj_date_received','sj_date_returned'] LOOP
    IF payload ? key THEN PERFORM private.catalog_por_require_v1(jsonb_typeof(payload->key)='string' OR payload->key='null'::jsonb,'UNKNOWN_SHAPE',side||'.payload.'||key); END IF;
   END LOOP;
   IF payload ? 'customer_id' THEN
    customer:=private.catalog_por_uuid_v1(payload->'customer_id',side||'.payload.customer_id');
    state:=private.catalog_por_ref_v1(state,'customer',customer,side,side||'.payload.customer_id');
   END IF;
   IF payload ? 'po_id' THEN
    po:=private.catalog_por_uuid_v1(payload->'po_id',side||'.payload.po_id');
    state:=private.catalog_por_edge_v1(state,'po',po,side||'.payload.po_id',customer);
   END IF;
   IF payload ? 'order_id' THEN
    target:=private.catalog_por_uuid_v1(payload->'order_id',side||'.payload.order_id');
    state:=private.catalog_por_edge_v1(state,'girard_order',target,side||'.payload.order_id',NULL,NULL,
     CASE WHEN operation='approve_sales' AND result_id IS NOT NULL THEN jsonb_build_object('poId',result_id) ELSE '{}'::jsonb END);
   ELSIF operation='submit_sales' THEN
    target:=private.catalog_por_uuid_v1(payload->'visit_id',side||'.payload.visit_id');
    state:=private.catalog_por_edge_v1(state,'visit',target,side||'.payload.visit_id',customer);
   ELSIF operation='finalize_visit' THEN
    target:=private.catalog_por_uuid_v1(payload->'schedule_id',side||'.payload.schedule_id');
    state:=private.catalog_por_edge_v1(state,'schedule',target,side||'.payload.schedule_id');
    PERFORM private.catalog_por_require_v1(array_length(string_to_array(payload->>'storage_path','/'),1)=3
     AND split_part(payload->>'storage_path','/',1)='visits' AND split_part(payload->>'storage_path','/',2)=target
     AND split_part(payload->>'storage_path','/',3) NOT IN ('','.','..'),'UNKNOWN_SHAPE',side||'.payload.storage_path');
    latitude:=NULL; longitude:=NULL;
    IF payload ? 'lat' AND payload->'lat'<>'null'::jsonb THEN latitude:=private.catalog_por_number_v1(payload->'lat',-90,90,false,side||'.payload.lat'); END IF;
    IF payload ? 'lng' AND payload->'lng'<>'null'::jsonb THEN longitude:=private.catalog_por_number_v1(payload->'lng',-180,180,false,side||'.payload.lng'); END IF;
    PERFORM private.catalog_por_require_v1((latitude IS NULL)=(longitude IS NULL),'UNKNOWN_SHAPE',side||'.payload');
   END IF;
   IF payload ? 'sj_id' THEN
    target:=private.catalog_por_uuid_v1(payload->'sj_id',side||'.payload.sj_id',operation='save_delivery');
    IF target IS NOT NULL THEN state:=private.catalog_por_edge_v1(state,'delivery',target,side||'.payload.sj_id',customer,coalesce(po,result_po)); END IF;
   END IF;
   IF payload ? 'items' THEN
    state:=private.catalog_por_items_v1(state,payload->'items',CASE operation WHEN 'create_po' THEN 'raw-create' WHEN 'edit_po' THEN 'raw-edit' ELSE 'raw-sales' END,side,side||'.payload.items',customer,po);
   ELSIF operation='save_delivery' THEN
    state:=private.catalog_por_items_v1(state,payload->'lines','raw-sj',side,side||'.payload.lines',customer,po);
   END IF;
   IF payload ? 'promo_stock_ack' THEN state:=private.catalog_por_ack_v1(state,payload->'promo_stock_ack',side,side||'.payload.promo_stock_ack'); END IF;
   IF receipt<>'null'::jsonb THEN
    IF receipt ? 'po_id' THEN
     PERFORM private.catalog_por_require_v1(po IS NULL OR po=result_po,'CROSS_ORDER_LINEAGE',side||'.result.po_id');
     po:=result_po;
     state:=private.catalog_por_edge_v1(state,'po',po,side||'.result.po_id',customer);
    END IF;
    IF operation IN ('create_po','edit_po','approve_sales','cancel_po') THEN
     PERFORM private.catalog_por_require_v1(po IS NULL OR po=result_id,'CROSS_ORDER_LINEAGE',side||'.result.id');
     state:=private.catalog_por_edge_v1(state,'po',result_id,side||'.result.id',customer);
    ELSIF operation IN ('submit_sales','reject_sales') THEN
     PERFORM private.catalog_por_require_v1(operation<>'reject_sales' OR result_id=target,'CONTRADICTORY_LINEAGE',side||'.result.id');
     state:=private.catalog_por_edge_v1(state,'girard_order',result_id,side||'.result.id',customer,NULL,
      CASE WHEN operation='submit_sales' THEN jsonb_build_object('visitId',target) ELSE '{}'::jsonb END);
    ELSIF operation='finalize_visit' THEN
     state:=private.catalog_por_edge_v1(state,'visit',result_id,side||'.result.id',NULL,NULL,jsonb_build_object('scheduleId',target));
    ELSE
     PERFORM private.catalog_por_require_v1(target IS NULL OR target=result_id,'CONTRADICTORY_LINEAGE',side||'.result.id');
     state:=private.catalog_por_edge_v1(state,'delivery',result_id,side||'.result.id',customer,po);
    END IF;
   END IF;
  ELSE
   PERFORM private.catalog_por_require_v1(private.catalog_por_keys_v1(r,ARRAY['id','purchase_order_id','changed_by','field_changed','old_value','new_value','changed_at']),'UNKNOWN_SHAPE',side);
   PERFORM private.catalog_por_uuid_v1(r->'id',side||'.id');
   PERFORM private.catalog_por_uuid_v1(r->'changed_by',side||'.changed_by');
   po:=private.catalog_por_uuid_v1(r->'purchase_order_id',side||'.purchase_order_id');
   PERFORM private.catalog_por_require_v1(jsonb_typeof(r->'changed_at')='string','UNKNOWN_SHAPE',side||'.changed_at');
   state:=private.catalog_por_edge_v1(state,'po',po,side||'.purchase_order_id');
   field:=r->>'field_changed';
   -- Only public SQL-defined field producers are admitted. Other inherited
   -- trigger field grammars are unsupported, not declared nonreference.
   PERFORM private.catalog_por_require_v1(jsonb_typeof(r->'field_changed')='string' AND field IN ('customer','po_items_revised','sj_lines_revised','status','expected_delivery_date','notes','sj_date_returned','sj_voided','po_cancelled'),'UNKNOWN_OPERATION',side||'.field_changed');
   FOREACH sub IN ARRAY ARRAY['old_value','new_value'] LOOP
    value:=r->sub; path:=side||'.'||sub;
    IF value='null'::jsonb THEN CONTINUE; END IF;
    PERFORM private.catalog_por_require_v1(jsonb_typeof(value)='string','UNKNOWN_SHAPE',path);
    IF field='customer' THEN
     customer:=private.catalog_por_uuid_v1(value,path);
     state:=private.catalog_por_ref_v1(state,'customer',customer,side,path);
    ELSIF field IN ('po_items_revised','sj_lines_revised') THEN
     value:=private.catalog_por_text_array_v1(value,path);
     state:=private.catalog_por_items_v1(state,value,CASE WHEN field='po_items_revised' THEN CASE sub WHEN 'old_value' THEN 'saved-po' ELSE 'normalized-po' END ELSE CASE sub WHEN 'old_value' THEN 'saved-sj' ELSE 'normalized-sj' END END,side,path,NULL,po);
    END IF;
   END LOOP;
  END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(identities.ref ORDER BY CASE identities.ref->>'kind' WHEN 'customer' THEN 0 ELSE 1 END,(identities.ref->>'id')::uuid),'[]')
 INTO refs FROM (SELECT DISTINCT ref_element.value AS ref FROM jsonb_array_elements(state->'refs') AS ref_element(value)) identities;
 -- Dedup only direct kind+UUID identities. Every edge and origin occurrence is
 -- retained, including different constraints for the same historical resource.
 RETURN jsonb_build_object('ok',true,'extraction',jsonb_set(state,'{refs}',refs));
EXCEPTION WHEN SQLSTATE 'PCE03' THEN
 GET STACKED DIAGNOSTICS error_code=MESSAGE_TEXT,error_path=PG_EXCEPTION_DETAIL;
 RETURN jsonb_build_object('ok',false,'code',error_code,'path',error_path);
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_por_extract_event_v1(regclass,text,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
