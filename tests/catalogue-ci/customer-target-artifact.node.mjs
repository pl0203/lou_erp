import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,existsSync,symlinkSync,renameSync,linkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {cataloguePublicSourcePaths} from '../../scripts/catalogue-capture-source.mjs';
import {targetRuntimePaths} from '../../scripts/catalogue-customer-target-runtime.mjs';
let wrapper;try{wrapper=await import('../../scripts/catalogue-customer-target-artifact.mjs');}catch{}
const need=()=>assert.equal(typeof wrapper?.runCatalogueCustomerTargetArtifact,'function','Reviewed target artifact wrapper required');
const root=resolve('.'),sha=x=>createHash('sha256').update(x).digest('hex');
const nine=['scripts/catalogue-customer-target-runtime.mjs','supabase/catalogue/v1/02-customer-target-tracking.sql','tests/catalogue-ci/customer-target-runtime.node.mjs','tests/catalogue-ci/customer-target-tracking.node.mjs','tests/database/catalogue/customer-target-race-spec.md','tests/database/catalogue/customer-target-races.mjs','tests/database/catalogue/customer-target-runtime-authority.sql','tests/database/catalogue/customer-target-runtime-variants.sql','tests/database/catalogue/customer-target-tracking.sql','tests/database/catalogue/lifetime-admission-races.mjs','supabase/catalogue/v1/04-order-boundaries.sql','supabase/catalogue/v1/new06-co-order-boundaries.sql','supabase/catalogue/v1/02-promotion-owner-extraction.sql','supabase/catalogue/v1/new02-visit-reference-extraction.sql','supabase/catalogue/v1/new07-lifetime-admission.sql','supabase/catalogue/v1/new08-catalogue-create-edit.sql','tests/database/catalogue/create-edit-races.mjs','tests/catalogue-ci/create-edit-races.node.mjs','tests/database/catalogue/raw-caller-compatibility.sql','supabase/catalogue/v1/02-po-reference-extraction.sql','supabase/catalogue/v1/02-co-reference-extraction.sql','supabase/catalogue/v1/02-co-draft-reference-extraction.sql','supabase/catalogue/v1/02-retired-co-line-resolution.sql','supabase/catalogue/v1/new02-nonco-lineage-resolution.sql','supabase/catalogue/v1/new09-checked-boundaries.sql','supabase/catalogue/v1/new10-guarded-delete.sql','supabase/catalogue/v1/new11-master-completion-hooks.sql','tests/database/catalogue/checked-boundaries.sql','tests/database/catalogue/guarded-delete.sql','tests/database/catalogue/completion-races.mjs','tests/catalogue-ci/completion-races.node.mjs','tests/catalogue-ci/checked-boundaries.node.mjs','tests/catalogue-ci/guarded-delete.node.mjs','tests/catalogue-ci/master-completion-hooks.node.mjs','tests/database/catalogue/guarded-delete-history.sql','tests/catalogue-ci/guarded-delete-history.node.mjs','tests/database/catalogue/native-product-delete-races.mjs','tests/catalogue-ci/native-product-delete-races.node.mjs'];
const ci={repository:'pl0203/lou_erp',workflow:'Pilot safety checks',workflowRef:'pl0203/lou_erp/.github/workflows/pilot-safety.yml@refs/pull/30/merge',job:'catalogue-baseline',event:'pull_request',ref:'refs/pull/30/merge',eventSha:'d'.repeat(40),runId:'9',runAttempt:'1',headRef:'feat/catalogue-mutations-20261014',baseRef:'fix/pilot-database'};
const identity={profile:'github-catalogue-baseline-v1',source:{clean:true,commit:'a'.repeat(40),tree:'b'.repeat(40),candidate:'c'.repeat(64)},ci,runIdentity:'00000000-0000-4000-8000-000000000001',serverAddress:'172.18.0.2',serverPort:5432,serverVersion:'170011',systemIdentifier:'123456789'};
const env={PATH:'/usr/bin',CI:'true',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:ci.repository,GITHUB_WORKFLOW:ci.workflow,GITHUB_WORKFLOW_REF:ci.workflowRef,GITHUB_JOB:ci.job,GITHUB_EVENT_NAME:ci.event,GITHUB_REF:ci.ref,GITHUB_SHA:ci.eventSha,GITHUB_RUN_ID:ci.runId,GITHUB_RUN_ATTEMPT:ci.runAttempt,CATALOGUE_CI_PROFILE:identity.profile,CATALOGUE_CI_HEAD_REPOSITORY:ci.repository,CATALOGUE_CI_BASE_REPOSITORY:ci.repository,CATALOGUE_CI_HEAD_REF:ci.headRef,CATALOGUE_CI_BASE_REF:ci.baseRef,CATALOGUE_CI_SOURCE_SHA:identity.source.commit,CATALOGUE_CI_CANDIDATE_SHA256:identity.source.candidate,PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGDATABASE:'pilot_test',PGPASSWORD:'synthetic-ci-only'};
function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'target-artifact-source-')),output=join(directory,'output');mkdirSync(join(directory,'scale-results'));writeFileSync(output,'');
 const files=Object.values(targetRuntimePaths).map(path=>({path,sha256:sha(readFileSync(join(root,path)))}));
 const report={format:'catalogue-customer-target-runtime-v1',status:'BOUNDED_TARGET_RUNTIME_PASSED',identity:structuredClone(identity),lifecycle:{backendPid:'100',transactionId:'123'},rawCompatibility:{scope:'LEGACY_RAW_COMPATIBILITY_ONLY',executionGeneration:1,trackingReady:false,roles:['authenticated','service_role'],syntheticVisitRequestGrant:'ROLLBACK_VERIFIED',targetOldNewTracking:'PASSED',rawOrderVisitLifetime:'INCOMPLETE',businessTruncate:'ALLOWED_WITHOUT_ROW_EVIDENCE',masterTruncate:'REFUSED',globalActivation:'BLOCKED',hostedParity:'UNVERIFIED'},checkedCompletionProof:{status:'BOUNDED_CHECKED_COMPLETION_SUITES_PASSED',scope:'FUTURE_GENERATION_TWO_SYNTHETIC_ONLY',suites:['checked-boundaries','guarded-delete','guarded-delete-history'],historyScanner:'GENERATION_ONE_OWNER_PRIVATE_ONLY',executionGeneration:2,trackingReady:true,fixtureRestoration:'GENERATION_ONE_TRACKING_FALSE_CONSTRAINTS_VERIFIED',productionGeneration:1,productionTrackingReady:false,concurrency:'UNRUN',hostedParity:'UNVERIFIED',implementationAccepted:false},races:{status:'BOUNDED_TARGET_RACES_PASSED',backendPids:[201,202,203],cases:['reversed_raw_target_statements','evidence_relation_contention'],statusRecovery:{status:'BOUNDED_STATUS_RECOVERY_RACES_PASSED',replayBackendPid:204,cases:['inflight_dispatch_and_recovery_busy','committed_fresh_session_replay','replay_after_later_status_change','abandonment_fences_delayed_dispatch','actor_request_namespace_isolation','stale_master_version_refuses','repeatable_read_terminal_safety']},lifetimeAdmission:{status:'BOUNDED_LIFETIME_ADMISSION_RACES_PASSED',cases:['legacy_already_admitted_po_drain','authorized_raw_service_admission_drain','legacy_unledgered_owner_actual_dml_drain'],scope:'ADMISSION_ONLY_NOT_GLOBAL_LIFETIME'},createEdit:{status:'BOUNDED_CATALOGUE_CREATE_EDIT_RACES_PASSED',backendPids:[201,204,203],cases:['duplicate_create_exact_replay','edit_vs_reenable_both_directions','reconcile_during_blocked_fresh_create']},checkedCompletion:{status:'BOUNDED_CATALOGUE_COMPLETION_RACES_PASSED',backendPids:[201,204,203],cases:['target_duplicate_commit_replay','target_use_blocks_unused_delete','delete_commit_refuses_target_save','product_relation_busy_then_delete','delete_request_busy_replay','truncate_drain_busy_then_refused']},nativeProductDelete:{status:'BOUNDED_NATIVE_PRODUCT_DELETE_RACES_PASSED',backendPids:[201,204,203],cases:["native_no_action_po_and_executive", "native_multi_product_both_orders", "checked_po_first_native_nowait", "checked_promotion_first_native_nowait", "native_first_checked_po_wait", "native_first_checked_promotion_wait", "promotion_child_wait_root_flush", "identity_refusal_atomic_cascade_rollback", "native_committed_cascade_and_plain_provenance"]}},cleanup:'COMMITTED_SYNTHETIC_CHILD_DISPOSED',files,implementationAccepted:false,hostedVerified:false,trackingReady:false,broaderLockGraph:'UNPROVEN'};
 let calls=0,binding={identity:structuredClone(identity)},sourceDrift=false;
 const args={repoRoot:directory,env:{...env,GITHUB_OUTPUT:output},bind:()=>structuredClone(binding),readSource:(_repo,path)=>sourceDrift&&path===nine[0]?Buffer.from('// drift'):readFileSync(join(root,path)),execute:()=>{throw Error('Unexpected real executor');},launch:(file,argv,options)=>{calls++;assert.equal(file,process.execPath);assert.deepEqual(argv,['scripts/catalogue-customer-target-runtime.mjs']);assert.equal(options.cwd,directory);assert.equal(options.shell,false);assert.deepEqual(options.stdio,['ignore','pipe','pipe']);assert.ok(options.timeout<=600000);assert.ok(options.maxBuffer<=65536);return {status:0,signal:null,stdout:JSON.stringify(report)+'\n',stderr:''};}};
 return {directory,output,args,report,calls:()=>calls,drift:()=>{sourceDrift=true;},changeBinding:()=>{binding.identity.source.candidate='f'.repeat(64);}};
}
function refused(f){assert.equal(readFileSync(f.output,'utf8'),'bundle_ready=false\n');assert.equal(existsSync(join(f.directory,'scale-results/catalogue-customer-target-runtime/results.json')),false);}
test('exact reviewed runtime paths plus wrapper and source tests are captured once',()=>{
 need();for(const path of [...nine,'scripts/catalogue-customer-target-artifact.mjs','tests/catalogue-ci/customer-target-artifact.node.mjs'])assert.equal(cataloguePublicSourcePaths.filter(p=>p===path).length,1,path);
 assert.equal(new Set(cataloguePublicSourcePaths).size,cataloguePublicSourcePaths.length);assert.deepEqual(wrapper.targetRuntimeReviewedFiles.map(f=>f.path),nine);
 for(const entry of wrapper.targetRuntimeReviewedFiles)assert.equal(sha(readFileSync(join(root,entry.path))),entry.sha256);
});
test('exact validated runner bytes publish atomically with manifest then readiness',()=>{
 need();const f=fixture();const report=wrapper.runCatalogueCustomerTargetArtifact(f.args);assert.deepEqual(report,f.report);assert.equal(f.calls(),1);
 const directory=join(f.directory,'scale-results/catalogue-customer-target-runtime'),bytes=readFileSync(join(directory,'results.json'),'utf8');
 assert.equal(bytes,JSON.stringify(f.report)+'\n');assert.deepEqual(readdirSync(directory).sort(),['manifest.json','results.json']);
 assert.deepEqual(JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8')),{format:'catalogue-customer-target-runtime-manifest-v1',status:'BOUNDED_TARGET_RUNTIME_PASSED',files:[{path:'results.json',sha256:sha(bytes)}]});
 assert.equal(readFileSync(f.output,'utf8'),'bundle_ready=false\nbundle_ready=true\n');assert.equal(existsSync(join(f.directory,'scale-results/catalogue-customer-target-runtime-pending')),false);
});
test('nonzero exit signal stderr truncation and thrown errors never publish or leak',()=>{
 need();for(const response of [{status:1},{signal:'SIGTERM'},{stderr:'PRIVATE SQL'},{error:new Error('PRIVATE CREDENTIAL')},{stdout:'PRIVATE SQL\n'},{stdout:'x'.repeat(65537)}]){
  const f=fixture(),original=f.args.launch;f.args.launch=(...args)=>({...original(...args),...response});assert.throws(()=>wrapper.runCatalogueCustomerTargetArtifact(f.args),error=>error.message==='CATALOGUE_TARGET_ARTIFACT_REFUSED'&&!JSON.stringify(error).includes('PRIVATE'));refused(f);
 }
 const f=fixture();f.args.launch=()=>{throw Object.assign(new Error('PRIVATE ERROR'),{stdout:'PRIVATE SQL',stderr:'PRIVATE CONFIG'});};assert.throws(()=>wrapper.runCatalogueCustomerTargetArtifact(f.args),/^Error: CATALOGUE_TARGET_ARTIFACT_REFUSED$/);refused(f);
});
test('exact JSON framing rejects duplicates extra fields missing identity and all overclaims',()=>{
 need();const mutations=[r=>{delete r.races.nativeProductDelete;},r=>{r.races.nativeProductDelete.cases.pop();},r=>{r.races.nativeProductDelete.backendPids=[201,202,203];},r=>{delete r.checkedCompletionProof;},r=>{r.checkedCompletionProof.productionTrackingReady=true;},r=>{r.checkedCompletionProof.suites.pop();},r=>{delete r.races.checkedCompletion;},r=>{r.races.checkedCompletion.cases.pop();},r=>{r.races.checkedCompletion.backendPids=[201,202,203];},r=>{delete r.rawCompatibility;},r=>{r.rawCompatibility.executionGeneration=2;},r=>{r.rawCompatibility.trackingReady=true;},r=>{r.rawCompatibility.rawOrderVisitLifetime='PASSED';},r=>{r.rawCompatibility.globalActivation='READY';},r=>{r.rawCompatibility.syntheticVisitRequestGrant='PERSISTED';},r=>{r.cleanup='CLEANUP_UNPROVEN';},r=>{r.cleanup='ROLLBACK_VERIFIED';},r=>{r.implementationAccepted=true;},r=>{r.hostedVerified=true;},r=>{r.trackingReady=true;},r=>{r.broaderLockGraph='PROVEN';},r=>{r.identity.source.candidate='f'.repeat(64);},r=>{r.identity.private='PRIVATE';},r=>{r.lifecycle.sql='PRIVATE';},r=>{r.lifecycle.backendPid='0';},r=>{r.lifecycle.transactionId='01';},r=>{r.races.backendPids=[201,201,203];},r=>{r.races.backendPids=[201,202,0];},r=>{r.races.cases.reverse();},r=>{delete r.races.createEdit;},r=>{r.races.createEdit.cases.pop();},r=>{r.races.createEdit.backendPids=[201,202,203];},r=>{delete r.races.lifetimeAdmission;},r=>{r.races.lifetimeAdmission.cases.pop();},r=>{r.races.lifetimeAdmission.scope='GLOBAL_PROVEN';},r=>{delete r.races.statusRecovery;},r=>{r.races.statusRecovery.replayBackendPid=202;},r=>{r.races.statusRecovery.cases.pop();},r=>{r.files.reverse();},r=>{r.files[0].sha256='f'.repeat(64);},r=>{r.files.push(r.files[0]);},r=>{r.extra='PRIVATE SQL';},r=>{delete r.identity;},r=>{delete r.races;}];
 for(const mutate of mutations){const f=fixture();mutate(f.report);assert.throws(()=>wrapper.runCatalogueCustomerTargetArtifact(f.args),/CATALOGUE_TARGET_ARTIFACT_REFUSED/);refused(f);}
 for(const transform of [s=>s.trimEnd(),s=>s+'\n',s=>'noise\n'+s,s=>s+s,s=>s.replace('"format":','"format":"x","format":'),s=>s.replace('"identity":','"identity" :')]){const f=fixture(),original=f.args.launch;f.args.launch=(...args)=>{const r=original(...args);r.stdout=transform(r.stdout);return r;};assert.throws(()=>wrapper.runCatalogueCustomerTargetArtifact(f.args),/CATALOGUE_TARGET_ARTIFACT_REFUSED/);refused(f);}
});
test('post-run source binding or reviewed-byte drift refuses without cleanup retry',()=>{
 need();for(const mutate of [f=>f.changeBinding(),f=>f.drift()]){const f=fixture(),original=f.args.launch;f.args.launch=(...args)=>{const r=original(...args);mutate(f);return r;};assert.throws(()=>wrapper.runCatalogueCustomerTargetArtifact(f.args),/CATALOGUE_TARGET_ARTIFACT_REFUSED/);assert.equal(f.calls(),1);refused(f);}
});
test('preexisting destinations and symlink output fail before runner or unsafe writes',()=>{
 need();for(const mutate of [f=>mkdirSync(join(f.directory,'scale-results/catalogue-customer-target-runtime')),f=>mkdirSync(join(f.directory,'scale-results/catalogue-customer-target-runtime-pending')),f=>symlinkSync(join(f.directory,'missing'),join(f.directory,'scale-results/catalogue-customer-target-runtime'))]){const f=fixture();mutate(f);assert.throws(()=>wrapper.runCatalogueCustomerTargetArtifact(f.args),/CATALOGUE_TARGET_ARTIFACT_REFUSED/);assert.equal(f.calls(),0);refused(f);}
 const f=fixture(),target=join(f.directory,'target');writeFileSync(target,'unchanged');f.args.env.GITHUB_OUTPUT=join(f.directory,'symlink-output');symlinkSync(target,f.args.env.GITHUB_OUTPUT);assert.throws(()=>wrapper.runCatalogueCustomerTargetArtifact(f.args),/CATALOGUE_TARGET_ARTIFACT_REFUSED/);assert.equal(f.calls(),0);assert.equal(readFileSync(target,'utf8'),'unchanged');
});
test('post-run output or staging replacement and injected files refuse atomic publication',()=>{
 need();for(const suffix of ['catalogue-customer-target-runtime','catalogue-customer-target-runtime-pending']){const f=fixture(),original=f.args.launch;f.args.launch=(...args)=>{const r=original(...args),path=join(f.directory,'scale-results',suffix);renameSync(path,path+'-old');mkdirSync(path);return r;};assert.throws(()=>wrapper.runCatalogueCustomerTargetArtifact(f.args),/CATALOGUE_TARGET_ARTIFACT_REFUSED/);refused(f);}
 for(const suffix of ['catalogue-customer-target-runtime','catalogue-customer-target-runtime-pending']){const f=fixture(),original=f.args.launch;f.args.launch=(...args)=>{const r=original(...args);writeFileSync(join(f.directory,'scale-results',suffix,'unexpected.txt'),'PRIVATE');return r;};assert.throws(()=>wrapper.runCatalogueCustomerTargetArtifact(f.args),/CATALOGUE_TARGET_ARTIFACT_REFUSED/);refused(f);}
});
test('target is a success-only terminal database step in the exclusive job-owned service',()=>{
 const workflow=readFileSync('.github/workflows/pilot-safety.yml','utf8'),job=workflow.split('\n  catalogue-baseline:')[1];
 assert.equal((job.match(/run: node scripts\/catalogue-customer-target-artifact\.mjs/g)||[]).length,1);
 const terminal=job.indexOf('      - name: Verify terminal customer target runtime and disposal');assert.ok(terminal>job.indexOf('run: node scripts/catalogue-read-proof.mjs'));
 const suffix=job.slice(terminal);assert.match(suffix,/if: \$\{\{ success\(\) &&/);for(const id of ['catalogue-baseline-capture','catalogue-failfast','catalogue-foundation-red','catalogue-foundation','catalogue-reference-helpers','catalogue-read-proof'])assert.ok(suffix.includes(`steps.${id}.outcome == 'success'`));
 assert.match(suffix,/steps\.catalogue-read-proof\.outputs\.bundle_ready == 'true'/);assert.equal((suffix.match(/^        run:/gm)||[]).length,1);
 assert.match(suffix,/uses: actions\/upload-artifact@v4/);assert.match(suffix,/steps\.catalogue-customer-target-runtime\.outputs\.bundle_ready == 'true'/);assert.match(suffix,/path: scale-results\/catalogue-customer-target-runtime/);assert.ok(!/\.log|stderr|stdout/.test(suffix));
 assert.match(job,/runs-on: ubuntu-latest/);assert.match(job,/timeout-minutes: 20/);assert.match(job,/services:\n      postgres:\n        image: postgres:17/);assert.ok(!/volumes:|container_name:|self-hosted|continue-on-error/.test(job));assert.match(suffix,/entire per-job service/);
 assert.match(job,/run: node --test tests\/catalogue-ci\/customer-target-runtime\.node\.mjs tests\/catalogue-ci\/customer-target-tracking\.node\.mjs tests\/catalogue-ci\/customer-target-artifact\.node\.mjs/);
});
test('missing allowlist membership or pre-run reviewed-byte drift refuses before launch',()=>{
 need();const f=fixture();f.drift();assert.throws(()=>wrapper.runCatalogueCustomerTargetArtifact(f.args),/CATALOGUE_TARGET_ARTIFACT_REFUSED/);assert.equal(f.calls(),0);refused(f);
 const position=cataloguePublicSourcePaths.indexOf(nine[0]);assert.ok(position>=0);const [path]=cataloguePublicSourcePaths.splice(position,1);
 try{const f=fixture();assert.throws(()=>wrapper.runCatalogueCustomerTargetArtifact(f.args),/CATALOGUE_TARGET_ARTIFACT_REFUSED/);assert.equal(f.calls(),0);refused(f);}finally{cataloguePublicSourcePaths.splice(position,0,path);}
});
test('unbound identity fails before any real process and leaves readiness false',()=>{
 need();const f=fixture();delete f.args.bind;f.args.readSource=()=>{throw Error('No source read before binding');};assert.throws(()=>wrapper.runCatalogueCustomerTargetArtifact(f.args),/CATALOGUE_TARGET_ARTIFACT_REFUSED/);assert.equal(f.calls(),0);refused(f);
 for(const key of ['identity','source','ci']){const f=fixture();f.args.bind=()=>{const x={identity:structuredClone(identity)};if(key==='identity')delete x.identity;else x.identity[key].extra='PRIVATE CONFIG';return x;};assert.throws(()=>wrapper.runCatalogueCustomerTargetArtifact(f.args),/CATALOGUE_TARGET_ARTIFACT_REFUSED/);assert.equal(f.calls(),0);refused(f);}
});

test('hardlinked command-output file refuses without changing the other destination',()=>{
 need();const f=fixture(),target=join(f.directory,'hardlink-output');linkSync(f.output,target);
 assert.throws(()=>wrapper.runCatalogueCustomerTargetArtifact(f.args),/CATALOGUE_TARGET_ARTIFACT_REFUSED/);assert.equal(f.calls(),0);assert.equal(readFileSync(target,'utf8'),'');
});

function runtimeRefusal(cleanup='NOT_NEEDED',diagnostic={phase:'lifecycle',lifecyclePhase:'TARGET_SETUP',processExit:'SCRIPT_ERROR',sqlstate:'55006'}){
 return {status:'CATALOGUE_TARGET_RUNTIME_REFUSED',cleanup,diagnostic,implementationAccepted:false};
}
test('bounded runtime refusal preserves cleanup distinctions but never publishes a success artifact',()=>{
 need();for(const body of [
  runtimeRefusal(),
  runtimeRefusal('CLEANUP_UNPROVEN',{phase:'race-setup',lifecyclePhase:'NOT_APPLICABLE',processExit:'SCRIPT_ERROR',sqlstate:'55006'}),
  runtimeRefusal('COMMITTED_SYNTHETIC_CHILD_DISPOSED',{phase:'source-post-disposal',lifecyclePhase:'NOT_APPLICABLE',processExit:'NOT_APPLICABLE',sqlstate:null}),
 ]){
  const f=fixture(),cleanup=body.cleanup;f.args.launch=()=>({status:1,signal:null,stdout:'',stderr:JSON.stringify(body)+'\n'});
  let caught;try{wrapper.runCatalogueCustomerTargetArtifact(f.args);}catch(error){caught=error;}
  assert.equal(caught?.message,'CATALOGUE_TARGET_ARTIFACT_REFUSED');
  assert.deepEqual(caught.diagnostic,{phase:'child-result',processExit:'EXIT_1',cleanup,runtime:body.diagnostic});
  refused(f);assert.equal(existsSync(join(f.directory,'scale-results/catalogue-customer-target-runtime/manifest.json')),false);
 }
});
test('untrusted child failures never become runtime cleanup or SQLSTATE evidence',()=>{
 need();const body=JSON.stringify(runtimeRefusal())+'\n';
 const changes=[
  {status:0},{status:2},{signal:'SIGTERM'},{error:new Error('PRIVATE')},{stdout:'PRIVATE'},
  {stderr:body+'PRIVATE\n'},{stderr:'PRIVATE\n'},{stderr:body.trimEnd()},{stderr:'x'.repeat(2049)},
  {stderr:body.replace('"cleanup":','"cleanup":"NOT_NEEDED","cleanup":')},
  {stderr:body.replace('"sqlstate":"55006"','"sqlstate":"PRIVATE"')},
  {stderr:body.replace('"implementationAccepted":false','"implementationAccepted":true')},
  {stderr:body.replace('"diagnostic":','"extra":"PRIVATE","diagnostic":')},
  {stderr:body.replace('"cleanup":"NOT_NEEDED"','"cleanup":"ROLLBACK_VERIFIED"')},
 ];
 for(const change of changes){
  const f=fixture();f.args.launch=()=>({status:1,signal:null,stdout:'',stderr:body,...change});
  let caught;try{wrapper.runCatalogueCustomerTargetArtifact(f.args);}catch(error){caught=error;}
  assert.equal(caught?.message,'CATALOGUE_TARGET_ARTIFACT_REFUSED');assert.equal(caught.diagnostic.cleanup,null);assert.equal(caught.diagnostic.runtime,null);
  assert.ok(!JSON.stringify(caught).includes('PRIVATE'));refused(f);
 }
});
test('prelaunch refusal and unknown child outcome do not claim NOT_NEEDED cleanup',()=>{
 need();const f=fixture();f.drift();let caught;
 try{wrapper.runCatalogueCustomerTargetArtifact(f.args);}catch(error){caught=error;}
 assert.equal(caught.diagnostic.processExit,'NOT_STARTED');assert.equal(caught.diagnostic.cleanup,null);assert.equal(caught.diagnostic.runtime,null);refused(f);
 const g=fixture();g.args.launch=()=>{throw new Error('PRIVATE')};
 try{wrapper.runCatalogueCustomerTargetArtifact(g.args);}catch(error){caught=error;}
 assert.equal(caught.diagnostic.processExit,'UNKNOWN');assert.equal(caught.diagnostic.cleanup,null);assert.equal(caught.diagnostic.runtime,null);
 assert.ok(!JSON.stringify(caught).includes('PRIVATE'));refused(g);
});

test('wrapper never imports runtime before exact source binding and reviewed-byte gates',()=>{
 const source=readFileSync('scripts/catalogue-customer-target-artifact.mjs','utf8');
 assert.deepEqual(source.split('\n').filter(line=>line.startsWith('import ')),[
  "import assert from 'node:assert/strict';",
  "import {execFileSync,spawnSync} from 'node:child_process';",
  "import {createHash} from 'node:crypto';",
  "import {lstatSync,mkdirSync,writeFileSync,readFileSync,renameSync,readdirSync,openSync,fstatSync,closeSync,constants} from 'node:fs';",
  "import {resolve,dirname} from 'node:path';",
  "import {fileURLToPath,pathToFileURL} from 'node:url';",
  "import {catalogueFailfastBinding} from './catalogue-failfast-probe.mjs';",
  "import {catalogueCaptureSourceBytes,cataloguePublicSourcePaths} from './catalogue-capture-source.mjs';",
  "import {catalogueCiIdentity} from './catalogue-ci-profile.mjs';",
 ]);
 assert.doesNotMatch(source,/\b(?:import|require)\s*\(/);
 assert.doesNotMatch(source,/(?:from\s*|import\s*\(|require\s*\()\s*['"][^'"]*catalogue-customer-target-runtime\.mjs['"]/);
 const binding=source.indexOf('const binding=bind(repoRoot,env,execute)'),pins=source.indexOf('for(const entry of targetRuntimeReviewedFiles)assert.equal'),launch=source.indexOf('child=launch(process.execPath');
 assert.ok(binding>=0&&pins>binding&&launch>pins);
});

test('runtime cleanup must match its exact producer phase and unknown phase is untrusted',()=>{
 need();const before=['initialization','binding','source-preflight','identity-preflight','lifecycle','lifecycle-parse','source-post-lifecycle','identity-post-lifecycle'];
 const attempted=['race-setup','race-setup-parse','source-pre-races','identity-pre-races','races','source-post-races','identity-post-races','disposal'];
 const synchronous=['identity-preflight','lifecycle','identity-post-lifecycle','race-setup','identity-pre-races','identity-post-races','disposal'];
 const diagnostic=phase=>({phase,lifecyclePhase:['lifecycle','lifecycle-parse'].includes(phase)?'UNKNOWN':'NOT_APPLICABLE',processExit:synchronous.includes(phase)?'SCRIPT_ERROR':phase==='races'?'SESSION_SQLSTATE':'NOT_APPLICABLE',sqlstate:synchronous.includes(phase)?'55006':phase==='races'?'00000':null});
 const child=body=>({status:1,signal:null,stdout:'',stderr:JSON.stringify(body)+'\n'});
 for(const phase of [...before,...attempted,'source-post-disposal']){
  const expected=before.includes(phase)?'NOT_NEEDED':attempted.includes(phase)?'CLEANUP_UNPROVEN':'COMMITTED_SYNTHETIC_CHILD_DISPOSED';
  for(const cleanup of ['NOT_NEEDED','CLEANUP_UNPROVEN','COMMITTED_SYNTHETIC_CHILD_DISPOSED']){
   const body=runtimeRefusal(cleanup,diagnostic(phase));
   if(cleanup===expected)assert.deepEqual(wrapper.parseTargetRuntimeRefusal(child(body)),body);
   else assert.throws(()=>wrapper.parseTargetRuntimeRefusal(child(body)));
  }
 }
 for(const cleanup of ['NOT_NEEDED','CLEANUP_UNPROVEN','COMMITTED_SYNTHETIC_CHILD_DISPOSED'])assert.throws(()=>wrapper.parseTargetRuntimeRefusal(child(runtimeRefusal(cleanup,diagnostic('unknown')))));
});
test('refusal and success output with post-child source or binding drift carry no cleanup claim',()=>{
 need();for(const mode of ['refusal','success'])for(const mutate of [f=>f.drift(),f=>f.changeBinding()]){
  const f=fixture(),original=f.args.launch;f.args.launch=(...args)=>{
   const success=original(...args);mutate(f);
   return mode==='success'?success:{status:1,signal:null,stdout:'',stderr:JSON.stringify(runtimeRefusal())+'\n'};
  };
  let caught;try{wrapper.runCatalogueCustomerTargetArtifact(f.args);}catch(error){caught=error;}
  assert.equal(caught?.message,'CATALOGUE_TARGET_ARTIFACT_REFUSED');assert.equal(caught.diagnostic.processExit,mode==='success'?'EXIT_0':'EXIT_1');
  assert.equal(caught.diagnostic.cleanup,null);assert.equal(caught.diagnostic.runtime,null);assert.equal(f.calls(),1);refused(f);
 }
});

test('fine-grained lifecycle refusal labels preserve exact cleanup and phase constraints',()=>{
 need();const labels=["TARGET_SETUP","TARGET_INSTALL","TARGET_AUTHORITY","TARGET_EVENTS","TARGET_CASCADE_DROP","TARGET_CASCADE_ADD","TARGET_CASCADE_EVENTS","TARGET_AUTHENTICATED","TARGET_MISSING_IDENTITY","TARGET_ASSERTION_ONLY","TARGET_SESSION_GATE"];
 for(const lifecyclePhase of labels){
  const body=runtimeRefusal('NOT_NEEDED',{phase:'lifecycle',lifecyclePhase,processExit:'SCRIPT_ERROR',sqlstate:null});
  const child={status:1,signal:null,stdout:'',stderr:JSON.stringify(body)+'\n'};
  assert.deepEqual(wrapper.parseTargetRuntimeRefusal(child),body);
  for(const cleanup of ['CLEANUP_UNPROVEN','COMMITTED_SYNTHETIC_CHILD_DISPOSED'])assert.throws(()=>wrapper.parseTargetRuntimeRefusal({...child,stderr:JSON.stringify({...body,cleanup})+'\n'}));
  for(const phase of ['binding','race-setup','races','source-post-disposal'])assert.throws(()=>wrapper.parseTargetRuntimeRefusal({...child,stderr:JSON.stringify({...body,diagnostic:{...body.diagnostic,phase}})+'\n'}));
  const f=fixture();f.args.launch=()=>child;let caught;try{wrapper.runCatalogueCustomerTargetArtifact(f.args);}catch(error){caught=error;}
  assert.equal(caught?.message,'CATALOGUE_TARGET_ARTIFACT_REFUSED');assert.deepEqual(caught.diagnostic,{phase:'child-result',processExit:'EXIT_1',cleanup:'NOT_NEEDED',runtime:body.diagnostic});refused(f);
 }
 const body=runtimeRefusal('NOT_NEEDED',{phase:'lifecycle',lifecyclePhase:'TARGET_ARBITRARY',processExit:'SCRIPT_ERROR',sqlstate:null});
 assert.throws(()=>wrapper.parseTargetRuntimeRefusal({status:1,signal:null,stdout:'',stderr:JSON.stringify(body)+'\n'}));
});

test('status report requires every exact case and a distinct replacement backend',()=>{
 need();assert.equal(typeof wrapper.validateTargetStatusRecovery,'function','Status evidence validator missing');
 const status={status:'BOUNDED_STATUS_RECOVERY_RACES_PASSED',replayBackendPid:204,cases:['inflight_dispatch_and_recovery_busy','committed_fresh_session_replay','replay_after_later_status_change','abandonment_fences_delayed_dispatch','actor_request_namespace_isolation','stale_master_version_refuses','repeatable_read_terminal_safety']};
 assert.deepEqual(wrapper.validateTargetStatusRecovery(status,[201,202,203]),status);
 for(const mutate of [x=>{x.replayBackendPid=202;},x=>{x.replayBackendPid='204';},x=>{x.replayBackendPid=0;},x=>{x.replayBackendPid=2147483648;},x=>{x.cases.pop();},x=>{x.cases.reverse();},x=>{x.status='PASSED';},x=>{x.extra=true;}]){const x=structuredClone(status);mutate(x);assert.throws(()=>wrapper.validateTargetStatusRecovery(x,[201,202,203]));}
 for(const value of [undefined,null,{}])assert.throws(()=>wrapper.validateTargetStatusRecovery(value,[201,202,203]));
});
test('create edit report binds every exact race case to existing checked sessions',()=>{
 need();assert.equal(typeof wrapper.validateCatalogueCreateEditRaces,'function');
 const proof={status:'BOUNDED_CATALOGUE_CREATE_EDIT_RACES_PASSED',backendPids:[201,204,203],cases:['duplicate_create_exact_replay','edit_vs_reenable_both_directions','reconcile_during_blocked_fresh_create']};
 assert.deepEqual(wrapper.validateCatalogueCreateEditRaces(proof,[201,202,203],204),proof);
 for(const mutate of [x=>{x.backendPids=[201,202,203];},x=>{x.backendPids=[201,204,204];},x=>{x.cases.pop();},x=>{x.cases.reverse();},x=>{x.status='PASSED';},x=>{x.extra=true;}]){const x=structuredClone(proof);mutate(x);assert.throws(()=>wrapper.validateCatalogueCreateEditRaces(x,[201,202,203],204));}
});

test('completion proof validation remains synthetic and refuses missing suites or activation overclaims',()=>{
 need();assert.equal(typeof wrapper.validateCatalogueCheckedCompletion,'function');
 const proof={status:'BOUNDED_CHECKED_COMPLETION_SUITES_PASSED',scope:'FUTURE_GENERATION_TWO_SYNTHETIC_ONLY',suites:['checked-boundaries','guarded-delete','guarded-delete-history'],historyScanner:'GENERATION_ONE_OWNER_PRIVATE_ONLY',executionGeneration:2,trackingReady:true,fixtureRestoration:'GENERATION_ONE_TRACKING_FALSE_CONSTRAINTS_VERIFIED',productionGeneration:1,productionTrackingReady:false,concurrency:'UNRUN',hostedParity:'UNVERIFIED',implementationAccepted:false};
 assert.deepEqual(wrapper.validateCatalogueCheckedCompletion(proof),proof);
 for(const mutate of [x=>{x.suites.pop();},x=>{x.suites.reverse();},x=>{x.scope='HOSTED';},x=>{x.productionGeneration=2;},x=>{x.productionTrackingReady=true;},x=>{x.fixtureRestoration='UNPROVEN';},x=>{x.concurrency='PASSED';},x=>{x.hostedParity='VERIFIED';},x=>{x.implementationAccepted=true;},x=>{x.extra=true;}]){const value=structuredClone(proof);mutate(value);assert.throws(()=>wrapper.validateCatalogueCheckedCompletion(value));}
});

test('completion race report requires each executed case and exact three active backend identities',()=>{
 need();assert.equal(typeof wrapper.validateCatalogueCompletionRaces,'function');
 const proof={status:'BOUNDED_CATALOGUE_COMPLETION_RACES_PASSED',backendPids:[201,204,203],cases:['target_duplicate_commit_replay','target_use_blocks_unused_delete','delete_commit_refuses_target_save','product_relation_busy_then_delete','delete_request_busy_replay','truncate_drain_busy_then_refused']};
 assert.deepEqual(wrapper.validateCatalogueCompletionRaces(proof,[201,202,203],204),proof);
 for(const mutate of [x=>{x.backendPids=[201,202,203];},x=>{x.backendPids=[201,204,204];},x=>{x.cases.pop();},x=>{x.cases.reverse();},x=>{x.status='PASSED';},x=>{x.extra=true;}]){const value=structuredClone(proof);mutate(value);assert.throws(()=>wrapper.validateCatalogueCompletionRaces(value,[201,202,203],204));}
 for(const value of [undefined,null,{}])assert.throws(()=>wrapper.validateCatalogueCompletionRaces(value,[201,202,203],204));
});
