import { transferableAbortController } from 'node:util'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ send: vi.fn(), unresolved: false, unavailableOptions: new Set<string>(), owner: 0 }))
vi.mock('../../src/lib/catalogue/useCatalogueOrderOptions',()=>({useCatalogueOrderOptions:(kind:string,purpose:string)=>{const owner=state.owner;return {data:kind==='customer'?[{id:'c',name:'Store',pricing_tier:'luar_kota',is_enabled:true}]:[{id:'11111111-1111-4111-8111-111111111111',name:'Tiles',sku:'SKU',luar_kota:20,is_enabled:true}],getCurrentData:()=>owner!==state.owner||state.unavailableOptions.has(`${kind}:${purpose}`)?undefined:kind==='customer'?[{id:'c',name:'Store',pricing_tier:'luar_kota',is_enabled:true}]:[{id:'11111111-1111-4111-8111-111111111111',name:'Tiles',sku:'SKU',luar_kota:20,is_enabled:true}],isError:false,isFetching:false,refetch:vi.fn()}}}))
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'actor' }, profile: { id: 'actor', role: 'po_admin', is_active: true }, loading: false }) }))
vi.mock('../../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../../src/components/TransactionRecovery', () => ({ default: () => null }))
vi.mock('../../src/components/poImport/PODocumentImport', () => ({ default: () => null }))
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
beforeEach(() => { state.send.mockReset(); state.unresolved = false; state.unavailableOptions.clear(); state.owner = 0 })
const routers: ReturnType<typeof createMemoryRouter>[] = []
afterEach(() => { cleanup(); vi.unstubAllGlobals(); routers.splice(0).forEach(router => router.dispose()); clients.splice(0).forEach(c => c.clear()) })
function mount(kind: 'new' | 'edit') {
 const router = createMemoryRouter([{ path: kind === 'new' ? '/athel/po/new' : '/athel/po/:id/edit', element: kind === 'new' ? <PONew /> : <POEdit /> }, { path: '*', element: <p>Destination</p> }], { initialEntries: [kind === 'new' ? '/athel/po/new' : '/athel/po/po/edit'] }); routers.push(router)
 const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }); clients.push(client)
 render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
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
 expect(first).not.toHaveProperty('catalogueAdmission')
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
test('new stock demand requires deliberate catalogue selection, never manual SKU resolution', async () => {
 state.send.mockResolvedValue({ id:'saved' });mount('new')
 expect(screen.queryByRole('button',{name:/Tambah barang manual/})).toBeNull()
 expect((screen.getByRole('textbox',{name:'SKU Tiles'}) as HTMLInputElement).disabled).toBe(true)
 fireEvent.change(screen.getByLabelText('Harga satuan'),{target:{value:'0'}})
 fireEvent.click(screen.getByRole('button',{name:'Simpan PO'}));await waitFor(()=>expect(state.send).toHaveBeenCalledTimes(1))
 expect(state.send.mock.calls[0][1].items).toEqual([expect.objectContaining({product_id:productId,sku:'SKU',product_name:'Tiles',unit_price:0})])
})
test('a selected identity cannot be changed into unlinked demand for another campaign', async () => {
 state.send.mockResolvedValue({id:'saved'});mount('new')
 const sku=screen.getByRole('textbox',{name:'SKU Tiles'}) as HTMLInputElement
 expect(sku.disabled).toBe(true)
 fireEvent.change(sku,{target:{value:'noncatalog'}})
 fireEvent.change(screen.getByRole('spinbutton',{name:'Qty Tiles'}),{target:{value:'6'}})
 expect(sku.value).toBe('SKU')
 fireEvent.click(screen.getByRole('button',{name:'Simpan PO'}));await waitFor(()=>expect(state.send).toHaveBeenCalledTimes(1))
 expect(state.send.mock.calls[0][1].items[0]).toMatchObject({product_id:productId,sku:'SKU',quantity:6,unit_price:71})
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

// The real data router uses Node Request, which requires a Node-compatible signal.
beforeEach(() => { vi.stubGlobal('AbortController', class { constructor() { return transferableAbortController() } }) })


test.each(['new', 'edit'] as const)('%s rechecks current options on promotion Continue before observer rerender', async kind => {
 state.send.mockRejectedValueOnce(warning()).mockResolvedValueOnce({ id: 'saved' })
 mount(kind); fireEvent.click(screen.getByRole('button', { name: kind === 'new' ? 'Simpan PO' : 'Simpan Perubahan' }))
 await screen.findByRole('dialog', { name: 'Stok promosi tidak mencukupi' })
 state.unavailableOptions.add('product:enabled-for-order')
 fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' }))
 await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
 expect(state.send).toHaveBeenCalledTimes(1)
 expect((screen.getByLabelText('Harga satuan') as HTMLInputElement).value).toBe('71')
})

test.each(['new', 'edit'] as const)('%s never rebinds a pending promotion draft to a later catalogue owner', async kind => {
 state.send.mockRejectedValueOnce(warning()).mockResolvedValueOnce({ id: 'saved' })
 mount(kind); fireEvent.click(screen.getByRole('button', { name: kind === 'new' ? 'Simpan PO' : 'Simpan Perubahan' }))
 await screen.findByRole('dialog', { name: 'Stok promosi tidak mencukupi' })
 state.owner++
 fireEvent.change(screen.getByPlaceholderText('Catatan (opsional)...'), { target: { value: 'Later owner' } })
 fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' }))
 await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
 expect(state.send).toHaveBeenCalledTimes(1)
})


test.each(['new', 'edit'] as const)('%s immediate double Save dispatches the first admitted draft exactly once', async kind => {
 let finish!: (value: { id: string }) => void
 state.send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
 mount(kind)
 const save = screen.getByRole('button', { name: kind === 'new' ? 'Simpan PO' : 'Simpan Perubahan' })
 // Keep both events inside one React batch, before the pending observer render.
 act(() => { save.click(); save.click() })
 await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1))
 expect(state.send.mock.calls[0][1]).not.toHaveProperty('catalogueAdmission')
 await act(async () => finish({ id: 'saved' }))
 await screen.findByText('Destination')
 expect(state.send).toHaveBeenCalledTimes(1)
})
