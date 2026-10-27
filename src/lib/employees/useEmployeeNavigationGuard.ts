import {useId} from 'react'
import {useBeforeSignOut} from '../AuthContext'
import {useUnsavedChanges} from '../useUnsavedChanges'
/** Mount exactly once per editor. Render dialog once; do not also register an IHRNav guard.
 * Use runWithoutPrompt only after a confirmed command receipt, never on failure/uncertainty.
 * Pass draftGeneration to cancel old sign-out decisions when authority is lost. */
export function useEmployeeNavigationGuard({dirty,pending}:{dirty:boolean;pending:boolean},editorGeneration?:string|number) {
 const id=useId(),guard=useUnsavedChanges(dirty||pending)
 useBeforeSignOut(signal=>guard.confirmDiscardDecision({signal}),editorGeneration??id)
 return {...guard,confirmDiscard(action:()=>void,options?:{when?:boolean;message?:string}) {guard.confirmDiscard(()=>guard.runWithoutPrompt(action),options)}}
}
