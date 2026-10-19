import { transferableAbortController } from 'node:util'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  actor: 'actor-a', listeners: new Set<() => void>(), calls: [] as any[], requests: [] as { args: any; resolve: (value: any) => void }[],
  po: {} as any, sj: {} as any, holdJoin: false, joined: null as { data: any; resolve: (value: any) => void } | null,
}))
vi.mock('../../src/lib/AuthContext', async () => {
  const { useSyncExternalStore } = await import('react')
  const subscribe = (listener: () => void) => { state.listeners.add(listener); return () => { state.listeners.delete(listener) } }
  const snapshot = () => state.actor
  return { useAuth: () => { const actor = useSyncExternalStore(subscribe, snapshot); return { user: { id: actor }, profile: { id: actor, role: 'po_admin', is_active: true } } } }
})
vi.mock('../../src/components/AthelNav', () => ({ default: () => <a href="/athel/po">Procurement</a> }))
// Keep the real transaction sender/recovery and the real PO owner. Only the external backend is synthetic.
vi.mock('../../src/lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    let projection = ''; const filters: Record<string, string> = {}
    const q: any = { select: (value: string) => { projection = value; return q }, eq: (key: string, value: string) => { filters[key] = value; return q }, order: () => q, range: () => q, abortSignal: () => q,
      single: async () => {
        if (table === 'surat_jalan' && projection.includes('purchase_orders')) {
          const data = { ...state.sj, purchase_orders: { ...state.po } }
          if (state.holdJoin) return new Promise(resolve => { state.joined = { data, resolve } })
          return { data, error: null }
        }
        return { data: { ...state.po, id: filters.id ?? state.po.id }, error: null }
      },
      then: (resolve: any) => Promise.resolve({ data: table === 'surat_jalan' ? [{ ...state.sj }] : [], count: table === 'surat_jalan' ? 1 : 0, error: null }).then(resolve),
    }; return q
  },
  rpc: (name: string, args: any) => {
    if (name === 'pilot_order_transaction') {
      state.calls.push({ name, args, actor: state.actor })
      return new Promise(resolve => { state.requests.push({ args, resolve }) })
    }
    if (name !== 'pilot_po_lines_v1') throw new Error(`Unexpected synthetic RPC: ${name}`)
    const q: any = { abortSignal: () => q, then: (resolve: any) => Promise.resolve({ data: { version: 1, as_of: state.po.updated_at, items: [], total: 0, page: 1, page_size: 100, po_updated_at: args.p_expected_updated_at, po_has_delivery_history: true }, error: null }).then(resolve) }; return q
  },
} }))
import PODetail from '../../src/pages/athel/PODetail'

let client: QueryClient, router: ReturnType<typeof createMemoryRouter>
const receivedAction = 'Ubah tanggal SJ diterima toko', saveReceived = 'Simpan tanggal diterima', adopt = 'Gunakan versi PO terbaru'
const v1 = '2026-10-08T12:00:00Z', v2 = '2026-10-08T12:01:00Z'
beforeEach(() => {
  vi.stubGlobal('AbortController', class { constructor() { return transferableAbortController() } })
  state.actor = 'actor-a'; state.calls = []; state.requests = []; state.holdJoin = false; state.joined = null; localStorage.clear()
  state.po = { id: 'po', po_number: 'PO-1', status: 'complete', completed_at: '2026-09-30T12:00:00Z', updated_at: v1, total_value: 10, order_date: '2026-09-30', customers: { name: 'Store' } }
  state.sj = { id: 'sj', purchase_order_id: 'po', sj_number: 'SJ-1', sj_date: '2026-09-30', sj_date_received: '2026-10-01', sj_date_returned: '2026-10-04', voided_at: null, void_reason: null }
  client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } })
  router = createMemoryRouter([{ path: '/athel/po/:id', element: <PODetail /> }], { initialEntries: ['/athel/po/po'] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
})
afterEach(() => { cleanup(); router.dispose(); client.clear(); vi.unstubAllGlobals() })
async function swapActor() { await act(async () => { state.actor = 'actor-b'; state.listeners.forEach(listener => listener()) }) }
async function submitReceived() {
  const trigger = await screen.findByRole('button', { name: receivedAction }); await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(trigger)
  fireEvent.change(screen.getByLabelText('Tanggal SJ Diterima Toko'), { target: { value: '2026-10-07' } })
  fireEvent.click(screen.getByRole('button', { name: saveReceived })); await waitFor(() => expect(state.requests).toHaveLength(1))
  return state.requests[0]
}
async function conflict() {
  const request = await submitReceived(); state.po = { ...state.po, updated_at: v2 }
  await act(async () => request.resolve({ data: null, error: { code: 'PT409', message: 'PO berubah. Muat ulang dan periksa perubahan sebelum menyimpan kembali.' } }))
  await screen.findByRole('button', { name: 'Muat ulang PO' })
}
test('late received-date review read cannot establish reusable evidence after actor replacement', async () => {
  await conflict(); state.holdJoin = true; fireEvent.click(screen.getByRole('button', { name: 'Muat ulang PO' })); await waitFor(() => expect(state.joined).toBeTruthy())
  await swapActor(); await act(async () => state.joined!.resolve({ data: state.joined!.data, error: null }))
  const button = screen.queryByRole('button', { name: adopt }); expect(!button || (button as HTMLButtonElement).disabled).toBe(true)
})
test('adopted received-date proof cannot carry another actor’s retained draft into a new request', async () => {
  await conflict(); fireEvent.click(screen.getByRole('button', { name: 'Muat ulang PO' }))
  const button = await screen.findByRole('button', { name: adopt }); await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(button)
  await swapActor(); const submit = screen.queryByRole('button', { name: saveReceived }); if (submit) fireEvent.click(submit)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) }); expect(state.calls).toHaveLength(1)
})
test.each(['success', 'conflict'] as const)('old received-date %s does not close or poison a newer actor’s returned-date dialog', async outcome => {
  const oldRequest = await submitReceived(); await swapActor()
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const returnedTrigger = await screen.findByRole('button', { name: 'Ubah tanggal SJ kembali' }); await waitFor(() => expect((returnedTrigger as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(returnedTrigger)
  const newerDialog = screen.getByRole('dialog'); fireEvent.change(screen.getByLabelText('Tanggal SJ kembali'), { target: { value: '2026-10-06' } })
  await act(async () => oldRequest.resolve(outcome === 'success' ? { data: { id: 'sj', po_id: 'po', updated_at: v2 }, error: null } : { data: null, error: { code: 'PT409', message: 'Old actor conflict' } }))
  expect(screen.getByRole('dialog')).toBe(newerDialog); expect((screen.getByLabelText('Tanggal SJ kembali') as HTMLInputElement).value).toBe('2026-10-06')
  expect(screen.queryByRole('button', { name: 'Muat ulang PO' })).toBeNull(); expect(screen.queryByText(/Old actor conflict/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Simpan tanggal kembali' })); await waitFor(() => expect(state.calls).toHaveLength(2))
  expect(state.calls[1].actor).toBe('actor-b'); expect(state.calls[1].args.p_operation).toBe('edit_sj_returned_date'); expect(state.calls[1].args.p_payload.sj_date_returned).toBe('2026-10-06')
})
