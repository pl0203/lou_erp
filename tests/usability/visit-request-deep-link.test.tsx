import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ actor: 'owner', hidden: false, missing: false, fail: false, exact: [] as any[], paged: 0 }))
const targetId = '00000000-0000-4000-8000-000000000001'
const older = { id: targetId, requester_id: 'owner', customer_id: 'customer', status: 'approved', kind: 'new', version: 2, scheduled_date: '2026-08-12', notes: 'Older retained synthetic request', created_at: '2026-08-01T00:00:00Z', customers: { name: 'Synthetic branch' } }
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { id: state.actor, role: 'sales_person' } }) }))
vi.mock('../../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../../src/lib/visitTransactions', () => ({ useVisitPlanningSender: () => Object.assign(vi.fn(), { hasUnresolved: () => false }) }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { from: (table: string) => {
 const filters: Record<string, string> = {}
 const rows = table === 'visit_requests' ? Array.from({ length: 20 }, (_, i) => ({ ...older, id: `new-${i}`, status: 'pending', notes: `Newer synthetic request ${i}`, created_at: '2026-10-10T00:00:00Z' })) : table === 'customers' ? [{ id: 'customer', name: 'Synthetic branch' }] : [{ id: 'owner', full_name: 'Synthetic Owner' }]
 const q: any = { select: () => q, eq: (key: string, value: string) => { filters[key] = value; return q }, in: () => q, order: () => q, range: () => q, abortSignal: () => q,
 maybeSingle: async () => { state.exact.push({ table, filters: { ...filters } }); return { data: state.hidden || state.missing || state.fail ? null : older, error: state.fail ? new Error('Do not disclose server details') : null } },
 then: (resolve: any) => { if (table === 'visit_requests') state.paged++; return Promise.resolve({ data: rows, count: table === 'visit_requests' ? 21 : rows.length, error: null }).then(resolve) }
 }; return q
} } }))
import VisitRequests from '../../src/pages/girard/VisitRequests'
const clients: QueryClient[] = []
function mount(hash = `#visit-request-${targetId}`) { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client); const element = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[`/girard/visit-requests${hash}`]}><VisitRequests /></MemoryRouter></QueryClientProvider>; const view = render(element()); return { rerender: () => view.rerender(element()) } }
beforeEach(() => { state.actor = 'owner'; state.hidden = false; state.missing = false; state.fail = false; state.exact = []; state.paged = 0 })
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()) })
test('a recovered request older than the newest 20 resolves by exact RLS-scoped ID', async () => {
 mount(); expect(await screen.findByRole('heading', { name: 'Status permintaan yang dipilih' })).toBeTruthy()
 expect(await screen.findByText('Older retained synthetic request')).toBeTruthy(); expect(screen.getByText('Disetujui')).toBeTruthy(); expect(screen.getByText('12 Agustus 2026')).toBeTruthy()
 expect(document.getElementById(`visit-request-${targetId}`)).toBeTruthy()
 expect(state.exact).toEqual([{ table: 'visit_requests', filters: { id: targetId } }]); expect(state.paged).toBe(0)
 expect(screen.getByRole('link', { name: 'Lihat semua permintaan' }).getAttribute('href')).toBe('/girard/visit-requests')
})
for (const visibility of ['missing', 'hidden'] as const) test(`${visibility} request gives the same safe no-access result without stale details`, async () => {
 state[visibility] = true; mount(); expect(await screen.findByText('Permintaan tidak ditemukan atau Anda tidak memiliki akses.')).toBeTruthy()
 expect(screen.queryByText('Older retained synthetic request')).toBeNull(); expect(screen.queryByText('Disetujui')).toBeNull()
})
test('invalid request hash shows safe unavailable state without any request-table read', async () => {
 mount('#visit-request-not-a-valid-id'); expect(await screen.findByText('Permintaan tidak ditemukan atau Anda tidak memiliki akses.')).toBeTruthy(); expect(state.exact).toHaveLength(0); expect(state.paged).toBe(0)
})
test('exact status read failure supports retry without exposing backend details', async () => {
 state.fail = true; mount(); expect(await screen.findByText('Status permintaan belum tersedia.')).toBeTruthy(); expect(screen.queryByText(/Do not disclose/)).toBeNull()
 state.fail = false; fireEvent.click(screen.getByRole('button', { name: 'Coba lagi status permintaan' })); expect(await screen.findByText('Older retained synthetic request')).toBeTruthy()
})
test('actor changes cannot reuse the previous actor’s focused status result', async () => {
 const { rerender } = mount(); await screen.findByText('Older retained synthetic request'); state.hidden = true; state.actor = 'other-owner'; rerender()
 await screen.findByText('Permintaan tidak ditemukan atau Anda tidak memiliki akses.'); expect(screen.queryByText('Older retained synthetic request')).toBeNull(); await waitFor(() => expect(state.exact).toHaveLength(2))
})
