import { expect,test,vi,beforeEach } from 'vitest'
import { weeklyAccess,weeklyPage,weeklyRow,weekStart } from './weekly-calendar-fixtures'
const mocks=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
const api=await import('../../src/lib/leave/teamCalendarContracts').catch(()=>({})) as typeof import('../../src/lib/leave/teamCalendarContracts')
const rpc=await import('../../src/lib/leave/teamCalendarRpc').catch(()=>({})) as typeof import('../../src/lib/leave/teamCalendarRpc')
beforeEach(()=>mocks.rpc.mockReset())
test('week aligns Monday to Sunday across month, year and leap boundaries without local time',()=>{
 expect(api.weekForDate).toBeTypeOf('function')
 expect(api.weekForDate('2027-01-01')).toEqual({from:'2026-12-28',to:'2027-01-03'})
 expect(api.weekForDate('2024-02-29')).toEqual({from:'2024-02-26',to:'2024-03-03'})
 expect(api.shiftWeek(weekStart,-1)).toBe('2026-10-12')
 expect(()=>api.weekForDate('2026-02-30')).toThrow()
})
test('weekly payload accepts precisely seven dated cells and no private fields',()=>{
 expect(api.parseTeamCalendarPage).toBeTypeOf('function')
 expect(api.parseTeamCalendarPage(weeklyPage())).toEqual(weeklyPage())
 for(const field of ['reason','balance','requestId','approverName']){
  expect(()=>api.parseTeamCalendarPage({...weeklyPage(),[field]:'private'})).toThrow()
  expect(()=>api.parseTeamCalendarPage(weeklyPage([{...weeklyRow(),[field]:'private'}]))).toThrow()
 }
 const row=weeklyRow();row.days.pop();expect(()=>api.parseTeamCalendarPage(weeklyPage([row]))).toThrow()
})
test('validates cell schedule independently from historical absence minutes',()=>{
 expect(api.parseTeamCalendarPage).toBeTypeOf('function')
 const row=weeklyRow();row.days[0]={...row.days[0],schedule:'holiday',scheduledMinutes:0}
 expect(api.parseTeamCalendarPage(weeklyPage([row])).rows[0].days[0].absence?.minutes).toBe(60)
 row.days[0]={...row.days[0],schedule:'unconfigured',scheduledMinutes:null as unknown as number}
 expect(api.parseTeamCalendarPage(weeklyPage([row])).rows[0].days[0].schedule).toBe('unconfigured')
 for(const patch of [{schedule:'working',scheduledMinutes:0},{schedule:'off_duty',scheduledMinutes:225},{schedule:'unconfigured',scheduledMinutes:0},{schedule:'holiday',scheduledMinutes:null}]){
  row.days[0]={...row.days[0],...patch} as typeof row.days[number];expect(()=>api.parseTeamCalendarPage(weeklyPage([row]))).toThrow()
 }
})
test('rejects duplicate employees, cells, bad amounts/status and malformed page metadata',()=>{
 expect(api.parseTeamCalendarPage).toBeTypeOf('function')
 expect(()=>api.parseTeamCalendarPage(weeklyPage([weeklyRow(),weeklyRow()]))).toThrow()
 for(const patch of [{total:-1},{page:0},{pageSize:101},{periodStart:'2026-10-20'},{periodEnd:'2026-10-26'},{scopeVersion:''}])expect(()=>api.parseTeamCalendarPage({...weeklyPage(),...patch})).toThrow()
 for(const patch of [{minutes:0},{minutes:451},{minutes:1.5},{status:'cancelled'},{status:'rejected'},{availabilityLabel:'AM'},{reason:'secret'}]){
  const row=weeklyRow();row.days[0].absence={...row.days[0].absence!,...patch};expect(()=>api.parseTeamCalendarPage(weeklyPage([row]))).toThrow()
 }
 const row=weeklyRow();row.days[1].date=row.days[0].date;expect(()=>api.parseTeamCalendarPage(weeklyPage([row]))).toThrow()
})
test('access grants only declared server audiences and requires consistent weekly defaults',()=>{
 expect(api.parseTeamCalendarAccess).toBeTypeOf('function')
 expect(api.parseTeamCalendarAccess(weeklyAccess())).toEqual(weeklyAccess())
 for(const patch of [{calendarAudiences:['unknown']},{calendarAudiences:['own','own']},{defaultDate:null},{defaultDate:'2026-02-30'},{defaultDateState:'unknown'}])expect(()=>api.parseTeamCalendarAccess({...weeklyAccess(),...patch})).toThrow()
 expect(api.parseTeamCalendarAccess({...weeklyAccess(),defaultDate:null,defaultDateState:'timezone_mixed'}).defaultDate).toBeNull()
})
test('transport sends only bounded week and pagination, rejects response-owner mismatch',async()=>{
 expect(rpc.fetchTeamCalendar).toBeTypeOf('function')
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:weeklyPage(),error:null})})
 const signal=new AbortController().signal
 expect(await rpc.fetchTeamCalendar(weekStart,'week','own',1,25,signal)).toEqual(weeklyPage())
 expect(mocks.rpc).toHaveBeenCalledWith('leave_team_calendar_v1',{p_view:'week',p_period_start:weekStart,p_audience:'own',p_page:1,p_page_size:25})
 for(const patch of [{page:2},{pageSize:10},{periodStart:'2026-10-12',periodEnd:'2026-10-18'}]){
  mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:{...weeklyPage(),...patch},error:null})})
  await expect(rpc.fetchTeamCalendar(weekStart,'week','own',1,25,signal)).rejects.toThrow()
 }
})
test('aborted or invalid calls never reach transport and raw errors stay private',async()=>{
 expect(rpc.fetchTeamCalendar).toBeTypeOf('function')
 const abort=new AbortController();abort.abort()
 await expect(rpc.fetchTeamCalendar(weekStart,'week','own',1,25,abort.signal)).rejects.toThrow()
 await expect(rpc.fetchTeamCalendar('2026-10-20','week','own',1,25,new AbortController().signal)).rejects.toThrow()
 expect(mocks.rpc).not.toHaveBeenCalled()
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:null,error:{code:'42501',message:'private reason'}})})
 await expect(rpc.fetchTeamCalendar(weekStart,'week','own',1,25,new AbortController().signal)).rejects.not.toThrow('private reason')
})

