import { transferableAbortController } from 'node:util'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ tier: 'others', send: vi.fn(), prices: null as number | null }))
vi.mock('../src/lib/supabase', () => ({ supabase: {
 supabaseUrl:'https://catalogue.test',rest:{url:'https://catalogue.test/rest/v1',schemaName:'public'},
 rpc:(_name:string,args:any)=>{const request:any={abortSignal:()=>request,then:(resolve:any,reject:any)=>Promise.resolve().then(()=>{
   if (false) return {data:null,error:new Error('Options unavailable')}
   const source=args.p_kind==='customer'?[{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',name:'Customer',pricing_tier:state.tier},{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',name:'Different tier customer',pricing_tier:'luar_kota'}]:[{id:'11111111-1111-4111-8111-111111111111',name:'Unknown-price product',sku:'SKU',unit_price:999,luar_kota:500,dalam_kota:state.prices,harga_pokok:0}]
   const rows=source.map((row:any)=>args.p_kind==='customer'?{address:null,city:null,phone:null,email:null,customer_category:null,...row,is_enabled:true,catalog_version:'1'}:{size:null,unit_price:null,harga_pokok:null,luar_kota:null,dalam_kota:null,depo_bangunan:null,...row,is_enabled:true,catalog_version:'1'}).sort((a:any,b:any)=>a.id.localeCompare(b.id))
   return {data:{version:1,actor_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',role:'sales_person',kind:args.p_kind,purpose:args.p_purpose,status:args.p_status,search:args.p_search,page:args.p_page,page_size:args.p_page_size,total_count:String(rows.length),rows},error:null}
 }).then(resolve,reject)};return request},
} }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, profile: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'sales_person', is_active: true } }) }))
vi.mock('../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../src/components/TransactionRecovery', () => ({ default: () => null }))
vi.mock('../src/lib/orderTransactions', async original => ({ ...await original<any>(), useTransactionSender: () => Object.assign(state.send, { hasUnresolved: () => false }) }))
vi.mock('@tanstack/react-query', async original => { const actual=await original<any>(); return { ...actual, useQuery: (options: any) => { const {queryKey}=options; if(queryKey[0]==='catalogue') return actual.useQuery(options);
 const product = { id: '11111111-1111-4111-8111-111111111111', name: 'Unknown-price product', sku: 'SKU', unit_price: 999, luar_kota: 500, dalam_kota: state.prices, harga_pokok: 0, depo_bangunan: null }
 const customer = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Customer', pricing_tier: state.tier }
 const data = queryKey[0] === 'products' ? [product] : queryKey[0] === 'customers' ? [customer, { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'Different tier customer', pricing_tier: 'luar_kota' }]
 : queryKey[0] === 'schedule' ? { id: 's', customers: customer }
 : queryKey[0] === 'visit' ? { id: 'v', checked_in_at: '2026-10-01T00:00:00Z', visit_photos: [] }
 : queryKey[0] === 'active_promos' ? [{ id: 'promo', product_id: '11111111-1111-4111-8111-111111111111', products: product, luar_kota: 100, dalam_kota: null, harga_pokok: 0 }]
 : queryKey[0] === 'po' ? { id: 'po', customer_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', status: 'confirm', updated_at: 'v1' }
 : queryKey[0] === 'po_line_state' ? { po_updated_at: 'v1', po_has_delivery_history: false, items: [{ id: 'line', product_id:null,product_name: 'Historical', sku: 'SKU', quantity: 2, unit_price: 123.45, delivered_quantity: 0, has_delivery_history: false }] } : []
 return { data }
} } })
import PONew from '../src/pages/athel/PONew'
import POEdit from '../src/pages/athel/POEdit'
import VisitPage from '../src/pages/girard/VisitPage'
const clients: QueryClient[] = []
beforeEach(() => { state.tier = 'others'; state.prices = null; state.send.mockReset().mockResolvedValue({ id: 'saved' }) })
const routers: ReturnType<typeof createMemoryRouter>[] = []
afterEach(() => { cleanup(); vi.unstubAllGlobals(); routers.splice(0).forEach(router => router.dispose()); clients.splice(0).forEach(c => c.clear()) })
async function mount(kind: 'po' | 'visit' | 'edit') {
 const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }); clients.push(client)
 renderRoute(client, kind)
 if(kind!=='visit') await waitFor(()=>expect((screen.getByRole('combobox',{name:'Pelanggan'}) as HTMLInputElement).disabled).toBe(false))
 if (kind === 'po') { selectCustomer('Customer'); fireEvent.change(screen.getByPlaceholderText('mis. PO-2024-001'), { target: { value: 'TEST-PO' } }) }
 if (kind === 'visit') fireEvent.click(screen.getByRole('button', { name: '+ Pesanan Baru' }))
}
function selectCustomer(name: string) {
 fireEvent.change(screen.getByRole('combobox', { name: 'Pelanggan' }), { target: { value: name } })
 fireEvent.click(screen.getByRole('option', { name }))
}
function selectProduct(kind: 'po' | 'visit') {
 const input = kind === 'po' ? screen.getByRole('combobox', { name: 'Cari SKU atau nama barang' }) : screen.getByPlaceholderText('Cari SKU atau nama barang...')
 fireEvent.change(input, { target: { value: 'Unknown' } })
 if (kind === 'po') fireEvent.click(screen.getByRole('option', { name: /Unknown-price product/ }))
 else fireEvent.mouseDown(screen.getByRole('button', { name: /Unknown-price product/ }))
}
for (const kind of ['po'] as const) test(`${kind}: missing tier requires an explicit price; zero is valid and a newly selected line does not inherit manual price`, async () => {
 await mount(kind); selectProduct(kind)
 let price = screen.getByLabelText('Harga satuan') as HTMLInputElement
 expect(price.value).toBe('')
 const save = screen.getByRole('button', { name: kind === 'po' ? 'Simpan PO' : 'Kirim Pesanan' })
 fireEvent.click(save)
 await screen.findByText(/Harga wajib diisi/); expect(state.send).not.toHaveBeenCalled()
 fireEvent.change(price, { target: { value: '40' } })
 if (kind === 'po') {
  selectProduct(kind); expect(price.value).toBe('40') // Duplicate lookup preserves the existing draft price.
  fireEvent.click(screen.getByRole('button', { name: 'Hapus Unknown-price product' }))
 }
 selectProduct(kind)
 price = screen.getByLabelText('Harga satuan') as HTMLInputElement
 expect(price.value).toBe('')
 fireEvent.change(price, { target: { value: '0' } }); fireEvent.click(save)
 await waitFor(() => expect(state.send).toHaveBeenCalled())
 expect(state.send.mock.calls[0][1].items[0].unit_price).toBe(0)
})
test('PO edit preserves historical line price despite Others and null catalog, including customer re-selection', async () => {
 await mount('edit'); expect((screen.getByLabelText('Harga satuan') as HTMLInputElement).value).toBe('123.45')
 selectCustomer('Different tier customer')
 expect((screen.getByLabelText('Harga satuan') as HTMLInputElement).value).toBe('123.45')
})
test('Sales visit has no promotion selection or new ordering for a missing tier', async () => {
 state.tier = 'dalam_kota'; state.prices = 100
 const client = new QueryClient(); clients.push(client); renderRoute(client, 'visit')
 expect(screen.queryByRole('button', { name: '+ Pesanan Baru' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Harga belum diisi' })).toBeNull(); expect(state.send).not.toHaveBeenCalled()
})

test('new catalogue line with a missing tier starts with no implied free price', async () => {
 await mount('po'); selectProduct('po')
 expect((screen.getByLabelText('Harga satuan') as HTMLInputElement).value).toBe('')
 expect((screen.getByPlaceholderText('Nama produk') as HTMLInputElement).disabled).toBe(true)
 fireEvent.click(screen.getByRole('button', { name: 'Simpan PO' }))
 await screen.findByText(/Harga wajib diisi/); expect(state.send).not.toHaveBeenCalled()
})

test('Sales visit has no order tier or price controls for Others', async () => {
 const client = new QueryClient(); clients.push(client); renderRoute(client, 'visit')
 expect(screen.queryByLabelText('Harga satuan')).toBeNull(); expect(screen.queryByRole('button', { name: '+ Pesanan Baru' })).toBeNull(); expect(state.send).not.toHaveBeenCalled()
})
vi.mock('../src/components/StorePOContext', () => ({ default: () => null }))
vi.mock('../src/lib/reads/usePagedRead', () => ({ usePagedRead: () => ({ data: { items: [], total: 0 }, page: 1, isPending: false, setPage: vi.fn() }) }))

// Real router navigation requires Node-compatible Request signals in jsdom.
beforeEach(() => { vi.stubGlobal('AbortController', class { constructor() { return transferableAbortController() } }) })

function renderRoute(client: QueryClient, kind: 'po' | 'edit' | 'visit') { const router = createMemoryRouter([{ path: kind === 'po' ? '/athel/po/new' : kind === 'edit' ? '/athel/po/:id/edit' : '/girard/visit/:scheduleId', element: kind === 'po' ? <PONew /> : kind === 'edit' ? <POEdit /> : <VisitPage /> }, { path: '*', element: <p>Destination</p> }], { initialEntries: [kind === 'po' ? '/athel/po/new' : kind === 'edit' ? '/athel/po/po/edit' : '/girard/visit/s'] }); routers.push(router); return render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>) }
