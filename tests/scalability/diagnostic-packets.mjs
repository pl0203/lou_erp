import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { ACTORS } from './measure-reads.mjs'
// Emits fixed read-only SQL only. Each packet runs in its own guarded psql process.
export function buildDiagnosticPackets(){
 return [
  {name:'recent-manager',role:'managerA',from:'2026-07-01',planMode:'auto'},
  {name:'recent-admin',role:'po_admin',from:'2026-07-01',planMode:'auto'},
  {name:'history-admin-auto',role:'po_admin',from:'2021-01-01',planMode:'auto'},
  {name:'history-admin-custom',role:'po_admin',from:'2021-01-01',planMode:'force_custom_plan'},
 ].map(p=>({...p,sql:`-- SQL-only one-shot diagnostic; no API/p95 or concurrency acceptance.
BEGIN READ ONLY;
SET LOCAL statement_timeout='60s';
SET LOCAL plan_cache_mode='${p.planMode}';
DO $$ BEGIN
 IF current_database()<>'pilot_test' OR (SELECT count(*) FROM public.pilot_fixture_marker)<>1 OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') THEN RAISE EXCEPTION 'Disposable marker required'; END IF;
 IF (SELECT count(*) FROM public.pilot_scale_manifest)<>1 OR (SELECT (manifest->'base'->>'purchase_orders')::integer FROM public.pilot_scale_manifest)<>6000 THEN RAISE EXCEPTION 'Fixed6k fixture required'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','${ACTORS[p.role]}',true);
DO $$ BEGIN
 IF NOT row_security_active('public.purchase_orders') OR NOT row_security_active('public.po_line_items') OR NOT row_security_active('public.surat_jalan') OR NOT row_security_active('public.sj_line_items') THEN RAISE EXCEPTION 'Real role RLS required'; END IF;
 IF public.current_user_role()::text<>'${p.role==='managerA'?'sales_manager':'po_admin'}' THEN RAISE EXCEPTION 'Unexpected synthetic role'; END IF;
END $$;
SELECT '${p.name}' AS diagnostic,clock_timestamp() AS started_at,current_setting('plan_cache_mode') AS plan_mode;
EXPLAIN (ANALYZE,BUFFERS,VERBOSE,TIMING OFF)
SELECT public.pilot_athel_summary_v1('${p.from}','2026-09-30','2025-10-01','all','all');
SELECT 'SCALE_DIAGNOSTIC_VERIFIED' AS result,'${p.name}' AS diagnostic,clock_timestamp() AS finished_at;
ROLLBACK;
`}))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==2)throw new Error('No custom diagnostic arguments accepted')
 mkdirSync('scale-results/diagnostics',{recursive:true})
 for(const p of buildDiagnosticPackets())writeFileSync(`scale-results/diagnostics/${p.name}.sql`,p.sql,{flag:'wx'})
}
