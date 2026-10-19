import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { dashboardFixture, syntheticId } from '../sales-dashboard/fixtures'

const state = vi.hoisted(() => ({ role: 'executive', status: 'ready', enabled: true, data: null as any }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: '00000000-0000-4000-8000-000000000001' }, profile: { id: '00000000-0000-4000-8000-000000000001', role: state.role, full_name: 'Synthetic manager', is_active: true }, loading: state.status === 'auth' }), useBeforeSignOut: () => undefined }))
vi.mock('../../src/components/GirardNav', () => ({ default: () => <nav aria-label="Navigasi modul">Sales</nav> }))
vi.mock('../../src/lib/salesDashboard/useDashboardRead', () => ({ get dashboardFeatureEnabled() { return state.enabled }, useDashboardRead: (scope: string) => ({
  enabled: state.enabled, allowed: state.status !== 'denied', valid: state.status !== 'invalid', error: state.status === 'error', data: state.status === 'ready' ? state.data : undefined,
  identity: 'synthetic', scope, month: '2026-10-01', search: '', metric: 'poDeliveryValue', pending: state.status === 'loading', onMonth: vi.fn(), onSearch: vi.fn(), onMetric: vi.fn(), onPage: vi.fn(), onRefresh: vi.fn(), onReset: vi.fn(),
}) }))
vi.mock('../../src/pages/girard/CustomerPerformance', () => ({ CustomerPerformanceContent: () => <p>Store report</p> }))
vi.mock('../../src/pages/girard/GirardPerformance', () => ({ PerformanceContent: () => <p>Legacy team report</p> }))
vi.mock('../../src/lib/useUnsavedChanges', () => ({ useUnsavedChanges: () => ({ confirmDiscardDecision: vi.fn(), dialog: null }) }))
vi.mock('../../src/lib/salesTargets/useTargetTransport', () => ({ useTargetTransport: () => ({}) }))
vi.mock('../../src/components/sales/TargetWizard', () => ({ TargetWizard: () => <section aria-label="Target editor">Target form</section> }))
vi.mock('../../src/components/sales/TargetPlanInbox', () => ({ TargetPlanInbox: () => <section aria-label="Target inbox">Target reviews</section> }))
import GirardDashboard from '../../src/pages/girard/GirardDashboard'
import SalesTargets from '../../src/pages/girard/SalesTargets'

beforeEach(() => { state.role = 'executive'; state.status = 'ready'; state.enabled = true; state.data = dashboardFixture('leadership'); state.data.items[0].id = syntheticId(20) })
afterEach(cleanup)
function expectReferenceHeader(title: string, description: string) {
  const main = screen.getByRole('main'), heading = screen.getByRole('heading', { level: 1, name: title }), header = heading.closest('header')!
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  expect(header.parentElement).toBe(main); expect(main.firstElementChild).toBe(header)
  for (const token of ['ui-page-header', 'bg-white', 'border-b', 'border-brand-divider', 'px-4', 'md:px-8', 'py-5']) expect(header.classList.contains(token)).toBe(true)
  expect(heading.classList.contains('ui-page-header__title')).toBe(true)
  expect(header.querySelector('.ui-page-header__description')?.textContent).toBe(description)
  expect(main.classList.contains('px-4')).toBe(false)
  expect(main.classList.contains('space-y-6')).toBe(false)
}

test.each(['ready', 'loading', 'error', 'denied', 'invalid'])('Performa Tim keeps the shared full-width header during %s', status => {
  state.status = status
  render(<MemoryRouter initialEntries={['/girard/dashboard?tab=team&dashboard_month=2026-10-01']}><GirardDashboard /></MemoryRouter>)
  expectReferenceHeader('Performa Tim', 'Ringkasan performa tim dan toko')
  expect(screen.queryByRole('region', { name: 'Tampilan dashboard' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Performa Tim' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Performa Toko' })).toBeNull()
  if (status === 'ready') {
    expect(screen.getByText(/Cakupan pimpinan.*orang dalam hasil/)).toBeTruthy()
    expect(screen.getByLabelText('Bulan hasil')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Metrik hasil' })).toBeTruthy()
  }
})
test.each([false, true])('Performa Toko and legacy team retain the reference header without a second switcher (%s)', enabled => {
  state.enabled = enabled
  const view = render(<MemoryRouter initialEntries={['/girard/dashboard?tab=customers']}><GirardDashboard /></MemoryRouter>)
  expectReferenceHeader('Performa Toko', 'Ringkasan performa tim dan toko')
  expect(screen.queryByRole('region', { name: 'Tampilan dashboard' })).toBeNull()
  view.unmount(); state.enabled = false
  render(<MemoryRouter initialEntries={['/girard/dashboard?tab=team']}><GirardDashboard /></MemoryRouter>)
  expectReferenceHeader('Performa Tim', 'Ringkasan performa tim dan toko'); expect(screen.getByText('Legacy team report')).toBeTruthy()
})
test.each(['sales_person', 'sales_manager', 'sales_head', 'executive'])('Target Penjualan uses the same header band for %s without moving editor content into it', role => {
  state.role = role
  render(<MemoryRouter initialEntries={['/girard/targets?plan=synthetic-plan']}><SalesTargets /></MemoryRouter>)
  expectReferenceHeader('Target Penjualan', 'Target bulanan dengan dasar historis dan persetujuan yang terpisah.')
  const body = screen.getByRole('region', { name: 'Target editor' }).parentElement!
  for (const token of ['space-y-6', 'px-4', 'py-6', 'md:px-8']) expect(body.classList.contains(token)).toBe(true)
  expect(body.contains(screen.getByRole('region', { name: 'Target inbox' }))).toBe(true)
})
test('Target Penjualan retains its header while checking the actor', () => {
  state.status = 'auth'
  render(<MemoryRouter><SalesTargets /></MemoryRouter>)
  expectReferenceHeader('Target Penjualan', 'Target bulanan dengan dasar historis dan persetujuan yang terpisah.')
  expect(screen.getByText('Memeriksa akses akun…')).toBeTruthy(); expect(screen.queryByRole('region', { name: 'Target editor' })).toBeNull()
})

test('manager team scope/count remains body context below the shared page heading', () => {
  state.role = 'sales_manager'; state.data = dashboardFixture('team')
  render(<MemoryRouter initialEntries={['/girard/dashboard?tab=team']}><GirardDashboard /></MemoryRouter>)
  expectReferenceHeader('Performa Tim', 'Ringkasan performa tim dan toko')
  const context = screen.getByText(/Tim saya.*roster bulan terpilih.*orang dalam hasil/)
  expect(context.closest('.ui-page-header')).toBeNull()
})
