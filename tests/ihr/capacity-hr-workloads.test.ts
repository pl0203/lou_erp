import { unitEvidence, unitSeal, unitRestoreProof, unitPlanQuery } from './capacity-control-fixture'
import { buildCapacityPlans } from '../database/ihr/capacity-plans.mjs'
import { expect, test } from 'vitest'
import { assertCapacityResult, buildCapacityWorkloads } from '../database/ihr/capacity-workloads.mjs'
import { buildCapacityHrWorkloads, capacityHistoryInstant, compareCapacityHistory } from '../database/ihr/capacity-hr-workloads.mjs'
import { buildCapacityFixture, sha256 } from '../database/ihr/capacity-fixture.mjs'
const priorCheckpointNames = 59

test('new exact private HR workloads preserve all original 59 semantic workloads and approved fixture cardinalities', () => {
  const f = buildCapacityFixture(), hr = buildCapacityHrWorkloads(f)
  expect(hr).toHaveLength(45)
  expect(buildCapacityWorkloads(f).filter(w => !w.name.startsWith('hr-'))).toHaveLength(priorCheckpointNames)
  expect(f.people.filter(p => p.active)).toHaveLength(500)
  expect(f.accounts).toHaveLength(1500)
  expect(f.requests).toHaveLength(10000)
  expect(f.requests.reduce((n, r) => n + r.days.length, 0)).toBe(60000)
  expect(hr.every(w => w.role === 'authenticated' && w.kind === 'read' && w.thresholdMs === 1000)).toBe(true)
})

