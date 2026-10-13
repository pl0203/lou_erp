-- Approved cardinality: many stores per salesperson, one salesperson per store.
-- Forward-only metadata change. No mappings, PO credit, grants or RLS are rewritten.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL idle_in_transaction_session_timeout='60s';
SET LOCAL search_path='';
SET LOCAL row_security=off;
LOCK TABLE public.customer_sales_rep_assignments IN ACCESS EXCLUSIVE MODE;

DO $preflight$
DECLARE
 relation oid := 'public.customer_sales_rep_assignments'::regclass;
 salesperson_key oid; salesperson_index oid; customer_column smallint; sales_column smallint; id_column smallint;
 key record; expected_columns text[]; expected_indexes text[];
BEGIN
 IF current_user<>'postgres'
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=relation AND c.relkind='r'
  AND c.relowner=current_user::regrole AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition)
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid=relation OR inhparent=relation)
 THEN RAISE EXCEPTION 'Unexpected assignment relation; migration refused'; END IF;
 SELECT attnum INTO id_column FROM pg_catalog.pg_attribute WHERE attrelid=relation AND attname='id' AND NOT attisdropped;
 SELECT attnum INTO customer_column FROM pg_catalog.pg_attribute WHERE attrelid=relation AND attname='customer_id' AND NOT attisdropped;
 SELECT attnum INTO sales_column FROM pg_catalog.pg_attribute WHERE attrelid=relation AND attname='sales_rep_id' AND NOT attisdropped;
 SELECT array_agg(attname::text ORDER BY attnum) INTO expected_columns FROM pg_catalog.pg_attribute WHERE attrelid=relation AND attnum>0;
 IF expected_columns IS DISTINCT FROM ARRAY['id','customer_id','sales_rep_id','assigned_by']::text[]
 AND expected_columns IS DISTINCT FROM ARRAY['id','customer_id','sales_rep_id','assigned_by','assigned_at']::text[]
 THEN RAISE EXCEPTION 'Unexpected assignment columns; migration refused'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=relation AND a.attnum>0
  AND (a.attisdropped OR a.attidentity<>'' OR a.attgenerated<>''
   OR (a.attname<>'assigned_at' AND a.atttypid<>'uuid'::regtype)
   OR (a.attname='assigned_at' AND a.atttypid<>'timestamptz'::regtype)
   OR a.attnotnull IS DISTINCT FROM (a.attname IN ('id','customer_id','sales_rep_id'))))
 THEN RAISE EXCEPTION 'Unexpected assignment column contract; migration refused'; END IF;

 -- The required PK/customer key and all three existing FKs are verified first.
 -- NO ACTION is the known synthetic fixture; CASCADE is the verified hosted FK
 -- shape for customer/salesperson. Both are retained verbatim, never recreated.
 FOR key IN SELECT * FROM (VALUES
  ('customer_sales_rep_assignments_pkey','p','PRIMARY KEY (id)',id_column),
  ('customer_sales_rep_assignments_customer_id_key','u','UNIQUE (customer_id)',customer_column)
 ) AS required(name,kind,definition,column_number) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid=relation AND k.conname=key.name
   AND k.contype=key.kind::"char" AND k.conkey=ARRAY[key.column_number]::smallint[]
   AND k.convalidated AND NOT k.condeferrable AND NOT k.condeferred AND k.conparentid=0
   AND pg_catalog.pg_get_constraintdef(k.oid)=key.definition)
  THEN RAISE EXCEPTION 'Unexpected assignment uniqueness; migration refused'; END IF;
 END LOOP;
 FOR key IN SELECT * FROM (VALUES
  ('customer_sales_rep_assignments_assigned_by_fkey','FOREIGN KEY (assigned_by) REFERENCES public.users(id)','FOREIGN KEY (assigned_by) REFERENCES public.users(id)'),
  ('customer_sales_rep_assignments_customer_id_fkey','FOREIGN KEY (customer_id) REFERENCES public.customers(id)','FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE'),
  ('customer_sales_rep_assignments_sales_rep_id_fkey','FOREIGN KEY (sales_rep_id) REFERENCES public.users(id)','FOREIGN KEY (sales_rep_id) REFERENCES public.users(id) ON DELETE CASCADE')
 ) AS required(name,fixture_definition,hosted_definition) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid=relation AND k.conname=key.name
   AND k.contype='f' AND k.convalidated AND NOT k.condeferrable AND NOT k.condeferred AND k.conparentid=0
   AND pg_catalog.pg_get_constraintdef(k.oid) IN (key.fixture_definition,key.hosted_definition))
  THEN RAISE EXCEPTION 'Unexpected assignment foreign keys; migration refused'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid=relation AND k.conname NOT IN (
  'customer_sales_rep_assignments_pkey','customer_sales_rep_assignments_customer_id_key',
  'customer_sales_rep_assignments_assigned_by_fkey','customer_sales_rep_assignments_customer_id_fkey',
  'customer_sales_rep_assignments_sales_rep_id_fkey','customer_sales_rep_assignments_sales_rep_id_key'))
 THEN RAISE EXCEPTION 'Unexpected assignment constraints; migration refused'; END IF;

 SELECT k.oid,k.conindid INTO salesperson_key,salesperson_index FROM pg_catalog.pg_constraint k
 WHERE k.conrelid=relation AND k.conname='customer_sales_rep_assignments_sales_rep_id_key';
 IF salesperson_key IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.oid=salesperson_key
  AND k.contype='u' AND k.conkey=ARRAY[sales_column]::smallint[] AND k.convalidated
  AND NOT k.condeferrable AND NOT k.condeferred AND k.conparentid=0
  AND pg_catalog.pg_get_constraintdef(k.oid)='UNIQUE (sales_rep_id)')
 THEN RAISE EXCEPTION 'Unexpected assignment uniqueness; migration refused'; END IF;
 expected_indexes:=ARRAY['customer_sales_rep_assignments_customer_id_key','customer_sales_rep_assignments_pkey'];
 IF salesperson_key IS NOT NULL THEN expected_indexes:=expected_indexes||'customer_sales_rep_assignments_sales_rep_id_key'::text; END IF;
 IF (SELECT array_agg(c.relname::text ORDER BY c.relname) FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid WHERE i.indrelid=relation)
  IS DISTINCT FROM expected_indexes
 THEN RAISE EXCEPTION 'Unexpected assignment uniqueness; migration refused'; END IF;
 FOR key IN SELECT * FROM (VALUES
  ('customer_sales_rep_assignments_pkey','id',id_column,true),
  ('customer_sales_rep_assignments_customer_id_key','customer_id',customer_column,false),
  ('customer_sales_rep_assignments_sales_rep_id_key','sales_rep_id',sales_column,false)
 ) AS required(name,column_name,column_number,is_primary) LOOP
  IF key.name='customer_sales_rep_assignments_sales_rep_id_key' AND salesperson_key IS NULL THEN CONTINUE; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
   JOIN pg_catalog.pg_am m ON m.oid=c.relam JOIN pg_catalog.pg_constraint k ON k.conindid=i.indexrelid AND k.conrelid=relation
   WHERE i.indrelid=relation AND c.relname=key.name AND k.conname=key.name
   AND i.indisunique AND i.indisprimary=key.is_primary AND i.indisvalid AND i.indisready AND i.indislive
   AND NOT i.indisexclusion AND NOT i.indisreplident AND NOT i.indnullsnotdistinct
   AND i.indimmediate AND i.indnkeyatts=1 AND i.indnatts=1 AND i.indkey::text=key.column_number::text
   AND i.indpred IS NULL AND i.indexprs IS NULL AND m.amname='btree' AND c.relkind='i' AND NOT c.relispartition
   AND pg_catalog.pg_get_indexdef(i.indexrelid)=format('CREATE UNIQUE INDEX %s ON public.customer_sales_rep_assignments USING btree (%s)',key.name,key.column_name))
  THEN RAISE EXCEPTION 'Unexpected assignment uniqueness; migration refused'; END IF;
 END LOOP;

 -- Fail before the drop if any incoming FK or unexpected index/constraint
 -- dependent exists. The index's INTERNAL ownership dependency is expected.
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE contype='f' AND confrelid=relation)
 OR (salesperson_key IS NOT NULL AND (
  EXISTS(SELECT 1 FROM pg_catalog.pg_depend d WHERE d.refclassid='pg_catalog.pg_class'::regclass AND d.refobjid=salesperson_index)
  OR EXISTS(SELECT 1 FROM pg_catalog.pg_depend d WHERE d.refclassid='pg_catalog.pg_constraint'::regclass AND d.refobjid=salesperson_key
   AND NOT (d.classid='pg_catalog.pg_class'::regclass AND d.objid=salesperson_index AND d.objsubid=0 AND d.refobjsubid=0 AND d.deptype='i'))
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_class'::regclass AND d.objid=salesperson_index
   AND d.refclassid='pg_catalog.pg_constraint'::regclass AND d.refobjid=salesperson_key AND d.deptype='i')
 )) THEN RAISE EXCEPTION 'Unexpected assignment dependencies; migration refused'; END IF;
