// Unit orchestration doubles only; no PostgreSQL, permission or timing proof.
import { BASELINE_TABLES, BASELINE_SEQUENCES } from '../database/ihr/capacity-baseline.mjs'
import { buildCapacityFixture, validateCapacityFixture } from '../database/ihr/capacity-fixture.mjs'
import { buildCapacityPlans } from '../database/ihr/capacity-plans.mjs'
export const unitEvidence = { cpu: 'unit harness only', ramBytes: 1, storage: 'unit', os: 'unit', sourceCommit: 'a'.repeat(40), sourceTree: 'b'.repeat(40), migrationHashes: { unit: 'c'.repeat(64) }, fixtureGeneratorHash: 'd'.repeat(64) }
export function unitFingerprint() {
  return { format: 'ihr-capacity-baseline-v3', sha256: 'f'.repeat(64), diagnostics: { sequenceLogCounters: Object.fromEntries(BASELINE_SEQUENCES.map(name => [name, '0'])) },
    tables: Object.fromEntries(BASELINE_TABLES.map(name => [name, { rows: ['ihr_capacity_fixture.identity', 'public.pilot_fixture_marker', 'private.ihr_leave_scope_revision'].includes(name) ? 1 : 0, sha256: 'e'.repeat(64) }])),
    sequences: Object.fromEntries(BASELINE_SEQUENCES.map(name => [name, { state: { last_value: '1', is_called: true }, configuration: { seqtypid: '20', seqstart: '1', seqincrement: '1', seqmax: '9223372036854775807', seqmin: '1', seqcache: '1', seqcycle: false } }])) }
}
export function unitSeal() { return { format: 'ihr-capacity-seal-v2', targetDatabase: 'pilot_test', method: 'coordinator-owned-sealed-logical-dump', artifact: { sha256: 'a'.repeat(64), bytes: 10 }, logicalInputHash: validateCapacityFixture(buildCapacityFixture()).materializedInputHash,
  sourceCommit: unitEvidence.sourceCommit, sourceTree: unitEvidence.sourceTree, migrationHashes: unitEvidence.migrationHashes, fixtureGeneratorHash: unitEvidence.fixtureGeneratorHash, fingerprint: unitFingerprint() } }
export const unitRestoreProof = (seal: any) => ({ targetDatabase: 'pilot_test', artifactSha256: seal.artifact.sha256, baselineSha256: seal.fingerprint.sha256, restoredFromSealedArtifact: true, terminalSessionsClosed: true })
export function unitExplain(plan: any, changed: Record<string, any> = {}) {
  const node = (relation: string) => ({ 'Node Type': 'Index Scan', 'Relation Name': relation, 'Actual Rows': 1, 'Actual Loops': 1, 'Shared Hit Blocks': 1, 'Shared Read Blocks': 0, ...changed })
  return [{ 'Planning Time': .1, 'Execution Time': .2, Plan: { 'Node Type': 'Aggregate', 'Actual Rows': 1, 'Actual Loops': 1, 'Shared Hit Blocks': 1, 'Shared Read Blocks': 0, Plans: plan.requiredRelations.map(node) } }]
}
export function unitPlanQuery(sql: string, plans = buildCapacityPlans()) {
  const calendar = plans.find(p => p.calendarAuthorization?.sql === sql)
  if (calendar) return { actor: calendar.calendarAuthorization.actor, audience: calendar.calendarAuthorization.audience,
    employeeIds: [...calendar.calendarAuthorization.employeeIds].reverse(), authorizedAt: '2026-10-03T12:00:00+00:00' }
  if (sql.startsWith('EXPLAIN ')) return unitExplain(plans.find(p => sql.endsWith(p.sql)))
  if (sql.includes('FROM pg_indexes')) return [{ indexname: 'ihr_leave_hr_history_page', schemaname: 'private', tablename: 'ihr_leave_request_events', indexdef: 'CREATE INDEX ihr_leave_hr_history_page ON private.ihr_leave_request_events USING btree (request_id, at_time DESC, id DESC)' }]
  return undefined
}
