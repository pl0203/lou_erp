import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state=vi.hoisted(()=>({role:'po_admin',id:'00000000-0000-4000-8000-000000000001',fail:false,write:vi.fn(),rpc:vi.fn(),abort:false}))
vi.mock('../../src/lib/AuthContext',()=>({useAuth:()=>({user:{id:state.id},profile:{id:state.id,role:state.role,is_active:true},loading:false})}))
vi.mock('../../src/components/AthelNav',()=>({default:()=>null}))
vi.mock('../../src/lib/supabase',()=>({supabase:{supabaseUrl:'https://catalogue.example.invalid',rest:{url:'https://catalogue.example.invalid/rest/v1',schemaName:'public'},rpc: (...args:unknown[])=>state.rpc(...args),from:(table:string)=>{
 const row=table==='customers'?{id:'22222222-2222-4222-8222-222222222222',name:'Visible customer',address:null,city:null,phone:null,email:null,pricing_tier:'luar_kota',customer_category:null}:{id:'22222222-2222-4222-8222-222222222222',name:'Visible product',sku:'SKU',size:null,unit_price:null,harga_pokok:null,luar_kota:0,dalam_kota:null,depo_bangunan:null};
 const q:any={then:(resolve:any)=>Promise.resolve({data:[row],count:1,error:null}).then(resolve)};q.select=q.order=q.range=q.eq=()=>q;q.insert=q.update=q.delete=(...args:any[])=>{state.write(table,...args);return q};return q
}}}))
import CustomerList from '../../src/pages/athel/CustomerList'
import ProductList from '../../src/pages/athel/ProductList'
import { useProcurementAccess } from '../../src/lib/procurementAccess'
let client:QueryClient
const payload=()=>({version:1,as_of:'2026-10-09T00:00:00Z',actor_id:state.id,role:state.role,customer_create:state.role==='po_admin',customer_edit:state.role==='po_admin',customer_delete:false,product_create:state.role==='po_admin',product_edit:state.role==='po_admin',product_delete:state.role==='po_admin'})
beforeEach(()=>{state.role='po_admin';state.fail=false;state.write.mockClear();state.rpc.mockImplementation((name:string,args:any={})=>{
 let data:any=payload()
 if(name==='pilot_procurement_access_v2') data={...payload(),version:2,customer_create:true,customer_edit:true,customer_delete:state.role==='co_admin',product_create:true,product_edit:true,product_delete:true,customer_set_enabled:true,product_set_enabled:true,customer_delete_mode:state.role==='co_admin'?'guarded':'none',product_delete_mode:state.role==='co_admin'?'guarded':'direct'}
 if(name==='pilot_catalog_page_v1') {const common={id:'22222222-2222-4222-8222-222222222222',catalog_version:'1',is_enabled:true}; const row=args.p_kind==='customer'?{...common,name:'Visible customer',address:null,city:null,phone:null,email:null,pricing_tier:'luar_kota',customer_category:null}:{...common,name:'Visible product',sku:'SKU',size:null,unit_price:null,harga_pokok:null,luar_kota:0,dalam_kota:null,depo_bangunan:null};data={version:1,actor_id:state.id,role:state.role,kind:args.p_kind,purpose:args.p_purpose,status:args.p_status,search:args.p_search,page:args.p_page,page_size:args.p_page_size,total_count:'1',rows:[row]}}
 const q:any={then:(resolve:any)=>Promise.resolve({data,error:state.fail?{message:'offline'}:null}).then(resolve),abortSignal:()=>q};return q});client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}})})
afterEach(()=>{cleanup();client.clear()})
function mount(Page:typeof CustomerList){return render(<QueryClientProvider client={client}><Page/></QueryClientProvider>)}
test.each([CustomerList,ProductList])('CO legacy create/edit/delete remains read-only',async Page=>{state.role='co_admin';mount(Page);await screen.findAllByText(/Visible/);await waitFor(()=>expect(state.rpc).toHaveBeenCalled());expect(screen.queryByRole('button',{name:'Ubah'})).toBeNull();expect(screen.queryByRole('button',{name:'Hapus'})).toBeNull();expect(screen.queryByRole('button',{name:/Tambah/})).toBeNull();expect(state.write).not.toHaveBeenCalled()})
test('PO customer delete is hidden but create/edit remains available',async()=>{mount(CustomerList);await screen.findAllByRole('button',{name:'Ubah'});expect(screen.getByRole('button',{name:/Tambah Pelanggan/})).toBeTruthy();expect(screen.queryByRole('button',{name:'Hapus'})).toBeNull()})
test('an open product editor cannot save after capability refresh failure',async()=>{mount(ProductList);fireEvent.click((await screen.findAllByRole('button',{name:'Ubah'}))[0]);state.fail=true;await act(async()=>{await client.invalidateQueries({queryKey:['procurement-access']})});expect((screen.getByRole('button',{name:'Simpan'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'Simpan'}));expect(state.write).not.toHaveBeenCalled()})
test('stale handler loses capability immediately on role/identity render',async()=>{let requireAccess:((key:'product_edit')=>void)|undefined;function Probe(){const access=useProcurementAccess();requireAccess=access.require;return <p>{String(access.ready)}</p>}const view=render(<QueryClientProvider client={client}><Probe/></QueryClientProvider>);await screen.findByText('true');const stale=requireAccess!;expect(()=>stale('product_edit')).not.toThrow();state.role='co_admin';view.rerender(<QueryClientProvider client={client}><Probe/></QueryClientProvider>);expect(()=>stale('product_edit')).toThrow();await screen.findByText('true');expect(()=>stale('product_edit')).toThrow()})
test('cancelled refresh cannot restore previously true authority from query cache',async()=>{let current:any;function Probe(){current=useProcurementAccess();return <p>{String(current.ready)}</p>}mount(Probe as any);await screen.findByText('true');state.rpc.mockImplementation(()=>{const q:any={then:()=>new Promise(()=>{}),abortSignal:()=>q};return q});void client.invalidateQueries({queryKey:['procurement-access']});await waitFor(()=>expect(current.ready).toBe(false));await act(async()=>{await client.cancelQueries({queryKey:['procurement-access']})});expect(current.ready).toBe(false);expect(()=>current.require('product_edit')).toThrow()})
test('unmounted master handlers cannot retain previously granted authority',async()=>{let retained:any;function Probe(){retained=useProcurementAccess().require;return null}const view=mount(Probe as any);await waitFor(()=>expect(()=>retained('product_edit')).not.toThrow());view.unmount();expect(()=>retained('product_edit')).toThrow()})

test('new customer explains pricing consequences without changing the default tier or category', async () => {
 mount(CustomerList)
 fireEvent.click(await screen.findByRole('button', { name: /Tambah Pelanggan/ }))
 expect(screen.getByText(/Tier memilih kolom harga katalog/)).toBeTruthy()
 expect(screen.getByText(/Luar Kota adalah pilihan awal/)).toBeTruthy()
 expect(screen.getByText(/Others atau harga tier yang belum diisi/)).toBeTruthy()
 expect(screen.getByRole('combobox', { name: 'Tier Harga' }).getAttribute('aria-describedby')).toBeTruthy()
 expect((screen.getByRole('combobox', { name: 'Tier Harga' }) as HTMLSelectElement).value).toBe('luar_kota')
 expect((screen.getByRole('combobox', { name: 'Kategori Pelanggan *' }) as HTMLSelectElement).value).toBe('')
 expect(state.write).not.toHaveBeenCalled()
})
