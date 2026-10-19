import {StrictMode} from 'react'
import {act,cleanup,renderHook,waitFor,render,screen} from '@testing-library/react'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({fetch:vi.fn(),detail:vi.fn(),page:vi.fn(),audit:vi.fn(),candidates:vi.fn(),auth:{user:null,profile:null,loading:false} as any}))
vi.mock('../../src/lib/AuthContext',()=>({useAuth:()=>mocks.auth}))
vi.mock('../../src/lib/employees/rpc',()=>({fetchEmployeeContext:mocks.fetch,fetchEmployeeDetail:mocks.detail,fetchEmployeePage:mocks.page,fetchEmployeeAudit:mocks.audit,fetchEmployeeAccountCandidates:mocks.candidates,normalizeEmployeeError:(e:any)=>e instanceof Error&&'kind'in e?e:new Error('safe error')}))
import {EmployeeError} from '../../src/lib/employees/contracts'
import {useEmployeeContext,useEmployeeIdentityBoundary,getEmployeeAuthority,runEmployeeInteraction} from '../../src/lib/employees/useEmployeeContext'
import {useEmployeeCommand} from '../../src/lib/employees/useEmployeeCommand'
import {useEmployeeDetail,useEmployeePage,useEmployeeAudit,useEmployeeAccountCandidates} from '../../src/lib/employees/useEmployeeReads'
import {createEmployeeKeys,employeeKeys,EMPLOYEE_BACKEND,recoveryStorageKey} from '../../src/lib/employees/queryKeys'
import {actorId,otherId,employeeId,context,detail,deferred,fields} from './fixtures'
let client:QueryClient
function wrapper({children}:any){return <QueryClientProvider client={client}>{children}</QueryClientProvider>}
beforeEach(()=>{client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});mocks.auth={user:{id:actorId},profile:{id:actorId,is_active:true,role:'executive'},loading:false};mocks.fetch.mockReset().mockResolvedValue({...context});mocks.detail.mockReset().mockResolvedValue(detail);mocks.page.mockReset().mockResolvedValue({rows:[{id:employeeId,version:1,...fields}],total:1,page:1,pageSize:25});mocks.audit.mockReset().mockResolvedValue({rows:[],total:0,page:1,pageSize:25});mocks.candidates.mockReset().mockResolvedValue({rows:[],total:0,page:1,pageSize:25});sessionStorage.clear()})
afterEach(()=>{cleanup();client.clear()})
it('keys isolate backend, actor and scope; cached context is not completed authority',async()=>{
 expect(createEmployeeKeys('other').private(actorId,'one','detail')).not.toEqual(employeeKeys.private(actorId,'one','detail'))
 expect(employeeKeys.private(actorId,'one','detail')).not.toEqual(employeeKeys.private(otherId,'one','detail'))
 expect(employeeKeys.private(actorId,'one','detail')).not.toEqual(employeeKeys.private(actorId,'two','detail'))
 client.setQueryData(employeeKeys.context(actorId),context)
 const pending=deferred<any>();mocks.fetch.mockReturnValue(pending.promise)
 const hook=renderHook(()=>useEmployeeContext(),{wrapper});expect(hook.result.current.authorityReady).toBe(false)
 await act(async()=>pending.resolve({...context}));await waitFor(()=>expect(hook.result.current.authorityReady).toBe(true))
})
it('revalidates each interaction, rejects returned actor mismatch and disposal after switch',async()=>{
 const hook=renderHook(()=>useEmployeeContext(),{wrapper});await waitFor(()=>expect(hook.result.current.authorityReady).toBe(true))
 const action=vi.fn(()=>42);await act(async()=>expect(await runEmployeeInteraction(client,actorId,context.scopeVersion,action)).toBe(42));expect(mocks.fetch).toHaveBeenCalledTimes(2)
 mocks.fetch.mockResolvedValue({...context,actorId:otherId});await act(async()=>{await expect(runEmployeeInteraction(client,actorId,context.scopeVersion,action)).rejects.toMatchObject({kind:'invalid'})});expect(action).toHaveBeenCalledTimes(1);expect(hook.result.current.authorityReady).toBe(false)
 mocks.fetch.mockResolvedValue({...context});await act(async()=>{await hook.result.current.refresh()});await waitFor(()=>expect(hook.result.current.authorityReady).toBe(true))
 const pending=deferred<any>();const work=runEmployeeInteraction(client,actorId,context.scopeVersion,()=>pending.promise);const rejected=expect(work).rejects.toMatchObject({kind:'denied'});await waitFor(()=>expect(mocks.fetch).toHaveBeenCalledTimes(5))
 mocks.auth={user:{id:otherId},profile:{id:otherId,is_active:true,role:'executive'},loading:false};mocks.fetch.mockResolvedValue({...context,actorId:otherId});hook.rerender();await act(async()=>pending.resolve('private'));await rejected
})
it('cancelled and transport refreshes cannot revive cached authority but retain draft generation',async()=>{
 const hook=renderHook(()=>useEmployeeContext(),{wrapper});await waitFor(()=>expect(hook.result.current.authorityReady).toBe(true));const generation=hook.result.current.draftGeneration
 const pending=deferred<any>();mocks.fetch.mockReturnValue(pending.promise)
 let refresh:Promise<unknown>;act(()=>{refresh=hook.result.current.refresh()});await waitFor(()=>expect(hook.result.current.authorityReady).toBe(false))
 await act(async()=>{await client.cancelQueries({queryKey:employeeKeys.context(actorId)});pending.resolve({...context});await refresh!.catch(()=>{})});expect(hook.result.current.authorityReady).toBe(false);expect(hook.result.current.draftGeneration).toBe(generation)
 mocks.fetch.mockRejectedValue(new EmployeeError('transport'));await act(async()=>{await hook.result.current.refresh().catch(()=>{})});expect(hook.result.current.authorityReady).toBe(false);expect(hook.result.current.draftGeneration).toBe(generation)
})
it('scope changes preserve drafts but confirmed denial purges recovery and protected queries',async()=>{
 const hook=renderHook(()=>useEmployeeContext(),{wrapper});await waitFor(()=>expect(hook.result.current.authorityReady).toBe(true));const generation=hook.result.current.draftGeneration
 sessionStorage.setItem(recoveryStorageKey(EMPLOYEE_BACKEND,actorId),JSON.stringify({actorId,backend:EMPLOYEE_BACKEND,operationId:otherId,employeeId}))
 client.setQueryData(employeeKeys.private(actorId,context.scopeVersion,'old'),detail)
 mocks.fetch.mockResolvedValue({...context,scopeVersion:'two'});await act(async()=>{await hook.result.current.refresh()});expect(hook.result.current.draftGeneration).toBe(generation);expect(client.getQueryData(employeeKeys.private(actorId,context.scopeVersion,'old'))).toBeUndefined();expect(sessionStorage.length).toBe(1)
 mocks.fetch.mockResolvedValue({...context,canMaintainBasic:false,setupBlockers:[]});await act(async()=>{await hook.result.current.refresh()});expect(hook.result.current.authorityReady).toBe(false);expect(hook.result.current.draftGeneration).toBeGreaterThan(generation);expect(sessionStorage.length).toBe(0)
})
it('hides completed reads immediately during focus/offline uncertainty, without purging drafts',async()=>{
 function Screen(){const authority=useEmployeeContext(),read=useEmployeeDetail(employeeId);return <div>{read.data?.fields.name}<span data-testid="generation">{authority.draftGeneration}</span></div>}
 render(<Screen/>,{wrapper});await screen.findByText('Synthetic employee');const generation=screen.getByTestId('generation').textContent
 act(()=>window.dispatchEvent(new Event('offline')));expect(screen.queryByText('Synthetic employee')).toBeNull();expect(screen.getByTestId('generation').textContent).toBe(generation)
 const pending=deferred<any>();mocks.fetch.mockReturnValue(pending.promise);act(()=>window.dispatchEvent(new Event('focus')));expect(screen.queryByText('Synthetic employee')).toBeNull()
 await act(async()=>pending.reject(new EmployeeError('transport')));expect(screen.queryByText('Synthetic employee')).toBeNull()
})
it('discards old-identity and revoked protected results after their completion check',async()=>{
 const pending=deferred<any>();mocks.detail.mockReturnValue(pending.promise)
 const hook=renderHook(()=>useEmployeeDetail(employeeId),{wrapper});await waitFor(()=>expect(mocks.detail).toHaveBeenCalledTimes(1))
 mocks.fetch.mockResolvedValue({...context,canMaintainBasic:false,setupBlockers:[]});await act(async()=>pending.resolve(detail));await waitFor(()=>expect(hook.result.current.authorityReady).toBe(false));expect(hook.result.current.data).toBeUndefined()
 expect(client.getQueryCache().findAll({queryKey:employeeKeys.all}).some(q=>q.state.data===detail)).toBe(false)
})
it('does not publish a late protected result following identity change even when transport ignores abort',async()=>{
 const pending=deferred<any>();mocks.detail.mockReturnValueOnce(pending.promise)
 const hook=renderHook(()=>useEmployeeDetail(employeeId),{wrapper});await waitFor(()=>expect(mocks.detail).toHaveBeenCalledTimes(1))
 mocks.auth={user:null,profile:null,loading:false};hook.rerender();await act(async()=>pending.resolve(detail));expect(hook.result.current.data).toBeUndefined()
})
it('exposes page, audit and candidates only after their protected completion',async()=>{
 const hook=renderHook(()=>({page:useEmployeePage({query:'',status:null,page:1}),audit:useEmployeeAudit(employeeId,1),candidates:useEmployeeAccountCandidates('',1)}),{wrapper})
 await waitFor(()=>expect(hook.result.current.page.data?.rows[0].name).toBe('Synthetic employee'))
 await waitFor(()=>expect(hook.result.current.audit.data?.rows).toEqual([]));await waitFor(()=>expect(hook.result.current.candidates.data?.rows).toEqual([]))
})
it('same-user verified profile refresh invalidates read receipts without purging drafts',async()=>{
 const hook=renderHook(()=>({authority:useEmployeeContext(),detail:useEmployeeDetail(employeeId)}),{wrapper});await waitFor(()=>expect(hook.result.current.detail.data?.id).toBe(employeeId));const generation=hook.result.current.authority.draftGeneration
 const pending=deferred<any>();mocks.fetch.mockReturnValue(pending.promise);mocks.auth={...mocks.auth,profile:{...mocks.auth.profile}};hook.rerender()
 expect(hook.result.current.detail.data).toBeUndefined();expect(hook.result.current.authority.authorityReady).toBe(false);expect(hook.result.current.authority.draftGeneration).toBe(generation)
 await act(async()=>pending.resolve({...context}));await waitFor(()=>expect(hook.result.current.detail.data?.id).toBe(employeeId))
})
it('a mismatched post-read actor suspends every protected result, not just the queried row',async()=>{
 const pending=deferred<any>();mocks.detail.mockReturnValue(pending.promise)
 const hook=renderHook(()=>({authority:useEmployeeContext(),detail:useEmployeeDetail(employeeId)}),{wrapper});await waitFor(()=>expect(mocks.detail).toHaveBeenCalledTimes(1))
 mocks.fetch.mockResolvedValue({...context,actorId:otherId});await act(async()=>pending.resolve(detail));await waitFor(()=>expect(hook.result.current.authority.authorityReady).toBe(false));expect(hook.result.current.detail.data).toBeUndefined()
})
it('a cancelled protected refetch cannot revert to its previously visible cached result',async()=>{
 const hook=renderHook(()=>useEmployeeDetail(employeeId),{wrapper});await waitFor(()=>expect(hook.result.current.data?.id).toBe(employeeId))
 const pending=deferred<any>();mocks.detail.mockReturnValue(pending.promise)
 let work:Promise<unknown>;act(()=>{work=client.refetchQueries({queryKey:employeeKeys.all,predicate:q=>q.queryKey[3]==='private'})});await waitFor(()=>expect(mocks.detail).toHaveBeenCalledTimes(2))
 await act(async()=>{await client.cancelQueries({queryKey:employeeKeys.all,predicate:q=>q.queryKey[3]==='private'})})
 expect(hook.result.current.data).toBeUndefined()
 await act(async()=>{pending.resolve(detail);await work!})
 expect(hook.result.current.data).toBeUndefined()
})
it('private cache assignment is not a completed protected read receipt',async()=>{
 const hook=renderHook(()=>useEmployeeDetail(employeeId),{wrapper});await waitFor(()=>expect(hook.result.current.data?.id).toBe(employeeId))
 const key=client.getQueryCache().findAll({queryKey:employeeKeys.all}).find(q=>q.queryKey[3]==='private')!.queryKey
 await act(async()=>{client.setQueryData(key,{...detail,fields:{...fields,name:'Unverified cached employee'}})})
 await waitFor(()=>expect(hook.result.current.data).toBeUndefined())
})
it('cancelling an obsolete row read does not later suspend a newer completed read',async()=>{
 const pending=deferred<any>();mocks.detail.mockImplementation((id:string)=>id===employeeId?pending.promise:Promise.resolve({...detail,id:otherId}))
 const hook=renderHook(({id})=>useEmployeeDetail(id),{wrapper,initialProps:{id:employeeId}});await waitFor(()=>expect(mocks.detail).toHaveBeenCalledTimes(1));hook.rerender({id:otherId});await waitFor(()=>expect(hook.result.current.data?.id).toBe(otherId))
 await act(async()=>pending.resolve(detail));expect(hook.result.current.authorityReady).toBe(true);expect(hook.result.current.data?.id).toBe(otherId)
})
it('interaction transport failure suspends protected authority, while a confirmed action denial purges drafts',async()=>{
 const hook=renderHook(()=>useEmployeeContext(),{wrapper});await waitFor(()=>expect(hook.result.current.authorityReady).toBe(true));const generation=hook.result.current.draftGeneration
 await act(async()=>{await expect(runEmployeeInteraction(client,actorId,context.scopeVersion,()=>Promise.reject(new EmployeeError('transport')))).rejects.toMatchObject({kind:'transport'})})
 expect(hook.result.current.authorityReady).toBe(false);expect(hook.result.current.draftGeneration).toBe(generation)
 await act(async()=>{await expect(runEmployeeInteraction(client,actorId,context.scopeVersion,()=>Promise.reject(new EmployeeError('denied')))).rejects.toMatchObject({kind:'denied'})})
 expect(hook.result.current.draftGeneration).toBeGreaterThan(generation)
})
it('initial authority discovery purges stale foreign-actor and foreign-backend recovery markers',async()=>{
 sessionStorage.setItem(recoveryStorageKey(EMPLOYEE_BACKEND,otherId),JSON.stringify({actorId:otherId,backend:EMPLOYEE_BACKEND,operationId:otherId,employeeId}))
 sessionStorage.setItem(recoveryStorageKey('old-backend',actorId),JSON.stringify({actorId,backend:'old-backend',operationId:otherId,employeeId}))
 const hook=renderHook(()=>useEmployeeContext(),{wrapper});await waitFor(()=>expect(hook.result.current.authorityReady).toBe(true));expect(sessionStorage.length).toBe(0)
})

