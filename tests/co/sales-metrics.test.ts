// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'
const mock = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: mock.rpc } }))
import { decodeSalesMetrics, decodeSalesMetricMonths } from '../../src/lib/reads/salesMetrics'
import { decodeRead } from '../../src/lib/reads/rpc'
import { fetchSalesMetricsPage, fetchSalesMetricMonths } from '../../src/lib/reads/reports'

const id = '00000000-0000-0000-0000-000000000001'
const args = { p_manager_id: null, p_month_from: '2026-09-01', p_month_until: '2026-10-01', p_group_by: 'customer' as const, p_order_type: 'all' as const, p_page: 1, p_page_size: 100 }
const metrics = { po_order_value: '100.00', po_order_count: '1', po_delivered_revenue: '30.00', po_delivered_order_count: '1', co_sold_revenue: '2147483646999978525163.53', co_sold_order_count: '1' }
function page() { return { version: 2, as_of: '2026-10-09T15:00:00+00:00', scope: 'leadership', manager_id: null, month_from: args.p_month_from, month_until: args.p_month_until, group_by: 'customer', order_type: 'all', page: 1, page_size: 100, total: '1', summary: { ...metrics, co_report_event_count: '1' }, items: [{ customer_id: id, customer_name: 'Customer', ...metrics, co_report_event_count: '1' }] } }
const copy = <T,>(x: T): T => structuredClone(x)

