import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
vi.mock('../../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../../src/components/TransactionRecovery', () => ({ default: () => null }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u' }, profile: { id: 'u', role: 'executive', is_active: true } }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useBlocker: () => ({ state: 'unblocked' }), useBeforeUnload: () => {} }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { from(table: string) {
  const rows: Record<string, unknown>[] = table === 'products'
    ? [{ id: 'p', name: 'Synthetic product', sku: 'SYN-0', size: null, unit_price: 42, harga_pokok: 0, luar_kota: 0, dalam_kota: 0, depo_bangunan: 0 }]
    : table === 'customers' ? [{ id: 'c', name: 'Synthetic customer', pricing_tier: 'luar_kota' }] : []
  let columns = 'id', from = 0, to = 499
  const q: any = { then: (resolve: any) => Promise.resolve({ data: rows.slice(from, to + 1).map(row => Object.fromEntries(columns.split(',').map(key => key.trim()).map(key => [key, row[key]]))), count: rows.length, error: null }).then(resolve) }
  q.select = (value: string) => { columns = value; return q }
  q.order = q.abortSignal = () => q
  q.range = (a: number, b: number) => { from = a; to = b; return q }
  return q
} } }))
import Promotions from '../../src/pages/athel/Promotions'
import PONew from '../../src/pages/athel/PONew'
afterEach(cleanup)

test('navigating from promotion products to a PO never reuses an incompatible cached projection', async () => {
  // Keep the previous cache fresh to expose a shared-key row-contract collision deterministically.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  try {
    const promo = render(<QueryClientProvider client={client}><Promotions /></QueryClientProvider>)
    await waitFor(() => expect(client.getQueriesData({ queryKey: ['products'] }).some(([, data]) => Array.isArray(data) && data.length === 1)).toBe(true))
    const cached = client.getQueriesData({ queryKey: ['products'] }).find(([, data]) => Array.isArray(data))![1] as any[]
    expect(cached[0]).not.toHaveProperty('unit_price')
    promo.unmount()
    render(<QueryClientProvider client={client}><PONew /></QueryClientProvider>)
    await waitFor(() => expect((screen.getByRole('combobox', { name: 'Pelanggan' }) as HTMLInputElement).disabled).toBe(false))
    fireEvent.change(screen.getByRole('combobox', { name: 'Pelanggan' }), { target: { value: 'Synthetic customer' } })
    fireEvent.click(screen.getByRole('option', { name: 'Synthetic customer' }))
    const lookup = await screen.findByRole('combobox', { name: 'Cari SKU atau nama barang' })
    fireEvent.change(lookup, { target: { value: 'Synthetic product' } })
    fireEvent.click(screen.getByRole('option', { name: /Synthetic product/ }))
    expect((screen.getAllByRole('spinbutton')[1] as HTMLInputElement).value).toBe('0')
  } finally { client.clear() }
})
