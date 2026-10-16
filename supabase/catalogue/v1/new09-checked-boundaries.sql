-- Inactive assembled generation-two boundary. Source-only, never a cutover.
-- Existing generation-one interfaces, table grants and RLS remain unchanged.
-- Requires 01, 02 target tracking, 04, new06, new07 and new08 in that order.
-- The coordinator alone composes catalog_master_after_v1 with the defer hook.

CREATE TABLE private.catalog_target_requests_v1 (
 actor_id uuid NOT NULL, request_id uuid NOT NULL, fingerprint jsonb NOT NULL,
 status text NOT NULL CHECK(status IN('pending','committed')), receipt jsonb,
 PRIMARY KEY(actor_id,request_id), CHECK(jsonb_typeof(fingerprint)='object'),
 CHECK((status='pending' AND receipt IS NULL) OR (status='committed' AND jsonb_typeof(receipt)='object'))
);
ALTER TABLE private.catalog_target_requests_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.catalog_target_requests_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE private.catalog_target_active_v1 (
 backend_pid integer NOT NULL, transaction_id bigint NOT NULL, scope_id uuid NOT NULL,
 actor_id uuid NOT NULL, request_id uuid NOT NULL, customer_id uuid NOT NULL,
 year_month text NOT NULL, target_id uuid NOT NULL, target_value numeric,
 PRIMARY KEY(backend_pid,transaction_id)
);
ALTER TABLE private.catalog_target_active_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.catalog_target_active_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.catalog_target_terminal_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.status='pending' AND NEW.status='committed'
 AND ROW(NEW.actor_id,NEW.request_id,NEW.fingerprint) IS NOT DISTINCT FROM ROW(OLD.actor_id,OLD.request_id,OLD.fingerprint)
 THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Target request evidence is immutable' USING ERRCODE='23514',DETAIL='CATALOG_REQUEST_IMMUTABLE';
END $$;
CREATE TRIGGER catalog_target_terminal_v1 BEFORE UPDATE OR DELETE ON private.catalog_target_requests_v1
 FOR EACH ROW EXECUTE FUNCTION private.catalog_target_terminal_v1();
CREATE TRIGGER catalog_target_no_truncate_v1 BEFORE TRUNCATE ON private.catalog_target_requests_v1
 FOR EACH STATEMENT EXECUTE FUNCTION private.catalog_target_terminal_v1();
CREATE FUNCTION private.catalog_target_no_pending_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM private.catalog_target_requests_v1 r WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id AND r.status='pending')
 OR EXISTS(SELECT 1 FROM private.catalog_target_active_v1 c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id) THEN
  RAISE EXCEPTION 'Target request is not terminal' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER catalog_target_no_pending_v1 AFTER INSERT OR UPDATE ON private.catalog_target_requests_v1
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.catalog_target_no_pending_v1();

-- Build expected trees from the finite reviewed synthetic source, never from
-- whatever policies happen to be present on the real target table.
CREATE TEMP TABLE catalog_target_policy_reference_v1(customer_id uuid,set_by uuid) ON COMMIT DROP;
CREATE POLICY fixture_read ON pg_temp.catalog_target_policy_reference_v1 FOR SELECT TO authenticated USING(true);
CREATE POLICY customer_targets_write ON pg_temp.catalog_target_policy_reference_v1 FOR ALL TO authenticated
 USING(public.current_user_role() IN('sales_head','executive'))
 WITH CHECK(public.current_user_role() IN('sales_head','executive') AND set_by=auth.uid());
CREATE POLICY pilot_active_profile ON pg_temp.catalog_target_policy_reference_v1 AS RESTRICTIVE FOR ALL TO authenticated
 USING(public.current_user_role() IS NOT NULL) WITH CHECK(public.current_user_role() IS NOT NULL);
CREATE POLICY pilot_customer_visibility ON pg_temp.catalog_target_policy_reference_v1 AS RESTRICTIVE FOR SELECT TO authenticated
 USING(private.pilot_can_access_customer(customer_id));
CREATE POLICY co_procurement_no_sales_v1 ON pg_temp.catalog_target_policy_reference_v1 AS RESTRICTIVE FOR ALL TO authenticated
 USING(public.current_user_role() NOT IN('co_admin','po_admin')) WITH CHECK(public.current_user_role() NOT IN('co_admin','po_admin'));
CREATE TABLE private.catalog_target_policy_contract_v1(singleton boolean PRIMARY KEY CHECK(singleton),policies jsonb NOT NULL);
ALTER TABLE private.catalog_target_policy_contract_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.catalog_target_policy_contract_v1 FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO private.catalog_target_policy_contract_v1 VALUES(true,private.catalog_write_policy_signature_v1('pg_temp.catalog_target_policy_reference_v1'));
CREATE TRIGGER catalog_target_policy_immutable_v1 BEFORE INSERT OR UPDATE OR DELETE ON private.catalog_target_policy_contract_v1
 FOR EACH ROW EXECUTE FUNCTION private.catalog_write_contract_immutable_v1();
CREATE TRIGGER catalog_target_policy_no_truncate_v1 BEFORE TRUNCATE ON private.catalog_target_policy_contract_v1
 FOR EACH STATEMENT EXECUTE FUNCTION private.catalog_write_contract_immutable_v1();
CREATE FUNCTION private.catalog_target_authorize_v1() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); column_name text; privilege text;
BEGIN
 LOCK TABLE public.users IN SHARE MODE;
 IF actor IS NULL OR public.current_user_role() IS NULL OR public.current_user_role() NOT IN('sales_head','executive')
 OR current_setting('role',true) IS DISTINCT FROM 'authenticated' THEN
  RAISE EXCEPTION 'Target access denied' USING ERRCODE='42501',DETAIL='CATALOG_ACCESS_DENIED'; END IF;
 -- Reuses the reviewed helper metadata pin, not master-write authority.
 PERFORM private.catalog_assert_write_policy_v1('customer');
 IF (SELECT policies FROM private.catalog_target_policy_contract_v1 WHERE singleton)
 IS DISTINCT FROM private.catalog_write_policy_signature_v1('public.customer_targets')
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid='public.customer_targets'::regclass
  AND relkind='r' AND relrowsecurity AND NOT relforcerowsecurity AND NOT relispartition AND relowner='postgres'::regrole)
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid='public.customer_targets'::regclass OR inhparent='public.customer_targets'::regclass) THEN
  RAISE EXCEPTION 'Target policy parity unproved' USING ERRCODE='42501',DETAIL='CATALOG_POLICY_PARITY_UNPROVED'; END IF;
 FOREACH privilege IN ARRAY ARRAY['INSERT','UPDATE'] LOOP
  FOREACH column_name IN ARRAY ARRAY['customer_id','year_month','target_value','set_by'] LOOP
   IF NOT pg_catalog.has_column_privilege('authenticated','public.customer_targets',column_name,privilege) THEN
    RAISE EXCEPTION 'Target field access denied' USING ERRCODE='42501',DETAIL='CATALOG_ACCESS_DENIED'; END IF;
  END LOOP;
 END LOOP;
 FOREACH column_name IN ARRAY ARRAY['id','customer_id','year_month','target_value','set_by','created_at','updated_at'] LOOP
  IF NOT pg_catalog.has_column_privilege('authenticated','public.customer_targets',column_name,'SELECT') THEN
   RAISE EXCEPTION 'Target read access denied' USING ERRCODE='42501',DETAIL='CATALOG_ACCESS_DENIED'; END IF;
 END LOOP;
 RETURN actor;
END $$;
CREATE FUNCTION public.pilot_customer_target_write_access_v1() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; generation smallint; ready boolean;
BEGIN
 actor:=private.catalog_target_authorize_v1();
 SELECT execution_generation,tracking_ready INTO generation,ready FROM private.catalog_cutover_v1 WHERE singleton;
 IF generation IS NULL OR (generation<>1 AND (generation<>2 OR NOT ready)) THEN
  RAISE EXCEPTION 'Target generation unavailable' USING ERRCODE='55000',DETAIL='CATALOG_GENERATION_RETIRED'; END IF;
 RETURN jsonb_build_object('version',1,'actor_id',actor,'mode',CASE generation WHEN 1 THEN 'legacy' ELSE 'checked' END);
END $$;
CREATE FUNCTION public.pilot_customer_target_upsert_v1(p_request_id uuid,p_customer_id uuid,p_year_month text,p_target_value numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
<<pilot_customer_target_upsert_v1>>
DECLARE actor uuid; fingerprint jsonb; prior private.catalog_target_requests_v1%ROWTYPE;
 existing public.customer_targets%ROWTYPE; saved public.customer_targets%ROWTYPE; target uuid; receipt jsonb; customer_version bigint;
BEGIN
 actor:=private.catalog_target_authorize_v1();
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Target request required' USING ERRCODE='22023'; END IF;
 fingerprint:=jsonb_build_object('customer_id',p_customer_id,'year_month',p_year_month,'target_value',p_target_value);
 PERFORM pg_advisory_xact_lock(hashtextextended('catalog_target_request_v1:'||actor::text||':'||p_request_id::text,0));
 SELECT * INTO prior FROM private.catalog_target_requests_v1 r WHERE r.actor_id=actor AND r.request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF prior.fingerprint IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'Target request mismatch' USING ERRCODE='22023',DETAIL='CATALOG_REQUEST_MISMATCH'; END IF;
  IF prior.status='committed' THEN RETURN prior.receipt; END IF;
  RAISE EXCEPTION 'Target request not terminal' USING ERRCODE='55000',DETAIL='CATALOG_TRACKING_INCOMPLETE';
 END IF;
 IF p_customer_id IS NULL OR p_year_month IS NULL OR p_year_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
 OR (p_target_value IS NOT NULL AND (p_target_value::text IN('NaN','Infinity','-Infinity') OR p_target_value<0 OR p_target_value>999999999999.99 OR p_target_value<>round(p_target_value,2))) THEN
  RAISE EXCEPTION 'Invalid target values' USING ERRCODE='22023'; END IF;
 PERFORM private.catalog_writer_admit_v2();
 PERFORM pg_advisory_xact_lock(hashtextextended('catalog_target_month_v1:'||p_customer_id::text||':'||p_year_month,0));
 SELECT * INTO existing FROM public.customer_targets t WHERE t.customer_id=p_customer_id AND t.year_month=p_year_month FOR UPDATE;
 IF NOT private.pilot_can_access_customer(p_customer_id) THEN RAISE EXCEPTION 'Target customer unavailable' USING ERRCODE='42501',DETAIL='CATALOG_ACCESS_DENIED'; END IF;
 -- The immutable target scope proves the complete OLD/NEW master set is one.
 SELECT c.catalog_version INTO customer_version FROM public.customers c WHERE c.id=p_customer_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Target customer unavailable' USING ERRCODE='42501',DETAIL='CATALOG_ACCESS_DENIED'; END IF;
 LOCK TABLE private.catalog_identity_v1 IN ROW EXCLUSIVE MODE NOWAIT;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('catalog_identity_v1:customer:'||p_customer_id::text,1801427913)) THEN
  RAISE EXCEPTION 'Catalogue identity is busy' USING ERRCODE='55P03',DETAIL='CATALOG_IDENTITY_BUSY'; END IF;
 PERFORM 1 FROM private.catalog_identity_v1 i WHERE i.kind='customer' AND i.id=p_customer_id AND i.last_version=customer_version FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Target identity missing' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
 target:=coalesce(existing.id,gen_random_uuid());
 INSERT INTO private.catalog_target_requests_v1 VALUES(actor,p_request_id,fingerprint,'pending',NULL);
 INSERT INTO private.catalog_target_active_v1 VALUES(pg_backend_pid(),txid_current(),gen_random_uuid(),actor,p_request_id,p_customer_id,p_year_month,target,p_target_value);
 IF existing.id IS NULL THEN
  INSERT INTO public.customer_targets(id,customer_id,year_month,target_value,set_by)
   VALUES(target,p_customer_id,p_year_month,p_target_value,actor) RETURNING * INTO saved;
 ELSE
  UPDATE public.customer_targets SET target_value=p_target_value,set_by=actor
   WHERE id=target AND customer_id=p_customer_id AND year_month=p_year_month RETURNING * INTO saved;
 END IF;
 IF saved.id IS NULL OR ROW(saved.id,saved.customer_id,saved.year_month,saved.target_value,saved.set_by)
 IS DISTINCT FROM ROW(target,p_customer_id,p_year_month,p_target_value,actor) THEN
  RAISE EXCEPTION 'Target mutation mismatch' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
 DELETE FROM private.catalog_target_active_v1 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 receipt:=jsonb_build_object('version',1,'request_id',p_request_id,'actor_id',actor,'operation','upsert_target',
  'customer_id',p_customer_id,'year_month',p_year_month,'target_id',saved.id,'target_value',saved.target_value::text,'committed_at',clock_timestamp());
 UPDATE private.catalog_target_requests_v1 r SET status='committed',receipt=pilot_customer_target_upsert_v1.receipt WHERE r.actor_id=actor AND r.request_id=p_request_id;
 RETURN receipt;
