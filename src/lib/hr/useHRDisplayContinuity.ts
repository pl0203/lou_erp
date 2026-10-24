import { useLayoutEffect, useMemo, useRef } from 'react'
import type { HRDisplayLease } from './revalidation'

/** Ephemeral presentation only. Callers supply completed strict receipts, never cache data. */
export function useHRDisplayContinuity<T>({key,epoch,allowed,validatedData,pending,terminalFailure}:{key:string;epoch:number;allowed:boolean;validatedData:T|undefined;pending:boolean;terminalFailure:boolean}):{displayData:T|undefined;refreshing:boolean}{
 const retained=useRef<{key:string;epoch:number;value:T}|undefined>(undefined)
 // Deliberately checked in this render, not a passive/layout effect: a changed
 // target must never expose its predecessor even for one committed frame.
 if(!allowed||terminalFailure||retained.current?.key!==key||retained.current?.epoch!==epoch)retained.current=undefined
 if(allowed&&!terminalFailure&&validatedData!==undefined)retained.current={key,epoch,value:validatedData}
 else if(!pending)retained.current=undefined
 const displayData=retained.current?.value
 return {displayData,refreshing:pending&&displayData!==undefined}
}

/** Finite mounted owner. Genuine completion is acknowledged only after the strict
 * adapter predicate accepts the returned value, spanning context → query handoff. */
export function useHRDisplayOwner(lease:HRDisplayLease,key:string,epoch:number){
 const owner=useMemo(()=>({token:Symbol('hr-read-display')}),[lease,key,epoch])
 useLayoutEffect(()=>lease.registerDisplayOwner(owner.token),[lease,owner])
 return useMemo(()=>({
  begin(){const episode=lease.startDisplayEpisode();lease.setDisplayOwnerPending(owner.token,true,episode.id);return episode.id},
  settle(eligible:boolean,episodeId:number|undefined){lease.setDisplayOwnerEligible(owner.token,eligible);if(episodeId!==undefined)lease.setDisplayOwnerPending(owner.token,false,episodeId)},
  eligible(eligible:boolean){lease.setDisplayOwnerEligible(owner.token,eligible)},
 }),[lease,owner])
}
