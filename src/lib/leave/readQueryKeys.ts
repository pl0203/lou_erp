import type { QueryClient } from '@tanstack/react-query'
import { createLeaveKeys, LEAVE_BACKEND, leaveKeys } from './queryKeys'
import type { ApprovalCountFilter, CalendarAudience, CalendarRange } from './readContracts'
export function createLeaveReadKeys(backend:string){
 const keys=createLeaveKeys(backend)
 return {
  access:(actorId:string,scopeVersion:string,audience?:CalendarAudience)=>keys.private(actorId,scopeVersion,'read-access',audience??'default'),
  calendar:(actorId:string,scopeVersion:string,range:CalendarRange,audience:CalendarAudience)=>keys.private(actorId,scopeVersion,'team-calendar',audience,range.from,range.to),
  counts:(actorId:string,scopeVersion:string,filter:ApprovalCountFilter='all')=>keys.private(actorId,scopeVersion,'approval-counts',filter),
 }
}
export const leaveReadKeys=createLeaveReadKeys(LEAVE_BACKEND)
/** Call after a confirmed or reconciled request transition. Whole leave-identity invalidation also covers these. */
export function invalidateLeaveReads(client:QueryClient,actorId:string){
 return client.invalidateQueries({queryKey:leaveKeys.identity(actorId),predicate:query=>query.queryKey[3]==='private'&&['read-access','team-calendar','approval-counts'].includes(String(query.queryKey[5]))})
}
