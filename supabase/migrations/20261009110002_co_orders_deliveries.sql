-- Local additive candidate: CO commands and immutable delivery sources only.
BEGIN;
SET LOCAL search_path='';
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

CREATE FUNCTION private.co_input_object_v1(p jsonb, required text[], allowed text[]) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR NOT (p ?& required) THEN
  RAISE EXCEPTION 'Invalid CO object' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE NOT k=ANY(allowed)) THEN
  RAISE EXCEPTION 'Unexpected CO field' USING ERRCODE='22023';
 END IF;
END $$;
CREATE FUNCTION private.co_input_text_v1(p jsonb, optional boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF optional AND (p IS NULL OR p='null'::jsonb) THEN RETURN NULL; END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'string' OR (NOT optional AND nullif(btrim(p#>>'{}'),'') IS NULL) THEN
  RAISE EXCEPTION 'Invalid CO text' USING ERRCODE='22023';
 END IF;
 RETURN p#>>'{}';
END $$;
CREATE FUNCTION private.co_input_uuid_v1(p jsonb, optional boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE s text:=private.co_input_text_v1(p,optional);
BEGIN
 IF s IS NULL AND optional THEN RETURN NULL; END IF;
 IF s !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Invalid CO identity' USING ERRCODE='22023'; END IF;
 RETURN s::uuid;
END $$;
CREATE FUNCTION private.co_input_version_v1(p jsonb) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE s text:=private.co_input_text_v1(p);
BEGIN
 IF s !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION 'Invalid CO version' USING ERRCODE='22023'; END IF;
 RETURN s::bigint;
EXCEPTION WHEN numeric_value_out_of_range THEN RAISE EXCEPTION 'Invalid CO version' USING ERRCODE='22023';
END $$;
CREATE FUNCTION private.co_input_date_v1(p jsonb, optional boolean DEFAULT false) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE s text:=private.co_input_text_v1(p,optional); d date;
BEGIN
 IF s IS NULL AND optional THEN RETURN NULL; END IF;
 IF s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Invalid CO date' USING ERRCODE='22023'; END IF;
 d:=s::date;
 IF NOT isfinite(d) THEN RAISE EXCEPTION 'Invalid CO date' USING ERRCODE='22023'; END IF;
 RETURN d;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'Invalid CO date' USING ERRCODE='22023';
END $$;
CREATE FUNCTION private.co_input_quantity_v1(p jsonb) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE q numeric;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid CO quantity' USING ERRCODE='22023'; END IF;
 q:=(p#>>'{}')::numeric;
 IF q<1 OR q>2147483647 OR q<>trunc(q) THEN RAISE EXCEPTION 'Invalid CO quantity' USING ERRCODE='22023'; END IF;
 RETURN q::integer;
END $$;
CREATE FUNCTION private.co_input_price_v1(p jsonb) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE s text:=private.co_input_text_v1(p); amount numeric;
BEGIN
 IF s !~ '^(0|[1-9][0-9]*)([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'Invalid CO unit price' USING ERRCODE='22023'; END IF;
 amount:=s::numeric;
 IF amount>999999999999.99 THEN RAISE EXCEPTION 'Invalid CO unit price' USING ERRCODE='22023'; END IF;
 RETURN amount;
END $$;

CREATE FUNCTION private.co_delivered_line_quantity_v1(p_line_id uuid) RETURNS bigint
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(sum(l.quantity),0)::bigint FROM private.co_delivery_revision_lines l
 JOIN private.co_delivery_heads h ON h.current_revision_id=l.revision_id
 JOIN private.co_delivery_revisions r ON r.id=l.revision_id
 WHERE l.co_line_id=p_line_id AND NOT r.is_void;
$$;
CREATE FUNCTION private.co_delivery_progress_v1(p_co_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('delivery_progress',CASE WHEN d+r=o THEN 'complete' WHEN d=0 THEN 'not_started' ELSE 'partial' END,
 'ordered_quantity',o::text,'delivered_quantity',d::text,'resolved_undelivered_quantity',r::text,'pending_quantity',(o-d-r)::text)
 FROM (SELECT coalesce(sum(ordered_quantity),0) o,coalesce(sum(private.co_delivered_line_quantity_v1(id)),0) d,
 coalesce(sum(resolved_undelivered_quantity),0) r FROM private.co_order_lines WHERE co_id=p_co_id) x;
$$;
CREATE FUNCTION private.co_order_snapshot_v1(p_co_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('order',to_jsonb(o),'lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM private.co_order_lines l WHERE l.co_id=o.id),'[]'::jsonb))
 FROM private.co_orders o WHERE o.id=p_co_id;
$$;

-- Complete desired line set. Existing identities/prices cannot be supplied as editable fields.
CREATE FUNCTION private.co_write_order_lines_v1(p_co_id uuid, p_customer_id uuid, p_lines jsonb) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE x jsonb; line_id uuid; key_id uuid; q integer; current_line private.co_order_lines%ROWTYPE; seen uuid[]:='{}';
BEGIN
 IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines)=0 THEN RAISE EXCEPTION 'CO lines required' USING ERRCODE='22023'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  line_id:=private.co_input_uuid_v1(x->'id');
  IF line_id=ANY(seen) THEN RAISE EXCEPTION 'Duplicate CO line' USING ERRCODE='22023'; END IF;
  seen:=array_append(seen,line_id);
  SELECT * INTO current_line FROM private.co_order_lines WHERE id=line_id;
  q:=private.co_input_quantity_v1(x->'ordered_quantity');
  IF current_line.id IS NOT NULL THEN
   IF current_line.co_id<>p_co_id THEN RAISE EXCEPTION 'Invalid CO line identity' USING ERRCODE='22023'; END IF;
   PERFORM private.co_input_object_v1(x,ARRAY['id','ordered_quantity'],ARRAY['id','ordered_quantity']);
   IF q<private.co_delivered_line_quantity_v1(line_id)+current_line.resolved_undelivered_quantity THEN
    RAISE EXCEPTION 'CO quantity is below committed delivery or resolution' USING ERRCODE='23514';
   END IF;
   UPDATE private.co_order_lines SET ordered_quantity=q WHERE id=line_id;
  ELSE
   PERFORM private.co_input_object_v1(x,ARRAY['id','sku','product_name','ordered_quantity','unit_price'],ARRAY['id','sku','product_name','product_id','stock_key_id','ordered_quantity','unit_price']);
   -- A removed ID remains historical: do not silently reuse/rebind its audit identity.
   IF EXISTS(SELECT 1 FROM private.co_audit_events a WHERE a.customer_id=p_customer_id AND a.before_state->'lines' @> jsonb_build_array(jsonb_build_object('id',line_id))) THEN
    RAISE EXCEPTION 'Retired CO line identity' USING ERRCODE='22023';
   END IF;
   key_id:=private.co_stock_key_v1(p_customer_id,private.co_input_text_v1(x->'sku'),private.co_input_text_v1(x->'product_name'),private.co_input_uuid_v1(x->'product_id',true),private.co_input_uuid_v1(x->'stock_key_id',true));
   INSERT INTO private.co_order_lines(id,co_id,customer_id,stock_key_id,ordered_quantity,unit_price)
   VALUES(line_id,p_co_id,p_customer_id,key_id,q,private.co_input_price_v1(x->'unit_price'));
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM private.co_order_lines l WHERE l.co_id=p_co_id AND NOT l.id=ANY(seen)
  AND (EXISTS(SELECT 1 FROM private.co_delivery_revision_lines d WHERE d.co_line_id=l.id) OR EXISTS(SELECT 1 FROM private.co_stock_batches b WHERE b.co_line_id=l.id))) THEN
  RAISE EXCEPTION 'Referenced CO lines cannot be removed' USING ERRCODE='23514';
 END IF;
 DELETE FROM private.co_order_lines WHERE co_id=p_co_id AND NOT id=ANY(seen);
END $$;

-- Validates scope and cumulative quantities both at draft save and again under the post lock.
CREATE FUNCTION private.co_validate_sj_lines_v1(p_co_id uuid,p_lines jsonb) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE x jsonb; line_id uuid; q integer; l private.co_order_lines%ROWTYPE; seen uuid[]:='{}';
BEGIN
 IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines)=0 THEN RAISE EXCEPTION 'SJ lines required' USING ERRCODE='22023'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  PERFORM private.co_input_object_v1(x,ARRAY['co_line_id','quantity'],ARRAY['co_line_id','quantity']);
  line_id:=private.co_input_uuid_v1(x->'co_line_id'); q:=private.co_input_quantity_v1(x->'quantity');
  IF line_id=ANY(seen) THEN RAISE EXCEPTION 'Duplicate SJ line' USING ERRCODE='22023'; END IF;
  seen:=array_append(seen,line_id);
  SELECT * INTO l FROM private.co_order_lines WHERE id=line_id AND co_id=p_co_id;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Invalid SJ source identity' USING ERRCODE='22023'; END IF;
  IF q::bigint+private.co_delivered_line_quantity_v1(line_id)+l.resolved_undelivered_quantity>l.ordered_quantity THEN
   RAISE EXCEPTION 'SJ exceeds remaining ordered quantity' USING ERRCODE='23514';
  END IF;
 END LOOP;
END $$;

-- Task 3 MUST replace this seam with complete monthly planning and reviewed impact rules.
-- Caller holds the customer lock, has published the new source head, but has not switched
-- the effective generation. Returning an unpublished complete generation preserves atomicity.
CREATE FUNCTION private.co_build_delivery_generation_v1(p_customer_id uuid,p_next_customer_version bigint,p_actor_id uuid,p_new_delivery_revision_id uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE g uuid;
BEGIN
 IF EXISTS(SELECT 1 FROM private.co_report_heads WHERE customer_id=p_customer_id AND current_revision_id IS NOT NULL)
 OR EXISTS(SELECT 1 FROM private.co_return_heads WHERE customer_id=p_customer_id AND current_revision_id IS NOT NULL) THEN
  RAISE EXCEPTION 'CO settlement replay required before delivery posting' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM private.co_delivery_heads WHERE customer_id=p_customer_id AND current_revision_id=p_new_delivery_revision_id)
 OR NOT EXISTS(SELECT 1 FROM private.co_customer_state WHERE customer_id=p_customer_id AND version+1=p_next_customer_version)
 OR p_actor_id IS DISTINCT FROM private.co_actor_v1() THEN RAISE EXCEPTION 'Invalid CO generation context' USING ERRCODE='22023'; END IF;
 INSERT INTO private.co_replay_generations(customer_id,version,algorithm_version,created_by)
 VALUES(p_customer_id,p_next_customer_version,'co-delivery-only-v1',p_actor_id) RETURNING id INTO g;
 INSERT INTO private.co_stock_movements(generation_id,customer_id,batch_id,stock_key_id,kind,quantity_delta,effective_date,delivery_revision_line_id)
 SELECT g,p_customer_id,l.batch_id,l.stock_key_id,'delivery',l.quantity,r.sj_date,l.id
 FROM private.co_delivery_heads h JOIN private.co_delivery_revisions r ON r.id=h.current_revision_id
 JOIN private.co_delivery_revision_lines l ON l.revision_id=r.id WHERE h.customer_id=p_customer_id AND NOT r.is_void;
 RETURN g;
END $$;

CREATE FUNCTION public.pilot_co_transaction_v1(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; result jsonb; customer uuid; customer_version bigint; co_id uuid; order_row private.co_orders%ROWTYPE;
 draft_row private.co_drafts%ROWTYPE; draft_id uuid; credit jsonb; before_image jsonb; after_image jsonb; reason text;
 target_id uuid; target_version bigint; head_id uuid; revision_id uuid; creation_order bigint; generation_id uuid;
 line jsonb; source_line private.co_order_lines%ROWTYPE; batch_id uuid; delivery_line_id uuid; today date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
 -- Actor helper locks users before assignments/customer state; every retry is reauthorized.
 actor:=private.co_actor_v1();
 result:=private.co_command_begin_v1(p_request_id,p_operation,p_payload);
 IF result IS NOT NULL THEN RETURN result; END IF;
 IF p_operation='create_co' THEN
  PERFORM private.co_input_object_v1(p_payload,ARRAY['customer_id','expected_customer_version','co_number','order_date','lines'],ARRAY['customer_id','expected_customer_version','co_number','order_date','expected_delivery_date','notes','lines']);
  customer:=private.co_input_uuid_v1(p_payload->'customer_id');
  credit:=private.demo_capture_credit(customer);
  customer_version:=private.co_lock_customer_v1(customer,private.co_input_version_v1(p_payload->'expected_customer_version'));
  INSERT INTO private.co_orders(customer_id,co_number,order_date,expected_delivery_date,notes,created_by,
   sales_person_id_at_creation,sales_assignment_source_id,sales_attributed_at,sales_attribution_state)
  VALUES(customer,btrim(private.co_input_text_v1(p_payload->'co_number')),private.co_input_date_v1(p_payload->'order_date'),private.co_input_date_v1(p_payload->'expected_delivery_date',true),private.co_input_text_v1(p_payload->'notes',true),actor,
   (credit->>'sales_person_id_at_creation')::uuid,(credit->>'sales_assignment_source_id')::uuid,(credit->>'sales_attributed_at')::timestamptz,credit->>'sales_attribution_state') RETURNING id,version INTO co_id,target_version;
  PERFORM private.co_write_order_lines_v1(co_id,customer,p_payload->'lines');
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
  customer_version:=private.co_lock_customer_v1(customer,private.co_input_version_v1(p_payload->'expected_customer_version'));
  SELECT * INTO order_row FROM private.co_orders WHERE id=co_id FOR UPDATE;
  IF order_row.version<>private.co_input_version_v1(p_payload->'expected_co_version') THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
  IF order_row.status<>'active' THEN RAISE EXCEPTION 'CO must be active' USING ERRCODE='55000'; END IF;
  before_image:=private.co_order_snapshot_v1(co_id);
  IF p_operation='edit_co' THEN
   PERFORM private.co_input_object_v1(p_payload,ARRAY['co_id','expected_co_version','expected_customer_version','lines'],ARRAY['co_id','expected_co_version','expected_customer_version','co_number','order_date','expected_delivery_date','notes','lines']);
   PERFORM private.co_write_order_lines_v1(co_id,customer,p_payload->'lines');
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
    batch_id:=gen_random_uuid(); delivery_line_id:=gen_random_uuid();
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

CREATE FUNCTION public.pilot_reconcile_co_v1(p_request_id uuid,p_abandon boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RETURN private.co_command_reconcile_v1(p_request_id,p_abandon); END $$;

-- Private helpers remain unavailable to every API role; only checked entrypoints are callable.
DO $$ DECLARE fn regprocedure; BEGIN
 FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='private' AND p.proname IN('co_input_object_v1','co_input_text_v1','co_input_uuid_v1','co_input_version_v1','co_input_date_v1','co_input_quantity_v1','co_input_price_v1',
 'co_delivered_line_quantity_v1','co_delivery_progress_v1','co_order_snapshot_v1','co_write_order_lines_v1','co_validate_sj_lines_v1','co_build_delivery_generation_v1') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',fn);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.pilot_co_transaction_v1(uuid,text,jsonb),public.pilot_reconcile_co_v1(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pilot_co_transaction_v1(uuid,text,jsonb),public.pilot_reconcile_co_v1(uuid,boolean) TO authenticated;
COMMIT;
