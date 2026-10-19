import React from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { LocalDocument, ParsedPO } from '../src/lib/poImport/contracts'
import type { ImportContext } from '../src/lib/poImport/usePOImport'

const mocks = vi.hoisted(() => ({ actor: '11111111-1111-4111-8111-111111111111', rpc: vi.fn(), read: vi.fn(), parse: vi.fn() }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: mocks.actor }, profile: { id: mocks.actor, role: 'po_admin', is_active: true }, loading: false, error: null }) }))
vi.mock('../src/lib/supabase', () => ({ supabase: {
  supabaseUrl: 'https://catalogue.test', rest: { url: 'https://catalogue.test/rest/v1', schemaName: 'public' },
  rpc: (name: string, args: unknown) => { const request = { abortSignal: () => request, then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => mocks.rpc(name, args).then(resolve, reject) }; return request },
} }))
vi.mock('../src/lib/poImport/reader', () => ({ readPODocument: (...args: unknown[]) => mocks.read(...args) }))
vi.mock('../src/lib/poImport/parse', () => ({ parsePODocument: (...args: unknown[]) => mocks.parse(...args) }))
import { useCatalogueOrderOptions } from '../src/lib/catalogue/useCatalogueOrderOptions'
import { usePOImport } from '../src/lib/poImport/usePOImport'

const customer = { id: '22222222-2222-4222-8222-222222222222', name: 'Synthetic buyer', pricing_tier: 'luar_kota', address: null, city: null, phone: null, email: null, customer_category: null, is_enabled: true, catalog_version: '1' }
const product = { id: '33333333-3333-4333-8333-333333333333', name: 'Synthetic product', sku: 'SYN-1', size: 'pcs', unit_price: null, harga_pokok: 20, luar_kota: 125, dalam_kota: 40, depo_bangunan: null, is_enabled: true, catalog_version: '1' }
const field = (value: string | null) => ({ raw: value ?? '', value, page: 1 })
const parsed: ParsedPO = { version: 1, layout: 'photo-grid', complete: true, buyer: field(customer.name), supplier: field('Synthetic supplier'), poNumber: field('SYN-PO'), orderDate: field('2026-10-05'), expiry: field(null), delivery: field(null), paymentTerms: field(null), currency: field('IDR'), printedTotal: field('250'), priceBasis: 'gross', notes: '', rows: [{ id: 'r1', sku: field(product.sku), barcode: field(null), name: field(product.name), quantity: field('2'), unitPrice: field('125'), uom: field('pcs'), issues: [] }], issues: [] }
type PageArgs = { p_kind: string; p_purpose: string; p_status: string; p_search: string; p_page: number; p_page_size: number }
function page(args: PageArgs, rows: unknown[] = [args.p_kind === 'customer' ? customer : product]) {
  return { data: { version: 1, actor_id: mocks.actor, role: 'po_admin', kind: args.p_kind, purpose: args.p_purpose, status: args.p_status, search: args.p_search, page: args.p_page, page_size: args.p_page_size, total_count: String(rows.length), rows }, error: null }
}
const clients: QueryClient[] = []
let localDocument: LocalDocument
beforeEach(() => {
  mocks.actor = '11111111-1111-4111-8111-111111111111'
  mocks.rpc.mockReset().mockImplementation(async (_name, args) => page(args))
  localDocument = { pages: [], previews: [], dispose: vi.fn() }
  mocks.read.mockReset().mockResolvedValue(localDocument)
  mocks.parse.mockReset().mockReturnValue(parsed)
  focusManager.setFocused(undefined)
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); focusManager.setFocused(undefined) })
function mount() {
  const apply = vi.fn(), dirty = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client)
  const hook = renderHook(() => {
    const customers = useCatalogueOrderOptions('customer', 'enabled-for-order')
    const products = useCatalogueOrderOptions('product', 'enabled-for-order')
    // Match PONew's production boundary, including its empty-array fallback.
    const context: ImportContext = { customers: customers.data ?? [], products: products.data ?? [], actorKey: `${mocks.actor}:po_admin`, disabled: !customers.data || !products.data || customers.isError || products.isError || customers.isFetching || products.isFetching }
    return { customers, products, context, importer: usePOImport(context, apply, dirty) }
  }, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> })
  return { ...hook, apply, dirty }
}
async function review(hook: ReturnType<typeof mount>) {
  await waitFor(() => expect(hook.result.current.context.disabled).toBe(false))
  await act(async () => { await hook.result.current.importer.start(new File(['synthetic'], 'synthetic.png', { type: 'image/png' })) })
  expect(hook.result.current.importer.phase).toBe('review')
  act(() => { const decision = hook.result.current.importer.decision!; hook.result.current.importer.updateDecision({ ...decision, poNumber: 'USER-REVIEWED', rows: { r1: { ...decision.rows.r1, unitConfirmed: true } } }) })
}
function switchTab() {
  const visibility = vi.spyOn(document, 'visibilityState', 'get')
  act(() => { visibility.mockReturnValue('hidden'); window.dispatchEvent(new Event('visibilitychange')) })
  act(() => { visibility.mockReturnValue('visible'); window.dispatchEvent(new Event('visibilitychange')) })
}
function deferRefresh() {
  const pending: { args: PageArgs; resolve: (value: unknown) => void }[] = []
  mocks.rpc.mockImplementation((_name, args) => new Promise(resolve => pending.push({ args, resolve })))
  switchTab()
  return pending
}

