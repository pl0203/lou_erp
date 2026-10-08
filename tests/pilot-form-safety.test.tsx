import React from 'react'
import { transferableAbortController } from 'node:util'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cacheProbe } from './scalability/cache-probe'

const state = vi.hoisted(() => ({ send: vi.fn(), reconcile: vi.fn(), unresolved: false, visit: true }))
vi.mock('../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'actor' }, profile: { id: 'actor', role: 'sales_person' } }) }))
vi.mock('../src/lib/orderTransactions', async original => ({ ...await original<any>(), useTransactionSender: () => Object.assign(state.send, {
  hasUnresolved: () => state.unresolved, reconcile: state.reconcile, acknowledgeRecovered: () => { state.unresolved = false },
}) }))
vi.mock('../src/components/AthelNav', () => ({ default: () => <Link to="/elsewhere">Dashboard</Link> }))
vi.mock('../src/components/GirardNav', () => ({ default: () => <Link to="/elsewhere">Jadwal</Link> }))
vi.mock('@tanstack/react-query', async original => ({ ...await original<any>(), useQuery: ({ queryKey }: any) => ({ data:
  queryKey[0] === 'customers' ? [{ id: 'a', name: 'Customer A', pricing_tier: 'luar_kota' }, { id: 'b', name: 'Customer B', pricing_tier: 'dalam_kota' }]
    : queryKey[0] === 'schedule' ? { id: 's', customers: { id: 'a', name: 'Customer A', pricing_tier: 'luar_kota' } }
    : queryKey[0] === 'visit' ? (state.visit ? { id: 'v', sales_person_id: 'actor', note_version: 1, notes: 'Original note', checked_in_at: '2026-09-30T10:00:00Z', visit_photos: [] } : null) : [],
}) }))
import PONew from '../src/pages/athel/PONew'
import VisitPage from '../src/pages/girard/VisitPage'
const clients: QueryClient[] = []
const routers: ReturnType<typeof createMemoryRouter>[] = []
beforeEach(() => {
  // Node's Request requires its own AbortSignal rather than jsdom's DOM class.
  vi.stubGlobal('AbortController', class { constructor() { return transferableAbortController() } })
  state.send.mockReset().mockResolvedValue({ id: 'saved' }); state.reconcile.mockReset().mockResolvedValue({ state: 'committed', result: { id: 'recovered' } }); state.unresolved = false; state.visit = true
})
afterEach(() => { cleanup(); routers.splice(0).forEach(router => router.dispose()); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function mount(kind: 'po' | 'visit' = 'po') {
  const path = kind === 'po' ? '/athel/po/new' : '/girard/visit/s'
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }); clients.push(client)
  const router = createMemoryRouter([
    { path: '/athel/po/new', element: <PONew /> }, { path: '/girard/visit/:scheduleId', element: <VisitPage /> },
    { path: '*', element: <p>Destination page</p> },
  ], { initialEntries: ['/elsewhere', path] })
  routers.push(router)
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return router
}
function selectCustomer(name: string) {
  fireEvent.change(screen.getByRole('combobox', { name: 'Pelanggan' }), { target: { value: name } })
  fireEvent.click(screen.getByRole('option', { name }))
}
function dirtyPO() {
  selectCustomer('Customer A')
  fireEvent.change(screen.getByPlaceholderText('mis. PO-2024-001'), { target: { value: 'PO-KEEP' } })
  fireEvent.click(screen.getByRole('button', { name: '+ Tambah barang manual' }))
  fireEvent.change(screen.getByPlaceholderText('Nama produk'), { target: { value: 'Barang A' } })
  fireEvent.change(screen.getByLabelText('Harga satuan'), { target: { value: '0' } })
}

test('changing customer keeps original items until explicit discard and can be cancelled', () => {
  mount(); dirtyPO()
  selectCustomer('Customer B')
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect((screen.getByRole('combobox', { name: 'Pelanggan' }) as HTMLInputElement).value).toBe('Customer A')
  expect((screen.getByPlaceholderText('Nama produk') as HTMLInputElement).value).toBe('Barang A')
  fireEvent.click(screen.getByRole('button', { name: 'Tetap mengedit' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  selectCustomer('Customer B')
  fireEvent.click(screen.getByRole('button', { name: 'Buang perubahan' }))
  expect((screen.getByRole('combobox', { name: 'Pelanggan' }) as HTMLInputElement).value).toBe('Customer B')
  expect(screen.queryByPlaceholderText('Nama produk')).toBeNull()
  expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('PO-KEEP')
})

test('dirty new PO guards app links and refresh while clean forms do not prompt', async () => {
  const router = mount()
  const clean = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(clean)
  expect(clean.defaultPrevented).toBe(false)
  dirtyPO()
  const dirty = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(dirty)
  expect(dirty.defaultPrevented).toBe(true)
  fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }))
  expect(await screen.findByRole('dialog')).toBeTruthy()
  expect(router.state.location.pathname).toBe('/athel/po/new')
  fireEvent.click(screen.getByRole('button', { name: 'Tetap mengedit' }))
  expect((screen.getByPlaceholderText('Nama produk') as HTMLInputElement).value).toBe('Barang A')
  fireEvent.click(screen.getByRole('button', { name: /Kembali/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Buang perubahan' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/athel/po'))
})

test('browser-style Back can be cancelled then accepted and Forward still works', async () => {
  const router = mount(); dirtyPO()
  await act(() => router.navigate(-1))
  fireEvent.click(await screen.findByRole('button', { name: 'Tetap mengedit' }))
  expect(router.state.location.pathname).toBe('/athel/po/new')
  await act(() => router.navigate(-1))
  fireEvent.click(await screen.findByRole('button', { name: 'Buang perubahan' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/elsewhere'))
  await waitFor(() => expect(router.state.blockers.size).toBe(0))
  await act(() => router.navigate(1))
  await waitFor(() => expect(router.state.location.pathname).toBe('/athel/po/new'))
  expect(await screen.findByText('PO Baru')).toBeTruthy()
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('successful PO save bypasses the dirty guard and sends optional customer expiry unchanged', async () => {
  const router = mount(); dirtyPO()
  const probe = cacheProbe(clients.at(-1)!)
  const expiry = screen.getByLabelText('Tanggal Kedaluwarsa PO (opsional)')
  expect(expiry.hasAttribute('required')).toBe(false)
  fireEvent.change(expiry, { target: { value: '2026-12-31' } })
  fireEvent.click(screen.getByRole('button', { name: 'Simpan PO' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/athel/po/saved'))
  expect(state.send).toHaveBeenCalledWith('create_po', expect.objectContaining({ expected_delivery_date: '2026-12-31' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  await waitFor(() => probe.refreshed())
  probe.stop()
})

test('unknown save outcomes remain recoverable and recovered success does not leave a blocker', async () => {
  const router = mount(); dirtyPO()
  const probe = cacheProbe(clients.at(-1)!)
  state.send.mockImplementationOnce(async () => { state.unresolved = true; throw new Error('Hasil belum pasti') })
  fireEvent.click(screen.getByRole('button', { name: 'Simpan PO' }))
  await screen.findByText('Hasil belum pasti')
  probe.unchanged()
  fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Tetap mengedit' }))
  expect(state.unresolved).toBe(true)
  expect((screen.getByPlaceholderText('Nama produk') as HTMLInputElement).value).toBe('Barang A')
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/athel/po/recovered'))
  expect(screen.queryByRole('dialog')).toBeNull()
  await waitFor(() => probe.refreshed())
  probe.stop()
})

test('dirty visit notes can keep editing on Cancel and warn again before leaving', async () => {
  const router = mount('visit')
  fireEvent.click(screen.getByRole('button', { name: 'Edit catatan' }))
  fireEvent.change(screen.getByLabelText('Catatan kunjungan'), { target: { value: 'Barang kunjungan' } })
  fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
  expect(screen.getByRole('dialog')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Tetap mengedit' }))
  expect((screen.getByLabelText('Catatan kunjungan') as HTMLTextAreaElement).value).toBe('Barang kunjungan')
  fireEvent.click(screen.getByRole('link', { name: 'Jadwal' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Tetap mengedit' }))
  expect(router.state.location.pathname).toBe('/girard/visit/s')
  fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
  fireEvent.click(screen.getByRole('button', { name: 'Buang perubahan' }))
  expect(screen.queryByLabelText('Catatan kunjungan')).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: 'Jadwal' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/elsewhere'))
})

test.each(['navigate', 'cancel'])('a visit note committed while a %s dialog is open clears it and guards later new drafts', async action => {
  let resolve!: (value: { id: string }) => void
  state.send.mockReturnValueOnce(new Promise(done => { resolve = done }))
  const router = mount('visit')
  fireEvent.click(screen.getByRole('button', { name: 'Edit catatan' }))
  fireEvent.change(screen.getByLabelText('Catatan kunjungan'), { target: { value: 'Pending item' } })
  fireEvent.click(screen.getByRole('button', { name: 'Simpan catatan' }))
  await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1))
  if (action === 'navigate') { fireEvent.click(screen.getByRole('link', { name: 'Jadwal' })); await screen.findByRole('dialog') }
  else expect((screen.getByRole('button', { name: 'Batal' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => resolve({ id: 'saved' }))
  await waitFor(() => expect(screen.queryByLabelText('Catatan kunjungan')).toBeNull())
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(router.state.location.pathname).toBe('/girard/visit/s')
  fireEvent.click(screen.getByRole('button', { name: 'Edit catatan' }))
  fireEvent.change(screen.getByLabelText('Catatan kunjungan'), { target: { value: 'Another item' } })
  fireEvent.click(screen.getByRole('link', { name: 'Jadwal' }))
  expect(await screen.findByRole('dialog')).toBeTruthy()
})

test('pristine missing price stays clean; entering zero is a draft change and clearing restores clean', () => {
 mount()
 fireEvent.click(screen.getByRole('button', { name: '+ Tambah barang manual' }))
 const price = screen.getByLabelText('Harga satuan')
 expect((price as HTMLInputElement).value).toBe('')
 const clean = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(clean)
 expect(clean.defaultPrevented).toBe(false)
 fireEvent.change(price, { target: { value: '0' } })
 const dirty = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(dirty)
 expect(dirty.defaultPrevented).toBe(true)
 fireEvent.change(price, { target: { value: '' } })
 const cleared = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(cleared)
 expect(cleared.defaultPrevented).toBe(false)
})

test('new PO line fields stack on phones without narrowing SKU to one desktop column', () => {
  mount()
  fireEvent.click(screen.getByRole('button', { name: '+ Tambah barang manual' }))
  const sku = screen.getByText('SKU', { selector: 'label' }).parentElement!
  const grid = sku.parentElement!
  expect(grid.classList.contains('grid-cols-1')).toBe(true)
  expect([...grid.classList].some(name => name.startsWith('sm:grid-cols-['))).toBe(true)
  expect(sku.classList.contains('min-w-0')).toBe(true)
  for (const input of grid.querySelectorAll('input')) expect(input.classList.contains('min-w-0')).toBe(true)
})

vi.mock('../src/lib/visitTransactions', () => ({ useVisitPlanningSender: () => Object.assign(state.send, { hasUnresolved: () => state.unresolved, reconcile: state.reconcile, acknowledgeRecovered: () => { state.unresolved = false } }) }))
vi.mock('../src/components/StorePOContext', () => ({ default: () => null }))
vi.mock('../src/lib/reads/usePagedRead', () => ({ usePagedRead: () => ({ data: { items: [], total: 0 }, page: 1, isPending: false, setPage: vi.fn() }) }))
