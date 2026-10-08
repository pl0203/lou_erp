import React from 'react'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {afterEach,beforeEach,expect,test,vi} from 'vitest'
const mock=vi.hoisted(()=>({rpc:vi.fn(),profile:{id:'a',role:'sales_person'}}))
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:mock.rpc}}))
vi.mock('../../src/lib/AuthContext',()=>({useAuth:()=>({profile:mock.profile})}))
import StorePOContext,{fetchStorePOContext} from '../../src/components/StorePOContext'
const answer={version:1,as_of:'2026-10-08T00:00:00Z',latest_po_date:'2026-01-01',range_from:'2026-08-08',range_through:'2026-10-08',items:[],total:0,page:1,page_size:20}
const clients:QueryClient[]=[]
beforeEach(()=>{mock.rpc.mockReset().mockResolvedValue({data:answer,error:null});mock.profile={id:'a',role:'sales_person'}})
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear())})
function mount(customerId='c'){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);return {client,...render(<QueryClientProvider client={client}><StorePOContext customerId={customerId}/></QueryClientProvider>)}}
test('latest PO date stays distinct from server-derived two-calendar-month range',async()=>{
 mount();await screen.findByText(/2026-01-01/);expect(screen.getByText(/2026-08-08.*2026-10-08/)).toBeTruthy();expect(screen.getByText(/Tidak ada PO pada rentang ini/)).toBeTruthy()
})
test('cancelled and legacy statuses are preserved exactly',async()=>{
 mock.rpc.mockResolvedValue({data:{...answer,items:[{id:'1',po_number:'PO-1',order_date:'2026-10-08',status:'cancelled'},{id:'2',po_number:'PO-2',order_date:'2026-09-01',status:'shipped'}],total:2},error:null})
 mount();await screen.findByText('cancelled');expect(screen.getByText('shipped')).toBeTruthy()
})
test('failure shows retry and never a misleading empty state',async()=>{
 mock.rpc.mockResolvedValueOnce({data:null,error:{message:'denied'}});mount();await screen.findByRole('alert');expect(screen.queryByText(/Tidak ada PO/)).toBeNull();fireEvent.click(screen.getByText('Coba lagi'));await screen.findByText(/Tidak ada PO/)
})
test('customer and identity changes cannot show a stale store result',async()=>{
 const {rerender,client}=mount();await screen.findByText(/2026-01-01/);mock.rpc.mockReturnValue(new Promise(()=>{}));mock.profile={id:'b',role:'sales_manager'};
 rerender(<QueryClientProvider client={client}><StorePOContext customerId="different"/></QueryClientProvider>);expect(screen.queryByText(/2026-01-01/)).toBeNull();expect(screen.getByText(/Memuat riwayat PO/)).toBeTruthy()
 await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('pilot_store_po_context_v1',{p_customer_id:'different',p_page:1,p_page_size:20}))
})
test('invalid projection rejects rather than silently treating it as zero',async()=>{
 mock.rpc.mockResolvedValue({data:{...answer,total:null},error:null});await expect(fetchStorePOContext('c',1)).rejects.toThrow('valid')
})
test('server window rollover during pagination returns to the first page of the new window',async()=>{
 let rolled=false;mock.rpc.mockImplementation(async(_name:string,args:any)=>{if(args.p_page===2)rolled=true;return {data:{...answer,total:40,page:args.p_page,range_from:rolled?'2026-08-09':'2026-08-08',range_through:rolled?'2026-10-09':'2026-10-08'},error:null}})
 mount();await screen.findByText('Halaman 1');fireEvent.click(screen.getByText('Berikutnya'));await waitFor(()=>expect(screen.getByText(/2026-08-09.*2026-10-09/)).toBeTruthy());expect(screen.getByText('Halaman 1')).toBeTruthy()
})
