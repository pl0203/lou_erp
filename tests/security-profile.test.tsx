import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
const rpcProfile = { id: 'a', full_name: 'Scoped user', email: 'own@example.invalid', role: 'sales_person', is_active: true, manager_id: null }
vi.mock('../src/components/IHRNav', () => ({ default: () => null }))
vi.mock('../src/lib/supabase', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'a' } } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  from: () => { const query: any = { select: () => query, eq: () => query, single: async () => ({ data: null, error: new Error('Private user columns are not directly readable') }) }; return query },
  rpc: (name: string) => name === 'pilot_list_users' ? Promise.resolve({ data: [{ ...rpcProfile, full_name: 'Admin-visible account', phone: null, birth_date: null, invited_at: null }], error: null }) : ({ single: async () => name === 'pilot_my_profile' ? { data: rpcProfile, error: null } : { data: null, error: new Error('Unknown RPC') } }),
} }))
import UserManagement from '../src/pages/ihr/UserManagement'
import { AuthProvider, useAuth } from '../src/lib/AuthContext'
function Profile() { const { profile, loading } = useAuth(); return <div>{loading ? 'Loading' : profile?.email ?? 'Unavailable'}</div> }
afterEach(cleanup)
test('loads own profile when raw users PII columns are denied', async () => {
  render(<QueryClientProvider client={new QueryClient()}><AuthProvider><Profile /></AuthProvider></QueryClientProvider>)
  expect(await screen.findByText('own@example.invalid')).toBeTruthy()
})

test('admin user list uses its authorized directory when raw user PII is denied', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><UserManagement /></QueryClientProvider>)
  expect((await screen.findAllByText('Admin-visible account')).length).toBeGreaterThan(0)
})
