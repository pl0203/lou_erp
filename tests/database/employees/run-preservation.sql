-- Fixed disposable test wrapper only. Not an activation bundle.
BEGIN;
\ir ../../../sql/employee-foundation-schema.sql
\ir ../../../sql/employee-foundation-commands.sql
\ir ../../../sql/employee-foundation-reporting.sql
\ir ../ihr/helpers.sql
\ir preservation.sql
ROLLBACK;
\echo EMPLOYEE_PRESERVATION_PASSED
