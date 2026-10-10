import React from 'react'
import { transferableAbortController } from 'node:util'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const state = vi.hoisted(() => ({ send: vi.fn(), reconcile: vi.fn(), unresolved: false, readError: false }))
const version = '2026-10-01T00:00:00Z'
vi.mock('../src/lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    let id = 'po'
    const query: any = {
      select: () => query, eq: (_field: string, value: string) => { id = value; return query },
      order: () => query, range: () => query, abortSignal: () => query,
      single: async () => ({ data: { id, po_number: `PO-${id}`, status: 'confirm', order_date: '2026-10-01',
        expected_delivery_date: null, notes: null, customer_id: 'customer', customers: { name: 'Store A' }, updated_at: version, total_value: 20 }, error: null }),
      then: (resolve: any, reject: any) => Promise.resolve({ data: table === 'customers'
        ? [{ id: 'customer', name: 'Store A', pricing_tier: 'others' }, { id: 'other-customer', name: 'Store B', pricing_tier: 'others' }] : [], count: table === 'customers' ? 2 : 0, error: null }).then(resolve, reject),
    }
    return query
  },
  rpc: (_name: string, args: any) => {
    const query: any = { abortSignal: () => query, then: (resolve: any, reject: any) => Promise.resolve(state.readError
      ? { data: null, error: new Error('Read unavailable') }
      : { data: { version: 1, as_of: version, page: args.p_page, page_size: args.p_page_size, total: 1,
        po_updated_at: version, po_has_delivery_history: false,
        items: [{ id: 'line', product_id: null, product_name: 'Original item', sku: 'SKU', quantity: 2, unit_price: '10.00', line_total: '20.00', delivered_quantity: 0, has_delivery_history: false }] }, error: null }).then(resolve, reject) }
    return query
  },
} }))
vi.mock('../src/lib/orderTransactions', async original => ({ ...await original<any>(), useTransactionSender: () => Object.assign(state.send, {
  hasUnresolved: () => state.unresolved, reconcile: state.reconcile, acknowledgeRecovered: () => { state.unresolved = false },
}) }))
vi.mock('../src/components/AthelNav', () => ({ default: () => <nav>
  <Link to="/dashboard">Dashboard</Link><Link to="/reports">Reports</Link><Link to="/athel/po/other/edit">Other PO</Link>
</nav> }))
import POEdit from '../src/pages/athel/POEdit'

const clients: QueryClient[] = []
const routers: ReturnType<typeof createMemoryRouter>[] = []
beforeEach(() => {
  vi.stubGlobal('AbortController', class { constructor() { return transferableAbortController() } })
  state.send.mockReset().mockResolvedValue({ id: 'po' })
  state.reconcile.mockReset().mockResolvedValue({ state: 'committed', result: { id: 'po' } })
  state.unresolved = false; state.readError = false
})
afterEach(() => {
  cleanup(); routers.splice(0).forEach(router => router.dispose()); clients.splice(0).forEach(client => client.clear())
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})
async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter([
    { path: '/athel/po/:id/edit', element: <POEdit /> },
    { path: '*', element: <p>Destination page</p> },
  ], { initialEntries: ['/dashboard', '/athel/po/po/edit', '/reports'], initialIndex: 1 })
  clients.push(client); routers.push(router)
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  await screen.findByDisplayValue('Original item')
  await waitFor(() => expect((screen.getByRole('button', { name: 'Simpan Perubahan' }) as HTMLButtonElement).disabled).toBe(false))
  return { client, router }
}
function changeNotes(value = 'Keep my draft') { fireEvent.change(screen.getByPlaceholderText('Catatan (opsional)...'), { target: { value } }) }
function beforeUnload() { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented }
const keep = () => fireEvent.click(screen.getByRole('button', { name: 'Tetap mengedit' }))
const discard = () => fireEvent.click(screen.getByRole('button', { name: 'Buang perubahan' }))

