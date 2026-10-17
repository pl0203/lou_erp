import { transferableAbortController } from 'node:util'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({ send: vi.fn(), products: [] as any[], customers: [] as any[], lines: [] as any[], history: false, productsFetching: false, productsError: false, unavailableOptions: new Set<string>() }))
vi.mock('../src/lib/catalogue/useCatalogueOrderOptions', () => ({ useCatalogueOrderOptions: (kind: string, purpose: string) => ({
 data: (kind === 'customer' ? state.customers : state.products).map(row => ({ ...row, is_enabled: row.is_enabled ?? true })).filter(row => purpose === 'all-for-history' || row.is_enabled),
 getCurrentData: () => state.unavailableOptions.has(`${kind}:${purpose}`) || kind === 'product' && (state.productsFetching || state.productsError) ? undefined : (kind === 'customer' ? state.customers : state.products).map(row => ({ ...row, is_enabled: row.is_enabled ?? true })).filter(row => purpose === 'all-for-history' || row.is_enabled),
 isFetching: kind === 'product' && state.productsFetching, isError: kind === 'product' && state.productsError, refetch: vi.fn(),
}) }))
vi.mock('../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../src/components/TransactionRecovery', () => ({ default: () => null }))
vi.mock('../src/lib/orderTransactions', async original => ({ ...await original<any>(), useTransactionSender: () => Object.assign(state.send, { hasUnresolved: () => false }) }))
vi.mock('@tanstack/react-query', async original => ({ ...await original<any>(), useQuery: ({ queryKey }: any) => ({
 data: queryKey[0] === 'customers' ? state.customers : queryKey[0] === 'products' ? state.products
 : queryKey[0] === 'po' ? { id: 'po', customer_id: 'c', customers: { name: 'Alpha shop' }, status: 'confirm', po_number: 'PO', updated_at: 'v1' }
 : queryKey[0] === 'po_line_state' ? { po_updated_at: 'v1', po_has_delivery_history: state.history, items: state.lines } : [],
 isFetching: queryKey[0] === 'products' && state.productsFetching,
 isError: queryKey[0] === 'products' && state.productsError,
}) }))
import PONew from '../src/pages/athel/PONew'
import POEdit from '../src/pages/athel/POEdit'
const clients: QueryClient[] = []
const product = (id: string, sku = id, name = `Product ${id}`) => ({ id, sku, name, size: '12 pcs', unit_price: 999, luar_kota: 20, dalam_kota: 30, harga_pokok: 0, depo_bangunan: null })
beforeEach(() => {
 state.send.mockReset().mockResolvedValue({ id: 'saved' }); state.productsFetching = false; state.productsError = false; state.history = false; state.unavailableOptions.clear()
 state.customers = [{ id: 'c', name: 'Alpha shop', pricing_tier: 'luar_kota' }, { id: 'd', name: 'Beta shop', pricing_tier: 'dalam_kota' }]
 state.products = [product('p', 'SKU')]
 state.lines = [{ id: 'l', product_name: 'Historical', sku: 'OLD', quantity: 2, unit_price: 123.45, delivered_quantity: 0, has_delivery_history: false }]
})
const routers: ReturnType<typeof createMemoryRouter>[] = []
afterEach(() => { cleanup(); vi.unstubAllGlobals(); routers.splice(0).forEach(router => router.dispose()); clients.splice(0).forEach(c => c.clear()) })
function mount(kind: 'new' | 'edit' = 'new') {
 const router = createMemoryRouter([{ path: kind === 'new' ? '/athel/po/new' : '/athel/po/:id/edit', element: kind === 'new' ? <PONew /> : <POEdit /> }, { path: '*', element: <p>Destination</p> }], { initialEntries: [kind === 'new' ? '/athel/po/new' : '/athel/po/po/edit'] }); routers.push(router)
 const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }); clients.push(client)
 return render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
}
function customer(name = 'Alpha') {
 fireEvent.change(screen.getByRole('combobox', { name: 'Pelanggan' }), { target: { value: name } })
 fireEvent.click(screen.getByRole('option', { name: new RegExp(name) }))
}
function search(text: string) {
 const input = screen.getByRole('combobox', { name: 'Cari SKU atau nama barang' })
 fireEvent.change(input, { target: { value: text } }); return input
}
function exact(text = 'SKU') { const input = search(text); fireEvent.keyDown(input, { key: 'Enter' }); return input }

