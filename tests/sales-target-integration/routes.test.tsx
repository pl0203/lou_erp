import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ role: 'sales_manager', authenticated: true, active: true }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ user: state.authenticated ? {id:'actor'} : null, profile:{id:'actor',role:state.role,is_active:state.active},loading:false }) }))
vi.mock('../../src/pages/girard/SalesTargets', () => ({default:()=> <p>Monthly target boundary</p>}))
vi.mock('../../src/pages/Login', () => ({default:()=> <p>Login boundary</p>}))
vi.mock('../../src/pages/athel/POList', () => ({default:()=> <p>Procurement boundary</p>}))
vi.mock('../../src/pages/athel/co/COOrders', () => ({default:()=> <p>Consignment boundary</p>}))
vi.mock('../../src/pages/athel/co/COLayout', () => ({default:()=> <p>Consignment boundary</p>}))
// Employee authority is independently covered; these are outer route tests.
vi.mock('../../src/lib/employees/useEmployeeContext', () => ({ useEmployeeIdentityBoundary: () => undefined, useEmployeeContext: () => ({ displayAllowed: false }) }))
vi.mock('../../src/pages/ihr/employees/EmployeeList', () => ({ default: () => <p data-testid="route-leaf">EmployeeList</p> }))
vi.mock('../../src/pages/ihr/employees/EmployeeDetail', () => ({ default: () => <p data-testid="route-leaf">EmployeeDetail</p> }))
vi.mock('../../src/pages/ihr/employees/EmployeeEditor', () => ({ default: () => <p data-testid="route-leaf">EmployeeEditor</p> }))
vi.mock('../../src/pages/ihr/employees/EmployeeReportingEditor', () => ({ default: () => <p data-testid="route-leaf">EmployeeReportingEditor</p> }))
import App from '../../src/App'
afterEach(cleanup)
beforeEach(()=>{state.authenticated=true;state.active=true})
function mount(){render(<MemoryRouter initialEntries={['/girard/targets']}><App/></MemoryRouter>)}
test.each(['sales_person','sales_manager','sales_head','executive'])('%s reaches targets route without wider authorization',role=>{
 state.role=role;mount();expect(screen.getByText('Monthly target boundary')).toBeTruthy();expect(document.title).toBe('Target Penjualan | Padiwan')
})
test.each(['po_admin','co_admin'])('%s cannot reach targets route',role=>{state.role=role;mount();expect(screen.queryByText('Monthly target boundary')).toBeNull()})
test('signed out cannot reach targets route',()=>{state.authenticated=false;mount();expect(screen.getByText('Login boundary')).toBeTruthy()})
test('inactive identity cannot reach targets route',()=>{state.active=false;mount();expect(screen.getByText('Login boundary')).toBeTruthy()})

vi.mock('../../src/lib/supabase', () => ({ supabase: new Proxy({}, { get: (_target, key) => { throw new Error(`Unexpected Supabase access: ${String(key)}`) } }) }))