test('pristine loaded and refetched PO leaves through sidebar without warning', async () => {
  const { router, client } = await mount()
  await act(() => client.invalidateQueries())
  expect(beforeUnload()).toBe(false)
  fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('pristine recovery can show the saved PO without a discard warning', async () => {
  state.unresolved = true
  const { router } = await mount()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/athel/po/po'))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(beforeUnload()).toBe(false)
})

test.each(['notes', 'expiry', 'customer', 'name', 'sku', 'quantity', 'price', 'add', 'remove'])('%s edit is guarded before sidebar navigation or browser unload', async field => {
  const { router } = await mount()
  if (field === 'notes') changeNotes()
  if (field === 'expiry') fireEvent.change(screen.getByLabelText('Tanggal Kedaluwarsa PO (opsional)'), { target: { value: '2026-12-31' } })
  if (field === 'customer') {
    fireEvent.change(screen.getByRole('combobox', { name: 'Pelanggan' }), { target: { value: 'Store B' } })
    fireEvent.click(screen.getByRole('option', { name: 'Store B' }))
  }
  if (field === 'name') fireEvent.change(screen.getByLabelText('Nama produk Original item'), { target: { value: 'New name' } })
  if (field === 'sku') fireEvent.change(screen.getByLabelText('SKU Original item'), { target: { value: 'NEW' } })
  if (field === 'quantity') fireEvent.change(screen.getByLabelText('Qty Original item'), { target: { value: '3' } })
  if (field === 'price') fireEvent.change(screen.getByLabelText('Harga satuan'), { target: { value: '0' } })
  if (field === 'add') fireEvent.click(screen.getByRole('button', { name: '+ Tambah barang manual' }))
  if (field === 'remove') fireEvent.click(screen.getByRole('button', { name: 'Hapus Original item' }))
  expect(beforeUnload()).toBe(true)
  fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }))
  expect(await screen.findByRole('dialog')).toBeTruthy()
  expect(router.state.location.pathname).toBe('/athel/po/po/edit')
  keep()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(beforeUnload()).toBe(true)
})

test.each(['Batal', '← Kembali'])('%s preserves dirty form on Keep and navigates only after Discard', async action => {
  const { router } = await mount(); changeNotes()
  fireEvent.click(screen.getByRole('button', { name: action })); keep()
  expect(screen.getByDisplayValue('Keep my draft')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: action })); discard()
  await waitFor(() => expect(router.state.location.pathname).toBe('/athel/po/po'))
  expect(beforeUnload()).toBe(false)
})

test.each([-1, 1])('history navigation (%s) can be kept then discarded without corrupting reverse history', async delta => {
  const { router } = await mount(); changeNotes()
  await act(() => router.navigate(delta)); keep()
  expect(router.state.location.pathname).toBe('/athel/po/po/edit')
  expect(screen.getByDisplayValue('Keep my draft')).toBeTruthy()
  await act(() => router.navigate(delta)); discard()
  await waitFor(() => expect(router.state.location.pathname).toBe(delta === -1 ? '/dashboard' : '/reports'))
  // Router state publishes before React commits the destination and retires its
  // old blocker. Reverse immediately after that observable route lifecycle,
  // without an arbitrary delay or waiting for the next PO read.
  await screen.findByText('Destination page')
  expect(screen.queryByDisplayValue('Original item')).toBeNull()
  expect(router.state.blockers.size).toBe(0)
  await act(() => router.navigate(-delta))
  await screen.findByDisplayValue('Original item')
  expect(screen.queryByDisplayValue('Keep my draft')).toBeNull()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(beforeUnload()).toBe(false)
})

test('repeated links use the latest destination; Escape keeps the draft and warning can reopen', async () => {
  const { router } = await mount(); changeNotes()
  fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }))
  fireEvent.click(screen.getByRole('link', { name: 'Reports' }))
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByDisplayValue('Keep my draft')).toBeTruthy()
  fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }))
  fireEvent.click(screen.getByRole('link', { name: 'Reports' })); discard()
  await waitFor(() => expect(router.state.location.pathname).toBe('/reports'))
})

