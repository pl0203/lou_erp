import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { createMemoryRouter,RouterProvider } from 'react-router-dom'
import { transferableAbortController } from 'node:util'
import { QueryClient,QueryClientProvider } from '@tanstack/react-query'
import { afterEach,beforeEach,expect,test,vi } from 'vitest'
import type { LeaveContext } from '../../src/lib/leave/contracts'
import { employeeA,employeeB } from './fixtures'
import { quoteScope } from './quote-fixture'
const mocks=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
vi.mock('../../src/lib/AuthContext',()=>({useAuth:()=>({user:{id:'71000000-0000-0000-0000-000000000001'},profile:{id:'71000000-0000-0000-0000-000000000001',is_active:true},loading:false})}))
vi.mock('../../src/components/IHRNav',()=>({default:()=>null}))
import LeaveManagement from '../../src/pages/ihr/LeaveManagement'
import MyLeave from '../../src/pages/ihr/leave/MyLeave'
import OwnRequestActions from '../../src/pages/ihr/leave/OwnRequestActions'
import { leaveKeys } from '../../src/lib/leave/queryKeys'
const context:LeaveContext={scopeVersion:quoteScope,memberKind:'employee',capabilities:{request:true,approve:false,configure:false,adjust:false,readPrivate:false,manageAccess:false},currentPeriod:{year:2026,startDate:'2026-01-01',endDate:'2027-01-01'},timezone:'Etc/UTC',setup:{ready:true,blockers:[]},balances:[]}
const state={id:employeeB,version:2,status:'submitted',canWithdraw:true,canRequestCancellation:false,cancellationBlocker:null,activeAttemptId:null}
const approved={...state,status:'approved',canWithdraw:false,canRequestCancellation:true}
const clients:QueryClient[]=[]
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);const panel=(readState:'ready'|'pending'|'error'='ready')=><QueryClientProvider client={client}><OwnRequestActions actorId={employeeA} scopeVersion={quoteScope} requestId={employeeB} requestVersion={1} readState={readState}/></QueryClientProvider>;return {client,panel,view:render(panel())}}
function serve(current=state){mocks.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>name==='leave_transaction_v1'?Promise.resolve({data:{id:employeeB,version:3,operation:args.p_operation},error:null}):{abortSignal:()=>Promise.resolve({data:name==='leave_context_v1'?context:current,error:null})})}
function unload(){const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented}
beforeEach(()=>{vi.stubGlobal('AbortController',class{constructor(){return transferableAbortController()}});localStorage.clear();serve();vi.spyOn(window,'confirm').mockReturnValue(false)})
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());vi.unstubAllGlobals();vi.restoreAllMocks()})
test('withdraw uses a freshly authorized server version and coalesces clicks',async()=>{
 mount();const button=await screen.findByRole('button',{name:'Tarik pengajuan'});fireEvent.click(button);fireEvent.click(button)
 expect(await screen.findByText('Pengajuan cuti telah ditarik. Reservasi saldo dilepas.')).toBeTruthy()
 const sends=mocks.rpc.mock.calls.filter(([name])=>name==='leave_transaction_v1');expect(sends).toHaveLength(1);expect(sends[0][1]).toMatchObject({p_operation:'withdraw_request',p_payload:{request_id:employeeB,expected_version:2}});expect(localStorage.length).toBe(0)
})
test('whole cancellation keeps a private ephemeral reason with dirty guards until confirmed submission',async()=>{
 serve(approved);mount();fireEvent.click(await screen.findByRole('button',{name:'Minta pembatalan seluruh pengajuan'}));fireEvent.change(screen.getByLabelText('Alasan pembatalan'),{target:{value:'Private cancellation reason'}});expect(unload()).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'Tutup pembatalan'}));expect(window.confirm).toHaveBeenCalled();expect(screen.getByDisplayValue('Private cancellation reason')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'Kirim permintaan pembatalan'}));expect(await screen.findByText('Permintaan pembatalan telah dikirim. Pemakaian saldo tetap berlaku sampai pembatalan disetujui.')).toBeTruthy();expect(unload()).toBe(false);expect(screen.queryByDisplayValue('Private cancellation reason')).toBeNull();expect(localStorage.length).toBe(0)
 const args=mocks.rpc.mock.calls.filter(([name])=>name==='leave_transaction_v1')[0][1];expect(args.p_payload).toEqual({request_id:employeeB,expected_version:2,reason:'Private cancellation reason'})
})
test('uncertain cancellation persists only minimal metadata and recovery never resends the private reason',async()=>{
 serve(approved);const {view,panel}=mount();fireEvent.click(await screen.findByRole('button',{name:'Minta pembatalan seluruh pengajuan'}));fireEvent.change(screen.getByLabelText('Alasan pembatalan'),{target:{value:'Private cancellation reason'}})
 mocks.rpc.mockImplementationOnce(()=>({abortSignal:()=>Promise.resolve({data:context,error:null})}));mocks.rpc.mockRejectedValueOnce(new Error('Private cancellation reason'))
 fireEvent.click(screen.getByRole('button',{name:'Kirim permintaan pembatalan'}));await screen.findByRole('button',{name:'Pulihkan hasil tindakan'});const raw=localStorage.getItem(localStorage.key(0)!)!;expect(raw).not.toMatch(/reason|Private|request_id|expected_version/);expect(screen.queryByLabelText('Alasan pembatalan')).toBeNull()
 view.unmount();render(panel());await screen.findByRole('button',{name:'Pulihkan hasil tindakan'});mocks.rpc.mockImplementation((name:string)=>name==='leave_reconcile_request_v1'?Promise.resolve({data:{state:'committed',result:{id:employeeB,version:3,operation:'request_cancellation'}},error:null}):{abortSignal:()=>Promise.resolve({data:name==='leave_context_v1'?context:approved,error:null})})
 fireEvent.click(screen.getByRole('button',{name:'Pulihkan hasil tindakan'}));expect(await screen.findByText('Permintaan pembatalan telah dikirim. Pemakaian saldo tetap berlaku sampai pembatalan disetujui.')).toBeTruthy();expect(localStorage.length).toBe(0);expect(mocks.rpc.mock.calls.filter(([name])=>name==='leave_transaction_v1')).toHaveLength(1)
})
test('unset cancellation policy renders a safe blocker and exposes no action',async()=>{
 serve({...approved,canRequestCancellation:false,cancellationBlocker:'CANCELLATION_RULES_UNCONFIRMED'});mount();expect(await screen.findByText('Aturan pembatalan belum dikonfirmasi HR.')).toBeTruthy();expect(screen.queryByRole('button',{name:'Minta pembatalan seluruh pengajuan'})).toBeNull()
})
test('interrupted shared read hides a cancellation draft while retaining its guard and restores after same-scope readback',async()=>{
 serve(approved);const {panel,view}=mount();fireEvent.click(await screen.findByRole('button',{name:'Minta pembatalan seluruh pengajuan'}));fireEvent.change(screen.getByLabelText('Alasan pembatalan'),{target:{value:'Private cancellation reason'}})
 view.rerender(panel('error'));expect(screen.queryByDisplayValue('Private cancellation reason')).toBeNull();expect(unload()).toBe(true)
 view.rerender(panel());expect(await screen.findByDisplayValue('Private cancellation reason')).toBeTruthy();expect(unload()).toBe(true)
})
test('cancelled action preflight cannot turn cached authorization into a dispatched withdrawal',async()=>{
 const {client}=mount();await screen.findByRole('button',{name:'Tarik pengajuan'});let signal!:AbortSignal;mocks.rpc.mockReturnValue({abortSignal:(s:AbortSignal)=>(signal=s,new Promise(()=>{}))})
 fireEvent.click(screen.getByRole('button',{name:'Tarik pengajuan'}));await waitFor(()=>expect(signal).toBeDefined());await act(async()=>client.cancelQueries({queryKey:leaveKeys.context(employeeA,'current'),exact:true}));await screen.findByRole('alert');expect(mocks.rpc.mock.calls.filter(([name])=>name==='leave_transaction_v1')).toHaveLength(0)
})

