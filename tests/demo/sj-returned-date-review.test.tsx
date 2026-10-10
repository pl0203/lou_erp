import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ send: vi.fn(), po: {} as any, sj: {} as any, joined: null as any, joinedError: null as any, joins: [] as string[] }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'actor' }, profile: { id: 'actor', role: 'po_admin', is_active: true } }) }))
vi.mock('../../src/components/AthelNav', () => ({ default: () => <a href="/athel/po">Procurement</a> }))
vi.mock('../../src/components/TransactionRecovery', () => ({ default: () => null }))
vi.mock('../../src/lib/orderTransactions', () => ({ useTransactionSender: () => Object.assign(state.send, { hasUnresolved: () => false }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useParams: () => ({ id: 'po' }) }))
vi.mock('../../src/lib/supabase', () => ({ supabase: {
 rpc: (_name: string, args: any) => { const q: any = { abortSignal: () => q, then: (resolve: any) => Promise.resolve({ data: { version: 1, as_of: state.po.updated_at, items: [], total: 0, page: 1, page_size: 100, po_updated_at: args.p_expected_updated_at, po_has_delivery_history: false }, error: null }).then(resolve) }; return q },
 from: (table: string) => { let projection = ''; const q: any = { select: (value: string) => { projection = value; return q }, eq: () => q, order: () => q, range: () => q, abortSignal: () => q,
  single: async () => { if (table === 'surat_jalan' && projection.includes('purchase_orders')) { state.joins.push(projection); return { data: state.joined, error: state.joinedError } } return { data: state.po, error: null } },
  then: (resolve: any) => Promise.resolve({ data: table === 'surat_jalan' ? [state.sj] : [], count: table === 'surat_jalan' ? 1 : 0, error: null }).then(resolve),
 }; return q },
} }))
import PODetail from '../../src/pages/athel/PODetail'
const clients: QueryClient[] = []
const v1 = '2026-10-08T12:00:00Z', v2 = '2026-10-08T12:01:00Z'
beforeEach(() => {
 state.send.mockReset(); state.joins = []; state.joinedError = null
 state.po = { id: 'po', po_number: 'PO-1', status: 'complete', completed_at: '2026-09-30T12:00:00Z', updated_at: v1, total_value: 10, order_date: '2026-09-30', customers: { name: 'Store' } }
 state.sj = { id: 'sj', purchase_order_id: 'po', sj_number: 'SJ-1', sj_date: '2026-09-30', sj_date_received: null, sj_date_returned: '2026-10-01', voided_at: null, void_reason: null }
 state.joined = { ...state.sj, sj_date_returned: '2026-10-09', purchase_orders: { ...state.po, updated_at: v2 } }
 vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-08T12:00:00Z'))
})
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()) })
function mount() { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client); render(<QueryClientProvider client={client}><PODetail /></QueryClientProvider>); return client }
async function conflict() {
 state.send.mockRejectedValueOnce(Object.assign(new Error('PO berubah. Muat ulang dan periksa perubahan sebelum menyimpan kembali.'), { code: 'PT409' })).mockResolvedValueOnce({ id: 'sj', po_id: 'po', updated_at: v2 })
 const client = mount(); const trigger = await screen.findByRole('button', { name: 'Ubah tanggal SJ kembali' }); fireEvent.click(trigger)
 fireEvent.change(screen.getByLabelText('Tanggal SJ kembali'), { target: { value: '2026-10-07' } }); fireEvent.click(screen.getByRole('button', { name: 'Simpan tanggal kembali' })); await screen.findByText(/PO berubah. Muat ulang/)
 return client
}
test('returned-date conflict review shows coherent current SJ date before adopting the new parent version', async () => {
 await conflict(); state.po = { ...state.po, updated_at: v2 }; state.sj = { ...state.sj, sj_date_returned: '2026-10-09' }
 fireEvent.click(screen.getByRole('button', { name: 'Muat ulang PO' })); await screen.findByText('Tanggal tersimpan saat ini: 2026-10-09')
 expect((screen.getByLabelText('Tanggal SJ kembali') as HTMLInputElement).value).toBe('2026-10-07'); expect(state.joins).toHaveLength(1)
 expect((screen.getByRole('button', { name: 'Simpan tanggal kembali' }) as HTMLButtonElement).disabled).toBe(true)
 fireEvent.click(screen.getByRole('button', { name: 'Gunakan versi PO terbaru' })); fireEvent.click(screen.getByRole('button', { name: 'Simpan tanggal kembali' }))
 await waitFor(() => expect(state.send).toHaveBeenCalledTimes(2)); expect(state.send.mock.calls[1][1]).toEqual({ sj_id: 'sj', expected_updated_at: v2, sj_date_returned: '2026-10-07' })
})
test('returned-date review preserves a PostgreSQL one-microsecond version advance', async () => {
 const rejected = '2026-10-08T12:00:00.000001Z', latest = '2026-10-08T12:00:00.000002Z'
 state.po.updated_at = rejected; state.joined.purchase_orders.updated_at = latest
 await conflict(); state.po = { ...state.po, updated_at: latest }
 fireEvent.click(screen.getByRole('button', { name: 'Muat ulang PO' })); await screen.findByText('Tanggal tersimpan saat ini: 2026-10-09')
 fireEvent.click(screen.getByRole('button', { name: 'Gunakan versi PO terbaru' })); fireEvent.click(screen.getByRole('button', { name: 'Simpan tanggal kembali' }))
 await waitFor(() => expect(state.send).toHaveBeenCalledTimes(2))
 expect(state.send.mock.calls[1][1]).toEqual({ sj_id: 'sj', expected_updated_at: latest, sj_date_returned: '2026-10-07' })
})
test.each([
 ['same instant', '2026-10-08T12:00:00.000002+00:00'],
 ['same instant with offset', '2026-10-08T13:00:00.000002+01:00'],
 ['one microsecond stale', '2026-10-08T12:00:00.000001Z'],
] as const)('returned-date %s review cannot adopt a non-newer parent version', async (_name, latest) => {
 state.po.updated_at = '2026-10-08T12:00:00.000002Z'; state.joined.purchase_orders.updated_at = latest
 await conflict(); fireEvent.click(screen.getByRole('button', { name: 'Muat ulang PO' }))
 await screen.findByText(/Data SJ terbaru belum lengkap atau masih memakai versi lama/)
 expect(screen.queryByRole('button', { name: 'Gunakan versi PO terbaru' })).toBeNull()
 expect((screen.getByLabelText('Tanggal SJ kembali') as HTMLInputElement).value).toBe('2026-10-07')
 expect((screen.getByRole('button', { name: 'Simpan tanggal kembali' }) as HTMLButtonElement).disabled).toBe(true)
 expect(state.send).toHaveBeenCalledTimes(1)
})
test.each(['missing', 'failed', 'stale', 'voided'] as const)('returned-date %s authoritative read blocks adoption and retains entered date', async failure => {
 await conflict(); state.po = { ...state.po, updated_at: v2 }
 if (failure === 'missing') state.joined = null
 if (failure === 'failed') state.joinedError = { message: 'Read failed' }
 if (failure === 'stale') state.joined = { ...state.joined, purchase_orders: { ...state.po, updated_at: v1 } }
 if (failure === 'voided') state.joined = { ...state.joined, voided_at: v2, void_reason: 'Correction voided' }
 fireEvent.click(screen.getByRole('button', { name: 'Muat ulang PO' }))
 if (failure === 'voided') await screen.findByText('Status SJ saat ini: Dibatalkan')
 else await screen.findByText(/Data SJ terbaru belum lengkap|Read failed/)
 const adopt = screen.queryByRole('button', { name: 'Gunakan versi PO terbaru' }); expect(!adopt || (adopt as HTMLButtonElement).disabled).toBe(true)
 expect((screen.getByRole('button', { name: 'Simpan tanggal kembali' }) as HTMLButtonElement).disabled).toBe(true)
 expect((screen.getByLabelText('Tanggal SJ kembali') as HTMLInputElement).value).toBe('2026-10-07'); expect(state.send).toHaveBeenCalledTimes(1)
})
async function openKeyboardDialog() {
 mount(); const trigger = await screen.findByRole('button', { name: 'Ubah tanggal SJ kembali' }); trigger.focus(); fireEvent.click(trigger)
 return { trigger, dialog: screen.getByRole('dialog'), date: screen.getByLabelText('Tanggal SJ kembali'), save: screen.getByRole('button', { name: 'Simpan tanggal kembali' }) }
}
test.each(['forward', 'reverse'] as const)('returned-date dialog contains %s Tab navigation', async direction => {
 const { dialog, date, save } = await openKeyboardDialog()
 if (direction === 'forward') { save.focus(); fireEvent.keyDown(save, { key: 'Tab' }); expect(document.activeElement).toBe(date) }
 else { date.focus(); fireEvent.keyDown(date, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(save) }
 expect(dialog.contains(document.activeElement)).toBe(true)
})
test.each(['Escape', 'Batal'] as const)('returned-date %s closes safely and restores invoking SJ focus', async action => {
 const { trigger, date } = await openKeyboardDialog()
 if (action === 'Escape') fireEvent.keyDown(date, { key: 'Escape' })
 else fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
 await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(document.activeElement).toBe(trigger)
})
test('returned-date modal makes background inert and redirects background focus', async () => {
 const { trigger, dialog } = await openKeyboardDialog()
 expect(trigger.closest('[inert]')).not.toBeNull(); expect(trigger.closest('[aria-hidden="true"]')).not.toBeNull()
 trigger.focus(); expect(dialog.contains(document.activeElement)).toBe(true)
})
test('pending returned-date write locks Escape, cancellation and keyboard focus in the modal', async () => {
 let finish!: (value: any) => void; state.send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
 const { trigger, date, dialog, save } = await openKeyboardDialog(); fireEvent.click(save)
 await waitFor(() => expect((date as HTMLInputElement).disabled).toBe(true))
 fireEvent.keyDown(dialog, { key: 'Escape' }); fireEvent.click(screen.getByRole('button', { name: 'Batal' })); expect(screen.getByRole('dialog')).toBe(dialog)
 fireEvent.keyDown(dialog, { key: 'Tab' }); expect(document.activeElement).toBe(dialog); trigger.focus(); expect(document.activeElement).toBe(dialog)
 finish({ id: 'sj', po_id: 'po', updated_at: v2 }); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})
test('native modal Tab behavior is preserved for browser date-input segments', async () => {
 const prototype = HTMLDialogElement.prototype as any
 const original = prototype.showModal
 prototype.showModal = function () { this.setAttribute('open', '') }
 try {
  const { date } = await openKeyboardDialog(); date.focus()
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }); date.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
 } finally { if (original) prototype.showModal = original; else delete prototype.showModal }
})
