import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), raw: vi.fn(), auth: {} as any }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { functions: { invoke: mocks.invoke }, from: mocks.raw, storage: { from: mocks.raw } } }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => mocks.auth }))
import PromotionImage from '../../src/components/PromotionImage'
import type { ActivePromotion } from '../../src/lib/promotions'

const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', nextActor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', promotionId = '11111111-1111-4111-8111-111111111111'
const path = `promotions/${actor}/${promotionId}/22222222-2222-4222-8222-222222222222.png`
const initialUrl = 'https://example.invalid/storage/v1/object/sign/promotion-images/image?token=first-private'
const renewedUrl = 'https://example.invalid/storage/v1/object/sign/promotion-images/image?token=renewed-private'
const item = (changes: Partial<ActivePromotion> = {}): ActivePromotion => ({ id: promotionId, product_id: promotionId, product_name: 'Tiles', sku: 'SKU', size: null, products: { name: 'Tiles', sku: 'SKU', size: null }, start_date: '2020-01-01', end_date: '2020-01-02', is_active: true, stock_managed: true, remaining_quantity: 3, stock_version: 1, image_path: path, harga_pokok: null, luar_kota: 0, dalam_kota: 71, depo_bangunan: null, ...changes })
const signed = (url = initialUrl) => ({ data: { promotion_id: promotionId, signed_url: url, expires_in: 300 }, error: null })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
let client: QueryClient
async function tick(ms = 1) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
function tree(promotion = item()) { return <QueryClientProvider client={client}><PromotionImage promotion={promotion} /></QueryClientProvider> }
function mount(promotion = item()) { return render(tree(promotion)) }

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T12:00:00Z'))
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  focusManager.setFocused(undefined); onlineManager.setOnline(true)
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  mocks.auth = { user: { id: actor }, profile: { id: actor, role: 'sales_person', is_active: true }, loading: false, error: null }
  mocks.invoke.mockReset().mockResolvedValue(signed())
  mocks.raw.mockReset().mockImplementation(() => { throw new Error('Raw image access is forbidden') })
  localStorage.clear()
})
afterEach(() => { cleanup(); client.clear(); vi.useRealTimers(); focusManager.setFocused(undefined); onlineManager.setOnline(true) })

test('absent linkage is truthful and never requests an invented image', async () => {
  mount(item({ stock_managed: false, remaining_quantity: null, image_path: null })); await tick()
  expect(screen.getByText('Gambar belum tersedia')).toBeTruthy(); expect(mocks.invoke).not.toHaveBeenCalled()
})

test('canonical linked image loads through the fixed private signer without raw access or persistence', async () => {
  const pending = deferred<ReturnType<typeof signed>>(); mocks.invoke.mockReturnValueOnce(pending.promise); mount()
  expect(screen.getByText('Memuat gambar…')).toBeTruthy(); expect(screen.queryByRole('img')).toBeNull()
  await act(async () => { pending.resolve(signed()) }); await tick()
  expect(screen.getByRole('img', { name: 'Promosi Tiles' }).getAttribute('src')).toBe(initialUrl)
  expect(mocks.invoke).toHaveBeenCalledWith('promotion-image-url', { body: { promotion_id: promotionId } })
  expect(mocks.raw).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0)
})

test.each(['network', 'denied', 'wrong-promotion', 'wrong-ttl', 'unsafe-url'])('%s signer outcome uses safe fallback and one manual retry', async outcome => {
  if (outcome === 'network') mocks.invoke.mockRejectedValueOnce(new Error('Network failed'))
  else if (outcome === 'denied') mocks.invoke.mockResolvedValueOnce({ data: null, error: { message: 'Denied' } })
  else mocks.invoke.mockResolvedValueOnce({ data: { ...signed().data, ...(outcome === 'wrong-promotion' ? { promotion_id: nextActor } : outcome === 'wrong-ttl' ? { expires_in: 301 } : { signed_url: 'javascript:unsafe' }) }, error: null })
  mount(); await tick()
  expect(screen.getByText('Gambar belum dapat dimuat.')).toBeTruthy(); expect(screen.queryByRole('img')).toBeNull()
  await tick(1_000); expect(mocks.invoke).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Coba gambar lagi' })); await tick()
  expect(screen.getByRole('img').getAttribute('src')).toBe(initialUrl); expect(mocks.invoke).toHaveBeenCalledTimes(2)
  expect(mocks.raw).not.toHaveBeenCalled()
})

test('expired DOM image failure recovers after manual canonical renewal', async () => {
  mount(); await tick(); fireEvent.error(screen.getByRole('img'))
  expect(screen.getByText('Gambar belum dapat dimuat.')).toBeTruthy()
  mocks.invoke.mockResolvedValueOnce(signed(renewedUrl))
  fireEvent.click(screen.getByRole('button', { name: 'Coba gambar lagi' })); await tick()
  expect(screen.getByRole('img').getAttribute('src')).toBe(renewedUrl)
  expect(mocks.invoke).toHaveBeenCalledTimes(2)
})

