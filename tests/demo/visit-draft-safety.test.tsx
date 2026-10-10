import React from 'react'
import {transferableAbortController} from 'node:util'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state=vi.hoisted(()=>({profile:{id:'sales',role:'sales_person'},send:Object.assign(vi.fn(),{hasUnresolved:()=>false}),scheduleDates:[] as string[][]}))
vi.mock('../../src/lib/AuthContext',()=>({useAuth:()=>({profile:state.profile})}))
vi.mock('../../src/lib/visitTransactions',()=>({useVisitPlanningSender:()=>state.send}))
vi.mock('../../src/components/GirardNav',()=>({default:()=>null}))
vi.mock('../../src/components/ActivePromotionsBanner',()=>({default:()=>null}))
vi.mock('../../src/lib/CustomerStats',()=>({fetchCustomerStatsBatch:async()=>[]}))
vi.mock('../../src/lib/supabase',()=>({supabase:{from:(table:string)=>{
 let offset=0;let ids:string[]=[]
 const customers=[{id:'c1',name:'First store',address:null,city:null,last_visit_date:null,visit_frequency_days:7},{id:'c2',name:'Second store',address:null,city:null,last_visit_date:null,visit_frequency_days:7}]
 const rows=()=>table==='outlet_visits'?(offset===0?[{id:'v1',notes:'One',note_version:1,checked_in_at:'2026-10-08T10:00:00Z',lat:null,lng:null,schedule_id:'s1',customers:customers[0]},{id:'v2',notes:'Two',note_version:1,checked_in_at:'2026-10-08T09:00:00Z',lat:null,lng:null,schedule_id:'s2',customers:customers[1]}]:[{id:'v3',notes:'Three',note_version:1,checked_in_at:'2026-10-07T09:00:00Z',lat:null,lng:null,schedule_id:'s3',customers:customers[0]}]):table==='sales_schedules'?[{id:'s1',version:1,outlet_id:'c1',sales_person_id:'sales',scheduled_date:calendarDateKey(),status:'pending',notes:null,outlet_visits:[],customers:customers[0],users:{id:'sales',full_name:'Sales'}},{id:'s2',version:1,outlet_id:'c2',sales_person_id:'sales',scheduled_date:calendarDateKey(),status:'pending',notes:null,outlet_visits:[],customers:customers[1],users:{id:'sales',full_name:'Sales'}}]:table==='customers'?customers:table==='customer_manager_assignments'?customers.map(c=>({id:c.id,customer_id:c.id,customers:c})):table==='users'?[{id:'sales',full_name:'Sales'}]:[]
 const q:any={select:()=>q,eq:()=>q,in:(key:string,values:string[])=>{ids=values;if(table==='sales_schedules'&&key==='scheduled_date')state.scheduleDates.push(values);return q},order:()=>q,range:(start:number)=>{offset=start;return q},abortSignal:()=>q,single:async()=>({data:{id:'manager',full_name:'Manager'},error:null}),then:(ok:any)=>Promise.resolve({data:rows(),count:table==='outlet_visits'?21:rows().length,error:table==='sales_schedules'&&ids.includes('')?new Error('invalid date'):null}).then(ok)};return q
}}}))
import OwnVisitHistory from '../../src/pages/girard/OwnVisitHistory'
import DailySchedule from '../../src/pages/girard/DailySchedule'
import ManagerSchedule from '../../src/pages/girard/ManagerSchedule'
import {calendarDateKey} from '../../src/lib/calendarDate'
const clients:QueryClient[]=[];const routers:ReturnType<typeof createMemoryRouter>[]=[]
afterEach(()=>{cleanup();routers.splice(0).forEach(r=>r.dispose());clients.splice(0).forEach(c=>c.clear());vi.unstubAllGlobals()})
beforeEach(()=>{vi.stubGlobal('AbortController',class {constructor(){return transferableAbortController()}});state.profile={id:'sales',role:'sales_person'};state.scheduleDates=[];state.send.mockReset()})
function mount(element:React.ReactNode){const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});clients.push(client);const router=createMemoryRouter([{path:'/',element},{path:'/away',element:<p>Other route</p>},{path:'/girard/visit/:id',element:<p>Visit evidence route</p>}]);routers.push(router);render(<QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider>);return router}
async function editFirstNote(){await screen.findAllByText('Edit catatan');fireEvent.click(screen.getAllByText('Edit catatan')[0]);fireEvent.change(screen.getByLabelText('Catatan kunjungan'),{target:{value:'Keep earlier row draft'}})}
test('earlier history-row draft blocks route navigation even when later rows are clean',async()=>{
 const router=mount(<OwnVisitHistory/>);await editFirstNote();await act(async()=>{void router.navigate('/away')});expect(await screen.findByRole('dialog')).toBeTruthy();fireEvent.click(screen.getByText('Tetap mengedit'));expect((screen.getByLabelText('Catatan kunjungan') as HTMLTextAreaElement).value).toBe('Keep earlier row draft');expect(screen.queryByText('Other route')).toBeNull()
})
test('history pagination and evidence navigation confirm before discarding an earlier note draft',async()=>{
 mount(<OwnVisitHistory/>);await editFirstNote();fireEvent.click(screen.getByText('Berikutnya'));expect(await screen.findByRole('dialog')).toBeTruthy();fireEvent.click(screen.getByText('Tetap mengedit'));expect(screen.getByText('Halaman 1')).toBeTruthy();fireEvent.click(screen.getAllByText('Lihat foto dan bukti kunjungan')[0]);expect(await screen.findByRole('dialog')).toBeTruthy();fireEvent.click(screen.getByText('Tetap mengedit'));fireEvent.click(screen.getByText('Berikutnya'));fireEvent.click(await screen.findByText('Buang perubahan'));await screen.findByText('Three');expect(screen.queryByLabelText('Catatan kunjungan')).toBeNull()
})
test('switching amendment targets or starting a new proposal protects the existing dirty draft',async()=>{
 mount(<DailySchedule/>);const buttons=await screen.findAllByText('Ajukan perubahan');fireEvent.click(buttons[0]);fireEvent.change(screen.getByLabelText('Catatan permintaan'),{target:{value:'Keep proposal'}});fireEvent.click(screen.getAllByText('Ajukan perubahan').at(-1)!);expect(await screen.findByRole('dialog')).toBeTruthy();fireEvent.click(screen.getByText('Tetap mengedit'));expect((screen.getByLabelText('Catatan permintaan') as HTMLTextAreaElement).value).toBe('Keep proposal');fireEvent.click(screen.getByText('Ajukan kunjungan baru'));expect(await screen.findByRole('dialog')).toBeTruthy();fireEvent.click(screen.getByText('Buang perubahan'));expect((screen.getByLabelText('Catatan permintaan') as HTMLTextAreaElement).value).toBe('');expect((screen.getByLabelText('Toko') as HTMLSelectElement).value).toBe('')
})
test('blank manager date never reaches a DATE filter and leaves the selector usable',async()=>{
 state.profile={id:'manager',role:'sales_manager'};mount(<ManagerSchedule/>);const date=await screen.findByLabelText('Lihat tanggal');fireEvent.change(date,{target:{value:''}});await waitFor(()=>expect(state.scheduleDates.length).toBeGreaterThan(0));expect(state.scheduleDates.flat()).not.toContain('');expect((screen.getByLabelText('Lihat tanggal') as HTMLInputElement).value).toBe(calendarDateKey());fireEvent.change(date,{target:{value:'2026-11-08'}});await waitFor(()=>expect(state.scheduleDates.flat()).toContain('2026-11-08'))
})
