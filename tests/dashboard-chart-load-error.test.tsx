import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
vi.mock('../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../src/components/athel/DashboardCharts', () => { throw new Error('Synthetic chunk network failure') })
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: {
  metrics: { totalPOCount: 2, totalPOValue: 123, deliveredValue: 0, outstandingValue: 123, averagePOValue: 61.5, completedPOCount: 0 },
  customerShare: [], monthlySeries: [], dailySeries: [], statusBreakdown: [], topCustomers: [], outstandingItems: [],
} }) }))
import Dashboard from '../src/pages/athel/Dashboard'
afterEach(cleanup)
test('a chart chunk download failure leaves existing metrics and detail tables usable', async () => {
  render(<Dashboard />)
  expect(await screen.findByText('Grafik tidak dapat dimuat. Muat ulang halaman untuk mencoba lagi.')).toBeTruthy()
  expect(screen.getAllByText('Rp123').length).toBeGreaterThan(0)
  expect(screen.getByText('Top Customer')).toBeTruthy()
})
