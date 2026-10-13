-- FICTIONAL ONLY. Complete final-schema positive fixtures; all setup remains owner-only.
\ir ../quote-seed.sql
\ir policy-seed.sql
-- Manager 3 needs explicitly complete Saturday coverage under final readiness.
-- Employee 8 deliberately retains missing coverage, preserving the original negative.
INSERT INTO public.ihr_saturday_memberships(id,employee_id,group_id,effective_from,effective_until,created_by)
VALUES('86000000-0000-0000-0000-000000000031','71000000-0000-0000-0000-000000000003','79000000-0000-0000-0000-000000000021','2020-01-01','2040-01-01','71000000-0000-0000-0000-000000000006');
\ir governance-approvals-seed.sql
