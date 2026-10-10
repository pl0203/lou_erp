import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ send: vi.fn(), navigate: vi.fn(), unresolved: false, reconcile: vi.fn(), acknowledge: vi.fn() }))
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('react-router-dom', () => ({ useNavigate: () => state.navigate }))
vi.mock('../../src/lib/reads/usePagedRead', () => ({ usePagedRead: () => ({ data: { items: [{ id: 'legacy', customers: { name: 'Store' }, users: { full_name: 'Sales' }, status: 'pending', total_value: '355', created_at: '2026-10-01T00:00:00Z' }], status_counts: { pending: 1 }, page: 1, page_size: 20, total: 1 }, filters: { status: 'pending' }, setFilters: vi.fn(), setPage: vi.fn(), isPending: false, isError: false }) }))
vi.mock('@tanstack/react-query', async original => ({ ...await original<any>(), useQuery: () => ({ data: [{ id: 'line', product_name: 'Tiles', quantity: 5, unit_price: 71 }], isPending: false, isFetching: false, isError: false }) }))
vi.mock('../../src/lib/orderTransactions', async original => ({ ...await original<any>(), useTransactionSender: () => Object.assign(state.send, { hasUnresolved: () => state.unresolved, reconcile: state.reconcile, acknowledgeRecovered: state.acknowledge }) }))
import SalesOrders from '../../src/pages/athel/SalesOrders'
import { PromoStockWarningError } from '../../src/lib/promotionStock'
const id = '11111111-1111-4111-8111-111111111111'
const warning = new PromoStockWarningError({ code: 'PROMO_STOCK_WARNING', shortages: [{ promotion_id: id, product_id: id, product_name: 'Tiles', sku: 'SKU', remaining_quantity: 2, requested_quantity: 5, incremental_quantity: 5, shortfall: 3, stock_version: 1 }], ack: { stock: 1 } })
const changed = new PromoStockWarningError({ code: 'PROMO_STOCK_CHANGED', shortages: [], allocations: [{ product_id: id, product_name: 'Tiles', sku: 'SKU', promotion_id: null, remaining_quantity: 0, requested_quantity: 5, incremental_quantity: 5, allocation_quantity: 0, stock_version: null }], ack: { stock: 2 } })
let client: QueryClient
beforeEach(() => { state.send.mockReset(); state.navigate.mockReset(); state.reconcile.mockReset(); state.acknowledge.mockReset(); state.unresolved = false; vi.spyOn(window, 'confirm').mockReturnValue(true) })
afterEach(() => { cleanup(); client?.clear(); vi.restoreAllMocks() })
function mount() {
 client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }); render(<QueryClientProvider client={client}><SalesOrders /></QueryClientProvider>)
 fireEvent.click(screen.getByRole('button', { name: 'Setuju & Buat menjadi PO' }))
 fireEvent.change(screen.getByLabelText('Nomor PO *'), { target: { value: 'LEGACY-PO' } })
 const date = screen.getByLabelText('Tanggal Kedaluwarsa PO (opsional)'); fireEvent.change(date, { target: { value: '2026-10-31' } })
}
const payload = { order_id: 'legacy', po_number: 'LEGACY-PO', expected_delivery_date: '2026-10-31' }
test('legacy shortage then changed quote requires separate Continue with exact retained approval and immutable server items', async () => {
 state.send.mockRejectedValueOnce(warning).mockRejectedValueOnce(changed).mockResolvedValueOnce({ id: 'po' }); mount()
 expect(screen.getByText('Tiles x5')).toBeTruthy(); expect(screen.getAllByText('Rp 355')).toHaveLength(3)
 fireEvent.click(screen.getByRole('button', { name: 'Confirm & Create PO' }))
 await screen.findByRole('dialog', { name: 'Stok promosi tidak mencukupi' }); expect(screen.getAllByRole('dialog')).toHaveLength(1)
 expect(state.send.mock.calls[0]).toEqual(['approve_sales', payload])
 fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' })); await screen.findByRole('dialog', { name: 'Alokasi promosi berubah' })
 expect(state.send.mock.calls[1]).toEqual(['approve_sales', { ...payload, promo_stock_ack: warning.warning.ack }])
 fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' })); await waitFor(() => expect(state.navigate).toHaveBeenCalledWith('/athel/po/po'))
 expect(state.send.mock.calls[2]).toEqual(['approve_sales', { ...payload, promo_stock_ack: changed.warning.ack }])
})
test('stock cancel returns to intact approval draft without sending or editing item snapshots', async () => {
 state.send.mockRejectedValueOnce(warning); mount(); fireEvent.click(screen.getByRole('button', { name: 'Confirm & Create PO' }))
 await screen.findByRole('dialog', { name: 'Stok promosi tidak mencukupi' }); fireEvent.click(screen.getByRole('button', { name: 'Kembali ke formulir' }))
 expect(screen.getAllByRole('dialog')).toHaveLength(1); expect((screen.getByLabelText('Nomor PO *') as HTMLInputElement).value).toBe('LEGACY-PO')
 expect((screen.getByLabelText('Tanggal Kedaluwarsa PO (opsional)') as HTMLInputElement).value).toBe('2026-10-31'); expect(screen.getByText('Tiles x5')).toBeTruthy(); expect(state.send).toHaveBeenCalledTimes(1)
})
test('unknown legacy approval shows recovery, blocks duplicate sends and navigates only to committed receipt', async () => {
 state.send.mockImplementationOnce(async () => { state.unresolved = true; throw new Error('response lost') }); state.reconcile.mockResolvedValue({ state: 'committed', operation: 'approve_sales', result: { id: 'recovered' } }); mount()
 fireEvent.click(screen.getByRole('button', { name: 'Confirm & Create PO' })); await screen.findByText('response lost')
 expect(screen.queryByRole('button', { name: 'Lanjutkan' })).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Confirm & Create PO' })); expect(state.send).toHaveBeenCalledTimes(1)
 fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' })); await waitFor(() => expect(state.navigate).toHaveBeenCalledWith('/athel/po/recovered'))
 expect(state.acknowledge).toHaveBeenCalledTimes(1)
})
test('successful legacy approval sends only approval metadata and never item edits', async () => {
 state.send.mockResolvedValue({ id: 'po' }); mount(); fireEvent.click(screen.getByRole('button', { name: 'Confirm & Create PO' })); await waitFor(() => expect(state.navigate).toHaveBeenCalledWith('/athel/po/po')); expect(state.send.mock.calls[0]).toEqual(['approve_sales', payload])
})
test('repeated legacy approval and Continue clicks never create parallel attempts', async () => {
 let finish!: (value: { id: string }) => void
 state.send.mockRejectedValueOnce(warning).mockImplementationOnce(() => new Promise(resolve => { finish = resolve })); mount()
 const confirm = screen.getByRole('button', { name: 'Confirm & Create PO' }); fireEvent.click(confirm); fireEvent.click(confirm)
 await screen.findByRole('dialog', { name: 'Stok promosi tidak mencukupi' }); expect(state.send).toHaveBeenCalledTimes(1)
 const next = screen.getByRole('button', { name: 'Lanjutkan' }); fireEvent.click(next); fireEvent.click(next)
 await waitFor(() => expect(state.send).toHaveBeenCalledTimes(2)); expect(state.send.mock.calls[1]).toEqual(['approve_sales', { ...payload, promo_stock_ack: warning.warning.ack }])
 expect((screen.getByRole('button', { name: 'Kembali ke formulir' }) as HTMLButtonElement).disabled).toBe(true)
 finish({ id: 'po' }); await waitFor(() => expect(state.navigate).toHaveBeenCalledWith('/athel/po/po'))
})

test('legacy approval labels identify the fields and expiry help describes the date input', () => {
 mount()
 const number = screen.getByLabelText('Nomor PO *') as HTMLInputElement
 const expiry = screen.getByLabelText('Tanggal Kedaluwarsa PO (opsional)') as HTMLInputElement
 expect(number.type).toBe('text'); expect(expiry.type).toBe('date')
 const help = document.getElementById(expiry.getAttribute('aria-describedby') ?? '')
 expect(help?.textContent).toBe('Jika PO pelanggan memiliki tanggal kedaluwarsa. Bukan tanggal pengiriman.')
})
