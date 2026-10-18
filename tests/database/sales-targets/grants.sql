-- TEST-ONLY grants on disposable synthetic PostgreSQL. Not a deployment bundle.
GRANT EXECUTE ON FUNCTION public.pilot_sales_target_baseline_v1(date,uuid),public.pilot_sales_target_plan_v1(uuid),public.pilot_sales_dashboard_v3(date,text,uuid,integer,integer,text,text,text),public.pilot_sales_target_command_v1(uuid,text,jsonb),public.pilot_sales_target_reconcile_v1(uuid),public.pilot_sales_target_plans_v1(date,integer,integer),public.pilot_sales_targets_capability_v1() TO authenticated;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
SELECT public.test_assert(public.pilot_sales_targets_capability_v1()='{"schemaVersion":1,"available":false}'::jsonb,'capability disabled by default');
SELECT public.test_rejected($q$SELECT public.pilot_sales_target_baseline_v1('2026-10-01','10000000-0000-4000-8000-000000000003')$q$,'grant alone does not enable baseline');
SELECT public.test_rejected($q$SELECT public.pilot_sales_dashboard_v3('2026-10-01','team',NULL,1,20)$q$,'grant alone does not enable dashboard');
SELECT public.test_rejected($q$SELECT public.pilot_sales_target_plans_v1('2026-10-01',1,20)$q$,'grant alone does not enable inbox');
SELECT public.test_assert(public.pilot_sales_target_reconcile_v1(gen_random_uuid())->>'status'='not_found','read-only request recovery remains available when disabled');
ROLLBACK;
-- Synthetic activation ONLY, after validating that permission grants alone are not activation.
UPDATE private.sales_target_schema SET enabled=true WHERE version=1;
