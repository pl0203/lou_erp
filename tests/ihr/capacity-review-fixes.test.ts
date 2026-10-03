import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { assertPlanGate } from '../database/ihr/capacity-measure.mjs'
import { buildCapacityPlans } from '../database/ihr/capacity-workloads.mjs'
import { buildCapacityHrWorkloads } from '../database/ihr/capacity-hr-workloads.mjs'

test('baseline fingerprint includes authority, command/audit and sequence state without removing timestamps', () => {
  const sql = readFileSync('tests/database/ihr/capacity-validate.sql', 'utf8')
  for (const relation of ['auth.users', 'public.users', 'private.ihr_leave_commands', 'private.ihr_leave_scope_revision', 'private.ihr_leave_calendar_registry', 'public.ihr_leave_admin_events', 'private.ihr_leave_policy_owners', 'private.ihr_leave_request_reassignments', 'public.ihr_leave_requests_sequence_seq', 'public.ihr_leave_ledger_sequence_seq']) expect(sql).toContain(relation)
  expect(sql).not.toContain("-''updated_at''")
})
test('measurement requires a sealed logical artifact and independently verified restoration', () => {
  const source = readFileSync('tests/database/ihr/capacity-measure.mjs', 'utf8')
  expect(source).toContain('sealedBaseline')
  expect(source).toContain('assertRestorationProof')
})
test('missing plans fail closed and calendar query preserves actual security-definer predicate', () => {
  const plan = buildCapacityPlans().find(p => p.name === 'narrow-calendar-employee-date')
  expect(() => assertPlanGate(plan, null)).toThrow()
  expect(plan.sql).toContain('private.ihr_leave_calendar_can_read')
  expect(plan.sql).toContain('jsonb_agg')
})
test('private request history contains genuine populated first and deep pages of fifty', () => {
  const hr = buildCapacityHrWorkloads()
  const first = hr.find(w => w.name === 'hr-history-first-page-50').expected
  expect(first.rows).toHaveLength(50)
  expect(first.nextBefore).not.toBeNull()
  expect(hr.find(w => w.name === 'hr-history-deep-page-50')?.expected.rows).toHaveLength(50)
})

import { assertBaselineMatches, assertCapacityIdentity, assertRestorationProof, assertSealedBaseline, BASELINE_TABLES, BASELINE_SEQUENCES } from '../database/ihr/capacity-baseline.mjs'
import { assertCapacityPlanInventory } from '../database/ihr/capacity-plans.mjs'
import { assertMutationState, runCapacityMeasurement, summarizeSamples } from '../database/ihr/capacity-measure.mjs'
import { AS_OF, buildCapacityFixture, validateCapacityFixture } from '../database/ihr/capacity-fixture.mjs'
import { buildCapacityWorkloads } from '../database/ihr/capacity-workloads.mjs'
import { unitEvidence, unitFingerprint, unitSeal, unitRestoreProof, unitExplain } from './capacity-control-fixture'

