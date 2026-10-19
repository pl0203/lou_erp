// @vitest-environment node
import {readFileSync,existsSync} from 'node:fs'
import {expect,it} from 'vitest'
import * as gates from '../catalogue-ci/workflow-budget.mjs'
it('keeps HR explicitly blocked after inherited proof without an executable installer',()=>{
 const text=readFileSync('.github/workflows/pilot-safety.yml','utf8')
 expect(text).toContain('EMPLOYEE_NATIVE_CI_BLOCKED');expect(text).not.toContain('node scripts/employee-ci.mjs');expect(text).not.toContain('employee-combined.outputs');expect(text).not.toContain('runs-on: ubuntu-24.04')
 expect((gates as any).normalizeEmployeeCiAddition).toBeTypeOf('function')
 const normalized=(gates as any).normalizeEmployeeCiAddition(text)
 expect(normalized).not.toContain('EMPLOYEE_NATIVE_CI_BLOCKED')
 expect(normalized).toContain('  synthetic-safety:\n    needs: catalogue-baseline\n    if: ${{ always() }}\n    runs-on: ubuntu-latest')
})
it('rejects changed, duplicate, misplaced, missing and unrelated HR workflow changes',()=>{
 const text=readFileSync('.github/workflows/pilot-safety.yml','utf8'),g:any=gates
 expect(g.normalizeEmployeeCiAddition).toBeTypeOf('function')
 const block=g.EMPLOYEE_CI_ADDITION
 for(const changed of [text.replace(block,''),text.replace(block,block+block),text.replace(block,block.replace('exit 1','exit 0')),text.replace('    runs-on: ubuntu-latest','    runs-on: ubuntu-24.04'),text.replace(block,'').replace('\n  catalogue-baseline:', '\n  catalogue-baseline:\n'+block)])expect(()=>g.normalizeEmployeeCiAddition(changed)).toThrow()
 // The exact inverse preserves every unrelated byte; historical SHA checks then reject it.
 const unrelated=text.replace('node-version: 22','node-version: 24')
 expect(g.normalizeEmployeeBranchBudget(unrelated)).not.toBe(g.normalizeEmployeeBranchBudget(text))
})

it('removes the unverified native execution surface rather than hiding it behind a flag',()=>{
 for(const file of ['scripts/employee-ci.mjs','scripts/employee-pg17-install.mjs','tests/employee-ci/install-policy.mjs','tests/employee-ci/owned-cluster.mjs','tests/employee-ci/processes.mjs','tests/employees/ci-processes.test.ts'])expect(existsSync(file),file).toBe(false)
 const text=readFileSync('.github/workflows/pilot-safety.yml','utf8'),block=(gates as any).EMPLOYEE_CI_ADDITION
 expect(block).toContain('exit 1');expect(block).not.toContain('continue-on-error');expect(block).not.toContain('env:');expect(block).toContain("github.event.pull_request.head.ref == 'feat/employee-foundation-20261019'")
 for(const key of ["github.repository == 'pl0203/lou_erp'","github.event.pull_request.head.repo.full_name == 'pl0203/lou_erp'","github.event.pull_request.base.repo.full_name == 'pl0203/lou_erp'","github.event.pull_request.base.ref == 'fix/pilot-database'"])expect(block).toContain(key)
 expect(text.indexOf(block)).toBeGreaterThan(text.indexOf('node_modules/.bin/vitest run --config vitest.catalogue-read-proof.config.ts --maxWorkers=1'))
 expect(text.slice(text.indexOf(block)+block.length,text.indexOf('\n  catalogue-baseline:'))).not.toContain('      - ')
})
