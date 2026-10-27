import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { customerBackend } from '../helpers/customerBackend'

const state = vi.hoisted(() => ({
  backend: null as any, products: [] as any[], promotions: [] as any[], dashboard: null as any,
  role: 'executive', readError: false, readGate: null as Promise<void> | null,
  writeGate: null as Promise<void> | null, writeError: false, write: vi.fn(), invoke: vi.fn(),
  catalogueReceipts: new Map<string, any>(), catalogueAbandoned: new Set<string>(),
  unresolved: false, customerDelete: false, send: vi.fn(), reconcile: vi.fn(), acknowledge: vi.fn(),
}))
vi.mock('../../src/components/AthelNav', () => ({ default: () => <nav aria-label="Procurement"><a href="/athel/po">Procurement</a></nav> }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, profile: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: state.role, is_active: true }, loading: false, error: null }) }))
vi.mock('../../src/lib/procurementAccess', () => ({ useProcurementAccess: () => ({ ready: true, capabilities: { customer_create: true, customer_edit: true, customer_delete: state.customerDelete, product_create: true, product_edit: true, product_delete: true }, require: () => {} }) }))
vi.mock('../../src/lib/useUnsavedChanges', () => ({ useUnsavedChanges: () => ({ dialog: null }) }))
vi.mock('../../src/lib/promotionTransactions', async original => ({ ...await original<any>(), usePromotionTransactionSender: () => Object.assign(state.send, { hasUnresolved: () => state.unresolved, isInFlight: () => false, reconcile: state.reconcile, acknowledgeRecovered: state.acknowledge }) }))
vi.mock('../../src/lib/promotions', async original => ({ ...await original<any>(), fetchPromotions: async () => { if (state.readGate) await state.readGate; if (state.readError) throw new Error('Read denied'); return state.promotions } }))
vi.mock('../../src/lib/reads/reports', async original => ({ ...await original<any>(), fetchDashboardData: async () => { if (state.readGate) await state.readGate; if (state.readError) throw new Error('Read denied'); return state.dashboard } }))
vi.mock('../../src/components/athel/DashboardCharts', () => ({ default: () => <section aria-label="Synthetic charts">Charts</section> }))
vi.mock('../../src/lib/supabase', () => ({ supabase: {
  supabaseUrl: 'https://catalogue.example.invalid', rest: { url: 'https://catalogue.example.invalid/rest/v1', schemaName: 'public' },
  rpc: (name: string, args: any = {}) => {
    const q: any = { abortSignal: () => q, then: (resolve: any, reject: any) => (async () => {
      if (name === 'pilot_procurement_access_v2') return { data: { version: 2, as_of: '2026-10-15T00:00:00Z', actor_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: state.role,
        customer_create: true, customer_edit: true, customer_delete: state.role === 'co_admin', product_create: true, product_edit: true, product_delete: true,
        customer_set_enabled: true, product_set_enabled: true, customer_delete_mode: state.role === 'co_admin' ? 'guarded' : 'none', product_delete_mode: state.role === 'co_admin' ? 'guarded' : 'direct' }, error: null }
      if (name === 'pilot_catalog_delete_access_v1') return { data: { version: 1, actor_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', customer_delete: state.role === 'co_admin', product_delete: state.role === 'co_admin' }, error: null }
      if (name === 'pilot_catalog_transaction_v1') {
        if (state.catalogueAbandoned.has(args.p_request_id)) return { data: null, error: { message: 'Request abandoned' } }
        const prior = state.catalogueReceipts.get(args.p_request_id)
        if (prior) return prior.operation === args.p_operation && JSON.stringify(prior.payload) === JSON.stringify(args.p_payload)
          ? { data: prior.receipt, error: null } : { data: null, error: { message: 'Request differs' } }
        if (!['executive','po_admin','co_admin'].includes(state.role) || !['create','edit','delete_unused'].includes(args.p_operation) || args.p_operation === 'delete_unused' && state.role !== 'co_admin') return { data: null, error: { message: 'Denied' } }
        const rows = args.p_payload.kind === 'customer' ? state.backend.state.customers : state.products
        let row = rows.find((item: any) => item.id === args.p_payload.id)
        state.write(args.p_operation === 'create' ? 'insert' : args.p_operation === 'delete_unused' ? 'delete' : 'update', args.p_payload.values, args.p_payload.id ?? null)
        if (state.writeGate) await state.writeGate
        if (state.writeError || args.p_payload.kind === 'customer' && state.backend.state.customerResponse === 'denied') return { data: null, error: { message: 'Save failed' } }
        if (args.p_operation !== 'create' && (!row || row.catalog_version !== args.p_payload.expected_version)) return { data: null, error: { details: 'CATALOG_VERSION_CONFLICT' } }
        const before = args.p_operation === 'create' ? null : { catalog_version: row.catalog_version, is_enabled: row.is_enabled }
        if (args.p_operation === 'create') {
          row = { ...args.p_payload.values, id: crypto.randomUUID(), catalog_version: '1', is_enabled: true, ...(args.p_payload.kind === 'product' ? { unit_price: null } : {}) }
          rows.push(row)
        } else if (args.p_operation === 'delete_unused') {
          rows.splice(rows.indexOf(row), 1)
        } else {
          const changed = Object.entries(args.p_payload.values).some(([key, value]) => row[key] !== value)
          Object.assign(row, args.p_payload.values); row.catalog_version = String(BigInt(row.catalog_version) + (changed ? 1n : 0n))
        }
        const receipt = { version: 1, actor_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', request_id: args.p_request_id,
          operation: args.p_operation, kind: args.p_payload.kind, id: row.id, before,
          after: args.p_operation === 'delete_unused' ? null : { catalog_version: row.catalog_version, is_enabled: row.is_enabled }, committed_at: '2026-10-15T00:00:00Z' }
        state.catalogueReceipts.set(args.p_request_id, { operation: args.p_operation, payload: args.p_payload, receipt })
        return { data: receipt, error: null }
      }
      if (name === 'pilot_reconcile_catalog_v1') {
        const prior = state.catalogueReceipts.get(args.p_request_id)
        if (prior) return { data: { status: 'committed', receipt: prior.receipt }, error: null }
        if (args.p_abandon) state.catalogueAbandoned.add(args.p_request_id)
        return { data: { status: state.catalogueAbandoned.has(args.p_request_id) ? 'abandoned' : 'unknown' }, error: null }
      }
      if (name !== 'pilot_catalog_page_v1') throw new Error(`Unexpected catalogue RPC ${name}`)
      if (state.readGate) await state.readGate
      if (state.readError || args.p_kind === 'customer' && state.backend.state.readError) return { data: null, error: new Error('Read denied') }
      const fields = args.p_kind === 'customer' ? ['id','name','address','city','phone','email','pricing_tier','customer_category','is_enabled','catalog_version'] : ['id','name','sku','size','unit_price','harga_pokok','luar_kota','dalam_kota','depo_bangunan','is_enabled','catalog_version']
      const rows = (args.p_kind === 'customer' ? state.backend.state.customers : state.products).map((row: any) => Object.fromEntries(fields.map(field => [field, row[field]]))).sort((a: any, b: any) => a.id.localeCompare(b.id))
        .filter((row: any) => (!args.p_search || row.name.includes(args.p_search)) && (args.p_status === 'all' || row.is_enabled === (args.p_status === 'enabled')))
      return { data: { version: 1, actor_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: state.role, kind: args.p_kind, purpose: args.p_purpose, status: args.p_status, search: args.p_search, page: args.p_page, page_size: args.p_page_size, total_count: String(rows.length), rows: rows.slice((args.p_page - 1) * args.p_page_size, args.p_page * args.p_page_size) }, error: null }
    })().then(resolve, reject) }; return q
  }, functions: { invoke: state.invoke }, auth: { getUser: () => state.backend.auth.getUser() }, from: (table: string) => {
  if (table !== 'products') {
    const q = state.backend.from(table), originalThen = q.then
    let write = false
    for (const operation of ['insert', 'update', 'delete']) { const original = q[operation]; q[operation] = (...args: any[]) => { write = true; return original(...args) } }
    q.then = (resolve: any, reject: any) => (async () => { if (write && state.writeGate) await state.writeGate; if (!write && state.readGate) await state.readGate; return await { then: originalThen } })().then(resolve, reject)
    return q
  }
  let op = 'read', payload: any, id: string | null = null, start = 0, end = Infinity
  const q: any = { select: () => q, order: () => q, or: () => q, abortSignal: () => q,
    range: (a: number, b: number) => { start = a; end = b; return q }, eq: (_key: string, value: string) => { id = value; return q },
    update: (value: any) => { op = 'update'; payload = value; return q }, insert: (value: any) => { op = 'insert'; payload = value; return q }, delete: () => { op = 'delete'; return q },
    then: (resolve: any, reject: any) => (async () => {
      if (op === 'read') { if (state.readGate) await state.readGate; if (state.readError) return { data: null, count: null, error: new Error('Read denied') } }
      else {
        state.write(op, payload, id)
        if (state.writeGate) await state.writeGate
        if (state.writeError) return { data: null, error: new Error('Save failed') }
        if (op === 'delete') state.products = state.products.filter(row => row.id !== id)
        if (op === 'update') state.products = state.products.map(row => row.id === id ? { ...row, ...payload } : row)
      }
      return { data: state.products.slice(start, end + 1), count: state.products.length, error: null }
    })().then(resolve, reject),
  }; return q
} } }))

import CustomerList from '../../src/pages/athel/CustomerList'
import ProductList from '../../src/pages/athel/ProductList'
import Promotions from '../../src/pages/athel/Promotions'
import Dashboard from '../../src/pages/athel/Dashboard'
import CustomerCategorySelect from '../../src/components/CustomerCategorySelect'
import PromotionImage from '../../src/components/PromotionImage'
import { monthlyOptions } from '../../src/components/athel/dashboardChartOptions'

const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id = '11111111-1111-4111-8111-111111111111'
const product = () => ({ id, is_enabled: true, catalog_version: '1', name: 'Unset product', sku: 'TEST', size: null, unit_price: 17, harga_pokok: null, luar_kota: 12.34, dalam_kota: 999999999999.99, depo_bangunan: 0 })
const promotion = () => ({ id, product_id: id, product_name: 'Tiles', sku: 'SKU', size: null, start_date: '2020-01-01', end_date: '2020-01-02', is_active: true, stock_managed: true, remaining_quantity: 3, stock_version: 1, image_path: `promotions/${actor}/${id}/22222222-2222-4222-8222-222222222222.png`, harga_pokok: null, luar_kota: 0, dalam_kota: 71, depo_bangunan: null })
const clients: QueryClient[] = []
beforeEach(() => {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (name: string, _options: unknown, action: any) => action({ name, mode: 'exclusive' }) } })
  state.catalogueReceipts.clear(); state.catalogueAbandoned.clear()
  onlineManager.setOnline(true); state.backend = customerBackend(); Object.assign(state.backend.state.customers[0], { id: '22222222-2222-4222-8222-222222222222', is_enabled: true, catalog_version: '1' }); state.products = [product()]; state.promotions = [promotion()]
  state.role = 'executive'; state.readError = false; state.readGate = null; state.writeGate = null; state.writeError = false; state.unresolved = false; state.customerDelete = false
  state.write.mockReset(); state.send.mockReset().mockResolvedValue({ id, stock_version: 2 }); state.reconcile.mockReset(); state.acknowledge.mockReset()
  state.invoke.mockReset().mockResolvedValue({ data: { promotion_id: id, signed_url: 'https://example.invalid/image', expires_in: 300 }, error: null })
  state.dashboard = { metrics: { totalPOCount: 0, totalPOValue: '0', deliveredValue: '0', outstandingValue: '0', averagePOValue: '0', completedPOCount: 0 }, customerShare: [], monthlySeries: [], dailySeries: [], statusBreakdown: [], topCustomers: [], outstandingItems: [] }
  vi.spyOn(window, 'confirm').mockReturnValue(true); localStorage.clear()
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); onlineManager.setOnline(true); vi.restoreAllMocks(); localStorage.clear() })
function mount(Page: React.ComponentType) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client)
  const view = render(<QueryClientProvider client={client}><Page /></QueryClientProvider>); return { ...view, client }
}
function associated(label: string) {
  const control = screen.getByLabelText(label) as HTMLInputElement
  expect(control.id).not.toBe(''); expect(control.labels?.length).toBe(1)
  expect(control.labels?.[0].htmlFor).toBe(control.id); expect(control.closest('.ui-field')).toBeTruthy(); return control
}
function oneMain() {
  expect(document.querySelectorAll('main')).toHaveLength(1); expect(document.querySelectorAll('#main-content')).toHaveLength(1)
  expect(document.querySelector('main main')).toBeNull(); expect(document.querySelector('#main-content')?.getAttribute('tabindex')).toBe('-1')
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }

