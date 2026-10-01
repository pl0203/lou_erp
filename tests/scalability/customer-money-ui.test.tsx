import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ total: '0.00', top: [] as any[], missing: false }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useParams: () => ({ id: 'c' }) }))
vi.mock('../../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../../src/components/ActivePromotionsBanner', () => ({ default: () => null }))
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'u', role: 'executive' } }) }))
vi.mock('@tanstack/react-query', () => ({ useQuery: ({ queryKey }: any) => {
  const customer = { id: 'c', name: 'Synthetic customer', visit_frequency_days: 7, address: null, city: null, last_visit_date: null }
  if (queryKey[0] === 'girard_customer') return { data: customer }
  if (queryKey[0] === 'customer_stats_detail') return { data: state.missing ? undefined : { first_order_date: null, order_count_3mo: 0, total_sales_3mo: state.total, top_items: state.top } }
  if (queryKey[0] === 'customer_stats') return { data: state.missing ? [] : [{ customer_id: 'c', order_count: 0, total_sales: state.total, top_items: [] }] }
  if (['schedules', 'my_visits'].includes(queryKey[0])) return { data: [{ id: 's', outlet_id: 'c', scheduled_date: '2026-10-01', status: 'pending', notes: null, customers: customer, outlet_visits: [] }] }
  return { data: [] }
} }))
import DailySchedule from '../../src/pages/girard/DailySchedule'
import MyVisits from '../../src/pages/girard/MyVisits'
import CustomerDetail from '../../src/pages/girard/GirardCustomerDetail'
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T12:00:00Z')); state.total = '0.00'; state.top = []; state.missing = false })
afterEach(() => { cleanup(); vi.useRealTimers() })
for (const [name, Page] of [['daily schedule', DailySchedule], ['my visits', MyVisits], ['customer detail', CustomerDetail]] as const) {
  test(`${name} keeps a decimal zero as Rp 0 rather than treating its string as positive`, () => {
    render(<Page />)
    expect(screen.getByText('Rp 0')).toBeTruthy()
    expect(screen.queryByText('Rp 0.0M')).toBeNull()
  })
  test(`${name} marks an absent authorized statistic as unavailable after loading ends`, () => {
    state.missing = true; render(<Page />)
    expect(screen.getAllByText('Tidak tersedia').length).toBeGreaterThan(0)
    expect(screen.queryByText('Rp 0')).toBeNull()
    expect(screen.queryByText('Memuat...')).toBeNull()
  })
}
test('customer item revenue preserves exact decimal labels beyond safe integer cents', () => {
  state.top = [{ name: 'Synthetic item', revenue: '90071992547409.91' }]
  render(<CustomerDetail />)
  expect(screen.getByText('Rp 90.071.992.547.409,91')).toBeTruthy()
})
