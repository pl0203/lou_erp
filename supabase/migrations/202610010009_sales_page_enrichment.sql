-- Query-only: exact count/status scope, then bounded nullable label enrichment.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL search_path='';
DO $$ DECLARE relation_name text; key_number smallint; BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.pilot_sales_order_page_v1(text,boolean,integer,integer,uuid,uuid)'::regprocedure AND md5(prosrc)='ae6da867beb7fdd6600fbef7d10327f8' AND NOT prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=""']) THEN RAISE EXCEPTION 'Unexpected sales page base; review required'; END IF;
 FOREACH relation_name IN ARRAY ARRAY['customers','users'] LOOP
  SELECT attnum INTO key_number FROM pg_attribute WHERE attrelid=to_regclass('public.'||relation_name) AND attname='id' AND atttypid='uuid'::regtype AND attnotnull AND NOT attisdropped;
  IF key_number IS NULL OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.'||relation_name) AND contype='p' AND conkey=ARRAY[key_number]) THEN RAISE EXCEPTION 'Label relation primary-key contract drift'; END IF;
 END LOOP;
END $$;
CREATE TEMP TABLE sales_page_attributes ON COMMIT DROP AS SELECT oid,proowner,prolang,proleakproof,proisstrict,proparallel,proacl,provolatile,prosecdef,proconfig,prorettype,proargtypes,proargnames,pronargdefaults,pg_get_function_arguments(oid) AS canonical_arguments FROM pg_proc WHERE oid='public.pilot_sales_order_page_v1(text,boolean,integer,integer,uuid,uuid)'::regprocedure;
CREATE OR REPLACE FUNCTION public.pilot_sales_order_page_v1(p_status text,p_own_only boolean,p_page integer,p_page_size integer,p_customer_id uuid DEFAULT NULL,p_visit_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM private.pilot_read_page_guard_v1(p_page,p_page_size);
 IF p_status IS NULL OR p_status NOT IN ('all','pending','approved','rejected','cancelled') OR p_own_only IS NULL THEN
  RAISE EXCEPTION 'Invalid sales order filter' USING ERRCODE='22023';
 END IF;
 WITH matching AS MATERIALIZED (
  SELECT o.id,o.status,o.total_value,o.created_at,o.rejection_note,o.customer_id,o.submitted_by
  FROM public.girard_orders o
  WHERE (p_status='all' OR o.status=p_status) AND (NOT p_own_only OR o.submitted_by=auth.uid())
   AND (p_customer_id IS NULL OR o.customer_id=p_customer_id) AND (p_visit_id IS NULL OR o.visit_id=p_visit_id)
 ), page_rows AS MATERIALIZED (
  SELECT * FROM matching ORDER BY created_at DESC,id DESC LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size
 ), enriched AS (
  SELECT p.*,CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('name',c.name) END AS customers,
   CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('full_name',u.full_name) END AS users
  FROM page_rows p LEFT JOIN public.customers c ON c.id=p.customer_id LEFT JOIN public.users u ON u.id=p.submitted_by
 )
 SELECT jsonb_build_object('version',1,'as_of',statement_timestamp(),'page',p_page,'page_size',p_page_size,
  'total',(SELECT count(*) FROM matching),
  'status_counts',(SELECT jsonb_build_object('pending',count(*) FILTER(WHERE status='pending'),'approved',count(*) FILTER(WHERE status='approved'),'rejected',count(*) FILTER(WHERE status='rejected'),'cancelled',count(*) FILTER(WHERE status='cancelled')) FROM matching),
  'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'status',status,'total_value',total_value::text,
   'created_at',created_at,'rejection_note',rejection_note,'customers',customers,'users',users) ORDER BY created_at DESC,id DESC) FROM enriched),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM sales_page_attributes b LEFT JOIN pg_proc p ON p.oid=b.oid WHERE ROW(b.proowner,b.prolang,b.proleakproof,b.proisstrict,b.proparallel,b.proacl,b.provolatile,b.prosecdef,b.proconfig,b.prorettype,b.proargtypes,b.proargnames,b.pronargdefaults,b.canonical_arguments) IS DISTINCT FROM ROW(p.proowner,p.prolang,p.proleakproof,p.proisstrict,p.proparallel,p.proacl,p.provolatile,p.prosecdef,p.proconfig,p.prorettype,p.proargtypes,p.proargnames,p.pronargdefaults,pg_get_function_arguments(p.oid))) THEN RAISE EXCEPTION 'Sales page security/signature attributes changed'; END IF;
END $$;
COMMIT;
