import type { LeaveResult,LeaveStatus,UUID } from './contracts'
import type { OwnRequestDetail,OwnRequestSummary } from './requestContracts'
export type TransitionOperation='approve_request'|'reject_request'|'withdraw_request'|'request_cancellation'|'approve_cancellation'|'decline_cancellation'
type BaseCommand={requestId:UUID;expectedVersion:number}
export type TransitionCommand=BaseCommand & (
 {operation:'approve_request'|'withdraw_request'}|
 {operation:'reject_request'|'request_cancellation';reason:string}|
 {operation:'approve_cancellation';attemptId:UUID}|
 {operation:'decline_cancellation';attemptId:UUID;reason:string})
export type TransitionReceipt=LeaveResult & {operation:TransitionOperation}
export type AssignedSummary=Omit<OwnRequestSummary,'status'> & {status:'submitted'|'cancellation_pending';employee:{id:UUID;name:string};cancellationAttemptId:UUID|null;cancellationRequestedAt:string|null}
export type AssignedPage={rows:AssignedSummary[];nextBefore:number|null}
export type AssignedDetail=AssignedSummary & Pick<OwnRequestDetail,'reason'|'approverName'|'days'|'allocations'> & {balanceContext:{basis:'current';asOf:string;periods:{year:number;reservedMinutes:number|null;usedMinutes:number|null;availableMinutes:number|null;expiredMinutes:number|null;reconciled:boolean}[]};cancellation:{id:UUID;requestedAt:string;reason:string;approverName:string}|null}
export type OwnTransitionState={id:UUID;version:number;status:LeaveStatus;canWithdraw:boolean;canRequestCancellation:boolean;cancellationBlocker:string|null;activeAttemptId:UUID|null}
