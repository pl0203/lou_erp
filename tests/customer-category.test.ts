// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { CUSTOMER_CATEGORIES, formatCustomerCategory, parseCustomerCategory } from '../src/lib/customerCategory'

const choices = [
  { value: 'supermarket_besar', label: 'Supermarket Besar' },
  { value: 'supermarket_sedang', label: 'Supermarket Sedang' },
  { value: 'supermarket_kecil', label: 'Supermarket Kecil' },
  { value: 'tradisional_market', label: 'Tradisional Market' },
  { value: 'perorangan', label: 'Perorangan' },
] as const

describe('shared customer category contract', () => {
  it('exposes exactly the five stable values and labels in the approved order', () => {
    expect(CUSTOMER_CATEGORIES).toEqual(choices)
  })
  it('keeps the choices and every choice immutable', () => {
    expect(Object.isFrozen(CUSTOMER_CATEGORIES)).toBe(true)
    for (const choice of CUSTOMER_CATEGORIES) expect(Object.isFrozen(choice)).toBe(true)
  })
  it.each(choices)('parses and formats $value without selecting a price tier', ({ value, label }) => {
    expect(parseCustomerCategory(value)).toBe(value)
    expect(formatCustomerCategory(value)).toBe(label)
  })
  it.each([null, undefined, ''])('requires deliberate selection for new input %j', value => {
    expect(() => parseCustomerCategory(value)).toThrow('Customer category is required')
  })
  it('allows a legacy null only when explicitly requested', () => {
    expect(parseCustomerCategory(null, { allowUnclassified: true })).toBeNull()
    expect(formatCustomerCategory(null)).toBe('Unclassified')
  })
  it.each([undefined, '', ' ', 'SUPERmarket_besar', 'supermarket_besar ', ' supermarket_besar',
    'Supermarket Besar', 'harga_pokok', 'luar_kota', 'dalam_kota', 'depo_bangunan', 'others',
    'unclassified', 0, false, {}, [], 'unknown'])('rejects invalid stored or legacy input %j', value => {
    expect(() => parseCustomerCategory(value, { allowUnclassified: true })).toThrow()
    expect(() => formatCustomerCategory(value)).toThrow()
  })
})
