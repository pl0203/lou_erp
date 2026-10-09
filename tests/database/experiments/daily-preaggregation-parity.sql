-- Wrapped by exact helper/daily metadata guards and rollback; never standalone.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM public.purchase_orders) THEN RAISE EXCEPTION 'Empty daily parity fixture required'; END IF; END $$;
SET LOCAL session_replication_role='replica';
INSERT INTO auth.users(id) SELECT ('96000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid FROM generate_series(1,9)i;
INSERT INTO public.users(id,full_name,email,role,is_active,manager_id)
SELECT ('96000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'Synthetic daily user '||i,'daily-'||i||'@example.invalid',
(CASE i WHEN 1 THEN 'executive' WHEN 2 THEN 'sales_manager' WHEN 3 THEN 'sales_manager' WHEN 4 THEN 'sales_person' WHEN 5 THEN 'sales_person' WHEN 6 THEN 'po_admin' WHEN 7 THEN 'sales_head' ELSE 'executive' END)::public.user_role,i<>8,
CASE i WHEN 4 THEN '96000000-0000-0000-0000-000000000002'::uuid WHEN 5 THEN '96000000-0000-0000-0000-000000000003'::uuid END FROM generate_series(1,8)i;
INSERT INTO public.customers(id,name) VALUES(md5('daily-a')::uuid,'Synthetic daily A'),(md5('daily-b')::uuid,'Synthetic daily B');
INSERT INTO public.customer_manager_assignments(customer_id,manager_id,assigned_by) VALUES(md5('daily-a')::uuid,'96000000-0000-0000-0000-000000000002','96000000-0000-0000-0000-000000000001'),(md5('daily-b')::uuid,'96000000-0000-0000-0000-000000000003','96000000-0000-0000-0000-000000000001');
CREATE TEMP TABLE daily_po_facts(n integer,day date,status text,price numeric);
INSERT INTO daily_po_facts VALUES(1,'2026-09-01','confirm',100.25),(2,'2026-09-01','confirm',20.10),(3,'2026-08-01','complete',10.10),(4,'2025-09-30','confirm',30),(5,'2026-10-01','confirm',40),(6,'2026-09-01','cancelled',50),(7,'2024-02-29','confirm',60.05),(8,'2025-12-31','confirm',70.05);
INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number,status,order_date,total_value)
SELECT md5('daily-po-'||n)::uuid,md5(CASE WHEN n IN(1,2) THEN 'daily-b' ELSE 'daily-a' END)::uuid,'96000000-0000-0000-0000-000000000006','DAILY-'||n,status::public.po_status,day,1000 FROM daily_po_facts;
INSERT INTO public.girard_orders(id,customer_id,submitted_by,status,po_id,total_value)
SELECT md5('daily-order-'||f.n)::uuid,p.customer_id,('96000000-0000-0000-0000-'||CASE WHEN f.n=2 THEN '000000000005' ELSE '000000000004' END)::uuid,'approved',p.id,1000 FROM daily_po_facts f JOIN public.purchase_orders p ON p.id=md5('daily-po-'||f.n)::uuid;
INSERT INTO public.po_line_items(id,purchase_order_id,product_name,sku,quantity,unit_price)
SELECT md5('daily-line-'||n)::uuid,md5('daily-po-'||n)::uuid,'Synthetic daily item','DAY-'||n,100,price FROM daily_po_facts;
INSERT INTO public.po_line_items(id,purchase_order_id,product_name,sku,quantity,unit_price) VALUES(md5('daily-line-zero')::uuid,md5('daily-po-1')::uuid,'Synthetic zero','ZERO',100,0);
CREATE TEMP TABLE daily_header_facts(n integer,po integer,day date,voided boolean);
INSERT INTO daily_header_facts VALUES(1,1,'2026-09-01',false),(2,1,'2026-09-30',false),(3,1,'2026-09-15',false),(4,1,'2026-09-15',true),(5,1,'2026-09-15',false),(6,2,'2026-09-15',false),(7,3,'2026-09-15',false),(8,4,'2026-09-15',false),(9,1,'2026-09-15',false),(10,1,'2026-09-15',false),(11,5,'2026-09-15',false),(12,6,'2026-09-15',false),(13,1,'2026-10-01',false),(14,7,'2024-02-29',false),(15,8,'2025-12-31',false),(16,8,'2026-01-01',false),(17,1,'2026-09-15',false),(18,2,'2026-09-15',false);
INSERT INTO public.surat_jalan(id,purchase_order_id,sj_number,sj_date,created_by,voided_at,voided_by,void_reason)
SELECT md5('daily-sj-'||n)::uuid,md5('daily-po-'||po)::uuid,'DAILY-SJ-'||n,day,'96000000-0000-0000-0000-000000000006',CASE WHEN voided THEN '2026-09-16'::timestamptz END,CASE WHEN voided THEN '96000000-0000-0000-0000-000000000006'::uuid END,CASE WHEN voided THEN 'Synthetic void' END FROM daily_header_facts;
INSERT INTO public.sj_line_items(surat_jalan_id,po_line_item_id,quantity_delivered)
SELECT md5('daily-sj-'||h)::uuid,md5('daily-line-'||l)::uuid,q FROM(VALUES(1,'1',2),(1,'zero',3),(1,'1',1),(2,'1',0),(4,'1',5),(5,'2',1),(6,'1',1),(7,'3',2),(8,'1',1),(9,'4',1),(10,'5',1),(11,'1',1),(12,'6',1),(13,'1',1),(14,'7',1),(15,'8',1),(16,'8',1),(17,'zero',1),(18,'2',1))v(h,l,q);
-- Check constraints still reject negative values even during this synthetic seed.
DO $$ BEGIN
 BEGIN INSERT INTO public.sj_line_items(surat_jalan_id,po_line_item_id,quantity_delivered) VALUES(md5('daily-sj-1')::uuid,md5('daily-line-1')::uuid,-1); RAISE EXCEPTION 'Negative delivery unexpectedly accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.po_line_items SET unit_price=-1 WHERE id=md5('daily-line-1')::uuid; RAISE EXCEPTION 'Negative price unexpectedly accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SET LOCAL session_replication_role='origin';
CREATE TEMP TABLE daily_cases(n integer,first_day date,last_day date,rolling date,status text,fulfillment text,page integer,size integer);
INSERT INTO daily_cases VALUES
(1,'2026-09-01','2026-09-30','2025-10-01','all','all',1,30),
(2,'2026-09-01','2026-09-30','2025-10-01','confirm','all',1,30),
(3,'2026-09-01','2026-09-30','2025-10-01','cancelled','all',1,30),
(4,'2026-09-01','2026-09-30','2025-10-01','all','all',2,15),
(5,'2026-09-01','2026-09-30','2025-10-01','all','all',3,15),
(6,'2026-09-01','2026-09-30','2026-09-01','all','all',1,30),
(7,'2024-02-01','2024-02-29','2024-02-01','all','all',1,29),
(8,'2025-12-31','2026-01-01','2025-10-01','all','all',1,2),
(9,'2026-09-01','2026-09-30','2025-10-01','all','complete',1,30),
(10,'2026-09-01','2026-09-30','2025-10-01','all','partial',1,30),
(11,'2026-09-01','2026-09-30','2025-10-01','all','undelivered',1,30),
(12,'2026-09-15','2026-09-15','2025-10-01','all','all',1,1),
(13,'2026-09-01','2026-09-30','2025-10-01','complete','all',1,30),
(14,'2026-09-01','2026-09-30','2025-10-01','draft','all',1,30),
(15,'2026-09-01','2026-09-30','2025-10-01','in_progress','all',1,30);
-- Literal complete-day controls, independent from the original and candidate joins.
CREATE FUNCTION pg_temp.daily_literal(actor integer,case_no integer DEFAULT 1) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER AS $$
WITH c AS (SELECT * FROM pg_temp.daily_cases WHERE n=case_no),
calendar AS (SELECT c.*,first_day+i AS day,i+1 AS ordinal FROM c CROSS JOIN LATERAL generate_series(0,last_day-first_day)i),
values_by_day AS (SELECT day,ordinal,page,size,
 CASE
 WHEN case_no=7 AND day='2024-02-29' AND actor NOT IN(3,5) THEN 60.05
 WHEN case_no=8 AND actor NOT IN(3,5) THEN 70.05
 WHEN case_no NOT IN(3,7,8,13,14,15) AND day='2026-09-01' AND actor NOT IN(3,5) THEN 300.75
 WHEN day='2026-09-15' THEN
  CASE WHEN case_no IN(14,15) THEN 0
   WHEN case_no=13 THEN CASE WHEN actor NOT IN(3,5) THEN 20.20 ELSE 0 END
   WHEN case_no=3 THEN CASE WHEN actor NOT IN(3,5) THEN 50 ELSE 0 END
   WHEN case_no=2 THEN CASE WHEN actor IN(1,6,7) THEN 140.45 WHEN actor IN(2,4) THEN 0 ELSE 20.10 END
   WHEN case_no=6 THEN CASE WHEN actor IN(1,6,7) THEN 190.45 WHEN actor IN(2,4) THEN 50 ELSE 20.10 END
   ELSE CASE WHEN actor IN(1,6,7) THEN 210.65 WHEN actor IN(2,4) THEN 70.20 ELSE 20.10 END END
 ELSE 0 END AS amount,
 CASE
 WHEN case_no=7 AND day='2024-02-29' AND actor NOT IN(3,5) THEN 1
 WHEN case_no=8 AND actor NOT IN(3,5) THEN 1
 WHEN case_no NOT IN(3,7,8,13,14,15) AND day IN('2026-09-01','2026-09-30') AND actor NOT IN(3,5) THEN 1
 WHEN day='2026-09-15' THEN
  CASE WHEN case_no IN(14,15) THEN 0
   WHEN case_no IN(3,13) THEN CASE WHEN actor NOT IN(3,5) THEN 1 ELSE 0 END
   WHEN case_no=2 THEN CASE WHEN actor IN(1,6,7) THEN 4 ELSE 1 END
   WHEN case_no=6 THEN CASE WHEN actor IN(1,6,7) THEN 5 WHEN actor IN(2,4) THEN 2 ELSE 1 END
   ELSE CASE WHEN actor IN(1,6,7) THEN 6 WHEN actor IN(2,4) THEN 3 ELSE 1 END END
 ELSE 0 END AS count
 FROM calendar)
SELECT coalesce(jsonb_agg(jsonb_build_object('key',day,'deliveredValue',amount::numeric,'sjCount',count) ORDER BY day),'[]'::jsonb)
FROM values_by_day WHERE ordinal BETWEEN (page-1)*size+1 AND page*size $$;
CREATE FUNCTION pg_temp.daily_normalize(r jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT (r-'as_of'-'items')||jsonb_build_object('items',coalesce((SELECT jsonb_agg(x||jsonb_build_object('deliveredValue',(x->>'deliveredValue')::numeric,'sjCount',(x->>'sjCount')::bigint) ORDER BY ord) FROM jsonb_array_elements(r->'items') WITH ORDINALITY e(x,ord)),'[]'::jsonb)) $$;
CREATE TEMP TABLE daily_observations(variant text,actor integer,case_no integer);
CREATE FUNCTION pg_temp.check_daily(actor integer,case_no integer,variant text) RETURNS text LANGUAGE plpgsql SECURITY INVOKER AS $check$
DECLARE c record; actual jsonb; expected jsonb;
BEGIN
 IF current_user<>'authenticated' OR NOT row_security_active('public.purchase_orders') OR NOT row_security_active('public.sj_line_items') THEN RAISE EXCEPTION 'Daily actual role/RLS required'; END IF;
 PERFORM set_config('request.jwt.claim.sub','96000000-0000-0000-0000-'||lpad(actor::text,12,'0'),true);
 SELECT * INTO STRICT c FROM pg_temp.daily_cases WHERE n=case_no;
 actual:=pg_temp.daily_normalize(public.pilot_athel_daily_v1(c.first_day,c.last_day,c.rolling,c.status,c.fulfillment,c.page,c.size));
 expected:=pg_temp.daily_normalize(pg_temp.daily_baseline(c.first_day,c.last_day,c.rolling,c.status,c.fulfillment,c.page,c.size));
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Daily full response differs actor% case%',actor,case_no; END IF;
 IF actual->'items' IS DISTINCT FROM pg_temp.daily_literal(actor,case_no) THEN RAISE EXCEPTION 'Daily literal oracle differs actor%',actor; END IF;
 INSERT INTO pg_temp.daily_observations VALUES(variant,actor,case_no);
 RETURN 'DAILY_PARITY_CASE_VERIFIED '||variant||' '||actor||' '||case_no;
END $check$;
CREATE FUNCTION pg_temp.reject_bad_daily(control text) RETURNS text LANGUAGE plpgsql SECURITY INVOKER AS $negative$
DECLARE response jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000001',true);
 -- Any query error propagates; only the subsequent exact literal mismatch is caught.
 CASE control WHEN 'drop_line_cohort' THEN response:=pg_temp.daily_bad_drop_line_cohort('2026-09-01','2026-09-30','2025-10-01','all','all',1,30);
 WHEN 'count_empty' THEN response:=pg_temp.daily_bad_count_empty('2026-09-01','2026-09-30','2025-10-01','all','all',1,30);
 ELSE RAISE EXCEPTION 'Unknown negative control'; END CASE;
 BEGIN
  IF pg_temp.daily_normalize(response)->'items' IS DISTINCT FROM pg_temp.daily_literal(1) THEN RAISE EXCEPTION 'Expected daily literal mismatch' USING ERRCODE='P0004'; END IF;
 EXCEPTION WHEN SQLSTATE 'P0004' THEN
  IF SQLERRM<>'Expected daily literal mismatch' THEN RAISE; END IF;
  RETURN 'DAILY_NEGATIVE_CONTROL_REJECTED '||control;
 END;
 RAISE EXCEPTION 'Daily negative control escaped oracle';
END $negative$;
GRANT SELECT ON pg_temp.daily_cases TO authenticated;
GRANT INSERT,SELECT ON pg_temp.daily_observations TO authenticated;
DO $$ BEGIN EXECUTE format('GRANT USAGE ON SCHEMA %I TO authenticated,anon',pg_my_temp_schema()::regnamespace); END $$;
SET LOCAL ROLE authenticated;
SET LOCAL plan_cache_mode=auto;
PREPARE daily_parity(integer,integer,text) AS SELECT pg_temp.check_daily($1,$2,$3);
SELECT format('EXECUTE daily_parity(2,1,%L);','baseline') FROM generate_series(1,8) \gexec
SELECT format('EXECUTE daily_parity(%s,%s,%L);',a,c,'baseline') FROM generate_series(1,7)a CROSS JOIN generate_series(1,15)c ORDER BY a,c \gexec
RESET ROLE;
SELECT pg_temp.apply_daily_preaggregation();
SET LOCAL ROLE authenticated;
SELECT format('EXECUTE daily_parity(2,1,%L);','candidate') FROM generate_series(1,8) \gexec
SELECT format('EXECUTE daily_parity(%s,%s,%L);',a,c,'candidate') FROM generate_series(1,7)a CROSS JOIN generate_series(1,15)c ORDER BY a,c \gexec
SELECT pg_temp.reject_bad_daily('drop_line_cohort');
SELECT pg_temp.reject_bad_daily('count_empty');
-- Inactive executive, orphan Auth profile and NULL identity remain denied.
DO $$ DECLARE actor text; BEGIN
 FOREACH actor IN ARRAY ARRAY['96000000-0000-0000-0000-000000000008','96000000-0000-0000-0000-000000000009',''] LOOP
  PERFORM set_config('request.jwt.claim.sub',actor,true);
  BEGIN PERFORM public.pilot_athel_daily_v1('2026-09-01','2026-09-30','2025-10-01','all','all',1,30); RAISE EXCEPTION 'Unexpected daily identity access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
END $$;
SELECT set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000002',true);
DO $$ BEGIN
 BEGIN PERFORM public.pilot_athel_daily_v1('2026-09-01','2026-09-30','2025-10-01','all','all',0,30); RAISE EXCEPTION 'Invalid page accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.pilot_athel_daily_v1('2026-09-30','2026-09-01','2025-10-01','all','all',1,30); RAISE EXCEPTION 'Invalid dates accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.pilot_athel_daily_v1('2026-09-01','2026-09-30','2025-10-01','all','unknown',1,30); RAISE EXCEPTION 'Invalid fulfillment accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN BEGIN PERFORM public.pilot_athel_daily_v1('2026-09-01','2026-09-30','2025-10-01','all','all',1,30); RAISE EXCEPTION 'Anon daily access accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
RESET ROLE;
DO $$ BEGIN IF (SELECT count(*) FROM pg_temp.daily_observations)<>226 OR (SELECT count(DISTINCT(variant,actor,case_no)) FROM pg_temp.daily_observations)<>210 THEN RAISE EXCEPTION 'Incomplete daily matrix'; END IF; END $$;
SELECT 'DAILY_PREAGGREGATION_PARITY_VERIFIED';
