import React from 'react'
import { transferableAbortController } from 'node:util'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom'
const state=vi.hoisted(()=>({version:'2026-10-01T00:00:00Z',name:'Initial item',fail:false,lineGate:null as Promise<void>|null,headerGate:null as Promise<void>|null,deliveryGate:null as Promise<void>|null,conflict:false,failHeader:false,lineVersions:[] as string[],writes:[] as any[]}))
vi.mock('../../src/lib/AuthContext',()=>({useAuth:()=>({user:{id:'u'},profile:{id:'u',role:'staff'}})}))
vi.mock('../../src/components/AthelNav',()=>({default:()=>null}))
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:async(_name:string,args:any)=>{state.writes.push(args);return {data:null,error:{code:'PT409',message:'PO changed; refresh before saving'}}},from:()=>{let id='a';const q:any={select:()=>q,eq:(_key:string,value:string)=>{id=value;return q},single:async()=>{await state.headerGate;if(state.failHeader)return {data:null,error:new Error('header unavailable')};return {data:{id,po_number:`PO-${id}`,status:'in_progress',customer_id:'c',customers:{name:'Customer'},order_date:'2026-10-01',total_value:100,updated_at:state.version,completed_at:null},error:null}}};return q}}}))
vi.mock('../../src/lib/reads/detailReads',async original=>({...await original<any>(),
 fetchCompleteRows:async(table:string)=>table==='customers'?[{id:'c',name:'Customer',pricing_tier:'luar_kota'}]:[],
 fetchCompletePOLines:async(_id:string,version:string)=>{state.lineVersions.push(version);await state.lineGate;if(state.conflict)throw {code:'PT409',message:'PO changed; refresh before continuing'};if(state.fail)throw new Error('read failed');return {po_updated_at:version,po_has_delivery_history:false,items:[{id:'l',product_name:state.name,sku:'SKU',quantity:10,unit_price:'10.00',line_total:'100.00',delivered_quantity:0,has_delivery_history:false}]}},
 fetchAuditPage:async(_id:string,page:number)=>({items:[],total:0,page,page_size:20}),
 fetchDeliveryPage:async(id:string,page:number)=>({items:[{id:`sj-${id}`,sj_number:`SJ-${id}`,sj_date:'2026-10-01',voided_at:null}],total:1,page,page_size:20}),
 fetchDeliveryForEdit:async()=>{await state.deliveryGate;return []},
}))
import POEdit from '../../src/pages/athel/POEdit'
import PODetail from '../../src/pages/athel/PODetail'
const clients:QueryClient[]=[]
const routers: ReturnType<typeof createMemoryRouter>[] = []
function mount(edit=false,retry:false|number=false,existingClient?:QueryClient){
 const client=existingClient??new QueryClient({defaultOptions:{queries:{retry,retryDelay:0}}})
 if(!existingClient)clients.push(client)
 const router=createMemoryRouter([{path:'/po/:id',element:<><Link to="/po/a">Go A</Link><Link to="/po/b">Go B</Link>{edit?<POEdit/>:<PODetail/>}</>}],{initialEntries:['/po/a']})
 routers.push(router)
 render(<QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider>)
 return client
}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done});return {promise,resolve}}
beforeEach(()=>{vi.stubGlobal('AbortController', class { constructor() { return transferableAbortController() } });state.version='2026-10-01T00:00:00Z';state.name='Initial item';state.fail=false;state.lineGate=null;state.headerGate=null;state.deliveryGate=null;state.conflict=false;state.failHeader=false;state.lineVersions=[];state.writes=[]})
afterEach(()=>{cleanup();routers.splice(0).forEach(router=>router.dispose());vi.unstubAllGlobals();clients.splice(0).forEach(client=>client.clear());localStorage.clear()})
test('a single retry waits for fresh header and lines rather than reinitializing from failed cached data',async()=>{
 const client=mount(true);await screen.findByDisplayValue('Initial item');state.fail=true;await act(()=>client.invalidateQueries({queryKey:['po_line_state']}));await screen.findByRole('alert')
 const gate=deferred();state.headerGate=gate.promise;fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}))
 state.version='2026-10-02T00:00:00Z';state.name='Fresh item';state.fail=false;await act(()=>gate.resolve())
 expect(await screen.findByDisplayValue('Fresh item')).toBeTruthy();expect((screen.getByRole('button',{name:'Simpan Perubahan'}) as HTMLButtonElement).disabled).toBe(false)
})
test('a pending authoritative refresh keeps the edit draft visible and disables save',async()=>{
 const client=mount(true);await screen.findByDisplayValue('Initial item');fireEvent.change(screen.getAllByRole('spinbutton')[0],{target:{value:'12'}})
 const gate=deferred();state.lineGate=gate.promise;act(()=>{void client.invalidateQueries({queryKey:['po_line_state']})})
 await waitFor(()=>expect((screen.getByRole('button',{name:'Simpan Perubahan'}) as HTMLButtonElement).disabled).toBe(true));expect(screen.getByDisplayValue('12')).toBeTruthy();await act(()=>gate.resolve())
})
test('navigation during a deferred correction read does not strand the next PO in preparing state',async()=>{
 mount();const edit=await screen.findByRole('button',{name:'Ubah'});await waitFor(()=>expect((edit as HTMLButtonElement).disabled).toBe(false));const gate=deferred();state.deliveryGate=gate.promise;fireEvent.click(edit)
 fireEvent.click(screen.getByRole('link',{name:'Go B'}));await screen.findByText('PO-b');await waitFor(()=>expect((screen.getByRole('button',{name:'+ Surat Jalan'}) as HTMLButtonElement).disabled).toBe(false));await act(()=>gate.resolve());expect(screen.queryByText('Edit Surat Jalan')).toBeNull()
})
test('same-component PO navigation closes the previous PO delivery dialog',async()=>{
 mount();const add=await screen.findByRole('button',{name:'+ Surat Jalan'});await waitFor(()=>expect((add as HTMLButtonElement).disabled).toBe(false));fireEvent.click(add);await screen.findByText('New Surat Jalan');fireEvent.click(screen.getByRole('link',{name:'Go B'}));await screen.findByText('PO-b');expect(screen.queryByText('New Surat Jalan')).toBeNull()
})

