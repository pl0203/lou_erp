import { readFileSync } from 'node:fs'
import { beforeEach,expect,test,vi } from 'vitest'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc}}))
import { fetchLeaveAdminWriteContext } from '../../src/lib/leave/adminRpc'
import { adminKeys } from '../../src/lib/leave/adminQueryKeys'
const employee='71000000-0000-0000-0000-000000000001',account='83000000-0000-0000-0000-000000000001'
const period={year:2026,startDate:'2026-01-01',endDate:'2027-01-01'}
const response=()=>({employeeId:employee,scopeVersion:'current',authorityKey:'a'.repeat(64),capabilities:{configure:false,adjust:true},balance:{state:'verified',currentPeriod:period,account:{accountId:account,year:2026,version:4,reconciled:true}},memberOptions:null})
const serve=(data:unknown)=>rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data,error:null})})
beforeEach(()=>rpc.mockReset())
test('write context authorizes independent target writes without old private/global read overrides',()=>{
 const sql=readFileSync('supabase/migrations/202610021007_ihr_leave_admin.sql','utf8'),body=sql.split('CREATE FUNCTION public.leave_admin_write_context_v1(')[1]?.split('\n$$;')[0]??''
 for(const token of ["'configure',p_employee_id","'adjust',p_employee_id",'actor=p_employee_id',"member_kind='director'",'m.active_calendar_id',"'scopeVersion'","'authorityKey'"])expect(body).toContain(token)
 expect(body).not.toMatch(/ihr_leave_balance_json|read_private|ihr_leave_prepare_account|ihr_leave_global_config|INSERT|UPDATE|DELETE/)
 expect(sql).not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION public.leave_(?:balance_accounts|balance_history|admin_setup)_v1/)
})
test('adjust-only consumes minimal verified account metadata, and keys bind backend/scope/target',async()=>{
 serve(response());const value=await fetchLeaveAdminWriteContext(employee,'current',new AbortController().signal)
 expect(value.balance.account).toEqual({accountId:account,year:2026,version:4,reconciled:true});expect(value.memberOptions).toBeNull();expect(rpc).toHaveBeenCalledWith('leave_admin_write_context_v1',{p_employee_id:employee})
 expect(adminKeys.writeContext('actor','scope',employee)).toEqual(['leave',expect.any(String),'actor','private','scope','admin','write-context',employee])
})
test('configure receives only selected lineage options and distinct unreconciled state',async()=>{
 const data={...response(),capabilities:{configure:true,adjust:false},balance:{state:'unreconciled',currentPeriod:period,account:{accountId:account,year:2026,version:1,reconciled:false}},memberOptions:{state:'available',calendars:[{id:account,name:'Fictional current lineage'}],groups:[{id:employee,name:'Fictional group'}]}}
 serve(data);const value=await fetchLeaveAdminWriteContext(employee,'current',new AbortController().signal);expect(value.balance.state).toBe('unreconciled');expect(value.memberOptions?.calendars).toEqual(data.memberOptions.calendars)
})
test.each(['missing','unavailable'])('preserves an explicit %s account state',async state=>{
 serve({...response(),balance:{state,currentPeriod:state==='missing'?period:null,account:null}});expect((await fetchLeaveAdminWriteContext(employee,'current',new AbortController().signal)).balance.state).toBe(state)
})
test('rejects private additions, stale/wrong target, false verification and crossed permission sections',async()=>{
 const source=response();const variants=[{...source,scopeVersion:'stale'},{...source,employeeId:account},{...source,reason:'Private'}, {...source,balance:{...source.balance,account:{...source.balance.account,availableMinutes:5400}}}, {...source,balance:{...source.balance,account:{...source.balance.account,reconciled:false}}}, {...source,balance:{...source.balance,currentPeriod:{...period,year:2027}}}, {...source,memberOptions:{state:'available',calendars:[{id:account,name:'Unauthorised'}],groups:[]}}, {...source,capabilities:{configure:false,adjust:false}}]
 for(const data of variants){serve(data);await expect(fetchLeaveAdminWriteContext(employee,'current',new AbortController().signal)).rejects.toThrow()}
})
test('empty options never imply global calendar permission and interrupted replies are discarded',async()=>{
 serve({...response(),capabilities:{configure:true,adjust:false},memberOptions:{state:'lineage_unassigned',calendars:[],groups:[]}});expect((await fetchLeaveAdminWriteContext(employee,'current',new AbortController().signal)).memberOptions?.state).toBe('lineage_unassigned')
 const controller=new AbortController();rpc.mockReturnValue({abortSignal:()=>{controller.abort();return Promise.resolve({data:response(),error:null})}});await expect(fetchLeaveAdminWriteContext(employee,'current',controller.signal)).rejects.toThrow()
})
