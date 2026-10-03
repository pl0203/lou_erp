// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IHR_DB_SUITES, parseIhrDbArgs, runIhrDb, validateIhrDbTarget } from '../../scripts/test-ihr-db.mjs'

const target = { PGHOST: '127.0.0.1', PGDATABASE: 'pilot_test', PGUSER: 'postgres' }
const expectedSuites = ['foundation', 'calendar', 'accounts', 'quote', 'requests', 'decisions',
  'reads', 'admin', 'composed']
const roots: string[] = []
function syntheticRoot() {
  const root = mkdtempSync(join(tmpdir(), 'ihr-guard-'))
  roots.push(root)
  mkdirSync(join(root, 'tests/database/ihr'), { recursive: true })
  writeFileSync(join(root, 'tests/database/ihr/helpers.sql'), '-- synthetic helpers')
  for (const suite of expectedSuites) writeFileSync(join(root, `tests/database/ihr/${suite}.sql`), '-- synthetic assertion suite')
  writeFileSync(join(root, 'tests/database/ihr/concurrency.mjs'), '// synthetic race suite')
  return root
}
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))

describe('disposable iHR runner guard', () => {
  it('locks the fixed suite allowlist', () => { expect(IHR_DB_SUITES).toEqual(expectedSuites) })
  it.each([
    { ...target, PGHOST: 'db.production.example' }, { ...target, PGHOST: '/tmp' },
    { ...target, PGHOST: '' }, { ...target, PGHOST: 'localhost,remote' },
    { ...target, PGDATABASE: 'production' }, { ...target, PGDATABASE: 'pilot_test host=remote' },
    { ...target, PGUSER: 'service_role' }, { PGDATABASE: 'pilot_test', PGUSER: 'postgres' },
    { ...target, PGPORT: '5432 --host=remote' }, { ...target, PGPORT: '5432\n' },
    { ...target, PGPORT: '0' }, { ...target, PGPORT: '65536' },
  ])('launches no process for refused target %j', env => {
    const spawnSpy = vi.fn(), markerProbe = vi.fn()
    expect(() => runIhrDb({ env, suite: 'foundation', execute: spawnSpy, probe: markerProbe })).toThrow()
    expect(spawnSpy).not.toHaveBeenCalled()
    expect(markerProbe).not.toHaveBeenCalled()
  })
  it.each(['localhost', '127.0.0.1', '::1'])('accepts explicit loopback target %s', host => {
    expect(validateIhrDbTarget({ ...target, PGHOST: host }).PGHOST).toBe(host)
  })
  it('clears all inherited PG overrides and restores only the validated connection', () => {
    const env = validateIhrDbTarget({ ...target, PGHOSTADDR: 'remote', PGSERVICE: 'production',
      PGSERVICEFILE: '/tmp/production', PGPASSFILE: '/tmp/passwords', PGOPTIONS: '-c role=service_role',
      PGDATABASE_OVERRIDE: 'production', PGSSLMODE: 'disable', PGREQUIRESSL: '0', PGTARGETSESSIONATTRS: 'any',
      pgHOSTADDR: 'remote', PATH: '/usr/bin', PGPASSWORD: 'synthetic-password' })
    expect(env.PGHOST).toBe(target.PGHOST)
    expect(env.PGPORT).toBe('5432')
    expect(env.PATH).toBe('/usr/bin')
    expect(env.PGPASSWORD).toBe('synthetic-password')
    expect(Object.keys(env).filter(key => key.toUpperCase().startsWith('PG')).sort()).toEqual(
      ['PGCONNECT_TIMEOUT', 'PGDATABASE', 'PGHOST', 'PGPASSWORD', 'PGPORT', 'PGUSER'])
  })
  it.each(['', 'f', 't\nf', 'disposable-pilot-ci'])('launches zero workloads after refused marker %j', marker => {
    const spawnSpy = vi.fn(), markerProbe = vi.fn(() => marker)
    expect(() => runIhrDb({ env: target, suite: 'foundation', repoRoot: syntheticRoot(),
      execute: spawnSpy, probe: markerProbe })).toThrow(/marker/i)
    expect(markerProbe).toHaveBeenCalledTimes(1)
    expect(spawnSpy).not.toHaveBeenCalled()
    const [command, args, options] = markerProbe.mock.calls[0] as unknown as [string, string[], { input: string; env: Record<string, string>; shell: boolean }]
    expect(command).toBe('psql')
    expect(args).toContain('--no-password')
    expect(options.input).toMatch(/^BEGIN READ ONLY;/)
    expect(options.input).toContain('public.pilot_fixture_marker')
    expect(options.input).toContain("current_database() = 'pilot_test'")
    expect(options.input).toContain("current_user = 'postgres'")
    expect(options.input).toContain('ROLLBACK;')
    expect(options.env.PGOPTIONS).toContain('default_transaction_read_only=on')
    expect(options.shell).toBe(false)
  })
  it('does not execute workload when the read-only marker probe fails', () => {
    const spawnSpy = vi.fn(), markerProbe = vi.fn(() => { throw new Error('Missing fixture table') })
    expect(() => runIhrDb({ env: target, suite: 'foundation', repoRoot: syntheticRoot(),
      execute: spawnSpy, probe: markerProbe })).toThrow(/marker/i)
    expect(markerProbe).toHaveBeenCalledTimes(1)
    expect(spawnSpy).not.toHaveBeenCalled()
  })
  it('refuses missing suite files before even probing the database', () => {
    const root = syntheticRoot()
    rmSync(join(root, 'tests/database/ihr/foundation.sql'))
    const spawnSpy = vi.fn(), markerProbe = vi.fn()
    expect(() => runIhrDb({ env: target, suite: 'foundation', repoRoot: root,
      execute: spawnSpy, probe: markerProbe })).toThrow(/file/i)
    expect(spawnSpy).not.toHaveBeenCalled()
    expect(markerProbe).not.toHaveBeenCalled()
  })
  it('runs the chosen suite and helpers in one session only after verification', () => {
    const root = syntheticRoot(), order: string[] = []
    const markerProbe = vi.fn(() => { order.push('probe'); return 't\n' })
    const spawnSpy = vi.fn(() => { order.push('workload'); return '' })
    expect(runIhrDb({ env: { ...target, PGHOSTADDR: 'remote', PGSERVICE: 'remote', PGOPTIONS: '-c role=service_role' },
      suite: 'calendar', repoRoot: root, execute: spawnSpy, probe: markerProbe })).toEqual({ suites: ['calendar'], race: false })
    expect(order).toEqual(['probe', 'workload'])
    const [command, args, options] = spawnSpy.mock.calls[0] as unknown as [string, string[], { env: Record<string, string>; shell: boolean }]
    expect(command).toBe('psql')
    expect(args).toEqual(expect.arrayContaining(['-h', target.PGHOST, '-U', 'postgres', '-d', 'pilot_test', '-X',
      '--no-password', '--set=ON_ERROR_STOP=1', `--file=${root}/tests/database/ihr/helpers.sql`, `--file=${root}/tests/database/ihr/calendar.sql`]))
    expect(options.env).not.toHaveProperty('PGHOSTADDR')
    expect(options.env).not.toHaveProperty('PGSERVICE')
    expect(options.env.PGOPTIONS).not.toContain('service_role')
    expect(options.shell).toBe(false)
  })
  it('all runs every declared suite once and --race invokes the later concurrency suite', () => {
    const root = syntheticRoot(), spawnSpy = vi.fn(() => '')
    expect(runIhrDb({ env: target, suite: 'all', race: true, repoRoot: root,
      execute: spawnSpy, probe: vi.fn(() => 't') })).toEqual({ suites: expectedSuites, race: true })
    expect(spawnSpy).toHaveBeenCalledTimes(expectedSuites.length + 1)
    expect(spawnSpy.mock.calls.at(-1)).toEqual([process.execPath, [join(root, 'tests/database/ihr/concurrency.mjs')],
      expect.objectContaining({ shell: false, env: expect.objectContaining(target) })])
  })
  it('stops after the first failing workload', () => {
    const spawnSpy = vi.fn(() => { throw new Error('Assertion failed') })
    expect(() => runIhrDb({ env: target, suite: 'all', repoRoot: syntheticRoot(),
      execute: spawnSpy, probe: vi.fn(() => 't') })).toThrow('Assertion failed')
    expect(spawnSpy).toHaveBeenCalledTimes(1)
  })
  it('parses only the allowlisted suite and optional race flag', () => {
    expect(parseIhrDbArgs(['--suite', 'foundation'])).toEqual({ suite: 'foundation', race: false })
    expect(parseIhrDbArgs(['--suite', 'all', '--race'])).toEqual({ suite: 'all', race: true })
    expect(parseIhrDbArgs(['--race', '--suite', 'quote'])).toEqual({ suite: 'quote', race: true })
    for (const args of [[], ['--suite', 'remote'], ['--suite', 'cancellation'], ['--suite', 'calendar-read'], ['--suite', 'counts'], ['--file', 'custom.sql'], ['--suite', 'all', '--race', '--race'],
      ['--suite', 'all', '--suite', 'foundation'], ['--suite', 'all', '--reset']]) expect(() => parseIhrDbArgs(args)).toThrow()
  })
  it('rejects unknown programmatic suites without probing or executing', () => {
    const spawnSpy = vi.fn(), markerProbe = vi.fn()
    expect(() => runIhrDb({ env: target, suite: '../production', execute: spawnSpy, probe: markerProbe })).toThrow()
    expect(spawnSpy).not.toHaveBeenCalled()
    expect(markerProbe).not.toHaveBeenCalled()
  })
  it('SQL helper source preserves invoker authority and dynamically resolves the actual temporary schema', () => {
    const sql = readFileSync(new URL('../database/ihr/helpers.sql', import.meta.url), 'utf8')
    expect(sql).toContain('pg_temp.assert_true')
    expect(sql).toContain('pg_temp.assert_denied')
    expect(sql).not.toMatch(/SECURITY\s+DEFINER/i)
    expect(sql).toMatch(/current_user NOT IN \('anon', 'authenticated'\)/)
    expect(sql).toContain('rolbypassrls')
    expect(sql).toContain('GET STACKED DIAGNOSTICS')
    expect(sql).toContain('RETURNED_SQLSTATE')
    expect(sql).toContain('pg_catalog.pg_my_temp_schema()')
    expect(sql).toContain('pg_catalog.pg_namespace')
    expect(sql).toContain('GRANT USAGE ON SCHEMA %I')
    expect(sql).not.toMatch(/GRANT\s+USAGE\s+ON\s+SCHEMA\s+pg_temp/i)
  })
})
