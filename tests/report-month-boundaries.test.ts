// @vitest-environment node
import { beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ args: [] as any[] }))
vi.mock('../src/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const fakeFetch: typeof fetch = async (_input, init) => {
    const args = JSON.parse(String(init?.body)); state.args.push(args)
    const result = { version: 1, as_of: '2026-10-01T00:00:00Z', items: [], total: 0, page: args.p_page, page_size: args.p_page_size, summary: { total_sales: '0', active_customers: 0, total_customers: 0, total_visits: 0, total_target_visits: 0, visit_percent: 0, top_customer: null } }
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return { supabase: createClient('https://example.invalid', 'synthetic-test-key', { global: { fetch: fakeFetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) }
})
import { fetchCustomerPerformance } from '../src/pages/girard/CustomerPerformance'
beforeEach(() => { state.args = [] })
// The calendar month now crosses the wire directly; PostgreSQL owns inclusive
// DATE bounds and is independently checked in scalable-report-reads.sql.
for (const month of ['2026-09','2024-02','2025-02','2026-12']) test(`${month}: date columns retain the requested calendar month across browser timezones`, async () => {
  await fetchCustomerPerformance('u', 'executive', month)
  expect(state.args[0].p_year_month).toBe(month)
})
test('visit timestamps cover browser-local month using an exclusive next-month boundary', async () => {
  await fetchCustomerPerformance('u', 'executive', '2026-09')
  expect(state.args[0].p_visit_from).toBe(new Date(2026,8,1).toISOString())
  expect(state.args[0].p_visit_until).toBe(new Date(2026,9,1).toISOString())
  expect(state.args[0].p_manager_id).toBeNull()
})
