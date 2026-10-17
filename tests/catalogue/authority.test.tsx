import React, { useLayoutEffect } from 'react'
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useCatalogueAccess } from '../../src/lib/catalogue/useCatalogueAccess'
import { createCatalogueTransactionSender } from '../../src/lib/catalogue/transactions'
import { catalogueKeys } from '../../src/lib/catalogue/queryKeys'
const actor = '00000000-0000-4000-8000-000000000001'
const identity = { backend: 'https://catalogue.example.invalid', actorId: actor, role: 'co_admin' as const }
const access = { version: 2, as_of: '2026-10-14T05:00:00Z', actor_id: actor, role: 'co_admin', customer_create: true, customer_edit: true, customer_delete: true, product_create: true, product_edit: true, product_delete: true, customer_set_enabled: true, product_set_enabled: true, customer_delete_mode: 'guarded', product_delete_mode: 'guarded' }
const binding = { operation: 'create' as const, kind: 'product' as const }
const deferred = () => { let resolve!: (value: any) => void; return { promise: new Promise<any>(yes => { resolve = yes }), resolve: (value: any) => resolve(value) } }
function setup() {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }), rpc = vi.fn(async () => ({ data: access, error: null })), transport = { backend: identity.backend, rpc }
 const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
 const hook = renderHook(({ scope }) => useCatalogueAccess({ identity: scope, transport }), { wrapper, initialProps: { scope: identity as typeof identity | null } })
 return { ...hook, client, rpc, transport }
}
afterEach(() => { focusManager.setFocused(undefined); onlineManager.setOnline(true) })
test('requires exact fresh v2 authority and rechecks binding before each mutation', async () => {
 const r = setup(); expect(r.result.current.ready).toBe(false); expect(() => r.result.current.require(binding)).toThrow()
 await waitFor(() => expect(r.result.current.ready).toBe(true)); expect(r.result.current.isCurrent()).toBe(true)
 await act(async () => { expect(await r.result.current.authorize(binding)).toEqual(access) }); expect(r.rpc).toHaveBeenCalledTimes(2)
 r.rpc.mockResolvedValue({ data: { ...access, product_create: false }, error: null })
 await act(async () => { await expect(r.result.current.authorize(binding)).rejects.toThrow() }); expect(() => r.result.current.require(binding)).toThrow()
})
test('aborted refetch cannot authorize via reverted previously successful cache data', async () => {
 const r = setup(); await waitFor(() => expect(r.result.current.ready).toBe(true))
 const response = deferred(); r.rpc.mockImplementation(() => response.promise)
 let pending!: Promise<unknown>; act(() => { pending = r.result.current.refetch() }); await waitFor(() => expect(r.rpc).toHaveBeenCalledTimes(2))
 await act(async () => { await r.client.cancelQueries({ queryKey: catalogueKeys.authority(identity) }) })
 expect(r.client.getQueryData(catalogueKeys.authority(identity))).toEqual(access)
 expect(r.result.current.ready).toBe(false); expect(r.result.current.isCurrent()).toBe(false); expect(() => r.result.current.require(binding)).toThrow()
 await act(async () => { response.resolve({ data: access, error: null }); await pending }); expect(r.result.current.ready).toBe(false)
})
test('unmounted, missing identity, stale actor and backend requests never authorize', async () => {
 const r = setup(); await waitFor(() => expect(r.result.current.ready).toBe(true)); const oldRequire = r.result.current.require, oldAuthorize = r.result.current.authorize
 r.rerender({ scope: null }); expect(r.result.current.ready).toBe(false); expect(() => oldRequire(binding)).toThrow(); await expect(oldAuthorize(binding)).rejects.toThrow()
 r.rerender({ scope: { ...identity, actorId: '00000000-0000-4000-8000-000000000002' } }); await waitFor(() => expect(r.result.current.isError).toBe(true)); expect(r.result.current.ready).toBe(false)
 r.rerender({ scope: { ...identity, backend: 'https://other.example.invalid' } }); await waitFor(() => expect(r.result.current.isError).toBe(true)); expect(r.result.current.ready).toBe(false)
 const check = r.result.current.isCurrent; r.unmount(); expect(check()).toBe(false)
})
test('focus and reconnect perform fresh v2 reads and never use malformed flags', async () => {
 const r = setup(); await waitFor(() => expect(r.result.current.ready).toBe(true))
 await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true) }); await waitFor(() => expect(r.rpc).toHaveBeenCalledTimes(2))
 await act(async () => { onlineManager.setOnline(false); onlineManager.setOnline(true) }); await waitFor(() => expect(r.rpc).toHaveBeenCalledTimes(3))
 r.rpc.mockResolvedValue({ data: { ...access, version: 1 }, error: null }); await act(async () => { await r.result.current.refetch() }); expect(r.result.current.ready).toBe(false)
})

