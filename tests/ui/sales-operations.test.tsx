import React from 'react'
import { transferableAbortController } from 'node:util'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  role: 'sales_person', actor: 'actor', schedules: [] as any[], requests: [] as any[], visits: [] as any[],
  customer: undefined as any, readError: '', readPending: '', inboxMode: '', unresolved: false,
  scheduleRefreshGate: null as Promise<void> | null, gatedScheduleReads: 0, senders: new Map<string, any>(),
  reads: [] as { table: string; select: string; filters: [string, unknown][]; range?: number[] }[],
  send: Object.assign(vi.fn(), { hasUnresolved: () => false, reconcile: vi.fn(), acknowledgeRecovered: vi.fn() }),
}))
const customers = [
  { id: 'c1', name: 'Synthetic Company', city: 'Bandung', address: 'Cabang Utara', last_visit_date: null, visit_frequency_days: 7 },
  { id: 'c2', name: 'Synthetic Company', city: 'Jakarta', address: 'Cabang Selatan', last_visit_date: null, visit_frequency_days: 7 },
]
const people = [
  { id: 'actor', full_name: 'Leader', role: 'sales_manager', manager_id: null, is_active: true },
  { id: 'rep', full_name: 'Sales One', role: 'sales_person', manager_id: 'actor', is_active: true },
]
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: state.actor ? { id: state.actor, role: state.role } : null }) }))
vi.mock('../../src/components/GirardNav', () => ({ default: () => <nav aria-label="Navigasi modul">Modul</nav> }))
vi.mock('../../src/components/ActivePromotionsBanner', () => ({ default: () => null }))
vi.mock('../../src/lib/CustomerStats', () => ({ fetchCustomerStatsBatch: async () => [{ customer_id: 'c1', order_count: 1, total_sales: '50000', top_items: [] }], fetchCustomerStatsDetail: async () => ({ first_order_date: null, order_count_3mo: 0, total_sales_3mo: '0', top_items: [] }) }))
vi.mock('../../src/lib/visitTransactions', () => ({ useVisitPlanningSender: () => state.senders.get(state.actor) ?? state.send }))
vi.mock('../../src/lib/visitPlanning', () => ({ MAX_VISIT_NOTE_LENGTH: 2000, fetchVisitCustomers: async () => customers, fetchVisitPeople: async () => people, fetchVisitRequests: async () => { if (state.inboxMode === 'error') throw new Error('Private backend detail'); if (state.inboxMode === 'loading') return new Promise(() => {}); return { items: state.requests, total: state.requests.length } } }))
vi.mock('../../src/components/StorePOContext', () => ({ default: () => <section aria-label="Riwayat PO toko">PO context</section> }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { from: (table: string) => {
  const read = { table, select: '', filters: [] as [string, unknown][], range: undefined as number[] | undefined }; state.reads.push(read)
  const rows = () => (table === 'outlet_visits' ? state.visits : table === 'sales_schedules' ? state.schedules : table === 'customers' ? customers : table === 'users' ? people : table === 'visit_requests' ? state.requests : table === 'customer_manager_assignments' ? customers.map(c => ({ id: c.id, customer_id: c.id, customers: c })) : []).filter(row => read.filters.every(([key, value]) => Array.isArray(value) ? value.includes((row as any)[key]) : (row as any)[key] === value))
  const result = async (single = false) => {
    if (table === 'sales_schedules' && state.scheduleRefreshGate) { state.gatedScheduleReads++; await state.scheduleRefreshGate }
    if (state.readPending === table) return new Promise(() => {})
    if (state.readError === table) return { data: null, count: null, error: new Error('Private backend detail') }
    const data = table === 'customers' && single ? state.customer : single ? rows()[0] ?? null : rows()
    return { data, count: single ? undefined : rows().length, error: null }
  }
  const q: any = { select: (value: string) => { read.select = value; return q }, eq: (key: string, value: unknown) => { read.filters.push([key, value]); return q }, in: (key: string, value: unknown[]) => { read.filters.push([key, value]); return q }, gte: () => q, order: () => q, range: (start: number, end: number) => { read.range = [start, end]; return q }, limit: () => q, abortSignal: () => q, maybeSingle: () => result(true), single: () => result(true), then: (resolve: any, reject: any) => result().then(resolve, reject) }
  return q
} } }))
import DailySchedule from '../../src/pages/girard/DailySchedule'
import ManagerSchedule from '../../src/pages/girard/ManagerSchedule'
import MyVisits from '../../src/pages/girard/MyVisits'
import VisitRequests from '../../src/pages/girard/VisitRequests'
import CustomerDetail from '../../src/pages/girard/GirardCustomerDetail'
import { VisitProposalForm } from '../../src/components/VisitRequestInbox'
import OutletDetail from '../../src/pages/girard/OutletDetail'
import { calendarDateKey } from '../../src/lib/calendarDate'

