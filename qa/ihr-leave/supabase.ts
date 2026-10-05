import { manager } from './auth'
const a='71000000-0000-0000-0000-000000000001',b='71000000-0000-0000-0000-000000000002',m='71000000-0000-0000-0000-000000000003';
const rid='82000000-0000-0000-0000-000000000001',rid2='82000000-0000-0000-0000-000000000002';
const scope='visual-fixture-scope';
const balance={accountId:b,year:2026,allowanceMinutes:5400,approvedMinutes:900,pendingMinutes:450,availableMinutes:4050,expiredMinutes:0,version:2,reconciled:true};
const period={year:2026,startDate:'2026-01-01',endDate:'2027-01-01'};
const context={scopeVersion:scope,memberKind:manager?'manager':'employee',capabilities:{request:true,approve:manager,configure:false,adjust:false,readPrivate:false,manageAccess:false},setup:{ready:true,blockers:[]},balances:[balance],timezone:'Etc/UTC',currentPeriod:period};
const own={id:rid,sequence:2,startDate:'2026-10-09',endDate:'2026-10-09',duration:{mode:'full_scheduled_day'},totalMinutes:450,status:'submitted',version:1,submittedAt:'2026-10-03T00:00:00Z',sourceKind:'submission'};
const summary={...own,employee:{id:a,name:'Fictional Employee'},cancellationAttemptId:null,cancellationRequestedAt:null};
const detail={...summary,reason:'Synthetic private reason for visual QA.',approverName:'Fictional Manager',days:[{date:'2026-10-09',scheduledMinutes:450,chargedMinutes:450,exclusion:null,groupName:null}],allocations:[{...period,chargedMinutes:450}],cancellation:null,balanceContext:{basis:'current',asOf:'2026-10-05T02:00:00Z',periods:[{year:2026,reservedMinutes:450,usedMinutes:900,availableMinutes:4050,expiredMinutes:0,reconciled:true}]}};
function quote(input:any){const days:any[]=[];const start=new Date(input.start_date+'T12:00:00Z'),end=new Date(input.end_date+'T12:00:00Z');for(let d=start;d<=end;d.setUTCDate(d.getUTCDate()+1)){const date=d.toISOString().slice(0,10),scheduledMinutes=d.getUTCDay()===0?0:d.getUTCDay()===6?225:450;days.push({date,scheduledMinutes,chargedMinutes:scheduledMinutes===0?0:input.duration.mode==='full_scheduled_day'?scheduledMinutes:input.duration.minutes,exclusion:scheduledMinutes===0?'off_duty':null,year:scheduledMinutes?2026:null,accountId:scheduledMinutes?b:null,sources:{calendarId:b,calendarVersion:1,rosterId:null,rosterVersion:null,membershipId:null,membershipVersion:null,groupId:null,groupVersion:null,groupName:null}})}const totalMinutes=days.reduce((s,d)=>s+d.chargedMinutes,0);return {fingerprint:'a'.repeat(64),startDate:input.start_date,endDate:input.end_date,today:'2026-10-05',duration:input.duration,totalMinutes,days,allocations:[{accountId:b,year:2026,version:2,chargedMinutes:totalMinutes,availableBefore:4050,availableAfter:4050-totalMinutes}],approver:{id:m,name:'Fictional Manager',assignmentId:b,assignmentVersion:1},policy:{id:b,version:1},memberVersion:1,scopeVersion:scope};}
function response(name:string,args:any={}){
 if(name==='leave_context_v1')return context;
 if(name==='leave_reads_context_v1')return {scopeVersion:scope,calendarAudiences:manager?['own','assigned_team']:['own'],defaultRange:{from:'2026-10-01',to:'2026-10-31'},defaultRangeState:'ready'};
 if(name==='leave_calendar_v1')return [{employeeId:a,employeeName:'Fictional Employee',date:'2026-10-09',approvedMinutes:450,availabilityLabel:'full_scheduled_absence'},{employeeId:b,employeeName:'Fictional Teammate',date:'2026-10-10',approvedMinutes:120,availabilityLabel:'partial_absence'}].filter(r=>r.date>=args.p_from&&r.date<=args.p_to);
 if(name==='leave_approval_counts_v1')return {pendingLeave:1,pendingCancellation:0};
 if(name==='leave_assigned_inbox_v1')return {rows:[summary],nextBefore:null};
 if(name==='leave_assigned_request_v1')return detail;
 if(name==='leave_own_history_v1')return {rows:[own,{...own,id:rid2,sequence:1,startDate:'2026-09-15',endDate:'2026-09-16',totalMinutes:900,status:'approved',version:2,submittedAt:'2026-09-10T00:00:00Z'}],nextBefore:null};
 if(name==='leave_own_request_v1'){const {employee,cancellationAttemptId,cancellationRequestedAt,cancellation,balanceContext,...r}=detail;return r;}
 if(name==='leave_own_request_history_v1')return {requestId:args.p_request_id,requestVersion:1,scopeVersion:scope,rows:[],nextBefore:null};
 if(name==='leave_request_transition_state_v1')return {id:rid,version:1,status:'submitted',canWithdraw:true,canRequestCancellation:false,cancellationBlocker:null,activeAttemptId:null};
 if(name==='leave_balance_accounts_v1')return {currentPeriod:period,balances:[balance]};
 if(name==='leave_balance_history_v1')return {balance,rows:[{id:a,sequence:1,date:'2026-10-01',kind:'annual_grant',allowanceDelta:5400,reservedDelta:0,usedDelta:0}],nextBefore:null};
 if(name==='leave_quote_v1')return quote(args.p_input);
 if(name==='leave_admin_targets_v1')return {rows:[],total:0,page:1,pageSize:25};
 throw new Error('Unimplemented synthetic-only RPC '+name)
}
export const supabase={rpc(name:string,args:any){let promise:Promise<any>;if(name==='leave_transaction_v1')promise=Promise.resolve({data:null,error:{code:'42501',message:'Synthetic fixture does not perform mutations'}});else {try{promise=Promise.resolve({data:response(name,args),error:null})}catch(e){console.error(e);promise=Promise.resolve({data:null,error:{code:'55000'}})}}return Object.assign(promise,{abortSignal:(signal:AbortSignal)=>{signal.throwIfAborted();return promise}})}};
