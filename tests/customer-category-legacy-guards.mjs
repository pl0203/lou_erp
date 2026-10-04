// Pure, offline SQL preparation for a separate fictional PostgreSQL 17 fixture.
// No I/O, connection, credentials or execution. Every regression transaction rolls back.
import { assertSupportedCustomerCategoryMigrationSource } from './customer-category-migration-guards.mjs'
import { FROZEN_CUSTOMER_CATEGORY_OLD_PREFLIGHT } from './fixtures/customer-category-legacy-old-preflight.mjs'

export const LEGACY_CATEGORY_MARKERS = Object.freeze([
  'CUSTOMER_CATEGORY_LEGACY_OLD_PREFLIGHT_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_EXISTING_ROWS_VERIFIED',
  'CUSTOMER_CATEGORY_LEGACY_OLD_CLIENT_VERIFIED',
  'CUSTOMER_CATEGORY_LEGACY_VALID_VALUES_VERIFIED',
  'CUSTOMER_CATEGORY_LEGACY_INVALID_VALUES_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_ORDER_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_TYPE_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_NULLABILITY_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_DEFAULT_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_IDENTITY_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_COLUMN_ACL_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_TABLE_ACL_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_PK_NAME_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_PK_COLUMNS_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_PK_MISSING_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_RLS_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_FORCE_RLS_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_OWNER_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_INHERITANCE_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_DROPPED_COLUMN_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_ROLLBACK_VERIFIED',
])

const guard = `SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL idle_in_transaction_session_timeout='60s';
SET LOCAL search_path='';
SET LOCAL row_security=off;
DO $legacy_disposable$
BEGIN
 IF current_database()<>'pilot_category_legacy_test'
 THEN RAISE EXCEPTION 'Dedicated disposable legacy fixture required'; END IF;
 IF current_user<>'postgres'
 THEN RAISE EXCEPTION 'Disposable legacy postgres owner required'; END IF;
 IF pg_catalog.to_regclass('public.pilot_fixture_marker') IS NULL
 THEN RAISE EXCEPTION 'Disposable legacy marker required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci')
 OR pg_catalog.to_regclass('public.category_legacy_fixture_baseline') IS NULL
 THEN RAISE EXCEPTION 'Disposable legacy marker and baseline required'; END IF;
END $legacy_disposable$;
LOCK TABLE public.customers IN ACCESS EXCLUSIVE MODE;`

const snapshotQueries = [
  ['rows', "SELECT c.id,to_jsonb(c) AS original_row FROM public.customers c", "SELECT c.id,to_jsonb(c)-'customer_category' AS original_row FROM public.customers c JOIN category_legacy_original_rows b ON b.id=c.id"],
  ['relation', "SELECT c.oid,c.relkind,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,c.relispartition FROM pg_catalog.pg_class c WHERE c.oid='public.customers'::regclass"],
  ['columns', "SELECT a.attnum,to_jsonb(a) AS metadata,pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_expression FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.customers'::regclass AND a.attnum>0", "SELECT a.attnum,to_jsonb(a),pg_catalog.pg_get_expr(d.adbin,d.adrelid) FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.customers'::regclass AND a.attnum>0 AND a.attname<>'customer_category'"],
  ['constraints', "SELECT k.oid,to_jsonb(k) AS metadata FROM pg_catalog.pg_constraint k WHERE k.conrelid='public.customers'::regclass", "SELECT k.oid,to_jsonb(k) FROM pg_catalog.pg_constraint k WHERE k.conrelid='public.customers'::regclass AND k.conname<>'customers_customer_category_check'"],
  ['policies', "SELECT p.oid,to_jsonb(p) AS metadata FROM pg_catalog.pg_policy p WHERE p.polrelid='public.customers'::regclass"],
]
const snapshots = snapshotQueries.map(([name,query]) => `CREATE TEMP TABLE category_legacy_original_${name} ON COMMIT DROP AS ${query};`).join('\n')
const originalDifference = snapshotQueries.map(([name,before,after=before]) => `EXISTS(
 (SELECT * FROM category_legacy_original_${name} EXCEPT ${after})
 UNION ALL
 (${after} EXCEPT SELECT * FROM category_legacy_original_${name})
)`).join('\n OR ')

// This is the seed's exact stable snapshot, excluding volatile physical counters.
const fixtureState = `SELECT jsonb_build_object(
 'rows',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.customers c),
 'relation',(SELECT jsonb_build_array(c.oid,c.relkind,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,c.relispartition) FROM pg_catalog.pg_class c WHERE c.oid='public.customers'::regclass),
 'columns',(SELECT jsonb_agg(jsonb_build_array(a.attnum,to_jsonb(a),pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
  FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.customers'::regclass AND a.attnum>0),
 'constraints',(SELECT jsonb_agg(to_jsonb(k) ORDER BY k.oid) FROM pg_catalog.pg_constraint k WHERE k.conrelid='public.customers'::regclass),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_policy p WHERE p.polrelid='public.customers'::regclass)
)`

