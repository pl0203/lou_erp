import { readFileSync,mkdirSync,writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
const body=source=>{const b=source.match(/CREATE(?: OR REPLACE)? FUNCTION public\.pilot_sales_order_page_v1\([^]*?AS \$\$([^]*?)\$\$;/)?.[1];if(!b)throw new Error('Expected sales page body');return b}
export function extractSalesStatement(source){
 const b=body(source),start=b.indexOf('WITH matching AS MATERIALIZED'),end=b.lastIndexOf('INTO result;')
 if(start<0||end<=start||b.slice(end).trim()!=='INTO result;\n RETURN result;\nEND')throw new Error('Unexpected sales SELECT layout')
 const params={p_status:'$1',p_own_only:'$2',p_page:'$3',p_page_size:'$4',p_customer_id:'$5',p_visit_id:'$6'}
 return b.slice(start,end).trim().replace(/\bp_(?:status|own_only|page_size|page|customer_id|visit_id)\b/g,key=>params[key])+';'
}
export function buildSalesPlanPackets(source){
 const inner=extractSalesStatement(source),hash=createHash('md5').update(body(source)).digest('hex')
 const prepare=`PREPARE sales_read(text,boolean,integer,integer,uuid,uuid) AS\n${inner}\n`
 const cost="EXPLAIN (VERBOSE,COSTS) EXECUTE sales_read('all',false,1,10,NULL,NULL);\n"
 const prefix=(mode,nested=false)=>`BEGIN READ ONLY;
SET LOCAL statement_timeout='60s';
SET LOCAL plan_cache_mode='${mode}';
DO $$ BEGIN
 IF current_database()<>'pilot_test' OR current_user<>'postgres' OR (SELECT count(*) FROM public.pilot_fixture_marker)<>1 OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') OR (SELECT count(*) FROM public.pilot_scale_manifest)<>1 OR (SELECT manifest->'base'->>'purchase_orders' FROM public.pilot_scale_manifest) IS DISTINCT FROM '30000' THEN RAISE EXCEPTION 'Fixed disposable30k required'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.pilot_sales_order_page_v1(text,boolean,integer,integer,uuid,uuid)'::regprocedure) IS DISTINCT FROM '${hash}' THEN RAISE EXCEPTION 'Sales page source drift'; END IF;
END $$;
${nested?`LOAD 'auto_explain';
SET LOCAL auto_explain.log_min_duration='1s';
SET LOCAL auto_explain.log_nested_statements=on;
SET LOCAL auto_explain.log_analyze=off;
SET LOCAL auto_explain.log_timing=off;
SET LOCAL auto_explain.log_level='notice';`:''}
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','84000000-0000-0000-0000-000000000002',true);
DO $$ BEGIN IF public.current_user_role()::text IS DISTINCT FROM 'sales_manager' OR EXISTS(SELECT 1 FROM unnest(ARRAY['girard_orders','customers','users']) t(name) WHERE NOT row_security_active(('public.'||t.name)::regclass)) THEN RAISE EXCEPTION 'Real manager RLS required'; END IF; END $$;
SET LOCAL search_path='';
`
 const end=name=>`ROLLBACK;\nSELECT 'SALES_PLAN_DIAGNOSTIC_VERIFIED' AS result,'${name}' AS diagnostic;\n`
 const packets=['custom','generic'].map(mode=>{const name=`sales-inner-${mode}`;return{name,sql:prefix(`force_${mode}_plan`)+prepare+cost+'DEALLOCATE sales_read;\n'+end(name)}})
 packets.push({name:'sales-inner-auto-sixth',sql:prefix('auto')+prepare+cost.repeat(6)+"SELECT name,generic_plans,custom_plans FROM pg_prepared_statements WHERE name='sales_read';\nDEALLOCATE sales_read;\n"+end('sales-inner-auto-sixth')})
 for(const mode of ['auto','force_generic_plan']){const name=`sales-rpc-${mode}`;packets.push({name,sql:prefix(mode,true)+prepare+cost+"DEALLOCATE sales_read;\n"+`SELECT '${name}' AS diagnostic,clock_timestamp() AS started_at;
EXPLAIN (ANALYZE,BUFFERS,VERBOSE,TIMING OFF) WITH response AS MATERIALIZED(SELECT public.pilot_sales_order_page_v1('all',false,1,10,NULL,NULL) AS value) SELECT 1/CASE WHEN (value->>'total')::integer=15007 AND jsonb_array_length(value->'items')=10 THEN 1 ELSE 0 END AS exact_fixture_total FROM response;
`+end(name)})}
 return packets
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==2)throw new Error('No custom diagnostic inputs')
 const source=readFileSync('supabase/migrations/202610010009_sales_page_enrichment.sql','utf8')
 mkdirSync('scale-results/sales-diagnostics',{recursive:true})
 for(const p of buildSalesPlanPackets(source))writeFileSync(`scale-results/sales-diagnostics/${p.name}.sql`,p.sql,{flag:'wx'})
}
