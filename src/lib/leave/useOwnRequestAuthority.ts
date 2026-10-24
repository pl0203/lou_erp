import { useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore } from 'react'
import { useQuery,useQueryClient } from '@tanstack/react-query'
import {useAuth} from '../AuthContext'
import {synchronizeLeaveIdentity} from './queryKeys'
import {runBoundedHRCheck} from '../hr/revalidation'
import {useHRDisplayContinuity,useHRDisplayOwner} from '../hr/useHRDisplayContinuity'
import { runLeaveInteraction,useLeaveDisplayAuthority } from './useLeaveContext'
/** Each opening, page, detail, retry and foreground event needs a genuine completed authority read. */
export function useOwnRequestAuthority(actorId:string,scopeVersion:string,resource:string){
 const client=useQueryClient(),displayAuthority=useLeaveDisplayAuthority(client,actorId),[attempt,setAttempt]=useState(0),interaction=JSON.stringify([actorId,scopeVersion,resource,attempt])
 const {user,profile,loading}=useAuth()
 const identity=!loading&&user&&profile?.is_active&&profile.id===user.id?user.id:null
 useLayoutEffect(()=>{synchronizeLeaveIdentity(client,identity)},[client,identity])
 const pending=useRef(false)
 const [gate,setGate]=useState<{interaction:string;status:'pending'|'ready'|'denied'}|null>(null)
 useEffect(()=>{
  const abort=new AbortController();pending.current=true;displayAuthority.displayLease.startDisplayEpisode();setGate({interaction,status:'pending'})
  void runLeaveInteraction(client,actorId,scopeVersion,live=>{
   abort.signal.throwIfAborted()
   if(!live.capabilities.request||!['employee','manager'].includes(live.memberKind??''))throw new Error('authority-revoked')
  }).then(()=>{if(!abort.signal.aborted){pending.current=false;setGate({interaction,status:'ready'})}},()=>{if(!abort.signal.aborted){pending.current=false;setGate({interaction,status:'denied'})}})
  return()=>{abort.abort();pending.current=false}
 },[client,actorId,scopeVersion,interaction])
 useEffect(()=>{
  const refresh=()=>{if(!pending.current)setAttempt(value=>value+1)},foreground=()=>{if(document.visibilityState==='visible')refresh()}
  window.addEventListener('focus',foreground);document.addEventListener('visibilitychange',foreground)
  const timer=window.setInterval(foreground,60_000)
  return()=>{window.removeEventListener('focus',foreground);document.removeEventListener('visibilitychange',foreground);window.clearInterval(timer)}
 },[])
 // Verified identity is a current-render display boundary, independent of the
 // routine pending gate. Layout cleanup alone would expose one obsolete frame.
 return {displayAuthority:{...displayAuthority,displayAllowed:identity===actorId&&displayAuthority.displayAllowed},interaction,ready:identity===actorId&&gate?.interaction===interaction&&gate.status==='ready',denied:gate?.interaction===interaction&&gate.status==='denied',retry:()=>{if(!pending.current)setAttempt(value=>value+1)}}
}

type OwnReadReceipt={attempt:number;pending:boolean;terminal:boolean;completed:WeakMap<object,number>;revision:number;listeners:Set<()=>void>}
const ownReadReceipts=new WeakMap<object,OwnReadReceipt>()

/** Local own-request gate plus a genuine per-mounted-read completion. A cached
 * success cannot satisfy this proof, including TanStack cancellation rollback. */
export function useOwnRequestRead<T extends object>(authority:Pick<ReturnType<typeof useOwnRequestAuthority>,'ready'|'denied'|'displayAuthority'>,key:readonly unknown[],read:(signal:AbortSignal)=>Promise<T>,enabled=true,terminalFailure=false){
 const client=useQueryClient(),displayAuthority=authority.displayAuthority,serialized=JSON.stringify(key)
 const owner=useHRDisplayOwner(displayAuthority.displayLease,serialized,displayAuthority.displayEpoch)
 const queryOwner=client.getQueryCache().build(client,{queryKey:key})
 let receipt=ownReadReceipts.get(queryOwner)
 if(!receipt){receipt={attempt:0,pending:false,terminal:false,completed:new WeakMap(),revision:0,listeners:new Set()};ownReadReceipts.set(queryOwner,receipt)}
 const proof=receipt
 const entry=useMemo(()=>({floor:proof.attempt+(proof.pending?0:1)}),[proof,serialized,displayAuthority.displayEpoch])
 const publish=()=>{proof.revision++;proof.listeners.forEach(listener=>listener())}
 const subscribe=useCallback((listener:()=>void)=>{proof.listeners.add(listener);return()=>{proof.listeners.delete(listener)}},[proof])
 useSyncExternalStore(subscribe,()=>proof.revision,()=>proof.revision)
 useLayoutEffect(()=>client.getQueryCache().subscribe(event=>{
  if(JSON.stringify(event.query.queryKey)!==serialized)return
  if(event.type==='removed'||event.type==='updated'&&(event.action.type==='pause'||event.action.type==='error'||event.action.type==='success'&&event.action.manual)){proof.terminal=true;proof.pending=false;publish()}
 }),[client,serialized,proof])
 const query=useQuery({queryKey:key,queryFn:async({signal})=>{
  owner.begin();const attempt=++proof.attempt;proof.terminal=false;proof.pending=true;publish()
  const interrupted=()=>{if(proof.attempt===attempt){proof.terminal=true;proof.pending=false;publish()}}
  signal.addEventListener('abort',interrupted,{once:true})
  try{signal.throwIfAborted();if(!authority.ready)throw new Error('Akses cuti belum dikonfirmasi.')
   const result=await runBoundedHRCheck(signal,read,interrupted);signal.throwIfAborted()
   if(proof.attempt!==attempt)throw new Error('Obsolete own request read')
   proof.completed.set(result,attempt);proof.pending=false;publish();return result
  }catch(error){interrupted();throw error}finally{signal.removeEventListener('abort',interrupted)}
 },enabled:enabled&&authority.ready,retry:false,structuralSharing:false,networkMode:'always',refetchOnWindowFocus:false,refetchOnReconnect:false})
 const available=enabled&&authority.ready&&proof.attempt>=entry.floor&&query.isSuccess&&!query.isFetching&&!proof.terminal&&!!query.data&&proof.completed.get(query.data)===proof.attempt
 const displayAllowed=displayAuthority.displayAllowed&&!authority.denied&&!terminalFailure
 const display=useHRDisplayContinuity({key:serialized,epoch:displayAuthority.displayEpoch,allowed:displayAllowed,validatedData:available?query.data:undefined,pending:displayAuthority.refreshing||!authority.ready||query.isFetching,terminalFailure:terminalFailure||proof.terminal||query.isError})
 const episodeId=displayAuthority.displayLease.getDisplayEpisode()?.id
 useLayoutEffect(()=>{if(!displayAllowed||proof.terminal||query.isError||display.displayData===undefined)owner.eligible(false);else if(available&&displayAuthority.ready)owner.settle(true,episodeId)},[owner,available,displayAllowed,proof.terminal,query.isError,display.displayData,displayAuthority.ready,episodeId])
 return {...query,...display,displayAllowed,available,data:available?query.data:undefined}
}
