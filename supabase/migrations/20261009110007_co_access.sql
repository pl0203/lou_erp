-- Local reviewed candidate: separated Procurement audiences, no account/HR setup.
BEGIN;
SET LOCAL search_path = '';

-- All 23 rewrite inputs are exact reviewed pre07 prosrc bytes, independently
-- matched to staging's 2026-10-09 17:17 UTC read-only catalog receipt. Offsets
-- identify reviewed executable spans in those exact bodies, not token searches.
-- Any comment/formatting/body drift requires explicit review, never auto-repair.
CREATE TEMP TABLE co_access_function_metadata ON COMMIT DROP AS
 SELECT p.oid,to_jsonb(p)-'prosrc' AS metadata FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','private');
CREATE TEMP TABLE co_access_entrypoints (
 signature text PRIMARY KEY, audience text NOT NULL, body_sha256 text NOT NULL,
 entry_offset integer NOT NULL, function_oid oid, original_body text, expected_body text
) ON COMMIT DROP;
INSERT INTO co_access_entrypoints(signature,audience,body_sha256,entry_offset) VALUES
 ('public.pilot_athel_summary_v1(date,date,date,text,text)','executive','90ca2e0342b2a8a0ce75790f8457ef6c1f94eee03f2c37bee888b400d1c3775a',24),
 ('public.pilot_athel_daily_v1(date,date,date,text,text,integer,integer)','executive','ef7bcb75450af7f4a1ccea6169ab3981edc945da67668a126ec4676a9c00c1f3',64),
 ('public.pilot_promotions_v1(boolean)','sales','88f9548789efb9bc4296257469314d83b1decd9363ae8bab58c9022d3233ada9',75),
 ('public.pilot_promotion_image_v1(uuid)','sales','df9f5a426729ec8e43ba5c11d2197961933ea1947f7014fb0213fc9d026ba3c1',72),
 ('public.pilot_promotion_transaction_v1(uuid,text,jsonb)','executive','8a7b34add8532290a569823bcc4de36bca5e768431a45071de3eb8a8fb67922f',248),
 ('public.pilot_reconcile_promotion_v1(uuid,boolean)','executive','62e3e545a41be20d8ee4f514dc56c6d160880b699c99dc90d1b093006c93967e',105),
 ('public.pilot_sales_order_page_v1(text,boolean,integer,integer,uuid,uuid)','sales','d85a9cd3599781d353034d4c972b6d5eebae3eda8b3fc7ee0137dd352156187e',24),
 ('public.pilot_customer_stats_v1(uuid[],date,integer)','sales','fe298b7a4fba97b61f9f22654e29a3b714df415537e9b0ac7870fa32a27cd43c',24),
 ('public.pilot_revenue_v1(timestamptz,timestamptz,integer,integer)','sales','bf90b66fb7baf33c56c9b6762b293e28749ec4585a757fe0ebe94d3561d260f2',24),
 ('public.pilot_customer_performance_v1(uuid,text,timestamptz,timestamptz,integer,integer)','sales','16625a84818cb69c3a519425afda9e6fba8eae87c09639b639bba405c7a99ed6',59),
 ('public.pilot_sales_performance_v1(uuid,date,date,timestamptz,timestamptz,text,integer,integer)','sales','bef780675be5ba00a8993672b76d2b3fac0172de2778214f3efdd4807e4f9486',24),
 ('public.pilot_sales_report_months_v1(uuid)','sales','ed8a0124d1e70dc4098470bcf563272845ac91fa7af9a6baabfc8e57d41da53a',24),
 ('public.pilot_team_activity_v1(uuid[],date,timestamptz,timestamptz,timestamptz)','sales','34b38d1ededba706da33dc93f525c4b8f0ce2cabd96d21b0061e948826aff988',24),
 ('public.pilot_manager_customers_v1(uuid,timestamptz,timestamptz,integer,integer)','sales','24385572c34776719c617d6ba355b9d8e764a6282f258a439500010fe30b0908',24),
 ('public.pilot_store_po_context_v1(uuid,integer,integer)','sales','92306f7d5302befb1ee6118f84668fdc67864ff1241838a6196707be6713e555',141),
 ('private.pilot_admin_sales_source_v1(timestamptz,timestamptz)','sales','7ae5d0ef2a903a3392a326e00003a56b0a034f8e0b59e8db3942cc25246d7bf3',87),
 ('private.pilot_canonical_sales_source_v1(timestamptz,timestamptz)','sales','cce503aa3cba85ce16973aa8829591d36154dfef337af5dd668872d4e3b67bb7',2),
 ('private.pilot_admin_sales_start_v1(uuid)','sales','2c604ca02007edef4449b9e6f9a6715bab8ed8615b7f8908649cec02c5fc15b2',30),
 ('private.pilot_performance_scope_v1(uuid,text)','sales','487f1fa2160e86845c8d75d5a63027b21242d7e55ccbf57defe1979a990bf892',2),
 ('public.pilot_po_page_v1(text,text,integer,integer)','not_co','e46466385122daa8195682ddce6fe8deb8b6e1c0f81e95b54a044ff80add5a32',35),
 ('public.pilot_po_lines_v1(uuid,integer,integer,timestamptz)','not_co','8a9915cfca135b6c5344c5679278efd023d845c7fb6f7a48cf2d4857bd8cd04b',50),
 ('public.pilot_order_transaction(uuid,text,jsonb)','order','41062aa7cee423352ca399b5b240e5c6215a62e12c4b332e0c5edcf68e3ede99',516),
 ('public.pilot_reconcile_request(uuid,boolean)','recovery','ad0fe3154a32ca463965ec19766bf39e3a11ad2a5ece59722138c2dd8eee680f',136);
