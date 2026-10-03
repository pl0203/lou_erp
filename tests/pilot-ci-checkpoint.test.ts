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
const task4Step = workflow.match(/      - name: Guarded iHR calendar and accounts SQL suites\n([\s\S]*?)(?=      - )/)?.[1] ?? ''
const task4Script = task4Step.match(/        run: \|\n([\s\S]*)/)?.[1].replace(/^          /gm, '') ?? ''
const task4Suites = [
  ['calendar', 'IHR_CALENDAR_PERMISSIONS_AND_SETUP_PASSED'],
  ['accounts', 'IHR_ACCOUNTS_PERMISSIONS_AND_RECONCILIATION_PASSED'],
] as const
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

function runTask4MarkerGate(mode = 'complete') {
  // Execute the real bounded workflow shell with test-only runner output.
  // This verifies shell failure/marker handling, not SQL or a GitHub CI identity.
  expect(task4Script, 'workflow must contain the guarded Task4 suite block').not.toBe('')
  const sandbox = mkdtempSync(join(tmpdir(), 'pilot-ci-task4-'))
  const trace = join(sandbox, 'runner-trace')
  writeFileSync(join(sandbox, 'node'), `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_RUNNER_TRACE"
case "$*" in
  'scripts/test-ihr-db.mjs --suite calendar') suite=calendar; marker=IHR_CALENDAR_PERMISSIONS_AND_SETUP_PASSED ;;
  'scripts/test-ihr-db.mjs --suite accounts') suite=accounts; marker=IHR_ACCOUNTS_PERMISSIONS_AND_RECONCILIATION_PASSED ;;
  *) exit 43 ;;
esac
if [[ "$FAKE_RUNNER_MODE" == "missing-$suite" ]]; then exit 0; fi
if [[ "$FAKE_RUNNER_MODE" == "partial-$suite" ]]; then printf '%s\\n' "prefix-$marker"; exit 0; fi
printf '%s\\n' "$marker"
if [[ "$FAKE_RUNNER_MODE" == "failed-$suite" ]]; then exit 42; fi
`, { mode: 0o755 })
  try {
    const result = spawnSync('/bin/bash', ['-c', task4Script], {
      cwd: sandbox, encoding: 'utf8', timeout: 5000,
      env: { PATH: `${sandbox}:/usr/bin:/bin`, TMPDIR: sandbox,
        FAKE_RUNNER_TRACE: trace, FAKE_RUNNER_MODE: mode },
    })
    return { ...result, runnerCalls: (() => { try { return readFileSync(trace, 'utf8') } catch { return '' } })() }
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

test('synthetic SQL checks run only accepted foundation, calendar and accounts suites after migrations', () => {
  const sqlChecks = workflow.match(/      - name: SQL invariants, real role permissions and Storage metadata policies\n([\s\S]*?)(?=      - )/)?.[1] ?? ''
  expect(sqlChecks).toContain('          node scripts/test-ihr-db.mjs --suite foundation\n')
  expect(workflow.match(/node scripts\/test-ihr-db\.mjs --suite \S+/g)).toEqual([
    'node scripts/test-ihr-db.mjs --suite foundation',
    'node scripts/test-ihr-db.mjs --suite calendar',
    'node scripts/test-ihr-db.mjs --suite accounts',
  ])
  expect(workflow.indexOf('      - name: Guarded iHR calendar and accounts SQL suites')).toBeGreaterThan(workflow.indexOf('      - name: SQL invariants, real role permissions and Storage metadata policies'))
  expect(workflow.indexOf('      - name: Guarded iHR calendar and accounts SQL suites')).toBeLessThan(workflow.indexOf('      - name: Concurrent business operations'))
  expect(workflow).not.toMatch(/psql[^\n]*tests\/database\/ihr\//)
  expect(readFileSync('tests/database/ihr/foundation.sql', 'utf8')).not.toBe('')
  expect(readFileSync('tests/database/ihr/helpers.sql', 'utf8')).not.toBe('')
  for (const [suite, marker] of task4Suites) {
    const sql = readFileSync(`tests/database/ihr/${suite}.sql`, 'utf8')
    // Each complete marker follows the command suite include, not just the first rollback.
    expect(sql.trimEnd()).toMatch(new RegExp(`\\\\ir ${suite}-commands\\.sql\\n\\\\echo ${marker}$`))
    expect(task4Step).toContain(`grep -Fxq '${marker}'`)
    expect(task4Step).not.toMatch(new RegExp(`(?:echo|printf)[^\\n]*${marker}`))
  }
})

test('the Task4 shell accepts both exact complete-suite markers in order', () => {
  const result = runTask4MarkerGate()
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(0)
  expect(result.stderr).toBe('')
  expect(result.runnerCalls).toBe('scripts/test-ihr-db.mjs --suite calendar\nscripts/test-ihr-db.mjs --suite accounts\n')
  expect(result.stdout).toBe(`${task4Suites[0][1]}\n${task4Suites[1][1]}\n`)
})

test.each(['missing-calendar', 'partial-calendar', 'failed-calendar', 'missing-accounts', 'partial-accounts', 'failed-accounts'])('the Task4 shell rejects incomplete or failed suite output: %s', mode => {
  const result = runTask4MarkerGate(mode)
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(mode.startsWith('failed-') ? 42 : 1)
  expect(result.runnerCalls).toBe(mode.endsWith('-calendar')
    ? 'scripts/test-ihr-db.mjs --suite calendar\n'
    : 'scripts/test-ihr-db.mjs --suite calendar\nscripts/test-ihr-db.mjs --suite accounts\n')
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
    .replace(/      - name: Guarded iHR calendar and accounts SQL suites\n[\s\S]*?(?=      - )/, '')
  expect(createHash('sha256').update(preserved).digest('hex')).toBe('5e2058b31879c0059d04b9be6ced0aae2a530648208790e897f90d94d1e4fbda')
})
