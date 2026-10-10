import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, QueryObserver, onlineManager } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import * as keys from '../../src/lib/leave/readQueryKeys'
import * as hooks from '../../src/lib/leave/useLeaveReads'
import { runLeaveInteraction } from '../../src/lib/leave/useLeaveContext'
import { leaveKeys, synchronizeLeaveScope } from '../../src/lib/leave/queryKeys'
import type { LeaveContext } from '../../src/lib/leave/contracts'
const mocks=vi.hoisted(()=>({rpc:vi.fn(),auth:{user:{id:'71000000-0000-0000-0000-000000000003'},profile:{id:'71000000-0000-0000-0000-000000000003',is_active:true},loading:false}}))
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
vi.mock('../../src/lib/AuthContext',()=>({useAuth:()=>mocks.auth}))
const actor='71000000-0000-0000-0000-000000000003',other='71000000-0000-0000-0000-000000000004'
const context:LeaveContext={scopeVersion:'one',memberKind:'manager',timezone:'Etc/UTC',balances:[],setup:{ready:false,blockers:[]},capabilities:{request:true,approve:true,configure:false,adjust:false,readPrivate:false,manageAccess:false}}
const clients:QueryClient[]=[]
function client(){const q=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(q);return q}
function Probe({scope='one',filter='all',enabled=true}:{scope?:string;filter?:'all'|'submitted'|'cancellation_pending';enabled?:boolean}){
 const query=hooks.useLeaveApprovalCounts(mocks.auth.user.id,{...context,scopeVersion:scope},filter,enabled)
 return <output>{query.available&&query.data?String(hooks.approvalCountForFilter(query.data,filter)):'unavailable'}</output>
}
function mount(q:QueryClient,child:React.ReactNode=<Probe/>){return render(<QueryClientProvider client={q}>{child}</QueryClientProvider>)}
beforeEach(()=>{mocks.rpc.mockReset();mocks.auth.user={id:actor};mocks.auth.profile={id:actor,is_active:true};mocks.rpc.mockImplementation((name:string)=>({abortSignal:()=>Promise.resolve({data:name==='leave_context_v1'?context:{pendingLeave:31,pendingCancellation:2},error:null})}))})
afterEach(()=>{cleanup();clients.splice(0).forEach(q=>q.clear());vi.useRealTimers();onlineManager.setOnline(true)})
test('private keys distinguish backend, actor, scope, range, audience and status filter',()=>{
 expect(keys.createLeaveReadKeys).toBeTypeOf('function')
 const a=keys.createLeaveReadKeys('a'),b=keys.createLeaveReadKeys('b'),range={from:'2026-10-01',to:'2026-10-31'}
 expect(a.counts(actor,'one','all')).not.toEqual(b.counts(actor,'one','all'))
 expect(a.counts(actor,'one','all')).not.toEqual(a.counts(other,'one','all'))
 expect(a.counts(actor,'one','all')).not.toEqual(a.counts(actor,'two','all'))
 expect(a.counts(actor,'one','all')).not.toEqual(a.counts(actor,'one','submitted'))
 expect(a.calendar(actor,'one',range,'own')).not.toEqual(a.calendar(actor,'one',range,'assigned_team'))
 expect(a.calendar(actor,'one',range,'own')).not.toEqual(a.calendar(actor,'one',{...range,to:'2026-10-30'},'own'))
 expect(a.counts(actor,'one','all')[3]).toBe('private')
})
test('counts refresh authority first and status selection uses full counts',async()=>{
 expect(hooks.useLeaveApprovalCounts).toBeTypeOf('function')
 const q=client(),view=mount(q);expect(await screen.findByText('33')).toBeTruthy()
 expect(mocks.rpc.mock.calls[0][0]).toBe('leave_context_v1')
 view.rerender(<QueryClientProvider client={q}><Probe filter="submitted"/></QueryClientProvider>);expect(await screen.findByText('31')).toBeTruthy()
 view.rerender(<QueryClientProvider client={q}><Probe filter="cancellation_pending"/></QueryClientProvider>);expect(await screen.findByText('2')).toBeTruthy()
})
test('network failure hides retained successful count rather than showing zero',async()=>{
 expect(hooks.useLeaveApprovalCounts).toBeTypeOf('function')
 const q=client();mount(q);await screen.findByText('33')
 mocks.rpc.mockImplementation((name:string)=>({abortSignal:()=>Promise.resolve({data:name==='leave_context_v1'?context:null,error:name==='leave_context_v1'?null:{message:'private'}})}))
 act(()=>window.dispatchEvent(new Event('focus')));await screen.findByText('unavailable');await waitFor(()=>expect(q.getQueryState(keys.leaveReadKeys.counts(actor,'one','all'))?.status).toBe('error'))
 expect(screen.queryByText('0')).toBeNull();expect(screen.queryByText('33')).toBeNull();expect(screen.queryByText('private')).toBeNull()
})
test('server zero is available; inactive or disabled observers issue no reads',async()=>{
 expect(hooks.useLeaveApprovalCounts).toBeTypeOf('function')
 mocks.rpc.mockImplementation((name:string)=>({abortSignal:()=>Promise.resolve({data:name==='leave_context_v1'?context:{pendingLeave:0,pendingCancellation:0},error:null})}))
 const q=client(),view=mount(q);await screen.findByText('0')
 mocks.auth.profile.is_active=false;view.rerender(<QueryClientProvider client={q}><Probe/></QueryClientProvider>);expect(screen.getByText('unavailable')).toBeTruthy()
 mocks.rpc.mockClear();act(()=>window.dispatchEvent(new Event('focus')));expect(mocks.rpc).not.toHaveBeenCalled()
 view.unmount();mocks.auth.profile.is_active=true;mount(q,<Probe enabled={false}/>);expect(mocks.rpc).not.toHaveBeenCalled()
})
test('changing identity aborts old read and ignores a late response',async()=>{
 expect(hooks.useLeaveApprovalCounts).toBeTypeOf('function')
 let finish!:(value:unknown)=>void,signal!:AbortSignal
 mocks.rpc.mockImplementation((name:string)=>({abortSignal:(s:AbortSignal)=>name==='leave_context_v1'?Promise.resolve({data:context,error:null}):(signal=s,new Promise(resolve=>finish=resolve))}))
 const q=client(),view=mount(q);await waitFor(()=>expect(finish).toBeTypeOf('function'))
 mocks.rpc.mockImplementation((name:string)=>({abortSignal:()=>Promise.resolve({data:name==='leave_context_v1'?context:{pendingLeave:1,pendingCancellation:0},error:null})}))
 mocks.auth.user={id:other};mocks.auth.profile={id:other,is_active:true}
 view.rerender(<QueryClientProvider client={q}><Probe/></QueryClientProvider>);expect(await screen.findByText('1')).toBeTruthy();expect(signal.aborted).toBe(true)
 await act(async()=>finish({data:{pendingLeave:99,pendingCancellation:99},error:null}));expect(screen.queryByText('198')).toBeNull();expect(q.getQueryData(keys.leaveReadKeys.counts(actor,'one','all'))).toBeUndefined()
})
test('fresh authority rejects reassigned scope before count transport',async()=>{
 expect(hooks.useLeaveApprovalCounts).toBeTypeOf('function')
 mocks.rpc.mockImplementation(()=>({abortSignal:()=>Promise.resolve({data:{...context,scopeVersion:'two'},error:null})}))
 mount(client());await waitFor(()=>expect(mocks.rpc).toHaveBeenCalled());expect(screen.getByText('unavailable')).toBeTruthy();expect(mocks.rpc.mock.calls.some(([name])=>name==='leave_approval_counts_v1')).toBe(false)
})
test('polling waits sixty seconds, stops while hidden and revalidates upon visibility',async()=>{
 expect(hooks.useLeaveApprovalCounts).toBeTypeOf('function')
 vi.useFakeTimers();const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('visible')
 mount(client());await act(async()=>{await vi.advanceTimersByTimeAsync(1)})
 const initial=mocks.rpc.mock.calls.length;await act(async()=>{await vi.advanceTimersByTimeAsync(59_000)});expect(mocks.rpc).toHaveBeenCalledTimes(initial)
 await act(async()=>{await vi.advanceTimersByTimeAsync(1_000)});expect(mocks.rpc.mock.calls.length).toBeGreaterThan(initial)
 visibility.mockReturnValue('hidden');act(()=>document.dispatchEvent(new Event('visibilitychange')));const hidden=mocks.rpc.mock.calls.length
 await act(async()=>{await vi.advanceTimersByTimeAsync(120_000)});expect(mocks.rpc).toHaveBeenCalledTimes(hidden)
 visibility.mockReturnValue('visible');await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(1)});expect(mocks.rpc.mock.calls.length).toBeGreaterThan(hidden)
})
test('second same-identity observer does not purge another current count observer',async()=>{
 expect(hooks.useLeaveApprovalCounts).toBeTypeOf('function')
 const q=client(),view=mount(q);await screen.findByText('33');const key=keys.leaveReadKeys.counts(actor,'one','all'),original=q.getQueryCache().find({queryKey:key,exact:true})
 view.rerender(<QueryClientProvider client={q}><Probe/><Probe/></QueryClientProvider>);await screen.findAllByText('33')
 expect(q.getQueryCache().find({queryKey:key,exact:true})).toBe(original)
})
test('confirmed transition invalidation refreshes counts and calendar without unrelated reads',async()=>{
 expect(keys.invalidateLeaveReads).toBeTypeOf('function')
 const q=client();mount(q);await screen.findByText('33')
 const calendarKey=keys.leaveReadKeys.calendar(actor,'one',{from:'2026-10-01',to:'2026-10-31'},'own'),unrelated=leaveKeys.private(actor,'one','balance-history')
 q.setQueryData(calendarKey,[]);q.setQueryData(unrelated,['keep']);mocks.rpc.mockImplementation((name:string)=>({abortSignal:()=>Promise.resolve({data:name==='leave_context_v1'?context:{pendingLeave:30,pendingCancellation:2},error:null})}))
 await act(async()=>{await keys.invalidateLeaveReads(q,actor)});expect(await screen.findByText('32')).toBeTruthy();expect(q.getQueryState(calendarKey)?.isInvalidated).toBe(true);expect(q.getQueryData(unrelated)).toEqual(['keep'])
})
test('scope synchronization cancels reads that ignore transport abort',async()=>{
 expect(keys.createLeaveReadKeys).toBeTypeOf('function')
 const q=client(),key=keys.leaveReadKeys.counts(actor,'one','all');let finish!:(value:unknown)=>void
 const observer=new QueryObserver(q,{queryKey:key,queryFn:()=>new Promise(resolve=>finish=resolve)});const off=observer.subscribe(()=>{})
 synchronizeLeaveScope(q,actor,'two');finish({pendingLeave:99,pendingCancellation:99});await Promise.resolve();expect(q.getQueryData(key)).toBeUndefined();off()
})
test('manual refetch cannot bypass an explicitly disabled read gate',async()=>{
 function Disabled(){const query=hooks.useLeaveApprovalCounts(actor,context,'all',false);return <button onClick={()=>void query.refetch()}>Refetch disabled</button>}
 mount(client(),<Disabled/>);const {fireEvent}=await import('@testing-library/react');fireEvent.click(screen.getByText('Refetch disabled'))
 await act(async()=>{await Promise.resolve()});expect(mocks.rpc).not.toHaveBeenCalled()
})
test('calendar range change aborts obsolete response before cache publication',async()=>{
 const first={from:'2026-10-01',to:'2026-10-31'},second={from:'2026-11-01',to:'2026-11-30'}
 let finish!:(value:unknown)=>void,signal!:AbortSignal
 const row=(date:string)=>({employeeId:actor,employeeName:'Fictional manager',date,approvedMinutes:60,availabilityLabel:'partial_absence'})
 mocks.rpc.mockImplementation((name:string,args?:Record<string,string>)=>({abortSignal:(s:AbortSignal)=>name==='leave_context_v1'?Promise.resolve({data:context,error:null}):args!.p_from===first.from?(signal=s,new Promise(resolve=>finish=resolve)):Promise.resolve({data:[row(second.from)],error:null})}))
 function CalendarProbe({range}:{range:{from:string;to:string}}){const query=hooks.useLeaveCalendar(actor,context,range,'own');return <output>{query.available?query.data?.[0]?.date:'unavailable'}</output>}
 const q=client(),view=mount(q,<CalendarProbe range={first}/>);await waitFor(()=>expect(finish).toBeTypeOf('function'))
 view.rerender(<QueryClientProvider client={q}><CalendarProbe range={second}/></QueryClientProvider>);expect(await screen.findByText(second.from)).toBeTruthy();expect(signal.aborted).toBe(true)
 await act(async()=>finish({data:[row(first.from)],error:null}));expect(screen.queryByText(first.from)).toBeNull();expect(q.getQueryData(keys.leaveReadKeys.calendar(actor,'one',first,'own'))).toBeUndefined()
})

