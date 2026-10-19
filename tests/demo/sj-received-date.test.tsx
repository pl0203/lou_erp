import { transferableAbortController } from 'node:util'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ send: vi.fn(), complete: true, poStatusOverride: null as string | null, voidedAt: null as string | null, completedAt: '2026-09-30T12:00:00Z' as string | null, setFilters: vi.fn(), setPage: vi.fn() }))
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../../src/components/TransactionRecovery', () => ({ default: () => null }))
vi.mock('../../src/lib/orderTransactions', () => ({ useTransactionSender: () => Object.assign(state.send, { hasUnresolved: () => false }) }))
vi.mock('../../src/lib/reads/usePagedRead', () => ({ usePagedRead: (name: string) => ({ data: { items: name === 'surat_jalan' ? [{ id: 'sj', sj_number: 'SJ-1', sj_date: '2026-09-30', sj_date_received: '2026-10-01', sj_date_returned: '2026-10-02', voided_at: state.voidedAt }] : [], total: 1 }, page: 1, isPending: false, isError: false, setFilters: state.setFilters, setPage: state.setPage }) }))
vi.mock('@tanstack/react-query', async original => ({ ...await original<any>(), useQuery: ({ queryKey }: any) => ({ data: queryKey[0] === 'po' ? { id: 'po', po_number: 'PO-1', status: state.poStatusOverride ?? (state.complete ? 'complete' : 'in_progress'), completed_at: state.completedAt, updated_at: 'v1', total_value: 10, order_date: '2026-09-30', customers: { name: 'Store' }, sales_attribution_state: 'unassigned' }
 : queryKey[0] === 'po_line_state' ? { items: [], po_updated_at: 'v1' } : [], isFetching: false, isError: false, refetch: vi.fn() }) }))
import PODetail from '../../src/pages/athel/PODetail'
const clients: QueryClient[] = []
beforeEach(() => { state.send.mockReset(); state.complete = true; state.poStatusOverride = null; state.voidedAt = null; state.completedAt = '2026-09-30T12:00:00Z'; vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-08T12:00:00Z')) })
const routers: ReturnType<typeof createMemoryRouter>[] = []
afterEach(() => { cleanup(); vi.unstubAllGlobals(); routers.splice(0).forEach(router => router.dispose()); clients.splice(0).forEach(c => c.clear()) })
function mount() { const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }); clients.push(client); renderRoute(client) }
test.each([7, 8, 14])('day %i exposes the received-date action without broadening the full-SJ window', async day => {
 vi.spyOn(Date, 'now').mockReturnValue(Date.parse(`2026-10-${String(day).padStart(2, '0')}T12:00:00Z`))
 state.send.mockResolvedValue({ id: 'sj', po_id: 'po', updated_at: 'v2' }); mount()
 if (day > 7) expect(screen.queryByRole('button', { name: 'Ubah' })).toBeNull()
 else expect(screen.getByRole('button', { name: 'Ubah' })).toBeTruthy()
 expect(screen.queryByRole('link', { name: 'Ubah PO' })).toBeNull()
 fireEvent.click(screen.getByRole('button', { name: 'Ubah tanggal SJ diterima toko' }))
 expect(screen.queryByRole('textbox', { name: 'Nomor SJ' })).toBeNull()
 const date = screen.getByLabelText('Tanggal SJ Diterima Toko'); fireEvent.change(date, { target: { value: '2026-10-07' } })
 fireEvent.click(screen.getByRole('button', { name: 'Simpan tanggal diterima' }))
 await waitFor(() => expect(state.send).toHaveBeenCalledWith('edit_sj_received_date', { sj_id: 'sj', expected_updated_at: 'v1', sj_date_received: '2026-10-07' }))
})
test('server deadline refusal preserves entered date and does not broaden full-SJ editing', async () => {
 vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-16T12:00:00Z'))
 state.send.mockRejectedValue(new Error('Batas 14 hari sudah lewat.')); mount()
 fireEvent.click(screen.getByRole('button', { name: 'Ubah tanggal SJ diterima toko' }))
 fireEvent.change(screen.getByLabelText('Tanggal SJ Diterima Toko'), { target: { value: '2026-10-07' } })
 fireEvent.click(screen.getByRole('button', { name: 'Simpan tanggal diterima' }))
 await screen.findByText('Batas 14 hari sudah lewat.')
 expect((screen.getByLabelText('Tanggal SJ Diterima Toko') as HTMLInputElement).value).toBe('2026-10-07')
 expect(screen.queryByRole('button', { name: 'Ubah' })).toBeNull()
})
test('missing completion evidence fails closed for received-date action', () => {
 state.completedAt = null; mount(); expect(screen.queryByRole('button', { name: 'Ubah tanggal SJ diterima toko' })).toBeNull()
})
test('Unassigned credit explicitly explains the fixed creation snapshot', () => {
 mount(); expect(screen.getByText('Unassigned')).toBeTruthy(); expect(screen.getByText(/Kredit ditetapkan saat PO dibuat/)).toBeTruthy()
})
test('stale version feedback retains received date and offers authoritative refresh', async () => {
 state.send.mockRejectedValue(Object.assign(new Error('PO berubah. Muat ulang dan periksa perubahan sebelum menyimpan kembali.'), { code: 'PT409' })); mount()
 fireEvent.click(screen.getByRole('button', { name: 'Ubah tanggal SJ diterima toko' })); fireEvent.change(screen.getByLabelText('Tanggal SJ Diterima Toko'), { target: { value: '2026-10-07' } })
 fireEvent.click(screen.getByRole('button', { name: 'Simpan tanggal diterima' })); await screen.findByText(/PO berubah. Muat ulang/)
 expect((screen.getByLabelText('Tanggal SJ Diterima Toko') as HTMLInputElement).value).toBe('2026-10-07')
 expect(screen.getByRole('button', { name: 'Muat ulang PO' })).toBeTruthy()
})

