// Separately declared diagnostics. Never appended to the canonical 104 workloads/six plans.
// Coordinator execution only, after the exclusive PostgreSQL measurement slot is released.
import { buildCapacityFixture, personId, sha256 } from './capacity-fixture.mjs'
import { buildCapacityWorkloads } from './capacity-workloads.mjs'
import { calendarAuthorization, calendarSql } from './capacity-plans.mjs'
import { literal } from './capacity-sql.mjs'

export function buildCalendarAuthorizationDiagnostics(fixture = buildCapacityFixture()) {
  const original = buildCapacityWorkloads(fixture)
  const teams = [
    { suffix: 'team-small', person: 482, targets: [241, 242, 243, 244] },
    { suffix: 'team-large', person: 481, targets: Array.from({ length: 240 }, (_, i) => i + 1) },
    { suffix: 'director', person: 496, targets: [481, 486, 491] },
  ]
  const workloads = [], plans = []
  for (const team of teams) for (const [range, from, to] of [
    ['93-populated', '2026-01-01', '2026-04-03'],
    ['31-january-populated', '2026-01-01', '2026-01-31'],
  ]) {
    const baseline = original.find(w => w.name === `calendar-93-${team.suffix}`)
    const name = `calendar-diagnostic-${range}-${team.suffix}`
    const expected = { type: 'exact', value: baseline.expected.value.filter(row => row.date >= from && row.date <= to) }
    workloads.push({ ...baseline, name, sql: `SELECT public.leave_calendar_v1(${literal(from)},${literal(to)},'assigned_team')`, expected, diagnosticOnly: true })
    const sql = calendarSql(team.targets.map(personId), from, to)
    plans.push({ name, role: 'postgres', rpc: 'leave_calendar_v1', sql, sqlSha256: sha256(sql),
      calendarAuthorization: calendarAuthorization(team.person, 'assigned_team', team.targets),
      requiredRelations: ['ihr_leave_requests', 'ihr_leave_request_days', 'users'], forbidSeqScan: [],
      diagnosticOnly: true, authorityEvidence: 'owner underlying SELECT only; authenticated diagnostic workload is separate',
      planLimits: ['row EXPLAIN excludes authorization collection cost; full authenticated RPC timings include it',
        'UUID array literal represents the captured binding; long-lived PL/pgSQL generic-cache behavior is not established'] })
  }
  return { status: 'NOT_RUN', diagnosticOnly: true, fullCapacityAcceptance: false, warmups: 5, samples: 30,
    thresholdMs: 1000, workloads, plans,
    execution: 'Use the same captured-authorization validation and read-only repeatable-read plan protocol as the canonical sampler. Do not replace the required 104 workloads/six plans with these diagnostics.',
    caution: 'The current October month is empty in this frozen fixture. January is the populated normal-span comparison.' }
}
