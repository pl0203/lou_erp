// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { expect, test } from 'vitest'

const workflow = readFileSync('.github/workflows/pilot-safety.yml', 'utf8')
const immutableRef = '${{ github.event.pull_request.head.sha || github.sha }}'
const proofStep = workflow.match(/      - name: Verify immutable source checkpoint\n([\s\S]*?)(?=      - )/)?.[1] ?? ''
const proofScript = proofStep.match(/        run: \|\n([\s\S]*)/)?.[1].replace(/^          /gm, '') ?? ''
const task4Step = workflow.match(/      - name: Guarded iHR calendar and accounts SQL suites\n([\s\S]*?)(?=      - )/)?.[1] ?? ''
const task4Script = task4Step.match(/        run: \|\n([\s\S]*)/)?.[1].replace(/^          /gm, '') ?? ''
const quoteStep = workflow.match(/      - name: Guarded iHR quote SQL suite\n([\s\S]*?)(?=      - )/)?.[1] ?? ''
const quoteScript = quoteStep.match(/        run: \|\n([\s\S]*)/)?.[1].replace(/^          /gm, '') ?? ''
const quoteMarker = 'IHR_QUOTE_PERMISSIONS_AND_CALCULATION_PASSED'
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
  writeFileSync(join(sandbox, 'psql'), '#!/bin/bash\nexit 0\n', { mode: 0o755 })
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

