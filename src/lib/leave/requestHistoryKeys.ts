import type { UUID } from './contracts'
import { createLeaveKeys, LEAVE_BACKEND } from './queryKeys'
/** Owned request reads include backend, actor, current authority revision and exact server filters. */
export function createOwnRequestKeys(backend:string){
 const keys=createLeaveKeys(backend)
 return {
  history:(actor:UUID,scope:string,before:number|null,limit:number)=>keys.private(actor,scope,'own-history',{before,limit}),
  transition:(actor:UUID,scope:string,id:UUID,version:number)=>keys.private(actor,scope,'own-transition-state',id,version),
  events:(actor:UUID,scope:string,id:UUID,version:number,before:{atTime:string;id:UUID}|null,limit:number)=>keys.private(actor,scope,'own-request-events',id,version,{before,limit}),
  detail:(actor:UUID,scope:string,id:UUID,version:number)=>keys.private(actor,scope,'own-request',id,version),
 }
}
export const ownRequestKeys=createOwnRequestKeys(LEAVE_BACKEND)