test('real visibility refetch keeps the reviewed document while current options are unavailable, then resumes unchanged', async () => {
  const hook = mount(); await review(hook)
  const decision = hook.result.current.importer.decision
  const pending = deferRefresh()
  await waitFor(() => { expect(pending).toHaveLength(2); expect(hook.result.current.context.disabled).toBe(true) })
  expect(hook.result.current.customers.data).toBeUndefined()
  expect(hook.result.current.products.data).toBeUndefined()
  expect(hook.result.current.customers.getCurrentData()).toBeUndefined()
  expect(hook.result.current.products.getCurrentData()).toBeUndefined()
  expect(hook.result.current.importer.phase).toBe('review')
  expect(hook.result.current.importer.document).toBe(localDocument)
  expect(hook.result.current.importer.decision).toBe(decision)
  act(() => hook.result.current.importer.requestApply())
  expect(hook.apply).not.toHaveBeenCalled()
  expect(localDocument.dispose).not.toHaveBeenCalled()
  await act(async () => pending.forEach(item => item.resolve(page(item.args))))
  await waitFor(() => expect(hook.result.current.context.disabled).toBe(false))
  expect(hook.result.current.importer.phase).toBe('review')
  expect(hook.result.current.importer.decision).toBe(decision)
  act(() => hook.result.current.importer.requestApply())
  expect(hook.apply).toHaveBeenCalledTimes(1)
  let accepted: unknown
  act(() => { accepted = hook.apply.mock.calls[0][1]() })
  expect(accepted).toMatchObject({ poNumber: 'USER-REVIEWED', lineItems: [{ unit_price: 125, quantity: 2 }] })
  expect(localDocument.dispose).toHaveBeenCalledTimes(1)
})

test('a confirmation created before focus refresh stays invalid even after identical options return', async () => {
  const hook = mount(); await review(hook)
  act(() => hook.result.current.importer.requestApply())
  const oldAccept = hook.apply.mock.calls[0][1]
  const pending = deferRefresh()
  await waitFor(() => expect(hook.result.current.context.disabled).toBe(true))
  expect(oldAccept()).toBeNull()
  await act(async () => pending.forEach(item => item.resolve(page(item.args))))
  await waitFor(() => expect(hook.result.current.context.disabled).toBe(false))
  expect(oldAccept()).toBeNull()
  expect(hook.result.current.importer.phase).toBe('review')
})

test('a failed focus refresh retains local review but cannot apply stale options', async () => {
  const hook = mount(); await review(hook)
  mocks.rpc.mockRejectedValue(new Error('Synthetic read failure')); switchTab()
  await waitFor(() => expect(hook.result.current.products.isError).toBe(true))
  expect(hook.result.current.importer.phase).toBe('review')
  expect(hook.result.current.importer.decision?.poNumber).toBe('USER-REVIEWED')
  expect(localDocument.dispose).not.toHaveBeenCalled()
  act(() => hook.result.current.importer.requestApply())
  expect(hook.apply).not.toHaveBeenCalled()
})

test.each(['renamed', 'removed', 'price', 'customer-tier'])('a genuinely %s catalogue after refresh still invalidates and releases review', async change => {
  const hook = mount(); await review(hook)
  const pending = deferRefresh()
  await waitFor(() => expect(hook.result.current.context.disabled).toBe(true))
  await act(async () => pending.forEach(item => item.resolve(page(item.args, item.args.p_kind === 'customer'
    ? [{ ...customer, pricing_tier: change === 'customer-tier' ? 'dalam_kota' : customer.pricing_tier }]
    : change === 'removed' ? [] : [{ ...product, name: change === 'renamed' ? 'Updated product' : product.name, luar_kota: change === 'price' ? 130 : product.luar_kota }]))))
  await waitFor(() => expect(hook.result.current.context.disabled).toBe(false))
  expect(hook.result.current.importer.phase).toBe('error')
  expect(hook.result.current.importer.error).toContain('Katalog berubah')
  expect(localDocument.dispose).toHaveBeenCalledTimes(1)
  act(() => hook.result.current.importer.requestApply()); expect(hook.apply).not.toHaveBeenCalled()
})

