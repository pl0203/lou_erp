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
const normalizedCatalog=catalog.replace('to_jsonb(p) ORDER BY p.oid',()=>`(CASE WHEN p.oid=${target} THEN jsonb_set(to_jsonb(p),'{prosrc}',to_jsonb(${literal(helperOriginal)}::text)) ELSE to_jsonb(p) END) ORDER BY p.oid`)
function capture() { return "SET statement_timeout='60s';\nSET lock_timeout='5s';\nSET TIME ZONE 'UTC';\n"+guard+catalog+' AS helper_catalog_before\n\\gset\n' }
function during(variant) {
 return `SELECT 1/CASE WHEN (${normalizedCatalog})=:'helper_catalog_before' AND (SELECT md5(prosrc) FROM pg_proc WHERE oid=${target})='${md5(variant==='candidate'?helperCandidate:helperOriginal)}' THEN 1 ELSE 0 END AS helper_only_body_changed;\n`
}
function restored(name) { return `SELECT 1/CASE WHEN (${catalog})=:'helper_catalog_before' THEN 1 ELSE 0 END AS helper_catalog_restored;
${guard}SELECT 'HELPER_EXPERIMENT_RESTORED' AS result,${literal(name)} AS packet;
` }
function start(rows=0) {
 if(![0,6000,30000].includes(rows))throw new Error('Only fixed reviewed fixture sizes are supported')
 return capture()+`BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';
SET LOCAL TIME ZONE 'UTC';
`+(rows?`DO $$ BEGIN
 IF (SELECT count(*) FROM public.pilot_scale_manifest)<>1 OR (SELECT (manifest->'base'->>'purchase_orders')::integer FROM public.pilot_scale_manifest)<>${rows}
 OR (SELECT count(*) FROM public.purchase_orders)<>${rows+7} OR (SELECT count(*) FROM public.po_line_items)<>${rows*10+7}
 OR (SELECT count(*) FROM public.surat_jalan)<>${rows*2+5} OR (SELECT count(*) FROM public.sj_line_items)<>${rows*20+5} THEN RAISE EXCEPTION 'Exact unchanged ${rows} fixture required'; END IF;
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
 const sql=start(6000)+(variant==='candidate'?'SELECT pg_temp.apply_can_read_po_trial();\n':'')+`CREATE TEMP TABLE helper_measurement(response jsonb,rpc_elapsed_ms numeric);
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
 const policy=['baseline','candidate'].map(variant=>({name:`policy-${variant}`,variant,sql:capture()+source.replace('BEGIN;',()=>"BEGIN;\nSET LOCAL statement_timeout='60s';\nSET LOCAL lock_timeout='5s';\nSET LOCAL TIME ZONE 'UTC';\n"+setup+(variant==='candidate'?'SELECT pg_temp.apply_can_read_po_trial();\n':'')).replace(/^ROLLBACK;$/m,()=>during(variant)+'ROLLBACK;')+'\n'+restored(`policy-${variant}`)}))
 const warmups=['manager','sales','admin'].flatMap((role,i)=>['baseline','candidate'].map((variant,j)=>benchmark(role,variant,i*2+j,true)))
 const benchmarks=['baseline','candidate','candidate','baseline'].flatMap((variant,i)=>['manager','sales','admin'].map((role,j)=>benchmark(role,variant,i*3+j)))
 const plans=['baseline','candidate'].map(variant=>{
  const name=`plans-manager-${variant}`
  return {name,role:'manager',variant,sql:start(6000)+(variant==='candidate'?'SELECT pg_temp.apply_can_read_po_trial();\n':'')+`LOAD 'auto_explain';
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
export function buildHelper30kExperiment() {
 const source=read('tests/database/scalable-pooled-reads.sql')
 const from=source.indexOf('DO $guard$ DECLARE base_rows integer;'),to=source.indexOf('PREPARE pooled_read(integer,text,boolean)')
 if(from<0||to<=from)throw new Error('Frozen acceptance oracle boundaries missing')
 const oracle=source.slice(from,to)
 if(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/m.test(oracle))throw new Error('Oracle fragment must not control root transaction')
 function packet(rpc,variant,index,warmup) {
  const name=`${warmup?'warmup':'pair'}-${String(index).padStart(2,'0')}-${rpc}-${variant}`
  return {name,rpc,variant,warmup,sql:start(30000)+(variant==='candidate'?'SELECT pg_temp.apply_can_read_po_trial();\n':'')+`SET LOCAL plan_cache_mode=auto;\n`+oracle+'\n'+roleSetup('manager')+`SELECT pg_temp.pooled_check(2,'${rpc}',false);
RESET ROLE;
`+during(variant)+`ROLLBACK;
`+restored(name)}
 }
 const rpcs=['summary','stats','lines','daily']
 return {
  warmups:rpcs.flatMap((rpc,i)=>['baseline','candidate'].map((variant,j)=>packet(rpc,variant,i*2+j,true))),
  benchmarks:['baseline','candidate','candidate','baseline'].flatMap((variant,i)=>rpcs.map((rpc,j)=>packet(rpc,variant,i*4+j,false))),
 }
}
export function buildHelperDailyDiagnostic(){
 const migration=read('supabase/migrations/202610010002_scalable_report_reads.sql')
 const definition=migration.match(/CREATE FUNCTION public\.pilot_athel_daily_v1[\s\S]*?END \$\$;/)?.[0]
 if(!definition)throw new Error('Exact daily definition missing')
 const body=definition.split('AS $$')[1].split('$$;')[0]
 const first=body.indexOf(' WITH pos'),last=body.indexOf('\n RETURN result;')
 if(first<0||last<=first)throw new Error('Daily query boundaries changed')
 const originalQuery=body.slice(first+1,last)
 if((originalQuery.match(/ INTO result/g)||[]).length!==1)throw new Error('Daily INTO layout changed')
 const bindings=['p_from','p_to','p_rolling_from','p_status','p_page','p_page_size','total_days','page_offset']
 const query=originalQuery.replace(' INTO result','').replace(/\b(p_from|p_to|p_rolling_from|p_status|p_page|p_page_size|total_days|page_offset)\b/g,name=>'$'+(bindings.indexOf(name)+1))
 const source=read('tests/database/scalable-pooled-reads.sql')
 const from=source.indexOf('DO $guard$ DECLARE base_rows integer;'),to=source.indexOf('PREPARE pooled_read(integer,text,boolean)')
 if(from<0||to<=from)throw new Error('Frozen daily oracle missing')
 const oracle=source.slice(from,to)
 const parameters="'2026-09-01'::date,'2026-09-30'::date,'2025-10-01'::date,'all'::text,1::integer,30::integer,('2026-09-30'::date-'2026-09-01'::date+1)::integer,((1::bigint-1)*30)::bigint"
 const packets=['manager','admin'].flatMap(role=>['force_custom_plan','force_generic_plan','auto'].map(mode=>{
  const analyze=mode==='auto',name=`daily-${role}-${mode}`
  return {name,role,mode,analyze,sql:start(30000)+`SELECT pg_temp.apply_can_read_po_trial();
DO $$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.pilot_athel_daily_v1(date,date,date,text,text,integer,integer)'::regprocedure)<>'${md5(body)}' THEN RAISE EXCEPTION 'Installed daily SQL differs from diagnostic source'; END IF; END $$;
`+oracle+'\n'+roleSetup(role)+`SET LOCAL plan_cache_mode=${mode};
PREPARE daily_inner(date,date,date,text,integer,integer,integer,bigint) AS
${query}
SELECT 'DAILY_COST_PLAN ${name}' AS probe;
EXPLAIN (VERBOSE, COSTS ON) EXECUTE daily_inner(${parameters});
`+(analyze?`SELECT 'DAILY_INSTRUMENTED_INNER_PLAN ${name}' AS probe;
EXPLAIN (ANALYZE,BUFFERS,VERBOSE,TIMING OFF) EXECUTE daily_inner(${parameters});
`:'')+`-- RPC timing and the complete independent response oracle are separate from instrumented EXPLAIN.
SELECT pg_temp.pooled_check(${role==='manager'?2:6},'daily',false);
DEALLOCATE daily_inner;
RESET ROLE;
`+during('candidate')+'ROLLBACK;\n'+restored(name)}
 }))
 return {query,packets}
}
export function buildHelperAcceptancePackets(rows){
 if(![6000,30000].includes(rows))throw new Error('Fixed acceptance sizes only')
 const packets={truth:buildHelperExperiment().truth,policy:buildHelperExperiment().policy.find(p=>p.variant==='candidate').sql}
 for(const [name,path] of [['ground-truth','tests/database/scalability-ground-truth.sql'],['pooled-reads','tests/database/scalable-pooled-reads.sql']]){
  const source=read(path)
  if((source.match(/^BEGIN;$/gm)||[]).length!==1||(source.match(/^ROLLBACK;$/gm)||[]).length!==1||/^\s*COMMIT\s*;/m.test(source))throw new Error('Unexpected acceptance suite transaction shape')
  const prefix=start(rows)
  packets[name]=source.replace('BEGIN;',()=>prefix+'SELECT pg_temp.apply_can_read_po_trial();\n').replace(/^ROLLBACK;$/m,()=>during('candidate')+'ROLLBACK;')+'\n'+restored(`acceptance-${rows}-${name}`)
 }
 return packets
}
const emptyRaceFixture=`DO $empty$ DECLARE t text;n bigint; BEGIN
 IF to_regclass('public.pilot_scale_manifest') IS NOT NULL OR EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM storage.objects) OR EXISTS(SELECT 1 FROM private.pilot_order_requests) THEN RAISE EXCEPTION 'Source fixture must be empty'; END IF;
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'pilot_fixture_marker' LOOP
  EXECUTE format('SELECT count(*) FROM public.%I',t) INTO n;
  IF n<>0 THEN RAISE EXCEPTION 'Source fixture must be empty: %',t; END IF;
 END LOOP;
END $empty$;
`
export function helperRaceStateSql(){
 const either=guard.replace(`AND md5(p.prosrc)='${md5(helperOriginal)}'`,()=>`AND md5(p.prosrc) IN ('${md5(helperOriginal)}','${md5(helperCandidate)}')`)
 return `BEGIN READ ONLY; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='5s'; SET LOCAL TIME ZONE 'UTC';\n`+either+`SELECT jsonb_build_object('marker','HELPER_RACE_STATE','catalog_md5',(${catalog}),'normalized_catalog_md5',(${normalizedCatalog}),'helper_source_md5',(SELECT md5(prosrc) FROM pg_proc WHERE oid=${target}),'buckets_md5',(SELECT md5(coalesce(jsonb_agg(to_jsonb(b) ORDER BY id),'[]'::jsonb)::text) FROM storage.buckets b));\nROLLBACK;\n`
}
export function buildHelperRaceLifecycle(expectedCatalog){
 if(!/^[a-f0-9]{32}$/.test(expectedCatalog))throw new Error('Exact captured catalog digest required')
 const originalCreate=originalDefinition.replace(/^CREATE FUNCTION/,()=> 'CREATE OR REPLACE FUNCTION')
 const candidateGuard=guard.replaceAll(md5(helperOriginal),md5(helperCandidate))
 return {
  originalHash:md5(helperOriginal),candidateHash:md5(helperCandidate),
  empty:"SET statement_timeout='60s'; SET lock_timeout='5s';\n"+guard+emptyRaceFixture+"SELECT 'HELPER_RACE_EMPTY_VERIFIED';\n",
  candidateEmpty:"SET statement_timeout='60s'; SET lock_timeout='5s';\n"+candidateGuard+emptyRaceFixture+"SELECT 'HELPER_RACE_EMPTY_VERIFIED';\n",
  install:capture()+`SELECT 1/CASE WHEN :'helper_catalog_before'='${expectedCatalog}' THEN 1 ELSE 0 END AS captured_catalog_matches;\nBEGIN;\nSET LOCAL statement_timeout='60s';\nSET LOCAL lock_timeout='5s';\n`+emptyRaceFixture+setup+'SELECT pg_temp.apply_can_read_po_trial();\n'+during('candidate')+'COMMIT;\n'+during('candidate')+"SELECT 'HELPER_RACE_CANDIDATE_COMMITTED';\n",
  restore:"SET statement_timeout='60s'; SET lock_timeout='5s'; SET TIME ZONE 'UTC';\nBEGIN;\n"+candidateGuard+`SELECT 1/CASE WHEN (${normalizedCatalog})='${expectedCatalog}' THEN 1 ELSE 0 END AS known_candidate_metadata;\n`+originalCreate+`\nSELECT 1/CASE WHEN (${catalog})='${expectedCatalog}' THEN 1 ELSE 0 END AS restored_before_commit;\nCOMMIT;\nSELECT 1/CASE WHEN (${catalog})='${expectedCatalog}' THEN 1 ELSE 0 END AS restored_after_commit;\n`+guard+"SELECT 'HELPER_RACE_RESTORED';\n",
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==2)throw new Error('No arbitrary experiment parameters accepted')
 const packets=buildHelperExperiment();mkdirSync('scale-results/helper-experiment',{recursive:true})
 writeFileSync('scale-results/helper-experiment/truth.sql',packets.truth,{flag:'wx'})
 for(const p of [...packets.policy,...packets.warmups,...packets.benchmarks,...packets.plans])writeFileSync(`scale-results/helper-experiment/${p.name}.sql`,p.sql,{flag:'wx'})
 writeFileSync('scale-results/helper-experiment/packet-order.json',JSON.stringify(Object.fromEntries(['policy','warmups','benchmarks','plans'].map(k=>[k,packets[k].map(p=>p.name)])),null,2),{flag:'wx'})
}
