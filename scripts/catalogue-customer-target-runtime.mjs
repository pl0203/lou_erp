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
import {executeLifetimeAdmissionRaces} from '../tests/database/catalogue/lifetime-admission-races.mjs';
import {executeCatalogueCreateEditRaces} from '../tests/database/catalogue/create-edit-races.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=x=>createHash('sha256').update(x).digest('hex');
const quote=x=>`'${x.replaceAll("'","''")}'`;
export const targetRuntimePaths=Object.freeze({before:'tests/database/catalogue/before-foundation.sql',foundation:'supabase/catalogue/v1/01-foundation.sql',legacy:'tests/database/catalogue/legacy-columns.sql',roles:'tests/database/catalogue/roles.sql',target:'supabase/catalogue/v1/02-customer-target-tracking.sql',lifecycle:'tests/database/catalogue/customer-target-tracking.sql',authority:'tests/database/catalogue/customer-target-runtime-authority.sql',variants:'tests/database/catalogue/customer-target-runtime-variants.sql',orderCandidate:'supabase/catalogue/v1/04-order-boundaries.sql',coOrderCandidate:'supabase/catalogue/v1/new06-co-order-boundaries.sql',promotionOwnerGrammar:'supabase/catalogue/v1/02-promotion-owner-extraction.sql',visitGrammar:'supabase/catalogue/v1/new02-visit-reference-extraction.sql',lifetimeCandidate:'supabase/catalogue/v1/new07-lifetime-admission.sql',createEditCandidate:'supabase/catalogue/v1/new08-catalogue-create-edit.sql'});
const targetSha='e4567a9cd023aba3c1bdb4b84925c6a6bad1e931bf5a199ba41c2bf5e34924ca';
const suiteSha='82e49e5a6da51b084a02b8632a8e16241c8dd27a81fee6985325ecab37dfe026';
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
export const targetMarkers=Object.freeze(["CATALOGUE_TARGET_FOUNDATION_PASSED","CATALOGUE_TARGET_SETUP_PASSED","CATALOGUE_TARGET_INSTALL_PASSED","CATALOGUE_TARGET_AUTHORITY_PASSED","CATALOGUE_TARGET_EVENTS_PASSED","CATALOGUE_TARGET_CASCADE_DROP_PASSED","CATALOGUE_TARGET_CASCADE_ADD_PASSED","CATALOGUE_TARGET_CASCADE_PASSED","CATALOGUE_TARGET_AUTHENTICATED_PASSED","CATALOGUE_TARGET_MISSING_IDENTITY_PASSED","CATALOGUE_TARGET_ASSERTION_ONLY_PASSED","CATALOGUE_TARGET_LIFECYCLE_PASSED","CATALOGUE_TARGET_VARIANTS_PASSED","CATALOGUE_TARGET_ROLLBACK_VERIFIED"]);

export function instrumentTargetLifecycle(suite,candidate,authority){
 // Validate all original bytes before adding only fixed diagnostic echo lines.
 // No SQL statement or transaction boundary is changed, wrapped, or reordered.
 const plain=expandTargetLifecycle(suite,candidate,authority);assert.equal(typeof authority,'string');assert.ok(authority.length>0);
 const marker=i=>'\\echo '+targetMarkers[i]+' :target_pid :target_xid\n';
 const checkpoints=[
  [
    "SELECT pg_temp.foundation_assert((SELECT lifetime_state='unknown' FROM private.catalog_identity_v1 WHERE kind='customer' AND id=md5('target-fiction-3')::uuid),'savepoint rolls evidence back with target');\n",
    4
  ],
  [
    "ALTER TABLE public.customer_targets DROP CONSTRAINT customer_targets_customer_id_fkey;\n",
    5
  ],
  [
    "ALTER TABLE public.customer_targets ADD CONSTRAINT customer_targets_customer_id_fkey FOREIGN KEY(customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;\n",
    6
  ],
  [
    "SELECT pg_temp.foundation_assert((SELECT lifetime_state='used' AND deleted_at IS NOT NULL FROM private.catalog_identity_v1 WHERE kind='customer' AND id=md5('target-fiction-4')::uuid),'cascade OLD and parent tombstone retained');\n",
    7
  ],
  [
    "SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_identity_v1 WHERE lifetime_state='unused'),'no new unused allocation');\n",
    8
  ],
  [
    "ROLLBACK TO SAVEPOINT missing_target_identity;\n",
    9
  ],
  [
    "ROLLBACK TO SAVEPOINT assertion_only;\n",
    10
  ]
];
 let marked=suite;
 for(const [anchor,index]of checkpoints){
  assert.equal(suite.split(anchor).length,2,'Exact unique reviewed boundary required');
  marked=marked.replace(anchor,()=>anchor+marker(index));
 }
 assert.equal(marked.split(include).length,2);
 marked=marked.replace(include,()=>marker(1)+candidate+'\n'+marker(2)+authority+'\n'+marker(3));
 let restored=marked,prior=-1;
 for(let i=1;i<=10;i++){
  const line=marker(i);assert.equal(marked.split(line).length,2,'Fixed milestone must occur exactly once');
  const position=marked.indexOf(line);assert.ok(position>prior,'Fixed milestone order required');prior=position;
  restored=restored.replace(line,'');
 }
 assert.equal(restored,plain,'Diagnostics must preserve every original SQL byte');
 return marked;
}

