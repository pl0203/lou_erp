import { supabase } from '../supabase'
import { leaveErrorMessage } from './rpc'
import { parseCalendarAudience, parseCalendarAvailability, parseCalendarRange, parseLeaveApprovalCounts, parseLeaveReadAccess } from './readContracts'
import type { CalendarAudience, CalendarRange } from './readContracts'
export async function fetchLeaveReadAccess(signal:AbortSignal,audience?:CalendarAudience,director=false){
 signal.throwIfAborted()
 if(audience!==undefined)parseCalendarAudience(audience)
 const request=director||audience==='director_all'?supabase.rpc('leave_director_calendar_context_v1',{p_audience:audience??'director_all'}):audience===undefined?supabase.rpc('leave_reads_context_v1'):supabase.rpc('leave_reads_context_v1',{p_audience:audience})
 const {data,error}=await request.abortSignal(signal)
 signal.throwIfAborted();if(error)throw new Error(leaveErrorMessage(error));return parseLeaveReadAccess(data)
}
export async function fetchLeaveCalendar(range:CalendarRange,audience:CalendarAudience,signal:AbortSignal){
 signal.throwIfAborted();const {from,to}=parseCalendarRange(range);parseCalendarAudience(audience)
 const {data,error}=await supabase.rpc(audience==='director_all'?'leave_director_calendar_v1':'leave_calendar_v1',audience==='director_all'?{p_from:from,p_to:to}:{p_from:from,p_to:to,p_audience:audience}).abortSignal(signal)
 signal.throwIfAborted();if(error)throw new Error(leaveErrorMessage(error))
 const rows=parseCalendarAvailability(data)
 if(rows.some(row=>row.date<from||row.date>to))throw new Error('Respons layanan cuti tidak valid. Silakan muat ulang.')
 return rows
}
export async function fetchLeaveApprovalCounts(signal:AbortSignal){
 signal.throwIfAborted()
 const {data,error}=await supabase.rpc('leave_approval_counts_v1').abortSignal(signal)
 signal.throwIfAborted();if(error)throw new Error(leaveErrorMessage(error));return parseLeaveApprovalCounts(data)
}

