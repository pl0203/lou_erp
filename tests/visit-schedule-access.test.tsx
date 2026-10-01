import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
const state = vi.hoisted(() => ({ error: null as null | { message: string; code: string }, customerMissing: false }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {}, useParams: () => ({ scheduleId: 'dummy-schedule' }), useBlocker: () => ({ state: 'unblocked' }), useBeforeUnload: () => {} }))
vi.mock('../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'dummy-user' } }) }))
vi.mock('../src/lib/supabase', () => ({ supabase: { from: (table: string) => {
  const result = () => ({ data: table === 'sales_schedules' && state.customerMissing ? { id: 'dummy-schedule', customers: null } : null, error: table === 'sales_schedules' ? state.error : null })
  const q: any = { select: () => q, eq: () => q, order: () => q, lte: () => q, gte: () => q,
    single: async () => ({ data: null, error: state.error ?? { code: 'PGRST116', message: 'Cannot coerce the result to a single JSON object.' } }),
    maybeSingle: async () => result(), then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
  }; return q
} } }))
import VisitPage, { fetchSchedule } from '../src/pages/girard/VisitPage'
const clients: QueryClient[] = []
beforeEach(() => { state.error = null; state.customerMissing = false })
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0 })
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client)
  render(<QueryClientProvider client={client}><VisitPage /></QueryClientProvider>)
}
test('zero visible rows return null, preserving indistinguishable missing and inaccessible schedules', async () => {
  expect(await fetchSchedule('dummy-schedule')).toBeNull()
})
test('missing or hidden schedule shows safe no-access copy without visit actions', async () => {
  mount()
  expect(await screen.findByText('Jadwal tidak ditemukan atau Anda tidak memiliki akses.')).toBeTruthy()
  expect(screen.queryByText(/Cannot coerce/)).toBeNull()
  expect(screen.queryByText('+ Pesanan Baru')).toBeNull()
})
test('unexpected read failure stays an error and shows retry guidance without server details', async () => {
  state.error = { code: 'XX000', message: 'Internal database details must not be rendered' }
  await expect(fetchSchedule('dummy-schedule')).rejects.toEqual(state.error)
  mount()
  expect(await screen.findByText('Gagal memuat jadwal. Silakan muat ulang halaman untuk mencoba lagi.')).toBeTruthy()
  expect(screen.queryByText(state.error.message)).toBeNull()
  expect(screen.queryByText('Jadwal tidak ditemukan atau Anda tidak memiliki akses.')).toBeNull()
})
test('missing linked customer retains its actionable safe message', async () => {
  state.customerMissing = true; mount()
  expect(await screen.findByText('Pelanggan untuk jadwal ini tidak tersedia. Hubungi administrator.')).toBeTruthy()
})
