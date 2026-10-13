-- Measured generic plans repeatedly scanned whole child tables for one estimated
-- parent. These nonunique FK access paths also support explicit scoped child reads.
-- Ordinary index builds block writes; hosted rollout needs separate approval.
DO $$
DECLARE target record; relation oid; key_attribute smallint;
BEGIN
 FOR target IN SELECT * FROM (VALUES
  ('po_line_items','purchase_order_id','pilot_po_line_items_purchase_order_id_idx'),
  ('sj_line_items','surat_jalan_id','pilot_sj_line_items_surat_jalan_id_idx')
 ) AS requested(table_name,column_name,index_name) LOOP
  relation:=pg_catalog.to_regclass('public.'||target.table_name);
  SELECT a.attnum INTO key_attribute FROM pg_catalog.pg_attribute a WHERE a.attrelid=relation AND a.attname=target.column_name AND NOT a.attisdropped AND a.atttypid='pg_catalog.uuid'::pg_catalog.regtype;
  IF key_attribute IS NULL THEN RAISE EXCEPTION 'Expected public.%.% uuid contract missing',target.table_name,target.column_name; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid JOIN pg_catalog.pg_am am ON am.oid=c.relam
   WHERE i.indrelid=relation AND i.indkey[0]=key_attribute AND i.indisvalid AND i.indisready AND i.indpred IS NULL AND i.indexprs IS NULL AND am.amname='btree') THEN CONTINUE; END IF;
  IF pg_catalog.to_regclass('public.'||target.index_name) IS NOT NULL THEN RAISE EXCEPTION 'Index name % exists without expected usable access path',target.index_name; END IF;
  EXECUTE pg_catalog.format('CREATE INDEX %I ON public.%I USING btree(%I)',target.index_name,target.table_name,target.column_name);
 END LOOP;
END $$;
