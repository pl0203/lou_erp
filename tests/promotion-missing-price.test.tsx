import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ rpc: vi.fn(), upload: vi.fn(), price: null as number | null }))
const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', product = '11111111-1111-4111-8111-111111111111'
vi.mock('../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../src/components/TransactionRecovery', () => ({ default: () => null }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, profile: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'po_admin', is_active: true }, loading: false }) }))
vi.mock('react-router-dom', () => ({ useBlocker: () => ({ state: 'unblocked' }), useBeforeUnload: () => {} }))
vi.mock('../src/lib/supabase', () => ({ supabase: { rpc: state.rpc, storage: { from: () => ({ upload: state.upload }) } } }))
vi.mock('@tanstack/react-query', async original => ({ ...await original<any>(), useQuery: ({ queryKey }: any) => ({ data: queryKey[0] === 'products' ? [{ id: '11111111-1111-4111-8111-111111111111', name: 'Blank product', sku: 'BLANK', harga_pokok: state.price, luar_kota: state.price, dalam_kota: state.price, depo_bangunan: state.price }] : [] }) }))
import Promotions from '../src/pages/athel/Promotions'
let client: QueryClient
beforeEach(() => { localStorage.clear(); state.price = null; state.rpc.mockReset().mockImplementation((_n,args) => Promise.resolve({ data: { id: args.p_payload.id, stock_version: 1 }, error: null })); state.upload.mockReset().mockResolvedValue({ error: null }) })
afterEach(() => { cleanup(); client.clear() })
function mount() { client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }); render(<QueryClientProvider client={client}><Promotions /></QueryClientProvider>); fireEvent.click(screen.getByRole('button', { name: /Tambah Promosi/ })); fireEvent.change(screen.getByLabelText('Produk'), { target: { value: product } }) }
test('blank catalog promotion keeps nullable tiers distinct and preserves an explicitly entered zero', async () => {
 mount(); const prices = ['Harga Pokok','Luar Kota','Dalam Kota','Depo Bangunan'].map(t => screen.getByLabelText(`${t} (Rp)`) as HTMLInputElement)
 expect(prices.map(x => x.value)).toEqual(['','','','']); fireEvent.change(screen.getByLabelText('Diskon otomatis (%)'), { target: { value: '10' } }); expect(prices.map(x => x.value)).toEqual(['','','',''])
 fireEvent.change(prices[1], { target: { value: '0' } }); fireEvent.change(screen.getByLabelText('Stok awal'), { target: { value: '5' } }); fireEvent.change(screen.getByLabelText('Gambar promosi'), { target: { files: [new File(['image'], 'test.png', { type: 'image/png' })] } }); fireEvent.click(screen.getByRole('button', { name: 'Simpan promosi' }))
 await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1)); expect(state.upload.mock.calls[0][0]).toMatch(new RegExp(`^promotions/${actor}/`)); expect(state.rpc.mock.calls[0][1].p_payload).toMatchObject({ harga_pokok: null, luar_kota: 0, dalam_kota: null, depo_bangunan: null })
})
test('discount on an existing priced product retains whole-rupiah rounding', () => {
 state.price = 19.99; mount(); fireEvent.change(screen.getByLabelText('Diskon otomatis (%)'), { target: { value: '10' } }); expect(['Harga Pokok','Luar Kota','Dalam Kota','Depo Bangunan'].map(t => (screen.getByLabelText(`${t} (Rp)`) as HTMLInputElement).value)).toEqual(['18','18','18','18']); expect(state.rpc).not.toHaveBeenCalled()
})
