import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import VisitRequestInbox from '../src/components/VisitRequestInbox'
import type { VisitRequest } from '../src/lib/visitPlanning'
const state = vi.hoisted(() => ({ role: 'sales_manager', id: 'manager', requests: [] as VisitRequest[], rowsByPage: {} as Record<number, VisitRequest[]>, total: 0, error: false, unresolved: false, read: vi.fn(), send: vi.fn() }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { id: state.id, role: state.role } }) }))
vi.mock('../src/lib/visitTransactions', () => ({ useVisitPlanningSender: () => Object.assign(state.send, { hasUnresolved: () => state.unresolved }) }))
vi.mock('../src/lib/visitPlanning', () => ({ MAX_VISIT_NOTE_LENGTH: 2000, fetchVisitCustomers: async () => [{ id: 'c', name: 'Toko Mawar' }], fetchVisitPeople: async () => [{ id: 'sales', full_name: 'Dewi Sales' }], fetchVisitRequests: async (page: number) => { state.read(page); if (state.error) throw new Error('Unavailable'); return { items: state.rowsByPage[page] ?? state.requests, total: state.total } } }))
const clients: QueryClient[] = []
function request(overrides: Partial<VisitRequest> = {}): VisitRequest { return { id: 'r', requester_id: 'sales', kind: 'new', customer_id: 'c', scheduled_date: '2026-10-09', notes: 'Follow up display', source_schedule_id: null, base_version: null, status: 'pending', version: 3, reviewer_id: null, created_at: '2026-10-08', ...overrides } }
function mount() { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client); return render(<QueryClientProvider client={client}><VisitRequestInbox /></QueryClientProvider>) }
beforeEach(() => { state.role = 'sales_manager'; state.id = 'manager'; state.requests = []; state.rowsByPage = {}; state.total = 0; state.error = false; state.unresolved = false; state.read.mockReset(); state.send.mockReset().mockResolvedValue({ id: 'r', version: 4 }) })
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()) })
test('empty requests show a meaningful empty state without inactive pagination', async () => {
 mount(); expect(await screen.findByText('Belum ada permintaan kunjungan')).toBeTruthy()
 expect(screen.queryByRole('button', { name: 'Sebelumnya' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Berikutnya' })).toBeNull()
})
test('request cards show the customer, local date, requester, type, note and Indonesian status', async () => {
 state.requests = [request()]; state.total = 1; mount()
 expect(await screen.findByRole('heading', { name: 'Toko Mawar' })).toBeTruthy()
 expect(screen.getByText('9 Oktober 2026')).toBeTruthy(); expect(await screen.findByText('Pengaju: Dewi Sales')).toBeTruthy()
 expect(screen.getByText('Kunjungan baru')).toBeTruthy(); expect(screen.getByText('Menunggu persetujuan')).toBeTruthy(); expect(screen.getByText('Follow up display')).toBeTruthy()
 expect(screen.getByRole('button', { name: 'Setujui' }).className).toMatch(/bg-brand-primary/)
 expect(screen.getByRole('button', { name: 'Tolak' }).className).toMatch(/border-red/)
 expect(screen.queryByRole('button', { name: 'Berikutnya' })).toBeNull()
})
test.each([['approved', 'Disetujui'], ['rejected', 'Ditolak'], ['withdrawn', 'Ditarik']] as const)('completed %s requests are readable without decision controls', async (status, label) => {
 state.requests = [request({ status })]; state.total = 1; mount(); expect(await screen.findByText(label)).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Setujui' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Tolak' })).toBeNull()
})
test('pagination is bounded with clearly styled disabled buttons', async () => {
 state.requests = [request()]; state.total = 21; mount()
 const previous = await screen.findByRole('button', { name: 'Sebelumnya' }); expect((previous as HTMLButtonElement).disabled).toBe(true); expect(previous.className).toMatch(/disabled:opacity/)
 fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' })); await waitFor(() => expect(state.read).toHaveBeenLastCalledWith(2))
 expect((await screen.findByRole('button', { name: 'Berikutnya' }) as HTMLButtonElement).disabled).toBe(true)
 fireEvent.click(screen.getByRole('button', { name: 'Sebelumnya' })); await waitFor(() => expect(screen.getByText(/Halaman 1/)).toBeTruthy())
})
test.each(['sales_manager', 'sales_head', 'executive'])('%s keeps version-bound decisions and rejects repeat clicks', async role => {
 state.role = role; state.requests = [request()]; state.total = 1; state.send.mockReturnValue(new Promise(() => {})); mount()
 const approve = await screen.findByRole('button', { name: 'Setujui' }); fireEvent.click(approve); fireEvent.click(approve)
 expect(state.send).toHaveBeenCalledTimes(1); expect(state.send).toHaveBeenCalledWith('approve_request', { request_id: 'r', expected_version: 3 })
 expect((approve as HTMLButtonElement).disabled).toBe(true); expect((screen.getByRole('button', { name: 'Tolak' }) as HTMLButtonElement).disabled).toBe(true)
})
test('a salesperson can only withdraw their own pending request', async () => {
 state.role = 'sales_person'; state.id = 'sales'; state.requests = [request(), request({ id: 'other', requester_id: 'someone-else' })]; state.total = 2; mount()
 const withdraw = await screen.findByRole('button', { name: 'Tarik permintaan' }); expect(screen.getAllByRole('button', { name: 'Tarik permintaan' })).toHaveLength(1); expect(screen.queryByRole('button', { name: 'Setujui' })).toBeNull(); fireEvent.click(withdraw)
 await waitFor(() => expect(state.send).toHaveBeenCalledWith('withdraw_request', { request_id: 'r', expected_version: 3 }))
})
test('managers never approve their own request', async () => {
 state.id = 'sales'; state.requests = [request()]; state.total = 1; mount(); await screen.findByText('Pengaju: Dewi Sales'); expect(screen.queryByRole('button', { name: 'Setujui' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Tolak' })).toBeNull()
})
test('an unresolved transaction keeps request decisions blocked', async () => {
 state.unresolved = true; state.requests = [request()]; state.total = 1; mount(); const approve = await screen.findByRole('button', { name: 'Setujui' }); expect((approve as HTMLButtonElement).disabled).toBe(true); fireEvent.click(approve); expect(state.send).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' })).toBeTruthy()
})
test('read failure has an explicit retry button and cannot masquerade as an empty list', async () => {
 state.error = true; mount(); const alert = await screen.findByRole('alert'); expect(within(alert).getByRole('button', { name: 'Coba lagi' }).className).toMatch(/border/); expect(screen.queryByText('Belum ada permintaan kunjungan')).toBeNull()
 state.error = false; await act(async () => fireEvent.click(within(alert).getByRole('button', { name: 'Coba lagi' }))); expect(await screen.findByText('Belum ada permintaan kunjungan')).toBeTruthy()
})
test('version-conflict feedback stays visible without changing the request payload', async () => {
 state.requests = [request()]; state.total = 1; state.send.mockRejectedValue(new Error('Request changed; refresh')); mount(); fireEvent.click(await screen.findByRole('button', { name: 'Tolak' })); expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Request changed; refresh'); expect(state.send).toHaveBeenCalledWith('reject_request', { request_id: 'r', expected_version: 3 })
})

test('a current-scope refetch clamps a now-empty later page before hiding pagination', async () => {
 state.requests = [request()]; state.total = 21; mount()
 fireEvent.click(await screen.findByRole('button', { name: 'Berikutnya' }))
 await screen.findByText('Halaman 2 dari 2')
 state.total = 20; state.rowsByPage = { 1: [request({ notes: 'Remaining visible request' })], 2: [] }
 await act(async () => { await clients.at(-1)!.invalidateQueries({ queryKey: ['visit_requests'] }) })
 expect(await screen.findByText('Remaining visible request')).toBeTruthy()
 expect(state.read).toHaveBeenLastCalledWith(1)
 expect(screen.queryByRole('button', { name: 'Berikutnya' })).toBeNull()
})
