import { supabase } from '../supabase'
import { createTransactionSender } from '../orderTransactions'
import { parseDateKey, parseUUID } from './contracts'
import type { LeaveResult, Page, Recovery, UUID } from './contracts'
import { leaveErrorMessage } from './rpc'
import type { LeaveApproverOption, LeaveCalendarSetup, LeaveMemberSetup, LeaveSetupCommand, RosterPreview, RosterPreviewInput, SetupImpacts, CalendarPreviewInput, CalendarPreview } from './setupContracts'
function invalid(): never { throw new Error('Respons pengaturan cuti tidak valid. Muat ulang sebelum melanjutkan.') }
function obj(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v)) invalid(); return v as Record<string, unknown> }
function text(v: unknown): string { if (typeof v !== 'string') invalid(); return v }
function integer(v: unknown): number { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) invalid(); return v }
function bool(v: unknown): boolean { if (typeof v !== 'boolean') invalid(); return v }
function list(v: unknown): unknown[] { if (!Array.isArray(v)) invalid(); return v }
const dateOrNull = (v: unknown) => v === null ? null : parseDateKey(v)
const idOrNull = (v: unknown) => v === null ? null : parseUUID(v)
function impacts(value: unknown): SetupImpacts { const v=obj(value), available=bool(v.available); if (!available && (v.pendingCount!==null || v.approvedCount!==null)) invalid(); return {available,pendingCount:available?integer(v.pendingCount):null,approvedCount:available?integer(v.approvedCount):null} }
function result(value: unknown): LeaveResult {
 const v=obj(value), version=integer(v.version)
 if (!version || !['set_member','set_approver','save_calendar_version','set_group_membership','publish_roster'].includes(v.operation as string)) invalid()
 return {id:parseUUID(v.id),version,operation:text(v.operation)}
}
/** Serialization filter only; UUID/retry/uncertainty/recovery decisions stay in the shared sender. */
function metadataStorage(resolve: () => Storage): Storage {
 function minimal(raw: string) { const v=obj(JSON.parse(raw)), hash=text(v.key); if (!/^[0-9a-f]{64}$/.test(hash)) invalid(); return JSON.stringify({id:parseUUID(v.id),key:hash,uncertain:bool(v.uncertain),...(v.committed===undefined?{}:{committed:result(v.committed)})}) }
 return {get length(){return resolve().length},clear(){resolve().clear()},key(i){return resolve().key(i)},removeItem(k){resolve().removeItem(k)},getItem(k){const raw=resolve().getItem(k);return raw===null?null:minimal(raw)},setItem(k,v){resolve().setItem(k,minimal(v))}}
}
export function toSetupPayload(c: LeaveSetupCommand): Record<string, unknown> {
 const base={expected_version:integer(c.expectedVersion),reason:text(c.reason)}
 if (!base.reason.trim() || base.reason.length>1000) invalid()
 switch(c.operation){
 case 'set_member':
  if (!['employee','manager','director'].includes(c.memberKind)) invalid()
  return {...base,employee_id:parseUUID(c.employeeId),member_kind:c.memberKind,active:bool(c.active),employment_start:dateOrNull(c.employmentStart),eligibility_date:dateOrNull(c.eligibilityDate),calendar_id:idOrNull(c.calendarId)}
 case 'set_approver':
  if (c.approverId===null && (c.effectiveFrom!==null || c.effectiveUntil!==null || c.replaceAssignmentId===null)) invalid()
  if (c.approverId!==null && c.effectiveFrom===null) invalid()
  return {...base,employee_id:parseUUID(c.employeeId),approver_id:idOrNull(c.approverId),effective_from:dateOrNull(c.effectiveFrom),effective_until:dateOrNull(c.effectiveUntil),replace_assignment_id:idOrNull(c.replaceAssignmentId)}
 case 'set_group_membership':return {...base,employee_id:parseUUID(c.employeeId),group_id:parseUUID(c.groupId),effective_from:parseDateKey(c.effectiveFrom),effective_until:dateOrNull(c.effectiveUntil),replace_membership_id:idOrNull(c.replaceMembershipId)}
 case 'save_calendar_version':return {...base,...toCalendarProposal(c),preview_fingerprint:text(c.previewFingerprint)}
 case 'publish_roster':return {...base,calendar_id:parseUUID(c.calendarId),anchor:parseDateKey(c.anchor),groups:c.groups.map(g=>({id:parseUUID(g.id),on_anchor:bool(g.onAnchor)})),effective_from:parseDateKey(c.from),effective_until:parseDateKey(c.to),preview_fingerprint:text(c.previewFingerprint)}
 default:return invalid()
 }
}
/** authorize must revalidate live actor/scope (runLeaveInteraction). Stable backend/actor/form key
 * intentionally excludes scope revision, so lost authorization cannot hide an unresolved command. */