const targetFailurePhases=Object.freeze(['initialization','binding','source-preflight','identity-preflight','lifecycle','lifecycle-parse','source-post-lifecycle','identity-post-lifecycle','race-setup','race-setup-parse','source-pre-races','identity-pre-races','races','source-post-races','identity-post-races','disposal','source-post-disposal']);
const lifecycleFailurePhases=Object.freeze(["FOUNDATION","TARGET_SETUP","TARGET_INSTALL","TARGET_AUTHORITY","TARGET_EVENTS","TARGET_CASCADE_DROP","TARGET_CASCADE_ADD","TARGET_CASCADE_EVENTS","TARGET_AUTHENTICATED","TARGET_MISSING_IDENTITY","TARGET_ASSERTION_ONLY","TARGET_SESSION_GATE","VARIANTS_AND_ROLES","ROLLBACK","COMPLETE"]);
const targetProcessKinds=Object.freeze(['NOT_APPLICABLE','UNKNOWN','EXIT_0','EXIT_1','EXIT_2','SCRIPT_ERROR','OTHER_NONZERO','SIGNAL','TIMEOUT','BUFFER_LIMIT','SPAWN_FAILURE','SESSION_SQLSTATE']);
const targetSyncFailurePhases=Object.freeze(['identity-preflight','lifecycle','identity-post-lifecycle','race-setup','identity-pre-races','identity-post-races','disposal']);
const targetQueryState=Symbol('validated target session SQLSTATE');
export function targetProcessExit(error){
 if(!error||typeof error!=='object')return 'UNKNOWN';
 if(error.code==='ETIMEDOUT')return 'TIMEOUT';
 if(['ENOBUFS','ERR_CHILD_PROCESS_STDIO_MAXBUFFER'].includes(error.code))return 'BUFFER_LIMIT';
 if(['ENOENT','EACCES'].includes(error.code))return 'SPAWN_FAILURE';
 if(typeof error.signal==='string'&&error.signal!=='')return 'SIGNAL';
 if(error.code!==undefined||error.signal!==null)return 'UNKNOWN';
 if([0,1,2,3].includes(error.status))return ['EXIT_0','EXIT_1','EXIT_2','SCRIPT_ERROR'][error.status];
 return Number.isSafeInteger(error.status)&&error.status>0?'OTHER_NONZERO':'UNKNOWN';
}
function targetMarkerPrefix(output){
 assert.equal(typeof output,'string');assert.ok(Buffer.byteLength(output)<=65536);
 if(output==='')return 0;assert.ok(output.endsWith('\n'));
 const lines=output.slice(0,-1).split('\n');assert.ok(lines.length<=targetMarkers.length);
 let pid,xid;for(let i=0;i<lines.length;i++){
  const m=lines[i].match(/^([A-Z_]+) ([1-9][0-9]{0,19}) ([1-9][0-9]{0,19})$/);assert.ok(m);assert.equal(m[1],targetMarkers[i]);
  if(i===0){pid=m[2];xid=m[3];}assert.equal(m[2],pid);assert.equal(m[3],xid);
 }return lines.length;
}
export function validateTargetFailureDiagnostic(diagnostic){
 assert.deepEqual(Object.keys(diagnostic),['phase','lifecyclePhase','processExit','sqlstate']);
 assert.ok([...targetFailurePhases,'unknown'].includes(diagnostic.phase));
 assert.ok(['NOT_APPLICABLE','UNKNOWN',...lifecycleFailurePhases].includes(diagnostic.lifecyclePhase));
 assert.ok(targetProcessKinds.includes(diagnostic.processExit));
 if(['lifecycle','lifecycle-parse'].includes(diagnostic.phase))assert.notEqual(diagnostic.lifecyclePhase,'NOT_APPLICABLE');else assert.equal(diagnostic.lifecyclePhase,'NOT_APPLICABLE');
 if(diagnostic.phase==='lifecycle-parse')assert.notEqual(diagnostic.lifecyclePhase,'COMPLETE');
 if(diagnostic.sqlstate!==null){assert.equal(typeof diagnostic.sqlstate,'string');assert.match(diagnostic.sqlstate,/^[0-9A-Z]{5}$/);}
 if(!targetSyncFailurePhases.includes(diagnostic.phase)&&diagnostic.phase!=='races'){
  assert.equal(diagnostic.processExit,'NOT_APPLICABLE');assert.equal(diagnostic.sqlstate,null);
 }else{
  assert.notEqual(diagnostic.processExit,'NOT_APPLICABLE');
  if(diagnostic.processExit==='SESSION_SQLSTATE'){
   assert.equal(diagnostic.phase,'races');assert.notEqual(diagnostic.sqlstate,null);
  }else if(diagnostic.sqlstate!==null){
   assert.ok(targetSyncFailurePhases.includes(diagnostic.phase));assert.equal(diagnostic.processExit,'SCRIPT_ERROR');
  }
 }
 return diagnostic;
}
function targetScriptSqlstate(stderr){
 if(typeof stderr!=='string'||Buffer.byteLength(stderr)>512*1024||!stderr.endsWith('\n')||stderr.includes('\r'))return null;
 const lines=stderr.slice(0,-1).split('\n'),first=lines.shift()?.match(/^ERROR:[ \t]+([A-Z0-9]{5}):[ \t]+[^\r\n]*$/);if(!first)return null;
 // Accept one fully framed verbose error only. Extra severity/client records,
 // notices, unlabeled continuation and duplicate/out-of-order details are unknown.
 const labels=['DETAIL','HINT','CONTEXT','LOCATION'];let prior=-1;
 for(const line of lines){
  const match=line.match(/^(DETAIL|HINT|CONTEXT|LOCATION):[ \t]+[^\r\n]+$/);if(!match)return null;
  const position=labels.indexOf(match[1]);if(position<=prior)return null;prior=position;
 }
 return first[1];
}
// Diagnostic only. Never use this classification to authorize acceptance or cleanup.
// Follow the existing helper runner's strict script-error extractor; mixed errors,
// malformed framing, signals and infrastructure failures never supply a SQLSTATE.
export function targetFailureDiagnostic(phase,error,parseOutput){
 const result={phase:targetFailurePhases.includes(phase)?phase:'unknown',lifecyclePhase:'NOT_APPLICABLE',processExit:'NOT_APPLICABLE',sqlstate:null};
 const execution=[...targetSyncFailurePhases,'races'];
 if(execution.includes(result.phase)){
  result.processExit=targetProcessExit(error);
  if(result.phase==='races'&&error?.[targetQueryState]!==undefined){
   result.processExit='SESSION_SQLSTATE';result.sqlstate=error[targetQueryState];
  }else if(result.phase!=='races'&&error?.status===3&&error.signal===null&&error.code===undefined)result.sqlstate=targetScriptSqlstate(error.stderr);
 }
 if(['lifecycle','lifecycle-parse'].includes(result.phase)){
  result.lifecyclePhase='UNKNOWN';
  try{const count=targetMarkerPrefix(result.phase==='lifecycle'?error?.stdout:parseOutput);result.lifecyclePhase=result.phase==='lifecycle-parse'&&count===targetMarkers.length?'UNKNOWN':lifecycleFailurePhases[count];}catch{}
 }
 return Object.freeze(validateTargetFailureDiagnostic(result));
}

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
${instrumentTargetLifecycle(parts.lifecycle,parts.target,parts.authority)}\n${sessionGate()}${mark(11)}
${parts.variants}\n${parts.roles}\n${sessionGate()}${mark(12)}ROLLBACK;
${catalogueCiIdentityGateSql(identity)}${gate(`${absent} AND pg_backend_pid()=:'target_pid'::integer AND to_regclass('pg_temp.target_runtime_session') IS NULL`,'target_rollback_refused')}${mark(13)}\\o\n`;
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
// Fixed status/recovery proof, sharing only the already guarded terminal child.
const statusCustomerA='10000000-0000-4000-8000-000000000073',statusCustomerB='10000000-0000-4000-8000-000000000074';
const statusActorA='5e186f1c-c18f-6670-7b74-d7d2f4e8a28e',statusActorB='20000000-0000-4000-8000-000000000073';
const statusRequestA='30000000-0000-4000-8000-000000000101',statusRequestLater='30000000-0000-4000-8000-000000000102';
const statusRequestAbandon='30000000-0000-4000-8000-000000000103',statusRequestStale='30000000-0000-4000-8000-000000000104',statusRequestSnapshot='30000000-0000-4000-8000-000000000105';
export const statusRecoveryCases=Object.freeze(['inflight_dispatch_and_recovery_busy','committed_fresh_session_replay','replay_after_later_status_change','abandonment_fences_delayed_dispatch','actor_request_namespace_isolation','stale_master_version_refuses','repeatable_read_terminal_safety']);
export function statusRequestBarrierSql(pid,actorId,requestId){
 assert.ok(Number.isSafeInteger(pid)&&pid>0);
 return `WITH k AS (SELECT hashtextextended('catalog_request_v1:' || ${uuid(actorId)}::text || ':' || ${uuid(requestId)}::text,1801427914) AS v)