test('personal cancellation is reachable from own detail and protects closing history/detail while its reason is dirty',async()=>{
 const summary={id:employeeB,sequence:4,startDate:'2026-10-02',endDate:'2026-10-03',duration:{mode:'full_scheduled_day'},totalMinutes:675,status:'approved',version:2,submittedAt:'2026-10-01T12:00:00+00:00',sourceKind:'submission'}
 const detail={...summary,reason:'Original private reason',approverName:'Fictional Manager',days:[{date:'2026-10-02',scheduledMinutes:450,chargedMinutes:450,exclusion:null,groupName:null},{date:'2026-10-03',scheduledMinutes:225,chargedMinutes:225,exclusion:null,groupName:'Fictional Amber'}],allocations:[{year:2026,startDate:'2026-01-01',endDate:'2027-01-01',chargedMinutes:675}]}
 mocks.rpc.mockImplementation((name:string)=>({abortSignal:()=>Promise.resolve({data:name==='leave_context_v1'?context:name==='leave_own_history_v1'?{rows:[summary],nextBefore:null}:name==='leave_own_request_v1'?detail:approved,error:null})}))
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);render(<QueryClientProvider client={client}><MyLeave actorId={employeeA} context={context}/></QueryClientProvider>)
 fireEvent.click(screen.getByRole('button',{name:'Riwayat pengajuan'}));fireEvent.click(await screen.findByRole('button',{name:'Lihat rincian 2026-10-02 sampai 2026-10-03'}));fireEvent.click(await screen.findByRole('button',{name:'Minta pembatalan seluruh pengajuan'}));fireEvent.change(screen.getByLabelText('Alasan pembatalan'),{target:{value:'Private cancellation reason'}})
 expect((screen.getByRole('button',{name:'Buat pratinjau cuti'}) as HTMLButtonElement).disabled).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'Tutup rincian'}));expect(screen.getByDisplayValue('Private cancellation reason')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Tutup riwayat pengajuan'}));expect(screen.getByDisplayValue('Private cancellation reason')).toBeTruthy();expect(unload()).toBe(true)
 vi.mocked(window.confirm).mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'Tutup riwayat pengajuan'}));expect(screen.queryByDisplayValue('Private cancellation reason')).toBeNull();expect(unload()).toBe(false);expect((screen.getByRole('button',{name:'Buat pratinjau cuti'}) as HTMLButtonElement).disabled).toBe(false)
})

