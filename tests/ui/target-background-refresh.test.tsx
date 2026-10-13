import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { RESPONSE_EXAMPLES } from '../scalability/response-examples'

type Kind = 'customer' | 'sales'
type Layout = 'desktop' | 'mobile'
type Trigger = 'visibility' | 'reconnect'
const state = vi.hoisted(() => ({
  actor: 'actor', role: 'executive', rows: ['A', 'B'], target: '200.00',
  readGate: null as Promise<void> | null, readError: null as Error | null,
  writeGate: null as Promise<void> | null, writeError: false,
  reads: [] as { kind: Kind; actor: string; role: string; month: string; page: number }[],
  writes: [] as { table: string; payload: Record<string, unknown>; options: Record<string, unknown> }[],
}))
vi.mock('../../src/components/GirardNav', () => ({ default: () => <nav aria-label="Navigasi modul">Sales</nav> }))
vi.mock('../../src/components/sales/SalesMetricSummary', () => ({ SalesMetricsPanel: () => <p>Metrik Sales terpisah</p> }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { id: state.actor, role: state.role } }) }))
vi.mock('../../src/lib/reads/reports', () => ({
  fetchEarliestSalesPerformanceMonth: async () => '2026-09',
  fetchCustomerPerformancePage: async (actor: string, role: string, month: string, page: number) => {
    state.reads.push({ kind: 'customer', actor, role, month, page })
    await state.readGate
    if (state.readError) throw state.readError
    return { ...RESPONSE_EXAMPLES.pilot_customer_performance_v1, page, page_size: 2, total: 4,
      items: state.rows.map(letter => ({ ...RESPONSE_EXAMPLES.pilot_customer_performance_v1.items[0], id: `customer-${letter}`, name: `Synthetic customer ${letter}`, sales_target: state.target })) }
  },
  fetchSalesPerformancePage: async (actor: string, role: string, month: string, page: number) => {
    state.reads.push({ kind: 'sales', actor, role, month, page })
    await state.readGate
    if (state.readError) throw state.readError
    return { ...RESPONSE_EXAMPLES.pilot_sales_performance_v1, page, page_size: 2, total: 4,
      items: state.rows.map(letter => ({ ...RESPONSE_EXAMPLES.pilot_sales_performance_v1.items[0], id: `sales-${letter}`, full_name: `Synthetic salesperson ${letter}`, sales_target: state.target })) }
  },
}))
vi.mock('../../src/lib/supabase', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: state.actor } } }) },
  from: (table: string) => ({ upsert: async (payload: Record<string, unknown>, options: Record<string, unknown>) => {
    state.writes.push({ table, payload, options })
    const error = state.writeError ? new Error('synthetic write failure') : null
    await state.writeGate
    return { error }
  } }),
} }))
import GirardDashboard from '../../src/pages/girard/GirardDashboard'

