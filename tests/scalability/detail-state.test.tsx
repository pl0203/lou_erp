import React from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
const state = vi.hoisted(() => ({ lines: [] as any[], history: [] as any[], failLines: false, stale: false, failDeliveryLines: false, audit: [] as any[], writes: [] as any[] }))
const version = '2026-10-01T00:00:00Z'
vi.mock('../../src/lib/supabase', () => ({ supabase: {
  rpc: (_name: string, args: any) => {
    if (_name === 'pilot_order_transaction') { state.writes.push(args); return Promise.resolve({data:{id:'po'},error:null}) }
    const q: any = { abortSignal: () => q, then: (ok: any, fail: any) => Promise.resolve(state.failLines ? { data: null, error: new Error('line page unavailable') } : { data: {version:1,as_of:'2026-10-01T00:00:00Z', page:args.p_page,page_size:args.p_page_size,total:state.lines.length,po_updated_at:state.stale && args.p_page > 1 ? '2026-10-02T00:00:00Z' : '2026-10-01T00:00:00Z',po_has_delivery_history:true,items:state.lines.slice((args.p_page-1)*args.p_page_size,args.p_page*args.p_page_size)},error:null }).then(ok,fail) }; return q
  },
  from: (table: string) => {
    let offset=0, end=Infinity
    const all = table==='purchase_orders' ? [{id:'po',po_number:'PO-TEST',status:'in_progress',customer_id:'c',customers:{name:'Customer'},order_date:'2026-10-01',updated_at:'2026-10-01T00:00:00Z',total_value:100,completed_at:null}]
      :table==='po_line_items'?state.lines.map(l=>({...l,unit_price:Number(l.unit_price),line_total:Number(l.line_total)}))
      :table==='surat_jalan'?state.history:table==='po_audit_log'?state.audit:table==='customers'?[{id:'c',name:'Customer',pricing_tier:'luar_kota'}]:[]
    const result=()=>({data:all.slice(offset,Math.min(end+1,offset+100)),count:all.length,error:table==='sj_line_items' && state.failDeliveryLines ? new Error('selected lines failed') : null})
    const q:any={select:()=>q,eq:()=>q,order:()=>q,abortSignal:()=>q,range:(a:number,b:number)=>{offset=a;end=b;return q},single:async()=>({data:all[0],error:null}),then:(ok:any,fail:any)=>Promise.resolve(result()).then(ok,fail)};return q
  },
} }))
vi.mock('../../src/components/AthelNav',()=>({default:()=>null}))
vi.mock('../../src/lib/AuthContext',()=>({useAuth:()=>({user:{id:'u'},profile:{id:'u',role:'staff'}})}))
vi.mock('react-router-dom',()=>({useParams:()=>({id:'po'}),useNavigate:()=>vi.fn()}))
import POEdit from '../../src/pages/athel/POEdit'
import PODetail from '../../src/pages/athel/PODetail'
const clients:QueryClient[]=[]
function mount(Page:React.ComponentType){const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});clients.push(client);return render(<QueryClientProvider client={client}><Page/></QueryClientProvider>)}
beforeEach(()=>{state.failLines=false;state.stale=false;state.failDeliveryLines=false;state.audit=[];state.writes=[];state.history=[];state.lines=[{id:'l0',product_name:'Item 0',sku:'SKU0',quantity:10,unit_price:'10.00',line_total:'100.00',delivered_quantity:4,has_delivery_history:true}]})
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());localStorage.clear()})
test('edit locks historical identity and delivered minimum even when displayed delivery history is empty',async()=>{
 mount(POEdit);const name=await screen.findByDisplayValue('Item 0');expect((name as HTMLInputElement).disabled).toBe(true)
 expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true)
 expect((screen.getAllByRole('spinbutton')[0] as HTMLInputElement).min).toBe('4')
})
test('edit loads every line beyond a capped old raw read before exposing save',async()=>{
 state.lines=Array.from({length:101},(_,i)=>({...state.lines[0],id:`l${String(i).padStart(3,'0')}`,product_name:`Item ${i}`}));mount(POEdit)
 expect(await screen.findByDisplayValue('Item 100')).toBeTruthy();expect(screen.getByRole('button',{name:'Simpan Perubahan'})).toBeTruthy()
})
test('a changed PO version between line pages blocks edits instead of exposing partial items',async()=>{
 state.lines=Array.from({length:101},(_,i)=>({...state.lines[0],id:`l${i}`}));state.stale=true;mount(POEdit)
 expect(await screen.findByRole('alert')).toBeTruthy();expect(screen.queryByRole('button',{name:'Simpan Perubahan'})).toBeNull()
})
test('detail remaining quantity uses authoritative state rather than the displayed delivery page',async()=>{
 mount(PODetail);await screen.findByText('Item 0');const row=screen.getByText('Item 0').closest('tr')!;expect(within(row).getByText('6')).toBeTruthy()
})
test('failed authoritative line state prevents opening a delivery form and offers retry',async()=>{
 state.failLines=true;mount(PODetail);expect(await screen.findByRole('alert')).toBeTruthy();expect(screen.queryByText('New Surat Jalan')).toBeNull()
 const add=screen.queryByRole('button',{name:/Tambah.*(SJ|Surat Jalan)|New SJ/i});if(add)expect((add as HTMLButtonElement).disabled).toBe(true)
})

