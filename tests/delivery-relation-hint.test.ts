import { beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ selects: [] as string[] }))
vi.mock('../src/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const fakeFetch: typeof fetch = async (input) => {
    const url = new URL(String(input))
    const table = url.pathname.split('/').pop()
    if (table === 'surat_jalan') state.selects.push(url.searchParams.get('select') ?? '')
    const data = table === 'customers' ? [{id:'c',name:'Dummy',visit_frequency_days:7}]
      : table === 'purchase_orders' ? [{id:'p',customer_id:'c',status:'in_progress',order_date:'2026-09-01',total_value:999}]
      : table === 'po_line_items' ? [{purchase_order_id:'p',product_name:'Dummy',quantity:2,unit_price:15}]
      : table === 'surat_jalan' ? [{purchase_order_id:'p',sj_date:'2026-09-02',sj_line_items:[{quantity_delivered:2,po_line_items:{unit_price:15}},{quantity_delivered:1,po_line_items:{unit_price:0}}]}]
      : []
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type':'application/json' } })
  }
  return {supabase:createClient('https://example.invalid','synthetic-test-key',{global:{fetch:fakeFetch},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})}
})
import { fetchCustomerStatsBatch, fetchCustomerStatsDetail } from '../src/lib/CustomerStats'
import { fetchCustomerPerformance } from '../src/pages/girard/CustomerPerformance'
beforeEach(()=>{state.selects=[]})

for (const mode of ['batch','detail','performance']) test(`${mode}: delivery price embed uses exact FK and keeps response shape/zero promo semantics`,async()=>{
 const total=mode==='batch'?(await fetchCustomerStatsBatch(['c']))[0].total_sales
   :mode==='detail'?(await fetchCustomerStatsDetail('c')).total_sales_3mo
   :(await fetchCustomerPerformance('u','executive','2026-09'))[0].total_sales
 expect(state.selects).toHaveLength(1)
 expect(state.selects[0]).toContain('po_line_items!sj_line_items_po_line_item_id_fkey(unit_price)')
 expect(total).toBe(30)
})
