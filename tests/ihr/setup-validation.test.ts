import { describe, expect, it } from 'vitest'
import { validateLeaveSetup } from '../../src/lib/leave/setupValidation'
import type { SetupInput } from '../../src/lib/leave/contracts'
import { managerA } from './fixtures'

const ready: SetupInput = { memberKind: 'employee', active: true, timezone: 'Asia/Jakarta',
  annualPolicyConfirmed: true, openingReconciled: true, approverId: managerA, approverActive: true,
  hasCalendar: true, hasRosterCoverage: true, hasFirstGrantPolicy: false, cycleState: 'established_calendar',
  reservePendingAccepted: true, singleDateRuleAccepted: true }

describe('validateLeaveSetup', () => {
  it('accepts established-calendar request readiness without new-hire first-grant policy', () => {
    expect(validateLeaveSetup(ready)).toEqual([])
    expect(validateLeaveSetup({ ...ready, memberKind: 'manager' })).toEqual([])
  })
  it('directors cannot request', () => {
    expect(validateLeaveSetup({ ...ready, memberKind: 'director' })).toContainEqual(
      expect.objectContaining({ code: 'director_excluded', field: 'memberKind' }))
  })
  it.each([
    [{ memberKind: null }, 'member_missing', 'memberKind'],
    [{ active: false }, 'member_inactive', 'active'],
    [{ timezone: null }, 'timezone_missing', 'timezone'],
    [{ timezone: ' ' }, 'timezone_missing', 'timezone'],
    [{ timezone: 'Invalid/Timezone' }, 'timezone_invalid', 'timezone'],
    [{ annualPolicyConfirmed: false }, 'annual_policy_unconfirmed', 'annualPolicyConfirmed'],
    [{ openingReconciled: false }, 'opening_unreconciled', 'openingReconciled'],
    [{ approverId: null }, 'approver_missing', 'approverId'],
    [{ approverId: 'invalid' }, 'approver_invalid', 'approverId'],
    [{ approverActive: false }, 'approver_inactive', 'approverActive'],
    [{ hasCalendar: false }, 'calendar_missing', 'hasCalendar'],
    [{ hasRosterCoverage: false }, 'roster_coverage_missing', 'hasRosterCoverage'],
    [{ reservePendingAccepted: false }, 'pending_reservation_unaccepted', 'reservePendingAccepted'],
    [{ singleDateRuleAccepted: false }, 'single_date_rule_unaccepted', 'singleDateRuleAccepted'],
    [{ cycleState: 'first_grant_blocked', hasFirstGrantPolicy: false }, 'first_grant_blocked', 'cycleState'],
    [{ cycleState: 'first_grant_blocked', hasFirstGrantPolicy: true }, 'first_grant_blocked', 'cycleState'],
  ] as const)('returns named blocker %s', (patch, code, field) => {
    const blockers = validateLeaveSetup({ ...ready, ...patch })
    expect(blockers).toContainEqual(expect.objectContaining({ code, field, message: expect.any(String) }))
  })
  it('reports all missing controls, coverage and mapping together', () => {
    const blockers = validateLeaveSetup({ ...ready, timezone: null, approverId: null,
      hasRosterCoverage: false, reservePendingAccepted: false, singleDateRuleAccepted: false })
    expect(blockers.map(blocker => blocker.code)).toEqual([
      'timezone_missing', 'approver_missing', 'roster_coverage_missing',
      'pending_reservation_unaccepted', 'single_date_rule_unaccepted',
    ])
  })
})
