// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

test('calendar-edit fixtures always choose a strictly future Friday across all company weekdays', () => {
  const source = readFileSync('tests/database/ihr/quote-seed.sql', 'utf8')
  const formula = source.match(/\(\(5-extract\(isodow FROM statement_timestamp\(\) AT TIME ZONE 'Pacific\/Kiritimati'\)::integer\+(\d+)\)%7\)(\+\d+)?/)
  expect(formula).not.toBeNull()
  const offset = Number(formula![1]), increment = Number(formula![2] ?? 0)
  for (let weekday = 1; weekday <= 7; weekday++) {
    const days = (5 - weekday + offset) % 7 + increment
    expect(days).toBeGreaterThan(0)
    expect(days).toBeLessThanOrEqual(7)
    expect((weekday - 1 + days) % 7 + 1).toBe(5)
  }
})
