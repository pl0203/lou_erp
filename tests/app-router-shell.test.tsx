import React from 'react'
import { transferableAbortController } from 'node:util'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => {
  const root = document.createElement('div'); root.id = 'root'; document.body.append(root)
  return { tree: null as any, user: null as any, role: 'po_admin', authChanged: undefined as undefined | ((event: string, session: any) => void) }
})
vi.mock('react-dom/client', async original => {
  const actual = await original<any>()
  return { ...actual, createRoot: (container: HTMLElement, ...args: any[]) => container.id === 'root' ? { render: (tree: any) => { state.tree = tree } } : actual.createRoot(container, ...args) }
})
vi.mock('../src/lib/supabase', () => ({ supabase: {
  auth: {
    getSession: async () => ({ data: { session: state.user ? { user: state.user } : null } }),
    onAuthStateChange: (callback: any) => { state.authChanged = callback; return { data: { subscription: { unsubscribe() {} } } } },
    signInWithPassword: async () => { state.user = { id: 'actor' }; state.authChanged?.('SIGNED_IN', { user: state.user }); return { error: null } },
    signOut: async () => ({ error: null }),
  },
  rpc: () => ({ single: async () => ({ data: { id: 'actor', full_name: 'Synthetic Actor', role: state.role, is_active: true }, error: null }) }),
} }))
vi.mock('../src/pages/athel/PONew', () => ({ default: () => <p>PO editor route</p> }))
vi.mock('../src/pages/ihr/LeaveManagement', () => ({ default: () => <p>HR leave route</p> }))
vi.mock('../src/pages/athel/POList', () => ({ default: () => <p>PO list route</p> }))
vi.mock('../src/pages/athel/SalesOrders', () => ({ default: () => <p>Legacy sales orders route</p> }))
vi.mock('../src/pages/girard/DailySchedule', () => ({ default: () => <p>Sales schedule route</p> }))
vi.mock('../src/pages/girard/ManagerSchedule', () => ({ default: () => <p>Manager schedule route</p> }))
vi.mock('../src/pages/girard/VisitPage', async () => {
  const { useParams } = await import('react-router-dom')
  return { default: () => <p>Visit route: {useParams().scheduleId}</p> }
})
// The captured tree is exactly what production main.tsx passes to createRoot.
import '../src/main'
const router = () => state.tree.props.children.props.router
beforeEach(() => {
  vi.stubGlobal('AbortController', class { constructor() { return transferableAbortController() } })
  state.user = { id: 'actor' }; state.role = 'po_admin'
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test('the production router/provider shell preserves direct nested URLs and query/hash', async () => {
  await act(() => router().navigate('/athel/po/new?source=direct#details'))
  render(state.tree)
  expect(await screen.findByText('PO editor route')).toBeTruthy()
  expect(router().state.location.pathname).toBe('/athel/po/new')
  expect(router().state.location.search).toBe('?source=direct')
  expect(router().state.location.hash).toBe('#details')
})

test('direct parameterized visit links retain schedule IDs under the wildcard adapter', async () => {
  state.role = 'sales_person'
  await act(() => router().navigate('/girard/visit/synthetic-schedule'))
  render(state.tree)
  expect(await screen.findByText('Visit route: synthetic-schedule')).toBeTruthy()
})

test('unauthenticated direct links redirect to login and validated sign-in retains the existing role home', async () => {
  state.user = null
  await act(() => router().navigate('/athel/po/new'))
  render(state.tree)
  await screen.findByText('Selamat datang')
  expect(router().state.location.pathname).toBe('/login')
  fireEvent.change(screen.getByPlaceholderText('anda@perusahaan.com'), { target: { value: 'synthetic@example.invalid' } })
  fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'synthetic-only' } })
  fireEvent.click(screen.getByRole('button', { name: 'Masuk' }))
  expect(await screen.findByText('PO list route')).toBeTruthy()
  await waitFor(() => expect(router().state.location.pathname).toBe('/athel/po'))
})

test('existing role-denied redirects stay enforced in the new shell', async () => {
  state.role = 'sales_person'
  await act(() => router().navigate('/athel/po/new'))
  render(state.tree)
  expect(await screen.findByText('Sales schedule route')).toBeTruthy()
  expect(router().state.location.pathname).toBe('/girard/schedule')
})

test.each(['executive'])('%s retains the protected direct legacy sales URL', async role => {
  state.role = role
  await act(() => router().navigate('/athel/sales-orders'))
  render(state.tree)
  expect(await screen.findByText('Legacy sales orders route')).toBeTruthy()
  expect(router().state.location.pathname).toBe('/athel/sales-orders')
})

test.each(['sales_person', 'sales_manager', 'sales_head'])('%s still cannot open the legacy Procurement sales route', async role => {
  state.role = role
  await act(() => router().navigate('/athel/sales-orders'))
  render(state.tree)
  await screen.findByText(role === 'sales_person' ? 'Sales schedule route' : 'Manager schedule route')
  expect(screen.queryByText('Legacy sales orders route')).toBeNull()
  expect(router().state.location.pathname).toBe('/girard/schedule')
})

test('unauthenticated legacy sales links still redirect to login', async () => {
  state.user = null
  await act(() => router().navigate('/athel/sales-orders'))
  render(state.tree)
  await screen.findByText('Selamat datang')
  expect(screen.queryByText('Legacy sales orders route')).toBeNull()
  expect(router().state.location.pathname).toBe('/login')
})

test.each(['executive', 'po_admin', 'sales_person', 'sales_manager', 'sales_head'])('%s retains authenticated direct access to the HR leave route', async role => {
  state.role = role
  const query = ['sales_person', 'sales_manager'].includes(role) ? '?tab=mine' : ''
  await act(() => router().navigate(`/ihr/leave${query}`))
  render(state.tree)
  expect(await screen.findByText('HR leave route')).toBeTruthy()
  expect(router().state.location.pathname).toBe('/ihr/leave')
  expect(router().state.location.search).toBe(query)
})

test('unauthenticated direct HR leave links still redirect to login', async () => {
  state.user = null
  await act(() => router().navigate('/ihr/leave?tab=mine'))
  render(state.tree)
  await screen.findByText('Selamat datang')
  expect(screen.queryByText('HR leave route')).toBeNull()
  expect(router().state.location.pathname).toBe('/login')
})

test('PO Admin direct legacy sales URL now returns to its allowed home', async () => {
 state.role='po_admin'; await act(()=>router().navigate('/athel/sales-orders')); render(state.tree)
 expect(await screen.findByText('PO list route')).toBeTruthy(); expect(screen.queryByText('Legacy sales orders route')).toBeNull()
})
