BEGIN;
DO $$DECLARE gen uuid:=gen_random_uuid(); batch uuid:=gen_random_uuid(); h uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); BEGIN
 INSERT INTO private.co_customer_state VALUES('20000000-0000-4000-8000-000000000001',gen);
 INSERT INTO private.co_stock_batches VALUES(batch,'20000000-0000-4000-8000-000000000001',gen_random_uuid(),10,'10000000-0000-4000-8000-000000000004');
 INSERT INTO private.co_stock_movements(generation_id,customer_id,batch_id,effective_date,quantity_delta) VALUES(gen,'20000000-0000-4000-8000-000000000001',batch,'2020-01-01',2);
 INSERT INTO private.co_report_heads VALUES(h,'20000000-0000-4000-8000-000000000001','2026-09-01',r);
 INSERT INTO private.co_report_revisions VALUES(r,h,'20000000-0000-4000-8000-000000000001','2026-09-30',false);
END$$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
SELECT public.test_assert(public.pilot_sales_dashboard_v3('2026-09-01','own',NULL,1,20)->'summary'->'coSaleValue'='{"value":"0.00","quality":"complete"}'::jsonb,'PO-only customer does not invent CO reporting duty alongside reported CO customer');
RESET ROLE;
UPDATE private.co_report_revisions SET coverage_through_date='2026-09-15',is_partial_month=true;
INSERT INTO private.co_sale_allocations(generation_id,customer_id,report_revision_id,batch_id,quantity,amount,sales_person_id_at_creation)
 SELECT cs.effective_generation_id,cs.customer_id,h.current_revision_id,b.id,1,10,b.sales_person_id_at_creation FROM private.co_customer_state cs JOIN private.co_stock_batches b ON b.customer_id=cs.customer_id JOIN private.co_report_heads h ON h.customer_id=cs.customer_id;
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.pilot_sales_dashboard_v3('2026-09-01','own',NULL,1,20)->'summary'->'coSaleValue'='{"value":"10.00","quality":"partial"}'::jsonb,'required partial report keeps observed value without full attainment');
RESET ROLE;
DELETE FROM private.co_sale_allocations;
-- Current-owner transfer does not remove a predecessor's immutable credited exposure.
UPDATE public.customer_manager_assignments SET manager_id='10000000-0000-4000-8000-000000000008' WHERE customer_id='20000000-0000-4000-8000-000000000001';
DELETE FROM private.co_report_revisions;
DELETE FROM private.co_report_heads;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
SELECT public.test_assert(public.pilot_sales_dashboard_v3('2026-09-01','own',NULL,1,20)->'summary'->'coSaleValue'='{"value":null,"quality":"missing"}'::jsonb,'transferred old carried credited stock without report is still missing');
SELECT public.test_assert(public.pilot_sales_dashboard_v3('2026-09-01','own',NULL,1,20)->>'total'='2','carried-credit customer remains in own dashboard even no monthly allocation');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000008',true);
SELECT public.test_assert(public.pilot_sales_dashboard_v3('2026-09-01','own',NULL,1,20)->'summary'->'coSaleValue'='{"value":"0.00","quality":"complete"}'::jsonb,'new owner does not inherit predecessor actual-credit reporting duty');
RESET ROLE;
-- The settlement month still requires a report even if it ends at zero stock.
INSERT INTO private.co_stock_movements(generation_id,customer_id,batch_id,effective_date,quantity_delta)
 SELECT cs.effective_generation_id,cs.customer_id,b.id,'2026-09-20',-2 FROM private.co_customer_state cs JOIN private.co_stock_batches b ON b.customer_id=cs.customer_id;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
SELECT public.test_assert(public.pilot_sales_dashboard_v3('2026-09-01','own',NULL,1,20)->'summary'->'coSaleValue'->>'quality'='missing','zero-ending settlement month still requires report');
SELECT public.test_assert(public.pilot_sales_dashboard_v3('2026-10-01','own',NULL,1,20)->'summary'->'coSaleValue'='{"value":"0.00","quality":"complete"}'::jsonb,'subsequent settled gap has no new reporting duty');
RESET ROLE;
UPDATE private.co_customer_state SET effective_generation_id=gen_random_uuid();
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.pilot_sales_dashboard_v3('2026-09-01','own',NULL,1,20)->'summary'->'coSaleValue'='{"value":"0.00","quality":"complete"}'::jsonb,'obsolete corrected generation cannot create current reporting duty');
ROLLBACK;
SELECT 'CO_QUALITY_PASSED';
