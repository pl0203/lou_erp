import { transferableAbortController } from 'node:util'
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  send: vi.fn(), nextActorSend: vi.fn(), actor: 'actor', reconcile: vi.fn(), acknowledge: vi.fn(), editDelivery: vi.fn(),
  queryErrors: [] as string[], unresolved: false, po: {} as any, lines: [] as any[], customers: [] as any[], products: [] as any[],
  deliveries: [] as any[], orders: [] as any[], loading: false, error: false, salesStatus: 'pending', salesFilter: 'pending', refreshSales: null as (() => void) | null,
  setFilters: vi.fn(), setPage: vi.fn(), refetch: vi.fn(),
}))
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: state.actor }, profile: { id: state.actor, role: 'po_admin', is_active: true }, loading: false, error: null }) }))
vi.mock('../../src/components/AthelNav', () => ({ default: () => <nav aria-label="Procurement"><a href="/athel/po">Procurement</a></nav> }))
vi.mock('../../src/lib/orderTransactions', async original => ({ ...await original<any>(), useTransactionSender: () => Object.assign(state.actor === 'actor' ? state.send : state.nextActorSend, {
  hasUnresolved: () => state.unresolved, isInFlight: () => false, reconcile: state.reconcile, acknowledgeRecovered: state.acknowledge,
}) }))
vi.mock('../../src/lib/reads/detailReads', async original => ({ ...await original<any>(), fetchDeliveryForEdit: (...args: any[]) => state.editDelivery(...args) }))
vi.mock('../../src/lib/reads/usePagedRead', async () => { const { useState } = await import('react'); return { usePagedRead: (name: string, filters: any) => { const [, refresh] = useState(0); if (name === 'girard_orders') state.refreshSales = () => refresh(value => value + 1); return ({
  data: state.loading || state.error ? undefined : { items: name === 'purchase_orders' ? state.orders : name === 'girard_orders' ? [{ id: 'legacy', status: state.salesStatus, customers: { name: 'Synthetic buyer' }, users: { full_name: 'Synthetic sales' }, total_value: '9007199254740993.01', created_at: '2026-10-01T00:00:00Z' }] : name === 'surat_jalan' ? state.deliveries : [], total: 1, page: 1, page_size: 20, status_counts: { pending: 1 } },
  filters: name === 'girard_orders' ? { ...filters, status: state.salesFilter } : filters, page: 1, setFilters: state.setFilters, setPage: state.setPage, refetch: state.refetch, isPending: state.loading, isError: state.error,
}) } } })
vi.mock('@tanstack/react-query', async original => ({ ...await original<any>(), useQuery: ({ queryKey }: any) => ({
  data: state.loading || state.error ? undefined : queryKey[0] === 'po' ? state.po
    : queryKey[0] === 'po_line_state' ? { items: state.lines.map(line => ({ ...line, unit_price: queryKey[2] === 'edit' ? line.unit_price : String(line.unit_price) })), po_updated_at: state.po.updated_at, po_has_delivery_history: false }
    : queryKey[0] === 'customers' ? state.customers : queryKey[0] === 'products' ? state.products
    : queryKey[0] === 'sales_order_lines' ? [{ id: 'sale-line', product_name: 'Synthetic tile', sku: 'SYN-1', quantity: 1, unit_price: 71 }]
    : queryKey[0] === 'sj_lines' ? [{ id: 'delivery-line', po_line_item_id: 'line', quantity_delivered: 1 }] : [],
  isLoading: state.loading, isPending: state.loading, isFetching: false, isError: state.error || state.queryErrors.includes(queryKey[0]), refetch: state.refetch,
}) }))
import POList from '../../src/pages/athel/POList'
import PONew from '../../src/pages/athel/PONew'
import POEdit from '../../src/pages/athel/POEdit'
import PODetail from '../../src/pages/athel/PODetail'
import SalesOrders from '../../src/pages/athel/SalesOrders'
import { PromoStockWarningError } from '../../src/lib/promotionStock'

const version = '2026-10-12T08:00:00.123456Z'
const longName = 'Synthetic buyer with a very long branch identity '.repeat(6)
const warning = new PromoStockWarningError({ code: 'PROMO_STOCK_WARNING', shortages: [{ promotion_id: '11111111-1111-4111-8111-111111111111', product_id: '11111111-1111-4111-8111-111111111111', product_name: 'Synthetic tile', sku: 'SYN-1', remaining_quantity: 0, requested_quantity: 1, incremental_quantity: 1, shortfall: 1, stock_version: 1 }], ack: { stock: 1 } })
const clients: QueryClient[] = [], routers: ReturnType<typeof createMemoryRouter>[] = []
beforeEach(() => {
  state.actor = 'actor'; state.nextActorSend.mockReset(); state.send.mockReset().mockResolvedValue({ id: 'po' }); state.reconcile.mockReset(); state.acknowledge.mockReset(); state.editDelivery.mockReset().mockResolvedValue([{ po_line_item_id: 'line', quantity_delivered: 1 }])
  state.queryErrors = []; state.unresolved = false; state.loading = false; state.error = false; state.salesStatus = 'pending'; state.salesFilter = 'pending'; state.refreshSales = null; state.setFilters.mockReset()
  state.po = { id: 'po', po_number: 'SYN-PO', status: 'confirm', customer_id: 'buyer', customers: { name: 'Synthetic buyer' }, order_date: '2026-10-01', expected_delivery_date: null, notes: null, updated_at: version, total_value: 20, completed_at: null }
  state.lines = [{ id: 'line', product_id: null, product_name: 'Synthetic tile', sku: 'SYN-1', quantity: 5, delivered_quantity: 1, unit_price: 10, line_total: '50.00', has_delivery_history: false }, { id: 'zero-line', product_id: null, product_name: 'Zero delivery tile', sku: 'SYN-0', quantity: 1, delivered_quantity: 0, unit_price: 0, line_total: '0.00', has_delivery_history: false }]
  state.deliveries = [{ id: 'sj', sj_number: 'SYN-SJ', sj_date: '2026-10-01', sj_date_received: null, sj_date_returned: null, voided_at: null, void_reason: null }]
  state.customers = [{ id: 'buyer', name: 'Synthetic buyer', pricing_tier: 'luar_kota' }]
  state.products = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Synthetic tile', sku: 'SYN-1', size: '12 pcs', luar_kota: 71, unit_price: 99 }]
  state.orders = ['confirm', 'in_progress', 'complete', 'cancelled'].map((status, i) => ({ ...state.po, id: `po-${i}`, status, customers: { name: longName }, total_value: '9007199254740993.01' }))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); routers.splice(0).forEach(router => router.dispose()); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); localStorage.clear() })
