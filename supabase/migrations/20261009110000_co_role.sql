-- Inert role value only. Commit before the foundation references it.
BEGIN;
ALTER TYPE public.user_role ADD VALUE 'co_admin';
COMMIT;
