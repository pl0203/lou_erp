// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  ACTORS, CASE_NAMES, buildCases, buildReadTransaction, buildSelect,
  createPsqlTransport, parseOptions, runMeasurement, sanitizeConnectionEnv,
  summarizeSamples,
} from './measure-reads.mjs'

const env = { PATH: '/usr/bin', PGHOST: '127.0.0.1', PGDATABASE: 'pilot_test', PGUSER: 'postgres', PGPASSWORD: 'synthetic-secret' }
const po = { id: '85000000-0000-0000-0000-000000000001', customer_id: '86000000-0000-0000-0000-000000000001', po_number: "SYNTHETIC-PO-100%_'", customers: { name: 'SYNTHETIC Customer 100%_,' } }
const discovery = { version: 1, as_of: '2026-10-01T00:00:00Z', items: [po], total: 101, page: 1, page_size: 10 }
const profile = { marker: 'disposable-pilot-ci', database: 'pilot_test', server_address: '127.0.0.1', server_version: '17.4', counts: { purchase_orders: 6007, po_line_items: 60007, surat_jalan: 12005, sj_line_items: 120005, customers: 101 } }
const explain = [{ Plan: { 'Node Type': 'Result', 'Shared Hit Blocks': 12 }, 'Planning Time': 0.2, 'Execution Time': 4 }]
const executeArgs = ['--execute', '--permit', 'disposable-pilot-ci', '--rows', '6000', '--roles', 'executive', '--cases', 'po-first', '--profile', 'test CPU/local/fixture', '--output', '/tmp/read-results.json']

function fakeTransport(overrides: Record<string, unknown> = {}) {
  const calls: { kind: string; sql: string }[] = []
  return {
    calls,
    transport: async (request: { kind: string; sql: string }) => {
      calls.push(request)
      if (typeof overrides[request.kind] === 'function') return (overrides[request.kind] as Function)(request, calls)
      const data = overrides[request.kind] ?? (request.kind === 'profile' ? profile : request.kind === 'explain' ? explain : discovery)
      return { stdout: JSON.stringify(data), wallMs: 8 }
    },
  }
}

describe('scale read CLI guards', () => {
  it('defaults to a manifest and never contacts PostgreSQL', async () => {
    const fake = fakeTransport()
    const report = await runMeasurement(parseOptions([]), { env, transport: fake.transport })
    expect(fake.calls).toEqual([])
    expect(report.status).toBe('dry-run')
    expect(report.roles).toEqual(['executive', 'managerA'])
    expect(report.cases).toEqual(CASE_NAMES)
    expect(report.warmups).toBe(10)
    expect(report.measured_samples).toBe(100)
    expect(report.coverage.api.status).toBe('unrun')
    expect(report.coverage.concurrent_transport.status).toBe('unrun')
    expect(report.task7_complete).toBe(false)
  })

  it('records the generator window and planned fixture counts for both sizes', async () => {
    const report = await runMeasurement(parseOptions(['--rows', '30000']))
    expect(report.fixture_window).toEqual({ from: '2021-10-01', through: '2026-09-30', customers: 101 })
    expect(report.fixture_expected_po_rows).toBe(30007)
  })

  it('revalidates programmatic options before execution', async () => {
    const fake = fakeTransport()
    for (const override of [{ samples: 1 }, { warmups: 0 }, { roles: ['service_role'] }, { cases: ['arbitrary-sql'] }, { pageSize: 1.1 }]) {
      await expect(runMeasurement({ ...parseOptions(executeArgs), ...override }, { env, transport: fake.transport })).rejects.toThrow()
    }
    expect(fake.calls).toEqual([])
  })

  it.each([
    ['--rows', '1000'], ['--rows', '30001'], ['--page-size', '0'], ['--page-size', '101'],
    ['--page-size', '1.5'], ['--page-size', '1e2'], ['--page-size', '10junk'],
    ['--warmups', '9'], ['--samples', '99'], ['--samples', '1001'],
    ['--roles', 'service_role'], ['--roles', 'inactive'], ['--cases', 'arbitrary-sql'],
    ['--cases', 'po-first,po-first'], ['--statement-timeout', '0'], ['--unknown', 'x'],
  ])('rejects an unsafe or unbounded argument %s=%s', (flag, value) => {
    expect(() => parseOptions([flag, value])).toThrow()
  })

  it('requires explicit execution selections, profile, permit and output', () => {
    for (const flag of ['--permit', '--roles', '--cases', '--profile', '--output']) {
      const args = [...executeArgs]
      const index = args.indexOf(flag)
      args.splice(index, 2)
      expect(() => parseOptions(args)).toThrow()
    }
  })

  it.each(['remote.example', '/tmp', 'postgres://localhost/pilot_test', '127.0.0.1,remote', ''])('rejects target %s before any process', async host => {
    const fake = fakeTransport()
    await expect(runMeasurement(parseOptions(executeArgs), { env: { ...env, PGHOST: host }, transport: fake.transport })).rejects.toThrow()
    expect(fake.calls).toEqual([])
  })

  it('rejects a non-fixture database before any process', async () => {
    const fake = fakeTransport()
    await expect(runMeasurement(parseOptions(executeArgs), { env: { ...env, PGDATABASE: 'production' }, transport: fake.transport })).rejects.toThrow()
    expect(fake.calls).toEqual([])
  })

  it('passes only bounded connection variables and suppresses libpq overrides', () => {
    const sanitized = sanitizeConnectionEnv({ ...env, PGPORT: '5433', PGHOSTADDR: 'remote', PGSERVICE: 'production', PGSERVICEFILE: '/tmp/service', PGOPTIONS: '-c role=postgres', PGPASSFILE: '/tmp/real-password', LD_PRELOAD: '/tmp/evil.so', HOME: '/root', AWS_SECRET: 'not-pg' })
    expect(sanitized).toMatchObject({ PGHOST: '127.0.0.1', PGDATABASE: 'pilot_test', PGUSER: 'postgres', PGPORT: '5433', PGPASSWORD: 'synthetic-secret', PGPASSFILE: '/dev/null', PGCONNECT_TIMEOUT: '10' })
    for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS', 'LD_PRELOAD', 'HOME', 'AWS_SECRET']) expect(sanitized).not.toHaveProperty(key)
    expect(() => sanitizeConnectionEnv({ ...env, PGUSER: 'postgres options=-crole=superuser' })).toThrow()
    expect(() => sanitizeConnectionEnv({ ...env, PGPORT: '5432,5433' })).toThrow()
  })
})

