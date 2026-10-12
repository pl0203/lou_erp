import { transferableAbortController } from 'node:util'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ poStatus: 'confirm', completedAt: null as string | null, audits: [] as any[], lines: [] as any[], send: vi.fn(), navigate: vi.fn(), setFilters: vi.fn(), setPage: vi.fn() }))
vi.mock('../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../src/components/TransactionRecovery', () => ({ default: () => null }))
vi.mock('../src/lib/orderTransactions', () => ({ useTransactionSender: () => Object.assign(state.send, { hasUnresolved: () => false }) }))
vi.mock('../src/lib/reads/usePagedRead', () => ({ usePagedRead: (name: string, filters: any) => ({ data: { items: name === 'po_audit_log' ? state.audits : name === 'purchase_orders' ? [{ id: 'po', po_number: 'PO-1', status: 'confirm', total_value: '10000', order_date: '2026-10-10', customers: { name: 'Toko Cabang Timur' } }] : [], total: 1, page: 1, page_size: 10, status_counts: {} }, filters, page: 1, isPending: false, isError: false, setFilters: state.setFilters, setPage: state.setPage }) }))
vi.mock('@tanstack/react-query', async original => ({ ...await original<any>(), useQuery: ({ queryKey }: any) => ({ data: queryKey[0] === 'po' ? { id: 'po', po_number: 'PO-1', status: state.poStatus, completed_at: state.completedAt, updated_at: 'v1', total_value: 10000, order_date: '2026-10-10', customers: { name: 'Toko Cabang Timur' } } : queryKey[0] === 'po_line_state' ? { items: state.lines, po_updated_at: 'v1' } : [], isFetching: false, isError: false, refetch: vi.fn() }) }))
import PODetail from '../src/pages/athel/PODetail'
import POList from '../src/pages/athel/POList'
import MyOrders from '../src/pages/girard/MyOrders'
import CustomerCategorySelect from '../src/components/CustomerCategorySelect'
const clients: QueryClient[] = []
function mount(Page: () => any) { const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }); clients.push(client); const router = createMemoryRouter([{ path: '/athel/po', element: <Page /> }, { path: '/athel/po/:id', element: <Page /> }, { path: '/girard/orders', element: <Page /> }], { initialEntries: [Page === POList ? '/athel/po' : Page === PODetail ? '/athel/po/po' : '/girard/orders'] }); routers.push(router); return render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>) }
beforeEach(() => { state.poStatus = 'confirm'; state.completedAt = null; state.audits = []; state.lines = [{ id: 'line', product_name: 'Barang A', sku: 'A', quantity: 5, delivered_quantity: 0, unit_price: '2000', line_total: '10000' }]; state.send.mockReset(); state.navigate.mockReset() })
const routers: ReturnType<typeof createMemoryRouter>[] = []
afterEach(() => { cleanup(); vi.unstubAllGlobals(); routers.splice(0).forEach(router => router.dispose()); clients.splice(0).forEach(client => client.clear()) })

test('PO detail uses shared Indonesian status names and readable business dates', () => {
 mount(PODetail)
 expect(screen.getByRole('heading', { name: 'Rincian Pesanan' })).toBeTruthy()
 expect(screen.getAllByText('Dikonfirmasi')).toHaveLength(2)
 expect(screen.getByText('10 Oktober 2026')).toBeTruthy()
 expect(screen.queryByText('Confirm')).toBeNull()
})

test('full SJ previews completion before save and distinguishes shipment from receipt and document return', () => {
 mount(PODetail)
 fireEvent.click(screen.getByRole('button', { name: '+ Surat Jalan' }))
 expect(screen.getByRole('heading', { name: 'Surat Jalan Baru' })).toBeTruthy()
 expect(screen.getByText(/Diterima berarti/)).toBeTruthy()
 expect(screen.getByText(/SJ kembali berarti/)).toBeTruthy()
 expect(screen.queryByText(/PO akan berstatus Selesai/)).toBeNull()
 fireEvent.change(screen.getByRole('spinbutton', { name: 'Jumlah dikirim Barang A' }), { target: { value: '5' } })
 expect(screen.getByText(/PO akan berstatus Selesai/)).toBeTruthy()
 expect(screen.getByText(/tanggal penerimaan belum diisi/)).toBeTruthy()
 expect(state.send).not.toHaveBeenCalled()
 fireEvent.change(screen.getByRole('spinbutton', { name: 'Jumlah dikirim Barang A' }), { target: { value: '4' } })
 expect(screen.queryByText(/PO akan berstatus Selesai/)).toBeNull()
 expect(screen.getByText(/Masih ada sisa barang/)).toBeTruthy()
})

