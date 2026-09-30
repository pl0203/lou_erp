import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
vi.mock('react-router-dom',()=>({useNavigate:()=>()=>{},useParams:()=>({id:'c'})}))
vi.mock('../src/components/GirardNav',()=>({default:()=>null}))
vi.mock('../src/lib/supabase',()=>({supabase:{}}))
vi.mock('@tanstack/react-query',()=>({useQuery:({queryKey}:any)=>queryKey[0]==='girard_customer'?{data:{id:'c',name:'Customer',visit_frequency_days:7}}:queryKey[0]==='customer_stats_detail'?{data:undefined,isError:true,isLoading:false}:{data:[]}}))
import Detail from '../src/pages/girard/GirardCustomerDetail'
afterEach(cleanup)
test('failed stats do not display fabricated zero revenue',()=>{
 render(<Detail/>);
 expect(screen.queryByText('Rp 0')).toBeNull()
 expect(screen.getAllByText('Tidak tersedia').length).toBeGreaterThan(0)
})
