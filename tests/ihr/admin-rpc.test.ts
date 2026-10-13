import { beforeEach,expect,test,vi } from 'vitest'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc}}))
import { emptyPolicy } from '../../src/lib/leave/adminContracts'
import { toAdminPayload,parseAdminReceipt,fetchLeaveAdminSettings,fetchLeaveAdminAccess,fetchLeaveAdminTargets } from '../../src/lib/leave/adminRpc'
const employee='71000000-0000-0000-0000-000000000001',id='81000000-0000-0000-0000-000000000001'
beforeEach(()=>rpc.mockReset())
test('policy serialization retains unconfirmed nullable choices and fixed values stay server-owned',()=>{
 const payload=toAdminPayload({operation:'save_policy_version',employeeId:employee,expectedVersion:3,reason:'Reviewed draft',policy:{...emptyPolicy,effectiveFrom:'2099-10-03'}})
 expect(payload.cancellation_allow_past).toBeNull();expect(payload.calendar_audience).toBeNull();expect(payload.cancellation_rules_confirmed).toBe(false)
 expect(payload).not.toHaveProperty('annual_allowance_minutes');expect(payload.expected_version).toBe(3)
})
test('confirmed partial rules, fractional notices and invalid effective range fail before RPC',()=>{
 for(const policy of [{...emptyPolicy,requestRulesConfirmed:true},{...emptyPolicy,minimumNoticeDays:0.5},{...emptyPolicy,cancellationRulesConfirmed:true},{...emptyPolicy,calendarAudienceConfirmed:true}])expect(()=>toAdminPayload({operation:'save_policy_version',employeeId:employee,expectedVersion:1,reason:'Reviewed',policy:{...policy,effectiveFrom:'2099-10-03'}})).toThrow()
})
test('grant payload can only name external evidence; it cannot manufacture approved scope',()=>{
 const payload=toAdminPayload({operation:'grant_leave_access',manifestId:id,expectedVersion:0,reason:'Use approved manifest'})
 expect(payload).toEqual({manifest_id:id,expected_version:0,reason:'Use approved manifest'})
 expect(()=>toAdminPayload({operation:'grant_leave_access',manifestId:id,expectedVersion:1,reason:'Reviewed'})).toThrow()
})
test('receipts reject unknown operations and private extra fields',()=>{
 expect(parseAdminReceipt({id,version:1,operation:'grant_leave_access'})).toEqual({id,version:1,operation:'grant_leave_access'})
 expect(()=>parseAdminReceipt({id,version:1,operation:'grant_leave_access',reason:'private'})).toThrow()
 expect(()=>parseAdminReceipt({id,version:1,operation:'approve_request'})).toThrow()
})
test('reads cannot accept another target and raw diagnostics stay private',async()=>{
 rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:{employeeId:id},error:null})})
 await expect(fetchLeaveAdminSettings(employee,new AbortController().signal)).rejects.toThrow('Pengaturan')
 rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:null,error:{message:'secret SQL text'}})})
 await expect(fetchLeaveAdminAccess(employee,new AbortController().signal)).rejects.not.toThrow('secret SQL text')
})
test('an aborted fulfilled read cannot become current authority evidence',async()=>{
 const controller=new AbortController();rpc.mockReturnValue({abortSignal:()=>{controller.abort();return Promise.resolve({data:{employeeId:employee,grants:[],manifests:[]},error:null})}})
 await expect(fetchLeaveAdminAccess(employee,controller.signal)).rejects.toThrow()
})

test('target discovery preserves independent capabilities, scoped totals and unavailable versus empty',async()=>{
 const data={rows:[{id:employee,name:'Fictional',capabilities:{configure:false,adjust:true,readPrivate:false,calendar:false,manageAccess:false}}],total:1,page:1,pageSize:25}
 rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data,error:null})});expect((await fetchLeaveAdminTargets(1,25,new AbortController().signal)).rows[0].capabilities.configure).toBe(false)
 rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:{...data,rows:[],total:0},error:null})});expect((await fetchLeaveAdminTargets(1,25,new AbortController().signal)).rows).toEqual([])
 rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:null,error:{message:'denied'}})});await expect(fetchLeaveAdminTargets(1,25,new AbortController().signal)).rejects.toThrow()
})
test('target discovery rejects private extras and forged pagination',async()=>{
 for(const data of [{rows:[{id:employee,name:'Fictional',reason:'Private',capabilities:{configure:true,adjust:false,readPrivate:false,calendar:false,manageAccess:false}}],total:1,page:1,pageSize:25},{rows:[],total:2,page:1,pageSize:25}]){
  rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data,error:null})});await expect(fetchLeaveAdminTargets(1,25,new AbortController().signal)).rejects.toThrow()
 }
})
