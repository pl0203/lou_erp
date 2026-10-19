-- Fixed preinstallation snapshot regression. No candidate installation or commits.
BEGIN;
\ir snapshot.sql
DO $$ BEGIN
 IF NOT (pg_temp.employee_legacy_snapshot()->'catalog'->'functions' ? 'auth.uid()')
 OR NOT (pg_temp.employee_legacy_snapshot()->'catalog'->'relations' ? 'public.users')
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(pg_temp.employee_legacy_snapshot()->'catalog'->'dependencies')d WHERE d->>0='table' AND d->>2='public.users')
 THEN RAISE EXCEPTION 'EMPLOYEE_ABSENT_SNAPSHOT_LOST_LEGACY_OBJECTS'; END IF;
END $$;
ROLLBACK;
\echo EMPLOYEE_ABSENT_SNAPSHOT_PASSED
