-- Forward-only classification addition. Deployment requires separate target approval.
-- Existing customers stay null; no inferred classification or pricing/data rewrite.
-- Client rollback retains this column and every classification already entered.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL idle_in_transaction_session_timeout='60s';
SET LOCAL search_path='';
SET LOCAL row_security=off;
LOCK TABLE public.customers IN ACCESS EXCLUSIVE MODE;

-- This bounded, locked preflight deliberately refuses any preexisting category state.
-- Do not turn a failed contract into an IF NOT EXISTS repair or a silent skip.
DO $preflight$
DECLARE actual jsonb; expected jsonb;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.customers'::regclass AND attname='customer_category')
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.customers'::regclass AND conname='customers_customer_category_check')
 THEN RAISE EXCEPTION 'Unexpected customer category schema; migration refused'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid='public.customers'::regclass AND relkind='r'
   AND NOT relispartition AND relrowsecurity AND NOT relforcerowsecurity
   AND relowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user))
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid='public.customers'::regclass OR inhparent='public.customers'::regclass)
 THEN RAISE EXCEPTION 'Unexpected customers relation contract; migration refused'; END IF;
 SELECT jsonb_agg(jsonb_build_array(a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated) ORDER BY a.attnum)
 INTO actual FROM pg_catalog.pg_attribute a WHERE a.attrelid='public.customers'::regclass AND a.attnum>0 AND NOT a.attisdropped;
 SELECT jsonb_agg(jsonb_build_array(name,type_name,required,'','') ORDER BY position) INTO expected FROM (VALUES
  (1,'id','uuid',true), (2,'name','text',true), (3,'address','text',false),
  (4,'city','text',false), (5,'phone','text',false), (6,'email','text',false),
  (7,'pricing_tier','public.pricing_tier',true), (8,'visit_frequency_days','integer',true),
  (9,'last_visit_date','date',false), (10,'created_at','timestamp with time zone',false)
 ) contract(position,name,type_name,required);
 IF actual IS DISTINCT FROM expected
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_attribute a ON a.attrelid=k.conrelid AND a.attname='id'
   WHERE k.conrelid='public.customers'::regclass AND k.contype='p' AND k.convalidated AND k.conkey=ARRAY[a.attnum])
 THEN RAISE EXCEPTION 'Unexpected customers column contract; migration refused'; END IF;
END $preflight$;

-- Exact snapshots are taken under the customer lock. row_security=off raises if
-- this session cannot see the entire relation instead of hashing a filtered subset.
CREATE TEMP TABLE customer_categories_rows_before ON COMMIT DROP AS
 SELECT c.id,to_jsonb(c) AS original_row FROM public.customers c;
CREATE TEMP TABLE customer_categories_relation_before ON COMMIT DROP AS
 SELECT c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity FROM pg_catalog.pg_class c WHERE c.oid='public.customers'::regclass;
CREATE TEMP TABLE customer_categories_columns_before ON COMMIT DROP AS
 SELECT a.attnum,to_jsonb(a) AS metadata,pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_expression
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid='public.customers'::regclass AND a.attnum>0;
CREATE TEMP TABLE customer_categories_policies_before ON COMMIT DROP AS
 SELECT p.oid,to_jsonb(p) AS metadata FROM pg_catalog.pg_policy p WHERE p.polrelid='public.customers'::regclass;
CREATE TEMP TABLE customer_categories_constraints_before ON COMMIT DROP AS
 SELECT k.oid,to_jsonb(k) AS metadata FROM pg_catalog.pg_constraint k WHERE k.conrelid='public.customers'::regclass;

ALTER TABLE public.customers
 ADD COLUMN customer_category text DEFAULT NULL,
 ADD CONSTRAINT customers_customer_category_check CHECK (
  customer_category IS NULL OR customer_category IN (
   'supermarket_besar','supermarket_sedang','supermarket_kecil','tradisional_market','perorangan'
  )
 );

