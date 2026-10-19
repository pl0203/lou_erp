import type { LeaveContext } from './contracts'
import { leaveKeys } from './queryKeys'
import { useAuthorizedLeaveRead } from './useLeaveReads'
import { fetchTeamCalendar,fetchTeamCalendarAccess } from './teamCalendarRpc'
import type { CalendarView,TeamCalendarAudience } from './teamCalendarContracts'
export const teamCalendarKeys={
 access:(actor:string,scope:string,audience?:TeamCalendarAudience)=>leaveKeys.private(actor,scope,'team-calendar-access-v2',audience??'default'),
 page:(actor:string,scope:string,period:string,view:CalendarView,audience:TeamCalendarAudience,page:number,pageSize:number)=>leaveKeys.private(actor,scope,'team-calendar-v2',audience,view,period,page,pageSize),
}
export function useTeamCalendarAccess(actorId:string,context:LeaveContext,enabled=true,audience?:TeamCalendarAudience){
 return useAuthorizedLeaveRead(actorId,context,[...teamCalendarKeys.access(actorId,context.scopeVersion,audience),enabled?'enabled':'disabled'],async signal=>{
  const result=await fetchTeamCalendarAccess(signal,audience)
  if(result.scopeVersion!==context.scopeVersion)throw new Error('Data atau akses cuti berubah. Muat ulang sebelum melanjutkan.')
  return result
 },enabled)
}
export function useTeamCalendar(actorId:string,context:LeaveContext,period:string,view:CalendarView,audience:TeamCalendarAudience,page:number,enabled=true){
 return useAuthorizedLeaveRead(actorId,context,teamCalendarKeys.page(actorId,context.scopeVersion,period,view,audience,page,25),async signal=>{
  const result=await fetchTeamCalendar(period,view,audience,page,25,signal)
  if(result.scopeVersion!==context.scopeVersion)throw new Error('Data atau akses cuti berubah. Muat ulang sebelum melanjutkan.')
  return result
 },enabled,live=>audience!=='director_all'||live.memberKind==='director')
}
