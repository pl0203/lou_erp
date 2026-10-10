-- Synthetic reconstruction of the reviewed SELECT policy contract, not a live catalog export.
-- Caller already holds the guarded disposable6k transaction. No COMMIT in this fragment.
SET LOCAL search_path=public,pg_catalog;
DO $$ BEGIN
 IF current_database()<>'pilot_test' OR (SELECT count(*) FROM public.users)<>8 OR (SELECT count(*) FROM storage.objects)<>0 OR current_setting('pilot.policy_trial_mode',true) IS NULL OR current_setting('pilot.policy_trial_mode',true) NOT IN ('parity','benchmark') OR (current_setting('pilot.policy_trial_mode',true)='parity' AND (SELECT count(*) FROM public.purchase_orders)<>0) OR (current_setting('pilot.policy_trial_mode',true)='benchmark' AND (SELECT count(*) FROM public.purchase_orders)<>6007) THEN RAISE EXCEPTION 'Unexpected disposable fixture before policy trial'; END IF;
 IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename IN ('purchase_orders','po_line_items','po_audit_log','surat_jalan','sj_line_items') AND policyname NOT IN ('fixture_read','fixture_write','pilot_active_profile','pilot_po_visibility','pilot_parent_visibility')) THEN RAISE EXCEPTION 'Unexpected fixture policy before sanitized reconstruction'; END IF;
