import { readFileSync,mkdirSync,writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { buildDiagnosticPackets } from './diagnostic-packets.mjs'
export function extractSummaryStatement(source){
 const block=source.match(/CREATE(?: OR REPLACE)? FUNCTION public\.pilot_athel_summary_v1\([^]*?AS \$\$([^]*?)END \$\$;/)?.[1]
 if(!block)throw new Error('Expected summary function definition missing')
 const fixed=block.match(/EXECUTE \$summary_query\$\n([^]*?)\n\$summary_query\$ INTO result USING p_from,p_to,p_rolling_from,p_status,p_fulfillment;/)?.[1]
 if(fixed)return fixed
 const start=block.indexOf('WITH pos AS MATERIALIZED'),end=block.lastIndexOf('INTO result;')
 if(start<0||end<=start||block.slice(end).trim()!=='INTO result;\n RETURN result;')throw new Error('Unexpected summary statement layout')
 const parameters={p_from:'$1',p_to:'$2',p_rolling_from:'$3',p_status:'$4',p_fulfillment:'$5'}
 return block.slice(start,end).trim().replace(/\bp_(?:from|to|rolling_from|status|fulfillment)\b/g,key=>parameters[key])+';'
}
export function buildQueryPlanPackets(source){
 const bases=buildDiagnosticPackets(),inner=extractSummaryStatement(source)
 function prefix(role,mode){
  const base=bases.find(p=>p.role===role)
  return base.sql.split(`SELECT '${base.name}' AS diagnostic`)[0].replace(`SET LOCAL plan_cache_mode='${base.planMode}'`,`SET LOCAL plan_cache_mode='${mode}'`)
 }
 const finish=name=>`SELECT 'SCALE_DIAGNOSTIC_VERIFIED' AS result,'${name}' AS diagnostic;\nROLLBACK;\n`
 const packets=['custom','generic'].map(mode=>{
  const name=`admin-inner-${mode}`
  return {name,sql:prefix('po_admin',`force_${mode}_plan`)+`SET LOCAL search_path='';
-- Exact candidate inner SELECT, bound parameters only. Cost plan does not execute it.\nPREPARE diagnostic_summary(date,date,date,text,text) AS\n${inner}\nEXPLAIN (VERBOSE,COSTS) EXECUTE diagnostic_summary('2021-01-01','2026-09-30','2025-10-01','all','all');\nDEALLOCATE diagnostic_summary;\n`+finish(name)}
 })
 const pos="WITH pos AS MATERIALIZED (SELECT id FROM public.purchase_orders WHERE order_date BETWEEN '2025-10-01'::date AND '2026-09-30'::date) "
 const queries=[
  ['parent-cohort',pos+'SELECT count(*) FROM pos'],
  ['po-lines',pos+'SELECT count(*) FROM public.po_line_items l JOIN pos p ON p.id=l.purchase_order_id'],
  ['active-headers',pos+'SELECT count(*) FROM public.surat_jalan s JOIN pos p ON p.id=s.purchase_order_id WHERE s.voided_at IS NULL'],
  ['active-delivery-lines',pos+'SELECT count(*) FROM public.sj_line_items d JOIN public.surat_jalan s ON s.id=d.surat_jalan_id JOIN pos p ON p.id=s.purchase_order_id WHERE s.voided_at IS NULL'],
 ]
 const name='manager-component-costs'
 packets.push({name,sql:prefix('managerA','auto')+queries.map(([label,sql])=>`SELECT '${label}' AS diagnostic_component,clock_timestamp() AS started_at;\nEXPLAIN (ANALYZE,BUFFERS,VERBOSE,TIMING OFF) ${sql};\n`).join('')+finish(name)})
 return packets
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==2)throw new Error('No custom diagnostic arguments accepted')
 const source=readFileSync('supabase/migrations/202610010007_read_policy_plans.sql','utf8')
 mkdirSync('scale-results/diagnostics',{recursive:true})
 for(const p of buildQueryPlanPackets(source))writeFileSync(`scale-results/diagnostics/${p.name}.sql`,p.sql,{flag:'wx'})
}
