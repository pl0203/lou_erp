// Lightweight fixture/source assertions only. No database connections or timing claims.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCalendarAuthorizationDiagnostics } from './calendar-authorization-diagnostics.mjs'
import { buildCapacityPlans, assertCalendarPlanAuthorization } from './capacity-plans.mjs'
import { sha256 } from './capacity-fixture.mjs'

export function assertCalendarDiagnostics() {
  const diagnostics = buildCalendarAuthorizationDiagnostics(), plans = buildCapacityPlans()
  assert.equal(diagnostics.fullCapacityAcceptance, false)
  assert.equal(diagnostics.workloads.length, 6)
  assert.equal(plans.length, 6)
  for (const [suffix, januaryRows, quarterRows] of [['team-small', 22, 44], ['team-large', 1316, 2896], ['director', 14, 27]]) {
    for (const [range, rows] of [['31-january-populated', januaryRows], ['93-populated', quarterRows]]) {
      const workload = diagnostics.workloads.find(w => w.name === `calendar-diagnostic-${range}-${suffix}`)
      assert.equal(workload.expected.value.length, rows)
      assert.equal(workload.role, 'authenticated')
      assert.equal(workload.thresholdMs, 1000)
    }
  }
  const here = dirname(fileURLToPath(import.meta.url)), sql = readFileSync(join(here, '../../../supabase/migrations/202610021006_ihr_leave_reads.sql'), 'utf8')
  const sources = JSON.parse(readFileSync(join(here, 'capacity-plan-sources.json'), 'utf8'))
  assert.equal(sources.leave_calendar_v1.fileSha256, sha256(sql))
  assert.equal(sources.leave_calendar_v1.definitionSha256, sha256(sources.leave_calendar_v1.definition))
  assert.ok(sql.includes(sources.leave_calendar_v1.definition))
  for (const plan of [...plans.filter(p => p.calendarAuthorization), ...diagnostics.plans]) {
    assert.equal(plan.sqlSha256, sha256(plan.sql))
    assert.equal(plan.calendarAuthorization.sqlSha256, sha256(plan.calendarAuthorization.sql))
    assert.ok(plan.sql.includes('r.employee_id=ANY('))
    assert.ok(!plan.sql.includes('calendar_can_read'))
    const binding = plan.calendarAuthorization
    assertCalendarPlanAuthorization(plan, { actor: binding.actor, audience: binding.audience, employeeIds: [...binding.employeeIds].reverse(), authorizedAt: '2026-10-03T12:00:00Z' })
  }
  const manifest = JSON.parse(readFileSync(join(here, 'capacity-workload-manifest.json'), 'utf8'))
  assert.equal(manifest.workloads.length, 104)
  assert.deepEqual(manifest.plans, plans)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const started = performance.now()
  assertCalendarDiagnostics()
  console.log(`CALENDAR_DIAGNOSTIC_FIXTURE_SOURCE_ONLY_PASSED (${(performance.now()-started).toFixed(1)}ms); SQL/runtime/latency NOT_RUN`)
}