test('reverting draft fields and removing a newly added blank line restores pristine state', async () => {
  const { router } = await mount(); changeNotes(); changeNotes('')
  fireEvent.change(screen.getByLabelText('Harga satuan'), { target: { value: '' } })
  expect(beforeUnload()).toBe(true)
  fireEvent.change(screen.getByLabelText('Harga satuan'), { target: { value: '10' } })
  fireEvent.click(screen.getByRole('button', { name: '+ Tambah barang manual' }))
  fireEvent.click(screen.getByRole('button', { name: 'Hapus barang baru' }))
  expect(beforeUnload()).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/athel/po/po'))
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('failed save keeps edits protected; successful retry leaves without a stale warning', async () => {
  const { router } = await mount(); changeNotes()
  state.send.mockRejectedValueOnce(new Error('Save failed'))
  fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }))
  await screen.findByText('Save failed')
  fireEvent.click(screen.getByRole('button', { name: 'Batal' })); keep()
  expect(screen.getByDisplayValue('Keep my draft')).toBeTruthy()
  expect(beforeUnload()).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/athel/po/po'))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(beforeUnload()).toBe(false)
})

test('save completion clears a pending navigation dialog and reaches saved PO without further warning', async () => {
  let resolve!: (value: { id: string }) => void
  state.send.mockReturnValueOnce(new Promise(done => { resolve = done }))
  const { router } = await mount(); changeNotes()
  fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }))
  await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }))
  await screen.findByRole('dialog')
  await act(async () => resolve({ id: 'po' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/athel/po/po'))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(beforeUnload()).toBe(false)
})

test('unknown save retains recovery and draft; committed recovery asks before discarding dirty values', async () => {
  const { router } = await mount(); changeNotes()
  state.send.mockImplementationOnce(async () => { state.unresolved = true; throw new Error('Uncertain save') })
  fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }))
  await screen.findByText('Uncertain save')
  fireEvent.click(screen.getByRole('button', { name: 'Batal' })); keep()
  expect(state.unresolved).toBe(true)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' }))
  await screen.findByRole('dialog')
  expect(router.state.location.pathname).toBe('/athel/po/po/edit')
  discard()
  await waitFor(() => expect(router.state.location.pathname).toBe('/athel/po/po'))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(beforeUnload()).toBe(false)
})

test('read failure after edits still presents the navigation warning and keeps the in-memory draft', async () => {
  const { router, client } = await mount(); changeNotes()
  state.readError = true
  await act(() => client.invalidateQueries({ queryKey: ['po_line_state'] }))
  await screen.findByRole('button', { name: 'Coba lagi' })
  fireEvent.click(screen.getByRole('link', { name: 'Dashboard' })); keep()
  expect(router.state.location.pathname).toBe('/athel/po/po/edit')
  expect(beforeUnload()).toBe(true)
  state.readError = false
  await act(() => client.invalidateQueries({ queryKey: ['po_line_state'] }))
  expect(await screen.findByDisplayValue('Keep my draft')).toBeTruthy()
})

test('same-component PO navigation discards the old draft and guards edits against the new baseline', async () => {
  const { router } = await mount(); changeNotes()
  fireEvent.click(screen.getByRole('link', { name: 'Other PO' })); discard()
  await waitFor(() => expect(router.state.location.pathname).toBe('/athel/po/other/edit'))
  await screen.findByDisplayValue('PO-other')
  await waitFor(() => expect((screen.getByPlaceholderText('Catatan (opsional)...') as HTMLTextAreaElement).value).toBe(''))
  expect(beforeUnload()).toBe(false)
  changeNotes('Another draft')
  fireEvent.click(screen.getByRole('link', { name: 'Dashboard' })); keep()
  expect(screen.getByDisplayValue('Another draft')).toBeTruthy()
})