SELECT EXISTS(SELECT 1 FROM pg_locks,k WHERE pid=${pid} AND locktype='advisory' AND mode='ExclusiveLock' AND granted
 AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND objsubid=1
 AND classid=((k.v >> 32) & 4294967295)::oid AND objid=(k.v & 4294967295)::oid)
 AND cardinality(pg_blocking_pids(${pid}))=0;`;
}
export function statusBeginSql(actorId,isolation='READ COMMITTED'){
 assert.ok(['READ COMMITTED','REPEATABLE READ'].includes(isolation));uuid(actorId);
 return `BEGIN ISOLATION LEVEL ${isolation}; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='1500ms'; SET LOCAL idle_in_transaction_session_timeout='30s'; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub',${quote(actorId)},true);`;
}
export function validateStatusReceipt(receipt,{actorId,requestId,targetId,beforeVersion,beforeEnabled,afterVersion,afterEnabled}){
 assert.equal(typeof receipt?.committed_at,'string');assert.match(receipt.committed_at,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
 assert.deepEqual(receipt,{version:1,request_id:requestId,actor_id:actorId,operation:'set_enabled',kind:'customer',id:targetId,before:{catalog_version:beforeVersion,is_enabled:beforeEnabled},after:{catalog_version:afterVersion,is_enabled:afterEnabled},committed_at:receipt.committed_at});return receipt;
}
const statusCommand=(requestId,targetId,version,enabled)=>`SELECT public.pilot_catalog_transaction_v1(${uuid(requestId)},'set_enabled',${quote(JSON.stringify({kind:'customer',id:targetId,expected_version:version,is_enabled:enabled}))}::jsonb);`;
const statusReconcile=(requestId,abandon)=>`SELECT public.pilot_reconcile_catalog_v1(${uuid(requestId)},${abandon?'true':'false'});`;
// Re-raise only the named application error, leaving an actually aborted client
// transaction. A swallowed exception or a different 55P03 never passes.
function statusRefusalSql(statement,state,detail){
 assert.ok(['55P03','22023','40001'].includes(state));assert.ok(['CATALOG_REQUEST_BUSY','CATALOG_REQUEST_ABANDONED','CATALOG_VERSION_CONFLICT'].includes(detail));
 assert.ok(statement.startsWith('SELECT public.pilot_'));
 return `DO $status_refusal$ DECLARE detail text; BEGIN BEGIN ${statement.replace(/^SELECT /,'PERFORM ')}
 RAISE EXCEPTION 'Missing status refusal' USING ERRCODE='PCT03';
 EXCEPTION WHEN SQLSTATE '${state}' THEN GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL;
 IF detail IS DISTINCT FROM '${detail}' THEN RAISE EXCEPTION 'Wrong status refusal' USING ERRCODE='PCT04'; END IF; RAISE; END; END $status_refusal$;`;
}
const statusSnapshotConflictSql=`DO $status_snapshot$ DECLARE state text;constraint_name text;schema text;relation text;message text; BEGIN BEGIN
 PERFORM public.pilot_reconcile_catalog_v1(${uuid(statusRequestSnapshot)},true);
 RAISE EXCEPTION 'Stale snapshot returned a terminal result' USING ERRCODE='PCT05';
 EXCEPTION WHEN unique_violation OR serialization_failure THEN
 GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE,constraint_name=CONSTRAINT_NAME,schema=SCHEMA_NAME,relation=TABLE_NAME,message=MESSAGE_TEXT;
 IF (state='23505' AND (constraint_name IS DISTINCT FROM 'catalog_requests_v1_pkey' OR schema IS DISTINCT FROM 'private' OR relation IS DISTINCT FROM 'catalog_requests_v1'))
 OR (state='40001' AND message IS DISTINCT FROM 'could not serialize access due to concurrent update') THEN
 RAISE EXCEPTION 'Wrong stale snapshot conflict' USING ERRCODE='PCT06'; END IF; RAISE; END; END $status_snapshot$;`;

export async function executeTargetRaces({identity,connection,checkSource,Session=PsqlSession}){
 const sessions=[];const expected=async(s,sql,state)=>{
  const r=await s.query(sql);assert.equal(typeof r.sqlstate,'string');assert.match(r.sqlstate,/^[0-9A-Z]{5}$/);
  if(r.sqlstate!==state){const error=new Error('CATALOGUE_TARGET_SQLSTATE_REFUSED');error[targetQueryState]=r.sqlstate;throw error;}return r;
 };const ok=async(s,sql)=>(await expected(s,sql,'00000')).stdout.trim();
 try{
  for(const name of ['target_a','target_b','target_observer']){const s=new Session({name,env:connection});sessions.push(s);await ok(s,catalogueCiIdentityGateSql(identity)+"SET statement_timeout='8s'; SET idle_in_transaction_session_timeout='30s';\n\\set ON_ERROR_STOP off\nSELECT 1;");}
  const [a,b,observer]=sessions;const pids=requireTargetPids(await Promise.all(sessions.map(async s=>Number(await ok(s,'SELECT pg_backend_pid();')))));
  let retiredSession;const verify=async()=>{checkSource();for(const s of sessions.filter(s=>s!==retiredSession))verifyCatalogueCiObservation(JSON.parse(await ok(s,catalogueObservationSql('pilot_catalogue_test'))),identity,'pilot_catalogue_test');};
  await verify();await ok(a,begin);await ok(b,begin);await ok(a,mark(customerA,'2098-01'));await ok(b,mark(customerB,'2098-02'));
  assert.equal(await ok(observer,targetAdvisoryBarrierSql(pids[0],customerA)),'t');assert.equal(await ok(observer,targetAdvisoryBarrierSql(pids[1],customerB)),'t');
  await expected(b,targetExpectedContentionSql('advisory'),'55P03');
  // This second query independently proves that the losing transaction aborted.
  await expected(b,'SELECT 1;','25P02');await ok(b,'ROLLBACK;');
  await ok(a,mark(customerB,'2098-04'));await ok(a,'SET CONSTRAINTS public.catalog_customer_targets_assert_v1 IMMEDIATE; COMMIT;');
  assert.equal(await ok(observer,`SELECT (SELECT count(*)=2 FROM public.customer_targets WHERE customer_id IN(${uuid(customerA)},${uuid(customerB)}) AND year_month LIKE '2098-%') AND (SELECT count(*)=2 FROM private.catalog_identity_v1 WHERE kind='customer' AND id IN(${uuid(customerA)},${uuid(customerB)}) AND lifetime_state='used');`),'t');
  await verify();await ok(a,'BEGIN; LOCK TABLE private.catalog_identity_v1 IN ACCESS EXCLUSIVE MODE NOWAIT;');
  assert.equal(await ok(observer,`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=${pids[0]} AND locktype='relation' AND relation='private.catalog_identity_v1'::regclass AND mode='AccessExclusiveLock' AND granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database()));`),'t');
  await ok(b,begin);await expected(b,targetExpectedContentionSql('relation'),'55P03');await expected(b,'SELECT 1;','25P02');
  await ok(b,'ROLLBACK;');await ok(a,'ROLLBACK;');assert.equal(await ok(observer,`SELECT count(*)=0 FROM public.customer_targets WHERE customer_id=${uuid(customerA)} AND year_month='2098-05';`),'t');await verify();
  // The original two target races above are unchanged. Every status RPC below
  // enters through authenticated + a fictional JWT, never the definer role.
  const start=async(s,actorId=statusActorA,isolation='READ COMMITTED')=>{
   await ok(s,statusBeginSql(actorId,isolation));
   assert.equal(await ok(s,`SELECT current_user='authenticated' AND auth.uid()=${uuid(actorId)} AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) AND row_security_active('public.customers');`),'t');
  };
  const json=async(s,sql)=>JSON.parse(await ok(s,sql));
  const snapshot=()=>json(observer,`SELECT jsonb_build_object('masters',(SELECT jsonb_agg(jsonb_build_object('id',id,'version',catalog_version::text,'enabled',is_enabled) ORDER BY id) FROM public.customers WHERE id IN(${uuid(statusCustomerA)},${uuid(statusCustomerB)})),'identities',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM private.catalog_identity_v1 i WHERE kind='customer' AND id IN(${uuid(statusCustomerA)},${uuid(statusCustomerB)})),'requests',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY actor_id,request_id),'[]'::jsonb) FROM private.catalog_requests_v1 r));`);
  const state=async(versionA,enabledA,versionB,enabledB,requests)=>assert.equal(await ok(observer,`SELECT (SELECT catalog_version=${versionA} AND is_enabled=${enabledA} FROM public.customers WHERE id=${uuid(statusCustomerA)}) AND (SELECT catalog_version=${versionB} AND is_enabled=${enabledB} FROM public.customers WHERE id=${uuid(statusCustomerB)}) AND (SELECT last_version=${versionA} FROM private.catalog_identity_v1 WHERE kind='customer' AND id=${uuid(statusCustomerA)}) AND (SELECT last_version=${versionB} FROM private.catalog_identity_v1 WHERE kind='customer' AND id=${uuid(statusCustomerB)}) AND (SELECT count(*)=${requests} FROM private.catalog_requests_v1);`),'t');
  const receipt=(value,actorId,requestId,targetId,beforeVersion,beforeEnabled,afterVersion,afterEnabled)=>validateStatusReceipt(value,{actorId,requestId,targetId,beforeVersion,beforeEnabled,afterVersion,afterEnabled});
  const firstCommand=statusCommand(statusRequestA,statusCustomerA,'1',false);
  await state(1,true,1,true,0);const beforeCommand=await snapshot();
  await start(a);const original=receipt(await json(a,firstCommand),statusActorA,statusRequestA,statusCustomerA,'1',true,'2',false);
  assert.equal(await ok(observer,statusRequestBarrierSql(pids[0],statusActorA,statusRequestA)),'t');
  // The first dispatch is still uncommitted and owns the observed request key.
  for(const sql of [firstCommand,statusReconcile(statusRequestA,false),statusReconcile(statusRequestA,true)]){
   await start(b);await expected(b,statusRefusalSql(sql,'55P03','CATALOG_REQUEST_BUSY'),'55P03');
   await expected(b,'SELECT 1;','25P02');assert.deepEqual(await snapshot(),beforeCommand);await ok(b,'ROLLBACK;');
  }
  await ok(a,'COMMIT;');await state(2,false,1,true,1);await verify();
  // The exact replay connection must be born AFTER the winning commit.
  await b.close();retiredSession=b;const replay=new Session({name:'target_status_replay',env:connection});sessions.push(replay);
  await ok(replay,catalogueCiIdentityGateSql(identity)+"SET statement_timeout='8s'; SET idle_in_transaction_session_timeout='30s';\n\\set ON_ERROR_STOP off\nSELECT 1;");
  const replayPid=Number(await ok(replay,'SELECT pg_backend_pid();'));assert.ok(Number.isSafeInteger(replayPid)&&replayPid>0);assert.equal(new Set([...pids,replayPid]).size,4);await verify();
  const committed={status:'committed',receipt:original},afterCommit=await snapshot();
  await start(replay);assert.deepEqual(await json(replay,firstCommand),original);
  for(const abandon of [false,true])assert.deepEqual(await json(replay,statusReconcile(statusRequestA,abandon)),committed);
  await ok(replay,'COMMIT;');assert.deepEqual(await snapshot(),afterCommit);await state(2,false,1,true,1);
  await start(replay);receipt(await json(replay,statusCommand(statusRequestLater,statusCustomerA,'2',true)),statusActorA,statusRequestLater,statusCustomerA,'2',false,'3',true);await ok(replay,'COMMIT;');
  await state(3,true,1,true,2);const afterLater=await snapshot();await start(replay);
  assert.deepEqual(await json(replay,firstCommand),original);assert.deepEqual(await json(replay,statusReconcile(statusRequestA,true)),committed);
  await ok(replay,'COMMIT;');assert.deepEqual(await snapshot(),afterLater);await verify();
  // Different actors may own the same request UUID concurrently. One abandons;
  // the other commits, and neither terminal state may be reinterpreted.
  await start(replay);assert.deepEqual(await json(replay,statusReconcile(statusRequestAbandon,true)),{status:'abandoned'});
  assert.equal(await ok(observer,statusRequestBarrierSql(replayPid,statusActorA,statusRequestAbandon)),'t');
  await start(a,statusActorB);const other=receipt(await json(a,statusCommand(statusRequestAbandon,statusCustomerB,'1',false)),statusActorB,statusRequestAbandon,statusCustomerB,'1',true,'2',false);
  assert.equal(await ok(observer,statusRequestBarrierSql(pids[0],statusActorB,statusRequestAbandon)),'t');
  await ok(replay,'COMMIT;');await ok(a,'COMMIT;');await state(3,true,2,false,4);const afterAbandon=await snapshot();
  await start(a);await expected(a,statusRefusalSql(statusCommand(statusRequestAbandon,statusCustomerA,'3',false),'22023','CATALOG_REQUEST_ABANDONED'),'22023');
  await expected(a,'SELECT 1;','25P02');assert.deepEqual(await snapshot(),afterAbandon);await ok(a,'ROLLBACK;');
  await start(replay);assert.deepEqual(await json(replay,statusReconcile(statusRequestAbandon,false)),{status:'abandoned'});await ok(replay,'COMMIT;');
  await start(a,statusActorB);assert.deepEqual(await json(a,statusReconcile(statusRequestAbandon,true)),{status:'committed',receipt:other});await ok(a,'COMMIT;');assert.deepEqual(await snapshot(),afterAbandon);
  await start(replay);await expected(replay,statusRefusalSql(statusCommand(statusRequestStale,statusCustomerA,'2',false),'40001','CATALOG_VERSION_CONFLICT'),'40001');
  await expected(replay,'SELECT 1;','25P02');assert.deepEqual(await snapshot(),afterAbandon);await ok(replay,'ROLLBACK;');await verify();
  // A real master read pins the RR snapshot before A commits, without first
  // reserving the request key. Unknown is safe; false abandonment is not.
  await start(replay,statusActorA,'REPEATABLE READ');assert.equal(await ok(replay,`SELECT catalog_version::text FROM public.customers WHERE id=${uuid(statusCustomerA)};`),'3');
  await start(a);const snapshotWinner=receipt(await json(a,statusCommand(statusRequestSnapshot,statusCustomerA,'3',false)),statusActorA,statusRequestSnapshot,statusCustomerA,'3',true,'4',false);await ok(a,'COMMIT;');
  await state(4,false,2,false,5);const afterSnapshotWinner=await snapshot();
  assert.deepEqual(await json(replay,statusReconcile(statusRequestSnapshot,false)),{status:'unknown'});
  const conflict=await replay.query(statusSnapshotConflictSql);assert.ok(['23505','40001'].includes(conflict.sqlstate));
  await expected(replay,'SELECT 1;','25P02');assert.deepEqual(await snapshot(),afterSnapshotWinner);await ok(replay,'ROLLBACK;');
  await start(replay);for(const abandon of [false,true])assert.deepEqual(await json(replay,statusReconcile(statusRequestSnapshot,abandon)),{status:'committed',receipt:snapshotWinner});await ok(replay,'COMMIT;');
  assert.deepEqual(await snapshot(),afterSnapshotWinner);await state(4,false,2,false,5);await verify();
  const statusRecovery={status:'BOUNDED_STATUS_RECOVERY_RACES_PASSED',replayBackendPid:replayPid,cases:statusRecoveryCases};
  const lifetimeAdmission=await executeLifetimeAdmissionRaces({a,b:replay,observer,query:ok,verify});
  const createEdit=await executeCatalogueCreateEditRaces({a,b:replay,observer,query:ok,expectState:expected,verify});
  return {status:'BOUNDED_TARGET_RACES_PASSED',backendPids:pids,cases:['reversed_raw_target_statements','evidence_relation_contention'],statusRecovery,lifetimeAdmission,createEdit};
 }finally{await Promise.allSettled(sessions.map(s=>s.close()));}
}
export function buildTargetRaceSetup(identity,parts){
 validateParts(parts);
 // Existing baseline roles only. No inherited-role probes or cluster-role DDL
 // may escape the rollback lifecycle into the committed synthetic race setup.
 return `\\set ON_ERROR_STOP on\n\\o /dev/null\n${catalogueCiIdentityGateSql(identity)}${gate(absent,'target_race_preexisting_refused')}BEGIN;
SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='3s'; SET LOCAL search_path='';
INSERT INTO auth.users(id) VALUES(${actor}),(${uuid(statusActorB)});
INSERT INTO public.users(id,full_name,email,role,is_active) VALUES(${actor},'Fictional race executive','target-race@example.invalid','executive'::public.user_role,true),(${uuid(statusActorB)},'Fictional status race executive','status-race@example.invalid','executive'::public.user_role,true);
${parts.foundation}\n${parts.target}
${parts.orderCandidate}\n${parts.coOrderCandidate}\n${parts.promotionOwnerGrammar}\n${parts.visitGrammar}\n${parts.lifetimeCandidate}\n${parts.createEditCandidate}
INSERT INTO public.products(id,name,sku) VALUES('10000000-0000-4000-8000-000000000091','Fictional drain product','LIFETIME-DRAIN');
INSERT INTO public.customers(id,name) VALUES(${uuid(customerA)},'Fictional race A'),(${uuid(customerB)},'Fictional race B'),(${uuid(statusCustomerA)},'Fictional status race A'),(${uuid(statusCustomerB)},'Fictional status race B');
COMMIT;\n`;
}
export async function runCatalogueCustomerTargetRuntime({repoRoot=root,env=process.env,execute=execFileSync,Session=PsqlSession,bind=catalogueFailfastBinding,readSource=catalogueCaptureSourceBytes}={}){
 let cleanup='NOT_NEEDED',setupAttempted=false,binding,connection,phase='initialization',lifecycleOutput;
 const sync=(sql,db='pilot_catalogue_test')=>execute('psql',['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{cwd:repoRoot,env:{...connection,PGDATABASE:db,LC_ALL:'C'},input:sql,encoding:'utf8',timeout:180000,maxBuffer:512*1024,shell:false,stdio:['pipe','pipe','pipe']});
 try{
  phase='binding';binding=bind(repoRoot,env,execute);const identity=binding.identity;
  connection={...catalogueCiConnection(env,identity.source),PGDATABASE:'pilot_catalogue_test',LC_ALL:'C'};
  const checkSource=()=>assert.deepEqual(bind(repoRoot,env,execute),binding);
  phase='source-preflight';const bytes=Object.fromEntries(Object.entries(targetRuntimePaths).map(([k,p])=>[k,readSource(repoRoot,p)]));const parts=Object.fromEntries(Object.entries(bytes).map(([k,b])=>[k,b.toString('utf8')]));validateParts(parts);
  const verify=()=>verifyCatalogueCiObservation(JSON.parse(sync(catalogueCiIdentityGateSql(identity)+catalogueObservationSql('pilot_catalogue_test'))),identity,'pilot_catalogue_test');
  checkSource();phase='identity-preflight';verify();
  phase='lifecycle';lifecycleOutput=sync(buildTargetLifecycleSession(identity,parts));phase='lifecycle-parse';const lifecycle=parseTargetOutput(lifecycleOutput);
  phase='source-post-lifecycle';checkSource();phase='identity-post-lifecycle';verify();
  // Only after rollback is verified, install isolated fictional race substrate.
  // This is terminal use of the per-run child. Never run later DB jobs against it.
  setupAttempted=true;cleanup='CLEANUP_UNPROVEN';
  phase='race-setup';const setupOutput=sync(buildTargetRaceSetup(identity,parts));phase='race-setup-parse';assert.equal(setupOutput,'','Unexpected setup output');
  phase='source-pre-races';checkSource();phase='identity-pre-races';verify();
  phase='races';const races=await executeTargetRaces({identity,connection,checkSource,Session});
  phase='source-post-races';checkSource();phase='identity-post-races';verify();
  // A child marker alone cannot authorize disposal: verify the independently
  // bound root too, then use one literal name, no FORCE and no target parameters.
  // Identity-check/name-disposal is not atomic against a concurrent DBA replacing
  // the child. Only the exclusive per-run CI service makes this bounded design
  // appropriate. Never use it in shared/local/hosted database infrastructure.
  phase='disposal';sync(`${catalogueCiIdentityGateSql(identity,'pilot_test')}DROP DATABASE pilot_catalogue_test;\n${gate("NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='pilot_catalogue_test')",'target_disposal_refused')}`,'pilot_test');cleanup='COMMITTED_SYNTHETIC_CHILD_DISPOSED';phase='source-post-disposal';checkSource();
  return {format:'catalogue-customer-target-runtime-v1',status:'BOUNDED_TARGET_RUNTIME_PASSED',identity,lifecycle,races,cleanup,files:Object.entries(targetRuntimePaths).map(([k,path])=>({path,sha256:sha(bytes[k])})),implementationAccepted:false,hostedVerified:false,trackingReady:false,broaderLockGraph:'UNPROVEN'};
 }catch(cause){
  // No blind teardown after an uncertain setup/identity result. The per-job
  // disposable CI service must be destroyed by CI; this runner claims no proof.
  const error=new Error('CATALOGUE_TARGET_RUNTIME_REFUSED');error.cleanup=setupAttempted?cleanup:'NOT_NEEDED';error.diagnostic=targetFailureDiagnostic(phase,cause,lifecycleOutput);throw error;
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{assert.deepEqual(process.argv.slice(2),[]);const result=await runCatalogueCustomerTargetRuntime();console.log(JSON.stringify(result));}
 catch(error){console.error(JSON.stringify({status:'CATALOGUE_TARGET_RUNTIME_REFUSED',cleanup:error.cleanup??'NOT_NEEDED',diagnostic:error.diagnostic??targetFailureDiagnostic('initialization'),implementationAccepted:false}));process.exitCode=1;}
}