// A deliberately wrong physical order is created only in its own rollback test.
// The original synthetic table and rows remain intact under a temporary name.
const wrongOrder = `ALTER TABLE public.customers RENAME TO category_legacy_original_customers;
ALTER TABLE public.category_legacy_original_customers RENAME CONSTRAINT suppliers_pkey TO category_legacy_original_pkey;
CREATE TABLE public.customers (
 id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
 name text NOT NULL,
 email text,
 phone text,
 created_at timestamptz NOT NULL DEFAULT now(),
 address text,
 visit_frequency_days integer NOT NULL DEFAULT 7,
 last_visit_date date,
 city text,
 pricing_tier public.pricing_tier NOT NULL DEFAULT 'luar_kota',
 CONSTRAINT suppliers_pkey PRIMARY KEY (id)
);
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
GRANT ALL PRIVILEGES ON TABLE public.customers TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.customers TO authenticated;`

const columnError = 'Unexpected customers column contract; migration refused'
const relationError = 'Unexpected customers relation contract; migration refused'
const driftCases = [
  [wrongOrder, columnError],
  ['ALTER TABLE public.customers ALTER COLUMN email TYPE varchar(80);', columnError],
  ['ALTER TABLE public.customers ALTER COLUMN name DROP NOT NULL;', columnError],
  ['ALTER TABLE public.customers ALTER COLUMN visit_frequency_days SET DEFAULT 8;', columnError],
  ['ALTER TABLE public.customers ALTER COLUMN visit_frequency_days DROP DEFAULT;\nALTER TABLE public.customers ALTER COLUMN visit_frequency_days ADD GENERATED ALWAYS AS IDENTITY;', columnError],
  ['GRANT SELECT (name) ON public.customers TO authenticated;', columnError],
  ['GRANT DELETE ON TABLE public.customers TO authenticated;', relationError],
  ['ALTER TABLE public.customers RENAME CONSTRAINT suppliers_pkey TO synthetic_unexpected_pkey;', columnError],
  ['ALTER TABLE public.customers DROP CONSTRAINT suppliers_pkey;\nALTER TABLE public.customers ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id,name);', columnError],
  ['ALTER TABLE public.customers DROP CONSTRAINT suppliers_pkey;', columnError],
  ['ALTER TABLE public.customers DISABLE ROW LEVEL SECURITY;', relationError],
  ['ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;', relationError],
  ['ALTER TABLE public.customers OWNER TO authenticated;', relationError],
  ['CREATE TABLE public.synthetic_category_legacy_child () INHERITS (public.customers);', relationError],
  ['ALTER TABLE public.customers ADD COLUMN synthetic_removed_field text;\nALTER TABLE public.customers DROP COLUMN synthetic_removed_field;', columnError],
]