test('actor change while options are unavailable still clears the old review and refuses its confirmation', async () => {
  const hook = mount(); await review(hook)
  act(() => hook.result.current.importer.requestApply())
  const oldAccept = hook.apply.mock.calls[0][1]
  deferRefresh(); await waitFor(() => expect(hook.result.current.context.disabled).toBe(true))
  mocks.actor = '44444444-4444-4444-8444-444444444444'; hook.rerender()
  expect(hook.result.current.importer.phase).toBe('idle')
  expect(hook.result.current.importer.document).toBeNull()
  expect(localDocument.dispose).toHaveBeenCalledTimes(1)
  expect(oldAccept()).toBeNull()
})

test('reordering unchanged catalogue arrays does not discard a reviewed document', async () => {
  const apply = vi.fn(), dirty = vi.fn()
  const context: ImportContext = { customers: [customer, { ...customer, id: 'other-customer', name: 'Other buyer' }], products: [product, { ...product, id: 'other-product', name: 'Other product', sku: 'OTHER' }], actorKey: 'actor:po_admin', disabled: false }
  const hook = renderHook(props => usePOImport(props, apply, dirty), { initialProps: context })
  await act(async () => { await hook.result.current.start(new File(['synthetic'], 'synthetic.png', { type: 'image/png' })) })
  const decision = hook.result.current.decision
  hook.rerender({ ...context, customers: [...context.customers].reverse(), products: [...context.products].reverse() })
  expect(hook.result.current.phase).toBe('review')
  expect(hook.result.current.decision).toBe(decision)
  expect(localDocument.dispose).not.toHaveBeenCalled()
})

test('a document finishing during focus refresh is retained for review without admitting stale options', async () => {
  const hook = mount()
  await waitFor(() => expect(hook.result.current.context.disabled).toBe(false))
  let finish!: (document: LocalDocument) => void
  mocks.read.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  let reading!: Promise<void>
  act(() => { reading = hook.result.current.importer.start(new File(['synthetic'], 'synthetic.png', { type: 'image/png' })) })
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  const pending = deferRefresh(); await waitFor(() => expect(hook.result.current.context.disabled).toBe(true))
  await act(async () => { finish(localDocument); await reading })
  expect(hook.result.current.importer.phase).toBe('review')
  expect(hook.result.current.importer.decision?.customerId).toBe(customer.id)
  expect(hook.result.current.importer.decision?.rows.r1.productId).toBe(product.id)
  expect(localDocument.dispose).not.toHaveBeenCalled()
  act(() => hook.result.current.importer.requestApply()); expect(hook.apply).not.toHaveBeenCalled()
  await act(async () => pending.forEach(item => item.resolve(page(item.args))))
  await waitFor(() => expect(hook.result.current.context.disabled).toBe(false))
  expect(hook.result.current.importer.phase).toBe('review')
})

test('cancelling a retained review during refresh disposes it and later responses cannot revive it', async () => {
  const hook = mount(); await review(hook)
  const pending = deferRefresh(); await waitFor(() => expect(hook.result.current.context.disabled).toBe(true))
  act(() => hook.result.current.importer.cancel())
  expect(hook.result.current.importer.phase).toBe('idle')
  expect(localDocument.dispose).toHaveBeenCalledTimes(1)
  await act(async () => pending.forEach(item => item.resolve(page(item.args))))
  await waitFor(() => expect(hook.result.current.context.disabled).toBe(false))
  expect(hook.result.current.importer.phase).toBe('idle')
  expect(hook.result.current.importer.document).toBeNull()
  expect(localDocument.dispose).toHaveBeenCalledTimes(1)
})

test('a late read cannot preserve a document across an actor change during unavailable options', async () => {
  const hook = mount()
  await waitFor(() => expect(hook.result.current.context.disabled).toBe(false))
  let finish!: (document: LocalDocument) => void
  mocks.read.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  let reading!: Promise<void>
  act(() => { reading = hook.result.current.importer.start(new File(['synthetic'], 'synthetic.png', { type: 'image/png' })) })
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  deferRefresh(); await waitFor(() => expect(hook.result.current.context.disabled).toBe(true))
  mocks.actor = '44444444-4444-4444-8444-444444444444'; hook.rerender()
  await act(async () => { finish(localDocument); await reading })
  expect(hook.result.current.importer.phase).toBe('idle')
  expect(hook.result.current.importer.document).toBeNull()
  expect(localDocument.dispose).toHaveBeenCalledTimes(1)
  expect(mocks.parse).not.toHaveBeenCalled()
})