test('every previously omitted authority/command/audit/registry class and sequence drift is rejected', () => {
  const sealed = unitFingerprint()
  const omitted = ['auth.users', 'public.users', 'private.ihr_leave_commands', 'private.ihr_leave_scope_revision', 'private.ihr_leave_calendar_registry', 'public.ihr_leave_admin_events', 'private.ihr_leave_policy_owners', 'private.ihr_leave_request_reassignments']
  for (const relation of omitted) {
    const drift = structuredClone(sealed)
    drift.tables[relation].sha256 = '1'.repeat(64) // Even retaining a copied aggregate hash cannot hide map drift.
    expect(() => assertBaselineMatches(sealed, drift)).toThrow('differs')
    const missing = structuredClone(sealed); delete missing.tables[relation]
    expect(() => assertBaselineMatches(sealed, missing)).toThrow('inventory')
  }
  for (const name of BASELINE_SEQUENCES) {
    const drift = structuredClone(sealed); drift.sequences[name].state.last_value = (BigInt(drift.sequences[name].state.last_value) + 1n).toString()
    expect(() => assertBaselineMatches(sealed, drift)).toThrow('differs')
    const called = structuredClone(sealed); called.sequences[name].state.is_called = false
    expect(() => assertBaselineMatches(sealed, called)).toThrow('differs')
  }
  expect(BASELINE_TABLES).toHaveLength(32)
  const sql = readFileSync('tests/database/ihr/capacity-validate.sql', 'utf8')
  for (const relation of [...BASELINE_TABLES, ...BASELINE_SEQUENCES]) expect(sql).toContain(`'${relation}'`)
  expect(sql).toContain('to_jsonb(r)::text')
  expect(sql).toContain('Complete iHR table inventory mismatch')
  expect(sql).toContain('Complete iHR sequence inventory mismatch')
})
test('sealed artifact, exact singleton identity and restored artifact proof cannot be replaced with regeneration claims', () => {
  const seal = unitSeal(), generated = validateCapacityFixture(buildCapacityFixture())
  expect(() => assertSealedBaseline(seal, unitEvidence, generated)).not.toThrow()
  expect(() => assertSealedBaseline({ ...seal, method: 'regenerate-from-sql' }, unitEvidence, generated)).toThrow('sealed logical dump')
  expect(() => assertSealedBaseline({ ...seal, logicalInputHash: '1'.repeat(64) }, unitEvidence, generated)).toThrow('sealed logical dump')
  const proof = unitRestoreProof(seal)
  expect(() => assertRestorationProof(proof, seal)).not.toThrow()
  for (const patch of [{ artifactSha256: 'f'.repeat(64) }, { baselineSha256: 'a'.repeat(64) }, { terminalSessionsClosed: false }, { restoredFromSealedArtifact: false }]) expect(() => assertRestorationProof({ ...proof, ...patch }, seal)).toThrow('proof')
  const identity = { count: 1, rows: [{ seed: 'ihr-capacity-v1-20261003', input_hash: generated.materializedInputHash, uuid_hash: generated.fictionalUuidHash, as_of: AS_OF }] }
  expect(() => assertCapacityIdentity(identity, generated, AS_OF)).not.toThrow()
  expect(() => assertCapacityIdentity({ count: 2, rows: [...identity.rows, ...identity.rows] }, generated, AS_OF)).toThrow('Exactly one')
  expect(() => assertCapacityIdentity({ count: 0, rows: [] }, generated, AS_OF)).toThrow('Exactly one')
})
test('missing, malformed, opaque and incomplete plan evidence fails without relaxing narrow scan checks', () => {
  const plans = buildCapacityPlans(), calendar = plans.find(p => p.name === 'narrow-calendar-employee-date')
  expect(() => assertCapacityPlanInventory([])).toThrow('inventory')
  expect(() => assertCapacityPlanInventory(plans.slice(1))).toThrow('inventory')
  expect(() => assertCapacityPlanInventory(plans.map(p => p === calendar ? { ...p, sql: 'SELECT 1' } : p))).toThrow('changed')
  for (const missing of [null, [], {}, [{ Plan: {} }], [{ Plan: { 'Node Type': 'Result' }, 'Planning Time': 0, 'Execution Time': 0 }]]) expect(() => assertPlanGate(calendar, missing)).toThrow()
  const opaque = unitExplain({ requiredRelations: [] }); opaque[0].Plan['Node Type'] = 'Function Scan'
  expect(() => assertPlanGate(calendar, opaque)).toThrow('opaque')
  expect(() => assertPlanGate(calendar, unitExplain(calendar, { 'Node Type': 'Seq Scan' }))).toThrow('full-table scan')
  expect(() => assertPlanGate(calendar, unitExplain(calendar))).not.toThrow()
  expect(calendar.sql).not.toMatch(/r\.employee_id\s*=/)
  expect(calendar.sql).toContain("private.ihr_leave_calendar_can_read")
  expect(calendar.source.definition).toContain("private.ihr_leave_calendar_can_read(actor,r.employee_id,p_audience,authorized_at)")
  const history = plans.find(p => p.name === 'narrow-private-hr-history-cursor')
  for (const token of ['(at_time,id)<', 'ORDER BY at_time DESC,id DESC LIMIT 50', 'JOIN public.users', 'LEFT JOIN LATERAL', 'ihr_leave_request_reassignments', 'ihr_leave_cancellation_attempts']) expect(history.sql).toContain(token)
  expect(history.source.commit).toBe('0c687a61034d96bbbb7c349bf7478090cf0a6171')
})
test('dense cancellation history is legal, fully funded and preserves final cardinalities and refunds', () => {
  const f = buildCapacityFixture(), report = validateCapacityFixture(f), dense = f.requests.find(r => r.id === f.denseHistory.requestId)
  expect(dense.transitions).toHaveLength(124)
  expect(dense.transitions.filter(s => s === 'cancellation_declined')).toHaveLength(60)
  expect(dense.transitions.filter(s => s === 'cancellation_requested')).toHaveLength(61)
  expect(dense.status).toBe('cancelled')
  expect(report).toMatchObject({ activePeople: 500, accounts: 1500, requests: 10000, days: 60000, ledger: 22000, events: 22620, attempts: 2060, decisions: 1560, reversals: 1500, peakCommittedMinutes: 4275, maxCommittedMinutes: 2040 })
  const invalid = structuredClone(f); invalid.requests.find(r => r.id === f.denseHistory.requestId).transitions[2] = 'cancellation_declined'
  expect(() => validateCapacityFixture(invalid)).toThrow('legal transition order')
})
test('failed assertions retain the current captured result, phase/index and elapsed time before terminal failure', async () => {
  const seal = unitSeal(), generated = validateCapacityFixture(buildCapacityFixture()), workload = buildCapacityWorkloads().find(w => w.name === 'own-history-first-50')
  const records: any[] = []; let clock = 0, live = 0
  const openSession = async () => {
    live++
    return { async query(sql: string) {
      if (sql.includes("'allowed',current_database()")) return { allowed: true, currentDate: AS_OF, settings: { jit: 'off', fsync: 'on', full_page_writes: 'on' } }
      if (sql.includes('to_jsonb(i)')) return { count: 1, rows: [{ seed: 'ihr-capacity-v1-20261003', input_hash: generated.materializedInputHash, uuid_hash: generated.fictionalUuidHash, as_of: AS_OF }] }
      if (sql.includes('validate()')) return { requests: 10000, days: 60000, accounts: 1500, activePeople: 500, maxCommittedMinutes: 2040 }
      if (sql.includes('fingerprint()')) return seal.fingerprint
      if (sql.includes("'role',current_user")) return { role: 'authenticated', nonBypass: true, nonOwner: true }
      if (sql.startsWith('SELECT pg_temp.capacity_capture(')) return { ok: true, value: { rows: [], nextBefore: null } }
      return null
    }, async close() { live-- } }
  }
  await expect(runCapacityMeasurement({ environment: { PGHOST: '127.0.0.1', PGDATABASE: 'pilot_test', PGUSER: 'postgres' }, openSession, sealedBaseline: seal, evidence: unitEvidence,
    restoreBaseline: async () => { expect(live).toBe(0); return unitRestoreProof(seal) }, emit: async (kind: string, record: any) => { records.push({ kind, record: structuredClone(record) }) }, now: () => { clock += 10; return clock }, workloads: [workload], plans: buildCapacityPlans(),
  })).rejects.toThrow('mismatch')
  const observed = records.find(r => r.kind === 'observation').record
  expect(observed).toMatchObject({ name: workload.name, phase: 'warmup', index: 0, elapsedMs: 10, asserted: false, result: { ok: true, value: { rows: [], nextBefore: null } } })
  const failed = records.find(r => r.kind === 'failed-observation').record
  expect(failed.error.message).toContain('mismatch')
  const final = records.find(r => r.kind === 'failure').record
  expect(final.workloads[0].outputs[0].result).toEqual(observed.result)
  expect(final.currentObservation.elapsedMs).toBe(10)
  expect(final.capacityAccepted).toBe(false)
  expect(live).toBe(0)
})
test('adjustment commit requires a corresponding admin-audit increment and statistics retain minimum', () => {
  const w = buildCapacityWorkloads().find(w => w.name === 'mutation-adjustment'), id = w.expected.id
  const before = { account: { id, version: 2, allowance_minutes: 5400, used_minutes: 0, reserved_minutes: 0 }, ledgerRows: 1, adminEvents: 0 }
  const after = { account: { id, version: 3, allowance_minutes: 5340, used_minutes: 0, reserved_minutes: 0 }, ledgerRows: 2, adminEvents: 0 }
  const receipt = { id, version: 3, operation: 'adjust_balance' }
  expect(() => assertMutationState(w, before, after, receipt)).toThrow('admin audit')
  expect(() => assertMutationState(w, before, { ...after, adminEvents: 1 }, receipt)).not.toThrow()
  expect(summarizeSamples(Array.from({ length: 30 }, (_, i) => i + 7))).toMatchObject({ min: 7, max: 36, p50: 21, p95: 35 })
})
