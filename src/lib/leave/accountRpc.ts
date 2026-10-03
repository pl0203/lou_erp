import { supabase } from '../supabase'
import { parseDateKey, parseDurationSelection, parseUUID } from './contracts'
import type { AnnualPeriod, Balance, LeaveResult } from './contracts'
import type { BalanceAccounts, BalanceCommand, BalanceEntryKind, BalanceHistory } from './accountContracts'
import { formatLeaveMinutes } from './formatMinutes'
import { leaveErrorMessage } from './rpc'
export function invalidAccount():never { throw new Error('Respons saldo cuti tidak valid. Muat ulang sebelum melanjutkan.') }
export function accountObject(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))invalidAccount();return v as Record<string,unknown>}
function text(v:unknown):string{if(typeof v!=='string')invalidAccount();return v}
function list(v:unknown):unknown[]{if(!Array.isArray(v))invalidAccount();return v}
export function accountInteger(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER):number{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)invalidAccount();return v}
export function parseCurrentPeriod(value:unknown):AnnualPeriod|null{
 if(value===null)return null;const v=accountObject(value),year=accountInteger(v.year,1,9998),startDate=parseDateKey(v.startDate),endDate=parseDateKey(v.endDate)
 if(startDate!==`${String(year).padStart(4,'0')}-01-01`||endDate!==`${String(year+1).padStart(4,'0')}-01-01`)invalidAccount()
 return {year,startDate,endDate}
}
export function parseAccountBalance(value:unknown):Balance{
 const v=accountObject(value),accountId=parseUUID(v.accountId),year=accountInteger(v.year,1,9998),allowanceMinutes=accountInteger(v.allowanceMinutes,0,2147483647),version=accountInteger(v.version,1)
 if(v.reconciled!==undefined&&typeof v.reconciled!=='boolean')invalidAccount()
 const reconciled=v.reconciled===true
 const bucket=(key:string)=>{const value=v[key];if(value!==null)accountInteger(value,0,2147483647);if(reconciled&&value===null)invalidAccount();return reconciled?value as number:null}
 const approvedMinutes=bucket('approvedMinutes'),pendingMinutes=bucket('pendingMinutes'),availableMinutes=bucket('availableMinutes'),expiredMinutes=bucket('expiredMinutes')
 if(reconciled&&(approvedMinutes!+pendingMinutes!+availableMinutes!+expiredMinutes!==allowanceMinutes||(availableMinutes!>0&&expiredMinutes!>0)))invalidAccount()
 return {accountId,year,allowanceMinutes,approvedMinutes,pendingMinutes,availableMinutes,expiredMinutes,version,reconciled}
}
export function parseAccountBalances(value:unknown):Balance[]{
 const balances=list(value).map(parseAccountBalance)
 if(new Set(balances.map(b=>b.year)).size!==balances.length||new Set(balances.map(b=>b.accountId)).size!==balances.length)invalidAccount()
 return balances
}
export function formatSignedLeaveMinutes(minutes:number):string{
 accountInteger(minutes,-2147483648,2147483647)
 return `${minutes<0?'−':minutes>0?'+':''}${formatLeaveMinutes(Math.abs(minutes))}`
}
export async function fetchBalanceHistory(accountId:string,before:number|null,limit:number,signal:AbortSignal):Promise<BalanceHistory>{
 parseUUID(accountId);if(before!==null)accountInteger(before,1);accountInteger(limit,1,100)
 const {data,error}=await supabase.rpc('leave_balance_history_v1',{p_account_id:accountId,p_before:before,p_limit:limit}).abortSignal(signal);signal.throwIfAborted()
 if(error)throw new Error(leaveErrorMessage(error));const v=accountObject(data),balance=parseAccountBalance(v.balance)
 if(balance.accountId!==accountId)invalidAccount()
 let previous=before??Infinity
 const rows=list(v.rows).map(value=>{const r=accountObject(value),sequence=accountInteger(r.sequence,1),date=parseDateKey(r.date)
  if(sequence>=previous||Number(date.slice(0,4))!==balance.year||!['annual_grant','opening','adjustment','reservation','approval','rejection','withdrawal','cancellation'].includes(r.kind as string))invalidAccount();previous=sequence
  return {id:parseUUID(r.id),sequence,date,kind:r.kind as BalanceEntryKind,allowanceDelta:accountInteger(r.allowanceDelta,-2147483648,2147483647),reservedDelta:accountInteger(r.reservedDelta,-2147483648,2147483647),usedDelta:accountInteger(r.usedDelta,-2147483648,2147483647)}
 })
 const nextBefore=v.nextBefore===null?null:accountInteger(v.nextBefore,1)
 if(rows.length>limit||(nextBefore!==null&&(!rows.length||nextBefore!==rows.at(-1)?.sequence)))invalidAccount()
 return {balance,rows,nextBefore}
}
export async function fetchBalanceAccounts(employeeId:string,signal:AbortSignal):Promise<BalanceAccounts>{
 const {data,error}=await supabase.rpc('leave_balance_accounts_v1',{p_employee_id:parseUUID(employeeId)}).abortSignal(signal);signal.throwIfAborted()
 if(error)throw new Error(leaveErrorMessage(error));const v=accountObject(data)
 return {currentPeriod:parseCurrentPeriod(v.currentPeriod),balances:parseAccountBalances(v.balances)}
}
export function toBalancePayload(c:BalanceCommand):Record<string,unknown>{
 const base={employee_id:parseUUID(c.employeeId),year:accountInteger(c.year,1,9998),source_id:parseUUID(c.sourceId),expected_version:accountInteger(c.expectedVersion),reason:text(c.reason)}
 if(!base.reason.trim()||base.reason.length>1000)invalidAccount()
 if(c.operation==='adjust_balance'){
  const delta_minutes=accountInteger(c.deltaMinutes,-2147483648,2147483647);if(!delta_minutes)invalidAccount();return {...base,delta_minutes}
 }
 if(c.operation!=='reconcile_opening'||c.allowanceMinutes!==5400||!Array.isArray(c.futureApproved)||c.futureApproved.length>100)invalidAccount()
 const as_of=parseDateKey(c.asOf);if(Number(as_of.slice(0,4))!==c.year)invalidAccount()
 const ids=new Set<string>()
 const future_approved=c.futureApproved.map(line=>{
  const source_id=parseUUID(line.sourceId),start_date=parseDateKey(line.startDate),end_date=parseDateKey(line.endDate)
  if(ids.has(source_id)||start_date<=as_of||end_date<start_date||Number(end_date.slice(0,4))!==c.year)invalidAccount();ids.add(source_id)
  return {source_id,start_date,end_date,duration:parseDurationSelection(line.duration),total_minutes:accountInteger(line.totalMinutes,1,5400)}
 })
 const past_used_minutes=accountInteger(c.pastUsedMinutes,0,5400)
 if(past_used_minutes+future_approved.reduce((sum,line)=>sum+line.total_minutes,0)>5400)invalidAccount()
 return {...base,allowance_minutes:5400,past_used_minutes,as_of,future_approved}
}
export function parseBalanceReceipt(value:unknown):LeaveResult{
 const v=accountObject(value);if(v.operation!=='reconcile_opening'&&v.operation!=='adjust_balance')invalidAccount()
 return {id:parseUUID(v.id),version:accountInteger(v.version,1),operation:v.operation}
}