test.each(['new', 'edit'] as const)('%s customer search finds later records and typing does not change selection', kind => {
 state.customers.push(...Array.from({ length: 20 }, (_, i) => ({ id: `later${i}`, name: `Later shop ${i}`, pricing_tier: 'others' })))
 mount(kind)
 const input = screen.getByRole('combobox', { name: 'Pelanggan' })
 fireEvent.change(input, { target: { value: 'later19' } })
 expect(screen.getByRole('option', { name: /Later shop 19/ })).toBeTruthy()
 expect(screen.queryByText('Tier harga: Others')).toBeNull()
 fireEvent.click(screen.getByRole('option', { name: /Later shop 19/ }))
 expect((input as HTMLInputElement).value).toBe('Later shop 19')
 expect(screen.getByText('Others')).toBeTruthy()
})

test('exact SKU wins beyond six suggestions and immediately adds a row while keeping shared search focused', () => {
 state.products = [...Array.from({ length: 12 }, (_, i) => product(`p${i}`, `SKU-${i}`)), product('exact', 'SKU')]
 mount(); customer(); const input = exact('  sku  ')
 expect(screen.getByDisplayValue('Product exact')).toBeTruthy()
 const qty = screen.getByRole('spinbutton', { name: 'Qty Product exact' })
 expect(document.activeElement).toBe(input)
 expect((input as HTMLInputElement).value).toBe('')
 fireEvent.change(qty, { target: { value: '3' } })
 expect(screen.queryByRole('button', { name: 'Tambah & berikutnya' })).toBeNull()
 expect(state.send).not.toHaveBeenCalled()
})

test('substring Enter requires arrows or a deliberate option click and never submits PO', () => {
 state.products = [product('a'), product('b')]; mount(); customer(); const input = search('Product')
 fireEvent.keyDown(input, { key: 'Enter' }); expect(screen.queryByDisplayValue('Product a')).toBeNull()
 fireEvent.keyDown(input, { key: 'ArrowDown' }); fireEvent.keyDown(input, { key: 'ArrowDown' }); fireEvent.keyDown(input, { key: 'Enter' })
 expect(screen.getByDisplayValue('Product b')).toBeTruthy(); expect(state.send).not.toHaveBeenCalled()
})

test('normalized SKU collisions require deliberate choice, while repeat and IME keys add nothing', () => {
 state.products = [product('a', 'Sku'), product('b', 'SKU')]; mount(); customer(); const input = search('sku')
 fireEvent.keyDown(input, { key: 'Enter' }); expect(screen.queryByDisplayValue('Product a')).toBeNull()
 fireEvent.keyDown(input, { key: 'ArrowDown', isComposing: true }); fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
 fireEvent.keyDown(input, { key: 'Enter', repeat: true }); expect(screen.queryByDisplayValue('Product a')).toBeNull()
 fireEvent.keyDown(input, { key: 'ArrowDown' }); fireEvent.keyDown(input, { key: 'Enter' })
 expect(screen.getByDisplayValue('Product a')).toBeTruthy()
})

test('duplicate SKU focuses its existing editable row without changing quantity or manual price', () => {
 mount(); customer(); exact()
 const qty = screen.getByRole('spinbutton', { name: 'Qty Product p' }); fireEvent.change(qty, { target: { value: '7' } })
 fireEvent.change(screen.getByLabelText('Harga satuan'), { target: { value: '40' } })
 exact('sku'); expect(screen.getAllByDisplayValue('Product p')).toHaveLength(1)
 expect(document.activeElement).toBe(qty); expect((qty as HTMLInputElement).value).toBe('7')
 expect((screen.getByLabelText('Harga satuan') as HTMLInputElement).value).toBe('40')
 expect(screen.getByRole('status').textContent).toMatch(/sudah ada/)
})

test('a new search query clears the previous arrow selection; Escape dismisses suggestions', () => {
 state.products = [product('a'), product('b')]; mount(); customer()
 const input = search('Product'); fireEvent.keyDown(input, { key: 'ArrowDown' }); search('Product b')
 fireEvent.keyDown(input, { key: 'Enter' }); expect(screen.queryByPlaceholderText('Nama produk')).toBeNull()
 fireEvent.keyDown(input, { key: 'Escape' }); expect(screen.queryByRole('listbox')).toBeNull()
 fireEvent.keyDown(input, { key: 'Enter' }); expect(screen.queryByPlaceholderText('Nama produk')).toBeNull()
})

