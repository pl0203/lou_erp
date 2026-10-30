// @vitest-environment node
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,test} from 'vitest';
import {normalizeReleaseWorkflow,releaseBranch,releaseDispatchExpression,historicalWorkflowHash} from '../catalogue-ci/release-workflow-contract.mjs';
const checkedHistorical=(text:string)=>{const historical=normalizeReleaseWorkflow(text);expect(createHash('sha256').update(historical).digest('hex')).toBe(historicalWorkflowHash);return historical};
const workflow=readFileSync('.github/workflows/pilot-safety.yml','utf8');
const sha='a'.repeat(40), repo='pl0203/lou_erp';
const dispatch=()=>({github:{event_name:'workflow_dispatch',repository:repo,ref:`refs/heads/${releaseBranch}`,sha,event:{pull_request:undefined}},inputs:{expected_source_sha:sha}});
const pr=()=>({github:{event_name:'pull_request',repository:repo,ref:'refs/pull/30/merge',sha:'b'.repeat(40),event:{pull_request:{head:{repo:{full_name:repo},ref:'feat/catalogue-mutations-20261014'},base:{repo:{full_name:repo},ref:'fix/pilot-database'}}}},inputs:{expected_source_sha:undefined}});
const evaluate=(expression:string,context:any)=>new Function('github','inputs','always',`return !!(${expression})`)(context.github,context.inputs,()=>true);
const catalogueConditions=[...workflow.matchAll(/if: >-\n((?:[ ]{6,}[^\n]+\n)+?)(?=\s*(?:env:|uses:|runs-on:))/g)].map(m=>m[1].trim());
const main=workflow.match(/    if: \$\{\{ (.+) \}\}/)![1];
test('only exact release dispatch with matching explicit SHA enables both jobs and all three read-proof steps',()=>{
 expect(catalogueConditions).toHaveLength(4);
 for(const expression of [main,...catalogueConditions]){
  expect(evaluate(expression,dispatch())).toBe(true);const push=dispatch();push.github.event_name='push';push.inputs.expected_source_sha='';expect(evaluate(expression,push)).toBe(true);push.github.ref='refs/heads/unapproved';expect(evaluate(expression,push)).toBe(false);
  for(const mutate of [
   (c:any)=>c.github.ref='refs/heads/fix/pilot-database',
   (c:any)=>c.github.ref=`refs/tags/${releaseBranch}`,
   (c:any)=>c.github.repository='other/repository',
   (c:any)=>c.inputs.expected_source_sha='b'.repeat(40),
   (c:any)=>c.inputs.expected_source_sha='',
   (c:any)=>c.github.event_name='schedule',
  ]){const context=dispatch();mutate(context);expect(evaluate(expression,context)).toBe(false);}
 }
 expect(workflow.split(releaseDispatchExpression)).toHaveLength(6);expect(workflow).toContain(`  push:\n    branches:\n      - ${releaseBranch}\n`);
});
test('historical same-repository catalogue PR eligibility is preserved, wrong head/base/fork refused',()=>{
 expect(evaluate(main,pr())).toBe(true);
 for(const expression of catalogueConditions){
  expect(evaluate(expression,pr())).toBe(true);
  for(const mutate of [(c:any)=>c.github.event.pull_request.head.ref='unreviewed', (c:any)=>c.github.event.pull_request.base.ref='main',(c:any)=>c.github.event.pull_request.head.repo.full_name='fork/repository']){
   const context=pr();mutate(context);expect(evaluate(expression,context)).toBe(false);
  }
 }
});
test('audits disabled without changing dependencies, permissions, services or removing historical gates',()=>{
 const historical=checkedHistorical(workflow);
 expect(workflow).toContain("env:\n  npm_config_audit: 'false'\n");
 expect(workflow).toContain('        required: true\n        type: string');
 expect(workflow).toContain("  PILOT_RELEASE_SOURCE_SHA: ${{ github.event_name == 'push' && github.sha || inputs.expected_source_sha }}");
 expect(workflow.match(/permissions:\n\s+contents: read/g)).toHaveLength(2);
 expect(workflow).not.toMatch(/secrets\.|pull_request_target|continue-on-error/);
 expect(workflow.match(/image: postgres:17/g)).toHaveLength(2);
 expect(workflow.match(/timeout-minutes: 20/g)).toHaveLength(2);
 expect(historical).toContain('      - run: npm ci\n');
 for(const [from,to] of [["npm_config_audit: 'false'","npm_config_audit: 'true'"],[releaseBranch,'unapproved-branch'],['inputs.expected_source_sha == github.sha','true'],['node scripts/test-co-ci.mjs','echo skipped'],['contents: read','contents: write']])expect(()=>checkedHistorical(workflow.replace(from,to))).toThrow();
});

test('native browser accepts only exact release push with bound event and candidate SHA',()=>{
 const runner=readFileSync('tests/catalogue-browser/run.mjs','utf8');
 const start=runner.indexOf("  if (process.env.GITHUB_EVENT_NAME === 'push') {");const end=runner.indexOf('\n  report.context =',start);expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
 const check=new Function('process','assert',runner.slice(start,end));
 const assertion={equal:(a:any,b:any)=>expect(a).toBe(b),match:(s:string,r:RegExp)=>expect(s).toMatch(r),ok:(x:unknown)=>expect(x).toBeTruthy()};
 const env={GITHUB_EVENT_NAME:'push',GITHUB_REF:`refs/heads/${releaseBranch}`,GITHUB_SHA:sha,PILOT_RELEASE_SOURCE_SHA:sha,CATALOGUE_BROWSER_SOURCE_SHA:sha};check({env},assertion);
 for(const [key,value] of [['GITHUB_REF','refs/heads/main'],['GITHUB_REF',`refs/tags/${releaseBranch}`],['GITHUB_SHA','malformed'],['PILOT_RELEASE_SOURCE_SHA','b'.repeat(40)],['CATALOGUE_BROWSER_SOURCE_SHA','b'.repeat(40)],['GITHUB_EVENT_NAME','schedule']])expect(()=>check({env:{...env,[key]:value}},assertion)).toThrow();
 for(const event of ['pull_request','workflow_dispatch'])check({env:{...env,GITHUB_EVENT_NAME:event}},assertion);
});
