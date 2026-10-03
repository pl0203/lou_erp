import { supabase } from '../supabase'
import { parseDateKey,parseDurationSelection,parseUUID } from './contracts'
import type { LeaveStatus,UUID } from './contracts'
import type { AssignedDetail,AssignedPage,AssignedSummary,OwnTransitionState,TransitionCommand,TransitionOperation,TransitionReceipt } from './transitionContracts'
import { leaveErrorMessage } from './rpc'
const operations:TransitionOperation[]=['approve_request','reject_request','withdraw_request','request_cancellation','approve_cancellation','decline_cancellation']
const statuses:LeaveStatus[]=['submitted','approved','rejected','withdrawn','cancellation_pending','cancelled']
const summaryKeys=['id','sequence','startDate','endDate','duration','totalMinutes','status','version','submittedAt','sourceKind','employee','cancellationAttemptId','cancellationRequestedAt']
function invalid():never{throw new Error('Respons persetujuan cuti tidak valid. Muat ulang sebelum melanjutkan.')}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))invalid();return value as Record<string,unknown>}
function exact(value:unknown,keys:string[]){const v=object(value);if(Object.keys(v).sort().join(',')!==[...keys].sort().join(','))invalid();return v}
function integer(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)invalid();return value}
function text(value:unknown,max=1000,empty=false):string{if(typeof value!=='string'||value.length>max||(!empty&&!value.trim()))invalid();return value}
function timestamp(value:unknown){const s=text(value,50);if(!/^\d{4}-\d{2}-\d{2}T/.test(s)||!Number.isFinite(Date.parse(s)))invalid();return s}
function assignedSummary(value:unknown):AssignedSummary{
 const v=exact(value,summaryKeys),employee=exact(v.employee,['id','name']),startDate=parseDateKey(v.startDate),endDate=parseDateKey(v.endDate)
 if(startDate>endDate||!['submitted','cancellation_pending'].includes(v.status as string)||!['submission','opening'].includes(v.sourceKind as string))invalid()
 const cancellationAttemptId=v.cancellationAttemptId===null?null:parseUUID(v.cancellationAttemptId),cancellationRequestedAt=v.cancellationRequestedAt===null?null:timestamp(v.cancellationRequestedAt)
 if((v.status==='cancellation_pending')!==(cancellationAttemptId!==null)||(cancellationAttemptId===null)!==(cancellationRequestedAt===null))invalid()
 return {id:parseUUID(v.id),sequence:integer(v.sequence,1),startDate,endDate,duration:parseDurationSelection(v.duration),totalMinutes:integer(v.totalMinutes,1,164700),status:v.status as AssignedSummary['status'],version:integer(v.version,1),submittedAt:timestamp(v.submittedAt),sourceKind:v.sourceKind as AssignedSummary['sourceKind'],employee:{id:parseUUID(employee.id),name:text(employee.name,500)},cancellationAttemptId,cancellationRequestedAt}
}
export function toTransitionPayload(command:TransitionCommand):Record<string,unknown>{
 if(!operations.includes(command.operation))invalid()
 const result:Record<string,unknown>={request_id:parseUUID(command.requestId),expected_version:integer(command.expectedVersion,1)}
 if('reason' in command)result.reason=text(command.reason,1000,command.operation==='request_cancellation')
 if('attemptId' in command)result.attempt_id=parseUUID(command.attemptId)
 return result
}
export function parseTransitionReceipt(value:unknown):TransitionReceipt{
 const v=object(value);if(!operations.includes(v.operation as TransitionOperation))invalid()
 return {id:parseUUID(v.id),version:integer(v.version,2),operation:v.operation as TransitionOperation}
}
async function read(name:string,payload:Record<string,unknown>,signal:AbortSignal):Promise<unknown>{
 let response
 try{response=await supabase.rpc(name,payload).abortSignal(signal)}catch{signal.throwIfAborted();throw new Error('Layanan persetujuan belum dapat dihubungi. Silakan coba lagi.')}
 signal.throwIfAborted();if(response.error)throw new Error(leaveErrorMessage(response.error));return response.data
}
export async function fetchAssignedInbox(before:number|null,limit:number,signal:AbortSignal):Promise<AssignedPage>{
 if(before!==null)integer(before,1);integer(limit,1,100)
 const raw=await read('leave_assigned_inbox_v1',{p_before:before,p_limit:limit},signal)
 try{
  const v=exact(raw,['rows','nextBefore']);if(!Array.isArray(v.rows)||v.rows.length>limit)invalid()
  const rows=v.rows.map(assignedSummary),nextBefore=v.nextBefore===null?null:integer(v.nextBefore,1)
  if(new Set(rows.map(r=>r.id)).size!==rows.length||rows.some((r,i)=>(before!==null&&r.sequence>=before)||(i>0&&r.sequence>=rows[i-1].sequence))||
   (nextBefore!==null&&(!rows.length||nextBefore!==rows.at(-1)!.sequence)))invalid()
  return {rows,nextBefore}
 }catch{return invalid()}
}
export async function fetchAssignedRequest(id:UUID,signal:AbortSignal):Promise<AssignedDetail>{
 parseUUID(id);const raw=await read('leave_assigned_request_v1',{p_request_id:id},signal)
 try{
  const v=exact(raw,[...summaryKeys,'reason','approverName','days','allocations','cancellation']),s=assignedSummary(Object.fromEntries(summaryKeys.map(k=>[k,v[k]])))
  if(s.id!==id||!Array.isArray(v.days)||!v.days.length||v.days.length>366||!Array.isArray(v.allocations)||!v.allocations.length||v.allocations.length>2)invalid()
  const days=v.days.map(value=>{
   const d=exact(value,['date','scheduledMinutes','chargedMinutes','exclusion','groupName']),date=parseDateKey(d.date),scheduledMinutes=integer(d.scheduledMinutes,0,450),chargedMinutes=integer(d.chargedMinutes,0,450)
   if(![0,225,450].includes(scheduledMinutes)||chargedMinutes>scheduledMinutes||![null,'holiday','off_duty'].includes(d.exclusion as string|null)||(scheduledMinutes===0)!==(d.exclusion!==null)||chargedMinutes!==(scheduledMinutes===0?0:s.duration.mode==='full_scheduled_day'?scheduledMinutes:s.duration.minutes))invalid()
   return {date,scheduledMinutes:scheduledMinutes as 0|225|450,chargedMinutes,exclusion:d.exclusion as 'holiday'|'off_duty'|null,groupName:d.groupName===null?null:text(d.groupName,500)}
  })
  if(days[0].date!==s.startDate||days.at(-1)!.date!==s.endDate||days.reduce((n,d)=>n+d.chargedMinutes,0)!==s.totalMinutes||days.some((d,i)=>i>0&&Date.parse(d.date+'T00:00:00Z')-Date.parse(days[i-1].date+'T00:00:00Z')!==86400000))invalid()
  const allocations=v.allocations.map(value=>{
   const a=exact(value,['year','startDate','endDate','chargedMinutes']),year=integer(a.year,1,9998),startDate=parseDateKey(a.startDate),endDate=parseDateKey(a.endDate),chargedMinutes=integer(a.chargedMinutes,1,164700)
   if(startDate!==`${String(year).padStart(4,'0')}-01-01`||endDate!==`${String(year+1).padStart(4,'0')}-01-01`||days.filter(d=>Number(d.date.slice(0,4))===year).reduce((n,d)=>n+d.chargedMinutes,0)!==chargedMinutes)invalid()
   return {year,startDate,endDate,chargedMinutes}
  })
  if(allocations.reduce((n,a)=>n+a.chargedMinutes,0)!==s.totalMinutes||allocations.some((a,i)=>i>0&&a.year<=allocations[i-1].year))invalid()
  let cancellation:AssignedDetail['cancellation']=null
  if(v.cancellation!==null){const c=exact(v.cancellation,['id','requestedAt','reason','approverName']);cancellation={id:parseUUID(c.id),requestedAt:timestamp(c.requestedAt),reason:text(c.reason,1000,true),approverName:text(c.approverName,500)}}
  if((s.status==='cancellation_pending')!==(cancellation!==null)||cancellation?.id!==(s.cancellationAttemptId??undefined)||cancellation?.requestedAt!==(s.cancellationRequestedAt??undefined))invalid()
  return {...s,reason:text(v.reason,1000,true),approverName:text(v.approverName,500),days,allocations,cancellation}
 }catch{return invalid()}
}
export async function fetchOwnTransitionState(id:UUID,signal:AbortSignal):Promise<OwnTransitionState>{
 parseUUID(id);const raw=await read('leave_request_transition_state_v1',{p_request_id:id},signal)
 try{
  const v=exact(raw,['id','version','status','canWithdraw','canRequestCancellation','cancellationBlocker','activeAttemptId'])
  if(parseUUID(v.id)!==id||!statuses.includes(v.status as LeaveStatus)||typeof v.canWithdraw!=='boolean'||typeof v.canRequestCancellation!=='boolean')invalid()
  const blocker=v.cancellationBlocker===null?null:text(v.cancellationBlocker,100),activeAttemptId=v.activeAttemptId===null?null:parseUUID(v.activeAttemptId)
  if(v.canWithdraw!==(v.status==='submitted')||v.canRequestCancellation!==(v.status==='approved'&&blocker===null)||(v.status==='cancellation_pending')!==(activeAttemptId!==null)||(v.status!=='approved'&&blocker!==null))invalid()
  return {id,version:integer(v.version,1),status:v.status as LeaveStatus,canWithdraw:v.canWithdraw,canRequestCancellation:v.canRequestCancellation,cancellationBlocker:blocker,activeAttemptId}
 }catch{return invalid()}
}
