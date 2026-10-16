-- Additive Task 3 create/edit vertical. Apply in the existing rollback-only harness.
-- This proves the explicitly reviewed synthetic/public policy composition only.
-- Composed new10/new11 supply certified birth and guarded-delete hooks. This
-- file does not assert hosted parity, activate cutover, change master ACLs, relax
-- policy scope, or mark catalogue-only edits as business use.
-- SECURITY DEFINER does NOT inherit caller RLS. Effective column ACLs and the
-- current old/proposed-row predicates are checked explicitly below. Unknown
-- policy/helper shapes fail closed rather than being evaluated as the definer.

-- Retain the exact reviewed status bodies. Their private copies are owner-only;
-- the stable public signatures below dispatch into them without new target reads.
ALTER FUNCTION public.pilot_catalog_transaction_v1(uuid,text,jsonb) RENAME TO catalog_status_transaction_v1;
ALTER FUNCTION public.catalog_status_transaction_v1(uuid,text,jsonb) SET SCHEMA private;
REVOKE ALL ON FUNCTION private.catalog_status_transaction_v1(uuid,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.pilot_reconcile_catalog_v1(uuid,boolean) RENAME TO catalog_status_reconcile_v1;
ALTER FUNCTION public.catalog_status_reconcile_v1(uuid,boolean) SET SCHEMA private;
REVOKE ALL ON FUNCTION private.catalog_status_reconcile_v1(uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE private.catalog_requests_v1
  DROP CONSTRAINT catalog_requests_v1_status_check,
  DROP CONSTRAINT catalog_request_terminal_shape_v1,
  ADD COLUMN fingerprint text,
  ADD COLUMN write_columns text[],
  ADD CONSTRAINT catalog_requests_v1_status_check CHECK (status IN ('pending','committed','abandoned')),
  ADD CONSTRAINT catalog_request_terminal_shape_v1 CHECK ((
    (status='abandoned' AND binding IS NULL AND receipt IS NULL AND fingerprint IS NULL AND write_columns IS NULL)
    OR (status='committed' AND binding->>'operation'='set_enabled' AND jsonb_typeof(binding)='object'
      AND jsonb_typeof(receipt)='object' AND fingerprint IS NULL AND write_columns IS NULL)
    OR (binding->>'operation' IN ('create','edit') AND jsonb_typeof(binding)='object'
      AND fingerprint ~ '^[0-9a-f]{64}$' AND cardinality(write_columns)>0
      AND ((status='pending' AND receipt IS NULL) OR (status='committed' AND jsonb_typeof(receipt)='object')
        OR (status='abandoned' AND receipt IS NULL)))) IS TRUE);

CREATE OR REPLACE FUNCTION private.catalog_request_terminal_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.status='pending' AND NEW.status IN ('committed','abandoned')
    AND ROW(NEW.actor_id,NEW.request_id,NEW.binding,NEW.fingerprint,NEW.write_columns)
      IS NOT DISTINCT FROM ROW(OLD.actor_id,OLD.request_id,OLD.binding,OLD.fingerprint,OLD.write_columns) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Catalogue terminal request evidence is immutable'
    USING ERRCODE='23514', DETAIL='CATALOG_REQUEST_IMMUTABLE';
END $$;
CREATE FUNCTION private.catalog_request_no_pending_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Read terminal CURRENT state, not the INSERT event's pending NEW image.
  -- Assertion-only: never repairs, locks, mutates, or produces a receipt.
  IF EXISTS(SELECT 1 FROM private.catalog_requests_v1 r
      WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id AND r.status='pending') THEN
    RAISE EXCEPTION 'Catalogue request is not terminal' USING ERRCODE='23514', DETAIL='CATALOG_REQUEST_PENDING';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.catalog_request_no_pending_v1() FROM PUBLIC, anon, authenticated, service_role;
CREATE CONSTRAINT TRIGGER catalog_request_no_pending_v1 AFTER INSERT OR UPDATE ON private.catalog_requests_v1
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.catalog_request_no_pending_v1();

-- Build expected policy trees from finite reviewed expressions, NOT from whatever
-- happens to be installed. pg_get_expr canonicalizes both at the same search_path.
CREATE TEMP TABLE catalog_customer_policy_reference_v1(id uuid) ON COMMIT DROP;
CREATE TEMP TABLE catalog_product_policy_reference_v1(id uuid) ON COMMIT DROP;
CREATE POLICY fixture_read ON pg_temp.catalog_customer_policy_reference_v1 FOR SELECT TO authenticated USING (true);
CREATE POLICY fixture_write ON pg_temp.catalog_customer_policy_reference_v1 FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY pilot_active_profile ON pg_temp.catalog_customer_policy_reference_v1 AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_role() IS NOT NULL) WITH CHECK (public.current_user_role() IS NOT NULL);
CREATE POLICY catalog_co_customer_insert_v1 ON pg_temp.catalog_customer_policy_reference_v1 FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND public.current_user_role()='co_admin');
CREATE POLICY catalog_co_customer_update_v1 ON pg_temp.catalog_customer_policy_reference_v1 FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND public.current_user_role()='co_admin')
  WITH CHECK (auth.uid() IS NOT NULL AND public.current_user_role()='co_admin');
