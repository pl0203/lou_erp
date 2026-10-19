// Synthetic browser transport only. Never connects to a database or real auth.
// The feature's real transport, decoders, authority and command hooks stay in use.
import * as c from '../../src/lib/employees/contracts'
export const STORAGE_KEY='employee-synthetic-v1:server'
export const ACTOR='95000000-0000-0000-0000-000000000004'
export const INITIAL='97000000-0000-0000-0000-000000000001'
const MANAGER='97000000-0000-0000-0000-000000000002'
const parsers:Record<string,(x:unknown)=>unknown>={employee_context_v1:c.parseEmployeeContext,employee_page_v1:c.parseEmployeePage,employee_detail_v1:c.parseEmployeeDetail,employee_audit_v1:c.parseEmployeeAudit,employee_account_candidates_v1:c.parseEmployeeAccountCandidates,employee_preview_v1:c.parseEmployeePreview,employee_command_v1:c.parseCommandResult,employee_operation_v1:c.parseOperationResult}
const record=(id:string,name:string):c.EmployeeDetail=>({id,version:1,fields:{name,employeeNumber:null,jobTitle:'Tim sintetis',team:'Verifikasi',recordedStatus:'draft'},episode:null,account:null,reportingRevision:0,reporting:[],warnings:[]})
function initial(){return {version:1,allowed:true,timezone:null as string|null,mode:'normal',records:[record(INITIAL,'Contoh Karyawan 李 · sintetis'),record(MANAGER,'Contoh Atasan · sintetis')],candidates:[{userId:'95000000-0000-0000-0000-000000000007',displayName:'Akun Tidak Aktif · sintetis',email:'inactive@example.invalid',role:'sales_person',active:false,linkState:'unlinked'},{userId:'95000000-0000-0000-0000-000000000001',displayName:'Akun Aktif · sintetis',email:'active@example.invalid',role:'sales_person',active:true,linkState:'unlinked'}],audits:[] as c.EmployeeAuditEvent[],operations:{} as Record<string,any>,calls:[] as {name:string;args:any}[],commits:0}}
const clone=<T,>(x:T):T=>structuredClone(x)
const error=(code:string,message:string)=>({data:null,error:{code,message}})
export function createSyntheticServer(storage:Pick<Storage,'getItem'|'setItem'>){
 let state=storage.getItem(STORAGE_KEY)?JSON.parse(storage.getItem(STORAGE_KEY)!):initial()
 if(state.version!==1)throw Error('Unexpected synthetic storage version')
 const listeners=new Set<()=>void>(),held=new Set<()=>void>()
 const persist=()=>{state={...state};storage.setItem(STORAGE_KEY,JSON.stringify(state));listeners.forEach(fn=>fn())}
 const validateResponse=(name:string,data:unknown)=>{if(!parsers[name])throw Error('RPC unavailable in synthetic fixture');return parsers[name](data)}
 const scope=()=>`synthetic-scope-${state.timezone??'unset'}`
 const proposal=(a:any)=>c.normalizeEmployeeProposal({employeeId:a.p_employee_id,expectedVersion:a.p_expected_version,action:a.p_action,payload:a.p_payload,reason:a.p_reason,effectiveDate:a.p_effective_date,sourceReference:a.p_source_reference})
 async function preview(a:any){
  const p=proposal(a),r=state.records.find((x:c.EmployeeDetail)=>x.id===p.employeeId)
  if((r?.version??0)!==p.expectedVersion)throw {code:'40001',message:'VERSION_CONFLICT'}
  const section=p.action.includes('employee')?'fields':p.action==='save_initial_episode'?'episode':p.action==='save_reporting'?'reporting':'account'
  const before=r?{[section]:section==='account'?(r.account?{userId:r.account.userId}:{}):r[section]??{}}:{}
  const after={[section]:p.action==='save_reporting'?(p.payload as c.ReportingInput).intervals:p.payload}
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({p,scope:scope(),before})))
  return {employeeId:p.employeeId,expectedVersion:p.expectedVersion,action:p.action,normalizedPayload:p.payload,before,after,scopeVersion:scope(),timezone:state.timezone,previewFingerprint:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')}
 }
 async function perform(name:string,a:any){
  if(!parsers[name])throw Error('RPC unavailable in synthetic fixture')
  state.calls.push({name,args:clone(a)});state.calls=state.calls.slice(-1000);persist()
  if(state.mode==='slow')await new Promise(resolve=>setTimeout(resolve,650))
  if(name==='employee_context_v1')return {actorId:ACTOR,scopeVersion:scope(),canMaintainBasic:state.allowed,timezone:state.allowed?state.timezone:null,today:state.allowed&&state.timezone?'2026-10-19':null,setupBlockers:state.allowed&&!state.timezone?['WORKPLACE_TIMEZONE_UNCONFIRMED']:[]}
  if(!state.allowed)throw {code:'42501',message:'DIRECTOR_REQUIRED'}
  const paginate=(rows:any[])=>({rows:rows.slice((a.p_page-1)*a.p_page_size,a.p_page*a.p_page_size),total:rows.length,page:a.p_page,pageSize:a.p_page_size})
  if(name==='employee_page_v1')return paginate(state.records.map((r:c.EmployeeDetail)=>({id:r.id,version:r.version,...r.fields})).filter((r:any)=>(!a.p_status||r.recordedStatus===a.p_status)&&`${r.name} ${r.employeeNumber??''}`.toLowerCase().includes(a.p_query.toLowerCase())).sort((x:any,y:any)=>x.name.localeCompare(y.name)||x.id.localeCompare(y.id)))
  if(name==='employee_detail_v1'){const r=state.records.find((r:c.EmployeeDetail)=>r.id===a.p_employee_id);if(!r)throw {code:'P0002',message:'EMPLOYEE_NOT_FOUND'};return r}
  if(name==='employee_account_candidates_v1')return paginate(state.candidates.filter((r:any)=>`${r.displayName} ${r.email}`.toLowerCase().includes(a.p_query.toLowerCase())))
  if(name==='employee_audit_v1')return paginate(state.audits.filter((r:any)=>r.employeeId===a.p_employee_id).slice().reverse())
  if(name==='employee_preview_v1')return preview(a)
  if(name==='employee_operation_v1'){
   c.parseUUID(a.p_operation_id);if(!['read','abandon'].includes(a.p_resolution))throw {code:'22023',message:'INVALID_INPUT'}
   if(!state.operations[a.p_operation_id]&&a.p_resolution==='abandon'){state.operations[a.p_operation_id]={state:'abandoned',result:null};persist()}
   const operation=state.operations[a.p_operation_id];return operation?{state:operation.state,result:operation.result}:{state:'absent',result:null}
  }
  const p=proposal(a),id=c.parseUUID(a.p_operation_id),existing=state.operations[id],signature=JSON.stringify(p)
  if(existing?.state==='abandoned')throw {code:'55000',message:'OPERATION_ABANDONED'}
  if(existing){if(existing.signature!==signature)throw {code:'22023',message:'OPERATION_REUSED'};return existing.result}
  if(state.mode==='lost-before')throw Error('Synthetic response interrupted before commit')
  const v=await preview(a);if(v.previewFingerprint!==a.p_preview_fingerprint)throw {code:'40001',message:'PREVIEW_CHANGED'}
  let r=state.records.find((r:c.EmployeeDetail)=>r.id===p.employeeId)
  if(p.action==='create_employee'){r=record(p.employeeId,(p.payload as c.EmployeeFields).name);r.version=0;state.records.push(r)}
  if(!r)throw {code:'P0002',message:'EMPLOYEE_NOT_FOUND'}
  if(p.action.includes('employee'))r.fields=clone(p.payload)
  else if(p.action==='save_initial_episode')r.episode=clone(p.payload)
  else if(p.action==='save_reporting'){r.reporting=clone((p.payload as c.ReportingInput).intervals);r.reportingRevision++}
  else if(p.action==='link_account'){
   const account=state.candidates.find((x:any)=>x.userId===(p.payload as {userId:string}).userId)
   if(!account||account.linkState!=='unlinked'||r.account)throw {code:'23505',message:'ACCOUNT_ALREADY_LINKED'}
   const {linkState,...facts}=account;r.account={...facts,operationalManagerId:null,operationalManagerName:null,quarantined:false};account.linkState='linked'
  }else{if(!r.account||r.account.userId!==(p.payload as {userId:string}).userId)throw {code:'55000',message:'ACCOUNT_LINK_MISMATCH'};r.account.quarantined=true;state.candidates.find((x:any)=>x.userId===r.account.userId).linkState='quarantined'}
  r.version++;r.warnings=[]
  if(r.account?.quarantined)r.warnings.push('ACCOUNT_LINK_QUARANTINED')
  if(r.account&&!r.account.active&&r.fields.recordedStatus==='active')r.warnings.push('ACTIVE_EMPLOYMENT_INACTIVE_LOGIN')
  if(r.account?.active&&r.fields.recordedStatus==='ended')r.warnings.push('ENDED_EMPLOYMENT_ACTIVE_LOGIN')
  const result={operationId:id,employeeId:p.employeeId,version:r.version,auditEventId:crypto.randomUUID()}
  state.audits.push({id:result.auditEventId,employeeId:p.employeeId,actorId:ACTOR,actorName:'Director Sintetis',recordedAt:new Date().toISOString(),effectiveDate:p.effectiveDate,action:p.action,reason:p.reason,sourceReference:p.sourceReference,before:v.before,after:v.after})
  state.operations[id]={state:'completed',result,signature};state.commits++;persist()
  if(state.mode==='lost-after')throw Error('Synthetic response interrupted after commit')
  if(state.mode==='held-after')await new Promise<void>(resolve=>held.add(resolve))
  return result
 }
 return {getState:()=>state,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn)}},validateResponse,
  configure(patch:{mode?:string;allowed?:boolean;timezone?:string|null}){state={...state,...patch};persist()},
  release(){for(const resolve of held)resolve();held.clear()},
  rpc(name:string,args:any={}){
   if(!parsers[name])return Promise.reject(Error('RPC unavailable in synthetic fixture'))
   const work=perform(name,args).then(data=>({data:state.mode==='malformed'&&name!=='employee_context_v1'?{invalid:true}:clone(validateResponse(name,data)),error:null})).catch(e=>e?.code?error(e.code,e.message):Promise.reject(e))
   return Object.assign(work,{abortSignal:()=>work})
  },
 }
}
