import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import GirardNav from '../src/components/GirardNav'
import { fetchPendingVisitReviewCount } from '../src/lib/visitRequestBadge'

const state = vi.hoisted(() => ({ id: 'manager', role: 'sales_manager', count: 3 as number | null, error: null as Error | null, from: vi.fn(), select: vi.fn(), eq: vi.fn(), neq: vi.fn(), abort: vi.fn() }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { id: state.id, role: state.role, full_name: 'Reviewer' }, signOut: vi.fn() }) }))
vi.mock('../src/lib/supabase', () => ({ supabase: { from: state.from } }))
const clients: QueryClient[] = []
beforeEach(() => {
 state.id = 'manager'; state.role = 'sales_manager'; state.count = 3; state.error = null
 localStorage.clear(); vi.clearAllMocks()
 const query = { select: state.select, eq: state.eq, neq: state.neq, abortSignal: state.abort, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ count: state.count, error: state.error }).then(resolve) }
 for (const fn of [state.from, state.select, state.eq, state.neq, state.abort]) fn.mockReturnValue(query)
 vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); focusManager.setFocused(undefined); vi.useRealTimers(); vi.unstubAllGlobals() })
function mount() {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client)
 const tree = () => <QueryClientProvider client={client}><MemoryRouter><GirardNav /></MemoryRouter></QueryClientProvider>
 const view = render(tree()); return { client, rerender: () => view.rerender(tree()) }
}
test('uses an exact RLS-scoped count rather than a capped page, excluding own and completed requests', async () => {
 const signal = new AbortController().signal
 expect(await fetchPendingVisitReviewCount('manager', signal)).toBe(3)
 expect(state.from).toHaveBeenCalledWith('visit_requests')
 expect(state.select).toHaveBeenCalledWith('id', { count: 'exact', head: true })
 expect(state.eq).toHaveBeenCalledWith('status', 'pending')
 expect(state.neq).toHaveBeenCalledWith('requester_id', 'manager')
 expect(state.abort).toHaveBeenCalledWith(signal)
})
test.each(['expanded', 'collapsed', 'mobile'])('shows count with accessible label in %s navigation', async layout => {
 vi.stubGlobal('matchMedia', () => ({ matches: layout === 'mobile', addEventListener: vi.fn(), removeEventListener: vi.fn() }))
 state.count = 125; mount()
 if (layout === 'collapsed') fireEvent.click(screen.getByRole('button', { name: 'Minimalkan menu' }))
 if (layout === 'mobile') fireEvent.click(screen.getByRole('button', { name: 'Buka menu' }))
 const link = await screen.findByRole('link', { name: 'Permintaan Kunjungan, 125 menunggu' })
 expect(link.getAttribute('href')).toBe('/girard/visit-requests')
 expect(link.querySelector('.navigation-badge')?.textContent).toBe('99+')
})
test.each(['sales_manager', 'sales_head', 'executive'])('%s receives its scoped pending-review badge', async role => {
 state.role = role; mount(); expect(await screen.findByRole('link', { name: 'Permintaan Kunjungan, 3 menunggu' })).toBeTruthy()
})
test.each(['sales_person', 'po_admin', 'co_admin'])('%s does not query review counts', async role => {
 state.role = role; mount(); await act(async () => {})
 expect(state.from).not.toHaveBeenCalled(); expect(document.querySelector('.navigation-badge')).toBeNull()
})
test('hides zero counts', async () => {
 state.count = 0; mount(); await waitFor(() => expect(state.from).toHaveBeenCalled())
 expect(screen.getByRole('link', { name: 'Permintaan Kunjungan' })).toBeTruthy(); expect(document.querySelector('.navigation-badge')).toBeNull()
})
test('refreshes after inbox decision invalidation and removes zero badge', async () => {
 const { client } = mount(); await screen.findByRole('link', { name: 'Permintaan Kunjungan, 3 menunggu' })
 state.count = 0
 await act(async () => { await client.invalidateQueries() })
 await waitFor(() => expect(document.querySelector('.navigation-badge')).toBeNull())
})
test('refreshes when window focus or document visibility returns', async () => {
 mount(); await screen.findByRole('link', { name: 'Permintaan Kunjungan, 3 menunggu' })
 state.count = 2; fireEvent(window, new Event('focus'))
 await screen.findByRole('link', { name: 'Permintaan Kunjungan, 2 menunggu' })
 state.count = 1
 await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true) })
 await screen.findByRole('link', { name: 'Permintaan Kunjungan, 1 menunggu' })
})
test('actor and role changes cannot reuse another reviewer count', async () => {
 const view = mount(); await screen.findByRole('link', { name: 'Permintaan Kunjungan, 3 menunggu' })
 state.id = 'other-manager'; state.count = 1; view.rerender()
 await screen.findByRole('link', { name: 'Permintaan Kunjungan, 1 menunggu' })
 expect(state.neq).toHaveBeenLastCalledWith('requester_id', 'other-manager')
 state.role = 'sales_person'; view.rerender()
 expect(document.querySelector('.navigation-badge')).toBeNull()
})
test('picks up incoming requests every minute while active but does not poll in background', async () => {
 vi.useFakeTimers(); focusManager.setFocused(true)
 mount()
 await act(async () => { await vi.advanceTimersByTimeAsync(10) })
 expect(screen.getByRole('link', { name: 'Permintaan Kunjungan, 3 menunggu' })).toBeTruthy()
 state.count = 4
 await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
 expect(screen.getByRole('link', { name: 'Permintaan Kunjungan, 4 menunggu' })).toBeTruthy()
 focusManager.setFocused(false); state.from.mockClear(); state.count = 5
 await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
 expect(state.from).not.toHaveBeenCalled()
})
test('failed or unavailable counts are not displayed as a stale badge', async () => {
 const { client } = mount(); await screen.findByRole('link', { name: 'Permintaan Kunjungan, 3 menunggu' })
 state.error = new Error('Unavailable')
 await act(async () => { await client.invalidateQueries() })
 await waitFor(() => expect(document.querySelector('.navigation-badge')).toBeNull())
 state.error = null; state.count = null
 await expect(fetchPendingVisitReviewCount('manager')).rejects.toThrow('Jumlah permintaan belum tersedia.')
})
