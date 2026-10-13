-- Disposable catalog assertions; normal role/RLS business suites remain mandatory separately.
BEGIN;
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF current_database()<>'pilot_test' OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') THEN RAISE EXCEPTION 'Disposable pilot_test marker required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid JOIN pg_catalog.pg_am am ON am.oid=c.relam JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attname='po_id'
 WHERE i.indrelid='public.girard_orders'::regclass AND i.indkey[0]=a.attnum AND i.indisvalid AND i.indisready AND i.indpred IS NULL AND i.indexprs IS NULL AND am.amname='btree') THEN RAISE EXCEPTION 'Required usable leading po_id index missing'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid=to_regclass('public.pilot_girard_orders_po_id_idx') AND indisunique) THEN RAISE EXCEPTION 'Candidate must not introduce a uniqueness rule'; END IF;
END $$;
SELECT set_config('pilot.index_count',(SELECT count(*)::text FROM pg_catalog.pg_index WHERE indrelid='public.girard_orders'::regclass),true);
-- A second application must recognize the compatible index rather than add a duplicate.
\ir ../../supabase/migrations/202610010004_scalable_order_lookup_index.sql
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_catalog.pg_index WHERE indrelid='public.girard_orders'::regclass)<>current_setting('pilot.index_count')::integer THEN RAISE EXCEPTION 'Repeated migration added a duplicate index'; END IF;
END $$;
-- Fresh CI fixture has no equivalent baseline index: test recognition by shape,
-- not just by the candidate's name. All DDL is rolled back with this test.
ALTER INDEX public.pilot_girard_orders_po_id_idx RENAME TO synthetic_equivalent_po_lookup;
\ir ../../supabase/migrations/202610010004_scalable_order_lookup_index.sql
DO $$ BEGIN
 IF to_regclass('public.pilot_girard_orders_po_id_idx') IS NOT NULL OR (SELECT count(*) FROM pg_catalog.pg_index WHERE indrelid='public.girard_orders'::regclass)<>current_setting('pilot.index_count')::integer THEN RAISE EXCEPTION 'Equivalent differently named index was duplicated'; END IF;
END $$;
SELECT 'SCALABLE_ORDER_LOOKUP_INDEX_VERIFIED' AS result;
ROLLBACK;
