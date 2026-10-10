import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), raw: vi.fn(), auth: {} as any }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: mocks.rpc, functions: { invoke: mocks.invoke }, from: mocks.raw, storage: { from: mocks.raw } } }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => mocks.auth }))
import ActivePromotionsBanner from '../../src/components/ActivePromotionsBanner'
import SalesPage from '../../src/pages/girard/Promotions'

const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', promotion = '11111111-1111-4111-8111-111111111111'
const otherPromotion = '22222222-2222-4222-8222-222222222222'
const item = (changes = {}) => ({ id: promotion, product_id: promotion, product_name: 'Tiles', sku: 'SKU', size: '60 × 60', start_date: '2020-01-01', end_date: '2020-01-02', is_active: true, stock_managed: true, remaining_quantity: 3, stock_version: 1, image_path: `promotions/${actor}/${promotion}/33333333-3333-4333-8333-333333333333.png`, harga_pokok: null, luar_kota: 0, dalam_kota: 71, depo_bangunan: null, ...changes })
let items: ReturnType<typeof item>[], client: QueryClient
const reply = () => ({ data: { version: 1, as_of: '2026-10-09T12:00:00Z', items }, error: null })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function request<T>(promise: Promise<T>) { return Object.assign(promise, { abortSignal: () => promise }) }
async function tick(ms = 1) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
function mount(page = false) { return render(<QueryClientProvider client={client}><MemoryRouter>{page ? <SalesPage /> : <ActivePromotionsBanner />}</MemoryRouter></QueryClientProvider>) }

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T12:00:00Z'))
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  focusManager.setFocused(undefined); onlineManager.setOnline(true)
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  mocks.auth = { user: { id: actor }, profile: { id: actor, full_name: 'Sales user', role: 'sales_person', is_active: true }, loading: false, error: null, signOut: vi.fn() }
  items = [item()]
  mocks.rpc.mockReset().mockImplementation(() => request(Promise.resolve(reply())))
  mocks.invoke.mockReset().mockImplementation((_name, args) => Promise.resolve({ data: { promotion_id: args.body.promotion_id, signed_url: `https://example.invalid/${args.body.promotion_id}?token=private`, expires_in: 300 }, error: null }))
  mocks.raw.mockReset().mockImplementation(() => { throw new Error('Raw access must not be used') })
  localStorage.clear()
})
afterEach(() => { cleanup(); client.clear(); vi.useRealTimers(); focusManager.setFocused(undefined); onlineManager.setOnline(true) })

test.each(['sales_person', 'sales_manager', 'sales_head', 'executive'])('%s sees positive promotional stock and its product image without ordering or administration', async role => {
  mocks.auth.profile.role = role; mount(true); await tick()
  expect(screen.getByText('Stok tersedia: 3')).toBeTruthy()
  expect(screen.getByText('SKU · 60 × 60')).toBeTruthy()
  expect(screen.getByRole('img', { name: 'Promosi Tiles' }).getAttribute('src')).toBe(`https://example.invalid/${promotion}?token=private`)
  expect(screen.queryByRole('button', { name: /Tambah Promosi|Aktifkan|Jeda|Hapus|Tambah ke|Simpan|Ubah/ })).toBeNull()
  expect(mocks.rpc).toHaveBeenCalledWith('pilot_promotions_v1', { p_include_inactive: false })
  expect(mocks.rpc.mock.calls.every(call => call[0] === 'pilot_promotions_v1')).toBe(true)
  expect(mocks.invoke).toHaveBeenCalledWith('promotion-image-url', { body: { promotion_id: promotion } })
  expect(mocks.raw).not.toHaveBeenCalled()
})

test('enabled exhausted stock disappears without signing or pausing the campaign', async () => {
  items = [item({ remaining_quantity: 0 })]; mount(); await tick()
  expect(screen.queryByText('Tiles')).toBeNull()
  expect(screen.getByText('Belum ada product highlight aktif.')).toBeTruthy()
  expect(mocks.invoke).not.toHaveBeenCalled()
  expect(items[0]).toMatchObject({ is_active: true, remaining_quantity: 0 })
})

test('mixed highlights show only enabled positive stock and ignore managed legacy dates', async () => {
  items = [item(), item({ id: otherPromotion, product_name: 'Exhausted', remaining_quantity: 0 }), item({ id: actor, product_name: 'Paused', is_active: false })]
  mount(); await tick()
  expect(screen.getByText('Tiles')).toBeTruthy()
  expect(screen.queryByText('Exhausted')).toBeNull(); expect(screen.queryByText('Paused')).toBeNull()
  expect(screen.getAllByRole('img')).toHaveLength(1)
  expect(mocks.invoke).toHaveBeenCalledOnce()
})

test.each([-1, null, 0.5])('malformed managed stock %s fails closed instead of becoming available stock', async remaining_quantity => {
  items = [item({ remaining_quantity })]; mount(); await tick()
  expect(screen.getByRole('alert').textContent).toContain('Highlight belum dapat dimuat.')
  expect(screen.queryByText('Tiles')).toBeNull(); expect(mocks.invoke).not.toHaveBeenCalled()
})

test('prefix invalidation removes depleted cards, stops their renewals and restores replenished stock', async () => {
  mount(); await tick(); expect(screen.getByRole('img')).toBeTruthy()
  items = [item({ remaining_quantity: 0, stock_version: 2 })]
  await act(async () => { await client.invalidateQueries({ queryKey: ['promotions'] }) }); await tick()
  expect(screen.queryByText('Tiles')).toBeNull(); expect(screen.queryByRole('img')).toBeNull()
  const signatures = mocks.invoke.mock.calls.length
  await tick(240_000); expect(mocks.invoke).toHaveBeenCalledTimes(signatures)
  items = [item({ remaining_quantity: 7, stock_version: 3 })]
  await act(async () => { await client.invalidateQueries({ queryKey: ['promotions'] }) }); await tick()
  expect(screen.getByText('Stok tersedia: 7')).toBeTruthy(); expect(screen.getByRole('img')).toBeTruthy()
})

