-- CANDIDATE: requires reviewed hosted rollout approval. No hosted application implied.
-- Preserves existing authorization and original report populations; exact drift guards
-- reject unknown policy/helper/FK state and never drop a preexisting index.
-- Rejected005/006 experiments are not part of the deployable migration sequence.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL search_path=public,pg_catalog;
CREATE TEMP TABLE scale_expected_policies(table_name text,name text,permissive text,command text,roles name[],using_expr text,check_expr text) ON COMMIT DROP;
INSERT INTO scale_expected_policies
SELECT t,'pilot_active_profile','RESTRICTIVE','ALL',ARRAY['authenticated']::name[],'(current_user_role() IS NOT NULL)','(current_user_role() IS NOT NULL)'
FROM unnest(ARRAY['purchase_orders','po_line_items','po_audit_log','surat_jalan','sj_line_items'])t;
INSERT INTO scale_expected_policies
SELECT t,'pilot_po_visibility','RESTRICTIVE','SELECT',ARRAY['authenticated']::name[],'private.pilot_can_read_po(purchase_order_id)',NULL FROM unnest(ARRAY['po_line_items','po_audit_log','surat_jalan'])t;
INSERT INTO scale_expected_policies VALUES
('purchase_orders','pilot_po_visibility','RESTRICTIVE','SELECT','{authenticated}','private.pilot_can_read_po(id)',NULL),
('sj_line_items','pilot_parent_visibility','RESTRICTIVE','SELECT','{authenticated}','(EXISTS ( SELECT 1 FROM surat_jalan sj WHERE (sj.id = sj_line_items.surat_jalan_id)))',NULL),
('purchase_orders','po_admin_all','PERMISSIVE','ALL','{public}',$expr$(current_user_role() = ANY (ARRAY['po_admin'::user_role, 'executive'::user_role]))$expr$,NULL),
('purchase_orders','po_sales_read','PERMISSIVE','SELECT','{public}',$expr$(current_user_role() = ANY (ARRAY['sales_person'::user_role, 'sales_manager'::user_role, 'sales_head'::user_role]))$expr$,NULL),
('po_line_items','poli_admin_all','PERMISSIVE','ALL','{public}',$expr$(current_user_role() = ANY (ARRAY['po_admin'::user_role, 'executive'::user_role]))$expr$,NULL),
('po_line_items','poli_others_read','PERMISSIVE','SELECT','{public}','(auth.uid() IS NOT NULL)',NULL),
('po_audit_log','audit_read_all','PERMISSIVE','SELECT','{public}','(auth.uid() IS NOT NULL)',NULL),
('surat_jalan','sj_admin_all','PERMISSIVE','ALL','{public}',$expr$(current_user_role() = ANY (ARRAY['po_admin'::user_role, 'executive'::user_role]))$expr$,NULL),
('surat_jalan','sj_sales_read','PERMISSIVE','SELECT','{public}','(auth.uid() IS NOT NULL)',NULL),
('sj_line_items','sj_line_admin_all','PERMISSIVE','ALL','{public}',$expr$(current_user_role() = ANY (ARRAY['po_admin'::user_role, 'executive'::user_role]))$expr$,NULL),
('sj_line_items','sj_line_read','PERMISSIVE','SELECT','{public}','(auth.uid() IS NOT NULL)',NULL);
CREATE TEMP TABLE scale_unchanged_functions ON COMMIT DROP AS SELECT p.oid,p.proowner,p.prolang,p.proleakproof,p.proisstrict,p.proparallel,p.prosrc,p.prosecdef,p.provolatile,p.proconfig,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.oid<>'public.pilot_athel_summary_v1(date,date,date,text,text)'::regprocedure;
CREATE TEMP TABLE scale_unchanged_relations ON COMMIT DROP AS SELECT c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r';
CREATE TEMP TABLE scale_unchanged_columns ON COMMIT DROP AS SELECT a.attrelid,a.attnum,a.attacl FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped;
CREATE TEMP TABLE scale_unchanged_policies ON COMMIT DROP AS SELECT * FROM pg_policies WHERE schemaname IN ('public','storage') AND NOT (schemaname='public' AND ((tablename IN ('po_line_items','po_audit_log','surat_jalan') AND policyname='pilot_po_visibility') OR (tablename='sj_line_items' AND policyname='pilot_parent_visibility') OR (tablename IN ('purchase_orders','po_line_items','po_audit_log','surat_jalan','sj_line_items') AND policyname='pilot_active_profile')));
CREATE FUNCTION pg_temp.scale_assert_metadata() RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF EXISTS((SELECT * FROM scale_unchanged_functions EXCEPT SELECT p.oid,p.proowner,p.prolang,p.proleakproof,p.proisstrict,p.proparallel,p.prosrc,p.prosecdef,p.provolatile,p.proconfig,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.oid<>'public.pilot_athel_summary_v1(date,date,date,text,text)'::regprocedure) UNION ALL (SELECT p.oid,p.proowner,p.prolang,p.proleakproof,p.proisstrict,p.proparallel,p.prosrc,p.prosecdef,p.provolatile,p.proconfig,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.oid<>'public.pilot_athel_summary_v1(date,date,date,text,text)'::regprocedure EXCEPT SELECT * FROM scale_unchanged_functions)) THEN RAISE EXCEPTION 'Function or ACL drift'; END IF;
 IF EXISTS((SELECT * FROM scale_unchanged_relations EXCEPT SELECT c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r') UNION ALL (SELECT c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' EXCEPT SELECT * FROM scale_unchanged_relations)) THEN RAISE EXCEPTION 'Relation grant/RLS drift'; END IF;
 IF EXISTS((SELECT * FROM scale_unchanged_columns EXCEPT SELECT a.attrelid,a.attnum,a.attacl FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped) UNION ALL (SELECT a.attrelid,a.attnum,a.attacl FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped EXCEPT SELECT * FROM scale_unchanged_columns)) THEN RAISE EXCEPTION 'Column ACL drift'; END IF;
