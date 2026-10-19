/** Strict public JSON boundary. No raw service payload or error is safe UI text. */
export type UUID = string
export type DateOnly = string
export type EmployeeStatus = 'draft' | 'active' | 'ended'
export type EmployeeFields = { name:string; employeeNumber:string|null; jobTitle:string|null; team:string|null; recordedStatus:EmployeeStatus }
export type EpisodeInput = {startDate:DateOnly|null; endDate:DateOnly|null; sourceReference:string|null}
export type ReportingInterval = {managerEmployeeId:UUID|null; from:DateOnly; until:DateOnly|null}
export type ReportingInput = {mode:'schedule'|'correction'; intervals:ReportingInterval[]}
export const employeeWarnings=['ENDED_EMPLOYMENT_ACTIVE_LOGIN','ACTIVE_EMPLOYMENT_INACTIVE_LOGIN','ACCOUNT_LINK_QUARANTINED','REPORTING_COMPARISON_UNAVAILABLE','REPORTING_ACCESS_MANAGER_UNCOMPARABLE','REPORTING_ACCESS_MANAGER_MISMATCH'] as const
export const employeeRoles=['po_admin','co_admin','sales_person','sales_manager','sales_head','executive'] as const
export type EmployeeRole=typeof employeeRoles[number]
export type EmployeeWarning=typeof employeeWarnings[number]
export type EmployeeContext = {actorId:UUID; scopeVersion:string; canMaintainBasic:boolean; timezone:string|null; today:DateOnly|null; setupBlockers:'WORKPLACE_TIMEZONE_UNCONFIRMED'[]}
export type EmployeeAccount = {userId:UUID; displayName:string; email:string; role:EmployeeRole; active:boolean; operationalManagerId:UUID|null; operationalManagerName:string|null; quarantined:boolean}
export type EmployeeDetail = {id:UUID; version:number; fields:EmployeeFields; episode:EpisodeInput|null; account:EmployeeAccount|null; reportingRevision:number; reporting:ReportingInterval[]; warnings:EmployeeWarning[]}
export type EmployeeRow = EmployeeFields & {id:UUID;version:number}
export type Page<T> = {rows:T[];total:number;page:number;pageSize:number}
export type AccountCandidate = Pick<EmployeeAccount,'userId'|'displayName'|'email'|'role'|'active'> & {linkState:'unlinked'|'linked'|'quarantined'}
export type EmployeeAction = 'create_employee'|'edit_employee'|'save_initial_episode'|'link_account'|'quarantine_account_link'|'save_reporting'
export type EmployeeSnapshot = {fields?:Partial<EmployeeFields>;episode?:Partial<EpisodeInput>;account?:{userId?:UUID|null};reporting?:Partial<ReportingInterval>[]}
export type EmployeeAuditEvent = {id:UUID;employeeId:UUID;actorId:UUID;actorName:string;recordedAt:string;effectiveDate:DateOnly|null;action:EmployeeAction;reason:string;sourceReference:string|null;before:EmployeeSnapshot;after:EmployeeSnapshot}
type ActionPayload = {action:'create_employee'|'edit_employee';payload:EmployeeFields}|{action:'save_initial_episode';payload:EpisodeInput}|{action:'link_account'|'quarantine_account_link';payload:{userId:UUID}}|{action:'save_reporting';payload:ReportingInput}
export type EmployeeProposal = {employeeId:UUID;expectedVersion:number;reason:string;effectiveDate:DateOnly|null;sourceReference:string|null} & ActionPayload
export type EmployeePreview = {employeeId:UUID;expectedVersion:number;action:EmployeeAction;normalizedPayload:EmployeeFields|EpisodeInput|{userId:UUID}|ReportingInput;before:EmployeeSnapshot;after:EmployeeSnapshot;scopeVersion:string;timezone:string|null;previewFingerprint:string}
export type EmployeeCommand = EmployeeProposal & {operationId:UUID;previewFingerprint:string}
export type CommandResult = {operationId:UUID;employeeId:UUID;version:number;auditEventId:UUID}
export type OperationResult = {state:'absent'|'abandoned';result:null}|{state:'completed';result:CommandResult}
export type EmployeeErrorKind = 'denied'|'conflict'|'invalid'|'transport'
const safeMessages = {denied:'Akses karyawan tidak tersedia. Muat ulang atau hubungi administrator.',conflict:'Data berubah. Muat ulang dan tinjau perubahan sebelum melanjutkan.',invalid:'Data karyawan tidak valid. Periksa isian dan coba lagi.',transport:'Layanan karyawan belum dapat dikonfirmasi. Periksa hasil sebelum mengirim ulang.'}
export class EmployeeError extends Error {
 readonly kind:EmployeeErrorKind
 readonly reason:string
 constructor(kind:EmployeeErrorKind, reason = 'UNAVAILABLE') { super(safeMessages[kind]); this.name='EmployeeError';this.kind=kind;this.reason=reason }
}
function invalid():never {throw new EmployeeError('invalid','INVALID_INPUT')}
export function strictObject(value:unknown, keys:readonly string[], partial=false):Record<string,unknown> {
 if (!value || typeof value!=='object' || Array.isArray(value)) return invalid()
 const row=value as Record<string,unknown>
 if(Object.keys(row).some(key=>!keys.includes(key)) || (!partial && keys.some(key=>!Object.hasOwn(row,key)))) return invalid()
 return row
}
export function parseUUID(value:unknown):UUID {if(typeof value!=='string'||!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)) return invalid(); return value.toLowerCase()}
export function parseVersion(value:unknown):number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0) return invalid(); return value}
function text(value:unknown, max?:number):string {if(typeof value!=='string'||(max!==undefined && Array.from(value).length>max)) return invalid();return value}
function nonempty(value:unknown,max?:number) {const result=text(value,max);if(!result.trim())return invalid();return result}
function bool(value:unknown):boolean {if(typeof value!=='boolean')return invalid();return value}
function nullable<T>(value:unknown,parse:(x:unknown)=>T):T|null {return value===null?null:parse(value)}
function list<T>(value:unknown,parse:(x:unknown)=>T):T[] {if(!Array.isArray(value))return invalid();return value.map(item=>parse(item))}
function choice<T extends string>(value:unknown,choices:readonly T[]):T {if(typeof value!=='string'||!choices.includes(value as T))return invalid();return value as T}
export function parseDateOnly(value:unknown):DateOnly {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return invalid()
 const [year,month,day]=value.split('-').map(Number), leap=year%4===0&&(year%100!==0||year%400===0)
 if(year<1||month<1||month>12||day<1||day>[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][month-1])return invalid()
 return value
}
function timestamp(value:unknown):string {
 const result=text(value),match=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3}|\d{6})Z$/.exec(result)
 if(!match || +match[2]>23 || +match[3]>59 || +match[4]>59)return invalid()
 parseDateOnly(match[1]);return result
}
export function normalizeText(value:unknown,max:number,required=false):string|null {
 if(value===null&&!required)return null
 const result=text(value).trim();if(Array.from(result).length>max||(!result&&required))return invalid();return result||null
}
const fieldKeys=['name','employeeNumber','jobTitle','team','recordedStatus'] as const
const episodeKeys=['startDate','endDate','sourceReference'] as const
const intervalKeys=['managerEmployeeId','from','until'] as const
function fields(value:unknown,normalize=false):EmployeeFields {
 const row=strictObject(value,fieldKeys)
 return {name:normalize?normalizeText(row.name,160,true)!:nonempty(row.name,160),employeeNumber:normalize?normalizeText(row.employeeNumber,64):nullable(row.employeeNumber,v=>nonempty(v,64)),jobTitle:normalize?normalizeText(row.jobTitle,120):nullable(row.jobTitle,v=>nonempty(v,120)),team:normalize?normalizeText(row.team,120):nullable(row.team,v=>nonempty(v,120)),recordedStatus:choice(row.recordedStatus,['draft','active','ended'])}
}
function episode(value:unknown,normalize=false):EpisodeInput {
 const row=strictObject(value,episodeKeys),result={startDate:nullable(row.startDate,parseDateOnly),endDate:nullable(row.endDate,parseDateOnly),sourceReference:normalize?normalizeText(row.sourceReference,500):nullable(row.sourceReference,v=>nonempty(v,500))}
 if(result.startDate&&result.endDate&&result.endDate<result.startDate)return invalid();return result
}
function interval(value:unknown):ReportingInterval {
 const row=strictObject(value,intervalKeys), result={managerEmployeeId:nullable(row.managerEmployeeId,parseUUID),from:parseDateOnly(row.from),until:nullable(row.until,parseDateOnly)}
 if(result.until&&result.until<=result.from)return invalid();return result
}
const actions:EmployeeAction[]=['create_employee','edit_employee','save_initial_episode','link_account','quarantine_account_link','save_reporting']
function payload(action:EmployeeAction,value:unknown,normalize=false):EmployeePreview['normalizedPayload'] {
 if(action==='create_employee'||action==='edit_employee')return fields(value,normalize)
 if(action==='save_initial_episode')return episode(value,normalize)
 if(action==='save_reporting') {const row=strictObject(value,['mode','intervals']);return {mode:choice(row.mode,['schedule','correction']),intervals:list(row.intervals,interval).sort((a,b)=>a.from.localeCompare(b.from))}}
 return {userId:parseUUID(strictObject(value,['userId']).userId)}
}
/** Both previews and audits share the exact same recursive allowlist. */
export function parseEmployeeSnapshot(value:unknown):EmployeeSnapshot {
 const row=strictObject(value,['fields','episode','account','reporting'],true),result:EmployeeSnapshot={}
 if(Object.hasOwn(row,'fields')) {
  const part=strictObject(row.fields,fieldKeys,true),out:Partial<EmployeeFields>={}
  if(Object.hasOwn(part,'name'))out.name=nonempty(part.name,160)
  if(Object.hasOwn(part,'employeeNumber'))out.employeeNumber=nullable(part.employeeNumber,v=>nonempty(v,64))
  if(Object.hasOwn(part,'jobTitle'))out.jobTitle=nullable(part.jobTitle,v=>nonempty(v,120))
  if(Object.hasOwn(part,'team'))out.team=nullable(part.team,v=>nonempty(v,120))
  if(Object.hasOwn(part,'recordedStatus'))out.recordedStatus=choice(part.recordedStatus,['draft','active','ended'])
  result.fields=out
 }
 if(Object.hasOwn(row,'episode')) {
  const part=strictObject(row.episode,episodeKeys,true),out:Partial<EpisodeInput>={}
  if(Object.hasOwn(part,'startDate'))out.startDate=nullable(part.startDate,parseDateOnly)
  if(Object.hasOwn(part,'endDate'))out.endDate=nullable(part.endDate,parseDateOnly)
  if(Object.hasOwn(part,'sourceReference'))out.sourceReference=nullable(part.sourceReference,v=>nonempty(v,500))
  if(out.startDate&&out.endDate&&out.endDate<out.startDate)return invalid();result.episode=out
 }
 if(Object.hasOwn(row,'account')) {const part=strictObject(row.account,['userId'],true);result.account=Object.hasOwn(part,'userId')?{userId:nullable(part.userId,parseUUID)}:{}}
 if(Object.hasOwn(row,'reporting'))result.reporting=list(row.reporting,value=>{
  const part=strictObject(value,intervalKeys,true),out:Partial<ReportingInterval>={}
  if(Object.hasOwn(part,'managerEmployeeId'))out.managerEmployeeId=nullable(part.managerEmployeeId,parseUUID)
  if(Object.hasOwn(part,'from'))out.from=parseDateOnly(part.from)
  if(Object.hasOwn(part,'until'))out.until=nullable(part.until,parseDateOnly)
  if(out.from&&out.until&&out.until<=out.from)return invalid();return out
 })
 return result
}
export function parseEmployeeContext(value:unknown):EmployeeContext {
 const row=strictObject(value,['actorId','scopeVersion','canMaintainBasic','timezone','today','setupBlockers'])
 const result={actorId:parseUUID(row.actorId),scopeVersion:nonempty(row.scopeVersion),canMaintainBasic:bool(row.canMaintainBasic),timezone:nullable(row.timezone,nonempty),today:nullable(row.today,parseDateOnly),setupBlockers:list(row.setupBlockers,value=>choice(value,['WORKPLACE_TIMEZONE_UNCONFIRMED'] as const))}
 if((result.timezone===null)!==(result.today===null)||(!result.canMaintainBasic&&(result.timezone!==null||result.setupBlockers.length)))return invalid()
 return result
}
function account(value:unknown):EmployeeAccount {
 const row=strictObject(value,['userId','displayName','email','role','active','operationalManagerId','operationalManagerName','quarantined'])
 return {userId:parseUUID(row.userId),displayName:text(row.displayName),email:text(row.email),role:choice(row.role,employeeRoles),active:bool(row.active),operationalManagerId:nullable(row.operationalManagerId,parseUUID),operationalManagerName:nullable(row.operationalManagerName,text),quarantined:bool(row.quarantined)}
}
export function parseEmployeeDetail(value:unknown):EmployeeDetail {
 const row=strictObject(value,['id','version','fields','episode','account','reportingRevision','reporting','warnings'])
 return {id:parseUUID(row.id),version:parseVersion(row.version),fields:fields(row.fields),episode:nullable(row.episode,episode),account:nullable(row.account,account),reportingRevision:parseVersion(row.reportingRevision),reporting:list(row.reporting,interval),warnings:list(row.warnings,value=>choice(value,employeeWarnings))}
}
export function parsePage<T>(value:unknown,parse:(row:unknown)=>T):Page<T> {
 const row=strictObject(value,['rows','total','page','pageSize']),result={rows:list(row.rows,parse),total:parseVersion(row.total),page:parseVersion(row.page),pageSize:parseVersion(row.pageSize)}
 if(!result.page||!result.pageSize||result.pageSize>100||result.rows.length>result.pageSize||result.rows.length>result.total)return invalid();return result
}
export function parseEmployeePage(value:unknown):Page<EmployeeRow> {return parsePage(value,value=>{const row=strictObject(value,['id','version',...fieldKeys]);return {id:parseUUID(row.id),version:parseVersion(row.version),...fields(Object.fromEntries(fieldKeys.map(key=>[key,row[key]])))}})}
export function parseEmployeeAccountCandidates(value:unknown):Page<AccountCandidate> {return parsePage(value,value=>{const row=strictObject(value,['userId','displayName','email','role','active','linkState']);return {userId:parseUUID(row.userId),displayName:text(row.displayName),email:text(row.email),role:choice(row.role,employeeRoles),active:bool(row.active),linkState:choice(row.linkState,['unlinked','linked','quarantined'])}})}
export function parseEmployeeAudit(value:unknown):Page<EmployeeAuditEvent> {return parsePage(value,value=>{
 const row=strictObject(value,['id','employeeId','actorId','actorName','recordedAt','effectiveDate','action','reason','sourceReference','before','after'])
 return {id:parseUUID(row.id),employeeId:parseUUID(row.employeeId),actorId:parseUUID(row.actorId),actorName:text(row.actorName),recordedAt:timestamp(row.recordedAt),effectiveDate:nullable(row.effectiveDate,parseDateOnly),action:choice(row.action,actions),reason:nonempty(row.reason,500),sourceReference:nullable(row.sourceReference,v=>nonempty(v,500)),before:parseEmployeeSnapshot(row.before),after:parseEmployeeSnapshot(row.after)}
})}
export function normalizeEmployeeProposal(value:unknown):EmployeeProposal {
 const row=strictObject(value,['employeeId','expectedVersion','action','payload','reason','effectiveDate','sourceReference']),action=choice(row.action,actions)
 const result={employeeId:parseUUID(row.employeeId),expectedVersion:parseVersion(row.expectedVersion),action,payload:payload(action,row.payload,true),reason:normalizeText(row.reason,500,true)!,effectiveDate:nullable(row.effectiveDate,parseDateOnly),sourceReference:normalizeText(row.sourceReference,500)} as EmployeeProposal
 if(result.action==='save_reporting') {
  if(result.payload.mode==='correction'&&!result.sourceReference)return invalid()
  if(result.payload.intervals.some(i=>i.managerEmployeeId===result.employeeId))return invalid()
 }
 if(result.action==='save_initial_episode'&&result.payload.sourceReference&&result.sourceReference&&result.payload.sourceReference!==result.sourceReference)return invalid()
 return result
}
export function parseEmployeePreview(value:unknown):EmployeePreview {
 const row=strictObject(value,['employeeId','expectedVersion','action','normalizedPayload','before','after','scopeVersion','timezone','previewFingerprint']),action=choice(row.action,actions)
 return {employeeId:parseUUID(row.employeeId),expectedVersion:parseVersion(row.expectedVersion),action,normalizedPayload:payload(action,row.normalizedPayload),before:parseEmployeeSnapshot(row.before),after:parseEmployeeSnapshot(row.after),scopeVersion:nonempty(row.scopeVersion),timezone:nullable(row.timezone,nonempty),previewFingerprint:parseFingerprint(row.previewFingerprint)}
}
export function parseFingerprint(value:unknown):string {if(typeof value!=='string'||!/^[a-f\d]{64}$/.test(value))return invalid();return value}
export function parseCommandResult(value:unknown):CommandResult {
 const row=strictObject(value,['operationId','employeeId','version','auditEventId']);return {operationId:parseUUID(row.operationId),employeeId:parseUUID(row.employeeId),version:parseVersion(row.version),auditEventId:parseUUID(row.auditEventId)}
}
export function parseOperationResult(value:unknown):OperationResult {
 const row=strictObject(value,['state','result']),state=choice(row.state,['absent','completed','abandoned'])
 if(state==='completed')return {state,result:parseCommandResult(row.result)}
 if(row.result!==null)return invalid();return {state,result:null}
}
