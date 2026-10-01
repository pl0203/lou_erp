-- Evidence: disposable6k linked-order equality lookup scanned6007rows; the same
-- predicate repeats through existing PO/header/line authorization helpers.
-- Add only a nonunique access path. No policy/helper/business rule is changed.
-- Ordinary CREATE INDEX takes a write-blocking table lock while building. A live
-- rollout needs an approved maintenance window or separately reviewed concurrent DDL.
DO $$
DECLARE po_attribute smallint;
BEGIN
 SELECT a.attnum INTO po_attribute FROM pg_catalog.pg_attribute a
 WHERE a.attrelid=pg_catalog.to_regclass('public.girard_orders') AND a.attname='po_id'
 AND NOT a.attisdropped AND a.atttypid='pg_catalog.uuid'::pg_catalog.regtype;
 IF po_attribute IS NULL THEN RAISE EXCEPTION 'Expected public.girard_orders.po_id uuid contract missing'; END IF;
 -- An existing valid nonpartial btree with po_id as its first key serves the same
 -- equality lookup, including a wider or differently named index.
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid JOIN pg_catalog.pg_am am ON am.oid=c.relam
  WHERE i.indrelid='public.girard_orders'::pg_catalog.regclass AND i.indkey[0]=po_attribute
  AND i.indisvalid AND i.indisready AND i.indpred IS NULL AND i.indexprs IS NULL AND am.amname='btree') THEN
  RETURN;
 END IF;
 IF pg_catalog.to_regclass('public.pilot_girard_orders_po_id_idx') IS NOT NULL THEN
  RAISE EXCEPTION 'Index name exists without the expected usable po_id access path';
 END IF;
 CREATE INDEX pilot_girard_orders_po_id_idx ON public.girard_orders USING btree(po_id);
END $$;
