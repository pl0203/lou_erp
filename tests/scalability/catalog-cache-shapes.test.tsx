import { beforeEach } from 'vitest'
import { transferableAbortController } from 'node:util'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
const catalogue = vi.hoisted(() => ({
  actorId: '00000000-0000-4000-8000-000000000002',
  customer: { id: '00000000-0000-4000-8000-000000000010', name: 'Synthetic customer', address: null, city: null, phone: null, email: null, pricing_tier: 'luar_kota', customer_category: null, is_enabled: true, catalog_version: '1' },
  product: { id: '00000000-0000-4000-8000-000000000020', name: 'Synthetic product', sku: 'SYN-0', size: null, unit_price: 42, harga_pokok: 0, luar_kota: 0, dalam_kota: 0, depo_bangunan: 0, is_enabled: true, catalog_version: '1' },
}))
vi.mock('../../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../../src/components/TransactionRecovery', () => ({ default: () => null }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: catalogue.actorId }, profile: { id: catalogue.actorId, role: 'executive', is_active: true }, loading: false, error: null }) }))
vi.mock('../../src/lib/supabase', () => ({ supabase: {
  supabaseUrl: 'https://catalogue.test', rest: { url: 'https://catalogue.test/rest/v1', schemaName: 'public' },
  rpc(name: string, args: any) {
    const q: any = { abortSignal: () => q, then: (resolve: any, reject: any) => Promise.resolve().then(() => {
      if (name === 'pilot_promotions_v1') return { data: { version: 1, as_of: '2026-10-01T00:00:00Z', items: [] }, error: null }
      if (name !== 'pilot_catalog_page_v1') throw new Error(`Unexpected RPC: ${name}`)
      const rows = args.p_kind === 'customer' ? [catalogue.customer] : [catalogue.product]
      return { data: { version: 1, actor_id: catalogue.actorId, role: 'executive', kind: args.p_kind, purpose: args.p_purpose, status: args.p_status, search: args.p_search, page: args.p_page, page_size: args.p_page_size, total_count: String(rows.length), rows: rows.slice((args.p_page - 1) * args.p_page_size, args.p_page * args.p_page_size) }, error: null }
    }).then(resolve, reject) }
    return q
  },
  from(table: string) {
  const rows: Record<string, unknown>[] = table === 'products'
    ? [catalogue.product] : table === 'customers' ? [catalogue.customer] : []
  let columns = 'id', from = 0, to = 499
  const q: any = { then: (resolve: any) => Promise.resolve({ data: rows.slice(from, to + 1).map(row => Object.fromEntries(columns.split(',').map(key => key.trim()).map(key => [key, row[key]]))), count: rows.length, error: null }).then(resolve) }
  q.select = (value: string) => { columns = value; return q }
  q.order = q.abortSignal = () => q
  q.range = (a: number, b: number) => { from = a; to = b; return q }
  return q
} } }))
import Promotions from '../../src/pages/athel/Promotions'
import PONew from '../../src/pages/athel/PONew'
const routers: ReturnType<typeof createMemoryRouter>[] = []
afterEach(() => { cleanup(); vi.unstubAllGlobals(); routers.splice(0).forEach(router => router.dispose()) })

test('navigating from promotion products to a PO never reuses an incompatible cached projection', async () => {
  // Keep the previous cache fresh to expose a shared-key row-contract collision deterministically.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  try {
    const promo = mount(client, false)
    await waitFor(() => expect(client.getQueriesData({ queryKey: ['products'] }).some(([, data]) => Array.isArray(data) && data.length === 1)).toBe(true))
    const cached = client.getQueriesData({ queryKey: ['products'] }).find(([, data]) => Array.isArray(data))![1] as any[]
    expect(cached[0]).not.toHaveProperty('unit_price')
    promo.unmount()
    mount(client, true)
    await waitFor(() => expect((screen.getByRole('combobox', { name: 'Pelanggan' }) as HTMLInputElement).disabled).toBe(false))
    fireEvent.change(screen.getByRole('combobox', { name: 'Pelanggan' }), { target: { value: 'Synthetic customer' } })
    fireEvent.click(screen.getByRole('option', { name: 'Synthetic customer' }))
    const lookup = await screen.findByRole('combobox', { name: 'Cari SKU atau nama barang' })
    fireEvent.change(lookup, { target: { value: 'Synthetic product' } })
    fireEvent.click(screen.getByRole('option', { name: /Synthetic product/ }))
    expect((screen.getAllByRole('spinbutton')[1] as HTMLInputElement).value).toBe('0')
    const canonical = client.getQueriesData({ queryKey: ['catalogue', 'https://catalogue.test', catalogue.actorId, 'executive', 1, 'read', 'product', 'enabled-for-order'] })
    expect(canonical).toHaveLength(1)
    expect((canonical[0][1] as { rows: unknown[] }).rows).toEqual([catalogue.product])
    expect(client.getQueriesData({ queryKey: ['products'] }).find(([, data]) => Array.isArray(data))![1]).toEqual(cached)
  } finally { client.clear() }
})

// Real router navigation requires Node-compatible Request signals in jsdom.
beforeEach(() => { vi.stubGlobal('AbortController', class { constructor() { return transferableAbortController() } }) })

function mount(client: QueryClient, po: boolean) { const router = createMemoryRouter([{ path: po ? '/athel/po/new' : '/athel/promotions', element: po ? <PONew /> : <Promotions /> }, { path: '*', element: <p>Destination</p> }], { initialEntries: [po ? '/athel/po/new' : '/athel/promotions'] }); routers.push(router); return render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>) }
