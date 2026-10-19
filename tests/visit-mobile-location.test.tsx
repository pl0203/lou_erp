import React, { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  profile: { id: 'u', role: 'sales_person' }, scheduleId: 's',
  schedule: {} as any, visit: null as any, scheduleLoading: false, visitLoading: false, visitError: false,
  unresolved: false, checkIn: vi.fn(),
}))
vi.mock('react-router-dom', () => ({ Link: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a>, useNavigate: () => () => {}, useParams: () => ({ scheduleId: state.scheduleId }) }))
vi.mock('../src/lib/useUnsavedChanges', () => ({ useUnsavedChanges: () => ({ dialog: null, confirmDiscard: (fn: () => void) => fn() }) }))
vi.mock('../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../src/components/StorePOContext', () => ({ default: ({ collapsible }: any) => <section aria-label="Riwayat PO toko" data-collapsible={collapsible}>PO history</section> }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: state.profile }) }))
vi.mock('../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../src/lib/visitCheckIn', () => ({ createVisitCheckIn: () => state.checkIn }))
vi.mock('../src/lib/orderTransactions', () => ({ useTransactionSender: () => Object.assign(vi.fn(), { hasUnresolved: () => state.unresolved, pending: () => [] }) }))
vi.mock('../src/components/TransactionRecovery', () => ({ default: () => null }))
vi.mock('@tanstack/react-query', async original => ({ ...await original<any>(), useQuery: ({ queryKey }: any) => queryKey[0] === 'schedule'
  ? { data: state.schedule, isLoading: state.scheduleLoading }
  : { data: state.visit, isLoading: state.visitLoading, isError: state.visitError } }))
import VisitPage from '../src/pages/girard/VisitPage'

type Request = { success: PositionCallback; failure?: PositionErrorCallback | null }
const requests: Request[] = []
const geolocation = vi.fn((success: PositionCallback, failure?: PositionErrorCallback | null) => { requests.push({ success, failure }) })
const watchPosition = vi.fn()
const clients: QueryClient[] = []
// Deliberately synthetic coordinates, not a user or store location.
const point = (lat = 1.25, lng = 2.5) => ({ coords: { latitude: lat, longitude: lng } }) as GeolocationPosition
beforeEach(() => {
  requests.length = 0; geolocation.mockClear(); watchPosition.mockClear(); state.checkIn.mockReset(); localStorage.clear()
  state.profile = { id: 'u', role: 'sales_person' }; state.scheduleId = 's'; state.visit = null
  state.scheduleLoading = false; state.visitLoading = false; state.visitError = false; state.unresolved = false
  state.schedule = { id: 's', version: 1, status: 'pending', sales_person_id: 'u', scheduled_date: '2026-10-19', customers: { id: 'c', name: 'PT TOKO CONTOH BAHAN BANGUNAN NUSANTARA (Kota Contoh)', address: 'Jalan Contoh yang Sangat Panjang Nomor 123, Kecamatan Contoh, Kota Contoh 12345', city: 'Kota Contoh' } }
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: geolocation, watchPosition } })
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks() })
function mount(strict = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client)
  const tree = () => <QueryClientProvider client={client}>{strict ? <StrictMode><VisitPage /></StrictMode> : <VisitPage />}</QueryClientProvider>
  const result = render(tree()); return { ...result, refresh: () => result.rerender(tree()) }
}
async function requested(count = 1) { await waitFor(() => expect(geolocation).toHaveBeenCalledTimes(count)) }