describe('authorized read case construction', () => {
  it('derives first, middle, final and detail IDs from an authorized page', () => {
    const cases = buildCases({ role: 'managerA', pageSize: 10, discovery })
    const find = (name: string) => cases.find((item: { name: string }) => item.name === name)
    expect(find('po-first').params.p_page).toBe(1)
    expect(find('po-middle').params.p_page).toBe(6)
    expect(find('po-final').params.p_page).toBe(11)
    expect(find('po-search-exact').params.p_search).toBe(po.po_number)
    expect(find('po-search-broad').params.p_search).toBe('SCALE')
    expect(find('po-lines').params.p_po_id).toBe(po.id)
    expect(find('customer-stats').params.p_customer_ids).toEqual([po.customer_id])
    expect(find('customer-stats').params).toEqual({ p_customer_ids: [po.customer_id], p_cutoff: '2026-07-01', p_top_limit: 5 })
    expect(find('dashboard-summary').params).toEqual({ p_from: '2026-07-01', p_to: '2026-09-30', p_rolling_from: '2025-10-01', p_status: 'all', p_fulfillment: 'all' })
    expect(find('sales-performance').params.p_manager_id).toBe(ACTORS.managerA)
    expect(find('sales-performance').params.p_order_to).toBe('2026-09-30T23:59:59Z')
    expect(find('revenue').params.p_to).toBe('2026-09-30T23:59:59Z')
    expect(buildCases({ role: 'executive', pageSize: 100, discovery }).find((item: { name: string }) => item.name === 'sales-performance').params.p_manager_id).toBeNull()
  })

  it('rejects malformed, empty or unsafe discovered rows and page sizes', () => {
    for (const pageSize of [0, 1.5, 101, '10', NaN]) expect(() => buildCases({ role: 'executive', pageSize, discovery })).toThrow()
    expect(() => buildCases({ role: 'executive', pageSize: 10, discovery: { ...discovery, total: Number.MAX_SAFE_INTEGER + 1 } })).toThrow()
    expect(() => buildCases({ role: 'executive', pageSize: 10, discovery: { ...discovery, items: [] } })).toThrow()
    expect(() => buildCases({ role: 'executive', pageSize: 10, discovery: { ...discovery, items: [{ ...po, id: "x'); SELECT secret; --" }] } })).toThrow()
  })

  it('uses an actually visible customer relation instead of assuming a PO foreign key grants visibility', () => {
    const visible = { ...po, customer_id: '86000000-0000-0000-0000-000000000002' }
    const cases = buildCases({ role: 'managerA', pageSize: 10, discovery: { ...discovery, items: [{ ...po, customers: null }, visible] } })
    expect(cases.find((item: { name: string }) => item.name === 'customer-stats').params.p_customer_ids).toEqual([visible.customer_id])
    expect(() => buildCases({ role: 'managerA', pageSize: 10, discovery: { ...discovery, items: [{ ...po, customers: null }] } })).toThrow()
  })

  it('quotes literal search text without changing wildcard punctuation', () => {
    const exact = buildCases({ role: 'executive', pageSize: 10, discovery }).find((item: { name: string }) => item.name === 'po-search-exact')
    const sql = buildSelect(exact)
    expect(sql).toContain("'SYNTHETIC-PO-100%_'''::text")
    expect(sql).toContain('public.pilot_po_page_v1(')
    expect(sql).not.toContain('ILIKE')
    expect(() => buildSelect({ ...exact, rpc: 'arbitrary_function' })).toThrow()
    expect(() => buildSelect({ rpc: 'constructor', params: {} })).toThrow()
    expect(() => buildSelect({ ...exact, params: { ...exact.params, p_page_size: 1.5 } })).toThrow()
  })

  it('keeps each RPC read-only, authenticated, timed out and checked for active RLS', () => {
    const testCase = buildCases({ role: 'managerA', pageSize: 10, discovery })[0]
    const sql = buildReadTransaction({ actor: ACTORS.managerA, query: buildSelect(testCase), explain: true })
    expect(sql).toContain('BEGIN READ ONLY')
    expect(sql).toContain('SET LOCAL ROLE authenticated')
    expect(sql).toContain("SET LOCAL statement_timeout = '60s'")
    expect(sql).toContain('row_security_active')
    expect(sql).toContain('auth.uid()')
    expect(sql).toContain('prosecdef')
    expect(sql).toContain("public.current_user_role()::text IS DISTINCT FROM 'sales_manager'")
    expect(sql).toContain('pilot_fixture_marker')
    expect(sql).toContain('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON, TIMING OFF) SELECT')
    expect(sql).toContain('ROLLBACK')
    expect(() => buildReadTransaction({ actor: '10000000-0000-0000-0000-000000000001', query: buildSelect(testCase) })).toThrow()
  })
})

