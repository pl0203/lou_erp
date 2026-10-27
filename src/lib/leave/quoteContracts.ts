import type { DateKey, DurationSelection, UUID } from './contracts'
export type LeaveQuoteInput={startDate:DateKey;endDate:DateKey;duration:DurationSelection;reason:string}
export type QuoteSources={calendarId:UUID;calendarVersion:number;rosterId:UUID|null;rosterVersion:number|null;membershipId:UUID|null;membershipVersion:number|null;groupId:UUID|null;groupVersion:number|null;groupName:string|null}
export type QuotedDay={date:DateKey;scheduledMinutes:0|225|450;chargedMinutes:number;exclusion:'holiday'|'off_duty'|null;year:number|null;accountId:UUID|null;sources:QuoteSources}
export type QuoteAllocation={accountId:UUID;year:number;version:number;chargedMinutes:number;availableBefore:number;availableAfter:number}
/** Exact minimized SQL v1 response; it carries no private reason or writable per-date overrides. */
export type AuthoritativeLeaveQuote={fingerprint:string;startDate:DateKey;endDate:DateKey;today:DateKey;duration:DurationSelection;totalMinutes:number;days:QuotedDay[];allocations:QuoteAllocation[];approver:{id:UUID;name:string;assignmentId:UUID;assignmentVersion:number};policy:{id:UUID;version:number};memberVersion:number;scopeVersion:string}
