import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ requests: [] as { url: URL; body: any }[] }))
vi.mock('../../src/lib/procurementAccess', () => ({ useProcurementAccess: () => ({ ready: false, capabilities: {}, require: () => {} }) }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: '11111111-1111-4111-8111-111111111111' }, profile: { id: '11111111-1111-4111-8111-111111111111', role: 'sales_person', is_active: true }, loading: false, error: null }) }))
vi.mock('../../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../../src/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabase: createClient('https://example.invalid', 'synthetic-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const body = JSON.parse(String(init?.body)), url = new URL(String(input)); state.requests.push({ url, body })
      return new Response(JSON.stringify({ version: 1, actor_id: '11111111-1111-4111-8111-111111111111', role: 'sales_person', kind: body.p_kind,
        purpose: body.p_purpose, status: body.p_status, search: body.p_search, page: body.p_page, page_size: body.p_page_size, total_count: '0', rows: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    } },
  }) }
})
import CustomerList from '../../src/pages/athel/CustomerList'
import ProductList from '../../src/pages/athel/ProductList'
let client: QueryClient
beforeEach(() => { state.requests = []; client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }) })
afterEach(() => { cleanup(); client.clear() })
for (const [kind, Page] of [['customer', CustomerList], ['product', ProductList]] as const) test(`${kind} page passes literal search and stable catalogue contract to the validated RPC`, async () => {
  render(<QueryClientProvider client={client}><Page /></QueryClientProvider>)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a%,x*"' } })
  await waitFor(() => expect(state.requests.some(request => request.body.p_search === 'a%,x*"')).toBe(true))
  const request = state.requests.at(-1)!
  expect(request.url.pathname).toBe('/rest/v1/rpc/pilot_catalog_page_v1')
  expect(request.url.searchParams.has('or')).toBe(false)
  expect(request.body).toEqual({ p_kind: kind, p_purpose: 'catalogue', p_status: 'all', p_search: 'a%,x*"', p_page: 1, p_page_size: 10 })
  expect(screen.getByText(kind === 'customer' ? '0 pelanggan' : '0 barang')).toBeTruthy()
})
