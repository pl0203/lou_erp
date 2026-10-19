-- Fixed rollback-only SQL-to-TypeScript integration proof.
BEGIN;
\ir ../../../sql/employee-foundation-schema.sql
\ir ../../../sql/employee-foundation-commands.sql
\ir ../../../sql/employee-foundation-reporting.sql
\ir ../ihr/helpers.sql
\ir fixture-users.sql
UPDATE private.employee_settings SET timezone='UTC',version=version+1;
\ir retained-fixture.sql
SELECT 'EMPLOYEE_SQL_JSON|'||jsonb_build_object(
 'context',:'fixture_context'::jsonb,'preview',:'fixture_preview'::jsonb,
 'command',:'fixture_command'::jsonb,'page',:'fixture_page'::jsonb,
 'detail',:'fixture_detail'::jsonb,'audit',:'fixture_audit'::jsonb,
 'candidates',:'fixture_candidates'::jsonb,'recovered',:'fixture_recovered'::jsonb,
 'absent',:'fixture_absent'::jsonb,'abandoned',:'fixture_abandoned'::jsonb)::text;
ROLLBACK;
\echo EMPLOYEE_SQL_OUTPUT_ROLLED_BACK
