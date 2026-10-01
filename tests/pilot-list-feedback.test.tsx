import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(()=>({error:true, loading:false, refetch:vi.fn()}))
vi.mock('@tanstack/react-query',()=>({useQuery:()=>({data:[],isLoading:state.loading,isError:state.error,refetch:state.refetch}),useQueryClient:()=>({}),useMutation:()=>({})}))
vi.mock('../src/lib/supabase',()=>({supabase:{}}))
vi.mock('../src/lib/AuthContext',()=>({useAuth:()=>({profile:{id:'dummy'}})}))
vi.mock('../src/components/GirardNav',()=>({default:()=>null}))
vi.mock('../src/components/AthelNav',()=>({default:()=>null}))
vi.mock('../src/components/ActivePromotionsBanner',()=>({default:()=>null}))
vi.mock('react-router-dom',()=>({useNavigate:()=>()=>{}}))
import DailySchedule from '../src/pages/girard/DailySchedule'
import MyOrders from '../src/pages/girard/MyOrders'
import SalesOrders from '../src/pages/athel/SalesOrders'
afterEach(()=>{cleanup();state.error=true;state.loading=false;vi.clearAllMocks()})
for(const [name,Page] of [['schedule',DailySchedule],['own orders',MyOrders],['sales orders',SalesOrders]] as const){
 test(`${name} distinguishes failed reads from empty data and offers retry`,()=>{render(<Page/>);expect(screen.getByRole('alert')).toBeTruthy();expect(screen.queryByText(/\d+ (?:visits?|kunjungan)/)).toBeNull();expect(screen.queryByText(/Tidak ada|Tidak pending|Tidak ada kunjungan/)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}));expect(state.refetch).toHaveBeenCalledTimes(1)})
 test(`${name} shows loading without a false empty state`,()=>{state.error=false;state.loading=true;render(<Page/>);expect(screen.getAllByText(/Memuat/)[0]).toBeTruthy();expect(screen.queryByText(/\d+ (?:visits?|kunjungan)/)).toBeNull();expect(screen.queryByText(/Tidak ada/)).toBeNull()})
 test(`${name} only shows empty state after successful load`,()=>{state.error=false;render(<Page/>);expect(screen.getByText(/Tidak ada/)).toBeTruthy();expect(screen.queryByRole('alert')).toBeNull()})
}
