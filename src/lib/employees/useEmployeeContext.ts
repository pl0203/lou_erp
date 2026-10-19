import {useCallback,useLayoutEffect,useRef,useSyncExternalStore} from 'react'
import {QueryObserver,useQuery,useQueryClient} from '@tanstack/react-query'
import type {QueryClient} from '@tanstack/react-query'
import {useAuth} from '../AuthContext'
import {EmployeeError} from './contracts'
import type {EmployeeContext,UUID} from './contracts'
import {fetchEmployeeContext,normalizeEmployeeError} from './rpc'
import {clearEmployeeRecovery,purgeForeignEmployeeRecovery,employeeKeys,EMPLOYEE_BACKEND,removeEmployeeQueries} from './queryKeys'

type AuthoritySnapshot=Readonly<{actorId:UUID|null;backend:string;attempt:number;ready:boolean;scopeVersion:string|null;draftGeneration:number;denied:boolean}>
type Authority={snapshot:AuthoritySnapshot;completed:WeakMap<EmployeeContext,number>;listeners:Set<()=>void>;observers:number;detach?:()=>void;releaseQuery?:()=>void}
/** Completion evidence stays weak; the finite feature lease owns listeners and its query observer. */
const authorities=new WeakMap<QueryClient,Authority>()
function authority(client:QueryClient):Authority {
 let state=authorities.get(client)
 if(!state){state={snapshot:{actorId:null,backend:EMPLOYEE_BACKEND,attempt:0,ready:false,scopeVersion:null,draftGeneration:0,denied:false},completed:new WeakMap(),listeners:new Set(),observers:0};authorities.set(client,state)}
 return state
}
function publish(state:Authority,patch:Partial<AuthoritySnapshot>) {state.snapshot={...state.snapshot,...patch};state.listeners.forEach(listener=>listener())}
function purgeRecovery(actor:UUID|null,backend:string) {if(actor)try{clearEmployeeRecovery(actor,backend)}catch{/* Storage failure must not prevent revocation. No new writes can pass its validation. */}}
export function synchronizeEmployeeIdentity(client:QueryClient,actor:UUID|null,backend=EMPLOYEE_BACKEND,denied=false) {
 const state=authority(client),old=state.snapshot
 if(old.actorId===actor&&old.backend===backend){
  if(actor===null)purgeForeignEmployeeRecovery(null,backend)
  if(denied&&!old.denied)suspendEmployeeAuthority(client,true)
  return
 }
 purgeRecovery(old.actorId,old.backend)
 purgeForeignEmployeeRecovery(actor,backend)
 publish(state,{actorId:actor,backend,attempt:old.attempt+1,ready:false,scopeVersion:null,draftGeneration:old.draftGeneration+1,denied})
 removeEmployeeQueries(client,key=>key[1]!==backend||key[2]!==actor)
}
export function getEmployeeAuthority(client:QueryClient) {return authority(client).snapshot}
export function suspendEmployeeAuthority(client:QueryClient,denied=false) {
 const state=authority(client),old=state.snapshot
 if(denied)purgeRecovery(old.actorId,old.backend)
 publish(state,{attempt:old.attempt+1,ready:false,denied:denied||old.denied,draftGeneration:old.draftGeneration+(denied&&!old.denied?1:0)})
 removeEmployeeQueries(client,key=>key[3]==='private')
}
function current(client:QueryClient,actor:UUID,attempt:number,scope?:string) {
 const now=authority(client).snapshot
 return now.actorId===actor&&now.backend===EMPLOYEE_BACKEND&&now.attempt===attempt&&(scope===undefined||now.scopeVersion===scope)
}
function assertActor(context:EmployeeContext,actor:UUID) {if(context.actorId!==actor)throw new EmployeeError('invalid','ACTOR_MISMATCH')}
function contextOptions(client:QueryClient,actor:UUID) {return {
 queryKey:employeeKeys.context(actor),
 queryFn:async({signal}:{signal:AbortSignal})=>{
  const state=authority(client)
  if(state.snapshot.actorId!==actor||state.snapshot.backend!==EMPLOYEE_BACKEND)throw new EmployeeError('denied')
  suspendEmployeeAuthority(client)
  const attempt=state.snapshot.attempt
  const interrupt=()=>{if(current(client,actor,attempt))suspendEmployeeAuthority(client)}
  signal.addEventListener('abort',interrupt,{once:true})
  try {
   const result=await fetchEmployeeContext(signal)
   if(signal.aborted||!current(client,actor,attempt))throw new EmployeeError('transport','CANCELLED')
   assertActor(result,actor)
   if(!result.canMaintainBasic){suspendEmployeeAuthority(client,true);return result}
   state.completed.set(result,attempt)
   publish(state,{ready:true,scopeVersion:result.scopeVersion,denied:false})
   return result
  }catch(error){
   if(current(client,actor,attempt))suspendEmployeeAuthority(client,normalizeEmployeeError(error).kind==='denied')
   throw normalizeEmployeeError(error)
  }finally{signal.removeEventListener('abort',interrupt)}
 },networkMode:'always',structuralSharing:false,staleTime:0,retry:false,
} as const}
/** One shared entry lease: nested consumers subscribe without restarting authority.
 * A real 0-to-1 entry always fetches; the last exit retires all completion receipts. */