export function createLeaveSetupTransport(options:{actorId:UUID;backendScope:string;formScope:string;storage:()=>Storage;authorize:()=>Promise<void>}){
 parseUUID(options.actorId);if(!options.backendScope || !options.formScope) invalid()
 const sender=createTransactionSender({validateResult:(value,expectedOperation)=>{const receipt=result(value);return expectedOperation===undefined||receipt.operation===expectedOperation},rpcName:'leave_transaction_v1',recoveryRpcName:'leave_reconcile_request_v1',storage:()=>metadataStorage(options.storage),storageKey:`ihr-setup:${encodeURIComponent(options.backendScope)}:${options.actorId}:${encodeURIComponent(options.formScope)}`})
 return {
  async send(command:LeaveSetupCommand):Promise<LeaveResult>{try{const payload=toSetupPayload(command);await options.authorize();const response=result(await sender(command.operation,payload));if(response.operation!==command.operation)invalid();return response}catch{throw new Error('Pengaturan cuti belum dapat disimpan. Periksa akses dan isian; pulihkan hasil bila status belum pasti.')}},
  hasUnresolved:sender.hasUnresolved,acknowledgeRecovered:sender.acknowledgeRecovered,
  async reconcile():Promise<Recovery>{try{await options.authorize();const r=await sender.reconcile();if(r.state==='committed')return {state:'committed',result:result(r.result)};if(r.state==='abandoned')return {state:'abandoned'};return invalid()}catch{throw new Error('Hasil pengaturan cuti belum pasti. Jangan membuat pengiriman baru.')}}
 }
}
async function page<T>(section:string,number:number,size:number,signal:AbortSignal,parse:(v:unknown)=>T):Promise<Page<T>>{
 if(!Number.isSafeInteger(number)||number<1||!Number.isSafeInteger(size)||size<1||size>100)invalid()
 const {data,error}=await supabase.rpc('leave_admin_setup_v1',{p_section:section,p_page:number,p_page_size:size}).abortSignal(signal);signal.throwIfAborted()
 if(error)throw new Error(leaveErrorMessage(error));const v=obj(data);if(v.page!==number||v.pageSize!==size)invalid()
 return {rows:list(v.rows).map(parse),total:integer(v.total),page:number,pageSize:size}
}
export function fetchLeaveMembers(number:number,size:number,signal:AbortSignal):Promise<Page<LeaveMemberSetup>>{
 return page('members',number,size,signal,value=>{const v=obj(value);if(![null,'employee','manager','director'].includes(v.memberKind as string|null))invalid()
  return {id:parseUUID(v.id),name:text(v.name),memberKind:v.memberKind as LeaveMemberSetup['memberKind'],active:bool(v.active),employmentStart:dateOrNull(v.employmentStart),eligibilityDate:dateOrNull(v.eligibilityDate),calendarId:idOrNull(v.calendarId),version:integer(v.version),impacts:impacts(v.impacts),
   assignments:list(v.assignments).map(value=>{const a=obj(value);return {id:parseUUID(a.id),approverId:parseUUID(a.approverId),effectiveFrom:text(a.effectiveFrom),effectiveUntil:a.effectiveUntil===null?null:text(a.effectiveUntil),version:integer(a.version)}}),
   memberships:list(v.memberships).map(value=>{const m=obj(value);return {id:parseUUID(m.id),groupId:parseUUID(m.groupId),effectiveFrom:parseDateKey(m.effectiveFrom),effectiveUntil:dateOrNull(m.effectiveUntil),version:integer(m.version)}})}
 })
}
export function fetchLeaveApprovers(number:number,size:number,signal:AbortSignal):Promise<Page<LeaveApproverOption>>{
 return page('approvers',number,size,signal,value=>{const v=obj(value);if(v.memberKind!=='manager'&&v.memberKind!=='director')invalid();return {id:parseUUID(v.id),name:text(v.name),memberKind:v.memberKind,active:bool(v.active)}})
}
export function fetchLeaveRota(number:number,size:number,signal:AbortSignal):Promise<Page<LeaveCalendarSetup>>{
 return page('rota',number,size,signal,value=>{const v=obj(value);if(v.sundayMinutes!==null&&v.sundayMinutes!==0)invalid();return {
  id:parseUUID(v.id),name:text(v.name),version:integer(v.version),effectiveFrom:parseDateKey(v.effectiveFrom),effectiveUntil:dateOrNull(v.effectiveUntil),timezone:v.timezone===null?null:text(v.timezone),confirmedTimezone:v.confirmedTimezone===null?null:text(v.confirmedTimezone),holidaysConfirmed:bool(v.holidaysConfirmed),sundayMinutes:v.sundayMinutes as 0|null,
  holidays:list(v.holidays).map(parseDateKey),groups:list(v.groups).map(value=>{const g=obj(value);return {id:parseUUID(g.id),name:text(g.name),onAnchor:g.onAnchor===null?null:bool(g.onAnchor)}}),impacts:impacts(v.impacts)}})
}
export async function previewLeaveRoster(input:RosterPreviewInput,signal:AbortSignal):Promise<RosterPreview>{
 const {data,error}=await supabase.rpc('leave_roster_preview_v1',{p_calendar_id:parseUUID(input.calendarId),p_anchor:parseDateKey(input.anchor),p_groups:input.groups.map(g=>({id:parseUUID(g.id),on_anchor:bool(g.onAnchor)})),p_from:parseDateKey(input.from),p_to:parseDateKey(input.to)}).abortSignal(signal);signal.throwIfAborted()
 if(error)throw new Error(leaveErrorMessage(error));const v=obj(data);if(v.calendarId!==input.calendarId||!text(v.fingerprint)||integer(v.calendarVersion)<1)invalid()
 return {calendarId:parseUUID(v.calendarId),calendarVersion:integer(v.calendarVersion),fingerprint:text(v.fingerprint),impacts:impacts(v.impacts),rows:list(v.rows).map(value=>{const r=obj(value);if(r.capacityMinutes!==0&&r.capacityMinutes!==225)invalid();const date=parseDateKey(r.date),groupId=parseUUID(r.groupId);if(date<input.from||date>=input.to||!input.groups.some(g=>g.id===groupId))invalid();return {date,groupId,capacityMinutes:r.capacityMinutes}})}
}