END $$;
CREATE FUNCTION pg_temp.scale_assert_policies() RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF EXISTS((SELECT * FROM scale_unchanged_policies EXCEPT SELECT * FROM pg_policies) UNION ALL (SELECT * FROM pg_policies WHERE schemaname IN ('public','storage') AND NOT(schemaname='public' AND ((tablename IN ('po_line_items','po_audit_log','surat_jalan') AND policyname='pilot_po_visibility') OR (tablename='sj_line_items' AND policyname='pilot_parent_visibility') OR (tablename IN ('purchase_orders','po_line_items','po_audit_log','surat_jalan','sj_line_items') AND policyname='pilot_active_profile'))) EXCEPT SELECT * FROM scale_unchanged_policies)) THEN RAISE EXCEPTION 'Untargeted policy drift'; END IF;
END $$;
CREATE FUNCTION pg_temp.scale_assert_unchanged() RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 PERFORM pg_temp.scale_assert_metadata();
 PERFORM pg_temp.scale_assert_policies();
END $$;
CREATE FUNCTION pg_temp.scale_assert_contract() RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog AS $$
DECLARE t text; parent_key smallint; child_key smallint; f regprocedure;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Reviewed schema-owner migration required' USING ERRCODE='23514'; END IF;
 IF (SELECT array_agg(enumlabel::text ORDER BY enumlabel) FROM pg_enum WHERE enumtypid='public.user_role'::regtype) IS DISTINCT FROM ARRAY['executive','po_admin','sales_head','sales_manager','sales_person'] THEN RAISE EXCEPTION 'Role contract drift' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('authenticated','anon') AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Role bypass drift' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('authenticated','anon'))<>2 THEN RAISE EXCEPTION 'Missing application roles' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM scale_expected_policies e FULL JOIN (SELECT * FROM pg_policies WHERE schemaname='public' AND tablename IN ('purchase_orders','po_line_items','po_audit_log','surat_jalan','sj_line_items')) a ON a.tablename=e.table_name AND a.policyname=e.name
 WHERE ROW(e.permissive,e.command,e.roles,regexp_replace(e.using_expr,'\s','','g'),regexp_replace(e.check_expr,'\s','','g')) IS DISTINCT FROM ROW(a.permissive,a.cmd,a.roles,regexp_replace(a.qual,'\s','','g'),regexp_replace(a.with_check,'\s','','g'))) THEN RAISE EXCEPTION 'Policy contract drift' USING ERRCODE='23514'; END IF;
 SELECT attnum INTO parent_key FROM pg_attribute WHERE attrelid='public.purchase_orders'::regclass AND attname='id' AND NOT attisdropped;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_orders'::regclass AND contype='p' AND conkey=ARRAY[parent_key]) THEN RAISE EXCEPTION 'Parent PK drift' USING ERRCODE='23514'; END IF;
 FOREACH t IN ARRAY ARRAY['po_line_items','po_audit_log','surat_jalan'] LOOP
  SELECT attnum INTO child_key FROM pg_attribute WHERE attrelid=to_regclass('public.'||t) AND attname='purchase_order_id' AND attnotnull AND NOT attisdropped AND atttypid='uuid'::regtype;
  IF child_key IS NULL OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.'||t) AND contype='f' AND conkey=ARRAY[child_key] AND confrelid='public.purchase_orders'::regclass AND confkey=ARRAY[parent_key] AND convalidated AND confdeltype='c') THEN RAISE EXCEPTION 'Child FK contract drift' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOREACH t IN ARRAY ARRAY['purchase_orders','po_line_items','po_audit_log','surat_jalan','sj_line_items'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.'||t) AND relrowsecurity AND NOT relforcerowsecurity) OR NOT has_table_privilege('authenticated','public.'||t,'SELECT') THEN RAISE EXCEPTION 'Required RLS/select contract missing' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE oid IN ('public.current_user_role()'::regprocedure,'private.pilot_can_read_po(uuid)'::regprocedure,'private.pilot_can_access_actor(uuid)'::regprocedure) AND (provolatile<>'s' OR NOT prosecdef OR proconfig IS DISTINCT FROM ARRAY['search_path=""'])) THEN RAISE EXCEPTION 'Authorization helper contract drift' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['purchase_orders','po_line_items','po_audit_log','surat_jalan','sj_line_items']) t WHERE has_table_privilege('anon','public.'||t,'SELECT')) THEN RAISE EXCEPTION 'Anonymous table ACL drift' USING ERRCODE='23514'; END IF;
 FOREACH f IN ARRAY ARRAY['public.current_user_role()'::regprocedure,'private.pilot_can_read_po(uuid)'::regprocedure,'private.pilot_can_access_actor(uuid)'::regprocedure,'public.pilot_athel_summary_v1(date,date,date,text,text)'::regprocedure] LOOP
  IF NOT has_function_privilege('authenticated',f,'EXECUTE') OR has_function_privilege('anon',f,'EXECUTE') OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=f AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN RAISE EXCEPTION 'Read function ACL drift' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='auth.uid()'::regprocedure AND provolatile='s' AND NOT prosecdef AND prorettype='uuid'::regtype AND pronargs=0) THEN RAISE EXCEPTION 'Stable identity function contract drift' USING ERRCODE='23514'; END IF;
 PERFORM pg_temp.scale_assert_unchanged();
