import { expect, test } from 'vitest'
import { BASELINE_TABLES } from '../database/ihr/capacity-baseline.mjs'
import { buildCapacitySql } from '../database/ihr/capacity-sql.mjs'

test('generated fingerprint statements retain SQL literals after format-template decoding', () => {
  const generated = buildCapacitySql()
  const fingerprint = generated.slice(generated.indexOf('CREATE FUNCTION ihr_capacity_fixture.fingerprint()'))
  // Decode the actual emitted PL/pgSQL format argument, supporting ordinary and
  // tagged dollar quoting. This tests the dynamic statement, not its source escapes.
  const match = fingerprint.match(/EXECUTE format\(\s*(?:'((?:''|[^'])*)'|\$([A-Za-z_][A-Za-z_0-9]*)\$([\s\S]*?)\$\2\$)\s*,\s*t\s*\)\s+INTO n,h;/)
  expect(match).not.toBeNull()
  const template = match![1] === undefined ? match![3] : match![1].replaceAll("''", "'")
  expect(template.match(/%./g)).toEqual(['%s'])
  for (const relation of BASELINE_TABLES) {
    // The sole %s argument comes from the fixed relation inventory, as in SQL format.
    const query = template.replace('%s', relation)
    const literals = [...query.matchAll(/'((?:''|[^'])*)'/g)].map(value => value[1].replaceAll("''", "'"))
    expect(literals, relation).toEqual(['', '', 'UTF8', 'hex', 'UTF8', 'hex'])
    expect(query.replace(/\s+/g, ' ').trim(), relation).toBe(
      `SELECT count(*),encode(sha256(convert_to(coalesce(string_agg(h, '' ORDER BY h), ''),'UTF8')),'hex') FROM (SELECT encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h FROM ${relation} r) s`,
    )
  }
  // PostgreSQL parsing/execution remains a separate owned-fixture runtime check.
})
