import { afterEach, expect, test, vi } from 'vitest'
import { quoteFixture, quoteInput } from './quote-fixture'
const mocks=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
import { fetchLeaveQuote, parseLeaveQuote, toQuotePayload } from '../../src/lib/leave/quoteRpc'
afterEach(()=>mocks.rpc.mockReset())
test('exact quote adapter sends one duration and no actor/account authority',async()=>{
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:quoteFixture,error:null})})
 expect(await fetchLeaveQuote(quoteInput,new AbortController().signal)).toEqual(quoteFixture)
 expect(mocks.rpc).toHaveBeenCalledWith('leave_quote_v1',{p_input:{start_date:'2026-10-02',end_date:'2026-10-03',duration:{mode:'full_scheduled_day'},reason:quoteInput.reason}})
})
test('client validates Gregorian range and fixed selections without computing allowance',()=>{
 expect(toQuotePayload({...quoteInput,startDate:'2028-02-29',endDate:'2028-02-29'})).toMatchObject({start_date:'2028-02-29'})
 for(const change of [{startDate:'2026-02-29'},{endDate:'2026-10-01'},{endDate:'2027-10-03'},{duration:{mode:'fixed_minutes',minutes:450}},{reason:'x'.repeat(1001)}])expect(()=>toQuotePayload({...quoteInput,...change} as never)).toThrow()
})
test.each([
 (q:any)=>q.reason='leaked', (q:any)=>q.totalMinutes=676, (q:any)=>q.days[1].chargedMinutes=240,
 (q:any)=>q.days[1].date='2026-10-04', (q:any)=>q.days[1].sources.rosterVersion=null,
 (q:any)=>q.allocations[0].availableAfter=-1, (q:any)=>q.allocations[0].chargedMinutes=674,
 (q:any)=>q.allocations[0].version=0, (q:any)=>q.days[0].accountId=null,
 (q:any)=>q.approver.rawGrant='private', (q:any)=>q.policy.version=1.5,
 (q:any)=>q.days[0].scheduledMinutes=0, (q:any)=>q.days[0].exclusion='holiday',
 (q:any)=>q.days[0].year=2027, (q:any)=>q.fingerprint='forged',
])('rejects malformed, internally inconsistent or extra private response fields',mutate=>{
 const q=structuredClone(quoteFixture);mutate(q);expect(()=>parseLeaveQuote(q,quoteInput)).toThrow()
})
test('rejects response for another range or duration',()=>{
 expect(()=>parseLeaveQuote(quoteFixture,{...quoteInput,endDate:'2026-10-02'})).toThrow()
 expect(()=>parseLeaveQuote(quoteFixture,{...quoteInput,duration:{mode:'fixed_minutes',minutes:225}})).toThrow()
})
test('raw backend details and transport errors cannot leak input or diagnostics',async()=>{
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:null,error:{code:'22023',message:'Private annual leave reason',details:'secret'}})})
 await expect(fetchLeaveQuote(quoteInput,new AbortController().signal)).rejects.not.toThrow('Private annual leave reason')
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.reject(new Error('Private annual leave reason'))})
 await expect(fetchLeaveQuote(quoteInput,new AbortController().signal)).rejects.not.toThrow('Private annual leave reason')
})
test('aborted obsolete quote cannot publish its response',async()=>{
 const abort=new AbortController();mocks.rpc.mockReturnValue({abortSignal:()=>{abort.abort();return Promise.resolve({data:quoteFixture,error:null})}})
 await expect(fetchLeaveQuote(quoteInput,abort.signal)).rejects.toThrow()
})
