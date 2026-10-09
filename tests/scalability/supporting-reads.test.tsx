import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { supportingReadFixture } from './fixtures'
const state = vi.hoisted(() => ({ fixture: { tables: {} } as any, queries: new Map<string, any>(), role: 'executive' }))
vi.mock('../../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../../src/components/TransactionRecovery', () => ({ default: () => null }))
vi.mock('../../src/components/ActivePromotionsBanner', () => ({ default: () => null }))
vi.mock('../../src/lib/orderTransactions', () => ({ createTransactionSender: () => Object.assign(vi.fn(), { hasUnresolved: () => false }), useTransactionSender: () => vi.fn() }))
vi.mock('../../src/lib/useUnsavedChanges', () => ({ hasOrderItemChanges: () => false, useUnsavedChanges: () => ({ dialog: null, runWithoutPrompt: (fn: any) => fn(), confirmDiscard: (fn: any) => fn() }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: '00000000-0000-4000-8000-000000000002' }, profile: { id: '00000000-0000-4000-8000-000000000002', role: state.role, is_active: true }, loading: false }) }))
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: any) => { state.queries.set(options.queryKey[0], options); return { isLoading: true } }, useQueryClient: () => ({ invalidateQueries: vi.fn() }), useMutation: () => ({ mutate: vi.fn() }) }))
vi.mock('../../src/lib/supabase', async () => { const { fixtureClient } = await import('./fixtures'); return { supabase: fixtureClient(() => state.fixture) } })
import PONew from '../../src/pages/athel/PONew'
import DailySchedule from '../../src/pages/girard/DailySchedule'
import MyVisits from '../../src/pages/girard/MyVisits'
import GirardCustomers from '../../src/pages/girard/GirardCustomers'
import GirardManagers from '../../src/pages/girard/GirardManagers'
import ManagerSchedule from '../../src/pages/girard/ManagerSchedule'
import Promotions from '../../src/pages/athel/Promotions'
import { fetchPromotions } from '../../src/lib/promotions'
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T12:00:00Z')); state.fixture = supportingReadFixture(); state.role = 'executive'; state.queries.clear() })
afterEach(() => { cleanup(); vi.useRealTimers() })
const query = (name: string) => state.queries.get(name).queryFn({ signal: new AbortController().signal })

for (const [name, Page, key, expected] of [
  ['new PO customer choices', PONew, 'customers', 1001],
  ['new PO product choices', PONew, 'products', 1001],
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
  render(<Page />)
  const rows = await query(key)
  expect(rows).toHaveLength(expected)
  if (key === 'schedules' || key === 'my_visits') expect(rows.every((row: any) => row.customers?.id === row.outlet_id)).toBe(true)
})
test('manager cards use complete child assignments and team lists', async () => {
  render(<GirardManagers />)
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
  render(<ManagerSchedule />)
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
  render(<GirardManagers />)
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
  render(<GirardManagers />)
  const [row] = await query('managers_data')
  expect(row.customers).toHaveLength(0)
  expect(row.team).toHaveLength(0)
})
