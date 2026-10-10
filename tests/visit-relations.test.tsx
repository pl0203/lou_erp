import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state=vi.hoisted(()=>({customer:null as any}))
vi.mock('react-router-dom',()=>({useNavigate:()=>()=>{},useParams:()=>({scheduleId:'s'}),useBlocker:()=>({state:'unblocked'}),useBeforeUnload:()=>{}}))
vi.mock('../src/components/StorePOContext',()=>({default:()=>null}))
vi.mock('../src/components/GirardNav',()=>({default:()=>null}))
vi.mock('../src/lib/AuthContext',()=>({useAuth:()=>({profile:{id:'u'}})}))
vi.mock('../src/lib/supabase',()=>({supabase:{from:()=>{const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id:'s',customers:state.customer},error:null})};return q}}}))
vi.mock('@tanstack/react-query',()=>({useMutation:()=>({}),useQueryClient:()=>({}),useQuery:({queryKey}:any)=>({data:queryKey[0]==='schedule'?{id:'s',customers:state.customer}:queryKey[0]==='active_promos'?[{id:'promo',product_id:'p',products:null}]:queryKey[0]==='visit'?{id:'v',checked_in_at:'2026-09-30T00:00:00Z',visit_photos:[]}:[],isLoading:false})}))
import VisitPage,{fetchSchedule} from '../src/pages/girard/VisitPage'
beforeEach(()=>{state.customer=null})
afterEach(cleanup)
for (const value of [null,[]])test(`rejects missing required customer (${JSON.stringify(value)}) at data boundary`,async()=>{
 state.customer=value;await expect(fetchSchedule('s')).rejects.toThrow('Pelanggan')
})
test('missing customer shows an actionable error without rendering order actions',()=>{
 render(<VisitPage/>);expect(screen.getByText(/Pelanggan.*tidak tersedia/)).toBeTruthy();expect(screen.queryByText('+ Pesanan Baru')).toBeNull()
})
test('completed visit preserves historical access without any new order action',()=>{
 state.customer={id:'c',name:'Customer',pricing_tier:'luar_kota'}
 render(<VisitPage/>);expect(screen.queryByText('+ Pesanan Baru')).toBeNull()
 expect(screen.getByText('Riwayat pesanan saya')).toBeTruthy()
})
