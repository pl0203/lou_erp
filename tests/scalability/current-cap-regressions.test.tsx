import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { broadCustomerFixture, denseLineFixture, monthlyPOFixture } from './fixtures'

const state = vi.hoisted(() => ({ fixture: { tables: {} } as any, queries: [] as any[] }))
vi.mock('../../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: any) => { state.queries.push(options); return { isLoading: true, isPending: true, isFetching: true } } }))
vi.mock('../../src/lib/supabase', async () => { const { fixtureClient } = await import('./fixtures'); return { supabase: fixtureClient(() => state.fixture) } })
import Dashboard from '../../src/pages/athel/Dashboard'
import { fetchPOPage } from '../../src/lib/reads/orders'

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T12:00:00Z')); state.queries = [] })
afterEach(() => { cleanup(); vi.useRealTimers() })
const readLast = () => state.queries.at(-1).queryFn({ signal: new AbortController().signal })

test('latest three-month PO count remains 1500 with 6000 POs behind a 1000-row API cap', async () => {
  state.fixture = monthlyPOFixture(); render(<Dashboard />)
  const data = await readLast()
  expect(data.metrics.totalPOCount).toBe(1500)
})

test('500 POs with ten lines retain the exact 50000 outstanding value beyond the child cap', async () => {
  state.fixture = denseLineFixture(); render(<Dashboard />)
  const data = await readLast()
  const value = data.metrics.outstandingValue
  expect(typeof value === 'number' ? value.toFixed(2) : value).toBe('50000.00')
})

test('search includes all 101 matching customers rather than silently stopping at 100', async () => {
  state.fixture = broadCustomerFixture()
  const data = await fetchPOPage({ status: 'all', search: 'Common' }, 1)
  expect(data.total).toBe(101)
})
