import { beforeEach,describe,expect,it,vi } from 'vitest'
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc}}))
import { fetchAssignedInbox,fetchAssignedRequest,fetchOwnTransitionState,parseTransitionReceipt,toTransitionPayload } from '../../src/lib/leave/transitionRpc'
const id='82000000-0000-0000-0000-000000000001',attempt='82000000-0000-0000-0000-000000000002'
const signal=()=>new AbortController().signal
const row={id,sequence:2,startDate:'2026-10-09',endDate:'2026-10-09',duration:{mode:'full_scheduled_day'},totalMinutes:450,status:'submitted',version:1,submittedAt:'2026-10-03T00:00:00Z',sourceKind:'submission',employee:{id:'71000000-0000-0000-0000-000000000001',name:'Fictional employee'},cancellationAttemptId:null,cancellationRequestedAt:null}
function respond(data:unknown,error:unknown=null){rpc.mockReturnValue({abortSignal:vi.fn().mockResolvedValue({data,error})})}
beforeEach(()=>rpc.mockReset())
describe('transition boundary',()=>{
 it('serializes only exact operation-specific identifiers/version and ephemeral reason',()=>{
  expect(toTransitionPayload({operation:'withdraw_request',requestId:id,expectedVersion:1})).toEqual({request_id:id,expected_version:1})
  expect(toTransitionPayload({operation:'decline_cancellation',requestId:id,expectedVersion:3,attemptId:attempt,reason:'Needs dates'})).toEqual({request_id:id,expected_version:3,attempt_id:attempt,reason:'Needs dates'})
  expect(()=>toTransitionPayload({operation:'reject_request',requestId:id,expectedVersion:1,reason:' '})).toThrow()
  expect(()=>toTransitionPayload({operation:'approve_request',requestId:id,expectedVersion:1.5})).toThrow()
 })
 it('keeps receipts minimal and rejects unknown operations/versions',()=>{
  expect(parseTransitionReceipt({id,version:2,operation:'approve_request',reason:'private'})).toEqual({id,version:2,operation:'approve_request'})
  expect(()=>parseTransitionReceipt({id,version:1,operation:'approve_request'})).toThrow()
  expect(()=>parseTransitionReceipt({id,version:2,operation:'submit_request'})).toThrow()
 })
 it('validates assigned keyset and does not turn denied/errors into empty',async()=>{
  respond({rows:[row],nextBefore:null});expect((await fetchAssignedInbox(null,25,signal())).rows).toHaveLength(1)
  respond({rows:[row,row],nextBefore:2});await expect(fetchAssignedInbox(null,25,signal())).rejects.toThrow()
  respond(null,{code:'42501',message:'secret'});await expect(fetchAssignedInbox(null,25,signal())).rejects.toThrow();
  respond({rows:[],nextBefore:null});expect(await fetchAssignedInbox(null,25,signal())).toEqual({rows:[],nextBefore:null})
 })
 it('rejects inaccessible-status/cancellation mismatches and aborted private reads',async()=>{
  respond({rows:[{...row,status:'approved'}],nextBefore:null});await expect(fetchAssignedInbox(null,25,signal())).rejects.toThrow()
  respond({rows:[{...row,status:'cancellation_pending'}],nextBefore:null});await expect(fetchAssignedInbox(null,25,signal())).rejects.toThrow()
  const c=new AbortController();c.abort();respond({rows:[],nextBefore:null});await expect(fetchAssignedInbox(null,25,c.signal)).rejects.toThrow()
 })
 it('validates full frozen assigned detail and totals',async()=>{
  const detail={...row,reason:'Fictional reason',approverName:'Fictional manager',days:[{date:'2026-10-09',scheduledMinutes:450,chargedMinutes:450,exclusion:null,groupName:null}],allocations:[{year:2026,startDate:'2026-01-01',endDate:'2027-01-01',chargedMinutes:450}],cancellation:null,balanceContext:{basis:'current',asOf:'2026-10-03T01:00:00Z',periods:[{year:2026,reservedMinutes:450,usedMinutes:900,availableMinutes:4050,expiredMinutes:0,reconciled:true}]}}
  respond(detail);expect((await fetchAssignedRequest(id,signal())).totalMinutes).toBe(450)
  respond({...detail,totalMinutes:225});await expect(fetchAssignedRequest(id,signal())).rejects.toThrow()
 })
 it('fails closed on contradictory own cancellation state',async()=>{
  const state={id,version:2,status:'approved',canWithdraw:false,canRequestCancellation:false,cancellationBlocker:'CANCELLATION_RULES_UNCONFIRMED',activeAttemptId:null}
  respond(state);expect(await fetchOwnTransitionState(id,signal())).toEqual(state)
  respond({...state,canRequestCancellation:true});await expect(fetchOwnTransitionState(id,signal())).rejects.toThrow()
 })
})
it('assigned balance rejects unrelated periods, extra account handles and missing verification',async()=>{
 const detail={...row,reason:'',approverName:'Manager',days:[{date:row.startDate,scheduledMinutes:450,chargedMinutes:450,exclusion:null,groupName:null}],allocations:[{year:2026,startDate:'2026-01-01',endDate:'2027-01-01',chargedMinutes:450}],cancellation:null,balanceContext:{basis:'current',asOf:'2026-10-03T12:00:00Z',periods:[{year:2026,reservedMinutes:450,usedMinutes:0,availableMinutes:4950,expiredMinutes:0,reconciled:true}]}}
 respond(detail);expect((await fetchAssignedRequest(id,signal())).balanceContext.periods[0].availableMinutes).toBe(4950)
 for(const balanceContext of [{...detail.balanceContext,periods:[]},{...detail.balanceContext,basis:'submission'},{...detail.balanceContext,periods:[{...detail.balanceContext.periods[0],year:2025}]},{...detail.balanceContext,periods:[{...detail.balanceContext.periods[0],accountId:id}]},{...detail.balanceContext,periods:[{...detail.balanceContext.periods[0],reconciled:false}]}]){respond({...detail,balanceContext});await expect(fetchAssignedRequest(id,signal())).rejects.toThrow()}
})