describe('measurement evidence and failure handling', () => {
  it('records complete measured SQL distributions, every plan and exact parameters', async () => {
    const fake = fakeTransport()
    const report = await runMeasurement(parseOptions(executeArgs), { env, transport: fake.transport })
    expect(report.status).toBe('complete-sql-only')
    expect(report.profile.server.counts.purchase_orders).toBe(6007)
    expect(report.results).toHaveLength(1)
    const result = report.results[0]
    expect(result).toMatchObject({ status: 'complete', role: 'executive', case: 'po-first', sample_count: 100, warmup_count: 10, errors: [], params: { p_page: 1, p_page_size: 10, p_status: 'all', p_search: '' } })
    expect(result.timings.sql_execution_ms).toMatchObject({ p50: 4, p95: 4 })
    expect(result.timings.psql_process_wall_ms).toMatchObject({ p50: 8, p95: 8 })
    expect(result.samples).toHaveLength(100)
    expect(result.samples[0].plan).toEqual(explain)
    expect(result.representative_returned_json_bytes).toBe(Buffer.byteLength(JSON.stringify(discovery)))
    expect(fake.calls.filter(call => call.kind === 'explain')).toHaveLength(110)
    expect(report.coverage.api.status).toBe('unrun')
    expect(report.coverage.browser.status).toBe('unrun')
    expect(report.coverage.concurrent_transport.users).toEqual([1, 5, 10])
    expect(JSON.stringify(report)).not.toContain(env.PGPASSWORD)
  })

  it('refuses an absent fixture marker before discovery or measurement', async () => {
    const fake = fakeTransport({ profile: { ...profile, marker: null } })
    const report = await runMeasurement(parseOptions(executeArgs), { env, transport: fake.transport })
    expect(report.status).toBe('failed-incomplete')
    expect(report.errors).toHaveLength(1)
    expect(fake.calls.map(call => call.kind)).toEqual(['profile'])
    expect(report.results).toEqual([])
  })

  it('records a Docker server address while requiring the client target to stay loopback', async () => {
    const fake = fakeTransport({ profile: { ...profile, server_address: '172.18.0.2' } })
    const report = await runMeasurement(parseOptions(executeArgs), { env, transport: fake.transport })
    expect(report.status).toBe('complete-sql-only')
    expect(report.profile.server.server_address).toBe('172.18.0.2')
    await expect(runMeasurement(parseOptions(executeArgs), { env: { ...env, PGHOST: '172.18.0.2' }, transport: fake.transport })).rejects.toThrow()
  })

  it.each([
    { ...profile, database: 'production' },
    ...Object.keys(profile.counts).map(key => ({ ...profile, counts: { ...profile.counts, [key]: 1 } })),
    { ...profile, counts: { purchase_orders: 6007 } },
  ])('refuses an unexpected database or incomplete fixture shape before discovery', async server => {
    const fake = fakeTransport({ profile: server })
    const report = await runMeasurement(parseOptions(executeArgs), { env, transport: fake.transport })
    expect(report.status).toBe('failed-incomplete')
    expect(fake.calls.map(call => call.kind)).toEqual(['profile'])
  })

  it('stops at the first failed sample, preserves evidence and never manufactures p95', async () => {
    let samples = 0
    const fake = fakeTransport({ explain: () => {
      if (++samples === 12) throw new Error(`timeout with ${env.PGPASSWORD} and server details`)
      return { stdout: JSON.stringify(explain), wallMs: 8 }
    } })
    const report = await runMeasurement(parseOptions([...executeArgs.slice(0, 8), 'po-first,po-final', ...executeArgs.slice(9)]), { env, transport: fake.transport })
    expect(report.status).toBe('failed-incomplete')
    expect(report.results).toHaveLength(1)
    expect(report.results[0]).toMatchObject({ status: 'failed-incomplete', warmup_count: 10, sample_count: 1, timings: null })
    expect(report.results[0].errors).toHaveLength(1)
    expect(report.unrun_cases).toEqual([{ role: 'executive', case: 'po-final' }])
    expect(samples).toBe(12)
    expect(JSON.stringify(report)).not.toContain(env.PGPASSWORD)
  })

  it('rejects incomplete EXPLAIN output and reports failure instead of zero latency', async () => {
    const fake = fakeTransport({ explain: [{ Plan: {} }] })
    const report = await runMeasurement(parseOptions(executeArgs), { env, transport: fake.transport })
    expect(report.status).toBe('failed-incomplete')
    expect(report.results[0].timings).toBeNull()
    expect(report.results[0].sample_count).toBe(0)
  })

  it('uses nearest-rank quantiles only on a complete sample set', () => {
    expect(summarizeSamples(Array.from({ length: 100 }, (_, i) => i + 1), 100)).toEqual({ count: 100, p50: 50, p95: 95, min: 1, max: 100 })
    expect(() => summarizeSamples([1, 2], 100)).toThrow()
    expect(() => summarizeSamples([NaN], 1)).toThrow()
  })

  it('invokes psql without shell/config/credential output and scrubs process errors', async () => {
    let captured: unknown[] = []
    let stdin = ''
    const execFileImpl = (...args: unknown[]) => {
      captured = args
      queueMicrotask(() => (args[3] as Function)({ killed: true, message: env.PGPASSWORD }, '', env.PGPASSWORD))
      return { stdin: { end: (sql: string) => { stdin = sql } } }
    }
    const transport = createPsqlTransport({ env, execFileImpl })
    await expect(transport({ kind: 'profile', sql: 'SELECT 1;' })).rejects.toThrow('psql_timeout')
    expect(captured[0]).toBe('psql')
    expect(captured[1]).toEqual(expect.arrayContaining(['-X', '--no-password', '--set=ON_ERROR_STOP=1', '--file=-']))
    expect(captured[1]).not.toContain(env.PGPASSWORD)
    expect(captured[2]).toMatchObject({ timeout: 65000, shell: false })
    expect(stdin).toBe('SELECT 1;')
  })
})