it('identity boundary preserves recovery during initial session discovery, then purges on confirmed signed out',()=>{
 sessionStorage.setItem(recoveryStorageKey(EMPLOYEE_BACKEND,actorId),JSON.stringify({actorId,backend:EMPLOYEE_BACKEND,operationId:otherId,employeeId}))
 mocks.auth={user:null,profile:null,loading:true};const hook=renderHook(()=>useEmployeeIdentityBoundary(),{wrapper});expect(sessionStorage.length).toBe(1)
 mocks.auth={user:null,profile:null,loading:false};hook.rerender();expect(sessionStorage.length).toBe(0);expect(mocks.fetch).not.toHaveBeenCalled()
})

// Regression: a nested consumer shares the entry receipt; it must not restart its parent.
function NestedAudit(){const read=useEmployeeAudit(employeeId,1);return read.data?<p>Audit ready</p>:<p>Audit loading</p>}
function NestedDetail(){const read=useEmployeeDetail(employeeId);return read.data?<><p>Detail ready</p><NestedAudit/></>:<p>Detail loading</p>}
it('conditional detail-to-audit consumers complete once and remain stable',async()=>{
 mocks.fetch.mockImplementation(async()=>{if(mocks.fetch.mock.calls.length>12)throw new EmployeeError('transport');return {...context}})
 render(<NestedDetail/>,{wrapper})
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,150))})
 expect(mocks.fetch).toHaveBeenCalledTimes(3) // Entry, detail completion, audit completion.
 expect(screen.getByText('Detail ready')).toBeTruthy();expect(screen.getByText('Audit ready')).toBeTruthy()
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,50))})
 expect(mocks.detail).toHaveBeenCalledTimes(1);expect(mocks.audit).toHaveBeenCalledTimes(1);expect(mocks.fetch).toHaveBeenCalledTimes(3)
})
it('last consumer exit hides authority and re-entry requires fresh completion before exposing cached data',async()=>{
 client.setQueryDefaults(employeeKeys.all,{gcTime:Infinity})
 mocks.fetch.mockImplementation(async()=>{if(mocks.fetch.mock.calls.length>12)throw new EmployeeError('transport');return {...context}})
 function DetailOnly(){const read=useEmployeeDetail(employeeId);return read.data?<p>Detail ready</p>:<p>Detail loading</p>}
 function Feature({open}:{open:boolean}){useEmployeeIdentityBoundary();return open?<DetailOnly/>:<p>Outside employees</p>}
 const view=render(<Feature open/>,{wrapper})
 await screen.findByText('Detail ready');const generation=getEmployeeAuthority(client).draftGeneration
 view.rerender(<Feature open={false}/>);expect(getEmployeeAuthority(client).ready).toBe(false)
 const pending=deferred<any>();mocks.fetch.mockReturnValueOnce(pending.promise)
 view.rerender(<Feature open/>);expect(screen.queryByText('Detail ready')).toBeNull();expect(screen.queryByText('Audit ready')).toBeNull()
 expect(mocks.detail).toHaveBeenCalledTimes(1)
 await act(async()=>pending.resolve({...context}));await screen.findByText('Detail ready')
 expect(mocks.fetch).toHaveBeenCalledTimes(4);expect(mocks.detail).toHaveBeenCalledTimes(2)
 expect(getEmployeeAuthority(client).draftGeneration).toBe(generation)
})
it.each(['offline','focus'])('%s at interaction receipt consumption is uncertainty, not denial',async eventName=>{
 const hook=renderHook(()=>useEmployeeContext(),{wrapper});await waitFor(()=>expect(hook.result.current.authorityReady).toBe(true));const generation=hook.result.current.draftGeneration
 let armed=true;const stop=client.getQueryCache().subscribe(event=>{
  if(armed&&event.type==='updated'&&event.query.queryKey[3]==='context'&&event.query.state.fetchStatus==='idle'&&event.query.state.status==='success'){armed=false;window.dispatchEvent(new Event(eventName))}
 })
 const action=vi.fn();await act(async()=>{await expect(runEmployeeInteraction(client,actorId,context.scopeVersion,action)).rejects.toMatchObject({kind:'transport'})});stop()
 expect(action).not.toHaveBeenCalled();expect(hook.result.current.draftGeneration).toBe(generation)
})
it('persistent boundary revokes verified non-Director profiles without mounted employee consumers',()=>{
 const hook=renderHook(()=>useEmployeeIdentityBoundary(),{wrapper}),generation=getEmployeeAuthority(client).draftGeneration
 sessionStorage.setItem(recoveryStorageKey(EMPLOYEE_BACKEND,actorId),JSON.stringify({actorId,backend:EMPLOYEE_BACKEND,operationId:otherId,employeeId}))
 client.setQueryData(employeeKeys.context(actorId),context);client.setQueryData(employeeKeys.private(actorId,context.scopeVersion,'detail'),detail)
 mocks.auth={...mocks.auth,profile:{...mocks.auth.profile,role:'sales_person'}};hook.rerender()
 expect(sessionStorage.length).toBe(0);expect(getEmployeeAuthority(client).draftGeneration).toBeGreaterThan(generation)
 expect(getEmployeeAuthority(client).ready).toBe(false);expect(client.getQueryCache().findAll({queryKey:employeeKeys.all})).toHaveLength(0)
 expect(mocks.fetch).not.toHaveBeenCalled()
})

