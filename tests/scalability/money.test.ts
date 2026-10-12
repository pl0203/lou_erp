import { expect, test } from 'vitest'
import { formatMoney, moneyToChartNumber, moneyPercentage, formatCompactMoney } from '../../src/lib/reads/money'

test('formats exact decimal money without unsafe number conversion', () => {
  expect(formatMoney('50000.00', 'full')).toBe('50.000')
  expect(formatMoney('9007199254740993.1254', 'full')).toBe('9.007.199.254.740.993,125')
  expect(formatMoney('999.9995', 'full')).toBe('1.000')
  expect(formatMoney('-0.0004', 'full')).toBe('0')
  expect(formatMoney('-0.0005', 'full')).toBe('-0,001')
})
test.each([
  ['4505249.845', '4.505.249,85'],
  ['4505249.8449', '4.505.249,84'],
  ['999.995', '1.000'],
  ['-4505249.845', '-4.505.249,85'],
  ['-999.995', '-1.000'],
  ['9007199254740993.1254', '9.007.199.254.740.993,13'],
  ['9007199254740999.995', '9.007.199.254.741.000'],
  ['12.30', '12,3'],
  ['0.00', '0'],
  ['-0.0049', '0'],
  ['-0.005', '-0,01'],
])('formats PO average %s with at most two exact fractional digits', (value, expected) => {
  expect(formatMoney(value, 'average')).toBe(expected)
})
test('rounds millions in decimal arithmetic and keeps one decimal', () => {
  expect(formatMoney('1500000.00', 'millions')).toBe('1.5')
  expect(formatMoney('1550000', 'millions')).toBe('1.6')
  expect(formatMoney('0.00', 'millions')).toBe('0.0')
  expect(formatMoney('900719925474099350000', 'millions')).toBe('900719925474099.4')
})
test('permits finite plotting projections only and rejects malformed money', () => {
  expect(moneyToChartNumber('0.00')).toBe(0)
  expect(moneyToChartNumber('50000.00')).toBe(50000)
  for (const value of ['NaN', 'Infinity', '1e3', '', '1,000', '1.2.3']) {
    expect(() => formatMoney(value, 'full')).toThrow()
    expect(() => formatMoney(value, 'average')).toThrow()
    expect(() => moneyToChartNumber(value)).toThrow()
  }
  expect(() => moneyToChartNumber('1' + '0'.repeat(400))).toThrow()
})

test('formats compact amounts and ratios without converting monetary totals to numbers', () => {
  expect(formatCompactMoney('1500000000.00')).toBe('Rp1,50 miliar')
  expect(formatCompactMoney('1500000')).toBe('Rp1,5 juta')
  expect(formatCompactMoney('1500')).toBe('Rp1.500')
  expect(formatCompactMoney('0.00')).toBe('Rp0')
  expect(moneyPercentage('9007199254740993', '18014398509481986', 1)).toBe('50.0')
  expect(moneyPercentage('2', '3', 0)).toBe('67')
  expect(moneyPercentage('0', '0', 1)).toBe('0.0')
})

test('reporting compact money uses explicit Indonesian units and full small values', () => {
  expect(formatCompactMoney('10000.25')).toBe('Rp10.000,25')
  expect(formatCompactMoney('-1500.125')).toBe('Rp-1.500,125')
  expect(formatCompactMoney('0.01')).toBe('Rp0,01')
  expect(formatCompactMoney('1500000')).toBe('Rp1,5 juta')
  expect(formatCompactMoney('1500000000')).toBe('Rp1,50 miliar')
})
