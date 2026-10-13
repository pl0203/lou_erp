import { describe, expect, it } from 'vitest'
import { formatLeaveMinutes } from '../../src/lib/leave/formatMinutes'

describe('formats_exact_minutes', () => {
  it.each([[225, '3j 45m'], [450, '7j 30m'], [5400, '90j'], [0, '0j'],
    [60, '1j'], [1, '1m'], [59, '59m'], [61, '1j 1m']])('formats %i as %s', (minutes, expected) => {
    expect(formatLeaveMinutes(minutes)).toBe(expected)
  })
  it.each([-1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid minutes %s', minutes => {
    expect(() => formatLeaveMinutes(minutes)).toThrow()
  })
  it('keeps the largest safe integer exact', () => {
    expect(formatLeaveMinutes(Number.MAX_SAFE_INTEGER)).toBe('150119987579016j 31m')
  })
})
