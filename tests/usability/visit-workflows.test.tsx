import { MemoryRouter } from 'react-router-dom'
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ role: 'executive', search: '', schedules: [] as any[], requests: [] as any[], send: Object.assign(vi.fn(), { hasUnresolved: () => false }), navigate: vi.fn() }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'actor', role: state.role } }) }))
vi.mock('../../src/lib/visitTransactions', () => ({ useVisitPlanningSender: () => state.send }))
vi.mock('../../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../../src/components/ActivePromotionsBanner', () => ({ default: () => null }))
vi.mock('../../src/lib/CustomerStats', () => ({ fetchCustomerStatsBatch: async () => [{ customer_id: 'c1', order_count: 1, total_sales: '50000', top_items: [] }] }))
vi.mock('../../src/lib/useUnsavedChanges', () => ({ useUnsavedChanges: () => ({ dialog: null, confirmDiscard: (fn: () => void) => fn() }) }))
const customers = [
 { id: 'c1', name: 'Synthetic Company', city: 'Bandung', address: 'Cabang Utara', last_visit_date: null, visit_frequency_days: 7 },
 { id: 'c2', name: 'Synthetic Company', city: 'Jakarta', address: 'Cabang Selatan', last_visit_date: null, visit_frequency_days: 7 },
]
vi.mock('../../src/lib/supabase', () => ({ supabase: { from: (table: string) => {
 const filters: [string, unknown][] = []
 const rows = () => (table === 'customers' ? customers : table === 'users' ? [{ id: 'actor', full_name: 'Leader', role: 'executive', manager_id: null }, { id: 'rep', full_name: 'Sales One', role: 'sales_person', manager_id: 'manager' }, { id: 'manager', full_name: 'Manager One', role: 'sales_manager', manager_id: null }] : table === 'sales_schedules' ? state.schedules : table === 'visit_requests' ? state.requests : []).filter(row => filters.every(([key, value]) => (row as any)[key] === value))
 const q: any = { select: () => q, eq: (key: string, value: unknown) => { if (['requester_id','status','scheduled_date'].includes(key) && table === 'visit_requests') filters.push([key, value]); return q }, in: () => q, order: () => q, range: () => q, abortSignal: () => q, single: async () => ({ data: { id: 'actor', full_name: 'Leader', role: 'executive', manager_id: null }, error: null }), then: (resolve: any) => Promise.resolve({ data: rows(), count: rows().length, error: null }).then(resolve) }; return q
} } }))
import ManagerSchedule from '../../src/pages/girard/ManagerSchedule'
import DailySchedule from '../../src/pages/girard/DailySchedule'
import MyVisits from '../../src/pages/girard/MyVisits'
import { calendarDateKey } from '../../src/lib/calendarDate'
const clients: QueryClient[] = []
function mount(Page: React.ComponentType) { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client); render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/girard/schedule?${state.search}`]}><Page /></MemoryRouter></QueryClientProvider>) }
const schedule = (extras = {}) => ({ id: 'schedule', version: 1, outlet_id: 'c1', sales_person_id: 'rep', scheduled_date: calendarDateKey(), status: 'pending', notes: null, customers: customers[0], users: { id: 'rep', full_name: 'Sales One' }, outlet_visits: [], ...extras })
beforeEach(() => { state.role = 'executive'; state.search = ''; state.schedules = []; state.requests = []; state.send.mockReset().mockResolvedValue({ id: 'saved', version: 1 }); state.navigate.mockReset() })
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()) })
async function openAssignment() { mount(ManagerSchedule); await screen.findByRole('button', { name: '+ Kunjungan' }); fireEvent.click(screen.getByRole('button', { name: '+ Kunjungan' })); await screen.findAllByRole('option', { name: /Synthetic Company/ }) }
function fillAssignment(date = '2026-10-12') { fireEvent.change(screen.getByLabelText('Pelanggan'), { target: { value: 'c1' } }); fireEvent.change(screen.getByLabelText('Petugas kunjungan'), { target: { value: 'rep' } }); fireEvent.change(screen.getByLabelText('Tanggal jadwal'), { target: { value: date } }) }
test('assignment searches branch context and labels assignee role and manager', async () => {
 await openAssignment(); fireEvent.change(screen.getByRole('searchbox', { name: 'Cari pelanggan' }), { target: { value: 'selatan' } });
 expect(screen.queryByRole('option', { name: /Bandung/ })).toBeNull(); expect(screen.getByRole('option', { name: /Synthetic Company.*Jakarta.*Cabang Selatan/ })).toBeTruthy();
 expect(within(screen.getByLabelText('Petugas kunjungan')).getByRole('option', { name: /Sales One.*Staf Penjualan.*Tim Manager One/ })).toBeTruthy()
})
test('edited date survives clearing and refilling, and saved confirmation identifies chosen day', async () => {
 await openAssignment(); fillAssignment(); fireEvent.change(screen.getByLabelText('Tanggal jadwal'), { target: { value: '' } }); fireEvent.click(screen.getByRole('button', { name: 'Tugaskan' })); expect(state.send).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('Tanggal jadwal'), { target: { value: '2026-10-13' } }); fireEvent.click(screen.getByRole('button', { name: 'Tugaskan' }));
 await waitFor(() => expect(state.send).toHaveBeenCalledWith('create_schedule', expect.objectContaining({ scheduled_date: '2026-10-13' })));
 expect(await screen.findByText(/Kunjungan tersimpan.*13 Oktober 2026/)).toBeTruthy(); expect(screen.getByRole('link', { name: 'Lihat kunjungan tersimpan' }).getAttribute('href')).toBe('/girard/visit/saved')
})
test('duplicate scheduling failure is actionable and a fresh draft clears it without exposing hidden data', async () => {
 state.send.mockRejectedValue(new Error('duplicate key value violates unique constraint "one_rep_per_customer_per_day"'));
 await openAssignment(); fillAssignment(); fireEvent.click(screen.getByRole('button', { name: 'Tugaskan' }));
 expect(await screen.findByText(/Pelanggan ini sudah memiliki jadwal pada tanggal tersebut/)).toBeTruthy(); expect(screen.queryByText(/one_rep_per_customer_per_day/)).toBeNull(); expect(screen.getByText(/Detail jadwal hanya ditampilkan sesuai akses Anda/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button', { name: 'Batal' })); fireEvent.click(screen.getByRole('button', { name: '+ Kunjungan' })); expect(screen.queryByText(/Pelanggan ini sudah memiliki jadwal/)).toBeNull()
})
test('visible schedule conflict offers only the already authorized visit', async () => {
 state.schedules = [schedule()]; state.send.mockRejectedValue(new Error('duplicate key value violates unique constraint "one_rep_per_customer_per_day"')); await openAssignment(); fillAssignment(calendarDateKey()); fireEvent.click(screen.getByRole('button', { name: 'Tugaskan' }));
 expect((await screen.findByRole('link', { name: /Lihat jadwal yang sudah ada/ })).getAttribute('href')).toBe('/girard/visit/schedule')
})
test('selected-day empty text uses the actual date', async () => {
 mount(ManagerSchedule); fireEvent.change(screen.getByLabelText('Lihat tanggal'), { target: { value: '2026-10-12' } }); expect(await screen.findByText(/Tidak ada kunjungan.*12 Oktober 2026/)).toBeTruthy()
})
test('team drilldown retains date, person and completed filter without broadening visible data', async () => {
 state.search = 'date=2026-10-12&person=rep&status=visited'; state.schedules = [schedule({ scheduled_date: '2026-10-12', outlet_visits: [{ id: 'v' }] }), schedule({ id: 'other', sales_person_id: 'other', scheduled_date: '2026-10-12', customers: { id: 'c2', name: 'Excluded person' }, outlet_visits: [{ id: 'v2' }] }), schedule({ id: 'pending', scheduled_date: '2026-10-12', customers: { id: 'c3', name: 'Excluded pending' } })]; mount(ManagerSchedule);
 await screen.findByText(/Jadwal tim.*12 Oktober 2026.*Sales One.*Sudah dikunjungi/); expect(screen.queryByText('Excluded person')).toBeNull(); expect(screen.queryByText('Excluded pending')).toBeNull()
})
test('request success remains visible after closing form and links to pending request status', async () => {
 state.role = 'sales_person'; mount(DailySchedule); fireEvent.click(screen.getByRole('button', { name: 'Ajukan kunjungan baru' })); await screen.findAllByRole('option', { name: /Synthetic Company/ }); fireEvent.change(screen.getByLabelText('Toko'), { target: { value: 'c1' } }); fireEvent.click(screen.getByRole('button', { name: 'Ajukan kunjungan' }));
 expect(await screen.findByText(/Permintaan terkirim/)).toBeTruthy(); expect(screen.queryByLabelText('Catatan permintaan')).toBeNull(); expect(screen.getByRole('link', { name: 'Lihat status permintaan' }).getAttribute('href')).toBe('/girard/visit-requests#visit-request-saved'); expect(screen.getByText(/Status saat pengiriman: Menunggu persetujuan/)).toBeTruthy()
})
test('return screen separately loads pending requests for the owner and selected date', async () => {
 state.role = 'sales_person'; state.requests = [{ id: 'req', requester_id: 'actor', status: 'pending', scheduled_date: calendarDateKey(), customer_id: 'c1' }, { id: 'other', requester_id: 'other', status: 'pending', scheduled_date: calendarDateKey() }]; mount(DailySchedule);
 expect(await screen.findByText(/1 permintaan menunggu persetujuan/)).toBeTruthy(); expect(screen.getByRole('link', { name: 'Buka permintaan kunjungan' })).toBeTruthy()
})
for (const Page of [DailySchedule, MyVisits]) test(`${Page.name} never-visited customer is not presented as a newly late appointment`, async () => {
 state.schedules = [schedule()]; mount(Page); expect(await screen.findByText('Belum pernah dikunjungi')).toBeTruthy(); expect(screen.queryByText('Terlambat')).toBeNull(); expect(screen.getByText(/Jadwal memakai tanggal tanpa jam/)).toBeTruthy(); expect(await screen.findByText('Rp 50.000')).toBeTruthy()
})
test('revisit-age warning shows existing strict UTC cutoff rather than inventing appointment time', async () => {
 state.schedules = [schedule()]; customers[0].last_visit_date = '2020-01-01' as any; mount(MyVisits); expect(await screen.findByText('Interval kunjungan terlewati')).toBeTruthy(); expect(screen.getByText(/8 Januari 2020.*00.00.*UTC/)).toBeTruthy(); customers[0].last_visit_date = null
})
test('filtered day counts and visit detail links agree with team drilldown rows', async () => {
 const date = calendarDateKey(); state.search = `date=${date}&person=rep`; state.schedules = [schedule(), schedule({ id: 'outside', sales_person_id: 'other' })]; mount(ManagerSchedule);
 expect(await screen.findByRole('button', { name: /Hari Ini.*1 kunjungan/ })).toBeTruthy(); expect(screen.getAllByRole('link', { name: 'Lihat rincian kunjungan' })[0].getAttribute('href')).toBe('/girard/visit/schedule')
})
