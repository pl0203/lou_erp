import { expect, it } from 'vitest'
import { decodeBaseline, decodePlan, validMoney } from '../../src/lib/salesTargets/contracts'
const managerId = '10000000-0000-0000-0000-000000000001'
const request = { month: '2026-11-01', managerId }
const baseline = { schemaVersion: 1, ...request, rosterHash: 'synthetic-roster', currency: 'IDR', people: [], warnings: [] }
const plan = { id: '10000000-0000-0000-0000-000000000002', ...request, version: 1, state: 'draft', rosterHash: 'synthetic-roster', currency: 'IDR', lines: [], proposedBy: managerId, publishedBy: null, publishedAt: null, warnings: [] }
it('decodes baseline only for exact requested scope', () => {
  expect(decodeBaseline(request, baseline)).toEqual(baseline)
  expect(() => decodeBaseline({ ...request, month: '2026-12-01' }, baseline)).toThrow(/binding/)
  expect(() => decodeBaseline(request, { ...baseline, schemaVersion: 0 })).toThrow()
  expect(() => decodeBaseline(request, { ...baseline, people: [{ personId: managerId }] })).toThrow()
})
it('rejects numeric money, duplicate leaf targets, publication without approver or self approval', () => {
  expect(decodePlan(plan)).toEqual(plan)
  const line = { personId: managerId, metric: 'co_sale_value', amount: '0.00', applicability: 'target', reason: 'Reviewed' }
  expect(() => decodePlan({ ...plan, lines: [{ ...line, amount: 0 }] })).toThrow()
  expect(() => decodePlan({ ...plan, lines: [line, line] })).toThrow()
  expect(() => decodePlan({ ...plan, state: 'published' })).toThrow()
  expect(() => decodePlan({ ...plan, state: 'published', publishedBy: managerId, publishedAt: '2026-10-17T12:00:00Z' })).toThrow()
})
it('rejects incomplete submitted/published target sets and returned plans without feedback', () => {
  const personId = '10000000-0000-0000-0000-000000000003'
  const line = { personId, metric: 'po_order_value', amount: '0.00', applicability: 'target', reason: null }
  expect(() => decodePlan({ ...plan, state: 'submitted', lines: [] })).toThrow()
  expect(() => decodePlan({ ...plan, state: 'submitted', lines: [line] })).toThrow()
  expect(() => decodePlan({ ...plan, state: 'returned', lines: [] })).toThrow()
  expect(decodePlan({ ...plan, state: 'returned', returnReason: 'Periksa stok warisan', lines: [] }).returnReason).toBe('Periksa stok warisan')
})
it('accepts scoped immutable baseline snapshots but rejects mismatched plan context', () => {
  expect(decodePlan({ ...plan, baselineSnapshot: baseline }).baselineSnapshot?.rosterHash).toBe('synthetic-roster')
  expect(() => decodePlan({ ...plan, baselineSnapshot: { ...baseline, rosterHash: 'another-roster' } })).toThrow()
})

it('accepts the shared 24-integer-digit target bound and rejects a 25th digit', () => {
  expect(validMoney('999999999999999999999999.99')).toBe(true)
  expect(validMoney('1000000000000000000000000.00')).toBe(false)
})
