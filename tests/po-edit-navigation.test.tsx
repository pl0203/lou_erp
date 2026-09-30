import React, { Component } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../src/lib/supabase', () => ({ supabase: {
  rpc: mocks.rpc,
  from: (table: string) => ({ select: (projection: string) => {
    const po = { id: 'dummy-po', po_number: 'DUMMY-PO', status: 'confirm', order_date: '2026-09-30', expected_delivery_date: null, total_value: 20, notes: null, customer_id: 'dummy-customer', customers: { name: 'Dummy customer' }, updated_at: '2026-09-30T00:00:00Z', ...(projection.includes('completed_at') ? { completed_at: null } : {}) }
    const data = table === 'purchase_orders' ? po
      : table === 'po_line_items' ? [{ id: 'dummy-line', product_name: 'Dummy product', sku: 'DUMMY', quantity: 2, unit_price: 10, ...(projection.includes('line_total') ? { line_total: 20 } : {}) }]
      : table === 'customers' ? [{ id: 'dummy-customer', name: 'Dummy customer', pricing_tier: 'luar_kota' }] : []
    const result = Promise.resolve({ data, error: null })
    const query = { eq: () => query, order: () => query, single: () => result, then: result.then.bind(result) }
    return query
  } }),
} }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'dummy-actor' } }) }))
vi.mock('../src/components/AthelNav', () => ({ default: () => null }))
import POEdit from '../src/pages/athel/POEdit'
import PODetail from '../src/pages/athel/PODetail'

class Boundary extends Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <p>Unexpected detail crash</p> : this.props.children }
}
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks() })

test('canceling an invalid edit renders complete detail data without leaking the edit projection into its cache', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/athel/po/dummy-po/edit']}><Boundary><Routes>
    <Route path="/athel/po/:id/edit" element={<POEdit />} />
    <Route path="/athel/po/:id" element={<PODetail />} />
  </Routes></Boundary></MemoryRouter></QueryClientProvider>)
  await screen.findByDisplayValue('Dummy product')
  fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }))
  await screen.findByText('Jumlah barang harus berupa bilangan bulat positif.')
  expect(mocks.rpc).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
  await waitFor(() => expect(screen.getByText('Dummy product')).toBeTruthy())
  expect(screen.queryByText('Unexpected detail crash')).toBeNull()
  expect(client.getQueryData(['po_line_items', 'dummy-po'])).toEqual([expect.objectContaining({ quantity: 2, line_total: 20 })])
  expect(client.getQueryData(['po', 'dummy-po'])).toEqual(expect.objectContaining({ completed_at: null }))
  client.clear()
})