test('check-in is ahead of collapsible PO history while full customer, address, and date remain available', () => {
  mount()
  const heading = screen.getByRole('heading', { name: 'Check-in' })
  const history = screen.getByRole('region', { name: 'Riwayat PO toko' })
  expect(heading.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(history.getAttribute('data-collapsible')).toBe('true')
  expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(state.schedule.customers.name)
  expect(screen.getByText(/Jalan Contoh yang Sangat Panjang/).textContent).toContain(state.schedule.customers.address)
  expect(screen.getByText(/Jadwal:/).textContent).toContain('19 Oktober 2026')
})

test('eligible form requests location once automatically, without starting tracking or saving', async () => {
  const view = mount(true); await requested()
  expect(screen.queryByRole('button', { name: 'Dapatkan lokasi' })).toBeNull()
  expect(screen.getByText(/Mendapatkan lokasi/)).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Catatan kunjungan'), { target: { value: 'A note' } }); view.refresh()
  expect(geolocation).toHaveBeenCalledTimes(1)
  act(() => requests[0].success(point()))
  expect(screen.getByText(/Lokasi berhasil didapat/)).toBeTruthy()
  expect(watchPosition).not.toHaveBeenCalled(); expect(state.checkIn).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0)
})

test.each(['schedule-loading', 'visit-loading', 'visit-error', 'unowned', 'completed', 'existing', 'unknown-outcome'])('does not request location for %s', async mode => {
  if (mode === 'schedule-loading') state.scheduleLoading = true
  if (mode === 'visit-loading') state.visitLoading = true
  if (mode === 'visit-error') state.visitError = true
  if (mode === 'unowned') state.schedule.sales_person_id = 'other'
  if (mode === 'completed') state.schedule.status = 'completed'
  if (mode === 'existing') state.visit = { id: 'v', sales_person_id: 'other', checked_in_at: '2026-10-19T00:00:00Z', lat: null, lng: null, visit_photos: [] }
  if (mode === 'unknown-outcome') state.unresolved = true
  mount(); await act(async () => {})
  expect(geolocation).not.toHaveBeenCalled()
})

test('waits for both reads before automatically requesting location', async () => {
  state.visitLoading = true; const view = mount(); expect(geolocation).not.toHaveBeenCalled()
  state.visitLoading = false; view.refresh(); await requested()
})

test.each([1, 2, 3])('location error %s keeps optional fallback and retries only on explicit action', async code => {
  const view = mount(); await requested(); act(() => requests[0].failure?.({ code } as GeolocationPositionError))
  expect(screen.getByText(/tetap bisa check-in tanpa lokasi/)).toBeTruthy(); view.refresh(); expect(geolocation).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Coba lagi lokasi' })); await requested(2)
  act(() => requests[1].success(point())); expect(screen.getByText(/Lokasi berhasil didapat/)).toBeTruthy()
})

test('unsupported geolocation and synchronous browser failure retain optional check-in fallback', async () => {
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined }); const view = mount()
  expect(await screen.findByText(/tetap bisa check-in tanpa lokasi/)).toBeTruthy()
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: () => { throw new Error('blocked') } } })
  fireEvent.click(screen.getByRole('button', { name: 'Coba lagi lokasi' })); view.refresh()
  expect(screen.getByText(/tetap bisa check-in tanpa lokasi/)).toBeTruthy()
})

test.each(['actor', 'schedule', 'version', 'eligibility'])('late callback cannot cross a changed %s boundary', async change => {
  const view = mount(); await requested(); const first = requests[0]
  if (change === 'actor') { state.profile = { id: 'new-user', role: 'sales_person' }; state.schedule.sales_person_id = 'new-user' }
  if (change === 'schedule') state.scheduleId = 'new-schedule'
  if (change === 'version') state.schedule = { ...state.schedule, version: 2 }
  if (change === 'eligibility') state.schedule = { ...state.schedule, status: 'completed' }
  view.refresh(); await act(async () => {}); act(() => first.success(point(1, 2)))
  expect(screen.queryByText(/Lokasi berhasil didapat/)).toBeNull()
  if (change !== 'eligibility') { await requested(2); act(() => requests[1].success(point())); expect(screen.getByText(/Lokasi berhasil didapat/)).toBeTruthy() }
})

test('unmount rejects a late result and a new form gets a fresh one-shot request', async () => {
  const view = mount(); await requested(); view.unmount(); act(() => requests[0].success(point()))
  mount(); await requested(2); expect(screen.queryByText(/Lokasi berhasil didapat/)).toBeNull()
})
