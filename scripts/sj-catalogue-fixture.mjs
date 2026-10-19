// Finite source-only catalogue fixture assembly on the identity-bound CO database.
// No connections, hosted calls, baseline reset, export imports, or deployment.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
const sha256 = text => createHash('sha256').update(text).digest('hex')
export const sjCatalogueSourceFiles = Object.freeze([
  [
    "01-foundation.sql",
    "181e47d842a24d7043ffc39ae756e8582f5b8b7bbcb8b7e7992c1d19f22132a5"
  ],
  [
    "02-customer-target-tracking.sql",
    "e4567a9cd023aba3c1bdb4b84925c6a6bad1e931bf5a199ba41c2bf5e34924ca"
  ],
  [
    "02-po-reference-extraction.sql",
    "934108fd704a12edb73e8ff35ee288fa8ec90228d80a8151ef6f755e91b6a660"
  ],
  [
    "02-promotion-owner-extraction.sql",
    "d53ad17d77fbafbf8542c29fbcd04a3b3457916d296d0f2bf28df78a1389affc"
  ],
  [
    "02-co-reference-extraction.sql",
    "4dd6695b14a3587e43bd76df04abfa99916bf49b33344e99660a57ab5ebc12f9"
  ],
  [
    "02-co-draft-reference-extraction.sql",
    "ebdc135249aacc7c297fb88ec12640a0c5a7da3cd5cfa76c9f2adfd8050d8aa5"
  ],
  [
    "02-retired-co-line-resolution.sql",
    "361e4089150bc338268926e5c48db2e76afedff024f4b684118d022990238591"
  ],
  [
    "new02-visit-reference-extraction.sql",
    "5d64d14d3ebc2d7c075d8aba2d49fafece9f970235a54620393577ff2bfec71e"
  ],
  [
    "new02-nonco-lineage-resolution.sql",
    "9417cef406eaa4ea511bb50f77f3e16dba710cdebbf09d7c7c62d438c8864a4f"
  ],
  [
    "04-order-boundaries.sql",
    "db6d2fc9383d73a631622261d5fd2206b32303dbe7a9966a490be915e454d601"
  ],
  [
    "05-reads.sql",
    "552a5366af1f6cb304a8ace737e9ecf0703c4d0653ebd9eb609fb00a9b613ddd"
  ],
  [
    "new06-co-order-boundaries.sql",
    "f3621edc77272194db16f98dc1f3174db75d28fe712afd0b024672c5270d801f"
  ],
  [
    "new07-lifetime-admission.sql",
    "12120f0238263572eefa23d1bf3bbc5cc90de506546f6f76ba43888ed3eef087"
  ],
  [
    "new08-catalogue-create-edit.sql",
    "1c583c2acb7a1660262fe4e080b75bed7c81d701d4cfe24cdd68e6ea7d40eb00"
  ],
  [
    "new09-checked-boundaries.sql",
    "a1e820cccc360a5e7e61855265fa8068aac4abba68b62e57d06b281ef169e5cc"
  ],
  [
    "new10-guarded-delete.sql",
    "c3d526aef86b81894f2d73b4ae7c13f15f22618827f280a50b08844fb303e217"
  ],
  [
    "new11-master-completion-hooks.sql",
    "2a642a0adcb935755d2d6b127ba50c517328a85f3b225de4658a751f48834e71"
  ]
])
// Only the two finite native policy/auth adaptations from the reviewed installer.
// The original source candidates remain byte-for-byte unchanged.
const adaptations = {
  "new08-catalogue-create-edit.sql": {
    "sha256": "9623a415d9f7d970a305eefb5c4093ef95b3f7a18f88b134a094e169428809ce",
    "replacements": [
      [
        "-- Additive Task 3 create/edit vertical. Apply in the existing rollback-only harness.\n-- This proves the explicitly reviewed synthetic/public policy composition only.\n-- Composed new10/new11 supply certified birth and guarded-delete hooks. This\n-- file does not assert hosted parity, activate cutover, change master ACLs, relax\n-- policy scope, or mark catalogue-only edits as business use.\n-- SECURITY DEFINER does NOT inherit caller RLS. Effective column ACLs and the\n-- current old/proposed-row predicates are checked explicitly below. Unknown\n",
        "-- Review-only staging adaptation of the pinned create/edit source. Not applied\n-- or executable-approved; requires the separately reviewed atomic installer.\n-- The finite references below pin only the supplied reviewed hosted contracts.\n-- Composed new10/new11 supply certified birth and guarded-delete hooks. This\n-- file does not certify installation, activate cutover, change master ACLs, relax\n-- policy scope, or mark catalogue-only edits as business use.\n-- SECURITY DEFINER does NOT inherit caller RLS. Effective column ACLs and the\n-- current old/proposed-row predicates are checked explicitly below. Unknown\n"
      ],
      [
        "-- happens to be installed. pg_get_expr canonicalizes both at the same search_path.\nCREATE TEMP TABLE catalog_customer_policy_reference_v1(id uuid) ON COMMIT DROP;\nCREATE TEMP TABLE catalog_product_policy_reference_v1(id uuid) ON COMMIT DROP;\nCREATE POLICY fixture_read ON pg_temp.catalog_customer_policy_reference_v1 FOR SELECT TO authenticated USING (true);\nCREATE POLICY fixture_write ON pg_temp.catalog_customer_policy_reference_v1 FOR ALL TO authenticated USING (true) WITH CHECK (true);\nCREATE POLICY pilot_active_profile ON pg_temp.catalog_customer_policy_reference_v1 AS RESTRICTIVE FOR ALL TO authenticated\n  USING (public.current_user_role() IS NOT NULL) WITH CHECK (public.current_user_role() IS NOT NULL);\nCREATE POLICY catalog_co_customer_insert_v1 ON pg_temp.catalog_customer_policy_reference_v1 FOR INSERT TO authenticated\n",
        "-- happens to be installed. pg_get_expr canonicalizes both at the same search_path.\nCREATE TEMP TABLE catalog_customer_policy_reference_v1(id uuid) ON COMMIT DROP;\nCREATE TEMP TABLE catalog_product_policy_reference_v1(id uuid) ON COMMIT DROP;\nCREATE POLICY customers_read ON pg_temp.catalog_customer_policy_reference_v1 FOR SELECT TO public USING (auth.uid() IS NOT NULL);\nCREATE POLICY customers_write ON pg_temp.catalog_customer_policy_reference_v1 FOR ALL TO public\n  USING (public.current_user_role() = ANY (ARRAY['po_admin'::public.user_role, 'executive'::public.user_role]))\n  WITH CHECK (public.current_user_role() = ANY (ARRAY['po_admin'::public.user_role, 'executive'::public.user_role]));\nCREATE POLICY pilot_active_profile ON pg_temp.catalog_customer_policy_reference_v1 AS RESTRICTIVE FOR ALL TO authenticated\n  USING (public.current_user_role() IS NOT NULL) WITH CHECK (public.current_user_role() IS NOT NULL);\nCREATE POLICY catalog_co_customer_insert_v1 ON pg_temp.catalog_customer_policy_reference_v1 FOR INSERT TO authenticated\n"
      ],
      [
        "  USING (public.current_user_role()='co_admin');\nCREATE POLICY store_owner_customer_read_v1 ON pg_temp.catalog_customer_policy_reference_v1 FOR SELECT TO authenticated\n  USING (private.pilot_can_access_customer(id));\nCREATE POLICY fixture_read ON pg_temp.catalog_product_policy_reference_v1 FOR SELECT TO authenticated USING (true);\nCREATE POLICY fixture_write ON pg_temp.catalog_product_policy_reference_v1 FOR ALL TO authenticated USING (true) WITH CHECK (true);\nCREATE POLICY pilot_active_profile ON pg_temp.catalog_product_policy_reference_v1 AS RESTRICTIVE FOR ALL TO authenticated\n  USING (public.current_user_role() IS NOT NULL) WITH CHECK (public.current_user_role() IS NOT NULL);\nCREATE POLICY catalog_co_product_insert_v1 ON pg_temp.catalog_product_policy_reference_v1 FOR INSERT TO authenticated\n",
        "  USING (public.current_user_role()='co_admin');\nCREATE POLICY store_owner_customer_read_v1 ON pg_temp.catalog_customer_policy_reference_v1 FOR SELECT TO authenticated\n  USING (private.pilot_can_access_customer(id));\nCREATE POLICY products_read ON pg_temp.catalog_product_policy_reference_v1 FOR SELECT TO public USING (auth.uid() IS NOT NULL);\n-- Intentionally omit WITH CHECK: the reviewed stored polwithcheck is NULL.\n-- PostgreSQL uses this ALL policy's USING for proposed rows, not unconditional true.\nCREATE POLICY products_write ON pg_temp.catalog_product_policy_reference_v1 FOR ALL TO public\n  USING (public.current_user_role() = ANY (ARRAY['po_admin'::public.user_role, 'executive'::public.user_role]));\nCREATE POLICY pilot_active_profile ON pg_temp.catalog_product_policy_reference_v1 AS RESTRICTIVE FOR ALL TO authenticated\n  USING (public.current_user_role() IS NOT NULL) WITH CHECK (public.current_user_role() IS NOT NULL);\nCREATE POLICY catalog_co_product_insert_v1 ON pg_temp.catalog_product_policy_reference_v1 FOR INSERT TO authenticated\n"
      ],
      [
        "        OR NOT p.prosecdef OR p.provolatile<>'s' OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u'\n        OR p.prokind<>'f' OR p.proretset OR p.proconfig IS DISTINCT FROM ARRAY['search_path=\"\"']))\n    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='auth.uid()'::regprocedure\n      AND p.proowner='postgres'::regrole::oid AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='sql')\n      AND NOT p.prosecdef AND p.provolatile='s' AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u'\n      AND p.prokind='f' AND NOT p.proretset AND p.proconfig IS NULL\n      AND regexp_replace(p.prosrc,'[[:space:]]','','g')=regexp_replace(\n        $identity$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $identity$,'[[:space:]]','','g')) THEN\n    RAISE EXCEPTION 'Unreviewed catalogue helper metadata' USING ERRCODE='42501', DETAIL='CATALOG_POLICY_PARITY_UNPROVED';\n  END IF;\n  IF (SELECT regexp_replace(prosrc,'[[:space:]]','','g') FROM pg_catalog.pg_proc WHERE oid='public.current_user_role()'::regprocedure)\n",
        "        OR NOT p.prosecdef OR p.provolatile<>'s' OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u'\n        OR p.prokind<>'f' OR p.proretset OR p.proconfig IS DISTINCT FROM ARRAY['search_path=\"\"']))\n    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='auth.uid()'::regprocedure\n      AND p.proowner='supabase_auth_admin'::regrole::oid AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='sql')\n      AND NOT p.prosecdef AND p.provolatile='s' AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u'\n      AND p.prokind='f' AND NOT p.proretset AND p.proconfig IS NULL\n      AND regexp_replace(p.prosrc,'[[:space:]]','','g')=regexp_replace(\n        $identity$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $identity$,'[[:space:]]','','g')) THEN\n    RAISE EXCEPTION 'Unreviewed catalogue helper metadata' USING ERRCODE='42501', DETAIL='CATALOG_POLICY_PARITY_UNPROVED';\n  END IF;\n  IF (SELECT regexp_replace(prosrc,'[[:space:]]','','g') FROM pg_catalog.pg_proc WHERE oid='public.current_user_role()'::regprocedure)\n"
      ],
      [
        "LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$\nDECLARE role public.user_role := public.current_user_role();\nBEGIN\n  -- With the exact current signature above, permissive fixture_write is true;\n  -- restrictive ALL USING/WITH CHECK require an active profile. Customer SELECT\n  -- adds this exact visibility predicate. CO form policies add no narrower scope.\n  -- Call for BOTH locked old and proposed edit rows, and proposed create rows.\n  -- This is an explicit proof for these predicates, not caller-RLS inheritance.\n  IF role IS NULL OR role NOT IN ('co_admin','po_admin','executive') OR auth.uid() IS NULL\n",
        "LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$\nDECLARE role public.user_role := public.current_user_role();\nBEGIN\n  -- Under the exact finite signature above, baseline ALL write permits po_admin\n  -- and executive; the preserved CO INSERT/UPDATE alternatives permit co_admin.\n  -- Product ALL with NULL stored CHECK reuses USING for the proposed row.\n  -- Restrictive ALL requires an active profile; customer SELECT also requires\n  -- the visibility predicate below. Non-null identity satisfies baseline read.\n  -- These alternatives cover exactly the admitted authenticated RPC roles.\n  -- Call for BOTH locked old and proposed edit rows, and proposed create rows.\n  -- This is an explicit proof for these predicates, not caller-RLS inheritance.\n  IF role IS NULL OR role NOT IN ('co_admin','po_admin','executive') OR auth.uid() IS NULL\n"
      ]
    ]
  },
  "new09-checked-boundaries.sql": {
    "sha256": "a7596a1752b77d2715331606ce423cfddafebb730f95af0bc1db809fec9d06ec",
    "replacements": [
      [
        "-- Inactive assembled generation-two boundary. Source-only, never a cutover.\n-- Existing generation-one interfaces, table grants and RLS remain unchanged.\n-- Requires 01, 02 target tracking, 04, new06, new07 and new08 in that order.\n-- The coordinator alone composes catalog_master_after_v1 with the defer hook.\n",
        "-- Review-only staging adaptation. Not applied or executable-approved; no cutover.\n-- Generation-two writes remain gated; the target capability is also used in v1.\n-- Existing generation-one interfaces, table grants and RLS remain unchanged.\n-- Requires 01, 02 target tracking, 04, new06, new07 and new08 in that order.\n-- The coordinator alone composes catalog_master_after_v1 with the defer hook.\n"
      ],
      [
        "CREATE CONSTRAINT TRIGGER catalog_target_no_pending_v1 AFTER INSERT OR UPDATE ON private.catalog_target_requests_v1\n DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.catalog_target_no_pending_v1();\n\n-- Build expected trees from the finite reviewed synthetic source, never from\n-- whatever policies happen to be present on the real target table.\nCREATE TEMP TABLE catalog_target_policy_reference_v1(customer_id uuid,set_by uuid) ON COMMIT DROP;\nCREATE POLICY fixture_read ON pg_temp.catalog_target_policy_reference_v1 FOR SELECT TO authenticated USING(true);\nCREATE POLICY customer_targets_write ON pg_temp.catalog_target_policy_reference_v1 FOR ALL TO authenticated\n USING(public.current_user_role() IN('sales_head','executive'))\n WITH CHECK(public.current_user_role() IN('sales_head','executive') AND set_by=auth.uid());\nCREATE POLICY pilot_active_profile ON pg_temp.catalog_target_policy_reference_v1 AS RESTRICTIVE FOR ALL TO authenticated\n",
        "CREATE CONSTRAINT TRIGGER catalog_target_no_pending_v1 AFTER INSERT OR UPDATE ON private.catalog_target_requests_v1\n DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.catalog_target_no_pending_v1();\n\n-- Build expected trees from the finite reviewed hosted contract, never from\n-- whatever policies happen to be present on the real target table.\nCREATE TEMP TABLE catalog_target_policy_reference_v1(customer_id uuid,set_by uuid) ON COMMIT DROP;\nCREATE POLICY customer_targets_read ON pg_temp.catalog_target_policy_reference_v1 FOR SELECT TO public USING(auth.uid() IS NOT NULL);\nCREATE POLICY customer_targets_write ON pg_temp.catalog_target_policy_reference_v1 FOR ALL TO public\n USING(public.current_user_role() IN('sales_head','executive'))\n WITH CHECK(public.current_user_role() IN('sales_head','executive') AND set_by=auth.uid());\nCREATE POLICY pilot_active_profile ON pg_temp.catalog_target_policy_reference_v1 AS RESTRICTIVE FOR ALL TO authenticated\n"
      ]
    ]
  }
}
export const sjCatalogueFunctionPins = Object.freeze([
  [
    "public.pilot_order_transaction(uuid,text,jsonb)",
    "d46364fb5b2cf057e98e3f5c03a1a0e5",
    true,
    "v",
    "jsonb",
    "{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}"
  ],
  [
    "public.pilot_reconcile_request(uuid,boolean)",
    "36cd1c50d51128e611cbdd6807412aff",
    true,
    "v",
    "jsonb",
    "{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}"
  ],
  [
    "private.catalog_po_legacy_transaction_v1(uuid,text,jsonb)",
    "0b1e19441a499ae9c864b2d21aef28ba",
    true,
    "v",
    "jsonb",
    "{postgres=X/postgres}"
  ],
  [
    "private.catalog_po_transaction_core_v2(uuid,text,jsonb)",
    "48e381a23cd97852c4a01cfff6318bf9",
    true,
    "v",
    "jsonb",
    "{postgres=X/postgres}"
  ],
  [
    "private.demo_order_execution_fence()",
    "f43b664954adf3b68aff927a2f5c69d2",
    true,
    "v",
    "trigger",
    "{postgres=X/postgres}"
  ],
  [
    "private.catalog_po_assert_event_v2()",
    "45a2241d0821bdb3b5f0b84ca608111f",
    true,
    "v",
    "trigger",
    "{postgres=X/postgres}"
  ],
  [
    "private.catalog_por_extract_event_v1(regclass,text,jsonb,jsonb,jsonb)",
    "9678f1d6ebad54ab62755b3add49d347",
    false,
    "i",
    "jsonb",
    "{postgres=X/postgres}"
  ],
  [
    "private.catalog_history_extract_v1(text,jsonb)",
    "08b8ecb5f792d9bed6346b1f8487cadb",
    false,
    "s",
    "jsonb",
    "{postgres=X/postgres}"
  ],
  [
    "private.catalog_history_producers_v1()",
    "a4173a60d03b4a0efb9e9ea86af48449",
    true,
    "s",
    "void",
    "{postgres=X/postgres}"
  ],
  [
    "private.catalog_assert_checked_graph_v2()",
    "6155cb4ca3e236dfcd9eba04e75ce982",
    true,
    "v",
    "void",
    "{postgres=X/postgres}"
  ]
])
const fixturePath = 'tests/database/sj-catalogue-fixture.sql'
const nativeBoundary = '-- SJ_NATIVE_AUDIT_FIXTURE\n'
const literal = value => "'" + value.replaceAll("'", "''") + "'"
export function buildSjCatalogueFixture({ read }) {
 const fixture = read(fixturePath).split(nativeBoundary)
 assert.equal(fixture.length, 2, 'Exact native-audit fixture boundary required')
 const parts = [fixture[0]]
 for (const [name, expected] of sjCatalogueSourceFiles) {
  let sql = read(`supabase/catalogue/v1/${name}`)
  assert.equal(sha256(sql), expected, `Catalogue candidate changed: ${name}`)
  if (adaptations[name]) {
   for (const [from, to] of adaptations[name].replacements) {
    assert.equal(sql.split(from).length, 2, `Finite adaptation drift: ${name}`)
    sql = sql.replace(from, () => to)
   }
   assert.equal(sha256(sql), adaptations[name].sha256, `Native adaptation drift: ${name}`)
  }
  parts.push(`-- SOURCE FIXTURE: ${name}\n${sql}`)
 }
 // Reproduce the two observed native RPC ACLs absent from the synthetic default grants.
 parts.push(`REVOKE EXECUTE ON FUNCTION public.pilot_order_transaction(uuid,text,jsonb),public.pilot_reconcile_request(uuid,boolean) FROM authenticated;\nGRANT EXECUTE ON FUNCTION public.pilot_order_transaction(uuid,text,jsonb),public.pilot_reconcile_request(uuid,boolean) TO service_role,authenticated;`)
 return `BEGIN;\nSET LOCAL check_function_bodies=on;\n${parts.join('\n')}\n${sjCatalogueFixtureParitySql()}\nSELECT private.catalog_assert_checked_graph_v2();\nSELECT private.catalog_history_producers_v1();\nSELECT 'SJ_CATALOGUE_COHERENT_SYNTHETIC_GRAPH_PASSED';\nCOMMIT;\n`
}
export function sjCatalogueFixtureParitySql() {
 const pins = sjCatalogueFunctionPins.map(([signature, md5, definer, volatility, returns, acl]) =>
  `(${literal(signature)},${literal(md5)},${definer},${literal(volatility)},${literal(returns)},${literal(acl)})`).join(',\n')
 return `DO $parity$ DECLARE pin record; p record; BEGIN
 FOR pin IN SELECT * FROM (VALUES ${pins}) AS v(signature,body_md5,security_definer,volatility,returns,acl) LOOP
  SELECT pro.*,l.lanname INTO p FROM pg_proc pro JOIN pg_language l ON l.oid=pro.prolang WHERE pro.oid=to_regprocedure(pin.signature);
  IF p.oid IS NULL OR md5(p.prosrc)<>pin.body_md5 OR p.proowner<>'postgres'::regrole
   OR p.prosecdef<>pin.security_definer OR p.provolatile::text<>pin.volatility
   OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.proretset OR p.prokind<>'f'
   OR p.lanname<>'plpgsql' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
   OR pg_get_function_result(p.oid)<>pin.returns OR p.proacl::text IS DISTINCT FROM pin.acl
  THEN RAISE EXCEPTION 'Installed catalogue function parity failed: %',pin.signature; END IF;
 END LOOP;
 IF (SELECT count(*)=1 AND bool_and(singleton AND execution_generation=1 AND NOT tracking_ready) FROM private.catalog_cutover_v1) IS DISTINCT FROM true
 OR (SELECT count(*) FROM pg_constraint WHERE conrelid='private.catalog_cutover_v1'::regclass AND convalidated AND conname IN ('catalog_foundation_generation_one','catalog_foundation_not_ready'))<>2
 THEN RAISE EXCEPTION 'Inactive catalogue generation contract changed'; END IF;
 PERFORM private.catalog_assert_write_policy_v1('customer');
 PERFORM private.catalog_assert_write_policy_v1('product');
 END $parity$;
 SELECT 'SJ_CATALOGUE_INSTALLED_FUNCTION_PARITY_PASSED';`
}
export function runSjCatalogueFixture({ run, read }) {
 return run(buildSjCatalogueFixture({ read }))
}
// Apply only after coherent-synthetic generation-two proofs. Native audit tests
// must preserve the inherited fail-closed graph/history mismatch, not repin it.
export function sjNativeAuditFixtureSql({ read }) {
 const parts = read(fixturePath).split(nativeBoundary)
 assert.equal(parts.length, 2)
 return parts[1]
}
