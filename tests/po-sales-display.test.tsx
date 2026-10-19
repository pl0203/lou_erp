import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ id: 'actor-a', role: 'executive', active: true, fetch: vi.fn() }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: state.id }, profile: { id: state.id, role: state.role, is_active: state.active }, loading: false }) }))
vi.mock('../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../src/lib/poSales', async original => ({ ...await original<any>(), fetchNewPOSalesPreview: (...args: unknown[]) => state.fetch(...args) }))
import { savedPOSalesName } from '../src/lib/poSales'
import NewPOSalesPreview from '../src/components/NewPOSalesPreview'
let client: QueryClient
beforeEach(() => { state.id = 'actor-a'; state.role = 'executive'; state.active = true; state.fetch.mockReset(); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }) })
afterEach(() => { cleanup(); client.clear() })
const renderPreview = (customerId: string) => <QueryClientProvider client={client}><NewPOSalesPreview customerId={customerId} /></QueryClientProvider>
test('saved sales labels reflect only immutable credit, never a current owner fallback', () => {
 expect(savedPOSalesName({ sales_attribution_state: 'assigned', sales_person_id_at_creation: 'past-sales', sales_person_at_creation: { full_name: 'Original Sales' } })).toBe('Original Sales')
 expect(savedPOSalesName({ sales_attribution_state: 'unassigned', sales_person_at_creation: { full_name: 'Current Sales' } })).toBe('Belum ditugaskan')
 expect(savedPOSalesName({ sales_attribution_state: 'legacy' })).toBe('Belum diketahui')
 expect(savedPOSalesName({ sales_attribution_state: 'assigned', sales_person_id_at_creation: 'past-sales' })).toBe('Nama sales tidak tersedia')
})
test('new PO preview is explicitly prospective and does not mutate or assign', async () => {
 state.fetch.mockResolvedValue('Prospective Sales'); render(renderPreview('customer-a'))
 expect(await screen.findByText('Prospective Sales')).toBeTruthy()
 expect(screen.getByText(/Pratinjau.*Ditetapkan otomatis saat PO disimpan/)).toBeTruthy()
 expect(state.fetch).toHaveBeenCalledWith('customer-a', expect.any(AbortSignal))
})
test('loading and read errors never claim the customer is unassigned', async () => {
 let reject!: (error: Error) => void; state.fetch.mockReturnValue(new Promise((_resolve, fail) => { reject = fail }))
 render(renderPreview('customer-a')); expect(screen.getByRole('status').textContent).toContain('Memuat')
 expect(screen.queryByText('Belum ditugaskan')).toBeNull()
 await act(async () => reject(new Error('Unavailable'))); expect(await screen.findByText(/Sales: Belum dapat dimuat/)).toBeTruthy()
 expect(screen.queryByText('Belum ditugaskan')).toBeNull()
})
test('only confirmed missing owner displays unassigned', async () => {
 state.fetch.mockResolvedValue(null); render(renderPreview('customer-a')); expect(await screen.findByText('Belum ditugaskan')).toBeTruthy()
})
test('late previous-customer response cannot replace the current customer preview', async () => {
 let resolve!: (value: string) => void; state.fetch.mockImplementation((customer: string) => customer === 'customer-a' ? new Promise(done => { resolve = done }) : Promise.resolve('Second Sales'))
 const view = render(renderPreview('customer-a')); await waitFor(() => expect(state.fetch).toHaveBeenCalled())
 view.rerender(renderPreview('customer-b')); expect(await screen.findByText('Second Sales')).toBeTruthy()
 await act(async () => resolve('First Sales')); expect(screen.queryByText('First Sales')).toBeNull()
})
test('identity changes hide prior owner data while the new actor is loading', async () => {
 state.fetch.mockResolvedValueOnce('Private Sales').mockReturnValueOnce(new Promise(() => {}))
 const view = render(renderPreview('customer-a')); await screen.findByText('Private Sales')
 state.id = 'actor-b'; view.rerender(renderPreview('customer-a'))
 expect(screen.queryByText('Private Sales')).toBeNull(); expect(screen.getByRole('status')).toBeTruthy()
})

test('PO Admin never interprets RLS-hidden owner rows as unassigned', async () => {
 state.role = 'po_admin'; state.fetch.mockResolvedValue(null); render(renderPreview('customer-a'))
 expect(screen.getByText('Sales: Ditetapkan otomatis saat PO disimpan.')).toBeTruthy()
 expect(screen.queryByText('Belum ditugaskan')).toBeNull(); expect(state.fetch).not.toHaveBeenCalled()
})
