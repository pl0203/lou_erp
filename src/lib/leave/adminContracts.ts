import type { AnnualPeriod, DateKey, DurationSelection, LeaveStatus, LeaveResult, SetupBlocker, UUID } from './contracts'
import type { LeaveCalendarSetup, SetupImpacts } from './setupContracts'
export const ADMIN_OPERATIONS=['save_policy_version','activate_member_policy','set_governance_reference','grant_leave_access','revoke_leave_access','reassign_request'] as const
export type AdminOperation=typeof ADMIN_OPERATIONS[number]
export type AdminCapability='configure'|'adjust'|'read_private'|'calendar'|'manage_access'
export type GovernanceKind='retention'|'access_review'
export type LeavePolicyDraft={
 effectiveFrom:DateKey;effectiveUntil:DateKey|null;annualPolicyConfirmed:boolean;requestRulesConfirmed:boolean
 minimumNoticeDays:number|null;bookingHorizonDays:number|null;reasonRequired:boolean|null;reservePendingAccepted:boolean|null;singleDateRuleAccepted:boolean|null
 cancellationRulesConfirmed:boolean;cancellationMode:'whole_request'|null;cancellationAllowPast:boolean|null;cancellationAllowRepeatDeclined:boolean|null;cancellationReasonRequired:boolean|null
 calendarAudience:'explicit_grants'|null;calendarAudienceConfirmed:boolean
}
export type LeaveAdminPolicy=LeavePolicyDraft&{id:UUID;version:number}
export type GovernanceEvidence={id:UUID;kind:GovernanceKind;referenceVersion:number;selected:boolean;confirmed:boolean;ruleId:UUID|null;ruleVersion:number|null;ruleDocument:Record<string,unknown>|null;approvedBy:UUID|null;approvedAt:string|null;accountableOwner:UUID|null;cadence:string|null;capabilities:AdminCapability[]|null;grantIds:UUID[]|null;audienceIds:UUID[]|null}
export type LeaveAdminSettingsData={employeeId:UUID;authorityKey:string;memberVersion:number;policy:LeaveAdminPolicy|null;policyDrafts:LeaveAdminPolicy[];governance:GovernanceEvidence[];readiness:{ready:boolean;blockers:SetupBlocker[]};impacts:SetupImpacts}
export type AccessGrant={id:UUID;actorId:UUID;capability:AdminCapability;employeeId:UUID;effectiveFrom:string;effectiveUntil:string|null;version:number;revoked:boolean}
export type AccessManifest=Omit<AccessGrant,'id'|'version'|'revoked'>&{id:UUID;grantId:UUID;approvedBy:UUID;approvedAt:string;approvalReference:string}
export type LeaveAdminAccessData={employeeId:UUID;authorityKey:string;grants:AccessGrant[];manifests:AccessManifest[]}
export type LeaveAdminRequest={id:UUID;sequence:number;version:number;startDate:DateKey;endDate:DateKey;approverName:string;currentAssignmentId:UUID}
export type LeaveAdminCommand={expectedVersion:number;reason:string}&(
 |{operation:'save_policy_version';employeeId:UUID;policy:LeavePolicyDraft}
 |{operation:'activate_member_policy';employeeId:UUID;policyId:UUID;establishedEligibilityConfirmed:boolean}
 |{operation:'set_governance_reference';employeeId:UUID;kind:GovernanceKind;approvalId:UUID}
 |{operation:'grant_leave_access';manifestId:UUID}
 |{operation:'revoke_leave_access';grantId:UUID}
 |{operation:'reassign_request';employeeId:UUID;requestId:UUID;assignmentId:UUID}
)
export type AdminReceipt=LeaveResult&{operation:AdminOperation}
export type LeaveAdminSend=(command:LeaveAdminCommand)=>Promise<AdminReceipt>
export const emptyPolicy:LeavePolicyDraft={effectiveFrom:'',effectiveUntil:null,annualPolicyConfirmed:false,requestRulesConfirmed:false,minimumNoticeDays:null,bookingHorizonDays:null,reasonRequired:null,reservePendingAccepted:null,singleDateRuleAccepted:null,cancellationRulesConfirmed:false,cancellationMode:null,cancellationAllowPast:null,cancellationAllowRepeatDeclined:null,cancellationReasonRequired:null,calendarAudience:null,calendarAudienceConfirmed:false}

export type LeaveAdminTarget={id:UUID;name:string;capabilities:{configure:boolean;adjust:boolean;readPrivate:boolean;calendar:boolean;manageAccess:boolean}}

/** Write prerequisite metadata only. No private balance amounts or history are projected. */
export type AdminWriteAccount={accountId:UUID;year:number;version:number;reconciled:boolean}
export type AdminWriteBalance=
 |{state:'verified';currentPeriod:AnnualPeriod;account:AdminWriteAccount&{reconciled:true}}
 |{state:'unreconciled';currentPeriod:AnnualPeriod;account:AdminWriteAccount&{reconciled:false}}
 |{state:'missing';currentPeriod:AnnualPeriod;account:null}
 |{state:'unavailable';currentPeriod:null;account:null}
export type AdminMemberOptions={state:'available'|'lineage_unassigned'|'unavailable';calendars:{id:UUID;name:string}[];groups:{id:UUID;name:string}[]}
export type LeaveAdminWriteContext={employeeId:UUID;scopeVersion:string;authorityKey:string;capabilities:{configure:boolean;adjust:boolean};balance:AdminWriteBalance;memberOptions:AdminMemberOptions|null}
export type LeaveAdminRotaContext={calendarId:UUID;scopeVersion:string;authorityKey:string;calendar:LeaveCalendarSetup}

/** Independent private HR review. These reads confer no request mutation authority. */
export type HrRequestSummary={id:UUID;sequence:number;startDate:DateKey;endDate:DateKey;duration:DurationSelection;totalMinutes:number;status:LeaveStatus;version:number;submittedAt:string;sourceKind:'submission'|'opening'}
export type HrRequestDetail=HrRequestSummary&{reason:string;approverName:string;days:{date:DateKey;scheduledMinutes:0|225|450;chargedMinutes:number;exclusion:'holiday'|'off_duty'|null;groupName:string|null}[];allocations:{year:number;startDate:DateKey;endDate:DateKey;chargedMinutes:number}[]}
export type HrHistoryCursor={atTime:string;id:UUID}
export type HrRequestEvent={id:UUID;event:'submitted'|'opening_imported'|'approved'|'rejected'|'withdrawn'|'cancellation_requested'|'cancellation_accepted'|'cancellation_declined'|'reassigned';atTime:string;actor:{id:UUID;name:string};reason:string|null;approverName:string|null}
type HrEnvelope={employeeId:UUID;scopeVersion:string;authorityKey:string}
export type HrRequestPage=HrEnvelope&{rows:HrRequestSummary[];nextBefore:number|null}
export type HrRequestDetailResponse=HrEnvelope&{request:HrRequestDetail}
export type HrRequestHistoryPage=HrEnvelope&{requestId:UUID;rows:HrRequestEvent[];nextBefore:HrHistoryCursor|null}
