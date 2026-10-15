import { MemoryRouter } from 'react-router-dom'
import React from 'react'
import { QueryClient } from '@tanstack/react-query'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { supportingReadFixture } from './fixtures'
const state = vi.hoisted(() => ({
  fixture: { tables: {} } as any, queries: new Map<string, any>(), role: 'executive', cataloguePages: [] as any[],
}))
vi.mock('../../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../../src/components/TransactionRecovery', () => ({ default: () => null }))
vi.mock('../../src/components/ActivePromotionsBanner', () => ({ default: () => null }))
vi.mock('../../src/lib/orderTransactions', () => ({ createTransactionSender: () => Object.assign(vi.fn(), { hasUnresolved: () => false }), useTransactionSender: () => vi.fn() }))
vi.mock('../../src/lib/useUnsavedChanges', () => ({ hasOrderItemChanges: () => false, useUnsavedChanges: () => ({ dialog: null, runWithoutPrompt: (fn: any) => fn(), confirmDiscard: (fn: any) => fn() }) }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: '00000000-0000-4000-8000-000000000002' }, profile: { id: '00000000-0000-4000-8000-000000000002', role: state.role, is_active: true }, loading: false }) }))
// Capture the real query functions without auto-fetching, but retain a real cache
// for the catalogue hook's subscription, identity cleanup, and live-state reads.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQuery: (options: any) => { state.queries.set(JSON.stringify(options.queryKey), options); return { isLoading: true } },
  useQueryClient: () => queryClient,
  useMutation: () => ({ mutate: vi.fn() }),
}))
vi.mock('../../src/lib/supabase', async () => { const { fixtureClient } = await import('./fixtures'); return { supabase: { ...fixtureClient(() => state.fixture), supabaseUrl: 'https://catalogue.test', rest: { url: 'https://catalogue.test/rest/v1', schemaName: 'public' } } } })
import PONew from '../../src/pages/athel/PONew'
import DailySchedule from '../../src/pages/girard/DailySchedule'
import MyVisits from '../../src/pages/girard/MyVisits'
import GirardCustomers from '../../src/pages/girard/GirardCustomers'
import GirardManagers from '../../src/pages/girard/GirardManagers'
import ManagerSchedule from '../../src/pages/girard/ManagerSchedule'
import Promotions from '../../src/pages/athel/Promotions'
import { fetchPromotions } from '../../src/lib/promotions'
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T12:00:00Z')); state.fixture = supportingReadFixture(); state.role = 'executive'; state.queries.clear(); state.cataloguePages = []; vi.clearAllMocks()
  state.fixture.rpc.pilot_catalog_page_v1 = (args: any) => {
    state.cataloguePages.push({ ...args })
    // Project the canonical RPC contract, not the unrelated raw-table columns.
    const rows = (args.p_kind === 'customer' ? state.fixture.tables.customers.map((row: any) => ({
      id: row.id, name: row.name, address: row.address, city: row.city, phone: row.phone, email: row.email, pricing_tier: row.pricing_tier, customer_category: row.customer_category, is_enabled: true, catalog_version: '1',
    })) : state.fixture.tables.products.map((row: any) => ({
      id: row.id, name: row.name, sku: row.sku, size: row.size, unit_price: row.unit_price, harga_pokok: row.harga_pokok, luar_kota: row.luar_kota, dalam_kota: row.dalam_kota, depo_bangunan: row.depo_bangunan, is_enabled: true, catalog_version: '1',
    }))).sort((a: any, b: any) => a.id.localeCompare(b.id))
    return { version: 1, actor_id: '00000000-0000-4000-8000-000000000002', role: state.role, kind: args.p_kind, purpose: args.p_purpose, status: args.p_status, search: args.p_search, page: args.p_page, page_size: args.p_page_size, total_count: String(rows.length), rows: rows.slice((args.p_page - 1) * args.p_page_size, args.p_page * args.p_page_size) }
  }
})
afterEach(() => { cleanup(); queryClient.clear(); vi.useRealTimers() })
const query = (name: string) => {
  const matches = [...state.queries.values()].filter(options => options.queryKey[0] === name)
  expect(matches).toHaveLength(1)
  return matches[0].queryFn({ signal: new AbortController().signal })
}

