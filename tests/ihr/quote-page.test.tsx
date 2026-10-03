import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { transferableAbortController } from 'node:util'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { LeaveContext } from '../../src/lib/leave/contracts'
import { employeeA, employeeB } from './fixtures'
import { changedQuoteScope, quoteFixture, quoteInput, quoteScope } from './quote-fixture'
const mocks=vi.hoisted(()=>({rpc:vi.fn(),auth:{user:{id:'71000000-0000-0000-0000-000000000001'},profile:{id:'71000000-0000-0000-0000-000000000001',is_active:true},loading:false}}))
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
vi.mock('../../src/lib/AuthContext',()=>({useAuth:()=>mocks.auth}))
vi.mock('../../src/components/IHRNav',()=>({default:()=>null}))
import LeaveManagement from '../../src/pages/ihr/LeaveManagement'
import { leaveKeys } from '../../src/lib/leave/queryKeys'
const context:LeaveContext={scopeVersion:quoteScope,memberKind:'employee',capabilities:{request:true,approve:true,configure:false,adjust:false,readPrivate:false,manageAccess:false},currentPeriod:{year:2026,startDate:'2026-01-01',endDate:'2027-01-01'},timezone:'Etc/UTC',setup:{ready:false,blockers:[]},balances:[{accountId:employeeA,year:2026,allowanceMinutes:5400,approvedMinutes:450,pendingMinutes:60,availableMinutes:4890,expiredMinutes:0,version:4,reconciled:true}]}
const clients:QueryClient[]=[]
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);const element=()=> <QueryClientProvider client={client}><LeaveManagement/></QueryClientProvider>;return {client,element,view:render(element())}}
function serve(ctx:LeaveContext=context){mocks.rpc.mockImplementation((name:string)=>({abortSignal:()=>Promise.resolve({data:name==='leave_context_v1'?ctx:{...quoteFixture,scopeVersion:ctx.scopeVersion},error:null})}))}
async function openFill(){fireEvent.click(await screen.findByRole('button',{name:'Buat pratinjau cuti'}));await screen.findByLabelText('Alasan pribadi');for(const [label,value] of [['Tanggal mulai',quoteInput.startDate],['Tanggal selesai',quoteInput.endDate],['Alasan pribadi',quoteInput.reason]])fireEvent.change(screen.getByLabelText(label),{target:{value}});fireEvent.change(screen.getByLabelText('Durasi setiap tanggal'),{target:{value:'225'}})}
function unloadGuarded(){const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented}
async function failPreflight(){mocks.rpc.mockReturnValue({abortSignal:()=>Promise.reject(new Error('Sensitive transport diagnostic'))});fireEvent.click(screen.getByRole('button',{name:'Hitung pratinjau'}));await waitFor(()=>expect(screen.queryByLabelText('Alasan pribadi')).toBeNull())}
beforeEach(()=>{vi.stubGlobal('AbortController',class{constructor(){return transferableAbortController()}});mocks.auth.user.id=employeeA;mocks.auth.profile.id=employeeA;mocks.auth.profile.is_active=true;mocks.auth.loading=false;serve();vi.spyOn(window,'confirm').mockReturnValue(false)})
afterEach(()=>{cleanup();clients.splice(0).forEach(client=>client.clear());onlineManager.setOnline(true);mocks.rpc.mockReset();vi.restoreAllMocks();vi.unstubAllGlobals()})
test('real page preserves dirty draft through a failed shared-context read, hides unvalidated data, and restores only after successful same-scope retry',async()=>{
 mount();await openFill();expect(unloadGuarded()).toBe(true);await failPreflight()
 expect(document.activeElement).toBe(screen.getByRole('alert'))
 expect(screen.queryByText('81j 30m')).toBeNull();expect(screen.queryByRole('region',{name:'Pratinjau cuti'})).toBeNull();expect(unloadGuarded()).toBe(true);expect(window.confirm).not.toHaveBeenCalled();expect(screen.queryByText('Sensitive transport diagnostic')).toBeNull()
 let finish!:(value:unknown)=>void;mocks.rpc.mockReturnValue({abortSignal:()=>new Promise(resolve=>finish=resolve)})
 fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}));await waitFor(()=>expect(finish).toBeDefined());expect(screen.queryByLabelText('Alasan pribadi')).toBeNull();expect(screen.queryByText('81j 30m')).toBeNull();expect(unloadGuarded()).toBe(true)
 await act(async()=>finish({data:context,error:null}));expect(await screen.findByDisplayValue(quoteInput.reason)).toBeTruthy()
 expect((screen.getByLabelText('Tanggal mulai') as HTMLInputElement).value).toBe(quoteInput.startDate);expect((screen.getByLabelText('Tanggal selesai') as HTMLInputElement).value).toBe(quoteInput.endDate);expect((screen.getByLabelText('Durasi setiap tanggal') as HTMLSelectElement).value).toBe('225');expect(screen.getByText('81j 30m')).toBeTruthy();expect(unloadGuarded()).toBe(true)
})
test('real page accepts the complete actor token and a failed foreground read never restores its old preview on retry',async()=>{
 mount();await openFill();expect(document.activeElement).toBe(screen.getByLabelText('Tanggal mulai'));fireEvent.change(screen.getByLabelText('Durasi setiap tanggal'),{target:{value:'full'}});fireEvent.click(screen.getByRole('button',{name:'Hitung pratinjau'}));expect(await screen.findByRole('region',{name:'Pratinjau cuti'})).toBeTruthy();expect(document.activeElement).toBe(screen.getByRole('region',{name:'Pratinjau cuti'}))
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.reject(new Error('Transient failure'))});fireEvent(window,new Event('focus'));await waitFor(()=>expect(screen.queryByLabelText('Alasan pribadi')).toBeNull());expect(screen.queryByRole('region',{name:'Pratinjau cuti'})).toBeNull();expect(unloadGuarded()).toBe(true)
 serve();fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}));expect(await screen.findByDisplayValue(quoteInput.reason)).toBeTruthy();expect(screen.queryByRole('region',{name:'Pratinjau cuti'})).toBeNull()
})
test.each(['scope','capability','director'] as const)('retry with confirmed %s loss clears the hidden draft and dirty guard',async loss=>{
 mount();await openFill();await failPreflight();expect(unloadGuarded()).toBe(true)
 const changed:LeaveContext=loss==='scope'?{...context,scopeVersion:changedQuoteScope}:loss==='director'?{...context,scopeVersion:changedQuoteScope,memberKind:'director',currentPeriod:null,balances:[],capabilities:{...context.capabilities,request:false}}:{...context,capabilities:{...context.capabilities,request:false}}
 serve(changed);fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}));await screen.findByRole('tab',{name:'Persetujuan'});await waitFor(()=>expect(unloadGuarded()).toBe(false));expect(screen.queryByDisplayValue(quoteInput.reason)).toBeNull()
 if(loss==='scope'){fireEvent.click(screen.getByRole('button',{name:'Buat pratinjau cuti'}));expect((await screen.findByLabelText('Alasan pribadi') as HTMLTextAreaElement).value).toBe('')}
})
test.each(['identity','inactive'] as const)('a current %s change clears retained state immediately, before a new read completes',async change=>{
 const {view,element}=mount();await openFill();await failPreflight();expect(unloadGuarded()).toBe(true)
 mocks.rpc.mockReturnValue({abortSignal:()=>new Promise(()=>{})})
 if(change==='identity'){mocks.auth.user.id=employeeB;mocks.auth.profile.id=employeeB}else mocks.auth.profile.is_active=false
 view.rerender(element());expect(screen.queryByDisplayValue(quoteInput.reason)).toBeNull();expect(screen.queryByText('81j 30m')).toBeNull();expect(unloadGuarded()).toBe(false)
})
test('explicit server access denial destroys the suspended draft instead of treating it as a recoverable connection error',async()=>{
 mount();await openFill();mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:null,error:{code:'42501'}})})
 fireEvent.click(screen.getByRole('button',{name:'Hitung pratinjau'}));await waitFor(()=>expect(screen.queryByLabelText('Alasan pribadi')).toBeNull());expect(unloadGuarded()).toBe(false)
 serve();fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}));fireEvent.click(await screen.findByRole('button',{name:'Buat pratinjau cuti'}));expect((await screen.findByLabelText('Alasan pribadi') as HTMLTextAreaElement).value).toBe('')
})
test('a suspended dirty page still guards router navigation and only discards after confirmation',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client)
 const router=createMemoryRouter([{path:'/leave',element:<LeaveManagement/>},{path:'/away',element:<p>Other page</p>}],{initialEntries:['/leave']})
 render(<QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider>);await openFill();await failPreflight()
 await act(async()=>{void router.navigate('/away')});expect(window.confirm).toHaveBeenCalled();expect(router.state.location.pathname).toBe('/leave');expect(unloadGuarded()).toBe(true)
 vi.mocked(window.confirm).mockReturnValue(true);await act(async()=>{void router.navigate('/away')});expect(await screen.findByText('Other page')).toBeTruthy();expect(unloadGuarded()).toBe(false);router.dispose()
})
test('a quote transport finishing after a shared context failure cannot revive its old preview after retry',async()=>{
 mount();await openFill();fireEvent.change(screen.getByLabelText('Durasi setiap tanggal'),{target:{value:'full'}})
 let finishQuote!:(value:unknown)=>void,signal!:AbortSignal
 mocks.rpc.mockImplementation((name:string)=>({abortSignal:(s:AbortSignal)=>name==='leave_context_v1'?Promise.resolve({data:context,error:null}):(signal=s,new Promise(resolve=>finishQuote=resolve))}))
 fireEvent.click(screen.getByRole('button',{name:'Hitung pratinjau'}));await waitFor(()=>expect(finishQuote).toBeDefined())
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.reject(new Error('Transient failure'))});fireEvent(window,new Event('focus'));await waitFor(()=>expect(screen.queryByLabelText('Alasan pribadi')).toBeNull());expect(signal.aborted).toBe(true)
 await act(async()=>finishQuote({data:quoteFixture,error:null}));serve();fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}));expect(await screen.findByDisplayValue(quoteInput.reason)).toBeTruthy();expect(screen.queryByRole('region',{name:'Pratinjau cuti'})).toBeNull()
})
test('suspending the real page for history authority does not unmount and restart its accepted history gate',async()=>{
 let calls=0,finish!:(value:unknown)=>void
 mocks.rpc.mockImplementation((name:string)=>({abortSignal:()=>name==='leave_context_v1'?(++calls===1?Promise.resolve({data:context,error:null}):new Promise(resolve=>finish=resolve)):Promise.resolve({data:{balance:context.balances[0],rows:[{id:employeeB,sequence:3,date:'2026-10-02',kind:'adjustment',allowanceDelta:-60,reservedDelta:0,usedDelta:0}],nextBefore:null},error:null})}))
 mount();fireEvent.click(await screen.findByRole('button',{name:'Riwayat saldo'}));await waitFor(()=>expect(finish).toBeDefined());expect(screen.queryByText('−1j')).toBeNull()
 await act(async()=>finish({data:context,error:null}));expect(await screen.findByText('−1j')).toBeTruthy();expect(calls).toBe(2)
})
test.each([false,true])('cancelled shared preflight keeps private draft and balance suspended without cached continuation (offline=%s)',async offline=>{
 const {client}=mount();await openFill();fireEvent.change(screen.getByLabelText('Durasi setiap tanggal'),{target:{value:'full'}})
 const key=leaveKeys.context(employeeA,'current'),updatedAt=client.getQueryState(key)!.dataUpdatedAt
 let signal!:AbortSignal,finishOld!:(value:unknown)=>void
 if(offline)onlineManager.setOnline(false)
 mocks.rpc.mockImplementation((name:string)=>({abortSignal:(s:AbortSignal)=>name==='leave_context_v1'?(signal=s,new Promise(resolve=>finishOld=resolve)):Promise.resolve({data:quoteFixture,error:null})}))
 fireEvent.click(screen.getByRole('button',{name:'Hitung pratinjau'}));await waitFor(()=>expect(signal).toBeDefined());await waitFor(()=>expect(screen.queryByLabelText('Alasan pribadi')).toBeNull());expect(unloadGuarded()).toBe(true)
 await act(async()=>client.cancelQueries({queryKey:key,exact:true}));expect(signal.aborted).toBe(true);expect(client.getQueryState(key)!.dataUpdatedAt).toBe(updatedAt)
 expect(screen.queryByLabelText('Alasan pribadi')).toBeNull();expect(screen.queryByText('81j 30m')).toBeNull();expect(screen.queryByRole('region',{name:'Pratinjau cuti'})).toBeNull();expect(unloadGuarded()).toBe(true);expect(mocks.rpc.mock.calls.filter(([name])=>name==='leave_quote_v1')).toHaveLength(0)
 onlineManager.setOnline(true);serve();fireEvent.click(await screen.findByRole('button',{name:'Coba lagi'}));expect(await screen.findByDisplayValue(quoteInput.reason)).toBeTruthy();expect(screen.getByText('81j 30m')).toBeTruthy();expect(unloadGuarded()).toBe(true)
 await act(async()=>finishOld({data:context,error:null}));expect(mocks.rpc.mock.calls.filter(([name])=>name==='leave_quote_v1')).toHaveLength(0)
 fireEvent.click(screen.getByRole('button',{name:'Hitung pratinjau'}));expect(await screen.findByRole('region',{name:'Pratinjau cuti'})).toBeTruthy()
})
test('cancelled cached history reopening stays hidden until subsequent successful fresh authority and history retry',async()=>{
 const history={balance:context.balances[0],rows:[{id:employeeB,sequence:3,date:'2026-10-02',kind:'adjustment',allowanceDelta:-60,reservedDelta:0,usedDelta:0}],nextBefore:null}
 const serveHistory=()=>mocks.rpc.mockImplementation((name:string)=>({abortSignal:()=>Promise.resolve({data:name==='leave_context_v1'?context:history,error:null})}))
 serveHistory();const {client}=mount();fireEvent.click(await screen.findByRole('button',{name:'Riwayat saldo'}));expect(await screen.findByText('−1j')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Tutup riwayat saldo'}))
 const key=leaveKeys.context(employeeA,'current'),updatedAt=client.getQueryState(key)!.dataUpdatedAt;let signal!:AbortSignal
 mocks.rpc.mockImplementation((name:string)=>({abortSignal:(s:AbortSignal)=>name==='leave_context_v1'?(signal=s,new Promise(()=>{})):Promise.resolve({data:history,error:null})}))
 fireEvent.click(screen.getByRole('button',{name:'Riwayat saldo'}));await waitFor(()=>expect(signal).toBeDefined());expect(screen.queryByText('−1j')).toBeNull()
 await act(async()=>client.cancelQueries({queryKey:key,exact:true}));expect(signal.aborted).toBe(true);expect(client.getQueryState(key)!.dataUpdatedAt).toBe(updatedAt);expect(screen.queryByText('−1j')).toBeNull();expect(screen.queryByText('81j 30m')).toBeNull();expect(mocks.rpc.mock.calls.filter(([name])=>name==='leave_balance_history_v1')).toHaveLength(1)
 serveHistory();fireEvent.click(await screen.findByRole('button',{name:'Coba lagi'}));await screen.findByText('81j 30m');expect(screen.queryByText('−1j')).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}));expect(await screen.findByText('−1j')).toBeTruthy()
})
test('explicit account preparation still reaches validated shared context after its verified readback',async()=>{
 let prepared=false
 mocks.rpc.mockImplementation((name:string)=>({abortSignal:()=>{
  if(name==='leave_prepare_self_v1'){prepared=true;return Promise.resolve({data:{accountId:employeeA,year:2026,version:4},error:null})}
  return Promise.resolve({data:prepared?context:{...context,balances:[]},error:null})
 }}))
 mount();fireEvent.click(await screen.findByRole('button',{name:'Siapkan jatah tahun ini'}));expect(await screen.findByText('81j 30m')).toBeTruthy();expect(screen.queryByRole('alert')).toBeNull();expect(mocks.rpc.mock.calls.filter(([name])=>name==='leave_prepare_self_v1')).toHaveLength(1)
})
