// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

test('hosted PostgreSQL matches the exact version required by the unchanged rollout guard', () => {
 const builder = readFileSync('scripts/build-co-rollout.mjs','utf8')
 const workflow = readFileSync('.github/workflows/co-workspace-runtime.yml','utf8')
 const guarded = /current_setting\('server_version_num'\)<>'(\d{6})'/.exec(builder)?.[1]
 expect(guarded).toBe('170011')
 const image = /image: postgres:(\d+)\.(\d+)\s/.exec(workflow)
 expect(image).not.toBeNull()
 expect(String(Number(image![1]) * 10000 + Number(image![2]))).toBe(guarded)
 expect(builder).toContain("assert.equal(snapshot.observation.server_version_num,'170011')")
})
