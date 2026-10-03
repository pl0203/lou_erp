import { act,cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react'
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
import { leaveKeys } from '../../src/lib/leave/queryKeys'
const context:LeaveContext={scopeVersion:quoteScope,memberKind:'employee',capabilities:{request:true,approve:false,configure:false,adjust:false,readPrivate:false,manageAccess:false},currentPeriod:{year:2026,startDate:'2026-01-01',endDate:'2027-01-01'},timezone:'Etc/UTC',setup:{ready:true,blockers:[]},balances:[]}
const summary={id:employeeA,sequence:4,startDate:'2026-10-02',endDate:'2026-10-03',duration:{mode:'full_scheduled_day'},totalMinutes:675,status:'submitted',version:1,submittedAt:'2026-10-01T12:00:00+00:00',sourceKind:'submission'}
const older={...summary,id:employeeB,sequence:2,status:'approved',version:2,sourceKind:'opening'}
const detail={...summary,reason:'Private frozen reason',approverName:'Fictional Manager',days:[{date:'2026-10-02',scheduledMinutes:450,chargedMinutes:450,exclusion:null,groupName:null},{date:'2026-10-03',scheduledMinutes:225,chargedMinutes:225,exclusion:null,groupName:'Fictional Amber'}],allocations:[{year:2026,startDate:'2026-01-01',endDate:'2027-01-01',chargedMinutes:675}]}
const clients:QueryClient[]=[]
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);const panel=(actor=employeeA,scope=quoteScope,readState:'ready'|'pending'|'error'='ready')=><QueryClientProvider client={client}><MyLeave actorId={actor} context={{...context,scopeVersion:scope}} readState={readState}/></QueryClientProvider>;return {client,panel,view:render(panel())}}
function response(name:string,args:Record<string,unknown>){return name==='leave_context_v1'?context:name==='leave_own_request_v1'?detail:args.p_before===4?{rows:[older],nextBefore:null}:{rows:[summary],nextBefore:4}}
function serve(){mocks.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>({abortSignal:()=>Promise.resolve({data:response(name,args),error:null})}))}
async function history(){fireEvent.click(screen.getByRole('button',{name:'Riwayat pengajuan'}));await screen.findByRole('button',{name:'Lihat rincian 2026-10-02 sampai 2026-10-03'})}
async function details(){fireEvent.click(screen.getByRole('button',{name:'Lihat rincian 2026-10-02 sampai 2026-10-03'}));await screen.findByText(detail.reason)}
beforeEach(()=>{vi.stubGlobal('AbortController',class{constructor(){return transferableAbortController()}});serve()})
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());vi.unstubAllGlobals();vi.restoreAllMocks()})
test('own history pages by server cursor and own detail renders frozen reason/days/original periods',async()=>{
 mount();await history();expect(screen.queryByText(detail.reason)).toBeNull();await details();const region=screen.getByRole('region',{name:'Rincian pengajuan cuti'})
 expect(within(region).getByText('Fictional Amber')).toBeTruthy();expect(within(region).getByText('Fictional Manager')).toBeTruthy();expect(within(region).getByText(/2026-01-01/)).toBeTruthy()
 expect(mocks.rpc.mock.calls.find(([name])=>name==='leave_own_request_v1')?.[1]).toEqual({p_request_id:employeeA})
 fireEvent.click(screen.getByRole('button',{name:'Tutup rincian'}));fireEvent.click(screen.getByRole('button',{name:'Pengajuan lebih lama'}));await screen.findByText('Saldo awal');expect(mocks.rpc.mock.calls.filter(([name])=>name==='leave_own_history_v1').at(-1)?.[1]).toEqual({p_before:4,p_limit:25})
 expect((screen.getByRole('button',{name:'Pengajuan lebih lama'}) as HTMLButtonElement).disabled).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'Pengajuan lebih baru'}));await screen.findByText('Menunggu persetujuan')
})
test('cancelled cached reopening cannot reveal rows or run a history read before a genuinely completed authority retry',async()=>{
 const {client}=mount();await history();fireEvent.click(screen.getByRole('button',{name:'Tutup riwayat pengajuan'}));let signal!:AbortSignal
 mocks.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>({abortSignal:(s:AbortSignal)=>name==='leave_context_v1'?(signal=s,new Promise(()=>{})):Promise.resolve({data:response(name,args),error:null})}))
 fireEvent.click(screen.getByRole('button',{name:'Riwayat pengajuan'}));await waitFor(()=>expect(signal).toBeDefined());expect(screen.queryByText('Menunggu persetujuan')).toBeNull()
 await act(async()=>client.cancelQueries({queryKey:leaveKeys.context(employeeA,'current'),exact:true}));expect(signal.aborted).toBe(true);expect(screen.queryByText('Menunggu persetujuan')).toBeNull();expect(mocks.rpc.mock.calls.filter(([name])=>name==='leave_own_history_v1')).toHaveLength(1)
 serve();fireEvent.click(await screen.findByRole('button',{name:'Coba lagi riwayat pengajuan'}));expect(await screen.findByText('Menunggu persetujuan')).toBeTruthy()
})
test('closing detail aborts its read and a late reason cannot reappear',async()=>{
 mount();await history();let finish!:(value:unknown)=>void,signal!:AbortSignal
 mocks.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>({abortSignal:(s:AbortSignal)=>name==='leave_own_request_v1'?(signal=s,new Promise(resolve=>finish=resolve)):Promise.resolve({data:response(name,args),error:null})}))
 fireEvent.click(screen.getByRole('button',{name:'Lihat rincian 2026-10-02 sampai 2026-10-03'}));await waitFor(()=>expect(finish).toBeDefined());fireEvent.click(screen.getByRole('button',{name:'Tutup rincian'}));expect(signal.aborted).toBe(true)
 await act(async()=>finish({data:detail,error:null}));expect(screen.queryByText(detail.reason)).toBeNull()
})
test('shared interrupted reads hide detail and reject its late response before same-scope recovery',async()=>{
 const {panel,view}=mount();await history();let finish!:(value:unknown)=>void,signal!:AbortSignal
 mocks.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>({abortSignal:(s:AbortSignal)=>name==='leave_own_request_v1'?(signal=s,new Promise(resolve=>finish=resolve)):Promise.resolve({data:response(name,args),error:null})}))
 fireEvent.click(screen.getByRole('button',{name:'Lihat rincian 2026-10-02 sampai 2026-10-03'}));await waitFor(()=>expect(finish).toBeDefined());view.rerender(panel(employeeA,quoteScope,'error'));await waitFor(()=>expect(signal.aborted).toBe(true));await act(async()=>finish({data:detail,error:null}));expect(screen.queryByText(detail.reason)).toBeNull()
 serve();view.rerender(panel());expect(await screen.findByText(detail.reason)).toBeTruthy()
})
test('scope or identity change immediately removes own detail and another observer does not purge its current cache',async()=>{
 const {panel,view,client}=mount();await history();await details();const count=client.getQueryCache().getAll().length
 view.rerender(<>{panel()}<QueryClientProvider client={client}><MyLeave actorId={employeeA} context={context}/></QueryClientProvider></>);expect(screen.getByText(detail.reason)).toBeTruthy();expect(client.getQueryCache().getAll().length).toBeGreaterThanOrEqual(count)
 view.rerender(panel(employeeB,'changed'));expect(screen.queryByText(detail.reason)).toBeNull();expect(screen.queryByRole('region',{name:'Riwayat pengajuan cuti'})).toBeNull()
})
test('foreground authority revocation hides cached rows and safe errors exclude private diagnostics',async()=>{
 mount();await history();await details();mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:null,error:{code:'42501',message:detail.reason}})})
 fireEvent(window,new Event('focus'));await waitFor(()=>expect(screen.queryByText(detail.reason)).toBeNull());expect(screen.queryByText('Menunggu persetujuan')).toBeNull();expect(screen.getAllByRole('alert').map(n=>n.textContent).join()).not.toContain(detail.reason)
})

