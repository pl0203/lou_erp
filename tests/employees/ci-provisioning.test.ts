// @vitest-environment node
// Retained source/checkpoint/identity assertions. Native provisioning is removed.
import {expect,it} from 'vitest'
import * as guard from '../employee-ci/identity.mjs'
it('refuses proof labels for another repository, head, run, attempt, job or source',()=>{
 expect(guard).toBeDefined()
 const e={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'pl0203/lou_erp',GITHUB_WORKFLOW:'Pilot safety checks',GITHUB_JOB:'synthetic-safety',GITHUB_EVENT_NAME:'pull_request',GITHUB_RUN_ID:'19',GITHUB_RUN_ATTEMPT:'1',GITHUB_REF:'refs/pull/10/merge',GITHUB_WORKFLOW_REF:'pl0203/lou_erp/.github/workflows/pilot-safety.yml@refs/pull/10/merge',EMPLOYEE_CI_HEAD_REPOSITORY:'pl0203/lou_erp',EMPLOYEE_CI_BASE_REPOSITORY:'pl0203/lou_erp',EMPLOYEE_CI_HEAD_REF:'feat/employee-foundation-20261019',EMPLOYEE_CI_BASE_REF:'fix/pilot-database',EMPLOYEE_CI_SOURCE_SHA:'a'.repeat(40)}
 expect(guard.employeeCiIdentity(e,'a'.repeat(40))).toMatchObject({run:'19',attempt:'1',job:'synthetic-safety'})
 for(const [key,value]of Object.entries({GITHUB_REPOSITORY:'fork/repo',GITHUB_JOB:'catalogue-baseline',GITHUB_RUN_ID:'0',GITHUB_RUN_ATTEMPT:'0',EMPLOYEE_CI_HEAD_REF:'main',EMPLOYEE_CI_BASE_REF:'main',EMPLOYEE_CI_SOURCE_SHA:'b'.repeat(40),GITHUB_WORKFLOW_REF:'pl0203/lou_erp/.github/workflows/other.yml@refs/pull/10/merge'}))expect(()=>guard.employeeCiIdentity({...e,[key]:value},'a'.repeat(40))).toThrow()
})
it('keeps exact fixed source and checkpoint lists with no caller SQL/path/target surface',async()=>{
 const {readFileSync,existsSync}=await import('node:fs')
 const files=JSON.parse(readFileSync('tests/employee-ci/source-files.json','utf8'))
 for(const file of ['tests/employee-ci/identity.mjs','tests/employee-ci/source.mjs','tests/employee-ci/source-files.json','tests/employee-ci/checkpoints.json','sql/employee-foundation/effective-access.sql','tests/database/employees/effective-role-proof.sql','tests/database/employees/set-role-proof.sql','tests/database/employees/owner-role-proof.sql','tests/database/employees/sql-decoder.mjs','.github/workflows/pilot-safety.yml'])expect(files).toContain(file)
 expect(new Set(files).size).toBe(files.length);expect(files.some((x:string)=>x.includes('.env')||x.includes('.superpowers')||x.includes('/.temp/'))).toBe(false)
 const stages=JSON.parse(readFileSync('tests/employee-ci/checkpoints.json','utf8'));expect(stages.filter((s:any)=>s.suite==='composed')).toHaveLength(2)
 expect(stages.findIndex((s:any)=>s.suite==='composed')).toBeLessThan(stages.findIndex((s:any)=>s.file==='sql/director-calendar-settings-candidate.sql'))
 for(const file of files)expect(existsSync(file),file).toBe(true)
 for(const removed of ['scripts/employee-ci.mjs','scripts/employee-pg17-install.mjs','tests/employee-ci/install-policy.mjs','tests/employee-ci/owned-cluster.mjs','tests/employee-ci/processes.mjs','tests/employees/ci-processes.test.ts'])expect(files).not.toContain(removed)
})
