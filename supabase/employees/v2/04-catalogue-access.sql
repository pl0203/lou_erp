-- PREPARED LOCAL CANDIDATE ONLY. No staging execution/deployment authorization.
-- Apply inside reviewed atomic transaction after 01/02/03. Required for installed catalogue/targets.
-- Current captured source, NOT an assumption of historical/live equivalence.
-- Exact source + security/configuration/ACL preimages fail closed; no grants added.
SET LOCAL search_path=pg_catalog,pg_temp;
DO $preimages$ DECLARE entry record; BEGIN
 IF to_regprocedure('private.employee_account_allowed(uuid)') IS NULL THEN RAISE EXCEPTION 'EMPLOYEE_ACCESS_GATE_REQUIRED'; END IF;
 FOR entry IN SELECT * FROM (VALUES
('private.catalog_authorize_v1(text,uuid)','500b7634fe428377daec22a146729cbf978be110b478a479500544c4fc3d2002','58f8198a19d773f8ea457b1d71fe8464c43848605eb99fc9528f3870e90f0c9d',true,ARRAY['search_path=""']::text[],'{postgres=X/postgres}'),
('private.sales_target_actor_v1()','d85b302b7e7fe1042277840d1a3bd9aa2f2a407ad9aff2e72c7a358a001dab3b','05b4a8cfca8729ec0469746bcde21c19bdc5e4406e1411737dfdf959b6f24c4b',false,ARRAY['search_path=""']::text[],'{postgres=X/postgres}')
 ) x(signature,before_sha256,after_sha256,security_definer,configuration,privileges) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure(entry.signature)
   AND p.proowner='postgres'::regrole AND p.prosecdef=entry.security_definer
   AND p.proconfig=entry.configuration AND p.proacl::text=entry.privileges
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IN(entry.before_sha256,entry.after_sha256)) THEN
   RAISE EXCEPTION 'EMPLOYEE_PROTECTED_GATE_PREIMAGE_MISMATCH: %',entry.signature;
  END IF;
 END LOOP;
END $preimages$;