test('real shared page completes history/detail gates and hides frozen reason during cancelled foreground preflight',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client)
 render(<QueryClientProvider client={client}><LeaveManagement/></QueryClientProvider>)
 fireEvent.click(await screen.findByRole('button',{name:'Riwayat pengajuan'}));await screen.findByText('Menunggu persetujuan');await details()
 let signal!:AbortSignal;mocks.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>({abortSignal:(s:AbortSignal)=>name==='leave_context_v1'?(signal=s,new Promise(()=>{})):Promise.resolve({data:response(name,args),error:null})}))
 fireEvent(window,new Event('focus'));await waitFor(()=>expect(signal).toBeDefined());expect(screen.queryByText(detail.reason)).toBeNull()
 await act(async()=>client.cancelQueries({queryKey:leaveKeys.context(employeeA,'current'),exact:true}));expect(screen.queryByText(detail.reason)).toBeNull()
 serve();fireEvent.click(await screen.findByRole('button',{name:'Coba lagi'}));await screen.findByRole('button',{name:'Buat pratinjau cuti'})
 expect(screen.queryByText(detail.reason)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Coba lagi riwayat pengajuan'}));await screen.findByText('Menunggu persetujuan');fireEvent.click(screen.getByRole('button',{name:'Coba lagi rincian'}));expect(await screen.findByText(detail.reason)).toBeTruthy()
})
