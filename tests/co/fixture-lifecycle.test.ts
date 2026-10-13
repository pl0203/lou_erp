// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { runCoCi } from '../../scripts/test-co-ci.mjs'
const source = { commit: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true }
const env = { PATH: '/usr/bin', PGHOST: '127.0.0.1', PGPORT: '65437', PGUSER: 'postgres', PGDATABASE: 'pilot_test' }
function fixture(change: Record<string, unknown> = {}, existing = false) {
  const calls: { sql: string; db: string; args: string[] }[] = []
  const execute = (command: string, args: string[], options: any) => {
    const sql = options.input ?? ''; const db = options.env.PGDATABASE
    calls.push({ sql, db, args })
    if (sql.includes('CO_FIXTURE_OBSERVATION')) return JSON.stringify({ database: db, operator: 'postgres', database_owner: 'postgres', system_identifier: '1234567890', server_version_num: '170011', server_address: '127.0.0.1', server_port: 65437, marker: { kind: 'r', owner: 'postgres', rows: [{ purpose: 'disposable-pilot-ci' }] }, ...change })
    if (sql.includes('CO_VERIFY_FIXTURE_IDENTITY')) return 't'
    if (sql.includes('SELECT NOT EXISTS') && sql.includes('pg_database')) return existing ? 'f' : 't'
    if (sql.includes("SELECT current_database()='pilot_test'")) return 't'
    if (sql.includes('CO_PROTECTED_BASELINE_FINGERPRINT')) return 'a'.repeat(64)
    if (command !== 'psql' && args[0].endsWith('/co/rollout.mjs')) return 'CO_ATOMIC_ROLLOUT_LIFECYCLE_PASSED\n'
    if (command !== 'psql') return args[0].endsWith('decode-reads.mjs') ? 'CO_SQL_DECODERS_PASSED\n' : args[0].endsWith('decode-sales-metrics.mjs') ? 'CO_SALES_METRICS_DECODERS_PASSED\n' : 'CO_REAL_RACES_PASSED\nCO_EVIDENCE_REAL_RACES_PASSED\n'
    const markers = [...sql.matchAll(/SELECT '(CO_[A-Z_]+PASSED)'/g)].map(m => m[1])
    return markers.map(m => m + '\n').join('')
  }
  return { calls, run: (through = '01') => runCoCi({ env, execute, through, sourceIdentity: () => source } as any) }
}
describe('independent fixture identity lifecycle', () => {
  test('observes and stamps exact source/run/server before any CO migrations', () => {
    const f = fixture(); f.run()
    const observation = f.calls.findIndex(c => c.sql.includes('CO_FIXTURE_OBSERVATION'))
    const stamp = f.calls.findIndex(c => c.sql.includes('CO_CREATE_FIXTURE_IDENTITY'))
    const role = f.calls.findIndex(c => c.sql.includes('ALTER TYPE public.user_role ADD VALUE'))
    expect(observation).toBeGreaterThanOrEqual(0); expect(stamp).toBeGreaterThan(observation); expect(role).toBeGreaterThan(stamp)
    expect(f.calls[stamp].sql).toContain(source.commit); expect(f.calls[stamp].sql).toContain('1234567890')
  })
  test.each([{ system_identifier: null }, { server_port: 5432 }, { database_owner: 'anon' }, { marker: null }])('refuses wrong observed identity before any database creation: %j', change => {
    const f = fixture(change); expect(() => f.run()).toThrow()
    expect(f.calls.some(c => /CREATE DATABASE/.test(c.sql))).toBe(false)
  })
  test('requires a fresh fixed rollout companion before enum00 and refuses reuse', () => {
    const f = fixture(); f.run('08')
    const clone = f.calls.findIndex(c => c.sql === 'CREATE DATABASE pilot_co_rollout_test WITH TEMPLATE pilot_co_test OWNER postgres;')
    expect(clone).toBeGreaterThan(-1)
    expect(clone).toBeLessThan(f.calls.findIndex(c => c.sql.includes('ALTER TYPE public.user_role ADD VALUE')))
    expect(f.calls.filter(c => c.db === 'pilot_co_rollout_test' && c.sql.includes('CO_VERIFY_FIXTURE_IDENTITY'))).toHaveLength(1)
    expect(f.calls.filter(c => c.db === 'pilot_test' || c.db === 'pilot_co_rollout_test').map(c => c.sql).join('\n')).not.toMatch(/DROP DATABASE|TRUNCATE/)
  })
})