test.each(['save'])('%s pending makes draft controls read-only until the result is known', async operation => {
  let resolve!: (value: any) => void
  const pending = new Promise(done => { resolve = done })
  if (operation === 'save') state.send.mockReturnValueOnce(pending)
  else { state.unresolved = true; state.reconcile.mockReturnValueOnce(pending) }
  await mount(); changeNotes()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: operation === 'save' ? 'Simpan Perubahan' : 'Pulihkan hasil penyimpanan' }))
  await waitFor(() => expect(operation === 'save' ? state.send : state.reconcile).toHaveBeenCalledTimes(1))
  for (const label of ['Tanggal Kedaluwarsa PO (opsional)', 'Nama produk Original item', 'SKU Original item', 'Qty Original item', 'Harga satuan']) {
    expect(screen.getByLabelText(label).matches(':disabled')).toBe(true)
  }
  expect(screen.getByPlaceholderText('Catatan (opsional)...').matches(':disabled')).toBe(true)
  expect(screen.getByRole('button', { name: '+ Tambah barang manual' }).matches(':disabled')).toBe(true)
  expect(screen.getByRole('button', { name: 'Hapus Original item' }).matches(':disabled')).toBe(true)
  await act(async () => resolve(operation === 'save' ? { id: 'po' } : { state: 'committed', result: { id: 'po' } }))
})

test.each([['save', 'Dashboard'], ['save', 'Other PO'], ['recovery', 'Dashboard'], ['recovery', 'Other PO']])('late %s cannot override an accepted navigation to %s', async (operation, destination) => {
  let resolve!: (value: { id: string }) => void
  const pending = new Promise<any>(done => { resolve = done })
  if (operation === 'save') state.send.mockReturnValueOnce(pending)
  else { state.unresolved = true; state.reconcile.mockReturnValueOnce(pending) }
  const { router } = await mount(); changeNotes()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: operation === 'save' ? 'Simpan Perubahan' : 'Pulihkan hasil penyimpanan' }))
  await waitFor(() => expect(operation === 'save' ? state.send : state.reconcile).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('link', { name: destination })); discard()
  const path = destination === 'Dashboard' ? '/dashboard' : '/athel/po/other/edit'
  await waitFor(() => expect(router.state.location.pathname).toBe(path))
  if (destination === 'Other PO') { await screen.findByDisplayValue('PO-other'); changeNotes('New PO draft') }
  await act(async () => resolve(operation === 'save' ? { id: 'po' } : { state: 'committed', result: { id: 'po' } } as any))
  expect(router.state.location.pathname).toBe(path)
  if (destination === 'Other PO') {
    expect(screen.getByDisplayValue('New PO draft')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Dashboard' })); keep()
  }
})

test.each(['before', 'during', 'after rejected retry'])('recovery of draft A cannot silently discard draft B edited %s reconciliation', async timing => {
  const { router } = await mount(); changeNotes('Draft A')
  state.send.mockImplementationOnce(async () => { state.unresolved = true; throw new Error('Uncertain save') })
  fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }))
  await screen.findByText('Uncertain save')
  let resolve!: (value: any) => void
  state.reconcile.mockReturnValueOnce(new Promise(done => { resolve = done }))
  if (timing !== 'during') changeNotes('Draft B')
  if (timing === 'after rejected retry') {
    state.send.mockRejectedValueOnce(new Error('Resolve the previous save first'))
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }))
    await screen.findByText('Resolve the previous save first')
  }
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' }))
  await waitFor(() => expect(state.reconcile).toHaveBeenCalledTimes(1))
  if (timing === 'during') changeNotes('Draft B')
  await act(async () => resolve({ state: 'committed', result: { id: 'po' } }))
  await screen.findByRole('dialog'); keep()
  expect(router.state.location.pathname).toBe('/athel/po/po/edit')
  expect(screen.getByDisplayValue('Draft B')).toBeTruthy()
  expect(beforeUnload()).toBe(true)
})
