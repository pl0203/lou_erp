import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
vi.mock('../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../src/lib/supabase', () => ({ supabase: {} }))
import GirardCustomers from '../src/pages/girard/GirardCustomers'
const clients: QueryClient[] = []
function DetailDestination() { const { id } = useParams(); return <h1>Customer detail {id}</h1> }
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } }); clients.push(client)
  client.setQueryData(['all_customers'], [{ id: 'customer-a', name: 'Example Customer', address: null, city: 'Example City', phone: null, email: null, visit_frequency_days: 7, last_visit_date: null, pricing_tier: 'luar_kota', customer_category: null }])
  client.setQueryData(['managers_list'], [])
  client.setQueryData(['assignments'], [])
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/girard/customers']}><Routes>
    <Route path="/girard/customers" element={<GirardCustomers />} />
    <Route path="/girard/customer/:id" element={<DetailDestination />} />
  </Routes></MemoryRouter></QueryClientProvider>)
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()) })
for (const [layout, index] of [['desktop', 0], ['mobile', 1]] as const) {
  test(`${layout} customer name is a focusable semantic link to its existing detail route`, () => {
    mount()
    const links = screen.getAllByRole('link', { name: 'Example Customer' })
    expect(links).toHaveLength(2)
    const link = links[index]
    expect(link.getAttribute('href')).toBe('/girard/customer/customer-a')
    link.focus(); expect(document.activeElement).toBe(link)
    fireEvent.click(link)
    expect(screen.getByRole('heading', { name: 'Customer detail customer-a' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Ubah Penugasan Pelanggan' })).toBeNull()
  })
}
test('assignment edit remains a separate action rather than a nested part of the detail link', () => {
  mount()
  for (const button of screen.getAllByRole('button', { name: 'Ubah' })) expect(button.closest('a')).toBeNull()
  fireEvent.click(screen.getAllByRole('button', { name: 'Ubah' })[0])
  expect(screen.getByRole('heading', { name: 'Ubah Penugasan Pelanggan' })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Customer detail customer-a' })).toBeNull()
})
