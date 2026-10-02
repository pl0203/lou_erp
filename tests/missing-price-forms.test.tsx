import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ tier: 'others', send: vi.fn(), prices: null as number | null }))
vi.mock('../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u' }, profile: { id: 'u', role: 'sales_person' } }) }))
vi.mock('../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../src/components/TransactionRecovery', () => ({ default: () => null }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useParams: () => ({ id: 'po', scheduleId: 's' }), useBlocker: () => ({ state: 'unblocked' }), useBeforeUnload: () => {} }))
vi.mock('../src/lib/orderTransactions', async original => ({ ...await original<any>(), useTransactionSender: () => Object.assign(state.send, { hasUnresolved: () => false }) }))
vi.mock('@tanstack/react-query', async original => ({ ...await original<any>(), useQuery: ({ queryKey }: any) => {
 const product = { id: 'p', name: 'Unknown-price product', sku: 'SKU', unit_price: 999, luar_kota: 500, dalam_kota: state.prices, harga_pokok: 0, depo_bangunan: null }
 const customer = { id: 'c', name: 'Customer', pricing_tier: state.tier }
 const data = queryKey[0] === 'products' ? [product] : queryKey[0] === 'customers' ? [customer, { id: 'd', name: 'Different tier customer', pricing_tier: 'luar_kota' }]
 : queryKey[0] === 'schedule' ? { id: 's', customers: customer }
 : queryKey[0] === 'visit' ? { id: 'v', checked_in_at: '2026-10-01T00:00:00Z', visit_photos: [] }
 : queryKey[0] === 'active_promos' ? [{ id: 'promo', product_id: 'p', products: product, luar_kota: 100, dalam_kota: null, harga_pokok: 0 }]
 : queryKey[0] === 'po' ? { id: 'po', customer_id: 'c', status: 'confirm', updated_at: 'v1' }
 : queryKey[0] === 'po_line_state' ? { po_updated_at: 'v1', po_has_delivery_history: false, items: [{ id: 'line', product_name: 'Historical', sku: 'SKU', quantity: 2, unit_price: 123.45, delivered_quantity: 0, has_delivery_history: false }] } : []
 return { data }
} }))
import PONew from '../src/pages/athel/PONew'
import POEdit from '../src/pages/athel/POEdit'
import VisitPage from '../src/pages/girard/VisitPage'
const clients: QueryClient[] = []
beforeEach(() => { state.tier = 'others'; state.prices = null; state.send.mockReset().mockResolvedValue({ id: 'saved' }) })
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()) })
function mount(kind: 'po' | 'visit' | 'edit') {
 const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }); clients.push(client)
 render(<QueryClientProvider client={client}>{kind === 'po' ? <PONew /> : kind === 'edit' ? <POEdit /> : <VisitPage />}</QueryClientProvider>)
 if (kind === 'po') { selectCustomer('Customer'); fireEvent.change(screen.getByPlaceholderText('mis. PO-2024-001'), { target: { value: 'TEST-PO' } }) }
 if (kind === 'visit') fireEvent.click(screen.getByRole('button', { name: '+ Pesanan Baru' }))
}
function selectCustomer(name: string) {
 fireEvent.change(screen.getByRole('combobox', { name: 'Pelanggan' }), { target: { value: name } })
 fireEvent.click(screen.getByRole('option', { name }))
}
function selectProduct(kind: 'po' | 'visit', replacement = false) {
 const input = kind === 'po' ? screen.getByRole('combobox', { name: replacement ? 'Ganti barang berdasarkan SKU atau nama' : 'Cari SKU atau nama barang' }) : screen.getByPlaceholderText('Cari SKU atau nama barang...')
 fireEvent.change(input, { target: { value: 'Unknown' } })
 if (kind === 'po') fireEvent.click(screen.getByRole('option', { name: /Unknown-price product/ }))
 else fireEvent.mouseDown(screen.getByRole('button', { name: /Unknown-price product/ }))
}
for (const kind of ['po','visit'] as const) test(`${kind}: missing tier requires an explicit price; zero is valid and reselecting cannot retain an old manual price`, async () => {
 mount(kind); selectProduct(kind)
 const price = screen.getByLabelText('Harga satuan') as HTMLInputElement
 expect(price.value).toBe('')
 const save = screen.getByRole('button', { name: kind === 'po' ? 'Simpan PO' : 'Kirim Pesanan' })
 fireEvent.click(save)
 await screen.findByText(/Harga wajib diisi/); expect(state.send).not.toHaveBeenCalled()
 fireEvent.change(price, { target: { value: '40' } }); selectProduct(kind, true); expect(price.value).toBe('')
 fireEvent.change(price, { target: { value: '0' } }); fireEvent.click(save)
 await waitFor(() => expect(state.send).toHaveBeenCalled())
 expect(state.send.mock.calls[0][1].items[0].unit_price).toBe(0)
})
test('PO edit preserves historical line price despite Others and null catalog, including customer re-selection', () => {
 mount('edit'); expect((screen.getByLabelText('Harga satuan') as HTMLInputElement).value).toBe('123.45')
 selectCustomer('Different tier customer')
 expect((screen.getByLabelText('Harga satuan') as HTMLInputElement).value).toBe('123.45')
})
test('promotion selection is disabled without its explicit matching tier, even when catalog tier exists', () => {
 state.tier = 'dalam_kota'; state.prices = 100
 mount('visit')
 expect((screen.getByRole('button', { name: 'Harga belum diisi' }) as HTMLButtonElement).disabled).toBe(true)
})

test('new manual line starts with no implied free price', async () => {
 mount('po'); expect((screen.getByLabelText('Harga satuan') as HTMLInputElement).value).toBe('')
 fireEvent.change(screen.getByPlaceholderText('Nama produk'), { target: { value: 'Manual' } })
 fireEvent.click(screen.getByRole('button', { name: 'Simpan PO' }))
 await screen.findByText(/Harga wajib diisi/); expect(state.send).not.toHaveBeenCalled()
})

test('Others promotion explains group ineligibility instead of suggesting a nonexistent tier field', () => {
 mount('visit')
 expect(screen.getByText('Promosi tidak tersedia untuk kelompok pelanggan ini.')).toBeTruthy()
})
