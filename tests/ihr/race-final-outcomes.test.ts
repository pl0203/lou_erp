import {expect,test} from 'vitest'
import {assertFinalOutcome,assertFinalRosterPreview,stateTables} from '../database/ihr/race-final-state.mjs'
const id=(n:number)=>'87000000-0000-0000-0000-'+String(n).padStart(12,'0')
const stamp='2026-10-03T05:00:00.000Z',date='2026-10-09'
const blank=()=>({...Object.fromEntries(Object.keys(stateTables).map(key=>[key,[]])),roster:[],other_roster:{count:2,sha256:'fixed'}}) as any
function submit(){
 const before=blank(),account={id:id(2),employee_id:id(1),year:2026,period_start:'2026-01-01',period_end:'2027-01-01',timezone:'Pacific/Kiritimati',reserved_minutes:0,used_minutes:0,allowance_minutes:5400,version:4,policy_id:id(3)}
 before.accounts=[account];before.members=[{user_id:id(1),version:2}];before.policies=[{id:id(3),version:2}];before.assignments=[{id:id(4),version:1}]
 const quote={startDate:date,endDate:date,duration:{mode:'full_scheduled_day'},totalMinutes:450,approver:{id:id(5),name:'Fictional manager',assignmentId:id(4),assignmentVersion:1},policy:{id:id(3),version:2},memberVersion:2,fingerprint:'a'.repeat(64),days:[{date,scheduledMinutes:450,chargedMinutes:450,accountId:account.id,exclusion:null}],allocations:[{accountId:account.id,chargedMinutes:450}]}
 const source={quote,member:before.members[0],policy:before.policies[0],assignment:before.assignments[0]},daySources={[date]:{calendar:{version:1},membership:null,roster:null}}
 const c={actor:id(1),key:id(6),operation:'submit_request',payload:{input:{start_date:date,end_date:date,duration:quote.duration,reason:'Fictional reason'},quote_fingerprint:quote.fingerprint},quote,source,daySources}
 const receipt={id:id(7),version:1,operation:c.operation},after=structuredClone(before)
 after.requests=[{id:id(7),sequence:1,employee_id:id(1),status:'submitted',start_date:date,end_date:date,duration:quote.duration,total_minutes:450,reason:c.payload.input.reason,approver_id:id(5),approver_name:'Fictional manager',assignment_id:id(4),assignment_version:1,policy_id:id(3),policy_version:2,member_version:2,quote_fingerprint:quote.fingerprint,source_snapshot:source,source_kind:'submission',source_id:id(7),submitted_at:stamp,created_by:id(1),version:1}]
 after.days=[{request_id:id(7),day:date,scheduled_minutes:450,charged_minutes:450,exclusion:null,account_id:account.id,source_snapshot:daySources[date]}]
 after.allocations=[{request_id:id(7),account_id:account.id,year:2026,period_start:account.period_start,period_end:account.period_end,timezone:account.timezone,charged_minutes:450,account_version:4}]
 after.occupancy=[{employee_id:id(1),day:date,request_id:id(7)}]
 after.accounts[0].reserved_minutes=450;after.accounts[0].version=5
 after.ledger=[{id:id(8),sequence:1,account_id:account.id,effective_date:date,kind:'reservation',allowance_delta:0,reserved_delta:450,used_delta:0,source_kind:'request',source_id:id(7),source_event:'submitted',actor_id:id(1),reason:null,created_at:stamp}]
 after.events=[{id:id(9),request_id:id(7),actor_id:id(1),event:'submitted',at_time:stamp,data:{}}]
 after.commands=[{actor_id:id(1),request_id:id(6),operation:c.operation,payload:c.payload,result:receipt,abandoned:false,created_at:stamp}]
 return {before,after,c,receipt}
}
test('accepts an exact full-state submission including all frozen source rows',()=>{const s=submit();expect(assertFinalOutcome(s.before,s.after,s.c,s.receipt)).toBe(true)})
test.each(['request-source','day-source','allocation-period','duplicate-ledger','compensating-ledger','wrong-provenance','account-version','unrelated-account','duplicate-audit','loser-command','tombstone','mutated-policy','mutated-governance','roster-history','unexpected-refund','sequence','command-time','hidden-field'] as const)('rejects otherwise plausible outcome with %s corruption',defect=>{
 const s=submit();s.after=structuredClone(s.after)
 if(defect==='request-source')s.after.requests[0].source_snapshot.policy.version=99
 if(defect==='day-source')s.after.days[0].source_snapshot.calendar.version=99
 if(defect==='allocation-period')s.after.allocations[0].period_end='2028-01-01'
 if(defect==='duplicate-ledger')s.after.ledger.push({...s.after.ledger[0],id:id(80),sequence:2})
 if(defect==='compensating-ledger')s.after.ledger.push({...s.after.ledger[0],id:id(80),sequence:2,reserved_delta:-450},{...s.after.ledger[0],id:id(81),sequence:3})
 if(defect==='wrong-provenance')s.after.ledger[0].source_id=id(80)
 if(defect==='account-version')s.after.accounts[0].version++
 if(defect==='unrelated-account')s.after.accounts.push({...s.after.accounts[0],id:id(80)})
 if(defect==='duplicate-audit')s.after.events.push({...s.after.events[0],id:id(80)})
 if(defect==='loser-command')s.after.commands.push({...s.after.commands[0],request_id:id(80)})
 if(defect==='tombstone')s.after.commands[0].abandoned=true
 if(defect==='mutated-policy')s.after.policies[0].version++
 if(defect==='mutated-governance')s.after.governance_approvals.push({id:id(80)})
 if(defect==='roster-history')s.after.other_roster.sha256='rewritten'
 if(defect==='unexpected-refund')s.after.reversals.push({id:id(80)})
 if(defect==='sequence')s.after.ledger[0].sequence=0
 if(defect==='command-time')s.after.commands[0].created_at='2026-10-04T05:00:00.000Z'
 if(defect==='hidden-field')s.after.requests[0].surprise=true
 expect(()=>assertFinalOutcome(s.before,s.after,s.c,s.receipt)).toThrow()
})
function tombstone(){const before=blank(),after=structuredClone(before),c={actor:id(1),key:id(2),operation:'abandon'},receipt={state:'abandoned'};after.commands=[{actor_id:c.actor,request_id:c.key,operation:null,payload:null,result:null,abandoned:true,created_at:stamp}];return {before,after,c,receipt}}
test('accepts exactly one empty-payload tombstone',()=>{const s=tombstone();expect(assertFinalOutcome(s.before,s.after,s.c,s.receipt)).toBe(true)})
test.each(['payload','result','abandoned','account','extra-command'])('rejects corrupt tombstone %s',field=>{const s=tombstone();if(field==='account')s.after.accounts.push({id:id(4)});else if(field==='extra-command')s.after.commands.push({...s.after.commands[0],request_id:id(4)});else s.after.commands[0][field]=field==='abandoned'?false:{};expect(()=>assertFinalOutcome(s.before,s.after,s.c,s.receipt)).toThrow()})
function adjust(){
 const before=blank(),c={actor:id(10),key:id(11),operation:'adjust_balance',asOf:'2026-10-03',payload:{employee_id:id(1),year:2026,delta_minutes:-4950,source_id:id(12),expected_version:4,reason:'Fictional adjustment'}},receipt={id:id(2),version:5,operation:'adjust_balance'}
 before.accounts=[{id:id(2),employee_id:id(1),year:2026,allowance_minutes:5400,reserved_minutes:0,used_minutes:0,version:4}]
 const after=structuredClone(before);after.accounts[0].allowance_minutes=450;after.accounts[0].version=5
 after.ledger=[{id:id(13),sequence:1,account_id:id(2),effective_date:c.asOf,kind:'adjustment',allowance_delta:-4950,reserved_delta:0,used_delta:0,source_kind:'adjustment',source_id:id(12),source_event:'allowance',actor_id:id(10),reason:c.payload.reason,created_at:stamp}]
 after.admin_events=[{id:id(14),actor_id:id(10),operation:c.operation,target_user_id:id(1),command_request_id:null,before_data:null,after_data:c.payload,reason:c.payload.reason,created_at:stamp}]
 after.commands=[{actor_id:c.actor,request_id:c.key,operation:c.operation,payload:c.payload,result:receipt,abandoned:false,created_at:stamp}]
 return {before,after,c,receipt}
}
test('accepts exact adjustment provenance and audit without changing the annual grant',()=>{const s=adjust();expect(assertFinalOutcome(s.before,s.after,s.c,s.receipt)).toBe(true)})
test.each(['ledger','audit','balance','source','receipt'])('rejects corrupt adjustment %s',field=>{const s=adjust();if(field==='ledger')s.after.ledger[0].kind='annual_grant';if(field==='audit')s.after.admin_events[0].target_user_id=id(99);if(field==='balance')s.after.accounts[0].reserved_minutes=450;if(field==='source')s.after.ledger[0].source_id=id(99);if(field==='receipt')s.receipt.version=99;expect(()=>assertFinalOutcome(s.before,s.after,s.c,s.receipt)).toThrow()})
function calendar(){
 const before=blank(),c={actor:id(9),key:id(20),operation:'save_calendar_version',payload:{calendar_id:id(30),expected_version:1,name:'Fictional revised calendar',effective_from:date,effective_until:'2026-10-10',timezone:'Pacific/Kiritimati',holidays_confirmed:true,sunday_minutes:0,holidays:[],groups:[],reason:'Fictional calendar race'}},receipt={id:id(30),version:2,operation:'save_calendar_version'}
 before.registry=[{id:id(30),version:1}];before.calendars=[{id:id(31),calendar_id:id(30),version:1,name:'Original immutable source'}]
 const after=structuredClone(before);after.registry[0].version=2
 after.calendars.push({id:id(32),calendar_id:id(30),version:2,name:c.payload.name,effective_from:date,effective_until:'2026-10-10',timezone:'Pacific/Kiritimati',holidays_confirmed:true,sunday_minutes:0,created_by:c.actor,created_at:stamp})
 after.admin_events=[{id:id(33),actor_id:c.actor,operation:c.operation,target_user_id:null,command_request_id:null,before_data:null,after_data:c.payload,reason:c.payload.reason,created_at:stamp}]
 after.commands=[{actor_id:c.actor,request_id:c.key,operation:c.operation,payload:c.payload,result:receipt,abandoned:false,created_at:stamp}]
 return {before,after,c,receipt}
}
test('accepts a calendar successor while preserving every prior calendar',()=>{const s=calendar();expect(assertFinalOutcome(s.before,s.after,s.c,s.receipt)).toBe(true)})
test.each(['old-calendar','registry','reason','extra-holiday','request'])('rejects corrupt calendar outcome %s',field=>{
 const s=calendar();if(field==='old-calendar')s.after.calendars[0].name='changed';if(field==='registry')s.after.registry[0].version=3;if(field==='reason')s.after.admin_events[0].reason='changed';if(field==='extra-holiday')s.after.exceptions.push({id:id(35),day:date});if(field==='request')s.after.requests.push({id:id(7)})
 expect(()=>assertFinalOutcome(s.before,s.after,s.c,s.receipt)).toThrow()
})
const rosterCalendar='73000000-0000-0000-0000-000000000090',rosterVersion='73000000-0000-0000-0000-000000000091'
const amber='79000000-0000-0000-0000-000000000021',blue='79000000-0000-0000-0000-000000000022'
function roster(ordering='roster_then_submit'){
 const before=ordering==='submit_then_roster'?structuredClone(submit().after):blank()
 before.registry=[{id:rosterCalendar,version:1}]
 before.calendars=[{id:rosterVersion,calendar_id:rosterCalendar,version:1,name:'Original immutable source'}]
 const c:any={actor:id(9),key:id(20),operation:'publish_roster',rosterSaturday:'2026-10-10',calendarVersion:rosterVersion,payload:{calendar_id:rosterCalendar,expected_version:1,anchor:'2026-10-10',effective_from:'2026-10-10',effective_until:'2026-10-11',groups:[{id:amber,on_anchor:false},{id:blue,on_anchor:true}],preview_fingerprint:'fingerprint',reason:'Fictional roster'},preview:{rows:[{date:'2026-10-10',groupId:amber,capacityMinutes:0},{date:'2026-10-10',groupId:blue,capacityMinutes:225}]}}
 before.roster=[{id:id(50),calendar_version_id:rosterVersion,group_id:amber,day:'2026-10-10',capacity_minutes:225,version:1},{id:id(53),calendar_version_id:rosterVersion,group_id:blue,day:'2026-10-10',capacity_minutes:0,version:1}]
 if(ordering==='submit_then_roster') {
  const request=before.requests[0]
  request.end_date='2026-10-10';request.total_minutes=675
  request.source_snapshot.quote.endDate='2026-10-10';request.source_snapshot.quote.totalMinutes=675
  const day={...before.days[0],day:'2026-10-10',scheduled_minutes:225,charged_minutes:225,source_snapshot:{roster:structuredClone(before.roster[0])}}
  before.days.push(day);before.occupancy.push({...before.occupancy[0],day:'2026-10-10'})
  request.source_snapshot.quote.days.push({date:'2026-10-10',scheduledMinutes:225,chargedMinutes:225,accountId:before.accounts[0].id,exclusion:null})
  request.source_snapshot.quote.allocations[0].chargedMinutes=675
  before.allocations[0].charged_minutes=675;before.accounts[0].reserved_minutes=675;before.ledger[0].reserved_delta=675
 }
 const after=structuredClone(before),receipt={id:rosterCalendar,version:2,operation:'publish_roster'};after.registry[0].version=2
 // Publication data is literal test input, never copied from the preview being tested.
 after.roster.push(
  {id:id(51),calendar_version_id:rosterVersion,group_id:amber,version:2,day:'2026-10-10',capacity_minutes:0,anchor:'2026-10-10',on_anchor:false,effective_from:'2026-10-10',effective_until:'2026-10-11',published_by:c.actor,published_at:stamp},
  {id:id(52),calendar_version_id:rosterVersion,group_id:blue,version:2,day:'2026-10-10',capacity_minutes:225,anchor:'2026-10-10',on_anchor:true,effective_from:'2026-10-10',effective_until:'2026-10-11',published_by:c.actor,published_at:stamp})
 after.admin_events=[{id:id(33),actor_id:c.actor,operation:c.operation,target_user_id:null,command_request_id:null,before_data:null,after_data:c.payload,reason:c.payload.reason,created_at:stamp}]
 after.commands.push({actor_id:c.actor,request_id:c.key,operation:c.operation,payload:c.payload,result:receipt,abandoned:false,created_at:stamp})
 return {before,after,c,receipt}
}
test.each(['roster_then_submit','submit_then_roster'])('accepts the independent two-row roster oracle in %s with full prior history preserved',ordering=>{const s=roster(ordering);expect(s.before.requests).toHaveLength(ordering==='submit_then_roster'?1:0);expect(assertFinalOutcome(s.before,s.after,s.c,s.receipt)).toBe(true)})
test.each(['old-roster','wrong-capacity','wrong-calendar','duplicate-row','unrelated-roster'])('rejects corrupt roster %s',field=>{const s=roster();if(field==='old-roster')s.after.roster[0].capacity_minutes=0;if(field==='wrong-capacity')s.after.roster[2].capacity_minutes=225;if(field==='wrong-calendar')s.after.roster[2].calendar_version_id=id(99);if(field==='duplicate-row')s.after.roster.push({...s.after.roster[2],id:id(99)});if(field==='unrelated-roster')s.after.other_roster.count++;expect(()=>assertFinalOutcome(s.before,s.after,s.c,s.receipt)).toThrow()})
test.each(['wrong-capacities','zero-rows','one-row','extra-row','duplicate-group','wrong-date'])('rejects agreeing wrong preview and publication: %s',defect=>{
 const s=roster(),preview=s.c.preview.rows,rows=s.after.roster
 if(defect==='wrong-capacities'){preview[0].capacityMinutes=225;preview[1].capacityMinutes=0;rows[2].capacity_minutes=225;rows[3].capacity_minutes=0}
 if(defect==='zero-rows'){preview.length=0;rows.splice(2)}
 if(defect==='one-row'){preview.pop();rows.pop()}
 if(defect==='extra-row'){preview.push({...preview[1],date:'2026-10-17'});rows.push({...rows[3],id:id(54),day:'2026-10-17'})}
 if(defect==='duplicate-group'){preview[1]={...preview[0]};rows[3]={...rows[2],id:id(52)}}
 if(defect==='wrong-date'){for(const row of preview)row.date='2026-10-17';rows[2].day='2026-10-17';rows[3].day='2026-10-17'}
 expect(()=>assertFinalOutcome(s.before,s.after,s.c,s.receipt)).toThrow()
})
test.each(['preview-only','publication-only'])('rejects a duty/off error in %s',side=>{
 const s=roster();if(side==='preview-only'){s.c.preview.rows[0].capacityMinutes=225;s.c.preview.rows[1].capacityMinutes=0}else{s.after.roster[2].capacity_minutes=225;s.after.roster[3].capacity_minutes=0}
 expect(()=>assertFinalOutcome(s.before,s.after,s.c,s.receipt)).toThrow()
})
test.each(['request','day','allocation','reservation','event','command','admin-audit'])('roster publication preserves pre-existing submit-first %s history',field=>{
 const s=roster('submit_then_roster')
 if(field==='request')s.after.requests[0].source_snapshot.quote.totalMinutes=450
 if(field==='day')s.after.days[1].source_snapshot.roster.capacity_minutes=0
 if(field==='allocation')s.after.allocations[0].charged_minutes=450
 if(field==='reservation')s.after.ledger[0].reserved_delta=450
 if(field==='event')s.after.events[0].event='cancelled'
 if(field==='command')s.after.commands[0].abandoned=true
 if(field==='admin-audit')s.after.admin_events[0].after_data={}
 expect(()=>assertFinalOutcome(s.before,s.after,s.c,s.receipt)).toThrow()
})
test('preview verification returns independent literal rows before fingerprint consumption',()=>{
 const s=roster(),expected=[{date:'2026-10-10',groupId:amber,capacityMinutes:0},{date:'2026-10-10',groupId:blue,capacityMinutes:225}]
 const oracle=assertFinalRosterPreview(s.c.preview,s.c.rosterSaturday)
 expect(oracle).toEqual(expected);expect(oracle).not.toBe(s.c.preview.rows)
 s.c.preview.rows[0].capacityMinutes=225;expect(oracle).toEqual(expected)
 expect(()=>assertFinalRosterPreview(s.c.preview,s.c.rosterSaturday)).toThrow()
})
test.each(['zero-rows','one-row','extra-row','duplicate-group','wrong-date'])('rejects wrong preview only: %s',defect=>{
 const s=roster(),rows=s.c.preview.rows
 if(defect==='zero-rows')rows.length=0
 if(defect==='one-row')rows.pop()
 if(defect==='extra-row')rows.push({...rows[1],date:'2026-10-17'})
 if(defect==='duplicate-group')rows[1]={...rows[0]}
 if(defect==='wrong-date')rows[0].date='2026-10-17'
 expect(()=>assertFinalRosterPreview(s.c.preview,s.c.rosterSaturday)).toThrow()
 expect(()=>assertFinalOutcome(s.before,s.after,s.c,s.receipt)).toThrow()
})
test.each(['zero-rows','one-row','extra-row','duplicate-group','wrong-date'])('rejects wrong publication against a correct preview: %s',defect=>{
 const s=roster(),rows=s.after.roster
 if(defect==='zero-rows')rows.splice(2)
 if(defect==='one-row')rows.pop()
 if(defect==='extra-row')rows.push({...rows[3],id:id(54),day:'2026-10-17'})
 if(defect==='duplicate-group')rows[3]={...rows[2],id:id(52)}
 if(defect==='wrong-date')rows[2].day='2026-10-17'
 expect(()=>assertFinalRosterPreview(s.c.preview,s.c.rosterSaturday)).not.toThrow()
 expect(()=>assertFinalOutcome(s.before,s.after,s.c,s.receipt)).toThrow()
})
test.each(['calendar','calendar-version','registry-version','groups','anchor','effective-start','effective-end'])('rejects a changed fixed fixture input: %s',field=>{
 const s=roster()
 if(field==='calendar')s.c.payload.calendar_id=id(99)
 if(field==='calendar-version')s.c.calendarVersion=id(99)
 if(field==='registry-version')s.c.payload.expected_version=2
 if(field==='groups'){s.c.payload.groups[0].on_anchor=true;s.c.payload.groups[1].on_anchor=false}
 if(field==='anchor')s.c.payload.anchor='2026-10-03'
 if(field==='effective-start')s.c.payload.effective_from='2026-10-09'
 if(field==='effective-end')s.c.payload.effective_until='2026-10-18'
 expect(()=>assertFinalOutcome(s.before,s.after,s.c,s.receipt)).toThrow()
})