test('PO audits present actor action and localized status while keeping exact raw data in closed details', () => {
 const raw = '[{"id":"uuid-line-123","product_name":"Barang A","quantity":5}]'
 state.audits = [
  { id: 'a', field_changed: 'status', old_value: 'confirm', new_value: 'complete', changed_at: '2026-10-10T01:23:45Z', users: { full_name: 'Admin PO' } },
  { id: 'b', field_changed: 'po_items_revised', old_value: '[]', new_value: raw, changed_at: '2026-10-10T01:23:45Z', users: { full_name: 'Admin PO' } },
  { id: 'c', field_changed: 'unexpected_event', old_value: null, new_value: '{broken-json', changed_at: '2026-10-10T01:23:45Z', users: null },
 ]
 const { container } = mount(PODetail)
 expect(screen.getByText(/Admin PO mengubah status PO dari Dikonfirmasi menjadi Selesai/)).toBeTruthy()
 expect(screen.getByText('Admin PO memperbarui daftar barang PO.')).toBeTruthy()
 expect(screen.getByText(/Pengguna tercatat memperbarui data PO/)).toBeTruthy()
 const details = Array.from(container.querySelectorAll('details'))
 expect(details).toHaveLength(3)
 expect(details.every(detail => !detail.open)).toBe(true)
 expect(details[1].textContent).toContain(raw)
 expect(details[2].textContent).toContain('{broken-json')
 expect(screen.getAllByText(/10 Oktober 2026.*01.23.45 UTC/)).toHaveLength(3)
})

test('desktop PO actions remain sticky and overflow guidance is visible before the table', () => {
 mount(POList)
 const region = screen.getByRole('region', { name: 'Daftar pesanan pembelian' })
 expect(screen.getByText(/Geser tabel.*kolom Aksi tetap terlihat/)).toBeTruthy()
 expect(within(region).getByRole('columnheader', { name: 'Aksi' }).className).toContain('sticky')
 expect(within(region).getByRole('link', { name: 'Lihat' }).closest('td')!.className).toContain('right-0')
 expect(within(region).getByText('Toko Cabang Timur').className).toContain('min-w-')
})

test('Sales order history explains the Admin PO handoff without offering inaccessible creation', () => {
 mount(MyOrders)
 expect(screen.getByRole('heading', { name: 'Pesanan baru: serahkan ke Admin PO' })).toBeTruthy()
 expect(screen.getByText(/saluran kerja yang biasa digunakan/)).toBeTruthy()
 expect(screen.getByText(/Nama pelanggan.*cabang/)).toBeTruthy()
 expect(screen.getByText(/SKU.*jumlah.*harga/)).toBeTruthy()
 expect(screen.queryByRole('button', { name: /PO Baru|Buat Pesanan|Kirim/ })).toBeNull()
 expect(screen.queryByRole('link', { name: /Procurement|Pengadaan/ })).toBeNull()
})

test('customer classification guidance makes category independent of the pricing tier', () => {
 render(<CustomerCategorySelect value="" allowUnclassified={false} onChange={vi.fn()} />)
 expect(screen.getByText(/jenis dan skala usaha/)).toBeTruthy()
 expect(screen.getByText(/Kategori tidak mengubah tier harga/)).toBeTruthy()
 const select = screen.getByRole('combobox', { name: 'Kategori Pelanggan *' })
 expect(select.getAttribute('aria-describedby')).toBeTruthy()
})

test('an already-complete PO with no remaining quantity does not preview itself as incomplete', () => {
 state.poStatus = 'complete'
 state.completedAt = new Date().toISOString()
 state.lines[0].delivered_quantity = 5
 mount(PODetail)
 fireEvent.click(screen.getByRole('button', { name: '+ Surat Jalan' }))
 expect(screen.getByText('PO saat ini berstatus Selesai.')).toBeTruthy()
 expect(screen.getByText('Tidak ada sisa jumlah barang untuk surat jalan baru.')).toBeTruthy()
 expect(screen.queryByText(/Masih ada sisa barang/)).toBeNull()
 expect(screen.queryByText(/PO belum selesai/)).toBeNull()
 expect((screen.getByRole('spinbutton', { name: 'Jumlah dikirim Barang A' }) as HTMLInputElement).disabled).toBe(true)
 expect(state.send).not.toHaveBeenCalled()
})

// The real data router uses Node Request, which requires a Node-compatible signal.
beforeEach(() => { vi.stubGlobal('AbortController', class { constructor() { return transferableAbortController() } }) })
