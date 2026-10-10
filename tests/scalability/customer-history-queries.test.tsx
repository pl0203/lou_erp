import { afterEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ urls: [] as URL[], headers: [] as Headers[], response: [] as any[], count: 0, error: false }))
vi.mock('../../src/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabase: createClient('https://example.invalid', 'synthetic-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      state.urls.push(new URL(String(input))); state.headers.push(new Headers(init?.headers))
      return new Response(JSON.stringify(state.error ? { message: 'read failed' } : state.response), {
        status: state.error ? 500 : 200, headers: { 'Content-Type': 'application/json', 'Content-Range': `0-${Math.max(0, state.response.length - 1)}/${state.count}` },
      })
    } },
  }) }
})
import { fetchCustomerOrderPage, fetchCustomerVisitPage, fetchNextCustomerSchedule, fetchVisitEvidence, fetchCustomerDetail } from '../../src/lib/reads/customerDetailReads'
afterEach(() => { state.urls = []; state.headers = []; state.response = []; state.count = 0; state.error = false })
for (const [fetcher, table, filter, order, size] of [
  [fetchCustomerVisitPage, 'outlet_visits', 'outlet_id', 'checked_in_at.desc,id.desc', 10],
  [fetchCustomerOrderPage, 'purchase_orders', 'customer_id', 'order_date.desc,id.desc', 20],
] as const) {
  test(`${table} keeps customer scope and deterministic ordering on subsequent exact-count pages`, async () => {
    const result = await fetcher({ customerId: 'synthetic-customer' }, 2)
    expect(state.urls).toHaveLength(1)
    const query = state.urls[0].searchParams
    expect(query.get(filter)).toBe('eq.synthetic-customer'); expect(query.get('order')).toBe(order)
    expect(query.get('offset')).toBe(String(size)); expect(query.get('limit')).toBe(String(size))
    expect(state.headers[0].get('prefer')).toContain('count=exact')
    expect(result).toEqual({ items: [], total: 0, page: 2, page_size: size })
    expect(query.get('select')).not.toMatch(/visit_photos|surat_jalan|notes/)
  })
  test(`${table} rejects a truncated or duplicate page instead of declaring it complete`, async () => {
    state.count = size + 1; state.response = [{ id: 'only-one' }]
    await expect(fetcher({ customerId: 'c' }, 1)).rejects.toThrow(/lengkap/)
    state.response = Array.from({ length: size }, () => ({ id: 'duplicate' }))
    await expect(fetcher({ customerId: 'c' }, 1)).rejects.toThrow(/lengkap/)
  })
  test(`${table} refuses invalid page numbers before sending a request`, async () => {
    for (const page of [0, -1, 1.5, Number.MAX_SAFE_INTEGER]) await expect(fetcher({ customerId: 'c' }, page)).rejects.toThrow()
    expect(state.urls).toEqual([])
  })
}
test('next visit only queries pending schedules on/after the local calendar date with a stable limit', async () => {
  state.response = [{ id: 's', scheduled_date: '2026-10-05', notes: 'Schedule note', users: [{ full_name: 'Rep' }] }]
  const result = await fetchNextCustomerSchedule('c', '2026-10-02')
  expect(result?.users?.full_name).toBe('Rep')
  const query = state.urls[0].searchParams
  expect(query.get('outlet_id')).toBe('eq.c'); expect(query.get('status')).toBe('eq.pending')
  expect(query.get('scheduled_date')).toBe('gte.2026-10-02'); expect(query.get('order')).toBe('scheduled_date.asc,id.asc')
  expect(query.get('limit')).toBe('1')
})
test('visit evidence filters both the requested visit and its customer and does not query other personal fields', async () => {
  expect(await fetchVisitEvidence('c', 'v')).toBeNull()
  const query = state.urls[0].searchParams
  expect(query.get('outlet_id')).toBe('eq.c'); expect(query.get('id')).toBe('eq.v')
  expect(query.get('select')).toBe('id,notes,visit_photos(id,storage_path,taken_at)')
})
test('missing customer is indistinguishable from inaccessible customer while read errors remain errors', async () => {
  expect(await fetchCustomerDetail('c')).toBeNull()
  state.error = true
  await expect(fetchCustomerDetail('c')).rejects.toHaveProperty('message', 'read failed')
})
test('a missing exact count is rejected', async () => {
  state.count = Number.NaN
  await expect(fetchCustomerOrderPage({ customerId: 'c' }, 1)).rejects.toThrow(/lengkap/)
})
