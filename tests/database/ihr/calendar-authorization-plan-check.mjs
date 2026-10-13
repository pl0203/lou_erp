// Lightweight unit assertions only, never SQL/authority/latency evidence.
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import * as plans from './capacity-plans.mjs'

export function assertCalendarPlanBindingChecks() {
  assert.equal(typeof plans.assertCalendarPlanAuthorization, 'function', 'calendar plans need runtime authorization binding validation')
  const a = '71000000-0000-0000-0000-000000000001', b = '71000000-0000-0000-0000-000000000002'
  const plan = { name: 'unit-only-calendar', calendarAuthorization: { actor: a, audience: 'assigned_team', employeeIds: [a, b] } }
  const valid = { actor: a, audience: 'assigned_team', authorizedAt: '2026-10-03T12:00:00+00:00', employeeIds: [b, a] }
  assert.doesNotThrow(() => plans.assertCalendarPlanAuthorization(plan, valid))
  for (const patch of [{ employeeIds: [a] }, { employeeIds: [a, a, b] }, { employeeIds: null }, { actor: b }, { audience: 'own' }, { authorizedAt: null }, { authorizedAt: 'not-a-timestamp' }]) {
    assert.throws(() => plans.assertCalendarPlanAuthorization(plan, { ...valid, ...patch }), /authorization binding/)
  }
  assert.throws(() => plans.assertCalendarPlanAuthorization(plan, null), /authorization binding/)
}

export async function assertCalendarPlanExecutionChecks() {
  assert.equal(typeof plans.captureCapacityPlan, 'function', 'capture the actual binding before any calendar row EXPLAIN')
  const id = '71000000-0000-0000-0000-000000000001'
  const plan = { name: 'unit-only-calendar', sql: 'SELECT row_projection', calendarAuthorization: { sql: 'SELECT authorization', actor: id, audience: 'own', employeeIds: [id] } }
  const valid = { actor: id, audience: 'own', authorizedAt: '2026-10-03T12:00:00Z', employeeIds: [id] }
  const actions = [], explain = [{ unitOnly: true }]
  const session = { async query(sql) { actions.push(sql); return sql === plan.calendarAuthorization.sql ? valid : explain } }
  const captured = await plans.captureCapacityPlan(session, plan, async (kind, record) => { actions.push(kind); assert.equal(record.captured, valid) })
  assert.deepEqual(actions, ['SELECT authorization', 'plan-authorization', 'EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT JSON) SELECT row_projection'])
  assert.equal(captured.authorizationBinding, valid)
  assert.equal(captured.explain, explain)
  const rejected = []
  await assert.rejects(() => plans.captureCapacityPlan({ async query(sql) { rejected.push(sql); return { ...valid, employeeIds: [] } } }, plan, async kind => { rejected.push(kind) }), /authorization binding/)
  assert.deepEqual(rejected, ['SELECT authorization', 'plan-authorization'], 'retain bad binding and never execute unbound row EXPLAIN')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assertCalendarPlanBindingChecks()
  await assertCalendarPlanExecutionChecks()
  console.log('CALENDAR_PLAN_BINDING_UNIT_ONLY_PASSED; SQL/runtime/latency NOT_RUN')
}
