BEGIN READ ONLY;
SET LOCAL search_path = '';
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';
SET LOCAL idle_in_transaction_session_timeout = '15s';

-- Setup failures are separate from the missing foundation contract.
DO $fixture$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN ('customers', 'products', 'users')
        AND c.relkind = 'r' AND c.relrowsecurity) <> 3
     OR pg_catalog.to_regprocedure('auth.uid()') IS NULL
     OR pg_catalog.to_regprocedure('public.pilot_procurement_access_v1()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_enum e
                    WHERE e.enumtypid = pg_catalog.to_regtype('public.user_role') AND e.enumlabel = 'co_admin')
     OR (SELECT count(*) FROM pg_catalog.pg_policy p
         JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND NOT p.polpermissive AND
          ((c.relname = 'customers' AND p.polname IN ('co_customer_no_insert_v1', 'co_customer_no_update_v1', 'co_customer_no_delete_v1'))
           OR (c.relname = 'products' AND p.polname IN ('co_product_no_insert_v1', 'co_product_no_update_v1', 'co_product_no_delete_v1')))) <> 6
  THEN
    RAISE EXCEPTION 'CATALOGUE_FOUNDATION_FIXTURE_INVALID' USING ERRCODE = 'PFC02';
  END IF;
END $fixture$;
\echo CATALOGUE_FOUNDATION_FIXTURE_READY

-- First real foundation assertion. Later role, lifecycle and race suites are unrun.
DO $contract$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN ('customers', 'products')
        AND a.attnum > 0 AND NOT a.attisdropped AND a.attnotnull
        AND ((a.attname = 'is_enabled' AND a.atttypid = 'boolean'::pg_catalog.regtype)
          OR (a.attname = 'catalog_version' AND a.atttypid = 'bigint'::pg_catalog.regtype))) <> 4
  THEN
    RAISE EXCEPTION 'CATALOGUE_FOUNDATION_MISSING_SERVER_COLUMNS' USING ERRCODE = 'PFC01';
  END IF;
END $contract$;
\echo CATALOGUE_FOUNDATION_CONTRACT_PASSED
ROLLBACK;
