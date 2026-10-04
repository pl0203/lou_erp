// Frozen byte-exact preflight from migration at base 1deb183.
// Its ordered legacy mismatch must remain reproducible after the forward fix.
export const FROZEN_CUSTOMER_CATEGORY_OLD_PREFLIGHT = String.raw`DO $preflight$
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
END $preflight$;`
