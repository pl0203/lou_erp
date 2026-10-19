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
test('new promotion exposes media and stock, not prices; null legacy columns satisfy the contract', async () => {
 mount(); expect(screen.queryByLabelText('Luar Kota (Rp)')).toBeNull(); expect(screen.queryByLabelText('Diskon otomatis (%)')).toBeNull()
 fireEvent.change(screen.getByLabelText('Stok awal'), { target: { value: '5' } }); fireEvent.change(screen.getByLabelText('Gambar promosi'), { target: { files: [new File(['image'], 'test.png', { type: 'image/png' })] } }); fireEvent.click(screen.getByRole('button', { name: 'Simpan promosi' }))
 await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1)); expect(state.upload.mock.calls[0][0]).toMatch(new RegExp(`^promotions/${actor}/`)); expect(state.rpc.mock.calls[0][1].p_payload).toMatchObject({ harga_pokok: null, luar_kota: null, dalam_kota: null, depo_bangunan: null, opening_quantity: 5 })
})

test('priced catalogue products do not reintroduce promotion price or discount controls', () => {
 state.price = 19.99; mount(); expect(screen.queryByLabelText('Diskon otomatis (%)')).toBeNull(); expect(screen.queryByLabelText('Harga Pokok (Rp)')).toBeNull(); expect(state.rpc).not.toHaveBeenCalled()
})
