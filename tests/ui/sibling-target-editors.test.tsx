import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { RESPONSE_EXAMPLES } from '../scalability/response-examples'

const state = vi.hoisted(() => ({ actor: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'executive', readGate: null as Promise<void> | null, reads: [] as { kind: string; actor: string; role: string; month: string; page: number }[], target: '200.00' as string | null, writeError: false, readError: false, authGate: null as Promise<void> | null, writeGate: null as Promise<void> | null, writes: [] as any[], getUser: vi.fn(), retry: vi.fn() }))
vi.mock('../../src/components/GirardNav', () => ({ default: () => <nav aria-label="Navigasi modul">Sales</nav> }))
vi.mock('../../src/components/sales/SalesMetricSummary', () => ({ SalesMetricsPanel: () => <p>Metrik Sales terpisah</p> }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: state.actor }, profile: { id: state.actor, role: state.role, is_active: true }, loading: false, error: null }) }))
vi.mock('../../src/lib/reads/reports', () => ({
  fetchEarliestSalesPerformanceMonth: async () => '2026-09',
  fetchCustomerPerformancePage: async (actor: string, role: string, month: string, page: number) => { state.retry(); state.reads.push({ kind: 'customer', actor, role, month, page }); await state.readGate; if (state.readError) throw new Error('read unavailable'); return { ...RESPONSE_EXAMPLES.pilot_customer_performance_v1, page, page_size: 2, total: 4, items: ['A', 'B'].map((letter, index) => ({ ...RESPONSE_EXAMPLES.pilot_customer_performance_v1.items[0], id: `customer-${letter}`, name: `Synthetic customer ${letter}`, sales_target: index === 0 ? state.target : '200.00' })) } },
  fetchSalesPerformancePage: async (actor: string, role: string, month: string, page: number) => { state.retry(); state.reads.push({ kind: 'sales', actor, role, month, page }); await state.readGate; if (state.readError) throw new Error('read unavailable'); return { ...RESPONSE_EXAMPLES.pilot_sales_performance_v1, page, page_size: 2, total: 4, items: ['A', 'B'].map((letter, index) => ({ ...RESPONSE_EXAMPLES.pilot_sales_performance_v1.items[0], id: `sales-${letter}`, full_name: `Synthetic salesperson ${letter}`, sales_target: index === 0 ? state.target : '200.00' })) } },
}))
vi.mock('../../src/lib/supabase', () => ({ supabase: {
  supabaseUrl: 'https://legacy-target.example.invalid', rest: { url: 'https://legacy-target.example.invalid/rest/v1', schemaName: 'public' },
  rpc: async (name: string) => {
    if (name !== 'pilot_customer_target_write_access_v1') throw new Error(`Unexpected target RPC ${name}`)
    if (!['sales_head', 'executive'].includes(state.role)) return { data: null, error: { code: '42501' } }
    return { data: { version: 1, actor_id: state.actor, mode: 'legacy' }, error: null }
  },
  auth: { getUser: async () => { state.getUser(); await state.authGate; return { data: { user: { id: state.actor } } } } },
  from: (table: string) => ({ upsert: async (payload: any, options: any) => { state.writes.push({ table, payload, options }); const error = state.writeError ? new Error('save unavailable') : null; await state.writeGate; return { error } } }),
} }))
import { useTargetEditorLock } from '../../src/components/ui/useTargetEditorLock'
import { CustomerActivityContent } from '../../src/pages/girard/CustomerPerformance'
import { PerformanceActivityContent } from '../../src/pages/girard/GirardPerformance'
import GirardDashboard from '../../src/pages/girard/GirardDashboard'

