import { beforeEach, expect, test, vi } from 'vitest'
const mocks=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
import { createLeaveSetupTransport, fetchLeaveRota, previewLeaveRoster, toSetupPayload } from '../../src/lib/leave/setupRpc'
const actor='71000000-0000-0000-0000-000000000005',id='71000000-0000-0000-0000-000000000001',cal='73000000-0000-0000-0000-000000000001',group='74000000-0000-0000-0000-000000000001'
const command={operation:'set_member' as const,employeeId:id,memberKind:'employee' as const,active:true,employmentStart:null,eligibilityDate:null,calendarId:null,expectedVersion:1,reason:'Fictional secret reason'}
beforeEach(()=>{mocks.rpc.mockReset();localStorage.clear()})
test('maps exact SQL fields and rejects invalid date or unsupported working Sunday',()=>{
 expect(toSetupPayload({...command,actor_id:'forged'} as typeof command)).toEqual({employee_id:id,member_kind:'employee',active:true,employment_start:null,eligibility_date:null,calendar_id:null,expected_version:1,reason:command.reason})
 expect(()=>toSetupPayload({...command,employmentStart:'2026-02-30'})).toThrow()
 for(const sundayMinutes of [225,450]) expect(()=>toSetupPayload({operation:'save_calendar_version',calendarId:cal,name:'Fictional',effectiveFrom:'2099-10-01',effectiveUntil:null,timezone:null,holidaysConfirmed:false,sundayMinutes,holidays:[],groups:[],expectedVersion:0,reason:'test'} as unknown as Parameters<typeof toSetupPayload>[0])).toThrow()
})
test('retains shared UUID/fence on ambiguity and storage contains only minimal metadata',async()=>{
 mocks.rpc.mockResolvedValueOnce({data:null,error:{code:'NETWORK',message:'private SQL'}})
 const authorize=vi.fn().mockResolvedValue(undefined),transport=createLeaveSetupTransport({actorId:actor,backendScope:'fictional',formScope:'people',storage:()=>localStorage,authorize})
 await expect(transport.send(command)).rejects.toThrow('Pengaturan cuti')
 const first=mocks.rpc.mock.calls[0][1].p_request_id
 expect(mocks.rpc.mock.calls[0][0]).toBe('leave_transaction_v1')
 expect(localStorage.getItem(localStorage.key(0)!)).not.toContain(command.reason)
 expect(localStorage.key(0)).toContain(actor)
 await expect(transport.send({...command,reason:'Changed'})).rejects.toThrow()
 expect(mocks.rpc).toHaveBeenCalledTimes(1)
 mocks.rpc.mockResolvedValueOnce({data:{id,version:2,operation:'set_member'},error:null})
 await transport.send(command)
 expect(mocks.rpc.mock.calls[1][1].p_request_id).toBe(first)
})
test('reconcile uses shared RPC and cannot persist extra private fields',async()=>{
 mocks.rpc.mockResolvedValueOnce({data:null,error:{code:'NETWORK',message:'hidden'}})
 const transport=createLeaveSetupTransport({actorId:actor,backendScope:'fixture',formScope:'people',storage:()=>localStorage,authorize:async()=>{}})
 await expect(transport.send(command)).rejects.toThrow()
 mocks.rpc.mockResolvedValueOnce({data:{state:'committed',result:{id,version:2,operation:'set_member',private_note:'never store'}},error:null})
 expect(await transport.reconcile()).toEqual({state:'committed',result:{id,version:2,operation:'set_member'}})
 expect(mocks.rpc.mock.calls[1][0]).toBe('leave_reconcile_request_v1')
 expect(localStorage.getItem(localStorage.key(0)!)).not.toMatch(/private_note|never store|reason|scopeVersion/)
})
test('preview is abortable read-only and validates capacities; rota rejects working Sundays',async()=>{
 const data={calendarId:cal,calendarVersion:1,fingerprint:'fp',rows:[{date:'2099-10-03',groupId:group,capacityMinutes:225,reason:'discard'}],impacts:{available:false,pendingCount:null,approvedCount:null}}
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data,error:null})})
 const input={calendarId:cal,anchor:'2099-10-03',from:'2099-10-03',to:'2099-11-01',groups:[{id:group,onAnchor:true}]}
 expect((await previewLeaveRoster(input,new AbortController().signal)).rows[0]).not.toHaveProperty('reason')
 expect(mocks.rpc.mock.calls[0][0]).toBe('leave_roster_preview_v1')
 data.rows[0].capacityMinutes=450
 await expect(previewLeaveRoster(input,new AbortController().signal)).rejects.toThrow()
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:{rows:[{id:cal,name:'Test',version:1,effectiveFrom:'2099-10-01',effectiveUntil:null,timezone:null,confirmedTimezone:null,holidaysConfirmed:false,sundayMinutes:450,holidays:[],groups:[],impacts:data.impacts}],total:1,page:1,pageSize:20},error:null})})
 await expect(fetchLeaveRota(1,20,new AbortController().signal)).rejects.toThrow()
})
test('revocation sends all three nulls and rejects mixed-null shapes',()=>{
 const base={operation:'set_approver' as const,employeeId:id,approverId:null,effectiveFrom:null,effectiveUntil:null,replaceAssignmentId:group,expectedVersion:2,reason:'Explicit revocation'}
 expect(toSetupPayload(base)).toEqual({employee_id:id,approver_id:null,effective_from:null,effective_until:null,replace_assignment_id:group,expected_version:2,reason:base.reason})
 expect(()=>toSetupPayload({...base,effectiveFrom:'2099-10-03'})).toThrow()
 expect(()=>toSetupPayload({...base,replaceAssignmentId:null})).toThrow()
})
const makeTransport=()=>createLeaveSetupTransport({actorId:actor,backendScope:'fixture',formScope:'people',storage:()=>localStorage,authorize:async()=>{}})
const receipt={id,version:2,operation:'set_member'}
const malformed=[{id,operation:'set_member'},{id,version:2},{id:'invalid',version:2,operation:'set_member'},{...receipt,operation:'set_approver'}]
test.each(malformed)('malformed command receipt retains identity through reload and blocks a new command: %j',async(bad)=>{
 mocks.rpc.mockResolvedValueOnce({data:{...bad,private_note:command.reason},error:null})
 const transport=makeTransport()
 await expect(transport.send(command)).rejects.toThrow('Pengaturan cuti')
 expect(transport.hasUnresolved()).toBe(true)
 const first=mocks.rpc.mock.calls[0][1].p_request_id,raw=localStorage.getItem(localStorage.key(0)!)!
 expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['id','key','uncertain'])
 expect(raw).not.toMatch(/Fictional|private_note|reason|scopeVersion|operation/)
 const reloaded=makeTransport()
 await expect(reloaded.send({...command,reason:'Changed draft'})).rejects.toThrow()
 expect(mocks.rpc).toHaveBeenCalledTimes(1)
 mocks.rpc.mockResolvedValueOnce({data:{state:'committed',result:{...receipt,private_note:'never persist'}},error:null})
 expect(await reloaded.reconcile()).toEqual({state:'committed',result:receipt})
 expect(mocks.rpc.mock.calls[1][1].p_request_id).toBe(first)
 expect(localStorage.getItem(localStorage.key(0)!)).not.toMatch(/private_note|never persist|reason|scopeVersion/)
 expect(await reloaded.send(command)).toEqual(receipt)
 expect(mocks.rpc).toHaveBeenCalledTimes(2);expect(reloaded.hasUnresolved()).toBe(false)
})
test.each(malformed.slice(0,3))('malformed reconciliation receipt remains unresolved after reload: %j',async(bad)=>{
 mocks.rpc.mockResolvedValueOnce({data:null,error:{code:'NETWORK',message:'private'}})
 await expect(makeTransport().send(command)).rejects.toThrow()
 const first=mocks.rpc.mock.calls[0][1].p_request_id,reloaded=makeTransport()
 mocks.rpc.mockResolvedValueOnce({data:{state:'committed',result:bad},error:null})
 await expect(reloaded.reconcile()).rejects.toThrow('Jangan membuat pengiriman baru')
 expect(reloaded.hasUnresolved()).toBe(true)
 await expect(reloaded.send({...command,reason:'Other'})).rejects.toThrow()
 expect(mocks.rpc).toHaveBeenCalledTimes(2)
 mocks.rpc.mockResolvedValueOnce({data:{state:'abandoned'},error:null})
 expect(await reloaded.reconcile()).toEqual({state:'abandoned'})
 expect(mocks.rpc.mock.calls[2][1].p_request_id).toBe(first);expect(reloaded.hasUnresolved()).toBe(false)
})
test('operation mismatch in a recovered receipt cannot consume identity on command replay',async()=>{
 mocks.rpc.mockResolvedValueOnce({data:null,error:{code:'NETWORK',message:'hidden'}})
 await expect(makeTransport().send(command)).rejects.toThrow()
 const reloaded=makeTransport()
 mocks.rpc.mockResolvedValueOnce({data:{state:'committed',result:{...receipt,operation:'set_approver'}},error:null})
 await reloaded.reconcile() // Reload only knows the UUID/hash; the server supplies the receipt operation.
 await expect(reloaded.send(command)).rejects.toThrow()
 expect(reloaded.hasUnresolved()).toBe(true)
 const pending=JSON.parse(localStorage.getItem(localStorage.key(0)!)!)
 expect(pending).toMatchObject({id:mocks.rpc.mock.calls[0][1].p_request_id,uncertain:true})
 expect(pending).not.toHaveProperty('committed')
 expect(mocks.rpc).toHaveBeenCalledTimes(2)
 mocks.rpc.mockResolvedValueOnce({data:{state:'committed',result:receipt},error:null})
 expect(await reloaded.reconcile()).toEqual({state:'committed',result:receipt})
 expect(await reloaded.send(command)).toEqual(receipt)
 expect(reloaded.hasUnresolved()).toBe(false)
})

test('retry after a malformed success keeps the same command UUID',async()=>{
 mocks.rpc.mockResolvedValueOnce({data:{id},error:null})
 const transport=makeTransport()
 await expect(transport.send(command)).rejects.toThrow()
 const requestId=mocks.rpc.mock.calls[0][1].p_request_id
 mocks.rpc.mockResolvedValueOnce({data:receipt,error:null})
 expect(await transport.send(command)).toEqual(receipt)
 expect(mocks.rpc.mock.calls[1][1].p_request_id).toBe(requestId)
 expect(transport.hasUnresolved()).toBe(false)
})
