import { readFileSync,mkdirSync,writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
function definition(source){
 const block=source.match(/CREATE(?: OR REPLACE)? FUNCTION public\.pilot_customer_performance_v1\([^]*?AS \$\$([^]*?)END \$\$;/)?.[1]
 if(!block)throw new Error('Expected customer function definition')
 return block+'END '
}
export function extractCustomerStatement(source){
 const block=definition(source),start=block.indexOf('WITH cohort AS MATERIALIZED'),end=block.lastIndexOf('INTO result;')
 if(start<0||end<=start||block.slice(end).trim()!=='INTO result;\n RETURN result;\nEND')throw new Error('Unexpected customer SELECT layout')
 const params={p_manager_id:'$1',p_year_month:'$2',p_visit_from:'$3',p_visit_until:'$4',p_page:'$5',p_page_size:'$6',month_from:'$7',month_until:'$8'}
 return block.slice(start,end).trim().replace(/\b(?:p_manager_id|p_year_month|p_visit_from|p_visit_until|p_page_size|p_page|month_from|month_until)\b/g,key=>params[key])+';'
}
export function buildCustomerPlanPackets(source){
 const inner=extractCustomerStatement(source),bodyHash=createHash('md5').update(definition(source)).digest('hex')
 const roles={manager:{id:'84000000-0000-0000-0000-000000000002',role:'sales_manager',month:'2026-09',end:'2026-10-01',count:51,sales:125180},executive:{id:'84000000-0000-0000-0000-000000000001',role:'executive',month:'2026-07',end:'2026-08-01',count:101,sales:250000}}
 const args=r=>`${r.role==='sales_manager'?`'${r.id}'::uuid`:'NULL::uuid'},'${r.month}','${r.month}-01'::timestamptz,'${r.end}'::timestamptz,1,10`
 function prefix(role,mode,nested=false){const r=roles[role];return `BEGIN READ ONLY;
SET LOCAL statement_timeout='60s';
SET LOCAL plan_cache_mode='${mode}';
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_database()<>'pilot_test' OR current_user<>'postgres' OR (SELECT count(*) FROM public.pilot_fixture_marker)<>1 OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') OR (SELECT count(*) FROM public.pilot_scale_manifest)<>1 OR coalesce((SELECT (manifest->'base'->>'purchase_orders')::integer FROM public.pilot_scale_manifest),0) NOT IN(6000,30000) THEN RAISE EXCEPTION 'Declared disposable scale required'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.pilot_customer_performance_v1(uuid,text,timestamptz,timestamptz,integer,integer)'::regprocedure) IS DISTINCT FROM '${bodyHash}' THEN RAISE EXCEPTION 'Customer function source drift'; END IF;
END $$;
${nested?`LOAD 'auto_explain';
SET LOCAL auto_explain.log_min_duration='1s';
SET LOCAL auto_explain.log_nested_statements=on;
SET LOCAL auto_explain.log_analyze=off;
SET LOCAL auto_explain.log_timing=off;
SET LOCAL auto_explain.log_level='notice';`:''}
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','${r.id}',true);
DO $$ BEGIN IF public.current_user_role()::text IS DISTINCT FROM '${r.role}' OR EXISTS(SELECT 1 FROM unnest(ARRAY['customers','purchase_orders','po_line_items','surat_jalan','sj_line_items','outlet_visits','customer_targets','customer_manager_assignments','users']) t(name) WHERE NOT row_security_active(('public.'||t.name)::regclass)) THEN RAISE EXCEPTION 'Actual role/RLS required'; END IF; END $$;
SET LOCAL search_path='';
`}
 const prepare=`PREPARE customer_read(uuid,text,timestamptz,timestamptz,integer,integer,date,date) AS\n${inner}\n`
 const explain=(r,actual=false)=>`EXPLAIN (${actual?'ANALYZE,BUFFERS,VERBOSE,TIMING OFF':'VERBOSE,COSTS'}) EXECUTE customer_read(${args(r)},'${r.month}-01'::date,'${r.end}'::date);\n`
 const finish=name=>`ROLLBACK;\nSELECT 'CUSTOMER_PLAN_DIAGNOSTIC_VERIFIED' AS result,'${name}' AS diagnostic;\n`
 const packets=[]
 for(const role of ['manager','executive'])for(const mode of ['custom','generic']){
  const name=`customer-inner-${role}-${mode}`
  packets.push({name,sql:prefix(role,`force_${mode}_plan`)+prepare+explain(roles[role])+`DEALLOCATE customer_read;\n`+finish(name)})
 }
 const name='customer-inner-auto-sixth'
 packets.push({name,sql:prefix('manager','auto')+prepare+explain(roles.manager).repeat(5)+`SELECT set_config('request.jwt.claim.sub','${roles.executive.id}',true);\n`+explain(roles.executive)+`SELECT name,generic_plans,custom_plans FROM pg_prepared_statements WHERE name='customer_read';\nDEALLOCATE customer_read;\n`+finish(name)})
 for(const [role,mode] of [['manager','auto'],['executive','auto'],['executive','force_generic_plan']]){
  const r=roles[role],name=`customer-rpc-${role}-${mode}`
  packets.push({name,sql:prefix(role,mode,true)+prepare+explain(r)+`DEALLOCATE customer_read;\nSELECT '${name}' AS diagnostic,clock_timestamp() AS started_at;\nEXPLAIN (ANALYZE,BUFFERS,VERBOSE,TIMING OFF) WITH response AS MATERIALIZED(SELECT public.pilot_customer_performance_v1(${args(r)}) AS value) SELECT 1/CASE WHEN (value->>'total')::integer=${r.count} AND (value->'summary'->>'total_sales')::numeric=${r.sales} THEN 1 ELSE 0 END AS exact_fixture_totals FROM response;\n`+finish(name)})
 }
 const actual='customer-inner-manager-actual'
 packets.push({name:actual,sql:prefix('manager','force_custom_plan')+prepare+explain(roles.manager)+explain(roles.manager,true)+`DEALLOCATE customer_read;\n`+finish(actual)})
 return packets
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==2)throw new Error('No custom diagnostic inputs')
 const source=readFileSync('supabase/migrations/202610010008_customer_delivery_aggregation.sql','utf8')
 mkdirSync('scale-results/customer-diagnostics',{recursive:true})
 for(const p of buildCustomerPlanPackets(source))writeFileSync(`scale-results/customer-diagnostics/${p.name}.sql`,p.sql,{flag:'wx'})
}