const clients: QueryClient[] = []
let visibility: DocumentVisibilityState = 'visible'
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))
  state.actor = 'actor'; state.role = 'executive'; state.rows = ['A', 'B']; state.target = '200.00'
  state.readGate = null; state.readError = null; state.writeGate = null; state.writeError = false; state.reads = []; state.writes = []
  visibility = 'visible'; vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  focusManager.setFocused(undefined); onlineManager.setOnline(true)
})
afterEach(() => {
  cleanup(); clients.splice(0).forEach(client => client.clear())
  focusManager.setFocused(undefined); onlineManager.setOnline(true); vi.useRealTimers(); vi.unstubAllGlobals()
})
const family = (kind: Kind) => kind === 'customer' ? 'customer_performance' : 'performance'
const readKey = (kind: Kind) => [family(kind), 'actor:executive', { yearMonth: '2026-10' }, 1]
const regionName = (kind: Kind) => kind === 'customer' ? 'Tabel aktivitas pelanggan' : 'Tabel aktivitas tim'
const panelName = (kind: Kind) => kind === 'customer' ? 'Performa Pelanggan' : 'Performa Tim Sales'
const dashboard = (client: QueryClient) => <StrictMode><QueryClientProvider client={client}><MemoryRouter><GirardDashboard /></MemoryRouter></QueryClientProvider></StrictMode>
async function mount(kind: Kind, terminalError = false) {
  // Match src/main.tsx: default retry/focus/reconnect/staleness behavior. Only
  // terminal-error tests disable retries to reach that terminal state promptly.
  const client = new QueryClient()
  if (terminalError) client.setQueryDefaults([family(kind)], { retry: false })
  clients.push(client)
  const view = render(dashboard(client))
  if (kind === 'sales') fireEvent.click(screen.getByRole('button', { name: panelName(kind) }))
  await screen.findByRole('region', { name: regionName(kind) })
  return { client, view }
}
const openers = () => screen.getAllByRole('button', { name: /^Rp / }) as HTMLButtonElement[]
function openDraft(layout: Layout) {
  fireEvent.click(openers()[layout === 'desktop' ? 0 : state.rows.length])
  const input = screen.getByRole('spinbutton') as HTMLInputElement
  fireEvent.change(input, { target: { value: '999' } })
  return input
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}
async function beginRefresh(kind: Kind, trigger: Trigger = 'visibility') {
  const gate = deferred(); state.readGate = gate.promise
  const before = state.reads.filter(read => read.kind === kind).length
  act(() => {
    if (trigger === 'visibility') {
      visibility = 'hidden'; window.dispatchEvent(new Event('visibilitychange'))
      visibility = 'visible'; window.dispatchEvent(new Event('visibilitychange'))
    } else {
      window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online'))
    }
  })
  // This helper establishes only the external read. It does not require the
  // bug (destroyed editor/released lock) or an implementation-specific remount.
  await waitFor(() => expect(state.reads.filter(read => read.kind === kind)).toHaveLength(before + 1))
  return gate
}
async function finishRefresh(kind: Kind, gate: ReturnType<typeof deferred>) {
  await act(async () => gate.resolve())
  return screen.findByRole('region', { name: regionName(kind) })
}
function expectMasked(kind: Kind) {
  expect(screen.queryByRole('region', { name: regionName(kind) })).toBeNull()
  expect(screen.queryByRole('spinbutton')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Simpan target' })).toBeNull()
  expect(screen.queryAllByText(kind === 'customer' ? 'Synthetic customer A' : 'Synthetic salesperson A')).toHaveLength(0)
  expect(screen.queryAllByRole('button', { name: /^Rp / })).toHaveLength(0)
}
function expectDraft(kind: Kind, layout: Layout, pending = false) {
  const inputs = screen.queryAllByRole('spinbutton') as HTMLInputElement[]
  expect(inputs, 'the fresh matching row must restore its sole target session').toHaveLength(1)
  expect(inputs[0].value).toBe('999')
  expect(inputs[0].disabled).toBe(pending)
  expect(openers().every(button => button.disabled)).toBe(true)
  const desktop = screen.getByRole('region', { name: regionName(kind) }).parentElement!
  expect(desktop.contains(inputs[0])).toBe(layout === 'desktop')
  expect(desktop.classList.contains(layout === 'desktop' ? 'block' : 'hidden')).toBe(true)
  expect(desktop.classList.contains('md:block')).toBe(false)
  return inputs[0]
}

// Real dashboard, default QueryClient, usePagedRead, presentation lock, fields,
// editors and mutation lifecycle. Only service/auth boundaries are synthetic.
for (const kind of ['customer', 'sales'] as const) {
  for (const layout of ['desktop', 'mobile'] as const) {
    for (const trigger of ['visibility', 'reconnect'] as const) test(`${kind} ${layout}: lone draft survives ${trigger} return while private rows stay masked`, async () => {
      await mount(kind); openDraft(layout)
      const read = await beginRefresh(kind, trigger)
      expectMasked(kind); expect(state.writes).toHaveLength(0)
      await finishRefresh(kind, read)
      const input = expectDraft(kind, layout)
      for (const width of [390, 1024]) {
        vi.stubGlobal('innerWidth', width); act(() => window.dispatchEvent(new Event('resize')))
        expect(expectDraft(kind, layout)).toBe(input)
      }
      openers().forEach(button => fireEvent.click(button))
      expectDraft(kind, layout); expect(state.writes).toHaveLength(0)
      fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
      expect(screen.queryByRole('spinbutton')).toBeNull(); expect(openers().every(button => !button.disabled)).toBe(true)
      fireEvent.click(openers()[0]); expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('200.00')
    })

    test(`${kind} ${layout}: read-before-save completion restores the pending session and prevents a duplicate write`, async () => {
      const { client } = await mount(kind); const invalidation = vi.spyOn(client, 'invalidateQueries')
      const write = deferred(); state.writeGate = write.promise
      fireEvent.keyDown(openDraft(layout), { key: 'Enter' })
      await waitFor(() => expect(state.writes).toHaveLength(1))
      const read = await beginRefresh(kind, 'reconnect'); expectMasked(kind)
      await finishRefresh(kind, read)
      const input = expectDraft(kind, layout, true)
      act(() => {
        fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.keyDown(input, { key: 'Escape' })
        fireEvent.click(screen.getByRole('button', { name: 'Simpan target' })); fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
        openers().forEach(button => button.click())
      })
      expectDraft(kind, layout, true); expect(state.writes).toHaveLength(1)
      state.target = '999.00'; await act(async () => write.resolve())
      await waitFor(() => expect(invalidation).toHaveBeenCalledWith({ queryKey: readKey(kind).slice(0, 3), refetchType: 'active' }))
      await screen.findByRole('region', { name: regionName(kind) })
      await waitFor(() => expect(screen.queryByRole('spinbutton')).toBeNull())
      expect(openers().every(button => !button.disabled)).toBe(true); expect(state.writes).toHaveLength(1)
      expect(state.writes[0]).toMatchObject({ table: kind === 'customer' ? 'customer_targets' : 'sales_targets',
        payload: { [kind === 'customer' ? 'customer_id' : 'user_id']: `${kind}-A`, target_value: 999, year_month: '2026-10', set_by: 'actor' },
        options: { onConflict: kind === 'customer' ? 'customer_id,year_month' : 'user_id,year_month' } })
    })

    test(`${kind} ${layout}: save completed while masked closes only its own session and still refreshes the active scope`, async () => {
      const { client } = await mount(kind); const invalidation = vi.spyOn(client, 'invalidateQueries')
      const write = deferred(); state.writeGate = write.promise
      fireEvent.keyDown(openDraft(layout), { key: 'Enter' })
      await waitFor(() => expect(state.writes).toHaveLength(1))
      const read = await beginRefresh(kind); expectMasked(kind)
      state.target = '999.00'; await act(async () => write.resolve())
      await waitFor(() => expect(invalidation).toHaveBeenCalledWith({ queryKey: readKey(kind).slice(0, 3), refetchType: 'active' }))
      expectMasked(kind)
      await finishRefresh(kind, read)
      expect(screen.queryByRole('spinbutton')).toBeNull(); expect(openers().every(button => !button.disabled)).toBe(true)
      expect(state.writes).toHaveLength(1)
      fireEvent.click(openers()[0]); expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('999.00')
    })

    for (const next of ['retry', 'cancel'] as const) test(`${kind} ${layout}: a save failure after refresh retains its draft and permits ${next}`, async () => {
      await mount(kind); const write = deferred(); state.writeGate = write.promise; state.writeError = true
      fireEvent.keyDown(openDraft(layout), { key: 'Enter' })
      await waitFor(() => expect(state.writes).toHaveLength(1))
      const read = await beginRefresh(kind); expectMasked(kind); await finishRefresh(kind, read)
      expectDraft(kind, layout, true)
      await act(async () => write.resolve())
      await screen.findByRole('alert'); expectDraft(kind, layout)
      if (next === 'retry') {
        state.writeError = false; state.target = '999.00'
        fireEvent.click(screen.getByRole('button', { name: 'Simpan target' }))
        await waitFor(() => expect(state.writes).toHaveLength(2))
        expect(state.writes[1].payload.target_value).toBe(999)
        await waitFor(() => expect(screen.queryByRole('spinbutton')).toBeNull())
        await screen.findByRole('region', { name: regionName(kind) })
      } else fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
      expect(openers().every(button => !button.disabled)).toBe(true); expect(screen.queryByRole('alert')).toBeNull()
    })
  }

  for (const error of ['transport', 'denial'] as const) test(`${kind}: terminal ${error} read failure clears the session before retry`, async () => {
    await mount(kind, true); openDraft('desktop')
    const read = await beginRefresh(kind); expectMasked(kind)
    state.readError = error === 'denial' ? Object.assign(new Error('synthetic permission denial'), { code: '42501' }) : new Error('synthetic unavailable read')
    await act(async () => read.resolve())
    const alert = await screen.findByRole('alert'); expectMasked(kind)
    state.readError = null; fireEvent.click(within(alert).getByRole('button', { name: 'Coba lagi' }))
    await screen.findByRole('region', { name: regionName(kind) })
    expect(screen.queryByRole('spinbutton')).toBeNull(); expect(openers().every(button => !button.disabled)).toBe(true)
    fireEvent.click(openers()[0]); expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('200.00')
    expect(state.writes).toHaveLength(0)
  })

  test(`${kind}: a fresh read removing the target clears it and its later return cannot resurrect the draft`, async () => {
    await mount(kind); openDraft('mobile')
    const removed = await beginRefresh(kind); state.rows = ['B']; await finishRefresh(kind, removed)
    expect(screen.queryByRole('spinbutton')).toBeNull(); expect(openers().every(button => !button.disabled)).toBe(true)
    const returned = await beginRefresh(kind); state.rows = ['A', 'B']; await finishRefresh(kind, returned)
    expect(screen.queryByRole('spinbutton')).toBeNull()
    fireEvent.click(openers()[0]); expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('200.00')
    expect(state.writes).toHaveLength(0)
  })

  for (const change of ['actor', 'role', 'capability', 'month', 'page', 'tab'] as const) test(`${kind}: ${change} change clears a draft held behind refresh masking`, async () => {
    const { client, view } = await mount(kind); openDraft('desktop')
    const read = await beginRefresh(kind); expectMasked(kind)
    if (change === 'actor' || change === 'role' || change === 'capability') {
      if (change === 'actor') state.actor = 'replacement'
      else state.role = change === 'role' ? 'sales_head' : 'sales_person'
      view.rerender(dashboard(client))
    } else if (change === 'month') {
      fireEvent.change(screen.getByLabelText(kind === 'customer' ? 'Bulan aktivitas pelanggan' : 'Bulan performa sales'), { target: { value: '2026-09' } })
    } else if (change === 'tab') {
      fireEvent.click(screen.getByRole('button', { name: panelName(kind === 'customer' ? 'sales' : 'customer') }))
    } else {
      // Page controls are correctly masked during revalidation. First let the
      // same-scope read finish, then exercise the real next-page action.
      await finishRefresh(kind, read)
      fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }))
    }
    await act(async () => read.resolve())
    if (change === 'tab') {
      await screen.findByRole('region', { name: regionName(kind === 'customer' ? 'sales' : 'customer') })
      fireEvent.click(screen.getByRole('button', { name: panelName(kind) }))
    }
    await screen.findByRole('region', { name: regionName(kind) })
    expect(screen.queryByRole('spinbutton')).toBeNull()
    if (change === 'capability') {
      expect(screen.queryAllByRole('button', { name: /^Rp / })).toHaveLength(0)
      state.role = 'executive'; view.rerender(dashboard(client))
      await screen.findByRole('region', { name: regionName(kind) })
    }
    expect(openers().every(button => !button.disabled)).toBe(true)
    fireEvent.click(openers()[0]); expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('200.00')
    expect(state.writes).toHaveLength(0)
  })
}

