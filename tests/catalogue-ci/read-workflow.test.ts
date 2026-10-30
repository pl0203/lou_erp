import {normalizeReleaseWorkflow} from './release-workflow-contract.mjs';
// @vitest-environment node
import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { cataloguePublicSourcePaths } from '../../scripts/catalogue-capture-source.mjs'
import { readProofBoundPaths } from '../../scripts/catalogue-read-proof.mjs'
const workflow = normalizeReleaseWorkflow(readFileSync('.github/workflows/pilot-safety.yml', 'utf8'))
const [synthetic, baseline] = workflow.split('  catalogue-baseline:')
test('independent producer orders consumer without suppressing original safety job', () => {
 expect(synthetic).toContain('    needs: catalogue-baseline\n    if: ${{ always() }}')
 expect(baseline).not.toMatch(/^    needs:/m)
 expect(baseline.indexOf('node scripts/catalogue-read-proof.mjs')).toBeGreaterThan(baseline.indexOf('node scripts/catalogue-reference-helpers.mjs'))
 expect(workflow).not.toContain('continue-on-error')
 expect(synthetic.match(/run: npm ci/g)).toHaveLength(1)
 expect(baseline).not.toContain('npm ci')
})
test('same-run same-attempt exact artifact transport and non-skippable real decoder', () => {
 expect(workflow.match(/name: catalogue-read-proof-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/g)).toHaveLength(2)
 expect(synthetic).toContain('uses: actions/download-artifact@v4')
 expect(synthetic).not.toMatch(/run-id:|github-token:|repository:|merge-multiple:|pattern:/)
 expect(synthetic).toContain('CATALOGUE_READ_BASELINE_RESULT: ${{ needs.catalogue-baseline.result }}')
 expect(synthetic).toContain('test "$CATALOGUE_READ_BASELINE_RESULT" = success')
 expect(synthetic).toContain('node_modules/.bin/vitest run --config vitest.catalogue-read-proof.config.ts --maxWorkers=1')
 expect(baseline).toContain("steps.catalogue-read-proof.outputs.bundle_ready == 'true'")
 expect(baseline).toContain('path: scale-results/catalogue-read-proof')
 expect(baseline).toContain('if-no-files-found: error')
})
test('binding comes independently from clean exact-head checkout, never artifact', () => {
 expect(synthetic).toContain('assert.equal(source.clean, true)')
 expect(synthetic).toContain('assert.equal(source.commit, process.env.CATALOGUE_CI_SOURCE_SHA)')
 expect(synthetic).toContain('CATALOGUE_CI_SOURCE_TREE=${source.tree}')
 expect(synthetic).toContain('CATALOGUE_CI_CANDIDATE_SHA256=${source.candidate}')
 expect(synthetic).toContain('CATALOGUE_CI_SOURCE_SHA: ${{ github.event.pull_request.head.sha }}')
 expect(readProofBoundPaths.every(path => cataloguePublicSourcePaths.includes(path))).toBe(true)
})
test('decoder stages retain exact restricted PR scope without success-based skip', () => {
 const added=synthetic.split('      - name: Bind independent read decoder source')[1]
 expect(added).toBeTruthy()
 for (const step of added.split('      - name: ')) {
  expect(step).toContain("github.event_name == 'pull_request'")
  expect(step).toContain("github.repository == 'pl0203/lou_erp'")
  expect(step).toContain("github.event.pull_request.head.repo.full_name == 'pl0203/lou_erp'")
  expect(step).toContain("github.event.pull_request.base.repo.full_name == 'pl0203/lou_erp'")
  expect(step).toContain("github.event.pull_request.head.ref == 'feat/catalogue-mutations-20261014'")
  expect(step).toContain("github.event.pull_request.base.ref == 'fix/pilot-database'")
  expect(step).not.toMatch(/if:.*needs\.catalogue-baseline\.result/)
 }
})