-- Captured staging source 2026-10-24; identity/ACL retained.
CREATE OR REPLACE FUNCTION private.catalog_authorize_v1(p_kind text, p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid := auth.uid(); actor_role public.user_role; target_table regclass; writable boolean;
BEGIN
  -- current_user here is the definer, not the API caller. Neither a JWT claim
  -- alone nor service/owner execution supplies the authenticated entry boundary.
  IF current_setting('role', true) IS DISTINCT FROM 'authenticated' OR actor IS NULL THEN
    RAISE EXCEPTION 'Catalogue access denied' USING ERRCODE = '42501', DETAIL = 'CATALOG_ACCESS_DENIED';
  END IF;
  -- Hold the current profile against role/active changes until this transaction
  -- ends. FOR KEY SHARE would not prevent updates to these authority columns.
  LOCK TABLE public.users IN ROW SHARE MODE NOWAIT;
  SELECT u.role INTO actor_role FROM public.users u WHERE u.id = actor AND u.is_active AND private.employee_account_allowed(u.id) FOR SHARE NOWAIT;
  IF NOT FOUND OR actor_role IS NULL OR actor_role NOT IN ('co_admin', 'po_admin', 'executive') THEN
    RAISE EXCEPTION 'Catalogue access denied' USING ERRCODE = '42501', DETAIL = 'CATALOG_ACCESS_DENIED';
  END IF;
  IF p_kind IS NULL AND p_id IS NULL THEN RETURN actor; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('customer', 'product') OR p_id IS NULL THEN
    RAISE EXCEPTION 'Catalogue access denied' USING ERRCODE = '42501', DETAIL = 'CATALOG_ACCESS_DENIED';
  END IF;
  target_table := CASE p_kind WHEN 'customer' THEN 'public.customers'::regclass ELSE 'public.products'::regclass END;
  SELECT coalesce(bool_and(pg_catalog.has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')), false)
    INTO writable FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = target_table AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname NOT IN ('is_enabled', 'catalog_version');
  -- The synthetic masters have all-row permissive writes, restrictive active
  -- profile checks, and this customer visibility rule. CO UPDATE denials were
  -- replaced above. PO/executive visibility is supplied by the existing helper.
  IF NOT writable OR (p_kind = 'customer' AND NOT coalesce(
      actor_role = 'co_admin' OR private.pilot_can_access_customer(p_id), false)) THEN
    RAISE EXCEPTION 'Catalogue access denied' USING ERRCODE = '42501', DETAIL = 'CATALOG_ACCESS_DENIED';
  END IF;
  RETURN actor;
END $function$;

-- Captured staging source 2026-10-24; identity/ACL retained.
CREATE OR REPLACE FUNCTION private.sales_target_actor_v1()
 RETURNS public.users
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE actor public.users;
BEGIN
 SELECT * INTO actor FROM public.users WHERE id=auth.uid() AND is_active AND private.employee_account_allowed(id);
 IF actor.id IS NULL OR actor.role::text NOT IN('sales_person','sales_manager','sales_head','executive') THEN
  RAISE EXCEPTION 'Active sales actor required' USING ERRCODE='42501';
 END IF;
 RETURN actor;
END$function$;

-- Prepared guards inspect local pg_proc hashes, not dynamic body rewriting.
-- The pinned private evidence producer bodies and history graph stay untouched.
DO $catalogue_preimages$ DECLARE entry record; BEGIN
 FOR entry IN SELECT * FROM (VALUES
('private.catalog_assert_write_policy_v1(text)','289336c03c726c279cff6ea00e5ed21e722c06fac225190d39041e3256d4d9f6','9d2735b01503b9f419f7095d528bea1de2385acae5771976f13da067e1ab7104',true,ARRAY['search_path=""']::text[],'{postgres=X/postgres}'),
('public.pilot_co_evidence_attest_v1(uuid,uuid,uuid,text,bigint,text,text)','4b9babc775fe8eae355f790e9f4ed6ff3378a4b76f199c92175ce776c9e57fa3','9a879d7a2f3f98da5d97005f72e8edbbf71b077767169c320040316877b09a67',true,ARRAY['search_path=""']::text[],'{postgres=X/postgres,service_role=X/postgres}')
 ) x(signature,before_sha256,after_sha256,security_definer,configuration,privileges) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure(entry.signature)
   AND p.proowner='postgres'::regrole AND p.prosecdef=entry.security_definer
   AND p.proconfig=entry.configuration AND p.proacl::text=entry.privileges
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IN(entry.before_sha256,entry.after_sha256)) THEN
   RAISE EXCEPTION 'EMPLOYEE_CATALOGUE_GATE_PREIMAGE_MISMATCH: %',entry.signature;
  END IF;
 END LOOP;
END $catalogue_preimages$;
CREATE OR REPLACE FUNCTION private.catalog_assert_write_policy_v1(p_kind text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE target regclass; expected private.catalog_write_policy_contract_v1%ROWTYPE; helpers jsonb;
BEGIN
  target := CASE p_kind WHEN 'customer' THEN 'public.customers'::regclass WHEN 'product' THEN 'public.products'::regclass END;
  SELECT * INTO expected FROM private.catalog_write_policy_contract_v1 WHERE kind=p_kind;
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) INTO helpers FROM pg_catalog.pg_proc p
    WHERE p.oid IN ('public.current_user_role()'::regprocedure,'private.pilot_can_access_customer(uuid)'::regprocedure,'auth.uid()'::regprocedure);
  -- Exact reviewed role body/search_path transition only; immutable stored
  -- contracts, all other helper metadata, policies and effective ACLs are retained.
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(expected.helpers) old
    JOIN pg_catalog.pg_proc live ON live.oid='public.current_user_role()'::regprocedure
    WHERE (old->>'oid')::oid=live.oid
     AND encode(sha256(convert_to(old->>'prosrc','UTF8')),'hex')='d5eeb57d95c6dc07b6360707becbdb69e3efae2fe82cf470805b823d3e75a334'
     AND old->'proconfig'='["search_path=\"\""]'::jsonb
     AND encode(sha256(convert_to(live.prosrc,'UTF8')),'hex')='c241c016a8faf13fe807cfaeab10695ea990040537770345c1c9c1a86d14e15a'
     AND live.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
     AND old-ARRAY['prosrc','proconfig']=to_jsonb(live)-ARRAY['prosrc','proconfig']) THEN
    RAISE EXCEPTION 'Catalogue employee role parity is unproved' USING ERRCODE='42501',DETAIL='CATALOG_POLICY_PARITY_UNPROVED';
  END IF;
  SELECT jsonb_agg(CASE WHEN (item->>'oid')::oid='public.current_user_role()'::regprocedure
    THEN (SELECT to_jsonb(p) FROM pg_catalog.pg_proc p WHERE p.oid='public.current_user_role()'::regprocedure)
    ELSE item END ORDER BY ordinal) INTO expected.helpers
    FROM jsonb_array_elements(expected.helpers) WITH ORDINALITY AS captured(item,ordinal);
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
END $function$;

CREATE OR REPLACE FUNCTION public.pilot_co_evidence_attest_v1(p_actor_id uuid, p_evidence_id uuid, p_object_id uuid, p_object_version text, p_byte_size bigint, p_mime_type text, p_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE generation smallint;
BEGIN
 IF NOT private.employee_account_allowed(p_actor_id) THEN RAISE EXCEPTION 'CO authority required' USING ERRCODE='42501'; END IF;
 SELECT execution_generation INTO generation FROM private.catalog_cutover_v1 WHERE singleton;
 IF generation=1 THEN RETURN private.catalog_attest_legacy_v1(p_actor_id,p_evidence_id,p_object_id,p_object_version,p_byte_size,p_mime_type,p_sha256); END IF;
 RETURN private.catalog_attest_core_v2(p_actor_id,p_evidence_id,p_object_id,p_object_version,p_byte_size,p_mime_type,p_sha256,true);
END $function$;