END $$;
DROP POLICY fixture_read ON public.purchase_orders;
DROP POLICY fixture_write ON public.purchase_orders;
DROP POLICY fixture_read ON public.po_line_items;
DROP POLICY fixture_write ON public.po_line_items;
DROP POLICY fixture_read ON public.po_audit_log;
DROP POLICY fixture_read ON public.surat_jalan;
DROP POLICY fixture_write ON public.surat_jalan;
DROP POLICY fixture_read ON public.sj_line_items;
DROP POLICY fixture_write ON public.sj_line_items;
CREATE POLICY po_admin_all ON public.purchase_orders FOR ALL TO public USING(current_user_role() IN ('po_admin','executive'));
CREATE POLICY po_sales_read ON public.purchase_orders FOR SELECT TO public USING(current_user_role() IN ('sales_person','sales_manager','sales_head'));
CREATE POLICY poli_admin_all ON public.po_line_items FOR ALL TO public USING(current_user_role() IN ('po_admin','executive'));
CREATE POLICY poli_others_read ON public.po_line_items FOR SELECT TO public USING(auth.uid() IS NOT NULL);
CREATE POLICY audit_read_all ON public.po_audit_log FOR SELECT TO public USING(auth.uid() IS NOT NULL);
CREATE POLICY sj_admin_all ON public.surat_jalan FOR ALL TO public USING(current_user_role() IN ('po_admin','executive'));
CREATE POLICY sj_sales_read ON public.surat_jalan FOR SELECT TO public USING(auth.uid() IS NOT NULL);
CREATE POLICY sj_line_admin_all ON public.sj_line_items FOR ALL TO public USING(current_user_role() IN ('po_admin','executive'));
CREATE POLICY sj_line_read ON public.sj_line_items FOR SELECT TO public USING(auth.uid() IS NOT NULL);
-- The minimal fixture uses NO ACTION on two FKs; reproduce reviewed CASCADE before baseline.
ALTER TABLE public.po_audit_log DROP CONSTRAINT po_audit_log_purchase_order_id_fkey,
 ADD CONSTRAINT po_audit_log_purchase_order_id_fkey FOREIGN KEY(purchase_order_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;
ALTER TABLE public.surat_jalan DROP CONSTRAINT surat_jalan_purchase_order_id_fkey,
 ADD CONSTRAINT surat_jalan_purchase_order_id_fkey FOREIGN KEY(purchase_order_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;
CREATE TEMP TABLE expected_trial_policies(table_name text,name text,permissive text,command text,roles name[],using_expr text,check_expr text);
INSERT INTO expected_trial_policies
SELECT t,'pilot_active_profile','RESTRICTIVE','ALL',ARRAY['authenticated']::name[],'(current_user_role() IS NOT NULL)','(current_user_role() IS NOT NULL)'
FROM unnest(ARRAY['purchase_orders','po_line_items','po_audit_log','surat_jalan','sj_line_items'])t;
INSERT INTO expected_trial_policies
SELECT t,'pilot_po_visibility','RESTRICTIVE','SELECT',ARRAY['authenticated']::name[],'private.pilot_can_read_po(purchase_order_id)',NULL FROM unnest(ARRAY['po_line_items','po_audit_log','surat_jalan'])t;
INSERT INTO expected_trial_policies VALUES
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
CREATE TEMP TABLE trial_unchanged_functions AS SELECT p.oid,p.prosrc,p.prosecdef,p.provolatile,p.proconfig,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private');
CREATE TEMP TABLE trial_unchanged_relations AS SELECT c.oid,c.relacl,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r';
CREATE TEMP TABLE trial_unchanged_columns AS SELECT a.attrelid,a.attnum,a.attacl FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped;
CREATE TEMP TABLE trial_unchanged_policies AS SELECT * FROM pg_policies WHERE schemaname IN ('public','storage') AND NOT (schemaname='public' AND ((tablename IN ('po_line_items','po_audit_log','surat_jalan') AND policyname='pilot_po_visibility') OR (tablename='sj_line_items' AND policyname='pilot_parent_visibility')));
CREATE FUNCTION pg_temp.assert_trial_metadata_preserved() RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF EXISTS((SELECT * FROM trial_unchanged_functions EXCEPT SELECT p.oid,p.prosrc,p.prosecdef,p.provolatile,p.proconfig,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private')) UNION ALL (SELECT p.oid,p.prosrc,p.prosecdef,p.provolatile,p.proconfig,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') EXCEPT SELECT * FROM trial_unchanged_functions)) THEN RAISE EXCEPTION 'Function or ACL drift'; END IF;
 IF EXISTS((SELECT * FROM trial_unchanged_relations EXCEPT SELECT c.oid,c.relacl,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r') UNION ALL (SELECT c.oid,c.relacl,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' EXCEPT SELECT * FROM trial_unchanged_relations)) THEN RAISE EXCEPTION 'Relation grant/RLS drift'; END IF;
 IF EXISTS((SELECT * FROM trial_unchanged_columns EXCEPT SELECT a.attrelid,a.attnum,a.attacl FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped) UNION ALL (SELECT a.attrelid,a.attnum,a.attacl FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped EXCEPT SELECT * FROM trial_unchanged_columns)) THEN RAISE EXCEPTION 'Column ACL drift'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_trial_policies_preserved() RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF EXISTS((SELECT * FROM trial_unchanged_policies EXCEPT SELECT * FROM pg_policies) UNION ALL (SELECT * FROM pg_policies WHERE schemaname IN ('public','storage') AND NOT(schemaname='public' AND ((tablename IN ('po_line_items','po_audit_log','surat_jalan') AND policyname='pilot_po_visibility') OR (tablename='sj_line_items' AND policyname='pilot_parent_visibility'))) EXCEPT SELECT * FROM trial_unchanged_policies)) THEN RAISE EXCEPTION 'Untargeted policy drift'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_trial_preserved() RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 PERFORM pg_temp.assert_trial_metadata_preserved();
 PERFORM pg_temp.assert_trial_policies_preserved();
END $$;
CREATE FUNCTION pg_temp.assert_parent_set_contract() RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog AS $$
DECLARE t text; parent_key smallint; child_key smallint;
BEGIN
 IF current_user<>'postgres' OR current_database()<>'pilot_test' OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') THEN RAISE EXCEPTION 'Disposable owner required' USING ERRCODE='23514'; END IF;
 IF (SELECT array_agg(enumlabel::text ORDER BY enumlabel) FROM pg_enum WHERE enumtypid='public.user_role'::regtype) IS DISTINCT FROM ARRAY['executive','po_admin','sales_head','sales_manager','sales_person'] THEN RAISE EXCEPTION 'Role contract drift' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('authenticated','anon') AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Role bypass drift' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('authenticated','anon'))<>2 THEN RAISE EXCEPTION 'Missing application roles' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM expected_trial_policies e FULL JOIN (SELECT * FROM pg_policies WHERE schemaname='public' AND tablename IN ('purchase_orders','po_line_items','po_audit_log','surat_jalan','sj_line_items')) a ON a.tablename=e.table_name AND a.policyname=e.name
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
 PERFORM pg_temp.assert_trial_preserved();
END $$;
CREATE FUNCTION pg_temp.apply_parent_set_policy() RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog AS $$
BEGIN
 PERFORM pg_temp.assert_parent_set_contract();
 ALTER POLICY pilot_po_visibility ON public.po_line_items USING(purchase_order_id IN (SELECT p.id FROM public.purchase_orders p));
 ALTER POLICY pilot_po_visibility ON public.po_audit_log USING(purchase_order_id IN (SELECT p.id FROM public.purchase_orders p));
 ALTER POLICY pilot_po_visibility ON public.surat_jalan USING(purchase_order_id IN (SELECT p.id FROM public.purchase_orders p));
 ALTER POLICY pilot_parent_visibility ON public.sj_line_items USING(surat_jalan_id IN (SELECT s.id FROM public.surat_jalan s));
 PERFORM pg_temp.assert_trial_preserved();
END $$;
SELECT pg_temp.assert_parent_set_contract();
SAVEPOINT drift_probe;
ALTER POLICY po_sales_read ON public.purchase_orders USING(true);
DO $$ BEGIN BEGIN PERFORM pg_temp.apply_parent_set_policy(); RAISE EXCEPTION 'Drift unexpectedly accepted'; EXCEPTION WHEN check_violation THEN NULL; END; END $$;
ROLLBACK TO drift_probe;
RELEASE SAVEPOINT drift_probe;
SELECT 'PARENT_SET_DRIFT_GUARD_VERIFIED' AS result;
