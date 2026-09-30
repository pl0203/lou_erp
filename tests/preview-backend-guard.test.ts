// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
const target = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'fix/pilot-database' }
const url = 'https://mqfpupsuthghubkeiuey.supabase.co'
const jwt = (role: string, ref = 'mqfpupsuthghubkeiuey') => [Buffer.from('{"alg":"HS256"}').toString('base64url'), Buffer.from(JSON.stringify({ role, ref })).toString('base64url'), 'synthetic-signature'].join('.')
function run(env: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['scripts/verify-preview-backend.mjs'], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } })
}
describe('database preview backend build guard', () => {
  it('leaves local, CI and other branch/production builds unchanged', () => {
    for (const env of [{}, { ...target, VERCEL_ENV: 'production' }, { ...target, VERCEL_GIT_COMMIT_REF: 'fix/pilot-safety' }]) expect(run(env).status).toBe(0)
  })
  it('blocks the actual build command before Vite can load committed .env', () => {
    const result = spawnSync('npm', ['run', 'build'], { encoding: 'utf8', env: { PATH: process.env.PATH, ...target } })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Database preview build blocked')
    expect(result.stdout).not.toContain('building for production')
  })
  it('rejects missing process env despite repository .env fallback', () => {
    expect(run(target).status).not.toBe(0)
    expect(run({ ...target, VITE_SUPABASE_URL: url }).status).not.toBe(0)
  })
  it.each(['https://wrong.supabase.co', 'http://mqfpupsuthghubkeiuey.supabase.co', `${url}.attacker.invalid`, `${url}/rest/v1`, `${url}?x=1`, 'not-a-url'])('rejects wrong backend %s', candidate => {
    expect(run({ ...target, VITE_SUPABASE_URL: candidate, VITE_SUPABASE_ANON_KEY: 'sb_publishable_synthetic' }).status).not.toBe(0)
  })
  it.each(['sb_publishable_synthetic', jwt('anon')])('accepts explicit staging client-key format', key => {
    const result = run({ ...target, VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Database preview backend guard passed.')
    expect(result.stdout).not.toContain(key)
  })
  it.each(['sb_secret_DO_NOT_LOG', jwt('service_role'), jwt('authenticated'), jwt('anon', 'other-project'), 'malformed', 'sb_publishable_'])('rejects non-client or malformed keys without logging them', key => {
    const result = run({ ...target, VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key })
    expect(result.status).not.toBe(0)
    expect(result.stdout + result.stderr).not.toContain(key)
  })
})
