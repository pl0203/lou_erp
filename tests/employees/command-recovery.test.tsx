import {act,cleanup,renderHook,waitFor} from '@testing-library/react'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({context:vi.fn(),preview:vi.fn(),execute:vi.fn(),resolve:vi.fn(),auth:{user:null,profile:null,loading:false} as any}))
vi.mock('../../src/lib/AuthContext',()=>({useAuth:()=>mocks.auth}))
vi.mock('../../src/lib/employees/rpc',async()=>{const actual=await vi.importActual<any>('../../src/lib/employees/contracts');return {fetchEmployeeContext:mocks.context,previewEmployeeCommand:mocks.preview,executeEmployeeCommand:mocks.execute,resolveEmployeeOperation:mocks.resolve,normalizeEmployeeError:(e:any)=>e instanceof actual.EmployeeError?e:new actual.EmployeeError('transport')}})
import {EmployeeError} from '../../src/lib/employees/contracts'
import {useEmployeeCommand} from '../../src/lib/employees/useEmployeeCommand'
import {employeeKeys,EMPLOYEE_BACKEND,recoveryStorageKey,readEmployeeRecovery,writeEmployeeRecovery} from '../../src/lib/employees/queryKeys'
import {actorId,otherId,employeeId,context,proposal,preview,receipt,deferred} from './fixtures'
let client:QueryClient
function wrapper({children}:any){return <QueryClientProvider client={client}>{children}</QueryClientProvider>}
beforeEach(()=>{client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});mocks.auth={user:{id:actorId},profile:{id:actorId,is_active:true,role:'executive'},loading:false};mocks.context.mockReset().mockResolvedValue({...context});mocks.preview.mockReset().mockResolvedValue({...preview});mocks.execute.mockReset().mockImplementation(async command=>({...receipt,operationId:command.operationId}));mocks.resolve.mockReset().mockResolvedValue({state:'absent',result:null});sessionStorage.clear()})
afterEach(()=>{cleanup();client.clear()})
async function mount(id:string|undefined=employeeId){const hook=renderHook(()=>useEmployeeCommand(id),{wrapper});await waitFor(()=>expect(hook.result.current.authorityReady).toBe(true));return hook}
async function prepare(hook:any){await act(async()=>{expect(await hook.result.current.preview(proposal)).toEqual(preview)})}
async function unknown(hook:any){await prepare(hook);mocks.execute.mockRejectedValue(new EmployeeError('transport'));await act(async()=>{await hook.result.current.submit(proposal)});expect(hook.result.current.phase).toBe('uncertain');return readEmployeeRecovery(actorId)!}
it('persists only the minimal marker before dispatch and coalesces synchronous double submit',async()=>{
 const hook=await mount();await prepare(hook);const pending=deferred<any>();let command:any
 mocks.execute.mockImplementation(value=>{command=value;expect(readEmployeeRecovery(actorId)).toEqual({actorId,backend:EMPLOYEE_BACKEND,operationId:value.operationId,employeeId});expect(sessionStorage.getItem(recoveryStorageKey(EMPLOYEE_BACKEND,actorId))).not.toContain('Synthetic');return pending.promise})
 let first:Promise<any>,second:Promise<any>;act(()=>{first=hook.result.current.submit(proposal);second=hook.result.current.submit(proposal)})
 await waitFor(()=>expect(mocks.execute).toHaveBeenCalledTimes(1));await act(async()=>{pending.resolve({...receipt,operationId:command.operationId});await first!;await second!})
 expect(hook.result.current.phase).toBe('completed');expect(hook.result.current.receipt).toMatchObject({employeeId});expect(sessionStorage.length).toBe(0)
})
it('requires an actual preview bound to the unchanged proposal and fresh authority for each action',async()=>{
 const hook=await mount();await act(async()=>{await hook.result.current.submit(proposal)});expect(mocks.execute).not.toHaveBeenCalled()
 await prepare(hook);const count=mocks.context.mock.calls.length
 mocks.context.mockResolvedValue({...context,canMaintainBasic:false,setupBlockers:[]});await act(async()=>{await hook.result.current.submit(proposal)});expect(mocks.context.mock.calls.length).toBeGreaterThan(count);expect(mocks.execute).not.toHaveBeenCalled();expect(hook.result.current.phase).toBe('blocked')
})
it('fails closed if recovery storage is unavailable before dispatch',async()=>{
 const hook=await mount();await prepare(hook);vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('denied')})
 await act(async()=>{await hook.result.current.submit(proposal)});expect(mocks.execute).not.toHaveBeenCalled();expect(hook.result.current.error?.reason).toBe('RECOVERY_STORAGE_UNAVAILABLE');expect(hook.result.current.receipt).toBeNull()
})
it('never overwrites another unresolved marker',async()=>{
 const hook=await mount();await prepare(hook);sessionStorage.setItem(recoveryStorageKey(EMPLOYEE_BACKEND,actorId),JSON.stringify({actorId,backend:EMPLOYEE_BACKEND,employeeId:otherId,operationId:otherId}))
 await act(async()=>{await hook.result.current.submit(proposal)});expect(mocks.execute).not.toHaveBeenCalled();expect(readEmployeeRecovery(actorId)?.employeeId).toBe(otherId)
})
it('after commit loss recovers one receipt without retrying, then invalidates all affected reads',async()=>{
 const hook=await mount(),marker=await unknown(hook)
 for(const section of ['page','detail','audit','candidates'])client.setQueryData(employeeKeys.private(actorId,context.scopeVersion,section),{old:true})
 mocks.resolve.mockResolvedValue({state:'completed',result:{...receipt,operationId:marker.operationId}})
 await act(async()=>{await hook.result.current.checkOutcome()});expect(hook.result.current.phase).toBe('completed');expect(hook.result.current.receipt?.operationId).toBe(marker.operationId);expect(mocks.execute).toHaveBeenCalledTimes(1)
 for(const query of client.getQueryCache().findAll({queryKey:employeeKeys.all}))if(query.queryKey[3]==='private')expect(query.state.isInvalidated).toBe(true)
})
it('absent recovery does not permit replacement; explicit in-memory retry uses identical operation',async()=>{
 const hook=await mount(),marker=await unknown(hook);await act(async()=>{await hook.result.current.checkOutcome()});expect(hook.result.current.phase).toBe('uncertain')
 await act(async()=>{await hook.result.current.submit({...proposal,reason:'Changed'})});expect(mocks.execute).toHaveBeenCalledTimes(1)
 mocks.execute.mockImplementation(async command=>({...receipt,operationId:command.operationId}));await act(async()=>{await hook.result.current.retryUnknown()})
 expect(mocks.execute).toHaveBeenCalledTimes(2);expect(mocks.execute.mock.calls[1][0]).toEqual(mocks.execute.mock.calls[0][0]);expect(hook.result.current.receipt?.operationId).toBe(marker.operationId)
})
it('reload of /new discovers the old employee id before enabling creation and never reconstructs a request',async()=>{
 const first=await mount(),marker=await unknown(first);first.unmount()
 const second=await mount(otherId);expect(second.result.current.phase).toBe('uncertain');expect(second.result.current.recoveryEmployeeId).toBe(employeeId);expect(second.result.current.employeeId).toBe(employeeId)
 expect(second.result.current.canRetryUnknown).toBe(false);await act(async()=>{await second.result.current.submit({...proposal,employeeId:otherId});await second.result.current.retryUnknown()});expect(mocks.execute).toHaveBeenCalledTimes(1)
 await act(async()=>{await second.result.current.checkOutcome()});expect(mocks.resolve).toHaveBeenLastCalledWith(marker.operationId,'read');expect(second.result.current.phase).toBe('uncertain')
})
it('atomic abandon fences the old ID; completed abandon is a commit and absent is not a fence',async()=>{
 const hook=await mount(),marker=await unknown(hook)
 await act(async()=>{await hook.result.current.abandonUnknown()});expect(hook.result.current.phase).toBe('uncertain');expect(readEmployeeRecovery(actorId)?.operationId).toBe(marker.operationId)
 mocks.resolve.mockResolvedValue({state:'completed',result:{...receipt,operationId:marker.operationId}});await act(async()=>{await hook.result.current.abandonUnknown()});expect(hook.result.current.phase).toBe('completed');await act(async()=>{await hook.result.current.submit(proposal)});expect(mocks.execute).toHaveBeenCalledTimes(1)
})
it('successful abandon permits a new explicit preview/save with a new ID, not an automatic retry',async()=>{
 const hook=await mount(),marker=await unknown(hook);mocks.resolve.mockResolvedValue({state:'abandoned',result:null});await act(async()=>{await hook.result.current.abandonUnknown()});expect(hook.result.current.phase).toBe('idle');expect(sessionStorage.length).toBe(0);expect(mocks.execute).toHaveBeenCalledTimes(1)
 await prepare(hook);mocks.execute.mockImplementation(async command=>({...receipt,operationId:command.operationId}));await act(async()=>{await hook.result.current.submit(proposal)});expect(hook.result.current.receipt?.operationId).not.toBe(marker.operationId)
})
it('known conflict keeps the draft retryable, while malformed marker fails closed',async()=>{
 const hook=await mount();await prepare(hook);mocks.execute.mockRejectedValue(new EmployeeError('conflict','VERSION_CONFLICT'));await act(async()=>{await hook.result.current.submit(proposal)});expect(hook.result.current.phase).toBe('idle');expect(hook.result.current.error?.kind).toBe('conflict');expect(sessionStorage.length).toBe(0)
 hook.unmount();sessionStorage.setItem(recoveryStorageKey(EMPLOYEE_BACKEND,actorId),JSON.stringify({actorId,backend:EMPLOYEE_BACKEND,employeeId,operationId:otherId,name:'secret'}));const second=await mount();expect(second.result.current.phase).toBe('blocked');await act(async()=>{await second.result.current.submit(proposal)});expect(mocks.execute).toHaveBeenCalledTimes(1)
})
it('transport interruption preserves recovery and drafts, confirmed identity loss clears them',async()=>{
 const hook=await mount(),marker=await unknown(hook),generation=hook.result.current.draftGeneration
 mocks.context.mockRejectedValue(new EmployeeError('transport'));await act(async()=>{await hook.result.current.checkOutcome()});expect(readEmployeeRecovery(actorId)?.operationId).toBe(marker.operationId);expect(hook.result.current.draftGeneration).toBe(generation)
 mocks.auth={user:null,profile:null,loading:false};hook.rerender();expect(hook.result.current.phase).toBe('blocked');expect(hook.result.current.receipt).toBeNull();expect(sessionStorage.length).toBe(0);expect(hook.result.current.draftGeneration).toBeGreaterThan(generation)
})
it('never confuses known commit with a failed subsequent readback or transient authority change',async()=>{
 const hook=await mount();await prepare(hook);mocks.execute.mockImplementation(async command=>{window.dispatchEvent(new Event('offline'));return {...receipt,operationId:command.operationId}})
 await act(async()=>{await hook.result.current.submit(proposal)});expect(hook.result.current.phase).toBe('completed');expect(hook.result.current.receipt).not.toBeNull();expect(hook.result.current.authorityReady).toBe(false)
 mocks.context.mockRejectedValue(new EmployeeError('transport'));await act(async()=>{await hook.result.current.refresh().catch(()=>{})});expect(hook.result.current.phase).toBe('completed');expect(mocks.execute).toHaveBeenCalledTimes(1)
})
it('a resolved commit actually invalidates directory/detail/audit/candidates without optimistic replacement',async()=>{
 client.setQueryDefaults(employeeKeys.all,{gcTime:Infinity})
 const hook=await mount();await prepare(hook)
 mocks.execute.mockImplementation(async command=>{for(const section of ['page','detail','audit','candidates'])client.setQueryData(employeeKeys.private(actorId,context.scopeVersion,section),{sentinel:'server-read'});return {...receipt,operationId:command.operationId}})
 await act(async()=>{await hook.result.current.submit(proposal)})
 for(const section of ['page','detail','audit','candidates']){const query=client.getQueryCache().find({queryKey:employeeKeys.private(actorId,context.scopeVersion,section)});expect(query?.state.isInvalidated).toBe(true);expect(query?.state.data).toEqual({sentinel:'server-read'})}
})
it('does not expose a stale preview after a same-Director scope change but preserves recovery and draft generation',async()=>{
 const hook=await mount();await prepare(hook);const generation=hook.result.current.draftGeneration
 mocks.context.mockResolvedValue({...context,scopeVersion:'scope-two'});await act(async()=>{await hook.result.current.refresh()});expect(hook.result.current.previewResult).toBeNull();expect(hook.result.current.draftGeneration).toBe(generation)
 await act(async()=>{await hook.result.current.submit(proposal)});expect(mocks.execute).not.toHaveBeenCalled()
})
it('a stale pending command cannot block or clear a new identity editor recovery',async()=>{
 const hook=await mount();await prepare(hook);const old=deferred<any>();mocks.execute.mockReturnValueOnce(old.promise)
 let oldSubmit:Promise<any>;act(()=>{oldSubmit=hook.result.current.submit(proposal)});await waitFor(()=>expect(mocks.execute).toHaveBeenCalledTimes(1))
 mocks.auth={user:{id:otherId},profile:{id:otherId,is_active:true,role:'executive'},loading:false};mocks.context.mockResolvedValue({...context,actorId:otherId});hook.rerender();await waitFor(()=>expect(hook.result.current.authorityReady).toBe(true))
 await prepare(hook);mocks.execute.mockRejectedValue(new EmployeeError('transport'));await act(async()=>{await hook.result.current.submit(proposal)});expect(hook.result.current.phase).toBe('uncertain');const saved=readEmployeeRecovery(otherId)
 await act(async()=>{old.reject(new EmployeeError('invalid','INVALID_INPUT'));await oldSubmit!})
 expect(readEmployeeRecovery(otherId)).toEqual(saved);await act(async()=>{await hook.result.current.checkOutcome()});expect(mocks.resolve).toHaveBeenLastCalledWith(saved!.operationId,'read')
})
it('preserves a completed recovery response when authority transport becomes uncertain immediately afterward',async()=>{
 const hook=await mount(),marker=await unknown(hook)
 mocks.resolve.mockImplementation(async()=>{window.dispatchEvent(new Event('offline'));return {state:'completed',result:{...receipt,operationId:marker.operationId}}})
 await act(async()=>{await hook.result.current.abandonUnknown()});expect(hook.result.current.phase).toBe('completed');expect(hook.result.current.receipt?.operationId).toBe(marker.operationId);expect(mocks.execute).toHaveBeenCalledTimes(1)
})

