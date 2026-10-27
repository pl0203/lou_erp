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
// Employee authority is independently covered; these are outer route tests.
vi.mock('../../src/lib/employees/useEmployeeContext', () => ({ useEmployeeIdentityBoundary: () => undefined, useEmployeeContext: () => ({ displayAllowed: false }) }))
vi.mock('../../src/pages/ihr/employees/EmployeeList', () => ({ default: () => <p data-testid="route-leaf">EmployeeList</p> }))
vi.mock('../../src/pages/ihr/employees/EmployeeDetail', () => ({ default: () => <p data-testid="route-leaf">EmployeeDetail</p> }))
vi.mock('../../src/pages/ihr/employees/EmployeeEditor', () => ({ default: () => <p data-testid="route-leaf">EmployeeEditor</p> }))
vi.mock('../../src/pages/ihr/employees/EmployeeReportingEditor', () => ({ default: () => <p data-testid="route-leaf">EmployeeReportingEditor</p> }))
import App from '../../src/App'
afterEach(cleanup)
function mount(role: string, path: string) { state.role = role; render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>) }
test.each(['sales_person','sales_manager','sales_head','executive'])('%s reaches read-only highlights and own visit history', role => {
 mount(role, '/girard/promotions'); expect(screen.getByText('Sales highlights')).toBeTruthy(); cleanup(); mount(role, '/girard/visit-history'); expect(screen.getByText('Own visit history')).toBeTruthy()
})
test.each(['executive'])('%s reaches Procurement promotion administration', role => { mount(role, '/athel/promotions'); expect(screen.getByText('Admin promotions')).toBeTruthy() })
test('a salesperson cannot enter administration or the separate manager-only visits route', () => { mount('sales_person','/athel/promotions'); expect(screen.queryByText('Admin promotions')).toBeNull(); cleanup(); mount('sales_person','/girard/my-visits'); expect(screen.queryByText('Manager visits')).toBeNull() })
test('the separate manager visit route remains reachable', () => { mount('sales_manager','/girard/my-visits'); expect(screen.getByText('Manager visits')).toBeTruthy() })

vi.mock('../../src/lib/supabase', () => ({ supabase: new Proxy({}, { get: (_target, key) => { throw new Error(`Unexpected Supabase access: ${String(key)}`) } }) }))
