-- Only replaces the public legacy writer; existing live policy helpers stay untouched.
CREATE OR REPLACE FUNCTION public.pilot_catalog_transaction_v1(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid; target_kind text; target_id uuid; expected_version bigint; fields text[]; writes text[];
  request_binding jsonb; digest text; prior private.catalog_requests_v1%ROWTYPE; result jsonb;
  old_row jsonb; proposed_row jsonb; actual_row jsonb; assignments text; affected integer;
  customer public.customers%ROWTYPE; product public.products%ROWTYPE;
BEGIN
  PERFORM private.catalog_reauthorize_request_v1(p_request_id);
  IF p_operation='delete_unused' THEN
    RETURN private.catalog_delete_unused_v1(p_request_id,p_payload);
  END IF;
  IF p_operation='set_enabled' THEN
    RETURN private.catalog_status_transaction_v1(p_request_id,p_operation,p_payload);
  END IF;
  actor := private.catalog_authorize_v1(NULL,NULL);
  IF p_request_id IS NULL OR p_operation IS NULL OR p_operation NOT IN ('create','edit')
    OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_payload->'kind') IS DISTINCT FROM 'string' OR p_payload->>'kind' NOT IN ('customer','product')
    OR jsonb_typeof(p_payload->'values') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid catalogue command' USING ERRCODE='22023', DETAIL='CATALOG_INVALID_INPUT';
  END IF;
  target_kind := p_payload->>'kind';
  SELECT array_agg(key ORDER BY key) INTO fields FROM jsonb_object_keys(p_payload->'values') key;
  writes := fields;
  IF p_operation='create' THEN writes := array_append(writes,'id');
    IF target_kind='product' THEN writes := array_append(writes,'unit_price'); END IF;
  END IF;
  PERFORM private.catalog_authorize_fields_v1(p_operation,target_kind,writes);
  request_binding := jsonb_build_object('operation',p_operation,'kind',target_kind)
    || CASE WHEN p_operation='edit' THEN jsonb_build_object('id',p_payload->'id','expected_version',p_payload->'expected_version') ELSE '{}'::jsonb END;
  digest := encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_array(p_operation,p_payload)::text,'UTF8')),'hex');
  IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
    'catalog_request_v1:'||actor::text||':'||p_request_id::text,1801427914)) THEN
    RAISE EXCEPTION 'Catalogue request is busy' USING ERRCODE='55P03', DETAIL='CATALOG_REQUEST_BUSY';
  END IF;
  LOCK TABLE private.catalog_requests_v1 IN ROW EXCLUSIVE MODE NOWAIT;
  SELECT * INTO prior FROM private.catalog_requests_v1 WHERE actor_id=actor AND request_id=p_request_id;
  IF FOUND THEN
    IF prior.status='abandoned' THEN
      IF prior.binding IS NOT NULL THEN PERFORM private.catalog_authorize_bound_v1(prior.binding,prior.write_columns); END IF;
      RAISE EXCEPTION 'Catalogue request was abandoned' USING ERRCODE='22023', DETAIL='CATALOG_REQUEST_ABANDONED';
    END IF;
    IF prior.binding IS DISTINCT FROM request_binding OR prior.fingerprint IS DISTINCT FROM digest
      OR prior.write_columns IS DISTINCT FROM writes THEN
      RAISE EXCEPTION 'Catalogue request binding differs' USING ERRCODE='22023', DETAIL='CATALOG_REQUEST_CONFLICT';
    END IF;
    PERFORM private.catalog_authorize_bound_v1(prior.binding,prior.write_columns);
    IF prior.status<>'committed' THEN RAISE EXCEPTION 'Catalogue request is pending' USING ERRCODE='55P03', DETAIL='CATALOG_REQUEST_BUSY'; END IF;
    -- Exact committed recovery is target-independent: NO mutable row read,
    -- policy evaluation, master/evidence lock or history rewrite before return.
    RETURN prior.receipt;
  END IF;
  IF target_kind='product' AND p_operation='create' THEN
    RAISE EXCEPTION 'Refresh application to supply required Tipe' USING ERRCODE='22023', DETAIL='CATALOG_TYPE_REQUIRED' ;
  END IF;
  -- Fresh validation begins only after serialized exact replay recognition.
  IF (p_operation='create' AND (NOT p_payload ?& ARRAY['kind','values'] OR p_payload-ARRAY['kind','values']<>'{}'::jsonb))
    OR (p_operation='edit' AND (NOT p_payload ?& ARRAY['kind','id','expected_version','values']
      OR p_payload-ARRAY['kind','id','expected_version','values']<>'{}'::jsonb
      OR jsonb_typeof(p_payload->'id') IS DISTINCT FROM 'string'
      OR p_payload->>'id' !~ '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
      OR jsonb_typeof(p_payload->'expected_version') IS DISTINCT FROM 'string'
      OR p_payload->>'expected_version' !~ '^[1-9][0-9]*$' OR length(p_payload->>'expected_version')>19)) THEN
    RAISE EXCEPTION 'Invalid catalogue command' USING ERRCODE='22023', DETAIL='CATALOG_INVALID_INPUT';
  END IF;
  PERFORM private.catalog_validate_values_v1(p_operation,target_kind,p_payload->'values');
  IF p_operation = 'edit' THEN
    IF (p_payload->>'expected_version')::numeric>9223372036854775807 THEN
      RAISE EXCEPTION 'Invalid catalogue version' USING ERRCODE='22023', DETAIL='CATALOG_INVALID_INPUT'; END IF;
    target_id := (p_payload->>'id')::uuid; expected_version := (p_payload->>'expected_version')::bigint;
  ELSE target_id := gen_random_uuid(); END IF;
  INSERT INTO private.catalog_requests_v1(actor_id,request_id,status,binding,fingerprint,write_columns)
    VALUES(actor,p_request_id,'pending',request_binding,digest,writes);
  -- Shared generation admission precedes every final master lock. Generation one
  -- remains unchanged; only the later exact create scope can certify unused.
  PERFORM private.catalog_writer_drain_v2();
  -- Final-mode table/target locks precede identity evidence. NOWAIT also refuses
  -- concurrent policy DDL, and the held table lock prevents policy-shape changes.
  -- Effective field grants are checked again at this fresh execution boundary.
  IF target_kind='customer' THEN LOCK TABLE public.customers IN ROW EXCLUSIVE MODE NOWAIT;
  ELSE LOCK TABLE public.products IN ROW EXCLUSIVE MODE NOWAIT; END IF;
  PERFORM private.catalog_assert_write_policy_v1(target_kind);
  PERFORM private.catalog_authorize_fields_v1(p_operation,target_kind,writes);
  IF p_operation = 'edit' THEN
    IF target_kind='customer' THEN SELECT to_jsonb(c) INTO old_row FROM public.customers c WHERE id=target_id FOR UPDATE NOWAIT;
    ELSE SELECT to_jsonb(p) INTO old_row FROM public.products p WHERE id=target_id FOR UPDATE NOWAIT; END IF;
    IF old_row IS NULL THEN RAISE EXCEPTION 'Catalogue target not found' USING ERRCODE='P0002', DETAIL='CATALOG_NOT_FOUND'; END IF;
    PERFORM private.catalog_assert_write_row_v1(target_kind, old_row);
    IF (old_row->>'catalog_version')::bigint<>expected_version THEN
      RAISE EXCEPTION 'Catalogue version changed' USING ERRCODE='40001', DETAIL='CATALOG_VERSION_CONFLICT'; END IF;
    IF target_kind='product' AND old_row->>'product_type' IS NULL THEN
      RAISE EXCEPTION 'Refresh application to classify this product' USING ERRCODE='22023', DETAIL='CATALOG_TYPE_REQUIRED' ;
    END IF;
    proposed_row := old_row || (p_payload->'values');
  ELSE proposed_row := (p_payload->'values') || jsonb_build_object('id',target_id); END IF;
  PERFORM private.catalog_assert_write_row_v1(target_kind, proposed_row);
  IF p_operation = 'create' THEN
    PERFORM private.catalog_create_scope_enter_v1(p_request_id,target_kind,target_id);
    IF target_kind='customer' THEN
      customer := jsonb_populate_record(NULL::public.customers,proposed_row);
      INSERT INTO public.customers(id,name,address,city,phone,email,pricing_tier,customer_category)
        VALUES(target_id,customer.name,customer.address,customer.city,customer.phone,customer.email,customer.pricing_tier,customer.customer_category)
        RETURNING to_jsonb(customers) INTO actual_row;
    ELSE
      product := jsonb_populate_record(NULL::public.products,proposed_row);
      -- New legacy unit_price is NULL; edits never assign it.
      INSERT INTO public.products(id,name,sku,size,harga_pokok,luar_kota,dalam_kota,depo_bangunan,unit_price)
        VALUES(target_id,product.name,product.sku,product.size,product.harga_pokok,product.luar_kota,product.dalam_kota,product.depo_bangunan,NULL)
        RETURNING to_jsonb(products) INTO actual_row;
    END IF;
    GET DIAGNOSTICS affected=ROW_COUNT;
    PERFORM private.catalog_create_scope_leave_v1();
    IF affected<>1 OR actual_row IS NULL OR actual_row->>'catalog_version'<>'1' OR actual_row->'is_enabled'<>'true'::jsonb THEN
      RAISE EXCEPTION 'Catalogue create was not applied' USING ERRCODE='23514', DETAIL='CATALOG_IDENTITY_CONFLICT'; END IF;
  ELSE
    -- Dynamic identifiers come only from the exact field allowlist. Only supplied
    -- fields are assigned: no extra UPDATE grants or legacy unit_price rewrite.
    SELECT string_agg(format('%I = proposed.%I',key,key),', ' ORDER BY key) INTO assignments FROM unnest(fields) key;
    EXECUTE format('UPDATE public.%I AS target SET %s FROM jsonb_populate_record(NULL::public.%I,$1) proposed WHERE target.id=$2 RETURNING to_jsonb(target)',
      CASE target_kind WHEN 'customer' THEN 'customers' ELSE 'products' END,assignments,
      CASE target_kind WHEN 'customer' THEN 'customers' ELSE 'products' END)
      INTO actual_row USING proposed_row,target_id;
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected<>1 OR actual_row IS NULL THEN
      RAISE EXCEPTION 'Catalogue edit was not applied' USING ERRCODE='23514', DETAIL='CATALOG_IDENTITY_CONFLICT'; END IF;
  END IF;
  -- Guard against unexpected trigger rewrites of supplied values or server identity.
  IF actual_row->>'id'<>target_id::text OR EXISTS(SELECT 1 FROM jsonb_each(p_payload->'values') i WHERE actual_row->i.key IS DISTINCT FROM i.value)
    OR (p_operation='edit' AND (actual_row->'is_enabled' IS DISTINCT FROM old_row->'is_enabled'
      OR (target_kind='product' AND actual_row->'unit_price' IS DISTINCT FROM old_row->'unit_price'))) THEN
    RAISE EXCEPTION 'Catalogue write differed from its request' USING ERRCODE='23514', DETAIL='CATALOG_IDENTITY_CONFLICT'; END IF;
  PERFORM private.catalog_assert_write_row_v1(target_kind,actual_row);
  result := jsonb_build_object('version',1,'request_id',p_request_id,'actor_id',actor,'operation',p_operation,'kind',target_kind,'id',target_id,
    'before',CASE WHEN old_row IS NULL THEN NULL ELSE jsonb_build_object('catalog_version',old_row->>'catalog_version','is_enabled',old_row->'is_enabled') END,
    'after',jsonb_build_object('catalog_version',actual_row->>'catalog_version','is_enabled',actual_row->'is_enabled'),'committed_at',statement_timestamp());
  UPDATE private.catalog_requests_v1 SET status='committed',receipt=result WHERE actor_id=actor AND request_id=p_request_id AND status='pending';
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'Catalogue receipt missing' USING ERRCODE='23514', DETAIL='CATALOG_REQUEST_CONFLICT'; END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.pilot_catalog_transaction_v1(uuid,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pilot_catalog_transaction_v1(uuid,text,jsonb) TO authenticated;

