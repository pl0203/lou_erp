import { supabase } from '../supabase'
import { parseDateKey,parseUUID,parseDurationSelection } from './contracts'
import { parseCurrentPeriod } from './accountRpc'
import { leaveErrorMessage } from './rpc'
import { ADMIN_OPERATIONS } from './adminContracts'
import type { LeaveAdminRotaContext } from './adminContracts'
import type { AccessGrant,AccessManifest,AdminCapability,AdminReceipt,GovernanceEvidence,GovernanceKind,LeaveAdminAccessData,LeaveAdminCommand,LeaveAdminPolicy,LeaveAdminRequest,LeaveAdminSettingsData,LeaveAdminTarget,LeaveAdminWriteContext,AdminWriteBalance,HrRequestSummary,HrRequestDetail,HrRequestPage,HrRequestDetailResponse,HrRequestHistoryPage,HrRequestEvent,HrHistoryCursor,LeavePolicyDraft } from './adminContracts'
function invalid():never{throw new Error('Pengaturan cuti belum dapat dibaca atau disimpan. Periksa akses dan isian, lalu muat ulang.')}
function obj(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))invalid();return v as Record<string,unknown>}
function text(v:unknown):string{if(typeof v!=='string')invalid();return v}
function bool(v:unknown):boolean{if(typeof v!=='boolean')invalid();return v}
function integer(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER):number{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)invalid();return v}
function list(v:unknown):unknown[]{if(!Array.isArray(v))invalid();return v}
function nullable<T>(v:unknown,parse:(value:unknown)=>T):T|null{return v===null?null:parse(v)}
function enumeration<T extends string>(v:unknown,values:readonly T[]):T{if(!values.includes(v as T))invalid();return v as T}
const capabilities=['configure','adjust','read_private','calendar','manage_access'] as const
function authorityKey(v:unknown):string{const key=text(v);if(!/^[0-9a-f]{64}$/.test(key))invalid();return key}
function policy(v:unknown):LeaveAdminPolicy{
 const p=obj(v)
 return {id:parseUUID(p.id),version:integer(p.version,1),effectiveFrom:parseDateKey(p.effectiveFrom),effectiveUntil:nullable(p.effectiveUntil,parseDateKey),annualPolicyConfirmed:bool(p.annualPolicyConfirmed),requestRulesConfirmed:bool(p.requestRulesConfirmed),minimumNoticeDays:nullable(p.minimumNoticeDays,v=>integer(v,0,366)),bookingHorizonDays:nullable(p.bookingHorizonDays,v=>integer(v,0,366)),reasonRequired:nullable(p.reasonRequired,bool),reservePendingAccepted:nullable(p.reservePendingAccepted,bool),singleDateRuleAccepted:nullable(p.singleDateRuleAccepted,bool),cancellationRulesConfirmed:bool(p.cancellationRulesConfirmed),cancellationMode:nullable(p.cancellationMode,v=>enumeration(v,['whole_request'])),cancellationAllowPast:nullable(p.cancellationAllowPast,bool),cancellationAllowRepeatDeclined:nullable(p.cancellationAllowRepeatDeclined,bool),cancellationReasonRequired:nullable(p.cancellationReasonRequired,bool),calendarAudience:nullable(p.calendarAudience,v=>enumeration(v,['explicit_grants'])),calendarAudienceConfirmed:bool(p.calendarAudienceConfirmed)}
}
function evidence(v:unknown):GovernanceEvidence{
 const a=obj(v)
 return {id:parseUUID(a.id),kind:enumeration(a.kind,['retention','access_review']),referenceVersion:integer(a.referenceVersion),selected:bool(a.selected),confirmed:bool(a.confirmed),ruleId:nullable(a.ruleId,parseUUID),ruleVersion:nullable(a.ruleVersion,v=>integer(v,1)),ruleDocument:nullable(a.ruleDocument,obj),approvedBy:nullable(a.approvedBy,parseUUID),approvedAt:nullable(a.approvedAt,text),accountableOwner:nullable(a.accountableOwner,parseUUID),cadence:nullable(a.cadence,text),capabilities:nullable(a.capabilities,v=>list(v).map(x=>enumeration(x,capabilities))),grantIds:nullable(a.grantIds,v=>list(v).map(parseUUID)),audienceIds:nullable(a.audienceIds,v=>list(v).map(parseUUID))}
}
function policyPayload(p:LeavePolicyDraft):Record<string,unknown>{
 const start=parseDateKey(p.effectiveFrom),end=nullable(p.effectiveUntil,parseDateKey)
 const notice=nullable(p.minimumNoticeDays,v=>integer(v,0,366)),horizon=nullable(p.bookingHorizonDays,v=>integer(v,0,366))
 if(end!==null&&end<=start)invalid()
 if(p.requestRulesConfirmed&&(notice===null||horizon===null||notice>horizon||p.reasonRequired===null))invalid()
 if(p.cancellationRulesConfirmed&&(p.cancellationMode!=='whole_request'||p.cancellationAllowPast===null||p.cancellationAllowRepeatDeclined===null||p.cancellationReasonRequired===null))invalid()
 if(p.calendarAudienceConfirmed&&p.calendarAudience!=='explicit_grants')invalid()
 return {effective_from:start,effective_until:end,annual_policy_confirmed:bool(p.annualPolicyConfirmed),request_rules_confirmed:bool(p.requestRulesConfirmed),minimum_notice_days:notice,booking_horizon_days:horizon,reason_required:nullable(p.reasonRequired,bool),reserve_pending_accepted:nullable(p.reservePendingAccepted,bool),single_date_rule_accepted:nullable(p.singleDateRuleAccepted,bool),cancellation_rules_confirmed:bool(p.cancellationRulesConfirmed),cancellation_mode:nullable(p.cancellationMode,v=>enumeration(v,['whole_request'])),cancellation_allow_past:nullable(p.cancellationAllowPast,bool),cancellation_allow_repeat_declined:nullable(p.cancellationAllowRepeatDeclined,bool),cancellation_reason_required:nullable(p.cancellationReasonRequired,bool),calendar_audience:nullable(p.calendarAudience,v=>enumeration(v,['explicit_grants'])),calendar_audience_confirmed:bool(p.calendarAudienceConfirmed)}
}
export function toAdminPayload(c:LeaveAdminCommand):Record<string,unknown>{
 const base={expected_version:integer(c.expectedVersion),reason:text(c.reason)}
 if(!base.reason.trim()||base.reason.length>1000)invalid()
 switch(c.operation){
 case 'save_policy_version':return {...base,employee_id:parseUUID(c.employeeId),...policyPayload(c.policy)}
 case 'activate_member_policy':return {...base,employee_id:parseUUID(c.employeeId),policy_id:parseUUID(c.policyId),established_eligibility_confirmed:bool(c.establishedEligibilityConfirmed)}
 case 'set_governance_reference':return {...base,employee_id:parseUUID(c.employeeId),kind:enumeration<GovernanceKind>(c.kind,['retention','access_review']),approval_id:parseUUID(c.approvalId)}
 case 'grant_leave_access':if(c.expectedVersion!==0)invalid();return {...base,manifest_id:parseUUID(c.manifestId)}
 case 'revoke_leave_access':if(c.expectedVersion<1)invalid();return {...base,grant_id:parseUUID(c.grantId)}
 case 'reassign_request':if(c.expectedVersion<1)invalid();return {...base,employee_id:parseUUID(c.employeeId),request_id:parseUUID(c.requestId),assignment_id:parseUUID(c.assignmentId)}
 default:return invalid()
 }
}
export function parseAdminReceipt(value:unknown):AdminReceipt{
 const r=obj(value);if(Object.keys(r).sort().join(',')!=='id,operation,version')invalid()
 return {id:parseUUID(r.id),version:integer(r.version,1),operation:enumeration(r.operation,ADMIN_OPERATIONS)}
}
async function read(name:string,args:Record<string,unknown>,signal:AbortSignal):Promise<Record<string,unknown>>{
 const {data,error}=await supabase.rpc(name,args).abortSignal(signal);signal.throwIfAborted();if(error)throw new Error(leaveErrorMessage(error));return obj(data)
}
export async function fetchLeaveAdminSettings(employeeId:string,signal:AbortSignal):Promise<LeaveAdminSettingsData>{
 const v=await read('leave_admin_settings_v1',{p_employee_id:parseUUID(employeeId)},signal);if(v.employeeId!==employeeId)invalid()
 const r=obj(v.readiness),i=obj(v.impacts),ready=bool(r.ready),blockers=list(r.blockers).map(x=>{const b=obj(x);return {code:text(b.code),message:text(b.message)}}),available=bool(i.available)
 if(ready&&blockers.length||!ready&&!blockers.length||!available&&(i.pendingCount!==null||i.approvedCount!==null))invalid()
 return {employeeId,authorityKey:authorityKey(v.authorityKey),memberVersion:integer(v.memberVersion,1),policy:nullable(v.policy,policy),policyDrafts:list(v.policyDrafts).map(policy),governance:list(v.governance).map(evidence),readiness:{ready,blockers},impacts:{available,pendingCount:available?integer(i.pendingCount):null,approvedCount:available?integer(i.approvedCount):null}}
}
function grant(v:unknown,employeeId:string):AccessGrant{
 const g=obj(v);if(g.employeeId!==employeeId)invalid()
 return {id:parseUUID(g.id),actorId:parseUUID(g.actorId),capability:enumeration<AdminCapability>(g.capability,capabilities),employeeId,effectiveFrom:text(g.effectiveFrom),effectiveUntil:nullable(g.effectiveUntil,text),version:integer(g.version,1),revoked:bool(g.revoked)}
}
export async function fetchLeaveAdminAccess(employeeId:string,signal:AbortSignal):Promise<LeaveAdminAccessData>{
 const v=await read('leave_admin_access_v1',{p_employee_id:parseUUID(employeeId)},signal);if(v.employeeId!==employeeId)invalid()
 return {employeeId,authorityKey:authorityKey(v.authorityKey),grants:list(v.grants).map(x=>grant(x,employeeId)),manifests:list(v.manifests).map(x=>{const m=obj(x);if(m.employeeId!==employeeId)invalid();return {id:parseUUID(m.id),grantId:parseUUID(m.grantId),actorId:parseUUID(m.actorId),capability:enumeration<AdminCapability>(m.capability,capabilities),employeeId,effectiveFrom:text(m.effectiveFrom),effectiveUntil:nullable(m.effectiveUntil,text),approvedBy:parseUUID(m.approvedBy),approvedAt:text(m.approvedAt),approvalReference:text(m.approvalReference)} satisfies AccessManifest})}
}
export async function fetchLeaveAdminRequests(employeeId:string,before:number|null,limit:number,signal:AbortSignal):Promise<{rows:LeaveAdminRequest[];nextBefore:number|null}>{
 const v=await read('leave_admin_requests_v1',{p_employee_id:parseUUID(employeeId),p_before:nullable(before,x=>integer(x,1)),p_limit:integer(limit,1,100)},signal)
 const rows=list(v.rows).map(x=>{const r=obj(x);return {id:parseUUID(r.id),sequence:integer(r.sequence,1),version:integer(r.version,1),startDate:parseDateKey(r.startDate),endDate:parseDateKey(r.endDate),approverName:text(r.approverName),currentAssignmentId:parseUUID(r.currentAssignmentId)}})
 if(rows.length>limit||rows.some((r,i)=>(before!==null&&r.sequence>=before)||(i>0&&r.sequence>=rows[i-1].sequence)))invalid()
 const nextBefore=nullable(v.nextBefore,x=>integer(x,1));if(nextBefore!==null&&nextBefore!==rows.at(-1)?.sequence)invalid()
 return {rows,nextBefore}
}

