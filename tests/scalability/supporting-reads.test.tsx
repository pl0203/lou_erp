import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { supportingReadFixture } from './fixtures'
const state = vi.hoisted(() => ({ fixture: { tables: {} } as any, queries: new Map<string, any>() }))
vi.mock('../../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../../src/components/TransactionRecovery', () => ({ default: () => null }))
vi.mock('../../src/components/ActivePromotionsBanner', () => ({ default: () => null }))
vi.mock('../../src/lib/orderTransactions', () => ({ createTransactionSender: () => Object.assign(vi.fn(), { hasUnresolved: () => false }), useTransactionSender: () => vi.fn() }))
vi.mock('../../src/lib/useUnsavedChanges', () => ({ hasOrderItemChanges: () => false, useUnsavedChanges: () => ({ dialog: null, runWithoutPrompt: (fn: any) => fn(), confirmDiscard: (fn: any) => fn() }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: '00000000-0000-4000-8000-000000000002' }, profile: { id: '00000000-0000-4000-8000-000000000002', role: 'executive', is_active: true }, loading: false }) }))
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
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T12:00:00Z')); state.fixture = supportingReadFixture(); state.queries.clear() })
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
