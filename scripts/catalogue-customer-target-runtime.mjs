// AUTHORED / UNRUN. CI-owned terminal disposable child only. No hosted/local DB use.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {catalogueFailfastBinding} from './catalogue-failfast-probe.mjs';
import {catalogueCaptureSourceBytes} from './catalogue-capture-source.mjs';
import {foundationTopLevelSql} from './catalogue-foundation.mjs';
import {catalogueCiConnection,catalogueCiIdentityGateSql,catalogueObservationSql,verifyCatalogueCiObservation} from './catalogue-ci-profile.mjs';
import {PsqlSession} from '../tests/database/catalogue-failfast/session.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=x=>createHash('sha256').update(x).digest('hex');
const quote=x=>`'${x.replaceAll("'","''")}'`;
export const targetRuntimePaths=Object.freeze({before:'tests/database/catalogue/before-foundation.sql',foundation:'supabase/catalogue/v1/01-foundation.sql',legacy:'tests/database/catalogue/legacy-columns.sql',roles:'tests/database/catalogue/roles.sql',target:'supabase/catalogue/v1/02-customer-target-tracking.sql',lifecycle:'tests/database/catalogue/customer-target-tracking.sql',authority:'tests/database/catalogue/customer-target-runtime-authority.sql',variants:'tests/database/catalogue/customer-target-runtime-variants.sql'});
const targetSha='e4567a9cd023aba3c1bdb4b84925c6a6bad1e931bf5a199ba41c2bf5e34924ca';
const suiteSha='0a6e5f1622b3aabd84e43e2c601720ca01ca06e58dcef70c3d9a06dc394b9bb5';
const include='\\ir ../../../supabase/catalogue/v1/02-customer-target-tracking.sql\n';
export function expandTargetLifecycle(suite,candidate,authority='') {
 assert.equal(sha(suite),suiteSha,'Exact reviewed lifecycle bytes required');assert.equal(sha(candidate),targetSha,'Exact reviewed adapter bytes required');
 assert.equal(suite.split(include).length,2);foundationTopLevelSql(candidate);if(authority)foundationTopLevelSql(authority);
 let checked=suite.replace(include,'');
 for(const name of ['target_rollback','missing_target_identity','assertion_only'])for(const statement of [`SAVEPOINT ${name};`,`ROLLBACK TO SAVEPOINT ${name};`]){
  const lines=checked.split('\n');assert.equal(lines.filter(line=>line===statement).length,1);checked=lines.filter(line=>line!==statement).join('\n');
 }
 foundationTopLevelSql(checked);
 return suite.replace(include,()=>candidate+'\n'+authority+'\n');
}
export const targetMarkers=Object.freeze(['CATALOGUE_TARGET_FOUNDATION_PASSED','CATALOGUE_TARGET_LIFECYCLE_PASSED','CATALOGUE_TARGET_VARIANTS_PASSED','CATALOGUE_TARGET_ROLLBACK_VERIFIED']);
const gate=(predicate,label)=>`SELECT (${predicate}) AS target_gate\n\\gset\n\\if :target_gate\n\\else\nSELECT 1/0 AS ${label};\n\\endif\n`;
const absent=`to_regclass('private.catalog_identity_v1') IS NULL AND to_regclass('private.catalog_cutover_v1') IS NULL AND to_regprocedure('private.catalog_customer_targets_mark_v1()') IS NULL AND to_regprocedure('private.catalog_customer_targets_assert_v1()') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='catalogue_foundation_inherited_probe') AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=md5('catalogue-foundation-actor-3')::uuid)`;
const sessionGate=()=>gate(`current_user='postgres' AND pg_backend_pid()=:'target_pid'::integer AND txid_current()=:'target_xid'::bigint AND (SELECT count(*)=1 AND bool_and(pid=pg_backend_pid() AND xid=txid_current()) FROM pg_temp.target_runtime_session)`,'target_session_refused');
function validateParts(parts){assert.deepEqual(Object.keys(parts).sort(),Object.keys(targetRuntimePaths).sort());for(const [name,sql]of Object.entries(parts))if(name!=='lifecycle')foundationTopLevelSql(sql);expandTargetLifecycle(parts.lifecycle,parts.target,parts.authority);}
export function buildTargetLifecycleSession(identity,parts){
 validateParts(parts);const mark=i=>`\\echo ${targetMarkers[i]} :target_pid :target_xid\n`;
 return `\\set ON_ERROR_STOP on\n\\o /dev/null\n${catalogueCiIdentityGateSql(identity)}${gate(absent,'target_preexisting_refused')}BEGIN;
SET LOCAL search_path=''; SET LOCAL standard_conforming_strings=on; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='3s'; SET LOCAL idle_in_transaction_session_timeout='30s';
SELECT pg_backend_pid() AS target_pid,txid_current() AS target_xid\n\\gset
CREATE TEMP TABLE target_runtime_session ON COMMIT DROP AS SELECT pg_backend_pid() pid,txid_current() xid;
${parts.before}\n${parts.foundation}\n${parts.legacy}\n${sessionGate()}${mark(0)}
${expandTargetLifecycle(parts.lifecycle,parts.target,parts.authority)}\n${sessionGate()}${mark(1)}
${parts.variants}\n${parts.roles}\n${sessionGate()}${mark(2)}ROLLBACK;
${catalogueCiIdentityGateSql(identity)}${gate(`${absent} AND pg_backend_pid()=:'target_pid'::integer AND to_regclass('pg_temp.target_runtime_session') IS NULL`,'target_rollback_refused')}${mark(3)}\\o\n`;
}
export function parseTargetOutput(output){
 assert.equal(typeof output,'string');assert.ok(output.endsWith('\n'));const lines=output.slice(0,-1).split('\n');assert.equal(lines.length,targetMarkers.length);let pid,xid;
 lines.forEach((line,i)=>{const m=line.match(/^([A-Z_]+) ([1-9][0-9]*) ([1-9][0-9]*)$/);assert.ok(m);assert.equal(m[1],targetMarkers[i]);if(i===0){pid=m[2];xid=m[3];}assert.equal(m[2],pid);assert.equal(m[3],xid);});return {backendPid:pid,transactionId:xid};
}
export function requireTargetPids(pids){assert.equal(pids.length,3);assert.ok(pids.every(x=>Number.isSafeInteger(x)&&x>0));assert.equal(new Set(pids).size,3);return pids;}
const uuid=x=>{assert.match(x,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);return quote(x)+'::uuid';};
export function targetAdvisoryBarrierSql(pid,id){
 assert.ok(Number.isSafeInteger(pid)&&pid>0);
 return `WITH k AS (SELECT hashtextextended('catalog_identity_v1:customer:' || ${uuid(id)}::text,1801427913) AS v)
SELECT EXISTS(SELECT 1 FROM pg_locks,k WHERE pid=${pid} AND locktype='advisory' AND mode='ExclusiveLock' AND granted
 AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND objsubid=1
 AND classid=((k.v >> 32) & 4294967295)::oid AND objid=(k.v & 4294967295)::oid)
 AND cardinality(pg_blocking_pids(${pid}))=0;`;
}
const customerA='10000000-0000-4000-8000-000000000071',customerB='10000000-0000-4000-8000-000000000072';
const actor="md5('catalogue-foundation-actor-3')::uuid";
const mark=(id,month)=>`INSERT INTO public.customer_targets(customer_id,year_month,set_by) VALUES(${uuid(id)},${quote(month)},${actor});`;
// The exception handler validates exact DETAIL/message then RE-RAISES. The
// caller observes a genuinely aborted transaction, not a swallowed exception.
export function targetExpectedContentionSql(kind){
 assert.ok(['advisory','relation'].includes(kind));
 const expected=kind==='advisory'?"detail IS DISTINCT FROM 'CATALOG_IDENTITY_BUSY'":"message !~ '^could not obtain lock on relation'";
 return `DO $target_contention$ DECLARE detail text;message text; BEGIN BEGIN ${mark(customerA,kind==='advisory'?'2098-03':'2098-05')}
 RAISE EXCEPTION 'Missing contention' USING ERRCODE='PCT01';
 EXCEPTION WHEN lock_not_available THEN GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL,message=MESSAGE_TEXT;
 IF ${expected} THEN RAISE EXCEPTION 'Wrong contention' USING ERRCODE='PCT02'; END IF; RAISE; END; END $target_contention$;`;
}
const begin=`BEGIN; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='1500ms'; SET LOCAL idle_in_transaction_session_timeout='30s'; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub',${actor}::text,true);`;
export async function executeTargetRaces({identity,connection,checkSource,Session=PsqlSession}){
 const sessions=[];const ok=async(s,sql)=>{const r=await s.query(sql);assert.equal(r.sqlstate,'00000');return r.stdout.trim();};
 try{
  for(const name of ['target_a','target_b','target_observer']){const s=new Session({name,env:connection});sessions.push(s);await ok(s,catalogueCiIdentityGateSql(identity)+"SET statement_timeout='8s'; SET idle_in_transaction_session_timeout='30s';\n\\set ON_ERROR_STOP off\nSELECT 1;");}
  const [a,b,observer]=sessions;const pids=requireTargetPids(await Promise.all(sessions.map(async s=>Number(await ok(s,'SELECT pg_backend_pid();')))));
  const verify=async()=>{checkSource();for(const s of sessions)verifyCatalogueCiObservation(JSON.parse(await ok(s,catalogueObservationSql('pilot_catalogue_test'))),identity,'pilot_catalogue_test');};
  await verify();await ok(a,begin);await ok(b,begin);await ok(a,mark(customerA,'2098-01'));await ok(b,mark(customerB,'2098-02'));
  assert.equal(await ok(observer,targetAdvisoryBarrierSql(pids[0],customerA)),'t');assert.equal(await ok(observer,targetAdvisoryBarrierSql(pids[1],customerB)),'t');
  assert.equal((await b.query(targetExpectedContentionSql('advisory'))).sqlstate,'55P03');
  // This second query independently proves that the losing transaction aborted.
  assert.equal((await b.query('SELECT 1;')).sqlstate,'25P02');await ok(b,'ROLLBACK;');
  await ok(a,mark(customerB,'2098-04'));await ok(a,'SET CONSTRAINTS public.catalog_customer_targets_assert_v1 IMMEDIATE; COMMIT;');
  assert.equal(await ok(observer,`SELECT (SELECT count(*)=2 FROM public.customer_targets WHERE customer_id IN(${uuid(customerA)},${uuid(customerB)}) AND year_month LIKE '2098-%') AND (SELECT count(*)=2 FROM private.catalog_identity_v1 WHERE kind='customer' AND id IN(${uuid(customerA)},${uuid(customerB)}) AND lifetime_state='used');`),'t');
  await verify();await ok(a,'BEGIN; LOCK TABLE private.catalog_identity_v1 IN ACCESS EXCLUSIVE MODE NOWAIT;');
  assert.equal(await ok(observer,`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=${pids[0]} AND locktype='relation' AND relation='private.catalog_identity_v1'::regclass AND mode='AccessExclusiveLock' AND granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database()));`),'t');
  await ok(b,begin);assert.equal((await b.query(targetExpectedContentionSql('relation'))).sqlstate,'55P03');assert.equal((await b.query('SELECT 1;')).sqlstate,'25P02');
  await ok(b,'ROLLBACK;');await ok(a,'ROLLBACK;');assert.equal(await ok(observer,`SELECT count(*)=0 FROM public.customer_targets WHERE customer_id=${uuid(customerA)} AND year_month='2098-05';`),'t');await verify();
  return {status:'BOUNDED_TARGET_RACES_PASSED',backendPids:pids,cases:['reversed_raw_target_statements','evidence_relation_contention']};
 }finally{await Promise.allSettled(sessions.map(s=>s.close()));}
}
export function buildTargetRaceSetup(identity,parts){
 validateParts(parts);
 // Existing baseline roles only. No inherited-role probes or cluster-role DDL
 // may escape the rollback lifecycle into the committed synthetic race setup.
 return `\\set ON_ERROR_STOP on\n\\o /dev/null\n${catalogueCiIdentityGateSql(identity)}${gate(absent,'target_race_preexisting_refused')}BEGIN;
SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='3s'; SET LOCAL search_path='';
INSERT INTO auth.users(id) VALUES(${actor});
INSERT INTO public.users(id,full_name,email,role,is_active) VALUES(${actor},'Fictional race executive','target-race@example.invalid','executive'::public.user_role,true);
${parts.foundation}\n${parts.target}
INSERT INTO public.customers(id,name) VALUES(${uuid(customerA)},'Fictional race A'),(${uuid(customerB)},'Fictional race B');
COMMIT;\n`;
}
export async function runCatalogueCustomerTargetRuntime({repoRoot=root,env=process.env,execute=execFileSync,Session=PsqlSession,bind=catalogueFailfastBinding,readSource=catalogueCaptureSourceBytes}={}){
 let cleanup='NOT_NEEDED',setupAttempted=false,binding,connection;
 const sync=(sql,db='pilot_catalogue_test')=>execute('psql',['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{cwd:repoRoot,env:{...connection,PGDATABASE:db,LC_ALL:'C'},input:sql,encoding:'utf8',timeout:180000,maxBuffer:512*1024,shell:false,stdio:['pipe','pipe','pipe']});
 try{
  binding=bind(repoRoot,env,execute);const identity=binding.identity;
  connection={...catalogueCiConnection(env,identity.source),PGDATABASE:'pilot_catalogue_test',LC_ALL:'C'};
  const checkSource=()=>assert.deepEqual(bind(repoRoot,env,execute),binding);
  const bytes=Object.fromEntries(Object.entries(targetRuntimePaths).map(([k,p])=>[k,readSource(repoRoot,p)]));const parts=Object.fromEntries(Object.entries(bytes).map(([k,b])=>[k,b.toString('utf8')]));validateParts(parts);
  const verify=()=>verifyCatalogueCiObservation(JSON.parse(sync(catalogueCiIdentityGateSql(identity)+catalogueObservationSql('pilot_catalogue_test'))),identity,'pilot_catalogue_test');
  checkSource();verify();const lifecycle=parseTargetOutput(sync(buildTargetLifecycleSession(identity,parts)));checkSource();verify();
  // Only after rollback is verified, install isolated fictional race substrate.
  // This is terminal use of the per-run child. Never run later DB jobs against it.
  setupAttempted=true;cleanup='CLEANUP_UNPROVEN';
  assert.equal(sync(buildTargetRaceSetup(identity,parts)),'','Unexpected setup output');
  checkSource();verify();const races=await executeTargetRaces({identity,connection,checkSource,Session});checkSource();verify();
  // A child marker alone cannot authorize disposal: verify the independently
  // bound root too, then use one literal name, no FORCE and no target parameters.
  // Identity-check/name-disposal is not atomic against a concurrent DBA replacing
  // the child. Only the exclusive per-run CI service makes this bounded design
  // appropriate. Never use it in shared/local/hosted database infrastructure.
  sync(`${catalogueCiIdentityGateSql(identity,'pilot_test')}DROP DATABASE pilot_catalogue_test;\n${gate("NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='pilot_catalogue_test')",'target_disposal_refused')}`,'pilot_test');cleanup='COMMITTED_SYNTHETIC_CHILD_DISPOSED';checkSource();
  return {format:'catalogue-customer-target-runtime-v1',status:'BOUNDED_TARGET_RUNTIME_PASSED',identity,lifecycle,races,cleanup,files:Object.entries(targetRuntimePaths).map(([k,path])=>({path,sha256:sha(bytes[k])})),implementationAccepted:false,hostedVerified:false,trackingReady:false,broaderLockGraph:'UNPROVEN'};
 }catch{
  // No blind teardown after an uncertain setup/identity result. The per-job
  // disposable CI service must be destroyed by CI; this runner claims no proof.
  const error=new Error('CATALOGUE_TARGET_RUNTIME_REFUSED');error.cleanup=setupAttempted?cleanup:'NOT_NEEDED';throw error;
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{assert.deepEqual(process.argv.slice(2),[]);const result=await runCatalogueCustomerTargetRuntime();console.log(JSON.stringify(result));}
 catch(error){console.error(JSON.stringify({status:'CATALOGUE_TARGET_RUNTIME_REFUSED',cleanup:error.cleanup??'NOT_NEEDED',implementationAccepted:false}));process.exitCode=1;}
}
