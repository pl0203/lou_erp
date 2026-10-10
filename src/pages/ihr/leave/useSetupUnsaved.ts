import { useLayoutEffect } from 'react'
/** Drafts remain in memory. Parent handles in-app navigation confirmation when wiring settings. */
export function useSetupUnsaved(dirty:boolean){
 // Keep the guard in sync with the committed draft, before the browser can
 // observe a saved form or leave with a newly dirty one.
 useLayoutEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty])
}