const clients: QueryClient[] = []
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-12T12:00:00Z')); state.actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; state.role = 'executive'; state.readGate = null; state.reads = []; state.target = '200.00'; state.writeError = false; state.readError = false; state.authGate = null; state.writeGate = null; state.writes = []; state.getUser.mockReset(); state.retry.mockReset() })
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.useRealTimers(); vi.unstubAllGlobals() })
let currentView: ReturnType<typeof render>
const dashboard = (client: QueryClient) => <QueryClientProvider client={client}><MemoryRouter><GirardDashboard /></MemoryRouter></QueryClientProvider>
function mount() { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client); currentView = render(dashboard(client)); return currentView }
const family = (kind: 'customer' | 'sales') => kind === 'customer' ? 'customer_performance' : 'performance'
const readKey = (kind: 'customer' | 'sales', actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role = 'executive', month = '2026-10', page = 1) => [family(kind), `${actor}:${role}`, { yearMonth: month }, page]
const regionName = (kind: 'customer' | 'sales') => kind === 'sales' ? 'Tabel aktivitas tim' : 'Tabel aktivitas pelanggan'
async function panel(kind: 'customer' | 'sales') {
  mount()
  if (kind === 'sales') fireEvent.click(screen.getByRole('button', { name: 'Performa Tim Sales' }))
  return screen.findByRole('region', { name: kind === 'sales' ? 'Tabel aktivitas tim' : 'Tabel aktivitas pelanggan' })
}
function openers() { return screen.getAllByRole('button', { name: /^(?:Rp |\+ Atur target)/ }) as HTMLButtonElement[] }
function opener(region: HTMLElement) { return within(region).getAllByRole('button', { name: /^(?:Rp |\+ Atur target)/ })[0] as HTMLButtonElement }
function activate(button: HTMLButtonElement) { act(() => button.click()) }
function layoutCopies(kind: 'customer' | 'sales') {
  const desktop = screen.getByRole('region', { name: regionName(kind) }).parentElement!
  const mobileControl = [...openers(), ...screen.queryAllByRole('spinbutton')].find(control => !desktop.contains(control))!
  const mobile = mobileControl.closest('[class~="space-y-3"]') as HTMLElement
  return { desktop, mobile }
}
function expectResponsive(copies: ReturnType<typeof layoutCopies>) {
  expect(copies.desktop.classList.contains('hidden')).toBe(true)
  expect(copies.desktop.classList.contains('md:block')).toBe(true)
  expect(copies.mobile.classList.contains('md:hidden')).toBe(true)
  expect(copies.mobile.classList.contains('hidden')).toBe(false)
}
function expectPinned(copies: ReturnType<typeof layoutCopies>, owner: 'desktop' | 'mobile') {
  expect(copies[owner].classList.contains('block')).toBe(true)
  expect(copies[owner].classList.contains('hidden')).toBe(false)
  expect(copies[owner].classList.contains('md:hidden')).toBe(false)
  expect(copies[owner].classList.contains('md:block')).toBe(false)
  const other = copies[owner === 'desktop' ? 'mobile' : 'desktop']
  expect(other.classList.contains('hidden')).toBe(true)
  expect(other.classList.contains('md:block')).toBe(false)
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }


