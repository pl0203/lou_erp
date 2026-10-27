import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'actor', role: 'sales_person' } }) }))
vi.mock('../../src/lib/visitPlanning', () => ({ MAX_VISIT_NOTE_LENGTH: 2000, fetchVisitCustomers: async () => [{ id: 'customer', name: 'Synthetic store' }], fetchVisitPeople: async () => [], fetchVisitRequests: async () => ({ items: [], total: 0 }) }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: state.rpc } }))
import { VisitProposalForm } from '../../src/components/VisitRequestInbox'
const clients: QueryClient[] = []
function mount(onSubmitted = vi.fn()) { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client); return { onSubmitted, ...render(<QueryClientProvider client={client}><VisitProposalForm onSubmitted={onSubmitted} /></QueryClientProvider>) } }
beforeEach(() => { localStorage.clear(); state.rpc.mockReset(); vi.spyOn(window, 'confirm').mockReturnValue(true) })
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); vi.restoreAllMocks() })
async function submit() { await screen.findByText('Synthetic store'); fireEvent.change(screen.getByLabelText('Toko'), { target: { value: 'customer' } }); fireEvent.change(screen.getByLabelText('Tanggal kunjungan'), { target: { value: '2026-11-12' } }); fireEvent.click(screen.getByRole('button', { name: 'Ajukan kunjungan' })); await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1)) }
test('actual visit sender shows neutral progress, then success, with no first-save recovery warning', async () => {
 let finish!: (result: any) => void; state.rpc.mockReturnValue(new Promise(resolve => { finish = resolve })); const { onSubmitted } = mount(); await submit();
 expect(screen.queryByText(/Hasil penyimpanan sebelumnya belum terkonfirmasi/)).toBeNull(); expect(screen.queryByRole('button', { name: 'Pulihkan hasil penyimpanan' })).toBeNull(); expect(screen.getByRole('button', { name: 'Mengirim permintaan...' }).hasAttribute('disabled')).toBe(true);
 await act(async () => finish({ data: { id: 'request', version: 1 }, error: null })); expect(onSubmitted).toHaveBeenCalledWith({ id: 'request', date: '2026-11-12' }); expect(localStorage.length).toBe(0)
})
test('ambiguous result recovers same identity after remount without inventing the recovered request date', async () => {
 state.rpc.mockResolvedValue({ data: null, error: { message: 'Connection interrupted' } }); const first = mount(); await submit(); await screen.findByRole('button', { name: 'Pulihkan hasil penyimpanan' }); const requestId = state.rpc.mock.calls[0][1].p_request_id; first.unmount();
 state.rpc.mockResolvedValue({ data: { state: 'committed', operation: 'propose_visit', result: { id: 'request', version: 1 } }, error: null }); const { onSubmitted } = mount(); fireEvent.click(await screen.findByRole('button', { name: 'Pulihkan hasil penyimpanan' }));
 await waitFor(() => expect(state.rpc).toHaveBeenCalledWith('pilot_reconcile_schedule_v1', { p_request_id: requestId, p_abandon: true }));
 expect(onSubmitted).toHaveBeenCalledWith({ id: 'request' }); expect(state.rpc).toHaveBeenCalledTimes(2); expect(localStorage.length).toBe(0)
})
