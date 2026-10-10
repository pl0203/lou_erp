-- Plain SQL only. Coordinator applies exactly migrations1001..1008 through the existing guarded lifecycle.
-- Earlier native foundation/calendar/accounts suites retain their original staged migration semantics.
-- This entry then verifies the complete final schema. Every synthetic suite rolls back.
\set ON_ERROR_STOP on
\ir helpers.sql
\ir calendar-timezone-shadow.sql
\ir composed/helpers.sql
\ir composed/quote.sql
\ir composed/requests.sql
\ir composed/decisions.sql
\ir reads.sql
\ir admin.sql
\ir composed/preparation.sql
\ir final-review.sql
\ir context-contract.sql
\echo IHR_COMPOSED_BACKEND_PLAIN_PASSED
