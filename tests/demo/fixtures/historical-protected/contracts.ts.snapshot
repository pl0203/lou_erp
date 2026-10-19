/** Shared leave v1 contracts. Amounts and capacities are always integer minutes. */
export const WEEKDAY_MINUTES = 450 as const
export const HALF_DAY_MINUTES = 225 as const
export const ANNUAL_ALLOWANCE_MINUTES = 5400 as const
export const FIXED_DURATION_MINUTES = Object.freeze([60, 120, 180, 225, 240, 300, 360] as const)

export type DateKey = string
export type UUID = string
export type DurationSelection = { mode: 'fixed_minutes'; minutes: 60 | 120 | 180 | 225 | 240 | 300 | 360 } | { mode: 'full_scheduled_day' }
export type LeaveStatus = 'submitted' | 'approved' | 'rejected' | 'withdrawn' | 'cancellation_pending' | 'cancelled'
export type SetupBlocker = { code: string; message: string; field?: string }
export type SetupInput = {
  memberKind: 'employee' | 'manager' | 'director' | null
  active: boolean
  timezone: string | null
  annualPolicyConfirmed: boolean
  openingReconciled: boolean
  approverId: UUID | null
  approverActive: boolean
  hasCalendar: boolean
  hasRosterCoverage: boolean
  hasFirstGrantPolicy: boolean
  cycleState: 'established_calendar' | 'first_grant_blocked'
  reservePendingAccepted: boolean
  singleDateRuleAccepted: boolean
}
export type Balance = {
  accountId: UUID; year: number; allowanceMinutes: number; approvedMinutes: number | null
  pendingMinutes: number | null; availableMinutes: number | null; expiredMinutes: number | null; version: number
  /** Missing legacy verification is never a verified opening. */
  reconciled?: boolean
}
export type AnnualPeriod = { year: number; startDate: DateKey; endDate: DateKey }
export type LeaveContext = {
  /** Server-derived only. Older omitted responses keep preparation blocked. */
  currentPeriod?: AnnualPeriod | null
  scopeVersion: string
  memberKind: 'employee' | 'manager' | 'director' | null
  capabilities: { request: boolean; approve: boolean; configure: boolean; adjust: boolean; readPrivate: boolean; manageAccess: boolean }
  setup: { ready: boolean; blockers: SetupBlocker[] }
  balances: Balance[]
  timezone: string | null
}
export type QuoteDay = {
  date: DateKey; scheduledMinutes: 0 | 225 | 450; chargedMinutes: number
  exclusion: 'holiday' | 'off_duty' | null; year: number | null; calendarVersion: number
  rosterVersion: number | null; membershipVersion: number | null
}
export type LeaveQuote = {
  fingerprint: string; days: QuoteDay[]; totalMinutes: number; balancesAfter: Balance[]
  approver: { id: UUID; name: string }; scopeVersion: string; blockers: SetupBlocker[]
}
export type RequestSummary = {
  id: UUID; employee: { id: UUID; name: string }; startDate: DateKey; endDate: DateKey
  duration: DurationSelection; totalMinutes: number; status: LeaveStatus; version: number; submittedAt: string
}
export type Page<T> = { rows: T[]; total: number; page: number; pageSize: number }
export type Availability = { employeeId: UUID; employeeName: string; date: DateKey; minutes: number; fullScheduledDay: boolean }
export type LeaveResult = { id: UUID; version: number; operation: string }
export type Recovery = { state: 'committed' | 'abandoned'; result?: LeaveResult }

/** Gregorian date-only validation without UTC/local conversion or Date rollover. */
export function parseDateKey(value: unknown): DateKey {
  if (typeof value !== 'string' || value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError('Leave date must use YYYY-MM-DD')
  }
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10))
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]) {
    throw new TypeError('Leave date must be an actual calendar date')
  }
  return value
}

export function parseUUID(value: unknown): UUID {
  if (typeof value !== 'string' || value.length !== 36 || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)) {
    throw new TypeError('Leave identifier must be a UUID')
  }
  return value
}

/** Strict JSON boundary: a fixed 450-minute duration is deliberately unsupported. */
export function parseDurationSelection(value: unknown): DurationSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Leave duration is required')
  const selection = value as Record<string, unknown>
  const keys = Object.keys(selection).sort().join(',')
  if (selection.mode === 'full_scheduled_day' && keys === 'mode') return { mode: 'full_scheduled_day' }
  if (selection.mode === 'fixed_minutes' && keys === 'minutes,mode' &&
      FIXED_DURATION_MINUTES.some(minutes => minutes === selection.minutes)) {
    return { mode: 'fixed_minutes', minutes: selection.minutes as Extract<DurationSelection, { mode: 'fixed_minutes' }>['minutes'] }
  }
  throw new TypeError('Leave duration must be a supported fixed choice or full scheduled day')
}