test.each(['counts','calendar','access'] as const)('canceling %s during refreshed authority never restores a cached success as available',async kind=>{
 const range={from:'2026-10-01',to:'2026-10-31'}
 const key=kind==='counts'?keys.leaveReadKeys.counts(actor,'one','submitted'):kind==='calendar'?keys.leaveReadKeys.calendar(actor,'one',range,'own'):keys.leaveReadKeys.access(actor,'one')
 const data=kind==='counts'?{pendingLeave:31,pendingCancellation:0}:kind==='calendar'?[{employeeId:actor,employeeName:'Fictional manager',date:range.from,approvedMinutes:60,availabilityLabel:'partial_absence'}]:{scopeVersion:'one',calendarAudiences:['own'],defaultRange:range,defaultRangeState:'ready'}
 let held=false,finish!:(value:unknown)=>void
 mocks.rpc.mockImplementation((name:string)=>({abortSignal:()=>name==='leave_context_v1'&&held?new Promise(resolve=>finish=resolve):Promise.resolve({data:name==='leave_context_v1'?context:data,error:null})}))
 function CanceledRead(){
  const query=kind==='counts'?hooks.useLeaveApprovalCounts(actor,context,'submitted'):kind==='calendar'?hooks.useLeaveCalendar(actor,context,range,'own'):hooks.useLeaveReadAccess(actor,context)
  return <><output>{query.available&&query.data?'ready':'unavailable'}</output><button onClick={()=>void query.refetch()}>Refresh read</button></>
 }
 const q=client();mount(q,<CanceledRead/>);await screen.findByText('ready');held=true
 const {fireEvent}=await import('@testing-library/react');fireEvent.click(screen.getByText('Refresh read'));await waitFor(()=>expect(finish).toBeTypeOf('function'));await screen.findByText('unavailable')
 await act(async()=>{await q.cancelQueries({queryKey:key,exact:true});await new Promise(resolve=>setTimeout(resolve,20))})
 expect(q.getQueryState(key)?.status).toBe('success');expect(q.getQueryData(key)).toEqual(data)
 expect(screen.queryByText('ready')).toBeNull();expect(screen.getByText('unavailable')).toBeTruthy()
 held=false;await act(async()=>{finish({data:context,error:null});await new Promise(resolve=>setTimeout(resolve,20))})
 expect(screen.queryByText('ready')).toBeNull()
 fireEvent.click(screen.getByText('Refresh read'));expect(await screen.findByText('ready')).toBeTruthy()
})