test('a late authority completion cannot replace the current actor/backend epoch', async () => {
 const r = setup(); await waitFor(() => expect(r.result.current.ready).toBe(true))
 const response = deferred(); r.rpc.mockImplementationOnce(() => response.promise)
 let pending!: Promise<unknown>; act(() => { pending = r.result.current.refetch() }); await waitFor(() => expect(r.rpc).toHaveBeenCalledTimes(2))
 const oldCurrent = r.result.current.isCurrent
 r.rerender({ scope: { ...identity, actorId: '00000000-0000-4000-8000-000000000002' } })
 await waitFor(() => expect(r.result.current.isError).toBe(true))
 await act(async () => { response.resolve({ data: access, error: null }); await pending })
 expect(oldCurrent()).toBe(false); expect(r.result.current.ready).toBe(false); expect(r.result.current.isCurrent()).toBe(false)
})

test('a newly mounted owner cannot inherit a previous accepted epoch before a fresh completion', async () => {
 const r = setup(); await waitFor(() => expect(r.result.current.ready).toBe(true))
 let inherited = false
 const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={r.client}>{children}</QueryClientProvider>
 const next = renderHook(() => {
   const access = useCatalogueAccess({ identity, transport: r.transport })
   useLayoutEffect(() => { try { access.require(binding); inherited = true } catch { /* expected refusal */ } }, [])
   return access
 }, { wrapper })
 expect(inherited).toBe(false)
 await waitFor(() => expect(next.result.current.ready).toBe(true))
 next.unmount()
})

test('old owner callbacks never revive after identity A-null-A', async () => {
 const r = setup(); await waitFor(() => expect(r.result.current.ready).toBe(true))
 const oldCurrent = r.result.current.isCurrent, oldRequire = r.result.current.require, oldAuthorize = r.result.current.authorize
 r.rerender({ scope: null }); expect(oldCurrent()).toBe(false)
 r.rerender({ scope: identity }); await waitFor(() => expect(r.result.current.ready).toBe(true))
 expect(oldCurrent()).toBe(false); expect(() => oldRequire(binding)).toThrow()
 const calls = r.rpc.mock.calls.length; await expect(oldAuthorize(binding)).rejects.toThrow(); expect(r.rpc).toHaveBeenCalledTimes(calls)
 expect(r.result.current.isCurrent()).toBe(true)
})

test('old owner callbacks never revive after transport A-B-A', async () => {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
 const transport = { backend: identity.backend, rpc: vi.fn(async () => ({ data: access, error: null })) }
 const other = { backend: identity.backend, rpc: vi.fn(async () => ({ data: access, error: null })) }
 const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
 const r = renderHook(({ source }) => useCatalogueAccess({ identity, transport: source }), { wrapper, initialProps: { source: transport } })
 await waitFor(() => expect(r.result.current.ready).toBe(true)); const oldCurrent = r.result.current.isCurrent, oldAuthorize = r.result.current.authorize
 r.rerender({ source: other }); await act(async () => { await r.result.current.refetch() })
 r.rerender({ source: transport }); await act(async () => { await r.result.current.refetch() }); await waitFor(() => expect(r.result.current.ready).toBe(true))
 expect(oldCurrent()).toBe(false); await expect(oldAuthorize(binding)).rejects.toThrow()
})

test('sender waiting for a lock cannot dispatch after its owner leaves and returns', async () => {
 const r = setup(); await waitFor(() => expect(r.result.current.ready).toBe(true))
 const held = deferred(), entered = deferred(), command = vi.fn(async () => ({ data: null, error: null }))
 const sender = createCatalogueTransactionSender({ ...identity, role: 'co_admin', scope: 'owner-aba-dialog', storage: () => localStorage,
   authorize: r.result.current.authorize, isCurrent: r.result.current.isCurrent }, {
   backend: identity.backend, rpc: command,
   async withExclusiveLock(_key, action) { entered.resolve(undefined); await held.promise; return action() },
 })
 const pending = sender('create', { kind: 'product', values: { name: 'Fictional product', sku: 'ABA', size: null, harga_pokok: null, luar_kota: null, dalam_kota: null, depo_bangunan: null } })
 await entered.promise
 r.rerender({ scope: null }); r.rerender({ scope: identity }); await waitFor(() => expect(r.result.current.ready).toBe(true))
 held.resolve(undefined); await expect(pending).rejects.toThrow(); expect(command).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0)
})

test('StrictMode remount obtains current authority without reviving retired callbacks', async () => {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }), transport = { backend: identity.backend, rpc: vi.fn(async () => ({ data: access, error: null })) }
 const retired: (() => boolean)[] = []
 const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
 const r = renderHook(() => {
   const authority = useCatalogueAccess({ identity, transport })
   useLayoutEffect(() => { retired.push(authority.isCurrent) }, [])
   return authority
 }, { wrapper, reactStrictMode: true })
 await waitFor(() => expect(r.result.current.ready).toBe(true))
 expect(retired.length).toBeGreaterThanOrEqual(2); expect(retired[0]()).toBe(false)
})
