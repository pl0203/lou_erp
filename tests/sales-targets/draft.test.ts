import { expect, it } from 'vitest'
import { TargetDraftStore } from '../../src/lib/salesTargets/useTargetDraft'
const initial = () => ({ month: '2026-11-01', managerId: 'manager-a', step: 1 as const, baseline: null, lines: [], plan: null, dirty: false })
it('retains same-identity drafts across unmount/navigation, but clears cross-actor/role/backend state', () => {
  const store = new TargetDraftStore(), one = store.open('backend:actor-a:sales_manager', 'new', initial())
  one.update({ step: 2, dirty: true, lines: [{ personId: 'rep-a', metric: 'co_sale_value', amount: '123.45', applicability: 'target', reason: 'Reviewed' }] })
  expect(store.open('backend:actor-a:sales_manager', 'new', initial()).get().lines[0].amount).toBe('123.45')
  expect(store.open('backend:actor-b:sales_manager', 'new', initial()).get().lines).toEqual([])
  one.update({ dirty: true, month: '2028-01-01' })
  expect(store.open('backend:actor-a:sales_manager', 'new', initial()).get().lines).toEqual([])
  store.clear()
  expect(store.open('backend:actor-a:sales_manager', 'new', initial()).get().dirty).toBe(false)
})
it('retires new and old plan aliases after persistence so another month starts a fresh draft', () => {
  const store = new TargetDraftStore(), one = store.open('actor-a', 'new', initial())
  one.update({ dirty: true, step: 3 })
  store.remember('actor-a', 'saved-plan-id', one)
  expect(store.open('actor-a', 'saved-plan-id', initial()).get().step).toBe(3)
  expect(store.open('actor-a', 'new', initial()).get().step).toBe(1)
})
