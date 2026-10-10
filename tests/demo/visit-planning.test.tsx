import { expect, test, vi } from 'vitest'
import { isEditable } from '../../src/pages/girard/ManagerSchedule'
vi.mock('../../src/lib/supabase',()=>({supabase:{from:(table:string)=>mock.from(table)}}))
test('planned schedules can be edited today, tomorrow, in the past and outside the former horizon',()=>{
 for(const date of ['2026-10-08','2026-10-09','2025-01-01','2028-12-31']) expect(isEditable(date)).toBe(true)
})
import React from 'react'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {afterEach} from 'vitest'
const mock=vi.hoisted(()=>({send:Object.assign(vi.fn(),{hasUnresolved:()=>false}),role:'sales_person',requests:[] as any[],from:vi.fn()}))
vi.mock('../../src/lib/AuthContext',()=>({useAuth:()=>({profile:{id:mock.role==='sales_manager'?'manager':'sales',role:mock.role}})}))
vi.mock('../../src/lib/visitTransactions',()=>({useVisitPlanningSender:()=>mock.send}))
vi.mock('../../src/lib/useUnsavedChanges',()=>({useUnsavedChanges:()=>({dialog:null,confirmDiscard:(fn:()=>void)=>fn()})}))
vi.mock('../../src/lib/visitPlanning',()=>({MAX_VISIT_NOTE_LENGTH:2000,fetchVisitCustomers:async()=>[{id:'c',name:'Store'}],fetchVisitPeople:async()=>[{id:'sales',full_name:'Assigned Salesperson'}],fetchVisitRequests:async()=>({items:mock.requests,total:mock.requests.length})}))
import VisitRequestInbox,{VisitProposalForm} from '../../src/components/VisitRequestInbox'
const clients:QueryClient[]=[]
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());mock.send.mockReset();mock.role='sales_person'})
function mount(node:React.ReactNode){const c=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});clients.push(c);render(<QueryClientProvider client={c}>{node}</QueryClientProvider>)}
test('salesperson proposes an own visit without an editable salesperson input',async()=>{
 mock.send.mockResolvedValue({id:'r',version:1});mount(<VisitProposalForm/>);await screen.findByText('Store');fireEvent.change(screen.getByLabelText('Toko'),{target:{value:'c'}});fireEvent.change(screen.getByLabelText('Tanggal kunjungan'),{target:{value:'2026-10-08'}});fireEvent.click(screen.getByRole('button',{name:'Ajukan kunjungan'}));
 await waitFor(()=>expect(mock.send).toHaveBeenCalledWith('propose_visit',{customer_id:'c',scheduled_date:'2026-10-08',notes:''}));expect(screen.queryByLabelText('Salesperson')).toBeNull()
})
test('amendment submits original version and explains the original remains effective',async()=>{
 mock.send.mockResolvedValue({id:'r',version:1});mount(<VisitProposalForm source={{id:'s',version:3,outlet_id:'c',scheduled_date:'2026-10-08'}}/>);await screen.findByText('Store');expect(screen.getByText(/Jadwal yang disetujui tetap berlaku/)).toBeTruthy();fireEvent.change(screen.getByLabelText('Tanggal kunjungan'),{target:{value:'2026-10-09'}});fireEvent.click(screen.getByText('Ajukan perubahan'));
 await waitFor(()=>expect(mock.send).toHaveBeenCalledWith('amend_visit',expect.objectContaining({schedule_id:'s',expected_version:3,scheduled_date:'2026-10-09'})))
})
test('manager decisions bind request version and disable repeat clicks',async()=>{
 mock.role='sales_manager';mock.requests=[{id:'r',requester_id:'sales',version:2,status:'pending',kind:'new',customer_id:'c',scheduled_date:'2026-10-08'}];mock.send.mockReturnValue(new Promise(()=>{}));mount(<VisitRequestInbox/>);await screen.findByText('Setujui');await screen.findByText('Pengaju: Assigned Salesperson');fireEvent.click(screen.getByText('Setujui'));fireEvent.click(screen.getByText('Setujui'));await waitFor(()=>expect(mock.send).toHaveBeenCalledTimes(1));expect(mock.send).toHaveBeenCalledWith('approve_request',{request_id:'r',expected_version:2})
})