END $preflight$;

-- Locked exact row and metadata snapshots, with only the intended key/index
-- excluded. No row snapshot is persisted after this transaction.
CREATE TEMP TABLE sales_assignment_rows_before ON COMMIT DROP AS
 SELECT a.id,to_jsonb(a) AS metadata FROM public.customer_sales_rep_assignments a;
CREATE TEMP TABLE sales_assignment_relation_before ON COMMIT DROP AS
 SELECT c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,c.relkind,c.relispartition,c.reloptions,c.relreplident
 FROM pg_catalog.pg_class c WHERE c.oid='public.customer_sales_rep_assignments'::regclass;
CREATE TEMP TABLE sales_assignment_columns_before ON COMMIT DROP AS
 SELECT a.attnum,to_jsonb(a) AS metadata,pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_expression
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid='public.customer_sales_rep_assignments'::regclass AND a.attnum>0;
CREATE TEMP TABLE sales_assignment_policies_before ON COMMIT DROP AS
 SELECT p.oid,to_jsonb(p) AS metadata FROM pg_catalog.pg_policy p WHERE p.polrelid='public.customer_sales_rep_assignments'::regclass;
CREATE TEMP TABLE sales_assignment_constraints_before ON COMMIT DROP AS
 SELECT k.oid,to_jsonb(k) AS metadata FROM pg_catalog.pg_constraint k
 WHERE (k.conrelid='public.customer_sales_rep_assignments'::regclass OR k.confrelid='public.customer_sales_rep_assignments'::regclass)
 AND k.conname<>'customer_sales_rep_assignments_sales_rep_id_key';
