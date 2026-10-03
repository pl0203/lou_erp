import { expect, test } from 'vitest'
import { buildCapacityFixture } from '../database/ihr/capacity-fixture.mjs'

test('capacity fixture exposes a reproducible fictional data envelope', () => {
  const fixture = buildCapacityFixture()
  expect(fixture).not.toBeNull()
  expect(fixture.seed).toBe('ihr-capacity-v1-20261003')
  expect(fixture.asOf).toBe('2026-10-03')
})

import { accountId, groupAt, personId, scheduledMinutes, sha256, validateCapacityFixture } from '../database/ihr/capacity-fixture.mjs'
const fixture = buildCapacityFixture()
test('exact envelope preserves annual limits through every transition, including temporary reservations', () => {
  const report = validateCapacityFixture(fixture)
  expect(report).toMatchObject({ people: 505, activePeople: 500, accounts: 1500, requests: 10000, days: 60000, annualGrants: 1500 })
  expect(report.maxCommittedMinutes).toBeLessThanOrEqual(5400)
  expect(fixture.requests.reduce((n, r) => n + r.days.length, 0)).toBe(60000)
  expect(new Set(fixture.requests.map(r => r.days.length)).size).toBeGreaterThan(5)
  expect(new Set(fixture.requests.map(r => JSON.stringify(r.duration))).size).toBe(8)
  expect(sha256(buildCapacityFixture())).toBe(sha256(fixture))
})
test('dated rosters and nonoverlapping transfers cover both alternating groups and quote dates', () => {
  expect(scheduledMinutes(1, '2024-01-06')).toBe(225)
  expect(scheduledMinutes(2, '2024-01-06')).toBe(0)
  expect(scheduledMinutes(1, '2024-01-13')).toBe(0)
  expect(scheduledMinutes(2, '2024-01-13')).toBe(225)
  expect(scheduledMinutes(1, '2024-05-01')).toBe(0)
  expect(groupAt(25, '2025-06-30')).not.toBe(groupAt(25, '2025-07-01'))
  expect(fixture.roster.at(-1).date).toBe('2027-10-02')
  expect(fixture.accounts.filter(a => a.year === 2027)).toEqual([])
})
test('audiences contain real own-only, narrow, broad and independently scoped HR identities', () => {
  expect(fixture.people.filter(p => p.kind === 'director').every(p => !fixture.accounts.some(a => a.employee === p.n))).toBe(true)
  expect(fixture.grants.filter(g => g.actor === 470).map(g => g.capability)).toEqual(['configure'])
  expect(fixture.grants.filter(g => g.actor === 473).map(g => g.capability)).toEqual(['calendar'])
  expect(fixture.grants.filter(g => g.actor === 475 && g.capability === 'calendar')).toHaveLength(120)
  expect(fixture.requests.filter(r => r.employee === 1).length).toBeGreaterThan(100)
  expect(fixture.requests.filter(r => r.employee === 480)).toEqual([])
  expect(accountId(1, 2024)).not.toBe(personId(1))
})
test('validation rejects duplicate active dates and allowance inflation', () => {
  const broken = structuredClone(fixture)
  broken.accounts[0].allowance = 5401
  expect(() => validateCapacityFixture(broken)).toThrow('normal eligible allowance')
  const overlap = structuredClone(fixture)
  const first = overlap.requests.find(r => r.status === 'approved')
  const other = overlap.requests.find(r => r.status === 'approved' && r.id !== first.id && r.employee === first.employee && r.year === first.year)
  other.days = structuredClone(first.days)
  other.total = first.total
  // Preserve exact day cardinality to isolate the occupancy invariant.
  const spare = overlap.requests.find(r => r.status === 'rejected' && r.days.length > Math.abs(other.days.length - fixture.requests.find(r => r.id === other.id).days.length))
  const delta = overlap.requests.reduce((n, r) => n + r.days.length, 0) - 60000
  if (delta > 0) spare.days.splice(0, delta)
  if (delta < 0) spare.days.push(...Array.from({ length: -delta }, () => ({date:'2024-01-01',scheduled:0,charged:0})))
  spare.total = spare.days.reduce((n, d) => n + d.charged, 0)
  expect(() => validateCapacityFixture(overlap)).toThrow('one active request per date')
})
