// Generates only bounded negative tests for the existing disposable CI fixture.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
export function buildStalePOConflictGuards(migration){
 const body=migration.match(/DO \$stale_po_conflicts\$([^]*?)\$stale_po_conflicts\$;/)?.[1]
 if(!body||!body.includes('Stale PO source drift; migration refused')||!body.includes('EXECUTE replace(definition,target.old_raise,target.new_raise)'))throw new Error('Exact migration guard body required')
 const signatures=['public.pilot_po_lines_v1(uuid,integer,integer,timestamptz)','public.pilot_order_transaction(uuid,text,jsonb)']
 const cases=signatures.flatMap(signature=>[
  [`GRANT EXECUTE ON FUNCTION ${signature} TO anon;`,'Stale PO authority drift; migration refused'],
  [`GRANT EXECUTE ON FUNCTION ${signature} TO PUBLIC;`,'Stale PO authority drift; migration refused'],
  [`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated WITH GRANT OPTION;`,'Stale PO authority drift; migration refused'],
  [`ALTER FUNCTION ${signature} SET search_path=public;`,'Stale PO authority drift; migration refused'],
  [`ALTER FUNCTION ${signature} OWNER TO authenticated;`,'Stale PO authority drift; migration refused'],
  [`DO $drift$ BEGIN EXECUTE replace(pg_get_functiondef('${signature}'::regprocedure),'PO changed; refresh before','Synthetic changed source before'); END $drift$;`,'Stale PO source drift; migration refused'],
 ])
 return cases.map(([change,error],i)=>`BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL search_path='';
DO $$ BEGIN IF current_database()<>'pilot_test' OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') THEN RAISE EXCEPTION 'Disposable fixture required'; END IF; END $$;
CREATE FUNCTION pg_temp.assert_stale_po_migration() RETURNS void LANGUAGE plpgsql SET search_path='' AS $guard$${body}$guard$;
${change}
CREATE TEMP TABLE stale_guard_before AS SELECT p.oid,to_jsonb(p) AS metadata FROM pg_proc p WHERE p.oid IN('${signatures[0]}'::regprocedure,'${signatures[1]}'::regprocedure);
DO $test$ BEGIN
 BEGIN
  PERFORM pg_temp.assert_stale_po_migration();
  RAISE EXCEPTION 'Unexpectedly accepted stale PO drift';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'${error}' THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM stale_guard_before b LEFT JOIN pg_proc p ON p.oid=b.oid WHERE to_jsonb(p) IS DISTINCT FROM b.metadata) THEN RAISE EXCEPTION 'Rejected guard changed a function'; END IF;
 RAISE NOTICE 'STALE_PO_DRIFT_REJECTED_${i+1}';
END $test$;
ROLLBACK;
`).join('\n')
}
if(process.argv[1]?.endsWith('/stale-po-conflict-guards.mjs')){
 mkdirSync('scale-results',{recursive:true});writeFileSync('scale-results/stale-po-conflict-guards.sql',buildStalePOConflictGuards(readFileSync('supabase/migrations/202610020003_stale_po_conflicts.sql','utf8')))
}
