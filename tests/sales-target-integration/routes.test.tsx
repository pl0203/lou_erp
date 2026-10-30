import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
import App from '../../src/App'
const clients: QueryClient[] = []
function client(){const value=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});clients.push(value);return value}
afterEach(()=>{cleanup();clients.splice(0).forEach(value=>value.clear())})
beforeEach(()=>{state.authenticated=true;state.active=true})
function mount(){render(<QueryClientProvider client={client()}><MemoryRouter initialEntries={['/girard/targets']}><App/></MemoryRouter></QueryClientProvider>)}
test.each(['sales_person','sales_manager','sales_head','executive'])('%s reaches targets route without wider authorization',role=>{
 state.role=role;mount();expect(screen.getByText('Monthly target boundary')).toBeTruthy();expect(document.title).toBe('Target Penjualan | Padiwan')
})
test.each(['po_admin','co_admin'])('%s cannot reach targets route',role=>{state.role=role;mount();expect(screen.queryByText('Monthly target boundary')).toBeNull()})
test('signed out cannot reach targets route',()=>{state.authenticated=false;mount();expect(screen.getByText('Login boundary')).toBeTruthy()})
test('inactive identity cannot reach targets route',()=>{state.active=false;mount();expect(screen.getByText('Login boundary')).toBeTruthy()})
