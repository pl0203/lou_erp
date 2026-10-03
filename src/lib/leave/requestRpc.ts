import { supabase } from '../supabase'
import { parseDateKey,parseDurationSelection,parseUUID } from './contracts'
import type { LeaveStatus,UUID } from './contracts'
import type { LeaveQuoteInput } from './quoteContracts'
import type { OwnRequestDetail,OwnRequestPage,OwnRequestSummary,RequestReceipt } from './requestContracts'
import { toQuotePayload } from './quoteRpc'
import { leaveErrorMessage } from './rpc'
export function invalidRequest():never{throw new Error('Respons riwayat cuti tidak valid. Silakan muat ulang.')}
export function requestObject(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))invalidRequest();return value as Record<string,unknown>}
function exact(value:unknown,keys:readonly string[]){const v=requestObject(value);if(Object.keys(v).sort().join(',')!==[...keys].sort().join(','))invalidRequest();return v}
function integer(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)invalidRequest();return value}
function text(value:unknown,max:number,empty=false):string{if(typeof value!=='string'||(!empty&&!value.trim())||value.length>max)invalidRequest();return value}
const summaryKeys=['id','sequence','startDate','endDate','duration','totalMinutes','status','version','submittedAt','sourceKind'] as const
const statuses:LeaveStatus[]=['submitted','approved','rejected','withdrawn','cancellation_pending','cancelled']
function summary(value:unknown):OwnRequestSummary{
 const v=exact(value,summaryKeys),startDate=parseDateKey(v.startDate),endDate=parseDateKey(v.endDate),submittedAt=text(v.submittedAt,50)
 if(startDate>endDate||!/^\d{4}-\d{2}-\d{2}T/.test(submittedAt)||!Number.isFinite(Date.parse(submittedAt))||!statuses.includes(v.status as LeaveStatus)||!['submission','opening'].includes(v.sourceKind as string))invalidRequest()
 return {id:parseUUID(v.id),sequence:integer(v.sequence,1),startDate,endDate,duration:parseDurationSelection(v.duration),totalMinutes:integer(v.totalMinutes,1,164700),status:v.status as LeaveStatus,version:integer(v.version,1),submittedAt,sourceKind:v.sourceKind as OwnRequestSummary['sourceKind']}
}
export function toSubmitPayload(input:LeaveQuoteInput,fingerprint:string){
 if(typeof fingerprint!=='string'||!/^[0-9a-f]{64}$/.test(fingerprint))invalidRequest()
 return {input:toQuotePayload(input),quote_fingerprint:fingerprint}
}
/** Deliberately project only a semantic, minimal receipt before browser recovery serialization. */
export function parseRequestReceipt(value:unknown):RequestReceipt{
 const v=requestObject(value);if(v.operation!=='submit_request'||v.version!==1)invalidRequest()
 return {id:parseUUID(v.id),version:integer(v.version,1),operation:'submit_request'}
}
async function read(name:string,payload:Record<string,unknown>,signal:AbortSignal):Promise<unknown>{
 let response
 try{response=await supabase.rpc(name,payload).abortSignal(signal)}catch{signal.throwIfAborted();throw new Error('Layanan cuti tidak dapat dihubungi. Silakan coba lagi.')}
 signal.throwIfAborted();if(response.error)throw new Error(leaveErrorMessage(response.error));return response.data
}
export async function fetchOwnLeaveHistory(before:number|null,limit:number,signal:AbortSignal):Promise<OwnRequestPage>{
 if(before!==null)integer(before,1);integer(limit,1,100)
 const raw=await read('leave_own_history_v1',{p_before:before,p_limit:limit},signal)
 try{
  const v=exact(raw,['rows','nextBefore']);if(!Array.isArray(v.rows)||v.rows.length>limit)invalidRequest()
  const rows=v.rows.map(summary),nextBefore=v.nextBefore===null?null:integer(v.nextBefore,1)
  if(new Set(rows.map(r=>r.id)).size!==rows.length||rows.some((r,i)=>(before!==null&&r.sequence>=before)||(i>0&&r.sequence>=rows[i-1].sequence))||
   (nextBefore!==null&&(!rows.length||nextBefore!==rows.at(-1)!.sequence)))invalidRequest()
  return {rows,nextBefore}
 }catch{return invalidRequest()}
}
export async function fetchOwnLeaveRequest(id:UUID,signal:AbortSignal):Promise<OwnRequestDetail>{
 parseUUID(id);const raw=await read('leave_own_request_v1',{p_request_id:id},signal)
 try{
  const v=exact(raw,[...summaryKeys,'reason','approverName','days','allocations']),s=summary(Object.fromEntries(summaryKeys.map(key=>[key,v[key]])))
  if(s.id!==id||!Array.isArray(v.days)||!v.days.length||v.days.length>366||!Array.isArray(v.allocations)||!v.allocations.length||v.allocations.length>2)invalidRequest()
  const days=v.days.map(value=>{
   const d=exact(value,['date','scheduledMinutes','chargedMinutes','exclusion','groupName']),date=parseDateKey(d.date),scheduledMinutes=integer(d.scheduledMinutes,0,450),chargedMinutes=integer(d.chargedMinutes,0,450)
   if(![0,225,450].includes(scheduledMinutes)||chargedMinutes>scheduledMinutes||![null,'holiday','off_duty'].includes(d.exclusion as string|null)||
    (scheduledMinutes===0)!==(d.exclusion!==null)||chargedMinutes!==(scheduledMinutes===0?0:s.duration.mode==='full_scheduled_day'?scheduledMinutes:s.duration.minutes))invalidRequest()
   return {date,scheduledMinutes:scheduledMinutes as 0|225|450,chargedMinutes,exclusion:d.exclusion as 'holiday'|'off_duty'|null,groupName:d.groupName===null?null:text(d.groupName,500)}
  })
  if(days[0].date!==s.startDate||days.at(-1)!.date!==s.endDate||days.reduce((sum,d)=>sum+d.chargedMinutes,0)!==s.totalMinutes||
   days.some((d,i)=>i>0&&(Date.parse(d.date+'T00:00:00Z')-Date.parse(days[i-1].date+'T00:00:00Z'))!==86400000))invalidRequest()
  const allocations=v.allocations.map(value=>{
   const a=exact(value,['year','startDate','endDate','chargedMinutes']),year=integer(a.year,1,9998),startDate=parseDateKey(a.startDate),endDate=parseDateKey(a.endDate),chargedMinutes=integer(a.chargedMinutes,1,164700)
   if(startDate!==`${String(year).padStart(4,'0')}-01-01`||endDate!==`${String(year+1).padStart(4,'0')}-01-01`||days.filter(d=>Number(d.date.slice(0,4))===year).reduce((sum,d)=>sum+d.chargedMinutes,0)!==chargedMinutes)invalidRequest()
   return {year,startDate,endDate,chargedMinutes}
  })
  if(allocations.reduce((sum,a)=>sum+a.chargedMinutes,0)!==s.totalMinutes||allocations.some((a,i)=>i>0&&a.year<=allocations[i-1].year))invalidRequest()
  return {...s,reason:text(v.reason,1000,true),approverName:text(v.approverName,500),days,allocations}
 }catch{return invalidRequest()}
}