END $$;
CREATE TEMP TABLE scale_summary_before ON COMMIT DROP AS SELECT oid,proowner,prolang,proleakproof,proisstrict,proparallel,proacl,provolatile,prosecdef,proconfig,prorettype,proargtypes,proargnames FROM pg_proc WHERE oid='public.pilot_athel_summary_v1(date,date,date,text,text)'::regprocedure;
DO $preflight$ BEGIN
 IF to_regclass('public.pilot_po_line_items_purchase_order_id_idx') IS NOT NULL OR to_regclass('public.pilot_sj_line_items_surat_jalan_id_idx') IS NOT NULL THEN RAISE EXCEPTION 'Rejected experimental child-index state requires separate review'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.pilot_athel_summary_v1(date,date,date,text,text)'::regprocedure AND proowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND md5(prosrc)='aaaf7a1f665973967871dc3e22f89cd3' AND NOT prosecdef AND NOT proisstrict AND NOT proleakproof AND proparallel='u' AND prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND provolatile='s' AND proconfig=ARRAY['search_path=""']) THEN RAISE EXCEPTION 'Unexpected summary base function; review required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.current_user_role()'::regprocedure AND NOT proleakproof AND prolang=(SELECT oid FROM pg_language WHERE lanname='sql') AND proowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND md5(prosrc)='43f529ef07f71fa27bc34839521fc91d') THEN RAISE EXCEPTION 'Authorization helper source drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='private.pilot_can_read_po(uuid)'::regprocedure AND NOT proleakproof AND prolang=(SELECT oid FROM pg_language WHERE lanname='sql') AND proowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND md5(prosrc)='e4a035f92fc43345d6d439de348c1dc1') THEN RAISE EXCEPTION 'Authorization helper source drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='private.pilot_can_access_actor(uuid)'::regprocedure AND NOT proleakproof AND prolang=(SELECT oid FROM pg_language WHERE lanname='sql') AND proowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND md5(prosrc)='06eb73e4053426e55901aa1981c62fb1') THEN RAISE EXCEPTION 'Authorization helper source drift'; END IF;
