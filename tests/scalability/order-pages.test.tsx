import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({ handler: null as null | ((name: string, args: any, signal?: AbortSignal) => Promise<any>), calls: [] as any[] }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'viewer', role: 'admin' } }) }))
vi.mock('../../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../../src/lib/supabase', () => ({ supabase: {
  rpc(name: string, args: any) {
    let signal: AbortSignal | undefined
    const request: any = { abortSignal: (value: AbortSignal) => { signal = value; return request }, then: (resolve: any, reject: any) => { state.calls.push({ name, args, signal }); return state.handler!(name, args, signal).then(resolve, reject) } }
    return request
  },
  from() {
    const q: any = { then: (resolve: any) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve) }
    for (const key of ['select','order','range','eq','ilike','limit','or']) q[key] = () => q
    return q
  },
} }))
import POList from '../../src/pages/athel/POList'
const clients: QueryClient[] = []
const po = (id: number, label = 'Customer') => ({ id: `po-${id}`, po_number: `PO-${id}`, status: 'confirm', order_date: '2026-09-01', expected_delivery_date: null, total_value: '50000.00', customer_id: `c-${id}`, created_at: '2026-09-01T00:00:00Z', customers: { name: label } })
function page(args: any, total = 101, label = 'Customer') {
  return { data: { version: 1, as_of: '2026-10-01T00:00:00Z', page: args.p_page, page_size: args.p_page_size, total, items: Array.from({ length: Math.min(10, Math.max(0, total - (args.p_page - 1) * 10)) }, (_, i) => po((args.p_page - 1) * 10 + i + 1, label)) }, error: null }
}
function mount() { const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); clients.push(client); return render(<QueryClientProvider client={client}><MemoryRouter><POList /></MemoryRouter></QueryClientProvider>) }
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.useRealTimers() })
beforeEach(() => { state.calls = []; state.handler = async (_name, args) => page(args) })

test('shows exact matches beyond the old 100 lookup limit in ten-row pages', async () => {
  mount()
  await screen.findByText('101 pesanan')
  expect(screen.getAllByText('PO-10')).toHaveLength(2)
  expect(screen.queryByText('PO-11')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }))
  await screen.findAllByText('PO-11')
  expect(screen.queryByText('PO-1')).toBeNull()
  expect(screen.getByText(/11–20 dari 101/)).toBeTruthy()
})
test('keeps the displayed page truthful while the next page is pending', async () => {
  let resolve!: (value: any) => void
  state.handler = async (_name, args) => args.p_page === 2 ? new Promise(r => { resolve = r }) : page(args)
  mount(); await screen.findByText('101 pesanan')
  fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }))
  await screen.findByRole('status')
  expect(screen.getByRole('button', { name: 'Berikutnya' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getAllByText('PO-1')).toHaveLength(2)
  expect(screen.getByText(/1–10 dari 101/)).toBeTruthy()
  expect(screen.queryByText(/11–20 dari 101/)).toBeNull()
  await act(async () => resolve(page({ p_page: 2, p_page_size: 10 })))
  await screen.findAllByText('PO-11')
})
test('debounces literal search locally and atomically resets the page', async () => {
  mount(); await screen.findByText('101 pesanan')
  fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' })); await screen.findAllByText('PO-11')
  const search = screen.getByPlaceholderText('Cari nomor PO, pelanggan, atau SJ...')
  fireEvent.change(search, { target: { value: "50%_, 'quoted'\\" } })
  expect(state.calls).toHaveLength(2)
  await waitFor(() => expect(state.calls.length).toBe(3))
  expect(state.calls[2].args).toMatchObject({ p_search: "50%_, 'quoted'\\", p_page: 1, p_page_size: 10 })
  await screen.findAllByText('PO-1')
})
test('missing RPC shows a retryable error rather than falling back to truncated rows', async () => {
  state.handler = async () => ({ data: null, error: { message: 'Function unavailable', code: 'PGRST202' } })
  mount()
  await screen.findByRole('alert')
  expect(screen.queryByText('0 pesanan')).toBeNull()
  state.handler = async (_name, args) => page(args)
  fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
  await screen.findByText('101 pesanan')
})