test('monthly periods are exact calendar months, including leap February and year navigation',()=>{
 expect(api.periodForDate).toBeTypeOf('function')
 expect(api.periodForDate('2024-02-29','month')).toEqual({from:'2024-02-01',to:'2024-02-29'})
 expect(api.periodDates('2026-02-01','month')).toHaveLength(28)
 expect(api.periodDates('2024-02-01','month')).toHaveLength(29)
 expect(api.periodDates('2026-04-01','month')).toHaveLength(30)
 expect(api.periodDates('2026-10-01','month')).toHaveLength(31)
 expect(api.shiftPeriod('2026-12-01','month',1)).toBe('2027-01-01')
 expect(()=>api.periodDates('2026-10-19','month')).toThrow()
})

test('monthly transport validates exact view and month end; abort after transport cannot return data',async()=>{
 const {fixturePeriodPage}=await import('./weekly-calendar-fixtures')
 const month=fixturePeriodPage('2026-10-01','month')
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:month,error:null})})
 expect(await rpc.fetchTeamCalendar('2026-10-01','month','own',1,25,new AbortController().signal)).toEqual(month)
 expect(mocks.rpc).toHaveBeenCalledWith('leave_team_calendar_v1',{p_period_start:'2026-10-01',p_view:'month',p_audience:'own',p_page:1,p_page_size:25})
 expect(()=>api.parseTeamCalendarPage({...month,periodEnd:'2026-11-01'})).toThrow()
 const abort=new AbortController();let finish!:(value:unknown)=>void
 mocks.rpc.mockReturnValue({abortSignal:()=>new Promise(resolve=>finish=resolve)})
 const pending=rpc.fetchTeamCalendar('2026-10-01','month','own',1,25,abort.signal)
 abort.abort();finish({data:month,error:null});await expect(pending).rejects.toThrow()
})

test('calendar transition invalidation includes both new private projections but preserves unrelated cache',async()=>{
 const {QueryClient}=await import('@tanstack/react-query'),{invalidateLeaveReads}=await import('../../src/lib/leave/readQueryKeys'),{leaveKeys}=await import('../../src/lib/leave/queryKeys')
 const actor='71000000-0000-0000-0000-000000000003',client=new QueryClient()
 const access=leaveKeys.private(actor,'one','team-calendar-access-v2','default','enabled'),calendar=leaveKeys.private(actor,'one','team-calendar-v2','own','month','2026-10-01',1,25),unrelated=leaveKeys.private(actor,'one','private-note')
 client.setQueryData(access,weeklyAccess());client.setQueryData(calendar,weeklyPage());client.setQueryData(unrelated,'keep')
 await invalidateLeaveReads(client,actor)
 expect(client.getQueryState(access)?.isInvalidated).toBe(true);expect(client.getQueryState(calendar)?.isInvalidated).toBe(true);expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);client.clear()
})