CREATE POLICY pilot_customer_visibility ON pg_temp.catalog_customer_policy_reference_v1 AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.current_user_role()='co_admin' OR private.pilot_can_access_customer(id));
CREATE POLICY co_master_customer_read_v1 ON pg_temp.catalog_customer_policy_reference_v1 FOR SELECT TO authenticated
  USING (public.current_user_role()='co_admin');
CREATE POLICY store_owner_customer_read_v1 ON pg_temp.catalog_customer_policy_reference_v1 FOR SELECT TO authenticated
  USING (private.pilot_can_access_customer(id));
CREATE POLICY fixture_read ON pg_temp.catalog_product_policy_reference_v1 FOR SELECT TO authenticated USING (true);
CREATE POLICY fixture_write ON pg_temp.catalog_product_policy_reference_v1 FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY pilot_active_profile ON pg_temp.catalog_product_policy_reference_v1 AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_role() IS NOT NULL) WITH CHECK (public.current_user_role() IS NOT NULL);
CREATE POLICY catalog_co_product_insert_v1 ON pg_temp.catalog_product_policy_reference_v1 FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND public.current_user_role()='co_admin');
CREATE POLICY catalog_co_product_update_v1 ON pg_temp.catalog_product_policy_reference_v1 FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND public.current_user_role()='co_admin')
  WITH CHECK (auth.uid() IS NOT NULL AND public.current_user_role()='co_admin');
CREATE FUNCTION private.catalog_write_policy_signature_v1(p_table regclass) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,
    'roles',p.polroles,'permissive',p.polpermissive,
    'using',pg_catalog.pg_get_expr(p.polqual,p.polrelid),
    'check',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname),'[]'::jsonb)
  FROM pg_catalog.pg_policy p WHERE p.polrelid=p_table AND p.polcmd IN ('*','r','a','w');
$$;
REVOKE ALL ON FUNCTION private.catalog_write_policy_signature_v1(regclass) FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE private.catalog_write_policy_contract_v1 (
  kind text PRIMARY KEY CHECK(kind IN ('customer','product')), expected_policies jsonb NOT NULL,
  helpers jsonb NOT NULL
);
ALTER TABLE private.catalog_write_policy_contract_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.catalog_write_policy_contract_v1 FROM PUBLIC, anon, authenticated, service_role;

