import { supabase } from '../supabase'
import { parseDateKey, parseDurationSelection, parseUUID } from './contracts'
import { leaveErrorMessage } from './rpc'
import type { AuthoritativeLeaveQuote, LeaveQuoteInput, QuotedDay, QuoteSources } from './quoteContracts'
function invalid():never{throw new Error('Pratinjau cuti tidak valid. Periksa isian atau muat ulang.')}
function exact(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==keys.sort().join(','))invalid()
 return value as Record<string,unknown>
}
function integer(value:unknown,min=0,max=2147483647):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)invalid();return value}
function text(value:unknown):string{if(typeof value!=='string'||!value.length)invalid();return value}
function list(value:unknown,max:number):unknown[]{if(!Array.isArray(value)||!value.length||value.length>max)invalid();return value}
/** Gregorian civil ordinal, no browser timezone, elapsed-time division, or policy calculation. */
function ordinal(date:string):number{
 const y=Number(date.slice(0,4)),m=Number(date.slice(5,7)),d=Number(date.slice(8,10)),prior=y-1
 const leap=y%4===0&&(y%100!==0||y%400===0)
 const before=[0,31,59,90,120,151,181,212,243,273,304,334]
 return prior*365+Math.floor(prior/4)-Math.floor(prior/100)+Math.floor(prior/400)+before[m-1]+(leap&&m>2?1:0)+d
}
export function toQuotePayload(input:LeaveQuoteInput){
 const v=exact(input,['startDate','endDate','duration','reason']),start_date=parseDateKey(v.startDate),end_date=parseDateKey(v.endDate)
 if(start_date>end_date||Number(end_date.slice(0,4))>9998||ordinal(end_date)-ordinal(start_date)>365||typeof v.reason!=='string'||v.reason.length>1000)invalid()
 return {start_date,end_date,duration:parseDurationSelection(v.duration),reason:v.reason}
}
function sources(value:unknown):QuoteSources{
 const v=exact(value,['calendarId','calendarVersion','rosterId','rosterVersion','membershipId','membershipVersion','groupId','groupVersion','groupName'])
 const nullableId=(key:string)=>v[key]===null?null:parseUUID(v[key]),nullableVersion=(key:string)=>v[key]===null?null:integer(v[key],1,Number.MAX_SAFE_INTEGER)
 const result={calendarId:parseUUID(v.calendarId),calendarVersion:integer(v.calendarVersion,1,Number.MAX_SAFE_INTEGER),rosterId:nullableId('rosterId'),rosterVersion:nullableVersion('rosterVersion'),membershipId:nullableId('membershipId'),membershipVersion:nullableVersion('membershipVersion'),groupId:nullableId('groupId'),groupVersion:nullableVersion('groupVersion'),groupName:v.groupName===null?null:text(v.groupName)}
 const absent=result.rosterId===null
 if([result.rosterVersion,result.membershipId,result.membershipVersion,result.groupId,result.groupVersion,result.groupName].some(x=>(x===null)!==absent))invalid()
 return result
}
export function parseLeaveQuote(value:unknown,input:LeaveQuoteInput):AuthoritativeLeaveQuote{
 const v=exact(value,['fingerprint','startDate','endDate','today','duration','totalMinutes','days','allocations','approver','policy','memberVersion','scopeVersion'])
 const request=toQuotePayload(input),startDate=parseDateKey(v.startDate),endDate=parseDateKey(v.endDate),today=parseDateKey(v.today),duration=parseDurationSelection(v.duration)
 if(startDate!==request.start_date||endDate!==request.end_date||JSON.stringify(duration)!==JSON.stringify(request.duration)||today>startDate||typeof v.fingerprint!=='string'||!/^([a-f0-9]{64})$/.test(v.fingerprint))invalid()
 const totalMinutes=integer(v.totalMinutes,1,366*450),first=ordinal(startDate)
 const days:QuotedDay[]=list(v.days,366).map((value,index)=>{
  const d=exact(value,['date','scheduledMinutes','chargedMinutes','exclusion','year','accountId','sources']),date=parseDateKey(d.date),scheduledMinutes=integer(d.scheduledMinutes,0,450),chargedMinutes=integer(d.chargedMinutes,0,450)
  if(![0,225,450].includes(scheduledMinutes)||ordinal(date)!==first+index||date>endDate||![null,'holiday','off_duty'].includes(d.exclusion as string|null))invalid()
  const excluded=scheduledMinutes===0
  if((d.exclusion!==null)!==excluded||chargedMinutes!==(excluded?0:duration.mode==='full_scheduled_day'?scheduledMinutes:duration.minutes)||chargedMinutes>scheduledMinutes)invalid()
  const accountId=d.accountId===null?null:parseUUID(d.accountId),year=d.year===null?null:integer(d.year,1,9998)
  if(excluded?(accountId!==null||year!==null):(accountId===null||year!==Number(date.slice(0,4))))invalid()
  return {date,scheduledMinutes:scheduledMinutes as 0|225|450,chargedMinutes,exclusion:d.exclusion as QuotedDay['exclusion'],year,accountId,sources:sources(d.sources)}
 })
 if(days.at(-1)?.date!==endDate||days.reduce((sum,d)=>sum+d.chargedMinutes,0)!==totalMinutes)invalid()
 const allocations=list(v.allocations,2).map(value=>{
  const a=exact(value,['accountId','year','version','chargedMinutes','availableBefore','availableAfter']),accountId=parseUUID(a.accountId),year=integer(a.year,1,9998),version=integer(a.version,1,Number.MAX_SAFE_INTEGER),chargedMinutes=integer(a.chargedMinutes,1),availableBefore=integer(a.availableBefore),availableAfter=integer(a.availableAfter)
  const allocated=days.filter(d=>d.accountId===accountId)
  if(!allocated.length||allocated.some(d=>d.year!==year)||allocated.reduce((sum,d)=>sum+d.chargedMinutes,0)!==chargedMinutes||availableBefore-chargedMinutes!==availableAfter)invalid()
  return {accountId,year,version,chargedMinutes,availableBefore,availableAfter}
 })
 if(new Set(allocations.map(a=>a.accountId)).size!==allocations.length||new Set(allocations.map(a=>a.year)).size!==allocations.length||allocations.reduce((sum,a)=>sum+a.chargedMinutes,0)!==totalMinutes)invalid()
 const a=exact(v.approver,['id','name','assignmentId','assignmentVersion']),p=exact(v.policy,['id','version'])
 return {fingerprint:v.fingerprint,startDate,endDate,today,duration,totalMinutes,days,allocations,approver:{id:parseUUID(a.id),name:text(a.name),assignmentId:parseUUID(a.assignmentId),assignmentVersion:integer(a.assignmentVersion,1,Number.MAX_SAFE_INTEGER)},policy:{id:parseUUID(p.id),version:integer(p.version,1,Number.MAX_SAFE_INTEGER)},memberVersion:integer(v.memberVersion,1,Number.MAX_SAFE_INTEGER),scopeVersion:text(v.scopeVersion)}
}
export async function fetchLeaveQuote(input:LeaveQuoteInput,signal:AbortSignal):Promise<AuthoritativeLeaveQuote>{
 const payload=toQuotePayload(input)
 let response
 try{response=await supabase.rpc('leave_quote_v1',{p_input:payload}).abortSignal(signal)}catch{signal.throwIfAborted();throw new Error('Layanan cuti tidak dapat dihubungi. Silakan coba lagi.')}
 signal.throwIfAborted()
 if(response.error)throw new Error(leaveErrorMessage(response.error))
 try{return parseLeaveQuote(response.data,input)}catch{return invalid()}
}
