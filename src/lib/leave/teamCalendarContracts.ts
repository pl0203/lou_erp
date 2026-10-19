import { parseDateKey, parseUUID } from './contracts'
import type { CalendarRange } from './readContracts'

export const teamAudiences = ['own','assigned_team','granted','director_all','sales_all','sales_team','admin_team'] as const
export type TeamCalendarAudience = typeof teamAudiences[number]
export type TeamCalendarAccess = {
 scopeVersion: string; calendarAudiences: TeamCalendarAudience[]; defaultDate: string | null
 defaultDateState: 'ready' | 'timezone_unconfirmed' | 'timezone_mixed' | 'unavailable'
}
export type TeamAbsence = {status:'submitted'|'approved'|'cancellation_pending';minutes:number;availabilityLabel:'full_scheduled_absence'|'partial_absence'}
export type TeamDay = {date:string;schedule:'working'|'holiday'|'off_duty'|'unconfigured';scheduledMinutes:0|225|450|null;absence:TeamAbsence|null}
export type TeamEmployee = {employeeId:string;employeeName:string;days:TeamDay[]}
export type CalendarView = 'week'|'month'
export type TeamCalendarPage = {scopeVersion:string;view:CalendarView;periodStart:string;periodEnd:string;rows:TeamEmployee[];total:number;page:number;pageSize:number}
function invalid():never {throw new Error('Respons layanan cuti tidak valid. Silakan muat ulang.')}
function exact(value:unknown,keys:string[]):value is Record<string,unknown> {
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',')
}
function integer(value:unknown,min:number,max=Number.MAX_SAFE_INTEGER):value is number {return typeof value==='number'&&Number.isSafeInteger(value)&&value>=min&&value<=max}
function day(value:unknown):string {try{return parseDateKey(value)}catch{return invalid()}}
function dateOffset(date:string,offset:number):string {
 const value=new Date(`${day(date)}T00:00:00Z`);value.setUTCDate(value.getUTCDate()+offset)
 return day(value.toISOString().slice(0,10))
}
/** Date-only calendar arithmetic; never substitutes browser timezone for company timezone. */
export function weekForDate(date:string):CalendarRange {
 const value=day(date),weekday=new Date(`${value}T00:00:00Z`).getUTCDay()
 const from=dateOffset(value,-((weekday+6)%7));return {from,to:dateOffset(from,6)}
}
export function shiftWeek(weekStart:string,direction:-1|1):string {return dateOffset(parseWeekStart(weekStart),direction*7)}
export function parseWeekStart(value:unknown):string {const date=day(value);if(weekForDate(date).from!==date)return invalid();return date}
export function weekDates(weekStart:string):string[] {const start=parseWeekStart(weekStart);return Array.from({length:7},(_,i)=>dateOffset(start,i))}
export function parseTeamAudience(value:unknown):TeamCalendarAudience {
 if(!teamAudiences.includes(value as TeamCalendarAudience))return invalid();return value as TeamCalendarAudience
}
export function parseTeamPageInput(page:unknown,pageSize:unknown):{page:number;pageSize:number} {
 if(!integer(page,1,2147483647)||!integer(pageSize,1,100))return invalid();return {page,pageSize}
}
export function parseCalendarView(value:unknown):CalendarView {if(value!=='week'&&value!=='month')return invalid();return value}
export function periodForDate(date:string,view:CalendarView):CalendarRange {
 parseCalendarView(view);const value=day(date)
 if(view==='week')return weekForDate(value)
 const from=`${value.slice(0,7)}-01`,last=new Date(`${from}T00:00:00Z`);last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0)
 return {from,to:day(last.toISOString().slice(0,10))}
}
export function parsePeriodStart(value:unknown,view:CalendarView):string {const date=day(value);if(periodForDate(date,view).from!==date)return invalid();return date}
export function periodDates(start:string,view:CalendarView):string[] {
 const from=parsePeriodStart(start,view),to=periodForDate(from,view).to
 return Array.from({length:(Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000+1},(_,i)=>dateOffset(from,i))
}
export function shiftPeriod(start:string,view:CalendarView,direction:-1|1):string {
 parsePeriodStart(start,view)
 if(view==='week')return shiftWeek(start,direction)
 const value=new Date(`${start}T00:00:00Z`);value.setUTCMonth(value.getUTCMonth()+direction);return day(value.toISOString().slice(0,10))
}
export function parseTeamCalendarAccess(value:unknown):TeamCalendarAccess {
 if(!exact(value,['scopeVersion','calendarAudiences','defaultDate','defaultDateState'])||typeof value.scopeVersion!=='string'||!value.scopeVersion||!Array.isArray(value.calendarAudiences))return invalid()
 const calendarAudiences=value.calendarAudiences.map(parseTeamAudience)
 if(new Set(calendarAudiences).size!==calendarAudiences.length||!['ready','timezone_unconfirmed','timezone_mixed','unavailable'].includes(value.defaultDateState as string))return invalid()
 const defaultDate=value.defaultDate===null?null:day(value.defaultDate)
 if((value.defaultDateState==='ready')!==(defaultDate!==null))return invalid()
 return {scopeVersion:value.scopeVersion,calendarAudiences,defaultDate,defaultDateState:value.defaultDateState as TeamCalendarAccess['defaultDateState']}
}
function parseAbsence(value:unknown):TeamAbsence|null {
 if(value===null)return null
 if(!exact(value,['status','minutes','availabilityLabel'])||!['submitted','approved','cancellation_pending'].includes(value.status as string)||!integer(value.minutes,1,450)||!['full_scheduled_absence','partial_absence'].includes(value.availabilityLabel as string))return invalid()
 return value as TeamAbsence
}
export function hasVisiblePending(row:TeamEmployee):boolean {return row.days.some(day=>day.absence?.status==='submitted'||day.absence?.status==='cancellation_pending')}
export function parseTeamCalendarPage(value:unknown):TeamCalendarPage {
 if(!exact(value,['scopeVersion','view','periodStart','periodEnd','rows','total','page','pageSize'])||typeof value.scopeVersion!=='string'||!value.scopeVersion||!Array.isArray(value.rows)||!integer(value.total,0))return invalid()
 const {page,pageSize}=parseTeamPageInput(value.page,value.pageSize),view=parseCalendarView(value.view),periodStart=parsePeriodStart(value.periodStart,view),periodEnd=day(value.periodEnd),dates=periodDates(periodStart,view)
 if(periodEnd!==dates.at(-1)||value.rows.length>pageSize||value.rows.length>Math.max(0,value.total-(page-1)*pageSize))return invalid()
 const seen=new Set<string>()
 const rows=value.rows.map(row=>{
  if(!exact(row,['employeeId','employeeName','days'])||typeof row.employeeName!=='string'||!row.employeeName.trim()||!Array.isArray(row.days)||row.days.length!==dates.length)return invalid()
  let employeeId:string;try{employeeId=parseUUID(row.employeeId)}catch{return invalid()}
  if(seen.has(employeeId.toLowerCase()))return invalid();seen.add(employeeId.toLowerCase())
  const days:TeamDay[]=row.days.map((cell,index)=>{
   if(!exact(cell,['date','schedule','scheduledMinutes','absence'])||day(cell.date)!==dates[index])return invalid()
   const schedule=cell.schedule,minutes=cell.scheduledMinutes
   if(!(schedule==='working'&&(minutes===225||minutes===450)||['holiday','off_duty'].includes(schedule as string)&&minutes===0||schedule==='unconfigured'&&minutes===null))return invalid()
   return {date:dates[index],schedule:schedule as TeamDay['schedule'],scheduledMinutes:minutes as TeamDay['scheduledMinutes'],absence:parseAbsence(cell.absence)}
  })
  return {employeeId,employeeName:row.employeeName,days}
 })
 return {scopeVersion:value.scopeVersion,view,periodStart,periodEnd,rows,total:value.total,page,pageSize}
}
