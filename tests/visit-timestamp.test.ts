import { expect, test } from 'vitest'

const formatters = import.meta.glob<{ formatVisitTimestamp: (value: string | null) => string }>('../src/lib/visitTimestamp.ts')
async function formatter() {
  const load = formatters['../src/lib/visitTimestamp.ts']
  expect(load, 'shared visit check-in timestamp formatter').toBeTypeOf('function')
  return (await load()).formatVisitTimestamp
}

test('visit instant crosses midnight in labelled WIB', async () => {
  const format = await formatter()
  expect(format('2026-10-04T17:30:00Z')).toBe('5 Oktober 2026, 00.30 WIB')
})

test('visit timestamp retains Indonesian date and 24-hour minute precision', async () => {
  const format = await formatter()
  expect(format('2026-10-04T16:59:59Z')).toBe('4 Oktober 2026, 23.59 WIB')
  expect(format('2026-12-31T17:00:00Z')).toBe('1 Januari 2027, 00.00 WIB')
  expect(format('2026-10-05T06:05:45Z')).toBe('5 Oktober 2026, 13.05 WIB')
})

test('offset representations of the same visit instant have the same WIB label', async () => {
  const format = await formatter()
  expect(format('2026-10-05T00:30:00+07:00')).toBe(format('2026-10-04T17:30:00Z'))
  expect(format('2026-10-04T10:30:00-07:00')).toBe('5 Oktober 2026, 00.30 WIB')
})

test.each([null, '', 'not a timestamp', '2026-13-04T17:30:00Z', '2026-10-04T25:30:00Z'])('missing or invalid visit timestamp %s has the safe fallback', async value => {
  const format = await formatter()
  expect(format(value)).toBe('Waktu tidak tersedia')
})