test('saving a missing price focuses that row and accepts an intentional zero', async () => {
 state.products[0].luar_kota = null; mount(); customer(); const input = exact()
 expect(document.activeElement).toBe(input)
 fireEvent.change(screen.getByPlaceholderText('mis. PO-2024-001'), { target: { value: 'TEST' } })
 fireEvent.click(screen.getByRole('button', { name: 'Simpan PO' }))
 expect(screen.getByRole('alert').textContent).toMatch(/Harga wajib diisi/)
 expect(document.activeElement).toBe(screen.getByLabelText('Harga satuan'))
 expect(state.send).not.toHaveBeenCalled()
 fireEvent.change(screen.getByLabelText('Harga satuan'), { target: { value: '0' } })
 fireEvent.click(screen.getByRole('button', { name: 'Simpan PO' }))
 await waitFor(() => expect(state.send).toHaveBeenCalled())
 expect(state.send.mock.calls[0][1].items[0].unit_price).toBe(0)
 expect(screen.queryByRole('alert')).toBeNull()
})

test('catalog refresh/error disables search and prevents stale Enter selection', () => {
 mount(); customer(); const input = search('SKU')
 state.productsFetching = true
 fireEvent.change(screen.getByPlaceholderText('mis. PO-2024-001'), { target: { value: 'refresh' } })
 expect((input as HTMLInputElement).disabled).toBe(true)
 fireEvent.keyDown(input, { key: 'Enter' }); expect(screen.queryByDisplayValue('Product p')).toBeNull()
})

test('edit customer reselection preserves old prices but applies new tier to newly added items', () => {
 mount('edit'); customer('Beta'); exact()
 expect((screen.getAllByLabelText('Harga satuan')[0] as HTMLInputElement).value).toBe('123.45')
 expect((screen.getAllByLabelText('Harga satuan')[1] as HTMLInputElement).value).toBe('30')
})

test('edit duplicate focuses the first historical line and leaves historical duplicate IDs and prices unchanged', async () => {
 state.history = true; state.lines = [
  { ...state.lines[0], sku: 'SKU', delivered_quantity: 1, has_delivery_history: true },
  { ...state.lines[0], id: 'l2', sku: 'sku', product_name: 'Historical duplicate', unit_price: 66, has_delivery_history: true },
 ]; mount('edit'); exact()
 const firstQty = screen.getByRole('spinbutton', { name: 'Qty Historical' }); expect(document.activeElement).toBe(firstQty)
 expect(screen.getAllByLabelText('Harga satuan')).toHaveLength(2)
 fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' })); await waitFor(() => expect(state.send).toHaveBeenCalled())
 expect(state.send.mock.calls[0][1].items.map((line: any) => [line.id, line.unit_price])).toEqual([['l', 123.45], ['l2', 66]])
})

test('removing a preceding unsaved edit row preserves the later row DOM identity and quantity', () => {
 state.lines = []; state.products = [product('a'), product('b')]; mount('edit'); exact('a'); exact('b')
 const qty = screen.getByRole('spinbutton', { name: 'Qty Product b' }); fireEvent.change(qty, { target: { value: '9' } })
 const firstCard = screen.getByDisplayValue('Product a').closest('[data-po-line]')!
 fireEvent.click(within(firstCard as HTMLElement).getByRole('button', { name: 'Hapus Product a' }))
 expect(screen.getByRole('spinbutton', { name: 'Qty Product b' })).toBe(qty)
 expect((qty as HTMLInputElement).value).toBe('9')
})

test.each(['new', 'edit'] as const)('%s has one shared lookup and no initial blank row, then adds consecutive catalog rows by Enter and click', kind => {
 state.lines = []; state.products = [product('a'), product('b')]
 const { container } = mount(kind); if (kind === 'new') customer()
 const input = screen.getByRole('combobox', { name: 'Cari SKU atau nama barang' })
 expect(container.querySelectorAll('[data-po-line]')).toHaveLength(0)
 expect(screen.getByText('Belum ada barang. Cari SKU atau nama untuk menambahkan barang.')).toBeTruthy()
 input.focus(); exact('a')
 expect(screen.getByDisplayValue('Product a')).toBeTruthy()
 expect(document.activeElement).toBe(input)
 expect((input as HTMLInputElement).value).toBe('')
 const quantity = screen.getByRole('spinbutton', { name: 'Qty Product a' })
 search('Product b'); fireEvent.click(screen.getByRole('option', { name: /Product b/ }))
 expect(screen.getByDisplayValue('Product b')).toBeTruthy()
 expect(container.querySelectorAll('[data-po-line]')).toHaveLength(2)
 expect(screen.getAllByRole('combobox')).toHaveLength(2)
 expect(screen.queryByRole('button', { name: 'Tambah & berikutnya' })).toBeNull()
 expect(document.activeElement).toBe(input)
 expect((input as HTMLInputElement).value).toBe('')
 expect(screen.getByRole('spinbutton', { name: 'Qty Product a' })).toBe(quantity)
 expect(state.send).not.toHaveBeenCalled()
})

