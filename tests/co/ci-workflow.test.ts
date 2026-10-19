import {normalizeEmployeeBranchBudget} from '../catalogue-ci/workflow-budget.mjs'
// @vitest-environment node
import { expect, test } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
test('adds CO after all 32 original gates without changing their service, source or caps', () => {
  // Frozen exact bytes from reviewed 75d38e55; no ancestor lookup is available
  // in actions/checkout's single-commit checkout. Both complete regions are pinned.
  const actual = normalizeEmployeeBranchBudget(readFileSync('.github/workflows/pilot-safety.yml', 'utf8'));
  const scheduling = '    needs: catalogue-baseline\n    if: ${{ always() }}\n';
  expect(actual.split(scheduling)).toHaveLength(2);
  expect(actual).toContain(`  synthetic-safety:\n${scheduling}    runs-on: ubuntu-latest`);
  // Validate and remove only the reviewed source-test expansion. The original
  // catalogue job pin below remains unchanged, so no other CI byte can drift.
  const helperSourceLine = '        run: node --test tests/catalogue-ci/reference-helpers.node.mjs tests/catalogue-ci/promotion-owner-extraction.node.mjs tests/catalogue/retired-co-line-resolution.source.mjs tests/catalogue-ci/po-reference-extraction.node.mjs tests/catalogue-ci/visit-reference-extraction.node.mjs tests/catalogue-ci/co-reference-extraction.node.mjs';
  const addedSuites = ' tests/catalogue-ci/nonco-lineage-resolution.node.mjs tests/catalogue-ci/co-draft-reference-extraction.node.mjs';
  expect(actual.split(helperSourceLine + addedSuites + '\n')).toHaveLength(2);
  // Each new terminal-runtime region is independently pinned before removal.
  const targetSourceStart=actual.indexOf('      - name: Check customer target harness and artifact wrapper without a database');
  const targetSourceEnd=actual.indexOf('      - name: Bind clean candidate bytes before capture',targetSourceStart);
  const targetSource=actual.slice(targetSourceStart,targetSourceEnd);
  expect(createHash('sha256').update(targetSource).digest('hex')).toBe('8506100f1339b3734e2cd479b518ccc264fa4d9a90f00e8504fc6e9b562d7782');
  const targetTerminalStart=actual.indexOf('      - name: Verify terminal customer target runtime and disposal');
  const targetTerminal=actual.slice(targetTerminalStart,targetTerminalStart+1387);
  expect(createHash('sha256').update(targetTerminal).digest('hex')).toBe('2de4d693426ab98fafe38fc1aba630c7c7aa3294955e997d857a08a9b86e1b41');
  expect(actual.split(targetSource)).toHaveLength(2);expect(actual.split(targetTerminal)).toHaveLength(2);
  // Pin only the new native browser region, then preserve every historical byte pin.
  const browserStart = actual.indexOf('      - name: Native synthetic catalogue browser QA');
  const browserRegion = actual.slice(browserStart, browserStart + 640);
  expect(createHash('sha256').update(browserRegion).digest('hex')).toBe('52835f2c64d1d3f84e534c2738b4a246013d32ece348007d14c7e814e7a3aaa5');
  expect(actual.split(browserRegion)).toHaveLength(2);
  expect(actual).toContain('      - run: npm run build\n' + browserRegion + '      - name: Install official PostgreSQL client');
  // The received-date feature is additive; retain every historical envelope pin.
  const receivedStart = actual.indexOf('      - name: Guarded SJ received-date migration');
  const receivedRegion = actual.slice(receivedStart, receivedStart + 901);
  expect(createHash('sha256').update(receivedRegion).digest('hex')).toBe('eb6c3d02339aa38c41e742303ebcf3b87ae63557d302b0478d1a566bca3eccc9');
  expect(actual.split(receivedRegion)).toHaveLength(2);
  const normalized = actual.replace(scheduling, '').replace(helperSourceLine + addedSuites + '\n', helperSourceLine + '\n').replace(targetSource,'').replace(targetTerminal,'').replace(browserRegion,'').replace(receivedRegion,'');
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
