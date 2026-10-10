import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ handler: null as any }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'executive', role: 'executive' } }) }))
vi.mock('../../src/lib/reads/reports', () => ({ fetchEarliestSalesPerformanceMonth: async () => '2026-09-01', fetchCustomerPerformancePage: (...args: any[]) => state.handler('customer', ...args), fetchSalesPerformancePage: (...args: any[]) => state.handler('sales', ...args) }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { from() { const q: any = { then: (resolve: any) => Promise.resolve({ data: [{ order_date: '2026-09-01', scheduled_date: '2026-09-01' }], error: null }).then(resolve) }; for (const key of ['select','order','limit']) q[key] = () => q; return q } } }))
import { CustomerActivityContent as CustomerPerformanceContent } from '../../src/pages/girard/CustomerPerformance'
import { PerformanceActivityContent as PerformanceContent } from '../../src/pages/girard/GirardPerformance'
const clients: QueryClient[] = []
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-01T12:00:00Z')) })
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.useRealTimers() })
function result(kind: string, target: string) {
  const row = kind === 'customer' ? { id: 'same-row', name: 'Customer', manager_name: null, actual_visits: 1, target_visits: 4, last_visit_date: null, order_count: 1, total_sales: '50', sales_target: target } : { id: 'same-row', full_name: 'Sales person', scheduled: 4, visited: 1, missed: 0, orders: 1, total_sales: '50', visit_rate: 25, sales_target: target }
  const summary = kind === 'customer' ? { total_sales: '50', active_customers: 1, total_customers: 1, total_visits: 1, total_target_visits: 4, visit_percent: 25, top_customer: row } : { total_visited: 1, total_scheduled: 4, total_orders: 1, total_sales: '50', average_visit_rate: 25 }
  return { version: 1, as_of: '2026-10-01T12:00:00Z', items: [row], total: 1, page: 1, page_size: 50, summary }
}
for (const [kind, Component] of [['customer', CustomerPerformanceContent], ['sales', PerformanceContent]] as const) test(`${kind}: an unsaved target draft cannot move into another month`, async () => {
  let resolve!: (value: any) => void
  const pending = new Promise(r => { resolve = r })
  state.handler = async (_kind: string, _id: string, _role: string, month: string) => month === '2026-10' ? result(kind, '100.00') : pending
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); clients.push(client)
  render(<QueryClientProvider client={client}><Component /></QueryClientProvider>)
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Rp 0.0M' }).length).toBeGreaterThan(0))
  fireEvent.click(screen.getAllByRole('button', { name: 'Rp 0.0M' })[0])
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '999' } })
  fireEvent.change(kind === 'customer' ? screen.getByLabelText('Bulan aktivitas pelanggan') : screen.getByRole('combobox'), { target: { value: '2026-09' } })
  await waitFor(() => expect(screen.queryByRole('spinbutton')).toBeNull())
  await act(async () => resolve(result(kind, '200.00')))
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  expect(screen.queryByRole('spinbutton')).toBeNull()
  fireEvent.click(screen.getAllByRole('button', { name: 'Rp 0.0M' })[0])
  expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('200.00')
})