export async function fetchLeaveAdminTargets(page:number,size:number,signal:AbortSignal):Promise<{rows:LeaveAdminTarget[];total:number;page:number;pageSize:number}>{
 const v=await read('leave_admin_targets_v1',{p_page:integer(page,1),p_page_size:integer(size,1,100)},signal)
 if(v.page!==page||v.pageSize!==size)invalid()
 const rows=list(v.rows).map(x=>{const r=obj(x),c=obj(r.capabilities)
  if(Object.keys(r).sort().join(',')!=='capabilities,id,name'||Object.keys(c).sort().join(',')!=='adjust,calendar,configure,manageAccess,readPrivate')invalid()
  const capabilities={configure:bool(c.configure),adjust:bool(c.adjust),readPrivate:bool(c.readPrivate),calendar:bool(c.calendar),manageAccess:bool(c.manageAccess)}
  if(!Object.values(capabilities).some(Boolean))invalid()
  return {id:parseUUID(r.id),name:text(r.name),capabilities}
 })
 const total=integer(v.total);if(rows.length>size||new Set(rows.map(r=>r.id)).size!==rows.length||rows.length!==Math.min(size,Math.max(0,total-(page-1)*size)))invalid()
 return {rows,total,page,pageSize:size}
}

export async function fetchLeaveAdminWriteContext(employeeId:string,scopeVersion:string,signal:AbortSignal):Promise<LeaveAdminWriteContext>{
 const v=await read('leave_admin_write_context_v1',{p_employee_id:parseUUID(employeeId)},signal)
 const exact=(o:Record<string,unknown>,keys:string)=>{if(Object.keys(o).sort().join(',')!==keys)invalid()}
 exact(v,'authorityKey,balance,capabilities,employeeId,memberOptions,scopeVersion')
 if(v.employeeId!==employeeId||!scopeVersion||v.scopeVersion!==scopeVersion)invalid()
 const c=obj(v.capabilities);exact(c,'adjust,configure');const capabilities={configure:bool(c.configure),adjust:bool(c.adjust)}
 if(!capabilities.configure&&!capabilities.adjust)invalid()
 const b=obj(v.balance);exact(b,'account,currentPeriod,state');const state=enumeration(b.state,['verified','unreconciled','missing','unavailable']),currentPeriod=parseCurrentPeriod(b.currentPeriod)
 const account=nullable(b.account,x=>{const a=obj(x);exact(a,'accountId,reconciled,version,year');return {accountId:parseUUID(a.accountId),year:integer(a.year,1,9998),version:integer(a.version,1),reconciled:bool(a.reconciled)}})
 if(state==='unavailable'?(currentPeriod!==null||account!==null):currentPeriod===null)invalid()
 if(state==='missing'&&account!==null)invalid()
 if((state==='verified'||state==='unreconciled')&&(!account||account.year!==currentPeriod?.year||account.reconciled!==(state==='verified')))invalid()
 const memberOptions=nullable(v.memberOptions,x=>{
  const o=obj(x);exact(o,'calendars,groups,state');const optionsState=enumeration(o.state,['available','lineage_unassigned','unavailable'])
  const choices=(items:unknown)=>{const result=list(items).map(x=>{const item=obj(x);exact(item,'id,name');const name=text(item.name);if(!name.trim())invalid();return {id:parseUUID(item.id),name}});if(new Set(result.map(r=>r.id)).size!==result.length)invalid();return result}
  const calendars=choices(o.calendars),groups=choices(o.groups)
  if(optionsState==='available'?calendars.length!==1:calendars.length!==0||groups.length!==0)invalid()
  return {state:optionsState,calendars,groups}
 })
 if(capabilities.configure?(memberOptions===null):memberOptions!==null)invalid()
 return {employeeId,scopeVersion,authorityKey:authorityKey(v.authorityKey),capabilities,balance:{state,currentPeriod,account} as AdminWriteBalance,memberOptions}
}

