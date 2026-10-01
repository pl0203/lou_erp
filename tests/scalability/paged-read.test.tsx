import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { usePagedRead } from '../../src/lib/reads/usePagedRead'

const identity = vi.hoisted(() => ({ id: 'first-user', role: 'sales_manager' }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: identity }) }))
const clients: QueryClient[] = []
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); identity.id = 'first-user' })
const pageResult = (page: number, total = 21, name = `page ${page}`) => ({ version: 1 as const, as_of: '2026-10-01T00:00:00Z', items: [{ id: `${page}`, name }], page, page_size: 10, total })
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); clients.push(client)
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }

test('changing filters resets the page in the same query and excludes obsolete responses', async () => {
  const pending = deferred<ReturnType<typeof pageResult>>()
  const calls: { search: string; page: number; signal: AbortSignal }[] = []
  const fetcher = async (filters: { search: string }, page: number, signal: AbortSignal) => {
    calls.push({ ...filters, page, signal })
    if (filters.search === 'old' && page === 2) return pending.promise
    return pageResult(page, 21, filters.search)
  }
  const { result } = renderHook(() => usePagedRead('paged', { search: 'old' }, fetcher), { wrapper: wrapper() })
  await waitFor(() => expect(result.current.data?.items[0].name).toBe('old'))
  act(() => result.current.setPage(2))
  await waitFor(() => expect(calls.length).toBe(2))
  expect(result.current.isPending).toBe(true)
  expect(result.current.data?.page).toBe(1)
  act(() => result.current.setFilters({ search: 'new' }))
  await waitFor(() => expect(result.current.data?.items[0].name).toBe('new'))
  expect(result.current.page).toBe(1)
  expect(calls.map(({ search, page }) => ({ search, page }))).toEqual([{ search: 'old', page: 1 }, { search: 'old', page: 2 }, { search: 'new', page: 1 }])
  expect(calls[1].signal.aborted).toBe(true)
  await act(async () => pending.resolve(pageResult(2, 21, 'obsolete')))
  expect(result.current.data?.items[0].name).toBe('new')
})
test('an emptied final page recovers to the actual final page after deletion', async () => {
  let total = 21
  const fetcher = async (_filters: {}, page: number) => ({ ...pageResult(page, total), items: page > Math.ceil(total / 10) ? [] : [{ id: `${page}`, name: `page ${page}` }] })
  const { result } = renderHook(() => usePagedRead('deleted', {}, fetcher), { wrapper: wrapper() })
  await waitFor(() => expect(result.current.isPending).toBe(false))
  act(() => result.current.setPage(3))
  await waitFor(() => expect(result.current.data?.page).toBe(3))
  total = 20
  await act(async () => { await result.current.refetch() })
  await waitFor(() => expect(result.current.data?.page).toBe(2))
  expect(result.current.page).toBe(2)
})
test('identity changes do not show private rows from the previous account', async () => {
  const pending = deferred<ReturnType<typeof pageResult>>()
  const fetcher = async () => identity.id === 'first-user' ? pageResult(1, 1, 'private old account') : pending.promise
  const { result, rerender } = renderHook(() => usePagedRead('identity', {}, fetcher), { wrapper: wrapper() })
  await waitFor(() => expect(result.current.data?.items[0].name).toBe('private old account'))
  identity.id = 'second-user'; rerender()
  expect(result.current.data).toBeUndefined()
  await act(async () => pending.resolve(pageResult(1, 1, 'new account')))
  await waitFor(() => expect(result.current.data?.items[0].name).toBe('new account'))
})
test('failed pages are errors rather than successful empty results', async () => {
  const { result } = renderHook(() => usePagedRead('failure', {}, async () => { throw new Error('RPC missing') }), { wrapper: wrapper() })
  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(result.current.data).toBeUndefined()
})

test('an unchanged debounced filter does not reset the current page', async () => {
  const { result } = renderHook(() => usePagedRead('unchanged', { search: '' }, async (_filters, page) => pageResult(page)), { wrapper: wrapper() })
  await waitFor(() => expect(result.current.isPending).toBe(false))
  act(() => result.current.setPage(2))
  await waitFor(() => expect(result.current.data?.page).toBe(2))
  act(() => result.current.setFilters(previous => previous))
  expect(result.current.page).toBe(2)
})

test('out-of-range responses are never displayed as a successful invalid page during recovery', async () => {
  const recovery = deferred<ReturnType<typeof pageResult>>()
  let total = 21
  const fetcher = async (_filters: {}, page: number) => total === 20 && page === 2 ? recovery.promise : ({ ...pageResult(page, total), items: page === 3 && total === 20 ? [] : [{ id: `${page}`, name: 'row' }] })
  const { result } = renderHook(() => usePagedRead('recovery', {}, fetcher), { wrapper: wrapper() })
  await waitFor(() => expect(result.current.isPending).toBe(false))
  act(() => result.current.setPage(3)); await waitFor(() => expect(result.current.data?.page).toBe(3))
  total = 20
  await act(async () => { await result.current.refetch() })
  await waitFor(() => expect(result.current.page).toBe(2))
  expect(result.current.isPending).toBe(true)
  expect(result.current.data).toBeUndefined()
  await act(async () => recovery.resolve(pageResult(2, 20)))
  await waitFor(() => expect(result.current.data?.page).toBe(2))
})