END $$;
CREATE FUNCTION public.pilot_reconcile_customer_target_v1(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; prior private.catalog_target_requests_v1%ROWTYPE;
BEGIN
 actor:=private.catalog_target_authorize_v1();
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Target request required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('catalog_target_request_v1:'||actor::text||':'||p_request_id::text,0));
 SELECT * INTO prior FROM private.catalog_target_requests_v1 r WHERE r.actor_id=actor AND r.request_id=p_request_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','unknown'); END IF;
 IF prior.status='committed' THEN RETURN jsonb_build_object('status','committed','receipt',prior.receipt); END IF;
 RAISE EXCEPTION 'Target request not terminal' USING ERRCODE='55000',DETAIL='CATALOG_TRACKING_INCOMPLETE';
END $$;

-- Native product deletion has only the exact public baseline and the explicitly
-- fictional promotion-only CASCADE profile. No FK is changed by this source.
CREATE TABLE private.catalog_product_delete_scope_v2 (
 backend_pid integer NOT NULL,transaction_id bigint NOT NULL,scope_id uuid NOT NULL,
 root_flushed boolean NOT NULL DEFAULT false,
 PRIMARY KEY(backend_pid,transaction_id)
);
CREATE TABLE private.catalog_product_delete_rows_v2 (
 backend_pid integer NOT NULL,transaction_id bigint NOT NULL,scope_id uuid NOT NULL,
 product_id uuid NOT NULL,catalog_version bigint NOT NULL,old_row jsonb NOT NULL,
 promotion_use boolean NOT NULL DEFAULT false,
 pending_promotions uuid[] NOT NULL DEFAULT '{}',
 PRIMARY KEY(backend_pid,transaction_id,product_id)
);
ALTER TABLE private.catalog_product_delete_scope_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.catalog_product_delete_rows_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.catalog_product_delete_scope_v2,private.catalog_product_delete_rows_v2 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.catalog_product_delete_topology_v2() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actual jsonb; expected jsonb; promotion_action "char";
BEGIN
 -- Compare the complete incoming graph, column pairs and timing, not just one FK.
 SELECT confdeltype INTO promotion_action FROM pg_catalog.pg_constraint
 WHERE conrelid='public.promotions'::regclass AND confrelid='public.products'::regclass AND contype='f'
 AND conname IN('promotions_product_id_fkey','catalogue_fictional_promotion_product_cascade_v2');
 WITH edges AS (
 SELECT c.conrelid::regclass::text child,c.confrelid::regclass::text parent,c.conname name,c.confdeltype::text action,
  c.confupdtype::text update_action,c.confmatchtype::text match_type,c.condeferrable,c.condeferred,c.convalidated,
  ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(attnum,n) JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.n) columns,
  ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(attnum,n) JOIN pg_catalog.pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum ORDER BY k.n) parent_columns
 FROM pg_catalog.pg_constraint c WHERE c.contype='f' AND c.confrelid IN('public.products'::regclass,'public.promotions'::regclass))
 SELECT jsonb_agg(to_jsonb(e) ORDER BY child,name) INTO actual FROM edges e;
 SELECT jsonb_agg(jsonb_build_object('child',child,'parent',parent,'name',name,'action',action,'update_action','a','match_type','s',
  'condeferrable',false,'condeferred',false,'convalidated',true,'columns',jsonb_build_array(column_name),'parent_columns',jsonb_build_array('id')) ORDER BY child,name)
 INTO expected FROM (VALUES
 ('public.po_line_items','public.products','po_line_items_product_id_fkey','product_id','a'),
 ('public.girard_order_items','public.products','girard_order_items_product_id_fkey','product_id','a'),
 ('public.promotions','public.products',CASE WHEN promotion_action='c' THEN 'catalogue_fictional_promotion_product_cascade_v2' ELSE 'promotions_product_id_fkey' END,'product_id',CASE WHEN promotion_action='c' THEN 'c' ELSE 'a' END),
 ('private.pilot_promo_slices','public.products','pilot_promo_slices_product_id_fkey','product_id','a'),
 ('public.girard_order_items','public.promotions','girard_order_items_promotion_id_fkey','promotion_id','a'),
 ('private.pilot_promo_slices','public.promotions','pilot_promo_slices_promotion_id_fkey','promotion_id','a'),
 ('private.pilot_promo_movements','public.promotions','pilot_promo_movements_promotion_id_fkey','promotion_id','a')
 ) e(child,parent,name,column_name,action);
 IF actual IS DISTINCT FROM expected THEN
  RAISE EXCEPTION 'Unreviewed native product delete graph' USING ERRCODE='55000',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
END $$;
CREATE FUNCTION private.catalog_product_delete_begin_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE generation smallint;
BEGIN
 IF TG_RELID<>'public.products'::regclass OR TG_OP<>'DELETE' OR TG_LEVEL<>'STATEMENT' OR TG_WHEN<>'BEFORE' THEN RAISE EXCEPTION 'Unexpected product root' USING ERRCODE='23514'; END IF;
 generation:=private.catalog_writer_drain_v2();
 IF generation=1 THEN RETURN NULL; END IF;
 -- NOWAIT is essential: never wait for a final-mode master/table lock while a
 -- conflicting writer might need a tuple or evidence held by this statement.
 LOCK TABLE public.products IN EXCLUSIVE MODE NOWAIT;
 PERFORM private.catalog_product_delete_topology_v2();
 PERFORM private.catalog_assert_checked_graph_v2();
 PERFORM private.catalog_assert_history_contract_v1();
 INSERT INTO private.catalog_product_delete_scope_v2(backend_pid,transaction_id,scope_id) VALUES(pg_backend_pid(),txid_current(),gen_random_uuid());
 RETURN NULL;
END $$;
CREATE FUNCTION private.catalog_product_delete_row_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE scope uuid;
BEGIN
 IF TG_RELID<>'public.products'::regclass OR TG_OP<>'DELETE' OR TG_LEVEL<>'ROW' OR TG_WHEN<>'BEFORE' THEN RAISE EXCEPTION 'Unexpected product row' USING ERRCODE='23514'; END IF;
 IF (SELECT execution_generation FROM private.catalog_cutover_v1 WHERE singleton)=1 THEN RETURN OLD; END IF;
 SELECT scope_id INTO scope FROM private.catalog_product_delete_scope_v2 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND NOT root_flushed;
 IF scope IS NULL THEN RAISE EXCEPTION 'Product root context missing' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
 INSERT INTO private.catalog_product_delete_rows_v2(backend_pid,transaction_id,scope_id,product_id,catalog_version,old_row)
 VALUES(pg_backend_pid(),txid_current(),scope,OLD.id,OLD.catalog_version,to_jsonb(OLD));
 RETURN OLD;
END $$;
CREATE FUNCTION private.catalog_product_delete_defer_v2(p_old jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (SELECT execution_generation FROM private.catalog_cutover_v1 WHERE singleton)=1 THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.catalog_product_delete_rows_v2 r
 JOIN private.catalog_product_delete_scope_v2 s USING(backend_pid,transaction_id,scope_id)
 WHERE r.backend_pid=pg_backend_pid() AND r.transaction_id=txid_current()
 AND r.product_id=(p_old->>'id')::uuid AND r.catalog_version=(p_old->>'catalog_version')::bigint AND r.old_row=p_old) THEN
  RAISE EXCEPTION 'Unbound product delete event' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
 RETURN true;
END $$;
CREATE FUNCTION private.catalog_product_delete_end_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row_event record; prior private.catalog_identity_v1%ROWTYPE; scope uuid;
BEGIN
 IF TG_RELID<>'public.products'::regclass OR TG_OP<>'DELETE' OR TG_LEVEL<>'STATEMENT' OR TG_WHEN<>'AFTER' THEN RAISE EXCEPTION 'Unexpected product root flush' USING ERRCODE='23514'; END IF;
 IF (SELECT execution_generation FROM private.catalog_cutover_v1 WHERE singleton)=1 THEN RETURN NULL; END IF;
 SELECT scope_id INTO scope FROM private.catalog_product_delete_scope_v2 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND NOT root_flushed;
 IF scope IS NULL THEN RAISE EXCEPTION 'Product root context missing' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
 LOCK TABLE private.catalog_identity_v1 IN ROW EXCLUSIVE MODE NOWAIT;
 FOR row_event IN SELECT * FROM private.catalog_product_delete_rows_v2 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND scope_id=scope ORDER BY product_id LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('catalog_identity_v1:product:'||row_event.product_id::text,1801427913)) THEN
   RAISE EXCEPTION 'Catalogue identity is busy' USING ERRCODE='55P03',DETAIL='CATALOG_IDENTITY_BUSY'; END IF;
  SELECT * INTO prior FROM private.catalog_identity_v1 WHERE kind='product' AND id=row_event.product_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR prior.last_version<>row_event.catalog_version THEN
   RAISE EXCEPTION 'Product deletion identity mismatch' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
  UPDATE private.catalog_identity_v1 SET lifetime_state=CASE WHEN row_event.promotion_use THEN 'used' ELSE prior.lifetime_state END,
   deleted_at=coalesce(prior.deleted_at,statement_timestamp()) WHERE kind='product' AND id=row_event.product_id;
 END LOOP;
 -- FK cascades can queue child AFTER events for a later pass than this root
 -- AFTER STATEMENT. Keep their exact acknowledgements and the already-held
 -- sorted identity locks; only actual child AFTER events may mark their use.
 UPDATE private.catalog_product_delete_scope_v2 SET root_flushed=true
 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND scope_id=scope;
 IF NOT EXISTS(SELECT 1 FROM private.catalog_product_delete_rows_v2
  WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND scope_id=scope AND cardinality(pending_promotions)>0) THEN
  DELETE FROM private.catalog_product_delete_rows_v2 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND scope_id=scope;
  DELETE FROM private.catalog_product_delete_scope_v2 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND scope_id=scope;
 END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION private.catalog_product_delete_empty_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM private.catalog_product_delete_scope_v2 WHERE backend_pid=NEW.backend_pid AND transaction_id=NEW.transaction_id)
 OR EXISTS(SELECT 1 FROM private.catalog_product_delete_rows_v2 WHERE backend_pid=NEW.backend_pid AND transaction_id=NEW.transaction_id) THEN
  RAISE EXCEPTION 'Product delete root did not flush' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER catalog_product_delete_empty_v2 AFTER INSERT ON private.catalog_product_delete_scope_v2
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.catalog_product_delete_empty_v2();
CREATE TRIGGER catalog_product_delete_begin_v2 BEFORE DELETE ON public.products FOR EACH STATEMENT EXECUTE FUNCTION private.catalog_product_delete_begin_v2();
CREATE TRIGGER catalog_product_delete_row_v2 BEFORE DELETE ON public.products FOR EACH ROW EXECUTE FUNCTION private.catalog_product_delete_row_v2();
CREATE TRIGGER catalog_product_delete_end_v2 AFTER DELETE ON public.products FOR EACH STATEMENT EXECUTE FUNCTION private.catalog_product_delete_end_v2();

