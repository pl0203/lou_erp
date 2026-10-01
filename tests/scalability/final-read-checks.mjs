import { mkdirSync,writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
export function buildFinalReadChecks(){
 return [['admin','auto'],['manager','auto'],['admin','force_generic_plan']].map(([role,mode])=>{
  const name=`final-${role}-${mode}`,actor=role==='admin'?'84000000-0000-0000-0000-000000000006':'84000000-0000-0000-0000-000000000002'
  const count=role==='admin'?"current_setting('pilot.scale_rows')::integer+7":'756'
  const po=role==='admin'?"current_setting('pilot.scale_rows')::numeric*1000+600":'750500'
  const delivered=role==='admin'?"current_setting('pilot.scale_rows')::numeric*500+180":'375130'
  const outstanding=role==='admin'?"current_setting('pilot.scale_rows')::numeric*500+420":'375370'
  return {name,sql:`BEGIN READ ONLY;
SET LOCAL statement_timeout='60s';
SET LOCAL plan_cache_mode='${mode}';
DO $$ BEGIN
 IF current_database()<>'pilot_test' OR (SELECT count(*) FROM public.pilot_fixture_marker)<>1 OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') OR (SELECT count(*) FROM public.pilot_scale_manifest)<>1 OR (SELECT (manifest->'base'->>'purchase_orders')::integer FROM public.pilot_scale_manifest) NOT IN (6000,30000) THEN RAISE EXCEPTION 'Declared disposable scale fixture required'; END IF;
 IF to_regclass('public.pilot_po_line_items_purchase_order_id_idx') IS NOT NULL OR to_regclass('public.pilot_sj_line_items_surat_jalan_id_idx') IS NOT NULL THEN RAISE EXCEPTION 'Rejected experimental index state'; END IF;
END $$;
SELECT set_config('pilot.scale_rows',(SELECT manifest->'base'->>'purchase_orders' FROM public.pilot_scale_manifest),true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','${actor}',true);
DO $$ BEGIN IF NOT row_security_active('public.purchase_orders') OR NOT row_security_active('public.po_line_items') OR NOT row_security_active('public.surat_jalan') OR NOT row_security_active('public.sj_line_items') OR public.current_user_role()::text IS DISTINCT FROM '${role==='admin'?'po_admin':'sales_manager'}' THEN RAISE EXCEPTION 'Real role/RLS required'; END IF; END $$;
SELECT '${name}' AS diagnostic,clock_timestamp() AS started_at;
EXPLAIN (ANALYZE,BUFFERS,VERBOSE,TIMING OFF)
WITH response AS MATERIALIZED (SELECT public.pilot_athel_summary_v1('${role==='admin'?'2021-01-01':'2026-07-01'}','2026-09-30','2025-10-01','all','all') AS value)
SELECT 1 / CASE WHEN (value->'metrics'->>'totalPOCount')::integer=${count} AND (value->'metrics'->>'totalPOValue')::numeric=${po} AND (value->'metrics'->>'deliveredValue')::numeric=${delivered} AND (value->'metrics'->>'outstandingValue')::numeric=${outstanding} THEN 1 ELSE 0 END AS exact_kpi FROM response;
ROLLBACK;
SELECT 'FINAL_READ_DIAGNOSTIC_VERIFIED' AS result,'${name}' AS diagnostic;
`}
 })
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==2)throw new Error('No custom diagnostic arguments accepted')
 mkdirSync('scale-results/diagnostics',{recursive:true})
 for(const p of buildFinalReadChecks())writeFileSync(`scale-results/diagnostics/${p.name}.sql`,p.sql,{flag:'wx'})
}
