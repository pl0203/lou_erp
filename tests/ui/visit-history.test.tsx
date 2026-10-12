import React from 'react'
import { transferableAbortController } from 'node:util'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  history: [] as any[], total: 21, historyError: false, historyPending: false,
  schedule: null as any, visit: null as any, scheduleError: false, schedulePending: false, visitError: false,
  note: { id: 'v1', notes: 'Server note', note_version: 2 }, noteError: false,
  unresolved: false, send: Object.assign(vi.fn(), { hasUnresolved: () => false, reconcile: vi.fn(), acknowledgeRecovered: vi.fn() }),
  reads: [] as { table: string; select: string; options: unknown; filters: [string, unknown][]; orders: [string, unknown][]; range?: number[] }[],
}))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'sales', role: 'sales_person' } }) }))
vi.mock('../../src/components/GirardNav', () => ({ default: () => <nav aria-label="Navigasi modul">Modul</nav> }))
vi.mock('../../src/components/StorePOContext', () => ({ default: () => null }))
vi.mock('../../src/lib/reads/usePagedRead', () => ({ usePagedRead: () => ({ page: 1, data: { total: 0, items: [] }, isPending: false, isError: false, setPage: vi.fn() }) }))
vi.mock('../../src/lib/visitTransactions', () => ({ useVisitPlanningSender: () => state.send }))
vi.mock('../../src/lib/orderTransactions', () => ({ useTransactionSender: () => state.send }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { from: (table: string) => {
  const read = { table, select: '', options: undefined as unknown, filters: [] as [string, unknown][], orders: [] as [string, unknown][], range: undefined as number[] | undefined }
  state.reads.push(read)
  const query: any = {
    select: (select: string, options: unknown) => { read.select = select; read.options = options; return query },
    eq: (key: string, value: unknown) => { read.filters.push([key, value]); return query },
    order: (key: string, options: unknown) => { read.orders.push([key, options]); return query },
    range: (start: number, end: number) => { read.range = [start, end]; return query },
    maybeSingle: async () => {
      if (read.select === 'id, notes, note_version') return { data: state.noteError ? null : state.note, error: state.noteError ? new Error('unavailable') : null }
      if (table === 'sales_schedules') {
        if (state.schedulePending) return new Promise(() => {})
        return { data: state.schedule, error: state.scheduleError ? new Error('Private server details') : null }
      }
      return { data: state.visit, error: state.visitError ? new Error('unavailable') : null }
    },
    then: (resolve: any, reject: any) => (state.historyPending ? new Promise(() => {}) : Promise.resolve({ data: state.history, count: state.total, error: state.historyError ? new Error('unavailable') : null })).then(resolve, reject),
  }
  return query
} } }))
import OwnVisitHistory, { fetchOwnVisitHistory } from '../../src/pages/girard/OwnVisitHistory'
import VisitPage from '../../src/pages/girard/VisitPage'