DO $body_preflight$
DECLARE entry record; f oid; body text; span text;
BEGIN
 FOR entry IN SELECT * FROM pg_temp.co_access_entrypoints LOOP
  f:=to_regprocedure(entry.signature);
  IF f IS NULL OR NOT EXISTS(
   SELECT 1 FROM pg_proc p WHERE p.oid=f
   AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
   AND p.proconfig=ARRAY['search_path=""']
  ) THEN RAISE EXCEPTION 'Unexpected access entrypoint topology: %',entry.signature; END IF;
  SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid=f;
  span:=CASE WHEN entry.audience IN ('order','recovery') THEN 'role:=private.demo_order_actor();' ELSE 'BEGIN' END;
  IF encode(sha256(convert_to(body,'UTF8')),'hex')<>entry.body_sha256
   OR substring(body FROM entry.entry_offset FOR length(span))<>span
  THEN RAISE EXCEPTION 'Unreviewed access function body: %',entry.signature; END IF;
  UPDATE pg_temp.co_access_entrypoints SET function_oid=f,original_body=body WHERE signature=entry.signature;
 END LOOP;
END $body_preflight$;

-- Keep safe PO directory joins and shared Sales helpers unchanged. Only the
-- customer table receives the CO read path; assignment/target tables do not.
ALTER POLICY pilot_customer_visibility ON public.customers
 USING (public.current_user_role()='co_admin' OR private.pilot_can_access_customer(id));
CREATE POLICY co_master_customer_read_v1 ON public.customers FOR SELECT TO authenticated
 USING (public.current_user_role()='co_admin');
CREATE POLICY co_customer_no_insert_v1 ON public.customers AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (public.current_user_role()<>'co_admin');
CREATE POLICY co_customer_no_update_v1 ON public.customers AS RESTRICTIVE FOR UPDATE TO authenticated
 USING (public.current_user_role()<>'co_admin') WITH CHECK (public.current_user_role()<>'co_admin');
CREATE POLICY co_customer_no_delete_v1 ON public.customers AS RESTRICTIVE FOR DELETE TO authenticated
 USING (public.current_user_role()<>'co_admin');
CREATE POLICY co_product_no_insert_v1 ON public.products AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (public.current_user_role()<>'co_admin');
CREATE POLICY co_product_no_update_v1 ON public.products AS RESTRICTIVE FOR UPDATE TO authenticated
 USING (public.current_user_role()<>'co_admin') WITH CHECK (public.current_user_role()<>'co_admin');
CREATE POLICY co_product_no_delete_v1 ON public.products AS RESTRICTIVE FOR DELETE TO authenticated
 USING (public.current_user_role()<>'co_admin');

