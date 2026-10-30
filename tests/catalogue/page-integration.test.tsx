import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// These tests exercise the real backend adapter, authority hook and durable sender.
// Only the Supabase boundary, auth provider and native browser lock are synthetic.
const state = vi.hoisted(() => ({
  actor: '11111111-1111-4111-8111-111111111111', role: 'co_admin', backend: 'https://catalogue.example.invalid',
  customers: [] as any[], products: [] as any[], receipts: new Map<string, any>(), abandoned: new Set<string>(),
  command: vi.fn(), writes: vi.fn(), reads: vi.fn(), authority: vi.fn(),
  lostReply: false, historyDenied: false, missingRpc: false, conflict: false, deny: false, ready: true, commandGate: null as Promise<void> | null,
  readGate: null as Promise<void> | null, readinessGate: null as Promise<void> | null, count: null as string | null, client: null as any,
}))
vi.mock('../../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: state.actor }, profile: { id: state.actor, role: state.role, is_active: true }, loading: false, error: null }) }))
vi.mock('../../src/lib/supabase', () => {
  const supabase = {
    supabaseUrl: state.backend, rest: { url: `${state.backend}/rest/v1`, schemaName: 'public' },
    rpc(name: string, args: any = {}) {
      const operation = async () => {
        const maintainer = ['co_admin', 'po_admin', 'executive'].includes(state.role)
        const co = state.role === 'co_admin', granted = maintainer && !state.deny
        if (name === 'pilot_procurement_access_v1') return { data: { version: 1, as_of: '2026-10-15T00:00:00Z', actor_id: state.actor, role: state.role,
          customer_create: granted && !co, customer_edit: granted && !co, customer_delete: false,
          product_create: granted && !co, product_edit: granted && !co, product_delete: granted && !co }, error: null }
        if (name === 'pilot_procurement_access_v2') {
          state.authority()
          return { data: { version: 2, as_of: '2026-10-15T00:00:00Z', actor_id: state.actor, role: state.role,
            customer_create: granted, customer_edit: granted, customer_delete: granted && co,
            product_create: granted, product_edit: granted, product_delete: granted,
            customer_set_enabled: granted, product_set_enabled: granted,
            customer_delete_mode: granted && co ? 'guarded' : 'none', product_delete_mode: granted ? co ? 'guarded' : 'direct' : 'none' }, error: null }
        }
        if (name === 'pilot_catalog_delete_access_v1') {
          if (state.readinessGate) await state.readinessGate
          return { data: { version: 1, actor_id: state.actor, customer_delete: granted && co && state.ready, product_delete: granted && co && state.ready }, error: null }
        }
        if (name === 'pilot_catalog_page_v1') {
          state.reads(args)
          if (state.historyDenied && args.p_purpose === 'all-for-history') return { data: null, error: { message: 'denied' } }
          if (state.readGate) await state.readGate
          let rows = [...(args.p_kind === 'customer' ? state.customers : state.products)].sort((a, b) => a.id.localeCompare(b.id))
          rows = rows.filter(row => (!args.p_search || row.name.includes(args.p_search)) && (args.p_status === 'all' || row.is_enabled === (args.p_status === 'enabled')))
          return { data: { version: 1, actor_id: state.actor, role: state.role, kind: args.p_kind, purpose: args.p_purpose,
            status: args.p_status, search: args.p_search, page: args.p_page, page_size: args.p_page_size,
            total_count: state.count ?? String(rows.length), rows: rows.slice((args.p_page - 1) * args.p_page_size, args.p_page * args.p_page_size) }, error: null }
        }
        if (name === 'pilot_catalog_transaction_v1') {
          state.command(args)
          if (state.missingRpc) return { data: null, error: { code: 'PGRST202', message: 'missing' } }
          if (state.conflict) return { data: null, error: { details: 'CATALOG_VERSION_CONFLICT' } }
          const rows = args.p_payload.kind === 'customer' ? state.customers : state.products
          let target = rows.find(row => row.id === args.p_payload.id)
          const before = args.p_operation === 'create' ? null : { catalog_version: target.catalog_version, is_enabled: target.is_enabled }
          if (args.p_operation === 'create') {
            target = { ...args.p_payload.values, id: crypto.randomUUID(), catalog_version: '1', is_enabled: true,
              ...(args.p_payload.kind === 'product' ? { unit_price: null } : {}) }
            rows.push(target)
          } else if (args.p_operation === 'edit') {
            const changed = Object.entries(args.p_payload.values).some(([key, value]) => target[key] !== value)
            Object.assign(target, args.p_payload.values)
            target.catalog_version = String(BigInt(target.catalog_version) + (changed ? 1n : 0n))
          } else if (args.p_operation === 'delete_unused') {
            rows.splice(rows.indexOf(target), 1)
          } else {
            target.catalog_version = String(BigInt(target.catalog_version) + (target.is_enabled === args.p_payload.is_enabled ? 0n : 1n))
            target.is_enabled = args.p_payload.is_enabled
          }
          const receipt = { version: 1, request_id: args.p_request_id, actor_id: state.actor, operation: args.p_operation,
            kind: args.p_payload.kind, id: target.id, before, after: args.p_operation === 'delete_unused' ? null : { catalog_version: target.catalog_version, is_enabled: target.is_enabled }, committed_at: '2026-10-15T00:00:00Z' }
          state.receipts.set(args.p_request_id, receipt)
          if (state.commandGate) await state.commandGate
          if (state.lostReply) throw new Error('response lost')
          return { data: receipt, error: null }
        }
        if (name === 'pilot_reconcile_catalog_v1') {
          if (args.p_abandon && !state.receipts.has(args.p_request_id)) state.abandoned.add(args.p_request_id)
          return { data: state.receipts.has(args.p_request_id) ? { status: 'committed', receipt: state.receipts.get(args.p_request_id) }
            : { status: state.abandoned.has(args.p_request_id) ? 'abandoned' : 'unknown' }, error: null }
        }
        throw new Error(`Unexpected RPC: ${name}`)
      }
      let signal: AbortSignal | undefined
      const request = { abortSignal(value: AbortSignal) { signal = value; return request }, then(resolve: any, reject: any) {
        return Promise.resolve().then(() => { signal?.throwIfAborted(); return operation() }).then(resolve, reject)
      } }
      return request
    },
    from(table: string) { state.writes(table); throw new Error('No table writes are allowed in status tests') },
  }
  return { get supabase() { return state.client ?? supabase } }
})
import CustomerList from '../../src/pages/athel/CustomerList'
import ProductList from '../../src/pages/athel/ProductList'
import { catalogueKeys } from '../../src/lib/catalogue/queryKeys'
import { useCataloguePage } from '../../src/lib/catalogue/useCataloguePage'
import { supabase } from '../../src/lib/supabase'

const uuid = (index: number) => `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`
const version = '9007199254740993'
const customer = (index: number) => ({ id: uuid(index), name: `Customer ${index}`, address: null, city: 'Jakarta', phone: null, email: null, pricing_tier: 'others', customer_category: null, catalog_version: version, is_enabled: true })
const product = (index: number) => ({ id: uuid(index), name: `Product ${index}`, sku: `SKU-${index}`, size: null, unit_price: 17, harga_pokok: null, luar_kota: 12.34, dalam_kota: 20, depo_bangunan: 0, catalog_version: version, is_enabled: true })
const clients: QueryClient[] = []
function deferred() { let resolve!: () => void; return { promise: new Promise<void>(done => { resolve = done }), resolve: () => resolve() } }
function mount(Page: React.ComponentType, client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })) {
  clients.push(client)
  return { client, ...render(<QueryClientProvider client={client}><Page /></QueryClientProvider>) }
}
beforeEach(() => {
  state.actor = '11111111-1111-4111-8111-111111111111'; state.role = 'co_admin'; state.customers = [customer(1)]; state.products = [product(1)]
  state.receipts.clear(); state.abandoned.clear(); state.command.mockClear(); state.writes.mockClear(); state.reads.mockClear(); state.authority.mockClear()
  state.lostReply = false; state.historyDenied = false; state.ready = true; state.missingRpc = false; state.conflict = false; state.deny = false; state.commandGate = null; state.readGate = null; state.readinessGate = null; state.count = null; state.client = null
  localStorage.clear()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (name: string, _options: unknown, action: any) => action({ name, mode: 'exclusive' }) } })
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); localStorage.clear(); vi.restoreAllMocks(); onlineManager.setOnline(true) })

