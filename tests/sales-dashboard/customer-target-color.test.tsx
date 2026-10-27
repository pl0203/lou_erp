import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ actual: '10.00', target: '100.00' as string | null, visits: 5 }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'actor', role: 'sales_manager' } }) }))
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../../src/lib/catalogue/useCustomerTargetSave', () => ({ useCustomerTargetSave: () => ({ unresolved: false, busy: false, available: false }) }))
vi.mock('../../src/lib/reads/usePagedRead', () => ({ usePagedRead: () => ({
  filters: { yearMonth: '2026-10' }, page: 1, setFilters: vi.fn(), setPage: vi.fn(), isPending: false, isError: false, refetch: vi.fn(),
  data: { page: 1, page_size: 20, total: 1, summary: { total_sales: '10.00', active_customers: 1, total_visits: 5, total_target_visits: 5, visit_percent: 100, top_customer: null }, items: [{ id: 'customer', name: 'Synthetic customer', manager_name: null, actual_visits: state.visits, target_visits: 5, last_visit_date: null, order_count: 1, total_sales: state.actual, sales_target: state.target }] },
}) }))
import { CustomerActivityContent } from '../../src/pages/girard/CustomerPerformance'
let client: QueryClient
afterEach(() => { cleanup(); client?.clear() })
function view() { client = new QueryClient(); render(<QueryClientProvider client={client}><MemoryRouter><CustomerActivityContent /></MemoryRouter></QueryClientProvider>); return screen.getAllByText('% Pembanding target').find(element => element.tagName === 'P')!.parentElement! }
test('mobile sales progress follows sales achievement, not successful visits', () => {
  state.actual = '10'; state.target = '100'; state.visits = 5
  const region = view(); expect(region.querySelector('.bg-red-400')).toBeTruthy(); expect(region.querySelector('.bg-green-500')).toBeNull(); expect(region.textContent).toContain('10%')
})
test('achieved sales target stays green when visits are below plan', () => {
  state.actual = '110'; state.target = '100'; state.visits = 0
  const region = view(); expect(region.querySelector('.bg-green-500')).toBeTruthy(); expect(region.textContent).toContain('110%')
})
test('missing target and explicit zero remain distinct and neither produces a zero percent', () => {
  state.actual = '10'; state.target = null; state.visits = 0
  const missing = view(); expect(missing.textContent).toContain('Target belum ditetapkan'); expect(missing.textContent).not.toContain('0%')
  cleanup(); state.target = '0'; const zero = view(); expect(zero.textContent).toContain('Target nol'); expect(zero.textContent).not.toContain('0%')
})