CREATE TEMP TABLE sales_assignment_indexes_before ON COMMIT DROP AS
 SELECT i.indexrelid,to_jsonb(i) AS metadata,c.relowner,c.relacl,c.reloptions,pg_catalog.pg_get_indexdef(i.indexrelid) AS definition
 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
 WHERE i.indrelid='public.customer_sales_rep_assignments'::regclass AND c.relname<>'customer_sales_rep_assignments_sales_rep_id_key';
CREATE TEMP TABLE sales_assignment_triggers_before ON COMMIT DROP AS
 SELECT t.oid,to_jsonb(t) AS metadata FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.customer_sales_rep_assignments'::regclass;
CREATE TEMP TABLE sales_assignment_objects_before ON COMMIT DROP AS
 SELECT 'pg_catalog.pg_class'::regclass AS classid,c.oid AS objectid FROM pg_catalog.pg_class c
 WHERE c.oid='public.customer_sales_rep_assignments'::regclass
 UNION ALL SELECT 'pg_catalog.pg_class'::regclass,i.indexrelid FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
 WHERE i.indrelid='public.customer_sales_rep_assignments'::regclass AND c.relname<>'customer_sales_rep_assignments_sales_rep_id_key'
 UNION ALL SELECT 'pg_catalog.pg_constraint'::regclass,k.oid FROM pg_catalog.pg_constraint k
 WHERE k.conrelid='public.customer_sales_rep_assignments'::regclass AND k.conname<>'customer_sales_rep_assignments_sales_rep_id_key';
CREATE TEMP TABLE sales_assignment_dependencies_before ON COMMIT DROP AS
 SELECT to_jsonb(d) AS metadata FROM pg_catalog.pg_depend d
 WHERE EXISTS(SELECT 1 FROM sales_assignment_objects_before o WHERE (d.classid=o.classid AND d.objid=o.objectid) OR (d.refclassid=o.classid AND d.refobjid=o.objectid))
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid='public.customer_sales_rep_assignments'::regclass AND k.conname='customer_sales_rep_assignments_sales_rep_id_key'
  AND ((d.classid='pg_catalog.pg_constraint'::regclass AND d.objid=k.oid) OR (d.refclassid='pg_catalog.pg_constraint'::regclass AND d.refobjid=k.oid)
   OR (d.classid='pg_catalog.pg_class'::regclass AND d.objid=k.conindid) OR (d.refclassid='pg_catalog.pg_class'::regclass AND d.refobjid=k.conindid)));

DO $change$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.customer_sales_rep_assignments'::regclass
  AND conname='customer_sales_rep_assignments_sales_rep_id_key') THEN
  ALTER TABLE public.customer_sales_rep_assignments
   DROP CONSTRAINT customer_sales_rep_assignments_sales_rep_id_key;
 END IF;
END $change$;

