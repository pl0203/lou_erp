import { beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ calls: [] as { name: string; args: unknown }[], response: {} as unknown, error: null as unknown }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: (name: string, args: unknown) => { state.calls.push({ name, args }); return { abortSignal: () => Promise.resolve({ data: state.response, error: state.error }), then: (resolve: any, reject: any) => Promise.resolve({ data: state.response, error: state.error }).then(resolve, reject) } } } }))
import { decodeRead } from '../../src/lib/reads/rpc'
import * as reports from '../../src/lib/reads/reports'
const args = { p_manager_id: null, p_date_from: '2026-10-01', p_date_to: '2026-10-31', p_order_from: '2026-10-01T00:00:00Z', p_order_to: '2026-10-31T23:59:59Z', p_year_month: '2026-10', p_page: 1, p_page_size: 50 }
const performance = () => ({ version: 1, as_of: '2026-11-01T12:00:00Z', page: 1, page_size: 50, total: 0, items: [], summary: { total_visited: 0, total_scheduled: 0, total_orders: 1, total_sales: '75.00', average_visit_rate: 0, unassigned_orders: 1, unassigned_sales: '75.00' } })
beforeEach(() => { state.calls = []; state.error = null; state.response = { version: 1, as_of: '2026-11-01T12:00:00Z', earliest_schedule_date: null, earliest_order_at: '2026-10-03T12:00:00Z' } })
test('validates the explicit Unassigned count and decimal amount without losing the all-order total', () => {
  expect(decodeRead('pilot_sales_performance_v1', args, performance()).summary).toMatchObject({ total_orders: 1, total_sales: '75.00', unassigned_orders: 1, unassigned_sales: '75.00' })
  const invalid = performance(); invalid.summary.unassigned_orders = -1
  expect(() => decodeRead('pilot_sales_performance_v1', args, invalid)).toThrow(/unassigned_orders/)
  const invalidMoney = performance(); invalidMoney.summary.unassigned_sales = 'invalid'
  expect(() => decodeRead('pilot_sales_performance_v1', args, invalidMoney)).toThrow(/unassigned_sales/)
})
test('uses a bounded current-manager RPC for earliest report month with no schedule', async () => {
  expect(reports).toHaveProperty('fetchEarliestSalesPerformanceMonth')
  const fetchMonth = (reports as any).fetchEarliestSalesPerformanceMonth
  expect(await fetchMonth('manager-a', 'sales_manager')).toBe('2026-10')
  expect(state.calls).toEqual([{ name: 'pilot_sales_report_months_v1', args: { p_manager_id: 'manager-a' } }])
})
test('takes the earliest schedule or creation month, retains null for empty authorized data and rejects invalid responses', async () => {
  expect(reports).toHaveProperty('fetchEarliestSalesPerformanceMonth')
  const fetchMonth = (reports as any).fetchEarliestSalesPerformanceMonth
  state.response = { version: 1, as_of: '2026-11-01T12:00:00Z', earliest_schedule_date: '2026-08-01', earliest_order_at: '2026-10-03T12:00:00Z' }
  expect(await fetchMonth('head', 'sales_head')).toBe('2026-08')
  expect(state.calls[0].args).toEqual({ p_manager_id: null })
  state.response = { version: 1, as_of: '2026-11-01T12:00:00Z', earliest_schedule_date: null, earliest_order_at: null }
  expect(await fetchMonth('head', 'sales_head')).toBeNull()
  state.response = { version: 1, as_of: '2026-11-01T12:00:00Z', earliest_schedule_date: '2026-99-01', earliest_order_at: null }
  await expect(fetchMonth('head', 'sales_head')).rejects.toThrow()
  state.error = new Error('Current authority denied')
  await expect(fetchMonth('head', 'sales_head')).rejects.toThrow('Current authority denied')
})

test('an incomplete Unassigned pair is unavailable rather than presented as zero', () => {
  const incomplete = performance() as any
  delete incomplete.summary.unassigned_sales
  expect(() => decodeRead('pilot_sales_performance_v1', args, incomplete)).toThrow(/unassigned/)
})
