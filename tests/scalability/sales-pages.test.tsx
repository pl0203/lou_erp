import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ lines: vi.fn(), own: [] as boolean[] }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'user', role: 'sales_person' } }) }))
vi.mock('../../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../../src/components/TransactionRecovery', () => ({ default: () => null }))
vi.mock('../../src/lib/orderTransactions', () => ({ useTransactionSender: () => vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../../src/lib/reads/detailReads', () => ({ fetchSalesOrderLines: (...args: any[]) => state.lines(...args) }))
vi.mock('../../src/lib/reads/orders', () => ({ fetchSalesOrderPage: async (filters: any, page: number) => {
  state.own.push(filters.ownOnly)
  return { version: 1, as_of: '2026-10-01T00:00:00Z', page, page_size: 10, total: 1001, status_counts: { pending: 1001, approved: 0, rejected: 0, cancelled: 0 }, items: [{ id: `order-${page}`, status: 'pending', total_value: '50.00', created_at: '2026-09-30T12:00:00Z', rejection_note: null, customers: { name: `Customer ${page}` }, users: { full_name: 'Sales person' } }] }
} }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { from() { const q: any = { then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve) }; for (const key of ['select','order','eq']) q[key] = () => q; return q } } }))
import SalesOrders from '../../src/pages/athel/SalesOrders'
import MyOrders from '../../src/pages/girard/MyOrders'
const clients: QueryClient[] = []
function mount(Component: typeof MyOrders, initialLines?: any[]) { const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 10000 } } }); clients.push(client); if (initialLines) client.setQueryData(['sales_order_lines', 'order-1'], initialLines); return render(<QueryClientProvider client={client}><Component /></QueryClientProvider>) }
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()) })
beforeEach(() => { state.own = []; state.lines.mockReset().mockResolvedValue([{ id: 'line', order_id: 'order-1', product_name: 'Selected product', sku: null, quantity: 2, unit_price: 25, is_promo: false }]) })
test('personal status pills use full server counts and lines load only when selected', async () => {
  mount(MyOrders)
  await screen.findByText('1001 menunggu')
  expect(state.own).toEqual([true])
  expect(state.lines).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Lihat barang' }))
  await screen.findByText('Selected product')
  expect(state.lines.mock.calls[0][0]).toBe('order-1')
  fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }))
  await screen.findByText('Customer 2')
  expect(screen.queryByText('Customer 1')).toBeNull()
})
test('sales review waits for complete selected lines before enabling approval', async () => {
  let resolve!: (rows: any[]) => void
  state.lines.mockImplementation(() => new Promise(r => { resolve = r }))
  mount(SalesOrders); await screen.findByText('Customer 1')
  expect(state.own).toEqual([false])
  expect(state.lines).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /Setuju/ }))
  await waitFor(() => expect(state.lines).toHaveBeenCalledTimes(1))
  expect(screen.getByRole('button', { name: 'Confirm & Create PO' }).hasAttribute('disabled')).toBe(true)
  await act(async () => resolve([{ id: 'line', order_id: 'order-1', product_name: 'Selected product', sku: null, quantity: 2, unit_price: 25, is_promo: false }]))
  await screen.findByText(/Selected product/)
})

test('cached approval lines remain blocked while their complete refetch is pending', async () => {
  let resolve!: (rows: any[]) => void
  state.lines.mockImplementation(() => new Promise(r => { resolve = r }))
  mount(SalesOrders, [{ id: 'line', order_id: 'order-1', product_name: 'Cached product', sku: null, quantity: 2, unit_price: 25, is_promo: false }])
  await screen.findByText('Customer 1')
  fireEvent.click(screen.getByRole('button', { name: /Setuju/ }))
  await screen.findByText(/Cached product/)
  await waitFor(() => expect(state.lines).toHaveBeenCalledTimes(1))
  expect(screen.getByRole('button', { name: 'Confirm & Create PO' }).hasAttribute('disabled')).toBe(true)
  await act(async () => resolve([{ id: 'line', order_id: 'order-1', product_name: 'Fresh product', sku: null, quantity: 1, unit_price: 50, is_promo: false }]))
  await screen.findByText(/Fresh product/)
  expect(screen.getByRole('button', { name: 'Confirm & Create PO' }).hasAttribute('disabled')).toBe(false)
})
