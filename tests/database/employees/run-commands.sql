-- Fixed disposable test wrapper only. Not an activation bundle.
BEGIN;
\ir ../../../sql/employee-foundation-schema.sql
\ir ../../../sql/employee-foundation-commands.sql
\ir ../ihr/helpers.sql
\ir commands.sql
ROLLBACK;
\echo EMPLOYEE_COMMANDS_PASSED
