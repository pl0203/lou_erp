// @vitest-environment node
import { beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ filters: [] as { table: string; column: string; operator: string; value: string }[] }))
vi.mock('../src/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const fakeFetch: typeof fetch = async input => {
    const url = new URL(String(input)); const table = url.pathname.split('/').pop()!
    for (const [column,value] of url.searchParams) if (['order_date','sj_date','checked_in_at'].includes(column)) state.filters.push({table,column,operator:value.split('.')[0],value:value.slice(value.indexOf('.')+1)})
    const data = table==='customers'?[{id:'c',name:'Dummy',visit_frequency_days:7}]:table==='purchase_orders'?[{id:'p',customer_id:'c',status:'in_progress'}]:[]
    return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}})
  }
  return {supabase:createClient('https://example.invalid','synthetic-test-key',{global:{fetch:fakeFetch},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})}
})
import { fetchCustomerPerformance } from '../src/pages/girard/CustomerPerformance'
beforeEach(()=>{state.filters=[]})
for (const [month,last] of [['2026-09','30'],['2024-02','29'],['2025-02','28'],['2026-12','31']]) test(`${month}: date columns retain entire calendar month across browser timezones`,async()=>{
 await fetchCustomerPerformance('u','executive',month)
 for(const [table,column] of [['purchase_orders','order_date'],['surat_jalan','sj_date']]){
  expect(state.filters).toContainEqual({table,column,operator:'gte',value:`${month}-01`})
  expect(state.filters).toContainEqual({table,column,operator:'lte',value:`${month}-${last}`})
 }
})
test('visit timestamps cover browser-local month using an exclusive next-month boundary',async()=>{
 await fetchCustomerPerformance('u','executive','2026-09')
 expect(state.filters).toContainEqual({table:'outlet_visits',column:'checked_in_at',operator:'gte',value:new Date(2026,8,1).toISOString()})
 expect(state.filters).toContainEqual({table:'outlet_visits',column:'checked_in_at',operator:'lt',value:new Date(2026,9,1).toISOString()})
 expect(state.filters.some(f=>f.column==='checked_in_at'&&f.operator==='lte')).toBe(false)
})
