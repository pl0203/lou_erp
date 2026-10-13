-- Synthetic CI contract only. Never apply this fixture reconstruction to hosted data.
BEGIN;
DO $$ DECLARE t text; n bigint; BEGIN
 IF current_database()<>'pilot_test' OR current_user<>'postgres' OR (SELECT count(*) FROM public.pilot_fixture_marker)<>1 OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') THEN RAISE EXCEPTION 'Disposable owner fixture required'; END IF;
 IF (SELECT count(*) FROM auth.users)<>0 OR (SELECT count(*) FROM storage.objects)<>0 OR (SELECT count(*) FROM private.pilot_order_requests)<>0 THEN RAISE EXCEPTION 'Empty fixture required before policy reconstruction'; END IF;
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'pilot_fixture_marker' LOOP EXECUTE format('SELECT count(*) FROM public.%I',t) INTO n; IF n<>0 THEN RAISE EXCEPTION 'Empty fixture required before policy reconstruction'; END IF; END LOOP;
 IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename IN ('purchase_orders','po_line_items','po_audit_log','surat_jalan','sj_line_items') AND policyname NOT IN ('fixture_read','fixture_write','pilot_active_profile','pilot_po_visibility','pilot_parent_visibility')) THEN RAISE EXCEPTION 'Unexpected fixture policy'; END IF;
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
SELECT 'HOSTED_READ_POLICY_FIXTURE_VERIFIED' AS result;
COMMIT;
