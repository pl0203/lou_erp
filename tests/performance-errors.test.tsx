import React from 'react'
import { expect,test,vi } from 'vitest'
import { render,screen } from '@testing-library/react'
vi.mock('../src/lib/AuthContext',()=>({useAuth:()=>({profile:{id:'u',role:'executive'}})}))
vi.mock('../src/components/GirardNav',()=>({default:()=>null}))
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>({}),useQuery:({queryKey}:any)=>queryKey[0]==='customer_performance'?{isError:true,isLoading:false}:{},useMutation:()=>({})}))
vi.mock('../src/lib/supabase',()=>({supabase:{from:(table:string)=>{
 const data=table==='customers'?[{id:'c',name:'Customer',visit_frequency_days:7}]:table==='purchase_orders'?[{id:'p',customer_id:'c',status:'in_progress'}]:[]
 const q:any={then:(resolve:any)=>Promise.resolve({data,error:table==='surat_jalan'?new Error('delivery read failed'):null}).then(resolve)}
 for(const m of ['select','eq','in','is','gte','lte','order'])q[m]=()=>q
 return q
}}}))
import {CustomerPerformanceContent,fetchCustomerPerformance} from '../src/pages/girard/CustomerPerformance'
test('delivery query failure propagates from monthly performance',async()=>{await expect(fetchCustomerPerformance('u','executive','2026-09')).rejects.toThrow('delivery read failed')})
test('failed performance read does not show zero metrics',()=>{
 render(<CustomerPerformanceContent/>);expect(screen.getByRole('alert')).toBeTruthy();expect(screen.queryByText('Rp 0.0M')).toBeNull()
})
