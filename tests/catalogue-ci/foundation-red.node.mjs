import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync,readFileSync,writeFileSync,mkdirSync,copyFileSync,rmSync,symlinkSync,readdirSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cataloguePublicSourcePaths,catalogueCaptureSourceIdentity,catalogueCompositionSha256 } from '../../scripts/catalogue-capture-source.mjs';
let runner;try {runner=await import('../../scripts/catalogue-foundation-red.mjs');}catch{}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const sha=x=>createHash('sha256').update(x).digest('hex');
const source={commit:'a'.repeat(40),tree:'b'.repeat(40)};
const ci={repository:'pl0203/lou_erp',workflow:'Pilot safety checks',workflowRef:'pl0203/lou_erp/.github/workflows/pilot-safety.yml@refs/pull/30/merge',job:'catalogue-baseline',event:'pull_request',ref:'refs/pull/30/merge',eventSha:'d'.repeat(40),runId:'9',runAttempt:'1',headRef:'feat/catalogue-mutations-20261014',baseRef:'fix/pilot-database'};
const need=()=>assert.ok(runner,'Bound foundation RED checkpoint is not implemented');
const expectedError=()=>Object.assign(new Error('PRIVATE_CANARY'),{status:3,signal:null,stdout:'CATALOGUE_FOUNDATION_FIXTURE_READY\n',stderr:'ERROR:  PFC01: CATALOGUE_FOUNDATION_MISSING_SERVER_COLUMNS\nCONTEXT: private internal text\n'});
function fixture() {
 need();const directory=mkdtempSync(join(tmpdir(),'catalogue-foundation-red-'));
 const composition=JSON.parse(readFileSync(join(root,'supabase/catalogue/ci/composition.json'),'utf8'));
 for(const path of new Set([...cataloguePublicSourcePaths,...composition.composition.map(x=>x.path)])) {
  const destination=join(directory,path);mkdirSync(dirname(destination),{recursive:true});copyFileSync(join(root,path),destination);
 }
 const git=(command,args,options)=>{assert.equal(command,'git');assert.equal(options.env.GIT_NO_LAZY_FETCH,'1');return args.includes('HEAD^{tree}')?source.tree:args.includes('HEAD')?source.commit:'';};
 const bound=catalogueCaptureSourceIdentity(directory,git);
 const identity={profile:'github-catalogue-baseline-v1',source:bound,ci,runIdentity:'00000000-0000-4000-8000-000000000001',serverAddress:'172.18.0.2',serverPort:5432,serverVersion:'170011',systemIdentifier:'123456789'};
 const capture={format:'catalogue-baseline-capture-v1',status:'captured-unverified',scope:'synthetic-composed-source-only',task1Complete:false,hostedVerified:false,identity,compositionSha256:catalogueCompositionSha256,compositionPhases:42,refusalProbe:'verified-on-error-stop',implementationSuitesRun:[],catalog:{}};
 const captured=join(directory,'scale-results/catalogue-baseline');mkdirSync(captured,{recursive:true});
 const writeCapture=()=>{const bytes=JSON.stringify(capture);writeFileSync(join(captured,'capture.json'),bytes);writeFileSync(join(captured,'manifest.json'),JSON.stringify({format:'catalogue-capture-manifest-v1',status:'captured-unverified',source:bound,ci,files:[{path:'capture.json',sha256:sha(bytes)}]}));};writeCapture();
 const output=join(directory,'action-output');writeFileSync(output,'');
 const env={PATH:process.env.PATH,GIT_NO_LAZY_FETCH:'1',CI:'true',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:ci.repository,GITHUB_WORKFLOW:ci.workflow,GITHUB_WORKFLOW_REF:ci.workflowRef,GITHUB_JOB:ci.job,GITHUB_EVENT_NAME:ci.event,GITHUB_REF:ci.ref,GITHUB_SHA:ci.eventSha,GITHUB_RUN_ID:ci.runId,GITHUB_RUN_ATTEMPT:ci.runAttempt,CATALOGUE_CI_PROFILE:identity.profile,CATALOGUE_CI_HEAD_REPOSITORY:ci.repository,CATALOGUE_CI_BASE_REPOSITORY:ci.repository,CATALOGUE_CI_HEAD_REF:ci.headRef,CATALOGUE_CI_BASE_REF:ci.baseRef,CATALOGUE_CI_SOURCE_SHA:bound.commit,CATALOGUE_CI_CANDIDATE_SHA256:bound.candidate,PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGDATABASE:'pilot_test',PGPASSWORD:'synthetic-ci-only',GITHUB_OUTPUT:output};
 const calls=[];let error=expectedError();
 const execute=(command,args,options)=>{
  if(command==='git')return git(command,args,options);
  assert.equal(command,'psql');calls.push({args,options});
  assert.equal(options.env.GIT_NO_LAZY_FETCH,'1');assert.equal(options.env.PGDATABASE,'pilot_catalogue_test');assert.equal(options.env.HOME,undefined);
  if(options.input.includes('CATALOGUE_FIXTURE_OBSERVATION'))return JSON.stringify({database:'pilot_catalogue_test',operator:'postgres',database_owner:'postgres',system_identifier:identity.systemIdentifier,server_version_num:identity.serverVersion,server_address:identity.serverAddress,server_port:5432,marker:{kind:'r',owner:'postgres',rows:[{singleton:true,purpose:'disposable-catalogue-ci-v1',identity}]}});
  if(error)throw error;return 'CATALOGUE_FOUNDATION_FIXTURE_READY\nCATALOGUE_FOUNDATION_CONTRACT_PASSED\n';
 };
 return {directory,capture,writeCapture,output,env,calls,execute,setError:x=>error=x,cleanup:()=>rmSync(directory,{recursive:true,force:true})};
}
const withFixture=fn=>{const f=fixture();try{return fn(f);}finally{f.cleanup();}};
test('only the real expected SQL assertion failure is classified as missing-contract RED',()=>{
 need();assert.equal(runner.assertFoundationMissingContract(expectedError()),undefined);
 for(const change of [{status:0},{status:2},{signal:'SIGTERM'},{code:'ENOENT'},{stdout:''},{stdout:'CATALOGUE_FOUNDATION_FIXTURE_READY\nEXTRA\n'},{stderr:'ERROR:  42P01: fixture missing'},{stderr:'ERROR:  PFC01: CATALOGUE_FOUNDATION_MISSING_SERVER_COLUMNS_EXTRA'}])assert.throws(()=>runner.assertFoundationMissingContract(Object.assign(expectedError(),change)));
 assert.throws(()=>runner.assertFoundationMissingContract(undefined));
});
test('the fixed foundation SQL checks fixture setup before missing-contract assertion inside read-only transaction',()=>{
 need();const sql=readFileSync(join(root,'tests/database/catalogue/foundation.sql'),'utf8');
 assert.ok(sql.startsWith('BEGIN READ ONLY;'));assert.ok(sql.endsWith('ROLLBACK;\n'));
 assert.ok(sql.indexOf('CATALOGUE_FOUNDATION_FIXTURE_INVALID')<sql.indexOf('CATALOGUE_FOUNDATION_FIXTURE_READY'));
 assert.ok(sql.indexOf('CATALOGUE_FOUNDATION_FIXTURE_READY')<sql.indexOf('CATALOGUE_FOUNDATION_MISSING_SERVER_COLUMNS'));
 assert.match(sql,/attname = 'is_enabled'/);assert.match(sql,/attname = 'catalog_version'/);
 assert.ok(!/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COMMIT)\b/i.test(sql.replace(/'(?:[^']|'')*'/g,"''").replace(/--[^\n]*/g,'')));
});
test('bound invocation emits only an explicit RED artifact with exact identity and source checksum',()=>withFixture(f=>{
 const report=runner.runCatalogueFoundationRed({repoRoot:f.directory,env:f.env,execute:f.execute});
 assert.equal(report.status,'EXPECTED_MISSING_CONTRACT_RED');assert.equal(report.scope,'synthetic-foundation-contract-only');assert.equal(report.implementationAccepted,false);assert.equal(report.hostedVerified,false);
 assert.deepEqual(report.identity,f.capture.identity);assert.equal(report.testSha256,sha(readFileSync(join(f.directory,'tests/database/catalogue/foundation.sql'))));
 assert.equal(f.calls.length,3);for(const call of f.calls)assert.ok(call.options.input.includes('SELECT 1/0 AS catalogue_identity_refused;'));
 const out=join(f.directory,'scale-results/catalogue-foundation-red');assert.deepEqual(readdirSync(out).sort(),['manifest.json','results.json']);
 const bytes=readFileSync(join(out,'results.json'),'utf8');assert.ok(!bytes.includes('PRIVATE_CANARY'));assert.ok(!bytes.includes('private internal'));
 assert.deepEqual(JSON.parse(readFileSync(join(out,'manifest.json'),'utf8')).files,[{path:'results.json',sha256:sha(bytes)}]);
 assert.equal(readFileSync(f.output,'utf8'),'bundle_ready=false\nbundle_ready=true\n');
}));
test('setup failure, unexpected success, source drift and ambient targets cannot authorize an upload',()=>{
 need();for(const change of [f=>f.setError(null),f=>f.setError(Object.assign(expectedError(),{stderr:'ERROR:  PFC02: CATALOGUE_FOUNDATION_FIXTURE_INVALID',stdout:''})),f=>f.env.PGHOST='remote.invalid',f=>{f.capture.identity.ci={...ci,runAttempt:'2'};f.writeCapture();},f=>writeFileSync(join(f.directory,'tests/database/catalogue/foundation.sql'),'SELECT 1;')])withFixture(f=>{
  change(f);assert.throws(()=>runner.runCatalogueFoundationRed({repoRoot:f.directory,env:f.env,execute:f.execute}),/^Error: CATALOGUE_FOUNDATION_RED_REFUSED$/);
  assert.equal(readFileSync(f.output,'utf8'),'bundle_ready=false\n');assert.equal(existsSync(join(f.directory,'scale-results/catalogue-foundation-red/results.json')),false);
 });
});
test('preexisting or symlink output and partial manifest never become eligible this invocation',()=>{
 need();for(const change of [f=>{mkdirSync(join(f.directory,'scale-results/catalogue-foundation-red'));writeFileSync(join(f.directory,'scale-results/catalogue-foundation-red/results.json'),'PRIVATE_CANARY');},f=>symlinkSync(join(f.directory,'missing'),join(f.directory,'scale-results/catalogue-foundation-red')),f=>mkdirSync(join(f.directory,'scale-results/catalogue-foundation-red-pending'))])withFixture(f=>{
  change(f);assert.throws(()=>runner.runCatalogueFoundationRed({repoRoot:f.directory,env:f.env,execute:f.execute}),/CATALOGUE_FOUNDATION_RED_REFUSED/);assert.equal(f.calls.length,0);assert.equal(readFileSync(f.output,'utf8'),'bundle_ready=false\n');
 });
});
test('CLI has no target or implementation switch and returns only sanitized refusal outside dedicated CI',()=>{
 need();for(const args of [[],['--url','PRIVATE_CANARY'],['--apply']]){
  const result=spawnSync(process.execPath,[join(root,'scripts/catalogue-foundation-red.mjs'),...args],{env:{PATH:'/intentionally-absent-executables',GIT_NO_LAZY_FETCH:'1'},encoding:'utf8'});
  assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,'CATALOGUE_FOUNDATION_RED_REFUSED\n');
 }
});
test('only dedicated job and source binding include the red checkpoint and condition its exact upload',()=>{
 need();for(const path of ['scripts/catalogue-foundation-red.mjs','tests/database/catalogue/foundation.sql','tests/catalogue-ci/foundation-red.node.mjs'])assert.ok(cataloguePublicSourcePaths.includes(path));
 const workflow=readFileSync(join(root,'.github/workflows/pilot-safety.yml'),'utf8'),split=workflow.indexOf('\n  catalogue-baseline:');
 assert.equal(sha(workflow.slice(0,split)),'32b1e9ded0e18c707af5e2bdc15c7730a0a61634da296b078240b2d2ad6cf505');
 const job=workflow.slice(split);assert.ok(job.includes('node --test tests/catalogue-ci/foundation-red.node.mjs'));
 assert.ok(job.indexOf('node scripts/catalogue-foundation-red.mjs')>job.indexOf('node scripts/catalogue-failfast-probe.mjs'));
 assert.ok(job.includes("if: ${{ always() && steps.catalogue-foundation-red.outputs.bundle_ready == 'true' }}"));assert.ok(job.includes('path: scale-results/catalogue-foundation-red'));
 assert.ok(!job.includes('continue-on-error: true'));
});
