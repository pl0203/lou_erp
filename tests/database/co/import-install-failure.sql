-- Injected immediately before the candidate's sole terminal COMMIT by the fixed
-- local runner. A new psql connection must observe no candidate/ACL/hook residue.
DO $late_import_install_failure$
DECLARE dispatcher regprocedure;
BEGIN
 PERFORM private.co_workspace_generation_guard_v1();
 -- The composed catalogue keeps the public generation router unchanged; its
 -- generation-one legacy target owns the new publication hook instead.
 dispatcher := (CASE WHEN to_regclass('private.catalog_cutover_v1') IS NULL
  THEN 'public.pilot_co_transaction_v1(uuid,text,jsonb)'
  ELSE 'private.catalog_co_legacy_transaction_v1(uuid,text,jsonb)' END)::regprocedure;
 IF to_regprocedure('public.pilot_co_import_commit_v1(uuid,jsonb)') IS NULL
 OR to_regprocedure('public.pilot_co_import_review_v1(uuid,jsonb)') IS NULL
 OR position('co_import_publication_guard_v1' IN pg_get_functiondef(dispatcher))=0
 OR has_function_privilege('anon','public.pilot_co_import_commit_v1(uuid,jsonb)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.pilot_co_import_commit_v1(uuid,jsonb)','EXECUTE') THEN
  RAISE EXCEPTION 'Late installation probe did not reach final functions/hooks/ACLs';
 END IF;
 RAISE EXCEPTION 'Synthetic late import installation failure' USING ERRCODE='PZ603';
END $late_import_install_failure$;