test('real page keeps a private cancellation draft and dirty guard through shared context failure and cache purge',async()=>{
 const summary={id:employeeB,sequence:4,startDate:'2026-10-02',endDate:'2026-10-03',duration:{mode:'full_scheduled_day'},totalMinutes:675,status:'approved',version:2,submittedAt:'2026-10-01T12:00:00+00:00',sourceKind:'submission'}
 const detail={...summary,reason:'Original private reason',approverName:'Fictional Manager',days:[{date:'2026-10-02',scheduledMinutes:450,chargedMinutes:450,exclusion:null,groupName:null},{date:'2026-10-03',scheduledMinutes:225,chargedMinutes:225,exclusion:null,groupName:'Fictional Amber'}],allocations:[{year:2026,startDate:'2026-01-01',endDate:'2027-01-01',chargedMinutes:675}]}
 const servePage=()=>mocks.rpc.mockImplementation((name:string)=>({abortSignal:()=>Promise.resolve({data:name==='leave_context_v1'?context:name==='leave_own_history_v1'?{rows:[summary],nextBefore:null}:name==='leave_own_request_v1'?detail:approved,error:null})}))
 servePage();const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);render(<QueryClientProvider client={client}><LeaveManagement/></QueryClientProvider>)
 fireEvent.click(await screen.findByRole('button',{name:'Riwayat pengajuan'}));fireEvent.click(await screen.findByRole('button',{name:'Lihat rincian 2026-10-02 sampai 2026-10-03'}));fireEvent.click(await screen.findByRole('button',{name:'Minta pembatalan seluruh pengajuan'}));fireEvent.change(screen.getByLabelText('Alasan pembatalan'),{target:{value:'Retained private cancellation draft'}});expect(unload()).toBe(true)
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.reject(new Error('Sensitive diagnostic'))});fireEvent(window,new Event('focus'));await screen.findByRole('button',{name:'Coba lagi'});expect(screen.queryByDisplayValue('Retained private cancellation draft')).toBeNull();expect(unload()).toBe(true)
 servePage();fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}));fireEvent.click(await screen.findByRole('button',{name:'Coba lagi riwayat pengajuan'}));fireEvent.click(await screen.findByRole('button',{name:'Coba lagi rincian'}));fireEvent.click(await screen.findByRole('button',{name:'Coba lagi tindakan'}));expect(await screen.findByDisplayValue('Retained private cancellation draft')).toBeTruthy();expect(unload()).toBe(true)
})