// Real dashboard, QueryClient, usePagedRead, inline editors, buttons and fields.
// Only external read/auth/write boundaries and unrelated module chrome are synthetic.
for (const kind of ['customer', 'sales'] as const) {
  for (const firstCopy of ['desktop', 'mobile'] as const) test(`${kind} ${firstCopy} claims synchronously and disables every sibling copy including keyboard activation`, async () => {
    await panel(kind)
    const buttons = openers(); expect(buttons).toHaveLength(4)
    const first = firstCopy === 'desktop' ? buttons[0] : buttons[2]
    const sibling = firstCopy === 'desktop' ? buttons[1] : buttons[3]
    act(() => { first.click(); sibling.click() })
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1)
    const input = screen.getByRole('spinbutton') as HTMLInputElement
    fireEvent.change(input, { target: { value: '999' } })
    for (const button of openers()) {
      expect(button.disabled).toBe(true)
      const description = document.getElementById(button.getAttribute('aria-describedby') ?? '')
      expect(description?.textContent).toMatch(/Simpan atau batalkan.*target/i)
      button.focus(); expect(document.activeElement).not.toBe(button)
      // jsdom does not synthesize native keyboard clicks; .click() invokes the
      // native button activation path, which must remain disabled too.
      fireEvent.keyDown(button, { key: 'Enter' }); fireEvent.keyDown(button, { key: ' ' }); activate(button)
    }
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1)
    expect(screen.getByRole('spinbutton')).toBe(input); expect(input.value).toBe('999')
    expect((screen.getByRole('button', { name: 'Simpan target' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Batal' }) as HTMLButtonElement).disabled).toBe(false)
    expect(state.writes).toHaveLength(0)
  })

  for (const owner of ['desktop', 'mobile'] as const) for (const finish of ['Cancel', 'Escape', 'Save'] as const) test(`${kind} ${owner} pins its owning copy across breakpoint changes until ${finish}`, async () => {
    await panel(kind); const copies = layoutCopies(kind); expectResponsive(copies)
    activate(openers()[owner === 'desktop' ? 0 : 2])
    const input = screen.getByRole('spinbutton') as HTMLInputElement
    fireEvent.change(input, { target: { value: '999' } })
    expect(copies[owner].contains(input)).toBe(true)
    expectPinned(copies, owner)
    // This verifies emitted DOM/classes and retained ownership. jsdom cannot
    // prove CSS breakpoint rendering; browser acceptance remains separate.
    for (const width of [390, 1024, 320, 768]) {
      vi.stubGlobal('innerWidth', width); act(() => { window.dispatchEvent(new Event('resize')) })
      expectPinned(copies, owner)
      expect(screen.getByRole('spinbutton')).toBe(input); expect(input.isConnected).toBe(true); expect(input.value).toBe('999')
      expect(within(copies[owner]).getByRole('button', { name: 'Simpan target' })).toBeTruthy()
      expect(within(copies[owner]).getByRole('button', { name: 'Batal' })).toBeTruthy()
    }
    if (finish === 'Save') {
      const write = deferred(); state.writeGate = write.promise
      fireEvent.keyDown(input, { key: 'Enter' }); await waitFor(() => expect(state.writes).toHaveLength(1))
      expectPinned(copies, owner)
      await act(async () => write.resolve())
      await waitFor(() => expect(screen.queryByRole('spinbutton')).toBeNull())
      await screen.findByRole('region', { name: regionName(kind) })
      expectResponsive(layoutCopies(kind))
    } else {
      if (finish === 'Cancel') fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
      else fireEvent.keyDown(input, { key: 'Escape' })
      expectResponsive(copies); expect(screen.queryByRole('spinbutton')).toBeNull(); expect(state.writes).toHaveLength(0)
    }
    expect(openers().every(button => !button.disabled)).toBe(true)
  })

  for (const method of ['button', 'Escape'] as const) test(`${kind} explicit ${method} cancel releases siblings without writing the discarded draft`, async () => {
    await panel(kind); activate(openers()[0])
    const input = screen.getByRole('spinbutton'); fireEvent.change(input, { target: { value: '999' } })
    expect(openers().every(button => button.disabled)).toBe(true)
    if (method === 'button') fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
    else fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('spinbutton')).toBeNull()
    expect(openers().every(button => !button.disabled)).toBe(true)
    activate(openers()[1])
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('200.00')
    expect(state.getUser).not.toHaveBeenCalled(); expect(state.writes).toHaveLength(0)
  })

  test(`${kind} held save keeps its lock and success releases it after the normal active refresh`, async () => {
    const write = deferred(); state.writeGate = write.promise
    const region = await panel(kind); const client = clients.at(-1)!; const invalidation = vi.spyOn(client, 'invalidateQueries')
    activate(opener(region)); const input = screen.getByRole('spinbutton') as HTMLInputElement
    fireEvent.change(input, { target: { value: '100' } }); fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(state.writes).toHaveLength(1))
    expect(openers().every(button => button.disabled)).toBe(true)
    expect(input.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Batal' })); fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.getByRole('spinbutton')).toBe(input)
    openers().forEach(button => activate(button)); expect(screen.getAllByRole('spinbutton')).toHaveLength(1)
    const read = deferred(); state.readGate = read.promise; state.target = '100.00'; const before = state.reads.length
    await act(async () => write.resolve()); await waitFor(() => expect(state.reads).toHaveLength(before + 1))
    expect(invalidation).toHaveBeenCalledWith({ queryKey: readKey(kind).slice(0, 3), refetchType: 'active' })
    expect(screen.queryByRole('region', { name: regionName(kind) })).toBeNull()
    await act(async () => read.resolve()); await screen.findByRole('region', { name: regionName(kind) })
    expect(openers().every(button => !button.disabled)).toBe(true)
    expect(screen.queryByRole('alert')).toBeNull(); expectResponsive(layoutCopies(kind))
    activate(openers()[1]); expect(screen.getAllByRole('spinbutton')).toHaveLength(1)
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('200.00')
    expect(state.writes).toHaveLength(1)
    expect(state.writes[0]).toMatchObject({ table: kind === 'customer' ? 'customer_targets' : 'sales_targets', payload: { [kind === 'customer' ? 'customer_id' : 'user_id']: `${kind}-A`, year_month: '2026-10', target_value: 100, set_by: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, options: { onConflict: kind === 'customer' ? 'customer_id,year_month' : 'user_id,year_month' } })
  })

  for (const owner of ['desktop', 'mobile'] as const) for (const next of ['retry', 'cancel'] as const) test(`${kind} ${owner} failed save retains its typed draft and lock but permits ${next}`, async () => {
    state.writeError = true; await panel(kind); activate(openers()[owner === 'desktop' ? 0 : 2])
    const input = screen.getByRole('spinbutton') as HTMLInputElement
    fireEvent.change(input, { target: { value: '999' } }); fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(state.writes).toHaveLength(1))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Batal' }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByRole('spinbutton')).toBe(input); expect(input.isConnected).toBe(true); expect(input.value).toBe('999')
    const failure = screen.getByRole('alert')
    expect(failure.textContent).toMatch(/Penyimpanan target.*kendala/i)
    expect(failure.textContent).toMatch(/simpan lagi.*Batal/i)
    expect(input.getAttribute('aria-invalid')).toBeNull()
    expectPinned(layoutCopies(kind), owner)
    expect(input.disabled).toBe(false); expect(openers().every(button => button.disabled)).toBe(true)
    expect((screen.getByRole('button', { name: 'Simpan target' }) as HTMLButtonElement).disabled).toBe(false)
    openers().forEach(button => activate(button)); expect(screen.getAllByRole('spinbutton')).toHaveLength(1)
    if (next === 'retry') {
      state.writeError = false; state.target = '999.00'
      fireEvent.click(screen.getByRole('button', { name: 'Simpan target' }))
      await waitFor(() => expect(state.writes).toHaveLength(2))
      expect(state.writes[1].payload.target_value).toBe(999)
      await waitFor(() => expect(screen.queryByRole('spinbutton')).toBeNull())
      await screen.findByRole('region', { name: regionName(kind) })
    } else fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
    expect(openers().every(button => !button.disabled)).toBe(true)
    expect(screen.queryByRole('alert')).toBeNull(); expectResponsive(layoutCopies(kind))
    activate(openers()[1]); expect(screen.getAllByRole('spinbutton')).toHaveLength(1)
  })

  for (const change of ['month', 'page', 'actor', 'role'] as const) test(`${kind} fresh cached ${change} replacement remains exclusively owned after stale completion and cleanup`, async () => {
    const write = deferred(); state.writeGate = write.promise
    await panel(kind); const client = clients.at(-1)!; const invalidation = vi.spyOn(client, 'invalidateQueries')
    activate(openers()[0]); const oldInput = screen.getByRole('spinbutton')
    fireEvent.keyDown(oldInput, { key: 'Enter' }); await waitFor(() => expect(state.writes).toHaveLength(1))
    const nextActor = change === 'actor' ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const nextRole = change === 'role' ? 'sales_head' : 'executive'
    const nextMonth = change === 'month' ? '2026-09' : '2026-10'
    const nextPage = change === 'page' ? 2 : 1
    const nextKey = readKey(kind, nextActor, nextRole, nextMonth, nextPage)
    client.setQueryDefaults(nextKey, { staleTime: Infinity })
    client.setQueryData(nextKey, { ...client.getQueryData<any>(readKey(kind)), page: nextPage })
    if (change === 'month') fireEvent.change(screen.getByLabelText(kind === 'customer' ? 'Bulan aktivitas pelanggan' : 'Bulan performa sales'), { target: { value: nextMonth } })
    else if (change === 'page') fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }))
    else { state.actor = nextActor; state.role = nextRole; currentView.rerender(dashboard(client)) }
    expect(oldInput.isConnected).toBe(false); expect(screen.queryByRole('spinbutton')).toBeNull()
    expectResponsive(layoutCopies(kind))
    expect(openers().every(button => !button.disabled)).toBe(true)
    activate(openers()[1]); const current = screen.getByRole('spinbutton') as HTMLInputElement
    fireEvent.change(current, { target: { value: '999' } })
    expect(openers().every(button => button.disabled)).toBe(true)
    const read = deferred(); state.readGate = read.promise; const before = state.reads.length
    await act(async () => write.resolve()); await waitFor(() => expect(invalidation).toHaveBeenCalled())
    expect(screen.getByRole('spinbutton')).toBe(current); expect(current.isConnected).toBe(true); expect(current.value).toBe('999')
    expectPinned(layoutCopies(kind), 'desktop')
    expect(openers().every(button => button.disabled)).toBe(true)
    openers().forEach(button => activate(button)); expect(screen.getAllByRole('spinbutton')).toHaveLength(1)
    expect(invalidation).toHaveBeenCalledWith({ queryKey: readKey(kind).slice(0, 3), refetchType: 'none' })
    expect(state.reads).toHaveLength(before); expect(state.writes).toHaveLength(1)
    await act(async () => read.resolve())
    fireEvent.click(screen.getByRole('button', { name: 'Batal' })); expect(openers().every(button => !button.disabled)).toBe(true)
  })

  for (const owner of ['desktop', 'mobile'] as const) test(`${kind} ${owner} inactive sibling cleanup cannot unlock the retained current draft`, async () => {
    await panel(kind); const client = clients.at(-1)!
    activate(openers()[owner === 'desktop' ? 1 : 3]); const input = screen.getByRole('spinbutton') as HTMLInputElement
    fireEvent.change(input, { target: { value: '999' } })
    expect(openers().every(button => button.disabled)).toBe(true)
    await act(async () => { client.setQueryData<any>(readKey(kind), (data: any) => ({ ...data, items: data.items.filter((row: any) => row.id === `${kind}-B`) })) })
    await waitFor(() => expect(openers()).toHaveLength(1))
    expect(screen.getByRole('spinbutton')).toBe(input); expect(input.isConnected).toBe(true); expect(input.value).toBe('999')
    expectPinned(layoutCopies(kind), owner)
    expect(openers()[0].disabled).toBe(true)
    activate(openers()[0]); expect(screen.getAllByRole('spinbutton')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Batal' })); expect(openers().every(button => !button.disabled)).toBe(true)
    expect(state.writes).toHaveLength(0)
  })

  for (const owner of ['desktop', 'mobile'] as const) test(`${kind} ${owner} same-scope row removal retains the pending panel fence until settlement`, async () => {
    const write = deferred(); state.writeGate = write.promise
    await panel(kind); const client = clients.at(-1)!; const invalidation = vi.spyOn(client, 'invalidateQueries')
    activate(openers()[owner === 'desktop' ? 0 : 2]); const oldInput = screen.getByRole('spinbutton')
    fireEvent.keyDown(oldInput, { key: 'Enter' }); await waitFor(() => expect(state.writes).toHaveLength(1))
    await act(async () => { client.setQueryData<any>(readKey(kind), (data: any) => ({ ...data, items: data.items.filter((row: any) => row.id === `${kind}-B`) })) })
    await waitFor(() => expect(oldInput.isConnected).toBe(false)); expect(screen.queryByRole('spinbutton')).toBeNull()
    expect(openers().every(button => button.disabled)).toBe(true)
    expectPinned(layoutCopies(kind), owner)
    expect(screen.getByText(/Target sedang disimpan/)).toBeTruthy()
    openers().forEach(button => activate(button)); expect(screen.queryByRole('spinbutton')).toBeNull()
    const before = state.reads.length
    await act(async () => write.resolve()); await waitFor(() => expect(openers().every(button => !button.disabled)).toBe(true))
    expect(invalidation).toHaveBeenCalledWith({ queryKey: readKey(kind).slice(0, 3), refetchType: 'none' })
    expectResponsive(layoutCopies(kind))
    expect(state.reads).toHaveLength(before); expect(state.writes).toHaveLength(1)
    activate(openers()[owner === 'desktop' ? 1 : 0]); const input = screen.getByRole('spinbutton') as HTMLInputElement
    fireEvent.change(input, { target: { value: '999' } })
    expectPinned(layoutCopies(kind), owner === 'desktop' ? 'mobile' : 'desktop')
    expect(openers().every(button => button.disabled)).toBe(true)
    activate(openers()[0]); expect(screen.getAllByRole('spinbutton')).toHaveLength(1)
    expect(screen.getByRole('spinbutton')).toBe(input); expect(input.value).toBe('999')
    fireEvent.click(screen.getByRole('button', { name: 'Batal' })); expect(openers().every(button => !button.disabled)).toBe(true)
  })

  test(`${kind} tab unmount releases the panel and an old save cannot unlock its newer same-scope editor`, async () => {
    const write = deferred(); state.writeGate = write.promise
    await panel(kind); const client = clients.at(-1)!; const invalidation = vi.spyOn(client, 'invalidateQueries')
    activate(openers()[0]); fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Enter' })
    await waitFor(() => expect(state.writes).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: kind === 'customer' ? 'Performa Tim Sales' : 'Performa Pelanggan' }))
    await screen.findByRole('region', { name: regionName(kind === 'customer' ? 'sales' : 'customer') })
    expect(openers().every(button => !button.disabled)).toBe(true)
    activate(openers()[0]); expect(screen.getByRole('spinbutton')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: kind === 'customer' ? 'Performa Pelanggan' : 'Performa Tim Sales' }))
    await screen.findByRole('region', { name: regionName(kind) }); expect(openers().every(button => !button.disabled)).toBe(true)
    activate(openers()[1]); const input = screen.getByRole('spinbutton') as HTMLInputElement
    fireEvent.change(input, { target: { value: '999' } })
    await act(async () => write.resolve()); await waitFor(() => expect(invalidation).toHaveBeenCalled())
    expect(screen.getByRole('spinbutton')).toBe(input); expect(input.value).toBe('999')
    expect(openers().every(button => button.disabled)).toBe(true)
    openers().forEach(button => activate(button)); expect(screen.getAllByRole('spinbutton')).toHaveLength(1)
  })
}

