import {normalizeReleaseWorkflow} from './release-workflow-contract.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync,readFileSync,writeFileSync,mkdirSync,copyFileSync,rmSync,symlinkSync,readdirSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cataloguePublicSourcePaths,catalogueCaptureSourceIdentity,catalogueCompositionSha256 } from '../../scripts/catalogue-capture-source.mjs';
import { caseNames } from '../database/catalogue-failfast/results.mjs';
let adapter;try {adapter=await import('../../scripts/catalogue-failfast-probe.mjs');}catch{}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const sha=value=>createHash('sha256').update(value).digest('hex');
const source={commit:'a'.repeat(40),tree:'b'.repeat(40),candidate:'c'.repeat(64),clean:true};
const ci={repository:'pl0203/lou_erp',workflow:'Pilot safety checks',workflowRef:'pl0203/lou_erp/.github/workflows/pilot-safety.yml@refs/pull/2/merge',job:'catalogue-baseline',event:'pull_request',ref:'refs/pull/2/merge',eventSha:'d'.repeat(40),runId:'9',runAttempt:'1',headRef:'feat/catalogue-mutations-20261014',baseRef:'fix/pilot-database'};
const env=()=>({PATH:process.env.PATH,CI:'true',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:ci.repository,GITHUB_WORKFLOW:ci.workflow,GITHUB_WORKFLOW_REF:ci.workflowRef,GITHUB_JOB:ci.job,GITHUB_EVENT_NAME:ci.event,GITHUB_REF:ci.ref,GITHUB_SHA:ci.eventSha,GITHUB_RUN_ID:ci.runId,GITHUB_RUN_ATTEMPT:ci.runAttempt,CATALOGUE_CI_PROFILE:'github-catalogue-baseline-v1',CATALOGUE_CI_HEAD_REPOSITORY:ci.repository,CATALOGUE_CI_BASE_REPOSITORY:ci.repository,CATALOGUE_CI_HEAD_REF:ci.headRef,CATALOGUE_CI_BASE_REF:ci.baseRef,CATALOGUE_CI_SOURCE_SHA:source.commit,CATALOGUE_CI_CANDIDATE_SHA256:source.candidate,PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGDATABASE:'pilot_test',PGPASSWORD:'synthetic-ci-only'});
const gitFake=(command,args,options)=>{assert.equal(command,'git');assert.equal(options.env.GIT_NO_LAZY_FETCH,'1');assert.deepEqual(options.stdio,['pipe','pipe','pipe']);return args.includes('HEAD^{tree}')?source.tree:args.includes('HEAD')?source.commit:'';};
const need=()=>assert.ok(adapter,'Fixed post-capture adapter is not implemented');
function fixture() {
 need();const directory=mkdtempSync(join(tmpdir(),'catalogue-failfast-'));
 const manifest=JSON.parse(readFileSync(join(root,'supabase/catalogue/ci/composition.json'),'utf8'));
 for(const path of new Set([...cataloguePublicSourcePaths,...manifest.composition.map(x=>x.path)])) {
  const destination=join(directory,path);mkdirSync(dirname(destination),{recursive:true});copyFileSync(join(root,path),destination);
 }
 const boundSource=catalogueCaptureSourceIdentity(directory,gitFake);
 const identity={profile:'github-catalogue-baseline-v1',source:boundSource,ci:structuredClone(ci),runIdentity:'00000000-0000-4000-8000-000000000001',serverAddress:'172.18.0.2',serverPort:5432,serverVersion:'170011',systemIdentifier:'123456789'};
 const capture={format:'catalogue-baseline-capture-v1',status:'captured-unverified',scope:'synthetic-composed-source-only',task1Complete:false,hostedVerified:false,identity,compositionSha256:catalogueCompositionSha256,compositionPhases:42,refusalProbe:'verified-on-error-stop',implementationSuitesRun:[],catalog:{ignored:'SYNTHETIC_CAPTURE_CANARY'}};
 const directoryEvidence=join(directory,'scale-results/catalogue-baseline');mkdirSync(directoryEvidence,{recursive:true});
 const writeCapture=()=>{const bytes=JSON.stringify(capture);writeFileSync(join(directoryEvidence,'capture.json'),bytes);writeFileSync(join(directoryEvidence,'manifest.json'),JSON.stringify({format:'catalogue-capture-manifest-v1',status:'captured-unverified',source:identity.source,ci:identity.ci,files:[{path:'capture.json',sha256:sha(bytes)}]}));};writeCapture();
 const actionOutput=join(directory,'action-output');writeFileSync(actionOutput,'');
 return {directory,directoryEvidence,capture,writeCapture,actionOutput,env:{...env(),GITHUB_OUTPUT:actionOutput,CATALOGUE_CI_CANDIDATE_SHA256:boundSource.candidate},cleanup:()=>rmSync(directory,{recursive:true,force:true})};
}
const withFixture=async fn=>{const f=fixture();try{await fn(f);}finally{f.cleanup();}};
const passed=()=>({status:'BOUNDED_REPRESENTATIVE_CASES_PASSED',cases:caseNames.map(name=>({name,status:'PASSED',observations:[]}))});
test('post-capture adapter binds current exact source, run, cluster and all executable hashes',()=>withFixture(async f=>{
 let calls=0;const result=await adapter.runCatalogueFailfast({repoRoot:f.directory,env:f.env,execute:gitFake,runProbe:async (binding,repoRoot,connectionEnv)=>{
  calls++;assert.equal(repoRoot,f.directory);assert.deepEqual(binding.identity,f.capture.identity);assert.deepEqual(connectionEnv,f.env);
  assert.deepEqual(Object.keys(binding.files).sort(),['core.mjs','results.mjs','runner.mjs','scenarios.mjs','schema.sql','session.mjs']);
  for(const [path,digest] of Object.entries(binding.files))assert.equal(digest,sha(readFileSync(join(f.directory,'tests/database/catalogue-failfast',path))));
  return {...passed(),error:'UNEXPECTED_PRIVATE_CANARY',sessions:[{stderr:'UNEXPECTED_PRIVATE_CANARY'}]};
 }});
 assert.equal(calls,1);assert.equal(result.status,'BOUNDED_REPRESENTATIVE_CASES_PASSED');
 const out=join(f.directory,'scale-results/catalogue-failfast');assert.deepEqual(readdirSync(out).sort(),['manifest.json','results.json']);
 const bytes=readFileSync(join(out,'results.json'),'utf8');assert.ok(!bytes.includes('CANARY'));assert.ok(!bytes.includes('catalog'));
 const manifest=JSON.parse(readFileSync(join(out,'manifest.json'),'utf8'));assert.deepEqual(manifest.files,[{path:'results.json',sha256:sha(bytes)}]);
 assert.equal(readFileSync(f.actionOutput,'utf8'),'bundle_ready=false\nbundle_ready=true\n');
 await assert.rejects(adapter.runCatalogueFailfast({repoRoot:f.directory,env:f.env,execute:gitFake,runProbe:async()=>{calls++;return passed();}}),/CATALOGUE_FAILFAST_REFUSED/);
 assert.equal(calls,1);
 assert.equal(readFileSync(f.actionOutput,'utf8').trim().split('\n').at(-1),'bundle_ready=false');
}));
test('capture tampering or identity drift refuses before probe execution',async()=>{
 need();for(const change of [f=>f.capture.identity.source.commit='f'.repeat(40),f=>f.capture.identity.ci.runAttempt='2',f=>f.capture.status='complete',f=>f.capture.hostedVerified=true,f=>f.capture.task1Complete=true,f=>f.capture.refusalProbe='unverified',f=>f.capture.compositionSha256='f'.repeat(64),f=>f.capture.compositionPhases=41]) {
  await withFixture(async f=>{change(f);f.writeCapture();let called=false;await assert.rejects(adapter.runCatalogueFailfast({repoRoot:f.directory,env:f.env,execute:gitFake,runProbe:async()=>{called=true;return passed();}}),/CATALOGUE_FAILFAST_REFUSED/);assert.equal(called,false);assert.equal(readFileSync(f.actionOutput,'utf8').trim().split('\n').at(-1),'bundle_ready=false');});
 }
 await withFixture(async f=>{writeFileSync(join(f.directoryEvidence,'capture.json'),'{}');let called=false;await assert.rejects(adapter.runCatalogueFailfast({repoRoot:f.directory,env:f.env,execute:gitFake,runProbe:async()=>{called=true;return passed();}}),/CATALOGUE_FAILFAST_REFUSED/);assert.equal(called,false);});
});
test('post-capture adapter refuses changed candidate files, output symlinks, and report reuse',async()=>{
 need();for(const path of ['tests/database/catalogue-failfast/schema.sql','tests/database/catalogue-failfast/scenarios.mjs','scripts/catalogue-failfast-probe.mjs'])await withFixture(async f=>{
  writeFileSync(join(f.directory,path),readFileSync(join(f.directory,path),'utf8')+'\n');let called=false;
  await assert.rejects(adapter.runCatalogueFailfast({repoRoot:f.directory,env:f.env,execute:gitFake,runProbe:async()=>{called=true;return passed();}}),/CATALOGUE_FAILFAST_REFUSED/);assert.equal(called,false);assert.equal(readFileSync(f.actionOutput,'utf8').trim().split('\n').at(-1),'bundle_ready=false');
 });
 for(const path of ['scale-results/catalogue-failfast','scale-results/catalogue-baseline/capture.json','scale-results/catalogue-baseline/manifest.json'])await withFixture(async f=>{
  const target=join(f.directory,path);if(existsSync(target))rmSync(target);symlinkSync(join(f.directory,'missing'),target);let called=false;
  await assert.rejects(adapter.runCatalogueFailfast({repoRoot:f.directory,env:f.env,execute:gitFake,runProbe:async()=>{called=true;return passed();}}),/CATALOGUE_FAILFAST_REFUSED/);assert.equal(called,false);assert.equal(readFileSync(f.actionOutput,'utf8').trim().split('\n').at(-1),'bundle_ready=false');
 });
});
test('failed probe saves only failed typed results and never copies raw exception payloads',()=>withFixture(async f=>{
 const raw=Object.assign(new Error('UNEXPECTED_PRIVATE_CANARY'),{stdout:'UNEXPECTED_PRIVATE_CANARY',stderr:'UNEXPECTED_PRIVATE_CANARY',report:{...passed(),status:'FAILED_OR_INCONCLUSIVE',cases:[{name:caseNames[0],status:'FAILED',observations:[]}],error:'UNEXPECTED_PRIVATE_CANARY'}});
 await assert.rejects(adapter.runCatalogueFailfast({repoRoot:f.directory,env:f.env,execute:gitFake,runProbe:async()=>{throw raw;}}),error=>error.message==='CATALOGUE_FAILFAST_REFUSED'&&error.cause===undefined);
 const bytes=readFileSync(join(f.directory,'scale-results/catalogue-failfast/results.json'),'utf8');assert.ok(!bytes.includes('CANARY'));const result=JSON.parse(bytes);assert.equal(result.status,'FAILED_OR_INCONCLUSIVE');assert.equal(result.cases[0].status,'FAILED');
 assert.equal(readFileSync(f.actionOutput,'utf8'),'bundle_ready=false\nbundle_ready=true\n');
}));
test('manifest-write failure cannot expose a passed result in the uploaded directory',()=>withFixture(async f=>{
 await assert.rejects(adapter.runCatalogueFailfast({repoRoot:f.directory,env:f.env,execute:gitFake,runProbe:async()=>{
  const staging=join(f.directory,'scale-results/catalogue-failfast-pending');
  if(!existsSync(staging))mkdirSync(staging);
  mkdirSync(join(staging,'manifest.json'));
  mkdirSync(join(f.directory,'scale-results/catalogue-failfast/manifest.json'));
  return passed();
 }}),/CATALOGUE_FAILFAST_REFUSED/);
 assert.equal(existsSync(join(f.directory,'scale-results/catalogue-failfast/results.json')),false);
 assert.equal(readFileSync(f.actionOutput,'utf8').trim().split('\n').at(-1),'bundle_ready=false');
}));
test('malformed or false-success result fails closed with a sanitized failure receipt',async()=>{
 need();for(const change of [r=>r.cases.pop(),r=>r.cases[0].status='FAILED',r=>r.cases[0].name='UNEXPECTED_PRIVATE_CANARY',r=>r.cases[0].observations=[{sql:'UNEXPECTED_PRIVATE_CANARY'}]])await withFixture(async f=>{
  const r=passed();change(r);await assert.rejects(adapter.runCatalogueFailfast({repoRoot:f.directory,env:f.env,execute:gitFake,runProbe:async()=>r}),/CATALOGUE_FAILFAST_REFUSED/);
  const bytes=readFileSync(join(f.directory,'scale-results/catalogue-failfast/results.json'),'utf8');assert.ok(!bytes.includes('CANARY'));assert.equal(JSON.parse(bytes).status,'FAILED_OR_INCONCLUSIVE');
 });
});
test('CLI accepts no switches and exposes only constant failure output',()=>{
 need();for(const args of [[],['--url','UNEXPECTED_PRIVATE_CANARY'],['--reset']]) {
  const result=spawnSync(process.execPath,[join(root,'scripts/catalogue-failfast-probe.mjs'),...args],{env:{PATH:'/intentionally-absent-executables'},encoding:'utf8',timeout:10000});
  assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr.trim(),'CATALOGUE_FAILFAST_REFUSED');
 }
});
test('workflow adds only a fixed post-capture probe and separately scoped generic result upload',()=>{
 const workflow=normalizeReleaseWorkflow(readFileSync(join(root,'.github/workflows/pilot-safety.yml'),'utf8'));const split=workflow.indexOf('\n  catalogue-baseline:');
 // Preserve the historical application/CO prefix; separately pin both reviewed additions.
 const scheduling='    needs: catalogue-baseline\n    if: ${{ always() }}\n';
 assert.equal(workflow.split(scheduling).length,2);
 assert.ok(workflow.includes(`  synthetic-safety:\n${scheduling}    runs-on: ubuntu-latest`));
 // Independently pin the sole browser addition before removing it from the historical prefix.
 const browserStart=workflow.indexOf('      - name: Native synthetic catalogue browser QA');
 const browserRegion=workflow.slice(browserStart,browserStart+640);
 assert.equal(sha(browserRegion),'52835f2c64d1d3f84e534c2738b4a246013d32ece348007d14c7e814e7a3aaa5');
 assert.equal(workflow.split(browserRegion).length,2);
 assert.ok(workflow.includes('      - run: npm run build\n'+browserRegion+'      - name: Install official PostgreSQL client'));
 // Pin the approved additive SJ step independently; retain the historical prefix pin.
 const receivedStart=workflow.indexOf('      - name: Guarded SJ received-date migration');
 const receivedRegion=workflow.slice(receivedStart,receivedStart+901);
 assert.equal(sha(receivedRegion),'eb6c3d02339aa38c41e742303ebcf3b87ae63557d302b0478d1a566bca3eccc9');
 assert.equal(workflow.split(receivedRegion).length,2);
 assert.ok(workflow.includes('          done\n'+receivedRegion+'      - name: Preserve final CO evidence'));
 const prefix=workflow.slice(0,split).replace(scheduling,'').replace(browserRegion,'').replace(receivedRegion,'');
 const decoderStart=prefix.indexOf('      - name: Bind independent read decoder source');
 const commentStart=prefix.indexOf('  # Independent of synthetic-safety:');
 assert.ok(decoderStart>0&&commentStart>decoderStart);
 assert.equal(sha(prefix.slice(decoderStart,commentStart)),'8921961b19dff1f49d74cf285076cab79c8a3d3467a8e7bd8b1b7453f8980e73');
 assert.equal(sha(prefix.slice(0,decoderStart)+prefix.slice(commentStart)),'32b1e9ded0e18c707af5e2bdc15c7730a0a61634da296b078240b2d2ad6cf505');
 const job=workflow.slice(split);assert.ok(job.includes('--log-driver=none'));
 assert.ok(job.includes('node --test tests/database/catalogue-failfast/*.node.mjs tests/catalogue-ci/failfast.node.mjs'));
 assert.ok(job.indexOf('node scripts/catalogue-failfast-probe.mjs')>job.indexOf('node scripts/catalogue-capture-baseline.mjs'));
 assert.ok(job.includes('path: scale-results/catalogue-failfast'));assert.ok(!job.includes('path: scale-results\n'));
 assert.ok(job.includes("if: ${{ always() && steps.catalogue-failfast.outputs.bundle_ready == 'true' }}"));
 assert.ok(!job.includes("steps.catalogue-failfast.outcome != 'skipped'"));
});
test('pre-existing output content cannot authorize this invocation to upload it',()=>withFixture(async f=>{
 const output=join(f.directory,'scale-results/catalogue-failfast');mkdirSync(output);writeFileSync(join(output,'results.json'),'UNEXPECTED_PRIVATE_CANARY');
 await assert.rejects(adapter.runCatalogueFailfast({repoRoot:f.directory,env:f.env,execute:gitFake,runProbe:async()=>assert.fail('Existing output must refuse before the probe')}),/CATALOGUE_FAILFAST_REFUSED/);
 assert.equal(readFileSync(f.actionOutput,'utf8').trim().split('\n').at(-1),'bundle_ready=false');assert.equal(readFileSync(join(output,'results.json'),'utf8'),'UNEXPECTED_PRIVATE_CANARY');
}));
test('every integrated probe and test byte is included in source candidate binding',()=>{
 const names=readdirSync(join(root,'tests/database/catalogue-failfast')).filter(name=>/\.(?:mjs|sql)$/.test(name));
 for(const path of ['scripts/catalogue-failfast-probe.mjs','tests/catalogue-ci/failfast.node.mjs',...names.map(name=>`tests/database/catalogue-failfast/${name}`)])assert.ok(cataloguePublicSourcePaths.includes(path),path);
});