it('StrictMode entry cleanup and remount keep conditional readers stable and detach lifecycle listeners',async()=>{
 const addWindow=vi.spyOn(window,'addEventListener'),removeWindow=vi.spyOn(window,'removeEventListener'),addDocument=vi.spyOn(document,'addEventListener'),removeDocument=vi.spyOn(document,'removeEventListener')
 const key=recoveryStorageKey(EMPLOYEE_BACKEND,actorId),marker=JSON.stringify({actorId,backend:EMPLOYEE_BACKEND,employeeId,operationId:otherId});sessionStorage.setItem(key,marker)
 const view=render(<StrictMode><NestedDetail/></StrictMode>,{wrapper});await screen.findByText('Audit ready')
 const generation=getEmployeeAuthority(client).draftGeneration,initialCalls=mocks.fetch.mock.calls.length,auditCalls=mocks.audit.mock.calls.length
 expect(initialCalls).toBeLessThanOrEqual(4);expect(mocks.detail).toHaveBeenCalledTimes(1);expect(auditCalls).toBeLessThanOrEqual(2);expect(generation).toBe(1);expect(sessionStorage.getItem(key)).toBe(marker)
 act(()=>window.dispatchEvent(new Event('focus')));await screen.findByText('Audit ready')
 expect(mocks.fetch).toHaveBeenCalledTimes(initialCalls+3);expect(mocks.detail).toHaveBeenCalledTimes(2);expect(mocks.audit.mock.calls.length).toBeLessThanOrEqual(auditCalls+2);expect(getEmployeeAuthority(client).draftGeneration).toBe(generation)
 const stableCalls=mocks.fetch.mock.calls.length;await act(async()=>{await new Promise(resolve=>setTimeout(resolve,50))});expect(mocks.fetch).toHaveBeenCalledTimes(stableCalls)
 view.unmount();const calls=mocks.fetch.mock.calls.length
 act(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('offline'));document.dispatchEvent(new Event('visibilitychange'))})
 expect(mocks.fetch).toHaveBeenCalledTimes(calls);expect(getEmployeeAuthority(client).ready).toBe(false);expect(getEmployeeAuthority(client).draftGeneration).toBe(generation);expect(sessionStorage.getItem(key)).toBe(marker)
 for(const [name,listener] of addWindow.mock.calls.filter(([name])=>['focus','online','offline'].includes(name)))expect(removeWindow.mock.calls.filter(([removed,fn])=>removed===name&&fn===listener)).toHaveLength(1)
 for(const [name,listener] of addDocument.mock.calls.filter(([name])=>name==='visibilitychange'))expect(removeDocument.mock.calls.filter(([removed,fn])=>removed===name&&fn===listener)).toHaveLength(1)
})
it('context, read and command consumers distinguish server denial from pending and transport suspension',async()=>{
 const pending=deferred<any>();mocks.fetch.mockReturnValue(pending.promise)
 const hook=renderHook(()=>({authority:useEmployeeContext(),read:useEmployeeDetail(employeeId),command:useEmployeeCommand(employeeId)}),{wrapper})
 const denied=()=>[hook.result.current.authority.authorityDenied,hook.result.current.read.authorityDenied,hook.result.current.command.authorityDenied]
 expect(denied()).toEqual([false,false,false]);expect(hook.result.current.authority.authorityReady).toBe(false)
 await act(async()=>pending.reject(new EmployeeError('transport')));expect(denied()).toEqual([false,false,false])
 mocks.fetch.mockResolvedValue({...context,canMaintainBasic:false,setupBlockers:[]});await act(async()=>{await hook.result.current.authority.refresh()})
 expect(denied()).toEqual([true,true,true]);expect(hook.result.current.authority.context).toBeUndefined();expect(hook.result.current.read.data).toBeUndefined();expect(hook.result.current.command.authorityReady).toBe(false);expect(mocks.detail).not.toHaveBeenCalled()
 mocks.fetch.mockResolvedValue({...context});await act(async()=>{await hook.result.current.authority.refresh()});await waitFor(()=>expect(hook.result.current.authority.authorityReady).toBe(true));expect(denied()).toEqual([false,false,false])
})
it('a verified non-Director profile exposes negative authority without granting or fetching a positive context',()=>{
 mocks.auth={...mocks.auth,profile:{...mocks.auth.profile,role:'sales_person'}}
 const hook=renderHook(()=>useEmployeeContext(),{wrapper});expect(hook.result.current.authorityDenied).toBe(true);expect(hook.result.current.authorityReady).toBe(false);expect(hook.result.current.context).toBeUndefined();expect(mocks.fetch).not.toHaveBeenCalled()
})
it('rapid component handoffs keep a fresh context request alive and release the finite query anchor on final exit',async()=>{
 client.setQueryDefaults(employeeKeys.all,{gcTime:Infinity})
 const marker=JSON.stringify({actorId,backend:EMPLOYEE_BACKEND,employeeId,operationId:otherId})
 sessionStorage.setItem(recoveryStorageKey(EMPLOYEE_BACKEND,actorId),marker)
 function First(){const state=useEmployeeContext();return <p>{state.authorityReady?'First ready':'First checking'}</p>}
 function Second(){const state=useEmployeeContext();return <p>{state.authorityReady?'Second ready':'Second checking'}</p>}
 function Handoff({second}:{second:boolean}){useEmployeeIdentityBoundary();return second?<Second/>:<First/>}
 const view=render(<Handoff second={false}/>,{wrapper});await screen.findByText('First ready')
 const generation=getEmployeeAuthority(client).draftGeneration,second=deferred<any>()
 mocks.fetch.mockReturnValueOnce(second.promise)
 view.rerender(<Handoff second/>);expect(screen.queryByText('Second ready')).toBeNull();expect(getEmployeeAuthority(client).ready).toBe(false)
 expect(mocks.fetch).toHaveBeenCalledTimes(2)
 expect((mocks.fetch.mock.calls[1][0]as AbortSignal).aborted).toBe(false)
 await act(async()=>second.resolve({...context}));await screen.findByText('Second ready')
 const third=deferred<any>();mocks.fetch.mockReturnValueOnce(third.promise)
 view.rerender(<Handoff second={false}/>);expect(screen.queryByText('First ready')).toBeNull()
 expect((mocks.fetch.mock.calls[2][0]as AbortSignal).aborted).toBe(false)
 await act(async()=>third.resolve({...context}));await screen.findByText('First ready')
 expect(mocks.fetch).toHaveBeenCalledTimes(3);expect(getEmployeeAuthority(client).draftGeneration).toBe(generation)
 expect(sessionStorage.getItem(recoveryStorageKey(EMPLOYEE_BACKEND,actorId))).toBe(marker)
 const query=client.getQueryCache().find({queryKey:employeeKeys.context(actorId),exact:true})!
 view.unmount();expect(getEmployeeAuthority(client).ready).toBe(false);expect(query.getObserversCount()).toBe(0)
 const calls=mocks.fetch.mock.calls.length;act(()=>window.dispatchEvent(new Event('focus')));expect(mocks.fetch).toHaveBeenCalledTimes(calls)
})
