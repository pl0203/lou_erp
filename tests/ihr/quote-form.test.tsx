import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { transferableAbortController } from 'node:util'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { LeaveContext } from '../../src/lib/leave/contracts'
import { employeeA, employeeB } from './fixtures'
import { changedQuoteScope, quoteFixture, quoteInput, quoteScope } from './quote-fixture'
const mocks=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
vi.mock('../../src/lib/AuthContext',()=>({useAuth:()=>({user:{id:'71000000-0000-0000-0000-000000000001'}})}))
import MyLeave from '../../src/pages/ihr/leave/MyLeave'
import LeaveTabs from '../../src/pages/ihr/leave/LeaveTabs'
const context:LeaveContext={scopeVersion:quoteScope,memberKind:'employee',capabilities:{request:true,approve:true,configure:false,adjust:false,readPrivate:false,manageAccess:false},currentPeriod:{year:2026,startDate:'2026-01-01',endDate:'2027-01-01'},timezone:'Etc/UTC',setup:{ready:false,blockers:[]},balances:[{accountId:employeeA,year:2026,allowanceMinutes:5400,approvedMinutes:450,pendingMinutes:60,availableMinutes:4890,expiredMinutes:0,version:4,reconciled:true}]}
const clients:QueryClient[]=[]
function client(){const c=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(c);return c}
function panel(c:QueryClient,ctx=context,actor=employeeA){return <QueryClientProvider client={c}><MyLeave actorId={actor} context={ctx}/></QueryClientProvider>}
function reply(data:unknown,error:unknown=null){return {data,error}}
function quotes(){return mocks.rpc.mock.calls.filter(([name])=>name==='leave_quote_v1')}
async function open(){fireEvent.click(screen.getByRole('button',{name:'Buat pratinjau cuti'}));await screen.findByLabelText('Tanggal mulai')}
function fill(){for(const [label,value] of [['Tanggal mulai',quoteInput.startDate],['Tanggal selesai',quoteInput.endDate],['Alasan pribadi',quoteInput.reason]])fireEvent.change(screen.getByLabelText(label),{target:{value}})}
async function preview(){fireEvent.click(screen.getByRole('button',{name:'Hitung pratinjau'}));await screen.findByRole('region',{name:'Pratinjau cuti'})}
beforeEach(()=>{vi.stubGlobal('AbortController',class{constructor(){return transferableAbortController()}});mocks.rpc.mockImplementation((name:string)=>({abortSignal:()=>Promise.resolve(reply(name==='leave_context_v1'?context:quoteFixture))}));vi.spyOn(window,'confirm').mockReturnValue(false)})
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());mocks.rpc.mockReset();vi.restoreAllMocks();vi.unstubAllGlobals()})
test('single duration form focuses the date and shows authoritative 675-minute preview without submission',async()=>{
 render(panel(client()));await open();expect(document.activeElement).toBe(screen.getByLabelText('Tanggal mulai'))
 expect(screen.getAllByLabelText('Durasi setiap tanggal')).toHaveLength(1)
 expect(within(screen.getByLabelText('Durasi setiap tanggal')).getAllByRole('option')).toHaveLength(8)
 fill();await preview();const result=screen.getByRole('region',{name:'Pratinjau cuti'})
 expect(within(result).getByText('11j 15m')).toBeTruthy();expect(within(result).getByText('Fictional Manager')).toBeTruthy();expect(within(result).getByText('Fictional Amber')).toBeTruthy()
 expect(within(result).getByText('70j 15m')).toBeTruthy();expect(screen.queryByRole('button',{name:/Ajukan|Kirim/})).toBeNull()
 expect(quotes()[0][1]).toEqual({p_input:{start_date:quoteInput.startDate,end_date:quoteInput.endDate,duration:{mode:'full_scheduled_day'},reason:quoteInput.reason}})
})
test('read failure preserves private draft, focuses safe error and never stores it in query cache or browser storage',async()=>{
 const c=client(),storage=vi.spyOn(Storage.prototype,'setItem');render(panel(c));await open();fill()
 mocks.rpc.mockImplementation((name:string)=>({abortSignal:()=>Promise.resolve(name==='leave_context_v1'?reply(context):reply(null,{code:'22023',message:quoteInput.reason}))}))
 fireEvent.click(screen.getByRole('button',{name:'Hitung pratinjau'}));const alert=await screen.findByRole('alert')
 expect(document.activeElement).toBe(alert);expect((screen.getByLabelText('Alasan pribadi') as HTMLTextAreaElement).value).toBe(quoteInput.reason)
 expect(alert.textContent).not.toContain(quoteInput.reason);expect(storage).not.toHaveBeenCalled();expect(JSON.stringify(c.getQueryCache().getAll().map(q=>q.state.data))).not.toContain(quoteInput.reason)
 mocks.rpc.mockImplementation((name:string)=>({abortSignal:()=>Promise.resolve(reply(name==='leave_context_v1'?context:quoteFixture))}));await preview()
})
test('repeat clicks coalesce; editing aborts and discards a late quote while preserving new input',async()=>{
 let finish!:(v:unknown)=>void;let signal!:AbortSignal
 mocks.rpc.mockImplementation((name:string)=>({abortSignal:(s:AbortSignal)=>name==='leave_context_v1'?Promise.resolve(reply(context)):(signal=s,new Promise(r=>finish=r))}))
 render(panel(client()));await open();fill();const button=screen.getByRole('button',{name:'Hitung pratinjau'});fireEvent.click(button);fireEvent.click(button)
 await waitFor(()=>expect(quotes()).toHaveLength(1));fireEvent.change(screen.getByLabelText('Alasan pribadi'),{target:{value:'Changed draft'}});expect(signal.aborted).toBe(true)
 await act(async()=>finish(reply(quoteFixture)));expect(screen.queryByRole('region',{name:'Pratinjau cuti'})).toBeNull();expect(screen.getByDisplayValue('Changed draft')).toBeTruthy()
})
test('every duration change invalidates preview and sends one supported exact preset',async()=>{
 render(panel(client()));await open();fill();await preview()
 for(const minutes of [60,120,180,225,240,300,360]){
  fireEvent.change(screen.getByLabelText('Durasi setiap tanggal'),{target:{value:String(minutes)}});expect(screen.queryByRole('region',{name:'Pratinjau cuti'})).toBeNull()
  mocks.rpc.mockImplementation((name:string)=>({abortSignal:()=>Promise.resolve(name==='leave_context_v1'?reply(context):reply(null,{code:'22023'}))}))
  fireEvent.click(screen.getByRole('button',{name:'Hitung pratinjau'}));await screen.findByRole('alert');expect(quotes().at(-1)?.[1].p_input.duration).toEqual({mode:'fixed_minutes',minutes})
 }
})
test('close cancellation preserves draft and focus; confirmed close discards it and restores opener',async()=>{
 render(panel(client()));await open();fill();const reason=screen.getByLabelText('Alasan pribadi');reason.focus()
 fireEvent.click(screen.getByRole('button',{name:'Tutup formulir'}));expect(window.confirm).toHaveBeenCalledTimes(1);expect(screen.getByDisplayValue(quoteInput.reason)).toBeTruthy();expect(document.activeElement).toBe(reason)
 vi.mocked(window.confirm).mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'Tutup formulir'}));expect(screen.queryByLabelText('Alasan pribadi')).toBeNull();await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('button',{name:'Buat pratinjau cuti'})))
 await open();expect((screen.getByLabelText('Alasan pribadi') as HTMLTextAreaElement).value).toBe('');expect(screen.queryByRole('region',{name:'Pratinjau cuti'})).toBeNull()
})
test('reload is guarded only while draft is dirty and listener is removed on close',async()=>{
 render(panel(client()));await open();let e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);expect(e.defaultPrevented).toBe(false)
 fill();e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);expect(e.defaultPrevented).toBe(true)
 vi.mocked(window.confirm).mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'Tutup formulir'}));e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);expect(e.defaultPrevented).toBe(false)
})
test('tab navigation asks before discarding and returning starts a fresh form',async()=>{
 render(<QueryClientProvider client={client()}><LeaveTabs context={context}/></QueryClientProvider>);await open();fill()
 fireEvent.click(screen.getByRole('tab',{name:'Persetujuan'}));expect(screen.getByDisplayValue(quoteInput.reason)).toBeTruthy()
 vi.mocked(window.confirm).mockReturnValue(true);fireEvent.click(screen.getByRole('tab',{name:'Persetujuan'}));expect(screen.queryByLabelText('Alasan pribadi')).toBeNull()
 fireEvent.click(screen.getByRole('tab',{name:'Cuti Saya'}));await open();expect((screen.getByLabelText('Alasan pribadi') as HTMLTextAreaElement).value).toBe('')
})
test('router push, Back and Forward remain blocked until discard is confirmed',async()=>{
 function Scene(){const navigate=useNavigate();return <><button onClick={()=>navigate('/other')}>Navigate away</button><button onClick={()=>navigate(-1)}>Back</button><button onClick={()=>navigate(1)}>Forward</button><MyLeave actorId={employeeA} context={context}/></>}
 const c=client(),router=createMemoryRouter([{path:'/leave',element:<Scene/>},{path:'*',element:<p>Other page</p>}],{initialEntries:['/earlier','/leave','/later'],initialIndex:1})
 render(<QueryClientProvider client={c}><RouterProvider router={router}/></QueryClientProvider>);await open();fill()
 for(const label of ['Navigate away','Back','Forward']){fireEvent.click(screen.getByRole('button',{name:label}));await waitFor(()=>expect(router.state.blockers.size).toBe(1));expect(router.state.location.pathname).toBe('/leave');expect(screen.getByDisplayValue(quoteInput.reason)).toBeTruthy()}
 vi.mocked(window.confirm).mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'Forward'}));await screen.findByText('Other page');expect(router.state.location.pathname).toBe('/later');router.dispose()
})
test('opening waits for live authority, and a denied reopening cannot reveal previous draft or preview',async()=>{
 render(panel(client()));await open();fill();await preview();vi.mocked(window.confirm).mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'Tutup formulir'}))
 let finish!:(v:unknown)=>void;mocks.rpc.mockReturnValue({abortSignal:()=>new Promise(r=>finish=r)})
 fireEvent.click(screen.getByRole('button',{name:'Buat pratinjau cuti'}));await waitFor(()=>expect(finish).toBeDefined());expect(screen.queryByLabelText('Alasan pribadi')).toBeNull();expect(screen.queryByRole('region',{name:'Pratinjau cuti'})).toBeNull()
 await act(async()=>finish(reply(null,{code:'42501'})));expect(screen.queryByDisplayValue(quoteInput.reason)).toBeNull();expect(await screen.findByRole('alert')).toBeTruthy()
})
test('changed live scope before preview clears private input and never calls quote',async()=>{
 render(panel(client()));await open();fill();mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve(reply({...context,scopeVersion:changedQuoteScope}))})
 fireEvent.click(screen.getByRole('button',{name:'Hitung pratinjau'}));await screen.findByRole('alert');expect(quotes()).toHaveLength(0);expect(screen.queryByDisplayValue(quoteInput.reason)).toBeNull()
})
test('the same revision with a genuinely different actor digest still clears a successful quote and private draft',async()=>{
 mocks.rpc.mockImplementation((name:string)=>({abortSignal:()=>Promise.resolve(reply(name==='leave_context_v1'?context:{...quoteFixture,scopeVersion:changedQuoteScope}))}))
 render(panel(client()));await open();fill();fireEvent.click(screen.getByRole('button',{name:'Hitung pratinjau'}))
 expect((await screen.findByRole('alert')).textContent).toContain('Akses formulir berubah');expect(screen.queryByLabelText('Alasan pribadi')).toBeNull();expect(screen.queryByRole('region',{name:'Pratinjau cuti'})).toBeNull()
})
test('scope, identity and director transitions immediately discard private drafts and obsolete quote responses',async()=>{
 const c=client(),view=render(panel(c));await open();fill();await preview()
 view.rerender(panel(c,{...context,scopeVersion:'2'},employeeB));expect(screen.queryByDisplayValue(quoteInput.reason)).toBeNull();expect(screen.queryByRole('region',{name:'Pratinjau cuti'})).toBeNull()
 view.rerender(panel(c,{...context,memberKind:'director',capabilities:{...context.capabilities,request:false},balances:[]}));expect(screen.queryByRole('button',{name:'Buat pratinjau cuti'})).toBeNull()
})
test('account change and foreground authority refresh hide a previous quote until recalculated',async()=>{
 const c=client(),view=render(panel(c));await open();fill();await preview()
 view.rerender(panel(c,{...context,balances:[{...context.balances[0],version:5}]}));expect(screen.queryByRole('region',{name:'Pratinjau cuti'})).toBeNull();expect(screen.getByDisplayValue(quoteInput.reason)).toBeTruthy()
 await preview();fireEvent(window,new Event('focus'));expect(screen.queryByRole('region',{name:'Pratinjau cuti'})).toBeNull();await waitFor(()=>expect(mocks.rpc.mock.calls.filter(([name])=>name==='leave_context_v1').length).toBeGreaterThanOrEqual(4))
})
test('holiday and off-duty exclusions retain their distinct explanations and Saturday group',async()=>{
 const quote={...quoteFixture,endDate:'2026-10-04',totalMinutes:450,days:[quoteFixture.days[0],{...quoteFixture.days[1],scheduledMinutes:0,chargedMinutes:0,exclusion:'off_duty',year:null,accountId:null},{...quoteFixture.days[0],date:'2026-10-04',scheduledMinutes:0,chargedMinutes:0,exclusion:'holiday',year:null,accountId:null}],allocations:[{...quoteFixture.allocations[0],chargedMinutes:450,availableAfter:4440}]}
 mocks.rpc.mockImplementation((name:string)=>({abortSignal:()=>Promise.resolve(reply(name==='leave_context_v1'?context:quote))}))
 render(panel(client()));await open();fill();fireEvent.change(screen.getByLabelText('Tanggal selesai'),{target:{value:'2026-10-04'}});await preview()
 const result=screen.getByRole('region',{name:'Pratinjau cuti'})
 expect(within(result).getByText('Libur kalender')).toBeTruthy();expect(within(result).getByText('Tidak bertugas')).toBeTruthy();expect(within(result).getByText('Fictional Amber')).toBeTruthy()
 expect(within(result).getByText('74j')).toBeTruthy()
})
test('invalid or reversed dates preserve input without a quote RPC or misleading partial preview',async()=>{
 render(panel(client()));await open();fill();fireEvent.change(screen.getByLabelText('Tanggal selesai'),{target:{value:'2026-10-01'}})
 fireEvent.click(screen.getByRole('button',{name:'Hitung pratinjau'}));await screen.findByRole('alert');expect(quotes()).toHaveLength(0);expect(screen.getByDisplayValue(quoteInput.reason)).toBeTruthy()
 fireEvent.change(screen.getByLabelText('Tanggal mulai'),{target:{value:''}});fireEvent.click(screen.getByRole('button',{name:'Hitung pratinjau'}));await screen.findByRole('alert');expect(quotes()).toHaveLength(0);expect(screen.queryByRole('region',{name:'Pratinjau cuti'})).toBeNull()
})
test('closing or changing identity aborts an outstanding quote and cannot expose its late private response',async()=>{
 const c=client(),view=render(panel(c));let finish!:(v:unknown)=>void,signal!:AbortSignal
 mocks.rpc.mockImplementation((name:string)=>({abortSignal:(s:AbortSignal)=>name==='leave_context_v1'?Promise.resolve(reply(context)):(signal=s,new Promise(r=>finish=r))}))
 await open();fill();fireEvent.click(screen.getByRole('button',{name:'Hitung pratinjau'}));await waitFor(()=>expect(finish).toBeDefined())
 vi.mocked(window.confirm).mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'Tutup formulir'}));expect(signal.aborted).toBe(true)
 await act(async()=>finish(reply(quoteFixture)));expect(screen.queryByRole('region',{name:'Pratinjau cuti'})).toBeNull()
 await open();fill();fireEvent.click(screen.getByRole('button',{name:'Hitung pratinjau'}));await waitFor(()=>expect(quotes()).toHaveLength(2))
 view.rerender(panel(c,context,employeeB));expect(signal.aborted).toBe(true);await act(async()=>finish(reply(quoteFixture)));expect(screen.queryByDisplayValue(quoteInput.reason)).toBeNull();expect(screen.queryByRole('region',{name:'Pratinjau cuti'})).toBeNull()
})
test('foreground scope loss clears a private draft and preview, while an ordinary context failure keeps useful input',async()=>{
 render(panel(client()));await open();fill();await preview()
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.reject(new Error(quoteInput.reason))})
 fireEvent(window,new Event('focus'));await screen.findByRole('alert');expect(screen.queryByRole('region',{name:'Pratinjau cuti'})).toBeNull();expect(screen.getByDisplayValue(quoteInput.reason)).toBeTruthy();expect(screen.getByRole('alert').textContent).not.toContain(quoteInput.reason)
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve(reply({...context,scopeVersion:'2'}))});fireEvent(window,new Event('focus'));await waitFor(()=>expect(screen.queryByDisplayValue(quoteInput.reason)).toBeNull());expect(screen.queryByLabelText('Alasan pribadi')).toBeNull()
})
