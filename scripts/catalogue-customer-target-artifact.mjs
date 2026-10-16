// Source-reviewed wrapper only. Runtime remains AUTHORED / UNRUN until separately authorized.
// Terminal use of an exclusively job-owned PostgreSQL service, never a shared/local/hosted DB.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync,mkdirSync,writeFileSync,readFileSync,renameSync,readdirSync,openSync,fstatSync,closeSync,constants} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {catalogueFailfastBinding} from './catalogue-failfast-probe.mjs';
import {catalogueCaptureSourceBytes,cataloguePublicSourcePaths} from './catalogue-capture-source.mjs';
import {catalogueCiIdentity} from './catalogue-ci-profile.mjs';
const defaultRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..'),sha=x=>createHash('sha256').update(x).digest('hex');
export const targetRuntimeReviewedFiles=Object.freeze([
 {
  "path": "scripts/catalogue-customer-target-runtime.mjs",
  "sha256": "55fd224618f475128a0cceb7f12d8f43375965c67f30ffe28abd245a17bb974f"
 },
 {
  "path": "supabase/catalogue/v1/02-customer-target-tracking.sql",
  "sha256": "e4567a9cd023aba3c1bdb4b84925c6a6bad1e931bf5a199ba41c2bf5e34924ca"
 },
 {
  "path": "tests/catalogue-ci/customer-target-runtime.node.mjs",
  "sha256": "1e230d7ef835fa0a60f78d2ac337faf841e35abeb0fbf796ae67cc58bb9fe14c"
 },
 {
  "path": "tests/catalogue-ci/customer-target-tracking.node.mjs",
  "sha256": "bc15e5f94bb83e796f5cc39a1bfba9ef6aabd4cdc71be24e2350749d8b9c3394"
 },
 {
  "path": "tests/database/catalogue/customer-target-race-spec.md",
  "sha256": "d60bb2d91d24072f48da7a86b1bc60ce86f5adcc88ece4feec1968030a783d25"
 },
 {
  "path": "tests/database/catalogue/customer-target-races.mjs",
  "sha256": "baf9524fba4726179e8f01457d003b77769affc7e69c3950a0fbca61ab168139"
 },
 {
  "path": "tests/database/catalogue/customer-target-runtime-authority.sql",
  "sha256": "f5153099679cacfcbc65bbd5325cc9e6bd18e94b1e0643d00be18d98aa69247e"
 },
 {
  "path": "tests/database/catalogue/customer-target-runtime-variants.sql",
  "sha256": "7df904baf7dc731fd426bfeb542ffa88cd7751b0944e40daf569ae3699eec985"
 },
 {
  "path": "tests/database/catalogue/customer-target-tracking.sql",
  "sha256": "82e49e5a6da51b084a02b8632a8e16241c8dd27a81fee6985325ecab37dfe026"
 },
 {
  "path": "tests/database/catalogue/lifetime-admission-races.mjs",
  "sha256": "14288f2240ff45de31f32493f5640003ae332e1533554c39ef56a252c11abbb3"
 },
 {
  "path": "supabase/catalogue/v1/04-order-boundaries.sql",
  "sha256": "db6d2fc9383d73a631622261d5fd2206b32303dbe7a9966a490be915e454d601"
 },
 {
  "path": "supabase/catalogue/v1/new06-co-order-boundaries.sql",
  "sha256": "f3621edc77272194db16f98dc1f3174db75d28fe712afd0b024672c5270d801f"
 },
 {
  "path": "supabase/catalogue/v1/02-promotion-owner-extraction.sql",
  "sha256": "d53ad17d77fbafbf8542c29fbcd04a3b3457916d296d0f2bf28df78a1389affc"
 },
 {
  "path": "supabase/catalogue/v1/new02-visit-reference-extraction.sql",
  "sha256": "5d64d14d3ebc2d7c075d8aba2d49fafece9f970235a54620393577ff2bfec71e"
 },
 {
  "path": "supabase/catalogue/v1/new07-lifetime-admission.sql",
  "sha256": "12120f0238263572eefa23d1bf3bbc5cc90de506546f6f76ba43888ed3eef087"
 },
 {
  "path": "supabase/catalogue/v1/new08-catalogue-create-edit.sql",
  "sha256": "1c583c2acb7a1660262fe4e080b75bed7c81d701d4cfe24cdd68e6ea7d40eb00"
 },
 {
  "path": "tests/database/catalogue/create-edit-races.mjs",
  "sha256": "6829741eb8ffae0dde167a9b3190372598e6b24a88afb5a8b35059e420b1fc9d"
 },
 {
  "path": "tests/catalogue-ci/create-edit-races.node.mjs",
  "sha256": "e16ec511ce06efb71d390b5b516f5bb4e4416db8434c7ca8c09fea2f99298daa"
 },
 {
  "path": "tests/database/catalogue/raw-caller-compatibility.sql",
  "sha256": "26a4e970ff53d595f36fecfd270c414473a64992c2c603aa0d7d9da2a73ae0b1"
 },
 {
  "path": "supabase/catalogue/v1/02-po-reference-extraction.sql",
  "sha256": "934108fd704a12edb73e8ff35ee288fa8ec90228d80a8151ef6f755e91b6a660"
 },
 {
  "path": "supabase/catalogue/v1/02-co-reference-extraction.sql",
  "sha256": "4dd6695b14a3587e43bd76df04abfa99916bf49b33344e99660a57ab5ebc12f9"
 },
 {
  "path": "supabase/catalogue/v1/02-co-draft-reference-extraction.sql",
  "sha256": "ebdc135249aacc7c297fb88ec12640a0c5a7da3cd5cfa76c9f2adfd8050d8aa5"
 },
 {
  "path": "supabase/catalogue/v1/02-retired-co-line-resolution.sql",
  "sha256": "361e4089150bc338268926e5c48db2e76afedff024f4b684118d022990238591"
 },
 {
  "path": "supabase/catalogue/v1/new02-nonco-lineage-resolution.sql",
  "sha256": "9417cef406eaa4ea511bb50f77f3e16dba710cdebbf09d7c7c62d438c8864a4f"
 },
 {
  "path": "supabase/catalogue/v1/new09-checked-boundaries.sql",
  "sha256": "549fe757776630e84562f733751983abb82df536985a665cb4610210b889ce03"
 },
 {
  "path": "supabase/catalogue/v1/new10-guarded-delete.sql",
  "sha256": "46c0ffb88a515e07deed7a6d86381c53b3e971bc8ea24721b429a418bca095b2"
 },
 {
  "path": "supabase/catalogue/v1/new11-master-completion-hooks.sql",
  "sha256": "2a642a0adcb935755d2d6b127ba50c517328a85f3b225de4658a751f48834e71"
 },
 {
  "path": "tests/database/catalogue/checked-boundaries.sql",
  "sha256": "96e1121635373cbd0c64670aa50af047407dea324ef15ed645faea7b21c4b760"
 },
 {
  "path": "tests/database/catalogue/guarded-delete.sql",
  "sha256": "e8d82a9e7da9bec21f6dc450eccb8d045f0f2c20d3193d4a53f1a9a8a629ecc5"
 },
 {
  "path": "tests/database/catalogue/completion-races.mjs",
  "sha256": "3b4b117182914dca1915837b55692f4e214249288d275a994ba672eec1d47c8d"
 },
 {
  "path": "tests/catalogue-ci/completion-races.node.mjs",
  "sha256": "a7a939b5a375bab74d26d0cd9a11fb5180a716cf03c2bfde420e286cd5ec5bb3"
 },
 {
  "path": "tests/catalogue-ci/checked-boundaries.node.mjs",
  "sha256": "3d15eb1f8d714257fa8c5be1cc6ee30dad15b07e14048fe18a940ba9954b64e2"
 },
 {
  "path": "tests/catalogue-ci/guarded-delete.node.mjs",
  "sha256": "2ac30750e7d6d6e80c7f15244100fc88a388e410ee86640832a55dadbdc1637c"
 },
 {
  "path": "tests/catalogue-ci/master-completion-hooks.node.mjs",
  "sha256": "d54fe6434fe9d7d5cde2e88aa8526b14565a35aadfd76f8f691ad81ccc562884"
 },
 {
  "path": "tests/database/catalogue/guarded-delete-history.sql",
  "sha256": "15a96afe964ab536a74c0ff3a232095c4390406221e6e8a8bcede0d9043cd246"
 },
 {
  "path": "tests/catalogue-ci/guarded-delete-history.node.mjs",
  "sha256": "b597b3553d90433d5a8ff1b44078d3915b307b7d49b996bf62b47b83058dbd0f"
 },
 {
  "path": "tests/database/catalogue/native-product-delete-races.mjs",
  "sha256": "93dc7786ffb6f3e2227d79662f45c0a076c774f33de09057c10f689469af9416"
 },
 {
  "path": "tests/catalogue-ci/native-product-delete-races.node.mjs",
  "sha256": "4e8876d30cf43b642b42f1da2dec244a10a03878829e82f416e52f5ef7bd3612"
 }
].map(Object.freeze));
const reportPaths=Object.freeze(["tests/database/catalogue/before-foundation.sql", "supabase/catalogue/v1/01-foundation.sql", "tests/database/catalogue/legacy-columns.sql", "tests/database/catalogue/roles.sql", "supabase/catalogue/v1/02-customer-target-tracking.sql", "tests/database/catalogue/customer-target-tracking.sql", "tests/database/catalogue/customer-target-runtime-authority.sql", "tests/database/catalogue/customer-target-runtime-variants.sql", "supabase/catalogue/v1/04-order-boundaries.sql", "supabase/catalogue/v1/new06-co-order-boundaries.sql", "supabase/catalogue/v1/02-promotion-owner-extraction.sql", "supabase/catalogue/v1/02-po-reference-extraction.sql", "supabase/catalogue/v1/02-co-reference-extraction.sql", "supabase/catalogue/v1/02-co-draft-reference-extraction.sql", "supabase/catalogue/v1/02-retired-co-line-resolution.sql", "supabase/catalogue/v1/new02-visit-reference-extraction.sql", "supabase/catalogue/v1/new02-nonco-lineage-resolution.sql", "supabase/catalogue/v1/new07-lifetime-admission.sql", "supabase/catalogue/v1/new08-catalogue-create-edit.sql", "supabase/catalogue/v1/new09-checked-boundaries.sql", "supabase/catalogue/v1/new10-guarded-delete.sql", "supabase/catalogue/v1/new11-master-completion-hooks.sql", "tests/database/catalogue/raw-caller-compatibility.sql", "tests/database/catalogue/checked-boundaries.sql", "tests/database/catalogue/guarded-delete.sql", "tests/database/catalogue/guarded-delete-history.sql"]);
const wrapperPaths=['scripts/catalogue-customer-target-artifact.mjs','tests/catalogue-ci/customer-target-artifact.node.mjs'];
const directory=path=>{const stat=lstatSync(path);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());return stat;};
const sameDirectory=(path,expected)=>{const stat=directory(path);assert.equal(stat.ino,expected.ino);assert.equal(stat.dev,expected.dev);};
function validateIdentity(identity,env){
 const {commit,tree,candidate,clean}=identity.source;
 assert.deepEqual(identity.source,{commit,tree,candidate,clean});
 const exact=catalogueCiIdentity(env,{commit,tree,candidate,clean},{database:'pilot_test',operator:'postgres',database_owner:'postgres',server_address:identity.serverAddress,server_port:identity.serverPort,server_version_num:identity.serverVersion,system_identifier:identity.systemIdentifier},identity.runIdentity);
 assert.deepEqual(identity,exact);return identity;
}
export function validateTargetStatusRecovery(statusRecovery,pids){
 const replayPid=statusRecovery?.replayBackendPid;
 assert.ok(Number.isSafeInteger(replayPid)&&replayPid>0&&replayPid<=2147483647);assert.equal(new Set([...pids,replayPid]).size,4);
 const expected={status:'BOUNDED_STATUS_RECOVERY_RACES_PASSED',replayBackendPid:replayPid,cases:['inflight_dispatch_and_recovery_busy','committed_fresh_session_replay','replay_after_later_status_change','abandonment_fences_delayed_dispatch','actor_request_namespace_isolation','stale_master_version_refuses','repeatable_read_terminal_safety']};
 assert.deepEqual(statusRecovery,expected);return expected;
}
export function validateLifetimeAdmission(report){
 const expected={status:'BOUNDED_LIFETIME_ADMISSION_RACES_PASSED',cases:['legacy_already_admitted_po_drain','authorized_raw_service_admission_drain','legacy_unledgered_owner_actual_dml_drain'],scope:'ADMISSION_ONLY_NOT_GLOBAL_LIFETIME'};
 assert.deepEqual(report,expected);return expected;
}
export function validateCatalogueCreateEditRaces(report,pids,replayPid){
 const expected={status:'BOUNDED_CATALOGUE_CREATE_EDIT_RACES_PASSED',backendPids:[pids[0],replayPid,pids[2]],cases:['duplicate_create_exact_replay','edit_vs_reenable_both_directions','reconcile_during_blocked_fresh_create']};
 assert.deepEqual(report,expected);return expected;
}
export function validateCatalogueCompletionRaces(report,pids,replayPid){
 const expected={status:'BOUNDED_CATALOGUE_COMPLETION_RACES_PASSED',backendPids:[pids[0],replayPid,pids[2]],cases:['target_duplicate_commit_replay','target_use_blocks_unused_delete','delete_commit_refuses_target_save','product_relation_busy_then_delete','delete_request_busy_replay','truncate_drain_busy_then_refused']};
 assert.deepEqual(report,expected);return expected;
}
export function validateNativeProductDeleteRaces(report,pids,replayPid){
 const expected={status:'BOUNDED_NATIVE_PRODUCT_DELETE_RACES_PASSED',backendPids:[pids[0],replayPid,pids[2]],cases:["native_no_action_po_and_executive", "native_multi_product_both_orders", "checked_po_first_native_nowait", "checked_promotion_first_native_nowait", "native_first_checked_po_wait", "native_first_checked_promotion_wait", "promotion_child_wait_root_flush", "identity_refusal_atomic_cascade_rollback", "native_committed_cascade_and_plain_provenance"]};
 assert.deepEqual(report,expected);return expected;
}
export function validateCatalogueCheckedCompletion(report){
 const expected={status:'BOUNDED_CHECKED_COMPLETION_SUITES_PASSED',scope:'FUTURE_GENERATION_TWO_SYNTHETIC_ONLY',suites:['checked-boundaries','guarded-delete','guarded-delete-history'],historyScanner:'GENERATION_ONE_OWNER_PRIVATE_ONLY',executionGeneration:2,trackingReady:true,fixtureRestoration:'GENERATION_ONE_TRACKING_FALSE_CONSTRAINTS_VERIFIED',productionGeneration:1,productionTrackingReady:false,concurrency:'UNRUN',hostedParity:'UNVERIFIED',implementationAccepted:false};
 assert.deepEqual(report,expected);return expected;
}
function validateReport(bytes,identity,files){
 assert.equal(typeof bytes,'string');assert.ok(Buffer.byteLength(bytes)<=65536);assert.ok(bytes.endsWith('\n'));
 const report=JSON.parse(bytes);assert.equal(bytes,JSON.stringify(report)+'\n');
 const lifecycle=report.lifecycle;for(const key of ['backendPid','transactionId'])assert.match(lifecycle?.[key]??'',/^[1-9][0-9]{0,19}$/);
 const pids=report.races?.backendPids;assert.ok(Array.isArray(pids));assert.equal(pids.length,3);assert.equal(new Set(pids).size,3);assert.ok(pids.every(pid=>Number.isSafeInteger(pid)&&pid>0&&pid<=2147483647));
 const expected={format:'catalogue-customer-target-runtime-v1',status:'BOUNDED_TARGET_RUNTIME_PASSED',identity,lifecycle:{backendPid:lifecycle.backendPid,transactionId:lifecycle.transactionId},rawCompatibility:{scope:'LEGACY_RAW_COMPATIBILITY_ONLY',executionGeneration:1,trackingReady:false,roles:['authenticated','service_role'],syntheticVisitRequestGrant:'ROLLBACK_VERIFIED',targetOldNewTracking:'PASSED',rawOrderVisitLifetime:'INCOMPLETE',businessTruncate:'ALLOWED_WITHOUT_ROW_EVIDENCE',masterTruncate:'REFUSED',globalActivation:'BLOCKED',hostedParity:'UNVERIFIED'},checkedCompletionProof:validateCatalogueCheckedCompletion(report.checkedCompletionProof),races:{status:'BOUNDED_TARGET_RACES_PASSED',backendPids:pids,cases:['reversed_raw_target_statements','evidence_relation_contention'],statusRecovery:validateTargetStatusRecovery(report.races.statusRecovery,pids),lifetimeAdmission:validateLifetimeAdmission(report.races.lifetimeAdmission),createEdit:validateCatalogueCreateEditRaces(report.races.createEdit,pids,report.races.statusRecovery.replayBackendPid),checkedCompletion:validateCatalogueCompletionRaces(report.races.checkedCompletion,pids,report.races.statusRecovery.replayBackendPid),nativeProductDelete:validateNativeProductDeleteRaces(report.races.nativeProductDelete,pids,report.races.statusRecovery.replayBackendPid)},cleanup:'COMMITTED_SYNTHETIC_CHILD_DISPOSED',files,implementationAccepted:false,hostedVerified:false,trackingReady:false,broaderLockGraph:'UNPROVEN'};
 assert.deepEqual(report,expected);assert.equal(bytes,JSON.stringify(expected)+'\n');return expected;
}
function exactFile(path,expected){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=fstatSync(fd);assert.ok(stat.isFile()&&stat.nlink===1&&stat.size===Buffer.byteLength(expected));assert.equal(readFileSync(fd,'utf8'),expected);}finally{closeSync(fd);}
}

