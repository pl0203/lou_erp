import { webcrypto } from 'node:crypto'
import { beforeEach,expect,test,vi } from 'vitest'
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc}}))
import { createLeaveTransitionTransport } from '../../src/lib/leave/transitionTransport'
const actor='71000000-0000-0000-0000-000000000003',id='82000000-0000-0000-0000-000000000001'
function transport(){return createLeaveTransitionTransport({actorId:actor,backendScope:'fixture',formScope:'assigned',storage:()=>localStorage,authorize:async()=>{}})}
beforeEach(()=>{rpc.mockReset();localStorage.clear();vi.stubGlobal('crypto',webcrypto)})
test('a successful receipt must match the actual leave subject and expected next version before metadata clears',async()=>{
 const t=transport();rpc.mockResolvedValueOnce({data:{id:actor,version:2,operation:'approve_request'},error:null})
 await expect(t.send({operation:'approve_request',requestId:id,expectedVersion:1})).rejects.toThrow();expect(t.hasUnresolved()).toBe(true)
 rpc.mockResolvedValueOnce({data:{state:'abandoned'},error:null});await t.reconcile()
 rpc.mockResolvedValueOnce({data:{id,version:3,operation:'approve_request'},error:null})
 await expect(t.send({operation:'approve_request',requestId:id,expectedVersion:1})).rejects.toThrow();expect(t.hasUnresolved()).toBe(true)
})
test('lost cancellation response retains only minimal metadata and can reconcile once',async()=>{
 const t=transport();rpc.mockRejectedValueOnce(new Error('private cancellation note'))
 await expect(t.send({operation:'request_cancellation',requestId:id,expectedVersion:2,reason:'Private reason'})).rejects.toThrow()
 const raw=localStorage.getItem(localStorage.key(0)!)!;expect(raw).not.toMatch(/reason|request_id|Private|cancellation/)
 const reloaded=transport();rpc.mockResolvedValueOnce({data:{state:'committed',result:{id,version:3,operation:'request_cancellation',reason:'private'}},error:null})
 expect(await reloaded.reconcile()).toEqual({state:'committed',result:{id,version:3,operation:'request_cancellation'}})
 expect(localStorage.getItem(localStorage.key(0)!)).not.toContain('private');reloaded.acknowledgeRecovered();expect(reloaded.hasUnresolved()).toBe(false)
})