-- Restrictive policies also defeat permissive ALL policies and old own-record
-- relationships after an actor's role changes. Definer PO accounting is intact.
DO $policies$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['customer_manager_assignments','customer_sales_rep_assignments','customer_targets','sales_targets',
  'sales_schedules','visit_requests','outlet_visits','visit_photos','girard_orders','girard_order_items','orders','order_line_items','outlets','promotions'] LOOP
  EXECUTE format('CREATE POLICY co_procurement_no_sales_v1 ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.current_user_role() NOT IN (''co_admin'',''po_admin'')) WITH CHECK (public.current_user_role() NOT IN (''co_admin'',''po_admin''))',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['purchase_orders','po_line_items','po_audit_log','surat_jalan','sj_line_items'] LOOP
  EXECUTE format('CREATE POLICY co_no_po_v1 ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.current_user_role()<>''co_admin'') WITH CHECK (public.current_user_role()<>''co_admin'')',t);
 END LOOP;
END $policies$;

CREATE OR REPLACE FUNCTION private.pilot_can_read_po(po uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE(public.current_user_role()<>'co_admin' AND (public.current_user_role() IN ('po_admin','sales_head','executive')
 OR EXISTS (SELECT 1 FROM public.girard_orders o WHERE o.po_id=po AND private.pilot_can_access_actor(o.submitted_by))
 OR EXISTS (SELECT 1 FROM public.orders o WHERE o.purchase_order_id=po AND private.pilot_can_access_actor(o.sales_person_id))),false);
$$;
CREATE OR REPLACE FUNCTION private.pilot_store_in_manager_scope_v1(customer uuid,manager uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(auth.uid() IS NOT NULL AND public.current_user_role() IS NOT NULL
 AND public.current_user_role() NOT IN ('po_admin','co_admin')
 AND (public.current_user_role() IN('sales_head','executive') OR manager=auth.uid())
 AND EXISTS(SELECT 1 FROM public.customer_manager_assignments a JOIN public.users u ON u.id=a.manager_id
 WHERE a.customer_id=customer AND u.is_active AND (u.id=manager OR (u.role='sales_person' AND u.manager_id=manager))),false);
$$;
CREATE OR REPLACE FUNCTION private.demo_can_upload_promotion(path text,owner text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(public.current_user_role()='executive' AND owner=auth.uid()::text AND private.demo_promotion_path(path,auth.uid(),NULL),false);
$$;

-- Rebuild only a verified full body at its pinned executable span. Replacing
-- the one exact prosrc occurrence in the server-rendered DDL keeps signatures,
-- owners, ACLs, security modes and other metadata intact; postflight checks both.
DO $guards$
DECLARE entry record; definition text; guard text; body text; span text;
BEGIN
 FOR entry IN SELECT * FROM pg_temp.co_access_entrypoints WHERE audience NOT IN ('order','recovery') LOOP
  guard:=CASE entry.audience
   WHEN 'executive' THEN 'public.current_user_role() IS DISTINCT FROM ''executive''::public.user_role'
   WHEN 'sales' THEN 'public.current_user_role() IS NULL OR public.current_user_role() NOT IN (''sales_person'',''sales_manager'',''sales_head'',''executive'')'
   ELSE 'public.current_user_role() IS NULL OR public.current_user_role()=''co_admin'''
  END;
  span:=E'BEGIN\n -- co_access_boundary_v1: checked before any data read/replay.\n IF '
   ||guard||' THEN RAISE EXCEPTION ''Module access denied'' USING ERRCODE=''42501''; END IF;';
  body:=overlay(entry.original_body PLACING span FROM entry.entry_offset FOR 5);
  definition:=pg_get_functiondef(entry.function_oid);
  IF (SELECT prosrc FROM pg_proc WHERE oid=entry.function_oid) IS DISTINCT FROM entry.original_body
   OR (length(definition)-length(replace(definition,entry.original_body,'')))/length(entry.original_body)<>1
  THEN RAISE EXCEPTION 'Access function changed during rewrite: %',entry.signature; END IF;
  EXECUTE replace(definition,entry.original_body,body);
  UPDATE pg_temp.co_access_entrypoints SET expected_body=body WHERE signature=entry.signature;
 END LOOP;
END $guards$;

DO $order_authority$
DECLARE entry record; definition text; body text; span text; actor_span constant text:='role:=private.demo_order_actor();';
BEGIN
 FOR entry IN SELECT * FROM pg_temp.co_access_entrypoints WHERE audience IN ('order','recovery') LOOP
  body:=entry.original_body;
  span:=actor_span||E'\n IF role=''co_admin'' THEN RAISE EXCEPTION ''PO access denied'' USING ERRCODE=''42501''; END IF;';
  IF entry.audience='order' THEN
   span:=span||E'\n IF p_operation IN (''approve_sales'',''reject_sales'') AND role<>''executive'' THEN RAISE EXCEPTION ''Executive legacy review required'' USING ERRCODE=''42501''; END IF;';
  ELSE
   -- The later recovery span is also pinned in the same hash-verified body.
   -- Apply it first, so the earlier actor span keeps its original offset.
   IF substring(body FROM 503 FOR 13)<>'IF FOUND THEN' THEN RAISE EXCEPTION 'Unexpected recovery executable span'; END IF;
   body:=overlay(body PLACING E'IF FOUND THEN\n  IF prior.operation IN (''approve_sales'',''reject_sales'') AND role<>''executive'' THEN RAISE EXCEPTION ''Executive legacy recovery required'' USING ERRCODE=''42501''; END IF;' FROM 503 FOR 13);
  END IF;
  body:=overlay(body PLACING span FROM entry.entry_offset FOR length(actor_span));
  definition:=pg_get_functiondef(entry.function_oid);
  IF (SELECT prosrc FROM pg_proc WHERE oid=entry.function_oid) IS DISTINCT FROM entry.original_body
   OR (length(definition)-length(replace(definition,entry.original_body,'')))/length(entry.original_body)<>1
  THEN RAISE EXCEPTION 'Access function changed during rewrite: %',entry.signature; END IF;
  EXECUTE replace(definition,entry.original_body,body);
  UPDATE pg_temp.co_access_entrypoints SET expected_body=body WHERE signature=entry.signature;
 END LOOP;
END $order_authority$;

CREATE FUNCTION public.pilot_procurement_access_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.user_role:=public.current_user_role(); writable boolean;
BEGIN
 IF auth.uid() IS NULL OR r IS NULL OR r NOT IN ('po_admin','co_admin','executive') THEN RAISE EXCEPTION 'Procurement access denied' USING ERRCODE='42501'; END IF;
 -- These operations match the existing Procurement master policies and grants,
 -- exercised as authenticated by the access suite. A removed grant stays false.
 writable:=r IN ('po_admin','executive');
 RETURN jsonb_build_object('version',1,'as_of',statement_timestamp(),'actor_id',auth.uid(),'role',r,
  'customer_create',writable AND has_table_privilege(current_user,'public.customers','INSERT'),
  'customer_edit',writable AND has_table_privilege(current_user,'public.customers','UPDATE'),
  'customer_delete',false,
  'product_create',writable AND has_table_privilege(current_user,'public.products','INSERT'),
  'product_edit',writable AND has_table_privilege(current_user,'public.products','UPDATE'),
  'product_delete',writable AND has_table_privilege(current_user,'public.products','DELETE'));
END $$;
REVOKE ALL ON FUNCTION public.pilot_procurement_access_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_procurement_access_v1() TO authenticated;
DO $postflight$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_temp.co_access_entrypoints e LEFT JOIN pg_proc p ON p.oid=e.function_oid WHERE p.prosrc IS DISTINCT FROM e.expected_body) THEN RAISE EXCEPTION 'Unexpected rewritten access body'; END IF;
 IF EXISTS(SELECT 1 FROM co_access_function_metadata m LEFT JOIN pg_proc p ON p.oid=m.oid WHERE (to_jsonb(p)-'prosrc') IS DISTINCT FROM m.metadata) THEN RAISE EXCEPTION 'Unexpected existing function metadata/ACL change'; END IF;
 IF has_table_privilege('authenticated','public.customers','DELETE') THEN RAISE EXCEPTION 'Customer deletion baseline must remain denied'; END IF;
 IF has_function_privilege('anon','public.pilot_procurement_access_v1()','EXECUTE') THEN RAISE EXCEPTION 'Anonymous capability exposure'; END IF;
END $postflight$;
COMMIT;
