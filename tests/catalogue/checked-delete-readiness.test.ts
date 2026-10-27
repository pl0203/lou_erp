import { describe, expect, it } from 'vitest'
import { decodeCatalogueDeleteAccess } from '../../src/lib/catalogue/validation'
const actor = '11111111-1111-4111-8111-111111111111'
const value = { version: 1, actor_id: actor, customer_delete: false, product_delete: false }
describe('narrow guarded-delete readiness', () => {
  it('admits false independently of the unchanged CO eligibility mode', () => {
    expect(decodeCatalogueDeleteAccess(value, actor)).toEqual(value)
    expect(decodeCatalogueDeleteAccess({ ...value, product_delete: true }, actor).product_delete).toBe(true)
  })
  it.each([null, {}, { ...value, version: 2 }, { ...value, actor_id: '22222222-2222-4222-8222-222222222222' }, { ...value, extra: true }, { ...value, product_delete: 'true' }, { ...value, customer_delete: null }])('fails closed on unverified input %#', candidate => {
    expect(() => decodeCatalogueDeleteAccess(candidate, actor)).toThrow()
  })
})
