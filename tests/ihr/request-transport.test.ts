import { webcrypto } from 'node:crypto'
import { beforeEach,expect,test,vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { employeeA,employeeB } from './fixtures'
import { quoteInput } from './quote-fixture'
const mocks=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
import { createLeaveCommandTransport,createLeaveRequestTransport,invalidateRequestCaches } from '../../src/lib/leave/requestTransport'
import { leaveKeys } from '../../src/lib/leave/queryKeys'
const receipt={id:employeeA,version:1,operation:'submit_request'}
function transport(authorize=async()=>{},actor=employeeA,backend='fixture'){return createLeaveRequestTransport({actorId:actor,backendScope:backend,formScope:'own-request',storage:()=>localStorage,authorize})}
beforeEach(()=>{mocks.rpc.mockReset();localStorage.clear();vi.stubGlobal('crypto',webcrypto)})
test('lost response survives reload, fences a different attempt and keeps only UUID/hash/uncertainty',async()=>{
 mocks.rpc.mockRejectedValueOnce(new Error('Private reason network error'))
 await expect(transport().send(quoteInput,'a'.repeat(64))).rejects.toThrow('Pengajuan belum dapat dipastikan')
 const raw=localStorage.getItem(localStorage.key(0)!)!;expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['id','key','uncertain']);expect(raw).not.toMatch(/reason|input|start_date|Private/)
 const reloaded=transport();expect(reloaded.hasUnresolved()).toBe(true)
 await expect(reloaded.send({...quoteInput,reason:'Changed'},'a'.repeat(64))).rejects.toThrow();expect(mocks.rpc).toHaveBeenCalledTimes(1)
 const recovered=receipt;expect(recovered.id).not.toBe(JSON.parse(raw).id);mocks.rpc.mockResolvedValueOnce({data:{state:'committed',result:{...recovered,reason:'must not persist'}},error:null})
 expect(await reloaded.reconcile()).toEqual({state:'committed',result:recovered})
 expect(localStorage.getItem(localStorage.key(0)!)).not.toMatch(/reason|must not persist/)
 reloaded.acknowledgeRecovered();expect(reloaded.hasUnresolved()).toBe(false)
})
test('current authorization gates both send/recovery and malformed receipt preserves uncertainty',async()=>{
 const blocked=transport(async()=>{throw new Error('revoked')});await expect(blocked.send(quoteInput,'a'.repeat(64))).rejects.toThrow();expect(mocks.rpc).not.toHaveBeenCalled()
 mocks.rpc.mockResolvedValue({data:{...receipt,operation:'adjust_balance'},error:null});const t=transport();await expect(t.send(quoteInput,'a'.repeat(64))).rejects.toThrow();expect(t.hasUnresolved()).toBe(true)
 await expect(blocked.reconcile()).rejects.toThrow();expect(mocks.rpc).toHaveBeenCalledTimes(1)
})
test('terminal abandonment permits a new UUID and backend/actor scopes isolate metadata',async()=>{
 mocks.rpc.mockRejectedValueOnce(new Error('lost'));const t=transport();await expect(t.send(quoteInput,'a'.repeat(64))).rejects.toThrow()
 const first=mocks.rpc.mock.calls[0][1].p_request_id;expect(transport(async()=>{},employeeB).hasUnresolved()).toBe(false);expect(transport(async()=>{},employeeA,'other').hasUnresolved()).toBe(false)
 mocks.rpc.mockResolvedValueOnce({data:{state:'abandoned'},error:null});expect(await t.reconcile()).toEqual({state:'abandoned'});expect(t.hasUnresolved()).toBe(false)
 mocks.rpc.mockResolvedValueOnce({data:receipt,error:null});await t.send(quoteInput,'a'.repeat(64));expect(mocks.rpc.mock.calls.at(-1)?.[1].p_request_id).not.toBe(first)
})
test('wrong successful/recovered operation cannot consume stored identity',async()=>{
 mocks.rpc.mockRejectedValueOnce(new Error('lost'));const t=transport();await expect(t.send(quoteInput,'a'.repeat(64))).rejects.toThrow()
 mocks.rpc.mockResolvedValueOnce({data:{state:'committed',result:{...receipt,operation:'adjust_balance'}},error:null});await expect(t.reconcile()).rejects.toThrow();expect(t.hasUnresolved()).toBe(true)
})
test('confirmed or recovered success invalidates every affected leave cache for current backend',async()=>{
 const client=new QueryClient();client.setQueryData(leaveKeys.private(employeeA,'1','own-history'),{});client.setQueryData(leaveKeys.context(employeeA,'current'),{});client.setQueryData(leaveKeys.private(employeeB,'1','approvals'),{})
 await invalidateRequestCaches(client)
 for(const q of client.getQueryCache().getAll())expect(q.state.isInvalidated).toBe(true)
 client.clear()
})

test('shared command transport validates configured minimal receipt and isolates form scope',async()=>{
 const parseReceipt=(value:unknown)=>{const v=value as {id:string;version:number;operation:string};if(v.operation!=='withdraw_request'||v.version!==2)throw new Error('Invalid transition');return {id:v.id,version:v.version,operation:v.operation}}
 const options={actorId:employeeA,backendScope:'fixture',formScope:'withdraw',storage:()=>localStorage,authorize:async()=>{},parseReceipt}
 const t=createLeaveCommandTransport(options)
 mocks.rpc.mockRejectedValueOnce(new Error('Private transition note'))
 await expect(t.send('withdraw_request',{request_id:employeeB,expected_version:1})).rejects.toThrow()
 expect(t.hasUnresolved()).toBe(true);expect(transport().hasUnresolved()).toBe(false)
 const raw=localStorage.getItem(localStorage.key(0)!)!;expect(raw).not.toMatch(/note|request_id|expected_version|Private/)
 mocks.rpc.mockResolvedValueOnce({data:{state:'committed',result:{id:employeeB,version:2,operation:'withdraw_request',note:'Private'}},error:null})
 expect(await t.reconcile()).toEqual({state:'committed',result:{id:employeeB,version:2,operation:'withdraw_request'}})
 expect(localStorage.getItem(localStorage.key(0)!)).not.toContain('Private');t.acknowledgeRecovered();expect(t.hasUnresolved()).toBe(false)
})

test('submit accepts server-created subject distinct from command UUID and clears only confirmed uncertainty',async()=>{
 mocks.rpc.mockResolvedValueOnce({data:receipt,error:null});const t=transport()
 expect(await t.send(quoteInput,'a'.repeat(64))).toEqual(receipt)
 expect(mocks.rpc.mock.calls[0][1].p_request_id).not.toBe(receipt.id)
 expect(t.hasUnresolved()).toBe(false)
})
