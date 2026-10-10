import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ send: vi.fn(), unresolved: false }))
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'actor' }, profile: { id: 'actor', role: 'po_admin', is_active: true }, loading: false }) }))
vi.mock('../../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../../src/components/TransactionRecovery', () => ({ default: () => null }))
vi.mock('../../src/components/poImport/PODocumentImport', () => ({ default: () => null }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useParams: () => ({ id: 'po' }), useBlocker: () => ({ state: 'unblocked' }), useBeforeUnload: () => {} }))
vi.mock('../../src/lib/orderTransactions', async original => ({ ...await original<any>(), useTransactionSender: () => Object.assign(state.send, { hasUnresolved: () => state.unresolved }) }))
const productId = '11111111-1111-4111-8111-111111111111'
vi.mock('@tanstack/react-query', async original => ({ ...await original<any>(), useQuery: ({ queryKey }: any) => ({
 data: queryKey[0] === 'customers' ? [{ id: 'c', name: 'Store', pricing_tier: 'luar_kota' }] : queryKey[0] === 'products' ? [{ id: productId, name: 'Tiles', sku: 'SKU', luar_kota: 20 }]
 : queryKey[0] === 'po' ? { id: 'po', customer_id: 'c', customers: { name: 'Store' }, status: 'confirm', po_number: 'PO', updated_at: 'v1' }
 : queryKey[0] === 'po_line_state' ? { po_updated_at: 'v1', po_has_delivery_history: false, items: [{ id: 'l', product_id: productId, product_name: 'Tiles', sku: 'SKU', quantity: 5, unit_price: 71, delivered_quantity: 0, has_delivery_history: false }] } : [],
 isFetching: false, isError: false,
}) }))
import PONew from '../../src/pages/athel/PONew'
import POEdit from '../../src/pages/athel/POEdit'
import { PromoStockWarningError } from '../../src/lib/promotionStock'
const warning = (remaining = 2, version = 1) => new PromoStockWarningError({ code: 'PROMO_STOCK_WARNING', shortages: [{ promotion_id: productId, product_id: productId, product_name: 'Tiles', sku: 'SKU', remaining_quantity: remaining, requested_quantity: 5, incremental_quantity: 5, shortfall: 5 - remaining, stock_version: version }], ack: { opaque: { stock_version: version } } })
const clients: QueryClient[] = []
beforeEach(() => { state.send.mockReset(); state.unresolved = false })
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()) })
function mount(kind: 'new' | 'edit') {
 const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }); clients.push(client)
 render(<QueryClientProvider client={client}>{kind === 'new' ? <PONew /> : <POEdit />}</QueryClientProvider>)
 if (kind === 'new') {
  fireEvent.change(screen.getByRole('combobox', { name: 'Pelanggan' }), { target: { value: 'Store' } }); fireEvent.click(screen.getByRole('option', { name: /Store/ }))
  fireEvent.change(screen.getByPlaceholderText('mis. PO-2024-001'), { target: { value: 'PO' } })
  const search = screen.getByRole('combobox', { name: 'Cari SKU atau nama barang' }); fireEvent.change(search, { target: { value: 'SKU' } }); fireEvent.keyDown(search, { key: 'Enter' })
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Qty Tiles' }), { target: { value: '5' } }); fireEvent.change(screen.getByLabelText('Harga satuan'), { target: { value: '71' } })
 }
}
test.each(['new', 'edit'] as const)('%s retains exact draft and entered prices across refreshed stock warnings and Continue', async kind => {
 state.send.mockRejectedValueOnce(warning()).mockRejectedValueOnce(warning(0, 2)).mockResolvedValueOnce({ id: 'saved' })
 mount(kind); fireEvent.click(screen.getByRole('button', { name: kind === 'new' ? 'Simpan PO' : 'Simpan Perubahan' }))
 await screen.findByRole('dialog', { name: 'Stok promosi tidak mencukupi' })
 expect(screen.getByText('Tersisa: 2')).toBeTruthy(); expect(screen.getByText('Diminta: 5')).toBeTruthy()
 const first = state.send.mock.calls[0][1]
 fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' }))
 await screen.findByText('Tersisa: 0')
 expect(state.send.mock.calls[1][1]).toEqual({ ...first, promo_stock_ack: warning().warning.ack })
 expect((screen.getByLabelText('Harga satuan') as HTMLInputElement).value).toBe('71')
 fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' }))
 await waitFor(() => expect(state.send).toHaveBeenCalledTimes(3))
 expect(state.send.mock.calls[2][1]).toEqual({ ...first, promo_stock_ack: warning(0, 2).warning.ack })
 expect(first.items[0].product_id).toBe(productId)
})
test.each(['new', 'edit'] as const)('%s Cancel keeps draft without sending acknowledgment', async kind => {
 state.send.mockRejectedValue(warning()); mount(kind)
 fireEvent.click(screen.getByRole('button', { name: kind === 'new' ? 'Simpan PO' : 'Simpan Perubahan' }))
 await screen.findByRole('dialog'); fireEvent.click(screen.getByRole('button', { name: 'Kembali ke formulir' }))
 expect(screen.queryByRole('dialog')).toBeNull(); expect(state.send).toHaveBeenCalledTimes(1)
 expect((screen.getByRole('spinbutton', { name: 'Qty Tiles' }) as HTMLInputElement).value).toBe('5')
})
test('repeated Save and Continue clicks do not queue another mutation', async () => {
 let finish!: (value: any) => void
 state.send.mockRejectedValueOnce(warning()).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
 mount('new'); const save = screen.getByRole('button', { name: 'Simpan PO' }); fireEvent.click(save); fireEvent.click(save)
 await screen.findByRole('dialog'); expect(state.send).toHaveBeenCalledTimes(1)
 const next = screen.getByRole('button', { name: 'Lanjutkan' }); fireEvent.click(next); fireEvent.click(next)
 await waitFor(() => expect(state.send).toHaveBeenCalledTimes(2)); finish({ id: 'saved' })
})
test('network ambiguity offers no Continue and preserves draft for recovery', async () => {
 state.send.mockRejectedValue(new Error('response lost')); state.unresolved = true; mount('new')
 fireEvent.click(screen.getByRole('button', { name: 'Simpan PO' })); await screen.findByText('response lost')
 expect(screen.queryByRole('dialog')).toBeNull(); expect((screen.getByLabelText('Harga satuan') as HTMLInputElement).value).toBe('71')
})
test('manual line resolves only exact unique SKU identity and reports unresolved identity', async () => {
 state.send.mockResolvedValue({ id: 'saved' }); mount('new')
 fireEvent.click(screen.getByRole('button', { name: /Tambah barang manual/ }))
 expect(screen.getByText(/Identitas katalog belum terhubung/)).toBeTruthy()
 fireEvent.change(screen.getByRole('textbox', { name: 'Nama produk barang baru' }), { target: { value: 'Manual tiles' } })
 fireEvent.change(screen.getByRole('textbox', { name: 'SKU Manual tiles' }), { target: { value: ' sku ' } })
 const prices = screen.getAllByLabelText('Harga satuan'); fireEvent.change(prices[1], { target: { value: '0' } })
 expect(screen.queryByText(/Identitas katalog belum terhubung/)).toBeNull()
 fireEvent.click(screen.getByRole('button', { name: 'Simpan PO' }))
 await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1))
 expect(state.send.mock.calls[0][1].items[1]).toMatchObject({ product_id: productId, sku: ' sku ', unit_price: 0 })
})
test('changing a selected SKU clears stale identity instead of charging the old campaign', async () => {
 state.send.mockResolvedValue({ id: 'saved' }); mount('new')
 fireEvent.change(screen.getByRole('textbox', { name: 'SKU Tiles' }), { target: { value: 'noncatalog' } })
 expect(screen.getByText(/Identitas katalog belum terhubung/)).toBeTruthy()
 fireEvent.click(screen.getByRole('button', { name: 'Simpan PO' }))
 await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1))
 expect(state.send.mock.calls[0][1].items[0].product_id).toBeNull()
})
const changed = (paused = false) => new PromoStockWarningError({ code: 'PROMO_STOCK_CHANGED', shortages: [], allocations: [{ product_id: productId, product_name: 'Tiles', sku: 'SKU', promotion_id: paused ? null : productId, stock_version: paused ? null : 2, remaining_quantity: paused ? 0 : 9, requested_quantity: 5, incremental_quantity: 5, allocation_quantity: paused ? 0 : 5 }], ack: { version: 1, allocations: [{ promotion_id: paused ? null : productId, allocation_quantity: paused ? 0 : 5 }], opaque: 'new allocation quote' } })
test.each([['new', true], ['edit', true], ['new', false], ['edit', false]] as const)('%s requires another explicit Continue when the campaign is %s, keeping draft and prices', async (kind, paused) => {
 state.send.mockRejectedValueOnce(warning()).mockRejectedValueOnce(changed(paused)).mockResolvedValueOnce({ id: 'saved' })
 mount(kind); fireEvent.click(screen.getByRole('button', { name: kind === 'new' ? 'Simpan PO' : 'Simpan Perubahan' }))
 await screen.findByRole('dialog', { name: 'Stok promosi tidak mencukupi' }); const first = state.send.mock.calls[0][1]
 fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' }))
 await screen.findByRole('dialog', { name: 'Alokasi promosi berubah' })
 expect(screen.getByText(`Unit promosi dialokasikan: ${paused ? 0 : 5}`)).toBeTruthy()
 if (paused) expect(screen.getByText(/Tidak ada promosi aktif untuk alokasi/)).toBeTruthy()
 else expect(screen.getByText('Stok promosi tersedia: 9')).toBeTruthy()
 expect(state.send).toHaveBeenCalledTimes(2)
 expect((screen.getByLabelText('Harga satuan') as HTMLInputElement).value).toBe('71')
 fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' })); await waitFor(() => expect(state.send).toHaveBeenCalledTimes(3))
 expect(state.send.mock.calls[2][1]).toEqual({ ...first, promo_stock_ack: changed(paused).warning.ack })
})
test('Cancel after a paused-campaign quote keeps the draft and never confirms zero allocation', async () => {
 state.send.mockRejectedValueOnce(changed(true)); mount('new')
 fireEvent.click(screen.getByRole('button', { name: 'Simpan PO' })); await screen.findByRole('dialog', { name: 'Alokasi promosi berubah' })
 fireEvent.click(screen.getByRole('button', { name: 'Kembali ke formulir' })); expect(screen.queryByRole('dialog')).toBeNull()
 expect(state.send).toHaveBeenCalledTimes(1); expect((screen.getByLabelText('Harga satuan') as HTMLInputElement).value).toBe('71')
})
test('repeated Continue clicks on a changed quote send its fresh ack only once', async () => {
 let finish!: (value: any) => void
 state.send.mockRejectedValueOnce(changed(true)).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
 mount('new'); fireEvent.click(screen.getByRole('button', { name: 'Simpan PO' })); await screen.findByRole('dialog', { name: 'Alokasi promosi berubah' })
 const next = screen.getByRole('button', { name: 'Lanjutkan' }); fireEvent.click(next); fireEvent.click(next)
 await waitFor(() => expect(state.send).toHaveBeenCalledTimes(2)); expect(state.send.mock.calls[1][1].promo_stock_ack).toEqual(changed(true).warning.ack)
 finish({ id: 'saved' }); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})
test('an empty refreshed allocation list still presents review before Continue', async () => {
 const notice = new PromoStockWarningError({ code: 'PROMO_STOCK_CHANGED', shortages: [], allocations: [], ack: { version: 1, allocations: [], payload_hash: 'no incremental demand' } })
 state.send.mockRejectedValueOnce(notice).mockResolvedValueOnce({ id: 'saved' }); mount('edit')
 fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' })); await screen.findByRole('dialog', { name: 'Alokasi promosi berubah' })
 expect(screen.getByText(/Tidak ada tambahan unit katalog untuk dialokasikan/)).toBeTruthy(); expect(state.send).toHaveBeenCalledTimes(1)
 fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' })); await waitFor(() => expect(state.send).toHaveBeenCalledTimes(2))
 expect(state.send.mock.calls[1][1].promo_stock_ack).toEqual(notice.warning.ack); expect(state.send.mock.calls[1][1].items[0].unit_price).toBe(71)
})
