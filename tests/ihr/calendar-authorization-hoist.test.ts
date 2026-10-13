import { test } from 'vitest'
import { assertCalendarAuthorizationHoist } from '../database/ihr/calendar-authorization-source-check.mjs'
import { assertCalendarPlanBindingChecks, assertCalendarPlanExecutionChecks } from '../database/ihr/calendar-authorization-plan-check.mjs'
import { assertCalendarDiagnostics } from '../database/ihr/calendar-authorization-diagnostics-check.mjs'

test('calendar materializes the unchanged authorized member predicate before exact request projection', () => {
  assertCalendarAuthorizationHoist()
})

test('calendar plan binding requires the exact runtime-authorized set and retained authority time', async () => {
  assertCalendarPlanBindingChecks()
  await assertCalendarPlanExecutionChecks()
})

test('separate calendar diagnostics cover populated January and retain canonical workload/plan inventory', () => {
  assertCalendarDiagnostics()
})
