import type { ComponentType } from 'react'
import { transferableAbortController } from 'node:util'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AS_OF, fixtureId, supportingReadFixture } from '../scalability/fixtures'
import { RESPONSE_EXAMPLES } from '../scalability/response-examples'
import { customerBackend } from '../helpers/customerBackend'

const state = vi.hoisted(() => ({ mode: 'ready', role: 'sales_manager', fixture: {} as any, metricData: undefined as any, backend: null as any, readGate: null as Promise<void> | null, gatedReads: 0, readCalls: 0 }))
vi.mock('../../src/components/GirardNav', () => ({ default: () => <nav aria-label="Navigasi modul">Modul</nav> }))
vi.mock('../../src/pages/girard/DailySchedule', () => ({ default: () => <p>Sales home</p> }))
vi.mock('../../src/pages/girard/ManagerSchedule', () => ({ default: () => <p>Sales home</p> }))
vi.mock('../../src/pages/Landing', () => ({ default: () => <p>Executive home</p> }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: '00000000-0000-4000-8000-000000000002' }, profile: { id: '00000000-0000-4000-8000-000000000002', role: state.role, is_active: true }, loading: false, error: null }) }))
vi.mock('../../src/lib/supabase', async () => {
  const { fixtureClient } = await import('../scalability/fixtures')
  const client = fixtureClient(() => state.fixture)
  const guarded = (query: any) => {
    const then = query.then
    let mutation = false
    for (const method of ['insert', 'update', 'delete', 'upsert']) if (query[method]) {
      const original = query[method]
      query[method] = (...args: any[]) => { mutation = true; return original(...args) }
    }
    query.then = (resolve: any, reject: any) => {
      state.readCalls++
      if (state.mode === 'loading') return new Promise(() => {})
      if (state.mode === 'error') return Promise.resolve({ data: null, count: null, error: new Error('Private backend detail') }).then(resolve, reject)
      if (state.readGate && !mutation) { state.gatedReads++; return state.readGate.then(() => then(resolve, reject)) }
      return then(resolve, reject)
    }
    return query
  }
  return { supabase: { ...client, from: (table: string) => guarded(state.backend ? state.backend.from(table) : client.from(table)), rpc: (name: string, args: any) => state.backend ? state.backend.rpc(name, args) : guarded(client.rpc(name, args)), auth: { getUser: async () => ({ data: { user: { id: '00000000-0000-4000-8000-000000000002' } } }) } } }
})
vi.mock('../../src/lib/reads/useSalesMetrics', async importOriginal => ({
  ...await importOriginal<any>(),
  useSalesMetrics: () => ({ allowed: true, valid: true, role: state.role, key: ['test-metrics'], from: '2026-10', through: '2026-10', orderType: 'all', manager: null, pending: state.mode === 'loading', unavailable: state.mode === 'error', months: { earliest_month: '2026-10-01' }, data: state.mode === 'loading' || state.mode === 'error' ? undefined : state.metricData, update: vi.fn(), setPage: vi.fn(), refresh: vi.fn(), reset: vi.fn() }),
}))
import GirardCustomers from '../../src/pages/girard/GirardCustomers'
import GirardManagers from '../../src/pages/girard/GirardManagers'
import GirardTeam from '../../src/pages/girard/GirardTeam'
import ManagerCustomers from '../../src/pages/girard/ManagerCustomers'
import MyOrders from '../../src/pages/girard/MyOrders'
import MySalesSummary from '../../src/pages/girard/MySalesSummary'
import GirardDashboard from '../../src/pages/girard/GirardDashboard'
import Promotions from '../../src/pages/girard/Promotions'
import SalesMetricSummary from '../../src/components/sales/SalesMetricSummary'
import App from '../../src/App'

