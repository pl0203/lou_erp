import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ response: undefined as any, pending: false, error: false, earliestError: false }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'executive', role: 'executive' } }) }))
vi.mock('../../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../../src/lib/reads/usePagedRead', () => ({ usePagedRead: (_key: string, filters: any) => ({ data: state.response, filters, page: 1, setFilters: vi.fn(), setPage: vi.fn(), isPending: state.pending, isError: state.error, refetch: vi.fn() }) }))
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: any) => ({ data: undefined, isLoading: state.pending, isError: options.queryKey[0].startsWith('earliest') ? state.earliestError : state.error, refetch: vi.fn() }), useQueryClient: () => ({ invalidateQueries: vi.fn() }), useMutation: () => ({ mutate: vi.fn(), isPending: false }) }))
import { RevenueContent } from '../../src/pages/girard/GirardRevenue'
import { PerformanceContent } from '../../src/pages/girard/GirardPerformance'
import { CustomerPerformanceContent } from '../../src/pages/girard/CustomerPerformance'
import { ManagerCustomersContent } from '../../src/pages/girard/ManagerCustomers'
import GirardTeam from '../../src/pages/girard/GirardTeam'
afterEach(cleanup)
beforeEach(() => { state.pending = false; state.error = false; state.earliestError = false; state.response = { version: 1, as_of: '2026-10-01T00:00:00Z', items: [], total: 101, page: 1, page_size: 50 } })

test('revenue cards show full approved-order totals independent of the visible customer page', () => {
  state.response.summary = { total_sales: '1500000000.00', total_orders: 1500, active_customers: 101, top_customer: null }
  // The revenue contract exposes these complete totals beside the page.
  Object.assign(state.response, state.response.summary)
  render(<RevenueContent />)
  expect(screen.getByText('Rp 1500.0M')).toBeTruthy()
  expect(screen.getByText('dari 1500 pesanan')).toBeTruthy()
  expect(screen.getByText('101')).toBeTruthy()
})
test('sales performance uses the full summary and its server-calculated rounded average', () => {
  state.response.summary = { total_visited: 1234, total_scheduled: 2345, total_orders: 1500, total_sales: '1500000000.00', average_visit_rate: 57 }
  render(<PerformanceContent />)
  expect(screen.getByText('Rp 1500.0M')).toBeTruthy()
  expect(screen.getByText('57%')).toBeTruthy()
  expect(screen.getByText('1500')).toBeTruthy()
})
test('customer performance uses full totals and never derives customer counts from its page', () => {
  state.response.summary = { total_sales: '1500000000.00', active_customers: 101, total_customers: 1234, total_visits: 2345, total_target_visits: 3456, visit_percent: 68, top_customer: null }
  render(<CustomerPerformanceContent />)
  expect(screen.getByText('Rp 1500.0M')).toBeTruthy()
  expect(screen.getByText('dari 1234 total')).toBeTruthy()
  expect(screen.getByText('68%')).toBeTruthy()
})
test('manager customer cards use full cohort counts', () => {
  state.response.summary = { total: 1234, on_track: 1001, overdue: 233 }
  render(<ManagerCustomersContent />)
  expect(screen.getByText('1234')).toBeTruthy()
  expect(screen.getByText('1001')).toBeTruthy()
  expect(screen.getByText('233')).toBeTruthy()
})
for (const [name, Component] of [['revenue', RevenueContent], ['performance', PerformanceContent], ['customers', CustomerPerformanceContent], ['manager', ManagerCustomersContent], ['team', GirardTeam]] as const) {
  test(`${name} never presents failed summaries as zero`, () => {
    state.response = undefined; state.error = true
    render(<Component />)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeTruthy()
    expect(screen.queryByText(/^Rp 0/)).toBeNull()
  })
}

test('retained customer rows cannot edit targets for the newly requested month', () => {
  state.pending = true
  state.response.items = [{ id: 'c', name: 'Previous month customer', manager_name: null, actual_visits: 0, target_visits: 4, last_visit_date: null, order_count: 0, total_sales: '0', sales_target: null }]
  state.response.summary = { total_sales: '0', active_customers: 0, total_customers: 101, total_visits: 0, total_target_visits: 404, visit_percent: 0, top_customer: null }
  render(<CustomerPerformanceContent />)
  expect(screen.queryAllByRole('button', { name: '+ Set target' })).toHaveLength(0)
})

for (const [name, Component] of [['customer', CustomerPerformanceContent], ['sales', PerformanceContent]] as const) test(`${name}: failed month-directory reads are explicit and retryable`, () => {
  state.earliestError = true
  state.response.summary = { total_sales: '0', active_customers: 0, total_customers: 0, total_visits: 0, total_target_visits: 0, visit_percent: 0, top_customer: null, total_visited: 0, total_scheduled: 0, total_orders: 0, average_visit_rate: 0 }
  render(<Component />)
  expect(screen.getByRole('alert').textContent).toMatch(/bulan/i)
  expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeTruthy()
})