const clients: QueryClient[] = [], routers: ReturnType<typeof createMemoryRouter>[] = []
const requestId = '00000000-0000-4000-8000-000000000001'
const schedule = (overrides = {}) => ({ id: 'schedule', version: 3, outlet_id: 'c1', sales_person_id: 'actor', scheduled_date: calendarDateKey(), status: 'pending', notes: null, customers: customers[0], users: people[0], outlet_visits: [], ...overrides })
beforeEach(() => {
  vi.stubGlobal('AbortController', class { constructor() { return transferableAbortController() } })
  customers[0].last_visit_date = null; state.actor = 'actor'; state.role = 'sales_person'; state.schedules = [schedule()]; state.requests = []; state.visits = []; state.customer = customers[0]
  state.readError = ''; state.readPending = ''; state.inboxMode = ''; state.reads = []; state.unresolved = false; state.scheduleRefreshGate = null; state.gatedScheduleReads = 0; state.senders.clear()
  state.send.mockReset().mockResolvedValue({ id: requestId, version: 1 }); state.send.hasUnresolved = () => state.unresolved
  state.send.reconcile.mockReset(); state.send.acknowledgeRecovered.mockReset()
})
afterEach(() => { cleanup(); routers.splice(0).forEach(r => r.dispose()); clients.splice(0).forEach(c => c.clear()); vi.unstubAllGlobals() })
function mount(Page: React.ComponentType, path = '/girard/schedule') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client)
  const router = createMemoryRouter([{ path: Page === CustomerDetail ? '/girard/customer/:id' : path.split('?')[0].split('#')[0], element: <Page /> }, { path: '/girard/customer/:id', element: <CustomerDetail /> }, { path: '/girard/visit/:id', element: <p>Visit detail</p> }, { path: '/girard/visit-history', element: <p>Visit history</p> }, { path: '/away', element: <p>Other route</p> }], { initialEntries: [path] })
  routers.push(router); render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>); return router
}
function expectMain() {
  const mains = screen.getAllByRole('main'); expect(mains).toHaveLength(1); expect(mains[0].id).toBe('main-content'); expect(mains[0].tabIndex).toBe(-1)
  expect(document.querySelectorAll('#main-content')).toHaveLength(1)
  expect(screen.getByRole('navigation', { name: 'Navigasi modul' }).compareDocumentPosition(mains[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(mains[0].querySelector('main')).toBeNull()
}
async function openAssignment() {
  const opener = await screen.findByRole('button', { name: '+ Kunjungan' }); opener.focus(); fireEvent.click(opener)
  await screen.findByRole('option', { name: /Synthetic Company.*Bandung/ }); return opener
}
function fillAssignment() {
  fireEvent.change(screen.getByLabelText('Pelanggan'), { target: { value: 'c1' } })
  fireEvent.change(screen.getByLabelText('Petugas kunjungan'), { target: { value: 'rep' } })
  fireEvent.change(screen.getByLabelText('Tanggal jadwal'), { target: { value: '2026-10-13' } })
  fireEvent.change(screen.getByLabelText('Catatan jadwal'), { target: { value: 'Keep these notes' } })
}

for (const Page of [DailySchedule, MyVisits]) test(`${Page.name} exposes real visit and customer hrefs and one main`, async () => {
  mount(Page); await screen.findByRole('heading', { name: 'Synthetic Company' })
  expect(screen.getByRole('link', { name: 'Check-in kunjungan' }).getAttribute('href')).toBe('/girard/visit/schedule')
  expect(screen.getByRole('link', { name: 'Info Pelanggan' }).getAttribute('href')).toBe('/girard/customer/c1')
  expect(screen.queryByRole('button', { name: 'Info Pelanggan' })).toBeNull(); expectMain()
})
test('modified personal-history click retains the dirty proposal and its route', async () => {
  const router = mount(DailySchedule); fireEvent.click(screen.getByRole('button', { name: 'Ajukan kunjungan baru' }))
  fireEvent.change(screen.getByLabelText('Catatan permintaan'), { target: { value: 'Keep proposal' } })
  const link = screen.getByRole('link', { name: 'Riwayat kunjungan saya' }); expect(link.getAttribute('href')).toBe('/girard/visit-history')
  let intercepted = true; document.addEventListener('click', event => { intercepted = event.defaultPrevented; event.preventDefault() }, { once: true })
  fireEvent.click(link, { ctrlKey: true }); expect(intercepted).toBe(false); expect(router.state.location.pathname).toBe('/girard/schedule')
  expect(screen.queryByRole('dialog')).toBeNull(); expect((screen.getByLabelText('Catatan permintaan') as HTMLTextAreaElement).value).toBe('Keep proposal')
})
test('daily selected schedule date remains date-only and separate from the UTC cadence boundary', async () => {
  const customer = { ...customers[0], last_visit_date: '2020-01-01' }
  state.customer = customer; customers[0].last_visit_date = '2020-01-01' as any
  mount(DailySchedule); await screen.findByText(/8 Januari 2020.*00.00.*UTC/)
  expect(screen.getByText(/Jadwal memakai tanggal tanpa jam/)).toBeTruthy(); expect(screen.queryByText(/WIB/)).toBeNull()
  fireEvent.change(screen.getByLabelText('Lihat tanggal kunjungan'), { target: { value: '2027-03-15' } })
  expect(await screen.findByText(/Tidak ada kunjungan.*15 Maret 2027/)).toBeTruthy()
  const control = screen.getByLabelText('Lihat tanggal kunjungan'); expect(control.id).toBeTruthy()
  expect(screen.getByText('Lihat tanggal kunjungan', { selector: 'label' }).getAttribute('for')).toBe(control.id)
  customers[0].last_visit_date = null
})
test('pending receipt remains durable after proposal unmount with native link and independent owner read', async () => {
  mount(DailySchedule); fireEvent.click(screen.getByRole('button', { name: 'Ajukan kunjungan baru' })); await screen.findByRole('option', { name: /Synthetic Company.*Bandung/ })
  fireEvent.change(screen.getByLabelText('Toko'), { target: { value: 'c1' } }); fireEvent.change(screen.getByLabelText('Tanggal kunjungan'), { target: { value: '2026-10-13' } })
  const submit = screen.getByRole('button', { name: 'Ajukan kunjungan' }); expect(submit.classList.contains('ui-action--primary')).toBe(true)
  fireEvent.click(submit); expect(await screen.findByText(/Permintaan terkirim untuk 13 Oktober 2026/)).toBeTruthy()
  expect(screen.queryByLabelText('Catatan permintaan')).toBeNull(); expect(screen.getByRole('link', { name: 'Lihat status permintaan' }).getAttribute('href')).toBe(`/girard/visit-requests#visit-request-${requestId}`)
  expect(state.send).toHaveBeenCalledWith('propose_visit', { customer_id: 'c1', scheduled_date: '2026-10-13', notes: '' })
  expect(state.reads.find(r => r.table === 'visit_requests')?.filters).toEqual([['requester_id', 'actor'], ['scheduled_date', calendarDateKey()], ['status', 'pending']])
})
test('pending request decisions remain buttons and bind original request version once', async () => {
  state.role = 'sales_manager'; state.requests = [{ id: requestId, requester_id: 'rep', version: 2, status: 'pending', kind: 'new', customer_id: 'c1', scheduled_date: '2026-10-13' }]
  state.send.mockReturnValue(new Promise(() => {})); mount(VisitRequests, '/girard/visit-requests')
  const approve = await screen.findByRole('button', { name: 'Setujui' }); expect(approve.classList.contains('ui-action--primary')).toBe(true)
  expect(screen.getByRole('button', { name: 'Tolak' }).classList.contains('ui-action--danger')).toBe(true)
  fireEvent.click(approve); fireEvent.click(approve); expect(state.send).toHaveBeenCalledTimes(1)
  expect(state.send).toHaveBeenCalledWith('approve_request', { request_id: requestId, expected_version: 2 }); expect(approve.getAttribute('aria-busy')).toBe('true'); expectMain()
})
test('manager drilldown retains personal, manager, date and visited filters with native detail links', async () => {
  state.role = 'sales_manager'; state.schedules = [schedule({ sales_person_id: 'rep', scheduled_date: '2026-10-13', users: people[1], outlet_visits: [{ id: 'v' }] }), schedule({ id: 'outside-person', sales_person_id: 'other', scheduled_date: '2026-10-13', customers: { name: 'Excluded person' }, outlet_visits: [{ id: 'v2' }] }), schedule({ id: 'not-visited', sales_person_id: 'rep', scheduled_date: '2026-10-13', customers: { name: 'Excluded pending' } })]
  mount(ManagerSchedule, '/girard/schedule?date=2026-10-13&person=rep&manager=actor&status=visited')
  await screen.findByText(/Jadwal tim.*13 Oktober 2026.*Sales One.*Sudah dikunjungi/)
  expect(screen.queryByText('Excluded person')).toBeNull(); expect(screen.queryByText('Excluded pending')).toBeNull()
  expect(screen.getAllByRole('link', { name: 'Lihat rincian kunjungan' })[0].getAttribute('href')).toBe('/girard/visit/schedule'); expectMain()
})
test('manager assignment is a labelled native dialog with associated fields and clean returned focus', async () => {
  state.role = 'sales_manager'; mount(ManagerSchedule); const opener = await openAssignment()
  const dialog = screen.getByRole('dialog', { name: 'Tugaskan kunjungan' }); expect(dialog.tagName).toBe('DIALOG')
  for (const name of ['Cari pelanggan', 'Pelanggan', 'Petugas kunjungan', 'Tanggal jadwal', 'Catatan jadwal']) expect(screen.getByLabelText(name).id).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Batal' })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(document.activeElement).toBe(opener)
})
test('manager dirty create replacement retains all fields on Keep and clears them only on Discard', async () => {
  state.role = 'sales_manager'; mount(ManagerSchedule); const opener = await openAssignment(); fillAssignment()
  fireEvent.click(opener); const confirmation = await screen.findByRole('dialog', { name: 'Buang perubahan?' }); expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(confirmation.contains(document.activeElement)).toBe(true); fireEvent.click(within(confirmation).getByRole('button', { name: 'Tetap mengedit' }))
  const dialog = await screen.findByRole('dialog', { name: 'Tugaskan kunjungan' }); expect(dialog.contains(document.activeElement)).toBe(true)
  expect((screen.getByLabelText('Pelanggan') as HTMLSelectElement).value).toBe('c1'); expect((screen.getByLabelText('Petugas kunjungan') as HTMLSelectElement).value).toBe('rep')
  expect((screen.getByLabelText('Tanggal jadwal') as HTMLInputElement).value).toBe('2026-10-13'); expect((screen.getByLabelText('Catatan jadwal') as HTMLTextAreaElement).value).toBe('Keep these notes')
  fireEvent.click(opener); fireEvent.click(await screen.findByRole('button', { name: 'Buang perubahan' }))
  expect((await screen.findByLabelText('Catatan jadwal') as HTMLTextAreaElement).value).toBe(''); expect((screen.getByLabelText('Pelanggan') as HTMLSelectElement).value).toBe(''); expect(state.send).not.toHaveBeenCalled()
})
test('manager dirty edit replacement keeps original version and sends the retained draft after Keep', async () => {
  state.role = 'sales_manager'; mount(ManagerSchedule); const edit = (await screen.findAllByRole('button', { name: 'Ubah' }))[0]; edit.focus(); fireEvent.click(edit)
  fireEvent.change(screen.getByLabelText('Catatan jadwal'), { target: { value: 'Keep versioned edit' } })
  fireEvent.click(screen.getByRole('button', { name: '+ Kunjungan' })); fireEvent.click(await screen.findByRole('button', { name: 'Tetap mengedit' }))
  fireEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' })); await waitFor(() => expect(state.send).toHaveBeenCalled())
  expect(state.send).toHaveBeenCalledWith('edit_schedule', { schedule_id: 'schedule', expected_version: 3, customer_id: 'c1', sales_person_id: 'actor', scheduled_date: calendarDateKey(), notes: 'Keep versioned edit' })
})
test('pending manager assignment locks repeat saves and Escape dismissal', async () => {
  state.role = 'sales_manager'; state.send.mockReturnValue(new Promise(() => {})); mount(ManagerSchedule); await openAssignment(); fillAssignment()
  const save = screen.getByRole('button', { name: 'Tugaskan' }); fireEvent.click(save); fireEvent.click(save)
  await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1))
  const dialog = screen.getByRole('dialog', { name: 'Tugaskan kunjungan' }); fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(dialog.isConnected).toBe(true); expect(save.getAttribute('aria-busy')).toBe('true'); expect(state.send).toHaveBeenCalledTimes(1)
  expect((screen.getByRole('button', { name: 'Batal' }) as HTMLButtonElement).disabled).toBe(true)
})
test('unknown manager result cannot close and authoritative abandonment unlocks the same draft/version', async () => {
  state.role = 'sales_manager'; state.send.mockImplementationOnce(async () => { state.unresolved = true; throw new Error('Hasil belum diketahui') })
  state.send.reconcile.mockImplementationOnce(async () => { state.unresolved = false; return { state: 'abandoned' } }); vi.spyOn(window, 'confirm').mockReturnValue(true)
  mount(ManagerSchedule); await openAssignment(); fillAssignment(); fireEvent.click(screen.getByRole('button', { name: 'Tugaskan' })); await screen.findByText('Hasil belum diketahui')
  const dialog = screen.getByRole('dialog', { name: 'Tugaskan kunjungan' }); fireEvent.keyDown(dialog, { key: 'Escape' }); expect(dialog.isConnected).toBe(true)
  expect((screen.getByRole('button', { name: 'Batal' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Pulihkan hasil penyimpanan' })); await screen.findByText('Permintaan lama telah dibatalkan. Anda dapat menyimpan kembali.')
  expect((screen.getByLabelText('Catatan jadwal') as HTMLTextAreaElement).value).toBe('Keep these notes'); expect((screen.getByRole('button', { name: 'Tugaskan' }) as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Tugaskan' })); await waitFor(() => expect(state.send).toHaveBeenCalledTimes(2)); expect(state.send.acknowledgeRecovered).not.toHaveBeenCalled()
})
for (const Page of [DailySchedule, MyVisits, ManagerSchedule]) for (const mode of ['loading', 'error', 'empty']) test(`${Page.name} ${mode} retains exactly one reachable main`, async () => {
  if (Page === ManagerSchedule) state.role = 'sales_manager'
  state.readPending = mode === 'loading' ? 'sales_schedules' : ''; state.readError = mode === 'error' ? 'sales_schedules' : ''; if (mode === 'empty') state.schedules = []
  mount(Page)
  if (mode === 'error') await screen.findByRole('alert'); else if (mode === 'empty') await screen.findByText(/Tidak ada kunjungan/); else await screen.findByText(/Memuat (jadwal|kunjungan Anda)/)
  expect(screen.queryByText('Private backend detail')).toBeNull(); expectMain()
})
for (const mode of ['loading', 'error', 'denied', 'ready']) test(`customer ${mode} has one page-owned main without nested history mains`, async () => {
  state.readPending = mode === 'loading' ? 'customers' : ''; state.readError = mode === 'error' ? 'customers' : ''; if (mode === 'denied') state.customer = null
  mount(CustomerDetail, '/girard/customer/c1')
  if (mode === 'ready') await screen.findByRole('heading', { name: 'Synthetic Company' }); else if (mode === 'error') await screen.findByRole('alert'); else if (mode === 'denied') await screen.findByText('Pelanggan tidak ditemukan atau Anda tidak memiliki akses.'); else await screen.findByText(/Loading|Memuat pelanggan/)
  expectMain()
})
test('outlet placeholder remains honest inside one reachable page main', () => { mount(OutletDetail, '/girard/outlet/c1'); expectMain(); expect(screen.getByText(/coming soon|belum tersedia/i)).toBeTruthy() })

test('customer history labels the same WIB check-in instant and keeps next schedule date-only', async () => {
  state.schedules = [schedule({ scheduled_date: '2026-10-04' })]
  state.visits = [{ id: 'v1', outlet_id: 'c1', checked_in_at: '2026-10-04T17:30:00Z', users: { full_name: 'Sales One' } }]
  mount(CustomerDetail, '/girard/customer/c1'); expect(await screen.findByText('4 Oktober 2026')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Riwayat Kunjungan' }))
  expect(await screen.findByText('5 Oktober 2026, 00.30 WIB')).toBeTruthy(); expect(screen.getByText('Waktu check-in').tagName).toBe('DT'); expectMain()
})

test('abandoned proposal recovery unlocks its original retained customer, date and note', async () => {
  state.send.mockImplementationOnce(async () => { state.unresolved = true; throw new Error('Hasil belum diketahui') })
  state.send.reconcile.mockImplementationOnce(async () => { state.unresolved = false; return { state: 'abandoned' } }); vi.spyOn(window, 'confirm').mockReturnValue(true)
  const Proposal = () => <VisitProposalForm />; mount(Proposal)
  await screen.findByRole('option', { name: /Synthetic Company.*Bandung/ })
  fireEvent.change(screen.getByLabelText('Toko'), { target: { value: 'c1' } }); fireEvent.change(screen.getByLabelText('Tanggal kunjungan'), { target: { value: '2026-10-13' } }); fireEvent.change(screen.getByLabelText('Catatan permintaan'), { target: { value: 'Keep proposal' } })
  fireEvent.click(screen.getByRole('button', { name: 'Ajukan kunjungan' })); await screen.findByText('Hasil belum diketahui')
  expect((screen.getByLabelText('Catatan permintaan') as HTMLTextAreaElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' })); await screen.findByText('Permintaan lama telah dibatalkan. Anda dapat menyimpan kembali.')
  expect((screen.getByLabelText('Catatan permintaan') as HTMLTextAreaElement).value).toBe('Keep proposal'); expect((screen.getByRole('button', { name: 'Ajukan kunjungan' }) as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Ajukan kunjungan' })); await waitFor(() => expect(state.send).toHaveBeenCalledTimes(2))
  expect(state.send.mock.calls[1]).toEqual(['propose_visit', { customer_id: 'c1', scheduled_date: '2026-10-13', notes: 'Keep proposal' }]); expect(state.send.acknowledgeRecovered).not.toHaveBeenCalled()
})
test('abandoned request decision unlocks the same original request ID and version', async () => {
  state.role = 'sales_manager'; state.requests = [{ id: requestId, requester_id: 'rep', version: 2, status: 'pending', kind: 'new', customer_id: 'c1', scheduled_date: '2026-10-13' }]
  state.send.mockImplementationOnce(async () => { state.unresolved = true; throw new Error('Hasil belum diketahui') })
  state.send.reconcile.mockImplementationOnce(async () => { state.unresolved = false; return { state: 'abandoned' } }); vi.spyOn(window, 'confirm').mockReturnValue(true)
  mount(VisitRequests, '/girard/visit-requests'); fireEvent.click(await screen.findByRole('button', { name: 'Setujui' })); await screen.findByText('Hasil belum diketahui')
  fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' })); await screen.findByText('Permintaan lama telah dibatalkan. Anda dapat menyimpan kembali.')
  expect((screen.getByRole('button', { name: 'Setujui' }) as HTMLButtonElement).disabled).toBe(false); fireEvent.click(screen.getByRole('button', { name: 'Setujui' }))
  await waitFor(() => expect(state.send).toHaveBeenCalledTimes(2)); expect(state.send.mock.calls[1]).toEqual(['approve_request', { request_id: requestId, expected_version: 2 }]); expect(state.send.acknowledgeRecovered).not.toHaveBeenCalled()
})

test('committed manager recovery remains reachable inside the dialog and keeps verified receipt after close', async () => {
  state.role = 'sales_manager'; state.send.mockImplementationOnce(async () => { state.unresolved = true; throw new Error('Hasil belum diketahui') })
  state.send.reconcile.mockImplementationOnce(async () => { state.unresolved = false; return { state: 'committed', operation: 'create_schedule', result: { id: 'saved', version: 1 } } }); vi.spyOn(window, 'confirm').mockReturnValue(true)
  mount(ManagerSchedule); await openAssignment(); fillAssignment(); fireEvent.click(screen.getByRole('button', { name: 'Tugaskan' })); await screen.findByText('Hasil belum diketahui')
  const dialog = screen.getByRole('dialog', { name: 'Tugaskan kunjungan' }); const recovery = within(dialog).getByRole('button', { name: 'Pulihkan hasil penyimpanan' }); expect(screen.getAllByRole('button', { name: 'Pulihkan hasil penyimpanan' })).toHaveLength(1)
  fireEvent.click(recovery); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(await screen.findByText('Operasi sebelumnya sudah tersimpan. Periksa hasil tersimpan (referensi saved).')).toBeTruthy()
  expect(state.send.acknowledgeRecovered).toHaveBeenCalledTimes(1); expect(state.send).toHaveBeenCalledTimes(1)
})

for (const mode of ['loading', 'error', 'empty']) test(`request inbox ${mode} retains one reachable page main`, async () => {
  state.inboxMode = mode; mount(VisitRequests, '/girard/visit-requests')
  if (mode === 'loading') await screen.findByText('Memuat permintaan...'); else if (mode === 'error') await screen.findByText('Permintaan belum tersedia.'); else await screen.findByText('Belum ada permintaan kunjungan')
  expect(screen.queryByText('Private backend detail')).toBeNull(); expectMain()
})
for (const mode of ['loading', 'error', 'denied', 'ready', 'signed-out', 'invalid']) test(`focused request ${mode} retains the page main and safe exact-ID state`, async () => {
  state.requests = mode === 'ready' ? [{ id: requestId, customer_id: 'c1', scheduled_date: '2026-10-13', status: 'approved', kind: 'new', notes: 'Older retained synthetic request', customers: { name: 'Synthetic Company' } }] : []
  state.readPending = mode === 'loading' ? 'visit_requests' : ''; state.readError = mode === 'error' ? 'visit_requests' : ''; if (mode === 'signed-out') state.actor = ''
  mount(VisitRequests, `/girard/visit-requests#visit-request-${mode === 'invalid' ? 'invalid-id' : requestId}`)
  if (mode === 'loading') await screen.findByText('Memuat status permintaan...'); else if (mode === 'error') await screen.findByText('Status permintaan belum tersedia.'); else if (mode === 'ready') await screen.findByText('Older retained synthetic request'); else if (mode !== 'signed-out') await screen.findByText('Permintaan tidak ditemukan atau Anda tidak memiliki akses.')
  expect(screen.queryByText('Private backend detail')).toBeNull(); expectMain()
})
test('manager deletion retains original version and returns focus safely after the opener row disappears', async () => {
  state.role = 'sales_manager'; let finish!: () => void
  state.send.mockImplementationOnce(() => new Promise(resolve => { finish = () => { state.schedules = []; resolve({ id: 'schedule', version: 4 }) } }))
  mount(ManagerSchedule); const opener = (await screen.findAllByRole('button', { name: 'Hapus' }))[0]; opener.focus(); fireEvent.click(opener)
  const dialog = screen.getByRole('dialog', { name: 'Hapus jadwal kunjungan?' }); fireEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }))
  await waitFor(() => expect(state.send).toHaveBeenCalledWith('delete_schedule', { schedule_id: 'schedule', expected_version: 3 }))
  fireEvent.keyDown(dialog, { key: 'Escape' }); expect(dialog.isConnected).toBe(true)
  await act(async () => finish()); await screen.findByText(/Tidak ada kunjungan yang dijadwalkan/)
  expect(screen.queryByRole('dialog')).toBeNull(); expect(opener.isConnected).toBe(false); expect(document.activeElement?.getAttribute('tabindex')).toBe('-1'); expect(document.activeElement?.textContent).toContain('Jadwal'); expectMain()
})

test('replacing a clean delete confirmation with create or edit leaves one dialog and one recovery presentation', async () => {
  state.role = 'sales_manager'; mount(ManagerSchedule)
  fireEvent.click((await screen.findAllByRole('button', { name: 'Hapus' }))[0])
  fireEvent.click(screen.getByRole('button', { name: '+ Kunjungan' }))
  expect(screen.getAllByRole('dialog')).toHaveLength(1); expect(screen.getByRole('dialog', { name: 'Tugaskan kunjungan' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Hapus' })[0]); fireEvent.click(screen.getAllByRole('button', { name: 'Ubah' })[0])
  expect(screen.getAllByRole('dialog')).toHaveLength(1); expect(screen.getByRole('dialog', { name: 'Ubah jadwal kunjungan' })).toBeTruthy()
})

for (const mode of ['ordinary', 'recovered'] as const) test(`${mode} confirmed deletion keeps stable header focus across delayed fresh rows`, async () => {
  state.role = 'sales_manager'
  let releaseRefresh!: () => void
  const refresh = new Promise<void>(resolve => { releaseRefresh = resolve })
  const committed = () => { state.schedules = []; state.scheduleRefreshGate = refresh; return { id: 'schedule', version: 4 } }
  if (mode === 'ordinary') state.send.mockImplementationOnce(async () => committed())
  else {
    state.send.mockImplementationOnce(async () => { state.unresolved = true; throw new Error('Hasil belum diketahui') })
    state.send.reconcile.mockImplementationOnce(async () => { state.unresolved = false; return { state: 'committed', operation: 'delete_schedule', result: committed() } })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  }
  mount(ManagerSchedule)
  const opener = (await screen.findAllByRole('button', { name: 'Hapus' }))[0]; opener.focus(); fireEvent.click(opener)
  const dialog = screen.getByRole('dialog', { name: 'Hapus jadwal kunjungan?' }); fireEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }))
  await waitFor(() => expect(state.send).toHaveBeenCalledWith('delete_schedule', { schedule_id: 'schedule', expected_version: 3 }))
  if (mode === 'recovered') { await screen.findByText('Hasil belum diketahui'); fireEvent.click(within(dialog).getByRole('button', { name: 'Pulihkan hasil penyimpanan' })) }
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); expect(state.gatedScheduleReads).toBeGreaterThan(0) })
  expect(opener.isConnected).toBe(true)
  const stableTarget = document.activeElement
  // Close must target stable owner content even before the cached row disappears.
  expect(stableTarget).not.toBe(opener); expect(stableTarget?.getAttribute('tabindex')).toBe('-1'); expect(stableTarget?.textContent).toContain('Jadwal')
  await act(async () => releaseRefresh()); await screen.findByText(/Tidak ada kunjungan yang dijadwalkan/)
  expect(opener.isConnected).toBe(false); expect(document.activeElement).toBe(stableTarget); expect(document.activeElement).not.toBe(document.body)
  expect(state.send).toHaveBeenCalledTimes(1)
  expect(state.send.acknowledgeRecovered).toHaveBeenCalledTimes(mode === 'recovered' ? 1 : 0)
  expectMain()
})
for (const close of ['Batal', 'Escape'] as const) test(`delete ${close} returns to its existing opener without sending`, async () => {
  state.role = 'sales_manager'; mount(ManagerSchedule)
  const opener = (await screen.findAllByRole('button', { name: 'Hapus' }))[0]; opener.focus(); fireEvent.click(opener)
  const dialog = screen.getByRole('dialog', { name: 'Hapus jadwal kunjungan?' })
  if (close === 'Batal') fireEvent.click(within(dialog).getByRole('button', { name: 'Batal' })); else fireEvent.keyDown(dialog, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(document.activeElement).toBe(opener); expect(state.send).not.toHaveBeenCalled()
})
for (const outcome of ['committed', 'abandoned'] as const) test(`deferred ${outcome} recovery cannot clear a newer actor and role owner's draft or attach its receipt`, async () => {
  state.role = 'sales_manager'
  const newerSend = Object.assign(vi.fn(), { hasUnresolved: () => false, reconcile: vi.fn(), acknowledgeRecovered: vi.fn() })
  state.senders.set('new-actor', newerSend)
  state.send.mockImplementationOnce(async () => { state.unresolved = true; throw new Error('Hasil belum diketahui') })
  let finishRecovery!: () => void
  state.send.reconcile.mockImplementationOnce(() => new Promise(resolve => { finishRecovery = () => { state.unresolved = false; resolve(outcome === 'committed' ? { state: outcome, operation: 'create_schedule', result: { id: 'older-result', version: 1 } } : { state: outcome }) } }))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  let refreshIdentity!: () => void
  function ScopedManager() { const [, refresh] = React.useState(0); refreshIdentity = () => refresh(value => value + 1); return <ManagerSchedule /> }
  mount(ScopedManager); await openAssignment(); fillAssignment(); fireEvent.click(screen.getByRole('button', { name: 'Tugaskan' })); await screen.findByText('Hasil belum diketahui')
  fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' })); await waitFor(() => expect(state.send.reconcile).toHaveBeenCalledTimes(1))
  state.actor = 'new-actor'; state.role = 'executive'; await act(async () => refreshIdentity())
  await openAssignment(); fillAssignment(); fireEvent.change(screen.getByLabelText('Catatan jadwal'), { target: { value: 'Newer owner draft' } })
  const newerDialog = screen.getByRole('dialog', { name: 'Tugaskan kunjungan' })
  await act(async () => finishRecovery())
  expect(newerDialog.isConnected).toBe(true); expect(newerDialog.contains(document.activeElement)).toBe(true)
  expect((screen.getByLabelText('Pelanggan') as HTMLSelectElement).value).toBe('c1'); expect((screen.getByLabelText('Petugas kunjungan') as HTMLSelectElement).value).toBe('rep')
  expect((screen.getByLabelText('Tanggal jadwal') as HTMLInputElement).value).toBe('2026-10-13'); expect((screen.getByLabelText('Catatan jadwal') as HTMLTextAreaElement).value).toBe('Newer owner draft')
  expect(screen.queryByText(/referensi older-result/)).toBeNull(); expect(newerSend).not.toHaveBeenCalled(); expect(newerSend.acknowledgeRecovered).not.toHaveBeenCalled()
  expect(state.send.acknowledgeRecovered).toHaveBeenCalledTimes(outcome === 'committed' ? 1 : 0)
})
