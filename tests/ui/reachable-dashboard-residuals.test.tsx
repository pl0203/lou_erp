import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { RESPONSE_EXAMPLES } from '../scalability/response-examples'

const state = vi.hoisted(() => ({ actor: 'actor', role: 'executive', readGate: null as Promise<void> | null, reads: [] as { kind: string; actor: string; role: string; month: string }[], target: '200.00' as string | null, readError: false, authGate: null as Promise<void> | null, writeGate: null as Promise<void> | null, writes: [] as any[], getUser: vi.fn(), retry: vi.fn() }))
vi.mock('../../src/components/GirardNav', () => ({ default: () => <nav aria-label="Navigasi modul">Sales</nav> }))
vi.mock('../../src/components/sales/SalesMetricSummary', () => ({ SalesMetricsPanel: () => <p>Metrik Sales terpisah</p> }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { id: state.actor, role: state.role } }) }))
vi.mock('../../src/lib/reads/reports', () => ({
  fetchEarliestSalesPerformanceMonth: async () => '2026-09',
  fetchCustomerPerformancePage: async (actor: string, role: string, month: string) => { state.retry(); state.reads.push({ kind: 'customer', actor, role, month }); await state.readGate; if (state.readError) throw new Error('read unavailable'); return { ...RESPONSE_EXAMPLES.pilot_customer_performance_v1, items: RESPONSE_EXAMPLES.pilot_customer_performance_v1.items.map(row => ({ ...row, sales_target: state.target })) } },
  fetchSalesPerformancePage: async (actor: string, role: string, month: string) => { state.retry(); state.reads.push({ kind: 'sales', actor, role, month }); await state.readGate; if (state.readError) throw new Error('read unavailable'); return { ...RESPONSE_EXAMPLES.pilot_sales_performance_v1, items: RESPONSE_EXAMPLES.pilot_sales_performance_v1.items.map(row => ({ ...row, sales_target: state.target })) } },
}))
vi.mock('../../src/lib/supabase', () => ({ supabase: {
  auth: { getUser: async () => { state.getUser(); await state.authGate; return { data: { user: { id: state.actor } } } } },
  from: (table: string) => ({ upsert: async (payload: any, options: any) => { state.writes.push({ table, payload, options }); await state.writeGate; return { error: null } } }),
} }))
import GirardDashboard from '../../src/pages/girard/GirardDashboard'

const clients: QueryClient[] = []
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-12T12:00:00Z')); state.actor = 'actor'; state.role = 'executive'; state.readGate = null; state.reads = []; state.target = '200.00'; state.readError = false; state.authGate = null; state.writeGate = null; state.writes = []; state.getUser.mockReset(); state.retry.mockReset() })
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.useRealTimers() })
let currentView: ReturnType<typeof render>
const dashboard = (client: QueryClient) => <QueryClientProvider client={client}><MemoryRouter><GirardDashboard /></MemoryRouter></QueryClientProvider>
function mount() { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client); currentView = render(dashboard(client)); return currentView }
const family = (kind: 'customer' | 'sales') => kind === 'customer' ? 'customer_performance' : 'performance'
const readKey = (kind: 'customer' | 'sales', actor = 'actor', role = 'executive', month = '2026-10', page = 1) => [family(kind), `${actor}:${role}`, { yearMonth: month }, page]
const regionName = (kind: 'customer' | 'sales') => kind === 'sales' ? 'Tabel aktivitas tim' : 'Tabel aktivitas pelanggan'
async function panel(kind: 'customer' | 'sales') {
  mount()
  if (kind === 'sales') fireEvent.click(screen.getByRole('button', { name: 'Performa Tim Sales' }))
  return screen.findByRole('region', { name: kind === 'sales' ? 'Tabel aktivitas tim' : 'Tabel aktivitas pelanggan' })
}
function opener(region: HTMLElement) { return within(region).getAllByRole('button').find(button => /Rp |Atur target|Ubah target/.test(button.textContent ?? ''))! }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }

