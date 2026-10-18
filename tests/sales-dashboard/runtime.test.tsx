import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { dashboardFixture, syntheticId } from './fixtures'
const auth = vi.hoisted(() => ({ user: { id: '00000000-0000-4000-8000-000000000001' }, profile: { id: '00000000-0000-4000-8000-000000000001', role: 'sales_person', manager_id: null as string | null, is_active: true }, loading: false, error: null as string | null }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: vi.fn(() => { throw new Error('Unexpected production read') }) } }))
import { SalesDashboardPanel } from '../../src/components/sales/MySalesDashboardPanel'
import type { DashboardScope } from '../../src/lib/salesDashboard/contracts'
import type { DashboardTransport } from '../../src/lib/salesDashboard/transport'
let client: QueryClient
beforeEach(() => { client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); auth.user.id = syntheticId(1); Object.assign(auth.profile, { id: syntheticId(1), role: 'sales_person', manager_id: null, is_active: true }); auth.loading = false; auth.error = null })
afterEach(() => { cleanup(); client.clear() })
function mount(transport: DashboardTransport, scope: DashboardScope = 'own', enabled = true, path = '/girard/my-sales?dashboard_month=2026-10-01') {
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><SalesDashboardPanel scope={scope} enabled={enabled} transport={transport} /></MemoryRouter></QueryClientProvider>
  return { ...render(tree()), tree }
}
test('rollout is disabled by default and an explicit disabled gate makes no RPC', () => {
  const transport = vi.fn<DashboardTransport>(); mount(transport, 'own', false)
  expect(screen.getByText('Ringkasan baru belum diaktifkan.')).toBeTruthy(); expect(screen.getByRole('heading', { level: 1, name: 'Ringkasan Saya' })).toBeTruthy(); expect(transport).not.toHaveBeenCalled()
})
test('inactive or role-incompatible identity cannot issue a read', () => {
  auth.profile.is_active = false; const transport = vi.fn<DashboardTransport>(); mount(transport)
  expect(screen.getByText('Ringkasan tidak tersedia untuk cakupan akun ini.')).toBeTruthy(); expect(transport).not.toHaveBeenCalled()
  cleanup(); auth.profile.is_active = true; mount(transport, 'leadership'); expect(transport).not.toHaveBeenCalled()
})
test('malformed URL filter fails closed before RPC', () => {
  const transport = vi.fn<DashboardTransport>(); mount(transport, 'own', true, '/girard/my-sales?dashboard_month=2026-13-01&dashboard_page=-2')
  expect(screen.getByText('Filter ringkasan tidak valid.')).toBeTruthy(); expect(transport).not.toHaveBeenCalled()
})
test('unavailable API does not show invented KPI zeroes or legacy targets', async () => {
  const transport = vi.fn<DashboardTransport>().mockRejectedValue(new Error('Private service detail')); mount(transport)
  expect(await screen.findByText('Ringkasan baru belum tersedia.')).toBeTruthy()
  expect(screen.queryByText('Rp 0')).toBeNull(); expect(screen.queryByText('Private service detail')).toBeNull(); expect(transport).toHaveBeenCalledTimes(1)
})
test('search remains editable until explicitly applied, then resets page and whole-filter request', async () => {
  const transport = vi.fn<DashboardTransport>().mockImplementation(async args => ({ ...dashboardFixture(), month: args.p_month, page: args.p_page })); mount(transport)
  const input = await screen.findByRole('searchbox', { name: 'Cari pelanggan' })
  fireEvent.change(input, { target: { value: 'Pelanggan dicari' } }); expect(input).toBe(document.querySelector('input[type="search"]')); expect(transport).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Cari' }))
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(2))
  expect(transport.mock.calls[1][0]).toMatchObject({ p_search: 'Pelanggan dicari', p_page: 1 })
})
test('switching actor immediately hides and evicts another identity cached data', async () => {
  let resolveSecond!: (data: ReturnType<typeof dashboardFixture>) => void
  const transport = vi.fn<DashboardTransport>().mockResolvedValueOnce(dashboardFixture()).mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve }))
  const view = mount(transport); await screen.findAllByText('Pelanggan Contoh 1')
  auth.user.id = syntheticId(2); auth.profile.id = syntheticId(2); view.rerender(view.tree())
  expect(screen.queryByText('Pelanggan Contoh 1')).toBeNull()
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(2))
  expect(client.getQueryCache().findAll({ queryKey: ['sales-dashboard-v3'] }).every(query => query.queryKey[2] !== `${syntheticId(1)}:sales_person:`)).toBe(true)
  await act(async () => { const next = dashboardFixture(); next.items[0].name = 'Pelanggan akun kedua'; resolveSecond(next) })
  expect((await screen.findAllByText('Pelanggan akun kedua')).length).toBeGreaterThan(0)
})
test('leadership and manager reads request their distinct scopes', async () => {
  auth.profile.role = 'sales_head'; const transport = vi.fn<DashboardTransport>().mockResolvedValue(dashboardFixture('leadership')); mount(transport, 'leadership')
  await screen.findByRole('heading', { name: 'Ringkasan Tim' }); expect(transport.mock.calls[0][0].p_scope).toBe('leadership')
})

test('sort and attention request the whole filtered cohort and reset pagination', async () => {
  const transport = vi.fn<DashboardTransport>().mockImplementation(async args => ({ ...dashboardFixture('own', 42), month: args.p_month, page: args.p_page }))
  mount(transport, 'own', true, '/girard/my-sales?dashboard_month=2026-10-01&dashboard_page=3')
  fireEvent.change(await screen.findByRole('combobox', { name: 'Urutkan pelanggan' }), { target: { value: 'po_delivery_value_desc' } })
  await waitFor(() => expect(transport.mock.calls.at(-1)?.[0]).toMatchObject({ p_page: 1, p_sort: 'po_delivery_value_desc', p_attention: 'all' }))
  fireEvent.change(await screen.findByRole('combobox', { name: 'Fokus pelanggan' }), { target: { value: 'missing_co' } })
  await waitFor(() => expect(transport.mock.calls.at(-1)?.[0]).toMatchObject({ p_page: 1, p_sort: 'po_delivery_value_desc', p_attention: 'missing_co' }))
  expect(await screen.findByText('1–10 dari 42')).toBeTruthy()
})
