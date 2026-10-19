import assert from 'node:assert/strict'
// Only synthetic-safety's budget changes. The independent job remains historical.
export function assertEmployeeJobBudgets(workflow) {
 const jobs=workflow.split('\n  catalogue-baseline:')
 assert.equal(jobs.length,2,'Exactly one independent catalogue job required')
 assert.deepEqual(jobs[0].match(/^    timeout-minutes:.*$/gm),['    timeout-minutes: 45'],'Employee budget belongs only to synthetic-safety')
 assert.deepEqual(jobs[1].match(/^    timeout-minutes:.*$/gm),['    timeout-minutes: 20'],'Independent catalogue budget is unchanged')
 assert.equal(workflow.match(/^\s+timeout-minutes:.*$/gm)?.length,2,'No additional or nested budget edits')
}
// Exact inverse of the approved branch/budget delta; all historical hash pins
// still compare every remaining byte and reject unrelated workflow changes.
export function normalizeEmployeeBranchBudget(workflow) {
 workflow=normalizeEmployeeCiAddition(workflow)
 assertEmployeeJobBudgets(workflow)
 const expression="(github.event.pull_request.head.ref == 'feat/catalogue-mutations-20261014' || github.event.pull_request.head.ref == 'feat/employee-foundation-20261019')"
 assert.equal(workflow.split(expression).length,5,'Exactly four reviewed head expressions required')
 assert.equal(workflow.split("feat/employee-foundation-20261019").length,5,'No extra employee head conditions')
 return workflow.replaceAll(expression,"github.event.pull_request.head.ref == 'feat/catalogue-mutations-20261014'").replace('    timeout-minutes: 45','    timeout-minutes: 20')
}

// Exact additional delta: one explicit blocked HR gate AFTER every inherited check.
// Native package/process execution and its upload block have been removed entirely.
export const EMPLOYEE_CI_ADDITION="      - name: HR combined verification blocked pending reviewed containment\n        if: >-\n          always() &&\n          github.event_name == 'pull_request' &&\n          github.repository == 'pl0203/lou_erp' &&\n          github.event.pull_request.head.repo.full_name == 'pl0203/lou_erp' &&\n          github.event.pull_request.base.repo.full_name == 'pl0203/lou_erp' &&\n          github.event.pull_request.head.ref == 'feat/employee-foundation-20261019' &&\n          github.event.pull_request.base.ref == 'fix/pilot-database'\n        run: |\n          echo \"::error::EMPLOYEE_NATIVE_CI_BLOCKED: no reviewed disposable process containment; local synthetic proof does not satisfy this gate.\"\n          exit 1\n\n"
export function normalizeEmployeeCiAddition(workflow){
 const boundary='\n  catalogue-baseline:'
 const jobs=workflow.split(boundary);assert.equal(jobs.length,2)
 for(const job of jobs)assert.deepEqual(job.match(/^    runs-on:.*$/gm),['    runs-on: ubuntu-latest'])
 assert.equal(workflow.match(/^\s+runs-on:.*$/gm)?.length,2)
 assert.equal(workflow.split(EMPLOYEE_CI_ADDITION).length,2,'Exactly one reviewed blocked HR step')
 assert.ok(jobs[0].includes('          node_modules/.bin/vitest run --config vitest.catalogue-read-proof.config.ts --maxWorkers=1\n\n'+EMPLOYEE_CI_ADDITION+'  # Independent of synthetic-safety:'),'Blocked HR gate must follow every inherited decoder check')
 return workflow.replace(EMPLOYEE_CI_ADDITION,'')
}
