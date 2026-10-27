import React from 'react'
import { transferableAbortController } from 'node:util'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cacheProbe } from './scalability/cache-probe'

const state = vi.hoisted(() => ({ send: vi.fn(), reconcile: vi.fn(), unresolved: false, visit: true }))
vi.mock('../src/lib/supabase', () => ({ supabase: {
 supabaseUrl:'https://catalogue.test',rest:{url:'https://catalogue.test/rest/v1',schemaName:'public'},
 rpc:(_name:string,args:any)=>{const request:any={abortSignal:()=>request,then:(resolve:any,reject:any)=>Promise.resolve().then(()=>{
   if (false) return {data:null,error:new Error('Options unavailable')}
   const source=args.p_kind==='customer'?[{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',name:'Customer A',pricing_tier:'luar_kota'},{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',name:'Customer B',pricing_tier:'dalam_kota'}]:[{id:'11111111-1111-4111-8111-111111111111',name:'Barang A',sku:'SKU',luar_kota:null}]
   const rows=source.map((row:any)=>args.p_kind==='customer'?{address:null,city:null,phone:null,email:null,customer_category:null,...row,is_enabled:true,catalog_version:'1'}:{size:null,unit_price:null,harga_pokok:null,luar_kota:null,dalam_kota:null,depo_bangunan:null,...row,is_enabled:true,catalog_version:'1'}).sort((a:any,b:any)=>a.id.localeCompare(b.id))
   return {data:{version:1,actor_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',role:'sales_person',kind:args.p_kind,purpose:args.p_purpose,status:args.p_status,search:args.p_search,page:args.p_page,page_size:args.p_page_size,total_count:String(rows.length),rows},error:null}
 }).then(resolve,reject)};return request},
} }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, profile: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'sales_person', is_active:true } }) }))
vi.mock('../src/lib/orderTransactions', async original => ({ ...await original<any>(), useTransactionSender: () => Object.assign(state.send, {
  hasUnresolved: () => state.unresolved, reconcile: state.reconcile, acknowledgeRecovered: () => { state.unresolved = false },
}) }))
vi.mock('../src/components/AthelNav', () => ({ default: () => <Link to="/elsewhere">Dashboard</Link> }))
vi.mock('../src/components/GirardNav', () => ({ default: () => <Link to="/elsewhere">Jadwal</Link> }))
vi.mock('@tanstack/react-query', async original => { const actual=await original<any>(); return { ...actual, useQuery: (options: any) => { const {queryKey}=options; if(queryKey[0]==='catalogue') return actual.useQuery(options); return ({ data:
  queryKey[0] === 'customers' ? [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Customer A', pricing_tier: 'luar_kota' }, { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'Customer B', pricing_tier: 'dalam_kota' }]
    : queryKey[0] === 'schedule' ? { id: 's', customers: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Customer A', pricing_tier: 'luar_kota' } }
    : queryKey[0] === 'visit' ? (state.visit ? { id: 'v', sales_person_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', note_version: 1, notes: 'Original note', checked_in_at: '2026-09-30T10:00:00Z', visit_photos: [] } : null) : [],
}) } } })
import { hasOrderItemChanges } from '../src/lib/useUnsavedChanges'
import PONew from '../src/pages/athel/PONew'
import VisitPage from '../src/pages/girard/VisitPage'
const clients: QueryClient[] = []
const routers: ReturnType<typeof createMemoryRouter>[] = []
beforeEach(() => {
  // Node's Request requires its own AbortSignal rather than jsdom's DOM class.
  vi.stubGlobal('AbortController', class { constructor() { return transferableAbortController() } })
  state.send.mockReset().mockResolvedValue({ id: 'saved' }); state.reconcile.mockReset().mockResolvedValue({ state: 'committed', result: { id: 'recovered' } }); state.unresolved = false; state.visit = true
})
afterEach(() => { cleanup(); routers.splice(0).forEach(router => router.dispose()); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function mount(kind: 'po' | 'visit' = 'po') {
  const path = kind === 'po' ? '/athel/po/new' : '/girard/visit/s'
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }); clients.push(client)
  const router = createMemoryRouter([
    { path: '/athel/po/new', element: <PONew /> }, { path: '/girard/visit/:scheduleId', element: <VisitPage /> },
    { path: '*', element: <p>Destination page</p> },
  ], { initialEntries: ['/elsewhere', path] })
  routers.push(router)
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  if(kind==='po') await waitFor(()=>expect((screen.getByRole('combobox',{name:'Pelanggan'}) as HTMLInputElement).disabled).toBe(false))
  return router
}
function selectCustomer(name: string) {
  fireEvent.change(screen.getByRole('combobox', { name: 'Pelanggan' }), { target: { value: name } })
  fireEvent.click(screen.getByRole('option', { name }))
}
function dirtyPO() {
  selectCustomer('Customer A')
  fireEvent.change(screen.getByPlaceholderText('mis. PO-2024-001'), { target: { value: 'PO-KEEP' } })
  const lookup=screen.getByRole('combobox',{name:'Cari SKU atau nama barang'});fireEvent.change(lookup,{target:{value:'SKU'}});fireEvent.keyDown(lookup,{key:'Enter'})
  fireEvent.change(screen.getByLabelText('Harga satuan'), { target: { value: '0' } })
}

test('changing customer keeps original items until explicit discard and can be cancelled', async () => {
  await mount(); dirtyPO()
  selectCustomer('Customer B')
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect((screen.getByRole('combobox', { name: 'Pelanggan' }) as HTMLInputElement).value).toBe('Customer A')
  expect((screen.getByPlaceholderText('Nama produk') as HTMLInputElement).value).toBe('Barang A')
  fireEvent.click(screen.getByRole('button', { name: 'Tetap mengedit' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  selectCustomer('Customer B')
  fireEvent.click(screen.getByRole('button', { name: 'Buang perubahan' }))
  expect((screen.getByRole('combobox', { name: 'Pelanggan' }) as HTMLInputElement).value).toBe('Customer B')
  expect(screen.queryByPlaceholderText('Nama produk')).toBeNull()
  expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('PO-KEEP')
})

test('dirty new PO guards app links and refresh while clean forms do not prompt', async () => {
  const router = await mount()
  const clean = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(clean)
  expect(clean.defaultPrevented).toBe(false)
  dirtyPO()
  const dirty = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(dirty)
  expect(dirty.defaultPrevented).toBe(true)
  fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }))
  expect(await screen.findByRole('dialog')).toBeTruthy()
  expect(router.state.location.pathname).toBe('/athel/po/new')
  fireEvent.click(screen.getByRole('button', { name: 'Tetap mengedit' }))
  expect((screen.getByPlaceholderText('Nama produk') as HTMLInputElement).value).toBe('Barang A')
  fireEvent.click(screen.getByRole('link', { name: /Kembali/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Buang perubahan' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/athel/po'))
})

test('browser-style Back can be cancelled then accepted and Forward still works', async () => {
  const router = await mount(); dirtyPO()
  await act(() => router.navigate(-1))
  fireEvent.click(await screen.findByRole('button', { name: 'Tetap mengedit' }))
  expect(router.state.location.pathname).toBe('/athel/po/new')
  await act(() => router.navigate(-1))
  fireEvent.click(await screen.findByRole('button', { name: 'Buang perubahan' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/elsewhere'))
  await waitFor(() => expect(router.state.blockers.size).toBe(0))
  await act(() => router.navigate(1))
  await waitFor(() => expect(router.state.location.pathname).toBe('/athel/po/new'))
  expect(await screen.findByText('PO Baru')).toBeTruthy()
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('successful PO save bypasses the dirty guard and sends optional customer expiry unchanged', async () => {
  const router = await mount(); dirtyPO()
  const probe = cacheProbe(clients.at(-1)!)
  const expiry = screen.getByLabelText('Tanggal Kedaluwarsa PO (opsional)')
  expect(expiry.hasAttribute('required')).toBe(false)
  fireEvent.change(expiry, { target: { value: '2026-12-31' } })
  fireEvent.click(screen.getByRole('button', { name: 'Simpan PO' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/athel/po/saved'))
  expect(state.send).toHaveBeenCalledWith('create_po', expect.objectContaining({ expected_delivery_date: '2026-12-31' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  await waitFor(() => probe.refreshed())
  probe.stop()
})

test('unknown save outcomes remain recoverable and recovered success does not leave a blocker', async () => {
  const router = await mount(); dirtyPO()
  const probe = cacheProbe(clients.at(-1)!)
  state.send.mockImplementationOnce(async () => { state.unresolved = true; throw new Error('Hasil belum pasti') })
  fireEvent.click(screen.getByRole('button', { name: 'Simpan PO' }))
  await screen.findByText('Hasil belum pasti')
  probe.unchanged()
  fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Tetap mengedit' }))
  expect(state.unresolved).toBe(true)
  expect((screen.getByPlaceholderText('Nama produk') as HTMLInputElement).value).toBe('Barang A')
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/athel/po/recovered'))
  expect(screen.queryByRole('dialog')).toBeNull()
  await waitFor(() => probe.refreshed())
  probe.stop()
})

test('dirty visit notes can keep editing on Cancel and warn again before leaving', async () => {
  const router = await mount('visit')
  fireEvent.click(screen.getByRole('button', { name: 'Edit catatan' }))
  fireEvent.change(screen.getByLabelText('Catatan kunjungan'), { target: { value: 'Barang kunjungan' } })
  fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
  expect(screen.getByRole('dialog')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Tetap mengedit' }))
  expect((screen.getByLabelText('Catatan kunjungan') as HTMLTextAreaElement).value).toBe('Barang kunjungan')
  fireEvent.click(screen.getByRole('link', { name: 'Jadwal' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Tetap mengedit' }))
  expect(router.state.location.pathname).toBe('/girard/visit/s')
  fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
  fireEvent.click(screen.getByRole('button', { name: 'Buang perubahan' }))
  expect(screen.queryByLabelText('Catatan kunjungan')).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: 'Jadwal' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/elsewhere'))
})

test.each(['navigate', 'cancel'])('a visit note committed while a %s dialog is open clears it and guards later new drafts', async action => {
  let resolve!: (value: { id: string }) => void
  state.send.mockReturnValueOnce(new Promise(done => { resolve = done }))
  const router = await mount('visit')
  fireEvent.click(screen.getByRole('button', { name: 'Edit catatan' }))
  fireEvent.change(screen.getByLabelText('Catatan kunjungan'), { target: { value: 'Pending item' } })
  fireEvent.click(screen.getByRole('button', { name: 'Simpan catatan' }))
  await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1))
  if (action === 'navigate') { fireEvent.click(screen.getByRole('link', { name: 'Jadwal' })); await screen.findByRole('dialog') }
  else expect((screen.getByRole('button', { name: 'Batal' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => resolve({ id: 'saved' }))
  await waitFor(() => expect(screen.queryByLabelText('Catatan kunjungan')).toBeNull())
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(router.state.location.pathname).toBe('/girard/visit/s')
  fireEvent.click(screen.getByRole('button', { name: 'Edit catatan' }))
  fireEvent.change(screen.getByLabelText('Catatan kunjungan'), { target: { value: 'Another item' } })
  fireEvent.click(screen.getByRole('link', { name: 'Jadwal' }))
  expect(await screen.findByRole('dialog')).toBeTruthy()
})

test('empty form stays clean, but selecting a catalogue line remains dirty after clearing its entered zero price', async () => {
 const blank={product_id:null,product_name:'',sku:'',quantity:1,unit_price:Number.NaN}
 expect(hasOrderItemChanges([blank])).toBe(false);expect(hasOrderItemChanges([{...blank,unit_price:0}])).toBe(true);expect(hasOrderItemChanges([{...blank,unit_price:Number.NaN}])).toBe(false)
 await mount()
 const clean=new Event('beforeunload',{cancelable:true});window.dispatchEvent(clean);expect(clean.defaultPrevented).toBe(false)
 selectCustomer('Customer A')
 const lookup=screen.getByRole('combobox',{name:'Cari SKU atau nama barang'});fireEvent.change(lookup,{target:{value:'SKU'}});fireEvent.keyDown(lookup,{key:'Enter'})
 const price=screen.getByLabelText('Harga satuan') as HTMLInputElement;expect(price.value).toBe('')
 fireEvent.change(price,{target:{value:'0'}});expect(price.value).toBe('0')
 const dirty=new Event('beforeunload',{cancelable:true});window.dispatchEvent(dirty);expect(dirty.defaultPrevented).toBe(true)
 fireEvent.change(price,{target:{value:''}});expect(price.value).toBe('')
 const cleared=new Event('beforeunload',{cancelable:true});window.dispatchEvent(cleared);expect(cleared.defaultPrevented).toBe(true)
 expect(state.send).not.toHaveBeenCalled()
})

test('new PO line fields stack on phones without narrowing SKU to one desktop column', async () => {
  await mount()
  dirtyPO()
  const sku = screen.getByText('SKU', { selector: 'label' }).parentElement!
  const grid = sku.parentElement!
  expect(grid.classList.contains('grid-cols-1')).toBe(true)
  expect([...grid.classList].some(name => name.startsWith('sm:grid-cols-['))).toBe(true)
  expect(sku.classList.contains('min-w-0')).toBe(true)
  for (const input of grid.querySelectorAll('input')) expect(input.classList.contains('min-w-0')).toBe(true)
})

vi.mock('../src/lib/visitTransactions', () => ({ useVisitPlanningSender: () => Object.assign(state.send, { hasUnresolved: () => state.unresolved, reconcile: state.reconcile, acknowledgeRecovered: () => { state.unresolved = false } }) }))
vi.mock('../src/components/StorePOContext', () => ({ default: () => null }))
vi.mock('../src/lib/reads/usePagedRead', () => ({ usePagedRead: () => ({ data: { items: [], total: 0 }, page: 1, isPending: false, setPage: vi.fn() }) }))

test('dirty-navigation Escape keeps editing and restores the invoking control', async () => {
 const router = await mount(); dirtyPO()
 const trigger = screen.getByRole('link', { name: 'Dashboard' }); trigger.focus(); fireEvent.click(trigger)
 const dialog = await screen.findByRole('dialog', { name: 'Buang perubahan?' })
 expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Tetap mengedit' }))
 fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
 await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
 expect(document.activeElement).toBe(trigger)
 expect(router.state.location.pathname).toBe('/athel/po/new')
 expect((screen.getByPlaceholderText('Nama produk') as HTMLInputElement).value).toBe('Barang A')
 const dirty = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(dirty)
 expect(dirty.defaultPrevented).toBe(true)
 expect(dialog.classList.contains('ui-dialog')).toBe(true)
})
