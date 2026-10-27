import { beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ results: {} as Record<string, { data: any[]; error: unknown }> }))
// The raw-history calculation now lives in SQL. This small transport fixture
// retains the original zero/void/delivered examples and feeds the aggregate wire.
vi.mock('../src/lib/supabase', () => ({ supabase: { rpc(_name: string, args: any) {
  const error = Object.values(state.results).find(result => result.error)?.error ?? null
  const items = args.p_customer_ids.map((customer_id: string) => {
    const pos = state.results.purchase_orders.data.filter(po => po.customer_id === customer_id)
    const delivered = state.results.surat_jalan.data.filter(sj => !sj.voided_at && pos.some(po => po.id === sj.purchase_order_id && ['in_progress','complete'].includes(po.status)))
      .flatMap(sj => sj.sj_line_items).reduce((sum, line) => sum + line.quantity_delivered * line.po_line_items.unit_price, 0)
    return { customer_id, first_order_date: pos[0]?.order_date ?? null, order_count: pos.length, total_sales: delivered.toFixed(2), top_items: [] }
  })
  const result = { data: { version: 1, as_of: '2026-10-01T00:00:00Z', items }, error }
  return { then: (resolve: any) => Promise.resolve(result).then(resolve) }
} } }))
import { fetchCustomerStatsBatch, fetchCustomerStatsDetail } from '../src/lib/CustomerStats'
beforeEach(() => { state.results = {
  purchase_orders: { data: [{ id: 'p', customer_id: 'c', status: 'in_progress', order_date: new Date().toISOString().slice(0,10), total_value: 100 }], error: null },
  po_line_items: { data: [{ purchase_order_id: 'p', product_name: 'Product', quantity: 1, unit_price: 100 }], error: null },
  surat_jalan: { data: [], error: null },
} })
for (const mode of ['batch','detail']) {
 const run = () => mode === 'batch' ? fetchCustomerStatsBatch(['c']) : fetchCustomerStatsDetail('c')
 test(`${mode}: no deliveries is zero sales, not full PO value`, async () => { const result: any = await run(); expect(mode === 'batch' ? result[0].total_sales : result.total_sales_3mo).toBe('0.00') })
 for (const table of ['surat_jalan','po_line_items']) test(`${mode}: propagates ${table} aggregate read failure`, async () => { state.results[table].error = new Error('read failed'); await expect(run()).rejects.toThrow('read failed') })
 test(`${mode}: preserves actual delivered sales and zero-price items`, async () => {
  state.results.surat_jalan.data = [{ purchase_order_id: 'p', sj_line_items: [{ quantity_delivered: 2, po_line_items: { unit_price: 15 } }, { quantity_delivered: 1, po_line_items: { unit_price: 0 } }] }]
  const result: any = await run(); expect(mode === 'batch' ? result[0].total_sales : result.total_sales_3mo).toBe('30.00')
 })
}
test('voided deliveries do not contribute to customer sales', async () => {
 state.results.surat_jalan.data = [{ purchase_order_id: 'p', voided_at: '2026-09-30', sj_line_items: [{ quantity_delivered: 4, po_line_items: { unit_price: 50 } }] }]
 expect((await fetchCustomerStatsBatch(['c']))[0].total_sales).toBe('0.00'); expect((await fetchCustomerStatsDetail('c')).total_sales_3mo).toBe('0.00')
})
