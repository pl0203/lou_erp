// Fixed disposable extension to the existing composed fixture. Never accepts URL,
// target database, migration path, hosted credential or an unsafe/bypass switch.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runCoCi } from './test-co-ci.mjs'
import { runWorkspaceCurrentBaseline, WORKSPACE_CURRENT_AUTHORITY_SNAPSHOT } from './co-workspace-current-baseline.mjs'
import { coWorkspaceConnection, coSourceIdentity, coBindFixtureServer, CO_FIXTURE_OBSERVATION_SQL, coVerifyFixtureIdentitySql, coFixtureChildEnv } from './co-fixture-target.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
export function workspaceCase(args) {
  assert.equal(args.length, 2, 'Exactly one fixed case required')
  assert.equal(args[0], '--case', 'Only fixed cases accepted')
  assert.ok(['import-manifest','import-posting','import-races','workspace-reads'].includes(args[1]), 'Unknown fixed case')
  return args[1]
}
export function workspaceOptions(args) {
  assert.ok(args.length === 2 || args.length === 4, 'Only fixed case and optional fixed baseline accepted')
  const caseName = workspaceCase(args.slice(0, 2))
  const baselineName = args.length === 2 ? 'legacy' : args[3]
  if (args.length === 4) assert.equal(args[2], '--baseline', 'Only fixed baseline accepted')
  assert.ok(['legacy', 'current'].includes(baselineName), 'Unknown fixed baseline')
  return { caseName, baselineName }
}
export function composeWorkspaceReadFixture(posting, reads) {
  const terminal = /ROLLBACK;\s*SELECT 'CO_IMPORT_ATOMIC_POST_EDIT_PASSED';\s*$/
  assert.equal(posting.split('\n').filter(line => /^ROLLBACK;\s*$/.test(line)).length, 1, 'One terminal fixture rollback required')
  assert.match(posting, terminal, 'Exact posting fixture terminal required')
  assert.ok(!/^\s*(BEGIN|COMMIT|ROLLBACK);/mi.test(reads), 'Read assertions stay in existing rollback fixture')
  return posting.replace(terminal, () => reads + "\nROLLBACK;\nSELECT 'CO_IMPORT_ATOMIC_POST_EDIT_PASSED';\nSELECT 'CO_WORKSPACE_READS_PASSED';\n")
}
// Only reached after the fixed synthetic target and immutable identity checks.
// Keep unexpected PostgreSQL errors diagnosable without dumping exec arguments,
// stdout, or unbounded server output into the public job log.
export function assertWorkspaceInstallFailure(error) {
  const stderr = typeof error?.stderr === 'string' || Buffer.isBuffer(error?.stderr) ? String(error.stderr) : ''
  if (/PZ603.*Synthetic late import installation failure/.test(stderr)) return
  const diagnostic = stderr.slice(-8192).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
  throw new Error(`Must reach the deliberately late installation failure; unexpected PostgreSQL diagnostic:\n${diagnostic || 'No PostgreSQL stderr available'}`)
}
export function runCoWorkspaceDb({ env = process.env, execute = execFileSync, sourceIdentity = coSourceIdentity, caseName = 'import-manifest', baselineName = 'legacy' } = {}) {
  workspaceOptions(['--case',caseName,'--baseline',baselineName])
  const source = sourceIdentity()
  // Fail before any SQL or process execution for unverified source/target context.
  const expectedConnection = coWorkspaceConnection(env, source)
  const { identity, connection } = runCoCi({ env, execute, sourceIdentity, through: '08' })
  assert.deepEqual(connection, expectedConnection, 'Fixture connection drift')
  assert.deepEqual(identity.source, source, 'Fixture source drift')
  const run = sql => execute('psql', ['-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], {
    env: { ...connection, PGDATABASE: 'pilot_co_test' }, cwd: root, input: sql,
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 180000,
    shell: false, stdio: ['pipe', 'pipe', 'pipe'],
  })
  const verify = () => {
    coBindFixtureServer({ kind: env.CO_CI_PROFILE ? 'ci' : 'local', database: 'pilot_co_test', source, runIdentity: identity.runIdentity }, JSON.parse(run(CO_FIXTURE_OBSERVATION_SQL)), identity)
    assert.equal(run(coVerifyFixtureIdentitySql(identity)).trim(), 't', 'Exact independently marked source/server/run required')
  }
  verify()
  if (baselineName === 'current') {
    runWorkspaceCurrentBaseline({ run, verify, read: path => readFileSync(new URL('../' + path, import.meta.url), 'utf8') })
    verify()
  }
  const currentAuthorityBefore = baselineName === 'current' ? run(WORKSPACE_CURRENT_AUTHORITY_SNAPSHOT).trim() : null
  const candidate = readFileSync(new URL('../supabase/candidates/co-workspace-redesign/20261026100000_co_import_manifest.sql', import.meta.url), 'utf8')
  assert.equal(candidate.split('\n').filter(line => /^(BEGIN|COMMIT);\s*$/.test(line)).join(','), 'BEGIN;,COMMIT;', 'One whole-candidate transaction required')
  assert.ok(candidate.trimEnd().endsWith('COMMIT;'), 'Terminal candidate COMMIT required')
  const installationSnapshot = readFileSync(new URL('../tests/database/co/import-install-snapshot.sql', import.meta.url), 'utf8')
  const beforeInstall = run(installationSnapshot).trim()
  const lateFailure = readFileSync(new URL('../tests/database/co/import-install-failure.sql', import.meta.url), 'utf8')
  let failed = false
  try { run(candidate.replace(/COMMIT;\s*$/, lateFailure + '\nCOMMIT;\n')) }
  catch (error) {
    assertWorkspaceInstallFailure(error)
    failed = true
  }
  assert.equal(failed, true, 'Late installation fault must abort')
  assert.equal(run(installationSnapshot).trim(), beforeInstall, 'Failed candidate must leave no definitions/ACLs/relations/hooks/bucket residue')
  verify()
  process.stdout.write('CO_IMPORT_INSTALL_ROLLBACK_PASSED\n')
  run(candidate)
  verify()
  const output = run(readFileSync(new URL('../tests/database/co/import-manifest.sql', import.meta.url), 'utf8'))
  for (const marker of ['CO_IMPORT_CANONICAL_VECTORS_PASSED', 'CO_IMPORT_UNIT_DECLARATIONS_PASSED', 'CO_IMPORT_SHAPE_PRIMITIVES_PASSED', 'CO_IMPORT_DOMAIN_PARITY_PASSED', 'CO_IMPORT_PREPARE_LIFECYCLE_PASSED', 'CO_IMPORT_NUMERIC_CONVENTIONS_PASSED']) {
    assert.equal(output.split('\n').filter(line => line === marker).length, 1, `${marker} required exactly once`)
  }
  verify()
  const evidenceOutput = run(readFileSync(new URL('../tests/database/co/evidence-xlsx.sql', import.meta.url), 'utf8'))
  assert.equal(evidenceOutput.split('\n').filter(line => line === 'CO_XLSX_EVIDENCE_METADATA_PASSED').length, 1, 'XLSX metadata assertions required exactly once')
  verify()
  process.stdout.write(evidenceOutput)
  process.stdout.write(output)
  // Posting assertions also exercise immutable per-revision import reads.
  // Install their real additive dependency for all cases using that fixture.
  if (caseName !== 'import-manifest') {
    const reads = readFileSync(new URL('../supabase/candidates/co-workspace-redesign/20261026101000_co_workspace_reads.sql', import.meta.url), 'utf8')
    assert.equal(reads.split('\n').filter(line => /^(BEGIN|COMMIT);\s*$/.test(line)).join(','), 'BEGIN;,COMMIT;', 'One whole workspace-read candidate transaction required')
    assert.ok(reads.trimEnd().endsWith('COMMIT;'), 'Terminal workspace-read COMMIT required')
    run(reads)
    verify()
  }
  if (caseName === 'workspace-reads') {
    // Reuse real posting setup inside its existing rolled-back transaction. The
    // read fixture is fixed source, not an arbitrary caller-supplied path or URL.
    const postingFixture = readFileSync(new URL('../tests/database/co/import-posting.sql', import.meta.url), 'utf8')
    const readFixture = readFileSync(new URL('../tests/database/co/workspace-reads.sql', import.meta.url), 'utf8')
    const checked = run(composeWorkspaceReadFixture(postingFixture, readFixture))
    for (const marker of ['CO_IMPORT_ATOMIC_POST_EDIT_PASSED','CO_WORKSPACE_READS_PASSED']) {
      assert.equal(checked.split('\n').filter(line => line === marker).length, 1, `${marker} required exactly once`)
    }
    verify()
    process.stdout.write(checked)
  }
  if (caseName === 'import-posting' || caseName === 'import-races') {
    const posted = run(readFileSync(new URL('../tests/database/co/import-posting.sql', import.meta.url), 'utf8'))
    assert.equal(posted.split('\n').filter(line => line === 'CO_IMPORT_ATOMIC_POST_EDIT_PASSED').length, 1, 'Atomic post/Edit assertions required exactly once')
    process.stdout.write(posted)
    verify()
  }
  if (caseName === 'import-races') {
    const raced = execute(process.execPath, [fileURLToPath(new URL('../tests/database/co/import-races.mjs', import.meta.url))], {
      env: coFixtureChildEnv(connection, env, identity), cwd: root, encoding:'utf8', maxBuffer:32*1024*1024, timeout:180000, shell:false, stdio:['pipe','pipe','pipe'],
    })
    assert.equal(raced.split('\n').filter(line => line === 'CO_IMPORT_REAL_RACES_PASSED').length, 1, 'Observed real import races required exactly once')
    process.stdout.write(raced)
    verify()
  }
  if (baselineName === 'current') {
    assert.equal(run(WORKSPACE_CURRENT_AUTHORITY_SNAPSHOT).trim(), currentAuthorityBefore, 'HR authority, public routers, generation-two engines and inactive cutover must remain exact')
    const authority = run(readFileSync(new URL('../tests/database/co/workspace-current-authority.sql', import.meta.url), 'utf8'))
    assert.equal(authority.split('\n').filter(x => x === 'CO_WORKSPACE_CURRENT_AUTHORITY_PASSED').length, 1, 'Real current authority assertions required')
    verify()
    process.stdout.write(authority)
    const history = run(readFileSync(new URL('../tests/database/co/workspace-current-history.sql', import.meta.url), 'utf8'))
    assert.equal(history.split('\n').filter(x => x === 'CO_WORKSPACE_CURRENT_HISTORY_PASSED').length, 1, 'Real current history assertions required')
    verify()
    process.stdout.write(history)
  }
  // Lifecycle assertions are not real race/Edge/browser acceptance. No money-safety checkpoint marker.
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { runCoWorkspaceDb(workspaceOptions(process.argv.slice(2))) }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
}