for (const [kind, table] of [['customer', 'customers'], ['product', 'products']] as const) test(`new PO ${kind} choices remains complete beyond the API cap`, async () => {
  render(<MemoryRouter><PONew /></MemoryRouter>)
  const catalogueQueries = [...state.queries.values()].filter(options => options.queryKey[0] === 'catalogue')
  expect(catalogueQueries).toHaveLength(2)
  const options = catalogueQueries.find(options => options.queryKey[6] === kind)!
  expect(options.queryKey.slice(0, 14)).toEqual(['catalogue', 'https://catalogue.test', '00000000-0000-4000-8000-000000000002', 'executive', 1, 'read', kind, 'enabled-for-order', 'enabled', '', 1, 250, 'complete-options', expect.any(String)])
  expect(options.enabled).toBe(true)
  const { rows } = await options.queryFn({ signal: new AbortController().signal })
  expect(rows).toHaveLength(1001)
  expect(rows.map((row: any) => row.id)).toEqual(state.fixture.tables[table].map((row: any) => row.id))
  expect(state.cataloguePages.map(args => args.p_page)).toEqual([1, 2, 3, 4, 5])
  expect(state.cataloguePages.every(args => args.p_kind === kind && args.p_purpose === 'enabled-for-order' && args.p_status === 'enabled' && args.p_page_size === 250)).toBe(true)
})

for (const [name, Page, key, expected] of [
  ['Girard customer directory', GirardCustomers, 'all_customers', 1001],
  ['Girard customer assignments', GirardCustomers, 'assignments', 1001],
  ['daily schedules and customer enrichment', DailySchedule, 'schedules', 1001],
  ['own visit schedules', MyVisits, 'my_visits', 1001],
  ['manager assigned customers', ManagerSchedule, 'manager_customers', 1001],
  ['manager team choices', ManagerSchedule, 'manager_team', 1002],
  ['manager schedule window', ManagerSchedule, 'manager_schedules', 1001],
  ['promotion history', Promotions, 'promotions', 1001],
  ['promotion product choices', Promotions, 'products', 1001],
] as const) test(`${name} remains complete beyond the API cap`, async () => {
  render(<MemoryRouter><Page /></MemoryRouter>)
  const rows = await query(key)
  expect(rows).toHaveLength(expected)
  if (key === 'schedules' || key === 'my_visits') expect(rows.every((row: any) => row.customers?.id === row.outlet_id)).toBe(true)
})
test('manager cards use complete child assignments and team lists', async () => {
  render(<MemoryRouter><GirardManagers /></MemoryRouter>)
  const [manager] = await query('managers_data')
  expect(manager.customers).toHaveLength(1001)
  expect(manager.team).toHaveLength(1001)
})
test('active-promotion source does not silently omit later metadata rows', async () => {
  expect(await fetchPromotions()).toHaveLength(1001)
})

vi.mock('../../src/components/VisitRequestInbox', () => ({ default: () => null, VisitProposalForm: () => null }))

for (const key of ['manager_customers', 'manager_schedules']) test(`${key}: supervisor retains salesperson-owned stores returned by RLS`, async () => {
  state.role = 'sales_manager'
  const tables = state.fixture.tables
  tables.customer_manager_assignments = [tables.customer_manager_assignments[0]]
  tables.customer_manager_assignments[0].manager_id = tables.users[1].id
  tables.customers = [tables.customers[0]]
  tables.sales_schedules = [tables.sales_schedules[0]]
  render(<MemoryRouter><ManagerSchedule /></MemoryRouter>)
  const rows = await query(key)
  expect(rows).toHaveLength(1)
  expect(key === 'manager_customers' ? rows[0].id : rows[0].outlet_id).toBe(tables.customers[0].id)
})

test('manager cards attribute salesperson-owned customers to their current supervisor without duplicates', async () => {
  const tables = state.fixture.tables
  const first = tables.users[0], sales = tables.users[1]
  const second = { ...first, id: 'second-manager', full_name: 'Second manager' }
  tables.users = [first, second, sales]
  tables.customer_manager_assignments = tables.customer_manager_assignments.slice(0, 2)
  tables.customer_manager_assignments[1].manager_id = sales.id
  render(<MemoryRouter><GirardManagers /></MemoryRouter>)
  let rows = await query('managers_data')
  expect(rows.find((row: any) => row.id === first.id).customers).toHaveLength(2)
  sales.manager_id = second.id
  rows = await query('managers_data')
  expect(rows.find((row: any) => row.id === first.id).customers).toHaveLength(1)
  expect(rows.find((row: any) => row.id === second.id).customers).toEqual([tables.customer_manager_assignments[1].customers])
})

test('manager cards exclude inactive salesperson owners from the active supervisor scope', async () => {
  const tables = state.fixture.tables
  const manager = tables.users[0], sales = { ...tables.users[1], is_active: false }
  tables.users = [manager, sales]
  tables.customer_manager_assignments = [tables.customer_manager_assignments[0]]
  tables.customer_manager_assignments[0].manager_id = sales.id
  render(<MemoryRouter><GirardManagers /></MemoryRouter>)
  const [row] = await query('managers_data')
  expect(row.customers).toHaveLength(0)
  expect(row.team).toHaveLength(0)
})
