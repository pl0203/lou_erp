import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ profile: { id: 'manager-a', role: 'sales_manager' }, calls: [] as any[], unassigned: false }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: state.profile }) }))
vi.mock('../../src/lib/supabase', () => ({ supabase: {
  from: () => { const q: any = { select: () => q, order: () => q, limit: async () => ({ data: [], error: null }) }; return q },
  rpc: (name: string, args: unknown) => { state.calls.push({ name, args }); const result = Promise.resolve({ data: { version: 1, as_of: '2026-11-01T12:00:00Z', earliest_schedule_date: null, earliest_order_at: state.profile.id === 'manager-a' ? '2026-10-03T12:00:00Z' : null }, error: null }); return Object.assign(result, { abortSignal: () => result }) },
} }))
vi.mock('../../src/lib/reads/usePagedRead', () => ({ usePagedRead: (_key: string, filters: any) => ({ data: { version: 1, as_of: '2026-11-01T12:00:00Z', items: [], total: 0, page: 1, page_size: 50, summary: { total_visited: 0, total_scheduled: 0, total_orders: state.unassigned ? 1 : 0, total_sales: state.unassigned ? '75000000' : '0', average_visit_rate: 0, unassigned_orders: state.unassigned ? 1 : 0, unassigned_sales: state.unassigned ? '75000000' : '0' } }, filters, setFilters: vi.fn(), setPage: vi.fn(), isPending: false, isError: false, refetch: vi.fn() }) }))
import { PerformanceActivityContent as PerformanceContent } from '../../src/pages/girard/GirardPerformance'
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-01T12:00:00Z')); state.profile = { id: 'manager-a', role: 'sales_manager' }; state.calls = []; state.unassigned = false })
afterEach(() => { cleanup(); vi.useRealTimers() })
function view(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) { return render(<QueryClientProvider client={client}><PerformanceContent /></QueryClientProvider>) }
test('November selector includes an October credited PO even with no schedules', async () => {
  view()
  await waitFor(() => expect(screen.getByRole('option', { name: /Oktober 2026/i })).toBeTruthy())
  expect(state.calls).toEqual([{ name: 'pilot_sales_report_months_v1', args: { p_manager_id: 'manager-a' } }])
})
test('earliest directory is keyed by current actor scope rather than retaining another manager date', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rendered = view(client)
  await waitFor(() => expect(screen.getByRole('option', { name: /Oktober 2026/i })).toBeTruthy())
  state.profile = { id: 'manager-b', role: 'sales_manager' }
  rendered.rerender(<QueryClientProvider client={client}><PerformanceContent /></QueryClientProvider>)
  await waitFor(() => expect(state.calls).toHaveLength(2))
  await waitFor(() => expect(screen.queryByRole('option', { name: /Oktober 2026/i })).toBeNull())
})
test('authorized Unassigned amount is visibly separated from salesperson credit', () => {
  state.profile = { id: 'head', role: 'sales_head' }; state.unassigned = true
  view()
  expect(screen.getByText('Unassigned')).toBeTruthy()
  expect(screen.getByText(/1 pesanan belum memiliki kredit salesperson/i)).toBeTruthy()
})
