// @vitest-environment node
import { expect, test } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
test('adds CO after all 32 original gates without changing their service, source or caps', () => {
  // Frozen exact bytes from reviewed 75d38e55; no ancestor lookup is available
  // in actions/checkout's single-commit checkout. Both complete regions are pinned.
  const workflow = readFileSync('.github/workflows/pilot-safety.yml');
  const original = workflow.subarray(0, 13837);
  expect(createHash('sha256').update(original).digest('hex')).toBe('5c12be0b5d567c3f680bba8bf8d631924533e586c775207db54d988d44fb7d27');
  const added = workflow.subarray(13837).toString('utf8');
  // Whole appended envelope is pinned: no extra jobs, overrides or displaced steps.
  expect(createHash('sha256').update(added).digest('hex')).toBe('8d8ec09325e76a1fb7e3e77dfd49ed8ff04da36ccf03af270d27fcace34cfe46');
  expect(added.match(/^      - name:/gm)).toHaveLength(2);
  expect(added.indexOf('Guarded final CO composition')).toBeLessThan(added.indexOf('Preserve final CO evidence'));
  expect(added).toContain('CO_CI_PROFILE: github-pilot-safety-v1');
  expect(added).toContain('CO_CI_SOURCE_SHA: ${{ github.event.pull_request.head.sha || github.sha }}');
  expect(added).toContain('node scripts/test-co-ci.mjs');
  expect(added).toContain('CO_FINAL_COMPOSED_DATABASE_PASSED');
  expect(added).toContain('CO_REAL_RACES_PASSED');
  expect(added).toContain('CO_EVIDENCE_REAL_RACES_PASSED');
  expect(added).toContain('if: always()');
  expect(added).not.toMatch(/continue-on-error|timeout-minutes|PGHOST:|PGPORT:|PGPASSWORD:/);
});

test('known generated CI receipt directories cannot invalidate the later clean source binding',()=>{
 const ignored=readFileSync('.gitignore','utf8').split('\n')
 for(const path of ['/scale-results/','/rollout-results/','/import-results/'])expect(ignored).toContain(path)
})
