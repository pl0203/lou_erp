-- Run after the four original pilot migrations, BEFORE the demo visit migration.
-- Actual old RPC creates the legacy receipt; no invented receipt or rewritten history.
BEGIN;
-- Retain a test-only copy of the old body to simulate a delayed pre-cutover invocation.
DO $$ BEGIN EXECUTE replace(pg_get_functiondef('public.pilot_finalize_visit(uuid,text,jsonb)'::regprocedure),'FUNCTION public.pilot_finalize_visit','FUNCTION private.pilot_test_legacy_finalize'); END $$;
GRANT EXECUTE ON FUNCTION private.pilot_test_legacy_finalize(uuid,text,jsonb) TO authenticated;
INSERT INTO auth.users(id) VALUES('a3300000-0000-0000-0000-000000000001');
INSERT INTO public.users(id,full_name,email,role) VALUES('a3300000-0000-0000-0000-000000000001','Visit recovery executive','visit-recovery@tests.invalid','executive');
INSERT INTO public.customers(id,name) VALUES('c3300000-0000-0000-0000-000000000001','Visit recovery store');
INSERT INTO public.sales_schedules(id,outlet_id,sales_person_id,assigned_by,scheduled_date) SELECT ('53300000-0000-0000-0000-00000000000'||n)::uuid,'c3300000-0000-0000-0000-000000000001','a3300000-0000-0000-0000-000000000001','a3300000-0000-0000-0000-000000000001',current_date+n-2 FROM generate_series(1,3)n;
INSERT INTO storage.objects(bucket_id,name,owner_id) SELECT 'visits','visits/53300000-0000-0000-0000-00000000000'||n||'/proof.webp','a3300000-0000-0000-0000-000000000001' FROM generate_series(1,3)n;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a3300000-0000-0000-0000-000000000001',true);
SELECT public.pilot_finalize_visit('e3300000-0000-0000-0000-000000000001','finalize_visit','{"schedule_id":"53300000-0000-0000-0000-000000000001","storage_path":"visits/53300000-0000-0000-0000-000000000001/proof.webp"}');
COMMIT;
