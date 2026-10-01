import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({ query: null as null | (() => Promise<any>) }))
vi.mock('../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: any) => {
  state.query = options.queryFn
  return { isLoading: true }
} }))
vi.mock('../src/lib/supabase', () => ({ supabase: {
  from: () => {
    const query: any = { then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve) }
    for (const name of ['select', 'gte', 'lte', 'order', 'eq', 'in', 'is']) query[name] = () => query
    return query
  },
} }))
import Dashboard from '../src/pages/athel/Dashboard'
afterEach(() => { cleanup(); vi.useRealTimers() })

test('dashboard keeps every date including zero-delivery days instead of discarding most daily observations', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 30, 12))
  render(<Dashboard />)
  const data = await state.query!()
  expect(data.dailySeries).toHaveLength(92)
  expect(data.dailySeries[0]).toMatchObject({ key: '2026-07-01', deliveredValue: 0, sjCount: 0 })
  expect(data.dailySeries.at(-1)).toMatchObject({ key: '2026-09-30', deliveredValue: 0, sjCount: 0 })
  expect(new Set(data.dailySeries.map((day: any) => day.key)).size).toBe(92)
})