-- One fresh, owner-only scope per actual core invocation. The trusted unchanged
-- core owns business-row authority; these guards additionally bind every row to
-- its exact family/operation and complete final locked typed master set.
CREATE TABLE private.catalog_checked_scope_v2(
 backend_pid integer NOT NULL,transaction_id bigint NOT NULL,scope_id uuid NOT NULL,
 family text NOT NULL CHECK(family IN('po','co','promotion','owner','schedule','visit','evidence','attest')),
 prepared boolean NOT NULL DEFAULT false,customers uuid[] NOT NULL DEFAULT '{}',products uuid[] NOT NULL DEFAULT '{}',
 early_customers uuid[] NOT NULL DEFAULT '{}',early_products uuid[] NOT NULL DEFAULT '{}',
 PRIMARY KEY(backend_pid,transaction_id)
);
ALTER TABLE private.catalog_checked_scope_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.catalog_checked_scope_v2 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.catalog_checked_context_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE family text;
BEGIN
 IF TG_OP='INSERT' THEN
  IF (SELECT execution_generation FROM private.catalog_cutover_v1 WHERE singleton)=2 THEN
   PERFORM private.catalog_assert_checked_graph_v2();
   PERFORM private.catalog_assert_history_contract_v1();
  END IF;
  family:=CASE TG_RELID WHEN 'private.catalog_po_active_v2'::regclass THEN 'po' WHEN 'private.catalog_co_active_v2'::regclass THEN 'co'
   WHEN 'private.catalog_writer_active_v2'::regclass THEN to_jsonb(NEW)->>'family' END;
  IF family IS NULL OR NEW.backend_pid<>pg_backend_pid() OR NEW.transaction_id<>txid_current() THEN
   RAISE EXCEPTION 'Unbound core entry' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
  INSERT INTO private.catalog_checked_scope_v2(backend_pid,transaction_id,scope_id,family) VALUES(NEW.backend_pid,NEW.transaction_id,gen_random_uuid(),family);
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM private.catalog_checked_scope_v2 WHERE backend_pid=OLD.backend_pid AND transaction_id=OLD.transaction_id
   AND NOT prepared AND (cardinality(early_customers)>0 OR cardinality(early_products)>0)) THEN
   RAISE EXCEPTION 'Early references lack final writer phase' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
  DELETE FROM private.catalog_checked_scope_v2 WHERE backend_pid=OLD.backend_pid AND transaction_id=OLD.transaction_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing core exit' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
  RETURN OLD;
 END IF;
 RAISE EXCEPTION 'Unexpected core context event' USING ERRCODE='23514';
END $$;
CREATE FUNCTION private.catalog_checked_context_empty_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM private.catalog_checked_scope_v2 WHERE backend_pid=NEW.backend_pid AND transaction_id=NEW.transaction_id) THEN
  RAISE EXCEPTION 'Checked scope cannot survive commit' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER catalog_checked_context_empty_v2 AFTER INSERT ON private.catalog_checked_scope_v2
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.catalog_checked_context_empty_v2();
DO $scope_triggers$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['private.catalog_po_active_v2','private.catalog_co_active_v2','private.catalog_writer_active_v2'] LOOP
  EXECUTE format('CREATE TRIGGER catalog_checked_context_v2 AFTER INSERT OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION private.catalog_checked_context_v2()',relation);
 END LOOP;
