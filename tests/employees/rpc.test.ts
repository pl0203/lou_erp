import {beforeEach,expect,it,vi} from 'vitest'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc}}))
import { fetchEmployeeContext,fetchEmployeePage,fetchEmployeeDetail,fetchEmployeeAudit,fetchEmployeeAccountCandidates,previewEmployeeCommand,executeEmployeeCommand,resolveEmployeeOperation,normalizeEmployeeError } from '../../src/lib/employees/rpc'
import {context,detail,employeeId,actorId,otherId,operationId,proposal,preview,receipt,fields,deferred} from './fixtures'
let response:any
beforeEach(()=>{response={data:context,error:null};rpc.mockReset().mockImplementation(()=>({abortSignal:()=>Promise.resolve(response),then:(yes:any,no:any)=>Promise.resolve(response).then(yes,no)}))})
it('calls every exact read endpoint and validates correlated identifiers and pages',async()=>{
 const signal=new AbortController().signal
 expect(await fetchEmployeeContext(signal)).toEqual(context)
 expect(rpc).toHaveBeenLastCalledWith('employee_context_v1')
 response.data={rows:[{id:employeeId,version:1,...fields}],total:1,page:2,pageSize:25}
 expect((await fetchEmployeePage(' %_ ',null,2,25,signal)).rows[0].name).toBe(fields.name)
 expect(rpc).toHaveBeenLastCalledWith('employee_page_v1',{p_query:'%_',p_status:null,p_page:2,p_page_size:25})
 await expect(fetchEmployeePage('',null,1,25,signal)).rejects.toMatchObject({kind:'invalid'})
 response.data=detail;expect(await fetchEmployeeDetail(employeeId,signal)).toEqual(detail)
 expect(rpc).toHaveBeenLastCalledWith('employee_detail_v1',{p_employee_id:employeeId})
 await expect(fetchEmployeeDetail(otherId,signal)).rejects.toMatchObject({kind:'invalid'})
 response.data={rows:[],total:0,page:1,pageSize:25}
 await fetchEmployeeAudit(employeeId,1,25,signal);expect(rpc).toHaveBeenLastCalledWith('employee_audit_v1',{p_employee_id:employeeId,p_page:1,p_page_size:25})
 await fetchEmployeeAccountCandidates('',1,25,signal);expect(rpc).toHaveBeenLastCalledWith('employee_account_candidates_v1',{p_query:'',p_page:1,p_page_size:25})
})
it('normalizes exact proposal arguments and checks mutation and recovery receipts',async()=>{
 response.data=preview;expect(await previewEmployeeCommand({...proposal,reason:' Synthetic reason '},new AbortController().signal)).toEqual(preview)
 const args={p_employee_id:employeeId,p_expected_version:0,p_action:'create_employee',p_payload:fields,p_reason:proposal.reason,p_effective_date:null,p_source_reference:null}
 expect(rpc).toHaveBeenLastCalledWith('employee_preview_v1',args)
 response.data=receipt;expect(await executeEmployeeCommand({...proposal,operationId,previewFingerprint:preview.previewFingerprint})).toEqual(receipt)
 expect(rpc).toHaveBeenLastCalledWith('employee_command_v1',{...args,p_operation_id:operationId,p_preview_fingerprint:preview.previewFingerprint})
 response.data={...receipt,operationId:otherId};await expect(executeEmployeeCommand({...proposal,operationId,previewFingerprint:preview.previewFingerprint})).rejects.toMatchObject({kind:'transport'})
 response.data={state:'completed',result:receipt};await resolveEmployeeOperation(operationId,'abandon');expect(rpc).toHaveBeenLastCalledWith('employee_operation_v1',{p_operation_id:operationId,p_resolution:'abandon'})
 response.data={state:'completed',result:{...receipt,operationId:otherId}};await expect(resolveEmployeeOperation(operationId,'read')).rejects.toMatchObject({kind:'transport'})
})
it('uses safe categories and an exact code+reason allowlist, never raw messages',async()=>{
 const examples=[['42501','private database detail','denied'],['40001','VERSION_CONFLICT','conflict'],['22023','INVALID_INPUT','invalid'],['23505','NUMBER_CLAIMED','conflict'],['55000','REPORTING_HISTORY_CHANGE','conflict'],['P0002','MANAGER_NOT_FOUND','invalid'],['22023','REPORTING_CYCLE','invalid'],['40001','secret deadlock','transport'],['23505','secret constraint','transport'],['55000','secret','transport'],['22023','secret','transport']]
 for(const [code,message,kind] of examples){const error=normalizeEmployeeError({code,message,details:'secret',hint:'private'});expect(error.kind).toBe(kind);expect(JSON.stringify(error)).not.toContain('secret');expect(error.message).not.toContain('private')}
 response.error={code:'55000',message:'private server detail'};await expect(fetchEmployeeContext(new AbortController().signal)).rejects.toMatchObject({kind:'transport'})
 rpc.mockImplementation(()=>{throw new Error('secret token')});await expect(executeEmployeeCommand({...proposal,operationId,previewFingerprint:preview.previewFingerprint})).rejects.toMatchObject({kind:'transport'})
})
it('fails before dispatch for invalid inputs and discards late cancelled reads',async()=>{
 await expect(fetchEmployeePage('x'.repeat(121),null,1,25,new AbortController().signal)).rejects.toMatchObject({kind:'invalid'});expect(rpc).not.toHaveBeenCalled()
 const pending=deferred<any>(),controller=new AbortController();rpc.mockReturnValue({abortSignal:()=>pending.promise})
 const read=fetchEmployeeContext(controller.signal);controller.abort();pending.resolve({data:context,error:null});await expect(read).rejects.toMatchObject({kind:'transport'})
})
it('rejects pages outside the exact PostgreSQL int argument range before dispatch',async()=>{
 await expect(fetchEmployeePage('',null,2147483648,25,new AbortController().signal)).rejects.toMatchObject({kind:'invalid'});expect(rpc).not.toHaveBeenCalled()
})
it('canonicalizes the reviewed read SQL errors without exposing their messages',()=>{
 expect(normalizeEmployeeError({code:'P0002',message:'Employee not found'})).toMatchObject({kind:'invalid',reason:'EMPLOYEE_NOT_FOUND'})
 for(const message of ['Invalid employee page input','Invalid employee status','Employee id required'])expect(normalizeEmployeeError({code:'22023',message})).toMatchObject({kind:'invalid',reason:'INVALID_INPUT'})
})
it('rejects null required query and command shapes as safe typed errors before dispatch',async()=>{
 await expect(fetchEmployeePage(null as any,null,1,25,new AbortController().signal)).rejects.toMatchObject({kind:'invalid'});expect(rpc).not.toHaveBeenCalled()
})
it('rejects a null command shape as a safe typed error before dispatch',async()=>{
 await expect(executeEmployeeCommand(null as any)).rejects.toMatchObject({kind:'invalid'});expect(rpc).not.toHaveBeenCalled()
})
