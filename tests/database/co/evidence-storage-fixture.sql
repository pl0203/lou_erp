-- Synthetic metadata shape only. Never provider HTTP/version/race proof.
DO $$ BEGIN
 IF current_database()<>'pilot_co_test' OR current_user<>'postgres' OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') THEN RAISE EXCEPTION 'Disposable CO fixture required'; END IF;
END $$;
ALTER TABLE storage.objects ADD COLUMN version text, ADD COLUMN is_delete_marker boolean NOT NULL DEFAULT false, ADD COLUMN is_versioned boolean NOT NULL DEFAULT false;
