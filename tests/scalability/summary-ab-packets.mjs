import { readFileSync,mkdirSync,writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { buildDiagnosticPackets } from './diagnostic-packets.mjs'
import { extractSummaryStatement } from './query-plan-packets.mjs'
const indexGuard=`DO $$ DECLARE target record; BEGIN
 FOR target IN SELECT * FROM (VALUES
 ('po_line_items','purchase_order_id','pilot_po_line_items_purchase_order_id_idx'),
 ('sj_line_items','surat_jalan_id','pilot_sj_line_items_surat_jalan_id_idx')
 ) AS t(table_name,column_name,index_name) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid JOIN pg_catalog.pg_am am ON am.oid=c.relam JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0]
   WHERE c.oid=to_regclass('public.'||target.index_name) AND i.indrelid=to_regclass('public.'||target.table_name) AND a.attname=target.column_name AND a.atttypid='uuid'::regtype AND i.indnkeyatts=1 AND i.indisvalid AND i.indisready AND NOT i.indisunique AND NOT i.indisprimary AND i.indpred IS NULL AND i.indexprs IS NULL AND am.amname='btree') THEN RAISE EXCEPTION 'Unexpected child index contract; Candidate child indexes must be restored'; END IF;
 END LOOP;
END $$;\n`
export function buildSummaryAbPackets(source){
 const original=source.match(/CREATE FUNCTION public\.pilot_athel_summary_v1\([^]*?END \$\$;/)?.[0]
 if(!original)throw new Error('Baseline summary definition missing')
 const staticFunction=original.replace('public.pilot_athel_summary_v1','pg_temp.ab_summary')
 const dynamicFunction=staticFunction.slice(0,staticFunction.indexOf(' WITH pos'))+`\n EXECUTE $ab_query$\n${extractSummaryStatement(source)}\n$ab_query$ INTO result USING p_from,p_to,p_rolling_from,p_status,p_fulfillment;\n RETURN result;\nEND $$;`
 const bases=buildDiagnosticPackets(),packets=[]
 for(const variant of ['a-static-lookup-only','b-static-child-indexes','c-dynamic-child-indexes'])for(const role of ['admin','manager']){
  const base=bases.find(p=>p.role===(role==='admin'?'po_admin':'managerA'))
  let prefix=base.sql.split(`SELECT '${base.name}' AS diagnostic`)[0].replace('BEGIN READ ONLY;','BEGIN;\nSET LOCAL lock_timeout=\'5s\';')
  const setup=indexGuard+(variant.startsWith('a-')?'DROP INDEX public.pilot_po_line_items_purchase_order_id_idx;\nDROP INDEX public.pilot_sj_line_items_surat_jalan_id_idx;\n':'')+(variant.startsWith('c-')?dynamicFunction:staticFunction)+'\n'
  prefix=prefix.replace('SET LOCAL ROLE authenticated;',()=>setup+'SET LOCAL ROLE authenticated;')
  const name=`${variant}-${role}`,from=role==='admin'?'2021-01-01':'2026-07-01'
  packets.push({name,sql:prefix+`SELECT '${name}' AS diagnostic,clock_timestamp() AS started_at;\nEXPLAIN (ANALYZE,BUFFERS,VERBOSE,TIMING OFF) SELECT pg_temp.ab_summary('${from}','2026-09-30','2025-10-01','all','all');\nROLLBACK;\n`+indexGuard+`SELECT 'SCALE_DIAGNOSTIC_VERIFIED' AS result,'${name}' AS diagnostic;\n`})
 }
 const c=packets.find(p=>p.name==='c-dynamic-child-indexes-admin')
 packets.push({name:'c-dynamic-child-indexes-admin-generic',sql:c.sql.replaceAll('c-dynamic-child-indexes-admin','c-dynamic-child-indexes-admin-generic').replace("SET LOCAL plan_cache_mode='auto'","SET LOCAL plan_cache_mode='force_generic_plan'")})
 return packets
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==2)throw new Error('No custom diagnostic arguments accepted')
 const source=readFileSync('supabase/migrations/202610010002_scalable_report_reads.sql','utf8')
 mkdirSync('scale-results/diagnostics',{recursive:true})
 for(const p of buildSummaryAbPackets(source))writeFileSync(`scale-results/diagnostics/${p.name}.sql`,p.sql,{flag:'wx'})
}