const immediatePaths = [
  { kind: 'product', Page: ProductList, loaded: 'Unset product', action: 'save' },
  { kind: 'product', Page: ProductList, loaded: 'Unset product', action: 'delete' },
  { kind: 'customer', Page: CustomerList, loaded: 'Alpha shop', action: 'save' },
  { kind: 'customer', Page: CustomerList, loaded: 'Alpha shop', action: 'delete' },
] as const
async function openImmediatePath(path: typeof immediatePaths[number]) {
  // Customer removal uses current CO guarded authority; product removal stays native.
  state.customerDelete = path.kind === 'customer' && path.action === 'delete'
  if (state.customerDelete) state.role = 'co_admin'
  const view = mount(path.Page); await screen.findAllByText(path.loaded)
  const opener = screen.getAllByRole('button', { name: path.action === 'save' ? 'Ubah' : path.kind === 'customer' ? 'Hapus bila tidak digunakan' : 'Hapus' })[0]
  await waitFor(() => expect((opener as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(opener)
  if (path.kind === 'customer' && path.action === 'save') fireEvent.change(associated('Nama Pelanggan *'), { target: { value: 'Edited shop' } })
  const dialog = screen.getByRole('dialog')
  return { ...view, dialog, target: within(dialog).getByRole('button', { name: path.action === 'save' ? 'Simpan' : path.kind === 'customer' ? 'Konfirmasi Hapus' : 'Hapus' }) }
}
test.each(immediatePaths)('$kind $action immediately acquires one owner lock before notifications and blocks unsafe dismissal', async path => {
  const { client, dialog, target } = await openImmediatePath(path), gate = deferred(); state.writeGate = gate.promise
  const cancel = within(dialog).getByRole('button', { name: 'Batal' }), nativeCancel = new Event('cancel', { cancelable: true })
  act(() => {
    fireEvent.click(target); fireEvent.click(target); fireEvent.click(cancel)
    fireEvent.keyDown(dialog, { key: 'Escape' }); dialog.dispatchEvent(nativeCancel)
  })
  const started = client.getMutationCache().getAll().length, retained = screen.queryByRole('dialog')
  const guarded = path.kind === 'customer' && path.action === 'delete'
  if (guarded) await waitFor(() => expect(state.write).toHaveBeenCalledOnce())
  await act(async () => gate.resolve())
  if (guarded) expect(state.write).toHaveBeenCalledOnce(); else expect(started).toBe(1)
  expect(retained).toBe(dialog); expect(nativeCancel.defaultPrevented).toBe(true)
})
test.each(immediatePaths)('$kind $action releases its owner lock without bypassing durable recovery', async path => {
  const { client, dialog, target } = await openImmediatePath(path), gate = deferred(); state.writeGate = gate.promise
  state.writeError = true; state.backend.state.customerResponse = 'denied'
  act(() => { fireEvent.click(target); fireEvent.click(target) })
  await act(async () => gate.resolve())
  const guarded = path.kind === 'customer' && path.action === 'delete'
  if (guarded) await waitFor(() => expect(state.write).toHaveBeenCalledOnce())
  else expect(client.getMutationCache().getAll()).toHaveLength(1)
  if (path.action === 'save' || guarded) {
    await screen.findByText('Hasil belum terkonfirmasi')
    if (guarded) await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); else expect(screen.getByRole('dialog')).toBe(dialog)
    expect(localStorage.length).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' })); await screen.findByText(/Hasil belum diketahui/)
    if (guarded) expect(state.write).toHaveBeenCalledOnce(); else expect(client.getMutationCache().getAll()).toHaveLength(1)
    state.writeGate = null; state.writeError = false; state.backend.state.customerResponse = 'ok'
    fireEvent.click(screen.getByRole('button', { name: 'Batalkan permintaan tersimpan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi pembatalan permintaan' }))
    await waitFor(() => expect(screen.queryByText('Hasil belum terkonfirmasi')).toBeNull())
    expect(localStorage.length).toBe(0)
    if (guarded) {
      const opener = screen.getAllByRole('button', { name: 'Hapus bila tidak digunakan' })[0]
      await waitFor(() => expect((opener as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(opener)
    } else {
      expect(screen.getByRole('dialog')).toBe(dialog)
      if (path.kind === 'customer') expect(associated('Nama Pelanggan *').value).toBe('Edited shop')
    }
    const retry = screen.getByRole('button', { name: guarded ? 'Konfirmasi Hapus' : 'Simpan' })
    await waitFor(() => expect((retry as HTMLButtonElement).disabled).toBe(false))
    act(() => { fireEvent.click(retry); fireEvent.click(retry) })
  } else {
    await within(dialog).findByRole('alert')
    state.writeGate = null; state.writeError = false; state.backend.state.customerResponse = 'ok'
    const retry = within(dialog).getByRole('button', { name: 'Hapus' }); act(() => { fireEvent.click(retry); fireEvent.click(retry) })
  }
  if (guarded) await waitFor(() => expect(state.write).toHaveBeenCalledTimes(2))
  else expect(client.getMutationCache().getAll()).toHaveLength(2)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  if (guarded) {
    await screen.findByText('Hasil belum terkonfirmasi')
    fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' }))
    await waitFor(() => expect(screen.queryByText('Hasil belum terkonfirmasi')).toBeNull())
    expect(localStorage.length).toBe(0); expect(state.write).toHaveBeenCalledTimes(2)
    expect(state.backend.state.customers).toHaveLength(0)
  }
})

test('catalog and dashboard SKU table data retain the required 14px size', async () => {
  const catalog = mount(ProductList); await screen.findAllByText('Unset product')
  const sku = within(screen.getByRole('region', { name: 'Daftar barang' })).getByText('TEST')
  expect(sku.tagName).toBe('TD'); expect(sku.classList.contains('text-[13px]')).toBe(false); expect(sku.classList.contains('text-sm')).toBe(true)
  catalog.unmount(); state.dashboard.outstandingItems = [{ rank: 1, sku: 'SKU', productName: 'Product p', outstandingQty: 25, outstandingValue: '1000000' }]
  mount(Dashboard); await screen.findByRole('heading', { name: 'Rincian Barang Belum Terkirim' })
  const dashboardSKU = within(screen.getByRole('region', { name: 'Tabel Rincian Barang Belum Terkirim' })).getByText('SKU', { selector: 'td' })
  expect(dashboardSKU.tagName).toBe('TD'); expect(dashboardSKU.classList.contains('text-[13px]')).toBe(false); expect(dashboardSKU.classList.contains('text-sm')).toBe(true)
})

test.each([['customers', CustomerList, 'Alpha shop'], ['products', ProductList, 'Unset product'], ['promotions', Promotions, 'Tiles'], ['dashboard', Dashboard, 'Rata-rata Nilai PO']] as const)('%s owns one main after navigation in ready and unavailable states', async (_kind, Page, loaded) => {
  const view = mount(Page); await screen.findAllByText(loaded); oneMain()
  view.unmount(); onlineManager.setOnline(false); mount(Page); oneMain()
})
test('denied promotion administration retains one main without catalog reads', () => {
  state.role = 'sales_head'; mount(Promotions); oneMain(); expect(screen.getByRole('alert')).toBeTruthy(); expect(screen.queryByRole('button', { name: /Tambah Promosi/ })).toBeNull()
})
test.each([['customers', CustomerList, '0 pelanggan', 'Tidak ada pelanggan ditemukan.'], ['products', ProductList, '0 barang', 'Tidak ada barang ditemukan.']] as const)('%s cold paused read does not fabricate a zero total or verified empty list', (_kind, Page, zero, empty) => {
  onlineManager.setOnline(false); mount(Page)
  expect(screen.queryByText(zero)).toBeNull(); expect(screen.queryByText(empty)).toBeNull()
  expect(screen.getByRole('status').textContent).toMatch(/menunggu|tertunda|koneksi/i)
})
test('dashboard cold paused read has explicit unavailable feedback rather than a silent or fabricated zero dashboard', () => {
  onlineManager.setOnline(false); mount(Dashboard)
  expect(screen.queryByText('Rp0')).toBeNull(); expect(screen.queryByText('Charts')).toBeNull()
  expect(screen.getByRole('status').textContent).toMatch(/menunggu|tertunda|koneksi/i)
})
test.each([['customers', CustomerList, 'athel_customers', '0 pelanggan'], ['products', ProductList, 'products', '0 barang']] as const)('%s authoritative empty total is available while cached refresh is paused', async (kind, Page, key, zero) => {
  if (kind === 'customers') state.backend.state.customers = []; else state.products = []
  const { client } = mount(Page); await screen.findByText(zero)
  onlineManager.setOnline(false); await act(async () => { void client.invalidateQueries({ queryKey: [key === 'athel_customers' || key === 'products' ? 'catalogue' : key] }) })
  expect(screen.getByText(zero)).toBeTruthy(); await waitFor(() => expect(screen.getAllByRole('status').some(notice => /menunggu|tertunda|koneksi/i.test(notice.textContent ?? ''))).toBe(true))
  expect(screen.queryByText(/Halaman 1.*1/)).toBeNull()
})
test('products expose read failure and a native retry instead of a verified empty result', async () => {
  state.readError = true; mount(ProductList)
  const alert = await screen.findByRole('alert'); expect(alert.textContent).toMatch(/belum dapat|gagal/i)
  expect(screen.queryByText('Tidak ada barang ditemukan.')).toBeNull()
  const retry = within(alert).getByRole('button', { name: 'Coba lagi' }); expect(retry.classList.contains('ui-action')).toBe(true)
  state.readError = false; fireEvent.click(retry); await screen.findAllByText('Unset product')
})
test.each([['customer', CustomerList, '+ Tambah Pelanggan', ['Nama Pelanggan *', 'Alamat', 'Kota', 'Telepon', 'Email']], ['product', ProductList, '+ Tambah Barang', ['SKU *', 'Ukuran', 'Nama Barang *']]] as const)('%s editor labels reach actual fields and cancellation returns to its opener', async (_kind, Page, button, labels) => {
  mount(Page); const trigger = await screen.findByRole('button', { name: button }); await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false)); trigger.focus(); fireEvent.click(trigger)
  const dialog = screen.getByRole('dialog'); expect(dialog.tagName).toBe('DIALOG'); expect(dialog.classList.contains('ui-dialog')).toBe(true)
  for (const label of labels) associated(label)
  expect(dialog.contains(document.activeElement)).toBe(true); expect(trigger.closest('[inert]')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Batal' })); expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger)
})
test('category instances keep unique associated fields and explicit category-versus-tier help', () => {
  render(<><CustomerCategorySelect value="" allowUnclassified={false} onChange={() => {}} /><CustomerCategorySelect value={null} allowUnclassified onChange={() => {}} /></>)
  const selects = screen.getAllByRole('combobox'); expect(new Set(selects.map(control => control.id)).size).toBe(2)
  for (const control of selects) { expect(control.closest('.ui-field')).toBeTruthy(); expect(document.getElementById(control.getAttribute('aria-describedby')!)?.textContent).toContain('Pilih menurut jenis dan skala usaha pelanggan') }
})
test('catalogue metadata remains identifiable without exposing or rewriting legacy prices', async () => {
  state.products.push({ ...product(), id: '33333333-3333-4333-8333-333333333333', sku: 'OTHER', size: '30x60' }); mount(ProductList); await screen.findAllByText('Unset product')
  const table = screen.getByRole('region', { name: 'Daftar barang' }), mobile = screen.getByRole('list', { name: 'Daftar barang seluler' })
  expect(within(table).getAllByRole('row')).toHaveLength(3); expect(within(mobile).getAllByRole('listitem')).toHaveLength(2)
  for (const scope of [table, mobile]) { expect(within(scope).getByText('TEST')).toBeTruthy(); expect(within(scope).getByText('OTHER')).toBeTruthy(); expect(within(scope).queryByText('Rp 0')).toBeNull() }
  fireEvent.click(within(table).getAllByRole('button', { name: 'Ubah' })[0]); expect(screen.queryAllByRole('spinbutton')).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Simpan' })); await waitFor(() => expect(state.write).toHaveBeenCalledOnce())
  for (const key of ['harga_pokok','luar_kota','dalam_kota','depo_bangunan','unit_price']) expect(state.write.mock.calls[0][1]).not.toHaveProperty(key)
})

test('duplicate customer labels retain category, tier and branch identity in desktop rows and mobile cards', async () => {
  state.backend.state.customers.push({ ...state.backend.state.customers[0], id: '33333333-3333-4333-8333-333333333333', city: 'Surabaya', phone: '123', customer_category: 'perorangan', pricing_tier: 'others' })
  mount(CustomerList); await screen.findAllByText('Alpha shop')
  const table = screen.getByRole('region', { name: 'Daftar pelanggan' }), mobile = screen.getByRole('list', { name: 'Daftar pelanggan seluler' })
  expect(within(table).getAllByRole('row')).toHaveLength(3); expect(within(mobile).getAllByRole('listitem')).toHaveLength(2)
  for (const scope of [table, mobile]) { expect(within(scope).getByText('Jakarta')).toBeTruthy(); expect(within(scope).getByText('Surabaya')).toBeTruthy(); expect(within(scope).getByText('Unclassified')).toBeTruthy(); expect(within(scope).getByText('Perorangan')).toBeTruthy() }
  for (const card of within(mobile).getAllByRole('listitem')) expect(within(card).getByRole('button', { name: 'Ubah' }).classList.contains('ui-action')).toBe(true)
})
test('a catalog filter retains previous results with an explicit refresh message until the new exact empty result arrives', async () => {
  mount(ProductList); await screen.findAllByText('Unset product'); const gate = deferred(); state.readGate = gate.promise
  fireEvent.change(screen.getByLabelText('Cari barang'), { target: { value: 'no-match' } })
  await screen.findByText('Memperbarui data… Menampilkan hasil sebelumnya sampai selesai.')
  expect(screen.getByText('1 barang')).toBeTruthy(); expect(screen.queryByText('0 barang')).toBeNull(); expect(screen.queryByText('Tidak ada barang ditemukan.')).toBeNull()
  state.products = []; await act(async () => gate.resolve()); await screen.findByText('0 barang'); expect(screen.getAllByText('Tidak ada barang ditemukan.')).toHaveLength(2)
})
test('product dialog blocks pending dismissal and duplicate submit, then uses stable success focus across delayed refetch', async () => {
  mount(ProductList); await screen.findAllByText('Unset product'); const trigger = screen.getAllByRole('button', { name: 'Ubah' })[0]; trigger.focus(); fireEvent.click(trigger)
  const gate = deferred(); state.writeGate = gate.promise; const refetch = deferred(); state.readGate = refetch.promise
  const save = screen.getByRole('button', { name: 'Simpan' }); fireEvent.click(save); await waitFor(() => expect(state.write).toHaveBeenCalledOnce())
  const dialog = screen.getByRole('dialog'), cancel = screen.getByRole('button', { name: 'Batal' })
  expect((cancel as HTMLButtonElement).disabled).toBe(true); expect(associated('SKU *').disabled).toBe(true)
  fireEvent.keyDown(dialog, { key: 'Escape' }); fireEvent.click(cancel); fireEvent.click(save); expect(screen.getByRole('dialog')).toBe(dialog); expect(state.write).toHaveBeenCalledOnce()
  const nativeCancel = new Event('cancel', { cancelable: true }); dialog.dispatchEvent(nativeCancel); expect(nativeCancel.defaultPrevented).toBe(true)
  await act(async () => gate.resolve()); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const destination = document.activeElement; expect(destination).not.toBe(trigger); expect(destination?.getAttribute('tabindex')).toBe('-1'); expect(destination?.closest('#main-content')).toBeTruthy()
  state.products = []; await act(async () => refetch.resolve()); await waitFor(() => expect(screen.queryByText('Unset product')).toBeNull()); expect(document.activeElement).toBe(destination)
})
test('product delete dialog retains failure, exposes retry and restores cancellation focus', async () => {
  mount(ProductList); await screen.findAllByText('Unset product'); const trigger = screen.getAllByRole('button', { name: 'Hapus' })[0]; trigger.focus(); fireEvent.click(trigger)
  const dialog = screen.getByRole('dialog'); state.writeError = true; fireEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }))
  expect((await within(dialog).findByRole('alert')).textContent).toContain('Save failed'); expect(within(dialog).getByRole('button', { name: 'Hapus' })).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Batal' })); expect(document.activeElement).toBe(trigger)
})
test('an open product dialog keeps a failed background read and its retry reachable', async () => {
  const { client } = mount(ProductList); await screen.findAllByText('Unset product'); fireEvent.click(screen.getAllByRole('button', { name: 'Ubah' })[0])
  state.readError = true; await act(async () => { await client.invalidateQueries({ queryKey: ['catalogue'] }) })
  const dialog = screen.getByRole('dialog'), alert = await within(dialog).findByRole('alert')
  expect((within(dialog).getByRole('button', { name: 'Simpan' }) as HTMLButtonElement).disabled).toBe(true)
  state.readError = false; fireEvent.click(within(alert).getByRole('button', { name: 'Coba lagi' }))
  await waitFor(() => expect((within(dialog).getByRole('button', { name: 'Simpan' }) as HTMLButtonElement).disabled).toBe(false))
  expect(associated('SKU *').value).toBe('TEST')
})
test('customer pending save locks category and contact fields while preserving the existing three-prop category interface', async () => {
  mount(CustomerList); await screen.findAllByText('Alpha shop'); fireEvent.click(screen.getAllByRole('button', { name: 'Ubah' })[0])
  const gate = deferred(); state.writeGate = gate.promise; state.backend.state.customerResponse = 'denied'
  fireEvent.change(associated('Nama Pelanggan *'), { target: { value: 'Edited shop' } }); fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
  await waitFor(() => expect((screen.getByRole('button', { name: 'Batal' }) as HTMLButtonElement).disabled).toBe(true))
  const category = screen.getByRole('combobox', { name: /Kategori Pelanggan/ }) as HTMLSelectElement
  expect(category.disabled || category.closest('fieldset')?.disabled).toBe(true); expect(associated('Telepon').disabled).toBe(true)
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); expect(screen.getByRole('dialog')).toBeTruthy()
  await act(async () => gate.resolve()); await screen.findByText('Hasil belum terkonfirmasi'); expect(screen.getByRole('dialog')).toBeTruthy(); expect(localStorage.length).toBe(1)
  expect(associated('Nama Pelanggan *').value).toBe('Edited shop'); expect(associated('Telepon').disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Simpan' }) as HTMLButtonElement).disabled).toBe(true)
  expect(state.write.mock.calls[0][1]).toMatchObject({ name: 'Edited shop' })
})
test('customer successful edit keeps focus on its stable owner destination when delayed refresh removes the old row', async () => {
  mount(CustomerList); await screen.findAllByText('Alpha shop'); const trigger = screen.getAllByRole('button', { name: 'Ubah' })[0]; trigger.focus(); fireEvent.click(trigger)
  fireEvent.change(associated('Nama Pelanggan *'), { target: { value: 'Edited shop' } }); const gate = deferred(); state.readGate = gate.promise
  fireEvent.click(screen.getByRole('button', { name: 'Simpan' })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const destination = document.activeElement; expect(destination).not.toBe(trigger); expect(destination?.getAttribute('tabindex')).toBe('-1'); expect(destination?.closest('#main-content')).toBeTruthy()
  state.backend.state.customers = []; await act(async () => gate.resolve()); await screen.findByText('0 pelanggan'); expect(document.activeElement).toBe(destination)
})
test('product successful deletion locks pending controls and retains stable focus after delayed row removal', async () => {
  mount(ProductList); await screen.findAllByText('Unset product'); const trigger = screen.getAllByRole('button', { name: 'Hapus' })[0]; trigger.focus(); fireEvent.click(trigger)
  const gate = deferred(), refresh = deferred(); state.writeGate = gate.promise; state.readGate = refresh.promise
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Hapus' })); await waitFor(() => expect(state.write).toHaveBeenCalledOnce())
  expect((screen.getByRole('button', { name: 'Batal' }) as HTMLButtonElement).disabled).toBe(true); fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); expect(screen.getByRole('dialog')).toBeTruthy()
  await act(async () => gate.resolve()); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); const destination = document.activeElement
  expect(destination).not.toBe(trigger); expect(destination?.getAttribute('tabindex')).toBe('-1'); await act(async () => refresh.resolve()); await screen.findByText('0 barang'); expect(document.activeElement).toBe(destination)
})
test('inline promotion fields, prices and managed stock retain their meanings with shared native actions', async () => {
  mount(Promotions); await screen.findByText('Tiles'); const stock = screen.getByText('Stok tersedia: 3'); expect(stock).toBeTruthy()
  const status = screen.getByText('Berjalan'); expect(status.closest('.ui-status-badge')).toBeTruthy(); expect(status.closest('[role="status"]')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Tambah Promosi/ })); expect(screen.queryByRole('dialog')).toBeNull()
  for (const label of ['Produk', 'Stok awal', 'Gambar promosi']) associated(label)
  expect(screen.getByRole('button', { name: 'Simpan promosi' }).classList.contains('ui-action')).toBe(true)
})
test('unknown inline promotion result preserves manual price and one reachable original-sender recovery', async () => {
  state.send.mockImplementationOnce(async () => { state.unresolved = true; throw new Error('Unknown promotion result') })
  mount(Promotions); await screen.findByText('Tiles'); fireEvent.click(screen.getByRole('button', { name: 'Ubah gambar' }))
  fireEvent.click(screen.getByRole('button', { name: 'Simpan promosi' })); await screen.findByText('Unknown promotion result')
  expect(screen.queryByLabelText('Luar Kota (Rp)')).toBeNull(); expect(screen.getAllByRole('button', { name: 'Pulihkan hasil penyimpanan' })).toHaveLength(1); expect(screen.queryByRole('dialog')).toBeNull()
  expect((screen.getByRole('button', { name: 'Simpan promosi' }) as HTMLButtonElement).disabled).toBe(true); fireEvent.click(screen.getByRole('button', { name: 'Simpan promosi' })); expect(state.send).toHaveBeenCalledOnce()
})
test('linked image render failure uses safe shared feedback and canonical retry', async () => {
  const Image = () => <PromotionImage promotion={promotion() as any} />; mount(Image)
  const image = await screen.findByRole('img', { name: 'Promosi Tiles' }); fireEvent.error(image)
  const notice = screen.getByText('Gambar belum dapat dimuat.').closest('.ui-notice'); expect(notice).toBeTruthy()
  const retry = screen.getByRole('button', { name: 'Coba gambar lagi' }); expect(retry.classList.contains('ui-action')).toBe(true)
  fireEvent.click(retry); await screen.findByRole('img'); expect(state.invoke).toHaveBeenCalledTimes(2); expect(notice?.textContent).not.toContain('https://')
})
test('dashboard filter labels use the shared field system without changing authoritative zero and undefined average semantics', async () => {
  mount(Dashboard); await screen.findByText('Rata-rata Nilai PO'); for (const label of ['Tanggal awal', 'Tanggal akhir', 'Status PO', 'Status pengiriman']) associated(label)
  expect(screen.getByText('Rata-rata Nilai PO').parentElement?.textContent).toContain('Belum tersedia'); expect(screen.getAllByText('Rp0')).toHaveLength(3)
})
test('chart typography uses the approved self-hosted family and readable supporting size with unchanged values', () => {
  const option: any = monthlyOptions([{ key: '2026-09', label: 'Sep 2026', poValue: '12.34', deliveredValue: '0' }], {})
  expect(option.textStyle.fontFamily).toContain('Plus Jakarta Sans'); expect(option.textStyle.fontSize).toBeGreaterThanOrEqual(13); expect(option.tooltip.textStyle.fontSize).toBeGreaterThanOrEqual(13)
  expect(option.series.map((series: any) => series.data)).toEqual([[12.34], [0]])
})