describe('strict additive v2 sales contract', () => {
  test('preserves exact money, count strings and v2 routing', () => {
    const data = page()
    expect(decodeSalesMetrics(args, data)).toEqual(data)
    expect(decodeRead('pilot_sales_metrics_v2', args, data)).toEqual(data)
    expect(decodeRead('pilot_sales_report_months_v1', { p_manager_id: null }, { version: 1, as_of: data.as_of, earliest_schedule_date: null, earliest_order_at: null }).version).toBe(1)
  })
  test.each(['1', 1, '2', 3, null])('rejects wrong protocol %s', version => expect(() => decodeSalesMetrics(args, { ...page(), version })).toThrow())
  test.each([0, 2.5, -1, '1', 2147483648])('rejects invalid page %s', p => expect(() => decodeSalesMetrics({ ...args, p_page: p } as any, { ...page(), page: p })).toThrow())
  test.each(['1e3', 'NaN', 'Infinity', '-0.00', '01.00', '1', '1.0', 1, null])('rejects noncanonical money %s', value => {
    const data = page(); data.summary.po_order_value = value as any
    expect(() => decodeSalesMetrics(args, data)).toThrow()
  })
  test.each(['1.0', '-1', '01', '1e3', 1, null])('rejects noncanonical count %s', value => expect(() => decodeSalesMetrics(args, { ...page(), total: value })).toThrow())
  test('validates real half-open months, identity, timestamp and echoes', () => {
    for (const patch of [{ month_from: '2026-09-02' }, { month_until: '2026-02-30' }, { month_until: '2026-09-01' }, { group_by: 'person' }, { order_type: 'po' }, { manager_id: id }, { page_size: 99 }, { as_of: '2026-02-30T00:00:00Z' }, { as_of: '2026-10-09T00:00:00' }, { scope: 'admin' }]) expect(() => decodeSalesMetrics(args, { ...page(), ...patch })).toThrow()
    const data = page(); data.items[0].customer_id = 'not-a-uuid'; expect(() => decodeSalesMetrics(args, data)).toThrow()
  })
  test('rejects raw identifiers and extra fields at every level', () => {
    for (const key of ['co_id', 'report_id', 'revision_id', 'batch_id', 'evidence_path', 'source_id', 'generation_id', 'arbitrary']) {
      for (const level of ['root', 'summary', 'row']) {
        const data: any = page(); (level === 'root' ? data : level === 'summary' ? data.summary : data.items[0])[key] = id
        expect(() => decodeSalesMetrics(args, data)).toThrow()
      }
    }
  })
  test('requires complete pages with exact bigint offsets and unique grouping IDs', () => {
    const data = page(); expect(() => decodeSalesMetrics(args, { ...data, items: [] })).toThrow()
    expect(() => decodeSalesMetrics(args, { ...data, total: '2', items: [data.items[0], data.items[0]] })).toThrow()
    const huge = { ...data, total: '9007199254740993', page_size: 1 }
    expect(decodeSalesMetrics({ ...args, p_page_size: 1 }, huge).total).toBe('9007199254740993')
    expect(decodeSalesMetrics({ ...args, p_page: 2 }, { ...data, page: 2, items: [] }).items).toEqual([])
  })
  test('full collections require additive money/count equality; partial pages retain full totals', () => {
    const data = page(); data.summary.po_order_value = '101.00'
    expect(() => decodeSalesMetrics(args, data)).toThrow()
    expect(decodeSalesMetrics({ ...args, p_page_size: 1 }, { ...data, page_size: 1, total: '2' }).summary.po_order_value).toBe('101.00')
    const empty = { ...page(), total: '0', items: [] }
    expect(() => decodeSalesMetrics(args, empty)).toThrow()
  })
  test('person report contributions are nonadditive; zero-price sales still contribute', () => {
    const zero = { po_order_value: '0.00', po_order_count: '0', po_delivered_revenue: '0.00', po_delivered_order_count: '0', co_sold_revenue: '0.00', co_sold_order_count: '1' }
    const person = (n: number) => ({ person_id: id.slice(0, -1) + n, person_name: `Person${n}`, is_unassigned: false, ...zero, co_contributing_report_count: '1' })
    const data = { ...page(), group_by: 'person', total: '2', summary: { ...zero, co_sold_order_count: '2', co_report_event_count: '1' }, items: [person(1), person(2)] }
    expect(decodeSalesMetrics({ ...args, p_group_by: 'person' }, data)).toEqual(data)
    const unassigned = copy(data); unassigned.items[1] = { ...unassigned.items[1], person_id: null as any, person_name: 'Unassigned', is_unassigned: true }
    expect(decodeSalesMetrics({ ...args, p_group_by: 'person' }, unassigned)).toEqual(unassigned)
    expect(() => decodeSalesMetrics({ ...args, p_group_by: 'person', p_manager_id: id }, { ...unassigned, manager_id: id })).toThrow()
    expect(() => decodeSalesMetrics({ ...args, p_group_by: 'person' }, { ...unassigned, scope: 'own' })).toThrow()
    unassigned.items[1].is_unassigned = false; expect(() => decodeSalesMetrics({ ...args, p_group_by: 'person' }, unassigned)).toThrow()
  })
  test('excluded order-type families cannot contribute', () => {
    expect(() => decodeSalesMetrics({ ...args, p_order_type: 'po' }, { ...page(), order_type: 'po' })).toThrow()
    expect(() => decodeSalesMetrics({ ...args, p_order_type: 'co' }, { ...page(), order_type: 'co' })).toThrow()
  })
  test('month discovery is strict, nullable and shares filter bindings', () => {
    const a = { p_manager_id: null, p_order_type: 'co' as const }
    const data = { version: 2, as_of: page().as_of, scope: 'own', manager_id: null, order_type: 'co', earliest_month: '2026-09-01' }
    expect(decodeSalesMetricMonths(a, data)).toEqual(data)
    expect(decodeSalesMetricMonths(a, { ...data, earliest_month: null }).earliest_month).toBeNull()
    for (const patch of [{ earliest_month: '2026-09-02' }, { earliest_month: '0000-01-01' }, { earliest_month: 'infinity' }, { co_id: id }, { manager_id: id }, { version: 1 }, { order_type: 'all' }]) expect(() => decodeSalesMetricMonths(a, { ...data, ...patch })).toThrow()
  })
  test('adapters pass calendar bounds and filters unchanged, preserve exact results and abort/error behavior', async () => {
    const data = page(); const controller = new AbortController()
    const abortSignal = vi.fn().mockResolvedValue({ data, error: null }); mock.rpc.mockReturnValue({ abortSignal })
    expect(await fetchSalesMetricsPage(args, controller.signal)).toEqual(data)
    expect(mock.rpc).toHaveBeenLastCalledWith('pilot_sales_metrics_v2', args)
    expect(abortSignal).toHaveBeenCalledWith(controller.signal)
    const ma = { p_manager_id: null, p_order_type: 'co' as const }; const md = { version: 2, as_of: data.as_of, scope: 'leadership', manager_id: null, order_type: 'co', earliest_month: null }
    mock.rpc.mockResolvedValue({ data: md, error: null }); expect(await fetchSalesMetricMonths(ma)).toEqual(md)
    mock.rpc.mockResolvedValue({ data: null, error: { code: '42501' } }); await expect(fetchSalesMetricsPage(args)).rejects.toEqual({ code: '42501' })
    controller.abort(); mock.rpc.mockClear(); await expect(fetchSalesMetricsPage(args, controller.signal)).rejects.toThrow(); expect(mock.rpc).not.toHaveBeenCalled()
  })
})