END $preflight$;
SELECT pg_temp.scale_assert_contract();
ALTER POLICY pilot_po_visibility ON public.po_line_items USING(purchase_order_id IN (SELECT p.id FROM public.purchase_orders p));
ALTER POLICY pilot_po_visibility ON public.po_audit_log USING(purchase_order_id IN (SELECT p.id FROM public.purchase_orders p));
ALTER POLICY pilot_po_visibility ON public.surat_jalan USING(purchase_order_id IN (SELECT p.id FROM public.purchase_orders p));
ALTER POLICY pilot_parent_visibility ON public.sj_line_items USING(surat_jalan_id IN (SELECT s.id FROM public.surat_jalan s));
ALTER POLICY pilot_active_profile ON public.purchase_orders USING((SELECT public.current_user_role()) IS NOT NULL) WITH CHECK((SELECT public.current_user_role()) IS NOT NULL);
ALTER POLICY pilot_active_profile ON public.po_line_items USING((SELECT public.current_user_role()) IS NOT NULL) WITH CHECK((SELECT public.current_user_role()) IS NOT NULL);
ALTER POLICY pilot_active_profile ON public.po_audit_log USING((SELECT public.current_user_role()) IS NOT NULL) WITH CHECK((SELECT public.current_user_role()) IS NOT NULL);
ALTER POLICY pilot_active_profile ON public.surat_jalan USING((SELECT public.current_user_role()) IS NOT NULL) WITH CHECK((SELECT public.current_user_role()) IS NOT NULL);
ALTER POLICY pilot_active_profile ON public.sj_line_items USING((SELECT public.current_user_role()) IS NOT NULL) WITH CHECK((SELECT public.current_user_role()) IS NOT NULL);
CREATE OR REPLACE FUNCTION public.pilot_athel_summary_v1(p_from date,p_to date,p_rolling_from date,p_status text,p_fulfillment text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM private.pilot_report_dates_v1(p_from,p_to,p_rolling_from,p_status,p_fulfillment);

 EXECUTE $summary_query$
WITH pos AS MATERIALIZED (SELECT p.id,p.customer_id,p.status,p.order_date,p.total_value FROM public.purchase_orders p WHERE p.order_date BETWEEN least($1,$3) AND $2 AND ($4='all' OR p.status::text=$4)),
 lines AS MATERIALIZED (SELECT l.id,l.purchase_order_id,l.product_name,l.sku,l.quantity,l.unit_price FROM public.po_line_items l JOIN pos p ON p.id=l.purchase_order_id),
 headers AS MATERIALIZED (SELECT s.id,s.purchase_order_id,s.sj_date FROM public.surat_jalan s JOIN pos p ON p.id=s.purchase_order_id WHERE s.voided_at IS NULL),
 delivery_lines AS MATERIALIZED (SELECT s.id AS sj_id,s.purchase_order_id,s.sj_date,l.id AS line_id,d.quantity_delivered,d.quantity_delivered::numeric*l.unit_price AS value FROM headers s JOIN public.sj_line_items d ON d.surat_jalan_id=s.id JOIN lines l ON l.id=d.po_line_item_id),
 delivered_line AS (SELECT line_id,sum(quantity_delivered) AS quantity FROM delivery_lines GROUP BY line_id),
 delivered_po AS (SELECT purchase_order_id,sum(value) AS value FROM delivery_lines GROUP BY purchase_order_id),
 remaining AS MATERIALIZED (SELECT l.*,greatest(0,l.quantity-coalesce(d.quantity,0)) AS remaining_quantity,greatest(0,l.quantity-coalesce(d.quantity,0))*l.unit_price AS remaining_value FROM lines l LEFT JOIN delivered_line d ON d.line_id=l.id),
 remaining_po AS (SELECT purchase_order_id,sum(remaining_quantity) AS quantity,sum(remaining_value) AS value FROM remaining GROUP BY purchase_order_id),
 po_values AS MATERIALIZED (SELECT p.*,coalesce(d.value,0) AS delivered_value,coalesce(r.quantity,0) AS outstanding_quantity,coalesce(r.value,0) AS outstanding_value FROM pos p LEFT JOIN delivered_po d ON d.purchase_order_id=p.id LEFT JOIN remaining_po r ON r.purchase_order_id=p.id),
 filtered AS MATERIALIZED (SELECT * FROM po_values WHERE order_date BETWEEN $1 AND $2 AND
  ($5='all' OR ($5='undelivered' AND delivered_value=0) OR ($5='complete' AND outstanding_quantity=0 AND total_value>0) OR ($5='partial' AND delivered_value>0 AND outstanding_quantity>0))),
 customers AS (SELECT f.customer_id,coalesce(c.name,'Tanpa Pelanggan') AS name,sum(f.total_value) AS po_value,sum(f.delivered_value) AS delivered_value FROM filtered f LEFT JOIN public.customers c ON c.id=f.customer_id GROUP BY f.customer_id,c.name),
 ranked_customers AS MATERIALIZED (SELECT *,row_number() OVER(ORDER BY po_value DESC,customer_id) AS rank FROM customers),
 shares AS (SELECT rank,name AS label,po_value AS value FROM ranked_customers WHERE rank<=5 UNION ALL SELECT 6,'Lainnya',sum(po_value) FROM ranked_customers WHERE rank>5 HAVING count(*)>0),
 status_counts AS (SELECT status,count(*) AS count FROM filtered GROUP BY status),
 po_months AS (SELECT to_char(order_date,'YYYY-MM') AS month,sum(total_value) AS value FROM filtered WHERE order_date BETWEEN $3 AND $2 GROUP BY 1),
 delivered_months AS (SELECT to_char(sj_date,'YYYY-MM') AS month,sum(value) AS value FROM delivery_lines WHERE sj_date BETWEEN $3 AND $2 GROUP BY 1),
 months AS (SELECT to_char(date_trunc('month',$3::timestamp)+i*interval '1 month','YYYY-MM') AS key FROM generate_series(0,11) i),
 item_groups AS (SELECT coalesce(sku,product_name) AS key,sum(remaining_quantity) AS quantity,sum(remaining_value) AS value FROM remaining WHERE remaining_quantity>0 GROUP BY coalesce(sku,product_name) HAVING sum(remaining_value)>0),
 item_labels AS (SELECT DISTINCT ON(coalesce(sku,product_name)) coalesce(sku,product_name) AS key,coalesce(sku,'—') AS sku,product_name FROM remaining WHERE remaining_quantity>0 ORDER BY coalesce(sku,product_name),id),
 ranked_items AS (SELECT l.sku,l.product_name,g.quantity,g.value,row_number() OVER(ORDER BY g.value DESC,g.key) AS rank FROM item_groups g JOIN item_labels l ON l.key=g.key)
 SELECT jsonb_build_object('version',1,'as_of',statement_timestamp(),
  'metrics',(SELECT jsonb_build_object('totalPOCount',count(*),'totalPOValue',coalesce(sum(total_value),0)::text,'deliveredValue',coalesce(sum(delivered_value),0)::text,
   'outstandingValue',coalesce(sum(outstanding_value),0)::text,'averagePOValue',coalesce(avg(total_value),0)::text,'completedPOCount',count(*) FILTER(WHERE status='complete')) FROM filtered),
  'customerShare',CASE WHEN (SELECT coalesce(sum(po_value),0) FROM ranked_customers)>0 THEN coalesce((SELECT jsonb_agg(jsonb_build_object('label',label,'value',value::text) ORDER BY rank) FROM shares),'[]'::jsonb) ELSE '[]'::jsonb END,
  'monthlySeries',(SELECT jsonb_agg(jsonb_build_object('key',m.key,'poValue',coalesce(p.value,0)::text,'deliveredValue',coalesce(d.value,0)::text) ORDER BY m.key) FROM months m LEFT JOIN po_months p ON p.month=m.key LEFT JOIN delivered_months d ON d.month=m.key),
  'statusBreakdown',coalesce((SELECT jsonb_agg(jsonb_build_object('status',status,'value',count) ORDER BY status::text) FROM status_counts),'[]'::jsonb),
  'topCustomers',coalesce((SELECT jsonb_agg(jsonb_build_object('rank',rank,'name',name,'poValue',po_value::text,'deliveredValue',delivered_value::text,'fulfillmentRate',CASE WHEN po_value>0 THEN 100*delivered_value/po_value ELSE 0 END) ORDER BY rank) FROM ranked_customers WHERE rank<=10),'[]'::jsonb),
  'outstandingItems',coalesce((SELECT jsonb_agg(jsonb_build_object('rank',rank,'sku',sku,'productName',product_name,'outstandingQty',quantity,'outstandingValue',value::text) ORDER BY rank) FROM ranked_items WHERE rank<=10),'[]'::jsonb));
$summary_query$ INTO result USING p_from,p_to,p_rolling_from,p_status,p_fulfillment;
 RETURN result;
END $$;
SELECT pg_temp.scale_assert_unchanged();
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM scale_summary_before b LEFT JOIN pg_proc p ON p.oid=b.oid WHERE ROW(b.proowner,b.prolang,b.proleakproof,b.proisstrict,b.proparallel,b.proacl,b.provolatile,b.prosecdef,b.proconfig,b.prorettype,b.proargtypes,b.proargnames) IS DISTINCT FROM ROW(p.proowner,p.prolang,p.proleakproof,p.proisstrict,p.proparallel,p.proacl,p.provolatile,p.prosecdef,p.proconfig,p.prorettype,p.proargtypes,p.proargnames)) THEN RAISE EXCEPTION 'Summary security/signature attributes changed'; END IF;
END $$;
DROP FUNCTION pg_temp.scale_assert_contract();
DROP FUNCTION pg_temp.scale_assert_unchanged();
DROP FUNCTION pg_temp.scale_assert_policies();
DROP FUNCTION pg_temp.scale_assert_metadata();
COMMIT;