function mount(kind: 'list' | 'new' | 'edit' | 'detail' | 'sales') {
  const path = { list: '/athel/po', new: '/athel/po/new', edit: '/athel/po/po/edit', detail: '/athel/po/po', sales: '/athel/sales-orders' }[kind]
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } }); clients.push(client)
  const router = createMemoryRouter([{ path: kind === 'edit' ? '/athel/po/:id/edit' : kind === 'detail' ? '/athel/po/:id' : path, element: { list: <POList />, new: <PONew />, edit: <POEdit />, detail: <PODetail />, sales: <SalesOrders /> }[kind] }, { path: '*', element: <main id="destination">Destination</main> }], { initialEntries: [path] }); routers.push(router)
  const view = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return { ...view, router }
}
function expectAssociated(label: string) {
  const input = screen.getByLabelText(label) as HTMLInputElement
  expect(input.id).not.toBe('')
  expect([...document.querySelectorAll('label')].some(node => node.htmlFor === input.id)).toBe(true)
  return input
}
function nativeDialog() {
  const dialog = screen.getByRole('dialog')
  expect(dialog.tagName).toBe('DIALOG'); expect(dialog.classList.contains('ui-dialog')).toBe(true)
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  return dialog
}
test('list desktop and mobile actions have equal native destinations, status rules and exact long-value display', () => {
  const { router } = mount('list')
  const table = screen.getByRole('region', { name: 'Daftar pesanan pembelian' })
  expect(within(table).getAllByRole('link', { name: 'Lihat' }).map(link => link.getAttribute('href'))).toEqual(['/athel/po/po-0', '/athel/po/po-1', '/athel/po/po-2', '/athel/po/po-3'])
  expect(screen.getAllByRole('link', { name: 'Lihat' }).map(link => link.getAttribute('href'))).toEqual(['/athel/po/po-0', '/athel/po/po-1', '/athel/po/po-2', '/athel/po/po-3', '/athel/po/po-0', '/athel/po/po-1', '/athel/po/po-2', '/athel/po/po-3'])
  expect(screen.getAllByRole('link', { name: 'Ubah' }).map(link => link.getAttribute('href'))).toEqual(['/athel/po/po-0/edit', '/athel/po/po-1/edit', '/athel/po/po-0/edit', '/athel/po/po-1/edit'])
  expect(screen.getAllByText('Rp 9.007.199.254.740.993,01')).toHaveLength(8)
  expect(screen.getAllByText(longName.trim())).toHaveLength(8)
  const link = screen.getAllByRole('link', { name: 'Lihat' })[0]
  let intercepted = true
  document.addEventListener('click', event => { intercepted = event.defaultPrevented; event.preventDefault() }, { once: true })
  fireEvent.click(link, { ctrlKey: true, button: 0 }); expect(intercepted).toBe(false); expect(router.state.location.pathname).toBe('/athel/po')
})
test.each(['list', 'new', 'edit', 'detail', 'sales'] as const)('%s ready state has exactly one page-owned main target after navigation', async kind => {
  mount(kind)
  if (kind === 'edit') await screen.findByDisplayValue('Synthetic tile')
  expect(document.querySelectorAll('main')).toHaveLength(1); expect(document.querySelectorAll('#main-content')).toHaveLength(1)
  expect(document.querySelector('main main')).toBeNull(); expect(document.querySelector('#main-content')?.getAttribute('tabindex')).toBe('-1')
})
test.each(['edit', 'detail'] as const)('%s loading and unavailable states retain one main and reachable recovery', kind => {
  state.loading = true; state.unresolved = true; const view = mount(kind)
  expect(document.querySelectorAll('#main-content')).toHaveLength(1); expect(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' })).toBeTruthy()
  view.unmount(); state.loading = false; state.error = true; mount(kind)
  expect(document.querySelectorAll('#main-content')).toHaveLength(1); expect(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' })).toBeTruthy()
})
test.each(['new', 'edit'] as const)('%s visible labels and descriptions reach actual controls and stable line IDs', async kind => {
  mount(kind); if (kind === 'edit') await screen.findByDisplayValue('Synthetic tile')
  expectAssociated('Pelanggan'); expectAssociated('Nomor PO'); expectAssociated('Tanggal PO'); expectAssociated('Catatan')
  const expiry = expectAssociated('Tanggal Kedaluwarsa PO (opsional)')
  expect(document.getElementById(expiry.getAttribute('aria-describedby') ?? '')?.textContent).toContain('Bukan tanggal pengiriman')
  const lookup = expectAssociated('Cari SKU atau nama barang')
  expect(document.getElementById(lookup.getAttribute('aria-describedby') ?? '')?.textContent).toContain('Ketik SKU tepat')
  if (kind === 'new') fireEvent.click(screen.getByRole('button', { name: '+ Tambah barang manual' }))
  const name = screen.getAllByPlaceholderText('Nama produk')[0] as HTMLInputElement, originalId = name.id
  expect(originalId).not.toBe(''); expect(name.labels?.length).toBe(1)
  fireEvent.change(name, { target: { value: 'Long manual tile '.repeat(20) } }); expect(name.id).toBe(originalId)
  const row = name.closest('[data-po-line]')!
  for (const control of row.querySelectorAll('input')) expect(control.labels?.length).toBe(1)
})
test('large manual price and catalog unit description survive duplicate selection, row removal and exact stock retry', async () => {
  mount('new')
  fireEvent.change(screen.getByRole('combobox', { name: 'Pelanggan' }), { target: { value: 'Synthetic' } }); fireEvent.click(screen.getByRole('option', { name: 'Synthetic buyer' }))
  fireEvent.change(expectAssociated('Nomor PO'), { target: { value: 'LONG-PO' } })
  const lookup = expectAssociated('Cari SKU atau nama barang')
  fireEvent.change(lookup, { target: { value: 'SYN-1' } }); expect(screen.getByRole('option').textContent).toContain('12 pcs'); fireEvent.keyDown(lookup, { key: 'Enter' })
  const price = screen.getByLabelText('Harga satuan'); fireEvent.change(price, { target: { value: '999999999999.99' } })
  const name = screen.getByPlaceholderText('Nama produk'); fireEvent.change(name, { target: { value: 'Long tile '.repeat(25) } })
  fireEvent.change(lookup, { target: { value: 'SYN-1' } }); fireEvent.keyDown(lookup, { key: 'Enter' }); expect((price as HTMLInputElement).value).toBe('999999999999.99')
  fireEvent.click(screen.getByRole('button', { name: '+ Tambah barang manual' })); fireEvent.click(screen.getByRole('button', { name: 'Hapus barang baru' }))
  state.send.mockRejectedValueOnce(warning).mockResolvedValueOnce({ id: 'po' })
  fireEvent.click(screen.getByRole('button', { name: 'Simpan PO' })); await screen.findByRole('dialog', { name: 'Stok promosi tidak mencukupi' }); nativeDialog()
  const original = state.send.mock.calls[0][1]; expect(original.items).toEqual([{ product_id: state.products[0].id, product_name: 'Long tile '.repeat(25), sku: 'SYN-1', quantity: 1, unit_price: 999999999999.99 }])
  fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' })); await waitFor(() => expect(state.send).toHaveBeenCalledTimes(2))
  expect(state.send.mock.calls[1]).toEqual(['create_po', { ...original, promo_stock_ack: warning.warning.ack }])
})
const modalCases = [
  { kind: 'detail', open: '+ Surat Jalan', confirm: 'Simpan SJ', operation: 'save_delivery', field: 'Nomor SJ', value: 'NEW-SJ' },
  { kind: 'detail', open: 'Ubah', confirm: 'Simpan Perubahan SJ', operation: 'save_delivery', field: 'Nomor SJ', value: 'EDIT-SJ' },
  { kind: 'detail', open: 'Batalkan', confirm: 'Ya, batalkan', operation: 'void_delivery', field: 'Alasan pembatalan', value: 'Retained reason' },
  { kind: 'detail', open: 'Batalkan PO', confirm: 'Ya, batalkan', operation: 'cancel_po', field: 'Alasan pembatalan', value: 'Retained reason' },
  { kind: 'sales', open: 'Tolak', confirm: 'Tolak Pesanan', operation: 'reject_sales', field: 'Alasan penolakan (wajib)', value: 'Retained reason' },
  { kind: 'detail', open: 'Ubah tanggal SJ kembali', confirm: 'Simpan tanggal kembali', operation: 'edit_sj_returned_date', field: 'Tanggal SJ kembali', value: '2026-10-07' },
] as const
async function openCase(item: typeof modalCases[number]) {
  mount(item.kind); const trigger = screen.getByRole('button', { name: item.open }); trigger.focus(); fireEvent.click(trigger)
  if (item.open === 'Ubah') await screen.findByRole('heading', { name: /Ubah Surat Jalan/ })
  return trigger
}
test.each(modalCases)('$operation $open uses a native dialog, contains focus and returns cancellation to its trigger', async item => {
  const trigger = await openCase(item), dialog = nativeDialog(), field = expectAssociated(item.field)
  expect(dialog.contains(document.activeElement)).toBe(true); expect(trigger.closest('[inert]')).not.toBeNull()
  const cancel = screen.getByRole('button', { name: 'Batal' }); field.focus(); fireEvent.keyDown(field, { key: 'Tab', shiftKey: true }); expect(dialog.contains(document.activeElement)).toBe(true)
  fireEvent.click(cancel); expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger)
})
test.each(modalCases)('$operation $open locks pending dismissal and repeated submits while retaining full payload', async item => {
  let finish!: (result: { id: string }) => void
  state.send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const trigger = await openCase(item); const field = screen.getByLabelText(item.field); fireEvent.change(field, { target: { value: item.value } })
  if (item.operation === 'save_delivery') fireEvent.change(screen.getByRole('spinbutton', { name: 'Jumlah dikirim Synthetic tile' }), { target: { value: '2' } })
  const confirm = screen.getByRole('button', { name: item.confirm }); fireEvent.click(confirm); fireEvent.click(confirm)
  await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1)); const dialog = nativeDialog()
  const cancel = screen.getByRole('button', { name: 'Batal' }); await waitFor(() => expect((cancel as HTMLButtonElement).disabled).toBe(true))
  expect((field as HTMLInputElement).disabled).toBe(true); fireEvent.keyDown(dialog, { key: 'Escape' }); fireEvent.click(cancel); fireEvent.click(confirm)
  const nativeCancel = new Event('cancel', { cancelable: true }); dialog.dispatchEvent(nativeCancel)
  expect(nativeCancel.defaultPrevented).toBe(true); expect(screen.getByRole('dialog')).toBe(dialog); expect(state.send).toHaveBeenCalledTimes(1)
  const [operation, payload] = state.send.mock.calls[0]; expect(operation).toBe(item.operation)
  if (item.operation === 'save_delivery') expect(payload.lines).toEqual([{ po_line_item_id: 'line', quantity_delivered: 2 }, { po_line_item_id: 'zero-line', quantity_delivered: 0 }])
  if (item.operation !== 'reject_sales') expect(payload.expected_updated_at).toBe(version)
  else expect(payload).toEqual({ order_id: 'legacy', reason: item.value })
  await act(async () => finish({ id: 'po' })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  if (item.operation !== 'cancel_po') {
    expect(document.activeElement?.isConnected).toBe(true); expect(document.activeElement).not.toBe(trigger)
    expect(document.activeElement?.getAttribute('tabindex')).toBe('-1'); expect(document.activeElement?.closest('#main-content')).toBeTruthy()
  }
})
test.each(modalCases)('$operation $open retains unknown draft and exposes exactly one reachable original-sender recovery', async item => {
  state.send.mockImplementationOnce(async () => { state.unresolved = true; throw new Error('Unknown result') })
  state.reconcile.mockImplementationOnce(async () => { state.unresolved = false; return { state: 'abandoned' } })
  await openCase(item); fireEvent.change(screen.getByLabelText(item.field), { target: { value: item.value } })
  if (item.operation === 'save_delivery') fireEvent.change(screen.getByRole('spinbutton', { name: 'Jumlah dikirim Synthetic tile' }), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: item.confirm })); await screen.findByText('Unknown result')
  const dialog = nativeDialog(), recover = within(dialog).getByRole('button', { name: 'Pulihkan hasil penyimpanan' })
  expect(screen.getAllByRole('button', { name: 'Pulihkan hasil penyimpanan', hidden: true })).toHaveLength(1)
  fireEvent.keyDown(dialog, { key: 'Escape' }); expect(screen.getByRole('dialog')).toBe(dialog)
  expect((screen.getByLabelText(item.field) as HTMLInputElement).value).toBe(item.value)
  fireEvent.click(screen.getByRole('button', { name: item.confirm })); expect(state.send).toHaveBeenCalledTimes(1)
  fireEvent.click(recover); await screen.findByText('Permintaan lama telah dibatalkan. Anda dapat menyimpan kembali.')
  expect(state.acknowledge).not.toHaveBeenCalled(); expect((screen.getByLabelText(item.field) as HTMLInputElement).value).toBe(item.value)
  expect((screen.getByLabelText(item.field) as HTMLInputElement).disabled).toBe(false)
  expect(screen.queryByText(/^Periksa hasil tersimpan \(referensi/)).toBeNull()
})
test('acknowledged rejection uses stable owner focus even before delayed queue refetch removes its opener', async () => {
  await openCase(modalCases[4]); const opener = screen.getByRole('button', { name: 'Tolak', hidden: true })
  fireEvent.change(screen.getByLabelText('Alasan penolakan (wajib)'), { target: { value: 'No stock' } }); fireEvent.click(screen.getByRole('button', { name: 'Tolak Pesanan' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(opener.isConnected).toBe(true); expect(document.activeElement).not.toBe(opener)
  const stable = document.activeElement
  expect(stable?.getAttribute('tabindex')).toBe('-1'); expect(stable?.closest('#main-content')).toBeTruthy()
  expect(stable?.textContent).toContain('Antrean pesanan Sales lama')
  await act(async () => { state.salesStatus = 'rejected'; state.refreshSales?.() })
  expect(opener.isConnected).toBe(false); expect(screen.queryByRole('button', { name: 'Tolak' })).toBeNull(); expect(document.activeElement).toBe(stable)
})
test('legacy approval swaps one native stock dialog and returns to the intact focused owner draft', async () => {
  state.send.mockRejectedValueOnce(warning); mount('sales'); fireEvent.click(screen.getByRole('button', { name: 'Setuju & Buat menjadi PO' }))
  fireEvent.change(screen.getByLabelText('Nomor PO *'), { target: { value: 'APPROVE-PO' } }); fireEvent.change(screen.getByLabelText('Tanggal Kedaluwarsa PO (opsional)'), { target: { value: '2026-10-31' } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm & Create PO' })); await screen.findByRole('dialog', { name: 'Stok promosi tidak mencukupi' }); nativeDialog()
  fireEvent.click(screen.getByRole('button', { name: 'Kembali ke formulir' })); const dialog = nativeDialog()
  expect((screen.getByLabelText('Nomor PO *') as HTMLInputElement).value).toBe('APPROVE-PO'); expect((screen.getByLabelText('Tanggal Kedaluwarsa PO (opsional)') as HTMLInputElement).value).toBe('2026-10-31')
  expect(dialog.contains(document.activeElement)).toBe(true); expect(state.send.mock.calls[0]).toEqual(['approve_sales', { order_id: 'legacy', po_number: 'APPROVE-PO', expected_delivery_date: '2026-10-31' }])
})

// The real data router uses Node Request, which requires a Node-compatible signal.
beforeEach(() => { vi.stubGlobal('AbortController', class { constructor() { return transferableAbortController() } }) })

test('asynchronous SJ preparation retains the invoking button before focus moves elsewhere', async () => {
  let prepared!: (lines: any[]) => void
  state.editDelivery.mockReturnValueOnce(new Promise(resolve => { prepared = resolve }))
  mount('detail'); const opener = screen.getByRole('button', { name: 'Ubah' }); opener.focus(); fireEvent.click(opener)
  screen.getByRole('link', { name: 'Procurement' }).focus()
  await act(async () => prepared([{ po_line_item_id: 'line', quantity_delivered: 1 }]))
  fireEvent.keyDown(nativeDialog(), { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(opener)
})

test('existing PO search and status filters have visible labels associated with the actual controls', () => {
 mount('list'); expectAssociated('Cari PO'); expectAssociated('Status PO')
 expect(screen.getAllByRole('combobox')).toHaveLength(1)
})

test.each(modalCases)('$operation committed recovery keeps the authoritative reference visible after its modal closes', async item => {
 state.send.mockImplementationOnce(async () => { state.unresolved = true; throw new Error('Unknown result') })
 state.reconcile.mockResolvedValueOnce({ state: 'committed', operation: item.operation, result: { id: 'recovered-reference' } })
 await openCase(item); fireEvent.change(screen.getByLabelText(item.field), { target: { value: item.value } })
 if (item.operation === 'save_delivery') fireEvent.change(screen.getByRole('spinbutton', { name: 'Jumlah dikirim Synthetic tile' }), { target: { value: '2' } })
 fireEvent.click(screen.getByRole('button', { name: item.confirm })); await screen.findByText('Unknown result')
 fireEvent.click(within(nativeDialog()).getByRole('button', { name: 'Pulihkan hasil penyimpanan' }))
 await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
 expect(state.acknowledge).toHaveBeenCalledTimes(1); expect(state.send).toHaveBeenCalledTimes(1)
 expect(screen.getByText(/Periksa hasil tersimpan.*recovered-reference/)).toBeTruthy()
 await waitFor(() => expect(document.activeElement?.closest('#main-content')).toBeTruthy())
})

test('a deferred original PO recovery cannot close or attach its receipt to a newer record dialog', async () => {
 let finish!: (result: any) => void
 state.send.mockImplementationOnce(async () => { state.unresolved = true; throw new Error('Unknown result') })
 state.reconcile.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
 const { router } = mount('detail'); fireEvent.click(screen.getByRole('button', { name: '+ Surat Jalan' }))
 fireEvent.change(screen.getByLabelText('Nomor SJ'), { target: { value: 'ORIGINAL-SJ' } }); fireEvent.change(screen.getByRole('spinbutton', { name: 'Jumlah dikirim Synthetic tile' }), { target: { value: '2' } })
 fireEvent.click(screen.getByRole('button', { name: 'Simpan SJ' })); await screen.findByText('Unknown result')
 fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' })); await waitFor(() => expect(state.reconcile).toHaveBeenCalledTimes(1))
 state.po = { ...state.po, id: 'new-po', po_number: 'NEW-PO' }; state.unresolved = false
 await act(async () => router.navigate('/athel/po/new-po'))
 fireEvent.click(screen.getByRole('button', { name: '+ Surat Jalan' })); fireEvent.change(screen.getByLabelText('Nomor SJ'), { target: { value: 'NEWER-SJ' } })
 await act(async () => finish({ state: 'committed', operation: 'save_delivery', result: { id: 'old-reference' } }))
 expect(router.state.location.pathname).toBe('/athel/po/new-po'); expect(nativeDialog()).toBeTruthy()
 expect((screen.getByLabelText('Nomor SJ') as HTMLInputElement).value).toBe('NEWER-SJ'); expect(screen.queryByText(/Periksa hasil tersimpan.*old-reference/)).toBeNull()
 expect(state.acknowledge).toHaveBeenCalledTimes(1)
})
test('a deferred page recovery cannot close a newer legacy rejection presentation or attach its receipt there', async () => {
 let finish!: (result: any) => void
 state.unresolved = true; state.reconcile.mockReturnValueOnce(new Promise(resolve => { finish = resolve })); mount('sales')
 fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' })); await waitFor(() => expect(state.reconcile).toHaveBeenCalledTimes(1))
 fireEvent.click(screen.getByRole('button', { name: 'Tolak' })); const dialog = nativeDialog()
 await act(async () => { state.unresolved = false; finish({ state: 'committed', operation: 'reject_sales', result: { id: 'old-reference' } }) })
 expect(screen.getByRole('dialog')).toBe(dialog); expect(screen.queryByText(/Periksa hasil tersimpan.*old-reference/)).toBeNull()
 expect((screen.getByLabelText('Alasan penolakan (wajib)') as HTMLTextAreaElement).value).toBe(''); expect(state.acknowledge).toHaveBeenCalledTimes(1)
})
test('a receipt is isolated from a changed authenticated sender in the same legacy route', async () => {
 state.send.mockImplementationOnce(async () => { state.unresolved = true; throw new Error('Unknown result') })
 state.reconcile.mockResolvedValueOnce({ state: 'committed', operation: 'reject_sales', result: { id: 'actor-reference' } })
 await openCase(modalCases[4]); fireEvent.change(screen.getByLabelText('Alasan penolakan (wajib)'), { target: { value: 'No stock' } }); fireEvent.click(screen.getByRole('button', { name: 'Tolak Pesanan' })); await screen.findByText('Unknown result')
 fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' })); await screen.findByText(/Periksa hasil tersimpan.*actor-reference/)
 await act(async () => { state.actor = 'next-actor'; state.refreshSales?.() })
 expect(screen.queryByText(/Periksa hasil tersimpan.*actor-reference/)).toBeNull()
})

test.each([
 { state: 'unknown' },
 { state: 'committed', result: { id: '' } },
 { state: 'committed', result: { id: '  ' } },
 { state: 'committed' },
])('unconfirmed or invalid recovery $state cannot publish a confirmed reference', async result => {
 state.send.mockImplementationOnce(async () => { state.unresolved = true; throw new Error('Unknown result') })
 state.reconcile.mockResolvedValueOnce(result)
 await openCase(modalCases[4]); fireEvent.change(screen.getByLabelText('Alasan penolakan (wajib)'), { target: { value: 'Retained reason' } })
 fireEvent.click(screen.getByRole('button', { name: 'Tolak Pesanan' })); await screen.findByText('Unknown result')
 fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' })); await screen.findByText('Hasil belum dapat dipastikan. Jangan buat permintaan baru.')
 expect(nativeDialog()).toBeTruthy(); expect(screen.queryByText(/^Periksa hasil tersimpan \(referensi/)).toBeNull()
 expect(state.acknowledge).not.toHaveBeenCalled(); expect((screen.getByLabelText('Alasan penolakan (wajib)') as HTMLTextAreaElement).value).toBe('Retained reason')
})

test('a deferred recovery from the previous actor cannot close or attach its receipt to the new actor presentation', async () => {
 let finish!: (result: any) => void
 state.unresolved = true; state.reconcile.mockReturnValueOnce(new Promise(resolve => { finish = resolve })); mount('sales')
 fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' })); await waitFor(() => expect(state.reconcile).toHaveBeenCalledTimes(1))
 await act(async () => { state.actor = 'next-actor'; state.unresolved = false; state.refreshSales?.() })
 fireEvent.click(screen.getByRole('button', { name: 'Tolak' })); fireEvent.change(screen.getByLabelText('Alasan penolakan (wajib)'), { target: { value: 'New actor reason' } })
 await act(async () => finish({ state: 'committed', operation: 'reject_sales', result: { id: 'previous-actor-reference' } }))
 expect(nativeDialog()).toBeTruthy(); expect((screen.getByLabelText('Alasan penolakan (wajib)') as HTMLTextAreaElement).value).toBe('New actor reason')
 expect(screen.queryByText(/Periksa hasil tersimpan.*previous-actor-reference/)).toBeNull(); expect(state.acknowledge).toHaveBeenCalledTimes(1)
 expect(state.nextActorSend).not.toHaveBeenCalled()
})

test('deferred page recovery cannot leak its internal reference message into a changed actor on the same route', async () => {
 let finish!: (result: any) => void
 state.unresolved = true; state.reconcile.mockReturnValueOnce(new Promise(resolve => { finish = resolve })); mount('sales')
 fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' })); await waitFor(() => expect(state.reconcile).toHaveBeenCalledTimes(1))
 await act(async () => { state.actor = 'next-actor'; state.unresolved = false; state.refreshSales?.() })
 await act(async () => finish({ state: 'committed', operation: 'reject_sales', result: { id: 'previous-actor-reference' } }))
 expect(screen.queryByText(/Periksa hasil tersimpan.*previous-actor-reference/)).toBeNull()
 expect(state.acknowledge).toHaveBeenCalledTimes(1); expect(state.nextActorSend).not.toHaveBeenCalled()
})

test('deferred page recovery cannot leak its internal reference message into a newer PO record', async () => {
 let finish!: (result: any) => void
 state.unresolved = true; state.reconcile.mockReturnValueOnce(new Promise(resolve => { finish = resolve })); const { router } = mount('detail')
 fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' })); await waitFor(() => expect(state.reconcile).toHaveBeenCalledTimes(1))
 state.po = { ...state.po, id: 'new-po', po_number: 'NEW-PO' }; state.unresolved = false
 await act(async () => router.navigate('/athel/po/new-po'))
 await act(async () => finish({ state: 'committed', operation: 'save_delivery', result: { id: 'previous-record-reference' } }))
 expect(router.state.location.pathname).toBe('/athel/po/new-po'); expect(screen.queryByText(/Periksa hasil tersimpan.*previous-record-reference/)).toBeNull()
 expect(state.acknowledge).toHaveBeenCalledTimes(1)
})

test.each([
 { opener: 'Batalkan PO', title: 'Batalkan SYN-PO?' },
 { opener: 'Batalkan', title: 'Batalkan Surat Jalan?' },
 { opener: 'Ubah tanggal SJ kembali', title: 'Tanggal SJ kembali · SYN-SJ' },
])('$opener supersedes held SJ preparation and remains the sole dialog and original-sender recovery', async ({ opener, title }) => {
 let release!: (lines: any[]) => void
 state.editDelivery.mockReturnValueOnce(new Promise(resolve => { release = resolve })); state.unresolved = true
 mount('detail'); fireEvent.click(screen.getByRole('button', { name: 'Ubah' }))
 const originalSignal = state.editDelivery.mock.calls[0][3] as AbortSignal
 fireEvent.click(screen.getByRole('button', { name: opener })); const currentDialog = screen.getByRole('dialog', { name: title })
 // Assert the ownership transfer before releasing an abort-ignoring transport.
 // Without it, two Dialog focus listeners recurse in jsdom when the read resolves.
 expect(originalSignal.aborted).toBe(true)
 await act(async () => release([{ po_line_item_id: 'line', quantity_delivered: 1 }]))
 expect(screen.getAllByRole('dialog', { hidden: true })).toEqual([currentDialog])
 expect(screen.getAllByRole('button', { name: 'Pulihkan hasil penyimpanan', hidden: true })).toHaveLength(1)
 expect(currentDialog.contains(document.activeElement)).toBe(true)
 expect(state.send).not.toHaveBeenCalled(); expect(state.reconcile).not.toHaveBeenCalled(); expect(state.acknowledge).not.toHaveBeenCalled()
})

test('a released superseded SJ read cannot mount a second dialog or a second original-sender recovery', async () => {
 // Structural ownership probe only. Without native top-layer focus in jsdom,
 // competing pre-fix Dialog focus listeners recurse before we can count them.
 // The neighboring supersession tests separately assert the real focus owner.
 vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(() => {})
 let release!: (lines: any[]) => void
 state.editDelivery.mockReturnValueOnce(new Promise(resolve => { release = resolve })); state.unresolved = true
 mount('detail'); fireEvent.click(screen.getByRole('button', { name: 'Ubah' }))
 fireEvent.click(screen.getByRole('button', { name: 'Batalkan PO' }))
 await act(async () => release([{ po_line_item_id: 'line', quantity_delivered: 1 }]))
 expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(1)
 expect(screen.getAllByRole('button', { name: 'Pulihkan hasil penyimpanan', hidden: true })).toHaveLength(1)
 expect(screen.getByRole('dialog', { name: 'Batalkan SYN-PO?' })).toBeTruthy()
})

test.each(['resolve', 'reject'] as const)('superseded preparation %s cannot clear the loading owner of a newer preparation', async outcome => {
 let releaseOld!: (lines: any[]) => void, rejectOld!: (error: Error) => void, releaseNew!: (lines: any[]) => void
 state.editDelivery.mockReturnValueOnce(new Promise((resolve, reject) => { releaseOld = resolve; rejectOld = reject }))
  .mockReturnValueOnce(new Promise(resolve => { releaseNew = resolve }))
 state.deliveries.push({ ...state.deliveries[0], id: 'new-sj', sj_number: 'NEW-SJ' })
 mount('detail'); fireEvent.click(screen.getAllByRole('button', { name: 'Ubah' })[0])
 const oldSignal = state.editDelivery.mock.calls[0][3] as AbortSignal
 fireEvent.click(screen.getByRole('button', { name: 'Batalkan PO' })); expect(oldSignal.aborted).toBe(true)
 fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
 const newOpener = screen.getAllByRole('button', { name: 'Ubah' })[1]; newOpener.focus(); fireEvent.click(newOpener)
 expect(state.editDelivery).toHaveBeenCalledTimes(2); expect(state.editDelivery.mock.calls[1].slice(0, 3)).toEqual(['po', 'new-sj', version])
 await act(async () => { if (outcome === 'resolve') releaseOld([{ po_line_item_id: 'line', quantity_delivered: 4 }]); else rejectOld(new Error('Old preparation failed')) })
 expect(screen.queryByRole('dialog')).toBeNull(); expect((newOpener as HTMLButtonElement).disabled).toBe(true)
 expect((screen.getByRole('button', { name: '+ Surat Jalan' }) as HTMLButtonElement).disabled).toBe(true)
 expect(screen.queryByText('Data barang atau pengiriman belum lengkap. Pengiriman belum dapat diubah.')).toBeNull()
 await act(async () => releaseNew([{ po_line_item_id: 'line', quantity_delivered: 2 }]))
 const currentDialog = nativeDialog(); expect((screen.getByLabelText('Nomor SJ') as HTMLInputElement).value).toBe('NEW-SJ')
 expect(currentDialog.contains(document.activeElement)).toBe(true)
 fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan SJ' })); await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1))
 expect(state.send.mock.calls[0]).toEqual(['save_delivery', {
  sj_id: 'new-sj', po_id: 'po', expected_updated_at: version, sj_number: 'NEW-SJ', sj_date: '2026-10-01', sj_date_received: null, sj_date_returned: null,
  lines: [{ po_line_item_id: 'line', quantity_delivered: 2 }, { po_line_item_id: 'zero-line', quantity_delivered: 0 }],
 }])
})

test('actor replacement supersedes held preparation before any old delivery draft is adopted', async () => {
 let release!: (lines: any[]) => void
 state.editDelivery.mockReturnValueOnce(new Promise(resolve => { release = resolve })); const { router } = mount('detail')
 fireEvent.click(screen.getByRole('button', { name: 'Ubah' })); const oldSignal = state.editDelivery.mock.calls[0][3] as AbortSignal
 state.actor = 'next-actor'; await act(async () => router.navigate('/athel/po/po'))
 expect(oldSignal.aborted).toBe(true)
 await act(async () => release([{ po_line_item_id: 'line', quantity_delivered: 1 }]))
 expect(screen.queryByRole('dialog')).toBeNull(); expect((screen.getByRole('button', { name: 'Ubah' }) as HTMLButtonElement).disabled).toBe(false)
 expect(state.send).not.toHaveBeenCalled(); expect(state.nextActorSend).not.toHaveBeenCalled()
})

test.each(['detail', 'sales'] as const)('%s item data table retains keyboard scrolling and uses the required 14px style', kind => {
 mount(kind); fireEvent.click(screen.getByRole('button', { name: 'Lihat barang' }))
 const region = screen.getByRole('region', { name: kind === 'detail' ? 'Barang SYN-SJ' : 'Barang pesanan sales' })
 expect(region.getAttribute('tabindex')).toBe('0'); expect(region.classList.contains('overflow-x-auto')).toBe(true)
 const table = within(region).getByRole('table'); expect(table.classList.contains('text-sm')).toBe(true)
 expect(within(table).getByText('Synthetic tile')).toBeTruthy(); expect(within(table).getByText('SYN-1')).toBeTruthy()
})

test.each(['resolve', 'reject'] as const)('accepted page recovery releases held preparation loading before its stale read can %s', async outcome => {
 let release!: (lines: any[]) => void, reject!: (error: Error) => void
 state.editDelivery.mockReturnValueOnce(new Promise((resolve, fail) => { release = resolve; reject = fail })); state.unresolved = true
 state.reconcile.mockResolvedValueOnce({ state: 'committed', operation: 'save_delivery', result: { id: 'recovered-sj' } })
 state.acknowledge.mockImplementationOnce(() => { state.unresolved = false })
 mount('detail'); fireEvent.click(screen.getByRole('button', { name: 'Ubah' }))
 const signal = state.editDelivery.mock.calls[0][3] as AbortSignal
 expect((screen.getByRole('button', { name: '+ Surat Jalan' }) as HTMLButtonElement).disabled).toBe(true)
 fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' })); await screen.findByText(/Periksa hasil tersimpan.*recovered-sj/)
 expect(state.acknowledge).toHaveBeenCalledTimes(1); expect(state.unresolved).toBe(false)
 await act(async () => { if (outcome === 'resolve') release([{ po_line_item_id: 'line', quantity_delivered: 1 }]); else reject(new Error('Old preparation failed')) })
 expect(screen.queryByRole('dialog')).toBeNull()
 expect((screen.getByRole('button', { name: '+ Surat Jalan' }) as HTMLButtonElement).disabled).toBe(false)
 expect((screen.getByRole('button', { name: 'Ubah' }) as HTMLButtonElement).disabled).toBe(false)
 expect(signal.aborted).toBe(true); expect(screen.getByText(/Periksa hasil tersimpan.*recovered-sj/)).toBeTruthy()
 expect(screen.queryByText('Data barang atau pengiriman belum lengkap. Pengiriman belum dapat diubah.')).toBeNull()
 expect(state.send).not.toHaveBeenCalled(); expect(state.acknowledge).toHaveBeenCalledTimes(1)
})

test('a stale older page recovery cannot abort or clear the loading owner of a newer SJ preparation', async () => {
 let finishRecovery!: (result: any) => void, releasePreparation!: (lines: any[]) => void
 state.unresolved = true; state.reconcile.mockReturnValueOnce(new Promise(resolve => { finishRecovery = resolve }))
 state.acknowledge.mockImplementationOnce(() => { state.unresolved = false })
 state.editDelivery.mockReturnValueOnce(new Promise(resolve => { releasePreparation = resolve }))
 mount('detail'); fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' }))
 await waitFor(() => expect(state.reconcile).toHaveBeenCalledTimes(1))
 fireEvent.click(screen.getByRole('button', { name: 'Ubah' })); const signal = state.editDelivery.mock.calls[0][3] as AbortSignal
 await act(async () => finishRecovery({ state: 'committed', operation: 'save_delivery', result: { id: 'older-recovered-sj' } }))
 expect(state.acknowledge).toHaveBeenCalledTimes(1); expect(signal.aborted).toBe(false); expect(screen.queryByRole('dialog')).toBeNull()
 expect((screen.getByRole('button', { name: '+ Surat Jalan' }) as HTMLButtonElement).disabled).toBe(true)
 expect((screen.getByRole('button', { name: 'Ubah' }) as HTMLButtonElement).disabled).toBe(true)
 await act(async () => releasePreparation([{ po_line_item_id: 'line', quantity_delivered: 2 }]))
 const dialog = nativeDialog(); expect((screen.getByLabelText('Nomor SJ') as HTMLInputElement).value).toBe('SYN-SJ')
 expect(dialog.contains(document.activeElement)).toBe(true); expect(within(dialog).queryByText(/older-recovered-sj/)).toBeNull()
 fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan SJ' })); await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1))
 expect(state.send.mock.calls[0]).toEqual(['save_delivery', {
  sj_id: 'sj', po_id: 'po', expected_updated_at: version, sj_number: 'SYN-SJ', sj_date: '2026-10-01', sj_date_received: null, sj_date_returned: null,
  lines: [{ po_line_item_id: 'line', quantity_delivered: 2 }, { po_line_item_id: 'zero-line', quantity_delivered: 0 }],
 }]); expect(state.acknowledge).toHaveBeenCalledTimes(1)
})


test('PO detail SKU remains historical table data at the approved 14px size', () => {
  mount('detail')
  const table = screen.getByRole('table'); expect(table.classList.contains('text-sm')).toBe(true)
  const sku = within(table).getByRole('cell', { name: 'SYN-1' }); expect(sku.classList.contains('text-[13px]')).toBe(false); expect(sku.classList.contains('font-mono')).toBe(true)
  expect(within(table).getByRole('cell', { name: '5' })).toBeTruthy()
})


test.each(['edit-data', 'edit-options', 'detail-lines', 'sales-read'] as const)('%s canvas error keeps a legible red token and existing retry control', async failure => {
  if (failure === 'edit-data' || failure === 'sales-read') state.error = true
  else state.queryErrors = [failure === 'edit-options' ? 'customers' : 'po_line_state']
  mount(failure === 'sales-read' ? 'sales' : failure === 'detail-lines' ? 'detail' : 'edit')
  const copy = await screen.findByText(failure === 'edit-data' ? 'Data PO atau riwayat pengiriman belum dapat dimuat. Pengubahan belum tersedia.' : failure === 'edit-options' ? /Pilihan pelanggan atau produk belum lengkap/ : failure === 'detail-lines' ? /Data barang atau pengiriman belum lengkap/ : 'Gagal memuat pesanan dari sales. Data belum dapat ditampilkan.')
  const alert = copy.closest('[role="alert"]')!
  expect(alert.classList.contains('text-red-700')).toBe(true)
  expect(within(alert as HTMLElement).getByRole('button', { name: 'Coba lagi' }).classList.contains('ui-action')).toBe(true)
})


function expectCompactQuiet(action: HTMLElement, destructive = false) {
  expect(action.classList.contains('ui-action--compact')).toBe(true)
  expect(action.classList.contains(destructive ? 'ui-action--danger-quiet' : 'ui-action--quiet')).toBe(true)
}
test('compact PO list distinguishes quiet view from secondary edit in wrapping desktop and mobile groups', () => {
  mount('list')
  expect(screen.getByRole('link', { name: '+ PO Baru' }).classList.contains('ui-action--primary')).toBe(true)
  const views = screen.getAllByRole('link', { name: 'Lihat' })
  const edits = screen.getAllByRole('link', { name: 'Ubah' })
  expect(views).toHaveLength(8)
  expect(edits).toHaveLength(4)
  for (const link of [...views, ...edits]) {
    expect(link.classList.contains('ui-action--compact')).toBe(true)
    expect(link.classList.contains(link.textContent === 'Lihat' ? 'ui-action--quiet' : 'ui-action--secondary')).toBe(true)
    expect(link.parentElement?.classList.contains('flex')).toBe(true)
    expect(link.parentElement?.classList.contains('flex-wrap')).toBe(true)
    expect(link.className).not.toMatch(/flex-1|mr-3/)
  }
  for (const input of document.querySelectorAll('input, select')) expect(input.className).not.toMatch(/text-base|py-2|px-3/)
})
test.each(['new', 'edit'] as const)('compact %s preserves primary save and quiet back/cancel with token-sized editable controls', async kind => {
  mount(kind); if (kind === 'edit') await screen.findByDisplayValue('Synthetic tile')
  for (const link of screen.getAllByRole('link', { name: /Kembali|Batal/ })) expect(link.classList.contains('ui-action--quiet')).toBe(true)
  const save = screen.getByRole('button', { name: kind === 'new' ? 'Simpan PO' : 'Simpan Perubahan' })
  expect(save.classList.contains('ui-action--primary')).toBe(true)
  for (const input of document.querySelectorAll('input, select, textarea')) expect(input.className).not.toMatch(/min-h-11|text-base|py-2|px-3/)
  for (const lookup of screen.getAllByRole('combobox')) expect(lookup.classList.contains('ui-control')).toBe(true)
  if (kind === 'new') fireEvent.click(screen.getByRole('button', { name: '+ Tambah barang manual' }))
  const remove = screen.getAllByRole('button', { name: /^Hapus / })[0]
  expectCompactQuiet(remove, true)
  remove.focus(); expect(document.activeElement).toBe(remove)
})
test('compact delivery commands stay visible with subdued cancel openers and deliberate final confirmation', () => {
  mount('detail')
  for (const name of ['Lihat barang', 'Ubah tanggal SJ kembali', 'Ubah']) expectCompactQuiet(screen.getByRole('button', { name }))
  for (const name of ['Batalkan', 'Batalkan PO']) expectCompactQuiet(screen.getByRole('button', { name }), true)
  expect(screen.getByRole('button', { name: '+ Surat Jalan' }).classList.contains('ui-action--primary')).toBe(true)
  expect(screen.getByRole('link', { name: '← Kembali' }).classList.contains('ui-action--quiet')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Batalkan' }))
  const dialog = nativeDialog()
  expect(within(dialog).getByRole('button', { name: 'Ya, batalkan' }).classList.contains('ui-action--danger')).toBe(true)
  expect(within(dialog).getByRole('button', { name: 'Batal' }).classList.contains('ui-action--quiet')).toBe(true)
})
test('returned-date raw field adopts density without changing its lock or native date semantics', () => {
  mount('detail'); fireEvent.click(screen.getByRole('button', { name: 'Ubah tanggal SJ kembali' }))
  const input = screen.getByLabelText('Tanggal SJ kembali') as HTMLInputElement
  expect(input.type).toBe('date'); expect(input.classList.contains('ui-control')).toBe(true)
  expect(input.className).not.toMatch(/p-2|py-2|text-base|min-h-11/)
})


test('compact PO fields do not override the shared control radius', () => {
  mount('new'); fireEvent.click(screen.getByRole('button', { name: '+ Tambah barang manual' }))
  for (const input of document.querySelectorAll('input, textarea')) expect(input.classList.contains('rounded-lg')).toBe(false)
})
test('compact PO remove glyph uses shared action typography', () => {
  mount('new'); fireEvent.click(screen.getByRole('button', { name: '+ Tambah barang manual' }))
  expect(screen.getByRole('button', { name: 'Hapus barang baru' }).classList.contains('text-xl')).toBe(false)
})

test('compact PO list reserves desktop action-column room for both frequent native links', () => {
  mount('list')
  const region = screen.getByRole('region', { name: 'Daftar pesanan pembelian' })
  for (const view of within(region).getAllByRole('link', { name: 'Lihat' })) expect(view.closest('td')?.classList.contains('min-w-48')).toBe(true)
})

test('sales-order selected border follows status changes and leaves other filters unmarked', () => {
  state.setFilters.mockImplementation((value: { status: string }) => { state.salesFilter = value.status; state.refreshSales?.() })
  mount('sales')
  const statuses = ['Pending', 'Disetujui', 'Ditolak', 'Dibatalkan', 'Semua'].map(name => screen.getByRole('button', { name }))
  for (const chosen of [statuses[0], statuses[1], statuses[4], statuses[0]]) {
    fireEvent.click(chosen)
    for (const button of statuses) expect(button.classList.contains('border-brand-primary')).toBe(button === chosen)
  }
})
