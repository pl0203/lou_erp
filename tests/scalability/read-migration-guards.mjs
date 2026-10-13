import { readFileSync,mkdirSync,writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
export function buildReadMigrationGuardTests(migration){
 if((migration.match(/^BEGIN;$/gm)||[]).length!==1||(migration.match(/^COMMIT;$/gm)||[]).length!==1)throw new Error('Expected one atomic migration wrapper')
 const beforeChanges=migration.slice(migration.indexOf('BEGIN;')+6,migration.indexOf('\nALTER POLICY pilot_po_visibility'))
 if(!beforeChanges.includes('SELECT pg_temp.scale_assert_contract();')||beforeChanges.includes('$candidate_preflight$'))throw new Error('Unexpected candidate preflight layout')
 const cases=[
  {name:'acl',mutation:'GRANT EXECUTE ON FUNCTION public.pilot_athel_summary_v1(date,date,date,text,text) TO anon;',code:'23514',message:'Read function ACL drift'},
  {name:'policy',mutation:'ALTER POLICY po_sales_read ON public.purchase_orders USING(true);',code:'23514',message:'Policy contract drift'},
  {name:'foreign-key',mutation:'ALTER TABLE public.po_line_items DROP CONSTRAINT po_line_items_purchase_order_id_fkey;',code:'23514',message:'Child FK contract drift'},
  {name:'helper-source',mutation:"CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS public.user_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $changed$ SELECT role FROM public.users WHERE id=auth.uid() AND is_active AND true $changed$;",code:'P0001',message:'Authorization helper source drift'},
  {name:'experimental-index',mutation:'CREATE INDEX pilot_po_line_items_purchase_order_id_idx ON public.po_line_items(purchase_order_id);',code:'P0001',message:'Rejected experimental child-index state requires separate review'},
 ]
 return cases.map(c=>`BEGIN;
SET LOCAL statement_timeout='60s';
DO $$ BEGIN IF current_database()<>'pilot_test' OR current_user<>'postgres' OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') OR EXISTS(SELECT 1 FROM public.purchase_orders) OR EXISTS(SELECT 1 FROM auth.users) THEN RAISE EXCEPTION 'Empty disposable migration fixture required'; END IF; END $$;
${c.mutation}
DO $guard_test$ BEGIN
 BEGIN
  EXECUTE $candidate_preflight$${beforeChanges}$candidate_preflight$;
  RAISE EXCEPTION 'Expected exact candidate preflight rejection';
 EXCEPTION WHEN SQLSTATE '${c.code}' THEN
  IF SQLERRM IS DISTINCT FROM '${c.message}' THEN RAISE; END IF;
 END;
END $guard_test$;
ROLLBACK;
SELECT 'READ_MIGRATION_DRIFT_REJECTED' AS result,'${c.name}' AS case_name;
`).join('')
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==2)throw new Error('No custom guard arguments accepted')
 const source=readFileSync('supabase/migrations/202610010007_read_policy_plans.sql','utf8')
 mkdirSync('scale-results',{recursive:true})
 writeFileSync('scale-results/read-migration-guards.sql',buildReadMigrationGuardTests(source),{flag:'wx'})
}