test.each([renewedUrl, initialUrl])('a successful four-minute renewal clears the prior DOM failure even for URL %s', async url => {
  mount(); await tick(); fireEvent.error(screen.getByRole('img'))
  expect(screen.queryByRole('img')).toBeNull()
  mocks.invoke.mockResolvedValueOnce(signed(url)); await tick(240_000)
  expect(screen.getByRole('img').getAttribute('src')).toBe(url)
  expect(mocks.invoke).toHaveBeenCalledTimes(2)
})

test('pending renewal hides the cached URL and rejected authorization cannot revive it', async () => {
  mount(); await tick(); const pending = deferred<ReturnType<typeof signed>>()
  mocks.invoke.mockReturnValueOnce(pending.promise); await tick(240_000)
  expect(screen.getByText('Memuat gambar…')).toBeTruthy(); expect(screen.queryByRole('img')).toBeNull()
  await act(async () => { pending.resolve({ data: null, error: { message: 'Current authorization denied' } } as any) }); await tick()
  expect(screen.getByText('Gambar belum dapat dimuat.')).toBeTruthy(); expect(screen.queryByRole('img')).toBeNull()
  // An earlier URL remains a provider bearer capability until expiry; this UI neither displays nor revokes it.
  expect(mocks.invoke).toHaveBeenCalledTimes(2); expect(mocks.raw).not.toHaveBeenCalled()
})

test('after a hidden sleep beyond five minutes, refocus reauthorizes before displaying an old URL', async () => {
  mount(); await tick(); const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  await act(async () => { window.dispatchEvent(new Event('visibilitychange')) }); await tick(301_000)
  expect(mocks.invoke).toHaveBeenCalledOnce()
  const pending = deferred<ReturnType<typeof signed>>(); mocks.invoke.mockReturnValueOnce(pending.promise)
  visibility.mockReturnValue('visible'); await act(async () => { window.dispatchEvent(new Event('visibilitychange')) }); await tick()
  expect(screen.queryByRole('img')).toBeNull(); expect(screen.getByText('Memuat gambar…')).toBeTruthy()
  await act(async () => { pending.resolve(signed(renewedUrl)) }); await tick()
  expect(screen.getByRole('img').getAttribute('src')).toBe(renewedUrl)
})

test('a stale cached image cannot display when remount revalidation is paused offline', async () => {
  const view = mount(); await tick(); view.unmount()
  await act(async () => { onlineManager.setOnline(false) }); await tick(301_000)
  mount(); await tick()
  expect(screen.queryByRole('img')).toBeNull(); expect(screen.getByText('Memuat gambar…')).toBeTruthy()
  mocks.invoke.mockResolvedValueOnce(signed(renewedUrl))
  await act(async () => { onlineManager.setOnline(true) }); await tick()
  expect(screen.getByRole('img').getAttribute('src')).toBe(renewedUrl)
})

test('path replacement cannot inherit an old render error or display its prior signed URL', async () => {
  const view = mount(); await tick(); const previous = screen.getByRole('img')
  // React 19's installed DOM props retain the exact callback from this response.
  // Dispatch on a detached node would not exercise a late callback at all.
  const propsKey = Object.keys(previous).find(key => key.startsWith('__reactProps$'))!
  expect(propsKey).toBeTruthy()
  const lateError = vi.fn((previous as any)[propsKey].onError)
  expect(lateError.getMockImplementation()).toBeTypeOf('function')
  fireEvent.error(previous)
  const pending = deferred<ReturnType<typeof signed>>(); mocks.invoke.mockReturnValueOnce(pending.promise)
  view.rerender(tree(item({ image_path: path.replace('22222222', '33333333') }))); await tick()
  expect(screen.queryByRole('img')).toBeNull()
  await act(async () => { pending.resolve(signed(renewedUrl)) }); await tick()
  expect(screen.getByRole('img').getAttribute('src')).toBe(renewedUrl)
  await act(async () => { lateError() }); await tick()
  expect(lateError).toHaveBeenCalledOnce()
  expect(screen.getByRole('img').getAttribute('src')).toBe(renewedUrl)
})

test('actor and role changes cannot reuse a previous actor URL or render failure', async () => {
  const view = mount(); await tick(); fireEvent.error(screen.getByRole('img'))
  mocks.auth = { ...mocks.auth, user: { id: nextActor }, profile: { id: nextActor, role: 'sales_manager', is_active: true } }
  const pending = deferred<ReturnType<typeof signed>>(); mocks.invoke.mockReturnValueOnce(pending.promise)
  view.rerender(tree()); await tick(); expect(screen.queryByRole('img')).toBeNull()
  await act(async () => { pending.resolve(signed(renewedUrl)) }); await tick()
  expect(screen.getByRole('img').getAttribute('src')).toBe(renewedUrl)
  expect(mocks.invoke).toHaveBeenCalledTimes(2)
  mocks.auth.loading = true; view.rerender(tree()); await tick(240_000)
  expect(screen.queryByRole('img')).toBeNull(); expect(mocks.invoke).toHaveBeenCalledTimes(2)
})
