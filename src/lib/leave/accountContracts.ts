import type { AnnualPeriod, Balance, DateKey, DurationSelection, LeaveResult, UUID } from './contracts'
export type BalanceEntryKind='annual_grant'|'opening'|'adjustment'|'reservation'|'approval'|'rejection'|'withdrawal'|'cancellation'
export type BalanceEntry={id:UUID;sequence:number;date:DateKey;kind:BalanceEntryKind;allowanceDelta:number;reservedDelta:number;usedDelta:number}
export type BalanceHistory={balance:Balance;rows:BalanceEntry[];nextBefore:number|null}
export type BalanceAccounts={currentPeriod:AnnualPeriod|null;balances:Balance[]}
export type OpeningSourceLine={sourceId:UUID;startDate:DateKey;endDate:DateKey;duration:DurationSelection;totalMinutes:number}
type Base={employeeId:UUID;year:number;sourceId:UUID;expectedVersion:number;reason:string}
export type BalanceCommand=Base & (
 |{operation:'reconcile_opening';allowanceMinutes:number;pastUsedMinutes:number;asOf:DateKey;futureApproved:OpeningSourceLine[]}
 |{operation:'adjust_balance';deltaMinutes:number}
)
export type BalanceSend=(command:BalanceCommand)=>Promise<LeaveResult>
