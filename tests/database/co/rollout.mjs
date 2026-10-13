// Local synthetic lifecycle only. No connection arguments, target URLs or hosted receipts.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {coCiConnection,coSourceIdentity,coBindFixtureServer,CO_FIXTURE_OBSERVATION_SQL,coVerifyFixtureIdentitySql} from '../../../scripts/co-fixture-target.mjs'
import {CO_MIGRATIONS,coSha256,coInventoryQuery,coInventoryPin,coRenderPackets,coReconcileEnum} from '../../../scripts/build-co-rollout.mjs'
const root=fileURLToPath(new URL('../../../',import.meta.url))
export function runCoRollout({env=process.env,execute=execFileSync}={}){
 const input={...env}
 for(const [key,value] of [['PGPASSFILE','/dev/null/co-ci-no-password'],['PGSYSCONFDIR','/dev/null']]){assert.equal(input[key],value,'Runner-only sanitized connection required');delete input[key]}
 const source=coSourceIdentity(),connection=coCiConnection(input,env.CO_CI_PROFILE?source:undefined)
 const identity=JSON.parse(env.CO_FIXTURE_IDENTITY??'null')
 assert.ok(identity,'Independent parent identity required');assert.deepEqual(identity.source,source,'Source changed before rollout fixture')
 const runIdentity=env.CO_CI_PROFILE?`${env.GITHUB_RUN_ID}:${env.GITHUB_RUN_ATTEMPT}`:identity.runIdentity
 const run=(sql)=>execute('psql',['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{cwd:root,env:{...connection,PGDATABASE:'pilot_co_rollout_test'},input:sql,encoding:'utf8',maxBuffer:32*1024*1024,timeout:180000,shell:false,stdio:['pipe','pipe','pipe']})
 const one=sql=>JSON.parse(run(sql).trim().split('\n').at(-1))
 coBindFixtureServer({kind:env.CO_CI_PROFILE?'ci':'local',source,runIdentity,database:'pilot_co_rollout_test'},one(CO_FIXTURE_OBSERVATION_SQL),identity)
 assert.equal(run(coVerifyFixtureIdentitySql(identity)).trim(),'t','Independent rollout marker verification required')
 // Each observation below comes from actual changed catalogs inside rollback-only
 // transactions. It is not a shared false-returning predicate stub.
 let identityProbes=0
 for(const mutation of [
  "UPDATE public.pilot_fixture_marker SET purpose='wrong-purpose';",
  "INSERT INTO public.pilot_fixture_marker VALUES('extra-marker');",
  'ALTER TABLE public.pilot_fixture_marker OWNER TO anon;',
  'ALTER DATABASE pilot_co_rollout_test OWNER TO anon;',
  'ALTER TABLE public.pilot_fixture_marker RENAME TO saved_fixture_marker; CREATE VIEW public.pilot_fixture_marker AS SELECT * FROM public.saved_fixture_marker;',
 ]){
  const observed=one(`BEGIN; ${mutation} ${CO_FIXTURE_OBSERVATION_SQL} ROLLBACK;`)
  assert.throws(()=>coBindFixtureServer({kind:env.CO_CI_PROFILE?'ci':'local',source,runIdentity,database:'pilot_co_rollout_test'},observed,identity),/Fixture|marker/)
  identityProbes++
 }
 for(const field of ['source','runIdentity','systemIdentifier']){
  assert.equal(run(`BEGIN; UPDATE public.co_fixture_identity_v1 SET identity=jsonb_set(identity,'{${field}}','"wrong"'); ${coVerifyFixtureIdentitySql(identity)} ROLLBACK;`).trim(),'f','Changed stored identity must be refused')
  identityProbes++
 }
 assert.equal(run(coVerifyFixtureIdentitySql(identity)).trim(),'t','Identity perturbations must roll back')

 const read=path=>readFileSync(new URL(path,pathToFileURL(root)),'utf8')
 const inventory=read('scripts/co-preflight.sql'),delta=JSON.parse(read('scripts/co-rollout-delta.json'))
 const sources=CO_MIGRATIONS.map(path=>({path,sql:read(path),sha256:coSha256(read(path))}))
 const settings=inventory.slice(inventory.indexOf('SET LOCAL statement_timeout'),inventory.indexOf('\nWITH\n'))
 let storage=read('tests/database/co/evidence-storage-fixture.sql')
 assert.equal(storage.split("current_database()<>'pilot_co_test'").length,2)
 run(storage.replace("current_database()<>'pilot_co_test'","current_database()<>'pilot_co_rollout_test'"))
 run(`CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
 INSERT INTO supabase_migrations.schema_migrations VALUES('20261009014122','reviewed_demo_release_atomic_20261009',NULL),('20261009065443','unify_store_owner_credit',NULL);`)
 // Provider-default simulation only in this independently bound local database.
 // It precedes CO creation and preserves existing legacy service-role grants.
 run(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public,private GRANT EXECUTE ON FUNCTIONS TO service_role;
 ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private GRANT ALL ON TABLES TO service_role;
 ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private GRANT ALL ON SEQUENCES TO service_role;
 GRANT EXECUTE ON FUNCTION public.pilot_my_profile() TO service_role;`)
 const capture=(installed=false)=>one(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n${settings}\n${coInventoryQuery(inventory,{enumInstalled:installed,entries:true})}\nROLLBACK;`)
 const before=capture();assert.equal(before.complete,true)
 const packets=coRenderPackets({sources,inventory,snapshot:before,delta})
 let probes=0
 const fails=(sql,pattern)=>{let error;try{run(sql)}catch(e){error=e}assert.ok(error,'Expected fail-closed SQL');assert.match(String(error.stderr??error.message),pattern);probes++}
 const inject=(sql,mutation)=>sql.replace('BEGIN ISOLATION LEVEL REPEATABLE READ;',()=>`BEGIN ISOLATION LEVEL REPEATABLE READ;\n${mutation}\n`)
 for(const mutation of [
  'GRANT EXECUTE ON FUNCTION public.pilot_my_profile() TO anon;',
  'ALTER TABLE public.customers DISABLE ROW LEVEL SECURITY;',
  "ALTER FUNCTION public.pilot_my_profile() SET search_path='public';",
  'UPDATE public.users SET is_active=NOT is_active;',
  "DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.purchase_orders) THEN RAISE EXCEPTION 'Nonvacuous PO fixture required'; END IF; END $$; SELECT set_config('request.jwt.claim.sub',md5('owner-user-1')::uuid::text,true); UPDATE public.purchase_orders SET notes='unexpected protected change';",
  'ALTER FUNCTION public.pilot_my_profile() SECURITY INVOKER;',
  'ALTER FUNCTION public.pilot_my_profile() OWNER TO service_role;',
  "UPDATE supabase_migrations.schema_migrations SET name='wrong' WHERE version='20261009065443';",
 ])fails(inject(packets.enumSql,mutation),/drift|mismatch/)
 assert.deepEqual(coInventoryPin(capture()),coInventoryPin(before),'Preflight failures must roll back')
 assert.equal(run(packets.enumSql).trim(),'CO_ENUM_PACKET_PASSED')
 fails(packets.enumSql,/enum stage mismatch/)
 const enumState=capture(true)
 assert.deepEqual(coInventoryPin(enumState),coInventoryPin(before),'Separate enum commit changes no other catalog/data')
 fails(packets.forwardReviewSql,/UNARMED/)
 const receipt={version:'20990101000000',name:packets.enumApproval.name,source_sha256:packets.enumApproval.sourceSha256,packet_sha256:packets.enumApproval.packetSha256,statement_sha256:packets.enumApproval.packetSha256,statements:[packets.enumSql]}
 const armed=coRenderPackets({sources,inventory,snapshot:before,delta,enumReceipts:[receipt]})
 // Only this local synthetic receipt models connector bookkeeping; the release packet has no history write.
 const literal=x=>"'"+x.replaceAll("'","''")+"'"
 run(`INSERT INTO supabase_migrations.schema_migrations VALUES(${literal(receipt.version)},${literal(receipt.name)},ARRAY[${literal(packets.enumSql)}]);`)
 assert.equal(coReconcileEnum({approved:packets.enumApproval,baseline:before,observed:enumState,labels:[...before.user_role.labels,'co_admin'],receipts:[receipt]}),'enum_verified_forward_requires_separate_approval')
 fails(inject(armed.forwardSql,"UPDATE supabase_migrations.schema_migrations SET statements=ARRAY['wrong'] WHERE version='20990101000000';"),/statement bytes drift/)
 fails(armed.forwardSql.replace("SELECT 'CO_FORWARD_PACKET_PASSED';","DO $late_failure$ BEGIN RAISE EXCEPTION 'injected late failure'; END $late_failure$;"),/injected late failure/)
 assert.deepEqual(coInventoryPin(capture(true)),coInventoryPin(enumState),'Late failure leaves exact committed enum-only state')
 for(const [mutation,pattern] of [
  ["SELECT set_config('request.jwt.claim.sub',md5('owner-user-1')::uuid::text,true); UPDATE public.purchase_orders SET notes='unexpected protected change';",/Protected\/authority data changed/],
  ['GRANT EXECUTE ON FUNCTION public.pilot_my_profile() TO anon;',/catalog delta identities/],
  ['GRANT SELECT ON private.co_orders TO authenticated;',/new object metadata drift/],
  ["UPDATE storage.buckets SET public=true WHERE id='co-evidence';",/Storage bucket delta/],
  ['INSERT INTO private.co_customer_state(customer_id) SELECT id FROM public.customers ORDER BY id LIMIT 1;',/not empty/],
 ])fails(armed.forwardSql.replace('CREATE TEMP TABLE co_packet_after',mutation+'\nCREATE TEMP TABLE co_packet_after'),pattern)
 assert.deepEqual(coInventoryPin(capture(true)),coInventoryPin(enumState),'Postflight refusals roll back all forward changes')
 assert.equal(run(armed.forwardSql).trim(),'CO_FORWARD_PACKET_PASSED')
 fails(armed.forwardSql,/baseline drift/)
 assert.equal(run(read('tests/database/co/rollout.sql')).trim(),'CO_FINAL_AUDIENCES_PASSED')
 assert.equal(run("SELECT has_function_privilege('service_role','public.pilot_my_profile()','EXECUTE');").trim(),'t','Legacy service grant preserved')
 // Actual role/provider attestation behavior under simulated defaults, not catalog-only proof.
 let fixture=read('tests/database/co/fixture.sql');assert.equal(fixture.split("current_database()<>'pilot_co_test'").length,2)
 run(fixture.replace("current_database()<>'pilot_co_test'","current_database()<>'pilot_co_rollout_test'"))
 let evidenceSql=read('tests/database/co/evidence.sql')
 const attestation=" PERFORM public.pilot_co_evidence_attest_v1((ctx->>'actor_id')::uuid,e,oid,'synthetic-v1',100,'application/pdf',repeat('a',64));"
 assert.equal(evidenceSql.split(attestation).length,2,'Exact local attestation helper required')
 evidenceSql=evidenceSql.replace(attestation," SET LOCAL ROLE service_role;\n IF current_user<>'service_role' THEN RAISE EXCEPTION 'Actual service role required'; END IF;\n"+attestation+"\n RESET ROLE;")
 const evidence=run(evidenceSql)
 assert.equal(evidence.split('\n').filter(x=>x==='CO_EVIDENCE_PASSED').length,1)
 for(const s of sources)assert.equal(read(s.path),s.sql,'Source changed during rollout validation')
 process.stdout.write(`CO_ACTUAL_FIXTURE_IDENTITY_REFUSALS_${identityProbes}_PASSED\nCO_ROLLOUT_REFUSALS_${probes}_PASSED\nCO_PROVIDER_DEFAULT_AUDIENCES_AND_ATTESTATION_PASSED\nCO_ATOMIC_ROLLOUT_LIFECYCLE_PASSED\n`)
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{runCoRollout()}catch(error){process.stderr.write(`${error.stdout??''}${error.stderr??error.stack}\n`);process.exitCode=1}}
