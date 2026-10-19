import { readFileSync } from 'node:fs'
import { describe,expect,test,vi } from 'vitest'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc}}))
import { fetchLeaveContext } from '../../src/lib/leave/rpc'
import { fetchLeaveAdminRotaContext } from '../../src/lib/leave/adminRpc'
import { fetchLeaveRosterContinuations } from '../../src/lib/leave/setupRpc'
const path=process.env.IHR_DIRECTOR_CALENDAR_CONTRACT_PATH
const output=path?JSON.parse(readFileSync(path,'utf8')):null
function serve(value:unknown){rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:value,error:null})})}
describe.skipIf(!path)('real rollback-only PostgreSQL Director calendar contract',()=>{
 test('actual context grants only the separate calendar capability',async()=>{
  serve(output.context);const parsed=await fetchLeaveContext(new AbortController().signal)
  expect(parsed.memberKind).toBe('director');expect(parsed.capabilities.calendarConfigure).toBe(true)
  expect([parsed.capabilities.request,parsed.capabilities.configure,parsed.capabilities.adjust,parsed.capabilities.readPrivate,parsed.capabilities.manageAccess]).toEqual([false,false,false,false,false]);expect(parsed.balances).toEqual([])
 })
 test('actual rota response passes selected scope and authority proof decoding',async()=>{
  serve(output.rota);expect(await fetchLeaveAdminRotaContext(output.rota.calendarId,output.context.scopeVersion,new AbortController().signal)).toEqual(output.rota)
 })
 test('actual minimized same-group rows pass strict fixed-interval decoding',async()=>{
  const v=output.continuations;serve(v);const parsed=await fetchLeaveRosterContinuations(v.calendarId,output.context.scopeVersion,v.page,v.pageSize,new AbortController().signal)
  expect(parsed).toEqual(v);expect(parsed.rows.length).toBeGreaterThan(0)
  for(const row of parsed.rows)expect(row.continuationFingerprint).toMatch(/^[a-f0-9]{64}$/)
 })
})
