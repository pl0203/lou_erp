import type { DateKey, LeaveResult, UUID } from './contracts'
export type SetupImpacts = { available: boolean; pendingCount: number | null; approvedCount: number | null }
export type LeaveApproverOption = { id: UUID; name: string; memberKind: 'manager' | 'director'; active: boolean }
export type LeaveMemberSetup = {
 id: UUID; name: string; memberKind: 'employee' | 'manager' | 'director' | null; active: boolean
 employmentStart: DateKey | null; eligibilityDate: DateKey | null; calendarId: UUID | null; version: number
 /** Current server-authorized route choices; legacy omission retains the narrower original UI. */
 allowedApproverKinds?: ('manager' | 'director')[]
 assignments?: { id: UUID; approverId: UUID; effectiveFrom: string; effectiveUntil: string | null; version: number }[]
 memberships?: { id: UUID; groupId: UUID; effectiveFrom: DateKey; effectiveUntil: DateKey | null; version: number }[]
 impacts?: SetupImpacts
}
export type RotaGroup = { id: UUID; name: string; onAnchor: boolean | null }
export type LeaveCalendarSetup = {
 id: UUID; name: string; version: number; effectiveFrom: DateKey; effectiveUntil: DateKey | null
 timezone: string | null; confirmedTimezone?: string | null; holidaysConfirmed: boolean; sundayMinutes: 0 | null
 holidays: DateKey[]; groups: RotaGroup[]; impacts?: SetupImpacts
}
export type RosterPreviewInput = { calendarId: UUID; anchor: DateKey; groups: { id: UUID; onAnchor: boolean }[]; from: DateKey; to: DateKey }
export type RosterPreview = { calendarId: UUID; calendarVersion: number; fingerprint: string; rows: { date: DateKey; groupId: UUID; capacityMinutes: 0 | 225 }[]; impacts: SetupImpacts }
export type CalendarDraft={calendarId:UUID;name:string;effectiveFrom:DateKey;effectiveUntil:DateKey|null;timezone:string|null;holidaysConfirmed:boolean;sundayMinutes:0|null;holidays:DateKey[];groups:{id:UUID;name:string}[]}
export type CalendarPreviewInput=CalendarDraft&{expectedVersion:number}
export type CalendarPreview={calendarId:UUID;calendarVersion:number;fingerprint:string;impacts:SetupImpacts}
type Base = { expectedVersion: number; reason: string }
export type LeaveSetupCommand = Base & (
 | { operation: 'set_member'; employeeId: UUID; memberKind: 'employee' | 'manager' | 'director'; active: boolean; employmentStart: DateKey | null; eligibilityDate: DateKey | null; calendarId: UUID | null }
 | { operation: 'set_approver'; employeeId: UUID; approverId: UUID | null; effectiveFrom: DateKey | null; effectiveUntil: DateKey | null; replaceAssignmentId: UUID | null }
 | { operation: 'set_group_membership'; employeeId: UUID; groupId: UUID; effectiveFrom: DateKey; effectiveUntil: DateKey | null; replaceMembershipId: UUID | null }
 | ({operation:'save_calendar_version';previewFingerprint:string}&CalendarDraft)
 | ({ operation: 'publish_roster'; previewFingerprint: string } & RosterPreviewInput)
)
export type LeaveSetupSend = (command: LeaveSetupCommand) => Promise<LeaveResult>