it('minimal recovery storage rejects extra runtime fields before writing anything',()=>{
 expect(()=>writeEmployeeRecovery({actorId,backend:EMPLOYEE_BACKEND,operationId:otherId,employeeId,name:'Synthetic secret'} as any)).toThrow()
 expect(sessionStorage.length).toBe(0)
})

it.each(['offline','focus'].flatMap(eventName=>['preview','submit','recovery'].map(step=>({eventName,step}))))('$eventName before $step dispatch preserves draft identity and unresolved creation',async({eventName,step})=>{
 mocks.preview.mockImplementation(async value=>({...preview,employeeId:value.employeeId}))
 const hook=renderHook(()=>useEmployeeCommand(),{wrapper});await waitFor(()=>expect(hook.result.current.authorityReady).toBe(true))
 const attempted={...proposal,employeeId:hook.result.current.employeeId!},generation=hook.result.current.draftGeneration
 if(step!=='preview')await act(async()=>{await hook.result.current.preview(attempted)})
 if(step==='recovery'){
  mocks.execute.mockRejectedValue(new EmployeeError('transport'));await act(async()=>{await hook.result.current.submit(attempted)})
  expect(hook.result.current.phase).toBe('uncertain')
 }
 const saved=readEmployeeRecovery(actorId),previews=mocks.preview.mock.calls.length,dispatches=mocks.execute.mock.calls.length
 let armed=true;const stop=client.getQueryCache().subscribe(event=>{
  if(armed&&event.type==='updated'&&event.query.queryKey[3]==='context'&&event.query.state.fetchStatus==='idle'&&event.query.state.status==='success'){armed=false;window.dispatchEvent(new Event(eventName))}
 })
 await act(async()=>{if(step==='preview')await hook.result.current.preview(attempted);else if(step==='submit')await hook.result.current.submit(attempted);else await hook.result.current.checkOutcome()});stop()
 expect(readEmployeeRecovery(actorId)).toEqual(saved);expect(hook.result.current.draftGeneration).toBe(generation);expect(hook.result.current.employeeId).toBe(attempted.employeeId)
 expect(hook.result.current.error?.kind).toBe('transport');expect(mocks.preview).toHaveBeenCalledTimes(previews);expect(mocks.execute).toHaveBeenCalledTimes(dispatches);expect(mocks.resolve).not.toHaveBeenCalled()
 if(step==='recovery'){
  await act(async()=>{await hook.result.current.refresh();await hook.result.current.preview(attempted);await hook.result.current.submit(attempted)})
  expect(hook.result.current.phase).toBe('uncertain');expect(readEmployeeRecovery(actorId)).toEqual(saved);expect(mocks.execute).toHaveBeenCalledTimes(1)
 }
})
it('an interaction before initial authority completion is uncertainty and never purges the new draft',async()=>{
 const pending=deferred<any>();mocks.context.mockReturnValue(pending.promise)
 const hook=renderHook(()=>useEmployeeCommand(),{wrapper}),target=hook.result.current.employeeId,generation=hook.result.current.draftGeneration
 await act(async()=>{await hook.result.current.preview({...proposal,employeeId:target!})})
 expect(hook.result.current.error?.kind).toBe('transport');expect(hook.result.current.employeeId).toBe(target);expect(hook.result.current.draftGeneration).toBe(generation);expect(mocks.preview).not.toHaveBeenCalled()
 await act(async()=>pending.resolve({...context}))
})