const pages = [
  { Page: CustomerList, kind: 'customer', desktop: 'Daftar pelanggan', mobile: 'Daftar pelanggan seluler', name: 'Customer 1' },
  { Page: ProductList, kind: 'product', desktop: 'Daftar barang', mobile: 'Daftar barang seluler', name: 'Product 1' },
] as const
async function begin(desktop: string) {
  const region = await screen.findByRole('region', { name: desktop })
  const button = within(region).getAllByRole('button', { name: 'Nonaktifkan' })[0]
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(button)
  const confirm = screen.getByRole('button', { name: 'Konfirmasi Nonaktifkan' })
  fireEvent.click(confirm); fireEvent.click(confirm)
}

describe.each(pages)('$kind status page integration', ({ Page, kind, desktop, mobile }) => {
  it.each(['co_admin', 'po_admin', 'executive'])('offers guarded deletion only for the current CO delete mode (%s)', async role => {
    state.role = role; mount(Page)
    for (const scope of [await screen.findByRole('region', { name: desktop }), screen.getByRole('list', { name: mobile })]) {
      expect(within(scope).getByText('Aktif')).toBeTruthy()
      await waitFor(() => expect((within(scope).getByRole('button', { name: 'Nonaktifkan' }) as HTMLButtonElement).disabled).toBe(false))
      await waitFor(() => expect((within(scope).getByRole('button', { name: 'Hapus bila tidak digunakan' }) as HTMLButtonElement).disabled).toBe(role !== 'co_admin'))
    }
    if (role === 'co_admin') expect(screen.getAllByRole('button', { name: 'Ubah' })).toHaveLength(2)
    await begin(desktop)
    await waitFor(() => expect(within(screen.getByRole('region', { name: desktop })).getByText('Nonaktif')).toBeTruthy())
    expect(state.command).toHaveBeenCalledOnce()
    expect(state.command.mock.calls[0][0]).toMatchObject({ p_operation: 'set_enabled', p_payload: { kind, expected_version: version, is_enabled: false } })
    await waitFor(() => expect(screen.queryByText('Hasil belum terkonfirmasi')).toBeNull())
    expect(localStorage.length).toBe(0); expect(state.writes).not.toHaveBeenCalled()
    expect(state.authority.mock.calls.length).toBeGreaterThan(2)
    expect(within(screen.getByRole('region', { name: desktop })).getByText('Nonaktif')).toBeTruthy()
  })
  it.each(['sales_person', 'sales_manager', 'sales_head'])('does not grant status commands to %s', async role => {
    state.role = role; mount(Page); await screen.findByRole('region', { name: desktop })
    expect(screen.queryByRole('button', { name: 'Nonaktifkan' })).toBeNull(); expect(state.command).not.toHaveBeenCalled()
  })
  it('does not fall back to tables when the command RPC is missing', async () => {
    state.missingRpc = true; mount(Page); await begin(desktop)
    await screen.findByText('Hasil belum terkonfirmasi'); expect(state.command).toHaveBeenCalledOnce(); expect(state.writes).not.toHaveBeenCalled()
  })
  it('fails closed without native cross-context locks', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }); mount(Page)
    const region = await screen.findByRole('region', { name: desktop })
    expect((within(region).getByRole('button', { name: 'Nonaktifkan' }) as HTMLButtonElement).disabled).toBe(true); expect(state.command).not.toHaveBeenCalled()
  })
})

