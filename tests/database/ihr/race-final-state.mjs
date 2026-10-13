// Exact state assertions for the final-schema race adapter. No database/process lifecycle here.
import { isDeepStrictEqual } from 'node:util'
import { decisionOutcomeMatches } from './decisions-concurrency.mjs'
export const stateTables = {
 requests:['public.ihr_leave_requests','id'],days:['public.ihr_leave_request_days','request_id,day'],
 allocations:['public.ihr_leave_request_allocations','request_id,account_id'],occupancy:['public.ihr_leave_occupancy','employee_id,day'],
 accounts:['public.ihr_leave_accounts','id'],ledger:['public.ihr_leave_ledger','id'],events:['private.ihr_leave_request_events','id'],
 commands:['private.ihr_leave_commands','actor_id,request_id'],attempts:['private.ihr_leave_cancellation_attempts','id'],
 decisions:['private.ihr_leave_cancellation_decisions','attempt_id'],reversals:['private.ihr_leave_charge_reversals','request_id,account_id'],
 admin_events:['public.ihr_leave_admin_events','id'],members:['public.ihr_leave_members','user_id'],assignments:['public.ihr_leave_approvers','id'],
 grants:['public.ihr_leave_access_grants','id'],policies:['public.ihr_leave_policies','id'],policy_owners:['private.ihr_leave_policy_owners','policy_id'],
 calendars:['public.ihr_leave_calendars','id'],exceptions:['public.ihr_leave_calendar_exceptions','id'],groups:['public.ihr_saturday_groups','id'],
 memberships:['public.ihr_saturday_memberships','id'],registry:['private.ihr_leave_calendar_registry','id'],
 governance_approvals:['private.ihr_leave_governance_approvals','id'],governance_references:['private.ihr_leave_governance_references','employee_id,kind,version'],
 manifests:['private.ihr_leave_access_manifests','id'],reassignments:['private.ihr_leave_request_reassignments','request_id,request_version'],
}
export const snapshotSqlFor = (rosterDaySql='NULL::date') => `SELECT jsonb_build_object(${Object.entries(stateTables).map(([name,[table,order]])=>`'${name}',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY ${order}),'[]') FROM ${table} t)`).join(',')},
'roster',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.ihr_saturday_roster t WHERE day=${rosterDaySql}),
'other_roster',(SELECT jsonb_build_object('count',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),''),'UTF8')),'hex')) FROM public.ihr_saturday_roster t WHERE day IS DISTINCT FROM ${rosterDaySql}))::text;`
export const snapshotSql=snapshotSqlFor('(SELECT saturday FROM ihr_final_race_fixture.settings)')
export const submissionExpectationSql = (actorSql,inputSql) => `SELECT jsonb_build_object('quote',q.value,'source',jsonb_build_object('quote',q.value,'member',to_jsonb(m),'policy',to_jsonb(p),'assignment',to_jsonb(a)), 'daySources',(SELECT jsonb_object_agg(d->>'date',private.ihr_leave_day_snapshot(m.user_id,(d->>'date')::date)) FROM jsonb_array_elements(q.value->'days') d))::text FROM public.ihr_leave_members m JOIN public.ihr_leave_policies p ON p.id=m.active_policy_id CROSS JOIN LATERAL(SELECT private.ihr_leave_quote_v1(m.user_id,${inputSql},clock_timestamp()) value) q JOIN public.ihr_leave_approvers a ON a.id=(q.value->'approver'->>'assignmentId')::uuid WHERE m.user_id=${actorSql};`
const equal = (actual, expected, label) => { if (!isDeepStrictEqual(actual,expected)) throw new Error(`Final race state mismatch: ${label}`) }
const demand = (condition,label) => { if (!condition) throw new Error(`Final race state mismatch: ${label}`) }
const omit = (row,keys) => Object.fromEntries(Object.entries(row).filter(([key])=>!keys.includes(key)))
const stamp = value => typeof value==='string' && Number.isFinite(Date.parse(value))
const uuid = value => typeof value==='string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value)
const key = (field,row) => field==='commands'?`${row.actor_id}:${row.request_id}`:field==='days'?`${row.request_id}:${row.day}`:field==='occupancy'?`${row.employee_id}:${row.day}`:field==='allocations'?`${row.request_id}:${row.account_id}`:row.id
function additions(before,after,field,count) {
 const prior=new Map(before[field].map(row=>[key(field,row),row])),current=new Map(after[field].map(row=>[key(field,row),row]))
 demand(prior.size===before[field].length && current.size===after[field].length && current.size===prior.size+count,`${field} cardinality`)
 for(const [id,row] of prior) equal(current.get(id),row,`${field} immutable history`)
 const added=after[field].filter(row=>!prior.has(key(field,row)))
 if(['requests','ledger'].includes(field)) for(const row of added) demand(Number.isSafeInteger(row.sequence)&&row.sequence>Math.max(0,...before[field].map(old=>old.sequence)),`${field} monotone sequence`)
 return added
}
function generated(row,keys) {
 for(const k of keys) demand(k==='sequence'?Number.isSafeInteger(row[k])&&row[k]>0:k==='id'?uuid(row[k]):stamp(row[k]),`generated ${k}`)
 return omit(row,keys)
}
function command(before,after,c,receipt) {
 const [row]=additions(before,after,'commands',1)
 demand(stamp(row.created_at),'command timestamp')
 equal(omit(row,['created_at']),{actor_id:c.actor,request_id:c.key,operation:c.operation,payload:c.payload,result:receipt,abandoned:false},'complete command envelope')
}
function admin(before,after,c,target,beforeData=null) {
 const [row]=additions(before,after,'admin_events',1)
 equal(generated(row,['id','created_at']),{actor_id:c.actor,operation:c.operation,target_user_id:target,command_request_id:null,before_data:beforeData,after_data:c.payload,reason:c.payload.reason},'complete administrative audit')
}
// This one-Saturday fixture requests Amber off / Blue duty. These literal facts are
// independent of both the live preview and the publication under test.
export function assertFinalRosterPreview(preview,saturday) {
 demand(typeof saturday==='string' && /^\d{4}-\d{2}-\d{2}$/.test(saturday),'fixture Saturday date')
 const day=new Date(saturday+'T00:00:00.000Z')
 demand(Number.isFinite(day.getTime()) && day.toISOString().slice(0,10)===saturday && day.getUTCDay()===6,'fixture Saturday')
 const expected=[
  {date:saturday,groupId:'79000000-0000-0000-0000-000000000021',capacityMinutes:0},
  {date:saturday,groupId:'79000000-0000-0000-0000-000000000022',capacityMinutes:225},
 ]
 demand(Array.isArray(preview?.rows) && preview.rows.length===2,'exact two-row roster preview')
 equal([...preview.rows].sort((a,b)=>String(a?.groupId).localeCompare(String(b?.groupId))),expected,'independent Amber0/Blue225 preview')
 return expected
}
export function assertFinalOutcome(before,after,c,receipt) {
 const changed=new Set(['commands'])
 if(c.operation==='abandon') {
  const [row]=additions(before,after,'commands',1)
  demand(stamp(row.created_at),'tombstone timestamp')
  equal(omit(row,['created_at']),{actor_id:c.actor,request_id:c.key,operation:null,payload:null,result:null,abandoned:true},'exact tombstone')
  equal(receipt,{state:'abandoned'},'abandon receipt')
 } else if(['approve_request','reject_request','withdraw_request','approve_cancellation'].includes(c.operation)) {
  demand(decisionOutcomeMatches(before,after,{request_id:c.payload.request_id,actor_a:c.actor,command_a:c.key,operation_a:c.operation,payload_a:c.payload,expected_status:{approve_request:'approved',reject_request:'rejected',withdraw_request:'withdrawn',approve_cancellation:'cancelled'}[c.operation]},receipt),'complete decision delta')
  for(const field of ['requests','days','allocations','occupancy','accounts','ledger','events','commands','attempts','decisions','reversals']) changed.add(field)
 } else if(c.operation==='submit_request') {
  for(const field of ['requests','days','allocations','occupancy','accounts','ledger','events']) changed.add(field)
  const q=c.quote,[request]=additions(before,after,'requests',1)
  demand(uuid(request.id),'request identity');equal(receipt,{id:request.id,version:1,operation:c.operation},'submit receipt')
  equal(generated(request,['sequence','submitted_at']),{id:request.id,employee_id:c.actor,status:'submitted',start_date:q.startDate,end_date:q.endDate,duration:q.duration,total_minutes:q.totalMinutes,reason:c.payload.input.reason,approver_id:q.approver.id,approver_name:q.approver.name,assignment_id:q.approver.assignmentId,assignment_version:q.approver.assignmentVersion,policy_id:q.policy.id,policy_version:q.policy.version,member_version:q.memberVersion,quote_fingerprint:q.fingerprint,source_snapshot:c.source,source_kind:'submission',source_id:request.id,created_by:c.actor,version:1},'complete immutable request')
  const addedDays=additions(before,after,'days',q.days.length)
  for(const d of q.days) equal(addedDays.find(row=>row.day===d.date),{request_id:request.id,day:d.date,scheduled_minutes:d.scheduledMinutes,charged_minutes:d.chargedMinutes,exclusion:d.exclusion??null,account_id:d.accountId??null,source_snapshot:c.daySources[d.date]},'complete immutable day')
  const occupied=q.days.filter(d=>d.chargedMinutes>0),newOccupancy=additions(before,after,'occupancy',occupied.length)
  for(const d of occupied) equal(newOccupancy.find(row=>row.day===d.date),{employee_id:c.actor,day:d.date,request_id:request.id},'complete occupancy')
  const allocations=additions(before,after,'allocations',q.allocations.length),ledger=additions(before,after,'ledger',q.allocations.length)
  const changes=new Map(q.allocations.map(a=>[a.accountId,a.chargedMinutes]))
  equal(after.accounts,before.accounts.map(a=>changes.has(a.id)?{...a,reserved_minutes:a.reserved_minutes+changes.get(a.id),version:a.version+1}:a),'all accounts after reservation')
  for(const a of q.allocations) {
   const original=before.accounts.find(row=>row.id===a.accountId);demand(original,'original account')
   equal(allocations.find(row=>row.account_id===a.accountId),{request_id:request.id,account_id:original.id,year:original.year,period_start:original.period_start,period_end:original.period_end,timezone:original.timezone,charged_minutes:a.chargedMinutes,account_version:original.version},'complete frozen allocation')
   const row=ledger.find(row=>row.account_id===a.accountId)
   equal(generated(row,['id','sequence','created_at']),{account_id:a.accountId,effective_date:original.period_start>q.startDate?original.period_start:q.startDate,kind:'reservation',allowance_delta:0,reserved_delta:a.chargedMinutes,used_delta:0,source_kind:'request',source_id:request.id,source_event:'submitted',actor_id:c.actor,reason:null},'exact reservation ledger')
   demand(Date.parse(row.created_at)>=Date.parse(request.submitted_at),'reservation timestamp')
  }
  const [event]=additions(before,after,'events',1)
  equal(generated(event,['id']),{request_id:request.id,actor_id:c.actor,event:'submitted',at_time:request.submitted_at,data:{}},'exact submit audit')
  demand(Date.parse(after.commands.find(row=>row.actor_id===c.actor&&row.request_id===c.key)?.created_at)<=Date.parse(event.at_time),'command precedes submit event')
  command(before,after,c,receipt)
 } else if(c.operation==='adjust_balance') {
  for(const field of ['accounts','ledger','admin_events']) changed.add(field)
  const original=before.accounts.find(a=>a.employee_id===c.payload.employee_id && a.year===c.payload.year);demand(original,'adjustment account')
  equal(original.version,c.payload.expected_version,'expected adjustment version')
  equal(after.accounts,before.accounts.map(a=>a.id===original.id?{...a,allowance_minutes:a.allowance_minutes+c.payload.delta_minutes,version:a.version+1}:a),'exact adjustment balance')
  const [row]=additions(before,after,'ledger',1)
  equal(generated(row,['id','sequence','created_at']),{account_id:original.id,effective_date:c.asOf,kind:'adjustment',allowance_delta:c.payload.delta_minutes,reserved_delta:0,used_delta:0,source_kind:'adjustment',source_id:c.payload.source_id,source_event:'allowance',actor_id:c.actor,reason:c.payload.reason},'exact adjustment ledger')
  equal(receipt,{id:original.id,version:original.version+1,operation:c.operation},'adjustment receipt');command(before,after,c,receipt);admin(before,after,c,c.payload.employee_id)
 } else if(c.operation==='save_calendar_version') {
  for(const field of ['registry','calendars','exceptions','admin_events']) changed.add(field)
  equal(after.registry,before.registry.map(row=>row.id===c.payload.calendar_id?{...row,version:row.version+1}:row),'calendar registry')
  const [calendar]=additions(before,after,'calendars',1)
  equal(generated(calendar,['id','created_at']),{calendar_id:c.payload.calendar_id,version:c.payload.expected_version+1,name:c.payload.name,effective_from:c.payload.effective_from,effective_until:c.payload.effective_until,timezone:c.payload.timezone,holidays_confirmed:c.payload.holidays_confirmed,sunday_minutes:c.payload.sunday_minutes,created_by:c.actor},'complete calendar successor')
  const exceptions=additions(before,after,'exceptions',c.payload.holidays.length)
  for(const day of c.payload.holidays) equal(generated(exceptions.find(row=>row.day===day),['id']),{calendar_version_id:calendar.id,day,kind:'holiday'},'exact holiday')
  equal(c.payload.groups,[],'calendar scenario preserves groups');equal(receipt,{id:c.payload.calendar_id,version:c.payload.expected_version+1,operation:c.operation},'calendar receipt');command(before,after,c,receipt);admin(before,after,c,null)
 } else if(c.operation==='publish_roster') {
  for(const field of ['registry','roster','admin_events']) changed.add(field)
  equal(after.registry,before.registry.map(row=>row.id===c.payload.calendar_id?{...row,version:row.version+1}:row),'roster registry')
  const expected=assertFinalRosterPreview(c.preview,c.rosterSaturday)
  equal(c.payload.calendar_id,'73000000-0000-0000-0000-000000000090','fixture calendar identity')
  equal(c.calendarVersion,'73000000-0000-0000-0000-000000000091','fixture calendar source version')
  equal(c.payload.expected_version,1,'fixture registry source version')
  equal(before.registry.find(row=>row.id===c.payload.calendar_id)?.version,1,'original fixture registry version')
  demand(before.calendars.some(row=>row.id===c.calendarVersion && row.calendar_id===c.payload.calendar_id && row.version===1),'original fixture calendar source')
  equal(c.payload.groups,[{id:'79000000-0000-0000-0000-000000000021',on_anchor:false},{id:'79000000-0000-0000-0000-000000000022',on_anchor:true}],'fixture duty/off input')
  equal(c.payload.anchor,c.rosterSaturday,'fixture roster anchor')
  equal(c.payload.effective_from,c.rosterSaturday,'fixture publication start')
  const end=new Date(c.rosterSaturday+'T00:00:00.000Z');end.setUTCDate(end.getUTCDate()+1)
  equal(c.payload.effective_until,end.toISOString().slice(0,10),'fixture one-Saturday publication range')
  const added=additions(before,after,'roster',2)
  for(const d of expected) {
   const row=added.find(row=>row.day===d.date&&row.group_id===d.groupId)
   equal(generated(row,['id','published_at']),{calendar_version_id:'73000000-0000-0000-0000-000000000091',group_id:d.groupId,version:2,day:d.date,capacity_minutes:d.capacityMinutes,anchor:c.rosterSaturday,on_anchor:d.capacityMinutes===225,effective_from:c.rosterSaturday,effective_until:end.toISOString().slice(0,10),published_by:c.actor},'complete independent roster successor')
  }
  equal(receipt,{id:c.payload.calendar_id,version:c.payload.expected_version+1,operation:c.operation},'roster receipt');command(before,after,c,receipt);admin(before,after,c,null)
 } else throw new Error('Unsupported exact race outcome')
 for(const field of Object.keys(before)) if(!changed.has(field)) equal(after[field],before[field],`${field} unchanged`)
 equal(Object.keys(after).sort(),Object.keys(before).sort(),'snapshot shape')
 return true
}
