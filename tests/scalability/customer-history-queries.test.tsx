import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ queries: new Map<string, any>(), urls: [] as URL[] }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useParams: () => ({ id: 'synthetic-customer' }) }))
vi.mock('../../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: any) => { state.queries.set(options.queryKey[0], options.queryFn); return { isLoading: true } } }))
vi.mock('../../src/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabase: createClient('https://example.invalid', 'synthetic-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async input => { state.urls.push(new URL(String(input))); return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }) } },
  }) }
})
import CustomerDetail from '../../src/pages/girard/GirardCustomerDetail'
afterEach(() => { cleanup(); state.urls = []; state.queries.clear() })
for (const [key, order, limit] of [['visit_history', 'checked_in_at.desc,id.desc', '10'], ['order_history', 'order_date.desc,id.desc', '20']] as const) test(`${key} keeps its intentional bound and adds a deterministic tie-breaker`, async () => {
  render(<CustomerDetail />)
  await state.queries.get(key)()
  expect(state.urls).toHaveLength(1)
  expect(state.urls[0].searchParams.get('order')).toBe(order)
  expect(state.urls[0].searchParams.get('limit')).toBe(limit)
})