const clients: QueryClient[] = [], routers: ReturnType<typeof createMemoryRouter>[] = []
const zero = { po_order_value: '0.00', po_order_count: '0', po_delivered_revenue: '0.00', po_delivered_order_count: '0', co_sold_revenue: '0.00', co_sold_order_count: '0', co_report_event_count: '0' }
beforeEach(() => {
  onlineManager.setOnline(true)
  vi.stubGlobal('AbortController', class { constructor() { return transferableAbortController() } })
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(AS_OF))
  state.mode = 'ready'; state.role = 'sales_manager'
  state.backend = null; state.readGate = null; state.gatedReads = 0; state.readCalls = 0
  const fixture = supportingReadFixture()
  fixture.tables.customers = fixture.tables.customers.slice(0, 1)
  fixture.tables.users = fixture.tables.users.slice(0, 2).map(user => ({ ...user, email: 'sales@example.invalid', phone: null }))
  fixture.tables.customer_manager_assignments = fixture.tables.customer_manager_assignments.slice(0, 1).map(row => ({ ...row, version: 1 }))
  fixture.tables.promotions = fixture.tables.promotions.slice(0, 1).map(row => ({ ...row, is_active: true }))
  fixture.rpc = { ...fixture.rpc, ...Object.fromEntries(Object.entries(RESPONSE_EXAMPLES).map(([name, response]) => [name, (args: any) => ({ ...response, ...(args?.p_page ? { page: args.p_page, page_size: args.p_page_size } : {}) })])), pilot_sales_report_months_v1: () => ({ version: 1, as_of: AS_OF, earliest_schedule_date: '2026-10-01', earliest_order_at: null }), pilot_team_activity_v1: (args: any) => ({ ...RESPONSE_EXAMPLES.pilot_team_activity_v1, items: args.p_user_ids.map((id: string) => ({ ...RESPONSE_EXAMPLES.pilot_team_activity_v1.items[0], sales_person_id: id })) }) }
  state.fixture = fixture
  state.metricData = { version: 2, as_of: AS_OF, scope: 'team', group_by: 'customer', page: 1, page_size: 20, total: '1', summary: { ...zero, co_report_event_count: '1' }, items: [{ customer_id: fixtureId(1), customer_name: 'Synthetic customer', ...zero, co_report_event_count: '1' }] }
})
afterEach(() => { cleanup(); routers.splice(0).forEach(router => router.dispose()); clients.splice(0).forEach(client => client.clear()); onlineManager.setOnline(true); vi.useRealTimers(); vi.unstubAllGlobals() })
function mount(Page: ComponentType, path = '/girard/test', seed?: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client)
  seed?.(client)
  const router = createMemoryRouter([{ path: '*', element: <Page /> }], { initialEntries: [path] }); routers.push(router)
  return { client, ...render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>) }
}
function expectMain() {
  const mains = screen.getAllByRole('main'); expect(mains).toHaveLength(1)
  expect(mains[0].id).toBe('main-content'); expect(mains[0].tabIndex).toBe(-1)
  expect(document.querySelectorAll('#main-content')).toHaveLength(1)
  expect(screen.getByRole('navigation', { name: 'Navigasi modul' }).compareDocumentPosition(mains[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(mains[0].querySelector('main')).toBeNull(); mains[0].focus(); expect(document.activeElement).toBe(mains[0])
}
const pages = [GirardCustomers, GirardManagers, GirardTeam, ManagerCustomers, MyOrders, MySalesSummary, GirardDashboard, Promotions]
const routeMatrix = [
  ['/girard/customers', 'Pelanggan', ['sales_head', 'executive']],
  ['/girard/managers', 'Manajer', ['sales_head', 'executive']],
  ['/girard/team', 'Tim Saya', ['sales_manager', 'sales_head', 'executive']],
  ['/girard/my-customers', 'Pelanggan Saya', ['sales_manager', 'sales_head', 'executive']],
  ['/girard/my-orders', 'Riwayat Pesanan Saya', ['sales_person', 'sales_manager', 'sales_head', 'executive']],
  ['/girard/my-sales', 'Penjualan Saya', ['sales_person']],
  ['/girard/dashboard', 'Dashboard', ['sales_manager', 'sales_head', 'executive']],
  ['/girard/promotions', 'Promosi', ['sales_person', 'sales_manager', 'sales_head', 'executive']],
] as const
for (const role of ['sales_person', 'sales_manager', 'sales_head', 'executive']) for (const [path, title, roles] of routeMatrix) test(`${role} retains existing reporting access for ${path}`, async () => {
  state.role = role; mount(App, path)
  if ((roles as readonly string[]).includes(role)) { await screen.findByRole('heading', { level: 1, name: title }); expectMain() }
  else { await screen.findByText(role === 'executive' ? 'Executive home' : 'Sales home'); expect(screen.queryByRole('heading', { level: 1, name: title })).toBeNull() }
})
for (const Page of pages) for (const mode of ['loading', 'error', 'empty', 'ready']) test(`${Page.name} keeps one focusable main after navigation during ${mode}`, async () => {
  state.mode = mode
  if (mode === 'empty') {
    for (const table of Object.keys(state.fixture.tables)) state.fixture.tables[table] = []
    for (const name of Object.keys(state.fixture.rpc)) {
      const original = state.fixture.rpc[name]
      state.fixture.rpc[name] = (args: any) => ({ ...original(args), items: [], total: 0, summary: { total: 0, on_track: 0, overdue: 0, total_sales: '0', active_customers: 0, total_customers: 0, total_visits: 0, total_target_visits: 0, visit_percent: 0, top_customer: null }, status_counts: { pending: 0, approved: 0, rejected: 0, cancelled: 0 } })
    }
    state.metricData = { ...state.metricData, total: '0', items: [], summary: zero }
  }
  mount(Page)
  if (mode === 'error') await screen.findAllByRole('alert')
  if (mode === 'empty' || mode === 'ready') await waitFor(() => expect(screen.queryAllByText(/^Memuat/)).toHaveLength(0))
  expectMain()
})
for (const Page of [GirardCustomers, GirardManagers]) test(`${Page.name} never labels a pending directory count as measured zero`, () => {
  state.mode = 'loading'; mount(Page)
  expect(screen.queryByText(/^0 (?:total pelanggan|manajer penjualan)$/)).toBeNull()
})
const offlineDirectories = [
  [GirardCustomers, ['all_customers'], 'Memuat data pelanggan...', 'Tidak ada pelanggan ditemukan.'],
  [GirardManagers, ['managers_data'], 'Memuat...', 'Tidak ada manajer penjualan ditemukan.'],
  [GirardTeam, ['manager_team', fixtureId(2)], 'Memuat data tim...', 'Belum ada anggota tim yang ditugaskan.'],
] as const
for (const [Page, queryKey, loadingMessage, emptyMessage] of offlineDirectories) test(`${Page.name} does not treat an initial offline paused query as zero or verified empty`, () => {
  onlineManager.setOnline(false)
  const { client } = mount(Page)
  expect(client.getQueryState(queryKey)).toMatchObject({ status: 'pending', fetchStatus: 'paused', data: undefined })
  expect(state.readCalls).toBe(0)
  expect(screen.queryByText(/^0 (?:total pelanggan|manajer penjualan)$/)).toBeNull()
  expect(screen.queryByText(emptyMessage)).toBeNull()
  expect(screen.getByText(loadingMessage)).toBeTruthy()
  expectMain()
})
for (const [Page, key, noun] of [[GirardCustomers, 'all_customers', 'total pelanggan'], [GirardManagers, 'managers_data', 'manajer penjualan']] as const) for (const empty of [false, true]) test(`${Page.name} retains authoritative ${empty ? 'zero' : 'positive'} cached counts during an offline paused refresh`, () => {
  onlineManager.setOnline(false)
  const { client } = mount(Page, '/girard/test', client => {
    const rows = Page === GirardCustomers ? state.fixture.tables.customers : [{ ...state.fixture.tables.users[0], customers: state.fixture.tables.customers, team: state.fixture.tables.users.slice(1) }]
    client.setQueryData([key], empty ? [] : rows)
    if (Page === GirardCustomers) { client.setQueryData(['managers_list'], state.fixture.tables.users); client.setQueryData(['assignments'], state.fixture.tables.customer_manager_assignments) }
  })
  expect(client.getQueryState([key])).toMatchObject({ status: 'success', fetchStatus: 'paused' })
  expect(state.readCalls).toBe(0)
  expect(screen.getByText(`${empty ? 0 : 1} ${noun}`)).toBeTruthy()
  expect(screen.queryByText(/^Memuat/)).toBeNull()
  const emptyMessage = Page === GirardCustomers ? 'Tidak ada pelanggan ditemukan.' : 'Tidak ada manajer penjualan ditemukan.'
  if (empty) expect(screen.getByRole('heading', { name: emptyMessage })).toBeTruthy()
  else expect(screen.queryByText(emptyMessage)).toBeNull()
})
for (const empty of [false, true]) test(`team retains authoritative cached ${empty ? 'empty membership' : 'activity'} during an offline paused refresh`, () => {
  onlineManager.setOnline(false)
  const member = state.fixture.tables.users[1]
  const { client } = mount(GirardTeam, '/girard/team', client => {
    client.setQueryData(['manager_team', fixtureId(2)], empty ? [] : [member])
    if (!empty) client.setQueryData(['today_activity', fixtureId(2), [member.id], '2026-10-01'], [{ ...RESPONSE_EXAMPLES.pilot_team_activity_v1.items[0], sales_person_id: member.id }])
  })
  expect(client.getQueryState(['manager_team', fixtureId(2)])).toMatchObject({ status: 'success', fetchStatus: 'paused' })
  expect(state.readCalls).toBe(0)
  expect(screen.queryByText('Memuat data tim...')).toBeNull()
  if (empty) expect(screen.getByRole('heading', { name: 'Belum ada anggota tim yang ditugaskan.' })).toBeTruthy()
  else {
    expect(client.getQueryState(['today_activity', fixtureId(2), [member.id], '2026-10-01'])).toMatchObject({ status: 'success', fetchStatus: 'paused' })
    expect(screen.getAllByRole('link', { name: 'Lihat 2 jadwal Sales 0' })).toHaveLength(2)
    expect(screen.queryByText('Belum ada anggota tim yang ditugaskan.')).toBeNull()
  }
})
for (const [Page, prefix, loadingMessage, emptyMessage] of [
  [MyOrders, 'my_orders', 'Memuat pesanan...', 'Tidak ada pesanan ditemukan.'],
  [ManagerCustomers, 'my_customers', 'Memuat data pelanggan...', 'Belum ada pelanggan yang ditugaskan.'],
  [Promotions, 'promotions', 'Memuat promosi…', 'Belum ada promosi produk aktif.'],
] as const) test(`${Page.name} already keeps paused initial reads separate from verified empty data`, () => {
  onlineManager.setOnline(false)
  const { client } = mount(Page)
  expect(client.getQueryCache().find({ queryKey: [prefix], exact: false })?.state).toMatchObject({ status: 'pending', fetchStatus: 'paused', data: undefined })
  expect(state.readCalls).toBe(0)
  expect(screen.getByText(loadingMessage)).toBeTruthy()
  expect(screen.queryByText(emptyMessage)).toBeNull()
  expect(screen.queryAllByText(/^0 (?:menunggu|disetujui|ditolak)$/)).toHaveLength(0)
})
test('customer directory search is explicitly labelled and retains real detail links and wrapping names', async () => {
  const longName = 'NamaPelangganTanpaSpasi'.repeat(12); state.fixture.tables.customers[0].name = longName
  mount(GirardCustomers); await screen.findAllByRole('link', { name: longName })
  const input = screen.getByLabelText('Cari pelanggan'); expect(input.id).toBeTruthy()
  expect(screen.getByRole('region', { name: 'Filter pelanggan' })).toBeTruthy()
  for (const link of screen.getAllByRole('link', { name: longName })) { expect(link.getAttribute('href')).toBe(`/girard/customer/${state.fixture.tables.customers[0].id}`); expect(link.className).toContain('overflow-wrap:anywhere') }
  const cards = screen.getByRole('list', { name: 'Pelanggan' }); expect(within(cards).getAllByRole('listitem')).toHaveLength(1)
  fireEvent.change(input, { target: { value: 'does-not-match' } }); expect(screen.getByRole('heading', { name: 'Tidak ada pelanggan ditemukan.' })).toBeTruthy()
})
test('customer edit dialog labels native controls and returns focus without changing assignment data', async () => {
  mount(GirardCustomers); const opener = (await screen.findAllByRole('button', { name: 'Ubah' }))[0]; opener.focus(); fireEvent.click(opener)
  const dialog = screen.getByRole('dialog', { name: 'Ubah Penugasan Pelanggan' })
  const tier = within(dialog).getByLabelText('Tier Harga'); expect(tier.tagName).toBe('SELECT'); expect(tier.id).toBeTruthy()
  expect(within(dialog).getByLabelText('Frekuensi Kunjungan').id).toBeTruthy(); expect(within(dialog).getByLabelText('Penanggung Jawab Toko').id).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Batal' })); expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(opener)
  expect(state.fixture.tables.customer_manager_assignments[0].version).toBe(1)
})
test('confirmed customer edit focuses the stable search while refreshed rows are held and the opener later disappears', async () => {
  state.backend = customerBackend(); mount(GirardCustomers)
  const opener = (await screen.findAllByRole('button', { name: 'Ubah' }))[0]; opener.focus(); fireEvent.click(opener)
  fireEvent.change(screen.getByLabelText('Frekuensi Kunjungan'), { target: { value: '14' } })
  let release!: () => void; state.readGate = new Promise<void>(resolve => { release = resolve })
  fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const destination = screen.getByLabelText('Cari pelanggan'); expect(document.activeElement).toBe(destination)
  await waitFor(() => expect(state.gatedReads).toBeGreaterThan(0))
  state.backend.state.customers = []; await act(async () => { state.readGate = null; release() })
  await waitFor(() => expect(screen.queryAllByRole('button', { name: 'Ubah' })).toHaveLength(0))
  expect(opener.isConnected).toBe(false); expect(document.activeElement).toBe(destination)
  expect(state.backend.state.writes).toEqual([{ table: 'customers', op: 'update', payload: { visit_frequency_days: 14 }, filters: { id: 'c' } }])
})
test('pending customer assignment retains its native dialog and original version owner until acknowledgement', async () => {
  state.backend = customerBackend(); mount(GirardCustomers)
  const opener = (await screen.findAllByRole('button', { name: 'Ubah' }))[0]; fireEvent.click(opener)
  fireEvent.change(screen.getByLabelText('Penanggung Jawab Toko'), { target: { value: 'm' } })
  let release!: () => void; state.backend.state.assignmentGate = new Promise<void>(resolve => { release = resolve })
  const save = screen.getByRole('button', { name: 'Simpan' }); fireEvent.click(save); fireEvent.click(save)
  const pending = await screen.findByRole('button', { name: 'Menyimpan...' }); expect(pending.getAttribute('aria-busy')).toBe('true')
  const dialog = screen.getByRole('dialog'); fireEvent.keyDown(dialog, { key: 'Escape' }); expect(dialog.isConnected).toBe(true)
  expect(screen.getByRole('button', { name: 'Batal' })).toHaveProperty('disabled', true)
  expect(state.backend.state.writes).toHaveLength(1)
  expect(state.backend.state.writes[0].payload).toEqual({ p_customer_id: 'c', p_owner_id: 'm', p_expected_assignment_id: null, p_expected_version: null })
  await act(async () => { release() }); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(state.backend.state.assignments[0]).toMatchObject({ customer_id: 'c', manager_id: 'm', version: 1 })
})
test('personal customer summaries and pagination retain full authorized counts beyond the complete visible page', async () => {
  const original = RESPONSE_EXAMPLES.pilot_manager_customers_v1
  const longName = 'NamaPelangganTanpaSpasi'.repeat(12)
  state.fixture.rpc.pilot_manager_customers_v1 = (args: any) => ({ ...original, page: args.p_page, page_size: args.p_page_size, total: 1001, items: Array.from({ length: args.p_page_size }, (_, index) => ({ ...original.items[0], id: fixtureId(80000 + (args.p_page - 1) * args.p_page_size + index), name: index === 0 ? longName : `Synthetic customer ${index}` })), summary: { total: 1001, on_track: 800, overdue: 201 } })
  mount(ManagerCustomers); await screen.findByText('1–50 dari 1001')
  const summary = screen.getByRole('region', { name: 'Ringkasan pelanggan' }); expect(summary.querySelector('dl')).toBeTruthy()
  expect(within(summary).getByText('1001')).toBeTruthy(); expect(within(summary).getByText('800')).toBeTruthy(); expect(within(summary).getByText('201')).toBeTruthy()
  for (const name of screen.getAllByText(longName)) expect(name.className).toContain('overflow-wrap:anywhere')
  for (const badge of screen.getAllByText('Sesuai target')) { expect(badge.tagName).toBe('SPAN'); expect(badge.classList.contains('ui-status-badge')).toBe(true); expect(badge.getAttribute('role')).toBeNull(); expect(badge.tabIndex).toBe(-1) }
  const table = screen.getByRole('region', { name: 'Tabel pelanggan saya' }); table.focus(); expect(document.activeElement).toBe(table); expect(table.classList.contains('overflow-x-auto')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' })); await screen.findByText('51–100 dari 1001'); expect(within(summary).getByText('1001')).toBeTruthy()
})
test('personal order status counts stay authoritative and badges stay separate from filter actions', async () => {
  const original = RESPONSE_EXAMPLES.pilot_sales_order_page_v1
  const longName = 'NamaPelangganTanpaSpasi'.repeat(12)
  state.fixture.rpc.pilot_sales_order_page_v1 = (args: any) => ({ ...original, page: args.p_page, page_size: args.p_page_size, total: 1001, items: Array.from({ length: args.p_page_size }, (_, index) => ({ ...original.items[0], id: fixtureId(90000 + (args.p_page - 1) * args.p_page_size + index), customers: { name: index === 0 ? longName : `Synthetic customer ${index}` } })), status_counts: { pending: 1000, approved: 1, rejected: 0, cancelled: 0 } })
  mount(MyOrders); await screen.findByText('1000 menunggu'); expect(screen.getByText('1 disetujui')).toBeTruthy()
  const filter = screen.getByRole('region', { name: 'Filter riwayat pesanan' }); expect(within(filter).getByRole('button', { name: 'Semua' }).getAttribute('aria-pressed')).toBe('true')
  const list = screen.getByRole('list', { name: 'Riwayat pesanan' }); expect(within(list).getAllByRole('listitem')).toHaveLength(10)
  const badge = within(list).getAllByText('Disetujui')[0]; expect(badge.tagName).toBe('SPAN'); expect(badge.classList.contains('ui-status-badge--success')).toBe(true); expect(badge.getAttribute('role')).toBeNull()
  expect(within(list).getByText(longName).className).toContain('overflow-wrap:anywhere')
  fireEvent.click(within(filter).getByRole('button', { name: 'Disetujui' })); await waitFor(() => expect(within(filter).getByRole('button', { name: 'Disetujui' }).getAttribute('aria-pressed')).toBe('true'))
  expect(screen.getByText('1000 menunggu')).toBeTruthy()
})
test('team directory uses a labelled date filter, semantic cards and matching UTC/date drilldowns', async () => {
  mount(GirardTeam); await screen.findAllByRole('link', { name: 'Sales 0' })
  const input = screen.getByLabelText('Tanggal aktivitas tim'); expect(input.id).toBeTruthy(); expect(screen.getByRole('region', { name: 'Filter aktivitas tim' })).toBeTruthy()
  const table = screen.getByRole('region', { name: 'Tabel aktivitas tim' }); table.focus(); expect(document.activeElement).toBe(table)
  expect(screen.getByRole('list', { name: 'Anggota tim' }).querySelector('dl')).toBeTruthy()
  fireEvent.change(input, { target: { value: '2026-10-12' } })
  await waitFor(() => expect(screen.getAllByRole('link', { name: /Lihat 2 jadwal Sales 0/ })[0].getAttribute('href')).toBe(`/girard/schedule?date=2026-10-12&person=${fixtureId(40000)}`))
  expect(screen.getByText(/Batas pesanan harian: 00.00–23.59.59 UTC/)).toBeTruthy(); expect(screen.queryByText(/WIB/)).toBeNull()
})
test('manager cards retain complete child counts while the preview remains bounded and readable', async () => {
  state.fixture.tables.customer_manager_assignments = supportingReadFixture().tables.customer_manager_assignments
  mount(GirardManagers); await screen.findByText('1001')
  const list = screen.getByRole('list', { name: 'Manajer penjualan' }); expect(list.querySelector('dl')).toBeTruthy()
  expect(within(list).getByText('+998 lainnya')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Lihat jadwal tim Manager' }).getAttribute('href')).toContain(`manager=${fixtureId(2)}`)
})
test('metric filters are labelled shared fields while posted zero stays distinct from unavailable CO', () => {
  mount(MySalesSummary)
  const filter = screen.getByRole('region', { name: 'Filter Metrik Sales' })
  for (const label of ['Dari bulan', 'Sampai bulan', 'Jenis pesanan']) { const input = within(filter).getByLabelText(label); expect(input.tagName).toBe('SELECT'); expect(input.id).toBeTruthy(); expect(input.parentElement?.classList.contains('ui-field')).toBe(true) }
  expect(screen.getByRole('button', { name: 'Muat ulang metrik' }).classList.contains('ui-action')).toBe(true)
  const summary = screen.getByRole('region', { name: 'Ringkasan seluruh hasil' }); const card = within(summary).getByRole('heading', { name: 'Penjualan CO dilaporkan' }).closest('article')!
  expect(within(card).getByText('Rp 0')).toBeTruthy(); expect(within(card).getByText(/Nol pada laporan yang tersedia/)).toBeTruthy()
  cleanup(); render(<SalesMetricSummary summary={zero} />)
  const missing = screen.getByRole('heading', { name: 'Penjualan CO dilaporkan' }).closest('article')!
  expect(within(missing).getByText('Belum tersedia')).toBeTruthy(); expect(within(missing).queryByText('Rp 0')).toBeNull()
})
test('promotion cards keep absent legacy stock separate from managed zero without inventing availability', async () => {
  const original = state.fixture.rpc.pilot_promotions_v1
  state.fixture.rpc.pilot_promotions_v1 = () => { const response = original(); return { ...response, items: [...response.items, { ...response.items[0], id: fixtureId(70001), product_name: 'Exhausted', stock_managed: true, remaining_quantity: 0, stock_version: 1, image_path: `promotions/${fixtureId(2)}/${fixtureId(70001)}/${fixtureId(70002)}.png` }] } }
  mount(Promotions); await screen.findByText('Legacy · stok belum ditetapkan')
  const list = screen.getByRole('list', { name: 'Promosi produk aktif' }); expect(within(list).getAllByRole('listitem')).toHaveLength(1)
  expect(screen.queryByText('Exhausted')).toBeNull(); expect(screen.queryByText('Stok tersedia: 0')).toBeNull()
  const badge = screen.getByText('Legacy · aktif'); expect(badge.tagName).toBe('SPAN'); expect(badge.classList.contains('ui-status-badge')).toBe(true); expect(badge.getAttribute('role')).toBeNull()
})


test.each([{ name: 'GirardCustomers', Page: GirardCustomers }, { name: 'ManagerCustomers', Page: ManagerCustomers }])('$name location and visit frequency retain 14px data sizing and exact values', async ({ Page }) => {
  mount(Page); await waitFor(() => expect(screen.queryAllByText(/^Memuat/)).toHaveLength(0))
  const table = screen.getByRole('table'); expect(table.classList.contains('text-sm')).toBe(true)
  const headers = within(table).getAllByRole('columnheader')
  const indices = headers.flatMap((header, index) => ['Lokasi', 'Frekuensi Kunjungan'].includes(header.textContent ?? '') ? [index] : [])
  expect(indices).toHaveLength(2)
  for (const row of table.querySelectorAll('tbody tr')) for (const index of indices) {
    const cell = row.children[index]; expect(cell.classList.contains('text-[13px]')).toBe(false); expect(cell.textContent?.trim()).not.toBe('')
  }
})