test('recovery cannot acknowledge a receipt for another subject or a non-personal operation',async()=>{
 mount();const button=await screen.findByRole('button',{name:'Tarik pengajuan'});mocks.rpc.mockImplementationOnce(()=>({abortSignal:()=>Promise.resolve({data:context,error:null})}));mocks.rpc.mockRejectedValueOnce(new Error('lost'));fireEvent.click(button);await screen.findByRole('button',{name:'Pulihkan hasil tindakan'})
 for(const result of [{id:employeeA,version:3,operation:'withdraw_request'},{id:employeeB,version:3,operation:'approve_request'}]){
  mocks.rpc.mockImplementation((name:string)=>name==='leave_reconcile_request_v1'?Promise.resolve({data:{state:'committed',result},error:null}):{abortSignal:()=>Promise.resolve({data:name==='leave_context_v1'?context:state,error:null})})
  fireEvent.click(screen.getByRole('button',{name:'Pulihkan hasil tindakan'}));await screen.findByRole('alert');expect(screen.queryByText('Pengajuan cuti telah ditarik. Reservasi saldo dilepas.')).toBeNull();expect(localStorage.length).toBe(1)
 }
})
test('a suspended cancellation draft still blocks router navigation until discard is confirmed',async()=>{
 serve(approved);const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client)
 const router=createMemoryRouter([{path:'/leave',element:<OwnRequestActions actorId={employeeA} scopeVersion={quoteScope} requestId={employeeB} requestVersion={1} readState="ready"/>},{path:'/away',element:<p>Other page</p>}],{initialEntries:['/leave']})
 render(<QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider>);fireEvent.click(await screen.findByRole('button',{name:'Minta pembatalan seluruh pengajuan'}));fireEvent.change(screen.getByLabelText('Alasan pembatalan'),{target:{value:'Private cancellation draft'}})
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.reject(new Error('Sensitive diagnostic'))});fireEvent(window,new Event('focus'));await screen.findByRole('button',{name:'Coba lagi tindakan'});expect(screen.queryByDisplayValue('Private cancellation draft')).toBeNull();expect(unload()).toBe(true)
 await act(async()=>{void router.navigate('/away')});expect(window.confirm).toHaveBeenCalled();expect(router.state.location.pathname).toBe('/leave');expect(unload()).toBe(true)
 vi.mocked(window.confirm).mockReturnValue(true);await act(async()=>{void router.navigate('/away')});expect(await screen.findByText('Other page')).toBeTruthy();expect(unload()).toBe(false);router.dispose()
})
