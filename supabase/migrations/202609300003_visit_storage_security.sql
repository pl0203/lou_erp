-- PROPOSED: requires migrations 1/2 and hosted Storage verification before rollout.
-- Changes access policies only; never modifies stored object metadata or file bytes.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='visits' AND public=false) THEN
   RAISE EXCEPTION 'Expected private visits bucket; review bucket setup before migration';
 END IF;
END $$;
CREATE FUNCTION private.pilot_can_upload_visit_object(object_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE(public.current_user_role() IN ('sales_person','sales_manager','sales_head','executive')
 AND array_length(string_to_array(object_name,'/'),1)=3
 AND split_part(object_name,'/',1)='visits'
 AND split_part(object_name,'/',3) NOT IN ('','.','..')
 AND EXISTS(SELECT 1 FROM public.sales_schedules s WHERE s.id::text=split_part(object_name,'/',2)
   AND s.sales_person_id=auth.uid() AND private.pilot_can_access_customer(s.outlet_id)),false);
$$;
CREATE FUNCTION private.pilot_can_read_visit_object(object_name text,object_owner text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE(public.current_user_role() IN ('sales_person','sales_manager','sales_head','executive')
 AND array_length(string_to_array(object_name,'/'),1)=3
 AND split_part(object_name,'/',1)='visits'
 AND split_part(object_name,'/',3) NOT IN ('','.','..')
 AND EXISTS(SELECT 1 FROM public.visit_photos p JOIN public.outlet_visits v ON v.id=p.visit_id
   WHERE p.storage_path=object_name AND v.schedule_id::text=split_part(object_name,'/',2)
   AND object_owner=v.sales_person_id::text AND private.pilot_can_access_actor(v.sales_person_id)),false);
$$;
CREATE FUNCTION private.pilot_photo_object_owned(object_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.current_user_role() IS NOT NULL AND EXISTS(
   SELECT 1 FROM storage.objects o WHERE o.bucket_id='visits' AND o.name=object_name AND o.owner_id=auth.uid()::text);
$$;
REVOKE ALL ON FUNCTION private.pilot_can_upload_visit_object(text),private.pilot_can_read_visit_object(text,text),private.pilot_photo_object_owned(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.pilot_can_upload_visit_object(text),private.pilot_can_read_visit_object(text,text),private.pilot_photo_object_owned(text) TO authenticated;
-- Existing named policies were inspected; change their scope without creating an OR bypass.
ALTER POLICY visits_read ON storage.objects TO authenticated USING(
 bucket_id='visits' AND private.pilot_can_read_visit_object(name,owner_id));
ALTER POLICY visits_upload ON storage.objects TO authenticated WITH CHECK(
 bucket_id='visits' AND owner_id=auth.uid()::text AND private.pilot_can_upload_visit_object(name));
-- Protect visits if a future generic permissive policy is added for another bucket.
CREATE POLICY pilot_visit_storage_read ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING(
 bucket_id IS DISTINCT FROM 'visits' OR private.pilot_can_read_visit_object(name,owner_id));
CREATE POLICY pilot_visit_storage_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(
 bucket_id IS DISTINCT FROM 'visits' OR (owner_id=auth.uid()::text AND private.pilot_can_upload_visit_object(name)));
CREATE POLICY pilot_visit_storage_no_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated USING(bucket_id IS DISTINCT FROM 'visits') WITH CHECK(bucket_id IS DISTINCT FROM 'visits');
CREATE POLICY pilot_visit_storage_no_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated USING(bucket_id IS DISTINCT FROM 'visits');
-- Non-RLS privileges are unnecessary for browser clients, even on managed Storage tables.
REVOKE TRUNCATE,TRIGGER,REFERENCES,MAINTAIN ON storage.objects FROM PUBLIC,anon,authenticated;
-- Upload happens first. The helper bypasses object read RLS only to check exact ownership,
-- so the photo row can be linked before the now-readable signed URL is requested.
CREATE POLICY pilot_photo_owned_object ON public.visit_photos AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(private.pilot_photo_object_owned(storage_path));
COMMIT;