vi.mock('react-router-dom',()=>({useNavigate:()=>()=>{}}))
vi.mock('../../src/components/GirardNav',()=>({default:()=>null}))
import ManagerSchedule from '../../src/pages/girard/ManagerSchedule'
import {calendarDateKey} from '../../src/lib/calendarDate'
test('manager can change the approved store and today date through the versioned RPC',async()=>{
 mock.role='sales_manager';mock.requests=[];mock.send.mockResolvedValue({id:'s',version:3});
 mock.from.mockImplementation((table:string)=>{
  const customers=[{id:'c',name:'Store',city:null,address:null,last_visit_date:null,visit_frequency_days:7},{id:'c2',name:'Other Store',city:null,address:null,last_visit_date:null,visit_frequency_days:7}];
  const rows=table==='customer_manager_assignments'?customers.map((c,i)=>({id:String(i),customer_id:c.id,customers:c})):table==='users'?[{id:'sales',full_name:'Sales'}]:table==='sales_schedules'?[{id:'s',version:2,outlet_id:'c',sales_person_id:'sales',scheduled_date:calendarDateKey(),status:'pending',notes:null,customers:customers[0],users:{id:'sales',full_name:'Sales'}}]:[];
  const q:any={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,range:()=>q,abortSignal:()=>q,single:async()=>({data:{id:'manager',full_name:'Manager'},error:null}),then:(ok:any)=>Promise.resolve({data:rows,count:rows.length,error:null}).then(ok)};return q;
 });
 mount(<ManagerSchedule/>);const edits=await screen.findAllByRole('button',{name:'Ubah'});fireEvent.click(edits[0]);const date=screen.getByLabelText('Tanggal jadwal') as HTMLInputElement;expect(date.disabled).toBe(false);fireEvent.change(date,{target:{value:'2026-10-09'}});
 const selects=screen.getAllByRole('combobox');const store=selects.find(el=>(el as HTMLSelectElement).value==='c')!;expect((store as HTMLSelectElement).disabled).toBe(false);fireEvent.change(store,{target:{value:'c2'}});fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));
 await waitFor(()=>expect(mock.send).toHaveBeenCalledWith('edit_schedule',{schedule_id:'s',expected_version:2,customer_id:'c2',sales_person_id:'sales',scheduled_date:'2026-10-09',notes:''}));
})
import DailySchedule from '../../src/pages/girard/DailySchedule'
vi.mock('../../src/components/ActivePromotionsBanner',()=>({default:()=>null}))
vi.mock('../../src/lib/CustomerStats',()=>({fetchCustomerStatsBatch:async()=>[]}))
test('salesperson can reach and amend a planned visit beyond the four-day quick tabs',async()=>{
 mock.role='sales_person';mock.requests=[];
 mock.from.mockImplementation((table:string)=>{const rows=table==='sales_schedules'?[{id:'future',version:4,outlet_id:'c',scheduled_date:'2027-03-15',status:'pending',notes:null,outlet_visits:[]}]:table==='customers'?[{id:'c',name:'Future Store',address:null,city:null,last_visit_date:null,visit_frequency_days:7}]:[];const q:any={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,range:()=>q,abortSignal:()=>q,then:(ok:any)=>Promise.resolve({data:rows,count:rows.length,error:null}).then(ok)};return q})
 mount(<DailySchedule/>);fireEvent.change(screen.getByLabelText('Lihat tanggal kunjungan'),{target:{value:'2027-03-15'}});await screen.findByText('Future Store');fireEvent.click(screen.getByText('Ajukan perubahan'));expect(await screen.findByText(/Jadwal yang disetujui tetap berlaku/)).toBeTruthy();expect((screen.getByLabelText('Tanggal kunjungan') as HTMLInputElement).value).toBe('2027-03-15')
})
