import { beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ results: {} as Record<string, { data: unknown; error: unknown }> }))
vi.mock('../src/lib/supabase', () => ({ supabase: { from(table: string) {
  const q: any = { then: (resolve: any) => Promise.resolve(state.results[table]).then(resolve) }
  for (const m of ['select','in','eq','gte','order']) q[m] = () => q
  return q
} } }))
import { fetchCustomerStatsBatch, fetchCustomerStatsDetail } from '../src/lib/CustomerStats'
beforeEach(() => {
 state.results = {
  purchase_orders: { data: [{id:'p',customer_id:'c',status:'in_progress',order_date:new Date().toISOString().slice(0,10),total_value:100}], error:null },
  po_line_items: { data: [{purchase_order_id:'p',product_name:'Product',quantity:1,unit_price:100}], error:null },
  surat_jalan: { data: [], error:null },
 }
})
for (const mode of ['batch','detail']) {
 const run = () => mode === 'batch' ? fetchCustomerStatsBatch(['c']) : fetchCustomerStatsDetail('c')
 test(`${mode}: no deliveries is zero sales, not full PO value`, async () => {
  const result: any = await run()
  expect(mode === 'batch' ? result[0].total_sales : result.total_sales_3mo).toBe(0)
 })
 for (const table of ['surat_jalan','po_line_items']) test(`${mode}: propagates ${table} read failure`, async () => {
  state.results[table] = {data:null,error:new Error('read failed')}
  await expect(run()).rejects.toThrow('read failed')
 })
 test(`${mode}: sums actual deliveries`, async () => {
  state.results.surat_jalan.data = [{purchase_order_id:'p',sj_line_items:[{quantity_delivered:2,po_line_items:{unit_price:15}},{quantity_delivered:1,po_line_items:{unit_price:0}}]}]
  const result: any = await run()
  expect(mode === 'batch' ? result[0].total_sales : result.total_sales_3mo).toBe(30)
 })
}