for (const kind of ['customer', 'sales'] as const) {
  test(`${kind} reachable dashboard has visible target actions, labelled responsive fields and readable table/support text`, async () => {
    const region = await panel(kind)
    expect(opener(region).classList.contains('ui-action')).toBe(true)
    expect(opener(region).classList.contains('ui-action--quiet')).toBe(true)
    expect(opener(region).classList.contains('ui-action--compact')).toBe(true)
    fireEvent.click(opener(region))
    const input = within(region).getByRole('spinbutton', { name: /Target penjualan.*Rp/ })
    expect(input.closest('.ui-field')).toBeTruthy()
    expect(input.classList.contains('text-base')).toBe(false)
    expect(within(region).getByRole('button', { name: 'Simpan target' }).classList.contains('ui-action--primary')).toBe(true)
    expect(within(region).getByRole('button', { name: 'Batal' }).classList.contains('ui-action--quiet')).toBe(true)
    const label = document.querySelector(`label[for="${input.id}"]`)
    expect(label?.textContent).toMatch(/Target penjualan/)
    for (const name of ['Simpan target', 'Batal']) expect(within(region).getByRole('button', { name }).classList.contains('ui-action')).toBe(true)
    expect(document.querySelectorAll('[class~="text-xs"]')).toHaveLength(0)
    expect(within(region).getByRole('table').classList.contains('text-sm')).toBe(true)
    const month = kind === 'customer' ? screen.getByLabelText('Bulan aktivitas pelanggan') : screen.getByLabelText('Bulan performa sales')
    expect(month.classList.contains('ui-control')).toBe(true)
    expect(month.classList.contains('text-base')).toBe(false)
    expect(month.classList.contains('min-h-11')).toBe(false)
    if (kind === 'customer') {
      const monthLabel = month.closest('label')!
      expect(monthLabel.classList.contains('ui-field__label')).toBe(true)
      expect(monthLabel.contains(month)).toBe(true)
      expect(month.classList.contains('font-normal')).toBe(true)
    }
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByText('Metrik Sales terpisah')).toBeTruthy()
  })

  test(`${kind} Enter captures same-turn value once and pending Escape cannot dismiss its editor`, async () => {
    const auth = deferred(); state.authGate = auth.promise
    const region = await panel(kind); fireEvent.click(opener(region))
    const input = within(region).getByRole('spinbutton') as HTMLInputElement
    act(() => { fireEvent.change(input, { target: { value: '321.75' } }); fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.keyDown(input, { key: 'Escape' }) })
    expect(within(region).queryByRole('spinbutton')).toBe(input)
    await waitFor(() => expect(state.getUser).toHaveBeenCalledTimes(1))
    const cancel = within(region).getByRole('button', { name: 'Batal' }) as HTMLButtonElement
    expect(cancel.disabled).toBe(true)
    fireEvent.click(cancel)
    expect(within(region).getByRole('spinbutton')).toBe(input)
    await act(async () => auth.resolve())
    await waitFor(() => expect(state.writes).toHaveLength(1))
    expect(state.writes[0]).toMatchObject({ table: kind === 'customer' ? 'customer_targets' : 'sales_targets', payload: { year_month: '2026-10', target_value: 321.75, set_by: 'actor' }, options: { onConflict: kind === 'customer' ? 'customer_id,year_month' : 'user_id,year_month' } })
    await waitFor(() => expect(within(region).queryByRole('spinbutton')).toBeNull())
  })

  test(`${kind} repeated same-turn Enter sends the newly entered numeric value only once`, async () => {
    const auth = deferred(); state.authGate = auth.promise
    const region = await panel(kind); fireEvent.click(opener(region)); const input = within(region).getByRole('spinbutton')
    act(() => { fireEvent.change(input, { target: { value: '321.75' } }); fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.keyDown(input, { key: 'Enter' }) })
    await waitFor(() => expect(state.getUser).toHaveBeenCalledTimes(1))
    await act(async () => auth.resolve())
    await waitFor(() => expect(state.writes).toHaveLength(1)); expect(state.writes[0].payload.target_value).toBe(321.75)
  })

  test(`${kind} a late save for the previous month stales only its original scope and leaves the connected newer draft intact`, async () => {
    const write = deferred(); state.writeGate = write.promise
    const region = await panel(kind); const client = clients.at(-1)!; const invalidation = vi.spyOn(client, 'invalidateQueries')
    client.setQueryData(readKey(kind, 'actor', 'executive', '2026-10', 2), client.getQueryData(readKey(kind)))
    fireEvent.click(opener(region)); fireEvent.change(within(region).getByRole('spinbutton'), { target: { value: '100' } }); fireEvent.keyDown(within(region).getByRole('spinbutton'), { key: 'Enter' })
    await waitFor(() => expect(state.writes).toHaveLength(1))
    fireEvent.change(kind === 'customer' ? screen.getByLabelText('Bulan aktivitas pelanggan') : screen.getByLabelText('Bulan performa sales'), { target: { value: '2026-09' } })
    const next = await screen.findByRole('region', { name: regionName(kind) }); fireEvent.click(opener(next))
    const input = screen.getByRole('spinbutton') as HTMLInputElement; fireEvent.change(input, { target: { value: '999' } })
    const read = deferred(); state.readGate = read.promise; const readsBefore = state.reads.length
    await act(async () => write.resolve()); await waitFor(() => expect(invalidation).toHaveBeenCalled())
    expect(input.isConnected).toBe(true); expect(screen.getByRole('spinbutton')).toBe(input); expect(input.value).toBe('999')
    expect(invalidation).toHaveBeenCalledWith({ queryKey: readKey(kind).slice(0, 3), refetchType: 'none' })
    expect(client.getQueryState(readKey(kind))?.isInvalidated).toBe(true)
    expect(client.getQueryState(readKey(kind, 'actor', 'executive', '2026-10', 2))?.isInvalidated).toBe(true)
    expect(client.getQueryState(readKey(kind, 'actor', 'executive', '2026-09'))?.isInvalidated).toBe(false)
    expect(state.reads).toHaveLength(readsBefore); expect(state.writes[0].payload.year_month).toBe('2026-10')
    await act(async () => read.resolve())
    expect(input.isConnected).toBe(true); expect(screen.getByRole('spinbutton')).toBe(input)
  })

  test(`${kind} an ordinary current-owner save refreshes its original active scope`, async () => {
    const write = deferred(); state.writeGate = write.promise
    const region = await panel(kind); const client = clients.at(-1)!; const invalidation = vi.spyOn(client, 'invalidateQueries')
    fireEvent.click(opener(region)); fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '100' } }); fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Enter' })
    await waitFor(() => expect(state.writes).toHaveLength(1))
    const read = deferred(); state.readGate = read.promise; const readsBefore = state.reads.length; state.target = '100.00'
    await act(async () => write.resolve()); await waitFor(() => expect(state.reads).toHaveLength(readsBefore + 1))
    expect(invalidation).toHaveBeenCalledWith({ queryKey: readKey(kind).slice(0, 3), refetchType: 'active' })
    expect(state.reads.at(-1)).toEqual({ kind, actor: 'actor', role: 'executive', month: '2026-10' })
    expect(screen.queryByRole('spinbutton')).toBeNull()
    await act(async () => read.resolve())
    const current = await screen.findByRole('region', { name: regionName(kind) })
    expect(within(current).getByRole('button', { name: 'Rp 100' })).toBeTruthy()
  })

  test(`${kind} a same-scope remounted editor cannot be refetched by its unmounted predecessor`, async () => {
    const write = deferred(); state.writeGate = write.promise
    const region = await panel(kind); const client = clients.at(-1)!; const invalidation = vi.spyOn(client, 'invalidateQueries')
    fireEvent.click(opener(region)); fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Enter' }); await waitFor(() => expect(state.writes).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: kind === 'customer' ? 'Performa Tim Sales' : 'Performa Pelanggan' }))
    await screen.findByRole('region', { name: regionName(kind === 'customer' ? 'sales' : 'customer') })
    fireEvent.click(screen.getByRole('button', { name: kind === 'customer' ? 'Performa Pelanggan' : 'Performa Tim Sales' }))
    const next = await screen.findByRole('region', { name: regionName(kind) }); fireEvent.click(opener(next))
    const input = screen.getByRole('spinbutton') as HTMLInputElement; fireEvent.change(input, { target: { value: '999' } })
    const read = deferred(); state.readGate = read.promise; const readsBefore = state.reads.length
    await act(async () => write.resolve()); await waitFor(() => expect(invalidation).toHaveBeenCalled())
    expect(input.isConnected).toBe(true); expect(screen.getByRole('spinbutton')).toBe(input); expect(input.value).toBe('999')
    expect(invalidation).toHaveBeenCalledWith({ queryKey: readKey(kind).slice(0, 3), refetchType: 'none' })
    expect(state.reads).toHaveLength(readsBefore); expect(client.getQueryState(readKey(kind))?.isInvalidated).toBe(true)
    await act(async () => read.resolve())
  })

  for (const change of ['actor', 'role'] as const) test(`${kind} old success cannot refresh or adopt into a new ${change} read owner`, async () => {
    const write = deferred(); state.writeGate = write.promise
    const region = await panel(kind); const client = clients.at(-1)!; const invalidation = vi.spyOn(client, 'invalidateQueries')
    fireEvent.click(opener(region)); const oldInput = screen.getByRole('spinbutton'); fireEvent.keyDown(oldInput, { key: 'Enter' }); await waitFor(() => expect(state.writes).toHaveLength(1))
    const identityRead = deferred(); state.readGate = identityRead.promise
    if (change === 'actor') state.actor = 'replacement'; else state.role = 'sales_head'
    currentView.rerender(dashboard(client))
    await waitFor(() => expect(state.reads.at(-1)).toEqual({ kind, actor: state.actor, role: state.role, month: '2026-10' }))
    expect(oldInput.isConnected).toBe(false); expect(screen.queryByRole('spinbutton')).toBeNull()
    await act(async () => identityRead.resolve())
    const next = await screen.findByRole('region', { name: regionName(kind) }); fireEvent.click(opener(next))
    const input = screen.getByRole('spinbutton') as HTMLInputElement; fireEvent.change(input, { target: { value: '999' } })
    const read = deferred(); state.readGate = read.promise; const readsBefore = state.reads.length
    await act(async () => write.resolve()); await waitFor(() => expect(invalidation).toHaveBeenCalled())
    expect(input.isConnected).toBe(true); expect(screen.getByRole('spinbutton')).toBe(input); expect(input.value).toBe('999')
    expect(invalidation).toHaveBeenCalledWith({ queryKey: readKey(kind).slice(0, 3), refetchType: 'none' })
    expect(client.getQueryState(readKey(kind))?.isInvalidated).toBe(true)
    expect(client.getQueryState(readKey(kind, state.actor, state.role))?.isInvalidated).toBe(false)
    expect(state.reads).toHaveLength(readsBefore); expect(state.writes[0].payload.set_by).toBe('actor')
    await act(async () => read.resolve())
  })

  test(`${kind} a fresh cached replacement identity owns a new editor before old success`, async () => {
    const write = deferred(); state.writeGate = write.promise
    const region = await panel(kind); const client = clients.at(-1)!; const invalidation = vi.spyOn(client, 'invalidateQueries')
    fireEvent.click(opener(region)); const oldInput = screen.getByRole('spinbutton'); fireEvent.keyDown(oldInput, { key: 'Enter' }); await waitFor(() => expect(state.writes).toHaveLength(1))
    const replacementKey = readKey(kind, 'replacement')
    client.setQueryDefaults(replacementKey, { staleTime: Infinity })
    client.setQueryData(replacementKey, client.getQueryData(readKey(kind)))
    state.actor = 'replacement'; currentView.rerender(dashboard(client))
    expect(oldInput.isConnected).toBe(false); expect(screen.queryByRole('spinbutton')).toBeNull()
    const next = screen.getByRole('region', { name: regionName(kind) }); fireEvent.click(opener(next))
    const input = screen.getByRole('spinbutton') as HTMLInputElement; fireEvent.change(input, { target: { value: '999' } })
    const read = deferred(); state.readGate = read.promise; const readsBefore = state.reads.length
    await act(async () => write.resolve()); await waitFor(() => expect(invalidation).toHaveBeenCalled())
    expect(input.isConnected).toBe(true); expect(screen.getByRole('spinbutton')).toBe(input); expect(input.value).toBe('999')
    expect(invalidation).toHaveBeenCalledWith({ queryKey: readKey(kind).slice(0, 3), refetchType: 'none' })
    expect(client.getQueryState(replacementKey)?.isInvalidated).toBe(false); expect(state.reads).toHaveLength(readsBefore)
    await act(async () => read.resolve())
  })

  test(`${kind} idle Escape cancels without a write`, async () => {
    const region = await panel(kind); fireEvent.click(opener(region)); fireEvent.keyDown(within(region).getByRole('spinbutton'), { key: 'Escape' })
    expect(within(region).queryByRole('spinbutton')).toBeNull(); expect(state.getUser).not.toHaveBeenCalled(); expect(state.writes).toHaveLength(0)
  })

  test(`${kind} failed read uses a visible retry and keeps unavailable values absent`, async () => {
    state.readError = true; mount(); if (kind === 'sales') fireEvent.click(screen.getByRole('button', { name: 'Performa Tim Sales' }))
    const alert = await screen.findByRole('alert'); const retry = within(alert).getByRole('button', { name: 'Coba lagi' })
    expect(retry.classList.contains('ui-action')).toBe(true); expect(alert.classList.contains('text-red-700')).toBe(true); expect(screen.queryByRole('spinbutton')).toBeNull()
    state.readError = false; fireEvent.click(retry)
    await screen.findByRole('region', { name: kind === 'sales' ? 'Tabel aktivitas tim' : 'Tabel aktivitas pelanggan' })
  })
}

