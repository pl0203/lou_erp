import { readFileSync } from 'node:fs'
import { beforeEach,expect,test,vi } from 'vitest'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc}}))
import { fetchLeaveAdminRotaContext } from '../../src/lib/leave/adminRpc'
import { adminKeys } from '../../src/lib/leave/adminQueryKeys'
const calendarId='73000000-0000-0000-0000-000000000090',groupId='79000000-0000-0000-0000-000000000021'
const response=()=>({calendarId,scopeVersion:'current',authorityKey:'a'.repeat(64),calendar:{id:calendarId,name:'Fictional calendar',version:2,effectiveFrom:'2026-10-05',effectiveUntil:'2027-01-01',timezone:'Pacific/Kiritimati',confirmedTimezone:'Pacific/Kiritimati',holidaysConfirmed:true,sundayMinutes:0,holidays:['2026-12-25'],groups:[{id:groupId,name:'Fictional group',onAnchor:null}],impacts:{available:false,pendingCount:null,approvedCount:null}}})
const serve=(data:unknown)=>rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data,error:null})})
beforeEach(()=>rpc.mockReset())
test('one completed read binds the selected setup data and exact grant proof',async()=>{
 serve(response());const value=await fetchLeaveAdminRotaContext(calendarId,'current',new AbortController().signal)
 expect(value).toEqual(response());expect(rpc).toHaveBeenCalledTimes(1);expect(rpc).toHaveBeenCalledWith('leave_admin_rota_context_v1',{p_calendar_id:calendarId})
 expect(adminKeys.rotaContext('actor','current',calendarId)).toEqual(['leave',expect.any(String),'actor','private','current','admin','rota-context',calendarId])
})
test('fresh data revisions can retain the independently supplied same-grant proof',async()=>{
 serve(response());const before=await fetchLeaveAdminRotaContext(calendarId,'current',new AbortController().signal)
 serve({...response(),scopeVersion:'next',calendar:{...response().calendar,version:3,name:'Future name'}})
 const after=await fetchLeaveAdminRotaContext(calendarId,'next',new AbortController().signal)
 expect(after.calendar.version).toBe(3);expect(after.authorityKey).toBe(before.authorityKey);expect(after.scopeVersion).toBe('next')
})
test('rejects mismatched scope, calendar binding, invalid proof and unexpected private fields',async()=>{
 const v=response();for(const data of [{...v,scopeVersion:'stale'},{...v,calendarId:groupId},{...v,calendar:{...v.calendar,id:groupId}},{...v,authorityKey:'bad'},{...v,privateReason:'private'},{...v,calendar:{...v.calendar,reason:'private'}}]){
  serve(data);await expect(fetchLeaveAdminRotaContext(calendarId,'current',new AbortController().signal)).rejects.toThrow()
 }
})
test('rejects malformed setup and does not turn unavailable impacts into counts',async()=>{
 const v=response();for(const calendar of [{...v.calendar,version:0},{...v.calendar,effectiveUntil:'2026-01-01'},{...v.calendar,holidays:['2027-12-25']},{...v.calendar,groups:[...v.calendar.groups,...v.calendar.groups]},{...v.calendar,impacts:{available:false,pendingCount:1,approvedCount:null}},{...v.calendar,sundayMinutes:450}]){
  serve({...v,calendar});await expect(fetchLeaveAdminRotaContext(calendarId,'current',new AbortController().signal)).rejects.toThrow()
 }
})
test('denial and interruption never produce successful continuity evidence',async()=>{
 rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:null,error:{message:'denied'}})});await expect(fetchLeaveAdminRotaContext(calendarId,'current',new AbortController().signal)).rejects.toThrow()
 const controller=new AbortController();rpc.mockReturnValue({abortSignal:()=>{controller.abort();return Promise.resolve({data:response(),error:null})}});await expect(fetchLeaveAdminRotaContext(calendarId,'current',controller.signal)).rejects.toThrow()
})
test('explicit permission loss has a safe distinct message and aborted denial stays an interruption',async()=>{
 const signal=new AbortController().signal
 rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:null,error:{code:'42501',message:'Secret backend detail',details:'Private target'}})})
 await expect(fetchLeaveAdminRotaContext(calendarId,'current',signal)).rejects.toThrow('Akses cuti tidak tersedia. Muat ulang atau hubungi administrator HR.')
 rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:null,error:{code:'503',message:'Secret backend detail'}})})
 await expect(fetchLeaveAdminRotaContext(calendarId,'current',signal)).rejects.toThrow('Layanan cuti tidak dapat dihubungi. Silakan coba lagi.')
 serve({...response(),calendarId:groupId});await expect(fetchLeaveAdminRotaContext(calendarId,'current',signal)).rejects.not.toThrow('Akses cuti tidak tersedia')
 const controller=new AbortController();rpc.mockReturnValue({abortSignal:()=>{controller.abort();return Promise.resolve({data:null,error:{code:'42501'}})}})
 await expect(fetchLeaveAdminRotaContext(calendarId,'current',controller.signal)).rejects.toMatchObject({name:'AbortError'})
})
test('new read preserves the original global setup API and command restrictions',()=>{
 const sql=readFileSync('supabase/migrations/202610021007_ihr_leave_admin.sql','utf8'),body=sql.split('CREATE FUNCTION public.leave_admin_rota_context_v1(')[1]?.split('\n$$;')[0]??''
 expect(body).toContain('private.ihr_leave_global_config(actor,at_time)');expect(body).toContain('private.ihr_leave_require_actor()');expect(body).toContain("SECURITY DEFINER SET search_path = pg_catalog, pg_temp")
 expect(body).not.toMatch(/INSERT|UPDATE|DELETE|leave_admin_setup_v1/)
 expect(sql).not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION public.leave_admin_setup_v1/)
 expect(sql).toContain('REVOKE ALL ON FUNCTION public.leave_admin_rota_context_v1(uuid) FROM PUBLIC,anon,authenticated')
 expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.leave_admin_rota_context_v1(uuid) TO authenticated')
})
