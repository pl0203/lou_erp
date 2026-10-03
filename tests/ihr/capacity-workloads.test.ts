import { unitEvidence, unitSeal, unitRestoreProof, unitPlanQuery, unitExplain } from './capacity-control-fixture'
import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { AS_OF, buildCapacityFixture, validateCapacityFixture } from '../database/ihr/capacity-fixture.mjs'
import { buildCapacitySql } from '../database/ihr/capacity-sql.mjs'
import { assertCapacityResult, buildCapacityPlans, buildCapacityWorkloads } from '../database/ihr/capacity-workloads.mjs'
import { assertPlanGate, runCapacityMeasurement, summarizeSamples } from '../database/ihr/capacity-measure.mjs'
const workloads = buildCapacityWorkloads()

test('declared public workloads use frozen cursor/page interfaces with exact populated, empty and denied results', () => {
  expect(workloads).toHaveLength(104)
  expect(new Set(workloads.map(w => w.name)).size).toBe(workloads.length)
  expect(workloads.filter(w => w.role === 'postgres').map(w => w.name)).toEqual(['quote-owner-historical-maximum-366'])
  for (const name of ['own-history-first-50', 'own-history-deep-50', 'assigned-large-team-first-50', 'assigned-large-team-deep-50', 'private-hr-balance-first-50', 'private-hr-balance-deep-50']) {
    expect(workloads.find(w => w.name === name).expected.rows).toHaveLength(50)
  }
  expect(workloads.find(w => w.name === 'own-history-empty').expected.rows).toEqual([])
  expect(workloads.find(w => w.name === 'calendar-93-broad-approved').expected.value.length).toBeGreaterThan(500)
  expect(workloads.find(w => w.name === 'quote-public-maximum-366-missing-2027').expected).toMatchObject({ sqlstate: '55000', code: 'ACCOUNT_UNAVAILABLE' })
  expect(workloads.find(w => w.name === 'quote-owner-historical-maximum-366').expected).toMatchObject({ code: 'INSUFFICIENT_ALLOWANCE' })
  expect(workloads.filter(w => w.name.includes('whole-request-saturday')).map(w => w.expected.code)).toEqual(Array(3).fill('DURATION_EXCEEDS_SHIFT'))
  expect(workloads.filter(w => w.kind === 'mutation')).toHaveLength(6)
})
test('output assertions reject wrong IDs/cursors, partial counts, changed snapshots and false permission success', () => {
  const page = workloads.find(w => w.name === 'own-history-first-50')
  const valid = { ok: true, value: { rows: page.expected.rows, nextBefore: page.expected.nextBefore } }
  expect(() => assertCapacityResult(page, valid)).not.toThrow()
  expect(() => assertCapacityResult(page, { ok: true, value: { ...valid.value, nextBefore: null } })).toThrow('cursor')
  const denial = workloads.find(w => w.name === 'assigned-configure-only-denied')
  expect(() => assertCapacityResult(denial, { ok: true, value: [] })).toThrow('controlled rejection')
  expect(() => assertCapacityResult(denial, { ok: false, sqlstate: '42501', code: 'REQUEST_ACCESS_DENIED' })).not.toThrow()
  const counts = workloads.find(w => w.name === 'counts-large-team-full')
  const countValue = counts.expected.value
  expect(() => assertCapacityResult(counts, { ok: true, value: { pendingCancellation: countValue.pendingCancellation, pendingLeave: countValue.pendingLeave } })).not.toThrow()
  expect(() => assertCapacityResult(counts, { ok: true, value: { ...countValue, pendingLeave: 50 } })).toThrow('mismatch')
  const detail = workloads.find(w => w.name === 'own-detail-days')
  const detailValue = { ...detail.expected.summary, days: detail.expected.days, allocations: detail.expected.allocations, reason: detail.expected.reason, approverName: detail.expected.approverName }
  expect(() => assertCapacityResult(detail, { ok: true, value: detailValue })).not.toThrow()
  expect(() => assertCapacityResult(detail, { ok: true, value: { ...detailValue, days: [] } })).toThrow('immutable days')
})
test('nearest-rank statistics preserve all samples and enforce minimum sample count', () => {
  const samples = [...Array.from({ length: 29 }, (_, i) => i + 1), 5000]
  expect(summarizeSamples(samples)).toEqual({ n: 30, min: 1, p50: 15, p95: 29, max: 5000, rawMs: samples })
  expect(() => summarizeSamples(samples.slice(1))).toThrow('At least 30')
  expect(() => summarizeSamples([...samples.slice(1), NaN])).toThrow('finite')
})
test('plan gate detects nested narrow sequential scans without rejecting allowed broad scans', () => {
  const plans = buildCapacityPlans()
  const narrow = plans.find(p => p.name === 'narrow-calendar-employee-date')
  const bad = unitExplain(narrow, { 'Node Type': 'Seq Scan' })
  expect(() => assertPlanGate(plans.find(p => p.name === 'narrow-calendar-employee-date'), bad)).toThrow('full-table scan')
  expect(() => assertPlanGate(plans.find(p => p.name === 'broad-calendar-authorized-scope'), bad)).not.toThrow()
})
test('SQL artifact retains triggers, canonical quote validation, fixed hashes and owner marker guards', () => {
  const sql = buildCapacitySql()
  expect(sql).toContain("current_database()<>'pilot_test'")
  expect(sql).toContain("purpose='disposable-pilot-ci'")
  expect(sql).toContain('private.ihr_leave_quote_v1(employee')
  expect(sql).toContain('private.ihr_leave_day_snapshot(employee')
  expect(sql).toContain('SELECT ihr_capacity_fixture.validate()')
  expect(sql).toContain('SELECT ihr_capacity_fixture.fingerprint()')
  expect(sql).not.toMatch(/DISABLE TRIGGER|session_replication_role|TRUNCATE|DROP DATABASE|CREATE DATABASE/)
  const sampler = readFileSync('tests/database/ihr/capacity-measure.mjs', 'utf8')
  expect(sampler).not.toMatch(/node:child_process|spawn\(|execFile|pg_ctl|initdb/)
  expect(sampler).toContain('proof.nonBypass !== true || proof.nonOwner !== true')
})
test('target denial occurs before opening sessions or calling restoration', async () => {
  let called = false
  await expect(runCapacityMeasurement({ environment: { PGHOST: 'hosted.invalid', PGDATABASE: 'pilot_test', PGUSER: 'postgres' }, openSession() { called = true }, restoreBaseline() { called = true } })).rejects.toThrow('Explicit loopback')
  expect(called).toBe(false)
})
test('sampler restores outside timer, includes commit and retains five warmups and thirty observations', async () => {
  const generated = validateCapacityFixture(buildCapacityFixture()), actions: string[] = [], emitted: any[] = []
  const workload = workloads.find(w => w.name === 'mutation-adjustment')
  const seal = unitSeal(), plans = buildCapacityPlans()
  let mutationStateReads = 0
  let clock = 0
  const openSession = async () => ({
    async query(sql: string) {
      const planResult = unitPlanQuery(sql, plans); if (planResult !== undefined) return planResult
      if (sql === 'BEGIN' || sql === 'COMMIT') actions.push(sql)
      if (sql.includes("'allowed',current_database()")) return { allowed: true, currentDate: AS_OF, settings: { jit: 'off', fsync: 'on', full_page_writes: 'on' } }
      if (sql.includes('to_jsonb(i)')) return { count: 1, rows: [{ seed: 'ihr-capacity-v1-20261003', input_hash: generated.materializedInputHash, uuid_hash: generated.fictionalUuidHash, as_of: AS_OF }] }
      if (sql.includes('validate()') || sql.includes("'requests',(SELECT count")) return { requests: 10000, days: 60000, accounts: 1500, activePeople: 500, maxCommittedMinutes: 2040 }
      if (sql.includes('fingerprint()')) return seal.fingerprint
      if (sql.includes("'capacityMutationState'")) { const after = mutationStateReads++ % 2 === 1; return { account: {id: workload.expected.id, version: after ? 3 : 2, allowance_minutes: after ? 5340 : 5400, reserved_minutes: 0, used_minutes: 0}, ledgerRows: after ? 2 : 1, adminEvents: after ? 1 : 0 } }
      if (sql.includes('to_jsonb(a)')) return { version: 2, allowance_minutes: 5400 }
      if (sql.includes("'role',current_user")) return { role: 'authenticated', nonBypass: true, nonOwner: true }
      if (sql.startsWith('SELECT pg_temp.capacity_capture(')) { actions.push('RPC'); return { ok: true, value: { id: workload.expected.id, version: 3, operation: 'adjust_balance' } } }
      return null
    }, async close() { actions.push('close') },
  })
  const receipt = await runCapacityMeasurement({ environment: { PGHOST: '127.0.0.1', PGDATABASE: 'pilot_test', PGUSER: 'postgres' }, openSession,
    sealedBaseline: seal, restoreBaseline: async () => { actions.push('restore'); return unitRestoreProof(seal) },
    evidence: unitEvidence,
    emit: async (kind: string, record: any) => { emitted.push({ kind, record }) }, now: () => { actions.push('timer'); clock += 10; return clock }, workloads: [workload], plans,
  })
  expect(receipt.workloads[0].stats.n).toBe(30)
  expect(receipt.workloads[0].warmupsMs).toHaveLength(5)
  expect(emitted.filter(e => e.kind === 'sample')).toHaveLength(35)
  expect(actions.filter(a => a === 'restore')).toHaveLength(37) // initial sealed verification, 35 mutations, then plans
  for (let i = 0; i < actions.length; i++) if (actions[i] === 'BEGIN') expect(actions.slice(i - 1, i + 4)).toEqual(['timer', 'BEGIN', 'RPC', 'COMMIT', 'timer'])
})

test('published fixture, roster and workload manifests match the generator exactly', () => {
  const fixture = buildCapacityFixture()
  const manifest = JSON.parse(readFileSync('tests/database/ihr/capacity-fixture-manifest.json', 'utf8'))
  expect(manifest.materializedInputHash).toBe(validateCapacityFixture(fixture).materializedInputHash)
  const roster = readFileSync('tests/database/ihr/capacity-rosters.csv', 'utf8').trim().split('\n').slice(1)
  expect(roster).toEqual(fixture.roster.map(r => `${r.group},${r.date},${r.minutes},2024-01-06,${r.group === 'A'},2024-01-01,2027-10-05`))
  const published = JSON.parse(readFileSync('tests/database/ihr/capacity-workload-manifest.json', 'utf8'))
  expect(published.workloads).toEqual(workloads)
  expect(published.plans).toEqual(buildCapacityPlans())
  const audiences = JSON.parse(readFileSync('tests/database/ihr/capacity-audiences.json', 'utf8'))
  expect(audiences.people).toEqual(fixture.people)
  expect(audiences.memberships).toEqual(fixture.memberships)
})