test('same-component edit navigation initializes the new PO even when versions match',async()=>{
 mount(true);await screen.findByDisplayValue('Initial item');state.name='Next PO item';fireEvent.click(screen.getByRole('link',{name:'Go B'}));expect(await screen.findByDisplayValue('Next PO item')).toBeTruthy()
})

test.each([false,true])('PT409 line conflict gets one attempt even when the query client enables retries (edit=%s)',async(edit)=>{
 state.conflict=true;const client=mount(edit,1);await screen.findByRole('alert')
 await waitFor(()=>expect(client.isFetching({queryKey:['po_line_state']})).toBe(0))
 expect(state.lineVersions).toHaveLength(1)
})
test.each([false,true])('retry refreshes the header before requesting any lines and uses its new version (edit=%s)',async(edit)=>{
 state.conflict=true;mount(edit);await screen.findByRole('alert');state.lineVersions=[]
 const gate=deferred();state.headerGate=gate.promise;fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}))
 await act(async()=>{});expect(state.lineVersions).toEqual([])
 state.version='2026-10-02T00:00:00Z';state.name='Refreshed item';state.conflict=false;await act(()=>gate.resolve())
 if(edit)await screen.findByDisplayValue('Refreshed item');else await screen.findByText('Refreshed item')
 expect(state.lineVersions.length).toBeGreaterThan(0);expect(state.lineVersions.every(v=>v==='2026-10-02T00:00:00Z')).toBe(true)
})
test('a rejected edit stays blocked until deliberate refresh and never auto-resubmits',async()=>{
 mount(true);await screen.findByDisplayValue('Initial item')
 fireEvent.click(screen.getByRole('button',{name:'Simpan Perubahan'}));await waitFor(()=>expect(state.writes).toHaveLength(1))
 await screen.findByText('PO berubah. Muat ulang dan periksa perubahan sebelum menyimpan kembali.')
 expect((screen.getByRole('button',{name:'Simpan Perubahan'}) as HTMLButtonElement).disabled).toBe(true)
 state.version='2026-10-02T00:00:00Z';state.name='New authoritative item'
 fireEvent.click(screen.getByRole('button',{name:'Muat ulang PO'}));await screen.findByDisplayValue('New authoritative item')
 expect(state.writes).toHaveLength(1)
 expect((screen.getByRole('button',{name:'Simpan Perubahan'}) as HTMLButtonElement).disabled).toBe(false)
})

test.each([false,true])('navigation during delayed conflict refresh cannot strand the next PO (edit=%s)',async(edit)=>{
 state.conflict=true;mount(edit);await screen.findByRole('alert')
 const gate=deferred();state.headerGate=gate.promise;fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}))
 state.name='Next PO after refresh';state.conflict=false;fireEvent.click(screen.getByRole('link',{name:'Go B'}))
 await act(()=>gate.resolve())
 if(edit)expect(await screen.findByDisplayValue('Next PO after refresh')).toBeTruthy();else expect(await screen.findByText('Next PO after refresh')).toBeTruthy()
})

test('an edit conflict from the previous PO cannot block saving the next PO',async()=>{
 mount(true);await screen.findByDisplayValue('Initial item');fireEvent.click(screen.getByRole('button',{name:'Simpan Perubahan'}))
 await screen.findByText('PO berubah. Muat ulang dan periksa perubahan sebelum menyimpan kembali.')
 state.name='Different PO item';fireEvent.click(screen.getByRole('link',{name:'Go B'}));await screen.findByDisplayValue('Different PO item')
 expect((screen.getByRole('button',{name:'Simpan Perubahan'}) as HTMLButtonElement).disabled).toBe(false)
 expect(screen.queryByText('PO berubah. Muat ulang dan periksa perubahan sebelum menyimpan kembali.')).toBeNull()
})

test.each([false,true])('a still-conflicting manual refresh has one attempt and remount never retries the pinned version (edit=%s)',async(edit)=>{
 state.conflict=true;const client=mount(edit,1);await screen.findByRole('alert');expect(state.lineVersions).toHaveLength(1)
 fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}));await waitFor(()=>expect(client.isFetching()).toBe(0))
 expect(state.lineVersions).toHaveLength(2)
 cleanup();mount(edit,1,client);await screen.findByRole('alert');await waitFor(()=>expect(client.isFetching()).toBe(0))
 expect(state.lineVersions).toHaveLength(2)
})

test.each([false,true])('a failed header refresh never automatically reissues the conflicted line version (edit=%s)',async(edit)=>{
 state.conflict=true;const client=mount(edit,1);await screen.findByRole('alert');expect(state.lineVersions).toHaveLength(1)
 state.failHeader=true;fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}));await waitFor(()=>expect(client.isFetching()).toBe(0))
 expect(state.lineVersions).toHaveLength(1)
 state.failHeader=false;state.conflict=false;state.version='2026-10-02T00:00:00Z';state.name='After header recovery'
 fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}))
 if(edit)await screen.findByDisplayValue('After header recovery');else await screen.findByText('After header recovery')
 expect(state.lineVersions.slice(1).every(v=>v==='2026-10-02T00:00:00Z')).toBe(true)
})