test('invalid empty full collections cannot carry nonzero summary money', () => {
  const data = page()
  const zero = { po_order_value: '0.00', po_order_count: '0', po_delivered_revenue: '0.00', po_delivered_order_count: '0', co_sold_revenue: '0.00', co_sold_order_count: '0', co_report_event_count: '0' }
  expect(decodeSalesMetrics(args, { ...data, total: '0', items: [], summary: zero }).total).toBe('0')
  expect(() => decodeSalesMetrics(args, { ...data, total: '0', items: [], summary: { ...zero, po_order_value: '0.01', po_order_count: '1' } })).toThrow()
})

test('TypeScript keeps protocol v2, grouping shapes and string aggregates distinct from legacy v1', async () => {
  const ts = await import('typescript')
  const { resolve } = await import('node:path')
  const name = resolve('tests/co/sales-metrics-type-fixture.ts')
  const source = `
    import type { SalesMetricsPage, SalesMetricMonths, SalesMetricsArgs, ReadEnvelope } from '../../src/lib/reads/contracts'
    declare const page: SalesMetricsPage
    const version: 2 = page.version
    const count: string = page.summary.co_report_event_count
    const revenue: string = page.summary.co_sold_revenue
    if (page.group_by === 'customer') {
      const id: string = page.items[0].customer_id
      // @ts-expect-error customer events have no invented person contribution
      page.items[0].co_contributing_report_count
    } else {
      const id: string | null = page.items[0].person_id
      const contributes: string = page.items[0].co_contributing_report_count
      // @ts-expect-error person report contributions are not global event counts
      page.items[0].co_report_event_count
    }
    // @ts-expect-error aggregates expose no raw report identities
    page.items[0].report_head_id
    // @ts-expect-error exact counts are never JS Number
    const bad: number = page.summary.po_order_count
    // @ts-expect-error legacy version1 must not accept version2
    const old: ReadEnvelope = page
    declare const months: SalesMetricMonths
    const earliest: string | null = months.earliest_month
    const args: SalesMetricsArgs = { p_manager_id: null, p_order_type: 'all', p_group_by: 'person', p_month_from: '2026-09-01', p_month_until: '2026-10-01', p_page: 1, p_page_size: 100 }
    // @ts-expect-error there is no client role authorization argument
    args.role = 'executive'
  `
  const options = { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler }
  const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host)
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => file === name ? ts.createSourceFile(file, source, languageVersion, true) : original(file, languageVersion, onError, shouldCreateNewSourceFile)
  expect(ts.getPreEmitDiagnostics(ts.createProgram([name], options, host)).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([])
})
