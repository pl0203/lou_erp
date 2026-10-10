import { expect, test, vi, beforeEach } from 'vitest'
const mocks=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
const api=await import('../../src/lib/leave/readContracts').catch(()=>({})) as typeof import('../../src/lib/leave/readContracts')
const rpc=await import('../../src/lib/leave/readRpc').catch(()=>({})) as typeof import('../../src/lib/leave/readRpc')
const row={employeeId:'71000000-0000-0000-0000-000000000001',employeeName:'Fictional employee',date:'2026-10-03',approvedMinutes:225,availabilityLabel:'full_scheduled_absence'}
beforeEach(()=>mocks.rpc.mockReset())
test('strict availability accepts only the exact five minimized fields',()=>{
 expect(api.parseCalendarAvailability).toBeTypeOf('function')
 expect(api.parseCalendarAvailability([row])).toEqual([row])
 for(const extra of ['reason','type','balance','requestId','approverName','history'])expect(()=>api.parseCalendarAvailability([{...row,[extra]:'private'}])).toThrow()
})
test('availability rejects malformed dates, fractional amounts, invalid label and duplicate employee dates',()=>{
 expect(api.parseCalendarAvailability).toBeTypeOf('function')
 for(const patch of [{employeeId:'guessed'},{date:'2026-02-30'},{approvedMinutes:0},{approvedMinutes:1.5},{approvedMinutes:451},{availabilityLabel:'AM'}])expect(()=>api.parseCalendarAvailability([{...row,...patch}])).toThrow()
 expect(()=>api.parseCalendarAvailability([row,row])).toThrow()
})
test('calendar range counts inclusively across month/year/leap boundaries and accepts at most 93 days',()=>{
 expect(api.parseCalendarRange).toBeTypeOf('function')
 expect(api.parseCalendarRange({from:'2026-10-01',to:'2027-01-01'})).toEqual({from:'2026-10-01',to:'2027-01-01'})
 expect(api.parseCalendarRange({from:'2024-02-01',to:'2024-02-29'})).toEqual({from:'2024-02-01',to:'2024-02-29'})
 for(const range of [{from:'2026-10-01',to:'2027-01-02'},{from:'2026-10-04',to:'2026-10-03'},{from:'',to:'2026-10-03'}])expect(()=>api.parseCalendarRange(range)).toThrow()
})
test('counts distinguish actual zero from malformed or missing results',()=>{
 expect(api.parseLeaveApprovalCounts).toBeTypeOf('function')
 expect(api.parseLeaveApprovalCounts({pendingLeave:31,pendingCancellation:2})).toEqual({pendingLeave:31,pendingCancellation:2})
 expect(api.parseLeaveApprovalCounts({pendingLeave:0,pendingCancellation:0})).toEqual({pendingLeave:0,pendingCancellation:0})
 for(const invalid of [null,{pendingLeave:0},{pendingLeave:-1,pendingCancellation:0},{pendingLeave:1.2,pendingCancellation:0},{pendingLeave:1,pendingCancellation:0,employeeId:row.employeeId}])expect(()=>api.parseLeaveApprovalCounts(invalid)).toThrow()
})
test('read access rejects unbounded, duplicate and unknown calendar audiences',()=>{
 expect(api.parseLeaveReadAccess).toBeTypeOf('function')
 expect(api.parseLeaveReadAccess({scopeVersion:'1',calendarAudiences:['assigned_team'],defaultRange:null,defaultRangeState:'timezone_unconfirmed'})).toEqual({scopeVersion:'1',calendarAudiences:['assigned_team'],defaultRange:null,defaultRangeState:'timezone_unconfirmed'})
 for(const value of [{scopeVersion:'',calendarAudiences:[]},{scopeVersion:'1',calendarAudiences:['company']},{scopeVersion:'1',calendarAudiences:['own','own']},{scopeVersion:'1',calendarAudiences:[],grants:['private']}])expect(()=>api.parseLeaveReadAccess(value)).toThrow()
})
test('status filters select full server counts independently of any inbox page',()=>{
 expect(api.approvalCountForFilter).toBeTypeOf('function')
 const counts={pendingLeave:31,pendingCancellation:2}
 expect(api.approvalCountForFilter(counts,'all')).toBe(33)
 expect(api.approvalCountForFilter(counts,'submitted')).toBe(31)
 expect(api.approvalCountForFilter(counts,'cancellation_pending')).toBe(2)
})
test('calendar RPC sends only bounded dates and audience, sanitizes raw errors and rejects out-of-range results',async()=>{
 expect(rpc.fetchLeaveCalendar).toBeTypeOf('function')
 const abort=new AbortController(),range={from:'2026-10-01',to:'2026-10-31'}
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:[row],error:null})})
 expect(await rpc.fetchLeaveCalendar(range,'own',abort.signal)).toEqual([row])
 expect(mocks.rpc).toHaveBeenCalledWith('leave_calendar_v1',{p_from:range.from,p_to:range.to,p_audience:'own'})
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:null,error:{code:'42501',message:'Fictional private reason'}})})
 await expect(rpc.fetchLeaveCalendar(range,'own',abort.signal)).rejects.toThrow(/Akses cuti/)
 try{await rpc.fetchLeaveCalendar(range,'own',abort.signal)}catch(error){expect(String(error)).not.toContain('Fictional private reason')}
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:[{...row,date:'2026-11-01'}],error:null})})
 await expect(rpc.fetchLeaveCalendar(range,'own',abort.signal)).rejects.toThrow()
})
test('no count arguments enumerate employees or pages and network error never becomes zero',async()=>{
 expect(rpc.fetchLeaveApprovalCounts).toBeTypeOf('function')
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:{pendingLeave:31,pendingCancellation:2},error:null})})
 expect(await rpc.fetchLeaveApprovalCounts(new AbortController().signal)).toEqual({pendingLeave:31,pendingCancellation:2})
 expect(mocks.rpc).toHaveBeenCalledWith('leave_approval_counts_v1')
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:null,error:{message:'secret'}})})
 await expect(rpc.fetchLeaveApprovalCounts(new AbortController().signal)).rejects.toThrow(/Layanan cuti/)
})
test('aborted reads do not call transport or publish a late response',async()=>{
 expect(rpc.fetchLeaveApprovalCounts).toBeTypeOf('function')
 const before=new AbortController();before.abort();await expect(rpc.fetchLeaveApprovalCounts(before.signal)).rejects.toThrow();expect(mocks.rpc).not.toHaveBeenCalled()
 const after=new AbortController();let finish!:(value:unknown)=>void
 mocks.rpc.mockReturnValue({abortSignal:()=>new Promise(resolve=>finish=resolve)})
 const pending=rpc.fetchLeaveApprovalCounts(after.signal);after.abort();finish({data:{pendingLeave:99,pendingCancellation:99},error:null})
 await expect(pending).rejects.toThrow()
})
test('read access carries a server-derived default month for actors with no personal calendar',()=>{
 expect(api.parseLeaveReadAccess).toBeTypeOf('function')
 expect(api.parseLeaveReadAccess({scopeVersion:'1',calendarAudiences:['assigned_team'],defaultRange:{from:'2026-10-01',to:'2026-10-31'},defaultRangeState:'ready'})).toEqual({scopeVersion:'1',calendarAudiences:['assigned_team'],defaultRange:{from:'2026-10-01',to:'2026-10-31'},defaultRangeState:'ready'})
 expect(api.parseLeaveReadAccess({scopeVersion:'1',calendarAudiences:['granted'],defaultRange:null,defaultRangeState:'timezone_unconfirmed'}).defaultRange).toBeNull()
})

test('selected audience metadata uses an explicit default state and rejects inconsistent defaults',async()=>{
 expect(rpc.fetchLeaveReadAccess).toBeTypeOf('function')
 const access={scopeVersion:'1',calendarAudiences:['assigned_team'],defaultRange:null,defaultRangeState:'timezone_mixed'}
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:access,error:null})})
 expect(await rpc.fetchLeaveReadAccess(new AbortController().signal,'assigned_team')).toEqual(access)
 expect(mocks.rpc).toHaveBeenCalledWith('leave_reads_context_v1',{p_audience:'assigned_team'})
 expect(()=>api.parseLeaveReadAccess({...access,defaultRangeState:'ready'})).toThrow()
})