test.each([{ Page: ProductList, loaded: 'Unset product', add: '+ Tambah Barang' }, { Page: CustomerList, loaded: 'Alpha shop', add: '+ Tambah Pelanggan' }])('catalog $loaded desktop/mobile actions retain compact hierarchy and final delete emphasis', async ({ Page, loaded, add }) => {
  state.customerDelete = Page === CustomerList
  if (state.customerDelete) state.role = 'co_admin'
  mount(Page); await screen.findAllByText(loaded)
  expect(screen.getByRole('button', { name: add }).classList.contains('ui-action--primary')).toBe(true)
  for (const action of screen.getAllByRole('button', { name: /^(Ubah|Hapus(?: bila tidak digunakan)?)$/ })) {
    expect(action.classList.contains('ui-action--compact')).toBe(true)
    expect(action.classList.contains(action.textContent?.startsWith('Hapus') ? 'ui-action--danger-quiet' : 'ui-action--quiet')).toBe(true)
    if (action.textContent === 'Hapus bila tidak digunakan') expect(action.closest('.flex-wrap')).toBeTruthy()
    else expect(action.parentElement?.classList.contains('flex-wrap')).toBe(true)
  }
  const remove = screen.getAllByRole('button', { name: state.customerDelete ? 'Hapus bila tidak digunakan' : 'Hapus' })[0]
  await waitFor(() => expect((remove as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(remove)
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByRole('button', { name: state.customerDelete ? 'Konfirmasi Hapus' : 'Hapus' }).classList.contains('ui-action--danger')).toBe(true)
  expect(within(dialog).getByRole('button', { name: 'Batal' }).classList.contains('ui-action--quiet')).toBe(true)
})
test('catalogue rows have no obsolete price disclosure', async () => {
  mount(ProductList); await screen.findAllByText('Unset product')
  expect(screen.queryByRole('button', { name: 'Lihat semua harga ▼' })).toBeNull()
  expect(screen.getAllByRole('button', { name: 'Ubah' })).toHaveLength(2)
})

test('promotion support actions are compact while explicit stock/save commits retain primary emphasis', async () => {
  mount(Promotions); await screen.findByText('Tiles')
  for (const name of ['Ubah gambar', 'Sesuaikan stok', 'Jeda']) {
    const action = screen.getByRole('button', { name }); expect(action.classList.contains('ui-action--compact')).toBe(true); expect(action.classList.contains('ui-action--quiet')).toBe(true)
  }
  fireEvent.click(screen.getByRole('button', { name: 'Sesuaikan stok' }))
  expect(screen.getByRole('button', { name: 'Simpan penyesuaian' }).classList.contains('ui-action--primary')).toBe(true)
  expect(screen.getByRole('button', { name: 'Batal' }).classList.contains('ui-action--quiet')).toBe(true)
  expect(associated('Perubahan stok').getAttribute('type')).toBe('number')
})
