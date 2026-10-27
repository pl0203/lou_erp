import { MemoryRouter } from 'react-router-dom'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import DailySchedule from '../src/pages/girard/DailySchedule'
import ManagerSchedule from '../src/pages/girard/ManagerSchedule'
const state = vi.hoisted(() => ({ role: 'sales_person' }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'actor', role: state.role } }) }))
vi.mock('../src/lib/visitTransactions', () => ({ useVisitPlanningSender: () => Object.assign(vi.fn(), { hasUnresolved: () => false }) }))
vi.mock('../src/lib/useUnsavedChanges', () => ({ useUnsavedChanges: () => ({ dialog: null, confirmDiscard: (fn: () => void) => fn() }) }))
vi.mock('../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../src/components/ActivePromotionsBanner', () => ({ default: () => null }))
vi.mock('../src/components/VisitRequestInbox', () => ({ default: () => <p>Embedded requests</p>, VisitProposalForm: () => <p>Proposal form</p> }))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }), useQuery: () => ({ data: [], isLoading: false, isError: false }), useMutation: () => ({ mutate: vi.fn(), isPending: false }) }))
afterEach(cleanup)
test('salesperson schedule keeps proposal controls without the embedded request list', () => {
 state.role = 'sales_person'; render(<MemoryRouter><DailySchedule /></MemoryRouter>)
 expect(screen.queryByText('Embedded requests')).toBeNull()
 expect(screen.getByRole('button', { name: 'Ajukan kunjungan baru' }).className).toMatch(/ui-action--primary/)
})
test('manager schedule starts with its schedule heading and an obvious empty-state button', () => {
 state.role = 'sales_manager'; render(<MemoryRouter><ManagerSchedule /></MemoryRouter>)
 expect(screen.queryByText('Embedded requests')).toBeNull()
 expect(screen.getByRole('heading', { name: 'Jadwal', level: 1 })).toBeTruthy()
 expect(screen.getByRole('button', { name: /Tambahkan jadwal kunjungan baru/ }).className).toMatch(/ui-action--secondary/)
})

// No external client is part of this unit boundary; accidental I/O is a failure.
vi.mock('../src/lib/supabase', () => ({ supabase: new Proxy({}, { get: (_target, key) => { throw new Error(`Unexpected Supabase access: ${String(key)}`) } }) }))
