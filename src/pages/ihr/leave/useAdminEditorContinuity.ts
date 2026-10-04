import { useEffect, useRef, useState } from 'react'

/** An own confirmed command may bridge one context refresh, but only a completed
 * current read with the same authority can expose its remaining ephemeral draft.
 * External scope changes and different grants remount the editor immediately. */
export function useAdminEditorContinuity(scope:string,authority:string|undefined,fresh:boolean,isCurrent:()=>boolean,denied=false){
 const [,render]=useState(0),observed=useRef({scope,authority,epoch:0})
 const own=useRef<{authority:string|undefined;proved:boolean;nextScope?:string}|null>(null)
 const waiter=useRef<(()=>void)|null>(null),wasDenied=useRef(false)
 if(denied&&!wasDenied.current){own.current=null;observed.current={scope,authority,epoch:observed.current.epoch+1}}
 wasDenied.current=denied
 if(observed.current.scope!==scope){
  if(own.current){
   if(own.current.nextScope===undefined)own.current.nextScope=scope
   else if(own.current.nextScope!==scope)own.current=null
  }
  if(!own.current)observed.current={scope,authority,epoch:observed.current.epoch+1}
 }
 if(authority!==undefined&&observed.current.authority!==authority){
  if(observed.current.authority!==undefined)observed.current.epoch++
  observed.current.authority=authority
 }
 const epoch=observed.current.epoch
 useEffect(()=>{
  if(!waiter.current||own.current&&(!fresh||!isCurrent()))return
  if(own.current){if(own.current.authority===authority)own.current.proved=true;else own.current=null;observed.current.scope=scope}
  const resolve=waiter.current;waiter.current=null;resolve();render(n=>n+1)
 })
 useEffect(()=>()=>{waiter.current?.();waiter.current=null;own.current=null},[])
 return {
  key:epoch,
  retaining:!!own.current,
  ready:!denied&&fresh&&(!own.current||own.current.proved),
  // Called only after the canonical transport validates a successful receipt,
  // before its invalidation starts the shared context/readback refresh.
  onReceipt(){if(epoch===observed.current.epoch){own.current={authority:observed.current.authority,proved:false};render(n=>n+1)}},
  wait(){if(!own.current)return Promise.resolve();return new Promise<void>(resolve=>{waiter.current=resolve;render(n=>n+1)})},
  onSaved({hasUnsavedChanges}:{hasUnsavedChanges:boolean}){
   if(epoch!==observed.current.epoch)return
   own.current=null
   // A clean editor can reinitialize from the authoritative response. A dirty
   // editor keeps Task 3's independent per-section baselines and input state.
   if(!hasUnsavedChanges)observed.current.epoch++
   render(n=>n+1)
  },
 }
}
