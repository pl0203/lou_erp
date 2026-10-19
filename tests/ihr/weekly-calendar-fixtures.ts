export const weekStart='2026-10-19'
export const weekEnd='2026-10-25'
export const employeeId='71000000-0000-0000-0000-000000000003'
export function weeklyRow(id=employeeId,name='Fictional employee',status:string|null='approved'){
 return {employeeId:id,employeeName:name,days:Array.from({length:7},(_,i)=>({date:`2026-10-${19+i}`,schedule:i===6?'off_duty':'working',scheduledMinutes:i===6?0:i===5?225:450,absence:i===0&&status?{status,minutes:60,availabilityLabel:'partial_absence'}:null}))}
}
export function weeklyPage(rows=[weeklyRow()]){return {scopeVersion:'one',view:'week',periodStart:weekStart,periodEnd:weekEnd,rows,total:rows.length,page:1,pageSize:25}}
export function weeklyAccess(audiences=['sales_team','own']){return {scopeVersion:'one',calendarAudiences:audiences,defaultDate:weekStart,defaultDateState:'ready'}}

export function fixturePeriodPage(start:string,view:string,page=weeklyPage()){
 const first=new Date(`${start}T00:00:00Z`),last=new Date(first)
 if(view==='month'){last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0)}else last.setUTCDate(last.getUTCDate()+6)
 const length=(last.getTime()-first.getTime())/86400000+1
 return {...page,view,periodStart:start,periodEnd:last.toISOString().slice(0,10),rows:page.rows.map(row=>({...row,days:Array.from({length},(_,i)=>{const date=new Date(first);date.setUTCDate(date.getUTCDate()+i);return {...row.days[i%7],date:date.toISOString().slice(0,10)}})}))}
}
