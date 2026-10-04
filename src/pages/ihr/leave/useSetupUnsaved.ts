import { useEffect } from 'react'
/** Drafts remain in memory. Parent handles in-app navigation confirmation when wiring settings. */
export function useSetupUnsaved(dirty:boolean){
 useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty])
}
