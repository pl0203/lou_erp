import React from 'react'
import { expect,test,vi } from 'vitest'
import { render,screen } from '@testing-library/react'
vi.mock('../src/lib/AuthContext',()=>({useAuth:()=>({profile:{id:'u',role:'executive'}})}))
vi.mock('../src/components/GirardNav',()=>({default:()=>null}))
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>({}),useQuery:({queryKey}:any)=>queryKey[0]==='customer_performance'?{isError:true,isLoading:false}:{},useMutation:()=>({})}))
vi.mock('../src/lib/supabase',()=>({supabase:{rpc:()=>({then:(resolve:any)=>Promise.resolve({data:null,error:new Error('delivery read failed')}).then(resolve)})}}))
import {CustomerPerformanceContent,fetchCustomerPerformance} from '../src/pages/girard/CustomerPerformance'
test('delivery query failure propagates from monthly performance',async()=>{await expect(fetchCustomerPerformance('u','executive','2026-09')).rejects.toThrow('delivery read failed')})
test('failed performance read does not show zero metrics',()=>{
 render(<CustomerPerformanceContent/>);expect(screen.getByRole('alert')).toBeTruthy();expect(screen.queryByText('Rp 0.0M')).toBeNull()
})
