import { webcrypto } from 'node:crypto'
import { beforeEach, expect, test, vi } from 'vitest'
import { employeeA, employeeB } from './fixtures'
const mocks=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
import { createLeaveBalanceTransport } from '../../src/lib/leave/balanceTransport'
const command={operation:'adjust_balance' as const,employeeId:employeeA,year:2026,deltaMinutes:-60,sourceId:employeeB,expectedVersion:4,reason:'Private correction reason'}
beforeEach(()=>{mocks.rpc.mockReset();localStorage.clear();vi.stubGlobal('crypto',webcrypto)})
function transport(authorize=async()=>{}){return createLeaveBalanceTransport({actorId:employeeB,backendScope:'fictional',formScope:'balance',storage:()=>localStorage,authorize})}
test('balance transport shares command sender and persists only minimal recovery metadata',async()=>{
 mocks.rpc.mockRejectedValueOnce(new Error('network private server error'));const t=transport()
 await expect(t.send(command)).rejects.toThrow('Saldo belum dapat disimpan')
 expect(t.hasUnresolved()).toBe(true)
 const stored=localStorage.getItem(localStorage.key(0)!)!
 expect(stored).not.toMatch(/Private|employee_id|delta_minutes|source_id|payload/)
 expect(Object.keys(JSON.parse(stored)).sort()).toEqual(['id','key','uncertain'])
 expect(mocks.rpc.mock.calls[0][0]).toBe('leave_transaction_v1')
 mocks.rpc.mockResolvedValue({data:{state:'committed',result:{id:employeeA,version:5,operation:'adjust_balance',reason:'never persist'}},error:null})
 expect(await t.reconcile()).toEqual({state:'committed',result:{id:employeeA,version:5,operation:'adjust_balance'}})
 expect(mocks.rpc.mock.calls[1][0]).toBe('leave_reconcile_request_v1')
 expect(localStorage.getItem(localStorage.key(0)!)).not.toMatch(/reason|never persist/)
 t.acknowledgeRecovered();expect(t.hasUnresolved()).toBe(false)
})
test('live scope revocation prevents send and receipt mismatch stays unresolved',async()=>{
 const blocked=transport(async()=>{throw new Error('revoked')})
 await expect(blocked.send(command)).rejects.toThrow();expect(mocks.rpc).not.toHaveBeenCalled()
 mocks.rpc.mockResolvedValue({data:{id:employeeA,version:4,operation:'reconcile_opening'},error:null})
 const t=transport();await expect(t.send(command)).rejects.toThrow();expect(t.hasUnresolved()).toBe(true)
})
test('noninteger adjustment is rejected before network or metadata',async()=>{
 await expect(transport().send({...command,deltaMinutes:0.5})).rejects.toThrow()
 expect(mocks.rpc).not.toHaveBeenCalled();expect(localStorage.length).toBe(0)
})