-- The only nontrivial policy helpers are pinned to reviewed source semantics.
-- Their full metadata is subsequently checked on every fresh write. Auth identity
-- remains the same issuing-service helper used by the original RLS policies.
DO $helper_source_preflight$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid IN (
      'public.current_user_role()'::regprocedure,'private.pilot_can_access_customer(uuid)'::regprocedure)
      AND (p.proowner<>'postgres'::regrole::oid OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='sql')
        OR NOT p.prosecdef OR p.provolatile<>'s' OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u'
        OR p.prokind<>'f' OR p.proretset OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']))
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='auth.uid()'::regprocedure
      AND p.proowner='postgres'::regrole::oid AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='sql')
      AND NOT p.prosecdef AND p.provolatile='s' AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u'
      AND p.prokind='f' AND NOT p.proretset AND p.proconfig IS NULL
      AND regexp_replace(p.prosrc,'[[:space:]]','','g')=regexp_replace(
        $identity$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $identity$,'[[:space:]]','','g')) THEN
    RAISE EXCEPTION 'Unreviewed catalogue helper metadata' USING ERRCODE='42501', DETAIL='CATALOG_POLICY_PARITY_UNPROVED';
  END IF;
  IF (SELECT regexp_replace(prosrc,'[[:space:]]','','g') FROM pg_catalog.pg_proc WHERE oid='public.current_user_role()'::regprocedure)
    IS DISTINCT FROM regexp_replace($source$
  SELECT role FROM public.users WHERE id = auth.uid() AND is_active;
$source$,'[[:space:]]','','g') THEN
    RAISE EXCEPTION 'Unreviewed catalogue policy helper' USING ERRCODE='42501', DETAIL='CATALOG_POLICY_PARITY_UNPROVED';
  END IF;
  IF (SELECT regexp_replace(prosrc,'[[:space:]]','','g') FROM pg_catalog.pg_proc WHERE oid='private.pilot_can_access_customer(uuid)'::regprocedure)
    IS DISTINCT FROM regexp_replace($source$
 SELECT COALESCE(public.current_user_role() IN ('po_admin','sales_head','executive')
 OR (public.current_user_role()='sales_manager' AND private.pilot_store_in_manager_scope_v1(customer,auth.uid()))
 OR (public.current_user_role()='sales_person' AND (
   EXISTS(SELECT 1 FROM public.customer_manager_assignments a WHERE a.customer_id=customer AND a.manager_id=auth.uid())
   OR EXISTS(SELECT 1 FROM public.sales_schedules s WHERE s.outlet_id=customer AND s.sales_person_id=auth.uid()))),false);
$source$,'[[:space:]]','','g') THEN
    RAISE EXCEPTION 'Unreviewed catalogue policy helper' USING ERRCODE='42501', DETAIL='CATALOG_POLICY_PARITY_UNPROVED';
  END IF;
END $helper_source_preflight$;
INSERT INTO private.catalog_write_policy_contract_v1(kind,expected_policies,helpers)
SELECT kind,private.catalog_write_policy_signature_v1(reference),
  (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_proc p
    WHERE p.oid IN ('public.current_user_role()'::regprocedure,'private.pilot_can_access_customer(uuid)'::regprocedure,'auth.uid()'::regprocedure))
FROM (VALUES ('customer','pg_temp.catalog_customer_policy_reference_v1'::regclass),
  ('product','pg_temp.catalog_product_policy_reference_v1'::regclass)) x(kind,reference);
CREATE FUNCTION private.catalog_write_contract_immutable_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Reviewed policy contract is immutable' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION private.catalog_write_contract_immutable_v1() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER catalog_write_contract_immutable_v1 BEFORE INSERT OR UPDATE OR DELETE ON private.catalog_write_policy_contract_v1
  FOR EACH ROW EXECUTE FUNCTION private.catalog_write_contract_immutable_v1();
CREATE TRIGGER catalog_write_contract_no_truncate_v1 BEFORE TRUNCATE ON private.catalog_write_policy_contract_v1
  FOR EACH STATEMENT EXECUTE FUNCTION private.catalog_write_contract_immutable_v1();

