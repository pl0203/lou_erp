import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { LeaveContext } from '../../src/lib/leave/contracts'
const mocks = vi.hoisted(() => ({ auth: { user: { id: '71000000-0000-0000-0000-000000000001' }, profile: { id: '71000000-0000-0000-0000-000000000001', role: 'sales_person', full_name: 'Fictional Person', is_active: true }, loading: false, signOut: vi.fn() } }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => mocks.auth }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { from: () => ({ select: () => ({ eq: () => Promise.resolve({ count: 0, error: null }) }) }), rpc: vi.fn() } }))
vi.mock('../../src/pages/Login', () => ({ default: () => <p>Login route</p> }))
vi.mock('../../src/pages/ihr/LeaveManagement', () => ({ default: () => <p>Leave route</p> }))
vi.mock('../../src/pages/ihr/UserManagement', () => ({ default: () => <p>User administration route</p> }))
vi.mock('../../src/pages/girard/DailySchedule', () => ({ default: () => <p>Sales home</p> }))
vi.mock('../../src/pages/girard/ManagerSchedule', () => ({ default: () => <p>Manager home</p> }))
vi.mock('../../src/pages/athel/POList', () => ({ default: () => <p>PO home</p> }))
import App from '../../src/App'
import IHRNav from '../../src/components/IHRNav'
import AthelNav from '../../src/components/AthelNav'
import GirardNav from '../../src/components/GirardNav'
import LeaveTabs from '../../src/pages/ihr/leave/LeaveTabs'
function Location() { return <output>{useLocation().pathname}</output> }
function mount(element: React.ReactNode, path = '/ihr/leave') {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}>{element}<Location /></MemoryRouter></QueryClientProvider>)
}
beforeEach(() => { mocks.auth.profile.role = 'sales_person'; mocks.auth.profile.is_active = true })
afterEach(cleanup)
test.each(['sales_person', 'sales_manager', 'sales_head', 'po_admin', 'executive'])('%s can enter leave without deriving HR authority', role => {
  mocks.auth.profile.role = role; mount(<App />); expect(screen.getByText('Leave route')).toBeTruthy()
})
test.each(['sales_person', 'sales_manager', 'sales_head', 'po_admin'])('%s cannot enter user administration', role => {
  mocks.auth.profile.role = role; mount(<App />, '/ihr/users'); expect(screen.queryByText('User administration route')).toBeNull()
  expect(screen.getByText(role === 'po_admin' ? 'PO home' : role === 'sales_person' ? 'Sales home' : 'Manager home')).toBeTruthy()
})
test('inactive identity remains denied', () => { mocks.auth.profile.is_active = false; mount(<App />); expect(screen.getByText('/login')).toBeTruthy(); expect(screen.queryByText('Leave route')).toBeNull() })
test.each(['sales_person', 'sales_manager', 'po_admin'])('%s iHR switch offers only their module home', role => {
  mocks.auth.profile.role = role; mount(<IHRNav />)
  expect(screen.queryByText('Manajemen Pengguna')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'iHR' }))
  expect(screen.getByRole('button', { name: 'iHR' }).getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: role === 'po_admin' ? /Athel/ : /Girard/ }))
  expect(screen.getByText(role === 'po_admin' ? '/athel/po' : '/girard/schedule')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Menu pengguna' })); fireEvent.click(screen.getByRole('button', { name: 'Kembali ke modul' }))
  expect(screen.queryByText('/landing')).toBeNull()
})
test('executive retains existing user-management entry', () => { mocks.auth.profile.role = 'executive'; mount(<IHRNav />); expect(screen.getAllByRole('link', { name: 'Manajemen Pengguna' })[0].getAttribute('href')).toBe('/ihr/users') })
test.each(['sales_person', 'sales_manager'])('%s has an independent iHR module entry opening Ajukan Cuti without PO access', role => {
  mocks.auth.profile.role = role; mount(<GirardNav />)
  expect(screen.getAllByRole('link', { name: 'iHR' })[0].getAttribute('href')).toBe('/ihr/leave?tab=mine')
  fireEvent.click(screen.getByRole('button', { name: 'Girard' }))
  expect(screen.getByRole('button', { name: 'Girard' }).getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: /iHR/ }))
  expect(screen.getByText('/ihr/leave')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Athel/ })).toBeNull()
})
test.each(['sales_person', 'sales_manager'])('%s iHR page navigation labels the default leave page Ajukan Cuti', role => {
  mocks.auth.profile.role = role; mount(<IHRNav />)
  expect(screen.getAllByRole('link', { name: 'Ajukan Cuti' })[0].getAttribute('href')).toBe('/ihr/leave?tab=mine')
  expect(screen.queryByText('Manajemen Pengguna')).toBeNull()
})
test('PO admin has a direct leave entry without sales access', () => {
  mocks.auth.profile.role = 'po_admin'; mount(<AthelNav />)
  expect(screen.getAllByRole('link', { name: 'Cuti' })[0].getAttribute('href')).toBe('/ihr/leave')
  expect(screen.queryByRole('button', { name: /Girard/ })).toBeNull()
})
const director: LeaveContext = { scopeVersion: '1', memberKind: 'director', timezone: null, balances: [], setup: { ready: false, blockers: [] }, capabilities: { request: false, approve: true, configure: false, adjust: false, readPrivate: false, manageAccess: false } }
test('director gets only assigned approval navigation', () => { mount(<LeaveTabs context={director} />); expect(screen.getByRole('tab', { name: 'Persetujuan' })).toBeTruthy(); expect(screen.queryByRole('tab', { name: 'Ajukan Cuti' })).toBeNull(); expect(screen.queryByRole('tab', { name: 'Pengaturan' })).toBeNull() })
test('application role grants no HR tabs', () => { mocks.auth.profile.role = 'executive'; mount(<LeaveTabs context={{ ...director, memberKind: null, capabilities: { ...director.capabilities, approve: false } }} />); expect(screen.queryByRole('tab')).toBeNull() })
