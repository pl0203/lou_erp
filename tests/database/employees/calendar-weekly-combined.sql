-- Weekly owns its original BEGIN/ROLLBACK; do not wrap or concatenate transactions.
DO $$ BEGIN IF to_regclass('private.employee_records') IS NULL OR to_regprocedure('public.employee_command_v1(uuid,uuid,bigint,text,jsonb,text,date,text,text)') IS NULL THEN RAISE EXCEPTION 'Combined proof requires installed HR'; END IF; END $$;
\ir ../ihr/helpers.sql
\ir ../ihr/weekly-calendar.sql
\echo EMPLOYEE_WEEKLY_CALENDAR_COMBINED_PASSED
