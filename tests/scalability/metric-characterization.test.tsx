import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { fixtureId, metricCharacterizationRpcFixture } from './fixtures'
const state = vi.hoisted(() => ({ fixture: { tables: {} } as any, queries: new Map<string, any>() }))
vi.mock('../../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { id: '00000000-0000-4000-8000-000000000002', role: 'executive' } }) }))
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: any) => { state.queries.set(options.queryKey[0], options); return { data: options.queryKey[0] === 'manager_team' ? state.fixture.tables.users : undefined, isLoading: true } },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }), useMutation: () => ({ mutate: vi.fn() }),
}))
vi.mock('../../src/lib/supabase', async () => { const { fixtureClient } = await import('./fixtures'); return { supabase: fixtureClient(() => state.fixture) } })
import Dashboard from '../../src/pages/athel/Dashboard'
import GirardRevenue from '../../src/pages/girard/GirardRevenue'
import GirardPerformance from '../../src/pages/girard/GirardPerformance'
import GirardTeam from '../../src/pages/girard/GirardTeam'
import ManagerCustomers from '../../src/pages/girard/ManagerCustomers'
import { fetchCustomerPerformance } from '../../src/pages/girard/CustomerPerformance'
import { fetchCustomerStatsBatch, fetchCustomerStatsDetail } from '../../src/lib/CustomerStats'
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T12:00:00Z')); state.fixture = metricCharacterizationRpcFixture(); state.queries.clear() })
afterEach(() => { cleanup(); vi.useRealTimers() })
const query = (name: string) => state.queries.get(name).queryFn({ signal: new AbortController().signal })

test('dashboard preserves selected PO cohort, wider shipment/item windows, mixed-price quantity and legacy status', async () => {
  render(<Dashboard />)
  fireEvent.change(screen.getByLabelText('Tanggal awal'), { target: { value: '2026-10-01' } })
  fireEvent.change(screen.getByLabelText('Fulfillment'), { target: { value: 'undelivered' } })
  const data = await query('athel_dashboard')
  expect(data.metrics).toMatchObject({ totalPOCount: 2, totalPOValue: '70.00', deliveredValue: '0.00', outstandingValue: '70.00', averagePOValue: '35.00' })
  expect(data.dailySeries).toEqual([{ key: '2026-10-01', label: '1 Okt', deliveredValue: '20.00', sjCount: 2 }])
  expect(data.monthlySeries.find((x: any) => x.key === '2026-08').poValue).toBe('0.00')
  expect(data.monthlySeries.find((x: any) => x.key === '2026-09').deliveredValue).toBe('10.00')
  expect(data.outstandingItems.find((x: any) => x.sku === 'MIX')).toMatchObject({ outstandingQty: 4, outstandingValue: '20.00' })
  expect(data.outstandingItems.find((x: any) => x.sku === 'OLD')).toMatchObject({ outstandingQty: 7, outstandingValue: '70.00' })
  expect(data.statusBreakdown.some((x: any) => x.label === 'delayed')).toBe(true)
})
test('customer statistics retain future recent-count and cancelled top-item behavior but active delivery eligibility', async () => {
  const [batch] = await fetchCustomerStatsBatch([fixtureId(1)])
  const detail = await fetchCustomerStatsDetail(fixtureId(1))
  expect(batch).toMatchObject({ order_count: 4, total_sales: '30.00', top_items: ['Future cancelled item', 'Old item', 'Legacy item'] })
  expect(detail).toMatchObject({ first_order_date: '2026-08-01', order_count_3mo: 4, total_sales_3mo: '30.00' })
  expect(detail.top_items[0]).toEqual({ name: 'Future cancelled item', revenue: '200.00' })
})
test('customer performance uses current-month PO count and older-PO shipments plus latest target', async () => {
  const { items: [row] } = await fetchCustomerPerformance(fixtureId(2), 'executive', '2026-10')
  expect(row).toMatchObject({ order_count: 2, total_sales: '20.00', actual_visits: 2, target_visits: 4, sales_target: '200.00' })
})
test('revenue includes approved sales only while sales performance includes every status', async () => {
  render(<GirardRevenue />)
  expect((await query('revenue')).items).toMatchObject([{ order_count: 1, total_sales: '100.00' }])
  cleanup(); render(<GirardPerformance />)
  expect((await query('performance')).items).toMatchObject([{ scheduled: 2, visited: 1, missed: 1, orders: 4, total_sales: '200.00', visit_rate: 50, sales_target: '300.00' }])
})
test('team activity preserves current-day counts and weekly lower bound without a new upper bound', async () => {
  render(<GirardTeam />)
  expect(await query('today_activity')).toMatchObject([{ total_scheduled: 2, total_visited: 1, total_orders: 4 }])
  expect((await query('today_activity'))[0].weekly_visits).toBe(3)
})
test('manager customer visit count retains lower bound only and its thirty-day target', async () => {
  render(<ManagerCustomers />)
  expect((await query('my_customers')).items).toMatchObject([{ visits_this_period: 3, target_visits: 3, on_track: true, last_visit_date: '2026-09-01' }])
})