test('customer and team read families own independent presentation locks', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client)
  render(<QueryClientProvider client={client}><MemoryRouter><CustomerActivityContent /><PerformanceActivityContent /></MemoryRouter></QueryClientProvider>)
  const customer = await screen.findByRole('region', { name: 'Tabel aktivitas pelanggan' })
  const sales = await screen.findByRole('region', { name: 'Tabel aktivitas tim' })
  activate(opener(customer)); expect(opener(sales).disabled).toBe(false)
  activate(opener(sales)); expect(screen.getAllByRole('spinbutton')).toHaveLength(2)
  expect(openers().every(button => button.disabled)).toBe(true)
})

// The real presentation hook's synchronous API also protects claims before a
// render has updated native disabled flags. No numeric draft lives in this API.
test('opaque release ignores a different owner before another same-turn claim', () => {
  const { result } = renderHook(() => useTargetEditorLock('current'))
  const first = Symbol(); const other = Symbol()
  act(() => {
    expect(result.current.claim(first, 'desktop')).toBe(true)
    result.current.release(other)
    expect(result.current.claim(other, 'mobile')).toBe(false)
  })
  expect(result.current.busy).toBe(true)
  expect(result.current.layout).toBe('desktop')
})

test('opaque release from an earlier owner cannot unlock its newer same-scope replacement', () => {
  const { result } = renderHook(() => useTargetEditorLock('current'))
  const first = Symbol(); const second = Symbol(); const third = Symbol()
  act(() => {
    expect(result.current.claim(first, 'desktop')).toBe(true)
    result.current.release(first)
    expect(result.current.claim(second, 'mobile')).toBe(true)
    result.current.release(first)
    expect(result.current.claim(third, 'desktop')).toBe(false)
  })
  expect(result.current.busy).toBe(true)
  expect(result.current.layout).toBe('mobile')
})

test('opaque release from an earlier scope cannot clear a newer scope owner', () => {
  const { result, rerender } = renderHook(({ scope }) => useTargetEditorLock(scope), { initialProps: { scope: 'first' } })
  const first = Symbol(); const second = Symbol(); const third = Symbol()
  act(() => { expect(result.current.claim(first, 'desktop')).toBe(true) })
  const oldRelease = result.current.release
  rerender({ scope: 'second' }); expect(result.current.busy).toBe(false); expect(result.current.layout).toBeNull()
  act(() => {
    expect(result.current.claim(second, 'mobile')).toBe(true)
    oldRelease(first)
    expect(result.current.claim(third, 'desktop')).toBe(false)
  })
  expect(result.current.busy).toBe(true)
  expect(result.current.layout).toBe('mobile')
})