for (const role of ['sales_person', 'sales_manager', 'sales_head', 'executive']) for (const kind of ['customer', 'sales'] as const) test(`${role} retains ${kind} target role permission`, async () => {
  state.role = role; const region = await panel(kind)
  const allowed = kind === 'customer' ? ['sales_head', 'executive'].includes(role) : ['sales_manager', 'sales_head', 'executive'].includes(role)
  expect(within(region).queryAllByRole('button').some(button => /Rp |Atur target|Ubah target/.test(button.textContent ?? ''))).toBe(allowed)
  if (!allowed) { expect(within(region).queryByRole('spinbutton')).toBeNull(); expect(state.writes).toHaveLength(0) }
})


for (const kind of ['customer', 'sales'] as const) for (const target of [null, '0.00']) test(`${kind} read-only ${target === null ? 'absent' : 'zero'} target remains distinct 14px table data`, async () => {
  state.target = target; state.role = kind === 'customer' ? 'sales_manager' : 'sales_person'
  const region = await panel(kind); const table = within(region).getByRole('table')
  const headers = within(table).getAllByRole('columnheader'); const index = headers.findIndex(header => /^Target(?: Penjualan)?$/.test(header.textContent ?? ''))
  expect(index).toBeGreaterThanOrEqual(0)
  const value = table.querySelector('tbody tr')!.children[index].firstElementChild!
  expect(value.textContent).toBe(target === null ? '—' : 'Rp 0'); expect(value.classList.contains('text-sm')).toBe(true)
  expect(within(region).queryByRole('spinbutton')).toBeNull(); expect(state.writes).toHaveLength(0)
})