const hr = buildCapacityHrWorkloads()
const binding = { scopeVersion: '1500:' + 'a'.repeat(32), authorityKey: 'b'.repeat(64) }
function prepared(workload: any) { return { ...workload, expected: { ...workload.expected, ...binding } } }
function resultFor(workload: any) {
  const e = workload.expected
  const base: any = { employeeId: e.employeeId, ...binding }
  if (e.type === 'hr-page') return { ok: true, value: { ...base, rows: structuredClone(e.nested.rows), nextBefore: e.nested.nextBefore } }
  if (e.type === 'hr-detail') return { ok: true, value: { ...base, request: { ...e.nested.summary, days: structuredClone(e.nested.days), allocations: structuredClone(e.nested.allocations), reason: e.nested.reason, approverName: e.nested.approverName } } }
  return { ok: true, value: { ...base, requestId: e.requestId, rows: structuredClone(e.rows), nextBefore: e.nextBefore } }
}
test('private HR request pages have exact 50-row populated and empty expectations with original day charges', () => {
  for (const name of ['hr-requests-first-50', 'hr-requests-deep-50', 'hr-requests-combined-grant-first-50']) expect(hr.find(w => w.name === name).expected.nested.rows).toHaveLength(50)
  expect(hr.find(w => w.name === 'hr-requests-authorized-empty-page').expected.nested.rows).toEqual([])
  const detail = hr.find(w => w.name === 'hr-detail-original-days-charges').expected.nested
  expect(detail.days.reduce((n, d) => n + d.chargedMinutes, 0)).toBe(detail.summary.totalMinutes)
  expect(detail.allocations.reduce((n, a) => n + a.chargedMinutes, 0)).toBe(detail.summary.totalMinutes)
  expect(detail.summary.status).toBe('cancelled')
})
test('history 50 limits preserve dense genuine history and distinguish precise tuple cursor boundaries', () => {
  const count = (name: string) => hr.find(w => w.name === name).expected.rows.length
  expect(count('hr-history-first-page-50')).toBe(50)
  expect(count('hr-history-deep-page-50')).toBe(50)
  expect(count('hr-history-after-exact-cursor-50')).toBe(50)
  expect(count('hr-history-authorized-empty-page-50')).toBe(0)
  expect(count('hr-history-microsecond-after-event-50')).toBe(50)
  expect(count('hr-history-microsecond-before-event-50')).toBe(50)
  expect(count('hr-history-same-time-upper-uuid-50')).toBe(50)
  expect(count('hr-history-same-time-lower-uuid-50')).toBe(50)
  for (const name of ['hr-history-first-one-cursor', 'hr-history-next-one-cursor']) {
    const e = hr.find(w => w.name === name).expected
    expect(e.rows).toHaveLength(1)
    expect(e.nextBefore).toEqual({ atTime: e.rows[0].atTime, id: e.rows[0].id })
  }
})
test('history comparator retains microseconds, equivalent offsets and UUID tie order', () => {
  expect(capacityHistoryInstant('2026-01-01T00:00:00.000002Z') - capacityHistoryInstant('2026-01-01T00:00:00.000001Z')).toBe(1n)
  expect(capacityHistoryInstant('2026-01-01T01:00:00.123456+01:00')).toBe(capacityHistoryInstant('2026-01-01T00:00:00.123456Z'))
  expect(compareCapacityHistory({ atTime: '2026-01-01T00:00:00.000002Z', id: '00000000-0000-0000-0000-000000000000' }, { atTime: '2026-01-01T00:00:00.000001Z', id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' })).toBe(1)
  expect(compareCapacityHistory({ atTime: '2026-01-01T00:00:00Z', id: '00000000-0000-0000-0000-000000000000' }, { atTime: '2026-01-01T00:00:00Z', id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' })).toBe(-1)
  for (const date of ['2026-02-30T00:00:00Z', '2026-01-01T00:00:00.1234567Z', '2026-01-01']) expect(() => capacityHistoryInstant(date)).toThrow('timestamp')
})
test('strict HR projections require prepared exact target/scope/authority and reject data leaks', () => {
  for (const original of hr.filter(w => w.expected.type.startsWith('hr-'))) {
    const w = prepared(original), result = resultFor(w)
    expect(() => assertCapacityResult(w, result)).not.toThrow()
    expect(() => assertCapacityResult(original, result)).toThrow('authority binding')
    for (const key of ['employeeId', 'scopeVersion', 'authorityKey']) expect(() => assertCapacityResult(w, { ...result, value: { ...result.value, [key]: 'wrong' } })).toThrow('mismatch')
    expect(() => assertCapacityResult(w, { ...result, value: { ...result.value, source_snapshot: {} } })).toThrow('envelope keys')
  }
  const w = prepared(hr.find(w => w.name === 'hr-history-first-one-cursor')), result = resultFor(w)
  result.value.rows[0].atTime = result.value.rows[0].atTime.replace('.000000', '.000001')
  expect(() => assertCapacityResult(w, result)).toThrow('microsecond event time')
  const cursorResult = resultFor(w)
  cursorResult.value.nextBefore = { ...cursorResult.value.nextBefore, id: '00000000-0000-0000-0000-000000000000' }
  expect(() => assertCapacityResult(w, cursorResult)).toThrow('lossless history cursor')
})
test('read_private never falls back to own/approval/other grants, and request IDs remain target-bound', () => {
  for (const role of ['owner', 'approver', 'configure', 'adjust', 'calendar', 'manage-access', 'director', 'unrelated']) {
    for (const endpoint of ['list', 'detail', 'history']) expect(hr.find(w => w.name === `hr-${role}-${endpoint}-denied`).expected).toEqual({ type: 'error', sqlstate: '42501', code: 'REQUEST_ACCESS_DENIED' })
  }
  for (const name of ['hr-read-private-unrelated-target-denied', 'hr-wrong-target-request-detail-denied', 'hr-wrong-target-request-history-denied', 'hr-guessed-request-detail-denied', 'hr-guessed-request-history-denied']) expect(hr.find(w => w.name === name).expected.sqlstate).toBe('42501')
  expect(hr.find(w => w.name === 'hr-history-partial-cursor-denied').expected.sqlstate).toBe('22023')
})

import { runCapacityMeasurement } from '../database/ihr/capacity-measure.mjs'
import { AS_OF, validateCapacityFixture } from '../database/ihr/capacity-fixture.mjs'
test('sampler binds HR expected authority outside timing and retains the binding with each observation', async () => {
  const generated = validateCapacityFixture(buildCapacityFixture()), workload = hr.find(w => w.name === 'hr-requests-first-50')
  const actions: string[] = [], records: any[] = [], seal = unitSeal(), plans = buildCapacityPlans()
  let clock = 0
  const openSession = async () => ({
    async query(sql: string) {
      const planResult = unitPlanQuery(sql, plans); if (planResult !== undefined) return planResult
      if (sql.includes("'allowed',current_database()")) return { allowed: true, currentDate: AS_OF, settings: { jit: 'off', fsync: 'on', full_page_writes: 'on' } }
      if (sql.includes('to_jsonb(i)')) return { count: 1, rows: [{ seed: 'ihr-capacity-v1-20261003', input_hash: generated.materializedInputHash, uuid_hash: generated.fictionalUuidHash, as_of: AS_OF }] }
      if (sql.includes('validate()') || sql.includes("'requests',(SELECT count")) return { requests: 10000, days: 60000, accounts: 1500, activePeople: 500, maxCommittedMinutes: 2040 }
      if (sql.includes('fingerprint()')) return seal.fingerprint
      if (sql === workload.prepareExpectedSql) { actions.push('binding'); return binding }
      if (sql.includes("'role',current_user")) { actions.push('role-proof'); return { role: 'authenticated', nonBypass: true, nonOwner: true } }
      if (sql === 'BEGIN READ ONLY' || sql === 'COMMIT') actions.push(sql)
      if (sql.startsWith('SELECT pg_temp.capacity_capture(')) { actions.push('RPC'); return resultFor(prepared(workload)) }
      return null
    }, async close() {},
  })
  const receipt = await runCapacityMeasurement({ environment: { PGHOST: '127.0.0.1', PGDATABASE: 'pilot_test', PGUSER: 'postgres' }, openSession,
    sealedBaseline: seal, restoreBaseline: async () => unitRestoreProof(seal), evidence: unitEvidence,
    emit: async (kind: string, record: any) => { if (kind === 'sample') records.push(record) }, now: () => { actions.push('timer'); clock += 10; return clock }, workloads: [workload], plans,
  })
  expect(receipt.workloads[0].stats.n).toBe(30)
  expect(records).toHaveLength(35)
  expect(records.every(r => r.authorityBinding.scopeVersion === binding.scopeVersion && r.authorityBinding.authorityKey === binding.authorityKey)).toBe(true)
  for (let i = 0; i < actions.length; i++) if (actions[i] === 'binding') expect(actions.slice(i, i + 7)).toEqual(['binding', 'role-proof', 'timer', 'BEGIN READ ONLY', 'RPC', 'COMMIT', 'timer'])
})
