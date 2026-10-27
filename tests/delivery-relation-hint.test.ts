import { beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ paths: [] as string[] }))
vi.mock('../src/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const fakeFetch: typeof fetch = async (input, init) => {
    const name = new URL(String(input)).pathname.split('/').pop()!
    state.paths.push(name)
    const args = JSON.parse(String(init?.body))
    const total_sales = (2 * 15 + 1 * 0).toFixed(2)
    const row = { id: 'c', name: 'Dummy', manager_name: null, actual_visits: 0, target_visits: 4, last_visit_date: null, order_count: 1, total_sales, sales_target: null }
    const data = name === 'pilot_customer_stats_v1'
      ? { version: 1, as_of: '2026-10-01T00:00:00Z', items: [{ customer_id: 'c', first_order_date: '2026-09-01', order_count: 1, total_sales, top_items: [] }] }
      : { version: 1, as_of: '2026-10-01T00:00:00Z', items: [row], total: 1, page: args.p_page, page_size: args.p_page_size, summary: { total_sales, active_customers: 1, total_customers: 1, total_visits: 0, total_target_visits: 4, visit_percent: 0, top_customer: row } }
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return { supabase: createClient('https://example.invalid','synthetic-test-key',{ global:{fetch:fakeFetch},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false} }) }
})
import { fetchCustomerStatsBatch, fetchCustomerStatsDetail } from '../src/lib/CustomerStats'
import { fetchCustomerPerformance } from '../src/pages/girard/CustomerPerformance'
beforeEach(() => { state.paths = [] })
// The ambiguous PostgREST embedding is removed entirely. Exact FK joins and
// void filtering now live in the independently exercised invoker SQL functions.
for (const mode of ['batch','detail','performance']) test(`${mode}: aggregate read avoids ambiguous delivery embedding and preserves zero-price sales`, async () => {
 const total = mode === 'batch' ? (await fetchCustomerStatsBatch(['c']))[0].total_sales : mode === 'detail' ? (await fetchCustomerStatsDetail('c')).total_sales_3mo : (await fetchCustomerPerformance('u','executive','2026-09')).items[0].total_sales
 expect(state.paths).toEqual([mode === 'performance' ? 'pilot_customer_performance_v1' : 'pilot_customer_stats_v1'])
 expect(total).toBe('30.00')
})
