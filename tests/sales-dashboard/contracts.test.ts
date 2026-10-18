import { describe, expect, test, vi } from 'vitest'
import { decodeDashboard, type DashboardArgs } from '../../src/lib/salesDashboard/contracts'
import { targetProgress, dashboardMetricDefinitions, visitProgress, compareCompletedMonths, currentDashboardMonth, dashboardWarningText } from '../../src/lib/salesDashboard/definitions'
import { dashboardFixture, dashboardArgs } from './fixtures'

describe('version 3 fail-closed dashboard boundary', () => {
  test('accepts five independent measures and a reported zero', () => {
    const data = dashboardFixture()
    data.summary.coSaleValue = { value: '0.00', quality: 'partial' }
    expect(decodeDashboard(dashboardArgs, data).summary.coSaleValue.value).toBe('0.00')
    expect(dashboardMetricDefinitions).toHaveLength(5)
  })
  test.each(['schemaVersion', 'month', 'scope', 'page', 'pageSize'])('rejects an unbound %s', key => {
    const value: Record<string, unknown> = { ...dashboardFixture(), [key]: key === 'month' ? '2026-09-01' : key === 'scope' ? 'team' : 9 }
    expect(() => decodeDashboard(dashboardArgs, value)).toThrow()
  })
  test('missing CO is null, never an asserted zero', () => {
    const data = dashboardFixture(); data.summary.coSaleValue = { value: '0', quality: 'missing' }
    expect(() => decodeDashboard(dashboardArgs, data)).toThrow()
  })
  test('rejects malformed money, fractional counts and nonpublished target amounts', () => {
    for (const mutate of [
      (data: ReturnType<typeof dashboardFixture>) => { data.summary.poOrderValue.value = 'NaN' },
      (data: ReturnType<typeof dashboardFixture>) => { data.summary.coShippedCount.value = '1.5' },
      (data: ReturnType<typeof dashboardFixture>) => { data.targets.po_order_value.amount = '5.00' },
    ]) { const data = dashboardFixture(); mutate(data); expect(() => decodeDashboard(dashboardArgs, data)).toThrow() }
  })
  test('rejects incomplete page, duplicate rows, mixed kinds and target basis drift', () => {
    for (const mutate of [
      (data: ReturnType<typeof dashboardFixture>) => { data.total = 2 },
      (data: ReturnType<typeof dashboardFixture>) => { data.items.push(data.items[0]); data.total = 2 },
      (data: ReturnType<typeof dashboardFixture>) => { data.items[0].kind = 'person' },
      (data: ReturnType<typeof dashboardFixture>) => { data.targets.po_order_value.metric = 'co_sale_value' },
    ]) { const data = dashboardFixture(); mutate(data); expect(() => decodeDashboard(dashboardArgs, data)).toThrow() }
  })
  test('request rejects invalid month and oversized page before transport', () => {
    expect(() => decodeDashboard({ ...dashboardArgs, p_month: '2026-13-01' } as DashboardArgs, dashboardFixture())).toThrow()
    expect(() => decodeDashboard({ ...dashboardArgs, p_page_size: 1000 }, dashboardFixture())).toThrow()
  })
})

describe('basis-matched exact progress and contextual comparison', () => {
  const actual = { value: '80.00', quality: 'complete' as const }
  const target = { metric: 'po_delivery_value' as const, month: '2026-10-01', state: 'published' as const, amount: '200.00' }
  test('returns exact gap and attainment only for the matching published basis/month', () => {
    expect(targetProgress(actual, target, 'po_delivery_value', '2026-10-01')).toEqual({ percentage: '40', gap: '120.00', status: 'comparable' })
    expect(targetProgress(actual, target, 'co_sale_value', '2026-10-01').status).toBe('basis_mismatch')
    expect(targetProgress(actual, target, 'po_delivery_value', '2026-09-01').status).toBe('basis_mismatch')
  })
  test('zero is a published target, but is not an attainment denominator', () => {
    expect(targetProgress(actual, { ...target, amount: '0' }, 'po_delivery_value', '2026-10-01')).toMatchObject({ status: 'zero_target', percentage: null, gap: '-80.00' })
  })
  test('partial actuals and unpublished/partial targets never become a score', () => {
    expect(targetProgress({ ...actual, quality: 'partial' }, target, 'po_delivery_value', '2026-10-01').status).toBe('incomplete_actual')
    expect(targetProgress(actual, { ...target, state: 'partial', amount: null }, 'po_delivery_value', '2026-10-01').status).toBe('partial_target')
  })
  test('no scheduled visits has no rate, not zero percent', () => {
    expect(visitProgress('0', '0')).toBeNull(); expect(visitProgress('3', '4')).toBe('75')
  })
  test('large decimal gaps remain exact without Number aggregation', () => {
    expect(targetProgress({ value: '9007199254740993.12', quality: 'complete' }, { ...target, amount: '9007199254741000.13' }, 'po_delivery_value', '2026-10-01').gap).toBe('7.01')
  })
  test('current month, missing and different periods are not ranked against a full month', () => {
    expect(compareCompletedMonths('2026-10-01', actual, '2026-09-01', actual, '2026-10-17')).toBeNull()
    expect(compareCompletedMonths('2026-09-01', actual, '2026-08-01', { value: '40', quality: 'complete' }, '2026-10-17')).toBe('100')
    expect(compareCompletedMonths('2026-09-01', actual, '2026-07-01', actual, '2026-10-17')).toBeNull()
  })
})


test('business-month default uses Asia/Jakarta at UTC rollover, not device locale', () => {
  const year = vi.spyOn(Date.prototype, 'getFullYear').mockImplementation(function (this: Date) { return this.getUTCFullYear() })
  const month = vi.spyOn(Date.prototype, 'getMonth').mockImplementation(function (this: Date) { return this.getUTCMonth() })
  try {
    expect(currentDashboardMonth(new Date('2026-10-31T18:00:00Z'))).toBe('2026-11-01')
    expect(currentDashboardMonth(new Date('2026-10-31T16:59:59Z'))).toBe('2026-10-01')
  } finally { year.mockRestore(); month.mockRestore() }
})
test('source warning codes become readable context, not an unsupported count of data issues', () => {
  expect(dashboardWarningText('UNVERIFIED_HIERARCHIES_EXCLUDED')).toBe('Hierarki yang belum terverifikasi tidak dimasukkan ke cakupan.')
  expect(dashboardWarningText('TARGET_COVERAGE_OR_APPLICABILITY_NOT_COMPARABLE')).toContain('tidak sebanding')
})


test('matched daily schedules must not exceed the number scheduled or invent a count without a denominator', () => {
  const data = dashboardFixture(); data.activity.todayMatchedScheduled = '7'
  expect(() => decodeDashboard(dashboardArgs, data)).toThrow()
  data.activity.todayScheduled = null; data.activity.todayMatchedScheduled = '1'
  expect(() => decodeDashboard(dashboardArgs, data)).toThrow()
})

test('bounded server sort and attention filters are validated before data use', () => {
  expect(() => decodeDashboard({ ...dashboardArgs, p_sort: 'po_delivery_value_desc', p_attention: 'missing_co' }, dashboardFixture())).not.toThrow()
  expect(() => decodeDashboard({ ...dashboardArgs, p_sort: 'random' as any }, dashboardFixture())).toThrow()
  expect(() => decodeDashboard({ ...dashboardArgs, p_attention: 'target_incomplete' }, dashboardFixture())).toThrow()
  expect(() => decodeDashboard({ ...dashboardArgs, p_scope: 'team', p_attention: 'unvisited' }, dashboardFixture('team'))).toThrow()
})
