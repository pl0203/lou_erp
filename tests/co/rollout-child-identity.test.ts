// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'
import { runCoRollout } from '../database/co/rollout.mjs'

const source = vi.hoisted(() => ({ commit: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true }))
vi.mock('../../scripts/co-fixture-target.mjs', async importOriginal => ({
  ...await importOriginal<typeof import('../../scripts/co-fixture-target.mjs')>(),
  coSourceIdentity: () => source,
}))
const firstMutation = new Error('Stopped at first synthetic mutation')
function probe({ run = '111', attempt = '1', local = false, observedChange = {} } = {}) {
  const identity = { source, runIdentity: local ? 'bf6914fc-284b-4edb-b4e8-e3e87aa88e47' : '111:1', serverAddress: '127.0.0.1', serverPort: local ? 65437 : 5432, serverVersion: '170011', systemIdentifier: '1234567890' }
  const env = {
    PATH: '/usr/bin', PGHOST: '127.0.0.1', PGPORT: String(identity.serverPort), PGUSER: 'postgres', PGDATABASE: 'pilot_test',
    PGPASSFILE: '/dev/null/co-ci-no-password', PGSYSCONFDIR: '/dev/null', CO_FIXTURE_IDENTITY: JSON.stringify(identity),
    ...(!local ? { PGPASSWORD: 'synthetic-ci-only', CO_CI_PROFILE: 'github-pilot-safety-v1', CO_CI_SOURCE_SHA: source.commit,
      CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'pl0203/lou_erp', GITHUB_WORKFLOW: 'Pilot safety checks',
      GITHUB_JOB: 'synthetic-safety', GITHUB_RUN_ID: run, GITHUB_RUN_ATTEMPT: attempt, GITHUB_SHA: source.commit } : {}),
  }
  const sql: string[] = []
  const execute = (command: string, args: string[], options: any) => {
    expect(command).toBe('psql')
    expect(options.env.PGDATABASE).toBe('pilot_co_rollout_test')
    sql.push(options.input)
    if (options.input.startsWith('-- CO_FIXTURE_OBSERVATION')) return JSON.stringify({
      database: 'pilot_co_rollout_test', operator: 'postgres', database_owner: 'postgres', system_identifier: identity.systemIdentifier,
      server_version_num: identity.serverVersion, server_address: identity.serverAddress, server_port: identity.serverPort,
      marker: { kind: 'r', owner: 'postgres', rows: [{ purpose: 'disposable-pilot-ci' }] }, ...observedChange,
    })
    if (options.input.startsWith('-- CO_VERIFY_FIXTURE_IDENTITY')) return 't'
    throw firstMutation
  }
  return { sql, run: () => runCoRollout({ env, execute } as any) }
}
const mutations = (sql: string[]) => sql.filter(s => /\b(?:UPDATE|INSERT|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/.test(s))

describe('rollout child independently binds the current run before any mutation', () => {
  test('refuses a previous CI run with the same source and stored identity', () => {
    const p = probe({ run: '222' })
    expect(() => p.run()).toThrow(/Fixture server\/source\/run identity drift/)
    expect(mutations(p.sql)).toEqual([])
  })
  test('refuses a previous attempt of the same CI run', () => {
    const p = probe({ attempt: '2' })
    expect(() => p.run()).toThrow(/Fixture server\/source\/run identity drift/)
    expect(mutations(p.sql)).toEqual([])
  })
  test.each([false, true])('a correct %s-local profile reaches its first mutation only after both identity reads', local => {
    const p = probe({ local })
    expect(() => p.run()).toThrow(firstMutation)
    expect(p.sql).toHaveLength(3)
    expect(p.sql[0]).toContain('CO_FIXTURE_OBSERVATION')
    expect(p.sql[1]).toContain('CO_VERIFY_FIXTURE_IDENTITY')
    expect(mutations(p.sql)).toHaveLength(1)
  })
  test.each([{ system_identifier: '9876543210' }, { marker: null }])('still refuses observed identity drift %j before mutation', observedChange => {
    const p = probe({ observedChange })
    expect(() => p.run()).toThrow(/identity drift|marker/)
    expect(mutations(p.sql)).toEqual([])
  })
})
