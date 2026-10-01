import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
const mocks=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../src/lib/supabase',()=>({supabase:{rpc:mocks.rpc,from:()=>{const q:any={select:()=>q,eq:()=>q,order:()=>q,then:(resolve:any)=>Promise.resolve({data:[{id:'dummy',status:'pending',total_value:10,created_at:'2026-09-30',customers:{name:'Dummy customer'},users:{full_name:'Dummy sales'},girard_order_items:[]}],error:null}).then(resolve)};return q}}}))
vi.mock('../src/lib/AuthContext',()=>({useAuth:()=>({user:{id:'dummy-user'}})}))
vi.mock('../src/components/AthelNav',()=>({default:()=>null}))
vi.mock('react-router-dom',()=>({useNavigate:()=>()=>{}}))
import SalesOrders from '../src/pages/athel/SalesOrders'
afterEach(()=>{cleanup();localStorage.clear();vi.clearAllMocks()})
test('required rejection reason blocks whitespace and failed rejection preserves reason inline',async()=>{
 mocks.rpc.mockResolvedValue({data:null,error:{code:'40001',message:'Pesanan berubah. Muat ulang sebelum mencoba lagi.'}})
 const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})
 render(<QueryClientProvider client={client}><SalesOrders/></QueryClientProvider>)
 fireEvent.click(await screen.findByRole('button',{name:'Tolak'}))
 const reason=screen.getByRole('textbox');fireEvent.change(reason,{target:{value:'   '}})
 expect((screen.getByRole('button',{name:'Tolak Pesanan'}) as HTMLButtonElement).disabled).toBe(true)
 expect(mocks.rpc).not.toHaveBeenCalled()
 fireEvent.change(reason,{target:{value:'Barang belum tersedia'}});fireEvent.click(screen.getByRole('button',{name:'Tolak Pesanan'}))
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Pesanan berubah'))
 expect((reason as HTMLTextAreaElement).value).toBe('Barang belum tersedia')
 expect(screen.getByRole('button',{name:'Tolak Pesanan'})).toBeTruthy();client.clear()
})