test('received-date adapter uses the shared dialog and keeps pending Escape locked', async () => {
 let finish!: (value: { id: string; po_id: string; updated_at: string }) => void
 state.send.mockReturnValueOnce(new Promise(resolve => { finish = resolve })); mount()
 const trigger = screen.getByRole('button', { name: 'Ubah tanggal SJ diterima toko' }); trigger.focus(); fireEvent.click(trigger)
 const dialog = screen.getByRole('dialog')
 expect(dialog.classList.contains('ui-dialog')).toBe(true)
 fireEvent.change(screen.getByLabelText('Tanggal SJ Diterima Toko'), { target: { value: '2026-10-07' } })
 fireEvent.click(screen.getByRole('button', { name: 'Simpan tanggal diterima' }))
 await waitFor(() => expect((screen.getByRole('button', { name: 'Batal' }) as HTMLButtonElement).disabled).toBe(true))
 fireEvent.keyDown(dialog, { key: 'Escape' })
 expect(screen.getByRole('dialog')).toBe(dialog)
 expect(state.send).toHaveBeenCalledTimes(1)
 finish({ id: 'sj', po_id: 'po', updated_at: 'v2' })
 await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
 expect(document.activeElement).not.toBe(trigger)
 expect(document.activeElement?.getAttribute('tabindex')).toBe('-1')
 expect(document.activeElement?.closest('#main-content')).toBeTruthy()
})

function renderRoute(client: QueryClient) { const router = createMemoryRouter([{ path: '/athel/po/:id', element: <PODetail /> }, { path: '*', element: <p>Destination</p> }], { initialEntries: ['/athel/po/po'] }); routers.push(router); return render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>) }

// The real data router uses Node Request, which requires a Node-compatible signal.
beforeEach(() => { vi.stubGlobal('AbortController', class { constructor() { return transferableAbortController() } }) })


test('received date can be cleared without sending a returned date, quantity, or completion change', async () => {
 state.send.mockResolvedValue({ id: 'sj', po_id: 'po', updated_at: 'v2' }); mount()
 fireEvent.click(screen.getByRole('button', { name: 'Ubah tanggal SJ diterima toko' }))
 const date = screen.getByLabelText('Tanggal SJ Diterima Toko') as HTMLInputElement
 expect(date.value).toBe('2026-10-01')
 expect(screen.queryByLabelText('Tanggal SJ kembali')).toBeNull()
 fireEvent.change(date, { target: { value: '' } }); fireEvent.click(screen.getByRole('button', { name: 'Simpan tanggal diterima' }))
 await waitFor(() => expect(state.send).toHaveBeenCalledWith('edit_sj_received_date', { sj_id: 'sj', expected_updated_at: 'v1', sj_date_received: null }))
})
test.each(['confirm', 'in_progress'])('received date is editable on eligible %s PO', async status => {
 state.poStatusOverride = status; mount()
 expect(screen.getByRole('button', { name: 'Ubah tanggal SJ diterima toko' })).toBeTruthy()
})
test('cancelled PO and voided SJ do not expose received-date correction', () => {
 state.poStatusOverride = 'cancelled'; mount()
 expect(screen.queryByRole('button', { name: 'Ubah tanggal SJ diterima toko' })).toBeNull()
 cleanup(); state.poStatusOverride = 'complete'; state.voidedAt = '2026-10-08T12:00:00Z'; mount()
 expect(screen.queryByRole('button', { name: 'Ubah tanggal SJ diterima toko' })).toBeNull()
})