test('canceling current authority hides a previously completed read until genuine authority and read recovery',async()=>{
 let held=false,finish!:(value:unknown)=>void
 mocks.rpc.mockImplementation((name:string)=>({abortSignal:()=>name==='leave_context_v1'&&held?new Promise(resolve=>finish=resolve):Promise.resolve({data:name==='leave_context_v1'?context:{pendingLeave:31,pendingCancellation:0},error:null})}))
 function AuthorityProbe(){const query=hooks.useLeaveApprovalCounts(actor,context,'submitted');return <><output>{query.available&&query.data?String(query.data.pendingLeave):'unavailable'}</output><button onClick={()=>void query.refetch()}>Refresh count</button></>}
 const q=client();mount(q,<AuthorityProbe/>);await screen.findByText('31');held=true;const action=vi.fn()
 const pending=runLeaveInteraction(q,actor,'one',action).catch(()=>undefined);await waitFor(()=>expect(finish).toBeTypeOf('function'));await screen.findByText('unavailable')
 await act(async()=>{await q.cancelQueries({queryKey:leaveKeys.context(actor,'current'),exact:true});await new Promise(resolve=>setTimeout(resolve,20))})
 expect(q.getQueryState(leaveKeys.context(actor,'current'))?.status).toBe('success')
 expect(q.getQueryState(keys.leaveReadKeys.counts(actor,'one','submitted'))?.status).toBe('success')
 expect(screen.queryByText('31')).toBeNull();expect(action).not.toHaveBeenCalled()
 held=false;await act(async()=>{finish({data:context,error:null});await pending;await new Promise(resolve=>setTimeout(resolve,20))});expect(screen.queryByText('31')).toBeNull()
 const {fireEvent}=await import('@testing-library/react');fireEvent.click(screen.getByText('Refresh count'));expect(await screen.findByText('31')).toBeTruthy()
})
test('an offline paused attempt canceled before queryFn starts cannot restore completed display proof',async()=>{
 function OfflineProbe(){const query=hooks.useLeaveApprovalCounts(actor,context,'submitted');return <><output>{query.available&&query.data?String(query.data.pendingLeave):'unavailable'}</output><button onClick={()=>void query.refetch()}>Refresh online</button></>}
 const q=client(),key=keys.leaveReadKeys.counts(actor,'one','submitted');mount(q,<OfflineProbe/>);await screen.findByText('31')
 const original=q.getQueryCache().find({queryKey:key,exact:true})!,calls=mocks.rpc.mock.calls.length
 onlineManager.setOnline(false)
 // Exercise TanStack's real pre-queryFn pause/revert path with the actual owned query function.
 const pending=q.fetchQuery({queryKey:key,queryFn:original.options.queryFn,networkMode:'online',staleTime:0}).catch(()=>undefined)
 await waitFor(()=>expect(q.getQueryState(key)?.fetchStatus).toBe('paused'));await screen.findByText('unavailable');expect(mocks.rpc).toHaveBeenCalledTimes(calls)
 await act(async()=>{await q.cancelQueries({queryKey:key,exact:true});await pending;await new Promise(resolve=>setTimeout(resolve,20))})
 expect(q.getQueryState(key)?.status).toBe('success');expect(screen.queryByText('31')).toBeNull()
 onlineManager.setOnline(true);const {fireEvent}=await import('@testing-library/react');fireEvent.click(screen.getByText('Refresh online'));expect(await screen.findByText('31')).toBeTruthy()
})
test('shared current observers survive another observer unmounting during pending authority',async()=>{
 let held=false,finish!:(value:unknown)=>void,authoritySignal!:AbortSignal
 mocks.rpc.mockImplementation((name:string)=>({abortSignal:(signal:AbortSignal)=>name==='leave_context_v1'&&held?(authoritySignal=signal,new Promise(resolve=>finish=resolve)):Promise.resolve({data:name==='leave_context_v1'?context:{pendingLeave:31,pendingCancellation:0},error:null})}))
 const q=client(),view=mount(q,<><Probe key="first" filter="submitted"/><Probe key="second" filter="submitted"/></>);await screen.findAllByText('31')
 const key=keys.leaveReadKeys.counts(actor,'one','submitted'),original=q.getQueryCache().find({queryKey:key,exact:true});held=true
 act(()=>window.dispatchEvent(new Event('focus')));await waitFor(()=>expect(finish).toBeTypeOf('function'));await screen.findAllByText('unavailable')
 view.rerender(<QueryClientProvider client={q}><Probe key="second" filter="submitted"/></QueryClientProvider>)
 expect(q.getQueryCache().find({queryKey:key,exact:true})).toBe(original);expect(authoritySignal.aborted).toBe(false)
 held=false;await act(async()=>finish({data:context,error:null}));expect(await screen.findByText('31')).toBeTruthy()
})
test('joining and removing a disabled same-key observer does not revoke the active observer proof',async()=>{
 const q=client(),view=mount(q,<Probe key="first" filter="submitted"/>);await screen.findByText('31');const before=mocks.rpc.mock.calls.length
 view.rerender(<QueryClientProvider client={q}><Probe key="first" filter="submitted"/><Probe key="disabled" filter="submitted" enabled={false}/></QueryClientProvider>)
 expect(screen.getByText('31')).toBeTruthy();expect(screen.getByText('unavailable')).toBeTruthy();expect(mocks.rpc).toHaveBeenCalledTimes(before)
 view.rerender(<QueryClientProvider client={q}><Probe key="first" filter="submitted"/></QueryClientProvider>);expect(screen.getByText('31')).toBeTruthy();expect(mocks.rpc).toHaveBeenCalledTimes(before)
})
test('manually restored cache data cannot supply read completion proof',async()=>{
 const q=client();mount(q,<Probe filter="submitted"/>);await screen.findByText('31')
 const key=keys.leaveReadKeys.counts(actor,'one','submitted'),data=q.getQueryData(key)
 await act(async()=>{q.setQueryData(key,data);await new Promise(resolve=>setTimeout(resolve,20))});expect(screen.queryByText('31')).toBeNull()
 await act(async()=>{await keys.invalidateLeaveReads(q,actor)});expect(await screen.findByText('31')).toBeTruthy()
})
