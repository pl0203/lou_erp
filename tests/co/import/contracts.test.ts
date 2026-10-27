import { describe, expect, it } from 'vitest'
import { lineAmount, normalizeSourceNumber } from '../../../src/lib/co/import/decimal'
import { parseMoney } from '../../../src/lib/co/validation'

describe('source decimal contracts', () => {
  it.each([['', null], ['0', '0'], ['1.241.000', '1241000'], ['001,2300', '1.2300'], ['0,00001', '0.00001']])('normalizes explicit comma layout %s without rounding', (raw, decimal) => {
    expect(normalizeSourceNumber(raw!, ',')).toEqual({ raw, decimal, convention:'decimal_comma' })
  })
  it('uses only the declared layout', () => {
    expect(normalizeSourceNumber('1,080.25', '.').decimal).toBe('1080.25')
    expect(normalizeSourceNumber('1.080,25', '.').decimal).toBeNull()
  })
  it.each(['-1', '1.00.000', '1,2,3', 'NaN', '1e3'])('leaves invalid source %s unresolved', raw => {
    expect(normalizeSourceNumber(raw, ',').decimal).toBeNull()
  })
  it.each([
    ['73', '17000', '0', '1241000.00'],
    ['31', '19000', '0', '589000.00'],
    ['9007199254740993', '0.01', '0', '90071992547409.93'],
    ['2', '12.25', '0.50', '24.00'],
    ['0', '12', '0', '0.00'],
  ])('calculates exact extended amount %s × %s minus %s', (qty, price, discount, expected) => {
    expect(lineAmount(qty, parseMoney(price), parseMoney(discount))).toBe(expected)
  })
  it.each([['-1', '1', '0'], ['1.5', '1', '0'], ['1', '-1', '0'], ['1', '1.001', '0'], ['1', '1', '-1'], ['1', '1', '0.001'], ['1', '1', '2']])('rejects invalid ledger arithmetic %s %s %s', (qty, price, discount) => {
    expect(() => lineAmount(qty, price as ReturnType<typeof parseMoney>, discount as ReturnType<typeof parseMoney>)).toThrow()
  })
})

import { syntheticReport } from './fixtures'
it('preserves source SKU leading zeros and independent physical transaction identities', () => {
  expect(syntheticReport.sourceRows[0].sourceSku).toBe('00001234')
  expect(new Set(syntheticReport.sourceRows.map(row => row.id)).size).toBe(3)
  expect(syntheticReport.sourceRows[2].quantity).toEqual({ raw: '', decimal: null })
})

it('keeps ambiguous punctuation explicitly tied to its declared convention',()=>{
 expect(normalizeSourceNumber('1.234', '.')).toEqual({raw:'1.234',decimal:'1.234',convention:'decimal_dot'})
 expect(normalizeSourceNumber('1.234', ',')).toEqual({raw:'1.234',decimal:'1234',convention:'decimal_comma'})
 expect(normalizeSourceNumber('001,2300', ',')).toEqual({raw:'001,2300',decimal:'1.2300',convention:'decimal_comma'})
})
