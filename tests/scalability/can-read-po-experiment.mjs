import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
const read = p => readFileSync(p,'utf8')
const literal = s => `'${s.replaceAll("'","''")}'`
const md5 = s => createHash('md5').update(s).digest('hex')
const originalDefinition = read('supabase/migrations/202609300001_pilot_security.sql').match(/CREATE FUNCTION private\.pilot_can_read_po\(po uuid\)[\s\S]*?\$\$;/)?.[0]
if (!originalDefinition) throw new Error('Original helper definition missing')
export const helperOriginal = originalDefinition.split('AS $$')[1].split('$$;')[0]
const candidateDefinition = read('tests/database/experiments/can-read-po-single-lookup.sql').match(/CREATE OR REPLACE FUNCTION private\.pilot_can_read_po\(po uuid\)[\s\S]*?\$\$;/)?.[0]
if (!candidateDefinition) throw new Error('Experimental helper definition missing')
export const helperCandidate = candidateDefinition.split('AS $$')[1].split('$$;')[0]
const target = "'private.pilot_can_read_po(uuid)'::regprocedure"
// Complete catalog rows, not a shortlist of attributes. Temp-only probes are excluded.
const catalog = `SELECT md5(jsonb_build_object(
 'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private','auth')),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p),
 'relations',(SELECT jsonb_agg(to_jsonb(c)-ARRAY['relpages','reltuples','relallvisible','relfrozenxid','relminmxid'] ORDER BY c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','auth','storage')),
 'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','auth','storage')),
 'constraints',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN('public','private','auth','storage')),
 'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','auth','storage')),
 'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','auth','storage')),
 'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM pg_roles r),
 'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.roleid,m.member,m.grantor) FROM pg_auth_members m),
 'schemas',(SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_namespace n WHERE n.nspname IN('public','private','auth','storage'))
)::text)`
// Physical relation statistics/freeze horizons may change during autovacuum.
// Structural metadata and every function attribute remain in the comparison.
const guard = `DO $$ BEGIN
 IF current_database()<>'pilot_test' OR current_user<>'postgres' OR current_setting('session_replication_role')<>'origin'
 OR (SELECT count(*) FROM public.pilot_fixture_marker)<>1
 OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') THEN RAISE EXCEPTION 'Disposable helper experiment owner/marker required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=${target} AND p.proowner='postgres'::regrole AND p.prorettype='boolean'::regtype AND p.prokind='f' AND NOT p.proretset AND p.pronargs=1 AND p.pronargdefaults=0 AND p.provariadic=0 AND p.prosupport=0 AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='sql') AND p.provolatile='s' AND p.prosecdef AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u' AND p.procost=100 AND p.prorows=0 AND p.proargnames=ARRAY['po'] AND p.proconfig=ARRAY['search_path=""'] AND md5(p.prosrc)='${md5(helperOriginal)}') THEN RAISE EXCEPTION 'Original helper contract drift'; END IF;
 IF NOT has_function_privilege('authenticated',${target},'EXECUTE') OR has_function_privilege('anon',${target},'EXECUTE')
 OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=${target} AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN RAISE EXCEPTION 'Original helper ACL drift'; END IF;
END $$;
`
const setup = `CREATE TEMP TABLE helper_original_metadata ON COMMIT DROP AS SELECT to_jsonb(p)-'prosrc' AS value FROM pg_proc p WHERE p.oid=${target};
CREATE FUNCTION pg_temp.apply_can_read_po_trial() RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $apply$
BEGIN
 IF current_user<>'postgres' OR current_database()<>'pilot_test' THEN RAISE EXCEPTION 'Disposable owner required'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=${target})<>'${md5(helperOriginal)}' THEN RAISE EXCEPTION 'Original helper body required'; END IF;
 EXECUTE ${literal(candidateDefinition)};
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=${target}) IS DISTINCT FROM (SELECT value FROM pg_temp.helper_original_metadata) THEN RAISE EXCEPTION 'Helper metadata changed'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=${target})<>'${md5(helperCandidate)}' THEN RAISE EXCEPTION 'Wrong helper candidate body'; END IF;
END $apply$;
`
function capture() { return "SET statement_timeout='60s';\nSET lock_timeout='5s';\nSET TIME ZONE 'UTC';\n"+guard+catalog+' AS helper_catalog_before\n\\gset\n' }
function during(variant) {
 const normalized=catalog.replace('to_jsonb(p) ORDER BY p.oid',`(CASE WHEN p.oid=${target} THEN jsonb_set(to_jsonb(p),'{prosrc}',to_jsonb(${literal(helperOriginal)}::text)) ELSE to_jsonb(p) END) ORDER BY p.oid`)
 return `SELECT 1/CASE WHEN (${normalized})=:'helper_catalog_before' AND (SELECT md5(prosrc) FROM pg_proc WHERE oid=${target})='${md5(variant==='candidate'?helperCandidate:helperOriginal)}' THEN 1 ELSE 0 END AS helper_only_body_changed;\n`
}
function restored(name) { return `SELECT 1/CASE WHEN (${catalog})=:'helper_catalog_before' THEN 1 ELSE 0 END AS helper_catalog_restored;
${guard}SELECT 'HELPER_EXPERIMENT_RESTORED' AS result,${literal(name)} AS packet;
` }
function start(large=false) {
 return capture()+`BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';
SET LOCAL TIME ZONE 'UTC';
`+(large?`DO $$ BEGIN
 IF (SELECT count(*) FROM public.pilot_scale_manifest)<>1 OR (SELECT (manifest->'base'->>'purchase_orders')::integer FROM public.pilot_scale_manifest)<>6000
 OR (SELECT count(*) FROM public.purchase_orders)<>6007 OR (SELECT count(*) FROM public.po_line_items)<>60007
 OR (SELECT count(*) FROM public.surat_jalan)<>12005 OR (SELECT count(*) FROM public.sj_line_items)<>120005 THEN RAISE EXCEPTION 'Exact unchanged 6k fixture required'; END IF;
END $$;
`:'')+setup
}
function roleSetup(role) {
 const [actor,roleName]=role==='manager'?[2,'sales_manager']:role==='sales'?[4,'sales_person']:[6,'po_admin']
 return `SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','84000000-0000-0000-0000-${String(actor).padStart(12,'0')}',true);
DO $$ BEGIN IF public.current_user_role()::text IS DISTINCT FROM '${roleName}' OR EXISTS(SELECT 1 FROM unnest(ARRAY['purchase_orders','po_line_items','surat_jalan','sj_line_items']) t(name) WHERE NOT row_security_active(('public.'||t.name)::regclass)) THEN RAISE EXCEPTION 'Actual role/RLS required'; END IF; END $$;
SET LOCAL search_path='';
` }
const summary = role => `public.pilot_athel_summary_v1('${role==='admin'?'2021-01-01':'2026-07-01'}','2026-09-30','2025-10-01','all','all')`
function benchmark(role,variant,index,warmup=false) {
 const name=`${warmup?'warmup':'pair'}-${String(index).padStart(2,'0')}-${role}-${variant}`
 const expected=role==='admin'?['6007','6000600','3000180','3000420']:['756','750500','375130','375370']
 const sql=start(true)+(variant==='candidate'?'SELECT pg_temp.apply_can_read_po_trial();\n':'')+`CREATE TEMP TABLE helper_measurement(response jsonb,rpc_elapsed_ms numeric);
GRANT INSERT,SELECT ON pg_temp.helper_measurement TO authenticated;
CREATE FUNCTION pg_temp.measure_helper_summary() RETURNS TABLE(response jsonb,rpc_elapsed_ms numeric) LANGUAGE plpgsql SECURITY INVOKER AS $timed$
DECLARE started timestamptz;
BEGIN started:=clock_timestamp(); response:=${summary(role)}; rpc_elapsed_ms:=extract(epoch FROM clock_timestamp()-started)*1000; RETURN NEXT; END $timed$;
`+roleSetup(role)+`INSERT INTO pg_temp.helper_measurement SELECT * FROM pg_temp.measure_helper_summary();
SELECT 'HELPER_RPC_FINISH '||jsonb_build_object('name','${name}','role','${role}','variant','${variant}','warmup',${warmup},'rpc_elapsed_ms',rpc_elapsed_ms)::text FROM pg_temp.helper_measurement;
-- Independent fixed-fixture oracle is outside the measured RPC interval.
SELECT 1/CASE WHEN (response->'metrics'->>'totalPOCount')::integer=${expected[0]} AND (response->'metrics'->>'totalPOValue')::numeric=${expected[1]} AND (response->'metrics'->>'deliveredValue')::numeric=${expected[2]} AND (response->'metrics'->>'outstandingValue')::numeric=${expected[3]} THEN 1 ELSE 0 END AS exact_metrics FROM pg_temp.helper_measurement;
RESET ROLE;
`+during(variant)+`ROLLBACK;
`+restored(name)
 return {name,role,variant,warmup,sql}
}
export function buildHelperExperiment() {
 const truthSource=read('tests/database/experiments/can-read-po-truth-table.sql')
 if(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/m.test(truthSource))throw new Error('Truth fragment must not control root transaction')
 const truth=start()+truthSource+'\nRESET ROLE;\n'+during('candidate')+'ROLLBACK;\n'+restored('direct-truth')+`DO $$ BEGIN IF EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM public.users) OR EXISTS(SELECT 1 FROM public.purchase_orders) OR EXISTS(SELECT 1 FROM private.pilot_order_requests) THEN RAISE EXCEPTION 'Truth fixture did not rollback empty'; END IF; END $$;\n`
 const source=read('tests/database/scalable-policy-state.sql')
 if((source.match(/^BEGIN;$/gm)||[]).length!==1||(source.match(/^ROLLBACK;$/gm)||[]).length!==1||/^\s*COMMIT\s*;/m.test(source))throw new Error('Unexpected installed-policy transaction layout')
 const policy=['baseline','candidate'].map(variant=>({name:`policy-${variant}`,variant,sql:capture()+source.replace('BEGIN;',"BEGIN;\nSET LOCAL statement_timeout='60s';\nSET LOCAL lock_timeout='5s';\nSET LOCAL TIME ZONE 'UTC';\n"+setup+(variant==='candidate'?'SELECT pg_temp.apply_can_read_po_trial();\n':'')).replace(/^ROLLBACK;$/m,during(variant)+'ROLLBACK;')+'\n'+restored(`policy-${variant}`)}))
 const warmups=['manager','sales','admin'].flatMap((role,i)=>['baseline','candidate'].map((variant,j)=>benchmark(role,variant,i*2+j,true)))
 const benchmarks=['baseline','candidate','candidate','baseline'].flatMap((variant,i)=>['manager','sales','admin'].map((role,j)=>benchmark(role,variant,i*3+j)))
 const plans=['baseline','candidate'].map(variant=>{
  const name=`plans-manager-${variant}`
  return {name,role:'manager',variant,sql:start(true)+(variant==='candidate'?'SELECT pg_temp.apply_can_read_po_trial();\n':'')+`LOAD 'auto_explain';
SET LOCAL auto_explain.log_nested_statements=on;
SET LOCAL auto_explain.log_min_duration='0';
SET LOCAL auto_explain.log_analyze=on;
SET LOCAL auto_explain.log_timing=off;
SET LOCAL auto_explain.log_level='notice';
`+roleSetup('manager')+`SELECT 'single-helper-${variant}' AS probe;
SELECT private.pilot_can_read_po(md5('scale-po-1')::uuid);
RESET ROLE;
SET LOCAL auto_explain.log_min_duration='1s';
SET LOCAL auto_explain.log_analyze=off;
`+roleSetup('manager')+`
SELECT 'parent-count-${variant}' AS probe;
EXPLAIN (ANALYZE,BUFFERS,VERBOSE,TIMING OFF) SELECT count(*) FROM public.purchase_orders;
SELECT 'summary-${variant}' AS probe;
EXPLAIN (ANALYZE,BUFFERS,VERBOSE,TIMING OFF) SELECT ${summary('manager')};
RESET ROLE;
`+during(variant)+`ROLLBACK;
`+restored(name)}
 })
 return {truth,policy,warmups,benchmarks,plans}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==2)throw new Error('No arbitrary experiment parameters accepted')
 const packets=buildHelperExperiment();mkdirSync('scale-results/helper-experiment',{recursive:true})
 writeFileSync('scale-results/helper-experiment/truth.sql',packets.truth,{flag:'wx'})
 for(const p of [...packets.policy,...packets.warmups,...packets.benchmarks,...packets.plans])writeFileSync(`scale-results/helper-experiment/${p.name}.sql`,p.sql,{flag:'wx'})
 writeFileSync('scale-results/helper-experiment/packet-order.json',JSON.stringify(Object.fromEntries(['policy','warmups','benchmarks','plans'].map(k=>[k,packets[k].map(p=>p.name)])),null,2),{flag:'wx'})
}
