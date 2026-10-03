import { parseDateKey, parseUUID } from './contracts'
export type CalendarAudience='own'|'assigned_team'|'granted'
export type CalendarRange={from:string;to:string}
/** Exactly the five minimized server fields. No request ID/detail route or clock-time claim. */
export type CalendarAvailability={employeeId:string;employeeName:string;date:string;approvedMinutes:number;availabilityLabel:'full_scheduled_absence'|'partial_absence'}
export type LeaveReadAccess={scopeVersion:string;calendarAudiences:CalendarAudience[];defaultRange:CalendarRange|null;defaultRangeState:'ready'|'timezone_unconfirmed'|'timezone_mixed'|'unavailable'}
export type ApprovalCountFilter='all'|'submitted'|'cancellation_pending'
export type LeaveApprovalCounts={pendingLeave:number;pendingCancellation:number}
const audiences:readonly CalendarAudience[]=['own','assigned_team','granted']
function invalid():never{throw new Error('Respons layanan cuti tidak valid. Silakan muat ulang.')}
function object(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)}
function exact(value:unknown,keys:string[]):value is Record<string,unknown>{return object(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',')}
function count(value:unknown):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0}
export function parseCalendarAudience(value:unknown):CalendarAudience{
 if(!audiences.includes(value as CalendarAudience))return invalid();return value as CalendarAudience
}
export function parseCalendarRange(value:unknown):CalendarRange{
 if(!exact(value,['from','to']))return invalid()
 let from:string,to:string
 try{from=parseDateKey(value.from);to=parseDateKey(value.to)}catch{return invalid()}
 const days=(Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86_400_000
 if(days<0||days>92)return invalid();return {from,to}
}
export function parseCalendarAvailability(value:unknown):CalendarAvailability[]{
 if(!Array.isArray(value))return invalid()
 const seen=new Set<string>()
 return value.map(row=>{
  if(!exact(row,['employeeId','employeeName','date','approvedMinutes','availabilityLabel'])||typeof row.employeeName!=='string'||!row.employeeName.trim()
   ||!count(row.approvedMinutes)||row.approvedMinutes<1||row.approvedMinutes>450
   ||!['full_scheduled_absence','partial_absence'].includes(row.availabilityLabel as string))return invalid()
  let employeeId:string,date:string
  try{employeeId=parseUUID(row.employeeId);date=parseDateKey(row.date)}catch{return invalid()}
  const key=`${employeeId.toLowerCase()}:${date}`;if(seen.has(key))return invalid();seen.add(key)
  return {employeeId,employeeName:row.employeeName,date,approvedMinutes:row.approvedMinutes,availabilityLabel:row.availabilityLabel as CalendarAvailability['availabilityLabel']}
 })
}
export function parseLeaveReadAccess(value:unknown):LeaveReadAccess{
 if(!exact(value,['scopeVersion','calendarAudiences','defaultRange','defaultRangeState'])||typeof value.scopeVersion!=='string'||!value.scopeVersion
  ||!Array.isArray(value.calendarAudiences))return invalid()
 const calendarAudiences=value.calendarAudiences.map(parseCalendarAudience)
 if(new Set(calendarAudiences).size!==calendarAudiences.length)return invalid()
 if(!['ready','timezone_unconfirmed','timezone_mixed','unavailable'].includes(value.defaultRangeState as string))return invalid()
 const defaultRange=value.defaultRange===null?null:parseCalendarRange(value.defaultRange)
 if((value.defaultRangeState==='ready')!==(defaultRange!==null))return invalid()
 return {scopeVersion:value.scopeVersion,calendarAudiences,defaultRange,defaultRangeState:value.defaultRangeState as LeaveReadAccess['defaultRangeState']}
}
export function parseLeaveApprovalCounts(value:unknown):LeaveApprovalCounts{
 if(!exact(value,['pendingLeave','pendingCancellation'])||!count(value.pendingLeave)||!count(value.pendingCancellation))return invalid()
 if(!Number.isSafeInteger(value.pendingLeave+value.pendingCancellation))return invalid()
 return {pendingLeave:value.pendingLeave,pendingCancellation:value.pendingCancellation}
}
export function approvalCountForFilter(counts:LeaveApprovalCounts,filter:ApprovalCountFilter):number{
 switch(filter){case 'submitted':return counts.pendingLeave;case 'cancellation_pending':return counts.pendingCancellation;case 'all':return counts.pendingLeave+counts.pendingCancellation;default:return invalid()}
}
/** Calendar month derives only from a confirmed company timezone. */
export function calendarMonthRange(timezone:string|null,now:Date=new Date()):CalendarRange|null{
 if(!timezone)return null
 try{
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now)
  const year=parts.find(p=>p.type==='year')!.value,month=parts.find(p=>p.type==='month')!.value
  const last=new Date(Date.UTC(Number(year),Number(month),0)).getUTCDate()
  return parseCalendarRange({from:`${year}-${month}-01`,to:`${year}-${month}-${last}`})
 }catch{return null}
}
