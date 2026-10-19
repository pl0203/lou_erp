import { describe, expect, it, vi } from 'vitest'
import { addMoney, baselineForCustomer, baselineForPerson, buildSuggestedLines, completedMonths, nextTargetMonth, validateLines } from '../../src/lib/salesTargets/calculations'
import type { BaselinePerson, MonthValue } from '../../src/lib/salesTargets/contracts'
const months = (values: (string | null)[]): MonthValue[] => values.map((amount, i) => ({ month: `2026-0${7 + i}-01`, amount, quality: amount === null ? 'missing' : 'complete' }))
const cell = (values: (string | null)[]) => ({ metric: 'po_order_value' as const, months: months(values), contextMonths: months(['999.00', '999.00', '999.00']), complete: !values.includes(null), baseline: null, warningCodes: [] })
const person: BaselinePerson = { personId: '10000000-0000-0000-0000-000000000001', name: 'Sales contoh', ownership: 'direct_report', customers: [{ customerId: '20000000-0000-0000-0000-000000000001', name: 'Toko A', cells: [cell(['60', '80', '100'])] }, { customerId: '20000000-0000-0000-0000-000000000002', name: 'Toko B', cells: [cell(['20', '40', '60'])] }] }
describe('exact target planning', () => {
  it('averages each assigned customer then sums 80 + 40 = 120 without uplift', () => {
    expect(baselineForCustomer(months(['60', '80', '100']))).toBe('80.00')
    expect(baselineForPerson(person, 'po_order_value')).toBe('120.00')
    expect(addMoney(['120.00', '10.00'])).toBe('130.00')
  })
  it('includes complete zero, never treats missing or fewer months as zero', () => {
    expect(baselineForCustomer(months(['0', '0', '0']))).toBe('0.00')
    expect(baselineForCustomer(months(['20', null, '60']))).toBeNull()
    expect(baselineForCustomer(months(['20', '60']))).toBeNull()
    expect(baselineForPerson(person, 'co_sale_value')).toBeNull()
    expect(baselineForPerson({ ...person, customers: [] }, 'po_order_value')).toBeNull()
  })
  it('uses exact cents beyond JS safe integers and rounds the three-month mean once', () => {
    expect(addMoney(['9007199254740991.99', '0.01'])).toBe('9007199254740992.00')
    expect(baselineForCustomer(months(['0.01', '0.01', '0']))).toBe('0.01')
  })
  it('does not accept repeated/nonconsecutive months or negative/nondecimal money', () => {
    expect(baselineForCustomer([months(['10'])[0], months(['20'])[0], months(['30'])[0]])).toBeNull()
    expect(() => addMoney(['NaN'])).toThrow()
    expect(() => addMoney(['-1'])).toThrow()
    expect(() => addMoney(['1e3'])).toThrow()
  })
  it('uses three last completed calendar months and targets next month by local calendar', () => {
    expect(completedMonths('2026-11-01', new Date(2026, 9, 17), 3)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01'])
    expect(nextTargetMonth(new Date(2026, 11, 31))).toBe('2027-01-01')
  })
  it('leaves missing CO empty and requires reasons for manual values, adjustments and N/A', () => {
    const lines = buildSuggestedLines([person])
    expect(lines.map(x => x.amount)).toEqual(['120.00', null, null])
    expect(validateLines(lines, [person])).toHaveLength(2)
    const manual = lines.map(line => ({ ...line, amount: line.amount ?? '0', reason: line.amount === null ? 'Reviewed manually' : null }))
    expect(validateLines(manual, [person])).toEqual([])
    expect(validateLines(manual.map((line, i) => i === 0 ? { ...line, amount: '130', reason: null } : line), [person])[0].message).toMatch(/alasan/i)
    expect(validateLines(manual.map((line, i) => i === 0 ? { ...line, amount: null, applicability: 'not_applicable', reason: null } : line), [person])[0].message).toMatch(/alasan/i)
  })
})
it('requires explicit transfer review even for an unchanged complete historical baseline', () => {
  const transferred = structuredClone(person)
  transferred.customers[0].cells[0].warningCodes = ['TRANSFER_ACTUALS_REMAIN_PREDECESSOR']
  const lines = buildSuggestedLines([transferred]).map(line => line.amount === null ? { ...line, applicability: 'not_applicable' as const, reason: 'No business scope' } : line)
  expect(validateLines(lines, [transferred]).find(error => error.metric === 'po_order_value')?.message).toMatch(/warisan|kredit/i)
})

it('uses Jakarta month rollover regardless of the device timezone', () => {
  vi.stubEnv('TZ', 'UTC')
  try {
    const instant = new Date('2026-10-31T18:00:00Z')
    expect(nextTargetMonth(instant)).toBe('2026-12-01')
    expect(completedMonths('2026-12-01', instant)).toEqual(['2026-08-01', '2026-09-01', '2026-10-01'])
  } finally { vi.unstubAllEnvs() }
})
