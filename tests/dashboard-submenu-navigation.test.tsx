import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({ role: 'executive', dashboardEnabled: false }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'actor', role: state.role, full_name: 'Example User' }, signOut: vi.fn() }) }))
vi.mock('../src/lib/visitRequestBadge', () => ({ usePendingVisitReviewCount: () => undefined }))
vi.mock('../src/lib/salesDashboard/feature', () => ({ get dashboardFeatureEnabled() { return state.dashboardEnabled } }))
vi.mock('../src/lib/salesDashboard/useDashboardRead', () => ({ get dashboardFeatureEnabled() { return state.dashboardEnabled } }))
vi.mock('../src/components/sales/MySalesDashboardPanel', () => ({ TeamSalesDashboardPanel: () => <p>Team summary content</p> }))
vi.mock('../src/pages/girard/CustomerPerformance', () => ({ CustomerPerformanceContent: () => <p>Store performance content</p> }))
vi.mock('../src/pages/girard/GirardPerformance', () => ({ PerformanceContent: () => <p>Legacy team content</p> }))
import GirardNav from '../src/components/GirardNav'
import GirardDashboard from '../src/pages/girard/GirardDashboard'
function Location() {
  const location = useLocation(), navigate = useNavigate()
  return <><output data-testid="location">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>Browser back</button></>
}
function mount(path = '/girard/schedule', page = false) { return render(<MemoryRouter initialEntries={[path]}>{page ? <GirardDashboard /> : <GirardNav />}<Location /></MemoryRouter>) }
function viewport(mobile: boolean) { vi.stubGlobal('matchMedia', () => ({ matches: mobile, addEventListener: vi.fn(), removeEventListener: vi.fn() })) }
beforeEach(() => { state.role = 'executive'; state.dashboardEnabled = false; localStorage.clear(); viewport(false) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const salesRoles = ['sales_person', 'sales_manager', 'sales_head', 'executive']
test.each(salesRoles.flatMap(role => ['expanded', 'collapsed', 'mobile'].map(layout => [role, layout])))('%s retains only authorized dashboard children in %s navigation', (role, layout) => {
  state.role = role; viewport(layout === 'mobile')
  if (layout === 'collapsed') localStorage.setItem('padiwan.navigation.collapsed', 'true')
  mount()
  if (layout === 'mobile') fireEvent.click(screen.getByRole('button', { name: 'Buka menu' }))
  const trigger = screen.getByRole('button', { name: 'Dashboard' })
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByRole('link', { name: 'Target Penjualan' })).toBeNull()
  fireEvent.click(trigger)
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  const group = screen.getByRole('group', { name: 'Submenu Dashboard' })
  expect(trigger.getAttribute('aria-controls')).toBe(group.id)
  expect(within(group).getAllByRole('link').map(link => link.textContent)).toEqual(role === 'sales_person' ? ['Target Penjualan'] : ['Performa Tim', 'Performa Toko', 'Target Penjualan'])
  expect(screen.queryByRole('link', { name: 'Dashboard' })).toBeNull()
  expect(screen.getAllByRole('link', { name: 'Target Penjualan' })).toHaveLength(1)
  expect(document.querySelector('a[href="/girard/my-orders"]')).toBeNull()
  expect(screen.getByRole('link', { name: 'Riwayat Kunjungan Saya' }).getAttribute('href')).toBe('/girard/visit-history')
  if (layout === 'collapsed') expect(localStorage.getItem('padiwan.navigation.collapsed')).toBe('false')
  fireEvent.click(trigger)
  expect(screen.queryByRole('group', { name: 'Submenu Dashboard' })).toBeNull()
})

test.each(['po_admin', 'co_admin', 'hr_admin', 'unknown', ''])('%s gains no dashboard or target access', role => {
  state.role = role; mount('/girard/targets')
  expect(screen.queryByRole('button', { name: 'Dashboard' })).toBeNull()
  for (const name of ['Performa Tim', 'Performa Toko', 'Target Penjualan']) expect(screen.queryByRole('link', { name })).toBeNull()
})

test.each([
  ['/girard/dashboard?tab=team', 'Performa Tim'],
  ['/girard/dashboard?tab=customers&dashboard_month=2026-10-01', 'Performa Toko'],
  ['/girard/dashboard', 'Performa Toko'],
  ['/girard/dashboard?tab=invalid', 'Performa Toko'],
  ['/girard/targets?plan=00000000-0000-4000-8000-000000000001', 'Target Penjualan'],
])('direct link %s expands Dashboard and marks only %s as current', (path, label) => {
  mount(path)
  expect(screen.getByRole('button', { name: 'Dashboard' }).getAttribute('aria-expanded')).toBe('true')
  const links = within(screen.getByRole('group', { name: 'Submenu Dashboard' })).getAllByRole('link')
  expect(links.filter(link => link.getAttribute('aria-current') === 'page').map(link => link.textContent)).toEqual([label])
})

test.each([false, true])('legacy default and explicit tabs preserve the dashboard feature flag (%s)', enabled => {
  state.dashboardEnabled = enabled
  mount('/girard/dashboard?dashboard_month=2026-10-01', true)
  const expected = enabled ? 'Performa Tim' : 'Performa Toko'
  expect(screen.getByRole('link', { name: expected }).getAttribute('aria-current')).toBe('page')
  expect(screen.getByRole('button', { name: expected }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Performa Tim' }))
  expect(screen.getByText(enabled ? 'Team summary content' : 'Legacy team content')).toBeTruthy()
  expect(screen.getByTestId('location').textContent).toBe('/girard/dashboard?dashboard_month=2026-10-01&tab=team')
  fireEvent.click(screen.getByRole('button', { name: 'Performa Toko' }))
  expect(screen.getByText('Store performance content')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Performa Toko' }).getAttribute('aria-current')).toBe('page')
  fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
  expect(screen.getByText(enabled ? 'Team summary content' : 'Legacy team content')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Performa Tim' }).getAttribute('aria-current')).toBe('page')
})

test('mobile disclosure stays in the drawer and a child link closes it, restoring focus', () => {
  viewport(true); mount('/girard/dashboard?tab=team', true)
  const opener = screen.getByRole('button', { name: 'Buka menu' }); opener.focus(); fireEvent.click(opener)
  const dialog = screen.getByRole('dialog', { name: 'Menu utama' })
  const trigger = within(dialog).getByRole('button', { name: 'Dashboard' })
  fireEvent.click(trigger); expect(screen.getByRole('dialog')).toBe(dialog)
  trigger.focus(); fireEvent.click(trigger)
  expect(document.activeElement).toBe(trigger)
  fireEvent.click(within(dialog).getByRole('link', { name: 'Performa Toko' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(opener)
  expect(screen.getByText('Store performance content')).toBeTruthy()
  fireEvent.click(opener)
  expect(screen.getByRole('link', { name: 'Performa Toko' }).getAttribute('aria-current')).toBe('page')
  fireEvent.keyDown(screen.getByRole('button', { name: 'Dashboard' }), { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(opener)
})

test('collapsed Dashboard keeps a keyboard name and tooltip, then exposes child labels', () => {
  localStorage.setItem('padiwan.navigation.collapsed', 'true'); mount('/girard/targets')
  const trigger = screen.getByRole('button', { name: 'Dashboard' })
  fireEvent.focus(trigger); expect(screen.getByRole('tooltip').textContent).toBe('Dashboard')
  fireEvent.click(trigger)
  expect(screen.queryByRole('tooltip')).toBeNull()
  expect(screen.getByRole('link', { name: 'Target Penjualan' }).getAttribute('aria-current')).toBe('page')
})