export function toCalendarProposal(c:CalendarPreviewInput):Record<string,unknown>{
 if(c.sundayMinutes!==null&&c.sundayMinutes!==0)invalid()
 return {expected_version:integer(c.expectedVersion),calendar_id:parseUUID(c.calendarId),name:text(c.name),effective_from:parseDateKey(c.effectiveFrom),effective_until:dateOrNull(c.effectiveUntil),timezone:c.timezone===null?null:text(c.timezone),holidays_confirmed:bool(c.holidaysConfirmed),sunday_minutes:c.sundayMinutes,holidays:c.holidays.map(parseDateKey),groups:c.groups.map(g=>({id:parseUUID(g.id),name:text(g.name)}))}
}
export async function previewLeaveCalendar(input:CalendarPreviewInput,signal:AbortSignal):Promise<CalendarPreview>{
 const {data,error}=await supabase.rpc('leave_calendar_preview_v1',{p_proposal:toCalendarProposal(input)}).abortSignal(signal);signal.throwIfAborted()
 if(error)throw new Error(leaveErrorMessage(error));const v=obj(data)
 if(v.calendarId!==input.calendarId||v.calendarVersion!==input.expectedVersion||!text(v.fingerprint))invalid()
 return {calendarId:parseUUID(v.calendarId),calendarVersion:integer(v.calendarVersion),fingerprint:text(v.fingerprint),impacts:impacts(v.impacts)}
}
