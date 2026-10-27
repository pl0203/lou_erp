import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import Dashboard from '../../src/pages/athel/Dashboard'
import POList from '../../src/pages/athel/POList'
const mocks = vi.hoisted(() => ({ dashboard: vi.fn(), orders: vi.fn(), signedOut: false, profile: { id: 'a', role: 'procurement', is_active: true } }))
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: mocks.signedOut ? null : mocks.profile }) }))
vi.mock('../../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../../src/components/athel/DashboardCharts', () => ({ default: () => <div>Charts</div> }))
vi.mock('../../src/lib/reads/reports', async importOriginal => ({ ...await importOriginal<object>(), fetchDashboardData: mocks.dashboard }))
vi.mock('../../src/lib/reads/orders', () => ({ fetchPOPage: mocks.orders }))
const clients: QueryClient[] = []
afterEach(() => { cleanup(); clients.forEach(c => c.clear()); clients.length = 0; vi.clearAllMocks(); mocks.profile.id = 'a'; mocks.profile.role = 'procurement'; mocks.signedOut = false })
function deferred<T>() { let resolve!: (v: T) => void; let reject!: (v: Error) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j }); return { promise, resolve, reject } }
const dashboard = { monthlySeries: [], dailySeries: [], statusBreakdown: [], topCustomers: [], outstandingItems: [], customerShare: [], metrics: { totalPOValue: '120000', totalPOCount: 2, deliveredValue: '0', outstandingValue: '30000', averagePOValue: '60000', completedPOCount: 0 } }
const orders = { page: 1, page_size: 50, total: 0, items: [] }
function mount(node: React.ReactNode) { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client); return render(<QueryClientProvider client={client}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>) }
test('dashboard reserves summary and charts while initially loading', () => {
  mocks.dashboard.mockReturnValue(new Promise(() => {})); const { container } = mount(<Dashboard />)
  expect(container.querySelector('[data-skeleton="dashboard"]')).not.toBeNull()
  expect(container.querySelector('[data-skeleton="charts"]')).not.toBeNull()
  expect(screen.getByRole('status').textContent).toMatch(/Memuat dashboard/)
})
test('dashboard retains totals with their original filter context until new results arrive', async () => {
  const next = deferred<typeof dashboard>(); mocks.dashboard.mockResolvedValueOnce(dashboard).mockReturnValue(next.promise)
  mount(<Dashboard />); await screen.findByText('Rp120.000')
  const scope = screen.getByRole('region', { name: 'Cakupan ringkasan PO' }); const original = scope.textContent
  fireEvent.change(screen.getByLabelText('Status PO'), { target: { value: 'complete' } })
  expect(screen.getByText('Rp120.000')).toBeTruthy(); expect(scope.textContent).toBe(original)
  expect(screen.getByRole('status').textContent).toMatch(/Memperbarui dashboard/)
  await act(async () => next.resolve({ ...dashboard, metrics: { ...dashboard.metrics, totalPOValue: '240000' } }))
  await screen.findByText('Rp240.000'); expect(scope.textContent).toMatch(/Selesai/)
})
test('dashboard never retains a previous account result', async () => {
  mocks.dashboard.mockResolvedValueOnce(dashboard).mockReturnValue(new Promise(() => {}))
  const view = mount(<Dashboard />); await screen.findByText('Rp120.000')
  mocks.profile.id = 'b'; view.rerender(<QueryClientProvider client={clients[0]}><MemoryRouter><Dashboard /></MemoryRouter></QueryClientProvider>)
  expect(screen.queryByText('Rp120.000')).toBeNull(); expect(view.container.querySelector('[data-skeleton="dashboard"]')).not.toBeNull()
})
test('PO list reserves table and mobile cards initially', () => {
  mocks.orders.mockReturnValue(new Promise(() => {})); const { container } = mount(<POList />)
  expect(container.querySelector('[data-skeleton="po-list"]')).not.toBeNull()
  expect(screen.getByRole('status').textContent).toMatch(/Memuat pesanan/)
})
test('PO retained result explicitly identifies original filters while updating', async () => {
  const next = deferred<typeof orders>(); mocks.orders.mockResolvedValueOnce(orders).mockReturnValue(next.promise)
  mount(<POList />); await screen.findByText('0 pesanan')
  fireEvent.change(screen.getByLabelText('Status PO'), { target: { value: 'complete' } })
  await waitFor(() => expect(screen.getByText(/Hasil sebelumnya: Semua status/)).toBeTruthy())
  await act(async () => next.resolve(orders)); await waitFor(() => expect(screen.queryByText(/Hasil sebelumnya/)).toBeNull())
})
test('rapid dashboard filter changes abort the superseded read and keep focus, not its late result', async () => {
  const old = deferred<typeof dashboard>(); const latest = deferred<typeof dashboard>()
  mocks.dashboard.mockResolvedValueOnce(dashboard).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
  mount(<Dashboard />); await screen.findByText('Rp120.000')
  const select = screen.getByLabelText('Status PO'); select.focus()
  fireEvent.change(select, { target: { value: 'confirm' } }); await waitFor(() => expect(mocks.dashboard).toHaveBeenCalledTimes(2))
  fireEvent.change(select, { target: { value: 'complete' } }); await waitFor(() => expect(mocks.dashboard).toHaveBeenCalledTimes(3))
  expect(mocks.dashboard.mock.calls[1][4].aborted).toBe(true); expect(document.activeElement).toBe(select)
  await act(async () => latest.resolve({ ...dashboard, metrics: { ...dashboard.metrics, totalPOValue: '500000' } })); await screen.findByText('Rp500.000')
  await act(async () => old.resolve({ ...dashboard, metrics: { ...dashboard.metrics, totalPOValue: '900000' } }))
  expect(screen.queryByText('Rp900.000')).toBeNull(); expect(document.activeElement).toBe(select)
})
test('dashboard failed refresh is an explicit error with retry, not successful stale totals', async () => {
  const next = deferred<typeof dashboard>(); mocks.dashboard.mockResolvedValueOnce(dashboard).mockReturnValueOnce(next.promise).mockResolvedValue(dashboard)
  mount(<Dashboard />); await screen.findByText('Rp120.000'); fireEvent.change(screen.getByLabelText('Status PO'), { target: { value: 'complete' } })
  await act(async () => next.reject(new Error('Offline'))); await screen.findByRole('alert')
  expect(screen.queryByText('Rp120.000')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' })); await screen.findByText('Rp120.000')
})
test('dashboard role change does not retain previous results', async () => {
  mocks.dashboard.mockResolvedValueOnce(dashboard).mockReturnValue(new Promise(() => {})); const view = mount(<Dashboard />); await screen.findByText('Rp120.000')
  mocks.profile.role = 'executive'; view.rerender(<QueryClientProvider client={clients[0]}><MemoryRouter><Dashboard /></MemoryRouter></QueryClientProvider>)
  expect(screen.queryByText('Rp120.000')).toBeNull(); mocks.profile.role = 'procurement'
})
test('PO filter update has exactly one live status announcement', async () => {
  mocks.orders.mockResolvedValueOnce(orders).mockReturnValue(new Promise(() => {})); mount(<POList />); await screen.findByText('0 pesanan')
  fireEvent.change(screen.getByLabelText('Status PO'), { target: { value: 'complete' } })
  expect(screen.getAllByRole('status')).toHaveLength(1)
})

test('dashboard scope loss clears retained results and does not start another request', async () => {
  mocks.dashboard.mockResolvedValue(dashboard); const view = mount(<Dashboard />); await screen.findByText('Rp120.000')
  const calls = mocks.dashboard.mock.calls.length; mocks.signedOut = true
  view.rerender(<QueryClientProvider client={clients[0]}><MemoryRouter><Dashboard /></MemoryRouter></QueryClientProvider>)
  expect(screen.queryByText('Rp120.000')).toBeNull(); expect(mocks.dashboard).toHaveBeenCalledTimes(calls)
})