for (const kind of ['customer', 'sales'] as const) for (const clearedBy of ['read-error', 'row-removal'] as const) for (const outcome of ['success', 'failure'] as const) {
  test(`${kind}: ${clearedBy} clears the draft but fences all openers until the held save ${outcome} settles`, async () => {
    const { client } = await mount(kind, true); const invalidation = vi.spyOn(client, 'invalidateQueries')
    const write = deferred(); state.writeGate = write.promise; state.writeError = outcome === 'failure'
    fireEvent.keyDown(openDraft('mobile'), { key: 'Enter' })
    await waitFor(() => expect(state.writes).toHaveLength(1))
    const read = await beginRefresh(kind); expectMasked(kind)
    if (clearedBy === 'read-error') {
      state.readError = new Error('synthetic terminal read error')
      await act(async () => read.resolve())
      const alert = await screen.findByRole('alert')
      state.readError = null; fireEvent.click(within(alert).getByRole('button', { name: 'Coba lagi' }))
      await screen.findByRole('region', { name: regionName(kind) })
    } else {
      state.rows = ['B']; await finishRefresh(kind, read)
    }
    expect(screen.queryByRole('spinbutton')).toBeNull()
    expect(openers().every(button => button.disabled), 'the same-scope pending operation must still fence every target').toBe(true)
    expect(screen.getByText(/Target sedang disimpan/)).toBeTruthy()
    openers().forEach(button => { fireEvent.click(button); fireEvent.keyDown(button, { key: 'Enter' }); button.click() })
    expect(screen.queryByRole('spinbutton')).toBeNull(); expect(state.writes).toHaveLength(1)
    await act(async () => write.resolve())
    await waitFor(() => expect(openers().every(button => !button.disabled)).toBe(true))
    expect(screen.queryByRole('alert')).toBeNull(); expect(screen.queryByRole('spinbutton')).toBeNull()
    if (outcome === 'success') expect(invalidation).toHaveBeenCalledWith({ queryKey: readKey(kind).slice(0, 3), refetchType: 'none' })
    else expect(invalidation).not.toHaveBeenCalled()
    fireEvent.click(openers()[0]); const next = screen.getByRole('spinbutton') as HTMLInputElement
    expect(next.value).toBe('200.00'); fireEvent.change(next, { target: { value: '777' } })
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('spinbutton')).toBe(next); expect(next.value).toBe('777')
    expect(openers().every(button => button.disabled)).toBe(true); expect(state.writes).toHaveLength(1)
  })
}


for (const kind of ['customer', 'sales'] as const) for (const layout of ['desktop', 'mobile'] as const) {
  test(`${kind} ${layout}: a save failure while masked restores retry/cancel only after a successful fresh read`, async () => {
    const { client } = await mount(kind)
    const write = deferred(); state.writeGate = write.promise; state.writeError = true
    fireEvent.keyDown(openDraft(layout), { key: 'Enter' })
    await waitFor(() => expect(state.writes).toHaveLength(1))
    const read = await beginRefresh(kind); expectMasked(kind)
    await act(async () => write.resolve())
    await waitFor(() => expect(client.getMutationCache().getAll().at(-1)?.state.status).toBe('error'))
    expectMasked(kind); expect(screen.queryByRole('alert')).toBeNull()
    await finishRefresh(kind, read)
    expectDraft(kind, layout)
    expect(screen.getByRole('alert').textContent).toMatch(/Penyimpanan target.*kendala/)
    expect((screen.getByRole('button', { name: 'Simpan target' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
    expect(screen.queryByRole('spinbutton')).toBeNull(); expect(openers().every(button => !button.disabled)).toBe(true)
    expect(state.writes).toHaveLength(1)
  })
}
