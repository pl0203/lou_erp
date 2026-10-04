import { expect, test } from 'vitest'
import { assertBaselineMatches, assertSealedBaseline, BASELINE_SEQUENCES, BASELINE_TABLES, validateCapacityFingerprint } from '../database/ihr/capacity-baseline.mjs'
import { buildCapacityFixture, validateCapacityFixture } from '../database/ihr/capacity-fixture.mjs'
import { unitEvidence, unitFingerprint, unitSeal } from './capacity-control-fixture'
import { buildCapacitySql } from '../database/ihr/capacity-sql.mjs'

function logicalFingerprint() {
  const result: any = structuredClone(unitFingerprint())
  result.format = 'ihr-capacity-baseline-v3'
  result.diagnostics = { sequenceLogCounters: Object.fromEntries(BASELINE_SEQUENCES.map(name => [name, '0'])) }
  for (const sequence of Object.values(result.sequences) as any[]) {
    delete sequence.state.log_cnt
    sequence.state.last_value = String(sequence.state.last_value)
    for (const key of Object.keys(sequence.configuration)) if (key !== 'seqcycle') sequence.configuration[key] = String(sequence.configuration[key])
  }
  return result
}

test('only separately recorded sequence WAL log counters may drift', () => {
  const sealed = logicalFingerprint(), restored = structuredClone(sealed)
  for (const name of BASELINE_SEQUENCES) restored.diagnostics.sequenceLogCounters[name] = '32'
  expect(() => assertBaselineMatches(sealed, restored)).not.toThrow()
  const withoutDiagnostics = structuredClone(restored); delete withoutDiagnostics.diagnostics
  expect(() => assertBaselineMatches(sealed, withoutDiagnostics)).not.toThrow()
  const hidden = structuredClone(restored); hidden.diagnostics.ignoredState = 'forbidden'
  expect(() => validateCapacityFingerprint(hidden)).toThrow()
  const extraState = structuredClone(restored); extraState.sequences[BASELINE_SEQUENCES[0]].state.log_cnt = '32'
  expect(() => validateCapacityFingerprint(extraState)).toThrow()
})

test('all sequence allocation/configuration and all 32 relation hashes remain exact', () => {
  const sealed = logicalFingerprint()
  for (const name of BASELINE_SEQUENCES) {
    for (const field of ['last_value', 'is_called']) {
      const drift = structuredClone(sealed)
      drift.sequences[name].state[field] = field === 'last_value' ? '2' : false
      expect(() => assertBaselineMatches(sealed, drift)).toThrow('differs')
    }
    for (const [field, value] of Object.entries(sealed.sequences[name].configuration)) {
      const drift = structuredClone(sealed)
      drift.sequences[name].configuration[field] = field === 'seqcycle' ? !value : (BigInt(value as string) + 1n).toString()
      expect(() => assertBaselineMatches(sealed, drift)).toThrow('differs')
    }
    const lossy = structuredClone(sealed); lossy.sequences[name].configuration.seqmax = Number('9223372036854775807')
    expect(() => validateCapacityFingerprint(lossy)).toThrow()
  }
  for (const table of BASELINE_TABLES) {
    const drift = structuredClone(sealed); drift.tables[table].sha256 = '1'.repeat(64)
    expect(() => assertBaselineMatches(sealed, drift)).toThrow('differs')
  }
})

test('adjacent bigint boundaries remain distinct even when JavaScript numbers would round them together', () => {
  const high = '9223372036854775807', adjacent = '9223372036854775806'
  expect(Number(high)).toBe(Number(adjacent))
  for (const name of BASELINE_SEQUENCES) {
    const sealed = logicalFingerprint(); sealed.sequences[name].state.last_value = high
    expect(() => validateCapacityFingerprint(sealed)).not.toThrow()
    const allocationDrift = structuredClone(sealed); allocationDrift.sequences[name].state.last_value = adjacent
    expect(() => assertBaselineMatches(sealed, allocationDrift)).toThrow('differs')
    const maximumDrift = structuredClone(sealed); maximumDrift.sequences[name].configuration.seqmax = adjacent
    expect(() => assertBaselineMatches(sealed, maximumDrift)).toThrow('differs')
  }
})

test('generated SQL serializes retained sequence integers as text and hashes only the logical payload', () => {
  const generated = buildCapacitySql()
  const sequence = generated.match(/EXECUTE format\(\$sequence\$([\s\S]*?)\$sequence\$,t\) INTO state,log_counter;/)
  expect(sequence).not.toBeNull()
  for (const name of BASELINE_SEQUENCES) expect(sequence![1].replace('%s', name).replace(/\s+/g, ' ').trim()).toBe(
    `SELECT jsonb_build_object('last_value',s.last_value::text,'is_called',s.is_called),s.log_cnt::text FROM ${name} s`,
  )
  const config = generated.match(/SELECT jsonb_build_object\('seqtypid'([\s\S]*?)INTO STRICT configuration/)
  expect(config).not.toBeNull()
  const projected = [...config![0].matchAll(/'(seq[a-z]+)',s\.(seq[a-z]+)(::text)?/g)].map(match => [match[1], match[2], Boolean(match[3])])
  expect(projected).toEqual(['seqtypid', 'seqstart', 'seqincrement', 'seqmax', 'seqmin', 'seqcache', 'seqcycle'].map(field => [field, field, field !== 'seqcycle']))
  const payload = generated.match(/payload:=(.*);\n RETURN payload\|\|jsonb_build_object\('sha256',encode\(sha256\(convert_to\(payload::text,'UTF8'\)\),'hex'\),\n\s*'diagnostics',jsonb_build_object\('sequenceLogCounters',log_counters\)\);/)
  expect(payload?.[1]).toBe("jsonb_build_object('format','ihr-capacity-baseline-v3','tables',tables,'sequences',sequences)")
})

test('old fingerprint and physical seal contracts cannot be silently reused', () => {
  const fingerprint = logicalFingerprint(), generated = validateCapacityFixture(buildCapacityFixture())
  expect(() => validateCapacityFingerprint({ ...fingerprint, format: 'ihr-capacity-baseline-v2' })).toThrow('format')
  const seal = { ...unitSeal(), format: 'ihr-capacity-seal-v2', method: 'coordinator-owned-sealed-logical-dump', fingerprint }
  expect(() => assertSealedBaseline(seal, unitEvidence, generated)).not.toThrow()
  for (const patch of [{ format: 'ihr-capacity-seal-v1' }, { method: 'coordinator-owned-sealed-database-snapshot' }, { method: 'regenerate-from-sql' }]) {
    expect(() => assertSealedBaseline({ ...seal, ...patch }, unitEvidence, generated)).toThrow()
  }
})
