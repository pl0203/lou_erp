BEGIN;
DO $$DECLARE today date:=(statement_timestamp() AT TIME ZONE 'Asia/Jakarta')::date; s1 uuid:=gen_random_uuid(); s2 uuid:=gen_random_uuid(); BEGIN
 INSERT INTO public.sales_schedules(id,outlet_id,sales_person_id,scheduled_date,status) VALUES
 (s1,'20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004',today,'pending'),
 (s2,'20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004',today,'pending'),
 (gen_random_uuid(),'20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004',today+1,'pending');
 INSERT INTO public.outlet_visits(outlet_id,sales_person_id,checked_in_at,schedule_id) VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004',statement_timestamp(),s1),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004',statement_timestamp(),s1),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004',statement_timestamp(),NULL),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000005',statement_timestamp(),s2);
 INSERT INTO public.visit_requests(requester_id,customer_id,scheduled_date,status) VALUES
 ('10000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001',today,'pending'),
 ('10000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000002',today+40,'pending'),
 ('10000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000002',today,'rejected'),
 ('10000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000001',today,'pending'),
 ('10000000-0000-4000-8000-000000000008','20000000-0000-4000-8000-000000000001',today,'pending'),
 ('10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003',today,'pending');
END$$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
DO $$DECLARE b jsonb; month date:=date_trunc('month',statement_timestamp() AT TIME ZONE 'Asia/Jakarta')::date; BEGIN
 b:=public.pilot_sales_dashboard_v3(month,'own',NULL,1,20);
 PERFORM public.test_assert(b->'activity'->>'todayScheduled'='2','only today schedules');
 PERFORM public.test_assert(b->'activity'->>'todayMatchedScheduled'='1','exact schedule_id matching once and same actor/outlet');
 PERFORM public.test_assert(b->'activity'->>'todayVisited'='2','distinct visited customers including unscheduled');
 PERFORM public.test_assert(b->'activity'->>'scheduled'='2','future current-month schedules excluded from elapsed activity');
 PERFORM public.test_assert(b->'activity'->>'pendingRequests'='2','own all-date pending requests only');
 b:=public.pilot_sales_dashboard_v3(month,'own',NULL,1,20,'no matching customer');
 PERFORM public.test_assert(b->'activity'->>'pendingRequests'='2' AND b->'activity'->>'todayScheduled'='2','own priority cards independent customer search');
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
 b:=public.pilot_sales_dashboard_v3(month,'team',NULL,1,20,'Rep B');
 PERFORM public.test_assert(b->'activity'->>'pendingRequests'='3','manager queue excludes self and unrelated requesters and stays independent financial filter');
END$$;
ROLLBACK;
SELECT 'ACTIVITY_PASSED';
