import { beforeEach,it,expect,vi } from 'vitest'
const mocks=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../src/lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
import { fetchDirectorRequests } from '../src/lib/leave/directorRpc'
import { fetchLeaveReadAccess,fetchLeaveCalendar } from '../src/lib/leave/readRpc'
beforeEach(()=>mocks.rpc.mockReset())
it('uses dedicated director context without changing original context API',async()=>{
 const data={scopeVersion:'1',calendarAudiences:['director_all'],defaultRange:null,defaultRangeState:'unavailable'}
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data,error:null})})
 await fetchLeaveReadAccess(new AbortController().signal,'director_all')
 expect(mocks.rpc).toHaveBeenCalledWith('leave_director_calendar_context_v1',{p_audience:'director_all'})
})
it('uses dedicated bounded director calendar',async()=>{
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:[],error:null})})
 await fetchLeaveCalendar({from:'2026-10-01',to:'2026-10-31'},'director_all',new AbortController().signal)
 expect(mocks.rpc).toHaveBeenCalledWith('leave_director_calendar_v1',{p_from:'2026-10-01',p_to:'2026-10-31'})
})
it('reads overview page using only cursor and limit',async()=>{
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:{rows:[],nextBefore:null},error:null})})
 await expect(fetchDirectorRequests(20,new AbortController().signal)).resolves.toEqual({rows:[],nextBefore:null})
 expect(mocks.rpc).toHaveBeenCalledWith('leave_director_requests_v1',{p_before:20,p_limit:25})
})
it('does not fall back to broad table reads on denied or missing RPC',async()=>{
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:null,error:{code:'42501',message:'private'}})})
 await expect(fetchDirectorRequests(null,new AbortController().signal)).rejects.toThrow('Akses cuti')
 expect(mocks.rpc).toHaveBeenCalledTimes(1)
})
it('validates cursor and aborted requests before transport',async()=>{
 await expect(fetchDirectorRequests(-1,new AbortController().signal)).rejects.toThrow()
 const controller=new AbortController();controller.abort();await expect(fetchDirectorRequests(null,controller.signal)).rejects.toThrow();expect(mocks.rpc).not.toHaveBeenCalled()
})

it('retains all-director audience while switching to assigned team and back',async()=>{
 const data={scopeVersion:'1',calendarAudiences:['director_all','assigned_team'],defaultRange:null,defaultRangeState:'unavailable'}
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data,error:null})})
 for(const audience of ['director_all','assigned_team','director_all'] as const){
  const result=await fetchLeaveReadAccess(new AbortController().signal,audience,true)
  expect(result.calendarAudiences).toContain('director_all')
  expect(mocks.rpc).toHaveBeenLastCalledWith('leave_director_calendar_context_v1',{p_audience:audience})
 }
})
