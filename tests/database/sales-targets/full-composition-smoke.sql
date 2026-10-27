-- Fictional rollback-only actors on the actual repository baseline composition.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'pilot_co_test' OR current_user<>'postgres' OR inet_server_addr()<>'127.0.0.1'::inet
 OR NOT EXISTS(SELECT 1 FROM public.co_fixture_identity_v1 WHERE purpose='disposable-co-ci')
 THEN RAISE EXCEPTION 'Exact composed synthetic fixture required'; END IF;
END$$;
INSERT INTO auth.users(id) SELECT md5('target-composed-user-'||n)::uuid FROM generate_series(1,4)n;
INSERT INTO public.users(id,full_name,email,role,manager_id)
SELECT md5('target-composed-user-'||n)::uuid,'Target composed '||n,'target-composed-'||n||'@example.invalid',
 (CASE n WHEN 1 THEN 'executive' WHEN 2 THEN 'sales_head' WHEN 3 THEN 'sales_manager' ELSE 'sales_person' END)::public.user_role,
 CASE WHEN n>1 THEN md5('target-composed-user-'||(n-1))::uuid END FROM generate_series(1,4)n;
INSERT INTO public.customers(id,name) VALUES(md5('target-composed-customer')::uuid,'Target composed customer');
INSERT INTO public.customer_manager_assignments(customer_id,manager_id,assigned_by)
VALUES(md5('target-composed-customer')::uuid,md5('target-composed-user-4')::uuid,md5('target-composed-user-1')::uuid);
UPDATE private.sales_target_schema SET enabled=true;
GRANT EXECUTE ON FUNCTION public.pilot_sales_target_baseline_v1(date,uuid),public.pilot_sales_dashboard_v3(date,text,uuid,integer,integer,text,text,text),public.pilot_sales_target_command_v1(uuid,text,jsonb) TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('target-composed-user-4'),true);
SELECT public.pilot_sales_dashboard_v3('2026-10-01','own',NULL,1,20,'');
SELECT set_config('request.jwt.claim.sub',md5('target-composed-user-3'),true);
SELECT public.pilot_sales_dashboard_v3('2026-10-01','team',NULL,1,20,'');
DO $$DECLARE baseline jsonb;receipt jsonb; BEGIN
 baseline:=public.pilot_sales_target_baseline_v1('2026-11-01',md5('target-composed-user-3')::uuid);
 IF jsonb_array_length(baseline->'people')<>1 THEN RAISE EXCEPTION 'Expected one composed roster leaf'; END IF;
 receipt:=public.pilot_sales_target_command_v1(gen_random_uuid(),'save_draft',jsonb_build_object(
 'month','2026-11-01','managerId',md5('target-composed-user-3'),'expectedVersion',NULL,'rosterHash',baseline->>'rosterHash',
 'lines',(SELECT jsonb_agg(jsonb_build_object('personId',md5('target-composed-user-4'),'metric',metric,'amount',NULL,'applicability','target','reason',NULL)) FROM unnest(ARRAY['po_order_value','po_delivery_value','co_sale_value'])metric)));
 IF receipt->>'status'<>'committed' OR receipt#>>'{plan,state}'<>'draft' THEN RAISE EXCEPTION 'Expected composed draft command'; END IF;
END$$;
ROLLBACK;
SELECT 'SALES_TARGETS_FULL_SOURCE_SMOKE_PASSED';