CREATE FUNCTION private.catalog_assert_write_policy_v1(p_kind text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target regclass; expected private.catalog_write_policy_contract_v1%ROWTYPE; helpers jsonb;
BEGIN
  target := CASE p_kind WHEN 'customer' THEN 'public.customers'::regclass WHEN 'product' THEN 'public.products'::regclass END;
  SELECT * INTO expected FROM private.catalog_write_policy_contract_v1 WHERE kind=p_kind;
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) INTO helpers FROM pg_catalog.pg_proc p
    WHERE p.oid IN ('public.current_user_role()'::regprocedure,'private.pilot_can_access_customer(uuid)'::regprocedure,'auth.uid()'::regprocedure);
  IF EXISTS(SELECT 1 FROM unnest(ARRAY['public.current_user_role()'::regprocedure,'private.pilot_can_access_customer(uuid)'::regprocedure,'auth.uid()'::regprocedure]) f
      WHERE NOT pg_catalog.has_function_privilege('authenticated',f,'EXECUTE'))
    OR target IS NULL OR expected.kind IS NULL OR expected.helpers IS DISTINCT FROM helpers
    OR expected.expected_policies IS DISTINCT FROM private.catalog_write_policy_signature_v1(target)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=target AND c.relkind='r'
      AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition
      AND c.relowner<> 'authenticated'::regrole::oid)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid=target OR inhparent=target)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticated' AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Catalogue write policy parity is unproved' USING ERRCODE='42501', DETAIL='CATALOG_POLICY_PARITY_UNPROVED';
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.catalog_assert_write_policy_v1(text) FROM PUBLIC, anon, authenticated, service_role;
SELECT private.catalog_assert_write_policy_v1('customer'), private.catalog_assert_write_policy_v1('product');

