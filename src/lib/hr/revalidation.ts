/** One safety bound for context transport and its finite retained-display episode. */
export const HR_REVALIDATION_TIMEOUT_MS = 10_000
export async function runBoundedHRCheck<T>(signal:AbortSignal,check:(signal:AbortSignal)=>Promise<T>,onTimeout:()=>void):Promise<T>{
 const controller=new AbortController()
 let timer:ReturnType<typeof setTimeout>|undefined,interrupt:()=>void=()=>{}
 const cancelled=new Promise<never>((_,reject)=>{
  interrupt=()=>{controller.abort(signal.reason);reject(new DOMException('HR check cancelled','AbortError'))}
  if(signal.aborted){interrupt();return}
  signal.addEventListener('abort',interrupt,{once:true})
  // Settle the canonical timeout first; cooperative abort must not win the race.
  timer=setTimeout(()=>{reject(new DOMException('HR check timed out','TimeoutError'));controller.abort();onTimeout()},HR_REVALIDATION_TIMEOUT_MS)
 })
 try{return await Promise.race([cancelled,signal.aborted?cancelled:check(controller.signal)])}
 finally{if(timer!==undefined)clearTimeout(timer);signal.removeEventListener('abort',interrupt)}
}
export type HRDisplayEpisode=Readonly<{id:number;deadline:number}>
/** Internal adapter contract, not action authority. Late children must not release
 * a newer episode: all completions carry their captured episode id. */
export type HRDisplayLease={
 startDisplayEpisode:()=>HRDisplayEpisode
 registerDisplayOwner:(token:symbol)=>()=>void
 setDisplayOwnerEligible:(token:symbol,eligible:boolean)=>void
 setDisplayOwnerPending:(token:symbol,pending:boolean,episodeId:number)=>void
 getDisplayEpisode:()=>HRDisplayEpisode|undefined
 invalidateDisplayEpisode:()=>void
}
export function createHRDisplayLease(onTimeout:()=>void,onRefreshing:(refreshing:boolean)=>void){
 let sequence=0,episode:HRDisplayEpisode|undefined,contextPending=false,timer:ReturnType<typeof setTimeout>|undefined
 const owners=new Map<symbol,{eligible:boolean;pending:boolean}>()
 const finish=()=>{
  if(!episode||contextPending||Array.from(owners.values()).some(owner=>owner.pending))return
  clearTimeout(timer);timer=undefined;episode=undefined;onRefreshing(false)
 }
 const lease:HRDisplayLease={
  startDisplayEpisode(){
   if(episode)return episode
   episode={id:++sequence,deadline:Date.now()+HR_REVALIDATION_TIMEOUT_MS}
   const id=episode.id
   for(const owner of owners.values())owner.pending=owner.eligible
   timer=setTimeout(()=>{if(episode?.id!==id)return;lease.invalidateDisplayEpisode();onTimeout()},HR_REVALIDATION_TIMEOUT_MS)
   onRefreshing(true)
   return episode
  },
  registerDisplayOwner(token){
   if(!owners.has(token))owners.set(token,{eligible:false,pending:false})
   return()=>{owners.delete(token);finish()}
  },
  setDisplayOwnerEligible(token,eligible){const owner=owners.get(token);if(!owner)return;owner.eligible=eligible;if(!eligible){owner.pending=false;finish()}},
  setDisplayOwnerPending(token,pending,episodeId){if(episode?.id!==episodeId)return;const owner=owners.get(token);if(!owner)return;owner.pending=pending&&owner.eligible;finish()},
  getDisplayEpisode:()=>episode,
  invalidateDisplayEpisode(){
   clearTimeout(timer);timer=undefined;episode=undefined;contextPending=false
   for(const owner of owners.values()){owner.eligible=false;owner.pending=false}
   onRefreshing(false)
  },
 }
 return {...lease,
  beginContext(){const value=lease.startDisplayEpisode();contextPending=true;return value},
  completeContext(id:number){if(episode?.id!==id)return;contextPending=false;finish()},
 }
}
