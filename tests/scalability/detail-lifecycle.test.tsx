import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
const state=vi.hoisted(()=>({version:'2026-10-01T00:00:00Z',name:'Initial item',fail:false,lineGate:null as Promise<void>|null,headerGate:null as Promise<void>|null,deliveryGate:null as Promise<void>|null}))
vi.mock('../../src/lib/AuthContext',()=>({useAuth:()=>({user:{id:'u'},profile:{id:'u',role:'staff'}})}))
vi.mock('../../src/components/AthelNav',()=>({default:()=>null}))
vi.mock('../../src/lib/supabase',()=>({supabase:{from:()=>{let id='a';const q:any={select:()=>q,eq:(_key:string,value:string)=>{id=value;return q},single:async()=>{await state.headerGate;return {data:{id,po_number:`PO-${id}`,status:'in_progress',customer_id:'c',customers:{name:'Customer'},order_date:'2026-10-01',total_value:100,updated_at:state.version,completed_at:null},error:null}}};return q}}}))
vi.mock('../../src/lib/reads/detailReads',async original=>({...await original<any>(),
 fetchCompleteRows:async(table:string)=>table==='customers'?[{id:'c',name:'Customer',pricing_tier:'luar_kota'}]:[],
 fetchCompletePOLines:async(_id:string,version:string)=>{await state.lineGate;if(state.fail)throw new Error('read failed');return {po_updated_at:version,po_has_delivery_history:false,items:[{id:'l',product_name:state.name,sku:'SKU',quantity:10,unit_price:'10.00',line_total:'100.00',delivered_quantity:0,has_delivery_history:false}]}},
 fetchAuditPage:async(_id:string,page:number)=>({items:[],total:0,page,page_size:20}),
 fetchDeliveryPage:async(id:string,page:number)=>({items:[{id:`sj-${id}`,sj_number:`SJ-${id}`,sj_date:'2026-10-01',voided_at:null}],total:1,page,page_size:20}),
 fetchDeliveryForEdit:async()=>{await state.deliveryGate;return []},
}))
import POEdit from '../../src/pages/athel/POEdit'
import PODetail from '../../src/pages/athel/PODetail'
const clients:QueryClient[]=[]
function mount(edit=false){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/po/a']}><Link to="/po/a">Go A</Link><Link to="/po/b">Go B</Link><Routes><Route path="/po/:id" element={edit?<POEdit/>:<PODetail/>}/></Routes></MemoryRouter></QueryClientProvider>);return client}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done});return {promise,resolve}}
beforeEach(()=>{state.version='2026-10-01T00:00:00Z';state.name='Initial item';state.fail=false;state.lineGate=null;state.headerGate=null;state.deliveryGate=null})
afterEach(()=>{cleanup();clients.splice(0).forEach(client=>client.clear());localStorage.clear()})
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
