import { beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ reply: undefined as any, signal: undefined as AbortSignal | undefined }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: () => {
  const request: any = { abortSignal: (signal: AbortSignal) => { state.signal = signal; return request }, then: (resolve: any) => Promise.resolve(state.reply).then(resolve) }
  return request
} } }))
import { callRead, decodeRead } from '../../src/lib/reads/rpc'
const args = { p_status: 'all' as const, p_search: '', p_page: 1, p_page_size: 10 }
const row = { id: 'po', customer_id: 'customer', po_number: 'PO-1', status: 'confirm', order_date: '2026-09-30', expected_delivery_date: null, total_value: '9007199254740993.125', customers: null }
const valid = () => ({ version: 1, as_of: '2026-10-01T00:00:00Z', items: [row], total: 1, page: 1, page_size: 10 })
beforeEach(() => { state.reply = { data: valid(), error: null }; state.signal = undefined })
test('decodes a valid nullable relation and preserves exact money text', async () => {
  const response = await callRead('pilot_po_page_v1', args)
  expect(response.items[0].total_value).toBe('9007199254740993.125')
  expect(response.items[0].customers).toBeNull()
})
for (const [name, mutate] of [
  ['missing version', (page: any) => { delete page.version }],
  ['invalid snapshot', (page: any) => { page.as_of = 'unknown' }],
  ['unsafe count', (page: any) => { page.total = Number.MAX_SAFE_INTEGER + 1 }],
  ['missing count', (page: any) => { delete page.total }],
  ['truncated page', (page: any) => { page.total = 1001 }],
  ['wrong requested page', (page: any) => { page.page = 2 }],
  ['wrong page size', (page: any) => { page.page_size = 100 }],
  ['rolled-over date', (page: any) => { page.items = [{ ...row, order_date: '2026-02-31' }] }],
  ['numeric money', (page: any) => { page.items = [{ ...row, total_value: 50000 }] }],
  ['malformed money', (page: any) => { page.items = [{ ...row, total_value: 'Infinity' }] }],
  ['missing relation', (page: any) => { page.items = [{ ...row }]; delete page.items[0].customers }],
  ['duplicate row', (page: any) => { page.total = 2; page.items = [row, row] }],
] as const) test(`rejects ${name} rather than exposing successful partial data`, () => {
  const page = valid(); mutate(page)
  expect(() => decodeRead('pilot_po_page_v1', args, page)).toThrow()
})
test('propagates unavailable functions and request cancellation without a raw-table fallback', async () => {
  state.reply = { data: null, error: { message: 'Endpoint unavailable', code: 'PGRST202' } }
  await expect(callRead('pilot_po_page_v1', args)).rejects.toMatchObject({ code: 'PGRST202' })
  const abort = new AbortController(); abort.abort()
  await expect(callRead('pilot_po_page_v1', args, abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
})

test('rejects malformed calendar month keys in summaries', async () => {
  const { emptyDashboardSummary } = await import('./fixtures')
  const summary = emptyDashboardSummary()
  summary.monthlySeries[0].key = '2026-99'
  expect(() => decodeRead('pilot_athel_summary_v1', { p_from: '2026-10-01', p_to: '2026-10-01', p_rolling_from: '2025-11-01', p_status: 'all', p_fulfillment: 'all' }, summary)).toThrow()
})

test('stale PO line RPC maps PT409 to an actionable conflict while preserving its code', async () => {
  state.reply = { data: null, error: { code: 'PT409', message: 'PO changed; refresh before continuing' } }
  await expect(callRead('pilot_po_lines_v1', { p_po_id: 'po', p_page: 1, p_page_size: 100, p_expected_updated_at: '2026-10-01T00:00:00Z' })).rejects.toMatchObject({ code: 'PT409', message: 'PO berubah. Muat ulang sebelum melanjutkan.' })
})
