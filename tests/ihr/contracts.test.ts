import { describe, expect, it } from 'vitest'
import { ANNUAL_ALLOWANCE_MINUTES, FIXED_DURATION_MINUTES, HALF_DAY_MINUTES, WEEKDAY_MINUTES,
  parseDateKey, parseDurationSelection, parseUUID } from '../../src/lib/leave/contracts'
import type { Availability, Balance, DurationSelection, LeaveContext, LeaveQuote, LeaveResult,
  LeaveStatus, Page, QuoteDay, Recovery, RequestSummary, SetupBlocker, SetupInput } from '../../src/lib/leave/contracts'
import { directorA, employeeA, employeeB, hrA, hrB, managerA, inactiveA, unrelatedA,
  hrConfigureA, hrAdjustA, hrPrivateA, hrCalendarA, hrAccessA, syntheticHrVariants } from './fixtures'

describe('leave contracts', () => {
  it('locks integer-minute policy constants and fixed choices', () => {
    expect(WEEKDAY_MINUTES).toBe(450)
    expect(HALF_DAY_MINUTES).toBe(225)
    expect(ANNUAL_ALLOWANCE_MINUTES).toBe(5400)
    expect(FIXED_DURATION_MINUTES).toEqual([60, 120, 180, 225, 240, 300, 360])
  })
  it.each([60, 120, 180, 225, 240, 300, 360])('accepts fixed %i minutes', minutes => {
    expect(parseDurationSelection({ mode: 'fixed_minutes', minutes })).toEqual({ mode: 'fixed_minutes', minutes })
  })
  it('uses a separate full-scheduled-day mode', () => {
    expect(parseDurationSelection({ mode: 'full_scheduled_day' })).toEqual({ mode: 'full_scheduled_day' })
    expect(() => parseDurationSelection({ mode: 'fixed_minutes', minutes: 450 })).toThrow()
  })
  it.each([null, [], {}, 'full_scheduled_day', { mode: 'fixed_minutes', minutes: -60 },
    { mode: 'fixed_minutes', minutes: 0 }, { mode: 'fixed_minutes', minutes: 1.5 },
    { mode: 'fixed_minutes', minutes: NaN }, { mode: 'fixed_minutes', minutes: Number.MAX_SAFE_INTEGER + 1 },
    { mode: 'fixed_minutes', minutes: '60' }, { mode: 'fixed_minutes', minutes: 60, actor: 'forged' },
    { mode: 'full_scheduled_day', minutes: 450 }, { mode: 'full_scheduled_day', amount: 5400 },
    { mode: 'other', minutes: 60 }])('rejects malformed or unsupported duration %j', value => {
    expect(() => parseDurationSelection(value)).toThrow()
  })
  it.each(['2024-02-29', '2026-10-02', '2000-02-29', '0001-01-01', '0099-12-31'])('accepts actual date %s', date => {
    expect(parseDateKey(date)).toBe(date)
  })
  it.each(['2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-10-00',
    '2026-1-01', '0000-01-01', '2026-10-02T00:00:00Z', '2026-10-02\n', '', null])('rejects invalid date %j', value => {
    expect(() => parseDateKey(value)).toThrow()
  })
  it('exports distinct fictional UUID identifiers without real identity data', () => {
    const ids = [employeeA, employeeB, managerA, directorA, hrA, hrB, inactiveA, unrelatedA,
      hrConfigureA, hrAdjustA, hrPrivateA, hrCalendarA, hrAccessA]
    expect(new Set(ids).size).toBe(13)
    expect(ids.map(parseUUID)).toEqual(ids)
  })
  it('explicitly separates fictional scoped HR variants without approval grants', () => {
    expect(syntheticHrVariants).toEqual([
      { id: hrConfigureA, capabilities: ['configure'], employeeIds: [employeeA] },
      { id: hrAdjustA, capabilities: ['adjust'], employeeIds: [employeeA] },
      { id: hrPrivateA, capabilities: ['read_private'], employeeIds: [employeeA] },
      { id: hrCalendarA, capabilities: ['calendar'], employeeIds: [employeeA] },
      { id: hrAccessA, capabilities: ['manage_access'], employeeIds: [employeeA] },
      { id: hrA, capabilities: ['configure', 'adjust', 'read_private', 'calendar'], employeeIds: [employeeA] },
      { id: hrB, capabilities: ['configure', 'adjust', 'read_private', 'calendar', 'manage_access'], employeeIds: [employeeB] },
    ])
    expect(syntheticHrVariants.flatMap(actor => actor.capabilities)).not.toContain('approve')
  })
  it.each(['not-a-uuid', '', null, '10000000-0000-0000-0000-000000000001; DROP TABLE users',
    '10000000-0000-0000-0000-000000000001\n'])('rejects malformed UUID %j', value => {
    expect(() => parseUUID(value)).toThrow()
  })
  it('preserves the retained shared consumer shapes', () => {
    const duration: DurationSelection = { mode: 'fixed_minutes', minutes: 225 }
    const blocker: SetupBlocker = { code: 'calendar_missing', message: 'Calendar required', field: 'hasCalendar' }
    const input: SetupInput = { memberKind: 'employee', active: true, timezone: 'Etc/UTC',
      annualPolicyConfirmed: true, openingReconciled: true, approverId: managerA, approverActive: true,
      hasCalendar: true, hasRosterCoverage: true, hasFirstGrantPolicy: false, cycleState: 'established_calendar',
      reservePendingAccepted: true, singleDateRuleAccepted: true }
    const balance: Balance = { accountId: employeeA, year: 2026, allowanceMinutes: 5400,
      approvedMinutes: 0, pendingMinutes: 225, availableMinutes: 5175, expiredMinutes: 0, version: 1 }
    const context: LeaveContext = { scopeVersion: 'synthetic-1', memberKind: input.memberKind,
      capabilities: { request: true, approve: false, configure: false, adjust: false, readPrivate: false, manageAccess: false },
      setup: { ready: true, blockers: [] }, balances: [balance], timezone: input.timezone }
    const day: QuoteDay = { date: '2026-10-02', scheduledMinutes: 450, chargedMinutes: 225,
      exclusion: null, year: 2026, calendarVersion: 1, rosterVersion: 1, membershipVersion: 1 }
    const quote: LeaveQuote = { fingerprint: 'synthetic', days: [day], totalMinutes: 225,
      balancesAfter: [balance], approver: { id: managerA, name: 'Synthetic manager' }, scopeVersion: context.scopeVersion, blockers: [] }
    const statuses: LeaveStatus[] = ['submitted', 'approved', 'rejected', 'withdrawn', 'cancellation_pending', 'cancelled']
    const summary: RequestSummary = { id: employeeB, employee: { id: employeeA, name: 'Synthetic employee' },
      startDate: day.date, endDate: day.date, duration, totalMinutes: quote.totalMinutes, status: statuses[0],
      version: 1, submittedAt: '2026-10-02T00:00:00Z' }
    const page: Page<RequestSummary> = { rows: [summary], total: 1, page: 1, pageSize: 20 }
    const availability: Availability = { employeeId: employeeA, employeeName: summary.employee.name,
      date: day.date, minutes: day.chargedMinutes, fullScheduledDay: false }
    const result: LeaveResult = { id: summary.id, version: summary.version, operation: 'submit' }
    const recovery: Recovery = { state: 'committed', result }
    expect(page.rows[0].duration).toEqual(duration)
    expect(availability.minutes).toBe(225)
    expect(recovery.result).toEqual(result)
    expect(blocker.field).toBe('hasCalendar')
  })
})
