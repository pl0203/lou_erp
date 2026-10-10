import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ refetch: vi.fn() }))
vi.mock('../../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../../src/components/TransactionRecovery', () => ({ default: () => null }))
vi.mock('../../src/lib/orderTransactions', () => ({ createTransactionSender: () => vi.fn(), useTransactionSender: () => vi.fn() }))
vi.mock('../../src/lib/useUnsavedChanges', () => ({ hasOrderItemChanges: () => false, useUnsavedChanges: () => ({ dialog: null, runWithoutPrompt: (fn: any) => fn() }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u' }, profile: { id: 'u', role: 'sales_manager', is_active: true }, loading: false }) }))
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined, isLoading: false, isError: true, refetch: state.refetch }), useQueryClient: () => ({}), useMutation: () => ({ mutate: vi.fn() }) }))
import PONew from '../../src/pages/athel/PONew'
import MyVisits from '../../src/pages/girard/MyVisits'
import GirardCustomers from '../../src/pages/girard/GirardCustomers'
import GirardManagers from '../../src/pages/girard/GirardManagers'
import ManagerSchedule from '../../src/pages/girard/ManagerSchedule'
import Promotions from '../../src/pages/girard/Promotions'
afterEach(() => { cleanup(); state.refetch.mockClear() })
for (const [name, Page] of [['PO catalogs', PONew], ['own visits', MyVisits], ['customer directory', GirardCustomers], ['manager directory', GirardManagers], ['manager schedules', ManagerSchedule], ['promotions', Promotions]] as const) {
  test(`${name} reports incomplete or failed reads with retry rather than success-shaped emptiness`, () => {
    render(<Page />)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByText(/Tidak ada.*(?:pelanggan|kunjungan|manajer|promosi|jadwal)/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
    expect(state.refetch).toHaveBeenCalled()
    if (name === 'PO catalogs') expect((screen.getByRole('button', { name: 'Simpan PO' }) as HTMLButtonElement).disabled).toBe(true)
  })
}

vi.mock('../../src/components/VisitRequestInbox', () => ({ default: () => null, VisitProposalForm: () => null }))
