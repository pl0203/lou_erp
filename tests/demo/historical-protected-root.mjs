// Historical demo-release checkpoint ONLY, never a current CO rollout baseline.
// Three inert snapshots are exact bytes from reviewed BASE
// 5e99f7792e47658ce70ddd8b269df61fd843be3a and match the old manifest hashes.
// No Git lookup, hash regeneration, arbitrary fallback, network or DB activity.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEMO_MIGRATIONS } from '../../scripts/build-demo-rollout.mjs'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const snapshots = new Map([
  ['src/lib/AuthContext.tsx', 'AuthContext.tsx.snapshot'],
  ['src/pages/ihr/LeaveManagement.tsx', 'LeaveManagement.tsx.snapshot'],
  ['src/pages/ihr/UserManagement.tsx', 'UserManagement.tsx.snapshot'],
])
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export function createHistoricalProtectedRoot() {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'scripts/demo-rollout-protected-sources.json'), 'utf8'))
  assert.equal(manifest.sources.length, 81, 'Exact historical protected source inventory required')
  const root = mkdtempSync(join(tmpdir(), 'demo-historical-checkpoint-'))
  const cleanup = () => rmSync(root, { recursive: true, force: true })
  try {
    for (const source of manifest.sources) {
      const snapshot = snapshots.get(source.path)
      const bytes = readFileSync(snapshot ? new URL(`./fixtures/historical-protected/${snapshot}`, import.meta.url) : join(repoRoot, source.path))
      assert.equal(sha256(bytes), source.sha256, `Historical protected source drift: ${source.path}`)
      const destination = join(root, source.path)
      mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, bytes)
    }
    for (const path of DEMO_MIGRATIONS) {
      const destination = join(root, path)
      mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, readFileSync(join(repoRoot, path)))
    }
    return { root, cleanup }
  } catch (error) { cleanup(); throw error }
}
