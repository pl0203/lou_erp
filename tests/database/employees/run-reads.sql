-- Fixed disposable test wrapper only. Not an activation bundle.
BEGIN;
\ir ../../../sql/employee-foundation-schema.sql
\ir ../ihr/helpers.sql
\ir read-model.sql
ROLLBACK;
\echo EMPLOYEE_READS_PASSED
