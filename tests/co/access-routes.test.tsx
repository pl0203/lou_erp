import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
const auth = vi.hoisted(() => ({ user: { id: 'actor' }, profile: { id: 'actor', role: 'co_admin', is_active: true, full_name: 'Operator' }, loading: false, signOut: vi.fn() }))
const reads = vi.hoisted(() => vi.fn())
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../../src/pages/Login', () => ({ default: () => <p>Login boundary</p> }))
vi.mock('../../src/pages/ihr/UserManagement', () => ({ default: () => { reads('users'); return <p>User admin data</p> } }))
vi.mock('../../src/pages/girard/Dashboard', () => ({ default: () => { reads('sales-dashboard'); return <p>Sales dashboard data</p> } }))
// Route boundaries use inert leaf screens; CO screen/data behavior has its own data-router suites.
vi.mock('../../src/pages/athel/co/COOrders', () => ({ default: () => <p>CO home</p> }))
vi.mock('../../src/pages/athel/POList', () => ({ default: () => <p>PO home</p> }))
vi.mock('../../src/pages/athel/Dashboard', () => ({ default: () => { reads('dashboard'); return <p>Dashboard data</p> } }))
vi.mock('../../src/pages/athel/SalesOrders', () => ({ default: () => { reads('sales'); return <p>Legacy sales data</p> } }))
vi.mock('../../src/pages/athel/Promotions', () => ({ default: () => { reads('promotions'); return <p>Promotion data</p> } }))
vi.mock('../../src/pages/athel/PONew', () => ({ default: () => { reads('po'); return <p>PO form</p> } }))
vi.mock('../../src/pages/athel/PODetail', () => ({ default: () => { reads('po'); return <p>PO detail</p> } }))
vi.mock('../../src/pages/athel/POEdit', () => ({ default: () => { reads('po'); return <p>PO edit</p> } }))
vi.mock('../../src/pages/athel/CustomerList', () => ({ default: () => <p>Customer data</p> }))
vi.mock('../../src/pages/athel/ProductList', () => ({ default: () => <p>Item data</p> }))
vi.mock('../../src/pages/ihr/LeaveManagement', () => ({ default: () => <p>HR data</p> }))
// Employee authority is independently covered; these are outer route tests.
vi.mock('../../src/lib/employees/useEmployeeContext', () => ({ useEmployeeIdentityBoundary: () => undefined, useEmployeeContext: () => ({ displayAllowed: false }) }))
vi.mock('../../src/pages/ihr/employees/EmployeeList', () => ({ default: () => <p data-testid="route-leaf">EmployeeList</p> }))
vi.mock('../../src/pages/ihr/employees/EmployeeDetail', () => ({ default: () => <p data-testid="route-leaf">EmployeeDetail</p> }))
vi.mock('../../src/pages/ihr/employees/EmployeeEditor', () => ({ default: () => <p data-testid="route-leaf">EmployeeEditor</p> }))
vi.mock('../../src/pages/ihr/employees/EmployeeReportingEditor', () => ({ default: () => <p data-testid="route-leaf">EmployeeReportingEditor</p> }))
import App from '../../src/App'
import AthelNav from '../../src/components/AthelNav'
import { roleHome, moduleOptions } from '../../src/components/navigationModules'
afterEach(() => { cleanup(); reads.mockClear(); auth.profile.is_active = true })
function mount(role: string, path: string) { auth.profile.role = role; render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>) }
test.each(['po_admin', 'co_admin'])('%s cannot mount disallowed data routes', role => {
  for (const path of ['/athel/dashboard', '/athel/promotions', '/athel/sales-orders', '/girard/dashboard', '/ihr/users', ...(role === 'co_admin' ? ['/athel/po/new', '/athel/po/1', '/athel/po/1/edit'] : [])]) {
    mount(role, path); expect(reads).not.toHaveBeenCalled(); cleanup()
  }
})
test.each(['po_admin', 'co_admin'])('%s keeps both master lists and HR', role => { for (const [path, text] of [['/athel/customers','Customer data'], ['/athel/products','Item data'], ['/ihr/leave','HR data']]) { mount(role,path); expect(screen.getByText(text)).toBeTruthy(); cleanup() } })
test('CO has an authorized minimal route shell and home', () => {
  mount('co_admin','/athel/co')
  expect(screen.queryByRole('navigation', { name: 'Bagian pesanan konsinyasi' })).toBeNull()
  const submenu = screen.getByRole('group', { name: 'Submenu Consignment Order' })
  expect(within(submenu).getByRole('link', { name: 'Pesanan CO' }).getAttribute('aria-current')).toBe('page')
  const main = screen.getByRole('main')
  expect(screen.getAllByRole('main')).toHaveLength(1)
  expect(main.id).toBe('main-content')
  expect(within(main).getByText('CO home')).toBeTruthy()
  expect(roleHome('co_admin')).toBe('/athel/co')
  expect(moduleOptions('co_admin').map(v=>v.to)).toEqual(['/athel/co','/ihr/leave'])
})
test.each(['co_admin','po_admin','executive'])('%s has only approved Procurement links', role => {
 auth.profile.role=role; render(<MemoryRouter><AthelNav /></MemoryRouter>);
 const nav=screen.getByRole('navigation',{name:'Navigasi Procurement'});
 expect(!!within(nav).queryByRole('button',{name:'Consignment Order'})).toBe(role!=='po_admin');
 const links=within(nav).getAllByRole('link').map(v=>v.getAttribute('href'));
 expect(links).toEqual(role==='executive'?['/athel/dashboard','/athel/po','/athel/customers','/athel/promotions','/athel/products']: [...(role==='po_admin'?['/athel/po']:[]),'/athel/customers','/athel/products'])

})
test('executive retains Dashboard and legacy administration', () => { mount('executive','/athel/dashboard'); expect(reads).toHaveBeenCalledWith('dashboard'); cleanup(); mount('executive','/athel/sales-orders'); expect(reads).toHaveBeenCalledWith('sales') })
test('inactive CO cannot enter even the shell', () => { auth.profile.is_active=false; mount('co_admin','/athel/co'); expect(screen.getByText('Login boundary')).toBeTruthy() })

test('PO cannot enter the CO route family',()=>{
  mount('po_admin','/athel/co')
  expect(screen.getByText('PO home')).toBeTruthy()
  expect(screen.queryByText('Pesanan konsinyasi (CO)')).toBeNull()
  expect(screen.queryByRole('navigation', { name: 'Bagian pesanan konsinyasi' })).toBeNull()
})

vi.mock('../../src/lib/supabase', () => ({ supabase: new Proxy({}, { get: (_target, key) => { throw new Error(`Unexpected Supabase access: ${String(key)}`) } }) }))
