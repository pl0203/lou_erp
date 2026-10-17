-- Inactive integrated CO candidate, never an activation migration.
-- Built from the exact final stage04 dispatcher/orders and stage08 monthly +
-- reviewed publication composition. Existing generation 1 / tracking false stay.
-- The reviewed caller owns the installation transaction and all session bounds.
DO $preflight$ DECLARE entry record; BEGIN
 FOR entry IN SELECT * FROM (VALUES
 ('public.pilot_co_transaction_v1(uuid,text,jsonb)','2fe1a0188e2d64eaadce590c947e4358ac6e620117b5470abde87eb8dd6fdace'),
 ('private.co_orders_transaction_v1(uuid,text,jsonb)','5a8fd19becd31fe379b276dbcbe36ac6331574510fe78159850b02dc800556f6'),
 ('private.co_monthly_transaction_v1(uuid,text,jsonb)','0442408fd2b5cee0326495e155f75f62ae96a30bd02e1888fcebdb3204ddf61f'),
 ('private.co_publish_reviewed_v1(uuid,uuid,uuid,text,jsonb,text)','bece31e4f6c584737e43e8da02aeccfade18c7223a8933e3d0c2047d372c79cf')
 ) x(signature,body_hash) LOOP
  IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_catalog.pg_proc WHERE oid=entry.signature::regprocedure) IS DISTINCT FROM entry.body_hash THEN
   RAISE EXCEPTION 'Final composed CO body drift; refused' USING ERRCODE='55000'; END IF;
 END LOOP;
END $preflight$;
LOCK TABLE private.co_commands IN SHARE ROW EXCLUSIVE MODE NOWAIT;
ALTER TABLE private.co_commands ADD COLUMN execution_version smallint NOT NULL DEFAULT 1 CHECK(execution_version IN(1,2));
-- Do not edit the old begin helper or its implicit generation-one admission.
-- This insert fence is shared by old loaded order/monthly/evidence bodies.
CREATE TABLE private.catalog_co_active_v2(backend_pid integer NOT NULL,transaction_id bigint NOT NULL,PRIMARY KEY(backend_pid,transaction_id));
ALTER TABLE private.catalog_co_active_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.catalog_co_active_v2 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.catalog_co_active_v2() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM private.catalog_co_active_v2 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current())
$$;
CREATE FUNCTION private.catalog_co_context_empty_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM private.catalog_co_active_v2 WHERE backend_pid=NEW.backend_pid AND transaction_id=NEW.transaction_id) THEN
  RAISE EXCEPTION 'CO core context cannot survive commit' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER catalog_co_context_empty_v2 AFTER INSERT ON private.catalog_co_active_v2
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.catalog_co_context_empty_v2();
CREATE FUNCTION private.catalog_co_execution_fence_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE generation smallint;
BEGIN
 IF NEW.status='abandoned' THEN RETURN NEW; END IF;
 IF NEW.execution_version=2 THEN
  IF NOT private.catalog_co_active_v2() THEN RAISE EXCEPTION 'Private CO generation context required' USING ERRCODE='42501',DETAIL='CATALOG_GENERATION_RETIRED'; END IF;
 ELSE
  -- An admitted generation-one command holds this drain lock until commit.
  -- Only fresh command admission locks it; receipt replay never reaches INSERT.
  SELECT execution_generation INTO generation FROM private.catalog_cutover_v1 WHERE singleton FOR SHARE;
  IF generation IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Old CO execution retired at cutover' USING ERRCODE='42501',DETAIL='CATALOG_GENERATION_RETIRED'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER catalog_co_execution_fence_v2 BEFORE INSERT ON private.co_commands
 FOR EACH ROW EXECUTE FUNCTION private.catalog_co_execution_fence_v2();

