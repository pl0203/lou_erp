// @vitest-environment node
import { expect, test } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
test('adds CO after all 32 original gates without changing their service, source or caps', () => {
  // Frozen exact bytes from reviewed 75d38e55; no ancestor lookup is available
  // in actions/checkout's single-commit checkout. Both complete regions are pinned.
  const actual = readFileSync('.github/workflows/pilot-safety.yml', 'utf8');
  const scheduling = '    needs: catalogue-baseline\n    if: ${{ always() }}\n';
  expect(actual.split(scheduling)).toHaveLength(2);
  expect(actual).toContain(`  synthetic-safety:\n${scheduling}    runs-on: ubuntu-latest`);
  const normalized = actual.replace(scheduling, '');
  const decoderStart = normalized.indexOf('      - name: Bind independent read decoder source');
  const catalogueStart = normalized.indexOf('  # Independent of synthetic-safety:');
  const decoder = normalized.slice(decoderStart, catalogueStart);
  expect(createHash('sha256').update(decoder).digest('hex')).toBe('8921961b19dff1f49d74cf285076cab79c8a3d3467a8e7bd8b1b7453f8980e73');
  const workflow = Buffer.from(normalized.slice(0, decoderStart) + normalized.slice(catalogueStart));
  const original = workflow.subarray(0, 13837);
  expect(createHash('sha256').update(original).digest('hex')).toBe('5c12be0b5d567c3f680bba8bf8d631924533e586c775207db54d988d44fb7d27');
  const added = workflow.subarray(13837, 14698).toString('utf8');
  // The complete historical CO envelope remains byte-identical; catalogue is a separately pinned job.
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
  const catalogue = workflow.subarray(14698).toString('utf8');
  expect(createHash('sha256').update(catalogue).digest('hex')).toBe('c04a396d87932a0c43ae3ff903d3cb25313c444fbadb9b2480c3d7ee3bd80099');
  expect(catalogue.match(/^  [a-zA-Z0-9-]+:/gm)).toEqual(['  catalogue-baseline:']);
  expect(catalogue).not.toMatch(/continue-on-error|^    needs:/m);
});

test('known generated CI receipt directories cannot invalidate the later clean source binding',()=>{
 const ignored=readFileSync('.gitignore','utf8').split('\n')
 for(const path of ['/scale-results/','/rollout-results/','/import-results/'])expect(ignored).toContain(path)
})
