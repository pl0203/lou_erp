export const actorId = '10000000-0000-0000-0000-000000000001'
export const employeeId = '20000000-0000-0000-0000-000000000001'
export const otherId = '30000000-0000-0000-0000-000000000001'
export const operationId = '40000000-0000-0000-0000-000000000001'
export const fields = {name:'Synthetic employee',employeeNumber:null,jobTitle:null,team:null,recordedStatus:'draft' as const}
export const context = {actorId,scopeVersion:'scope-one',canMaintainBasic:true,timezone:null,today:null,setupBlockers:['WORKPLACE_TIMEZONE_UNCONFIRMED']}
export const detail = {id:employeeId,version:1,fields,episode:null,account:null,reportingRevision:0,reporting:[],warnings:[]}
export const proposal = {employeeId,expectedVersion:0,action:'create_employee' as const,payload:fields,reason:'Synthetic reason',effectiveDate:null,sourceReference:null}
export const preview = {employeeId,expectedVersion:0,action:'create_employee' as const,normalizedPayload:fields,before:{},after:{fields},scopeVersion:context.scopeVersion,timezone:null,previewFingerprint:'a'.repeat(64)}
export const receipt = {employeeId,operationId,version:1,auditEventId:otherId}
export function deferred<T>() { let resolve!: (value:T)=>void; let reject!: (error:unknown)=>void; const promise = new Promise<T>((yes,no)=>{resolve=yes;reject=no}); return {promise,resolve,reject} }
