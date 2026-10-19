BEGIN;
INSERT INTO public.purchase_orders(customer_id,order_date,status,total_value,sales_person_id_at_creation,sales_attribution_state) VALUES
 ('20000000-0000-4000-8000-000000000001','2026-09-05','confirm',10,'10000000-0000-4000-8000-000000000004','assigned'),
 ('20000000-0000-4000-8000-000000000002','2026-09-05','confirm',30,'10000000-0000-4000-8000-000000000004','assigned');
INSERT INTO public.outlet_visits(outlet_id,sales_person_id,checked_in_at) VALUES('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','2026-09-06 03:00:00+00');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
DO $$DECLARE x jsonb;y jsonb; BEGIN
 x:=public.pilot_sales_dashboard_v3('2026-09-01','own',NULL,1,1,'','po_order_value_desc','all');
 y:=public.pilot_sales_dashboard_v3('2026-09-01','own',NULL,2,1,'','po_order_value_desc','all');
 PERFORM public.test_assert(x->'items'->0->>'id'='20000000-0000-4000-8000-000000000002','sort complete cohort numerically before page');
 PERFORM public.test_assert(x->'summary'=y->'summary' AND x->'summary'->'poOrderValue'->>'value'='40.00','sort/page never changes full-filter totals');
 PERFORM public.test_assert(x->'trend'->0->>'month'='2026-08-01' AND x->'trend'->1->>'month'='2026-09-01','two completed-month trend points');
 PERFORM public.test_assert(x->'trend'->1->'metrics'->'poOrderValue'->>'value'='40.00','trend preserves same credit/cohort');
 x:=public.pilot_sales_dashboard_v3('2026-09-01','own',NULL,1,20,'','name','unvisited');
 PERFORM public.test_assert(x->>'total'='1' AND x->'summary'->'poOrderValue'->>'value'='30.00','attention filters whole cohort and totals');
 PERFORM public.test_assert(x->'warnings'?'FILTERED_CUSTOMERS_NO_COMPARABLE_PERSON_TARGET','attention suppresses personal denominator');
 PERFORM public.test_assert(x->'trend'->1->'metrics'->'poOrderValue'->>'value'='30.00','trend uses same attention-filtered cohort');
 PERFORM public.test_rejected($q$SELECT public.pilot_sales_dashboard_v3('2026-09-01','own',NULL,1,20,'','name','target_incomplete')$q$,'unsupported own attention rejected');
 PERFORM public.test_rejected($q$SELECT public.pilot_sales_dashboard_v3('2026-09-01','own',NULL,1,20,'','arbitrary_sql','all')$q$,'sort enum validated');
END$$;
ROLLBACK;
SELECT 'FILTERS_AND_TREND_PASSED';
