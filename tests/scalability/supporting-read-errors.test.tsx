import { MemoryRouter } from 'react-router-dom'
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ refetch: vi.fn(), rpc: vi.fn(), role: 'sales_manager' }))
vi.mock('../../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../../src/components/TransactionRecovery', () => ({ default: () => null }))
vi.mock('../../src/lib/orderTransactions', () => ({ createTransactionSender: () => Object.assign(vi.fn(), { hasUnresolved: () => false }), useTransactionSender: () => vi.fn() }))
vi.mock('../../src/lib/useUnsavedChanges', () => ({ hasOrderItemChanges: () => false, useUnsavedChanges: () => ({ dialog: null, runWithoutPrompt: (fn: any) => fn() }) }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: '00000000-0000-4000-8000-000000000002' }, profile: { id: '00000000-0000-4000-8000-000000000002', role: state.role, is_active: true }, loading: false, error: null }) }))
vi.mock('../../src/lib/supabase', () => ({ supabase: {
  supabaseUrl: 'https://catalogue.test', rest: { url: 'https://catalogue.test/rest/v1', schemaName: 'public' },
  rpc(name: string, args: any) {
    state.rpc(name, args)
    const q: any = { abortSignal: () => q, then: (resolve: any, reject: any) => Promise.resolve({ data: null, error: new Error('catalogue unavailable') }).then(resolve, reject) }
    return q
  },
} }))
vi.mock('@tanstack/react-query', async original => {
  const actual = await original<typeof import('@tanstack/react-query')>()
  return { ...actual,
    // Catalogue errors and retries must cross the real identity/query lifecycle.
    useQuery: (options: any) => options.queryKey[0] === 'catalogue' ? actual.useQuery(options) : { data: undefined, isLoading: false, isError: true, refetch: state.refetch },
    useMutation: () => ({ mutate: vi.fn() }),
  }
})
import PONew from '../../src/pages/athel/PONew'
import MyVisits from '../../src/pages/girard/MyVisits'
import GirardCustomers from '../../src/pages/girard/GirardCustomers'
import GirardManagers from '../../src/pages/girard/GirardManagers'
import ManagerSchedule from '../../src/pages/girard/ManagerSchedule'
import Promotions from '../../src/pages/girard/Promotions'
const clients: QueryClient[] = []
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); state.refetch.mockClear(); state.rpc.mockClear() })
for (const [name, Page] of [['PO catalogs', PONew], ['own visits', MyVisits], ['customer directory', GirardCustomers], ['manager directory', GirardManagers], ['manager schedules', ManagerSchedule], ['promotions', Promotions]] as const) {
  test(`${name} reports incomplete or failed reads with retry rather than success-shaped emptiness`, async () => {
    state.role = name === 'PO catalogs' ? 'po_admin' : 'sales_manager'
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client)
    render(<QueryClientProvider client={client}><MemoryRouter><Page /></MemoryRouter></QueryClientProvider>)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText(/Tidak ada.*(?:pelanggan|kunjungan|manajer|promosi|jadwal)/i)).toBeNull()
    if (name === 'PO catalogs') await waitFor(() => { expect(state.rpc).toHaveBeenCalledTimes(2); expect(client.isFetching()).toBe(0) })
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
    if (name === 'PO catalogs') {
      await waitFor(() => { expect(state.rpc).toHaveBeenCalledTimes(4); expect(client.isFetching()).toBe(0) })
      expect(state.rpc.mock.calls.map(([, args]) => args.p_kind).sort()).toEqual(['customer', 'customer', 'product', 'product'])
      expect(state.rpc.mock.calls.every(([rpc, args]) => rpc === 'pilot_catalog_page_v1' && args.p_purpose === 'enabled-for-order' && args.p_status === 'enabled')).toBe(true)
      const queries = client.getQueryCache().findAll({ queryKey: ['catalogue'] })
      expect(queries).toHaveLength(2)
      expect(queries.every(query => query.state.status === 'error' && query.state.error?.message === 'catalogue unavailable' && query.state.data === undefined)).toBe(true)
      expect(screen.getByRole('alert')).toBeTruthy()
      expect((screen.getByRole('button', { name: 'Simpan PO' }) as HTMLButtonElement).disabled).toBe(true)
    } else expect(state.refetch).toHaveBeenCalled()
  })
}

vi.mock('../../src/components/VisitRequestInbox', () => ({ default: () => null, VisitProposalForm: () => null }))