test('delivery headers are paged independently from authoritative quantities',async()=>{
 state.history=Array.from({length:21},(_,i)=>({id:`sj${i}`,sj_number:`SJ-${i}`,sj_date:'2026-10-01',voided_at:null,void_reason:null,sj_line_items:[]}));mount(PODetail)
 await screen.findByText('SJ-0');expect(screen.queryByText('SJ-20')).toBeNull()
 const section=screen.getByRole('region',{name:'Riwayat pengiriman'});fireEvent.click(within(section).getByRole('button',{name:'Berikutnya'}));expect(await screen.findByText('SJ-20')).toBeTruthy()
 const row=screen.getByText('Item 0').closest('tr')!;expect(within(row).getByText('6')).toBeTruthy()
})
test('failed selected delivery line read does not open a correction form',async()=>{
 state.failDeliveryLines=true;state.history=[{id:'sj',sj_number:'SJ-FAIL',sj_date:'2026-10-01',voided_at:null,void_reason:null,sj_line_items:[]}];mount(PODetail)
 const edit=await screen.findByRole('button',{name:'Ubah'});await waitFor(()=>expect((edit as HTMLButtonElement).disabled).toBe(false));fireEvent.click(edit);expect(await screen.findByRole('alert')).toBeTruthy();expect(screen.queryByText('Edit Surat Jalan')).toBeNull()
})
test('audit paging shows later entries without changing line readiness',async()=>{
 state.audit=Array.from({length:21},(_,i)=>({id:`a${i}`,field_changed:`Field ${i}`,old_value:null,new_value:'new',changed_at:'2026-10-01T00:00:00Z',users:{full_name:'Actor'}}));mount(PODetail)
 await screen.findByText('Field 0');expect(screen.queryByText('Field 20')).toBeNull();const section=screen.getByText('Riwayat Perubahan').parentElement!;fireEvent.click(within(section).getByRole('button',{name:'Berikutnya'}));expect(await screen.findByText('Field 20')).toBeTruthy()
})

test('complete editing retains the final line and invalidates cached full report summaries',async()=>{
 state.lines=Array.from({length:101},(_,i)=>({...state.lines[0],id:`l${i}`,product_name:`Item ${i}`}));mount(POEdit);await screen.findByDisplayValue('Item 100')
 clients[0].setQueryData(['athel_summary','sentinel'],{value:'before'})
 fireEvent.click(screen.getByRole('button',{name:'Simpan Perubahan'}));await waitFor(()=>expect(state.writes).toHaveLength(1))
 expect(state.writes[0].p_payload.items).toHaveLength(101);expect(state.writes[0].p_payload.items[100].product_name).toBe('Item 100')
 await waitFor(()=>expect(clients[0].getQueryState(['athel_summary','sentinel'])?.isInvalidated).toBe(true))
})
test('PO cancellation invalidates cached report summaries after confirmed success',async()=>{
 state.lines[0].delivered_quantity=0;mount(PODetail);await screen.findByText('PO-TEST')
 clients[0].setQueryData(['athel_summary','sentinel'],{value:'before'})
 fireEvent.click(screen.getByRole('button',{name:'Batalkan PO'}));fireEvent.change(screen.getByLabelText('Alasan pembatalan'),{target:{value:'Customer cancelled'}});fireEvent.click(screen.getByRole('button',{name:'Ya, batalkan'}))
 await waitFor(()=>expect(state.writes).toHaveLength(1));await waitFor(()=>expect(clients[0].getQueryState(['athel_summary','sentinel'])?.isInvalidated).toBe(true))
})

test('a later line refresh failure retains the delivery draft but blocks its save',async()=>{
 mount(PODetail);const add=await screen.findByRole('button',{name:'+ Surat Jalan'});await waitFor(()=>expect((add as HTMLButtonElement).disabled).toBe(false));fireEvent.click(add)
 fireEvent.change(screen.getByPlaceholderText('e.g. SJ-2024-001'),{target:{value:'KEEP-SJ'}})
 state.failLines=true;await act(()=>clients[0].invalidateQueries({queryKey:['po_line_state']}));await screen.findByRole('alert')
 expect(screen.getByDisplayValue('KEEP-SJ')).toBeTruthy();expect((screen.getByRole('button',{name:'Create SJ'}) as HTMLButtonElement).disabled).toBe(true)
})
