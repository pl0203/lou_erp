// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs')>(), existsSync: vi.fn(),
}))
import { EMPLOYEE_DB_SUITES, parseEmployeeDbArgs, runEmployeeDb } from '../../scripts/test-employee-db.mjs'

const exists = vi.mocked(existsSync)
const root = fileURLToPath(new URL('../../', import.meta.url))
const target = { PGHOST: '127.0.0.1', PGDATABASE: 'pilot_test', PGUSER: 'postgres' }
const suites = ['reads', 'commands', 'reporting', 'preservation', 'all']
const body = (suite: string) => suite === 'reads' ? 'read-model' : suite
const wrapper = (suite: string) => join(root, `tests/database/employees/run-${suite}.sql`)
const dependencies = (suite: string) => suite === 'reads' ? ['schema'] : suite === 'commands' ? ['schema', 'commands'] : ['schema', 'commands', 'reporting']
beforeEach(() => { exists.mockReturnValue(true) })

describe('fixed employee disposable database runner', () => {
  it('publishes only the declared suite allowlist', () => { expect(EMPLOYEE_DB_SUITES).toEqual(suites) })
  it.each(['repoRoot', 'path', 'sql', 'script', 'input', 'file', 'wrapper'])('rejects caller-controlled %s before any filesystem or process call', key => {
    const execute = vi.fn(), probe = vi.fn()
    expect(() => runEmployeeDb({ env: target, suite: 'reads', execute, probe, [key]: 'caller-controlled' })).toThrow(/option|argument|fixed/i)
    expect(exists).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled(); expect(probe).not.toHaveBeenCalled()
  })
  it.each([
    { ...target, PGHOST: 'db.production.example' }, { ...target, PGHOST: '/tmp' },
    { ...target, PGHOST: 'localhost,remote' }, { ...target, PGHOST: '' },
    { ...target, PGDATABASE: 'production' }, { ...target, PGDATABASE: 'pilot_test host=remote' },
    { ...target, PGUSER: 'service_role' }, { ...target, PGPORT: '5432\n' },
    { ...target, PGPORT: '0' }, { ...target, PGPORT: '65536' },
  ])('refuses unsafe target before any process %j', env => {
    const execute = vi.fn(), probe = vi.fn()
    expect(() => runEmployeeDb({ env, suite: 'reads', execute, probe })).toThrow()
    expect(execute).not.toHaveBeenCalled(); expect(probe).not.toHaveBeenCalled()
  })
  it.each(['', 'f', 't\nf', 'disposable-pilot-ci'])('refuses marker/server/prerequisite mismatch %j before execution', marker => {
    const execute = vi.fn(), probe = vi.fn(() => marker)
    expect(() => runEmployeeDb({ env: target, suite: 'reads', execute, probe })).toThrow(/fixture|marker|prerequisite/i)
    expect(execute).not.toHaveBeenCalled(); expect(probe).toHaveBeenCalledTimes(1)
    const options = probe.mock.calls[0][2] as { input: string; env: Record<string, string> }
    expect(options.input).toMatch(/^BEGIN READ ONLY;/)
    for (const token of ['inet_server_addr()', 'public.pilot_fixture_marker', 'public.users', 'public.leave_context_v1()', 'private.ihr_leave_calendar_timezone(uuid)', 'ROLLBACK;']) expect(options.input).toContain(token)
    expect(options.env.PGOPTIONS).toContain('default_transaction_read_only=on')
  })
  it('propagates probe refusal without workload execution', () => {
    const execute = vi.fn(), probe = vi.fn(() => { throw Error('fixture unavailable') })
    expect(() => runEmployeeDb({ env: target, suite: 'reads', execute, probe })).toThrow(/fixture|prerequisite/i)
    expect(execute).not.toHaveBeenCalled()
  })
  it.each(suites)('checks exactly the fixed dependency paths for %s', suite => {
    const execute = vi.fn(() => ''), probe = vi.fn(() => 't')
    const selected = suite === 'all' ? suites.filter(s => s !== 'all') : [suite]
    runEmployeeDb({ env: target, suite, execute, probe })
    const checked = exists.mock.calls.map(([path]) => path)
    expect(checked).toEqual([
      ...dependencies(suite).map(name => join(root, `sql/employee-foundation-${name}.sql`)),
      join(root, 'tests/database/ihr/helpers.sql'), join(root, 'tests/database/employees/seed.sql'),
      ...selected.flatMap(name => [join(root, `tests/database/employees/${body(name)}.sql`), wrapper(name)]),
    ])
  })
  it.each(suites)('refuses missing fixed dependencies for %s before probe/execution', suite => {
    exists.mockImplementation(path => !String(path).endsWith(`employee-foundation-${dependencies(suite).at(-1)}.sql`))
    const execute = vi.fn(), probe = vi.fn()
    expect(() => runEmployeeDb({ env: target, suite, execute, probe })).toThrow(/file|dependency/i)
    expect(execute).not.toHaveBeenCalled(); expect(probe).not.toHaveBeenCalled()
  })
  it.each(['tests/database/ihr/helpers.sql', 'tests/database/employees/seed.sql', 'tests/database/employees/read-model.sql', 'tests/database/employees/run-reads.sql'])('refuses missing fixed support file %s', suffix => {
    exists.mockImplementation(path => !String(path).endsWith(suffix))
    const execute = vi.fn(), probe = vi.fn()
    expect(() => runEmployeeDb({ env: target, suite: 'reads', execute, probe })).toThrow(/file|dependency/i)
    expect(execute).not.toHaveBeenCalled(); expect(probe).not.toHaveBeenCalled()
  })
  it.each(suites)('executes only fixed wrapper file arguments for %s', suite => {
    const execute = vi.fn(() => ''), probe = vi.fn(() => 't\n')
    const selected = suite === 'all' ? suites.filter(s => s !== 'all') : [suite]
    expect(runEmployeeDb({ env: { ...target, PGHOSTADDR: 'remote', PGSERVICE: 'remote', PGOPTIONS: '-c role=service_role' }, suite, execute, probe })).toEqual({ suites: selected, race: false })
    expect(execute).toHaveBeenCalledTimes(selected.length)
    const calls = execute.mock.calls as unknown as [string, string[], { input?: string; cwd: string; env: Record<string, string>; shell: boolean }][]
    calls.forEach(([command, args, options], i) => {
      expect(command).toBe('psql')
      expect(args).toEqual(['-h', '127.0.0.1', '-p', '5432', '-U', 'postgres', '-d', 'pilot_test', '-X', '--no-password', '--set=ON_ERROR_STOP=1', '--set=VERBOSITY=verbose', `--file=${wrapper(selected[i])}`])
      expect(options).not.toHaveProperty('input'); expect(options.shell).toBe(false); expect(options.cwd).toBe(root.replace(/\/$/, ''))
      expect(options.env).not.toHaveProperty('PGHOSTADDR'); expect(options.env).not.toHaveProperty('PGSERVICE'); expect(options.env.PGOPTIONS).not.toContain('service_role')
    })
  })
  it('checks the fixed race adapter before probing and invokes only that fixed path', () => {
    const raceFile = join(root, 'tests/database/employees/concurrency.mjs')
    const execute = vi.fn(() => ''), probe = vi.fn(() => 't')
    runEmployeeDb({ env: target, suite: 'commands', race: true, execute, probe })
    expect(exists).toHaveBeenCalledWith(raceFile)
    expect(execute.mock.calls.at(-1)).toEqual([process.execPath, [raceFile, '--suite', 'commands'], expect.objectContaining({ shell: false })])
    execute.mockClear(); probe.mockClear(); exists.mockImplementation(path => path !== raceFile)
    expect(() => runEmployeeDb({ env: target, suite: 'commands', race: true, execute, probe })).toThrow(/file/i)
    expect(execute).not.toHaveBeenCalled(); expect(probe).not.toHaveBeenCalled()
  })
  it('propagates workload failure and does not execute later wrappers', () => {
    const execute = vi.fn(() => { throw Error('fixed suite failed') })
    expect(() => runEmployeeDb({ env: target, suite: 'all', execute, probe: () => 't' })).toThrow('fixed suite failed')
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it('requires declared suite/race values before any process hook', () => {
    const execute = vi.fn(), probe = vi.fn()
    for (const options of [{ suite: 'unknown' }, { suite: 'reads', race: 'yes' }]) expect(() => runEmployeeDb({ env: target, execute, probe, ...options })).toThrow()
    expect(execute).not.toHaveBeenCalled(); expect(probe).not.toHaveBeenCalled()
  })
  it('accepts only the declared command-line contract', () => {
    expect(parseEmployeeDbArgs(['--suite', 'reads'])).toEqual({ suite: 'reads', race: false })
    expect(parseEmployeeDbArgs(['--race', '--suite', 'all'])).toEqual({ suite: 'all', race: true })
    for (const args of [[], ['--suite', 'unknown'], ['--file', 'anything.sql'], ['--suite', 'reads', '--race', '--race'], ['--suite', 'reads', '--suite', 'all']]) expect(() => parseEmployeeDbArgs(args)).toThrow()
  })
  it.each(['reads', 'commands', 'reporting', 'preservation'])('keeps %s in a version-controlled rollback wrapper', suite => {
    expect(() => readFileSync(wrapper(suite), 'utf8'), 'fixed wrapper must exist').not.toThrow()
    const text = readFileSync(wrapper(suite), 'utf8')
    expect(text).toBe(`-- Fixed disposable test wrapper only. Not an activation bundle.\nBEGIN;\n${dependencies(suite).map(name => `\\ir ../../../sql/employee-foundation-${name}.sql\n`).join('')}\\ir ../ihr/helpers.sql\n\\ir ${body(suite)}.sql\nROLLBACK;\n\\echo EMPLOYEE_${suite.toUpperCase()}_PASSED\n`)
  })
})
it('all with races retains each historical dispatch and adds fixed recovery plus actual SQL decoder',()=>{
 const execute=vi.fn(),probe=vi.fn(()=> 't')
 expect(runEmployeeDb({env:target,suite:'all',race:true,execute,probe})).toEqual({suites:['reads','commands','reporting','preservation'],race:true})
 expect(execute.mock.calls.slice(4).map(call=>call[1])).toEqual([
 [join(root,'tests/database/employees/concurrency.mjs'),'--suite','commands'],
 [join(root,'tests/database/employees/concurrency.mjs'),'--suite','reporting'],
 [join(root,'tests/database/employees/recovery-races.mjs')],
 [join(root,'tests/database/employees/sql-decoder.mjs')],
 ])
})
