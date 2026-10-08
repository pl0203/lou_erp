import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ send: vi.fn(), complete: true, completedAt: '2026-09-30T12:00:00Z' as string | null, setFilters: vi.fn(), setPage: vi.fn() }))
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../../src/components/TransactionRecovery', () => ({ default: () => null }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useParams: () => ({ id: 'po' }) }))
vi.mock('../../src/lib/orderTransactions', () => ({ useTransactionSender: () => Object.assign(state.send, { hasUnresolved: () => false }) }))
vi.mock('../../src/lib/reads/usePagedRead', () => ({ usePagedRead: (name: string) => ({ data: { items: name === 'surat_jalan' ? [{ id: 'sj', sj_number: 'SJ-1', sj_date: '2026-09-30', sj_date_returned: null, voided_at: null }] : [], total: 1 }, page: 1, isPending: false, isError: false, setFilters: state.setFilters, setPage: state.setPage }) }))
vi.mock('@tanstack/react-query', async original => ({ ...await original<any>(), useQuery: ({ queryKey }: any) => ({ data: queryKey[0] === 'po' ? { id: 'po', po_number: 'PO-1', status: state.complete ? 'complete' : 'in_progress', completed_at: state.completedAt, updated_at: 'v1', total_value: 10, order_date: '2026-09-30', customers: { name: 'Store' }, sales_attribution_state: 'unassigned' }
 : queryKey[0] === 'po_line_state' ? { items: [], po_updated_at: 'v1' } : [], isFetching: false, isError: false, refetch: vi.fn() }) }))
import PODetail from '../../src/pages/athel/PODetail'
const clients: QueryClient[] = []
beforeEach(() => { state.send.mockReset(); state.complete = true; state.completedAt = '2026-09-30T12:00:00Z'; vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-08T12:00:00Z')) })
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()) })
function mount() { const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }); clients.push(client); render(<QueryClientProvider client={client}><PODetail /></QueryClientProvider>) }
test.each([8, 14])('day %i exposes only the dedicated returned-date action, never full SJ or completed PO editing', async day => {
 vi.spyOn(Date, 'now').mockReturnValue(Date.parse(`2026-10-${String(day).padStart(2, '0')}T12:00:00Z`))
 state.send.mockResolvedValue({ id: 'sj', po_id: 'po', updated_at: 'v2' }); mount()
 expect(screen.queryByRole('button', { name: 'Ubah' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Ubah PO' })).toBeNull()
 fireEvent.click(screen.getByRole('button', { name: 'Ubah tanggal SJ kembali' }))
 expect(screen.queryByRole('textbox', { name: 'Nomor SJ' })).toBeNull()
 const date = screen.getByLabelText('Tanggal SJ kembali'); fireEvent.change(date, { target: { value: '2026-10-07' } })
 fireEvent.click(screen.getByRole('button', { name: 'Simpan tanggal kembali' }))
 await waitFor(() => expect(state.send).toHaveBeenCalledWith('edit_sj_returned_date', { sj_id: 'sj', expected_updated_at: 'v1', sj_date_returned: '2026-10-07' }))
})
test('server deadline refusal preserves entered date and does not broaden full-SJ editing', async () => {
 vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-16T12:00:00Z'))
 state.send.mockRejectedValue(new Error('Batas 14 hari sudah lewat.')); mount()
 fireEvent.click(screen.getByRole('button', { name: 'Ubah tanggal SJ kembali' }))
 fireEvent.change(screen.getByLabelText('Tanggal SJ kembali'), { target: { value: '2026-10-07' } })
 fireEvent.click(screen.getByRole('button', { name: 'Simpan tanggal kembali' }))
 await screen.findByText('Batas 14 hari sudah lewat.')
 expect((screen.getByLabelText('Tanggal SJ kembali') as HTMLInputElement).value).toBe('2026-10-07')
 expect(screen.queryByRole('button', { name: 'Ubah' })).toBeNull()
})
test('missing completion evidence fails closed for returned-date action', () => {
 state.completedAt = null; mount(); expect(screen.queryByRole('button', { name: 'Ubah tanggal SJ kembali' })).toBeNull()
})
test('Unassigned credit explicitly explains the fixed creation snapshot', () => {
 mount(); expect(screen.getByText('Unassigned')).toBeTruthy(); expect(screen.getByText(/Kredit ditetapkan saat PO dibuat/)).toBeTruthy()
})
test('stale version feedback retains returned date and offers authoritative refresh', async () => {
 state.send.mockRejectedValue(Object.assign(new Error('PO berubah. Muat ulang dan periksa perubahan sebelum menyimpan kembali.'), { code: 'PT409' })); mount()
 fireEvent.click(screen.getByRole('button', { name: 'Ubah tanggal SJ kembali' })); fireEvent.change(screen.getByLabelText('Tanggal SJ kembali'), { target: { value: '2026-10-07' } })
 fireEvent.click(screen.getByRole('button', { name: 'Simpan tanggal kembali' })); await screen.findByText(/PO berubah. Muat ulang/)
 expect((screen.getByLabelText('Tanggal SJ kembali') as HTMLInputElement).value).toBe('2026-10-07')
 expect(screen.getByRole('button', { name: 'Muat ulang PO' })).toBeTruthy()
})