-- Reauthorize the exact operation and actor before exposing any ledger state.
-- Current CO operations all have the same co_admin/executive audience; keeping
-- the allowlist here preserves the separate evidence-command family.
CREATE FUNCTION private.catalog_co_replay_v2(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE actor uuid:=private.co_actor_v1(); command private.co_commands%ROWTYPE; fingerprint text;
BEGIN
 IF p_request_id IS NULL OR p_operation IS NULL OR p_operation NOT IN('create_co','edit_co','cancel_co','save_sj_draft','post_sj','save_report_draft','post_report','save_return_draft','post_return','correct_sj','correct_report','correct_return','resolve_undelivered','close_co')
 OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Invalid CO command' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('co-command:'||actor::text||':'||p_request_id::text,0));
 fingerprint:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 SELECT * INTO command FROM private.co_commands WHERE actor_id=actor AND request_id=p_request_id FOR UPDATE;
 IF command.status='abandoned' THEN RAISE EXCEPTION 'CO request abandoned' USING ERRCODE='55000'; END IF;
 IF command.actor_id IS NOT NULL THEN
  IF command.operation IS DISTINCT FROM p_operation OR command.payload_fingerprint IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'CO request identity mismatch' USING ERRCODE='22023'; END IF;
  IF command.status='committed' THEN RETURN command.receipt; END IF;
  RAISE EXCEPTION 'CO command already executing in this transaction' USING ERRCODE='55000';
 END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION private.catalog_co_command_begin_v2(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 result:=private.catalog_co_replay_v2(p_request_id,p_operation,p_payload);
 IF result IS NOT NULL THEN RETURN result; END IF;
 IF NOT private.catalog_co_active_v2() THEN RAISE EXCEPTION 'Private CO generation context required' USING ERRCODE='42501'; END IF;
 INSERT INTO private.co_commands(actor_id,request_id,operation,payload_fingerprint,status,execution_version)
 VALUES(auth.uid(),p_request_id,p_operation,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),'pending',2);
 RETURN NULL;
END $$;

-- Scoped assertions inspect actual queued OLD/NEW values, not current context.
-- They take no row/advisory/tracking locks and never write or repair evidence.
CREATE FUNCTION private.catalog_co_assert_ref_v2(kind text,key uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF key IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private.catalog_identity_v1 i WHERE i.kind=catalog_co_assert_ref_v2.kind AND i.id=key AND i.lifetime_state='used') THEN
  RAISE EXCEPTION 'Actual CO reference was not marked used' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
END $$;
CREATE FUNCTION private.catalog_co_assert_stock_v2(key uuid,customer uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE stock private.co_stock_keys%ROWTYPE;
BEGIN
 IF key IS NULL THEN RETURN; END IF;
 SELECT * INTO stock FROM private.co_stock_keys k WHERE k.id=key;
 IF stock.id IS NULL OR (customer IS NOT NULL AND stock.customer_id IS DISTINCT FROM customer) THEN
  RAISE EXCEPTION 'Missing CO stock lineage' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
 PERFORM private.catalog_co_assert_ref_v2('customer',stock.customer_id);
 PERFORM private.catalog_co_assert_ref_v2('product',stock.product_id);
END $$;
CREATE FUNCTION private.catalog_co_assert_line_v2(line uuid,customer uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE keys uuid[];
BEGIN
 IF line IS NULL THEN RETURN; END IF;
 -- Retired IDs remain resolvable through immutable before snapshots. Never
 -- silently discard an OLD draft reference because its live line was removed.
 -- Empty monthly snapshots may have lines:null; non-array known shapes abort.
 SELECT array_agg(DISTINCT stock_key_id) INTO keys FROM (
  SELECT l.stock_key_id FROM private.co_order_lines l WHERE l.id=line AND (customer IS NULL OR l.customer_id=customer)
  UNION ALL
  SELECT (j->>'stock_key_id')::uuid FROM private.co_audit_events a
   CROSS JOIN LATERAL jsonb_array_elements(coalesce(nullif(a.before_state->'lines','null'::jsonb),'[]'::jsonb)) j
   WHERE (customer IS NULL OR a.customer_id=customer) AND j->>'id'=line::text
 ) refs;
 IF cardinality(keys) IS DISTINCT FROM 1 OR keys[1] IS NULL THEN
  RAISE EXCEPTION 'Missing or ambiguous CO line lineage' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
 PERFORM private.catalog_co_assert_stock_v2(keys[1],customer);
END $$;
CREATE FUNCTION private.catalog_co_assert_json_v2(value jsonb,customer uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb; pair record; key uuid; stock uuid;
BEGIN
 IF value IS NULL OR value='null'::jsonb THEN RETURN; END IF;
 IF jsonb_typeof(value)='array' THEN
  FOR item IN SELECT x FROM jsonb_array_elements(value) x LOOP PERFORM private.catalog_co_assert_json_v2(item,customer); END LOOP;
 ELSIF jsonb_typeof(value)='object' THEN
  IF value?'customer_id' THEN customer:=private.co_input_uuid_v1(value->'customer_id',true); END IF;
  PERFORM private.catalog_co_assert_ref_v2('customer',customer);
  FOR pair IN SELECT * FROM jsonb_each(value) LOOP
   IF pair.key IN('product_id','stock_key_id','co_line_id','batch_id') THEN
    key:=private.co_input_uuid_v1(pair.value,true);
    IF pair.key='product_id' THEN PERFORM private.catalog_co_assert_ref_v2('product',key);
    ELSIF pair.key='stock_key_id' THEN PERFORM private.catalog_co_assert_stock_v2(key,customer);
    ELSIF pair.key='co_line_id' THEN PERFORM private.catalog_co_assert_line_v2(key,customer);
    ELSIF key IS NOT NULL THEN
     SELECT b.stock_key_id INTO stock FROM private.co_stock_batches b WHERE b.id=key AND (customer IS NULL OR b.customer_id=customer);
     IF NOT FOUND THEN RAISE EXCEPTION 'Missing CO batch lineage' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
     PERFORM private.catalog_co_assert_stock_v2(stock,customer);
    END IF;
   ELSIF jsonb_typeof(pair.value) IN('array','object') THEN PERFORM private.catalog_co_assert_json_v2(pair.value,customer);
   END IF;
  END LOOP;
 END IF;
END $$;
CREATE FUNCTION private.catalog_co_assert_event_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN PERFORM private.catalog_co_assert_json_v2(to_jsonb(OLD)); END IF;
 IF TG_OP<>'DELETE' THEN PERFORM private.catalog_co_assert_json_v2(to_jsonb(NEW)); END IF;
 RETURN NULL;
END $$;
DO $triggers$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['co_customer_state','co_stock_keys','co_orders','co_order_lines','co_drafts','co_report_draft_lines',
 'co_delivery_heads','co_delivery_revisions','co_delivery_revision_lines','co_report_heads','co_report_revisions','co_report_revision_lines',
 'co_return_heads','co_return_revisions','co_return_revision_lines','co_stock_batches','co_replay_generations','co_stock_movements','co_sale_allocations',
 'co_commands','co_audit_events','co_report_evidence'] LOOP
  EXECUTE format('CREATE CONSTRAINT TRIGGER catalog_co_assert_v2 AFTER INSERT OR UPDATE OR DELETE ON private.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (private.catalog_co_active_v2()) EXECUTE FUNCTION private.catalog_co_assert_event_v2()',relation);
 END LOOP;
END $triggers$;

-- Users and creation-credit assignment locks precede this call. Early state
-- INSERT only queues an assertion; it never takes a new master/evidence lock.
-- One customer state serializes its complete order/report/return chronology.
CREATE FUNCTION private.catalog_co_customer_phase_v2(customer uuid,expected bigint,new_lines jsonb) RETURNS bigint
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE version bigint; key uuid; products uuid[]; ref record; state text;
BEGIN
 version:=private.co_lock_customer_v1(customer,expected);
 PERFORM o.id FROM private.co_orders o WHERE o.customer_id=customer ORDER BY o.id FOR UPDATE;
 PERFORM h.id FROM private.co_delivery_heads h WHERE h.customer_id=customer ORDER BY h.id FOR UPDATE;
 PERFORM h.id FROM private.co_return_heads h WHERE h.customer_id=customer ORDER BY h.id FOR UPDATE;
 PERFORM h.id FROM private.co_report_heads h WHERE h.customer_id=customer ORDER BY h.id FOR UPDATE;
 PERFORM d.id FROM private.co_drafts d WHERE d.customer_id=customer ORDER BY d.id FOR UPDATE;
 IF jsonb_typeof(new_lines) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'CO lines required' USING ERRCODE='22023'; END IF;
 -- Immutable keys retain references after line deletion and throughout all
 -- reports, corrections, returns, draft and audit snapshots for this customer.
 SELECT array_agg(DISTINCT id ORDER BY id) INTO products FROM (
  SELECT k.product_id id FROM private.co_stock_keys k WHERE k.customer_id=customer
  UNION ALL SELECT private.co_input_uuid_v1(j->'product_id',true) FROM jsonb_array_elements(new_lines) j
 ) refs WHERE id IS NOT NULL;
 PERFORM 1 FROM public.customers c WHERE c.id=customer FOR SHARE;
 FOREACH key IN ARRAY coalesce(products,'{}'::uuid[]) LOOP PERFORM 1 FROM public.products p WHERE p.id=key FOR SHARE; END LOOP;
 LOCK TABLE private.catalog_identity_v1 IN ROW EXCLUSIVE MODE NOWAIT;
 FOR ref IN SELECT 'customer'::text kind,customer id UNION ALL SELECT 'product',x FROM unnest(products) x ORDER BY 1,2 LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('catalog_identity_v1:'||ref.kind||':'||ref.id::text,1801427913)) THEN
   RAISE EXCEPTION 'Catalogue identity is busy' USING ERRCODE='55P03',DETAIL='CATALOG_IDENTITY_BUSY'; END IF;
  SELECT i.lifetime_state INTO state FROM private.catalog_identity_v1 i WHERE i.kind=ref.kind AND i.id=ref.id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Catalogue tracking incomplete' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
  IF state<>'used' THEN UPDATE private.catalog_identity_v1 i SET lifetime_state='used' WHERE i.kind=ref.kind AND i.id=ref.id; END IF;
 END LOOP;
 RETURN version;
END $$;

CREATE FUNCTION private.catalog_co_stock_key_v2(customer uuid,sku text,label text,product_id uuid,stock_key_id uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE product public.products%ROWTYPE; existing private.co_stock_keys%ROWTYPE; result uuid;
BEGIN
 -- No lock acquisition here: the complete prepared master phase precedes use.
 -- Canonical selection is checked BEFORE any old customer/SKU key is considered.
 SELECT * INTO product FROM public.products p WHERE p.id=product_id;
 IF product.id IS NULL THEN RAISE EXCEPTION 'Canonical CO product required' USING ERRCODE='22023'; END IF;
 IF NOT product.is_enabled THEN RAISE EXCEPTION 'Enabled CO product required' USING ERRCODE='23514',DETAIL='CATALOG_DISABLED'; END IF;
 IF private.co_normalize_sku_v1(sku) IS DISTINCT FROM private.co_normalize_sku_v1(product.sku) THEN
  RAISE EXCEPTION 'Product ID and SKU do not match' USING ERRCODE='22023'; END IF;
 IF stock_key_id IS NOT NULL THEN
  SELECT * INTO existing FROM private.co_stock_keys k WHERE k.id=stock_key_id AND k.customer_id=customer;
  IF existing.id IS NULL OR existing.normalized_sku IS DISTINCT FROM private.co_normalize_sku_v1(sku) THEN RAISE EXCEPTION 'Invalid CO stock identity' USING ERRCODE='22023'; END IF;
 ELSE SELECT * INTO existing FROM private.co_stock_keys k WHERE k.customer_id=customer AND k.normalized_sku=private.co_normalize_sku_v1(sku); END IF;
 IF existing.id IS NOT NULL THEN
  IF existing.product_id IS DISTINCT FROM product.id THEN RAISE EXCEPTION 'Conflicting CO product identity' USING ERRCODE='22023'; END IF;
  RETURN existing.id; -- Same selected product retains the saved label and SKU.
 END IF;
 INSERT INTO private.co_stock_keys(customer_id,display_sku,product_id,product_name)
 VALUES(customer,btrim(sku),product.id,product.name) RETURNING id INTO result;
 RETURN result;
END $$;
CREATE FUNCTION private.catalog_co_write_order_lines_v2(p_co_id uuid,p_customer_id uuid,p_lines jsonb) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE x jsonb; line_id uuid; key_id uuid; q integer; current_line private.co_order_lines%ROWTYPE; stock private.co_stock_keys%ROWTYPE;
 product public.products%ROWTYPE; customer_enabled boolean; seen uuid[]:='{}';
BEGIN
 IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines)=0 THEN RAISE EXCEPTION 'CO lines required' USING ERRCODE='22023'; END IF;
 SELECT c.is_enabled INTO customer_enabled FROM public.customers c WHERE c.id=p_customer_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Extant CO customer required' USING ERRCODE='23514',DETAIL='CATALOG_DISABLED'; END IF;
 -- A newly inserted order has no persisted lines and never gets grandfathering.
 IF NOT customer_enabled AND NOT EXISTS(SELECT 1 FROM private.co_order_lines l WHERE l.co_id=p_co_id) THEN
  RAISE EXCEPTION 'Enabled CO customer required' USING ERRCODE='23514',DETAIL='CATALOG_DISABLED'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  line_id:=private.co_input_uuid_v1(x->'id');
  IF line_id=ANY(seen) THEN RAISE EXCEPTION 'Duplicate CO line' USING ERRCODE='22023'; END IF;
  seen:=array_append(seen,line_id);
  SELECT * INTO current_line FROM private.co_order_lines WHERE id=line_id;
  q:=private.co_input_quantity_v1(x->'ordered_quantity');
  IF current_line.id IS NOT NULL THEN
   IF current_line.co_id<>p_co_id THEN RAISE EXCEPTION 'Invalid CO line identity' USING ERRCODE='22023'; END IF;
   PERFORM private.co_input_object_v1(x,ARRAY['id','ordered_quantity'],ARRAY['id','ordered_quantity']);
   SELECT * INTO stock FROM private.co_stock_keys k WHERE k.id=current_line.stock_key_id AND k.customer_id=p_customer_id;
   IF stock.id IS NULL THEN RAISE EXCEPTION 'Missing CO stock identity' USING ERRCODE='23514'; END IF;
   SELECT * INTO product FROM public.products p WHERE p.id=stock.product_id;
   IF NOT customer_enabled AND q>current_line.ordered_quantity THEN RAISE EXCEPTION 'Disabled customer historical line cap' USING ERRCODE='23514',DETAIL='CATALOG_DISABLED'; END IF;
   IF product.id IS NOT NULL AND NOT product.is_enabled AND q>current_line.ordered_quantity THEN
    RAISE EXCEPTION 'Disabled product historical line cap' USING ERRCODE='23514',DETAIL='CATALOG_DISABLED'; END IF;
   -- Legacy manual/null product lines keep current quantity rules when their
   -- customer is enabled. Existing immutable key and saved price never change.
   IF q<private.co_delivered_line_quantity_v1(line_id)+current_line.resolved_undelivered_quantity THEN
    RAISE EXCEPTION 'CO quantity is below committed delivery or resolution' USING ERRCODE='23514'; END IF;
   UPDATE private.co_order_lines SET ordered_quantity=q WHERE id=line_id;
  ELSE
   PERFORM private.co_input_object_v1(x,ARRAY['id','sku','product_name','product_id','ordered_quantity','unit_price'],ARRAY['id','sku','product_name','product_id','stock_key_id','ordered_quantity','unit_price']);
   IF NOT customer_enabled THEN RAISE EXCEPTION 'Disabled customer cannot add a line' USING ERRCODE='23514',DETAIL='CATALOG_DISABLED'; END IF;
   IF EXISTS(SELECT 1 FROM private.co_audit_events a WHERE a.before_state->'lines' @> jsonb_build_array(jsonb_build_object('id',line_id))) THEN
    RAISE EXCEPTION 'Retired CO line identity' USING ERRCODE='22023'; END IF;
   key_id:=private.catalog_co_stock_key_v2(p_customer_id,private.co_input_text_v1(x->'sku'),private.co_input_text_v1(x->'product_name'),private.co_input_uuid_v1(x->'product_id'),private.co_input_uuid_v1(x->'stock_key_id',true));
   INSERT INTO private.co_order_lines(id,co_id,customer_id,stock_key_id,ordered_quantity,unit_price)
   VALUES(line_id,p_co_id,p_customer_id,key_id,q,private.co_input_price_v1(x->'unit_price'));
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM private.co_order_lines l WHERE l.co_id=p_co_id AND NOT l.id=ANY(seen)
  AND (EXISTS(SELECT 1 FROM private.co_delivery_revision_lines d WHERE d.co_line_id=l.id) OR EXISTS(SELECT 1 FROM private.co_stock_batches b WHERE b.co_line_id=l.id))) THEN
  RAISE EXCEPTION 'Referenced CO lines cannot be removed' USING ERRCODE='23514'; END IF;
 DELETE FROM private.co_order_lines WHERE co_id=p_co_id AND NOT id=ANY(seen);
END $$;

CREATE FUNCTION private.catalog_co_legacy_transaction_v1(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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

CREATE FUNCTION private.catalog_co_orders_transaction_v2(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; result jsonb; customer uuid; customer_version bigint; co_id uuid; order_row private.co_orders%ROWTYPE;
 draft_row private.co_drafts%ROWTYPE; draft_id uuid; credit jsonb; before_image jsonb; after_image jsonb; reason text;
 target_id uuid; target_version bigint; head_id uuid; revision_id uuid; creation_order bigint; generation_id uuid;
 line jsonb; source_line private.co_order_lines%ROWTYPE; batch_id uuid; delivery_line_id uuid; today date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
 -- Actor helper locks users before assignments/customer state; every retry is reauthorized.
 actor:=private.co_actor_v1();
 result:=private.catalog_co_command_begin_v2(p_request_id,p_operation,p_payload);
 IF result IS NOT NULL THEN RETURN result; END IF;
 IF p_operation='create_co' THEN
  PERFORM private.co_input_object_v1(p_payload,ARRAY['customer_id','expected_customer_version','co_number','order_date','lines'],ARRAY['customer_id','expected_customer_version','co_number','order_date','expected_delivery_date','notes','lines']);
  customer:=private.co_input_uuid_v1(p_payload->'customer_id');
  credit:=private.demo_capture_credit(customer);
  customer_version:=private.catalog_co_customer_phase_v2(customer,private.co_input_version_v1(p_payload->'expected_customer_version'),CASE WHEN p_operation IN('create_co','edit_co') THEN p_payload->'lines' ELSE '[]'::jsonb END);
  INSERT INTO private.co_orders(customer_id,co_number,order_date,expected_delivery_date,notes,created_by,
   sales_person_id_at_creation,sales_assignment_source_id,sales_attributed_at,sales_attribution_state)
  VALUES(customer,btrim(private.co_input_text_v1(p_payload->'co_number')),private.co_input_date_v1(p_payload->'order_date'),private.co_input_date_v1(p_payload->'expected_delivery_date',true),private.co_input_text_v1(p_payload->'notes',true),actor,
   (credit->>'sales_person_id_at_creation')::uuid,(credit->>'sales_assignment_source_id')::uuid,(credit->>'sales_attributed_at')::timestamptz,credit->>'sales_attribution_state') RETURNING id,version INTO co_id,target_version;
  PERFORM private.catalog_co_write_order_lines_v2(co_id,customer,p_payload->'lines');
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
  customer_version:=private.catalog_co_customer_phase_v2(customer,private.co_input_version_v1(p_payload->'expected_customer_version'),CASE WHEN p_operation IN('create_co','edit_co') THEN p_payload->'lines' ELSE '[]'::jsonb END);
  SELECT * INTO order_row FROM private.co_orders WHERE id=co_id FOR UPDATE;
  IF order_row.version<>private.co_input_version_v1(p_payload->'expected_co_version') THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
  IF order_row.status<>'active' THEN RAISE EXCEPTION 'CO must be active' USING ERRCODE='55000'; END IF;
  before_image:=private.co_order_snapshot_v1(co_id);
  IF p_operation='edit_co' THEN
   PERFORM private.co_input_object_v1(p_payload,ARRAY['co_id','expected_co_version','expected_customer_version','lines'],ARRAY['co_id','expected_co_version','expected_customer_version','co_number','order_date','expected_delivery_date','notes','lines']);
   PERFORM private.catalog_co_write_order_lines_v2(co_id,customer,p_payload->'lines');
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

CREATE FUNCTION private.catalog_co_monthly_transaction_v2(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE proposed_sources jsonb; proposed_context jsonb; proposal jsonb; actor uuid; result jsonb; action text; c uuid; v bigint; d private.co_drafts%ROWTYPE; did uuid; m date; context jsonb; old_image jsonb; new_image jsonb;
 x jsonb; k uuid; quantity integer; seen uuid[]:='{}'; metadata_key text; plan jsonb; head uuid; revision uuid; line_id uuid; line_ids jsonb:='{}'; g uuid; target uuid; target_version bigint;
BEGIN
 IF p_operation NOT IN('save_report_draft','post_report') THEN RETURN private.catalog_co_orders_transaction_v2(p_request_id,p_operation,p_payload); END IF;
 actor:=private.co_actor_v1(); result:=private.catalog_co_command_begin_v2(p_request_id,p_operation,p_payload); IF result IS NOT NULL THEN RETURN result; END IF;
 IF p_operation='save_report_draft' THEN action:=private.co_input_text_v1(p_payload->'action'); END IF;
 IF action='initialize' THEN
  PERFORM private.co_input_object_v1(p_payload,ARRAY['action','customer_id','report_month','expected_customer_version'],ARRAY['action','customer_id','report_month','expected_customer_version','draft_id','expected_draft_version','report_reference','received_date','notes','source_context']);
  c:=private.co_input_uuid_v1(p_payload->'customer_id'); m:=private.co_input_date_v1(p_payload->'report_month');
  IF extract(day FROM m)<>1 OR (p_payload?'draft_id')<>(p_payload?'expected_draft_version') THEN RAISE EXCEPTION 'Invalid CO report initialization' USING ERRCODE='22023'; END IF;
 ELSE
  did:=private.co_input_uuid_v1(p_payload->'draft_id'); SELECT customer_id INTO c FROM private.co_drafts WHERE id=did AND kind='report';
  IF c IS NULL THEN RAISE EXCEPTION 'Invalid CO report draft' USING ERRCODE='22023'; END IF;
 END IF;
 v:=private.catalog_co_customer_phase_v2(c,private.co_input_version_v1(p_payload->'expected_customer_version'),'[]'::jsonb);
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
   PERFORM private.co_link_evidence_v1(c,head,revision,d.id,d.version);
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

CREATE FUNCTION private.catalog_co_dispatch_v2(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; result jsonb; c uuid; v bigint; o private.co_orders%ROWTYPE; d private.co_drafts%ROWTYPE; h private.co_delivery_heads%ROWTYPE; x jsonb; k uuid; q integer; seen uuid[]:='{}'; before_image jsonb; after_image jsonb; reason text; plan jsonb; s jsonb; replay jsonb; facts jsonb; target uuid; target_version bigint;
BEGIN
 -- Authorize before even classifying a draft, including delegated operations/retries.
 PERFORM private.co_actor_v1();
 IF p_operation='post_sj' AND NOT p_payload?'preview_fingerprint' THEN
  IF EXISTS(SELECT 1 FROM private.co_drafts WHERE id=private.co_input_uuid_v1(p_payload->'draft_id') AND payload?'bound_delivery_head_id') THEN RAISE EXCEPTION 'Correction draft requires correct_sj' USING ERRCODE='22023'; END IF;
  RETURN private.catalog_co_monthly_transaction_v2(p_request_id,p_operation,p_payload);
 END IF;
 IF p_operation NOT IN('save_return_draft','post_return','correct_sj','correct_report','correct_return','resolve_undelivered','close_co','post_sj') AND NOT(p_operation='save_sj_draft' AND p_payload?'delivery_head_id') THEN RETURN private.catalog_co_monthly_transaction_v2(p_request_id,p_operation,p_payload); END IF;
 actor:=private.co_actor_v1(); result:=private.catalog_co_command_begin_v2(p_request_id,p_operation,p_payload); IF result IS NOT NULL THEN RETURN result; END IF;
 IF p_operation='save_return_draft' THEN c:=private.co_input_uuid_v1(p_payload->'customer_id');
 ELSIF p_operation IN('save_sj_draft','close_co','resolve_undelivered') THEN SELECT * INTO o FROM private.co_orders WHERE id=private.co_input_uuid_v1(p_payload->'co_id'); c:=o.customer_id;
 ELSIF p_operation IN('post_sj','post_return','correct_report') THEN SELECT customer_id INTO c FROM private.co_drafts WHERE id=private.co_input_uuid_v1(p_payload->'draft_id');
 ELSIF p_operation='correct_sj' THEN SELECT customer_id INTO c FROM private.co_delivery_heads WHERE id=private.co_input_uuid_v1(p_payload->'delivery_head_id');
 ELSE SELECT customer_id INTO c FROM private.co_return_heads WHERE id=private.co_input_uuid_v1(p_payload->'return_head_id'); END IF;
 IF c IS NULL THEN RAISE EXCEPTION 'Invalid CO command target' USING ERRCODE='22023'; END IF;
 v:=private.catalog_co_customer_phase_v2(c,private.co_input_version_v1(p_payload->'expected_customer_version'),'[]'::jsonb);
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

-- The only scope initializer is the owner-only admitted core. Client fields,
-- helper defaults and GUCs cannot select this execution generation.
CREATE FUNCTION private.catalog_co_transaction_core_v2(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 result:=private.catalog_co_replay_v2(p_request_id,p_operation,p_payload);
 IF result IS NOT NULL THEN RETURN result; END IF;
 IF private.catalog_co_active_v2() THEN RAISE EXCEPTION 'Nested CO core refused' USING ERRCODE='55000'; END IF;
 INSERT INTO private.catalog_co_active_v2 VALUES(pg_backend_pid(),txid_current());
 result:=private.catalog_co_dispatch_v2(p_request_id,p_operation,p_payload);
 DELETE FROM private.catalog_co_active_v2 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 RETURN result;
END $$;
CREATE FUNCTION private.catalog_co_transaction_v2(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE state private.catalog_cutover_v1%ROWTYPE; result jsonb;
BEGIN
 result:=private.catalog_co_replay_v2(p_request_id,p_operation,p_payload);
 IF result IS NOT NULL THEN RETURN result; END IF;
 SELECT * INTO state FROM private.catalog_cutover_v1 WHERE singleton FOR SHARE;
 IF NOT FOUND OR state.execution_generation<>2 OR NOT state.tracking_ready THEN
  RAISE EXCEPTION 'Catalogue generation not admitted' USING ERRCODE='55000',DETAIL='CATALOG_GENERATION_RETIRED'; END IF;
 RETURN private.catalog_co_transaction_core_v2(p_request_id,p_operation,p_payload);
END $$;
CREATE OR REPLACE FUNCTION public.pilot_co_transaction_v1(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; generation smallint;
BEGIN
 -- Before the mutable stage04 correction-draft classifier and every new lock.
 result:=private.catalog_co_replay_v2(p_request_id,p_operation,p_payload);
 IF result IS NOT NULL THEN RETURN result; END IF;
 SELECT execution_generation INTO generation FROM private.catalog_cutover_v1 WHERE singleton;
 IF generation=1 THEN RETURN private.catalog_co_legacy_transaction_v1(p_request_id,p_operation,p_payload); END IF;
 RETURN private.catalog_co_transaction_v2(p_request_id,p_operation,p_payload);
END $$;
DO $acl$ DECLARE f regprocedure; BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='private' AND p.proname IN('catalog_co_active_v2','catalog_co_context_empty_v2','catalog_co_execution_fence_v2',
 'catalog_co_replay_v2','catalog_co_command_begin_v2','catalog_co_assert_ref_v2','catalog_co_assert_stock_v2','catalog_co_assert_line_v2',
 'catalog_co_assert_json_v2','catalog_co_assert_event_v2','catalog_co_customer_phase_v2','catalog_co_stock_key_v2','catalog_co_write_order_lines_v2',
 'catalog_co_legacy_transaction_v1','catalog_co_orders_transaction_v2','catalog_co_monthly_transaction_v2','catalog_co_dispatch_v2',
 'catalog_co_transaction_core_v2','catalog_co_transaction_v2') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f);
 END LOOP;
END $acl$;
-- Trigger WHEN executes as the DML caller. Only this own-context boolean is public.
GRANT EXECUTE ON FUNCTION private.catalog_co_active_v2() TO PUBLIC;
DO $acl_check$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
  WHERE n.nspname='private' AND p.proname IN('catalog_co_active_v2','catalog_co_context_empty_v2','catalog_co_execution_fence_v2',
   'catalog_co_replay_v2','catalog_co_command_begin_v2','catalog_co_assert_ref_v2','catalog_co_assert_stock_v2','catalog_co_assert_line_v2',
   'catalog_co_assert_json_v2','catalog_co_assert_event_v2','catalog_co_customer_phase_v2','catalog_co_stock_key_v2','catalog_co_write_order_lines_v2',
   'catalog_co_legacy_transaction_v1','catalog_co_orders_transaction_v2','catalog_co_monthly_transaction_v2','catalog_co_dispatch_v2',
   'catalog_co_transaction_core_v2','catalog_co_transaction_v2')
  AND (p.proowner<>'postgres'::regrole OR (a.grantee<>p.proowner AND NOT(p.proname='catalog_co_active_v2' AND a.grantee=0 AND NOT a.is_grantable)) OR a.grantor<>p.proowner OR a.privilege_type<>'EXECUTE'))
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
  WHERE c.oid='private.catalog_co_active_v2'::regclass AND (c.relowner<>'postgres'::regrole OR a.grantee<>c.relowner OR a.grantor<>c.relowner))
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid='private.catalog_co_active_v2'::regclass)
 THEN RAISE EXCEPTION 'Unexpected private CO privilege path' USING ERRCODE='42501'; END IF;
 IF has_function_privilege('authenticated','private.catalog_co_transaction_core_v2(uuid,text,jsonb)','EXECUTE')
 OR has_function_privilege('anon','private.catalog_co_command_begin_v2(uuid,text,jsonb)','EXECUTE')
 OR has_table_privilege('authenticated','private.catalog_co_active_v2','INSERT,UPDATE,DELETE,SELECT') THEN
  RAISE EXCEPTION 'Private CO core must remain owner-only' USING ERRCODE='42501'; END IF;
END $acl_check$;
