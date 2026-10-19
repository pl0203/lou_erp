import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ role: 'sales_person' }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'actor' }, profile: { id: 'actor', role: state.role, is_active: true }, loading: false }) }))
vi.mock('../../src/pages/Login', () => ({ default: () => <p>Login boundary</p> }))
vi.mock('../../src/pages/girard/Promotions', () => ({ default: () => <p>Sales highlights</p> }))
vi.mock('../../src/pages/girard/OwnVisitHistory', () => ({ default: () => <p>Own visit history</p> }))
vi.mock('../../src/pages/girard/MyVisits', () => ({ default: () => <p>Manager visits</p> }))
vi.mock('../../src/pages/athel/Promotions', () => ({ default: () => <p>Admin promotions</p> }))
vi.mock('../../src/pages/girard/DailySchedule', () => ({ default: () => <p>Sales schedule</p> }))
vi.mock('../../src/pages/girard/ManagerSchedule', () => ({ default: () => <p>Manager schedule</p> }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: () => ({ select: () => ({ eq: async () => ({count:0,error:null}) }) }) } }))
import App from '../../src/App'
afterEach(cleanup)
function mount(role: string, path: string) { state.role = role; render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></QueryClientProvider>) }
test.each(['sales_person','sales_manager','sales_head','executive'])('%s reaches read-only highlights and own visit history', role => {
 mount(role, '/girard/promotions'); expect(screen.getByText('Sales highlights')).toBeTruthy(); cleanup(); mount(role, '/girard/visit-history'); expect(screen.getByText('Own visit history')).toBeTruthy()
})
test.each(['executive'])('%s reaches Procurement promotion administration', role => { mount(role, '/athel/promotions'); expect(screen.getByText('Admin promotions')).toBeTruthy() })
test('a salesperson cannot enter administration or the separate manager-only visits route', () => { mount('sales_person','/athel/promotions'); expect(screen.queryByText('Admin promotions')).toBeNull(); cleanup(); mount('sales_person','/girard/my-visits'); expect(screen.queryByText('Manager visits')).toBeNull() })
test('the separate manager visit route remains reachable', () => { mount('sales_manager','/girard/my-visits'); expect(screen.getByText('Manager visits')).toBeTruthy() })
