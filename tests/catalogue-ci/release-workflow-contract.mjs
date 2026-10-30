// Exact finite release-CI adaptation only; preserve every historical workflow gate.
import assert from 'node:assert/strict';
export const releaseBranch='release/padiwan-staging-fixes-20261030';
export const releaseDispatchExpression="github.event_name == 'workflow_dispatch' && github.repository == 'pl0203/lou_erp' && github.ref == 'refs/heads/release/padiwan-staging-fixes-20261030' && inputs.expected_source_sha != '' && inputs.expected_source_sha == github.sha";
const transitions=[
  // Outer sequential synthetic job budget only; all child/SQL/lock bounds remain frozen.
  {before:'    timeout-minutes: 20\n',after:'    timeout-minutes: 30\n',count:1},
  {
    "before": "  workflow_dispatch:\npermissions:",
    "after": "  push:\n    branches:\n      - release/padiwan-staging-fixes-20261030\n  workflow_dispatch:\n    inputs:\n      expected_source_sha:\n        description: Exact reviewed release commit SHA\n        required: true\n        type: string\nenv:\n  npm_config_audit: 'false'\n  PILOT_RELEASE_SOURCE_SHA: ${{ github.event_name == 'push' && github.sha || inputs.expected_source_sha }}\npermissions:",
    "count": 1
  },
  {
    "before": "    if: ${{ always() }}\n",
    "after": "    if: ${{ always() && (github.event_name == 'pull_request' || (github.event_name == 'workflow_dispatch' && github.repository == 'pl0203/lou_erp' && github.ref == 'refs/heads/release/padiwan-staging-fixes-20261030' && inputs.expected_source_sha != '' && inputs.expected_source_sha == github.sha) || (github.event_name == 'push' && github.repository == 'pl0203/lou_erp' && github.ref == 'refs/heads/release/padiwan-staging-fixes-20261030')) }}\n",
    "count": 1
  },
  {
    "before": "          github.event_name == 'pull_request' &&\n          github.repository == 'pl0203/lou_erp' &&\n          github.event.pull_request.head.repo.full_name == 'pl0203/lou_erp' &&\n          github.event.pull_request.base.repo.full_name == 'pl0203/lou_erp' &&\n          github.event.pull_request.head.ref == 'feat/catalogue-mutations-20261014' &&\n          github.event.pull_request.base.ref == 'fix/pilot-database'",
    "after": "          (github.event_name == 'pull_request' &&\n          github.repository == 'pl0203/lou_erp' &&\n          github.event.pull_request.head.repo.full_name == 'pl0203/lou_erp' &&\n          github.event.pull_request.base.repo.full_name == 'pl0203/lou_erp' &&\n          github.event.pull_request.head.ref == 'feat/catalogue-mutations-20261014' &&\n          github.event.pull_request.base.ref == 'fix/pilot-database') ||\n          (github.event_name == 'workflow_dispatch' && github.repository == 'pl0203/lou_erp' && github.ref == 'refs/heads/release/padiwan-staging-fixes-20261030' && inputs.expected_source_sha != '' && inputs.expected_source_sha == github.sha) ||\n          (github.event_name == 'push' && github.repository == 'pl0203/lou_erp' && github.ref == 'refs/heads/release/padiwan-staging-fixes-20261030')",
    "count": 3
  },
  {
    "before": "      github.event_name == 'pull_request' &&\n      github.repository == 'pl0203/lou_erp' &&\n      github.event.pull_request.head.repo.full_name == 'pl0203/lou_erp' &&\n      github.event.pull_request.base.repo.full_name == 'pl0203/lou_erp' &&\n      github.event.pull_request.head.ref == 'feat/catalogue-mutations-20261014' &&\n      github.event.pull_request.base.ref == 'fix/pilot-database'",
    "after": "      (github.event_name == 'pull_request' &&\n      github.repository == 'pl0203/lou_erp' &&\n      github.event.pull_request.head.repo.full_name == 'pl0203/lou_erp' &&\n      github.event.pull_request.base.repo.full_name == 'pl0203/lou_erp' &&\n      github.event.pull_request.head.ref == 'feat/catalogue-mutations-20261014' &&\n      github.event.pull_request.base.ref == 'fix/pilot-database') ||\n      (github.event_name == 'workflow_dispatch' && github.repository == 'pl0203/lou_erp' && github.ref == 'refs/heads/release/padiwan-staging-fixes-20261030' && inputs.expected_source_sha != '' && inputs.expected_source_sha == github.sha) ||\n      (github.event_name == 'push' && github.repository == 'pl0203/lou_erp' && github.ref == 'refs/heads/release/padiwan-staging-fixes-20261030')",
    "count": 1
  },
  {
    "before": "CATALOGUE_CI_SOURCE_SHA: ${{ github.event.pull_request.head.sha }}",
    "after": "CATALOGUE_CI_SOURCE_SHA: ${{ github.event.pull_request.head.sha || github.sha }}",
    "count": 3
  },
  {
    "before": "          ref: ${{ github.event.pull_request.head.sha }}\n          persist-credentials: false",
    "after": "          ref: ${{ github.event.pull_request.head.sha || github.sha }}\n          persist-credentials: false",
    "count": 1
  },
  {
    "before": " tests/catalogue-ci/co-draft-reference-extraction.node.mjs\n",
    "after": " tests/catalogue-ci/co-draft-reference-extraction.node.mjs tests/catalogue-ci/release-identity.node.mjs\n",
    "count": 1
  }
];
export function normalizeReleaseWorkflow(text){
 const jobs=text.split('\n  catalogue-baseline:');
 assert.equal(jobs.length,2,'Exact two-job boundary required');
 assert.equal(jobs[0].split('    timeout-minutes: 30\n').length,2,'Synthetic budget must remain exactly 30 minutes');
 assert.equal(jobs[1].includes('    timeout-minutes: 30\n'),false,'Catalogue budget must not widen');
 for(const {before,after,count} of [...transitions].reverse()){
  assert.equal(text.split(after).length-1,count,'Missing/extra/changed release CI clause');
  text=text.split(after).join(before);
 }
 return text;
}
export const historicalWorkflowHash='2e2cd0b00f4cda01dd4debcec7455f36e69a37dfc76fca2868cb82246d37b28c';
