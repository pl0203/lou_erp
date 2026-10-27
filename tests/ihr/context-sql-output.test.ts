import { readFileSync } from 'node:fs'
import { describe, expect, test, vi } from 'vitest'
const mocks=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
import { fetchLeaveContext } from '../../src/lib/leave/rpc'
const path=process.env.IHR_CONTEXT_CONTRACT_PATH
const outputs:Record<string,unknown>=path?JSON.parse(readFileSync(path,'utf8')):{notRun:null}
describe.skipIf(!path)('actual PostgreSQL final-context output through unchanged strict client parser',()=>{
 test('SQL evidence contains each required role and setup state',()=>{
  expect(Object.keys(outputs).sort()).toEqual(['blockedManager','director','governanceBlocked','inactiveMember','nonmember','readyEmployee','readyManager'])
 })
 test.each(Object.entries(outputs))('%s is a valid client context',async(name,data)=>{
  mocks.rpc.mockReturnValue({abortSignal:vi.fn().mockResolvedValue({data,error:null})})
  const parsed=await fetchLeaveContext(new AbortController().signal)
  expect(Array.isArray(parsed.setup.blockers)).toBe(true)
  expect(parsed.setup.ready).toBe(name==='readyEmployee'||name==='readyManager')
  expect(parsed.setup.blockers.some(b=>b.code==='SCHEMA_NOT_READY')).toBe(false)
  if(name==='readyEmployee'||name==='readyManager'){
   expect(parsed.setup.blockers).toEqual([])
   expect(parsed.currentPeriod).not.toBeNull()
   expect(parsed.balances).toHaveLength(2)
  }
 })
})
