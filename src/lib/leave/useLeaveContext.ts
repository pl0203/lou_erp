import { useCallback, useEffect, useLayoutEffect, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { useAuth } from '../AuthContext'
import {createHRDisplayLease,runBoundedHRCheck,type HRDisplayLease} from '../hr/revalidation'
import type { LeaveContext, UUID } from './contracts'
import { fetchLeaveContext } from './rpc'
import { getLeaveIdentityGeneration,isCurrentLeaveIdentity,subscribeLeaveIdentityBoundary,leaveKeys,synchronizeLeaveIdentity,synchronizeLeaveScope } from './queryKeys'

type ReadReceipt={attempt:number;state:'unvalidated'|'pending'|'ready';displayEpoch:number;displayAllowed:boolean;refreshing:boolean}
type AuthorityRead={receipt:ReadReceipt;completed:WeakMap<LeaveContext,number>;listeners:Set<()=>void>;displayContext?:LeaveContext;observers:number;contextObservers:number;releaseOffline?:()=>void;displayLease:ReturnType<typeof createHRDisplayLease>}
const authorityReads=new WeakMap<QueryClient,Map<UUID,AuthorityRead>>()
/** Only a mounted feature lease retains its last genuinely completed context. */
function authorityRead(client:QueryClient,identity:UUID):AuthorityRead{
 let reads=authorityReads.get(client)
 if(!reads){
  reads=new Map();authorityReads.set(client,reads)
  const owned=reads
  subscribeLeaveIdentityBoundary(client,()=>{for(const read of owned.values())invalidate(read)})
 }
 let read=reads.get(identity)
 if(!read){
  read={receipt:{attempt:0,state:'unvalidated',displayEpoch:0,displayAllowed:false,refreshing:false},completed:new WeakMap(),listeners:new Set(),observers:0,contextObservers:0,displayLease:null!}
  const owned=read
  read.displayLease=createHRDisplayLease(()=>{invalidate(owned);void client.cancelQueries({queryKey:leaveKeys.context(identity,'current'),exact:true});synchronizeLeaveScope(client,identity)},refreshing=>publish(owned,{refreshing}))
  reads.set(identity,read)
 }
 return read
}
function publish(read:AuthorityRead,patch:Partial<ReadReceipt>){read.receipt={...read.receipt,...patch};read.listeners.forEach(listener=>listener())}
function invalidate(read:AuthorityRead){
 read.displayLease.invalidateDisplayEpisode();read.displayContext=undefined
 publish(read,{attempt:read.receipt.attempt+1,state:'unvalidated',displayEpoch:read.receipt.displayEpoch+1,displayAllowed:false,refreshing:false})
}
function validated(read:AuthorityRead,context:LeaveContext|undefined,attempt=read.receipt.attempt){
 return !!context&&read.receipt.attempt===attempt&&read.receipt.state==='ready'&&read.completed.get(context)===attempt
}
function contextOptions(client: QueryClient, identity: UUID) {
 return {
  queryKey:leaveKeys.context(identity,'current'),
  queryFn:async({signal}:{signal:AbortSignal})=>{
   const read=authorityRead(client,identity),generation=getLeaveIdentityGeneration(client)
   if(!isCurrentLeaveIdentity(client,identity,generation))throw new Error('Akses cuti belum dikonfirmasi.')
   const episode=read.displayLease.beginContext(),attempt=read.receipt.attempt+1
   publish(read,{attempt,state:'pending'})
   const current=()=>read.receipt.attempt===attempt&&isCurrentLeaveIdentity(client,identity,generation)
   const interrupted=()=>{if(current())invalidate(read)}
   signal.addEventListener('abort',interrupted,{once:true})
   try{
    const context=await runBoundedHRCheck(signal,fetchLeaveContext,interrupted)
    if(signal.aborted||!current())throw new DOMException('Obsolete leave context','AbortError')
    if(read.displayContext&&read.displayContext.scopeVersion!==context.scopeVersion){
     read.displayLease.invalidateDisplayEpisode();read.displayContext=undefined
     publish(read,{displayAllowed:false,displayEpoch:read.receipt.displayEpoch+1})
    }
    // Check generation BEFORE cleanup: an old actor must not purge a new actor's rows.
    synchronizeLeaveScope(client,identity,context.scopeVersion)
    if(!current())throw new DOMException('Obsolete leave context','AbortError')
    read.completed.set(context,attempt);read.displayContext=read.observers>0?context:undefined
    publish(read,{state:'ready',displayAllowed:read.observers>0})
    read.displayLease.completeContext(episode.id)
    return context
   }catch(error){
    if(current()){interrupted();if(!signal.aborted)synchronizeLeaveScope(client,identity)}
    throw error
   }finally{signal.removeEventListener('abort',interrupted)}
  },networkMode:'always',structuralSharing:false,staleTime:0,retry:false,
 } as const
}
/** Both fetching context consumers and non-fetching protected-read owners share
 * one offline invalidation listener for this finite actor authority lifetime. */
function retainAuthorityOwner(client:QueryClient,identity:UUID,read:AuthorityRead,contextOwner=false){
 if(contextOwner)read.contextObservers++
 if(read.observers++===0){
  const offline=()=>{
   const current=isCurrentLeaveIdentity(client,identity,getLeaveIdentityGeneration(client))
   invalidate(read)
   void client.cancelQueries({queryKey:leaveKeys.context(identity,'current'),exact:true})
   if(current){
    if(read.contextObservers>0)synchronizeLeaveScope(client,identity)
    // A standalone observer must not recreate/refetch its query on removal.
    else void client.cancelQueries({queryKey:leaveKeys.identity(identity),predicate:query=>query.queryKey[3]==='private'})
   }
  }
  window.addEventListener('offline',offline)
  read.releaseOffline=()=>window.removeEventListener('offline',offline)
 }
 return()=>{
  if(contextOwner)read.contextObservers--
  if(--read.observers===0){
   read.releaseOffline?.();read.releaseOffline=undefined
   invalidate(read)
   void client.cancelQueries({queryKey:leaveKeys.context(identity,'current'),exact:true})
  }
 }
}
export function useLeaveContext(){
 const {user,profile,loading}=useAuth(),client=useQueryClient()
 const identity=!loading&&user&&profile?.is_active&&profile.id===user.id?user.id:null
 const read=authorityRead(client,identity??'signed-out')
 const subscribe=useCallback((listener:()=>void)=>{read.listeners.add(listener);return()=>{read.listeners.delete(listener)}},[read])
 const receipt=useSyncExternalStore(subscribe,()=>read.receipt,()=>read.receipt)
 useLayoutEffect(()=>{synchronizeLeaveIdentity(client,identity)},[client,identity])
 useLayoutEffect(()=>{
  if(!identity)return
  return retainAuthorityOwner(client,identity,read,true)
 },[client,identity,read])
 const query=useQuery({...contextOptions(client,identity??'signed-out'),enabled:!!identity,
  refetchOnWindowFocus:false,refetchInterval:()=>document.visibilityState==='visible'?60_000:false,refetchIntervalInBackground:false})
 useEffect(()=>{
  const refresh=()=>{if(identity&&document.visibilityState==='visible')void client.fetchQuery(contextOptions(client,identity)).catch(()=>{})}
  window.addEventListener('focus',refresh);window.addEventListener('online',refresh);document.addEventListener('visibilitychange',refresh)
  return()=>{window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',refresh)}
 },[client,identity,read])
 const displayAllowed=!!identity&&read.observers>0&&receipt.displayAllowed
 return {...query,authorityReady:!!identity&&query.isSuccess&&!query.isFetching&&validated(read,query.data),authorityPending:!!identity&&receipt.state==='pending',displayLease:read.displayLease as HRDisplayLease,displayContext:displayAllowed?read.displayContext:undefined,displayAllowed,displayEpoch:receipt.displayEpoch,refreshing:receipt.refreshing}
}
/** Every action still requires a genuine fresh completion; display is never authority. */
export async function runLeaveInteraction<T>(client:QueryClient,identity:UUID,scopeVersion:string,action:(context:LeaveContext)=>Promise<T>|T):Promise<T>{
 const pending=client.fetchQuery(contextOptions(client,identity))
 const read=authorityRead(client,identity),attempt=read.receipt.attempt
 const context=await pending
 if(!validated(read,context,attempt))throw new Error('Akses cuti belum dikonfirmasi. Silakan coba lagi.')
 if(context.scopeVersion!==scopeVersion)throw new Error('Data atau akses cuti berubah. Muat ulang sebelum melanjutkan.')
 return action(context)
}

/** Non-fetching internal subscriber for protected-read owners. Mounting cannot
 * create authority; displayContext still requires the actual context completion. */
export function useLeaveDisplayAuthority(client:QueryClient,identity:UUID){
 const read=authorityRead(client,identity)
 const subscribe=useCallback((listener:()=>void)=>{read.listeners.add(listener);return()=>{read.listeners.delete(listener)}},[read])
 const receipt=useSyncExternalStore(subscribe,()=>read.receipt,()=>read.receipt)
 useLayoutEffect(()=>retainAuthorityOwner(client,identity,read),[client,identity,read])
 const current=isCurrentLeaveIdentity(client,identity,getLeaveIdentityGeneration(client))
 return {displayLease:read.displayLease as HRDisplayLease,displayEpoch:receipt.displayEpoch,displayAllowed:current&&receipt.displayAllowed,refreshing:receipt.refreshing,ready:current&&receipt.state==='ready'}
}
