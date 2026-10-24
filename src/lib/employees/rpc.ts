import { supabase } from '../supabase'
import { EmployeeError, strictObject, normalizeEmployeeProposal, normalizeText, parseCommandResult, parseEmployeeAccountCandidates, parseEmployeeAudit, parseEmployeeContext, parseEmployeeDetail, parseEmployeePage, parseEmployeePreview, parseFingerprint, parseOperationResult, parseUUID, parseVersion } from './contracts'
import type { EmployeeCommand, EmployeeErrorKind, EmployeeProposal, EmployeeStatus, Page } from './contracts'
const known:Record<string,Record<string,EmployeeErrorKind>>={
 '22023':{INVALID_INPUT:'invalid',INVALID_ACTION:'invalid',REHIRE_DEFERRED:'invalid',OPERATION_REUSED:'conflict',REPORTING_SELF_REFERENCE:'invalid',REPORTING_OVERLAP:'invalid',REPORTING_CYCLE:'invalid',CORRECTION_SOURCE_REQUIRED:'invalid'},
 'P0002':{EMPLOYEE_NOT_FOUND:'invalid',ACCOUNT_NOT_FOUND:'invalid',MANAGER_NOT_FOUND:'invalid'},
 '40001':{VERSION_CONFLICT:'conflict',PREVIEW_CHANGED:'conflict'},
 '23505':{EMPLOYEE_EXISTS:'conflict',NUMBER_CLAIMED:'conflict',ACCOUNT_ALREADY_LINKED:'conflict',EMPLOYEE_ALREADY_LINKED:'conflict'},
 '55000':{WORKPLACE_TIMEZONE_UNCONFIRMED:'invalid',ACCOUNT_LINK_MISMATCH:'conflict',ACCOUNT_LINK_QUARANTINED:'conflict',OPERATION_ABANDONED:'conflict',REPORTING_HISTORY_CHANGE:'conflict',REPORTING_GRAPH_UNAVAILABLE:'invalid'},
}
/** Never attach the original error, details, hint, response, or cause. */
export function normalizeEmployeeError(error:unknown):EmployeeError {
 if(error instanceof EmployeeError)return error
 const row=error&&typeof error==='object'?error as Record<string,unknown>:{}
 if(row.code==='42501')return new EmployeeError('denied','DIRECTOR_REQUIRED')
 if(row.code==='P0002'&&row.message==='Employee not found')return new EmployeeError('invalid','EMPLOYEE_NOT_FOUND')
 if(row.code==='22023'&&['Invalid employee page input','Invalid employee status','Employee id required'].includes(row.message as string))return new EmployeeError('invalid','INVALID_INPUT')
 if(typeof row.code==='string'&&typeof row.message==='string'&&Object.hasOwn(known,row.code)&&Object.hasOwn(known[row.code],row.message))return new EmployeeError(known[row.code][row.message],row.message)
 return new EmployeeError('transport')
}
async function call<T>(name:string,args:Record<string,unknown>|undefined,parse:(value:unknown)=>T,signal?:AbortSignal,uncertain=false):Promise<T> {
 try {
  if(signal?.aborted)throw new EmployeeError('transport','CANCELLED')
  const request=args===undefined?supabase.rpc(name):supabase.rpc(name,args)
  const {data,error}=await (signal?request.abortSignal(signal):request)
  if(signal?.aborted)throw new EmployeeError('transport','CANCELLED')
  if(error)throw normalizeEmployeeError(error)
  try{return parse(data)}catch{throw new EmployeeError(uncertain?'transport':'invalid','INVALID_RESPONSE')}
 }catch(error){throw normalizeEmployeeError(error)}
}
function pageArgs(query:string,page:number,pageSize:number) {
 if(typeof query!=='string')throw new EmployeeError('invalid','INVALID_INPUT')
 parseVersion(page);parseVersion(pageSize)
 if(page<1||page>2147483647||pageSize<1||pageSize>100)throw new EmployeeError('invalid','INVALID_INPUT')
 return {p_query:normalizeText(query,120)??'',p_page:page,p_page_size:pageSize}
}
function checkedPage<T>(value:Page<T>,page:number,pageSize:number) {if(value.page!==page||value.pageSize!==pageSize)throw new EmployeeError('invalid','INVALID_RESPONSE');return value}
export function fetchEmployeeContext(signal:AbortSignal) {return call('employee_context_v1',undefined,parseEmployeeContext,signal)}
export async function fetchEmployeePage(query:string,status:EmployeeStatus|null,page:number,pageSize:number,signal:AbortSignal) {
 if(status!==null&&!['draft','active','ended'].includes(status))throw new EmployeeError('invalid','INVALID_INPUT')
 return call('employee_page_v1',{...pageArgs(query,page,pageSize),p_status:status},v=>checkedPage(parseEmployeePage(v),page,pageSize),signal)
}
export async function fetchEmployeeDetail(id:string,signal:AbortSignal) {
 const target=parseUUID(id)
 return call('employee_detail_v1',{p_employee_id:target},v=>{const result=parseEmployeeDetail(v);if(result.id!==target)throw new EmployeeError('invalid');return result},signal)
}
export async function fetchEmployeeAudit(id:string,page:number,pageSize:number,signal:AbortSignal) {
 const target=parseUUID(id),{p_page,p_page_size}=pageArgs('',page,pageSize)
 return call('employee_audit_v1',{p_employee_id:target,p_page,p_page_size},v=>{const result=checkedPage(parseEmployeeAudit(v),page,pageSize);if(result.rows.some(row=>row.employeeId!==target))throw new EmployeeError('invalid');return result},signal)
}
export async function fetchEmployeeAccountCandidates(query:string,page:number,pageSize:number,signal:AbortSignal) {
 return call('employee_account_candidates_v1',pageArgs(query,page,pageSize),v=>checkedPage(parseEmployeeAccountCandidates(v),page,pageSize),signal)
}
function proposalArgs(proposal:EmployeeProposal) {return {p_employee_id:proposal.employeeId,p_expected_version:proposal.expectedVersion,p_action:proposal.action,p_payload:proposal.payload,p_reason:proposal.reason,p_effective_date:proposal.effectiveDate,p_source_reference:proposal.sourceReference}}
export async function previewEmployeeCommand(proposal:EmployeeProposal,signal:AbortSignal) {
 const normalized=normalizeEmployeeProposal(proposal)
 return call('employee_preview_v1',proposalArgs(normalized),v=>{
  const result=parseEmployeePreview(v)
  if(result.employeeId!==normalized.employeeId||result.expectedVersion!==normalized.expectedVersion||result.action!==normalized.action||JSON.stringify(result.normalizedPayload)!==JSON.stringify(normalized.payload))throw new EmployeeError('invalid')
  return result
 },signal)
}
export async function executeEmployeeCommand(command:EmployeeCommand) {
 strictObject(command,['employeeId','expectedVersion','action','payload','reason','effectiveDate','sourceReference','operationId','previewFingerprint'])
 const {operationId,previewFingerprint,...proposal}=command,operation=parseUUID(operationId),normalized=normalizeEmployeeProposal(proposal)
 return call('employee_command_v1',{...proposalArgs(normalized),p_operation_id:operation,p_preview_fingerprint:parseFingerprint(previewFingerprint)},v=>{
  const result=parseCommandResult(v)
  if(result.operationId!==operation||result.employeeId!==normalized.employeeId||result.version<1)throw new EmployeeError('invalid')
  return result
 },undefined,true)
}
export async function resolveEmployeeOperation(operationId:string,resolution:'read'|'abandon') {
 const operation=parseUUID(operationId)
 if(!['read','abandon'].includes(resolution))throw new EmployeeError('invalid')
 return call('employee_operation_v1',{p_operation_id:operation,p_resolution:resolution},v=>{
  const result=parseOperationResult(v)
  if(result.state==='completed'&&result.result.operationId!==operation)throw new EmployeeError('invalid')
  return result
 },undefined,true)
}