it('keeps one recovery owner after a row leaves the filter and never invalidates saved PO/CO history', async () => {
  state.lostReply = true // A committed write with a lost response must still require recovery.
  // These unobserved sentinels must survive normal cache GC to test invalidation.
  const { client } = mount(CustomerList, new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }))
  const histories = [['purchase_orders'], ['co', state.backend, state.actor, state.role, 'history']] as const
  histories.forEach(key => client.setQueryData(key, { saved: true }))
  await begin('Daftar pelanggan'); await screen.findByText('Hasil belum terkonfirmasi')
  fireEvent.change(screen.getByLabelText('Status pelanggan'), { target: { value: 'enabled' } })
  await screen.findAllByText('Tidak ada pelanggan ditemukan.')
  expect(screen.getAllByText('Hasil belum terkonfirmasi')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' }))
  await waitFor(() => expect(screen.queryByText('Hasil belum terkonfirmasi')).toBeNull())
  expect(state.reads).toHaveBeenCalledWith(expect.objectContaining({ p_kind: 'customer', p_purpose: 'all-for-history', p_status: 'all', p_search: '' }))
  histories.forEach(key => { expect(client.getQueryData(key)).toEqual({ saved: true }); expect(client.getQueryState(key)?.isInvalidated).toBe(false) })
})
it('recovers a product attempt after unmount on the customer page without resending', async () => {
  const gate = deferred(); state.commandGate = gate.promise
  const first = mount(ProductList); await begin('Daftar barang'); await waitFor(() => expect(state.command).toHaveBeenCalledOnce())
  first.unmount(); mount(CustomerList); await screen.findByText('Hasil belum terkonfirmasi')
  await act(async () => gate.resolve())
  const recover = screen.getByRole('button', { name: 'Periksa hasil' })
  await waitFor(() => expect((recover as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(recover)
  await waitFor(() => expect(screen.queryByText('Hasil belum terkonfirmasi')).toBeNull())
  expect(state.reads).toHaveBeenCalledWith(expect.objectContaining({ p_kind: 'product', p_purpose: 'all-for-history' }))
  expect(state.command).toHaveBeenCalledOnce(); expect(localStorage.length).toBe(0)
})
it('requires explicit terminal abandonment after a definitive stale-version refusal', async () => {
  state.conflict = true; mount(CustomerList); await begin('Daftar pelanggan'); await screen.findByText('Hasil belum terkonfirmasi')
  fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' })); await screen.findByText(/Hasil belum diketahui/)
  expect(localStorage.length).toBe(1)
  fireEvent.click(screen.getByRole('button', { name: 'Batalkan permintaan tersimpan' }))
  expect(localStorage.length).toBe(1)
  fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi pembatalan permintaan' }))
  await waitFor(() => expect(screen.queryByText('Hasil belum terkonfirmasi')).toBeNull())
  expect(localStorage.length).toBe(0); expect(state.command).toHaveBeenCalledOnce()
  await waitFor(() => expect((within(screen.getByRole('region', { name: 'Daftar pelanggan' })).getByRole('button', { name: 'Nonaktifkan' }) as HTMLButtonElement).disabled).toBe(false))
})
it('never acknowledges a canonical read older than its receipt and accepts a newer version without overwriting it', async () => {
  const gate = deferred(); state.commandGate = gate.promise
  mount(CustomerList); await begin('Daftar pelanggan'); await waitFor(() => expect(state.command).toHaveBeenCalledOnce())
  state.customers[0].catalog_version = version; state.customers[0].is_enabled = true
  await act(async () => gate.resolve()); await screen.findByText('Hasil belum terkonfirmasi')
  fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' })); await screen.findByText('Data terbaru belum dapat diverifikasi. Periksa hasil kembali.')
  expect(localStorage.length).toBe(1)
  state.customers[0].catalog_version = '9007199254740995'
  fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' }))
  await waitFor(() => expect(screen.queryByText('Hasil belum terkonfirmasi')).toBeNull())
  expect(state.customers[0].is_enabled).toBe(true); expect(state.customers[0].catalog_version).toBe('9007199254740995')
})
it('retains recovery when storage cannot durably acknowledge', async () => {
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked') })
  mount(CustomerList); await begin('Daftar pelanggan'); await screen.findByText('Hasil belum terkonfirmasi')
  fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' })); await screen.findByText(/Pemulihan belum berhasil/)
  expect(localStorage.length).toBe(1); expect(state.command).toHaveBeenCalledOnce()
})
it('loses authority before confirmation without dispatching', async () => {
  const { client } = mount(CustomerList)
  const region = await screen.findByRole('region', { name: 'Daftar pelanggan' })
  await waitFor(() => expect((within(region).getByRole('button', { name: 'Nonaktifkan' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(within(region).getByRole('button', { name: 'Nonaktifkan' }))
  state.deny = true
  await act(async () => { await client.invalidateQueries({ queryKey: catalogueKeys.authority({ backend: state.backend, actorId: state.actor, role: 'co_admin' }) }) })
  fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi Nonaktifkan' })); expect(state.command).not.toHaveBeenCalled()
})
it('rejects a stale confirmation rather than rebasing onto a newer row', async () => {
  const { client } = mount(CustomerList)
  const region = await screen.findByRole('region', { name: 'Daftar pelanggan' })
  await waitFor(() => expect((within(region).getByRole('button', { name: 'Nonaktifkan' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(within(region).getByRole('button', { name: 'Nonaktifkan' }))
  state.customers[0].catalog_version = '9007199254740994'
  const gate = deferred(); state.readGate = gate.promise
  let refresh!: Promise<void>
  await act(async () => { refresh = client.invalidateQueries({ queryKey: ['catalogue'] }) })
  const confirm = screen.getByRole('button', { name: 'Konfirmasi Nonaktifkan' })
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(true))
  state.readGate = null
  await act(async () => { gate.resolve(); await refresh })
  const key = catalogueKeys.read({ backend: state.backend, actorId: state.actor, role: 'co_admin' },
    { kind: 'customer', purpose: 'catalogue', status: 'all', search: '', page: 1, page_size: 10 })
  await waitFor(() => {
    expect(client.getQueryData<{ page: { rows: { catalog_version: string }[] } }>(key)?.page.rows[0].catalog_version).toBe('9007199254740994')
    expect((confirm as HTMLButtonElement).disabled).toBe(false)
  })
  fireEvent.click(confirm)
  await screen.findByText(/Data berubah. Batalkan/); expect(state.command).not.toHaveBeenCalled()
})
it('product rows preserve status controls while obsolete price disclosure is absent', async () => {
  mount(ProductList); const mobile = await screen.findByRole('list', { name: 'Daftar barang seluler' })
  expect(screen.queryByRole('button', { name: /Lihat semua harga/ })).toBeNull()
  expect(within(mobile).queryByText('Rp 0')).toBeNull(); expect(within(mobile).queryByText('Rp 12,34')).toBeNull()
  expect(screen.getByLabelText('Status barang')).toBeTruthy()
})

it('old controller callbacks cannot revive across actor A-B-A', async () => {
  let controller!: ReturnType<typeof useCataloguePage<'customer'>>
  function Probe() { controller = useCataloguePage({ kind: 'customer', search: '', page: 1, pageSize: 10, status: 'all' }); return null }
  const view = mount(Probe); await waitFor(() => expect(controller.authority?.customer_set_enabled).toBe(true))
  const old = controller.sender!, owner = controller.owner!
  state.actor = '33333333-3333-4333-8333-333333333333'; view.rerender(<QueryClientProvider client={view.client}><Probe /></QueryClientProvider>)
  state.actor = '11111111-1111-4111-8111-111111111111'; view.rerender(<QueryClientProvider client={view.client}><Probe /></QueryClientProvider>)
  await waitFor(() => expect(controller.authority?.customer_set_enabled).toBe(true))
  expect(owner.isCurrent()).toBe(false)
  await expect(old('set_enabled', { kind: 'customer', id: uuid(1), expected_version: version as any, is_enabled: false })).rejects.toThrow()
  expect(state.command).not.toHaveBeenCalled()
})

it('keeps recovery reachable while moving to a different catalogue page', async () => {
  state.lostReply = true // A committed write with a lost response must still require recovery.
  state.customers = Array.from({ length: 12 }, (_, index) => customer(index + 1))
  mount(CustomerList); await begin('Daftar pelanggan'); await screen.findByText('Hasil belum terkonfirmasi')
  fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }))
  await screen.findAllByText('Customer 11')
  expect(screen.queryByText('Customer 1')).toBeNull(); expect(screen.getAllByText('Hasil belum terkonfirmasi')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' }))
  await waitFor(() => expect(screen.queryByText('Hasil belum terkonfirmasi')).toBeNull())
  expect(state.command).toHaveBeenCalledOnce()
})
it('does not dispatch when recovery storage cannot persist the request', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable') })
  mount(CustomerList); await begin('Daftar pelanggan')
  await screen.findByText('Perubahan belum terkonfirmasi. Periksa hasil di bagian pemulihan katalog.')
  expect(state.command).not.toHaveBeenCalled(); expect(state.writes).not.toHaveBeenCalled()
})
it('refuses an otherwise validated count that cannot be represented safely by pagination controls', async () => {
  state.customers = Array.from({ length: 10 }, (_, index) => customer(index + 1)); state.count = '9007199254740993'
  mount(CustomerList); await screen.findByRole('alert')
  expect(screen.queryByText('0 pelanggan')).toBeNull(); expect(screen.queryByText('Customer 1')).toBeNull(); expect(state.command).not.toHaveBeenCalled()
})
it('old controller callbacks cannot revive across backend A-B-A', async () => {
  let controller!: ReturnType<typeof useCataloguePage<'customer'>>
  function Probe() { controller = useCataloguePage({ kind: 'customer', search: '', page: 1, pageSize: 10, status: 'all' }); return null }
  const view = mount(Probe); await waitFor(() => expect(controller.authority?.customer_set_enabled).toBe(true))
  const original = supabase, old = controller.sender!, owner = controller.owner!
  state.client = { ...original, supabaseUrl: 'https://other.example.invalid', rest: { url: 'https://other.example.invalid/rest/v1', schemaName: 'public' } }
  view.rerender(<QueryClientProvider client={view.client}><Probe /></QueryClientProvider>)
  state.client = original; view.rerender(<QueryClientProvider client={view.client}><Probe /></QueryClientProvider>)
  await waitFor(() => expect(controller.authority?.customer_set_enabled).toBe(true))
  expect(owner.isCurrent()).toBe(false)
  await expect(old('set_enabled', { kind: 'customer', id: uuid(1), expected_version: version as any, is_enabled: false })).rejects.toThrow()
  expect(state.command).not.toHaveBeenCalled()
})

it('keeps terminal abandonment recoverable across unmount before canonical refresh finishes', async () => {
  state.conflict = true
  const first = mount(CustomerList); await begin('Daftar pelanggan'); await screen.findByText('Hasil belum terkonfirmasi')
  const gate = deferred(); state.readGate = gate.promise
  fireEvent.click(screen.getByRole('button', { name: 'Batalkan permintaan tersimpan' }))
  fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi pembatalan permintaan' }))
  await waitFor(() => expect(JSON.parse(localStorage.getItem(localStorage.key(0)!)!).abandoned).toBe(true))
  first.unmount()
  mount(ProductList); await screen.findByText('Hasil belum terkonfirmasi')
  state.readGate = null; await act(async () => gate.resolve())
  await waitFor(() => expect((screen.getByRole('button', { name: 'Periksa hasil' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' }))
  await waitFor(() => expect(screen.queryByText('Hasil belum terkonfirmasi')).toBeNull())
  expect(localStorage.length).toBe(0); expect(state.command).toHaveBeenCalledOnce()
})


it.each(pages)('saves $kind edits through the durable RPC with the captured decimal version', async ({ Page, kind, desktop }) => {
  mount(Page)
  const region = await screen.findByRole('region', { name: desktop })
  const edit = within(region).getByRole('button', { name: 'Ubah' })
  await waitFor(() => expect((edit as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(edit)
  fireEvent.change(screen.getByLabelText(kind === 'customer' ? 'Nama Pelanggan *' : 'Nama Barang *'), { target: { value: 'Renamed by CO' } })
  fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
  await screen.findByText('Hasil belum terkonfirmasi')
  expect(state.command).toHaveBeenCalledOnce()
  expect(state.command.mock.calls[0][0]).toMatchObject({ p_operation: 'edit', p_payload: { kind, id: uuid(1), expected_version: version, values: { name: 'Renamed by CO' } } })
  expect(state.command.mock.calls[0][0].p_payload.values).not.toHaveProperty('unit_price')
  expect(state.writes).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' }))
  await waitFor(() => expect(screen.queryByText('Hasil belum terkonfirmasi')).toBeNull())
  expect(localStorage.length).toBe(0)
})
it('creates a product through the receipt contract, never a raw insert', async () => {
  mount(ProductList)
  const add = await screen.findByRole('button', { name: '+ Tambah Barang' })
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(add)
  fireEvent.change(screen.getByLabelText('Nama Barang *'), { target: { value: 'New product' } })
  fireEvent.change(screen.getByLabelText('SKU *'), { target: { value: 'new-01' } })
  fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
  await screen.findByText('Hasil belum terkonfirmasi')
  expect(state.command).toHaveBeenCalledOnce()
  expect(state.command.mock.calls[0][0]).toMatchObject({ p_operation: 'create', p_payload: { kind: 'product', values: { name: 'New product', sku: 'NEW-01', harga_pokok: null } } })
  expect(state.command.mock.calls[0][0].p_payload).not.toHaveProperty('id')
  expect(state.command.mock.calls[0][0].p_payload.values).not.toHaveProperty('unit_price')
  fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' }))
  await waitFor(() => expect(screen.queryByText('Hasil belum terkonfirmasi')).toBeNull())
  expect(localStorage.length).toBe(0); expect(state.writes).not.toHaveBeenCalled()
})
it.each([['customer', CustomerList, 'Nama Pelanggan *', 'Daftar pelanggan'], ['product', ProductList, 'Nama Barang *', 'Daftar barang']] as const)('keeps refused %s draft frozen with keyboard-accessible recovery until explicit abandonment', async (kind, Page, nameLabel, regionLabel) => {
  mount(Page)
  const region = await screen.findByRole('region', { name: regionLabel })
  const edit = within(region).getByRole('button', { name: 'Ubah' })
  await waitFor(() => expect((edit as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(edit); state.conflict = true
  const name = screen.getByLabelText(nameLabel) as HTMLInputElement
  fireEvent.change(name, { target: { value: 'Attempt' } })
  const originalVersion = (kind === 'customer' ? state.customers : state.products)[0].catalog_version
  fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
  await screen.findByText('Hasil belum terkonfirmasi')
  expect(await screen.findByText(/Data katalog berubah/)).toBeTruthy()
  const dialog = screen.getByRole('dialog')
  expect(name.value).toBe('Attempt'); expect(name.disabled).toBe(true)
  const check = within(dialog).getByRole('button', { name: 'Periksa hasil' })
  const abandon = within(dialog).getByRole('button', { name: 'Batalkan permintaan tersimpan' })
  expect(screen.getAllByRole('button', { name: 'Periksa hasil', hidden: true })).toHaveLength(1)
  await waitFor(() => expect(document.activeElement).toBe(check))
  expect((check as HTMLButtonElement).disabled).toBe(false)
  fireEvent.keyDown(check, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(abandon)
  fireEvent.keyDown(abandon, { key: 'Tab' }); expect(document.activeElement).toBe(check)
  for (const label of ['Simpan', 'Batal']) {
    const button = within(dialog).getByRole('button', { name: label }) as HTMLButtonElement
    expect(button.disabled).toBe(true); fireEvent.click(button)
  }
  fireEvent.keyDown(dialog, { key: 'Escape' }); expect(screen.getByRole('dialog')).toBe(dialog)
  fireEvent.click(check); await screen.findByText(/Hasil belum diketahui/)
  expect(localStorage.length).toBe(1); expect(state.command).toHaveBeenCalledOnce(); expect(name.value).toBe('Attempt')
  fireEvent.click(abandon); fireEvent.click(within(dialog).getByRole('button', { name: 'Konfirmasi pembatalan permintaan' }))
  await waitFor(() => expect(localStorage.length).toBe(0))
  await waitFor(() => expect(name.disabled).toBe(false))
  expect(name.value).toBe('Attempt'); expect(screen.getByRole('dialog')).toBe(dialog)
  expect(state.command).toHaveBeenCalledOnce()
  // Only the user's new Save dispatches again, retaining the captured version.
  state.conflict = false
  fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }))
  await waitFor(() => expect(state.command).toHaveBeenCalledTimes(2))
  expect(state.command.mock.calls[1][0].p_payload).toMatchObject({ expected_version: originalVersion, values: { name: 'Attempt' } })
  expect(state.command.mock.calls[1][0].p_request_id).not.toBe(state.command.mock.calls[0][0].p_request_id)
})
it('acknowledges a committed edit after a later canonical product deletion', async () => {
  mount(ProductList)
  const region = await screen.findByRole('region', { name: 'Daftar barang' })
  const edit = within(region).getByRole('button', { name: 'Ubah' })
  await waitFor(() => expect((edit as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(edit); fireEvent.change(screen.getByLabelText('Nama Barang *'), { target: { value: 'Renamed' } })
  fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
  await screen.findByText('Hasil belum terkonfirmasi'); state.products = []
  fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' }))
  await waitFor(() => expect(screen.queryByText('Hasil belum terkonfirmasi')).toBeNull())
  expect(localStorage.length).toBe(0); expect(state.command).toHaveBeenCalledOnce()
})
it('retires an open form when its actor leaves and returns, rather than transferring intent', async () => {
  const view = mount(ProductList)
  const region = await screen.findByRole('region', { name: 'Daftar barang' })
  const edit = within(region).getByRole('button', { name: 'Ubah' })
  await waitFor(() => expect((edit as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(edit); fireEvent.change(screen.getByLabelText('Nama Barang *'), { target: { value: 'Old actor intent' } })
  state.actor = '33333333-3333-4333-8333-333333333333'
  view.rerender(<QueryClientProvider client={view.client}><ProductList /></QueryClientProvider>)
  state.actor = '11111111-1111-4111-8111-111111111111'
  view.rerender(<QueryClientProvider client={view.client}><ProductList /></QueryClientProvider>)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(state.command).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0)
})

it.each(pages)('recovers $kind guarded deletion from its receipt, not from target absence', async ({ Page, kind, desktop }) => {
  mount(Page)
  const region = await screen.findByRole('region', { name: desktop })
  const button = within(region).getByRole('button', { name: 'Hapus bila tidak digunakan' })
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  expect(within(region).queryByRole('button', { name: 'Hapus', exact: true })).toBeNull()
  fireEvent.click(button); fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi Hapus' }))
  await screen.findByText('Hasil belum terkonfirmasi')
  expect(state.command.mock.calls[0][0]).toMatchObject({ p_operation: 'delete_unused', p_payload: { kind, id: uuid(1), expected_version: version } })
  fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' }))
  await waitFor(() => expect(screen.queryByText('Hasil belum terkonfirmasi')).toBeNull())
  expect(localStorage.length).toBe(0); expect(state.writes).not.toHaveBeenCalled()
})
it('keeps unknown guarded deletion unresolved even when the customer disappears', async () => {
  state.missingRpc = true; mount(CustomerList)
  const region = await screen.findByRole('region', { name: 'Daftar pelanggan' })
  const button = within(region).getByRole('button', { name: 'Hapus bila tidak digunakan' })
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(button); fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi Hapus' }))
  await screen.findByText('Hasil belum terkonfirmasi'); state.customers = []
  fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' }))
  await screen.findByText(/Hasil belum diketahui/)
  expect(localStorage.length).toBe(1); expect(state.command).toHaveBeenCalledOnce()
})

it('unready guarded deletion never hides catalogue edits or expands native direct deletion', async () => {
  state.ready = false; mount(CustomerList)
  const region = await screen.findByRole('region', { name: 'Daftar pelanggan' })
  await waitFor(() => expect((within(region).getByRole('button', { name: 'Nonaktifkan' }) as HTMLButtonElement).disabled).toBe(false))
  expect((within(region).getByRole('button', { name: 'Hapus bila tidak digunakan' }) as HTMLButtonElement).disabled).toBe(true)
  expect(within(region).queryByRole('button', { name: 'Hapus', exact: true })).toBeNull()
})
it.each(['po_admin', 'executive'])('keeps %s native product deletion independent of guarded readiness', async role => {
  state.ready = false; state.role = role; mount(ProductList)
  const region = await screen.findByRole('region', { name: 'Daftar barang' })
  await waitFor(() => expect(within(region).getByRole('button', { name: 'Hapus', exact: true })).toBeTruthy())
  expect((within(region).getByRole('button', { name: 'Hapus bila tidak digunakan' }) as HTMLButtonElement).disabled).toBe(true)
})

it('cancelled readiness refresh cannot revive a previously allowed cached result', async () => {
  let controller!: ReturnType<typeof useCataloguePage<'customer'>>
  function Probe() { controller = useCataloguePage({ kind: 'customer', search: '', page: 1, pageSize: 10, status: 'all' }); return null }
  const view = mount(Probe)
  await waitFor(() => expect(controller.guardedDeleteAvailable).toBe(true))
  const key = [...catalogueKeys.authority({ backend: state.backend, actorId: state.actor, role: 'co_admin' }), 'guarded-delete-readiness']
  const gate = deferred(); state.readinessGate = gate.promise
  let refresh!: Promise<void>
  act(() => { refresh = view.client.refetchQueries({ queryKey: key, exact: true }) })
  await waitFor(() => expect(controller.guardedDeleteAvailable).toBe(false))
  await act(async () => { await view.client.cancelQueries({ queryKey: key, exact: true }) })
  expect(view.client.getQueryData(key)).toBeTruthy()
  expect(controller.guardedDeleteAvailable).toBe(false)
  await act(async () => { gate.resolve(); await refresh })
  expect(controller.guardedDeleteAvailable).toBe(false)
})

it('offline readiness refetch then cancellation cannot revive previously accepted delete permission', async () => {
  let controller!: ReturnType<typeof useCataloguePage<'customer'>>
  function Probe() { controller = useCataloguePage({ kind: 'customer', search: '', page: 1, pageSize: 10, status: 'all' }); return null }
  const view = mount(Probe)
  await waitFor(() => expect(controller.guardedDeleteAvailable).toBe(true))
  const key = [...catalogueKeys.authority({ backend: state.backend, actorId: state.actor, role: 'co_admin' }), 'guarded-delete-readiness']
  const previouslyAccepted = view.client.getQueryData(key)
  const gate = deferred(); state.readinessGate = gate.promise
  act(() => { onlineManager.setOnline(false) })
  let refresh!: Promise<void>
  act(() => { refresh = view.client.refetchQueries({ queryKey: key, exact: true }) })
  await waitFor(() => expect(controller.guardedDeleteAvailable).toBe(false))
  await act(async () => { await view.client.cancelQueries({ queryKey: key, exact: true }) })
  // TanStack may restore idle plus the previous cached object. That is not a
  // fresh readiness observation and must not restore deletion permission.
  expect(view.client.getQueryState(key)?.fetchStatus).toBe('idle')
  expect(view.client.getQueryData(key)).toBe(previouslyAccepted)
  expect(controller.guardedDeleteAvailable).toBe(false)
  await act(async () => { gate.resolve(); await refresh })
  expect(controller.guardedDeleteAvailable).toBe(false)
  state.readinessGate = null
  // Browser online status is advisory. Only an actual new successful read,
  // rather than query cancellation/cache reversion, restores readiness.
  await act(async () => { await view.client.refetchQueries({ queryKey: key, exact: true }) })
  await waitFor(() => expect(controller.guardedDeleteAvailable).toBe(true))
  expect(view.client.getQueryData(key)).not.toBe(previouslyAccepted)
})


describe.each(pages)('$kind automatic successful status confirmation', ({Page,kind,desktop})=>{
  it('renders canonical Nonaktif and clears recovery without Periksa hasil after one successful command',async()=>{
    mount(Page);await begin(desktop);
    await waitFor(()=>expect(within(screen.getByRole('region',{name:desktop})).getByText('Nonaktif')).toBeTruthy());
    await waitFor(()=>expect(screen.queryByText('Hasil belum terkonfirmasi')).toBeNull());
    expect(localStorage.length).toBe(0);expect(state.command).toHaveBeenCalledOnce();expect(state.writes).not.toHaveBeenCalled();
    expect(state.command.mock.calls[0][0]).toMatchObject({p_operation:'set_enabled',p_payload:{kind,expected_version:version,is_enabled:false}});
    expect(state.reads).toHaveBeenCalledWith(expect.objectContaining({p_kind:kind,p_purpose:'all-for-history'}));
  });
});

it('retains recovery after a successful command when canonical history is denied, without resending', async () => {
  state.historyDenied = true
  mount(CustomerList); await begin('Daftar pelanggan')
  await screen.findByText('Hasil belum terkonfirmasi')
  expect(localStorage.length).toBe(1); expect(state.command).toHaveBeenCalledOnce()
  expect(within(screen.getByRole('region', { name: 'Daftar pelanggan' })).getByText('Aktif')).toBeTruthy()
  state.historyDenied = false
  fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' }))
  await waitFor(() => expect(screen.queryByText('Hasil belum terkonfirmasi')).toBeNull())
  expect(within(screen.getByRole('region', { name: 'Daftar pelanggan' })).getByText('Nonaktif')).toBeTruthy()
  expect(state.command).toHaveBeenCalledOnce(); expect(localStorage.length).toBe(0)
})

it('does not acknowledge the old actor while automatic canonical acceptance is pending', async () => {
  const command = deferred(); state.commandGate = command.promise
  const view = mount(CustomerList); await begin('Daftar pelanggan')
  await waitFor(() => expect(state.command).toHaveBeenCalledOnce())
  const read = deferred(); state.readGate = read.promise
  await act(async () => command.resolve())
  await waitFor(() => expect(state.reads).toHaveBeenCalledWith(expect.objectContaining({ p_purpose: 'all-for-history' })))
  state.actor = '33333333-3333-4333-8333-333333333333'
  view.rerender(<QueryClientProvider client={view.client}><CustomerList /></QueryClientProvider>)
  state.readGate = null; await act(async () => read.resolve())
  await waitFor(() => expect(screen.queryByText('Hasil belum terkonfirmasi')).toBeNull())
  expect(localStorage.length).toBe(1); expect(state.command).toHaveBeenCalledOnce()
  state.actor = '11111111-1111-4111-8111-111111111111'
  view.rerender(<QueryClientProvider client={view.client}><CustomerList /></QueryClientProvider>)
  await screen.findByText('Hasil belum terkonfirmasi')
  await waitFor(() => expect((screen.getByRole('button', { name: 'Periksa hasil' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' }))
  await waitFor(() => expect(screen.queryByText('Hasil belum terkonfirmasi')).toBeNull())
  expect(localStorage.length).toBe(0); expect(state.command).toHaveBeenCalledOnce()
})

it('keeps automatic recovery reachable if the acknowledgment lock release fails after storage removal', async () => {
  let releases = 0
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (name: string, _options: unknown, action: any) => {
    const result = await action({ name, mode: 'exclusive' })
    if (++releases === 2) throw new Error('lock release failed')
    return result
  } } })
  mount(CustomerList); await begin('Daftar pelanggan')
  await screen.findByText('Hasil belum terkonfirmasi')
  expect(releases).toBe(2); expect(localStorage.length).toBe(0)
  expect((within(screen.getByRole('region', { name: 'Daftar pelanggan' })).getByRole('button', { name: 'Aktifkan' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' }))
  await waitFor(() => expect(screen.queryByText('Hasil belum terkonfirmasi')).toBeNull())
  expect(state.command).toHaveBeenCalledOnce(); expect(state.writes).not.toHaveBeenCalled()
})