const clients: QueryClient[] = []
const routers: ReturnType<typeof createMemoryRouter>[] = []
const historyVisit = (overrides = {}) => ({ id: 'v1', sales_person_id: 'sales', outlet_id: 'c1', schedule_id: 's1', checked_in_at: '2026-10-04T17:30:00Z', lat: null, lng: null, notes: 'Saved note', note_version: 1, customers: { id: 'c1', name: 'First store' }, sales_schedules: { scheduled_date: '2026-10-04' }, ...overrides })
beforeEach(() => {
  vi.stubGlobal('AbortController', class { constructor() { return transferableAbortController() } })
  state.history = [historyVisit()]; state.total = 21; state.historyError = false; state.historyPending = false
  state.schedule = { id: 's1', version: 1, sales_person_id: 'sales', scheduled_date: '2026-10-04', status: 'visited', customers: { id: 'c1', name: 'First store', address: null, city: null, pricing_tier: 'luar_kota' } }
  state.visit = { ...historyVisit(), visit_photos: [] }; state.scheduleError = false; state.schedulePending = false; state.visitError = false
  state.note = { id: 'v1', notes: 'Server note', note_version: 2 }; state.noteError = false; state.unresolved = false; state.reads = []
  state.send.mockReset().mockResolvedValue({ id: 'v1', version: 2 }); state.send.hasUnresolved = () => state.unresolved
  state.send.reconcile.mockReset(); state.send.acknowledgeRecovered.mockReset()
})
afterEach(() => { cleanup(); routers.splice(0).forEach(router => router.dispose()); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })
function mount(path = '/girard/visit-history') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client)
  const router = createMemoryRouter([{ path: '/girard/visit-history', element: <OwnVisitHistory /> }, { path: '/girard/visit/:scheduleId', element: <VisitPage /> }, { path: '/away', element: <p>Other route</p> }], { initialEntries: [path] })
  routers.push(router); render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>); return router
}
function expectMain() {
  const mains = screen.getAllByRole('main'); expect(mains).toHaveLength(1)
  expect(mains[0].id).toBe('main-content'); expect(mains[0].tabIndex).toBe(-1)
  expect(document.querySelectorAll('#main-content')).toHaveLength(1)
  expect(screen.getByRole('navigation', { name: 'Navigasi modul' }).compareDocumentPosition(mains[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(mains[0].querySelector('main')).toBeNull()
}
async function editNote(value = 'Retained draft') {
  fireEvent.click(await screen.findByRole('button', { name: 'Edit catatan' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Catatan kunjungan' }), { target: { value } })
}

test('history labels metadata, keeps date-only schedule and outlines a real detail link', async () => {
  mount(); await screen.findByRole('heading', { name: 'First store' })
  const article = screen.getByRole('article')
  expect(within(article).getByText('Waktu check-in').tagName).toBe('DT')
  expect(within(article).getByText('5 Oktober 2026, 00.30 WIB').tagName).toBe('DD')
  expect(within(article).getByText('4 Oktober 2026')).toBeTruthy()
  expect(within(article).getByText('Lokasi').tagName).toBe('DT')
  expect(within(article).getByText('Tidak dicatat')).toBeTruthy()
  const link = within(article).getByRole('link', { name: 'Lihat detail kunjungan' })
  expect(link.getAttribute('href')).toBe('/girard/visit/s1')
  expect(link.classList.contains('ui-action--secondary')).toBe(true)
  expect(within(article).queryByRole('button', { name: /Lihat.*kunjungan/ })).toBeNull()
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.getByText('1–20 dari 21')).toBeTruthy()
  expect(screen.getByText('Halaman 1 dari 2')).toBeTruthy()
  expectMain()
})

test('history and detail display the same visit instant without changing the scheduled date', async () => {
  const router = mount(); await screen.findByText('5 Oktober 2026, 00.30 WIB')
  await act(async () => { await router.navigate('/girard/visit/s1') })
  expect(await screen.findByText('5 Oktober 2026, 00.30 WIB')).toBeTruthy()
  expect(screen.getByText('Jadwal: 2026-10-04')).toBeTruthy()
  expectMain()
})

test('historical visit with no schedule omits detail action and uses missing-time fallback', async () => {
  state.history = [historyVisit({ schedule_id: null, checked_in_at: null, sales_schedules: null })]
  mount(); expect(await screen.findByText('Waktu tidak tersedia')).toBeTruthy()
  expect(screen.getByText('Kunjungan historis')).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Lihat detail kunjungan' })).toBeNull()
})

test('own history read retains exact actor scope, count, ordering and server 20-row page', async () => {
  await fetchOwnVisitHistory('sales', 2)
  expect(state.reads).toHaveLength(1)
  expect(state.reads[0]).toMatchObject({ table: 'outlet_visits', options: { count: 'exact' }, filters: [['sales_person_id', 'sales']], orders: [['checked_in_at', { ascending: false }], ['id', undefined]], range: [20, 39] })
  expect(state.reads[0].select).not.toContain('visit_photos')
  expect(state.reads[0].select).not.toContain('status')
})

test.each(['ctrlKey', 'metaKey', 'shiftKey', 'altKey'])('modified detail %s click preserves href and current dirty draft', async modifier => {
  const router = mount(); await editNote()
  const link = screen.getByRole('link', { name: 'Lihat detail kunjungan' })
  let intercepted = true
  document.addEventListener('click', event => { intercepted = event.defaultPrevented; event.preventDefault() }, { once: true })
  fireEvent.click(link, { [modifier]: true, button: 0 })
  expect(intercepted).toBe(false)
  expect(router.state.location.pathname).toBe('/girard/visit-history')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect((screen.getByRole('textbox', { name: 'Catatan kunjungan' }) as HTMLTextAreaElement).value).toBe('Retained draft')
})

test.each(['loading', 'error', 'empty'])('history %s owns one reachable main target', async mode => {
  state.historyPending = mode === 'loading'; state.historyError = mode === 'error'; if (mode === 'empty') { state.history = []; state.total = 0 }
  mount()
  if (mode === 'loading') expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Memuat riwayat...')
  if (mode === 'error') expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Riwayat belum tersedia.'))
  if (mode === 'empty') expect(await screen.findByRole('region', { name: 'Belum ada kunjungan.' })).toBeTruthy()
  expectMain()
})

test.each(['loading', 'error', 'denied', 'customer-missing', 'visit-error'])('detail %s owns one reachable main without leaking private server data', async mode => {
  state.schedulePending = mode === 'loading'; state.scheduleError = mode === 'error'
  if (mode === 'denied' || mode === 'error') state.schedule = null
  if (mode === 'customer-missing') state.schedule = { ...state.schedule, customers: null }
  state.visitError = mode === 'visit-error'
  mount('/girard/visit/s1')
  if (mode === 'loading') await screen.findByText('Memuat...')
  else if (mode === 'visit-error') await screen.findByText('Status kunjungan belum tersedia.')
  else if (mode === 'denied') await screen.findByText('Jadwal tidak ditemukan atau Anda tidak memiliki akses.')
  else if (mode === 'error') await screen.findByText('Gagal memuat jadwal. Silakan muat ulang halaman untuk mencoba lagi.')
  else await screen.findByText('Pelanggan untuk jadwal ini tidak tersedia. Hubungi administrator.')
  expect(screen.queryByText('Private server details')).toBeNull(); expectMain()
})

test('note edit uses associated field and primary save with secondary cancel, preserving reviewed payload', async () => {
  mount(); await editNote('Edited note')
  const textarea = screen.getByRole('textbox', { name: 'Catatan kunjungan' }) as HTMLTextAreaElement
  expect(textarea.id).toBeTruthy(); expect(textarea.maxLength).toBe(2000)
  expect(screen.getByText('Catatan kunjungan', { selector: 'label' }).getAttribute('for')).toBe(textarea.id)
  expect(screen.getByRole('button', { name: 'Simpan catatan' }).classList.contains('ui-action--primary')).toBe(true)
  expect(screen.getByRole('button', { name: 'Batal' }).classList.contains('ui-action--secondary')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Simpan catatan' }))
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
  expect(state.send).toHaveBeenCalledWith('edit_visit_note', { visit_id: 'v1', expected_version: 1, notes: 'Edited note' })
})

test('unknown note result keeps the exact draft, blocks new sends and allows recovery', async () => {
  state.send.mockImplementationOnce(async () => { state.unresolved = true; throw new Error('Hasil belum diketahui') })
  let finish!: () => void
  state.send.reconcile.mockImplementationOnce(() => new Promise(resolve => { finish = () => { state.unresolved = false; resolve({ state: 'abandoned' }) } }))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  mount(); await editNote()
  fireEvent.click(screen.getByRole('button', { name: 'Simpan catatan' }))
  await screen.findByText('Hasil belum diketahui')
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Retained draft')
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Simpan catatan' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Simpan catatan' })); expect(state.send).toHaveBeenCalledTimes(1)
  const recover = screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' }) as HTMLButtonElement
  fireEvent.click(recover); fireEvent.click(recover)
  expect(state.send.reconcile).toHaveBeenCalledTimes(1)
  expect(recover.disabled).toBe(true)
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true)
  await act(async () => finish())
  await screen.findByText('Permintaan lama telah dibatalkan. Anda dapat menyimpan kembali.')
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Retained draft')
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false)
  expect((screen.getByRole('button', { name: 'Simpan catatan' }) as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Simpan catatan' }))
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
  expect(state.send.mock.calls.at(-1)).toEqual(['edit_visit_note', { visit_id: 'v1', expected_version: 1, notes: 'Retained draft' }])
  expect(state.send.acknowledgeRecovered).not.toHaveBeenCalled()
})

test('conflict warns clearly and preserves draft until latest server version is reviewed', async () => {
  state.send.mockRejectedValueOnce(new Error('Visit notes changed; refresh'))
  mount(); await editNote()
  fireEvent.click(screen.getByRole('button', { name: 'Simpan catatan' }))
  await screen.findByText('Server note')
  const warning = screen.getAllByRole('alert').find(alert => alert.textContent?.includes('Draf Anda tetap'))
  expect(warning).toBeTruthy()
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Retained draft')
  expect((screen.getByRole('button', { name: 'Simpan catatan' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Simpan draf pada versi terbaru' }))
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
  expect(state.send.mock.calls.at(-1)).toEqual(['edit_visit_note', { visit_id: 'v1', expected_version: 2, notes: 'Retained draft' }])
})

test('conflict read failure uses one warning region and retries without changing the draft', async () => {
  state.send.mockRejectedValueOnce(new Error('Visit notes changed; refresh')); state.noteError = true
  mount(); await editNote()
  fireEvent.click(screen.getByRole('button', { name: 'Simpan catatan' }))
  await screen.findByText('Catatan terbaru belum tersedia.')
  expect(screen.getAllByRole('alert')).toHaveLength(1)
  const retry = screen.getByRole('button', { name: 'Muat catatan terbaru' })
  expect(retry.classList.contains('ui-action--secondary')).toBe(true)
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Retained draft')
  expect((screen.getByRole('button', { name: 'Simpan catatan' }) as HTMLButtonElement).disabled).toBe(true)
  state.noteError = false; fireEvent.click(retry)
  await screen.findByText('Server note')
  fireEvent.click(screen.getByRole('button', { name: 'Gunakan catatan terbaru' }))
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Server note')
  expect(screen.queryByText(/Draf Anda tetap/)).toBeNull()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Edited latest note' } })
  fireEvent.click(screen.getByRole('button', { name: 'Simpan catatan' }))
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
  expect(state.send.mock.calls.at(-1)).toEqual(['edit_visit_note', { visit_id: 'v1', expected_version: 2, notes: 'Edited latest note' }])
})

test('pending note save stays locked and repeated clicks send the same draft only once', async () => {
  let finish!: () => void
  state.send.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ id: 'v1', version: 2 }) }))
  mount(); await editNote()
  const save = screen.getByRole('button', { name: 'Simpan catatan' }) as HTMLButtonElement
  fireEvent.click(save); fireEvent.click(save)
  expect(save.disabled).toBe(true); expect(save.getAttribute('aria-busy')).toBe('true')
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Batal' }) as HTMLButtonElement).disabled).toBe(true)
  expect(state.send).toHaveBeenCalledTimes(1)
  expect(state.send).toHaveBeenCalledWith('edit_visit_note', { visit_id: 'v1', expected_version: 1, notes: 'Retained draft' })
  await act(async () => finish())
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
})
