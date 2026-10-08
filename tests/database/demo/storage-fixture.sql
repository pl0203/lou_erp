-- TEST ONLY. Match provider-owned metadata fields absent from the historical minimal fixture.
-- Never apply this file to Supabase or any database containing real records.
DO $$ BEGIN
 IF current_database()<>'pilot_test' OR current_user<>'postgres'
 OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci')
 OR EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM storage.objects)
 THEN RAISE EXCEPTION 'Empty disposable fixture required'; END IF;
END $$;
ALTER TABLE storage.objects ADD COLUMN metadata jsonb;
ALTER TABLE storage.buckets ADD COLUMN name text, ADD COLUMN file_size_limit bigint, ADD COLUMN allowed_mime_types text[];
