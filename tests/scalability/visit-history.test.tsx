import React from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
const state=vi.hoisted(()=>({fail:false}))
vi.mock('react-router-dom',()=>({useNavigate:()=>()=>{},useParams:()=>({scheduleId:'s'}),useBlocker:()=>({state:'unblocked'}),useBeforeUnload:()=>{}}))
vi.mock('../../src/components/StorePOContext',()=>({default:()=>null}))
vi.mock('../../src/components/GirardNav',()=>({default:()=>null}))
vi.mock('../../src/lib/AuthContext',()=>({useAuth:()=>({profile:{id:'u',role:'sales_person'}})}))
vi.mock('../../src/lib/supabase',()=>({supabase:{
 rpc:(_name:string,args:any)=>{const items=Array.from({length:11},(_,i)=>({id:`o${i}`,status:'pending',total_value:'10.00',created_at:`2026-10-${String(i+1).padStart(2,'0')}T12:00:00Z`,rejection_note:null,customers:{name:'Customer'},users:{full_name:'Rep'}}));const q:any={abortSignal:()=>q,then:(ok:any,fail:any)=>Promise.resolve({data:{version:1,as_of:'2026-10-01T00:00:00Z',items:items.slice((args.p_page-1)*10,args.p_page*10),page:args.p_page,page_size:10,total:11,status_counts:{pending:11,approved:0,rejected:0,cancelled:0}},error:state.fail?new Error('unavailable'):null}).then(ok,fail)};return q},
 from:(table:string)=>{let start=0,end=Infinity;const rows=table==='girard_orders'?Array.from({length:11},(_,i)=>({id:`o${i}`,status:'pending',total_value:10,created_at:`2026-10-${String(i+1).padStart(2,'0')}T12:00:00Z`,girard_order_items:[{id:`l${i}`,product_name:`History item ${i}`,quantity:1,unit_price:10}]})):table==='girard_order_items'?[{id:'l',order_id:'o0',product_name:'Selected item',quantity:1,unit_price:10,is_promo:false,sku:null}]:[];const q:any={select:()=>q,eq:()=>q,order:()=>q,lte:()=>q,gte:()=>q,abortSignal:()=>q,range:(a:number,b:number)=>{start=a;end=b;return q},maybeSingle:async()=>({data:table==='sales_schedules'?{id:'s',customers:{id:'c',name:'Customer',pricing_tier:'luar_kota'}}:{id:'v',checked_in_at:'2026-10-01T12:00:00Z',visit_photos:[]},error:null}),then:(ok:any,fail:any)=>Promise.resolve({data:rows.slice(start,end+1),count:rows.length,error:null}).then(ok,fail)};return q}
} }))
import VisitPage from '../../src/pages/girard/VisitPage'
const clients:QueryClient[]=[]
function mount(){const c=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(c);render(<QueryClientProvider client={c}><VisitPage/></QueryClientProvider>)}
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());state.fail=false})
test('visit history pages summaries and fetches lines only when selected',async()=>{
 mount();await screen.findByText('Riwayat pesanan kunjungan');expect(screen.queryByText('History item 10')).toBeNull()
 const details=await screen.findAllByRole('button',{name:'Lihat barang'});expect(details).toHaveLength(10)
 fireEvent.click(details[0]);expect(await screen.findByText('Selected item')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'Berikutnya'}));expect(await screen.findByText('11–11 dari 11')).toBeTruthy()
})
test('visit order error offers retry instead of declaring empty history',async()=>{
 state.fail=true;mount();expect(await screen.findByRole('alert')).toBeTruthy();expect(screen.queryByText('Belum ada pesanan dalam kunjungan ini.')).toBeNull()
})
