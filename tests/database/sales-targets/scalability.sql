BEGIN;
SET LOCAL statement_timeout='15s';
-- 30 representatives and 42 customers, entirely synthetic; totals never page totals.
INSERT INTO public.users(id,full_name,role,is_active,manager_id)
 SELECT ('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Scale rep '||lpad(n::text,2,'0'),'sales_person',true,'10000000-0000-4000-8000-000000000003' FROM generate_series(1,30)n;
INSERT INTO public.customers(id,name,created_at) SELECT ('60000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Scale customer '||lpad(n::text,2,'0'),'2020-01-01' FROM generate_series(1,42)n;
INSERT INTO public.customer_manager_assignments(customer_id,manager_id)
 SELECT ('60000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'50000000-0000-4000-8000-000000000001'::uuid FROM generate_series(1,42)n;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
DO $$DECLARE p1 jsonb; p2 jsonb; b jsonb; BEGIN
 p1:=public.pilot_sales_dashboard_v3('2026-10-01','team',NULL,1,20);p2:=public.pilot_sales_dashboard_v3('2026-10-01','team',NULL,2,20);
 PERFORM public.test_assert(p1->>'total'='33' AND p2->>'total'='33','30 added representatives plus original3');
 PERFORM public.test_assert(jsonb_array_length(p1->'items')=20 AND jsonb_array_length(p2->'items')=13,'team pagination across many reps');
 PERFORM public.test_assert(p1->'summary'=p2->'summary' AND p1->'activity'=p2->'activity','whole-filter measures stable across pages');
 b:=public.pilot_sales_target_baseline_v1('2026-10-01','10000000-0000-4000-8000-000000000003');
 PERFORM public.test_assert(jsonb_array_length(b->'people')=33,'complete planning roster');
 PERFORM public.test_assert((SELECT jsonb_array_length(p->'customers') FROM jsonb_array_elements(b->'people')p WHERE p->>'personId'='50000000-0000-4000-8000-000000000001')=42,'42 customer portfolio not truncated');
END$$;
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT public.pilot_sales_target_baseline_v1('2026-10-01','10000000-0000-4000-8000-000000000003');
SELECT set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000001',true);
SELECT public.test_assert(public.pilot_sales_dashboard_v3('2026-10-01','own',NULL,3,20)->>'total'='42' AND jsonb_array_length(public.pilot_sales_dashboard_v3('2026-10-01','own',NULL,3,20)->'items')=2,'42 customer third page');
SELECT set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000002',true);
SELECT public.test_assert(public.pilot_sales_dashboard_v3('2026-10-01','own',NULL,1,20)->>'total'='0','zero customer rep');
RESET ROLE;
UPDATE public.customer_manager_assignments SET manager_id='50000000-0000-4000-8000-000000000002' WHERE customer_id IN(SELECT id FROM public.customers WHERE name LIKE 'Scale customer%' ORDER BY name LIMIT 5);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000002',true);
SELECT public.test_assert(public.pilot_sales_dashboard_v3('2026-10-01','own',NULL,1,20)->>'total'='5','five customer rep');
RESET ROLE;
UPDATE public.users SET is_active=false WHERE id='10000000-0000-4000-8000-000000000008';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000007',true);
SELECT public.test_assert(public.pilot_sales_dashboard_v3('2026-10-01','team',NULL,1,20)->>'total'='0','zero-person manager team');
ROLLBACK;
SELECT 'SCALABILITY_PASSED';
