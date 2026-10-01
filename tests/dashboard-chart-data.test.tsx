import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({ query: null as null | (() => Promise<any>) }))
vi.mock('../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: any) => {
  state.query = options.queryFn
  return { isLoading: true }
} }))
vi.mock('../src/lib/supabase', async () => {
  const { fixtureClient, monthlyPOFixture } = await import('./scalability/fixtures')
  const fixture = monthlyPOFixture()
  fixture.rpc!.pilot_athel_summary_v1 = () => ({ version: 1, as_of: '2026-09-30T00:00:00Z', metrics: { totalPOCount: 0, totalPOValue: '0', deliveredValue: '0', outstandingValue: '0', averagePOValue: '0', completedPOCount: 0 }, customerShare: [], statusBreakdown: [], topCustomers: [], outstandingItems: [], monthlySeries: Array.from({ length: 12 }, (_, i) => ({ key: new Date(Date.UTC(2025, 9 + i, 1)).toISOString().slice(0, 7), poValue: '0', deliveredValue: '0' })) })
  return { supabase: fixtureClient(() => fixture) }
})
import Dashboard from '../src/pages/athel/Dashboard'
afterEach(() => { cleanup(); vi.useRealTimers() })

test('dashboard keeps every date including zero-delivery days instead of discarding most daily observations', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 30, 12))
  render(<Dashboard />)
  const data = await state.query!({ signal: new AbortController().signal })
  expect(data.dailySeries).toHaveLength(92)
  expect(data.dailySeries[0]).toMatchObject({ key: '2026-07-01', deliveredValue: '0.00', sjCount: 0 })
  expect(data.dailySeries.at(-1)).toMatchObject({ key: '2026-09-30', deliveredValue: '0.00', sjCount: 0 })
  expect(new Set(data.dailySeries.map((day: any) => day.key)).size).toBe(92)
})