CREATE FUNCTION private.catalog_authorize_fields_v1(p_operation text,p_kind text,p_columns text[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid; target regclass; column_name text; privilege text;
BEGIN
  actor := private.catalog_authorize_v1(NULL,NULL);
  target := CASE p_kind WHEN 'customer' THEN 'public.customers'::regclass WHEN 'product' THEN 'public.products'::regclass END;
  privilege := CASE p_operation WHEN 'create' THEN 'INSERT' WHEN 'edit' THEN 'UPDATE' END;
  IF target IS NULL OR privilege IS NULL OR p_columns IS NULL OR cardinality(p_columns)=0 THEN
    RAISE EXCEPTION 'Catalogue access denied' USING ERRCODE='42501', DETAIL='CATALOG_ACCESS_DENIED';
  END IF;
  -- These are effective authenticated grants (including inherited edges), never
  -- current_user inside the definer. Only actual written columns are required.
  FOREACH column_name IN ARRAY p_columns LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=target
      AND a.attname=column_name AND a.attnum>0 AND NOT a.attisdropped
      AND pg_catalog.has_column_privilege('authenticated',target,a.attnum,privilege)) THEN
      RAISE EXCEPTION 'Catalogue field access denied' USING ERRCODE='42501', DETAIL='CATALOG_ACCESS_DENIED';
    END IF;
  END LOOP;
  -- WHERE/version checks and receipt RETURNING require these exact read grants.
  FOREACH column_name IN ARRAY ARRAY['id','catalog_version','is_enabled'] LOOP
    IF NOT pg_catalog.has_column_privilege('authenticated',target,column_name,'SELECT') THEN
      RAISE EXCEPTION 'Catalogue read access denied' USING ERRCODE='42501', DETAIL='CATALOG_ACCESS_DENIED';
    END IF;
  END LOOP;
  RETURN actor;
END $$;
REVOKE ALL ON FUNCTION private.catalog_authorize_fields_v1(text,text,text[]) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.catalog_assert_write_row_v1(p_kind text,p_row jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE role public.user_role := public.current_user_role();
BEGIN
  -- With the exact current signature above, permissive fixture_write is true;
  -- restrictive ALL USING/WITH CHECK require an active profile. Customer SELECT
  -- adds this exact visibility predicate. CO form policies add no narrower scope.
  -- Call for BOTH locked old and proposed edit rows, and proposed create rows.
  -- This is an explicit proof for these predicates, not caller-RLS inheritance.
  IF role IS NULL OR role NOT IN ('co_admin','po_admin','executive') OR auth.uid() IS NULL
    OR jsonb_typeof(p_row) IS DISTINCT FROM 'object' OR p_row->>'id' IS NULL
    OR p_kind NOT IN ('customer','product')
    OR (p_kind='customer' AND NOT coalesce(role='co_admin' OR private.pilot_can_access_customer((p_row->>'id')::uuid),false)) THEN
    RAISE EXCEPTION 'Catalogue row access denied' USING ERRCODE='42501', DETAIL='CATALOG_ACCESS_DENIED';
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.catalog_assert_write_row_v1(text,jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.catalog_validate_values_v1(p_operation text,p_kind text,p_values jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE fields text[]; item record; value_type text;
BEGIN
  fields := CASE p_kind WHEN 'customer' THEN ARRAY['name','address','city','phone','email','pricing_tier','customer_category']
    WHEN 'product' THEN ARRAY['name','sku','size','harga_pokok','luar_kota','dalam_kota','depo_bangunan'] END;
  IF fields IS NULL OR jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR p_values='{}'::jsonb
    OR p_values-fields <> '{}'::jsonb OR (p_operation='create' AND NOT p_values ?& fields) THEN
    RAISE EXCEPTION 'Invalid catalogue fields' USING ERRCODE='22023', DETAIL='CATALOG_INVALID_INPUT';
  END IF;
  FOR item IN SELECT key,value FROM jsonb_each(p_values) LOOP
    value_type := jsonb_typeof(item.value);
    IF item.key IN ('name','sku') THEN
      IF value_type IS DISTINCT FROM 'string' OR btrim(item.value#>>'{}')='' THEN
        RAISE EXCEPTION 'Catalogue name or SKU required' USING ERRCODE='22023', DETAIL='CATALOG_INVALID_INPUT';
      END IF;
    ELSIF item.key='pricing_tier' THEN
      IF value_type IS DISTINCT FROM 'string' OR item.value#>>'{}' NOT IN ('harga_pokok','luar_kota','dalam_kota','depo_bangunan','others') THEN
        RAISE EXCEPTION 'Invalid price tier' USING ERRCODE='22023', DETAIL='CATALOG_INVALID_INPUT';
      END IF;
    ELSIF item.key='customer_category' THEN
      IF NOT (p_operation='edit' AND value_type='null') AND
        (value_type IS DISTINCT FROM 'string' OR item.value#>>'{}' NOT IN ('supermarket_besar','supermarket_sedang','supermarket_kecil','tradisional_market','perorangan')) THEN
        RAISE EXCEPTION 'Invalid customer category' USING ERRCODE='22023', DETAIL='CATALOG_INVALID_INPUT';
      END IF;
    ELSIF item.key IN ('harga_pokok','luar_kota','dalam_kota','depo_bangunan') THEN
      IF value_type<>'null' AND (value_type IS DISTINCT FROM 'number') THEN
        RAISE EXCEPTION 'Invalid price' USING ERRCODE='22023', DETAIL='CATALOG_INVALID_INPUT';
      END IF;
      IF value_type='number' AND ((item.value#>>'{}')::numeric<0 OR (item.value#>>'{}')::numeric>999999999999.99
        OR trunc((item.value#>>'{}')::numeric,2)<>(item.value#>>'{}')::numeric) THEN
        RAISE EXCEPTION 'Invalid price' USING ERRCODE='22023', DETAIL='CATALOG_INVALID_INPUT';
      END IF;
    ELSIF value_type NOT IN ('null','string') THEN
      RAISE EXCEPTION 'Invalid catalogue text' USING ERRCODE='22023', DETAIL='CATALOG_INVALID_INPUT';
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.catalog_validate_values_v1(text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Stored request authority is checked before EVERY public dispatch branch. A
-- status/create/edit probe cannot reveal a former CO's retained delete result.
CREATE FUNCTION private.catalog_authorize_bound_v1(p_binding jsonb,p_columns text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid; target regclass; column_name text;
BEGIN
  actor := private.catalog_authorize_v1(NULL,NULL);
  IF jsonb_typeof(p_binding) IS DISTINCT FROM 'object' OR p_binding->>'kind' IS NULL OR p_binding->>'kind' NOT IN ('customer','product') THEN
    RAISE EXCEPTION 'Catalogue access denied' USING ERRCODE='42501', DETAIL='CATALOG_ACCESS_DENIED';
  END IF;
  CASE p_binding->>'operation'
    WHEN 'create','edit' THEN
      PERFORM private.catalog_authorize_fields_v1(p_binding->>'operation',p_binding->>'kind',p_columns);
    WHEN 'set_enabled' THEN
      PERFORM private.catalog_authorize_v1(p_binding->>'kind',(p_binding->>'id')::uuid);
    WHEN 'delete_unused' THEN
      -- This is the CO-only command grant, NOT a raw DELETE privilege or UI flag.
      -- Base authorization holds the actual active users row in SHARE mode.
      IF public.current_user_role() IS DISTINCT FROM 'co_admin'::public.user_role THEN
        RAISE EXCEPTION 'Catalogue access denied' USING ERRCODE='42501', DETAIL='CATALOG_ACCESS_DENIED'; END IF;
      PERFORM private.catalog_authorize_v1(p_binding->>'kind','00000000-0000-0000-0000-000000000000'::uuid);
      target := CASE p_binding->>'kind' WHEN 'customer' THEN 'public.customers'::regclass ELSE 'public.products'::regclass END;
      FOREACH column_name IN ARRAY ARRAY['id','catalog_version','is_enabled'] LOOP
        IF NOT pg_catalog.has_column_privilege('authenticated',target,column_name,'SELECT') THEN
          RAISE EXCEPTION 'Catalogue access denied' USING ERRCODE='42501', DETAIL='CATALOG_ACCESS_DENIED'; END IF;
      END LOOP;
    ELSE RAISE EXCEPTION 'Catalogue access denied' USING ERRCODE='42501', DETAIL='CATALOG_ACCESS_DENIED';
  END CASE;
END $$;
REVOKE ALL ON FUNCTION private.catalog_authorize_bound_v1(jsonb,text[]) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.catalog_reauthorize_request_v1(p_request_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid; prior private.catalog_requests_v1%ROWTYPE;
BEGIN
  actor := private.catalog_authorize_v1(NULL,NULL);
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Invalid catalogue request' USING ERRCODE='22023', DETAIL='CATALOG_INVALID_INPUT'; END IF;
  IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
      'catalog_request_v1:'||actor::text||':'||p_request_id::text,1801427914)) THEN
    RAISE EXCEPTION 'Catalogue request is busy' USING ERRCODE='55P03', DETAIL='CATALOG_REQUEST_BUSY'; END IF;
  LOCK TABLE private.catalog_requests_v1 IN ROW EXCLUSIVE MODE NOWAIT;
  SELECT * INTO prior FROM private.catalog_requests_v1 WHERE actor_id=actor AND request_id=p_request_id;
  IF FOUND AND prior.binding IS NOT NULL THEN
    PERFORM private.catalog_authorize_bound_v1(prior.binding,prior.write_columns);
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.catalog_reauthorize_request_v1(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.pilot_catalog_transaction_v1(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
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

CREATE FUNCTION public.pilot_reconcile_catalog_v1(p_request_id uuid,p_abandon boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid; prior private.catalog_requests_v1%ROWTYPE;
BEGIN
  actor := private.catalog_authorize_v1(NULL,NULL);
  IF p_request_id IS NULL OR p_abandon IS NULL THEN
    RAISE EXCEPTION 'Invalid catalogue recovery' USING ERRCODE='22023', DETAIL='CATALOG_INVALID_INPUT'; END IF;
  IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
      'catalog_request_v1:'||actor::text||':'||p_request_id::text,1801427914)) THEN
    RAISE EXCEPTION 'Catalogue request is busy' USING ERRCODE='55P03', DETAIL='CATALOG_REQUEST_BUSY'; END IF;
  LOCK TABLE private.catalog_requests_v1 IN ROW EXCLUSIVE MODE NOWAIT;
  SELECT * INTO prior FROM private.catalog_requests_v1 WHERE actor_id=actor AND request_id=p_request_id;
  IF FOUND AND prior.binding IS NOT NULL THEN
    PERFORM private.catalog_authorize_bound_v1(prior.binding,prior.write_columns);
  END IF;
  IF prior.actor_id IS NULL OR prior.binding IS NULL OR prior.binding->>'operation'='set_enabled' THEN
    -- Unknown/unbound abandonment and status behavior retain their exact body.
    RETURN private.catalog_status_reconcile_v1(p_request_id,p_abandon);
  END IF;
  PERFORM private.catalog_authorize_bound_v1(prior.binding,prior.write_columns);
  IF prior.status='committed' THEN RETURN jsonb_build_object('status','committed','receipt',prior.receipt); END IF;
  IF prior.status='abandoned' THEN RETURN jsonb_build_object('status','abandoned'); END IF;
  RAISE EXCEPTION 'Catalogue request is pending' USING ERRCODE='55P03', DETAIL='CATALOG_REQUEST_BUSY';
END $$;
REVOKE ALL ON FUNCTION public.pilot_reconcile_catalog_v1(uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pilot_reconcile_catalog_v1(uuid,boolean) TO authenticated;

-- Exhaustive ACL postflight for every object introduced or renamed in this file.
DO $catalog_create_edit_acl_postflight$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    WHERE p.oid IN (
      'private.catalog_status_transaction_v1(uuid,text,jsonb)'::regprocedure,
      'private.catalog_status_reconcile_v1(uuid,boolean)'::regprocedure,
      'private.catalog_request_terminal_v1()'::regprocedure,
      'private.catalog_request_no_pending_v1()'::regprocedure,
      'private.catalog_write_policy_signature_v1(regclass)'::regprocedure,
      'private.catalog_write_contract_immutable_v1()'::regprocedure,
      'private.catalog_assert_write_policy_v1(text)'::regprocedure,
      'private.catalog_authorize_fields_v1(text,text,text[])'::regprocedure,
      'private.catalog_assert_write_row_v1(text,jsonb)'::regprocedure,
      'private.catalog_validate_values_v1(text,text,jsonb)'::regprocedure,
      'private.catalog_authorize_bound_v1(jsonb,text[])'::regprocedure,
      'private.catalog_reauthorize_request_v1(uuid)'::regprocedure,
      'public.pilot_catalog_transaction_v1(uuid,text,jsonb)'::regprocedure,
      'public.pilot_reconcile_catalog_v1(uuid,boolean)'::regprocedure)
    AND a.grantee<>p.proowner AND NOT (p.oid IN (
      'public.pilot_catalog_transaction_v1(uuid,text,jsonb)'::regprocedure,
      'public.pilot_reconcile_catalog_v1(uuid,boolean)'::regprocedure)
      AND a.grantee='authenticated'::regrole::oid AND a.privilege_type='EXECUTE' AND NOT a.is_grantable))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL
      pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
      WHERE c.oid='private.catalog_write_policy_contract_v1'::regclass AND a.grantee<>c.relowner) THEN
    RAISE EXCEPTION 'Unexpected catalogue create/edit ACL' USING ERRCODE='42501';
  END IF;
END $catalog_create_edit_acl_postflight$;
