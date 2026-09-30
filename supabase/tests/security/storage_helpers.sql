-- Synthetic helper checks only. Does not validate hosted Storage HTTP/signed URLs or RLS.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
DO $$ BEGIN IF to_regprocedure('private.pilot_can_upload_visit_object(text)') IS NULL THEN RAISE EXCEPTION 'FAIL: scoped Storage helper missing'; END IF; END $$;
INSERT INTO auth.users(id) SELECT ('12000000-0000-0000-0000-00000000000'||n)::uuid FROM generate_series(1,6) n;
INSERT INTO public.users(id,full_name,email,role,manager_id,is_active) VALUES
('12000000-0000-0000-0000-000000000001','Own rep','rep@storage.invalid','sales_person','12000000-0000-0000-0000-000000000002',true),
('12000000-0000-0000-0000-000000000002','Own manager','mgr@storage.invalid','sales_manager',NULL,true),
('12000000-0000-0000-0000-000000000003','Other rep','other@storage.invalid','sales_person',NULL,true),
('12000000-0000-0000-0000-000000000004','Head','head@storage.invalid','sales_head',NULL,true),
('12000000-0000-0000-0000-000000000005','Inactive','inactive@storage.invalid','executive',NULL,false),
('12000000-0000-0000-0000-000000000006','PO admin','po@storage.invalid','po_admin',NULL,true);
INSERT INTO public.customers(id,name) VALUES ('22000000-0000-0000-0000-000000000001','Storage customer');
INSERT INTO public.sales_schedules(id,outlet_id,sales_person_id,assigned_by,scheduled_date) VALUES
('42000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','12000000-0000-0000-0000-000000000001','12000000-0000-0000-0000-000000000004',current_date);
-- Minimal local storage fixture provides bucket_id/name/owner_id. Real staging uses Storage API.
INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES ('visits','visits/42000000-0000-0000-0000-000000000001/photo.webp','12000000-0000-0000-0000-000000000001');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','12000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(private.pilot_can_upload_visit_object('visits/42000000-0000-0000-0000-000000000001/photo.webp'),'upload permitted before visit/photo metadata exists');
SELECT pg_temp.assert_true(NOT private.pilot_can_read_visit_object('visits/42000000-0000-0000-0000-000000000001/photo.webp','12000000-0000-0000-0000-000000000001'),'unlinked upload is unreadable');
SELECT pg_temp.assert_true(NOT private.pilot_can_upload_visit_object('visits/not-a-uuid/photo.webp'),'malformed schedule denied without cast exception');
SELECT pg_temp.assert_true(NOT private.pilot_can_upload_visit_object('visits/42000000-0000-0000-0000-000000000001/../photo.webp'),'extra path segments denied');
SELECT pg_temp.assert_true(private.pilot_photo_object_owned('visits/42000000-0000-0000-0000-000000000001/photo.webp'),'owned object can be linked');
SELECT pg_temp.assert_true(NOT private.pilot_photo_object_owned('visits/42000000-0000-0000-0000-000000000001/missing.webp'),'missing object cannot be linked');
INSERT INTO public.outlet_visits(id,outlet_id,sales_person_id,schedule_id) VALUES ('62000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001',auth.uid(),'42000000-0000-0000-0000-000000000001');
INSERT INTO public.visit_photos(visit_id,storage_path) VALUES ('62000000-0000-0000-0000-000000000001','visits/42000000-0000-0000-0000-000000000001/photo.webp');
SELECT pg_temp.assert_true(private.pilot_can_read_visit_object('visits/42000000-0000-0000-0000-000000000001/photo.webp','12000000-0000-0000-0000-000000000001'),'own linked photo readable');
SELECT pg_temp.assert_true(NOT private.pilot_can_read_visit_object('visits/42000000-0000-0000-0000-000000000001/photo.webp',NULL),'ownerless legacy file fails closed');
SELECT set_config('request.jwt.claim.sub','12000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true(NOT private.pilot_can_upload_visit_object('visits/42000000-0000-0000-0000-000000000001/photo.webp'),'other rep cannot upload into foreign schedule');
SELECT pg_temp.assert_true(NOT private.pilot_can_read_visit_object('visits/42000000-0000-0000-0000-000000000001/photo.webp','12000000-0000-0000-0000-000000000001'),'other rep cannot read linked photo');
SELECT pg_temp.assert_true(NOT private.pilot_photo_object_owned('visits/42000000-0000-0000-0000-000000000001/photo.webp'),'foreign object cannot be linked');
SELECT set_config('request.jwt.claim.sub','12000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert_true(private.pilot_can_read_visit_object('visits/42000000-0000-0000-0000-000000000001/photo.webp','12000000-0000-0000-0000-000000000001'),'manager reads own team photo');
SELECT pg_temp.assert_true(NOT private.pilot_can_upload_visit_object('visits/42000000-0000-0000-0000-000000000001/photo.webp'),'manager cannot upload as team member');
SELECT set_config('request.jwt.claim.sub','12000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true(private.pilot_can_read_visit_object('visits/42000000-0000-0000-0000-000000000001/photo.webp','12000000-0000-0000-0000-000000000001'),'head reads linked photo');
SELECT set_config('request.jwt.claim.sub','12000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_true(NOT private.pilot_can_read_visit_object('visits/42000000-0000-0000-0000-000000000001/photo.webp','12000000-0000-0000-0000-000000000001'),'inactive executive denied linked photo');
SELECT set_config('request.jwt.claim.sub','12000000-0000-0000-0000-000000000006',true);
SELECT pg_temp.assert_true(NOT private.pilot_can_read_visit_object('visits/42000000-0000-0000-0000-000000000001/photo.webp','12000000-0000-0000-0000-000000000001'),'PO admin does not gain visit-photo scope');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','12000000-0000-0000-0000-000000000004',true);
UPDATE public.sales_schedules SET sales_person_id='12000000-0000-0000-0000-000000000003' WHERE id='42000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','12000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(NOT private.pilot_can_upload_visit_object('visits/42000000-0000-0000-0000-000000000001/new.webp'),'reassigned schedule removes former actor upload authority');
SELECT pg_temp.assert_true(private.pilot_can_read_visit_object('visits/42000000-0000-0000-0000-000000000001/photo.webp','12000000-0000-0000-0000-000000000001'),'historical actor keeps own linked evidence after reassignment');
SELECT set_config('request.jwt.claim.sub','12000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true(private.pilot_can_upload_visit_object('visits/42000000-0000-0000-0000-000000000001/new.webp'),'new schedule actor can upload own evidence');
SELECT pg_temp.assert_true(NOT private.pilot_can_read_visit_object('visits/42000000-0000-0000-0000-000000000001/photo.webp','12000000-0000-0000-0000-000000000001'),'new schedule actor cannot read old actor evidence');
RESET ROLE;
ROLLBACK;
