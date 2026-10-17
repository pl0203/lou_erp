// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from 'vitest'
import { DEMO_MIGRATIONS } from '../../scripts/build-demo-rollout.mjs'
import { createHistoricalProtectedRoot } from './historical-protected-root.mjs'

const manifestPath = 'scripts/demo-rollout-protected-sources.json'
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { sources: { path: string; sha256: string }[] }
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const fixturePath = 'tests/demo/fixtures/historical-protected'

// Real isolated copies let us damage a fixture without touching the checkout,
// weakening the production builder, or mocking the helper's filesystem checks.
function withIsolatedHelper(assertion: (root: string, run: () => { error: string | null; code: string | null; remaining: string[] }) => void) {
  const root = mkdtempSync(join(tmpdir(), 'historical-helper-test-'))
  try {
    const files = [
      'tests/demo/historical-protected-root.mjs',
      'scripts/build-demo-rollout.mjs',
      'scripts/assemble-read-rollout.mjs',
      'scripts/demo-rollout-fixture-target.mjs',
      'scripts/demo-rollout-snapshot.sql',
      manifestPath,
      ...manifest.sources.map(source => source.path),
      ...DEMO_MIGRATIONS,
    ]
    for (const path of files) {
      const destination = join(root, path)
      mkdirSync(dirname(destination), { recursive: true })
      copyFileSync(path, destination)
    }
    cpSync(fixturePath, join(root, fixturePath), { recursive: true })
    const scratch = join(root, 'tmp')
    mkdirSync(scratch)
    const helperUrl = pathToFileURL(join(root, 'tests/demo/historical-protected-root.mjs')).href
    const run = () => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', `
      import { readdirSync } from 'node:fs'
      import { tmpdir } from 'node:os'
      import { createHistoricalProtectedRoot } from ${JSON.stringify(helperUrl)}
      let error = null, code = null
      try { createHistoricalProtectedRoot().cleanup() }
      catch (failure) { error = failure.message; code = failure.code ?? null }
      console.log(JSON.stringify({ error, code, remaining: readdirSync(tmpdir()) }))
    `], { encoding: 'utf8', env: { TMPDIR: scratch } }))
    assertion(root, run)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('preserves all 81 immutable protected hashes and four migration bytes in a disposable root', () => {
  const historical = createHistoricalProtectedRoot()
  try {
    expect(manifest.sources).toHaveLength(81)
    for (const source of manifest.sources) {
      expect(sha256(readFileSync(join(historical.root, source.path))), source.path).toBe(source.sha256)
    }
    expect(DEMO_MIGRATIONS).toHaveLength(4)
    for (const path of DEMO_MIGRATIONS) {
      expect(readFileSync(join(historical.root, path)), path).toEqual(readFileSync(path))
    }
  } finally {
    historical.cleanup()
  }
  expect(existsSync(historical.root)).toBe(false)
  expect(() => historical.cleanup()).not.toThrow()
})

test.each([
  ['src/lib/AuthContext.tsx', 'AuthContext.tsx.snapshot'],
  ['src/pages/ForgotPassword.tsx', 'ForgotPassword.tsx.snapshot'],
  ['src/lib/leave/readContracts.ts', 'readContracts.ts.snapshot'],
  ['src/lib/leave/readQueryKeys.ts', 'readQueryKeys.ts.snapshot'],
  ['src/lib/leave/readRpc.ts', 'readRpc.ts.snapshot'],
  ['src/lib/leave/useLeaveReads.ts', 'useLeaveReads.ts.snapshot'],
])('rejects a tampered snapshot for %s and cleans the partial root without current-source fallback', (source, snapshot) => {
  withIsolatedHelper((root, run) => {
    const snapshotFile = join(root, fixturePath, snapshot)
    // Even pristine pinned current-source bytes must not rescue a bad snapshot.
    copyFileSync(snapshotFile, join(root, source))
    writeFileSync(snapshotFile, Buffer.concat([readFileSync(snapshotFile), Buffer.from('\n// tampered fixture\n')]))
    const result = run()
    expect(result.code).toBe('ERR_ASSERTION')
    expect(result.error).toContain(`Historical protected source drift: ${source}`)
    expect(result.remaining).toEqual([])
  })
})

test.each([
  ['src/lib/AuthContext.tsx', 'AuthContext.tsx.snapshot'],
  ['src/pages/ForgotPassword.tsx', 'ForgotPassword.tsx.snapshot'],
  ['src/lib/leave/readContracts.ts', 'readContracts.ts.snapshot'],
  ['src/lib/leave/readQueryKeys.ts', 'readQueryKeys.ts.snapshot'],
  ['src/lib/leave/readRpc.ts', 'readRpc.ts.snapshot'],
  ['src/lib/leave/useLeaveReads.ts', 'useLeaveReads.ts.snapshot'],
])('rejects a missing snapshot for %s and cleans the partial root without current-source fallback', (source, snapshot) => {
  withIsolatedHelper((root, run) => {
    const snapshotFile = join(root, fixturePath, snapshot)
    copyFileSync(snapshotFile, join(root, source))
    rmSync(snapshotFile)
    const result = run()
    expect(result.code).toBe('ENOENT')
    expect(result.error).toContain(snapshot)
    expect(result.remaining).toEqual([])
  })
})

test('still rejects drift in an unmapped protected source and cleans the partial root', () => {
  withIsolatedHelper((root, run) => {
    const source = 'src/lib/leave/accountContracts.ts'
    writeFileSync(join(root, source), '\n// tampered current source\n')
    const result = run()
    expect(result.code).toBe('ERR_ASSERTION')
    expect(result.error).toContain(`Historical protected source drift: ${source}`)
    expect(result.remaining).toEqual([])
  })
})

test('still rejects an incomplete protected inventory before allocating a root', () => {
  withIsolatedHelper((root, run) => {
    writeFileSync(join(root, manifestPath), JSON.stringify({ ...manifest, sources: manifest.sources.slice(1) }))
    const result = run()
    expect(result.code).toBe('ERR_ASSERTION')
    expect(result.error).toContain('Exact historical protected source inventory required')
    expect(result.remaining).toEqual([])
  })
})

test('cleans the completed protected-source root if a pinned migration is missing', () => {
  withIsolatedHelper((root, run) => {
    rmSync(join(root, DEMO_MIGRATIONS[3]))
    const result = run()
    expect(result.code).toBe('ENOENT')
    expect(result.error).toContain(DEMO_MIGRATIONS[3])
    expect(result.remaining).toEqual([])
  })
})