DO $postflight$
BEGIN
 IF EXISTS(SELECT 1 FROM public.customers WHERE customer_category IS NOT NULL)
 OR EXISTS(
  (SELECT id,original_row FROM customer_categories_rows_before EXCEPT SELECT c.id,to_jsonb(c)-'customer_category' FROM public.customers c)
  UNION ALL
  (SELECT c.id,to_jsonb(c)-'customer_category' FROM public.customers c EXCEPT SELECT id,original_row FROM customer_categories_rows_before)
 ) THEN RAISE EXCEPTION 'Customer rows changed; migration refused'; END IF;
 IF EXISTS(
  (SELECT * FROM customer_categories_relation_before EXCEPT SELECT c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity FROM pg_catalog.pg_class c WHERE c.oid='public.customers'::regclass)
  UNION ALL
  (SELECT c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity FROM pg_catalog.pg_class c WHERE c.oid='public.customers'::regclass EXCEPT SELECT * FROM customer_categories_relation_before)
 ) THEN RAISE EXCEPTION 'Customer access metadata changed; migration refused'; END IF;
 IF EXISTS(
  (SELECT * FROM customer_categories_columns_before EXCEPT
   SELECT a.attnum,to_jsonb(a),pg_catalog.pg_get_expr(d.adbin,d.adrelid) FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE a.attrelid='public.customers'::regclass AND a.attnum>0 AND a.attname<>'customer_category')
  UNION ALL
  (SELECT a.attnum,to_jsonb(a),pg_catalog.pg_get_expr(d.adbin,d.adrelid) FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE a.attrelid='public.customers'::regclass AND a.attnum>0 AND a.attname<>'customer_category' EXCEPT SELECT * FROM customer_categories_columns_before)
 ) THEN RAISE EXCEPTION 'Customer column metadata changed; migration refused'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE a.attrelid='public.customers'::regclass AND a.attname='customer_category' AND NOT a.attisdropped
   AND a.atttypid='text'::regtype AND a.atttypmod=-1 AND NOT a.attnotnull AND a.attacl IS NULL
   AND a.attidentity='' AND a.attgenerated='' AND coalesce(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'NULL::text')='NULL::text')
 THEN RAISE EXCEPTION 'Unexpected new category column metadata; migration refused'; END IF;
 IF EXISTS(
  (SELECT * FROM customer_categories_policies_before EXCEPT SELECT p.oid,to_jsonb(p) FROM pg_catalog.pg_policy p WHERE p.polrelid='public.customers'::regclass)
  UNION ALL
  (SELECT p.oid,to_jsonb(p) FROM pg_catalog.pg_policy p WHERE p.polrelid='public.customers'::regclass EXCEPT SELECT * FROM customer_categories_policies_before)
 ) THEN RAISE EXCEPTION 'Customer policies changed; migration refused'; END IF;
 IF EXISTS(
  (SELECT * FROM customer_categories_constraints_before EXCEPT SELECT k.oid,to_jsonb(k) FROM pg_catalog.pg_constraint k WHERE k.conrelid='public.customers'::regclass AND k.conname<>'customers_customer_category_check')
  UNION ALL
  (SELECT k.oid,to_jsonb(k) FROM pg_catalog.pg_constraint k WHERE k.conrelid='public.customers'::regclass AND k.conname<>'customers_customer_category_check' EXCEPT SELECT * FROM customer_categories_constraints_before)
 ) THEN RAISE EXCEPTION 'Customer constraints changed; migration refused'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_attribute a ON a.attrelid=k.conrelid AND a.attname='customer_category'
   WHERE k.conrelid='public.customers'::regclass AND k.conname='customers_customer_category_check'
   AND k.contype='c' AND k.convalidated AND k.conkey=ARRAY[a.attnum])
 THEN RAISE EXCEPTION 'Category CHECK is missing or not validated; migration refused'; END IF;
END $postflight$;
COMMIT;
