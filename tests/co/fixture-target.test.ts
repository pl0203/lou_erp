// @vitest-environment node
import { describe, expect, test } from 'vitest'
import * as runner from '../../scripts/test-co-ci.mjs'

const source = { commit: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true }
const ci = {
  PATH: '/usr/bin', PGHOST: '127.0.0.1', PGPORT: '5432', PGUSER: 'postgres',
  PGDATABASE: 'pilot_test', PGPASSWORD: 'synthetic-ci-only',
  CO_CI_PROFILE: 'github-pilot-safety-v1', CO_CI_SOURCE_SHA: source.commit,
  CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'pl0203/lou_erp',
  GITHUB_WORKFLOW: 'Pilot safety checks', GITHUB_JOB: 'synthetic-safety',
  GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'c'.repeat(40),
}
const observed = {
  database: 'pilot_test', operator: 'postgres', database_owner: 'postgres',
  system_identifier: '1234567890', server_version_num: '170011', server_address: '172.18.0.2', server_port: 5432,
  marker: { kind: 'r', owner: 'postgres', rows: [{ purpose: 'disposable-pilot-ci' }] },
}
const bind = (input: typeof observed, expected?: unknown) =>
  (runner as any).coBindFixtureServer({ kind: 'ci', source, runIdentity: '12345:1' }, input, expected)

describe('explicit fixed GitHub fixture profile', () => {
  test('accepts a checked PR head distinct from the event SHA and sanitizes child environment', () => {
    const connection = (runner.coCiConnection as any)({ ...ci, HOME: '/unsafe', NODE_OPTIONS: '--inspect', LD_PRELOAD: '/unsafe.so', SECRET: 'not-child-data' }, source)
    expect(connection).toMatchObject({ PGHOST: '127.0.0.1', PGPORT: '5432', PGUSER: 'postgres', PGDATABASE: 'pilot_test', PGPASSWORD: 'synthetic-ci-only', PGTZ: 'UTC', PGCONNECT_TIMEOUT: '5' })
    for (const key of ['HOME', 'NODE_OPTIONS', 'LD_PRELOAD', 'SECRET']) expect(connection).not.toHaveProperty(key)
  })
  test.each([
    ['CO_CI_PROFILE', 'other'], ['CO_CI_SOURCE_SHA', 'd'.repeat(40)], ['CI', 'false'],
    ['GITHUB_ACTIONS', 'false'], ['GITHUB_REPOSITORY', 'elsewhere/lou_erp'],
    ['GITHUB_WORKFLOW', 'Another workflow'], ['GITHUB_JOB', 'another-job'],
    ['GITHUB_RUN_ID', '123;SELECT'], ['GITHUB_RUN_ATTEMPT', '0'], ['GITHUB_SHA', 'invalid'],
    ['PGHOST', 'db.hosted.invalid'], ['PGPORT', '65437'], ['PGUSER', 'app'],
    ['PGDATABASE', 'postgres'], ['PGPASSWORD', 'another-password'],
    ['PGHOSTADDR', '172.18.0.2'], ['PGSERVICE', 'hosted'], ['PGSERVICEFILE', '/unsafe'],
    ['PGOPTIONS', '-c role=postgres'], ['PGPASSFILE', '/unsafe'], ['PGSSLMODE', 'require'],
    ['DATABASE_URL', 'postgres://hosted'], ['SUPABASE_DB_URL', 'postgres://hosted'],
    ['SUPABASE_DB_PASSWORD', 'secret'], ['LD_LIBRARY_PATH', '/unsafe'],
  ])('refuses changed or ambient %s', (key, value) => {
    expect(() => (runner.coCiConnection as any)({ ...ci, [key]: value }, source)).toThrow()
  })
  test('requires the exact actual clean source identity, not merely supplied environment', () => {
    for (const identity of [undefined, { ...source, clean: false }, { ...source, commit: 'd'.repeat(40) }, { ...source, tree: 'invalid' }]) {
      expect(() => (runner.coCiConnection as any)(ci, identity)).toThrow()
    }
  })
  test('partial profile cannot silently fall back to local mode', () => {
    const { CO_CI_PROFILE: omitted, ...rest } = ci
    expect(() => (runner.coCiConnection as any)(rest, source)).toThrow()
  })
})

describe('immutable observed server identity', () => {
  test('binds only the fully verified marker/owner/server and preserves exact full version', () => {
    expect(bind(observed)).toEqual({ source, runIdentity: '12345:1', serverAddress: '172.18.0.2', serverPort: 5432, serverVersion: '170011', systemIdentifier: '1234567890' })
  })
  test.each([
    { database: 'postgres' }, { operator: 'service_role' }, { database_owner: 'service_role' },
    { server_version_num: '160011' }, { server_version_num: '170011x' },
    { system_identifier: null }, { system_identifier: 'not-a-cluster' }, { server_address: null }, { server_address: '203.0.113.1' }, { server_port: 65437 },
    { marker: null }, { marker: { ...observed.marker, owner: 'service_role' } },
    { marker: { ...observed.marker, kind: 'v' } }, { marker: { ...observed.marker, rows: [] } },
    { marker: { ...observed.marker, rows: [{ purpose: 'other' }] } },
    { marker: { ...observed.marker, rows: [...observed.marker.rows, ...observed.marker.rows] } },
  ])('refuses independently changed observation %j', change => {
    expect(() => bind({ ...observed, ...change } as any)).toThrow()
  })
  test('subsequent observations cannot rebind address, port or full version', () => {
    const expected = bind(observed)
    for (const change of [{ system_identifier: '1234567891' }, { server_address: '172.18.0.3' }, { server_port: 5433 }, { server_version_num: '170012' }]) {
      expect(() => bind({ ...observed, ...change }, expected)).toThrow()
    }
    expect(bind(observed, expected)).toEqual(expected)
  })
})
