import { useEffect,useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { runLeaveInteraction } from './useLeaveContext'
/** Each opening, page, detail, retry and foreground event needs a genuine completed authority read. */
export function useOwnRequestAuthority(actorId:string,scopeVersion:string,resource:string){
 const client=useQueryClient(),[attempt,setAttempt]=useState(0),interaction=JSON.stringify([actorId,scopeVersion,resource,attempt])
 const [gate,setGate]=useState<{interaction:string;status:'pending'|'ready'|'denied'}|null>(null)
 useEffect(()=>{
  const abort=new AbortController();setGate({interaction,status:'pending'})
  void runLeaveInteraction(client,actorId,scopeVersion,live=>{
   abort.signal.throwIfAborted()
   if(!live.capabilities.request||!['employee','manager'].includes(live.memberKind??''))throw new Error('authority-revoked')
  }).then(()=>{if(!abort.signal.aborted)setGate({interaction,status:'ready'})},()=>{if(!abort.signal.aborted)setGate({interaction,status:'denied'})})
  return()=>abort.abort()
 },[client,actorId,scopeVersion,interaction])
 useEffect(()=>{
  const refresh=()=>setAttempt(value=>value+1),foreground=()=>{if(document.visibilityState==='visible')refresh()}
  window.addEventListener('focus',foreground);document.addEventListener('visibilitychange',foreground)
  const timer=window.setInterval(foreground,60_000)
  return()=>{window.removeEventListener('focus',foreground);document.removeEventListener('visibilitychange',foreground);window.clearInterval(timer)}
 },[])
 return {ready:gate?.interaction===interaction&&gate.status==='ready',denied:gate?.interaction===interaction&&gate.status==='denied',retry:()=>setAttempt(value=>value+1)}
}
