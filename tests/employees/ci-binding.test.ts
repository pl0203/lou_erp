import { assertEmployeeJobBudgets } from '../catalogue-ci/workflow-budget.mjs'
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { catalogueCiConnection, catalogueCiIdentity } from '../../scripts/catalogue-ci-profile.mjs'
import { connectionFor } from '../database/catalogue-failfast/core.mjs'
const source={commit:'a'.repeat(40),tree:'b'.repeat(40),candidate:'c'.repeat(64),clean:true}
const env=(head='feat/employee-foundation-20261019')=>({CI:'true',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'pl0203/lou_erp',GITHUB_WORKFLOW:'Pilot safety checks',GITHUB_JOB:'catalogue-baseline',GITHUB_EVENT_NAME:'pull_request',GITHUB_REF:'refs/pull/2/merge',GITHUB_SHA:'d'.repeat(40),GITHUB_WORKFLOW_REF:'pl0203/lou_erp/.github/workflows/pilot-safety.yml@refs/pull/2/merge',GITHUB_RUN_ID:'9',GITHUB_RUN_ATTEMPT:'1',CATALOGUE_CI_PROFILE:'github-catalogue-baseline-v1',CATALOGUE_CI_HEAD_REPOSITORY:'pl0203/lou_erp',CATALOGUE_CI_BASE_REPOSITORY:'pl0203/lou_erp',CATALOGUE_CI_HEAD_REF:head,CATALOGUE_CI_BASE_REF:'fix/pilot-database',CATALOGUE_CI_SOURCE_SHA:source.commit,CATALOGUE_CI_CANDIDATE_SHA256:source.candidate,PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGDATABASE:'pilot_test',PGPASSWORD:'synthetic-ci-only',PATH:'/usr/bin'})
const observed={database:'pilot_test',operator:'postgres',database_owner:'postgres',server_address:'172.18.0.2',server_port:5432,server_version_num:'170011',system_identifier:'123456789'}
const identity=(e:ReturnType<typeof env>)=>catalogueCiIdentity(e,source,observed,'00000000-0000-4000-8000-000000000001')
describe('combined employee CI keeps independent catalogue proof',()=>{
 it.each(['feat/employee-foundation-20261019','feat/catalogue-mutations-20261014'])('admits only explicitly reviewed head %s through capture and downstream binding',head=>{
  const e=env(head)
  expect(catalogueCiConnection(e,source).PGDATABASE).toBe('pilot_test')
  const b={format:'synthetic-failfast-binding-v1',approval:'REVIEWED_FOR_THIS_RUN',identity:identity(e),files:{'schema.sql':'e'.repeat(64)},scope:'generic-synthetic-only'}
  expect(connectionFor(e,b).PGDATABASE).toBe('pilot_catalogue_test')
  expect(b.identity.ci.headRef).toBe(head)
 })
 it.each([['CATALOGUE_CI_HEAD_REF','feat/unrelated'],['CATALOGUE_CI_BASE_REF','main'],['CATALOGUE_CI_HEAD_REPOSITORY','fork/lou_erp'],['CATALOGUE_CI_BASE_REPOSITORY','fork/lou_erp'],['GITHUB_JOB','synthetic-safety'],['GITHUB_ACTIONS','false'],['CATALOGUE_CI_SOURCE_SHA','f'.repeat(40)],['CATALOGUE_CI_CANDIDATE_SHA256','f'.repeat(64)],['GITHUB_RUN_ATTEMPT','0']])('rejects changed %s', (key,value)=>{expect(()=>catalogueCiConnection({...env(),[key]:value},source)).toThrow()})
 it('rejects cross-head and cross-attempt failfast evidence',()=>{
  const e=env(),b={format:'synthetic-failfast-binding-v1',approval:'REVIEWED_FOR_THIS_RUN',identity:identity(e),files:{'schema.sql':'e'.repeat(64)},scope:'generic-synthetic-only'}
  for(const patch of [{GITHUB_RUN_ATTEMPT:'2'},{CATALOGUE_CI_HEAD_REF:'feat/catalogue-mutations-20261014'}])expect(()=>connectionFor({...e,...patch},b)).toThrow()
 })
 it('binds all four workflow conditions to the exact two heads and keeps same-run artifacts',()=>{
  const workflow=readFileSync('.github/workflows/pilot-safety.yml','utf8')
  const condition="(github.event.pull_request.head.ref == 'feat/catalogue-mutations-20261014' || github.event.pull_request.head.ref == 'feat/employee-foundation-20261019')"
  expect(workflow.split(condition)).toHaveLength(5)
  expect(workflow).toContain('catalogue-read-proof-${{ github.run_id }}-${{ github.run_attempt }}')
  expect(workflow).toContain('timeout-minutes: 45')
  const consumer=readFileSync('scripts/catalogue-read-consumer.mjs','utf8')
  expect(consumer).toContain('headRef:env.CATALOGUE_CI_HEAD_REF')
  expect(consumer).toContain('assert.deepEqual(report.identity,expectedIdentity)')
 })
})

it('refuses a 45-minute budget on the wrong job and any unrelated budget drift',()=>{
 const original=readFileSync('.github/workflows/pilot-safety.yml','utf8')
 expect(()=>assertEmployeeJobBudgets(original)).not.toThrow()
 const split=original.indexOf('\n  catalogue-baseline:')
 const swapped=original.slice(0,split).replace('timeout-minutes: 45','timeout-minutes: 20')+original.slice(split).replace('timeout-minutes: 20','timeout-minutes: 45')
 expect(()=>assertEmployeeJobBudgets(swapped)).toThrow()
 for(const mutation of [original.replace('timeout-minutes: 45','timeout-minutes: 60'),original.replace('timeout-minutes: 20','timeout-minutes: 45'),original.replace('    timeout-minutes: 45','    timeout-minutes: 45\n    timeout-minutes: 20')])expect(()=>assertEmployeeJobBudgets(mutation)).toThrow()
})