// These finite validators must stay local. Importing the runtime here would
// evaluate it before the source-binding and reviewed-byte prelaunch checks.
const targetFailurePhases=Object.freeze(['initialization','binding','source-preflight','identity-preflight','lifecycle','lifecycle-parse','source-post-lifecycle','identity-post-lifecycle','race-setup','race-setup-parse','source-pre-races','identity-pre-races','races','source-post-races','identity-post-races','disposal','source-post-disposal']);
const lifecycleFailurePhases=Object.freeze(["FOUNDATION","TARGET_SETUP","TARGET_INSTALL","TARGET_AUTHORITY","TARGET_EVENTS","TARGET_CASCADE_DROP","TARGET_CASCADE_ADD","TARGET_CASCADE_EVENTS","TARGET_AUTHENTICATED","TARGET_MISSING_IDENTITY","TARGET_ASSERTION_ONLY","TARGET_SESSION_GATE","VARIANTS_AND_ROLES","RAW_COMPATIBILITY","CHECKED_BOUNDARIES","GUARDED_DELETE","GUARDED_DELETE_HISTORY","ROLLBACK","COMPLETE"]);
const targetProcessKinds=Object.freeze(['NOT_APPLICABLE','UNKNOWN','EXIT_0','EXIT_1','EXIT_2','SCRIPT_ERROR','OTHER_NONZERO','SIGNAL','TIMEOUT','BUFFER_LIMIT','SPAWN_FAILURE','SESSION_SQLSTATE']);
const targetSyncFailurePhases=Object.freeze(['identity-preflight','lifecycle','identity-post-lifecycle','race-setup','identity-pre-races','identity-post-races','disposal']);
function targetProcessExit(error){
 if(!error||typeof error!=='object')return 'UNKNOWN';
 if(error.code==='ETIMEDOUT')return 'TIMEOUT';
 if(['ENOBUFS','ERR_CHILD_PROCESS_STDIO_MAXBUFFER'].includes(error.code))return 'BUFFER_LIMIT';
 if(['ENOENT','EACCES'].includes(error.code))return 'SPAWN_FAILURE';
 if(typeof error.signal==='string'&&error.signal!=='')return 'SIGNAL';
 if(error.code!==undefined||error.signal!==null)return 'UNKNOWN';
 if([0,1,2,3].includes(error.status))return ['EXIT_0','EXIT_1','EXIT_2','SCRIPT_ERROR'][error.status];
 return Number.isSafeInteger(error.status)&&error.status>0?'OTHER_NONZERO':'UNKNOWN';
}
function validateTargetFailureDiagnostic(diagnostic){
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

const targetCleanupByPhase=Object.freeze({
 initialization:'NOT_NEEDED',binding:'NOT_NEEDED','source-preflight':'NOT_NEEDED','identity-preflight':'NOT_NEEDED',lifecycle:'NOT_NEEDED','lifecycle-parse':'NOT_NEEDED','source-post-lifecycle':'NOT_NEEDED','identity-post-lifecycle':'NOT_NEEDED',
 'race-setup':'CLEANUP_UNPROVEN','race-setup-parse':'CLEANUP_UNPROVEN','source-pre-races':'CLEANUP_UNPROVEN','identity-pre-races':'CLEANUP_UNPROVEN',races:'CLEANUP_UNPROVEN','source-post-races':'CLEANUP_UNPROVEN','identity-post-races':'CLEANUP_UNPROVEN',disposal:'CLEANUP_UNPROVEN',
 'source-post-disposal':'COMMITTED_SYNTHETIC_CHILD_DISPOSED',
});
// Accept only the exact bounded failure envelope from the reviewed runtime.
// Failure evidence is diagnostic only: no report, manifest or ready=true follows.
export function parseTargetRuntimeRefusal(child){
 assert.equal(child.error,undefined);assert.equal(child.status,1);assert.equal(child.signal,null);assert.equal(child.stdout,'');
 assert.equal(typeof child.stderr,'string');assert.ok(Buffer.byteLength(child.stderr)<=2048);assert.ok(child.stderr.endsWith('\n'));
 const received=JSON.parse(child.stderr);assert.ok(Object.hasOwn(targetCleanupByPhase,received.diagnostic?.phase));assert.equal(received.cleanup,targetCleanupByPhase[received.diagnostic.phase]);
 const expected={status:'CATALOGUE_TARGET_RUNTIME_REFUSED',cleanup:received.cleanup,diagnostic:validateTargetFailureDiagnostic(received.diagnostic),implementationAccepted:false};
 assert.deepEqual(received,expected);assert.equal(child.stderr,JSON.stringify(expected)+'\n');return expected;
}

export function runCatalogueCustomerTargetArtifact({repoRoot=defaultRoot,env=process.env,execute=execFileSync,launch=spawnSync,bind=catalogueFailfastBinding,readSource=catalogueCaptureSourceBytes}={}){
 let descriptor,phase='initialization',child,launchAttempted=false,runtimeDiagnostic=null,runtimeCleanup=null;
 try{
  assert.equal(typeof env.GITHUB_OUTPUT,'string');descriptor=openSync(env.GITHUB_OUTPUT,constants.O_WRONLY|constants.O_APPEND|constants.O_NOFOLLOW);const outputFile=fstatSync(descriptor);assert.ok(outputFile.isFile()&&outputFile.nlink===1);writeFileSync(descriptor,'bundle_ready=false\n');
  phase='binding';const binding=bind(repoRoot,env,execute),identity=validateIdentity(binding.identity,env);
  phase='reviewed-source';assert.equal(new Set(cataloguePublicSourcePaths).size,cataloguePublicSourcePaths.length);
  for(const path of [...reportPaths,...targetRuntimeReviewedFiles.map(x=>x.path),...wrapperPaths])assert.ok(cataloguePublicSourcePaths.includes(path));
  const snapshot=()=>cataloguePublicSourcePaths.map(path=>({path,sha256:sha(readSource(repoRoot,path))}));
  const sources=snapshot(),byPath=new Map(sources.map(x=>[x.path,x.sha256]));
  for(const entry of targetRuntimeReviewedFiles)assert.equal(byPath.get(entry.path),entry.sha256);
  const files=reportPaths.map(path=>({path,sha256:byPath.get(path)}));
  const checkSource=()=>{try{assert.deepEqual(bind(repoRoot,env,execute),binding);assert.deepEqual(snapshot(),sources);}catch(error){runtimeDiagnostic=null;runtimeCleanup=null;throw error;}};
  phase='destinations';const parent=resolve(repoRoot,'scale-results'),parentStat=directory(parent),output=resolve(parent,'catalogue-customer-target-runtime'),pending=resolve(parent,'catalogue-customer-target-runtime-pending');
  mkdirSync(output);const outputStat=directory(output);mkdirSync(pending);const pendingStat=directory(pending);
  const checkDirectories=()=>{sameDirectory(parent,parentStat);sameDirectory(output,outputStat);sameDirectory(pending,pendingStat);assert.deepEqual(readdirSync(output),[]);};
  phase='preflight';checkSource();checkDirectories();assert.deepEqual(readdirSync(pending),[]);
  // Capture both streams in memory only. Never persist raw logs or original errors.
  phase='child-launch';launchAttempted=true;child=launch(process.execPath,['scripts/catalogue-customer-target-runtime.mjs'],{cwd:repoRoot,env,encoding:'utf8',timeout:600000,maxBuffer:65536,shell:false,stdio:['ignore','pipe','pipe']});
  phase='child-result';
  if(child.status!==0||child.error!==undefined||child.signal!==null||child.stderr!==''){
   try{checkSource();const refusal=parseTargetRuntimeRefusal(child);runtimeCleanup=refusal.cleanup;runtimeDiagnostic=refusal.diagnostic;}catch{}
  }
  assert.equal(child.error,undefined);assert.equal(child.status,0);assert.equal(child.signal,null);assert.equal(child.stderr,'');
  phase='report-validation';const report=validateReport(child.stdout,identity,files);phase='postflight';checkSource();runtimeCleanup=report.cleanup;checkDirectories();assert.deepEqual(readdirSync(pending),[]);
  phase='bundle-staging';const manifest=JSON.stringify({format:'catalogue-customer-target-runtime-manifest-v1',status:report.status,files:[{path:'results.json',sha256:sha(child.stdout)}]})+'\n';
  writeFileSync(resolve(pending,'results.json'),child.stdout,{flag:'wx',mode:0o600});writeFileSync(resolve(pending,'manifest.json'),manifest,{flag:'wx',mode:0o600});
  const checkBundle=path=>{assert.deepEqual(readdirSync(path).sort(),['manifest.json','results.json']);exactFile(resolve(path,'results.json'),child.stdout);exactFile(resolve(path,'manifest.json'),manifest);};
  phase='bundle-publication';checkSource();checkDirectories();checkBundle(pending);renameSync(pending,output);
  phase='final-verification';sameDirectory(parent,parentStat);sameDirectory(output,pendingStat);checkBundle(output);checkSource();
  writeFileSync(descriptor,'bundle_ready=true\n');return report;
 }catch(cause){
  const error=new Error('CATALOGUE_TARGET_ARTIFACT_REFUSED');
  error.diagnostic=Object.freeze({phase,processExit:launchAttempted?targetProcessExit(child?.error??child??cause):'NOT_STARTED',cleanup:runtimeCleanup,runtime:runtimeDiagnostic});throw error;
 }
 finally{if(descriptor!==undefined)closeSync(descriptor);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{assert.deepEqual(process.argv.slice(2),[]);const result=runCatalogueCustomerTargetArtifact();console.log(JSON.stringify({status:result.status,cleanup:result.cleanup,implementationAccepted:false}));}
 catch(error){process.stderr.write('CATALOGUE_TARGET_ARTIFACT_REFUSED\n');if(process.env.GITHUB_ACTIONS==='true'&&error?.diagnostic)process.stderr.write(JSON.stringify({status:'CATALOGUE_TARGET_ARTIFACT_REFUSED',...error.diagnostic,implementationAccepted:false})+'\n');process.exitCode=1;}
}
