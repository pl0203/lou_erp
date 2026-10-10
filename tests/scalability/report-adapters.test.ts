import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { emptyDashboardSummary, fixtureClient, fixtureId, type Fixture } from './fixtures'
const state = vi.hoisted(() => ({ fixture: { tables: {} } as any, calls: [] as any[] }))
vi.mock('../../src/lib/supabase', async () => {
  const { fixtureClient } = await import('./fixtures')
  const base = fixtureClient(() => state.fixture)
  return { supabase: { ...base, rpc(name: string, args: any) { state.calls.push({ name, args }); return base.rpc(name, args) } } }
})
import { fetchDashboardData, fetchCustomerStatAggregates, fetchCustomerPerformancePage, fetchRevenuePage, fetchSalesPerformancePage, fetchTeamActivity, fetchManagerCustomerPage } from '../../src/lib/reads/reports'
const asOf = '2026-10-01T12:00:00Z'
function daily(args: any) {
  const days = []; const cursor = new Date(`${args.p_from}T00:00:00Z`)
  while (cursor.toISOString().slice(0, 10) <= args.p_to) { days.push({ key: cursor.toISOString().slice(0, 10), deliveredValue: '0.00', sjCount: 0 }); cursor.setUTCDate(cursor.getUTCDate() + 1) }
  return { version: 1, as_of: asOf, page: args.p_page, page_size: args.p_page_size, total: days.length, items: days.slice((args.p_page - 1) * args.p_page_size, args.p_page * args.p_page_size) }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T12:00:00Z')); state.calls = []; state.fixture = { tables: {}, rpc: { pilot_athel_summary_v1: emptyDashboardSummary, pilot_athel_daily_v1: daily } } })
afterEach(() => vi.useRealTimers())
test('loads every daily bucket across pages before returning the chart', async () => {
  const result = await fetchDashboardData('2025-01-01', '2026-10-01', 'all', 'all')
  expect(result.dailySeries).toHaveLength(639)
  expect(result.dailySeries[0]).toMatchObject({ key: '2025-01-01', deliveredValue: '0.00' })
  expect(result.dailySeries.at(-1)?.key).toBe('2026-10-01')
  expect(new Set(result.dailySeries.map(day => day.key)).size).toBe(639)
  expect(state.calls.filter(call => call.name === 'pilot_athel_daily_v1').map(call => call.args.p_page)).toEqual([1, 2])
})
test('rejects an interrupted or duplicate daily sequence instead of returning a partial chart', async () => {
  state.fixture.rpc.pilot_athel_daily_v1 = (args: any) => args.p_page === 2 ? null : daily(args)
  await expect(fetchDashboardData('2025-01-01', '2026-10-01', 'all', 'all')).rejects.toThrow()
  state.fixture.rpc.pilot_athel_daily_v1 = (args: any) => { const page = daily(args); if (args.p_page === 2) page.items[0].key = '2025-01-01'; return page }
  await expect(fetchDashboardData('2025-01-01', '2026-10-01', 'all', 'all')).rejects.toThrow()
})
test('chunks more than 100 customer IDs and preserves server totals beyond the raw row cap', async () => {
  const ids = Array.from({ length: 205 }, (_, i) => fixtureId(i + 1))
  state.fixture.rpc.pilot_customer_stats_v1 = (args: any) => ({ version: 1, as_of: asOf, items: args.p_customer_ids.map((customer_id: string) => ({ customer_id, first_order_date: null, order_count: 1500, total_sales: '50000.00', top_items: [] })) })
  const result = await fetchCustomerStatAggregates(ids, '2026-07-01', 3)
  expect(result).toHaveLength(205)
  expect(result[204].order_count).toBe(1500)
  expect(result[204].total_sales).toBe('50000.00')
  expect(state.calls.map(call => call.args.p_customer_ids.length)).toEqual([100, 100, 5])
})
test('a failed later customer batch fails the entire result', async () => {
  state.fixture.rpc.pilot_customer_stats_v1 = (args: any) => state.calls.length === 2 ? null : ({ version: 1, as_of: asOf, items: args.p_customer_ids.map((customer_id: string) => ({ customer_id, first_order_date: null, order_count: 0, total_sales: '0.00', top_items: [] })) })
  await expect(fetchCustomerStatAggregates(Array.from({ length: 101 }, (_, i) => fixtureId(i + 1)), '2026-07-01', 3)).rejects.toThrow()
})
test('customer performance sends own-manager or executive NULL scope with browser-local half-open visits', async () => {
  state.fixture.rpc.pilot_customer_performance_v1 = (args: any) => ({ version: 1, as_of: asOf, items: [], total: 0, page: args.p_page, page_size: args.p_page_size, summary: { total_sales: '0', active_customers: 0, total_customers: 0, total_visits: 0, total_target_visits: 0, visit_percent: 0, top_customer: null } })
  await fetchCustomerPerformancePage('manager', 'sales_manager', '2026-09')
  await fetchCustomerPerformancePage('executive', 'executive', '2026-09')
  expect(state.calls[0].args).toMatchObject({ p_manager_id: 'manager', p_year_month: '2026-09', p_visit_from: new Date(2026, 8, 1).toISOString(), p_visit_until: new Date(2026, 9, 1).toISOString(), p_page: 1, p_page_size: 50 })
  expect(state.calls[1].args.p_manager_id).toBeNull()
})
test('sales and revenue retain their existing date and inclusive last-second boundaries', async () => {
  state.fixture.rpc.pilot_sales_performance_v1 = (args: any) => ({ version: 1, as_of: asOf, items: [], total: 0, page: args.p_page, page_size: args.p_page_size, summary: { total_visited: 0, total_scheduled: 0, total_orders: 0, total_sales: '0', average_visit_rate: 0 } })
  state.fixture.rpc.pilot_revenue_v1 = (args: any) => ({ version: 1, as_of: asOf, items: [], total: 0, page: args.p_page, page_size: args.p_page_size, summary: { total_sales: '0', total_orders: 0, active_customers: 0, top_customer: null } })
  await fetchSalesPerformancePage('head', 'sales_head', '2026-09')
  await fetchRevenuePage('30d')
  const from = new Date(2026, 8, 1).toISOString().slice(0, 10), to = new Date(2026, 9, 0).toISOString().slice(0, 10)
  expect(state.calls[0].args).toMatchObject({ p_manager_id: null, p_date_from: from, p_date_to: to, p_order_from: `${from}T00:00:00`, p_order_to: `${to}T23:59:59` })
  expect(state.calls[1].args).toMatchObject({ p_from: '2026-09-01T00:00:00', p_to: '2026-10-01T23:59:59' })
})

test('missing activity for a directory member is unavailable rather than a fabricated zero', async () => {
  state.fixture.rpc.pilot_team_activity_v1 = () => ({ version: 1, as_of: asOf, items: [{ sales_person_id: fixtureId(1), total_scheduled: 0, total_visited: 0, total_orders: 0, weekly_visits: 0 }] })
  await expect(fetchTeamActivity([fixtureId(1), fixtureId(2)])).rejects.toThrow()
})
test('manager rows and summary share the exact caller-supplied overdue reference instant', async () => {
  state.fixture.rpc.pilot_manager_customers_v1 = (args: any) => ({ version: 1, as_of: '2026-10-01T12:00:02Z', items: [], total: 0, page: args.p_page, page_size: args.p_page_size, summary: { total: 0, on_track: 0, overdue: 0 } })
  const result = await fetchManagerCustomerPage(fixtureId(1))
  expect(result.referenceInstant).toBe(state.calls[0].args.p_as_of)
  expect(result.referenceInstant).toBe('2026-10-01T12:00:00.000Z')
  expect(state.calls[0].args.p_visit_from).toBe('2026-09-01T12:00:00.000Z')
})