export function buildCustomerCategoryLegacyGuards(source) {
  assertSupportedCustomerCategoryMigrationSource(source)
  const preflights = source.match(/DO \$preflight\$[\s\S]*?END \$preflight\$;/g)
  if (preflights?.length !== 1 || source.includes('$legacy_guard_source$')) throw new Error('Exact legacy category preflight boundary required')
  const preflight = preflights[0]
  const body = source.replace(/^BEGIN;\n/m, '').replace(/\nCOMMIT;\s*$/, '')
  const negative = driftCases.map(([mutation,expected],index) => `BEGIN;
${guard}
${mutation}
DO $legacy_negative$
BEGIN
 BEGIN
  EXECUTE $legacy_guard_source$${preflight}$legacy_guard_source$;
  RAISE EXCEPTION 'Legacy preflight accepted unexpected state';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'${expected}' THEN RAISE; END IF;
 END;
 RAISE NOTICE '${LEGACY_CATEGORY_MARKERS[index + 5]}';
END $legacy_negative$;
ROLLBACK;`).join('\n\n')
  return `-- Exact candidate migration and frozen prior preflight, fictional legacy-only.
-- The guarded seed is retained; every test mutation is rolled back.
BEGIN;
${guard}
DO $legacy_old_preflight$
BEGIN
 BEGIN
  EXECUTE $legacy_guard_source$${FROZEN_CUSTOMER_CATEGORY_OLD_PREFLIGHT}$legacy_guard_source$;
  RAISE EXCEPTION 'Frozen old preflight accepted actual legacy layout';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'${columnError}' THEN RAISE; END IF;
 END;
 RAISE NOTICE '${LEGACY_CATEGORY_MARKERS[0]}';
END $legacy_old_preflight$;
INSERT INTO public.customers(id,name,phone,email,created_at,address,visit_frequency_days,last_visit_date,city,pricing_tier)
 VALUES('96000000-0000-0000-0002-000000000001','Synthetic legacy category baseline','000-002','legacy-baseline@example.invalid','2026-08-03T00:00:00Z','Fictional baseline road',21,'2026-08-21','Synthetic baseline city','depo_bangunan');
${snapshots}
${body}
DO $legacy_existing$
BEGIN
 IF EXISTS(SELECT 1 FROM public.customers WHERE customer_category IS NOT NULL)
 OR ${originalDifference}
 THEN RAISE EXCEPTION 'Additive legacy migration changed original rows or metadata'; END IF;
 RAISE NOTICE '${LEGACY_CATEGORY_MARKERS[1]}';
END $legacy_existing$;

DO $legacy_old_client$
DECLARE inserted public.customers%ROWTYPE;
BEGIN
 INSERT INTO public.customers(name) VALUES('Synthetic legacy old-client omission') RETURNING * INTO inserted;
 IF inserted.id IS NULL OR inserted.created_at IS DISTINCT FROM now()
 OR inserted.visit_frequency_days<>7 OR inserted.pricing_tier<>'luar_kota'::public.pricing_tier
 OR inserted.customer_category IS NOT NULL
 OR inserted.phone IS NOT NULL OR inserted.email IS NOT NULL OR inserted.address IS NOT NULL
 OR inserted.city IS NOT NULL OR inserted.last_visit_date IS NOT NULL
 THEN RAISE EXCEPTION 'Old-client omission changed defaults or category'; END IF;
 RAISE NOTICE '${LEGACY_CATEGORY_MARKERS[2]}';
END $legacy_old_client$;

DO $legacy_values$
DECLARE category text; inserted public.customers%ROWTYPE;
BEGIN
 FOREACH category IN ARRAY ARRAY['supermarket_besar','supermarket_sedang','supermarket_kecil','tradisional_market','perorangan'] LOOP
  INSERT INTO public.customers(name,customer_category,pricing_tier)
   VALUES('Synthetic legacy valid '||category,category,'others') RETURNING * INTO inserted;
  IF inserted.customer_category IS DISTINCT FROM category OR inserted.pricing_tier<>'others'::public.pricing_tier
  THEN RAISE EXCEPTION 'Legacy category value was not preserved'; END IF;
 END LOOP;
 UPDATE public.customers SET customer_category='perorangan' WHERE id='96000000-0000-0000-0001-000000000001';
 IF (SELECT customer_category FROM public.customers WHERE id='96000000-0000-0000-0001-000000000001') IS DISTINCT FROM 'perorangan'
 OR ${originalDifference}
 THEN RAISE EXCEPTION 'Legacy category edit changed original source fields or metadata'; END IF;
 RAISE NOTICE '${LEGACY_CATEGORY_MARKERS[3]}';
END $legacy_values$;

DO $legacy_invalid$
DECLARE category text; rejected_constraint text; original_count bigint;
BEGIN
 SELECT count(*) INTO original_count FROM public.customers;
 FOREACH category IN ARRAY ARRAY['','SUPERMARKET_BESAR','supermarket_besar ',' supermarket_besar','unknown'] LOOP
  BEGIN
   INSERT INTO public.customers(name,customer_category) VALUES('Synthetic legacy invalid',category);
   RAISE EXCEPTION 'Legacy invalid category was accepted';
  EXCEPTION WHEN check_violation THEN
   GET STACKED DIAGNOSTICS rejected_constraint=CONSTRAINT_NAME;
   IF rejected_constraint<>'customers_customer_category_check' THEN RAISE; END IF;
  END;
 END LOOP;
 IF (SELECT count(*) FROM public.customers)<>original_count
 THEN RAISE EXCEPTION 'Rejected legacy category insert changed row count'; END IF;
 RAISE NOTICE '${LEGACY_CATEGORY_MARKERS[4]}';
END $legacy_invalid$;
ROLLBACK;

${negative}

BEGIN;
${guard}
DO $legacy_rollback$
DECLARE actual jsonb;
BEGIN
 ${fixtureState} INTO actual;
 IF actual IS DISTINCT FROM (SELECT state FROM public.category_legacy_fixture_baseline WHERE singleton)
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.customers'::regclass AND attname='customer_category')
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid='public.customers'::regclass OR inhparent='public.customers'::regclass)
 OR pg_catalog.to_regclass('public.category_legacy_original_customers') IS NOT NULL
 OR pg_catalog.to_regclass('public.synthetic_category_legacy_child') IS NOT NULL
 THEN RAISE EXCEPTION 'Legacy fixture changed after rollback'; END IF;
 RAISE NOTICE '${LEGACY_CATEGORY_MARKERS[20]}';
END $legacy_rollback$;
ROLLBACK;
`
}
