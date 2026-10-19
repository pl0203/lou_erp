import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { PsqlSession } from './session.mjs';
import { runScenarios } from './scenarios.mjs';
let output;try { output=await import('./results.mjs'); } catch {}
const root=dirname(fileURLToPath(import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sentinel='UNEXPECTED_PRIVATE_CANARY';
const source={commit:'a'.repeat(40),tree:'b'.repeat(40),candidate:'c'.repeat(64),clean:true};
const ci={repository:'pl0203/lou_erp',workflow:'Pilot safety checks',workflowRef:'pl0203/lou_erp/.github/workflows/pilot-safety.yml@refs/pull/2/merge',job:'catalogue-baseline',event:'pull_request',ref:'refs/pull/2/merge',eventSha:'d'.repeat(40),runId:'9',runAttempt:'1',headRef:'feat/catalogue-mutations-20261014',baseRef:'fix/pilot-database'};
const identity={profile:'github-catalogue-baseline-v1',source,ci,runIdentity:'00000000-0000-4000-8000-000000000001',serverAddress:'172.18.0.2',serverPort:5432,serverVersion:'170011',systemIdentifier:'123456789'};
const files=()=>Object.fromEntries(['core.mjs','runner.mjs','scenarios.mjs','schema.sql','session.mjs',...(output?['results.mjs']:[])].sort().map(name=>[name,hash(readFileSync(join(root,name)))]));
const binding=()=>({format:'synthetic-failfast-binding-v1',approval:'REVIEWED_FOR_THIS_RUN',scope:'generic-synthetic-only',identity,files:files()});
const env=()=>({PATH:process.env.PATH,CI:'true',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:ci.repository,GITHUB_WORKFLOW:ci.workflow,GITHUB_WORKFLOW_REF:ci.workflowRef,GITHUB_JOB:ci.job,GITHUB_EVENT_NAME:ci.event,GITHUB_REF:ci.ref,GITHUB_SHA:ci.eventSha,GITHUB_RUN_ID:ci.runId,GITHUB_RUN_ATTEMPT:ci.runAttempt,CATALOGUE_CI_PROFILE:identity.profile,CATALOGUE_CI_HEAD_REPOSITORY:ci.repository,CATALOGUE_CI_BASE_REPOSITORY:ci.repository,CATALOGUE_CI_HEAD_REF:ci.headRef,CATALOGUE_CI_BASE_REF:ci.baseRef,CATALOGUE_CI_SOURCE_SHA:source.commit,CATALOGUE_CI_CANDIDATE_SHA256:source.candidate,PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGDATABASE:'pilot_test',PGPASSWORD:'synthetic-ci-only'});
const temporary=fn=>{const dir=mkdtempSync(join(tmpdir(),'synthetic-output-'));try{return fn(dir);}finally{rmSync(dir,{recursive:true,force:true});}};
const runCli=(dir,b,e=env())=>{writeFileSync(join(dir,'binding.json'),JSON.stringify(b));return spawnSync(process.execPath,[join(root,'runner.mjs'),'--binding',join(dir,'binding.json'),'--source-root',dir],{encoding:'utf8',env:e,timeout:10000});};

test('CLI redacts malformed input instead of printing assertion data',()=>temporary(dir=>{
 const result=runCli(dir,{format:sentinel});
 assert.equal(result.status,1);assert.equal(result.stdout,'');
 assert.equal(result.stderr.trim(),'SYNTHETIC_FAILFAST_REFUSED');
}));
test('CLI pipes subprocess stderr and never prints subprocess failure payloads',()=>temporary(dir=>{
 writeFileSync(join(dir,'git'),`#!/bin/sh\nprintf '${sentinel} raw SQL function body\\n' >&2\nexit 3\n`,{mode:0o700});
 const result=runCli(dir,binding(),{...env(),PATH:dir});
 assert.equal(result.status,1);assert.equal(result.stdout,'');
 assert.equal(result.stderr.trim(),'SYNTHETIC_FAILFAST_REFUSED');
}));
test('session errors and retained diagnostics exclude SQL and subprocess text',async()=>{
 const child=`process.stdin.once('data',()=>{process.stderr.write('${sentinel} raw function body');process.exit(3);});`;
 const session=new PsqlSession({name:'redaction',command:process.execPath,args:['-e',child],env:{PATH:process.env.PATH}});
 try {
  await assert.rejects(session.query(`SELECT '${sentinel}';`),error=>!error.message.includes(sentinel));
  assert.equal(session.transcript,undefined);assert.equal(session.stderr,undefined);
 } finally { await session.close(); }
});
const need=()=>assert.ok(output,'Strict public result adapter is not implemented');
const observation={pid:21,state:'active',blockers:[22],wait_event_type:'Lock',wait_event:'transactionid',locks:[{locktype:'transactionid',mode:'ShareLock',granted:false,relation:sentinel,transactionid:sentinel}],sql:sentinel};
const report=()=>({status:'BOUNDED_REPRESENTATIVE_CASES_PASSED',cases:output.caseNames.map(name=>({name,status:'PASSED',observations:[]})),sessions:[{stderr:sentinel,commands:[{sql:sentinel}]}],topology:sentinel,error:sentinel,claim:sentinel});
test('public adapter covers the exact existing case inventory',async()=>{
 need();const names=[];await runScenarios({test:async name=>names.push(name)});
 assert.deepEqual(output.caseNames,names);
});
test('result summary only emits typed case outcomes and necessary synthetic observations',()=>{
 need();const raw=report();raw.cases[0].observations=[{barrier:observation},{cycle:[observation,{...observation,pid:22,blockers:[21]}]},{results:[{sqlstate:'00000',stdout:sentinel,elapsedMs:1},{sqlstate:'40P01',stderr:sentinel,elapsedMs:12}]},{fastRefusal:{sqlstate:'55P03',elapsedMs:1,observed:[observation],stdout:sentinel}}];
 const result=output.publicResult(raw,binding());const json=JSON.stringify(result);
 assert.ok(!json.includes(sentinel));assert.ok(!/"(?:stdout|stderr|commands|topology|claim|sql|relation)":/.test(json));
 assert.equal(result.status,'BOUNDED_REPRESENTATIVE_CASES_PASSED');assert.equal(result.cases.length,15);
 assert.deepEqual(result.source,source);assert.deepEqual(result.run,{id:'9',attempt:'1',eventSha:ci.eventSha,fixture:identity.runIdentity});
 assert.match(result.identitySha256,/^[a-f0-9]{64}$/);assert.match(result.clusterSha256,/^[a-f0-9]{64}$/);
 assert.equal(result.cases[0].observations[0].barrier.pid,21);assert.deepEqual(result.cases[0].observations[0].barrier.blockers,[22]);
 assert.deepEqual(result.cases[0].observations[2].results.map(x=>x.sqlstate),['00000','40P01']);
});
test('sanitization never promotes missing, duplicate, failed, running or inconclusive cases to success',()=>{
 need();for(const change of [r=>r.cases.pop(),r=>r.cases[1]=r.cases[0],r=>r.cases[0].status='FAILED',r=>r.cases[0].status='RUNNING',r=>r.status='RUNNING']){
  const r=report();change(r);assert.throws(()=>output.publicResult(r,binding()));
 }
 const failed=report();failed.status='FAILED_OR_INCONCLUSIVE';failed.cases=failed.cases.slice(0,1);failed.cases[0].status='FAILED';
 const result=output.publicResult(failed,binding());assert.equal(result.status,'FAILED_OR_INCONCLUSIVE');assert.equal(result.cases[0].status,'FAILED');assert.ok(!JSON.stringify(result).includes(sentinel));
});
test('public observations reject unknown cases, malformed SQLSTATE, identifiers and unbounded data',()=>{
 need();for(const change of [r=>r.cases[0].name=sentinel,r=>r.cases[0].observations=[{results:[{sqlstate:sentinel}]}],r=>r.cases[0].observations=[{barrier:{...observation,pid:sentinel}}],r=>r.cases[0].observations=Array(1001).fill({barrier:observation}),r=>r.cases[0].observations=[{error:sentinel}]]){
  const r=report();change(r);assert.throws(()=>output.publicResult(r,binding()));
 }
});
test('sparse case and observation arrays cannot bypass result validation',()=>{
 need();for(const change of [r=>r.cases=new Array(15),r=>delete r.cases[0],r=>r.cases[0].observations=new Array(1),r=>r.cases[0].observations=[{cycle:new Array(2)}],r=>r.cases[0].observations=[{results:new Array(2)}],r=>r.cases[0].observations=[{barrier:{...observation,locks:new Array(1)}}]]) {
  const raw=report();change(raw);assert.throws(()=>output.publicResult(raw,binding()));
 }
});