function runQuoteMarkerGate(mode = 'complete') {
  // Run the exact workflow shell against test-only output; no SQL is executed.
  expect(quoteScript, 'workflow must contain the guarded quote suite block').not.toBe('')
  const sandbox = mkdtempSync(join(tmpdir(), 'pilot-ci-quote-'))
  const trace = join(sandbox, 'runner-trace')
  writeFileSync(join(sandbox, 'psql'), '#!/bin/bash\nexit 0\n', { mode: 0o755 })
  writeFileSync(join(sandbox, 'node'), `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_RUNNER_TRACE"
[[ "$*" == 'scripts/test-ihr-db.mjs --suite quote' ]] || exit 43
marker=${quoteMarker}
case "$FAKE_RUNNER_MODE" in
  missing) exit 0 ;;
  partial) printf '%s\\n' "prefix-$marker"; exit 0 ;;
  suffixed) printf '%s\\n' "$marker-suffix"; exit 0 ;;
  failed-before) exit 42 ;;
esac
printf '%s\\n' "$marker"
if [[ "$FAKE_RUNNER_MODE" == failed-after ]]; then exit 42; fi
`, { mode: 0o755 })
  try {
    const result = spawnSync('/bin/bash', ['-c', quoteScript], {
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

test('synthetic SQL checks preserve staged native suites before one final composed entry', () => {
  expect(workflow.match(/node scripts\/test-ihr-db\.mjs --suite \S+/g)).toEqual([
    'node scripts/test-ihr-db.mjs --suite foundation',
    'node scripts/test-ihr-db.mjs --suite calendar',
    'node scripts/test-ihr-db.mjs --suite accounts',
    'node scripts/test-ihr-db.mjs --suite quote',
    'node scripts/test-ihr-db.mjs --suite requests',
    'node scripts/test-ihr-db.mjs --suite composed',
  ])
  const staged = workflow.indexOf('      - name: Guarded iHR foundation SQL suite')
  const final = workflow.indexOf('      - name: Guarded final composed iHR SQL suite')
  expect(staged).toBeGreaterThan(workflow.indexOf('      - name: Load only synthetic test contract and candidate migrations'))
  expect(workflow.indexOf('      - name: Guarded iHR calendar and accounts SQL suites')).toBeGreaterThan(staged)
  expect(final).toBeGreaterThan(workflow.indexOf('      - name: Load final iHR reads and administration migrations'))
  expect(final).toBeLessThan(workflow.indexOf('      - name: Concurrent business operations'))
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

test('the quote workflow requires the native marker after the complete boundary include', () => {
  const sql = readFileSync('tests/database/ihr/quote.sql', 'utf8')
  expect(sql.trimEnd()).toMatch(/\\ir quote-boundaries\.sql\n\\echo IHR_QUOTE_PERMISSIONS_AND_CALCULATION_PASSED$/)
  expect(sql.match(/\\echo IHR_QUOTE_PERMISSIONS_AND_CALCULATION_PASSED/g)).toHaveLength(1)
  expect(readFileSync('tests/database/ihr/quote-boundaries.sql', 'utf8')).not.toBe('')
  expect(quoteStep).toContain(`grep -Fxq '${quoteMarker}'`)
  expect(quoteStep).not.toMatch(new RegExp(`(?:echo|printf)[^\\n]*${quoteMarker}`))
  expect(workflow.indexOf('      - name: Guarded iHR quote SQL suite')).toBeGreaterThan(workflow.indexOf('      - name: Guarded iHR calendar and accounts SQL suites'))
  expect(workflow.indexOf('      - name: Guarded iHR quote SQL suite')).toBeLessThan(workflow.indexOf('      - name: Concurrent business operations'))
})

test('the quote shell accepts the exact complete-suite marker', () => {
  const result = runQuoteMarkerGate()
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(0)
  expect(result.stderr).toBe('')
  expect(result.runnerCalls).toBe('scripts/test-ihr-db.mjs --suite quote\n')
  expect(result.stdout).toBe(`${quoteMarker}\n`)
})

test.each(['missing', 'partial', 'suffixed', 'failed-before', 'failed-after'])('the quote shell rejects incomplete or failed suite output: %s', mode => {
  const result = runQuoteMarkerGate(mode)
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(mode.startsWith('failed-') ? 42 : 1)
  expect(result.runnerCalls).toBe('scripts/test-ihr-db.mjs --suite quote\n')
})

test('the composition preserves every category-staging workflow byte outside the explicit HR envelope', () => {
  // Reviewed category staging: d1593520a4afde7e66b590d814062eba92bee03f.
  const preserved = workflow
    .replace('            if [[ "$file" > supabase/migrations/202610021001_ihr_leave_foundation.sql || "$file" == supabase/migrations/202610021001_ihr_leave_foundation.sql ]]; then continue; fi\n', '')
    .replace(/      - name: Guarded iHR foundation SQL suite\n[\s\S]*?(?=      - )/, '')
    .replace(/      - name: Guarded iHR calendar and accounts SQL suites\n[\s\S]*?(?=      - )/, '')
    .replace(/      - name: Guarded iHR quote SQL suite\n[\s\S]*?(?=      - )/, '')
    .replace(/      - name: Guarded iHR requests SQL suite\n[\s\S]*?(?=      - )/, '')
    .replace(/      - name: Load final iHR reads and administration migrations\n[\s\S]*?(?=      - )/, '')
    .replace(/      - name: Guarded final composed iHR SQL suite\n[\s\S]*?(?=      - )/, '')
  expect(createHash('sha256').update(preserved).digest('hex')).toBe('674f7c74302c3f735008f272b61751427df20f97a9fd0638b380c42945912563')
})

const finalMarkers = [
  'IHR_QUOTE_PERMISSIONS_AND_CALCULATION_PASSED',
  'IHR_REQUESTS_ATOMIC_SUBMISSION_PASSED',
  'IHR_REQUEST_DECISIONS_CANCELLATIONS_PASSED',
  'IHR_LEAVE_READS_PRIVACY_AND_COUNTS_PASSED',
  'IHR_ADMIN_SCOPED_SETTINGS_PASSED',
  'IHR_FINAL_SCHEMA_PREPARATION_APPROVALS_PASSED',
  'IHR_COMPOSED_BACKEND_PLAIN_PASSED',
  'IHR_FINAL_CONTEXT_CONTRACT_PASSED',
] as const
const finalStep = workflow.match(/      - name: Guarded final composed iHR SQL suite\n([\s\S]*?)(?=      - )/)?.[1] ?? ''
const finalScript = finalStep.match(/        run: \|\n([\s\S]*)/)?.[1].replace(/^          /gm, '') ?? ''
function runFinalMarkerGate(mode = 'complete') {
  expect(finalScript).not.toBe('')
  const sandbox = mkdtempSync(join(tmpdir(), 'pilot-ci-final-'))
  writeFileSync(join(sandbox, 'node'), `#!/bin/bash
set -euo pipefail
[[ "$*" == 'scripts/test-ihr-db.mjs --suite composed' ]] || exit 43
if [[ "$FAKE_RUNNER_MODE" == failed-before ]]; then exit 42; fi
for marker in ${finalMarkers.join(' ')}; do
  if [[ "$FAKE_RUNNER_MODE" == "missing-$marker" ]]; then continue; fi
  if [[ "$FAKE_RUNNER_MODE" == "partial-$marker" ]]; then printf '%s\\n' "prefix-$marker"; continue; fi
  printf '%s\\n' "$marker"
  if [[ "$FAKE_RUNNER_MODE" == "duplicate-$marker" ]]; then printf '%s\\n' "$marker"; fi
done
if [[ "$FAKE_RUNNER_MODE" == failed-after ]]; then exit 42; fi
`, { mode: 0o755 })
  writeFileSync(join(sandbox, 'npm'), `#!/bin/bash
set -euo pipefail
[[ \"$*\" == 'test -- tests/ihr/context-sql-output.test.ts --maxWorkers=1' ]] || exit 43
[[ \"$IHR_CONTEXT_CONTRACT_PATH\" == 'scale-results/ihr-context-contract.json' ]] || exit 44
if [[ \"$FAKE_RUNNER_MODE\" == failed-client ]]; then exit 45; fi
`, { mode: 0o755 })
  try { return spawnSync('/bin/bash', ['-c', finalScript], {
    cwd: sandbox, encoding: 'utf8', timeout: 5000,
    env: { PATH: `${sandbox}:/usr/bin:/bin`, TMPDIR: sandbox, FAKE_RUNNER_MODE: mode },
  }) } finally { rmSync(sandbox, { recursive: true, force: true }) }
}
test('final composed shell accepts all eight distinct native completion markers once', () => {
  expect(runFinalMarkerGate().status).toBe(0)
  expect(finalStep).toContain('set -euo pipefail')
  expect(finalStep).not.toMatch(/(?:echo|printf)[^\n]*IHR_/)
  for (const marker of finalMarkers) expect(finalStep).toContain(`grep -Fxc '${marker}'`)
  const admin = readFileSync('tests/database/ihr/admin.sql', 'utf8')
  expect(admin.match(/\\ir admin-rota-context\.sql/g)).toHaveLength(1)
  expect(admin.indexOf('\\ir admin-rota-context.sql')).toBeLessThan(admin.indexOf('\\echo IHR_ADMIN_SCOPED_SETTINGS_PASSED'))
})
test.each(finalMarkers.flatMap(marker => ['missing', 'partial', 'duplicate'].map(mode => `${mode}-${marker}`)))('final composed shell rejects incomplete native proof: %s', mode => {
  expect(runFinalMarkerGate(mode).status).toBe(1)
})
test('final composed shell rejects a failed strict client parse of real SQL evidence',()=>{
  expect(runFinalMarkerGate('failed-client').status).toBe(45)
})
test.each(['failed-before', 'failed-after'])('final composed shell rejects failed runner output: %s', mode => {
  expect(runFinalMarkerGate(mode).status).toBe(42)
})
test('staged migration application remains literal and precedes each native runner invocation', () => {
  const pairs = [
    ['202610021001_ihr_leave_foundation.sql', 'foundation'],
    ['202610021002_ihr_leave_calendar.sql', 'calendar'],
    ['202610021003_ihr_leave_accounts.sql', 'accounts'],
    ['202610021004_ihr_leave_quote.sql', 'quote'],
    ['202610021005_ihr_leave_requests.sql', 'requests'],
  ] as const
  expect(workflow).toContain('sha256sum --strict --check tests/database/ihr/ci-source-manifest.sha256')
  expect(workflow).toContain('if [[ "$file" > supabase/migrations/202610021001_ihr_leave_foundation.sql || "$file" == supabase/migrations/202610021001_ihr_leave_foundation.sql ]]; then continue; fi')
  for (const [migration, suite] of pairs) {
    const application = workflow.indexOf(`psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/${migration}`)
    expect(application).toBeGreaterThan(-1)
    expect(application).toBeLessThan(workflow.indexOf(`node scripts/test-ihr-db.mjs --suite ${suite}`))
  }
})

function assertLiteralSqlClosure(entries: Map<string, string>, entryPoints: string[], repoRoot = '.') {
  const seen = new Set<string>()
  function visit(path: string) {
    if (!path.startsWith('tests/database/ihr/') || posix.normalize(path) !== path) throw new Error('SQL include escapes the HR source boundary')
    if (!entries.has(path)) throw new Error(`SQL include requires an exact literal manifest entry: ${path}`)
    if (seen.has(path)) return
    seen.add(path)
    const sql = readFileSync(join(repoRoot, path), 'utf8')
    expect(entries.get(path)).toBe(createHash('sha256').update(sql).digest('hex'))
    for (const rawLine of sql.split('\n')) {
      const line = rawLine.trim()
      if (line.startsWith('--') || !/\\(?:ir|i|include_relative|include)(?![A-Za-z_])/.test(line)) continue
      const include = /^\\ir[ \t]+([a-z0-9_./-]+\.sql)$/.exec(line)
      if (!include || posix.isAbsolute(include[1])) throw new Error('Unsupported or dynamic SQL include syntax')
      visit(posix.normalize(posix.join(posix.dirname(path), include[1])))
    }
  }
  entryPoints.forEach(visit)
  return seen
}

test('the literal CI source manifest pins every HR migration and recursive SQL include', () => {
  const lines = readFileSync('tests/database/ihr/ci-source-manifest.sha256', 'utf8').trimEnd().split('\n')
  expect(lines.every(line => /^[a-f0-9]{64}  (?:scripts\/test-ihr-db\.mjs|supabase\/migrations\/20261002100[1-8]_ihr_leave_[a-z]+\.sql|tests\/database\/ihr\/[a-z/-]+\.sql)$/.test(line))).toBe(true)
  const entries = new Map(lines.map(line => [line.slice(66), line.slice(0, 64)]))
  expect(entries.size).toBe(lines.length)
  for (const name of ['foundation', 'calendar', 'accounts', 'quote', 'requests', 'reads', 'admin', 'context']) {
    const number = ['foundation', 'calendar', 'accounts', 'quote', 'requests', 'reads', 'admin', 'context'].indexOf(name) + 1
    expect(entries.has(`supabase/migrations/20261002100${number}_ihr_leave_${name}.sql`)).toBe(true)
  }
  assertLiteralSqlClosure(entries, ['foundation', 'calendar', 'accounts', 'quote', 'requests', 'composed'].map(suite => `tests/database/ihr/${suite}.sql`))
  const result = spawnSync('sha256sum', ['--strict', '--check', 'tests/database/ihr/ci-source-manifest.sha256'], { encoding: 'utf8', timeout: 5000 })
  expect(result.status, result.stderr).toBe(0)
})

function checkSyntheticClosure(parentSql: string, childSql: string, includeChild: boolean, includeOutside = false) {
  const root = mkdtempSync(join(tmpdir(), 'ihr-ci-closure-'))
  const parent = 'tests/database/ihr/composed/entry.sql'
  const child = 'tests/database/ihr/declared.sql'
  const files = new Map([
    [parent, parentSql], [child, childSql],
    ['tests/database/ihr/unlisted.sql', '-- synthetic unlisted SQL child\n'],
    ['tests/database/outside.sql', '-- synthetic out-of-boundary SQL child\n'],
  ])
  const entries = new Map([[parent, createHash('sha256').update(parentSql).digest('hex')]])
  if (includeChild) entries.set(child, createHash('sha256').update(childSql).digest('hex'))
  if (includeOutside) entries.set('tests/database/outside.sql', createHash('sha256').update(files.get('tests/database/outside.sql')!).digest('hex'))
  try {
    for (const [path, sql] of files) {
      mkdirSync(join(root, posix.dirname(path)), { recursive: true })
      writeFileSync(join(root, path), sql)
    }
    // Parent pins are recomputed after the include is added. The child must
    // still be discovered and checked independently before SQL can run.
    return assertLiteralSqlClosure(entries, [parent], root)
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test('parent-relative declared child is normalized and traversed', () => {
  expect([...checkSyntheticClosure('\\ir ./../composed/../declared.sql\n', '-- synthetic declared child\n', true)]).toEqual([
    'tests/database/ihr/composed/entry.sql', 'tests/database/ihr/declared.sql',
  ])
})
test('parent pin refresh cannot authorize an unlisted parent-relative child', () => {
  expect(() => checkSyntheticClosure('\\ir ../unlisted.sql\n', '-- declared child\n', false)).toThrow()
})
test('declared parent-relative child cannot conceal an unlisted nested descendant', () => {
  expect(() => checkSyntheticClosure('\\ir ../declared.sql\n', '\\ir ./unlisted.sql\n', true)).toThrow()
})
test('include normalization rejects a path escaping the HR SQL boundary before reading it', () => {
  expect(() => checkSyntheticClosure('\\ir ../../outside.sql\n', '-- declared child\n', false, true)).toThrow(/boundary/)
})
test.each([
  '\\ir :dynamic', '\\ir "/tmp/child.sql"', '\\ir /tmp/child.sql',
  '\\ir child.sql \\ir other.sql', '\\i ../declared.sql',
  '\\include ../declared.sql', '\\include_relative ../declared.sql', '\\ir', 'SELECT 1; \\ir ../declared.sql',
  '\\ir../declared.sql', '\\ir:dynamic', '\\ir"../declared.sql"',
])('unsupported or dynamic include syntax is rejected before SQL: %s', directive => {
  expect(() => checkSyntheticClosure(`${directive}\n`, '-- declared child\n', false)).toThrow(/include/)
})