END $scope_triggers$;
CREATE FUNCTION private.catalog_checked_prepare_v2(p_customers uuid[],p_products uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
<<catalog_checked_prepare_v2>>
DECLARE scope private.catalog_checked_scope_v2%ROWTYPE; customers uuid[]; products uuid[];
BEGIN
 SELECT coalesce(array_agg(DISTINCT x ORDER BY x),'{}') INTO customers FROM unnest(p_customers) x WHERE x IS NOT NULL;
 SELECT coalesce(array_agg(DISTINCT x ORDER BY x),'{}') INTO products FROM unnest(p_products) x WHERE x IS NOT NULL;
 SELECT * INTO scope FROM private.catalog_checked_scope_v2 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 IF NOT FOUND OR NOT scope.early_customers<@customers OR NOT scope.early_products<@products
 OR (scope.prepared AND (scope.customers<>customers OR scope.products<>products)) THEN
  RAISE EXCEPTION 'Incomplete final writer set' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
 UPDATE private.catalog_checked_scope_v2 SET prepared=true,customers=catalog_checked_prepare_v2.customers,products=catalog_checked_prepare_v2.products
 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
END $$;
CREATE FUNCTION private.catalog_checked_early_json_v2(value jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item record; refs jsonb:='{"customers":[],"products":[]}'; nested jsonb; key uuid;
BEGIN
 IF value IS NULL OR value='null'::jsonb THEN RETURN refs; END IF;
 IF jsonb_typeof(value)='array' THEN
  FOR item IN SELECT x FROM jsonb_array_elements(value) x LOOP
   nested:=private.catalog_checked_early_json_v2(item.x);
   refs:=jsonb_build_object('customers',(refs->'customers')||(nested->'customers'),'products',(refs->'products')||(nested->'products'));
  END LOOP;
 ELSIF jsonb_typeof(value)='object' THEN
  FOR item IN SELECT * FROM jsonb_each(value) LOOP
   IF item.key IN('customer_id','product_id') THEN
    IF jsonb_typeof(item.value) NOT IN('string','null') THEN RAISE EXCEPTION 'Malformed early reference' USING ERRCODE='22023'; END IF;
    key:=(item.value#>>'{}')::uuid;
    IF key IS NOT NULL THEN
     IF item.key='customer_id' THEN refs:=jsonb_set(refs,'{customers}',refs->'customers'||jsonb_build_array(key));
     ELSE refs:=jsonb_set(refs,'{products}',refs->'products'||jsonb_build_array(key)); END IF;
    END IF;
   ELSIF jsonb_typeof(item.value) IN('array','object') THEN
    nested:=private.catalog_checked_early_json_v2(item.value);
    refs:=jsonb_build_object('customers',(refs->'customers')||(nested->'customers'),'products',(refs->'products')||(nested->'products'));
   END IF;
  END LOOP;
 END IF;
 RETURN refs;
END $$;
CREATE FUNCTION private.catalog_checked_early_event_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
<<catalog_checked_early_event_v2>>
DECLARE scope private.catalog_checked_scope_v2%ROWTYPE; refs jsonb; customers uuid[]; products uuid[];
BEGIN
 SELECT * INTO scope FROM private.catalog_checked_scope_v2 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 IF NOT FOUND THEN RETURN NEW; END IF; -- untouched generation-one bodies
 IF TG_OP<>'INSERT' OR NOT ((TG_RELID='private.pilot_order_requests'::regclass AND scope.family='po')
 OR (TG_RELID='private.co_commands'::regclass AND scope.family IN('co','evidence'))
 OR (TG_RELID='private.co_customer_state'::regclass AND scope.family IN('co','evidence'))) THEN
  RAISE EXCEPTION 'Unexpected early writer event' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
 refs:=private.catalog_checked_early_json_v2(to_jsonb(NEW));
 SELECT coalesce(array_agg(x::uuid),'{}') INTO customers FROM jsonb_array_elements_text(refs->'customers') x;
 SELECT coalesce(array_agg(x::uuid),'{}') INTO products FROM jsonb_array_elements_text(refs->'products') x;
 IF scope.prepared THEN
  IF NOT customers<@scope.customers OR NOT products<@scope.products THEN
   RAISE EXCEPTION 'Early event outside final writer set' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
 ELSE
  UPDATE private.catalog_checked_scope_v2 SET early_customers=early_customers||catalog_checked_early_event_v2.customers,early_products=early_products||catalog_checked_early_event_v2.products
   WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER catalog_checked_early_event_v2 AFTER INSERT ON private.pilot_order_requests FOR EACH ROW EXECUTE FUNCTION private.catalog_checked_early_event_v2();
CREATE TRIGGER catalog_checked_early_event_v2 AFTER INSERT ON private.co_commands FOR EACH ROW EXECUTE FUNCTION private.catalog_checked_early_event_v2();
CREATE TRIGGER catalog_checked_early_event_v2 AFTER INSERT ON private.co_customer_state FOR EACH ROW EXECUTE FUNCTION private.catalog_checked_early_event_v2();

-- Exact body preflight before signature-preserving final-phase wrappers.
DO $checked_phase_preflight$ DECLARE f record; BEGIN
 FOR f IN SELECT * FROM (VALUES
 ('private.catalog_po_master_phase_v2(uuid,uuid,uuid,jsonb,jsonb)','7c7dc6531414997df4753797e506a545b882031631a9c1cc4047fc1022873a80'),
 ('private.catalog_co_customer_phase_v2(uuid,bigint,jsonb)','19191924f142f1b4dd5f4e1a7d6068b2dd4ba978835c189ba92fba5c176c935e'),
 ('private.catalog_writer_master_phase_v2(uuid[],uuid[],boolean)','974c3f30dc55307538a50ceab601b034ff902672632d19603712e5e1c877c1c5'),
 ('private.catalog_evidence_master_phase_v2(uuid)','cc8bdf2753ad281a267c02b5fee7c4b1fb2a7ba64244e4427420adc5184a66de')
 ) x(signature,body_hash) LOOP
  IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_catalog.pg_proc WHERE oid=f.signature::regprocedure) IS DISTINCT FROM f.body_hash THEN
   RAISE EXCEPTION 'Final writer phase drift' USING ERRCODE='55000',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
 END LOOP;
END $checked_phase_preflight$;
ALTER FUNCTION private.catalog_po_master_phase_v2(uuid,uuid,uuid,jsonb,jsonb) RENAME TO catalog_po_master_phase_original_v2;
ALTER FUNCTION private.catalog_co_customer_phase_v2(uuid,bigint,jsonb) RENAME TO catalog_co_customer_phase_original_v2;
ALTER FUNCTION private.catalog_writer_master_phase_v2(uuid[],uuid[],boolean) RENAME TO catalog_writer_master_phase_original_v2;
ALTER FUNCTION private.catalog_evidence_master_phase_v2(uuid) RENAME TO catalog_evidence_master_phase_original_v2;
CREATE FUNCTION private.catalog_po_master_phase_v2(po uuid,old_customer uuid,new_customer uuid,old_lines jsonb,new_lines jsonb) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE customers uuid[]; products uuid[];
BEGIN
 -- Same exact complete set as the pinned original, under its pre-held order and
 -- assignment locks. Collection takes no new master/evidence locks.
 SELECT array_agg(DISTINCT x ORDER BY x) INTO customers FROM (SELECT x FROM unnest(ARRAY[old_customer,new_customer]) x UNION SELECT g.customer_id FROM public.girard_orders g WHERE g.po_id=po) q WHERE x IS NOT NULL;
 SELECT array_agg(DISTINCT x ORDER BY x) INTO products FROM (
 SELECT (j->>'product_id')::uuid x FROM jsonb_array_elements(coalesce(old_lines,'[]')) j UNION ALL
 SELECT (j->>'product_id')::uuid FROM jsonb_array_elements(coalesce(new_lines,'[]')) j UNION ALL
 SELECT s.product_id FROM private.pilot_promo_slices s WHERE s.purchase_order_id=po) q WHERE x IS NOT NULL;
 PERFORM private.catalog_po_master_phase_original_v2(po,old_customer,new_customer,old_lines,new_lines);
 PERFORM private.catalog_checked_prepare_v2(customers,products);
END $$;
CREATE FUNCTION private.catalog_co_customer_phase_v2(customer uuid,expected bigint,new_lines jsonb) RETURNS bigint
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE result bigint; products uuid[];
BEGIN
 result:=private.catalog_co_customer_phase_original_v2(customer,expected,new_lines);
 -- The original still holds customer chronology and all existing immutable keys.
 SELECT array_agg(DISTINCT id ORDER BY id) INTO products FROM (
  SELECT k.product_id id FROM private.co_stock_keys k WHERE k.customer_id=customer
  UNION ALL SELECT private.co_input_uuid_v1(j->'product_id',true) FROM jsonb_array_elements(new_lines) j
 ) refs WHERE id IS NOT NULL;
 PERFORM private.catalog_checked_prepare_v2(ARRAY[customer],products);
 RETURN result;
END $$;
CREATE FUNCTION private.catalog_writer_master_phase_v2(customers uuid[],products uuid[],visit_completion boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 PERFORM private.catalog_writer_master_phase_original_v2(customers,products,visit_completion);
 PERFORM private.catalog_checked_prepare_v2(customers,products);
END $$;
CREATE FUNCTION private.catalog_evidence_master_phase_v2(customer uuid) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE products uuid[];
BEGIN
 PERFORM private.catalog_evidence_master_phase_original_v2(customer);
 SELECT array_agg(DISTINCT k.product_id ORDER BY k.product_id) INTO products FROM private.co_stock_keys k WHERE k.customer_id=customer AND k.product_id IS NOT NULL;
 PERFORM private.catalog_checked_prepare_v2(ARRAY[customer],products);
END $$;
CREATE FUNCTION private.catalog_checked_ref_allowed_v2(p_kind text,p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_id IS NULL OR EXISTS(SELECT 1 FROM private.catalog_checked_scope_v2 s
 WHERE s.backend_pid=pg_backend_pid() AND s.transaction_id=txid_current() AND s.prepared
 AND CASE p_kind WHEN 'customer' THEN p_id=ANY(s.customers) WHEN 'product' THEN p_id=ANY(s.products) ELSE false END)
$$;
CREATE FUNCTION private.catalog_business_family_v2() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE
 WHEN EXISTS(SELECT 1 FROM private.catalog_target_active_v1 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current()) THEN 'target'
 WHEN EXISTS(SELECT 1 FROM private.catalog_product_delete_scope_v2 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND NOT root_flushed) THEN 'product_delete'
 ELSE (SELECT family FROM private.catalog_checked_scope_v2 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND prepared) END
$$;
CREATE FUNCTION private.catalog_business_statement_allowed_v2(p_relation regclass,p_operation text,p_family text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(CASE p_relation::text
 WHEN 'public.customer_targets' THEN p_family='target' AND p_operation IN('INSERT','UPDATE')
 WHEN 'public.customer_manager_assignments' THEN p_family='owner' AND p_operation IN('INSERT','UPDATE')
 WHEN 'public.purchase_orders' THEN p_family='po' AND p_operation IN('INSERT','UPDATE')
 WHEN 'public.po_line_items' THEN p_family='po' AND p_operation IN('INSERT','UPDATE','DELETE')
 WHEN 'public.po_audit_log' THEN p_family='po' AND p_operation='INSERT'
 WHEN 'public.girard_orders' THEN p_family='po' AND p_operation='UPDATE'
 WHEN 'public.surat_jalan' THEN p_family='po' AND p_operation IN('INSERT','UPDATE')
 WHEN 'public.sj_line_items' THEN p_family='po' AND p_operation IN('INSERT','DELETE')
 WHEN 'public.promotions' THEN (p_family='promotion' AND p_operation IN('INSERT','UPDATE')) OR (p_family='po' AND p_operation='UPDATE') OR (p_family='product_delete' AND p_operation='DELETE')
 WHEN 'public.sales_schedules' THEN (p_family='schedule' AND p_operation IN('INSERT','UPDATE','DELETE')) OR (p_family='visit' AND p_operation='UPDATE')
 WHEN 'public.visit_requests' THEN p_family='schedule' AND p_operation IN('INSERT','UPDATE')
 WHEN 'public.outlet_visits' THEN (p_family='visit' AND p_operation='INSERT') OR (p_family='schedule' AND p_operation='UPDATE')
 WHEN 'public.visit_photos' THEN p_family='visit' AND p_operation='INSERT'
 -- girard_order_items, orders, order_line_items and the retired sales-rep table
 -- have no supported generation-two application writer.
 ELSE false END,false)
$$;
CREATE FUNCTION private.catalog_business_row_allowed_v2(p_relation regclass,p_operation text,p_old jsonb,p_new jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE family text:=private.catalog_business_family_v2(); row_data jsonb; customer uuid; product uuid; parent uuid; item jsonb; snapshot text;
 target private.catalog_target_active_v1%ROWTYPE; relation text:=p_relation::text;
BEGIN
 IF NOT private.catalog_business_statement_allowed_v2(p_relation,p_operation,family) THEN RETURN false; END IF;
 IF family='target' THEN
  SELECT * INTO target FROM private.catalog_target_active_v1 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
  IF p_operation NOT IN('INSERT','UPDATE') OR p_new IS NULL
  OR ROW((p_new->>'id')::uuid,(p_new->>'customer_id')::uuid,p_new->>'year_month',(p_new->>'target_value')::numeric,(p_new->>'set_by')::uuid)
  IS DISTINCT FROM ROW(target.target_id,target.customer_id,target.year_month,target.target_value,target.actor_id)
  OR (p_old IS NOT NULL AND ROW(p_old->>'id',p_old->>'customer_id',p_old->>'year_month',p_old->'created_at')
   IS DISTINCT FROM ROW(p_new->>'id',p_new->>'customer_id',p_new->>'year_month',p_new->'created_at')) THEN RETURN false; END IF;
  RETURN true;
 END IF;
 IF family='product_delete' THEN
  IF relation<>'public.promotions' OR p_operation<>'DELETE' OR p_old IS NULL OR p_new IS NOT NULL THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=p_relation AND c.confrelid='public.products'::regclass
   AND c.conname='catalogue_fictional_promotion_product_cascade_v2' AND c.contype='f' AND c.confdeltype='c') THEN RETURN false; END IF;
  RETURN EXISTS(SELECT 1 FROM private.catalog_product_delete_rows_v2 r
   JOIN private.catalog_product_delete_scope_v2 s USING(backend_pid,transaction_id,scope_id)
   WHERE r.backend_pid=pg_backend_pid() AND r.transaction_id=txid_current() AND r.product_id=(p_old->>'product_id')::uuid AND NOT s.root_flushed);
 END IF;
 -- Every lookup is at the BEFORE event while the parent is still present and
 -- held by its unchanged core. No deferred lookup can lose OLD lineage.
 FOR row_data IN SELECT x FROM unnest(ARRAY[p_old,p_new]) x WHERE x IS NOT NULL LOOP
  IF jsonb_typeof(row_data)<>'object' OR row_data->>'id' IS NULL THEN RETURN false; END IF;
  customer:=NULL; product:=NULL; parent:=NULL;
  IF relation IN('public.customer_manager_assignments','public.purchase_orders','public.girard_orders','public.visit_requests') THEN
   customer:=(row_data->>'customer_id')::uuid;
  ELSIF relation IN('public.sales_schedules','public.outlet_visits') THEN customer:=(row_data->>'outlet_id')::uuid;
  ELSIF relation='public.promotions' THEN product:=(row_data->>'product_id')::uuid;
  ELSIF relation='public.po_line_items' THEN
   product:=(row_data->>'product_id')::uuid;
   SELECT p.customer_id INTO customer FROM public.purchase_orders p WHERE p.id=(row_data->>'purchase_order_id')::uuid;
   IF NOT FOUND THEN RETURN false; END IF;
  ELSIF relation IN('public.surat_jalan','public.po_audit_log') THEN
   SELECT p.customer_id INTO customer FROM public.purchase_orders p WHERE p.id=(row_data->>'purchase_order_id')::uuid;
   IF NOT FOUND THEN RETURN false; END IF;
  ELSIF relation='public.sj_line_items' THEN
   SELECT l.product_id,p.customer_id INTO product,customer FROM public.po_line_items l JOIN public.purchase_orders p ON p.id=l.purchase_order_id
   WHERE l.id=(row_data->>'po_line_item_id')::uuid;
   IF NOT FOUND THEN RETURN false; END IF;
  ELSIF relation='public.visit_photos' THEN
   SELECT v.outlet_id INTO customer FROM public.outlet_visits v WHERE v.id=(row_data->>'visit_id')::uuid;
   IF NOT FOUND THEN RETURN false; END IF;
  ELSE RETURN false;
  END IF;
  IF NOT private.catalog_checked_ref_allowed_v2('customer',customer) OR NOT private.catalog_checked_ref_allowed_v2('product',product) THEN RETURN false; END IF;
  IF relation='public.po_audit_log' AND row_data->>'field_changed'='po_items_revised' THEN
   FOREACH snapshot IN ARRAY ARRAY[row_data->>'old_value',row_data->>'new_value'] LOOP
    IF snapshot IS NULL THEN CONTINUE; END IF;
    IF jsonb_typeof(snapshot::jsonb)<>'array' THEN RETURN false; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(snapshot::jsonb) LOOP
     IF jsonb_typeof(item)<>'object' OR NOT item?'product_id' OR jsonb_typeof(item->'product_id') NOT IN('string','null')
     OR NOT private.catalog_checked_ref_allowed_v2('product',(item->>'product_id')::uuid) THEN RETURN false; END IF;
    END LOOP;
   END LOOP;
  END IF;
 END LOOP;
 RETURN true;
END $$;
CREATE FUNCTION private.catalog_business_write_fence_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE generation smallint; old_row jsonb; new_row jsonb;
BEGIN
 generation:=private.catalog_writer_drain_v2();
 IF generation=1 THEN
  IF TG_LEVEL='STATEMENT' THEN RETURN NULL; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 IF NOT private.catalog_business_statement_allowed_v2(TG_RELID,TG_OP,private.catalog_business_family_v2()) THEN
  RAISE EXCEPTION 'Unsupported generation-two business write' USING ERRCODE='42501',DETAIL='CATALOG_GENERATION_RETIRED'; END IF;
 IF TG_LEVEL='STATEMENT' THEN
  PERFORM private.catalog_assert_checked_graph_v2();
  PERFORM private.catalog_assert_history_contract_v1();
  RETURN NULL;
 END IF;
 IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW); END IF;
 IF NOT private.catalog_business_row_allowed_v2(TG_RELID,TG_OP,old_row,new_row) THEN
  RAISE EXCEPTION 'Business row outside exact writer scope' USING ERRCODE='42501',DETAIL='CATALOG_GENERATION_RETIRED'; END IF;
 IF TG_RELID='public.promotions'::regclass AND TG_OP='DELETE' AND private.catalog_business_family_v2()='product_delete' THEN
  -- Register actual BEFORE lineage only, never lifetime use. A skipped AFTER
  -- leaves this exact ID pending and the deferred empty-scope check refuses it.
  UPDATE private.catalog_product_delete_rows_v2 r SET pending_promotions=array_append(r.pending_promotions,(old_row->>'id')::uuid)
  FROM private.catalog_product_delete_scope_v2 s
  WHERE r.backend_pid=s.backend_pid AND r.transaction_id=s.transaction_id AND r.scope_id=s.scope_id
   AND r.backend_pid=pg_backend_pid() AND r.transaction_id=txid_current() AND NOT s.root_flushed
   AND r.product_id=(old_row->>'product_id')::uuid AND NOT (old_row->>'id')::uuid=ANY(r.pending_promotions);
  IF NOT FOUND THEN RAISE EXCEPTION 'Unbound native promotion registration' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE FUNCTION private.catalog_business_truncate_fence_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE generation smallint;
BEGIN
 -- TRUNCATE already owns ACCESS EXCLUSIVE before firing this trigger. Unlike
 -- catalog_writer_drain_v2, use fail-fast shared admission to avoid a drain /
 -- checked-writer relation-lock cycle. Even gen1 may safely return busy here.
 SELECT execution_generation INTO generation FROM private.catalog_cutover_v1 WHERE singleton FOR SHARE NOWAIT;
 IF generation IS DISTINCT FROM 1 THEN
  RAISE EXCEPTION 'Business truncate retired at generation two' USING ERRCODE='42501',DETAIL='CATALOG_GENERATION_RETIRED'; END IF;
 RETURN NULL;
END $$;
DO $business_fences$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['public.customer_targets','public.customer_manager_assignments','public.customer_sales_rep_assignments',
 'public.purchase_orders','public.po_line_items','public.po_audit_log','public.girard_orders','public.girard_order_items','public.orders','public.order_line_items',
 'public.surat_jalan','public.sj_line_items','public.promotions','public.sales_schedules','public.visit_requests','public.outlet_visits','public.visit_photos'] LOOP
  EXECUTE format('CREATE TRIGGER catalog_business_statement_v2 BEFORE INSERT OR UPDATE OR DELETE ON %s FOR EACH STATEMENT EXECUTE FUNCTION private.catalog_business_write_fence_v2()',relation);
  EXECUTE format('CREATE TRIGGER catalog_business_row_v2 BEFORE INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION private.catalog_business_write_fence_v2()',relation);
  EXECUTE format('CREATE TRIGGER catalog_business_truncate_v2 BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION private.catalog_business_truncate_fence_v2()',relation);
 END LOOP;
 -- Named private evidence/request surfaces. Their immutable existing triggers
 -- continue to apply; this adds no alternate raw CO command path or grant.
 FOREACH relation IN ARRAY ARRAY['private.pilot_order_requests','private.pilot_promotion_requests','private.pilot_schedule_requests','private.pilot_visit_requests',
 'private.pilot_store_owner_audit_v1','private.pilot_visit_workflow_audit','private.pilot_promo_slices','private.pilot_promo_movements',
 'private.co_customer_state','private.co_stock_keys','private.co_orders','private.co_order_lines','private.co_drafts','private.co_report_draft_lines',
 'private.co_delivery_heads','private.co_delivery_revisions','private.co_delivery_revision_lines','private.co_report_heads','private.co_report_revisions','private.co_report_revision_lines',
 'private.co_return_heads','private.co_return_revisions','private.co_return_revision_lines','private.co_stock_batches','private.co_replay_generations','private.co_stock_movements','private.co_sale_allocations',
 'private.co_commands','private.co_audit_events','private.co_report_evidence','private.co_evidence','private.co_evidence_verifications'] LOOP
  EXECUTE format('CREATE TRIGGER catalog_business_truncate_v2 BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION private.catalog_business_truncate_fence_v2()',relation);
 END LOOP;
END $business_fences$;
CREATE FUNCTION private.catalog_product_delete_promotion_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE scope uuid; flushed boolean; row_event private.catalog_product_delete_rows_v2%ROWTYPE;
BEGIN
 IF (SELECT execution_generation FROM private.catalog_cutover_v1 WHERE singleton)=1 THEN RETURN NULL; END IF;
 IF TG_RELID<>'public.promotions'::regclass OR TG_OP<>'DELETE' OR TG_LEVEL<>'ROW' OR TG_WHEN<>'AFTER' THEN
  RAISE EXCEPTION 'Unexpected native promotion acknowledgement' USING ERRCODE='23514'; END IF;
 SELECT scope_id,root_flushed INTO scope,flushed FROM private.catalog_product_delete_scope_v2
 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 UPDATE private.catalog_product_delete_rows_v2 r SET pending_promotions=array_remove(r.pending_promotions,OLD.id),promotion_use=true
 WHERE r.backend_pid=pg_backend_pid() AND r.transaction_id=txid_current()
  AND r.scope_id=scope AND r.product_id=OLD.product_id AND OLD.id=ANY(r.pending_promotions)
 RETURNING r.* INTO row_event;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Unbound actual promotion deletion' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
 -- An early child leaves actual use for the root's sorted flush. A late child
 -- uses only the identity lock already acquired before root_flushed was set.
 -- No child or deferred trigger acquires a new evidence/advisory lock order.
 IF flushed THEN
  UPDATE private.catalog_identity_v1 SET lifetime_state='used'
  WHERE kind='product' AND id=row_event.product_id AND last_version=row_event.catalog_version AND deleted_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Native child identity not flushed' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.catalog_product_delete_rows_v2
   WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND scope_id=scope AND cardinality(pending_promotions)>0) THEN
   DELETE FROM private.catalog_product_delete_rows_v2 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND scope_id=scope;
   DELETE FROM private.catalog_product_delete_scope_v2 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND scope_id=scope;
  END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER catalog_product_delete_promotion_v2 AFTER DELETE ON public.promotions
 FOR EACH ROW EXECUTE FUNCTION private.catalog_product_delete_promotion_v2();
CREATE FUNCTION private.catalog_product_delete_assert_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Assertion-only actual OLD snapshot. Forced immediate assertion refuses an
 -- unflushed root, even if prior unrelated business had already marked it used.
 IF (SELECT execution_generation FROM private.catalog_cutover_v1 WHERE singleton)=1 THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM private.catalog_product_delete_scope_v2 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current())
 OR NOT EXISTS(SELECT 1 FROM private.catalog_identity_v1 WHERE kind='product' AND id=OLD.product_id AND lifetime_state='used') THEN
  RAISE EXCEPTION 'Native child event not finalized' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER catalog_product_delete_assert_v2 AFTER DELETE ON public.promotions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.catalog_product_delete_assert_v2();

-- Explicit final-composition trigger/function manifest. Generated from the finite
-- reviewed public SQL files; never learned from whichever triggers are installed.
-- Literal and generated triggers are exhaustive, including multiline declarations.
-- new11's exact final master body is pinned here; runtime-only after assembly.
CREATE FUNCTION private.catalog_assert_checked_graph_v2() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE expected jsonb; actual jsonb; entry record;
BEGIN
 SELECT jsonb_agg(to_jsonb(e) ORDER BY relation,name) INTO expected FROM (VALUES
 ('private.catalog_co_active_v2','catalog_checked_context_v2','private.catalog_checked_context_v2()',13,'O',false,false,'','',NULL),
 ('private.catalog_co_active_v2','catalog_co_context_empty_v2','private.catalog_co_context_empty_v2()',5,'O',true,true,'','',NULL),
 ('private.catalog_po_active_v2','catalog_checked_context_v2','private.catalog_checked_context_v2()',13,'O',false,false,'','',NULL),
 ('private.catalog_po_active_v2','catalog_po_context_empty_v2','private.catalog_po_context_empty_v2()',5,'O',true,true,'','',NULL),
 ('private.catalog_writer_active_v2','catalog_checked_context_v2','private.catalog_checked_context_v2()',13,'O',false,false,'','',NULL),
 ('private.catalog_writer_active_v2','catalog_writer_context_empty_v2','private.catalog_writer_context_empty_v2()',5,'O',true,true,'','',NULL),
 ('private.co_audit_events','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.co_audit_events','catalog_co_assert_v2','private.catalog_co_assert_event_v2()',29,'O',true,true,'','','private.catalog_co_active_v2()'),
 ('private.co_audit_events','catalog_writer_assert_v2','private.catalog_writer_assert_event_v2()',29,'O',true,true,'','','private.catalog_writer_active_v2()'),
 ('private.co_audit_events','co_immutable','private.co_immutable_v1()',27,'O',false,false,'','',NULL),
 ('private.co_commands','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.co_commands','catalog_checked_early_event_v2','private.catalog_checked_early_event_v2()',5,'O',false,false,'','',NULL),
 ('private.co_commands','catalog_co_assert_v2','private.catalog_co_assert_event_v2()',29,'O',true,true,'','','private.catalog_co_active_v2()'),
 ('private.co_commands','catalog_co_execution_fence_v2','private.catalog_co_execution_fence_v2()',7,'O',false,false,'','',NULL),
 ('private.co_commands','catalog_writer_assert_v2','private.catalog_writer_assert_event_v2()',29,'O',true,true,'','','private.catalog_writer_active_v2()'),
 ('private.co_commands','co_command_finished','private.co_command_finished_v1()',21,'O',true,true,'','',NULL),
 ('private.co_commands','co_command_terminal','private.co_command_guard_v1()',27,'O',false,false,'','',NULL),
 ('private.co_customer_state','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.co_customer_state','catalog_checked_early_event_v2','private.catalog_checked_early_event_v2()',5,'O',false,false,'','',NULL),
 ('private.co_customer_state','catalog_co_assert_v2','private.catalog_co_assert_event_v2()',29,'O',true,true,'','','private.catalog_co_active_v2()'),
 ('private.co_customer_state','catalog_writer_assert_v2','private.catalog_writer_assert_event_v2()',29,'O',true,true,'','','private.catalog_writer_active_v2()'),
 ('private.co_customer_state','co_customer_state_transition','private.co_customer_state_guard_v1()',27,'O',false,false,'','',NULL),
 ('private.co_delivery_heads','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.co_delivery_heads','catalog_co_assert_v2','private.catalog_co_assert_event_v2()',29,'O',true,true,'','','private.catalog_co_active_v2()'),
 ('private.co_delivery_heads','co_delivery_identity','private.co_identity_guard_v1()',27,'O',false,false,'','',NULL),
 ('private.co_delivery_revision_lines','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.co_delivery_revision_lines','catalog_co_assert_v2','private.catalog_co_assert_event_v2()',29,'O',true,true,'','','private.catalog_co_active_v2()'),
 ('private.co_delivery_revision_lines','co_delivery_lines_append','private.co_revision_line_guard_v1()',7,'O',false,false,'','',NULL),
 ('private.co_delivery_revision_lines','co_immutable','private.co_immutable_v1()',27,'O',false,false,'','',NULL),
 ('private.co_delivery_revisions','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.co_delivery_revisions','catalog_co_assert_v2','private.catalog_co_assert_event_v2()',29,'O',true,true,'','','private.catalog_co_active_v2()'),
 ('private.co_delivery_revisions','co_immutable','private.co_immutable_v1()',27,'O',false,false,'','',NULL),
 ('private.co_drafts','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.co_drafts','catalog_co_assert_v2','private.catalog_co_assert_event_v2()',29,'O',true,true,'','','private.catalog_co_active_v2()'),
 ('private.co_drafts','catalog_writer_assert_v2','private.catalog_writer_assert_event_v2()',29,'O',true,true,'','','private.catalog_writer_active_v2()'),
 ('private.co_drafts','co_prepare_sj_draft','private.co_prepare_sj_draft_v1()',23,'O',false,false,'','',NULL),
 ('private.co_evidence','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.co_evidence','catalog_writer_assert_v2','private.catalog_writer_assert_event_v2()',29,'O',true,true,'','','private.catalog_writer_active_v2()'),
 ('private.co_evidence','co_evidence_identity','private.co_evidence_guard_v1()',27,'O',false,false,'','',NULL),
 ('private.co_evidence_verifications','catalog_attest_execution_fence_v2','private.catalog_attest_execution_fence_v2()',7,'O',false,false,'','',NULL),
 ('private.co_evidence_verifications','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.co_evidence_verifications','catalog_writer_assert_v2','private.catalog_writer_assert_event_v2()',29,'O',true,true,'','','private.catalog_writer_active_v2()'),
 ('private.co_evidence_verifications','co_evidence_immutable','private.co_immutable_v1()',27,'O',false,false,'','',NULL),
 ('private.co_order_lines','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.co_order_lines','catalog_co_assert_v2','private.catalog_co_assert_event_v2()',29,'O',true,true,'','','private.catalog_co_active_v2()'),
 ('private.co_order_lines','co_line_identity','private.co_identity_guard_v1()',19,'O',false,false,'','',NULL),
 ('private.co_orders','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.co_orders','catalog_co_assert_v2','private.catalog_co_assert_event_v2()',29,'O',true,true,'','','private.catalog_co_active_v2()'),
 ('private.co_orders','co_order_identity','private.co_identity_guard_v1()',27,'O',false,false,'','',NULL),
 ('private.co_replay_generations','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.co_replay_generations','catalog_co_assert_v2','private.catalog_co_assert_event_v2()',29,'O',true,true,'','','private.catalog_co_active_v2()'),
 ('private.co_replay_generations','co_immutable','private.co_immutable_v1()',27,'O',false,false,'','',NULL),
 ('private.co_report_draft_lines','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.co_report_draft_lines','catalog_co_assert_v2','private.catalog_co_assert_event_v2()',29,'O',true,true,'','','private.catalog_co_active_v2()'),
 ('private.co_report_evidence','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.co_report_evidence','catalog_co_assert_v2','private.catalog_co_assert_event_v2()',29,'O',true,true,'','','private.catalog_co_active_v2()'),
 ('private.co_report_evidence','co_evidence_immutable','private.co_immutable_v1()',27,'O',false,false,'','',NULL),
 ('private.co_report_heads','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.co_report_heads','catalog_co_assert_v2','private.catalog_co_assert_event_v2()',29,'O',true,true,'','','private.catalog_co_active_v2()'),
 ('private.co_report_heads','co_report_identity','private.co_identity_guard_v1()',27,'O',false,false,'','',NULL),
 ('private.co_report_revision_lines','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.co_report_revision_lines','catalog_co_assert_v2','private.catalog_co_assert_event_v2()',29,'O',true,true,'','','private.catalog_co_active_v2()'),
 ('private.co_report_revision_lines','co_immutable','private.co_immutable_v1()',27,'O',false,false,'','',NULL),
 ('private.co_report_revision_lines','co_report_lines_append','private.co_revision_line_guard_v1()',7,'O',false,false,'','',NULL),
 ('private.co_report_revisions','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.co_report_revisions','catalog_co_assert_v2','private.catalog_co_assert_event_v2()',29,'O',true,true,'','','private.catalog_co_active_v2()'),
 ('private.co_report_revisions','co_immutable','private.co_immutable_v1()',27,'O',false,false,'','',NULL),
 ('private.co_return_heads','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.co_return_heads','catalog_co_assert_v2','private.catalog_co_assert_event_v2()',29,'O',true,true,'','','private.catalog_co_active_v2()'),
 ('private.co_return_heads','co_return_identity','private.co_identity_guard_v1()',27,'O',false,false,'','',NULL),
 ('private.co_return_revision_lines','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.co_return_revision_lines','catalog_co_assert_v2','private.catalog_co_assert_event_v2()',29,'O',true,true,'','','private.catalog_co_active_v2()'),
 ('private.co_return_revision_lines','co_immutable','private.co_immutable_v1()',27,'O',false,false,'','',NULL),
 ('private.co_return_revision_lines','co_return_lines_append','private.co_revision_line_guard_v1()',7,'O',false,false,'','',NULL),
 ('private.co_return_revisions','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.co_return_revisions','catalog_co_assert_v2','private.catalog_co_assert_event_v2()',29,'O',true,true,'','','private.catalog_co_active_v2()'),
 ('private.co_return_revisions','co_immutable','private.co_immutable_v1()',27,'O',false,false,'','',NULL),
 ('private.co_sale_allocations','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.co_sale_allocations','catalog_co_assert_v2','private.catalog_co_assert_event_v2()',29,'O',true,true,'','','private.catalog_co_active_v2()'),
 ('private.co_sale_allocations','co_allocation_source_snapshot','private.co_source_snapshot_v1()',7,'O',false,false,'','',NULL),
 ('private.co_sale_allocations','co_generation_append','private.co_generation_append_v1()',7,'O',false,false,'','',NULL),
 ('private.co_sale_allocations','co_immutable','private.co_immutable_v1()',27,'O',false,false,'','',NULL),
 ('private.co_stock_batches','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.co_stock_batches','catalog_co_assert_v2','private.catalog_co_assert_event_v2()',29,'O',true,true,'','','private.catalog_co_active_v2()'),
 ('private.co_stock_batches','co_batch_source_snapshot','private.co_source_snapshot_v1()',7,'O',false,false,'','',NULL),
 ('private.co_stock_batches','co_immutable','private.co_immutable_v1()',27,'O',false,false,'','',NULL),
 ('private.co_stock_keys','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.co_stock_keys','catalog_co_assert_v2','private.catalog_co_assert_event_v2()',29,'O',true,true,'','','private.catalog_co_active_v2()'),
 ('private.co_stock_keys','co_immutable','private.co_immutable_v1()',27,'O',false,false,'','',NULL),
 ('private.co_stock_movements','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.co_stock_movements','catalog_co_assert_v2','private.catalog_co_assert_event_v2()',29,'O',true,true,'','','private.catalog_co_active_v2()'),
 ('private.co_stock_movements','co_generation_append','private.co_generation_append_v1()',7,'O',false,false,'','',NULL),
 ('private.co_stock_movements','co_immutable','private.co_immutable_v1()',27,'O',false,false,'','',NULL),
 ('private.pilot_order_requests','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.pilot_order_requests','catalog_checked_early_event_v2','private.catalog_checked_early_event_v2()',5,'O',false,false,'','',NULL),
 ('private.pilot_order_requests','catalog_po_assert_v2','private.catalog_po_assert_event_v2()',29,'O',true,true,'','','private.catalog_po_active_v2()'),
 ('private.pilot_order_requests','demo_order_execution_fence','private.demo_order_execution_fence()',7,'O',false,false,'','',NULL),
 ('private.pilot_order_requests','pilot_block_legacy_visit_claim_v1','private.pilot_block_legacy_visit_claim_v1()',7,'O',false,false,'','',NULL),
 ('private.pilot_promo_movements','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.pilot_promo_movements','catalog_po_assert_v2','private.catalog_po_assert_event_v2()',29,'O',true,true,'','','private.catalog_po_active_v2()'),
 ('private.pilot_promo_movements','catalog_writer_assert_v2','private.catalog_writer_assert_event_v2()',29,'O',true,true,'','','private.catalog_writer_active_v2()'),
 ('private.pilot_promo_movements','demo_movement_immutable','private.demo_immutable_evidence()',27,'O',false,false,'','',NULL),
 ('private.pilot_promo_slices','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.pilot_promo_slices','catalog_po_assert_v2','private.catalog_po_assert_event_v2()',29,'O',true,true,'','','private.catalog_po_active_v2()'),
 ('private.pilot_promotion_requests','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.pilot_promotion_requests','catalog_family_execution_fence_v2','private.catalog_family_execution_fence_v2()',7,'O',false,false,'70726f6d6f74696f6e00','',NULL),
 ('private.pilot_promotion_requests','catalog_writer_assert_v2','private.catalog_writer_assert_event_v2()',29,'O',true,true,'','','private.catalog_writer_active_v2()'),
 ('private.pilot_schedule_requests','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.pilot_schedule_requests','catalog_family_execution_fence_v2','private.catalog_family_execution_fence_v2()',7,'O',false,false,'7363686564756c6500','',NULL),
 ('private.pilot_schedule_requests','catalog_writer_assert_v2','private.catalog_writer_assert_event_v2()',29,'O',true,true,'','','private.catalog_writer_active_v2()'),
 ('private.pilot_store_owner_audit_v1','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.pilot_store_owner_audit_v1','catalog_writer_assert_v2','private.catalog_writer_assert_event_v2()',29,'O',true,true,'','','private.catalog_writer_active_v2()'),
 ('private.pilot_store_owner_audit_v1','store_owner_audit_immutable','private.demo_immutable_evidence()',27,'O',false,false,'','',NULL),
 ('private.pilot_visit_requests','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.pilot_visit_requests','catalog_family_execution_fence_v2','private.catalog_family_execution_fence_v2()',7,'O',false,false,'766973697400','',NULL),
 ('private.pilot_visit_requests','catalog_writer_assert_v2','private.catalog_writer_assert_event_v2()',29,'O',true,true,'','','private.catalog_writer_active_v2()'),
 ('private.pilot_visit_workflow_audit','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('private.pilot_visit_workflow_audit','catalog_writer_assert_v2','private.catalog_writer_assert_event_v2()',29,'O',true,true,'','','private.catalog_writer_active_v2()'),
 ('public.customer_manager_assignments','catalog_business_row_v2','private.catalog_business_write_fence_v2()',31,'O',false,false,'','',NULL),
 ('public.customer_manager_assignments','catalog_business_statement_v2','private.catalog_business_write_fence_v2()',30,'O',false,false,'','',NULL),
 ('public.customer_manager_assignments','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('public.customer_manager_assignments','catalog_raw_drain_v2','private.catalog_raw_drain_v2()',30,'O',false,false,'','',NULL),
 ('public.customer_manager_assignments','catalog_writer_assert_v2','private.catalog_writer_assert_event_v2()',29,'O',true,true,'','','private.catalog_writer_active_v2()'),
 ('public.customer_manager_assignments','pilot_guard_actor_fields','private.pilot_guard_actor_fields()',23,'O',false,false,'','',NULL),
 ('public.customer_manager_assignments','store_owner_guard_v1','private.pilot_store_owner_guard_v1()',23,'O',false,false,'','',NULL),
 ('public.customer_sales_rep_assignments','catalog_business_row_v2','private.catalog_business_write_fence_v2()',31,'O',false,false,'','',NULL),
 ('public.customer_sales_rep_assignments','catalog_business_statement_v2','private.catalog_business_write_fence_v2()',30,'O',false,false,'','',NULL),
 ('public.customer_sales_rep_assignments','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('public.customer_sales_rep_assignments','catalog_raw_drain_v2','private.catalog_raw_drain_v2()',30,'O',false,false,'','',NULL),
 ('public.customer_targets','catalog_business_row_v2','private.catalog_business_write_fence_v2()',31,'O',false,false,'','',NULL),
 ('public.customer_targets','catalog_business_statement_v2','private.catalog_business_write_fence_v2()',30,'O',false,false,'','',NULL),
 ('public.customer_targets','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('public.customer_targets','catalog_customer_targets_assert_v1','private.catalog_customer_targets_assert_v1()',29,'O',true,true,'','',NULL),
 ('public.customer_targets','catalog_customer_targets_mark_v1','private.catalog_customer_targets_mark_v1()',29,'O',false,false,'','',NULL),
 ('public.customer_targets','catalog_raw_drain_v2','private.catalog_raw_drain_v2()',30,'O',false,false,'','',NULL),
 ('public.customer_targets','pilot_guard_actor_fields','private.pilot_guard_actor_fields()',23,'O',false,false,'','',NULL),
 ('public.customers','catalog_master_after_v1','private.catalog_master_after_v1()',29,'O',false,false,'','',NULL),
 ('public.customers','catalog_master_before_v1','private.catalog_master_before_v1()',23,'O',false,false,'','',NULL),
 ('public.customers','catalog_master_no_truncate_v1','private.catalog_master_truncate_v1()',34,'O',false,false,'','',NULL),
 ('public.customers','catalog_raw_drain_v2','private.catalog_raw_drain_v2()',30,'O',false,false,'','',NULL),
 ('public.girard_order_items','catalog_business_row_v2','private.catalog_business_write_fence_v2()',31,'O',false,false,'','',NULL),
 ('public.girard_order_items','catalog_business_statement_v2','private.catalog_business_write_fence_v2()',30,'O',false,false,'','',NULL),
 ('public.girard_order_items','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('public.girard_order_items','catalog_raw_drain_v2','private.catalog_raw_drain_v2()',30,'O',false,false,'','',NULL),
 ('public.girard_orders','catalog_business_row_v2','private.catalog_business_write_fence_v2()',31,'O',false,false,'','',NULL),
 ('public.girard_orders','catalog_business_statement_v2','private.catalog_business_write_fence_v2()',30,'O',false,false,'','',NULL),
 ('public.girard_orders','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('public.girard_orders','catalog_po_assert_v2','private.catalog_po_assert_event_v2()',29,'O',true,true,'','','private.catalog_po_active_v2()'),
 ('public.girard_orders','catalog_raw_drain_v2','private.catalog_raw_drain_v2()',30,'O',false,false,'','',NULL),
 ('public.order_line_items','catalog_business_row_v2','private.catalog_business_write_fence_v2()',31,'O',false,false,'','',NULL),
 ('public.order_line_items','catalog_business_statement_v2','private.catalog_business_write_fence_v2()',30,'O',false,false,'','',NULL),
 ('public.order_line_items','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('public.order_line_items','catalog_raw_drain_v2','private.catalog_raw_drain_v2()',30,'O',false,false,'','',NULL),
 ('public.orders','catalog_business_row_v2','private.catalog_business_write_fence_v2()',31,'O',false,false,'','',NULL),
 ('public.orders','catalog_business_statement_v2','private.catalog_business_write_fence_v2()',30,'O',false,false,'','',NULL),
 ('public.orders','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('public.orders','catalog_raw_drain_v2','private.catalog_raw_drain_v2()',30,'O',false,false,'','',NULL),
 ('public.outlet_visits','catalog_business_row_v2','private.catalog_business_write_fence_v2()',31,'O',false,false,'','',NULL),
 ('public.outlet_visits','catalog_business_statement_v2','private.catalog_business_write_fence_v2()',30,'O',false,false,'','',NULL),
 ('public.outlet_visits','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('public.outlet_visits','catalog_raw_drain_v2','private.catalog_raw_drain_v2()',30,'O',false,false,'','',NULL),
 ('public.outlet_visits','catalog_writer_assert_v2','private.catalog_writer_assert_event_v2()',29,'O',true,true,'','','private.catalog_writer_active_v2()'),
 ('public.outlet_visits','fixture_last_visit','public.update_outlet_last_visit()',5,'O',false,false,'','',NULL),
 ('public.outlet_visits','pilot_visit_evidence_v1','private.pilot_visit_evidence_v1()',19,'O',false,false,'','',NULL),
 ('public.po_audit_log','catalog_business_row_v2','private.catalog_business_write_fence_v2()',31,'O',false,false,'','',NULL),
 ('public.po_audit_log','catalog_business_statement_v2','private.catalog_business_write_fence_v2()',30,'O',false,false,'','',NULL),
 ('public.po_audit_log','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('public.po_audit_log','catalog_po_assert_v2','private.catalog_po_assert_event_v2()',29,'O',true,true,'','','private.catalog_po_active_v2()'),
 ('public.po_audit_log','catalog_raw_drain_v2','private.catalog_raw_drain_v2()',30,'O',false,false,'','',NULL),
 ('public.po_line_items','catalog_business_row_v2','private.catalog_business_write_fence_v2()',31,'O',false,false,'','',NULL),
 ('public.po_line_items','catalog_business_statement_v2','private.catalog_business_write_fence_v2()',30,'O',false,false,'','',NULL),
 ('public.po_line_items','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('public.po_line_items','catalog_po_assert_v2','private.catalog_po_assert_event_v2()',29,'O',true,true,'','','private.catalog_po_active_v2()'),
 ('public.po_line_items','catalog_raw_drain_v2','private.catalog_raw_drain_v2()',30,'O',false,false,'','',NULL),
 ('public.po_line_items','fixture_log_lines','public.log_line_item_changes()',29,'O',false,false,'','',NULL),
 ('public.po_line_items','fixture_recalculate','public.recalculate_po_total()',29,'O',false,false,'','',NULL),
 ('public.products','catalog_master_after_v1','private.catalog_master_after_v1()',29,'O',false,false,'','',NULL),
 ('public.products','catalog_master_before_v1','private.catalog_master_before_v1()',23,'O',false,false,'','',NULL),
 ('public.products','catalog_master_no_truncate_v1','private.catalog_master_truncate_v1()',34,'O',false,false,'','',NULL),
 ('public.products','catalog_product_delete_begin_v2','private.catalog_product_delete_begin_v2()',10,'O',false,false,'','',NULL),
 ('public.products','catalog_product_delete_end_v2','private.catalog_product_delete_end_v2()',8,'O',false,false,'','',NULL),
 ('public.products','catalog_product_delete_row_v2','private.catalog_product_delete_row_v2()',11,'O',false,false,'','',NULL),
 ('public.products','catalog_raw_drain_v2','private.catalog_raw_drain_v2()',30,'O',false,false,'','',NULL),
 ('public.promotions','catalog_business_row_v2','private.catalog_business_write_fence_v2()',31,'O',false,false,'','',NULL),
 ('public.promotions','catalog_business_statement_v2','private.catalog_business_write_fence_v2()',30,'O',false,false,'','',NULL),
 ('public.promotions','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('public.promotions','catalog_po_assert_v2','private.catalog_po_assert_event_v2()',29,'O',true,true,'','','private.catalog_po_active_v2()'),
 ('public.promotions','catalog_product_delete_assert_v2','private.catalog_product_delete_assert_v2()',9,'O',true,true,'','',NULL),
 ('public.promotions','catalog_product_delete_promotion_v2','private.catalog_product_delete_promotion_v2()',9,'O',false,false,'','',NULL),
 ('public.promotions','catalog_raw_drain_v2','private.catalog_raw_drain_v2()',30,'O',false,false,'','',NULL),
 ('public.promotions','catalog_writer_assert_v2','private.catalog_writer_assert_event_v2()',29,'O',true,true,'','','private.catalog_writer_active_v2()'),
 ('public.promotions','pilot_guard_actor_fields','private.pilot_guard_actor_fields()',23,'O',false,false,'','',NULL),
 ('public.purchase_orders','catalog_business_row_v2','private.catalog_business_write_fence_v2()',31,'O',false,false,'','',NULL),
 ('public.purchase_orders','catalog_business_statement_v2','private.catalog_business_write_fence_v2()',30,'O',false,false,'','',NULL),
 ('public.purchase_orders','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('public.purchase_orders','catalog_po_assert_v2','private.catalog_po_assert_event_v2()',29,'O',true,true,'','','private.catalog_po_active_v2()'),
 ('public.purchase_orders','catalog_raw_drain_v2','private.catalog_raw_drain_v2()',30,'O',false,false,'','',NULL),
 ('public.purchase_orders','demo_credit_immutable','private.demo_immutable_credit()',19,'O',false,false,'','',NULL),
 ('public.purchase_orders','trg_log_po_changes','public.log_po_changes()',19,'O',false,false,'','',NULL),
 ('public.sales_schedules','catalog_business_row_v2','private.catalog_business_write_fence_v2()',31,'O',false,false,'','',NULL),
 ('public.sales_schedules','catalog_business_statement_v2','private.catalog_business_write_fence_v2()',30,'O',false,false,'','',NULL),
 ('public.sales_schedules','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('public.sales_schedules','catalog_raw_drain_v2','private.catalog_raw_drain_v2()',30,'O',false,false,'','',NULL),
 ('public.sales_schedules','catalog_writer_assert_v2','private.catalog_writer_assert_event_v2()',29,'O',true,true,'','','private.catalog_writer_active_v2()'),
 ('public.sales_schedules','pilot_freeze_visited_schedule','private.pilot_freeze_visited_schedule()',31,'O',false,false,'','',NULL),
 ('public.sales_schedules','pilot_guard_actor_fields','private.pilot_schedule_origin_v1()',23,'O',false,false,'','',NULL),
 ('public.sj_line_items','catalog_business_row_v2','private.catalog_business_write_fence_v2()',31,'O',false,false,'','',NULL),
 ('public.sj_line_items','catalog_business_statement_v2','private.catalog_business_write_fence_v2()',30,'O',false,false,'','',NULL),
 ('public.sj_line_items','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('public.sj_line_items','catalog_po_assert_v2','private.catalog_po_assert_event_v2()',29,'O',true,true,'','','private.catalog_po_active_v2()'),
 ('public.sj_line_items','catalog_raw_drain_v2','private.catalog_raw_drain_v2()',30,'O',false,false,'','',NULL),
 ('public.sj_line_items','trg_check_po_completion','public.check_po_completion()',29,'O',true,true,'','',NULL),
 ('public.surat_jalan','catalog_business_row_v2','private.catalog_business_write_fence_v2()',31,'O',false,false,'','',NULL),
 ('public.surat_jalan','catalog_business_statement_v2','private.catalog_business_write_fence_v2()',30,'O',false,false,'','',NULL),
 ('public.surat_jalan','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('public.surat_jalan','catalog_po_assert_v2','private.catalog_po_assert_event_v2()',29,'O',true,true,'','','private.catalog_po_active_v2()'),
 ('public.surat_jalan','catalog_raw_drain_v2','private.catalog_raw_drain_v2()',30,'O',false,false,'','',NULL),
 ('public.surat_jalan','fixture_log_sj','public.log_sj_changes()',29,'O',false,false,'','',NULL),
 ('public.visit_photos','catalog_business_row_v2','private.catalog_business_write_fence_v2()',31,'O',false,false,'','',NULL),
 ('public.visit_photos','catalog_business_statement_v2','private.catalog_business_write_fence_v2()',30,'O',false,false,'','',NULL),
 ('public.visit_photos','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('public.visit_photos','catalog_raw_drain_v2','private.catalog_raw_drain_v2()',30,'O',false,false,'','',NULL),
 ('public.visit_photos','catalog_writer_assert_v2','private.catalog_writer_assert_event_v2()',29,'O',true,true,'','','private.catalog_writer_active_v2()'),
 ('public.visit_photos','pilot_complete_proven_visit','private.pilot_complete_proven_visit()',5,'O',false,false,'','',NULL),
 ('public.visit_requests','catalog_business_row_v2','private.catalog_business_write_fence_v2()',31,'O',false,false,'','',NULL),
 ('public.visit_requests','catalog_business_statement_v2','private.catalog_business_write_fence_v2()',30,'O',false,false,'','',NULL),
 ('public.visit_requests','catalog_business_truncate_v2','private.catalog_business_truncate_fence_v2()',34,'O',false,false,'','',NULL),
 ('public.visit_requests','catalog_raw_drain_v2','private.catalog_raw_drain_v2()',30,'O',false,false,'','',NULL),
 ('public.visit_requests','catalog_writer_assert_v2','private.catalog_writer_assert_event_v2()',29,'O',true,true,'','','private.catalog_writer_active_v2()')
 ) e(relation,name,function_name,event_type,enabled,"deferrable",initially_deferred,arguments,columns,qualifier);
 SELECT jsonb_agg(jsonb_build_object('relation',t.tgrelid::regclass::text,'name',t.tgname,
  'function_name',t.tgfoid::regprocedure::text,'event_type',t.tgtype::integer,'enabled',t.tgenabled::text,
  'deferrable',t.tgdeferrable,'initially_deferred',t.tginitdeferred,'arguments',encode(t.tgargs,'hex'),
  'columns',t.tgattr::text,'qualifier',pg_catalog.pg_get_expr(t.tgqual,t.tgrelid)) ORDER BY t.tgrelid::regclass::text,t.tgname)
 INTO actual FROM pg_catalog.pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid=ANY(ARRAY[
 'private.catalog_co_active_v2'::regclass,
 'private.catalog_po_active_v2'::regclass,
 'private.catalog_writer_active_v2'::regclass,
 'private.co_audit_events'::regclass,
 'private.co_commands'::regclass,
 'private.co_customer_state'::regclass,
 'private.co_delivery_heads'::regclass,
 'private.co_delivery_revision_lines'::regclass,
 'private.co_delivery_revisions'::regclass,
 'private.co_drafts'::regclass,
 'private.co_evidence'::regclass,
 'private.co_evidence_verifications'::regclass,
 'private.co_order_lines'::regclass,
 'private.co_orders'::regclass,
 'private.co_replay_generations'::regclass,
 'private.co_report_draft_lines'::regclass,
 'private.co_report_evidence'::regclass,
 'private.co_report_heads'::regclass,
 'private.co_report_revision_lines'::regclass,
 'private.co_report_revisions'::regclass,
 'private.co_return_heads'::regclass,
 'private.co_return_revision_lines'::regclass,
 'private.co_return_revisions'::regclass,
 'private.co_sale_allocations'::regclass,
 'private.co_stock_batches'::regclass,
 'private.co_stock_keys'::regclass,
 'private.co_stock_movements'::regclass,
 'private.pilot_order_requests'::regclass,
 'private.pilot_promo_movements'::regclass,
 'private.pilot_promo_slices'::regclass,
 'private.pilot_promotion_requests'::regclass,
 'private.pilot_schedule_requests'::regclass,
 'private.pilot_store_owner_audit_v1'::regclass,
 'private.pilot_visit_requests'::regclass,
 'private.pilot_visit_workflow_audit'::regclass,
 'public.customer_manager_assignments'::regclass,
 'public.customer_sales_rep_assignments'::regclass,
 'public.customer_targets'::regclass,
 'public.customers'::regclass,
 'public.girard_order_items'::regclass,
 'public.girard_orders'::regclass,
 'public.order_line_items'::regclass,
 'public.orders'::regclass,
 'public.outlet_visits'::regclass,
 'public.po_audit_log'::regclass,
 'public.po_line_items'::regclass,
 'public.products'::regclass,
 'public.promotions'::regclass,
 'public.purchase_orders'::regclass,
 'public.sales_schedules'::regclass,
 'public.sj_line_items'::regclass,
 'public.surat_jalan'::regclass,
 'public.visit_photos'::regclass,
 'public.visit_requests'::regclass
 ]);
 IF actual IS DISTINCT FROM expected THEN
  RAISE EXCEPTION 'Unreviewed checked writer trigger graph' USING ERRCODE='55000',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
 FOR entry IN SELECT * FROM (VALUES
 ('private.catalog_attest_execution_fence_v2()','ab19328e4a1d81f0142ce40b3ab6f5efd62d8897c34b9c73b8ac6b97227dd3c2'),
 ('private.catalog_business_truncate_fence_v2()','1640d75ee6dd81da28bda93020d1d07486248871d2c2f81a02d6c3a1552394fe'),
 ('private.catalog_business_write_fence_v2()','c2fa22d90828f8388ee9517623bb9ae89debf2dc2298cc4e3627e33fa4eb4c8a'),
 ('private.catalog_checked_context_v2()','34cb8467390bc71cc1ed8d3089dc4bc9dfc22feb00809b27f9ac2990614712b6'),
 ('private.catalog_checked_early_event_v2()','8a288a8a89db699391622293cd1da1a1f9bb1ea01b12556cd7054e46d9f40496'),
 ('private.catalog_co_assert_event_v2()','a2d61bee8cec2fd1f2802ee392f69dbfcdf85dfb8b8ce9d2852da4e45ab3481c'),
 ('private.catalog_co_context_empty_v2()','73b2a1a272062c7f8799e1cce018ca4167355812ea82f9898bf8e6c597244dd7'),
 ('private.catalog_co_execution_fence_v2()','2f0ba16ecb74a4b33bf0d50eebed52fd940ba46afd9adcef71fb5f4a63264210'),
 ('private.catalog_customer_targets_assert_v1()','58526c7aead817a222eec532b4235c358ae9105a3d6c47af4090d01a5d0006ca'),
 ('private.catalog_customer_targets_mark_v1()','c98f010ed5a98130c13b50de84e4ee4087e437bd0e3657943fa772a80b528e3c'),
 ('private.catalog_family_execution_fence_v2()','b19a483fa1d377373c95a8e337538693bbb961c62e8b7c84e127a78bfb9b8368'),
 ('private.catalog_master_after_v1()','e159ee748c9c22cf86caca92499acc1d04f38f67ff62360a3340c6348ad033de'),
 ('private.catalog_master_before_v1()','77a7e3fabe0c10073a888e05ee408018492be04c2f60b56cfa062d3094bb2021'),
 ('private.catalog_master_truncate_v1()','8106c87bf92790576397b6f61def1e0c946b0906a58ffb7de67a687cf5486fab'),
 ('private.catalog_po_assert_event_v2()','724655ca8092b32cef374fb2f0088a2e539c6539c3ec5b29091c4721ace9eb9b'),
 ('private.catalog_po_context_empty_v2()','8d31f1d41fb1f30afb2dd337658d7d73f0863eb8fdfcf93c16c2646cb24dfdc1'),
 ('private.catalog_product_delete_assert_v2()','116dda016e9adfdbe08d2332125ee34ec79cbf80c653062edabdbe3c0da2d89d'),
 ('private.catalog_product_delete_begin_v2()','cf5e3cbb79afeaf9a9ee3fd5742a03a92e889f7a0e981b519bdfcb48c1b3ac82'),
 ('private.catalog_product_delete_end_v2()','e8757a761637ef4757658d456505e304156822871fe4574e8128c81845f65de0'),
 ('private.catalog_product_delete_promotion_v2()','88cd89e6d52d7ca7e67ff6039fb003b832118abc81a94b3296cedb8b05fa2ffd'),
 ('private.catalog_product_delete_row_v2()','4fe3cc13c7de6c6fec9f119b509b9597a7fbe7691cfc53fc5e588b63aa1d1b20'),
 ('private.catalog_raw_drain_v2()','7f782e299e101dee161789090e9ccef6b1c9576da9afe535e48f15ee7da2836f'),
 ('private.catalog_writer_assert_event_v2()','09eb4ff9d37ffc4707c68e5ecef859d4d2cabc7f5317dda20e69777032acd773'),
 ('private.catalog_writer_context_empty_v2()','59c809da35c84c3c654ec6042c4cc6268d82ccea2a3766fafb839cd0401dfa70'),
 ('private.co_command_finished_v1()','7765d68dab98309a69bccd5cf55367ef33e6ece2dae33df18a94e853e03fd1e4'),
 ('private.co_command_guard_v1()','9b6ce02ef2e1a66dd905ee0aa28c62a86f092b51788e647b9a8c7a553cf44c2a'),
 ('private.co_customer_state_guard_v1()','8615bb92a61631eeb80bebb0622482692fc2e4439f923c547707399ad51af335'),
 ('private.co_evidence_guard_v1()','328bf7afb75bf9c7af6db01d3dd6515c44680e9d7aa201e41d845813f5b3f049'),
 ('private.co_generation_append_v1()','e512d630b91f5b0a36c8b32ab39548b122421bc7d03a8b940c4ed507f8552df2'),
 ('private.co_identity_guard_v1()','5e4fde322fabe5dd92071fecad3960fb4914f88a9606be2ac8d6b14cefe42270'),
 ('private.co_immutable_v1()','d72f9dfaee72a638df19ae15ced9ba5003a319a65dd261ff9d6b9bd6f5f68903'),
 ('private.co_prepare_sj_draft_v1()','5ef63aa260cbdc25c470ea15bf4a6aab9c464935a5a21b671be91ec24a376f90'),
 ('private.co_revision_line_guard_v1()','42c63b9a69abda916db1c4b96b88d80dc71c06c9a91c1ed612755189863161da'),
 ('private.co_source_snapshot_v1()','33bf858c67e6545be307400b18d9438e91f78242d75a2142f5eef4a7d8a72bb9'),
 ('private.demo_immutable_credit()','dac78da8d1f0f6acbf3aac9ccf4db87910057aaa205a188146992f9e8d11c479'),
 ('private.demo_immutable_evidence()','29398c8d7eb2ac9a955c3f04baf78bbdaa2ada0cf23602da89965d8729509063'),
 ('private.demo_order_execution_fence()','2ef5505a63d8a74057d3723efcf1ab5705642d465892093a79468ab916958502'),
 ('private.pilot_block_legacy_visit_claim_v1()','5e4b063c24423c98cbdcab1e0c27edc636572956f3d513a50d1a817831cb65ae'),
 ('private.pilot_complete_proven_visit()','3830c486bbf1e1d36f6b315d255bf679270e6f52bc0345469f9fb333d1fcd314'),
 ('private.pilot_freeze_visited_schedule()','852a7da2521d948845faef609937996506ffdd0c19174767ec50dcb35aad4744'),
 ('private.pilot_guard_actor_fields()','c2fce631acf2de5805c9f8c35cbb199ed486b8bed385613778e9a2777771d6f3'),
 ('private.pilot_schedule_origin_v1()','baf4d6bc9297cebda0324c0875b9dfa32ef7774ceaf7e92f6bd3084e3435dcbd'),
 ('private.pilot_store_owner_guard_v1()','80a27148324cc5c69404c93ed80f968915ae07791de8d4faa497040eecf0681b'),
 ('private.pilot_visit_evidence_v1()','42d03a08dcd2438839c0f4645cd5444a10b4596687f0ce3dc9da31b3acea1e0f'),
 ('public.check_po_completion()','e430d9136e1577a0f93b3f5f0e065801930079d93c8687c19422b627c548ea7a'),
 ('public.log_line_item_changes()','8065794d8a1c12fdb4cad7057c3aca5394b5c46dcce45ec11e25301a082523df'),
 ('public.log_po_changes()','8d15cbec095bd37a5bb7d69121bb8ad2cf54a3e3665efc47d9b6d4b547e3f2ce'),
 ('public.log_sj_changes()','502ecb7f99ee25bcd3daa3d1cad083dee8b59323287f74dd97d7f823e63ac8ba'),
 ('public.recalculate_po_total()','e3a77469531df8e378e8a370e4eacb5f7019ab138a29e80f03465dd4e9014269'),
 ('public.update_outlet_last_visit()','e48ea735b6eb90f5c4b775ecfdd583339da2a2ee77751e8587076449e6034d3d')
 ) h(signature,body_hash) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=entry.signature::regprocedure
   AND p.proowner='postgres'::regrole AND p.prokind='f' AND NOT p.proretset
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=entry.body_hash) THEN
   RAISE EXCEPTION 'Unreviewed checked writer trigger function' USING ERRCODE='55000',DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
 END LOOP;
END $$;

-- Exact source-defined privileges for the future three target APIs only. No
-- existing table/column grants or public writer permissions are modified.
DO $checked_boundary_revoke$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='private' AND p.proname=ANY(ARRAY['catalog_assert_checked_graph_v2','catalog_business_family_v2','catalog_business_row_allowed_v2','catalog_business_statement_allowed_v2','catalog_business_truncate_fence_v2','catalog_business_write_fence_v2','catalog_checked_context_empty_v2','catalog_checked_context_v2','catalog_checked_early_event_v2','catalog_checked_early_json_v2','catalog_checked_prepare_v2','catalog_checked_ref_allowed_v2','catalog_co_customer_phase_original_v2','catalog_co_customer_phase_v2','catalog_evidence_master_phase_original_v2','catalog_evidence_master_phase_v2','catalog_po_master_phase_original_v2','catalog_po_master_phase_v2','catalog_product_delete_assert_v2','catalog_product_delete_begin_v2','catalog_product_delete_defer_v2','catalog_product_delete_empty_v2','catalog_product_delete_end_v2','catalog_product_delete_promotion_v2','catalog_product_delete_row_v2','catalog_product_delete_topology_v2','catalog_target_authorize_v1','catalog_target_no_pending_v1','catalog_target_terminal_v1','catalog_writer_master_phase_original_v2','catalog_writer_master_phase_v2']))
 OR (n.nspname='public' AND p.proname=ANY(ARRAY['pilot_customer_target_upsert_v1','pilot_customer_target_write_access_v1','pilot_reconcile_customer_target_v1'])) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 END LOOP;
END $checked_boundary_revoke$;
GRANT EXECUTE ON FUNCTION public.pilot_customer_target_upsert_v1(uuid,uuid,text,numeric),public.pilot_reconcile_customer_target_v1(uuid),public.pilot_customer_target_write_access_v1() TO authenticated;
DO $checked_boundary_acl_postflight$
DECLARE count_functions integer;
BEGIN
 SELECT count(*) INTO count_functions FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='private' AND p.proname=ANY(ARRAY['catalog_assert_checked_graph_v2','catalog_business_family_v2','catalog_business_row_allowed_v2','catalog_business_statement_allowed_v2','catalog_business_truncate_fence_v2','catalog_business_write_fence_v2','catalog_checked_context_empty_v2','catalog_checked_context_v2','catalog_checked_early_event_v2','catalog_checked_early_json_v2','catalog_checked_prepare_v2','catalog_checked_ref_allowed_v2','catalog_co_customer_phase_original_v2','catalog_co_customer_phase_v2','catalog_evidence_master_phase_original_v2','catalog_evidence_master_phase_v2','catalog_po_master_phase_original_v2','catalog_po_master_phase_v2','catalog_product_delete_assert_v2','catalog_product_delete_begin_v2','catalog_product_delete_defer_v2','catalog_product_delete_empty_v2','catalog_product_delete_end_v2','catalog_product_delete_promotion_v2','catalog_product_delete_row_v2','catalog_product_delete_topology_v2','catalog_target_authorize_v1','catalog_target_no_pending_v1','catalog_target_terminal_v1','catalog_writer_master_phase_original_v2','catalog_writer_master_phase_v2']))
 OR (n.nspname='public' AND p.proname=ANY(ARRAY['pilot_customer_target_upsert_v1','pilot_customer_target_write_access_v1','pilot_reconcile_customer_target_v1']));
 IF count_functions<>34 OR EXISTS(
  SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
  WHERE ((n.nspname='private' AND p.proname=ANY(ARRAY['catalog_assert_checked_graph_v2','catalog_business_family_v2','catalog_business_row_allowed_v2','catalog_business_statement_allowed_v2','catalog_business_truncate_fence_v2','catalog_business_write_fence_v2','catalog_checked_context_empty_v2','catalog_checked_context_v2','catalog_checked_early_event_v2','catalog_checked_early_json_v2','catalog_checked_prepare_v2','catalog_checked_ref_allowed_v2','catalog_co_customer_phase_original_v2','catalog_co_customer_phase_v2','catalog_evidence_master_phase_original_v2','catalog_evidence_master_phase_v2','catalog_po_master_phase_original_v2','catalog_po_master_phase_v2','catalog_product_delete_assert_v2','catalog_product_delete_begin_v2','catalog_product_delete_defer_v2','catalog_product_delete_empty_v2','catalog_product_delete_end_v2','catalog_product_delete_promotion_v2','catalog_product_delete_row_v2','catalog_product_delete_topology_v2','catalog_target_authorize_v1','catalog_target_no_pending_v1','catalog_target_terminal_v1','catalog_writer_master_phase_original_v2','catalog_writer_master_phase_v2']))
   OR (n.nspname='public' AND p.proname=ANY(ARRAY['pilot_customer_target_upsert_v1','pilot_customer_target_write_access_v1','pilot_reconcile_customer_target_v1'])))
  AND (p.proowner<>'postgres'::regrole OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] OR p.prokind<>'f'
   OR a.grantor<>p.proowner OR a.privilege_type<>'EXECUTE'
   OR (a.grantee<>p.proowner AND NOT(n.nspname='public' AND a.grantee='authenticated'::regrole AND NOT a.is_grantable))))
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
  WHERE n.nspname='private' AND c.relname=ANY(ARRAY['catalog_checked_scope_v2','catalog_product_delete_rows_v2','catalog_product_delete_scope_v2','catalog_target_active_v1','catalog_target_policy_contract_v1','catalog_target_requests_v1']
  ) AND (c.relowner<>'postgres'::regrole OR NOT c.relrowsecurity OR c.relforcerowsecurity OR c.relkind<>'r'
   OR a.grantee<>c.relowner OR a.grantor<>c.relowner))
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='private' AND c.relname=ANY(ARRAY['catalog_checked_scope_v2','catalog_product_delete_rows_v2','catalog_product_delete_scope_v2','catalog_target_active_v1','catalog_target_policy_contract_v1','catalog_target_requests_v1'])) THEN
  RAISE EXCEPTION 'Unexpected checked boundary ACL or owner' USING ERRCODE='42501'; END IF;
 IF (SELECT execution_generation<>1 OR tracking_ready FROM private.catalog_cutover_v1 WHERE singleton)
 OR (SELECT count(*) FROM pg_catalog.pg_constraint WHERE conrelid='private.catalog_cutover_v1'::regclass
  AND conname IN('catalog_foundation_generation_one','catalog_foundation_not_ready') AND convalidated)<>2 THEN
  RAISE EXCEPTION 'Inactive generation-one constraints required' USING ERRCODE='55000'; END IF;
END $checked_boundary_acl_postflight$;
