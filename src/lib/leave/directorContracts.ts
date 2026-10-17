import { parseDateKey, parseUUID } from './contracts'
import type { LeaveStatus } from './contracts'
export type DirectorRequest={id:string;sequence:number;employeeId:string;employeeName:string;startDate:string;endDate:string;totalMinutes:number;status:LeaveStatus;submittedAt:string;approverName:string|null}
export type DirectorRequestPage={rows:DirectorRequest[];nextBefore:number|null}
const statuses=['submitted','approved','rejected','withdrawn','cancellation_pending','cancelled']
function invalid():never{throw new Error('Respons ringkasan cuti tidak valid. Silakan muat ulang.')}
function exact(v:unknown,keys:string[]):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.sort().join(',')}
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0
export function parseDirectorRequests(value:unknown,before:number|null=null,limit=25):DirectorRequestPage{
 if(!exact(value,['rows','nextBefore'])||!Array.isArray(value.rows)||value.rows.length>limit||!(value.nextBefore===null||positive(value.nextBefore)))return invalid()
 let previous=before??Infinity;const ids=new Set<string>()
 const rows=value.rows.map(row=>{
  if(!exact(row,['id','sequence','employeeId','employeeName','startDate','endDate','totalMinutes','status','submittedAt','approverName'])||!positive(row.sequence)||row.sequence>=previous
   ||typeof row.employeeName!=='string'||!row.employeeName.trim()||!positive(row.totalMinutes)||!statuses.includes(row.status as string)
   ||typeof row.submittedAt!=='string'||!Number.isFinite(Date.parse(row.submittedAt))||!(row.approverName===null||typeof row.approverName==='string'))return invalid()
  const id=parseUUID(row.id),employeeId=parseUUID(row.employeeId),startDate=parseDateKey(row.startDate),endDate=parseDateKey(row.endDate)
  if(startDate>endDate||ids.has(id.toLowerCase()))return invalid();ids.add(id.toLowerCase());previous=row.sequence
  return {id,employeeId,startDate,endDate,sequence:row.sequence,employeeName:row.employeeName,totalMinutes:row.totalMinutes,status:row.status as LeaveStatus,submittedAt:row.submittedAt,approverName:typeof row.approverName==='string'?row.approverName:null}
 })
 if(value.nextBefore!==null&&(!rows.length||value.nextBefore!==rows.at(-1)!.sequence))return invalid()
 return {rows,nextBefore:typeof value.nextBefore==='number'?value.nextBefore:null}
}
