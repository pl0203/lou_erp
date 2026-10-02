// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const workflow = readFileSync('.github/workflows/pilot-safety.yml', 'utf8')
const immutableRef = '${{ github.event.pull_request.head.sha || github.sha }}'
const proofStep = workflow.match(/      - name: Verify immutable source checkpoint\n([\s\S]*?)(?=      - )/)?.[1] ?? ''
const proofScript = proofStep.match(/        run: \|\n([\s\S]*)/)?.[1].replace(/^          /gm, '') ?? ''
const commit = 'a'.repeat(40)
const tree = 'b'.repeat(40)

function runProof(expected: string, actual = commit, failedGitCommand = '') {
  // Only the bounded workflow shell block runs here. Git is a temporary fake;
  // no repository, database or GitHub database-identity variables are used.
  expect(proofScript, 'workflow must contain the immutable source verification block').not.toBe('')
  const sandbox = mkdtempSync(join(tmpdir(), 'pilot-ci-checkpoint-'))
  const trace = join(sandbox, 'git-trace')
  writeFileSync(join(sandbox, 'git'), `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_GIT_TRACE"
if [[ "$*" == "$FAKE_FAILED_GIT_COMMAND" ]]; then exit 42; fi
case "$*" in
  'rev-parse HEAD') printf '%s\\n' "$FAKE_COMMIT_SHA" ;;
  'rev-parse HEAD^{tree}') printf '%s\\n' "$FAKE_TREE_SHA" ;;
  *) exit 43 ;;
esac
`, { mode: 0o755 })
  try {
    const result = spawnSync('/bin/bash', ['-c', proofScript], {
      cwd: sandbox,
      encoding: 'utf8',
      timeout: 5000,
      env: {
        PATH: `${sandbox}:/usr/bin:/bin`,
        EXPECTED_SOURCE_SHA: expected,
        FAKE_COMMIT_SHA: actual,
        FAKE_TREE_SHA: tree,
        FAKE_FAILED_GIT_COMMAND: failedGitCommand,
        FAKE_GIT_TRACE: trace,
      },
    })
    return { ...result, gitCalls: (() => { try { return readFileSync(trace, 'utf8') } catch { return '' } })() }
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
}

test('checkout and the proof expectation pin PR head with a manual github.sha fallback', () => {
  expect(workflow).toContain(`      - uses: actions/checkout@v4\n        with:\n          ref: ${immutableRef}\n`)
  expect(proofStep).toContain(`          EXPECTED_SOURCE_SHA: ${immutableRef}\n`)
  expect(workflow.indexOf('      - name: Verify immutable source checkpoint')).toBeGreaterThan(workflow.indexOf('      - uses: actions/checkout@v4'))
  expect(workflow.indexOf('      - name: Verify immutable source checkpoint')).toBeLessThan(workflow.indexOf('      - run: npm test'))
})

test.each(['', 'a'.repeat(39), 'a'.repeat(41), 'A'.repeat(40), 'g'.repeat(40), `${commit}\n`, `$(printf ${commit})`])('rejects an invalid expected SHA before reading Git: %j', expected => {
  const result = runProof(expected)
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('Expected source SHA must be 40 lowercase hexadecimal characters')
  expect(result.gitCalls).toBe('')
  expect(result.stdout).not.toContain('PILOT_CI_')
})

test('fails closed on a checked-out HEAD mismatch before reading the tree', () => {
  const result = runProof(commit, 'c'.repeat(40))
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('Checked-out HEAD does not match the expected source SHA')
  expect(result.gitCalls).toBe('rev-parse HEAD\n')
  expect(result.stdout).not.toContain('PILOT_CI_')
})

test.each(['rev-parse HEAD', 'rev-parse HEAD^{tree}'])('fails closed if Git cannot provide %s', command => {
  const result = runProof(commit, commit, command)
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(42)
  expect(result.stdout).not.toContain('PILOT_CI_')
})

test('prints the immutable commit and tree proof only after an exact source match', () => {
  const result = runProof(commit)
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(0)
  expect(result.stderr).toBe('')
  expect(result.gitCalls).toBe('rev-parse HEAD\nrev-parse HEAD^{tree}\n')
  expect(result.stdout).toBe(`PILOT_CI_COMMIT_SHA=${commit}\nPILOT_CI_TREE_SHA=${tree}\n`)
})

test('the full application suite uses one worker before the preserved SQL checks', () => {
  expect(workflow).toContain('      - run: npm test -- --maxWorkers=1\n')
  expect(workflow).not.toMatch(/      - run: npm test\s*\n/)
  expect(workflow.indexOf('      - run: npm test -- --maxWorkers=1')).toBeLessThan(workflow.indexOf('      - name: Load only synthetic test contract and candidate migrations'))
})

test('synthetic SQL checks add only the marker-guarded, available iHR foundation suite', () => {
  const sqlChecks = workflow.match(/      - name: SQL invariants, real role permissions and Storage metadata policies\n([\s\S]*?)(?=      - )/)?.[1] ?? ''
  expect(sqlChecks).toContain('          node scripts/test-ihr-db.mjs --suite foundation\n')
  expect(workflow.match(/node scripts\/test-ihr-db\.mjs[^\n]*/g)).toEqual(['node scripts/test-ihr-db.mjs --suite foundation'])
  expect(workflow).not.toMatch(/psql[^\n]*tests\/database\/ihr\//)
  expect(readFileSync('tests/database/ihr/foundation.sql', 'utf8')).not.toBe('')
  expect(readFileSync('tests/database/ihr/helpers.sql', 'utf8')).not.toBe('')
})

test('the envelope preserves every existing synthetic workflow byte outside its reviewed additions', () => {
  // Baseline: reviewed HR product commit 00ee204c38be40208ab8f59d8506680e64448ccd.
  // Removing only the allowed envelope restores services, permissions, guards,
  // SQL/read/import/rollback checks and artifact retention exactly.
  const preserved = workflow
    .replace(`      - uses: actions/checkout@v4\n        with:\n          ref: ${immutableRef}\n`, '      - uses: actions/checkout@v4\n')
    .replace(/      - name: Verify immutable source checkpoint\n[\s\S]*?(?=      - )/, '')
    .replace('      - run: npm test -- --maxWorkers=1\n', '      - run: npm test\n')
    .replace('          node scripts/test-ihr-db.mjs --suite foundation\n', '')
  expect(createHash('sha256').update(preserved).digest('hex')).toBe('5e2058b31879c0059d04b9be6ced0aae2a530648208790e897f90d94d1e4fbda')
})
