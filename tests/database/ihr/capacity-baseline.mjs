// Complete fixture-relevant state. Empty relations and all timestamp-bearing source JSON remain significant.
export const BASELINE_TABLES = Object.freeze([
  'auth.users', 'public.users', 'public.pilot_fixture_marker', 'ihr_capacity_fixture.identity',
  'public.ihr_leave_members', 'public.ihr_leave_access_grants', 'public.ihr_leave_approvers', 'public.ihr_leave_admin_events',
  'private.ihr_leave_commands', 'private.ihr_leave_scope_revision', 'private.ihr_leave_calendar_registry',
  'public.ihr_leave_policies', 'public.ihr_leave_calendars', 'public.ihr_leave_calendar_exceptions', 'public.ihr_saturday_groups',
  'public.ihr_saturday_memberships', 'public.ihr_saturday_roster', 'public.ihr_leave_accounts', 'public.ihr_leave_ledger',
  'public.ihr_leave_requests', 'public.ihr_leave_request_days', 'public.ihr_leave_request_allocations', 'public.ihr_leave_occupancy',
  'private.ihr_leave_request_events', 'private.ihr_leave_cancellation_attempts', 'private.ihr_leave_cancellation_decisions',
  'private.ihr_leave_charge_reversals', 'private.ihr_leave_policy_owners', 'private.ihr_leave_access_manifests',
  'private.ihr_leave_governance_approvals', 'private.ihr_leave_governance_references', 'private.ihr_leave_request_reassignments',
])
export const BASELINE_SEQUENCES = Object.freeze(['public.ihr_leave_requests_sequence_seq', 'public.ihr_leave_ledger_sequence_seq'])
export const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const integerText = value => typeof value === 'string' && /^(?:0|-?[1-9][0-9]*)$/.test(value)
const sequenceIntegerFields = ['seqcache', 'seqincrement', 'seqmax', 'seqmin', 'seqstart', 'seqtypid']
export function validateCapacityFingerprint(fingerprint) {
  if (fingerprint?.format !== 'ihr-capacity-baseline-v3' || !hash(fingerprint.sha256)) throw new Error('Complete baseline format/hash required')
  if (!same(Object.keys(fingerprint).filter(key => key !== 'diagnostics').sort(), ['format', 'sequences', 'sha256', 'tables'])) throw new Error('Unexpected baseline fields')
  if (!same(Object.keys(fingerprint.tables ?? {}).sort(), [...BASELINE_TABLES].sort()) || !same(Object.keys(fingerprint.sequences ?? {}).sort(), [...BASELINE_SEQUENCES].sort())) throw new Error('Complete baseline table/sequence inventory mismatch')
  for (const table of BASELINE_TABLES) {
    const entry = fingerprint.tables[table]
    if (!same(Object.keys(entry ?? {}).sort(), ['rows', 'sha256']) || !Number.isSafeInteger(entry.rows) || entry.rows < 0 || !hash(entry.sha256)) throw new Error(`Malformed baseline relation ${table}`)
  }
  if (fingerprint.tables['ihr_capacity_fixture.identity'].rows !== 1 || fingerprint.tables['public.pilot_fixture_marker'].rows !== 1 || fingerprint.tables['private.ihr_leave_scope_revision'].rows !== 1) throw new Error('Singleton baseline identity/marker/revision required')
  for (const name of BASELINE_SEQUENCES) {
    const seq = fingerprint.sequences[name]
    if (!same(Object.keys(seq ?? {}).sort(), ['configuration', 'state']) || !same(Object.keys(seq.state ?? {}).sort(), ['is_called', 'last_value'])
      || typeof seq.state.is_called !== 'boolean' || !integerText(seq.state.last_value)
      || !same(Object.keys(seq.configuration ?? {}).sort(), ['seqcache', 'seqcycle', 'seqincrement', 'seqmax', 'seqmin', 'seqstart', 'seqtypid'])
      || typeof seq.configuration.seqcycle !== 'boolean' || sequenceIntegerFields.some(field => !integerText(seq.configuration[field]))) throw new Error(`Malformed baseline sequence ${name}`)
  }
  // Only the separately named PostgreSQL WAL/prelogging counters are diagnostic.
  if (fingerprint.diagnostics !== undefined && (!same(Object.keys(fingerprint.diagnostics ?? {}), ['sequenceLogCounters'])
    || !same(Object.keys(fingerprint.diagnostics.sequenceLogCounters ?? {}).sort(), [...BASELINE_SEQUENCES].sort())
    || BASELINE_SEQUENCES.some(name => !integerText(fingerprint.diagnostics.sequenceLogCounters[name])))) throw new Error('Malformed sequence WAL diagnostics')
  return fingerprint
}
export function assertBaselineMatches(sealed, actual) {
  validateCapacityFingerprint(sealed); validateCapacityFingerprint(actual)
  const logical = ({ diagnostics, ...retained }) => retained
  if (!same(logical(actual), logical(sealed))) throw new Error('Restored complete logical baseline differs from sealed dump')
}
export function assertSealedBaseline(seal, evidence, generated) {
  if (seal?.format !== 'ihr-capacity-seal-v2' || seal.targetDatabase !== 'pilot_test' || seal.method !== 'coordinator-owned-sealed-logical-dump'
    || !hash(seal.artifact?.sha256) || !Number.isSafeInteger(seal.artifact?.bytes) || seal.artifact.bytes < 1
    || seal.logicalInputHash !== generated.materializedInputHash || seal.sourceCommit !== evidence.sourceCommit || seal.sourceTree !== evidence.sourceTree
    || seal.fixtureGeneratorHash !== evidence.fixtureGeneratorHash || !same(seal.migrationHashes, evidence.migrationHashes)) throw new Error('Pinned once-materialized sealed logical dump is required')
  validateCapacityFingerprint(seal.fingerprint)
  return seal
}
export function assertRestorationProof(proof, seal) {
  if (proof?.artifactSha256 !== seal.artifact.sha256 || proof.baselineSha256 !== seal.fingerprint.sha256 || proof.targetDatabase !== 'pilot_test'
    || proof.restoredFromSealedArtifact !== true || proof.terminalSessionsClosed !== true) throw new Error('Verified terminal-close sealed-dump restoration proof required')
}
export function assertCapacityIdentity(identity, generated, asOf) {
  if (identity?.count !== 1 || !Array.isArray(identity.rows) || identity.rows.length !== 1) throw new Error('Exactly one capacity identity row required')
  const row = identity.rows[0]
  if (row.input_hash !== generated.materializedInputHash || row.uuid_hash !== generated.fictionalUuidHash || row.as_of !== asOf || row.seed !== 'ihr-capacity-v1-20261003') throw new Error('Materialized fixture identity mismatch')
}