test('background prefix refresh retains the mounted image while newer stock is pending', async () => {
  mount(); await tick(); const image = screen.getByRole('img'), pending = deferred<ReturnType<typeof reply>>()
  mocks.rpc.mockImplementationOnce(() => request(pending.promise))
  await act(async () => { void client.invalidateQueries({ queryKey: ['promotions'] }) }); await tick()
  expect(screen.getByText('Memperbarui highlight…')).toBeTruthy()
  expect(screen.getByRole('img')).toBe(image); expect(image.isConnected).toBe(true)
  await act(async () => { pending.resolve(reply()) }); await tick()
  expect(screen.getByRole('img')).toBe(image); expect(mocks.invoke).toHaveBeenCalledOnce()
})

test('foreground polling refreshes other-actor stock without image unmount or signing churn', async () => {
  mount(); await tick(); const image = screen.getByRole('img'), pending = deferred<ReturnType<typeof reply>>()
  mocks.rpc.mockImplementationOnce(() => request(pending.promise))
  await tick(30_000)
  expect(screen.getByText('Memperbarui highlight…')).toBeTruthy()
  expect(screen.getByText('Stok tersedia: 3')).toBeTruthy()
  expect(screen.getByRole('img')).toBe(image); expect(image.isConnected).toBe(true)
  expect(mocks.invoke).toHaveBeenCalledOnce()
  items = [item({ remaining_quantity: 2, stock_version: 2 })]
  await act(async () => { pending.resolve(reply()) }); await tick()
  expect(screen.getByText('Stok tersedia: 2')).toBeTruthy(); expect(screen.getByRole('img')).toBe(image)
  expect(screen.queryByText('Memperbarui highlight…')).toBeNull(); expect(mocks.invoke).toHaveBeenCalledOnce()
  items = [item({ remaining_quantity: 0, stock_version: 3 })]; await tick(30_000)
  expect(screen.queryByText('Tiles')).toBeNull(); expect(screen.queryByRole('img')).toBeNull()
})

test('hidden pages do not poll and refocus updates exhausted stock', async () => {
  mount(); await tick(); const reads = mocks.rpc.mock.calls.length
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  await act(async () => { window.dispatchEvent(new Event('visibilitychange')) })
  items = [item({ remaining_quantity: 0, stock_version: 2 })]
  await tick(90_000); expect(mocks.rpc).toHaveBeenCalledTimes(reads)
  visibility.mockReturnValue('visible')
  await act(async () => { window.dispatchEvent(new Event('visibilitychange')) }); await tick()
  expect(screen.queryByText('Tiles')).toBeNull(); expect(screen.getByText('Belum ada product highlight aktif.')).toBeTruthy()
})

test('reconnect fetches changed stock without navigation', async () => {
  mount(); await tick(); await act(async () => { onlineManager.setOnline(false) })
  items = [item({ remaining_quantity: 9, stock_version: 2 })]
  await act(async () => { onlineManager.setOnline(true) }); await tick()
  expect(screen.getByText('Stok tersedia: 9')).toBeTruthy()
})

test('initial loading differs from verified empty stock and errors hide stale quantities until retry', async () => {
  const pending = deferred<ReturnType<typeof reply>>()
  mocks.rpc.mockImplementationOnce(() => request(pending.promise)); mount()
  expect(screen.getByText('Memuat highlight…')).toBeTruthy(); expect(screen.queryByText('Belum ada product highlight aktif.')).toBeNull()
  await act(async () => { pending.resolve(reply()) }); await tick()
  expect(screen.getByText('Stok tersedia: 3')).toBeTruthy()
  mocks.rpc.mockImplementationOnce(() => request(Promise.resolve({ data: null, error: { message: 'Read failed' } })))
  await act(async () => { await client.invalidateQueries({ queryKey: ['promotions'] }) }); await tick()
  expect(screen.getByRole('alert')).toBeTruthy(); expect(screen.queryByText('Stok tersedia: 3')).toBeNull(); expect(screen.queryByRole('img')).toBeNull()
  items = []; fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' })); await tick()
  expect(screen.queryByRole('alert')).toBeNull(); expect(screen.getByText('Belum ada product highlight aktif.')).toBeTruthy()
})

test.each(['loading', 'inactive', 'mismatch', 'error', 'signed-out'])('unverified %s identity cannot read or reuse a previous actor highlight', async state => {
  const view = mount(); await tick(); expect(screen.getByRole('img')).toBeTruthy()
  const reads = mocks.rpc.mock.calls.length, signatures = mocks.invoke.mock.calls.length
  if (state === 'loading') mocks.auth.loading = true
  if (state === 'inactive') mocks.auth.profile.is_active = false
  if (state === 'mismatch') mocks.auth.profile.id = otherPromotion
  if (state === 'error') mocks.auth.error = 'Identity unavailable'
  if (state === 'signed-out') mocks.auth.user = null
  view.rerender(<QueryClientProvider client={client}><ActivePromotionsBanner /></QueryClientProvider>); await tick(30_000)
  expect(screen.queryByText('Tiles')).toBeNull(); expect(screen.queryByRole('img')).toBeNull()
  expect(mocks.rpc).toHaveBeenCalledTimes(reads); expect(mocks.invoke).toHaveBeenCalledTimes(signatures)
})