function exactHr(o:Record<string,unknown>,keys:string){if(Object.keys(o).sort().join(',')!==keys)invalid()}
export async function fetchLeaveAdminRotaContext(calendarId:string,scopeVersion:string,signal:AbortSignal):Promise<LeaveAdminRotaContext>{
 const v=await read('leave_admin_rota_context_v1',{p_calendar_id:parseUUID(calendarId)},signal)
 exactHr(v,'authorityKey,calendar,calendarId,scopeVersion');if(v.calendarId!==calendarId||!scopeVersion||v.scopeVersion!==scopeVersion)invalid()
 const c=obj(v.calendar);exactHr(c,'confirmedTimezone,effectiveFrom,effectiveUntil,groups,holidays,holidaysConfirmed,id,impacts,name,sundayMinutes,timezone,version');if(c.id!==calendarId)invalid()
 const effectiveFrom=parseDateKey(c.effectiveFrom),effectiveUntil=nullable(c.effectiveUntil,parseDateKey),holidays=list(c.holidays).map(parseDateKey)
 if(effectiveUntil!==null&&effectiveUntil<=effectiveFrom||new Set(holidays).size!==holidays.length||holidays.some(d=>d<effectiveFrom||effectiveUntil!==null&&d>=effectiveUntil))invalid()
 const groups=list(c.groups).map(value=>{const g=obj(value);exactHr(g,'id,name,onAnchor');return {id:parseUUID(g.id),name:text(g.name),onAnchor:nullable(g.onAnchor,bool)}})
 if(new Set(groups.map(g=>g.id)).size!==groups.length||c.sundayMinutes!==null&&c.sundayMinutes!==0)invalid()
 const i=obj(c.impacts);exactHr(i,'approvedCount,available,pendingCount');const available=bool(i.available);if(!available&&(i.pendingCount!==null||i.approvedCount!==null))invalid()
 return {calendarId,scopeVersion,authorityKey:authorityKey(v.authorityKey),calendar:{id:calendarId,name:text(c.name),version:integer(c.version,1),effectiveFrom,effectiveUntil,timezone:nullable(c.timezone,text),confirmedTimezone:nullable(c.confirmedTimezone,text),holidaysConfirmed:bool(c.holidaysConfirmed),sundayMinutes:c.sundayMinutes as 0|null,holidays,groups,impacts:{available,pendingCount:available?integer(i.pendingCount):null,approvedCount:available?integer(i.approvedCount):null}}}
}
function hrEnvelope(v:Record<string,unknown>,employeeId:string,scopeVersion:string,keys:string){
 exactHr(v,keys);if(v.employeeId!==employeeId||!scopeVersion||v.scopeVersion!==scopeVersion)invalid()
 return {employeeId,scopeVersion,authorityKey:authorityKey(v.authorityKey)}
}
function hrTimestamp(value:unknown):string{
 const v=text(value),match=v.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/)
 if(!match||Number(match[2])>23||Number(match[3])>59||Number(match[4])>59||!Number.isFinite(Date.parse(v)))invalid()
 parseDateKey(match[1]);return v
}
function hrInstant(value:string):bigint{
 const fraction=value.match(/\.(\d{1,6})(?=Z|[+-]\d{2}:\d{2}$)/)?.[1]??''
 return BigInt(Date.parse(value.replace(/\.\d{1,6}(?=Z|[+-]\d{2}:\d{2}$)/,'')))*1000n+BigInt(fraction.padEnd(6,'0')||'0')
}
function hrCompare(a:HrHistoryCursor,b:HrHistoryCursor):number{const x=hrInstant(a.atTime),y=hrInstant(b.atTime);if(x!==y)return x<y?-1:1;const left=a.id.toLowerCase(),right=b.id.toLowerCase();return left===right?0:left<right?-1:1}
function hrSummary(value:unknown,detail=false):HrRequestSummary{
 const r=obj(value);exactHr(r,detail?'allocations,approverName,days,duration,endDate,id,reason,sequence,sourceKind,startDate,status,submittedAt,totalMinutes,version':'duration,endDate,id,sequence,sourceKind,startDate,status,submittedAt,totalMinutes,version')
 const startDate=parseDateKey(r.startDate),endDate=parseDateKey(r.endDate);if(endDate<startDate)invalid()
 return {id:parseUUID(r.id),sequence:integer(r.sequence,1),startDate,endDate,duration:parseDurationSelection(r.duration),totalMinutes:integer(r.totalMinutes,1,2147483647),status:enumeration(r.status,['submitted','approved','rejected','withdrawn','cancellation_pending','cancelled']),version:integer(r.version,1),submittedAt:hrTimestamp(r.submittedAt),sourceKind:enumeration(r.sourceKind,['submission','opening'])}
}
export async function fetchHrRequests(employeeId:string,scopeVersion:string,before:number|null,limit:number,signal:AbortSignal):Promise<HrRequestPage>{
 const v=await read('leave_hr_requests_v1',{p_employee_id:parseUUID(employeeId),p_before:nullable(before,v=>integer(v,1)),p_limit:integer(limit,1,50)},signal),envelope=hrEnvelope(v,employeeId,scopeVersion,'authorityKey,employeeId,nextBefore,rows,scopeVersion')
 const rows=list(v.rows).map(x=>hrSummary(x));if(rows.length>limit||new Set(rows.map(r=>r.id)).size!==rows.length||rows.some((r,i)=>(before!==null&&r.sequence>=before)||(i>0&&r.sequence>=rows[i-1].sequence)))invalid()
 const nextBefore=nullable(v.nextBefore,v=>integer(v,1));if(nextBefore!==null&&nextBefore!==rows.at(-1)?.sequence)invalid()
 return {...envelope,rows,nextBefore}
}
export async function fetchHrRequest(employeeId:string,scopeVersion:string,requestId:string,signal:AbortSignal):Promise<HrRequestDetailResponse>{
 const v=await read('leave_hr_request_v1',{p_employee_id:parseUUID(employeeId),p_request_id:parseUUID(requestId)},signal),envelope=hrEnvelope(v,employeeId,scopeVersion,'authorityKey,employeeId,request,scopeVersion'),r=obj(v.request),summary=hrSummary(r,true)
 if(summary.id!==requestId)invalid()
 const reason=text(r.reason);if(reason.length>1000)invalid()
 const days=list(r.days).map(x=>{const d=obj(x);exactHr(d,'chargedMinutes,date,exclusion,groupName,scheduledMinutes');const date=parseDateKey(d.date),scheduledMinutes=integer(d.scheduledMinutes,0,450);if(![0,225,450].includes(scheduledMinutes)||date<summary.startDate||date>summary.endDate)invalid();const chargedMinutes=integer(d.chargedMinutes,0,scheduledMinutes),exclusion=nullable(d.exclusion,v=>enumeration(v,['holiday','off_duty'] as const));if(exclusion!==null&&chargedMinutes!==0)invalid();return {date,scheduledMinutes:scheduledMinutes as 0|225|450,chargedMinutes,exclusion,groupName:nullable(d.groupName,text)}})
 const allocations=list(r.allocations).map(x=>{const a=obj(x);exactHr(a,'chargedMinutes,endDate,startDate,year');const period=parseCurrentPeriod(a);if(!period)invalid();return {...period,chargedMinutes:integer(a.chargedMinutes,1,2147483647)}})
 if(!days.length||days.length>366||days.some((d,i)=>i>0&&d.date<=days[i-1].date)||new Set(allocations.map(a=>a.year)).size!==allocations.length||days.reduce((sum,d)=>sum+d.chargedMinutes,0)!==summary.totalMinutes||allocations.reduce((sum,a)=>sum+a.chargedMinutes,0)!==summary.totalMinutes)invalid()
 const request:HrRequestDetail={...summary,reason,approverName:text(r.approverName),days,allocations};return {...envelope,request}
}
export async function fetchHrRequestHistory(employeeId:string,scopeVersion:string,requestId:string,before:HrHistoryCursor|null,limit:number,signal:AbortSignal):Promise<HrRequestHistoryPage>{
 const boundary=before===null?null:{atTime:hrTimestamp(before.atTime),id:parseUUID(before.id)}
 const v=await read('leave_hr_request_history_v1',{p_employee_id:parseUUID(employeeId),p_request_id:parseUUID(requestId),p_before_at:boundary?.atTime??null,p_before_id:boundary?.id??null,p_limit:integer(limit,1,50)},signal),envelope=hrEnvelope(v,employeeId,scopeVersion,'authorityKey,employeeId,nextBefore,requestId,rows,scopeVersion')
 if(v.requestId!==requestId)invalid()
 const rows=list(v.rows).map(x=>{const e=obj(x),actor=obj(e.actor);exactHr(e,'actor,approverName,atTime,event,id,reason');exactHr(actor,'id,name');const reason=nullable(e.reason,text);if(reason!==null&&reason.length>1000)invalid();return {id:parseUUID(e.id),event:enumeration(e.event,['submitted','opening_imported','approved','rejected','withdrawn','cancellation_requested','cancellation_accepted','cancellation_declined','reassigned']),atTime:hrTimestamp(e.atTime),actor:{id:parseUUID(actor.id),name:text(actor.name)},reason,approverName:nullable(e.approverName,text)} satisfies HrRequestEvent})
 if(rows.length>limit||new Set(rows.map(r=>r.id)).size!==rows.length||rows.some((r,i)=>(boundary!==null&&hrCompare(r,boundary)>=0)||(i>0&&hrCompare(r,rows[i-1])>=0)))invalid()
 const nextBefore=nullable(v.nextBefore,x=>{const c=obj(x);exactHr(c,'atTime,id');return {atTime:hrTimestamp(c.atTime),id:parseUUID(c.id)}})
 if(nextBefore!==null&&(!rows.length||hrCompare(nextBefore,rows[rows.length-1])!==0))invalid()
 return {...envelope,requestId,rows,nextBefore}
}
