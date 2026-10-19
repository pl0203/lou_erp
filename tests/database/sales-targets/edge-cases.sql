BEGIN;
INSERT INTO private.sales_target_history_coverage VALUES('po_order_value','2020-01-01','2027-01-01','Synthetic complete source','10000000-0000-4000-8000-000000000001',now()),('po_delivery_value','2020-01-01','2027-01-01','Synthetic complete source','10000000-0000-4000-8000-000000000001',now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
DO $$DECLARE payload jsonb:=public.test_payload('2026-10-01'); receipt jsonb; plan uuid; lines jsonb; baseline jsonb; BEGIN
 -- Complete unchanged PO baseline still requires explicit predecessor-credit review.
 SELECT jsonb_agg(CASE WHEN l->>'personId'='10000000-0000-4000-8000-000000000004' AND l->>'metric'='po_order_value' THEN l||'{"amount":"120.00","reason":null}' ELSE l END) INTO lines FROM jsonb_array_elements(payload->'lines')l;
 PERFORM public.test_rejected(format('SELECT public.pilot_sales_target_command_v1(gen_random_uuid(),''submit'',%L::jsonb)',payload||jsonb_build_object('lines',lines)),'complete unchanged transferred baseline requires reason');
 -- Explicit zero and N/A are both valid, but never interchangeable.
 SELECT jsonb_agg(CASE WHEN l->>'personId'='10000000-0000-4000-8000-000000000005' THEN l||'{"amount":null,"applicability":"not_applicable","reason":"Synthetic N/A review"}' WHEN l->>'personId'='10000000-0000-4000-8000-000000000003' THEN l||'{"amount":"0.00"}' ELSE l END) INTO lines FROM jsonb_array_elements(payload->'lines')l;
 receipt:=public.pilot_sales_target_command_v1(gen_random_uuid(),'submit',payload||jsonb_build_object('lines',lines));plan:=(receipt->'plan'->>'id')::uuid;
 PERFORM public.test_assert(public.pilot_sales_target_plans_v1('2026-10-01',1,20)->>'total'='1','manager discovers submitted plan');
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
 PERFORM public.test_assert(public.pilot_sales_target_plans_v1('2026-10-01',1,20)->>'total'='0','rep cannot discover drafts');
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000006',true);
 PERFORM public.test_assert(public.pilot_sales_target_plans_v1('2026-10-01',1,20)->>'total'='0','unrelated Head cannot discover plan');
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
 receipt:=public.pilot_sales_target_command_v1(gen_random_uuid(),'return',jsonb_build_object('planId',plan,'expectedVersion',1,'reason','Please explain inherited stock adjustment'));
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
 PERFORM public.test_assert(public.pilot_sales_target_plan_v1(plan)->>'returnReason'='Please explain inherited stock adjustment','return feedback reload');
 receipt:=public.pilot_sales_target_command_v1(gen_random_uuid(),'submit',payload||jsonb_build_object('planId',plan,'expectedVersion',2,'lines',lines));
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
 receipt:=public.pilot_sales_target_command_v1(gen_random_uuid(),'approve_publish',jsonb_build_object('planId',plan,'expectedVersion',3));
 PERFORM public.test_assert(public.pilot_sales_dashboard_v3('2026-10-01','team','10000000-0000-4000-8000-000000000003',1,20)->'targets'->'po_order_value'='{"metric":"po_order_value","month":"2026-10-01","state":"partial","amount":null}'::jsonb,'mixed target and N/A cannot compare all-person actual');
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
 PERFORM public.test_assert(public.pilot_sales_target_plans_v1('2026-10-01',1,20)->>'total'='1','rep discovers own published plan');
 PERFORM public.test_assert(public.pilot_sales_dashboard_v3('2026-10-01','own',NULL,1,20,'Transferred')->'targets'->'po_order_value'->>'amount' IS NULL,'filtered customer actual has no full-person denominator');
 PERFORM public.test_assert(public.pilot_sales_dashboard_v3('2026-10-01','own',NULL,1,20,'Transferred')->'warnings'?'FILTERED_CUSTOMERS_NO_COMPARABLE_PERSON_TARGET','filtered target gap explained');
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
 PERFORM public.test_assert(public.pilot_sales_dashboard_v3('2026-10-01','own',NULL,1,20)->'targets'->'po_order_value'->>'amount'='0.00','explicit zero target remains zero');
END$$;
RESET ROLE;
-- A published monthly leaf stays with the frozen team, not current fallback team.
UPDATE public.users SET manager_id='10000000-0000-4000-8000-000000000007' WHERE id='10000000-0000-4000-8000-000000000004';
INSERT INTO public.sales_schedules(outlet_id,sales_person_id,scheduled_date,status) VALUES('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004',(statement_timestamp() AT TIME ZONE 'Asia/Jakarta')::date,'pending');
INSERT INTO public.visit_requests(requester_id,customer_id,scheduled_date,status) VALUES('10000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001',(statement_timestamp() AT TIME ZONE 'Asia/Jakarta')::date,'pending');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000007',true);
SELECT public.test_assert(public.pilot_sales_dashboard_v3('2026-10-01','team',NULL,1,20)->>'total'='1','published leaf excluded from new manager fallback');
SELECT public.test_assert(public.pilot_sales_dashboard_v3('2026-10-01','team',NULL,1,20)->'activity'->>'todayScheduled'='1' AND public.pilot_sales_dashboard_v3('2026-10-01','team',NULL,1,20)->'activity'->>'pendingRequests'='1','new manager sees current daily and queue despite frozen financial exclusion');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
SELECT public.test_assert(public.pilot_sales_dashboard_v3('2026-10-01','team',NULL,1,20)->'activity'->>'todayScheduled'='0' AND public.pilot_sales_dashboard_v3('2026-10-01','team',NULL,1,20)->'activity'->>'pendingRequests'='0','old manager frozen financial scope cannot reveal transferred current activity');

SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT public.test_assert((SELECT item->>'managerId' FROM jsonb_array_elements(public.pilot_sales_dashboard_v3('2026-10-01','leadership',NULL,1,20)->'items')item WHERE item->>'id'='10000000-0000-4000-8000-000000000004')='10000000-0000-4000-8000-000000000003','frozen original publication manager owns monthly leaf');
RESET ROLE;
UPDATE public.users SET manager_id='10000000-0000-4000-8000-000000000003' WHERE id='10000000-0000-4000-8000-000000000004';
-- Changed roster: an added rep receives 3 explicit missing draft inputs, not omission.
INSERT INTO public.users VALUES('10000000-0000-4000-8000-000000000011','New rep','sales_person',true,'10000000-0000-4000-8000-000000000003');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
DO $$DECLARE p jsonb; revision jsonb; BEGIN
 p:=public.pilot_sales_target_plans_v1('2026-10-01',1,20)->'items'->0;
 revision:=public.pilot_sales_target_command_v1(gen_random_uuid(),'propose_revision',jsonb_build_object('planId',p->>'id','expectedVersion',(p->>'version')::bigint,'reason','New rep reviewed'));
 PERFORM public.test_assert(jsonb_array_length(revision->'plan'->'lines')=12,'expanded roster has all metrics');
 PERFORM public.test_assert((SELECT count(*) FROM jsonb_array_elements(revision->'plan'->'lines')l WHERE l->>'personId'='10000000-0000-4000-8000-000000000011' AND l->'amount'='null'::jsonb AND l->>'applicability'='target')=3,'new rep amounts missing, not automatic zero');
END$$;
ROLLBACK;
BEGIN;
-- Predecessor open orders older than context must still trigger transfer review.
UPDATE public.purchase_orders SET status='complete';
INSERT INTO public.purchase_orders(customer_id,order_date,status,total_value,sales_person_id_at_creation,sales_attribution_state)
 VALUES('20000000-0000-4000-8000-000000000003','2020-01-01','in_progress',7,'10000000-0000-4000-8000-000000000008','assigned');
SELECT public.test_assert(private.sales_target_transfer_v1('20000000-0000-4000-8000-000000000003','2026-10-01'),'old open predecessor PO requires review');
UPDATE public.purchase_orders SET status='complete';
INSERT INTO private.co_customer_state VALUES('20000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001');
INSERT INTO private.co_stock_batches VALUES('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003',gen_random_uuid(),2,'10000000-0000-4000-8000-000000000008');
INSERT INTO private.co_stock_movements(generation_id,customer_id,batch_id,effective_date,quantity_delta) VALUES('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000002','2020-01-01',5);
SELECT public.test_assert(private.sales_target_transfer_v1('20000000-0000-4000-8000-000000000003','2026-10-01'),'old remaining predecessor CO stock requires review');
ROLLBACK;
BEGIN;
-- Recorded dashboard aggregates are exact; planning coverage remains separate.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000005',true);
SELECT public.test_assert(public.pilot_sales_dashboard_v3('2026-10-01','own',NULL,1,20)->'summary'->'poOrderValue'='{"value":"0.00","quality":"complete"}'::jsonb,'no recorded facts still returns exact dashboard zero; no baseline assertion');
SELECT public.test_assert(public.pilot_sales_dashboard_v3('2026-10-01','own',NULL,1,20)->>'total'='0','zero customer roster works');
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
DO $$DECLARE payload jsonb:=public.test_payload('2027-12-01'); lines jsonb; r jsonb; BEGIN
 SELECT jsonb_agg(l||'{"amount":"999999999999999999999999.99"}'::jsonb) INTO lines FROM jsonb_array_elements(payload->'lines')l;
 r:=public.pilot_sales_target_command_v1(gen_random_uuid(),'save_draft',payload||jsonb_build_object('lines',lines));
 PERFORM public.test_assert(r->'plan'->'lines'->0->>'amount'='999999999999999999999999.99','24 digit money exact maximum');
 SELECT jsonb_agg(l||'{"amount":"1000000000000000000000000.00"}'::jsonb) INTO lines FROM jsonb_array_elements(payload->'lines')l;
 PERFORM public.test_rejected(format('SELECT public.pilot_sales_target_command_v1(gen_random_uuid(),''save_draft'',%L::jsonb)',payload||jsonb_build_object('lines',lines)),'25 digit money first invalid');
END$$;
ROLLBACK;
SELECT public.test_assert(private.sales_target_calendar_month_v1('2026-09-30 17:00:00+00')='2026-10-01','Jakarta month boundary at 17 UTC');
SELECT public.test_assert(private.sales_target_calendar_month_v1('2026-09-30 16:59:59+00')='2026-09-01','before Jakarta month boundary');
SELECT 'EDGE_CASES_PASSED';
