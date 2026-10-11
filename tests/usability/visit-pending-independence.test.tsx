import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ actor: 'owner', scheduleError: false, pendingError: false, failDate: '', calls: [] as { table: string; filters: Record<string, string> }[] }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: state.actor ? { id: state.actor, role: 'sales_person' } : null }) }))
vi.mock('../../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../../src/components/ActivePromotionsBanner', () => ({ default: () => null }))
vi.mock('../../src/components/VisitRequestInbox', () => ({ VisitProposalForm: () => null }))
vi.mock('../../src/lib/CustomerStats', () => ({ fetchCustomerStatsBatch: async () => [] }))
vi.mock('../../src/lib/useUnsavedChanges', () => ({ useUnsavedChanges: () => ({ dialog: null, confirmDiscard: (fn: () => void) => fn() }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { from: (table: string) => {
 const filters: Record<string, string> = {}
 const q: any = { select: () => q, eq: (key: string, value: string) => { filters[key] = value; return q }, in: () => q, order: () => q, range: () => q, abortSignal: () => q, then: (resolve: any) => {
   state.calls.push({ table, filters: { ...filters } })
   const failed = table === 'sales_schedules' ? state.scheduleError : state.pendingError || !!state.failDate && filters.scheduled_date === state.failDate
   const data = table === 'visit_requests' && filters.requester_id === 'owner' ? [{ id: 'own-pending' }] : []
   return Promise.resolve({ data: failed ? null : data, error: failed ? new Error('Synthetic read failure') : null, count: failed ? null : data.length }).then(resolve)
 } }; return q
} } }))
import DailySchedule from '../../src/pages/girard/DailySchedule'
import { calendarDateKey } from '../../src/lib/calendarDate'
const clients: QueryClient[] = []
function mount() { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client); const view = render(<QueryClientProvider client={client}><DailySchedule /></QueryClientProvider>); return { client, rerender: () => view.rerender(<QueryClientProvider client={client}><DailySchedule /></QueryClientProvider>) } }
beforeEach(() => { state.actor = 'owner'; state.scheduleError = false; state.pendingError = false; state.failDate = ''; state.calls = [] })
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()) })
test('schedule read failure does not hide healthy server-backed pending confirmation after reload', async () => {
 state.scheduleError = true; mount()
 expect(await screen.findByText('Gagal memuat jadwal. Data belum dapat ditampilkan.')).toBeTruthy()
 expect(await screen.findByText('1 permintaan menunggu persetujuan')).toBeTruthy()
 expect(screen.getByRole('link', { name: 'Buka permintaan kunjungan' })).toBeTruthy()
 expect(state.calls.find(call => call.table === 'visit_requests')?.filters).toEqual({ requester_id: 'owner', scheduled_date: calendarDateKey(), status: 'pending' })
 expect(screen.queryByText(/Tidak ada kunjungan dijadwalkan/)).toBeNull()
})
test('pending read failure leaves successful schedule state available and reports its own retry', async () => {
 state.pendingError = true; mount()
 expect(await screen.findByText(/Tidak ada kunjungan dijadwalkan/)).toBeTruthy()
 expect(await screen.findByText(/Status permintaan belum tersedia/)).toBeTruthy()
 expect(screen.queryByText('1 permintaan menunggu persetujuan')).toBeNull()
 const before = state.calls.filter(call => call.table === 'sales_schedules').length
 state.pendingError = false; fireEvent.click(screen.getByRole('button', { name: 'Coba lagi status permintaan' }))
 expect(await screen.findByText('1 permintaan menunggu persetujuan')).toBeTruthy()
 expect(state.calls.filter(call => call.table === 'sales_schedules')).toHaveLength(before)
})
test('both read failures remain distinct with independently targeted retries', async () => {
 state.scheduleError = true; state.pendingError = true; mount()
 await screen.findByText('Gagal memuat jadwal. Data belum dapat ditampilkan.'); await screen.findByText(/Status permintaan belum tersedia/)
 expect(screen.getAllByRole('alert')).toHaveLength(2)
 const pendingBefore = state.calls.filter(call => call.table === 'visit_requests').length
 state.scheduleError = false; fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
 expect(await screen.findByText(/Tidak ada kunjungan dijadwalkan/)).toBeTruthy()
 expect(screen.getByText(/Status permintaan belum tersedia/)).toBeTruthy()
 expect(state.calls.filter(call => call.table === 'visit_requests')).toHaveLength(pendingBefore)
})
test('pending failure on a different selected date never shows the previous date count', async () => {
 const { client } = mount(); await screen.findByText('1 permintaan menunggu persetujuan')
 state.failDate = '2027-03-15'; fireEvent.change(screen.getByLabelText('Lihat tanggal kunjungan'), { target: { value: state.failDate } })
 await screen.findByText(/Status permintaan belum tersedia/)
 expect(screen.queryByText('1 permintaan menunggu persetujuan')).toBeNull()
 expect(client.getQueryData(['own_pending_visit_requests', 'owner', calendarDateKey()])).toEqual([{ id: 'own-pending' }])
})
test('missing actor disables pending reads and changing actor does not reuse prior owner status', async () => {
 state.actor = ''; const { rerender } = mount(); await act(async () => {})
 expect(state.calls.filter(call => call.table === 'visit_requests')).toHaveLength(0)
 expect(screen.queryByText(/Memuat status permintaan/)).toBeNull()
 state.actor = 'owner'; rerender(); await screen.findByText('1 permintaan menunggu persetujuan')
 state.actor = 'different-owner'; rerender(); await waitFor(() => expect(state.calls.some(call => call.table === 'visit_requests' && call.filters.requester_id === 'different-owner')).toBe(true))
 expect(screen.queryByText('1 permintaan menunggu persetujuan')).toBeNull()
})
