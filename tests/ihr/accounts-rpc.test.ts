import { beforeEach, expect, test, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { employeeA, employeeB } from './fixtures'
const mocks=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
import { fetchLeaveContext } from '../../src/lib/leave/rpc'
import { fetchBalanceHistory, parseAccountBalance, parseCurrentPeriod, toBalancePayload, formatSignedLeaveMinutes } from '../../src/lib/leave/accountRpc'
import { prepareCurrentLeaveAccount } from '../../src/lib/leave/prepareAccount'
import { leaveKeys, synchronizeLeaveIdentity } from '../../src/lib/leave/queryKeys'
const period={year:2026,startDate:'2026-01-01',endDate:'2027-01-01'}
const balance={accountId:employeeA,year:2026,allowanceMinutes:5400,approvedMinutes:450,pendingMinutes:60,availableMinutes:4890,expiredMinutes:0,version:4,reconciled:true}
const context={scopeVersion:'1',memberKind:'employee',capabilities:{request:true,approve:false,configure:false,adjust:false,readPrivate:false,manageAccess:false},timezone:'Pacific/Kiritimati',setup:{ready:false,blockers:[{code:'approver_missing',message:'Penyetuju belum ada'}]},currentPeriod:period,balances:[] as unknown[]}
const reply=(data:unknown)=>({abortSignal:()=>Promise.resolve({data,error:null})})
beforeEach(()=>mocks.rpc.mockReset())
test('current server period requires exact calendar-year boundaries',()=>{
 expect(parseCurrentPeriod(period)).toEqual(period)
 for(const p of [{...period,startDate:'2026-02-01'},{...period,year:2026.5},{...period,endDate:'2026-12-31'}])expect(()=>parseCurrentPeriod(p)).toThrow()
 expect(parseCurrentPeriod(null)).toBeNull()
})
test('unverified and legacy balance buckets fail closed and exact parsing drops private extras',()=>{
 expect(parseAccountBalance({...balance,reconciled:false,actorId:employeeB})).toEqual({...balance,reconciled:false,approvedMinutes:null,pendingMinutes:null,availableMinutes:null,expiredMinutes:null})
 const {reconciled:_,...old}=balance
 expect(parseAccountBalance(old).availableMinutes).toBeNull()
 expect(parseAccountBalance({...balance,secret:'never'})).toEqual(balance)
 for(const b of [{...balance,version:0},{...balance,availableMinutes:4890.5},{...balance,approvedMinutes:null},{...balance,availableMinutes:5000}])expect(()=>parseAccountBalance(b)).toThrow()
})
test('older context omission stays omitted and cannot prepare',async()=>{
 const {currentPeriod:_,...old}=context;mocks.rpc.mockReturnValue(reply(old))
 const c=await fetchLeaveContext(new AbortController().signal)
 expect(c.currentPeriod).toBeUndefined()
 await expect(prepareCurrentLeaveAccount(new QueryClient(),employeeA,c)).rejects.toThrow()
 expect(mocks.rpc).toHaveBeenCalledTimes(1)
})
test('history is bounded, exact and cannot restore an aborted result',async()=>{
 const entry={id:employeeA,sequence:4,date:'2026-10-02',kind:'adjustment',allowanceDelta:-60,reservedDelta:0,usedDelta:0}
 mocks.rpc.mockReturnValue(reply({balance,rows:[{...entry,reason:'secret',actorId:employeeB}],nextBefore:4,private:'raw'}))
 expect(await fetchBalanceHistory(employeeA,null,25,new AbortController().signal)).toEqual({balance,rows:[entry],nextBefore:4})
 expect(mocks.rpc).toHaveBeenCalledWith('leave_balance_history_v1',{p_account_id:employeeA,p_before:null,p_limit:25})
 await expect(fetchBalanceHistory(employeeA,null,101,new AbortController().signal)).rejects.toThrow()
 const abort=new AbortController();abort.abort();await expect(fetchBalanceHistory(employeeA,null,25,abort.signal)).rejects.toThrow()
})
test('opening payload includes verified allowance and stable future source IDs without inferring remaining',()=>{
 const c={operation:'reconcile_opening' as const,employeeId:employeeA,year:2026,allowanceMinutes:5400,pastUsedMinutes:450,asOf:'2026-10-02',futureApproved:[{sourceId:employeeB,startDate:'2026-10-05',endDate:'2026-10-05',duration:{mode:'fixed_minutes' as const,minutes:60 as const},totalMinutes:60}],sourceId:employeeA,expectedVersion:2,reason:'Reviewed'}
 expect(toBalancePayload(c)).toEqual({employee_id:employeeA,year:2026,allowance_minutes:5400,past_used_minutes:450,as_of:'2026-10-02',future_approved:[{source_id:employeeB,start_date:'2026-10-05',end_date:'2026-10-05',duration:{mode:'fixed_minutes',minutes:60},total_minutes:60}],source_id:employeeA,expected_version:2,reason:'Reviewed'})
 expect(()=>toBalancePayload({...c,allowanceMinutes:4950})).toThrow()
 expect(()=>toBalancePayload({...c,futureApproved:[c.futureApproved[0],c.futureApproved[0]]})).toThrow()
})
test('signed adjustments do not weaken shared nonnegative formatting',()=>{
 expect(formatSignedLeaveMinutes(-225)).toBe('−3j 45m');expect(formatSignedLeaveMinutes(60)).toBe('+1j');expect(formatSignedLeaveMinutes(0)).toBe('0j')
 expect(()=>toBalancePayload({operation:'adjust_balance',employeeId:employeeA,year:2026,deltaMinutes:0,sourceId:employeeB,expectedVersion:2,reason:'Reviewed'})).toThrow()
})
test('preparation is explicitly invoked, coalesced by client/actor/year and read back before publishing',async()=>{
 const q=new QueryClient(),prepared={...context,balances:[balance]};let resolve!:()=>void;const pending=new Promise<void>(r=>resolve=r)
 mocks.rpc.mockImplementation((name:string)=>name==='leave_prepare_self_v1'?{abortSignal:async()=>{await pending;return {data:{accountId:employeeA,year:2026,version:4},error:null}}}:reply(prepared))
 const one=prepareCurrentLeaveAccount(q,employeeA,context),two=prepareCurrentLeaveAccount(q,employeeA,context)
 await vi.waitFor(()=>expect(mocks.rpc.mock.calls.filter(([name])=>name==='leave_prepare_self_v1')).toHaveLength(1))
 expect(q.getQueryData(leaveKeys.context(employeeA,'current'))).not.toEqual(prepared)
 resolve();expect(await one).toEqual(prepared);expect(await two).toEqual(prepared)
 expect(q.getQueryData(leaveKeys.context(employeeA,'current'))).toEqual(prepared);q.clear()
})
test('cancelled preparation cannot publish a late response after identity transition',async()=>{
 const q=new QueryClient();let resolve!:(v:unknown)=>void
 mocks.rpc.mockImplementation((name:string)=>name==='leave_prepare_self_v1'?{abortSignal:()=>new Promise(r=>resolve=r)}:reply(context))
 const pending=prepareCurrentLeaveAccount(q,employeeA,context).catch(()=>null)
 await vi.waitFor(()=>expect(resolve).toBeDefined());synchronizeLeaveIdentity(q,employeeB)
 resolve({data:{accountId:employeeA,year:2026,version:2},error:null});await pending
 expect(q.getQueryData(leaveKeys.context(employeeA,'current'))).toBeUndefined();q.clear()
})
test.each(['director','missing_account','new_year'])('preparation read-back rejects %s instead of showing grant',async(mode)=>{
 const q=new QueryClient();mocks.rpc.mockImplementation((name:string)=>name==='leave_prepare_self_v1'?reply({accountId:employeeA,year:2026,version:2}):reply(mode==='director'?{...context,memberKind:'director',currentPeriod:null,capabilities:{...context.capabilities,request:false}}:mode==='new_year'?{...context,currentPeriod:{year:2027,startDate:'2027-01-01',endDate:'2028-01-01'}}:context))
 await expect(prepareCurrentLeaveAccount(q,employeeA,context)).rejects.toThrow();q.clear()
})
test('account parser rejects out-of-domain SQL integer buckets',()=>{
 expect(()=>parseAccountBalance({...balance,allowanceMinutes:2147483648,availableMinutes:2147483138})).toThrow()
})
test('context refuses duplicate annual account periods',async()=>{
 mocks.rpc.mockReturnValue(reply({...context,balances:[balance,{...balance,accountId:employeeB}]}))
 await expect(fetchLeaveContext(new AbortController().signal)).rejects.toThrow()
})
test('private account list parser is exact and an unverified target cannot invent a current period',async()=>{
 const {fetchBalanceAccounts}=await import('../../src/lib/leave/accountRpc')
 mocks.rpc.mockReturnValue(reply({currentPeriod:null,balances:[{...balance,private:'secret'}],employeeName:'not in adapter'}))
 expect(await fetchBalanceAccounts(employeeA,new AbortController().signal)).toEqual({currentPeriod:null,balances:[balance]})
 expect(mocks.rpc).toHaveBeenCalledWith('leave_balance_accounts_v1',{p_employee_id:employeeA})
 mocks.rpc.mockReturnValue(reply({balances:[balance]}))
 await expect(fetchBalanceAccounts(employeeA,new AbortController().signal)).rejects.toThrow()
})