test.each(['new', 'edit'] as const)('%s lets the user delete the final row and returns to the empty state', kind => {
 state.lines = []; mount(kind); if (kind === 'new') customer()
 exact()
 fireEvent.click(screen.getByRole('button', { name: 'Hapus Product p' }))
 expect(screen.queryByDisplayValue('Product p')).toBeNull()
 expect(screen.getByText('Belum ada barang. Cari SKU atau nama untuk menambahkan barang.')).toBeTruthy()
 expect(screen.getAllByRole('combobox')).toHaveLength(2)
})

test('delivered edit rows keep deletion, product, SKU and price locked with editable minimum quantity', () => {
 state.history = true; state.lines[0].delivered_quantity = 2; state.lines[0].has_delivery_history = true
 mount('edit')
 expect((screen.getByRole('button', { name: 'Hapus Historical' }) as HTMLButtonElement).disabled).toBe(true)
 expect((screen.getByDisplayValue('Historical') as HTMLInputElement).disabled).toBe(true)
 expect((screen.getByDisplayValue('OLD') as HTMLInputElement).disabled).toBe(true)
 expect((screen.getByLabelText('Harga satuan') as HTMLInputElement).disabled).toBe(true)
 const qty = screen.getByRole('spinbutton', { name: 'Qty Historical' }) as HTMLInputElement
 expect(qty.disabled).toBe(false); expect(qty.min).toBe('2')
 fireEvent.click(screen.getByRole('button', { name: 'Hapus Historical' }))
 expect(screen.getByDisplayValue('Historical')).toBeTruthy()
})

test('saving rejects an edit quantity below its active delivery minimum', () => {
 state.history = true; state.lines[0].delivered_quantity = 2; state.lines[0].has_delivery_history = true
 mount('edit'); const qty = screen.getByRole('spinbutton', { name: 'Qty Historical' })
 fireEvent.change(qty, { target: { value: '1' } })
 fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }))
 expect(screen.getByRole('alert').textContent).toMatch(/terkirim aktif/)
 expect(document.activeElement).toBe(qty)
 expect(state.send).not.toHaveBeenCalled()
})

