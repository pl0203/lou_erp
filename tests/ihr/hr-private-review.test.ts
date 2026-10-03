import { readFileSync } from 'node:fs'
import { expect,test,vi } from 'vitest'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc}}))
import { fetchHrRequests,fetchHrRequest,fetchHrRequestHistory } from '../../src/lib/leave/adminRpc'
const employee='71000000-0000-0000-0000-000000000001',request='84000000-0000-0000-0000-000000000001',event='84000000-0000-0000-0000-000000000002'
const envelope={employeeId:employee,scopeVersion:'current',authorityKey:'a'.repeat(64)}
const summary={id:request,sequence:1,startDate:'2026-10-05',endDate:'2026-10-05',duration:{mode:'full_scheduled_day'},totalMinutes:450,status:'approved',version:2,submittedAt:'2026-10-03T00:00:00+00:00',sourceKind:'submission'}
const detail={...summary,reason:'Private annual reason',approverName:'Frozen original manager',days:[{date:'2026-10-05',scheduledMinutes:450,chargedMinutes:450,exclusion:null,groupName:null}],allocations:[{year:2026,startDate:'2026-01-01',endDate:'2027-01-01',chargedMinutes:450}]}
const serve=(data:unknown)=>rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data,error:null})})
test('HR review has an exclusive read_private predicate and all lists are bounded50',()=>{
 const sql=readFileSync('supabase/migrations/202610021007_ihr_leave_admin.sql','utf8'),auth=sql.split('CREATE FUNCTION private.ihr_leave_require_hr_reader(')[1]?.split('\n$$;')[0]??''
 expect(auth).toContain("'read_private',p_employee_id");expect(auth).not.toMatch(/is_approver|configure|manage_access|p_actor=p_employee/)
 for(const name of ['leave_hr_requests_v1','leave_hr_request_v1','leave_hr_request_history_v1']){const body=sql.split(`CREATE FUNCTION public.${name}(`)[1]?.split('\n$$;')[0]??'';expect(body).toContain('private.ihr_leave_require_hr_reader');expect(body).not.toMatch(/SELECT \* FROM public.users|INSERT|UPDATE|DELETE/)}
 expect(sql).toContain('p_limit NOT BETWEEN 1 AND 50');expect(sql).toContain('ON private.ihr_leave_request_events(request_id,at_time DESC,id DESC)')
})
test('list exposes no private reason and binds exact target/scope',async()=>{
 serve({...envelope,rows:[summary],nextBefore:null});expect((await fetchHrRequests(employee,'current',null,25,new AbortController().signal)).rows[0].id).toBe(request)
 for(const data of [{...envelope,rows:[{...summary,reason:'private'}],nextBefore:null},{...envelope,scopeVersion:'stale',rows:[],nextBefore:null}]){serve(data);await expect(fetchHrRequests(employee,'current',null,25,new AbortController().signal)).rejects.toThrow()}
 await expect(fetchHrRequests(employee,'current',null,51,new AbortController().signal)).rejects.toThrow()
})
test('detail retains frozen charges/original routing and rejects raw sources or wrong IDs',async()=>{
 serve({...envelope,request:detail});expect((await fetchHrRequest(employee,'current',request,new AbortController().signal)).request.approverName).toBe('Frozen original manager')
 for(const data of [{...detail,source_snapshot:{}},{...detail,id:event},{...detail,days:[{...detail.days[0],chargedMinutes:451}]}]){serve({...envelope,request:data});await expect(fetchHrRequest(employee,'current',request,new AbortController().signal)).rejects.toThrow()}
})
test('history validates exact paginated event projection and carries microsecond cursor unchanged',async()=>{
 const row={id:event,event:'reassigned',atTime:'2026-10-03T00:00:00.000123+00:00',actor:{id:employee,name:'Current name'},reason:'Audited route reason',approverName:'Frozen replacement'}
 serve({...envelope,requestId:request,rows:[row],nextBefore:{atTime:row.atTime,id:event}});const result=await fetchHrRequestHistory(employee,'current',request,null,25,new AbortController().signal);expect(result.rows[0]).toEqual(row);expect(result.nextBefore?.atTime).toBe(row.atTime)
 for(const data of [{...row,data:{reason:'raw'}},{...row,event:'uncontrolled_event'}]){serve({...envelope,requestId:request,rows:[data],nextBefore:null});await expect(fetchHrRequestHistory(employee,'current',request,null,25,new AbortController().signal)).rejects.toThrow()}
})
test('aborted HR detail never becomes a completed private read',async()=>{
 const controller=new AbortController();rpc.mockReturnValue({abortSignal:()=>{controller.abort();return Promise.resolve({data:{...envelope,request:detail},error:null})}});await expect(fetchHrRequest(employee,'current',request,controller.signal)).rejects.toThrow()
})
test('history orders microseconds without truncating to milliseconds',async()=>{
 const actor={id:employee,name:'Reviewer'},latest={id:request,event:'approved',atTime:'2026-10-03T00:00:00.000124+00:00',actor,reason:null,approverName:'Manager'},older={...latest,id:event,atTime:'2026-10-03T00:00:00.000123+00:00'}
 serve({...envelope,requestId:request,rows:[latest,older],nextBefore:null});expect((await fetchHrRequestHistory(employee,'current',request,null,25,new AbortController().signal)).rows).toHaveLength(2)
 serve({...envelope,requestId:request,rows:[older,latest],nextBefore:null});await expect(fetchHrRequestHistory(employee,'current',request,null,25,new AbortController().signal)).rejects.toThrow()
})
