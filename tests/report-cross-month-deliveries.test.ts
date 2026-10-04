// @vitest-environment node
import { beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ failEligible: false }))
vi.mock('../src/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const fakeFetch: typeof fetch = async (_input, init) => {
    if (state.failEligible) return new Response(JSON.stringify({ message: 'eligible orders unavailable', code: 'XX000' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    const args = JSON.parse(String(init?.body))
    const orders = [{ order_date: '2026-08-15' }, { order_date: '2026-09-15' }]
    const deliveries = [{ date: '2026-09-01', quantity: 2 }, { date: '2026-09-30', quantity: 3 }, { date: '2026-10-01', quantity: 4 }, { date: '2026-09-10', quantity: 5, voided: true }]
    const order_count = orders.filter(order => order.order_date.startsWith(args.p_year_month)).length
    const total_sales = deliveries.filter(delivery => !delivery.voided && delivery.date.startsWith(args.p_year_month)).reduce((sum, delivery) => sum + delivery.quantity * 10, 0).toFixed(2)
    const row = { id: 'c', name: 'Dummy', manager_name: null, actual_visits: 0, target_visits: 4, last_visit_date: null, order_count, total_sales, sales_target: null }
    const response = { version: 1, as_of: '2026-10-01T00:00:00Z', items: [row], total: 1, page: args.p_page, page_size: args.p_page_size, summary: { total_sales, active_customers: 1, total_customers: 1, total_visits: 0, total_target_visits: 4, visit_percent: 0, top_customer: row } }
    return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return { supabase: createClient('https://example.invalid', 'synthetic-test-key', { global: { fetch: fakeFetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) }
})
import { fetchCustomerPerformance } from '../src/pages/girard/CustomerPerformance'
beforeEach(() => { state.failEligible = false })
test('monthly delivered sales include earlier orders while order count remains creation-month based', async () => {
 const { items: [row] } = await fetchCustomerPerformance('u','executive','2026-09')
 expect(row.order_count).toBe(1); expect(row.total_sales).toBe('50.00')
})
test('eligible delivery-order read failure propagates instead of reporting zero sales', async () => {
 state.failEligible = true
 await expect(fetchCustomerPerformance('u','executive','2026-09')).rejects.toMatchObject({ message: 'eligible orders unavailable' })
})
