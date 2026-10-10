import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const state = vi.hoisted(() => ({ role: 'executive', signOut: vi.fn(), from: vi.fn(() => ({ select: () => ({ eq: async () => ({ count: 100, error: null }) }) })) }))
vi.mock('../src/lib/supabase', () => ({ supabase: { from: state.from } }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { role: state.role, full_name: 'Example Executive' }, signOut: state.signOut }) }))
import AthelNav from '../src/components/AthelNav'
import AppNavigation from '../src/components/AppNavigation'
import GirardNav from '../src/components/GirardNav'
import IHRNav from '../src/components/IHRNav'
import Landing from '../src/pages/Landing'

let viewportListener: ((event: { matches: boolean }) => void) | undefined
function viewport(mobile = false) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: mobile, addEventListener: (_: string, listener: typeof viewportListener) => { viewportListener = listener }, removeEventListener: vi.fn() })))
}
function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output> }
function mount(component: React.ReactNode = <AthelNav />, path = '/athel/po') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><div className="min-h-screen">{component}<main><button>Page action</button></main></div><Location /></MemoryRouter></QueryClientProvider>)
}
beforeEach(() => { state.role = 'executive'; state.from.mockClear(); state.signOut.mockReset().mockResolvedValue(true); localStorage.clear(); viewport() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

test('desktop has a single semantic navigation and preserves nested Purchase Order selection', () => {
  mount(<AthelNav />, '/athel/po/123/edit')
  const nav = screen.getByRole('navigation', { name: 'Navigasi Procurement' })
  expect(within(nav).getAllByRole('link', { name: 'Purchase Order' })).toHaveLength(1)
  expect(within(nav).getByRole('link', { name: 'Purchase Order' }).getAttribute('aria-current')).toBe('page')
})

test('navigation badges cap visual counts while retaining the accessible count', () => {
  mount(<AppNavigation module="athel" links={[{ to: '/example', label: 'Example queue', icon: 'orders', badge: 100 }]} />)
  const link = screen.getByRole('link', { name: /Example queue/ })
  expect(link.textContent).toContain('99+')
  expect(link.getAttribute('aria-label')).toContain('100')
})

test.each(['executive', 'po_admin', 'co_admin'].flatMap(role => ['expanded', 'collapsed', 'mobile'].map(layout => [role, layout])))('%s has no legacy sales queue in %s navigation', (role, layout) => {
  state.role = role
  viewport(layout === 'mobile')
  mount()
  if (layout === 'collapsed') fireEvent.click(screen.getByRole('button', { name: 'Minimalkan menu' }))
  if (layout === 'mobile') fireEvent.click(screen.getByRole('button', { name: 'Buka menu' }))
  const nav = screen.getByRole('navigation', { name: 'Navigasi Procurement' })
  expect(within(nav).queryByRole('link', { name: /Antrean Sales lama/i })).toBeNull()
  expect(nav.querySelector('a[href="/athel/sales-orders"]')).toBeNull()
  expect(within(nav).getAllByRole('link').map(link => [link.getAttribute('href'), link.getAttribute('aria-label')])).toEqual([
    ...(role === 'executive' ? [['/athel/dashboard', 'Dashboard']] : []),
    ...(role !== 'co_admin' ? [['/athel/po', 'Purchase Order']] : []),
    ...(role !== 'po_admin' ? [['/athel/co', 'Consignment Order']] : []),
    ['/athel/customers', 'Daftar Pelanggan'],
    ...(role === 'executive' ? [['/athel/promotions', 'Promosi']] : []),
    ['/athel/products', 'Daftar Barang'],
  ])
})

test.each(['executive', 'po_admin'])('%s navigation no longer fetches or polls the legacy sales badge', async role => {
  vi.useFakeTimers()
  state.role = role
  mount()
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
  expect(state.from).not.toHaveBeenCalled()
})

test('hamburger collapses to named icons, offers keyboard tooltips and restores the preference after remount', () => {
  const view = mount()
  const collapse = screen.getByRole('button', { name: 'Minimalkan menu' })
  expect(collapse.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(collapse)
  expect(screen.getByRole('button', { name: 'Buka menu' }).getAttribute('aria-expanded')).toBe('false')
  const purchase = screen.getByRole('link', { name: 'Purchase Order' })
  expect(purchase.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  fireEvent.focus(purchase)
  expect(screen.getByRole('tooltip').textContent).toBe('Purchase Order')
  fireEvent.keyDown(purchase, { key: 'Escape' })
  expect(screen.queryByRole('tooltip')).toBeNull()
  view.unmount(); mount()
  expect(screen.getByRole('button', { name: 'Buka menu' }).getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: 'Buka menu' }))
  expect(screen.getByRole('button', { name: 'Minimalkan menu' })).toBeTruthy()
})

test('storage refusal cannot prevent opening or minimizing navigation', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked') })
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Minimalkan menu' }))
  expect(screen.getByRole('button', { name: 'Buka menu' })).toBeTruthy()
})

test.each(['sales_person', 'sales_manager', 'sales_head', 'po_admin', 'executive'])('%s keeps the existing module access and renamed labels', role => {
  state.role = role; mount(<IHRNav />, '/ihr/leave')
  expect(!!screen.queryByRole('link', { name: 'Manajemen Pengguna' })).toBe(role === 'executive')
  fireEvent.click(screen.getByRole('button', { name: 'HR' }))
  const choices = screen.getByRole('group', { name: 'Pilihan modul' })
  expect(!!within(choices).queryByRole('button', { name: /Procurement/ })).toBe(['po_admin', 'executive'].includes(role))
  expect(!!within(choices).queryByRole('button', { name: /Sales/ })).toBe(role !== 'po_admin')
  fireEvent.click(within(choices).getByRole('button', { name: /HR/ }))
  expect(screen.getByTestId('location').textContent).toBe(role === 'executive' ? '/ihr/users' : ['sales_person', 'sales_manager'].includes(role) ? '/ihr/leave?tab=mine' : '/ihr/leave')
})

test.each(['sales_person', 'sales_manager'])('%s retains its Sales operational links', role => {
  state.role = role; mount(<GirardNav />, '/girard/schedule')
  expect(screen.getByRole('link', { name: 'Promosi' }).getAttribute('href')).toBe('/girard/promotions')
  expect(screen.getByRole('link', { name: 'Riwayat Kunjungan' }).getAttribute('href')).toBe('/girard/visit-history')
  expect(screen.getByRole('link', { name: 'Riwayat Pesanan' }).getAttribute('href')).toBe('/girard/my-orders')
})

test('mobile drawer closes with Escape and returns focus to its opener', () => {
  viewport(true); mount()
  const opener = screen.getByRole('button', { name: 'Buka menu' }); opener.focus(); fireEvent.click(opener)
  const dialog = screen.getByRole('dialog', { name: 'Menu utama' })
  expect(dialog.getAttribute('aria-modal')).toBe('true')
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Tutup menu' }))
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(opener)
})

test('mobile drawer traps keyboard focus and closes after following a route', () => {
  viewport(true); mount()
  fireEvent.click(screen.getByRole('button', { name: 'Buka menu' }))
  const dialog = screen.getByRole('dialog')
  const close = within(dialog).getByRole('button', { name: 'Tutup menu' })
  close.focus(); fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Menu pengguna' }))
  fireEvent.keyDown(dialog, { key: 'Tab' })
  expect(document.activeElement).toBe(close)
  fireEvent.click(within(dialog).getByRole('link', { name: 'Dashboard' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByTestId('location').textContent).toBe('/athel/dashboard')
})

test('resizing to desktop clears mobile dialog and body lock', () => {
  viewport(true); mount(); fireEvent.click(screen.getByRole('button', { name: 'Buka menu' }))
  expect(document.body.style.overflow).toBe('hidden')
  act(() => viewportListener?.({ matches: false }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.body.style.overflow).not.toBe('hidden')
  expect(screen.getByRole('button', { name: 'Minimalkan menu' })).toBeTruthy()
})

test('HR sign-out still respects the unsaved-draft safeguard', async () => {
  const beforeSignOut = vi.fn(() => false); mount(<IHRNav beforeSignOut={beforeSignOut} />, '/ihr/leave')
  fireEvent.click(screen.getByRole('button', { name: 'Menu pengguna' })); fireEvent.click(screen.getByRole('button', { name: 'Keluar' }))
  expect(beforeSignOut).toHaveBeenCalledOnce(); expect(state.signOut).not.toHaveBeenCalled()
  beforeSignOut.mockReturnValue(true); fireEvent.click(screen.getByRole('button', { name: 'Keluar' }))
  expect(state.signOut).toHaveBeenCalledOnce()
  await act(async () => {})
  // Mocked auth does not change identity; the real provider/ProtectedRoute redirect is covered by co/signout.
  expect(screen.getByTestId('location').textContent).toBe('/ihr/leave')
})

test('module chooser uses the same collapsible sidebar and all approved module names', () => {
  mount(<Landing />, '/landing')
  expect(screen.getByRole('button', { name: 'Minimalkan menu' })).toBeTruthy()
  for (const label of ['Procurement', 'Sales', 'HR']) expect(screen.getByRole('link', { name: label })).toBeTruthy()
  expect(screen.queryByText('Athel')).toBeNull(); expect(screen.queryByText('Girard')).toBeNull(); expect(screen.queryByText('iHR')).toBeNull()
})

test('Escape on closed mobile module/account controls dismisses the drawer', () => {
  viewport(true); mount()
  const opener = screen.getByRole('button', { name: 'Buka menu' })
  for (const label of ['Procurement', 'Menu pengguna']) {
    fireEvent.click(opener)
    const control = within(screen.getByRole('dialog')).getByRole('button', { name: label })
    control.focus(); fireEvent.keyDown(control, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  }
})

test('account Escape closes only the popover and restores focus to its trigger', () => {
  mount()
  const trigger = screen.getByRole('button', { name: 'Menu pengguna' })
  fireEvent.click(trigger)
  const signOut = screen.getByRole('button', { name: 'Keluar' }); signOut.focus()
  fireEvent.keyDown(signOut, { key: 'Escape' })
  expect(screen.queryByRole('button', { name: 'Keluar' })).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

test('account actions follow the account trigger in keyboard reading order', () => {
  mount()
  const trigger = screen.getByRole('button', { name: 'Menu pengguna' })
  fireEvent.click(trigger)
  const home = screen.getByRole('button', { name: 'Ganti modul' })
  const signOut = screen.getByRole('button', { name: 'Keluar' })
  expect(trigger.compareDocumentPosition(home) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(home.compareDocumentPosition(signOut) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

const allRoles = ['sales_person', 'sales_manager', 'sales_head', 'po_admin', 'executive']
const layouts = ['expanded', 'collapsed', 'mobile']
const crossModuleCases = allRoles.flatMap(role => ['Procurement', 'Sales'].flatMap(module => layouts.map(layout => [role, module, layout])))

test.each(crossModuleCases)('%s has no leave shortcut in %s %s navigation but can still switch to HR', (role, module, layout) => {
  state.role = role
  viewport(layout === 'mobile')
  mount(module === 'Procurement' ? <AthelNav /> : <GirardNav />, module === 'Procurement' ? '/athel/po' : '/girard/schedule')
  if (layout === 'collapsed') fireEvent.click(screen.getByRole('button', { name: 'Minimalkan menu' }))
  if (layout === 'mobile') fireEvent.click(screen.getByRole('button', { name: 'Buka menu' }))
  const nav = screen.getByRole('navigation', { name: `Navigasi ${module}` })
  expect(nav.querySelector('a[href^="/ihr/leave"]')).toBeNull()
  expect(within(nav).queryByRole('link', { name: /Cuti|HR/i })).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: module }))
  const choices = screen.getByRole('group', { name: 'Pilihan modul' })
  fireEvent.click(within(choices).getByRole('button', { name: /HR/ }))
  expect(screen.getByTestId('location').textContent).toBe(role === 'executive' ? '/ihr/users' : ['sales_person', 'sales_manager'].includes(role) ? '/ihr/leave?tab=mine' : '/ihr/leave')
  if (layout === 'mobile') expect(screen.queryByRole('dialog')).toBeNull()
})

test.each(allRoles.flatMap(role => layouts.map(layout => [role, layout])))('%s retains its leave link inside HR in %s navigation', (role, layout) => {
  state.role = role
  viewport(layout === 'mobile')
  mount(<IHRNav />, '/ihr/leave')
  if (layout === 'collapsed') fireEvent.click(screen.getByRole('button', { name: 'Minimalkan menu' }))
  if (layout === 'mobile') fireEvent.click(screen.getByRole('button', { name: 'Buka menu' }))
  const nav = screen.getByRole('navigation', { name: 'Navigasi HR' })
  const personal = ['sales_person', 'sales_manager'].includes(role)
  const leave = within(nav).getByRole('link', { name: personal ? 'Ajukan Cuti' : 'Manajemen Cuti' })
  expect(leave.getAttribute('href')).toBe(personal ? '/ihr/leave?tab=mine' : '/ihr/leave')
  expect(leave.getAttribute('aria-current')).toBe('page')
  expect(!!within(nav).queryByRole('link', { name: 'Manajemen Pengguna' })).toBe(role === 'executive')
  fireEvent.click(leave)
  expect(screen.getByTestId('location').textContent).toBe(personal ? '/ihr/leave?tab=mine' : '/ihr/leave')
  if (layout === 'mobile') expect(screen.queryByRole('dialog')).toBeNull()
})