DO $postflight$
BEGIN
 IF EXISTS(
  (SELECT * FROM sales_assignment_rows_before EXCEPT SELECT a.id,to_jsonb(a) FROM public.customer_sales_rep_assignments a)
  UNION ALL (SELECT a.id,to_jsonb(a) FROM public.customer_sales_rep_assignments a EXCEPT SELECT * FROM sales_assignment_rows_before)
 ) THEN RAISE EXCEPTION 'Assignment rows changed; migration refused'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.customer_sales_rep_assignments'::regclass AND conname='customer_sales_rep_assignments_sales_rep_id_key')
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
  WHERE i.indrelid='public.customer_sales_rep_assignments'::regclass AND c.relname='customer_sales_rep_assignments_sales_rep_id_key')
 THEN RAISE EXCEPTION 'Unexpected assignment uniqueness; migration refused'; END IF;
 IF EXISTS(
  (SELECT * FROM sales_assignment_relation_before EXCEPT SELECT c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,c.relkind,c.relispartition,c.reloptions,c.relreplident FROM pg_catalog.pg_class c WHERE c.oid='public.customer_sales_rep_assignments'::regclass)
  UNION ALL (SELECT c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,c.relkind,c.relispartition,c.reloptions,c.relreplident FROM pg_catalog.pg_class c WHERE c.oid='public.customer_sales_rep_assignments'::regclass EXCEPT SELECT * FROM sales_assignment_relation_before)
 ) OR EXISTS(
  (SELECT * FROM sales_assignment_columns_before EXCEPT SELECT a.attnum,to_jsonb(a),pg_catalog.pg_get_expr(d.adbin,d.adrelid) FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.customer_sales_rep_assignments'::regclass AND a.attnum>0)
  UNION ALL (SELECT a.attnum,to_jsonb(a),pg_catalog.pg_get_expr(d.adbin,d.adrelid) FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.customer_sales_rep_assignments'::regclass AND a.attnum>0 EXCEPT SELECT * FROM sales_assignment_columns_before)
 ) OR EXISTS(
  (SELECT * FROM sales_assignment_policies_before EXCEPT SELECT p.oid,to_jsonb(p) FROM pg_catalog.pg_policy p WHERE p.polrelid='public.customer_sales_rep_assignments'::regclass)
  UNION ALL (SELECT p.oid,to_jsonb(p) FROM pg_catalog.pg_policy p WHERE p.polrelid='public.customer_sales_rep_assignments'::regclass EXCEPT SELECT * FROM sales_assignment_policies_before)
 ) OR EXISTS(
  (SELECT * FROM sales_assignment_constraints_before EXCEPT SELECT k.oid,to_jsonb(k) FROM pg_catalog.pg_constraint k WHERE k.conrelid='public.customer_sales_rep_assignments'::regclass OR k.confrelid='public.customer_sales_rep_assignments'::regclass)
  UNION ALL (SELECT k.oid,to_jsonb(k) FROM pg_catalog.pg_constraint k WHERE k.conrelid='public.customer_sales_rep_assignments'::regclass OR k.confrelid='public.customer_sales_rep_assignments'::regclass EXCEPT SELECT * FROM sales_assignment_constraints_before)
 ) OR EXISTS(
  (SELECT * FROM sales_assignment_indexes_before EXCEPT SELECT i.indexrelid,to_jsonb(i),c.relowner,c.relacl,c.reloptions,pg_catalog.pg_get_indexdef(i.indexrelid) FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='public.customer_sales_rep_assignments'::regclass)
  UNION ALL (SELECT i.indexrelid,to_jsonb(i),c.relowner,c.relacl,c.reloptions,pg_catalog.pg_get_indexdef(i.indexrelid) FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='public.customer_sales_rep_assignments'::regclass EXCEPT SELECT * FROM sales_assignment_indexes_before)
 ) OR EXISTS(
  (SELECT * FROM sales_assignment_triggers_before EXCEPT SELECT t.oid,to_jsonb(t) FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.customer_sales_rep_assignments'::regclass)
  UNION ALL (SELECT t.oid,to_jsonb(t) FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.customer_sales_rep_assignments'::regclass EXCEPT SELECT * FROM sales_assignment_triggers_before)
 ) OR EXISTS(
  (SELECT * FROM sales_assignment_dependencies_before EXCEPT SELECT to_jsonb(d) FROM pg_catalog.pg_depend d WHERE EXISTS(SELECT 1 FROM sales_assignment_objects_before o WHERE (d.classid=o.classid AND d.objid=o.objectid) OR (d.refclassid=o.classid AND d.refobjid=o.objectid)))
  UNION ALL (SELECT to_jsonb(d) FROM pg_catalog.pg_depend d WHERE EXISTS(SELECT 1 FROM sales_assignment_objects_before o WHERE (d.classid=o.classid AND d.objid=o.objectid) OR (d.refclassid=o.classid AND d.refobjid=o.objectid)) EXCEPT SELECT * FROM sales_assignment_dependencies_before)
 ) THEN RAISE EXCEPTION 'Assignment metadata changed; migration refused'; END IF;
END $postflight$;
NOTIFY pgrst,'reload schema';
COMMIT;
