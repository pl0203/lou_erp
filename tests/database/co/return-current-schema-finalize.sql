-- Synthetic current-profile schema/ACL composition only, before the return candidate.
BEGIN;
SET LOCAL search_path='';
DO $guard$ BEGIN
 IF current_database()<>'pilot_co_test' OR current_user<>'postgres' OR current_setting('server_version_num')::integer/10000<>17
 OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci')
 OR NOT EXISTS(SELECT 1 FROM private.catalog_cutover_v1 WHERE singleton AND execution_generation=1 AND NOT tracking_ready)
 OR to_regclass('private.co_return_workspace_requests') IS NOT NULL THEN RAISE EXCEPTION 'Fixed synthetic current baseline required';END IF;
END $guard$;
-- Existing hosted native policy shapes; restrictive actor/customer policies are retained.
DROP POLICY fixture_read ON public.users;
DROP POLICY fixture_users_update ON public.users;
DROP POLICY fixture_users_admin ON public.users;
CREATE POLICY users_read_all ON public.users FOR SELECT TO PUBLIC USING(auth.uid() IS NOT NULL);
CREATE POLICY users_update_own ON public.users FOR UPDATE TO PUBLIC USING(auth.uid()=id);
CREATE POLICY executive_manage_users ON public.users FOR ALL TO PUBLIC USING(public.current_user_role()='executive'::public.user_role) WITH CHECK(public.current_user_role()='executive'::public.user_role);
DROP POLICY fixture_read ON public.customer_manager_assignments;
ALTER POLICY cma_head_all ON public.customer_manager_assignments TO PUBLIC;
CREATE POLICY cma_read ON public.customer_manager_assignments FOR SELECT TO PUBLIC USING(auth.uid() IS NOT NULL);
DROP POLICY fixture_read ON public.customer_sales_rep_assignments;
DROP POLICY fixture_write ON public.customer_sales_rep_assignments;
CREATE POLICY "authenticated read" ON public.customer_sales_rep_assignments FOR SELECT TO authenticated USING(true);
CREATE POLICY "managers write" ON public.customer_sales_rep_assignments FOR ALL TO authenticated USING(true) WITH CHECK(true);
CREATE POLICY csra_read ON public.customer_sales_rep_assignments FOR SELECT TO PUBLIC USING(auth.uid() IS NOT NULL);
CREATE POLICY csra_write ON public.customer_sales_rep_assignments FOR ALL TO PUBLIC USING(auth.uid() IS NOT NULL);
-- Finite pre-existing grants, not default privileges and not grants to new return endpoints.
GRANT EXECUTE ON FUNCTION private.ihr_leave_calendar_context_v1() TO service_role;
GRANT EXECUTE ON FUNCTION private.ihr_leave_context_before_admin() TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_assign_store_owner_v1(uuid,uuid,uuid,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_athel_daily_v1(date,date,date,text,text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_athel_summary_v1(date,date,date,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_customer_performance_v1(uuid,text,timestamp with time zone,timestamp with time zone,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_customer_stats_v1(uuid[],date,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_finalize_visit(uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_list_users() TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_manager_customers_v1(uuid,timestamp with time zone,timestamp with time zone,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_my_profile() TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_po_lines_v1(uuid,integer,integer,timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_po_page_v1(text,text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_promotion_image_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_promotion_transaction_v1(uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_promotions_v1(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_reconcile_promotion_v1(uuid,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_reconcile_schedule_v1(uuid,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_reconcile_visit(uuid,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_revenue_v1(timestamp with time zone,timestamp with time zone,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_sales_order_page_v1(text,boolean,integer,integer,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_sales_performance_v1(uuid,date,date,timestamp with time zone,timestamp with time zone,text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_sales_report_months_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_schedule_transaction_v1(uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_store_po_context_v1(uuid,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_team_activity_v1(uuid[],date,timestamp with time zone,timestamp with time zone,timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_team_directory() TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_sales_dashboard_v3(date,text,uuid,integer,integer,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_sales_target_baseline_v1(date,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_sales_target_command_v1(uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_sales_target_plan_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_sales_target_plans_v1(date,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_sales_target_reconcile_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_sales_targets_capability_v1() TO authenticated;
SELECT 'CO_RETURN_CURRENT_SCHEMA_COMPOSED';
COMMIT;
