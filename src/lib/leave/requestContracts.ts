import type { DateKey,DurationSelection,LeaveResult,LeaveStatus,UUID } from './contracts'
export type RequestReceipt=LeaveResult & {operation:'submit_request'}
export type OwnRequestSummary={id:UUID;sequence:number;startDate:DateKey;endDate:DateKey;duration:DurationSelection;totalMinutes:number;status:LeaveStatus;version:number;submittedAt:string;sourceKind:'submission'|'opening'}
export type OwnRequestPage={rows:OwnRequestSummary[];nextBefore:number|null}
export type OwnRequestDetail=OwnRequestSummary & {reason:string;approverName:string;days:{date:DateKey;scheduledMinutes:0|225|450;chargedMinutes:number;exclusion:'holiday'|'off_duty'|null;groupName:string|null}[];allocations:{year:number;startDate:DateKey;endDate:DateKey;chargedMinutes:number}[]}