test.each(['new', 'edit'] as const)('%s admits only explicit catalogue selections and locks canonical identity', kind => {
 state.lines = []; mount(kind); if (kind === 'new') customer()
 expect(screen.queryByRole('button', { name: '+ Tambah barang manual' })).toBeNull()
 exact(); const name = screen.getByDisplayValue('Product p') as HTMLInputElement
 expect(name.disabled).toBe(true); expect((screen.getByDisplayValue('SKU') as HTMLInputElement).disabled).toBe(true)
 fireEvent.change(name, { target: { value: 'Fabricated' } })
 fireEvent.change(screen.getByRole('spinbutton', { name:'Qty Product p' }), { target:{value:'2'} })
 expect(screen.getByDisplayValue('Product p')).toBeTruthy()
 expect((screen.getByLabelText('Harga satuan') as HTMLInputElement).disabled).toBe(false)
})
test('disabled customer retains historical manual line, caps its quantity, and blocks new demand', () => {
 state.customers[0].is_enabled = false; mount('edit')
 expect(screen.getByDisplayValue('Historical')).toBeTruthy()
 const quantity = screen.getByRole('spinbutton', { name: 'Qty Historical' }) as HTMLInputElement
 expect(quantity.max).toBe('2')
 expect((screen.getByRole('combobox', { name: 'Cari SKU atau nama barang' }) as HTMLInputElement).disabled).toBe(true)
 fireEvent.change(quantity, { target: { value: '3' } }); fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }))
 expect(screen.getByRole('alert').textContent).toMatch(/nonaktif/); expect(state.send).not.toHaveBeenCalled()
})
test('disabled product retains saved identity and agreed price with its own per-line cap', async () => {
 state.products[0].is_enabled = false; state.lines[0].product_id = 'p'; mount('edit')
 expect(screen.getByDisplayValue('Historical')).toBeTruthy()
 const quantity = screen.getByRole('spinbutton', { name: 'Qty Historical' }) as HTMLInputElement
 expect(quantity.max).toBe('2'); fireEvent.change(quantity, { target: { value: '1' } })
 fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' })); await waitFor(() => expect(state.send).toHaveBeenCalled())
 expect(state.send.mock.calls[0][1].items[0]).toMatchObject({ id:'l', product_id:'p', sku:'OLD', product_name:'Historical', quantity:1, unit_price:123.45 })
})
test('enabled customer retains existing manual quantity and zero agreed-price editing', async () => {
 mount('edit'); fireEvent.change(screen.getByRole('spinbutton', { name: 'Qty Historical' }), { target: { value:'7' } })
 fireEvent.change(screen.getByLabelText('Harga satuan'), { target:{value:'0'} })
 fireEvent.click(screen.getByRole('button', { name:'Simpan Perubahan' })); await waitFor(() => expect(state.send).toHaveBeenCalled())
 expect(state.send.mock.calls[0][1].items[0]).toMatchObject({id:'l',product_id:null,sku:'OLD',product_name:'Historical',quantity:7,unit_price:0})
})
test.each(['new', 'edit'] as const)('%s empty-list Save blocks writes and returns focus to the shared lookup', kind => {
 state.lines = []; mount(kind)
 if (kind === 'new') {
  customer(); fireEvent.change(screen.getByPlaceholderText('mis. PO-2024-001'), { target: { value: 'TEST' } })
 }
 const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
 const save = screen.getByRole('button', { name: kind === 'new' ? 'Simpan PO' : 'Simpan Perubahan' })
 save.focus(); fireEvent.click(save)
 expect(alert).toHaveBeenCalledWith('PO harus memiliki minimal satu barang.')
 expect(state.send).not.toHaveBeenCalled()
 expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Cari SKU atau nama barang' }))
})

// The real data router uses Node Request, which requires a Node-compatible signal.
beforeEach(() => { vi.stubGlobal('AbortController', class { constructor() { return transferableAbortController() } }) })

// Mutate only the live option source, then dispatch immediately: no component rerender
// may be inserted between invalidation/refetch completion and the admission event.
test.each(['new', 'edit'] as const)('%s rejects a stale selected product before the observer rerenders', kind => {
 state.lines = []; mount(kind); if (kind === 'new') customer()
 const input = search('SKU')
 state.products = [{ ...state.products[0], is_enabled: false }]
 fireEvent.keyDown(input, { key: 'Enter' })
 expect(screen.queryByDisplayValue('Product p')).toBeNull()
 expect(state.send).not.toHaveBeenCalled()
})

test.each(['new', 'edit'] as const)('%s blocks Save against live invalidated options before the observer rerenders', kind => {
 state.lines = []; mount(kind); if (kind === 'new') customer()
 exact(); if (kind === 'new') fireEvent.change(screen.getByPlaceholderText('mis. PO-2024-001'), { target: { value: 'CURRENT' } })
 state.unavailableOptions.add('product:enabled-for-order')
 fireEvent.click(screen.getByRole('button', { name: kind === 'new' ? 'Simpan PO' : 'Simpan Perubahan' }))
 expect(screen.getByRole('alert').textContent).toMatch(/katalog/)
 expect(state.send).not.toHaveBeenCalled()
})

test.each(['customer:all-for-history', 'product:all-for-history'])('edit rejects new selection while only %s is invalidated', key => {
 state.lines = []; mount('edit'); const input = search('SKU')
 state.unavailableOptions.add(key)
 fireEvent.keyDown(input, { key: 'Enter' })
 expect(screen.queryByDisplayValue('Product p')).toBeNull()
 expect(state.send).not.toHaveBeenCalled()
})

test.each(['customer', 'product'])('edit enforces the fresh disabled %s per-line cap before observer rerender', kind => {
 state.lines[0].product_id = 'p'; mount('edit')
 fireEvent.change(screen.getByRole('spinbutton', { name: 'Qty Historical' }), { target: { value: '3' } })
 if (kind === 'customer') state.customers = state.customers.map(row => ({ ...row, is_enabled: row.id !== 'c' }))
 else state.products = state.products.map(row => ({ ...row, is_enabled: false }))
 fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }))
 expect(screen.getByRole('alert').textContent).toMatch(/nonaktif/)
 expect(state.send).not.toHaveBeenCalled()
})
