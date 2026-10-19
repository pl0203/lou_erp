import assert from 'node:assert/strict'
export function employeeCiIdentity(env,commit){
 for(const [key,value]of Object.entries({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'pl0203/lou_erp',GITHUB_WORKFLOW:'Pilot safety checks',GITHUB_JOB:'synthetic-safety',GITHUB_EVENT_NAME:'pull_request',EMPLOYEE_CI_HEAD_REPOSITORY:'pl0203/lou_erp',EMPLOYEE_CI_BASE_REPOSITORY:'pl0203/lou_erp',EMPLOYEE_CI_HEAD_REF:'feat/employee-foundation-20261019',EMPLOYEE_CI_BASE_REF:'fix/pilot-database'}))assert.equal(env[key],value,`Unreviewed employee CI ${key}`)
 assert.match(env.GITHUB_REF??'',/^refs\/pull\/[1-9][0-9]*\/merge$/)
 assert.equal(env.GITHUB_WORKFLOW_REF,`pl0203/lou_erp/.github/workflows/pilot-safety.yml@${env.GITHUB_REF}`)
 for(const key of ['GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT'])assert.match(env[key]??'',/^[1-9][0-9]*$/)
 assert.match(commit??'',/^[a-f0-9]{40}$/);assert.equal(env.EMPLOYEE_CI_SOURCE_SHA,commit)
 return {repository:env.GITHUB_REPOSITORY,workflow:env.GITHUB_WORKFLOW,workflowRef:env.GITHUB_WORKFLOW_REF,job:env.GITHUB_JOB,run:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT,headRepository:env.EMPLOYEE_CI_HEAD_REPOSITORY,headRef:env.EMPLOYEE_CI_HEAD_REF,baseRepository:env.EMPLOYEE_CI_BASE_REPOSITORY,baseRef:env.EMPLOYEE_CI_BASE_REF,commit}
}
