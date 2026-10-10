-- Isolated second experiment: parent-set policies are the baseline in both arms.
SELECT pg_temp.apply_parent_set_policy();
UPDATE pg_temp.expected_trial_policies SET using_expr='(purchase_order_id IN ( SELECT p.id FROM purchase_orders p))'
 WHERE table_name IN ('po_line_items','po_audit_log','surat_jalan') AND name='pilot_po_visibility';
UPDATE pg_temp.expected_trial_policies SET using_expr='(surat_jalan_id IN ( SELECT s.id FROM surat_jalan s))'
 WHERE table_name='sj_line_items' AND name='pilot_parent_visibility';
-- Protect all parent-set/permissive policies now; only five profile expressions may change.
DELETE FROM pg_temp.trial_unchanged_policies;
INSERT INTO pg_temp.trial_unchanged_policies
SELECT * FROM pg_policies WHERE schemaname IN ('public','storage') AND NOT(schemaname='public' AND tablename IN ('purchase_orders','po_line_items','po_audit_log','surat_jalan','sj_line_items') AND policyname='pilot_active_profile');
-- Replace only the temporary assertion's policy exclusion; all metadata checks stay intact.
CREATE OR REPLACE FUNCTION pg_temp.assert_trial_policies_preserved() RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF EXISTS((SELECT * FROM pg_temp.trial_unchanged_policies EXCEPT SELECT * FROM pg_policies) UNION ALL (SELECT * FROM pg_policies WHERE schemaname IN ('public','storage') AND NOT(schemaname='public' AND tablename IN ('purchase_orders','po_line_items','po_audit_log','surat_jalan','sj_line_items') AND policyname='pilot_active_profile') EXCEPT SELECT * FROM pg_temp.trial_unchanged_policies)) THEN RAISE EXCEPTION 'Untargeted scalar policy drift'; END IF;
END $$;
CREATE FUNCTION pg_temp.apply_scalar_profile_policy() RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog AS $$
BEGIN
 PERFORM pg_temp.assert_parent_set_contract();
 ALTER POLICY pilot_active_profile ON public.purchase_orders USING((SELECT public.current_user_role()) IS NOT NULL) WITH CHECK((SELECT public.current_user_role()) IS NOT NULL);
 ALTER POLICY pilot_active_profile ON public.po_line_items USING((SELECT public.current_user_role()) IS NOT NULL) WITH CHECK((SELECT public.current_user_role()) IS NOT NULL);
 ALTER POLICY pilot_active_profile ON public.po_audit_log USING((SELECT public.current_user_role()) IS NOT NULL) WITH CHECK((SELECT public.current_user_role()) IS NOT NULL);
 ALTER POLICY pilot_active_profile ON public.surat_jalan USING((SELECT public.current_user_role()) IS NOT NULL) WITH CHECK((SELECT public.current_user_role()) IS NOT NULL);
 ALTER POLICY pilot_active_profile ON public.sj_line_items USING((SELECT public.current_user_role()) IS NOT NULL) WITH CHECK((SELECT public.current_user_role()) IS NOT NULL);
 PERFORM pg_temp.assert_trial_preserved();
END $$;
SELECT pg_temp.assert_parent_set_contract();
SAVEPOINT scalar_drift_probe;
ALTER POLICY pilot_active_profile ON public.purchase_orders USING(true) WITH CHECK(true);
DO $$ BEGIN BEGIN PERFORM pg_temp.apply_scalar_profile_policy(); RAISE EXCEPTION 'Scalar drift unexpectedly accepted'; EXCEPTION WHEN check_violation THEN NULL; END; END $$;
ROLLBACK TO scalar_drift_probe;
RELEASE SAVEPOINT scalar_drift_probe;
SELECT 'SCALAR_PROFILE_DRIFT_GUARD_VERIFIED' AS result;