function subscribeFeature(client:QueryClient,actor:UUID) {
 const state=authority(client);state.observers++
 if(state.observers===1){
  // Keep this query observed synchronously across React's layout/passive route
  // handoff. Otherwise an outgoing passive unsubscribe can cancel the incoming
  // entry request before its React observer subscribes. This disabled observer
  // never fetches or supplies authority; only the finite feature lease owns it.
  const anchor=new QueryObserver(client,{...contextOptions(client,actor),enabled:false,refetchOnWindowFocus:false,refetchOnReconnect:false})
  state.releaseQuery=anchor.subscribe(()=>{})
  const refresh=()=>{const actor=state.snapshot.actorId;if(actor&&document.visibilityState==='visible')void client.fetchQuery(contextOptions(client,actor)).catch(()=>{})}
  const offline=()=>suspendEmployeeAuthority(client)
  window.addEventListener('focus',refresh);window.addEventListener('online',refresh);window.addEventListener('offline',offline);document.addEventListener('visibilitychange',refresh)
  state.detach=()=>{window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);window.removeEventListener('offline',offline);document.removeEventListener('visibilitychange',refresh)}
  void client.fetchQuery(contextOptions(client,actor)).catch(()=>{})
 }
 return ()=>{if(--state.observers===0){
  state.detach?.();state.detach=undefined
  void client.cancelQueries({queryKey:employeeKeys.context(actor)})
  suspendEmployeeAuthority(client)
  state.releaseQuery?.();state.releaseQuery=undefined
 }}
}
export function useEmployeeContext() {
 const {profile}=useAuth(),client=useQueryClient(),actor=useEmployeeIdentityBoundary()
 const state=authority(client)
 const subscribe=useCallback((listener:()=>void)=>{state.listeners.add(listener);return()=>{state.listeners.delete(listener)}},[state])
 const snapshot=useSyncExternalStore(subscribe,()=>state.snapshot,()=>state.snapshot)
 const previousProfile=useRef({actor,profile})
 useLayoutEffect(()=>{
  const previous=previousProfile.current;previousProfile.current={actor,profile}
  if(actor&&previous.actor===actor&&previous.profile!==profile){
   void client.cancelQueries({queryKey:employeeKeys.context(actor)})
   void client.fetchQuery(contextOptions(client,actor)).catch(()=>{})
  }
 },[client,actor,profile])
 // Context observers never own fetching. Entry, explicit interactions and lifecycle
 // events do, so a conditional child cannot invalidate the parent that mounted it.
 const query=useQuery({...contextOptions(client,actor??'signed-out'),enabled:false,refetchOnWindowFocus:false,refetchOnReconnect:false})
 useLayoutEffect(()=>actor?subscribeFeature(client,actor):undefined,[client,actor])
 const refresh=useCallback(async()=>{
  if(!actor)throw new EmployeeError('denied')
  return client.fetchQuery(contextOptions(client,actor))
 },[client,actor])
 const authorityReady=state.observers>0&&!!actor&&snapshot.actorId===actor&&snapshot.backend===EMPLOYEE_BACKEND&&snapshot.ready&&query.isSuccess&&!query.isFetching&&!!query.data&&state.completed.get(query.data)===snapshot.attempt
 return {context:authorityReady?query.data:undefined,authorityReady,authorityDenied:snapshot.actorId===actor&&snapshot.backend===EMPLOYEE_BACKEND&&snapshot.denied,authorityPending:query.isFetching,refresh,error:query.error?normalizeEmployeeError(query.error):null,draftGeneration:snapshot.draftGeneration,authorityRevision:snapshot.attempt,actorId:actor,scopeVersion:authorityReady?snapshot.scopeVersion:null}
}
function authorityChanged(client:QueryClient,actor:UUID) {
 const now=authority(client).snapshot
 const revoked=now.actorId!==actor||now.backend!==EMPLOYEE_BACKEND||now.denied
 return new EmployeeError(revoked?'denied':'transport','AUTHORITY_CHANGED')
}
/** Revalidation must complete in this actor/backend before invoking a handler. */
export async function runEmployeeInteraction<T>(client:QueryClient,actor:UUID,scope:string,action:(context:EmployeeContext)=>T|Promise<T>):Promise<T> {
 const before=authority(client).snapshot
 if(before.actorId!==actor||before.backend!==EMPLOYEE_BACKEND)throw new EmployeeError('denied')
 const pending=client.fetchQuery(contextOptions(client,actor)),attempt=authority(client).snapshot.attempt
 const result=await pending.catch(error=>{throw normalizeEmployeeError(error)}),state=authority(client)
 if(!current(client,actor,attempt)||!state.snapshot.ready||state.completed.get(result)!==attempt)throw authorityChanged(client,actor)
 assertActor(result,actor)
 if(result.scopeVersion!==scope)throw new EmployeeError('conflict','SCOPE_CHANGED')
 try {
  const value=await action(result)
  if(!current(client,actor,attempt,scope)||!state.snapshot.ready)throw authorityChanged(client,actor)
  return value
 }catch(error){
  const safe=normalizeEmployeeError(error)
  if(current(client,actor,attempt)&&(safe.kind==='denied'||safe.kind==='transport'))suspendEmployeeAuthority(client,safe.kind==='denied')
  throw safe
 }
}
/** A protected response is not publishable until a post-read authority check completes. */
export async function completeEmployeeRead<T>(client:QueryClient,actor:UUID,scope:string,attempt:number,signal:AbortSignal,read:()=>Promise<T>):Promise<T> {
 const check=()=>{if(signal.aborted||!current(client,actor,attempt,scope)||!authority(client).snapshot.ready)throw new EmployeeError('transport','CANCELLED')}
 try {
  check();const value=await read();check()
  const result=await fetchEmployeeContext(signal);check();assertActor(result,actor)
  if(!result.canMaintainBasic){suspendEmployeeAuthority(client,true);throw new EmployeeError('denied')}
  if(result.scopeVersion!==scope){suspendEmployeeAuthority(client);void client.fetchQuery(contextOptions(client,actor)).catch(()=>{});throw new EmployeeError('conflict','SCOPE_CHANGED')}
  return value
 }catch(error){
  const safe=normalizeEmployeeError(error)
  if(!signal.aborted&&current(client,actor,attempt,scope)&&(safe.kind==='denied'||safe.kind==='transport'||safe.reason==='ACTOR_MISMATCH'))suspendEmployeeAuthority(client,safe.kind==='denied')
  throw safe
 }
}
/** Task 5 must call this once inside App, before its loading early return, outside
 * ProtectedRoute gates. No RPC, auth subscription, or navigation guard is added.
 * Initial unresolved discovery is not sign-out and must not destroy reload recovery. */
export function useEmployeeIdentityBoundary():UUID|null {
 const {user,profile,loading}=useAuth(),client=useQueryClient()
 // A verified non-Director profile is a negative restriction even off-route.
 // An executive profile alone never grants authority: completed server evidence does.
 const denied=!!(!loading&&user&&profile&&profile.id===user.id&&(!profile.is_active||profile.role!=='executive'))
 const actor=!loading&&user&&profile?.is_active&&profile.id===user.id&&!denied?user.id:null
 useLayoutEffect(()=>{
  if(loading){
   const previous=authority(client).snapshot.actorId
   if(previous&&user?.id!==previous)synchronizeEmployeeIdentity(client,null)
   return
  }
  synchronizeEmployeeIdentity(client,actor,EMPLOYEE_BACKEND,denied)
 },[client,actor,loading,user?.id,denied])
 return actor
}
