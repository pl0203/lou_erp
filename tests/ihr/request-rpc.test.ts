import { beforeEach,expect,test,vi } from 'vitest'
import { employeeA } from './fixtures'
import { quoteInput } from './quote-fixture'
const mocks=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
import { fetchOwnLeaveHistory,fetchOwnLeaveRequest,parseRequestReceipt,toSubmitPayload } from '../../src/lib/leave/requestRpc'
export const summary={id:employeeA,sequence:4,startDate:'2026-10-02',endDate:'2026-10-03',duration:{mode:'full_scheduled_day'},totalMinutes:675,status:'submitted',version:1,submittedAt:'2026-10-01T12:00:00+00:00',sourceKind:'submission'}
const detail={...summary,reason:'Private fixture reason',approverName:'Fictional Manager',days:[{date:'2026-10-02',scheduledMinutes:450,chargedMinutes:450,exclusion:null,groupName:null},{date:'2026-10-03',scheduledMinutes:225,chargedMinutes:225,exclusion:null,groupName:'Fictional Amber'}],allocations:[{year:2026,startDate:'2026-01-01',endDate:'2027-01-01',chargedMinutes:675}]}
beforeEach(()=>mocks.rpc.mockReset())
function response(data:unknown,error:unknown=null){mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data,error})})}
test('submit maps exact quote input without caller authority and receipt strips extra private fields',()=>{
 expect(toSubmitPayload(quoteInput,'a'.repeat(64))).toEqual({input:{start_date:quoteInput.startDate,end_date:quoteInput.endDate,duration:quoteInput.duration,reason:quoteInput.reason},quote_fingerprint:'a'.repeat(64)})
 expect(()=>toSubmitPayload(quoteInput,'forged')).toThrow()
 expect(parseRequestReceipt({id:employeeA,version:1,operation:'submit_request',reason:'must not persist'})).toEqual({id:employeeA,version:1,operation:'submit_request'})
 for(const receipt of [{id:employeeA,version:0,operation:'submit_request'},{id:employeeA,version:2,operation:'submit_request'},{id:employeeA,version:1,operation:'adjust_balance'}])expect(()=>parseRequestReceipt(receipt)).toThrow()
})
test('bounded own history uses server keyset with no employee override and rejects reason leaks',async()=>{
 response({rows:[summary],nextBefore:4});expect(await fetchOwnLeaveHistory(null,25,new AbortController().signal)).toEqual({rows:[summary],nextBefore:4})
 expect(mocks.rpc).toHaveBeenCalledWith('leave_own_history_v1',{p_before:null,p_limit:25})
 response({rows:[{...summary,reason:'secret'}],nextBefore:null});await expect(fetchOwnLeaveHistory(null,25,new AbortController().signal)).rejects.toThrow('Respons riwayat')
 response({rows:[summary],nextBefore:9});await expect(fetchOwnLeaveHistory(null,25,new AbortController().signal)).rejects.toThrow()
 response({rows:[summary,summary],nextBefore:null});await expect(fetchOwnLeaveHistory(null,25,new AbortController().signal)).rejects.toThrow()
})
test('own detail verifies requested identity, frozen dates and exact original allocations',async()=>{
 response(detail);expect(await fetchOwnLeaveRequest(employeeA,new AbortController().signal)).toEqual(detail)
 for(const invalid of [{...detail,id:'71000000-0000-0000-0000-000000000002'},{...detail,totalMinutes:674},{...detail,source_snapshot:{secret:true}},{...detail,allocations:[{...detail.allocations[0],chargedMinutes:1}]},{...detail,days:[{...detail.days[0],chargedMinutes:451},detail.days[1]]}]){
  response(invalid);await expect(fetchOwnLeaveRequest(employeeA,new AbortController().signal)).rejects.toThrow('Respons riwayat')
 }
})
test('request reads reject cancellation and sanitize network and server messages',async()=>{
 const abort=new AbortController();mocks.rpc.mockReturnValue({abortSignal:()=>{abort.abort();return Promise.resolve({data:detail,error:null})}})
 await expect(fetchOwnLeaveRequest(employeeA,abort.signal)).rejects.toThrow()
 response(null,{code:'42501',message:'Private fixture reason'});await expect(fetchOwnLeaveRequest(employeeA,new AbortController().signal)).rejects.not.toThrow('Private fixture reason')
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.reject(new Error('Private fixture reason'))});await expect(fetchOwnLeaveHistory(null,25,new AbortController().signal)).rejects.not.toThrow('Private fixture reason')
})
test('owner event envelope binds request version and scope and retains exact microsecond tuple ordering',async()=>{
 const {fetchOwnRequestEvents}=await import('../../src/lib/leave/requestRpc')
 const newer={id:employeeA,event:'cancellation_declined',atTime:'2026-10-03T10:00:00.000002Z',actor:{id:employeeA,name:'Manager'},reason:'Declined once',approverName:'Manager'},older={...newer,id:'71000000-0000-0000-0000-000000000002',atTime:'2026-10-03T10:00:00.000001Z',event:'cancellation_requested'}
 const data={requestId:employeeA,requestVersion:4,scopeVersion:'scope',rows:[newer,older],nextBefore:{atTime:older.atTime,id:older.id}}
 response(data);expect((await fetchOwnRequestEvents(employeeA,4,'scope',null,2,new AbortController().signal)).rows).toEqual([newer,older])
 expect(mocks.rpc).toHaveBeenLastCalledWith('leave_own_request_history_v1',{p_request_id:employeeA,p_before_at:null,p_before_id:null,p_limit:2})
 for(const bad of [{...data,requestVersion:3},{...data,scopeVersion:'stale'},{...data,requestId:older.id},{...data,rows:[older,newer]},{...data,rows:[{...newer,data:{private:true}},older]},{...data,nextBefore:{atTime:newer.atTime,id:newer.id}}]){
  response(bad);await expect(fetchOwnRequestEvents(employeeA,4,'scope',null,2,new AbortController().signal)).rejects.toThrow()
 }
})
