import { supabase } from '../supabase'
import { leaveErrorMessage } from './rpc'
import { parsePeriodStart,parseCalendarView,parseTeamAudience,parseTeamCalendarAccess,parseTeamCalendarPage,parseTeamPageInput } from './teamCalendarContracts'
import type { CalendarView,TeamCalendarAudience } from './teamCalendarContracts'
export async function fetchTeamCalendarAccess(signal:AbortSignal,audience?:TeamCalendarAudience){
 signal.throwIfAborted();if(audience!==undefined)parseTeamAudience(audience)
 const {data,error}=await supabase.rpc('leave_team_calendar_context_v1',audience===undefined?{}:{p_audience:audience}).abortSignal(signal)
 signal.throwIfAborted();if(error)throw new Error(leaveErrorMessage(error));return parseTeamCalendarAccess(data)
}
export async function fetchTeamCalendar(period:string,view:CalendarView,audience:TeamCalendarAudience,page:number,pageSize:number,signal:AbortSignal){
 signal.throwIfAborted();parseCalendarView(view);const periodStart=parsePeriodStart(period,view);parseTeamAudience(audience);parseTeamPageInput(page,pageSize)
 const {data,error}=await supabase.rpc('leave_team_calendar_v1',{p_period_start:periodStart,p_view:view,p_audience:audience,p_page:page,p_page_size:pageSize}).abortSignal(signal)
 signal.throwIfAborted();if(error)throw new Error(leaveErrorMessage(error))
 const result=parseTeamCalendarPage(data)
 if(result.periodStart!==periodStart||result.view!==view||result.page!==page||result.pageSize!==pageSize)throw new Error('Respons layanan cuti tidak valid. Silakan muat ulang.')
 return result
}
