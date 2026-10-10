import { useCallback, useEffect, useLayoutEffect, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { useAuth } from '../AuthContext'
import type { LeaveContext } from './contracts'
import type { ApprovalCountFilter, CalendarAudience, CalendarRange } from './readContracts'
import { fetchLeaveApprovalCounts, fetchLeaveCalendar, fetchLeaveReadAccess } from './readRpc'
import { leaveReadKeys } from './readQueryKeys'
import { synchronizeLeaveIdentity } from './queryKeys'
import { runLeaveInteraction } from './useLeaveContext'
export { approvalCountForFilter } from './readContracts'
export { invalidateLeaveReads } from './readQueryKeys'
type ReadProof={attempt:number;state:'unvalidated'|'pending'|'ready';revision:number;completed:WeakMap<object,number>;listeners:Set<()=>void>}
type ClientProofs={reads:Map<string,ReadProof>;authority:Map<string,ReadProof>}
const clientProofs=new WeakMap<QueryClient,ClientProofs>()
function newProof():ReadProof{return {attempt:0,state:'unvalidated',revision:0,completed:new WeakMap(),listeners:new Set()}}
function publish(proof:ReadProof,state:ReadProof['state']){proof.state=state;proof.revision++;proof.listeners.forEach(listener=>listener())}
/** Receipts contain only counters and weak references. Cache cancellation can restore
 * query state/data, but cannot restore either the read or authority completion proof. */
function proofsFor(client:QueryClient){
 let proofs=clientProofs.get(client);if(proofs)return proofs
 proofs={reads:new Map(),authority:new Map()};clientProofs.set(client,proofs)
 const state=proofs
 client.getQueryCache().subscribe(event=>{
  const key=event.query.queryKey,authority=key[3]==='context'&&key[4]==='current'
  const proof=(authority?state.authority:state.reads).get(JSON.stringify(key));if(!proof)return
  if(event.type==='removed'){publish(proof,'unvalidated');return}
  if(event.type!=='updated'||client.getQueryCache().find({queryKey:key,exact:true})!==event.query)return
  const action=event.action
  if(action.type==='fetch'){
   if(authority){proof.attempt++;publish(proof,'pending')}else publish(proof,'unvalidated')
  }else if(action.type==='error'||action.type==='pause'||action.type==='invalidate')publish(proof,'unvalidated')
  else if(action.type==='success'){
   if(action.manual)publish(proof,'unvalidated')
   else if(authority&&event.query.state.data&&typeof event.query.state.data==='object'){
    if(!proof.attempt)proof.attempt++
    proof.completed.set(event.query.state.data,proof.attempt);publish(proof,'ready')
   }
  }
 })
 return proofs
}
function scopedProof(client:QueryClient,key:readonly unknown[]){
 const proofs=proofsFor(client),name=JSON.stringify(key),authorityKey=[key[0],key[1],key[2],'context','current'] as const,authorityName=JSON.stringify(authorityKey)
 let read=proofs.reads.get(name);if(!read){read=newProof();proofs.reads.set(name,read)}
 let authority=proofs.authority.get(authorityName);if(!authority){authority=newProof();proofs.authority.set(authorityName,authority)}
 return {read,authority,authorityKey}
}
function completed(proof:ReadProof,value:object|undefined){return !!value&&proof.state==='ready'&&proof.completed.get(value)===proof.attempt}
/** Each refetch acquires a genuine current-authority receipt before reading. No cached
 * placeholder is exposed during pending, failed, revoked or disabled authority. */
export function useAuthorizedLeaveRead<T extends object>(actorId:string,context:LeaveContext,key:readonly unknown[],read:(signal:AbortSignal)=>Promise<T>,enabled:boolean,authorize:(live:LeaveContext)=>boolean=()=>true){
 const client=useQueryClient(),{user,profile,loading}=useAuth()
 const identity=!loading&&user&&profile?.is_active&&profile.id===user.id?user.id:null
 const allowed=enabled&&identity===actorId
 const {read:proof,authority,authorityKey}=scopedProof(client,key)
 const subscribe=useCallback((listener:()=>void)=>{proof.listeners.add(listener);authority.listeners.add(listener);return()=>{proof.listeners.delete(listener);authority.listeners.delete(listener)}},[proof,authority])
 useSyncExternalStore(subscribe,()=>proof.revision+authority.revision,()=>proof.revision+authority.revision)
 useLayoutEffect(()=>{synchronizeLeaveIdentity(client,identity)},[client,identity])
 const query=useQuery({queryKey:key,queryFn:async({signal})=>{
  const attempt=++proof.attempt;publish(proof,'pending')
  const interrupted=()=>{if(proof.attempt===attempt)publish(proof,'unvalidated')}
  signal.addEventListener('abort',interrupted,{once:true})
  try{
   signal.throwIfAborted();if(!allowed)throw new Error('Akses cuti tidak tersedia. Muat ulang.')
   const result=await runLeaveInteraction(client,actorId,context.scopeVersion,live=>{
    signal.throwIfAborted();if(!authorize(live))throw new Error('Akses cuti tidak tersedia. Muat ulang.')
    return read(signal)
   })
   signal.throwIfAborted();proof.completed.set(result,attempt)
   if(proof.attempt===attempt)publish(proof,'ready')
   return result
  }catch(error){interrupted();throw error}finally{signal.removeEventListener('abort',interrupted)}
 },enabled:allowed,staleTime:0,retry:false,networkMode:'always',structuralSharing:false,refetchOnWindowFocus:false,
 refetchInterval:()=>allowed&&document.visibilityState==='visible'?60_000:false,refetchIntervalInBackground:false})
 useEffect(()=>{
  const refresh=()=>{if(allowed&&document.visibilityState==='visible')void query.refetch()}
  window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh)
  return()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh)}
 },[allowed,query.refetch])
 const currentAuthority=client.getQueryData<LeaveContext>(authorityKey),authorityState=client.getQueryState(authorityKey)
 const authorityReady=authorityState?.status==='success'&&authorityState.fetchStatus==='idle'&&completed(authority,currentAuthority)
  &&currentAuthority?.scopeVersion===context.scopeVersion&&authorize(currentAuthority)
 const isCurrent=(value?:T)=>{
  const current=client.getQueryState<T>(key),live=client.getQueryData<LeaveContext>(authorityKey),liveState=client.getQueryState(authorityKey)
  return allowed&&current?.status==='success'&&current.fetchStatus==='idle'&&!current.isInvalidated&&(!value||current.data===value)&&completed(proof,current.data)
   &&liveState?.status==='success'&&liveState.fetchStatus==='idle'&&completed(authority,live)&&live?.scopeVersion===context.scopeVersion&&authorize(live)
 }
 const available=allowed&&query.isSuccess&&query.fetchStatus==='idle'&&completed(proof,query.data)&&authorityReady
 return {...query,data:available?query.data:undefined,available,isCurrent}
}
export function useLeaveReadAccess(actorId:string,context:LeaveContext,enabled=true,audience?:CalendarAudience){
 return useAuthorizedLeaveRead(actorId,context,leaveReadKeys.access(actorId,context.scopeVersion,audience),async signal=>{
  const access=await fetchLeaveReadAccess(signal,audience)
  if(access.scopeVersion!==context.scopeVersion)throw new Error('Data atau akses cuti berubah. Muat ulang sebelum melanjutkan.')
  return access
 },enabled)
}
export function useLeaveCalendar(actorId:string,context:LeaveContext,range:CalendarRange,audience:CalendarAudience,enabled=true){
 return useAuthorizedLeaveRead(actorId,context,leaveReadKeys.calendar(actorId,context.scopeVersion,range,audience),signal=>fetchLeaveCalendar(range,audience,signal),enabled,
  live=>audience!=='own'||live.memberKind==='employee'||live.memberKind==='manager')
}
export function useLeaveApprovalCounts(actorId:string,context:LeaveContext,filter:ApprovalCountFilter='all',enabled=true){
 return useAuthorizedLeaveRead(actorId,context,leaveReadKeys.counts(actorId,context.scopeVersion,filter),fetchLeaveApprovalCounts,enabled&&context.capabilities.approve,
  live=>live.capabilities.approve)
}
