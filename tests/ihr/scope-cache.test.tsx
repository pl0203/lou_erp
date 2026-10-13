import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import type { LeaveContext } from '../../src/lib/leave/contracts'
import { employeeA, employeeB } from './fixtures'
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), auth: { user: { id: '71000000-0000-0000-0000-000000000001' }, profile: { id: '71000000-0000-0000-0000-000000000001', is_active: true }, loading: false } }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => mocks.auth }))
import { leaveKeys, createLeaveKeys, synchronizeLeaveScope } from '../../src/lib/leave/queryKeys'
import { useLeaveContext, runLeaveInteraction } from '../../src/lib/leave/useLeaveContext'
const context = (scopeVersion: string): LeaveContext => ({ scopeVersion, memberKind: 'employee', timezone: null, balances: [], capabilities: { request: true, approve: false, configure: false, adjust: false, readPrivate: false, manageAccess: false }, setup: { ready: false, blockers: [] } })
const clients: QueryClient[] = []
function client() { const q = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(q); return q }
function Probe() { const q = useLeaveContext(); return <output>{q.isError ? 'denied' : q.data?.scopeVersion ?? 'waiting'}</output> }
function reply(scope: string) { return { abortSignal: () => Promise.resolve({ data: context(scope), error: null }) } }
beforeEach(() => { mocks.rpc.mockReset(); mocks.rpc.mockReturnValue(reply('scope-1')); mocks.auth.user = { id: employeeA }; mocks.auth.profile = { id: employeeA, is_active: true } })
afterEach(() => { cleanup(); clients.splice(0).forEach(q => q.clear()); vi.useRealTimers() })
test('keys distinguish backend, identity, scope and filters/range', () => {
  expect(createLeaveKeys('backend-a').context(employeeA, '1')).not.toEqual(createLeaveKeys('backend-b').context(employeeA, '1'))
  expect(leaveKeys.context(employeeA, '1')).not.toEqual(leaveKeys.context(employeeB, '1'))
  expect(leaveKeys.private(employeeA, '1', 'detail', 'a')).not.toEqual(leaveKeys.private(employeeA, '2', 'detail', 'a'))
  expect(leaveKeys.private(employeeA, '1', 'list', { page: 1 })).not.toEqual(leaveKeys.private(employeeA, '1', 'list', { page: 2 }))
})
test('genuine scope change purges cached rows and aborts pending work, preventing late publication', async () => {
  const q = client(), oldScopeKey = leaveKeys.private(employeeA, 'one', 'cached'), pendingKey = leaveKeys.private(employeeA, 'one', 'pending')
  q.setQueryData(oldScopeKey, ['private'])
  let resolve!: (v: string[]) => void, signal!: AbortSignal
  const pending = q.fetchQuery({ queryKey: pendingKey, queryFn: ({ signal: s }) => { signal = s; return new Promise<string[]>(r => { resolve = r }) } }).catch(() => undefined)
  synchronizeLeaveScope(q, employeeA, 'two')
  expect(q.getQueryData(oldScopeKey)).toBeUndefined(); expect(signal.aborted).toBe(true)
  resolve(['late']); await pending; expect(q.getQueryData(pendingKey)).toBeUndefined()
})
test('account transition purges old rows and ignores an old context response', async () => {
  const q = client(); let resolve!: (v: unknown) => void
  mocks.rpc.mockReturnValueOnce({ abortSignal: () => new Promise(r => { resolve = r }) })
  const view = render(<QueryClientProvider client={q}><Probe /></QueryClientProvider>)
  const oldScopeKey = leaveKeys.private(employeeA, 'old', 'detail'); q.setQueryData(oldScopeKey, ['old person'])
  mocks.auth.user = { id: employeeB }; mocks.auth.profile = { id: employeeB, is_active: true }
  view.rerender(<QueryClientProvider client={q}><Probe /></QueryClientProvider>); await screen.findByText('scope-1')
  await act(async () => { resolve({ data: context('old-account'), error: null }); await Promise.resolve() })
  expect(q.getQueryData(oldScopeKey)).toBeUndefined(); expect(q.getQueryData(leaveKeys.context(employeeA, 'current'))).toBeUndefined(); expect(screen.queryByText('old-account')).toBeNull()
})
test.each(['scope', 'failure'])('foreground %s revalidation cancels cached and in-flight private data', async mode => {
  const q = client(); render(<QueryClientProvider client={q}><Probe /></QueryClientProvider>); await screen.findByText('scope-1')
  const key = leaveKeys.private(employeeA, 'scope-1', 'cached'), pendingKey = leaveKeys.private(employeeA, 'scope-1', 'pending'); q.setQueryData(key, ['secret'])
  let signal!: AbortSignal, resolve!: (value: string[]) => void
  const pending = q.fetchQuery({ queryKey: pendingKey, queryFn: ({ signal: s }) => { signal = s; return new Promise<string[]>(r => { resolve = r }) } }).catch(() => undefined)
  mocks.rpc.mockReturnValue(mode === 'scope' ? reply('scope-2') : { abortSignal: () => Promise.resolve({ data: null, error: { code: '42501' } }) })
  act(() => window.dispatchEvent(new Event('focus'))); await screen.findByText(mode === 'scope' ? 'scope-2' : 'denied')
  expect(q.getQueryData(key)).toBeUndefined(); expect(signal.aborted).toBe(true)
  resolve(['late']); await pending; expect(q.getQueryData(pendingKey)).toBeUndefined()
})
test('second same-identity observer preserves current cached and in-flight queries and their active observers', async () => {
  const q = client(), view = render(<QueryClientProvider client={q}><Probe key="one" /></QueryClientProvider>); await screen.findByText('scope-1')
  const cachedKey = leaveKeys.private(employeeA, 'scope-1', 'cached'), pendingKey = leaveKeys.private(employeeA, 'scope-1', 'pending'); q.setQueryData(cachedKey, ['cached'])
  const cached = new QueryObserver(q, { queryKey: cachedKey, queryFn: async () => ['wrong'], staleTime: Infinity })
  let signal!: AbortSignal, resolve!: (value: string[]) => void
  const pending = new QueryObserver(q, { queryKey: pendingKey, queryFn: ({ signal: s }) => { signal = s; return new Promise<string[]>(r => { resolve = r }) } })
  const offCached = cached.subscribe(() => {}), offPending = pending.subscribe(() => {})
  try {
    const original = q.getQueryCache().find({ queryKey: cachedKey, exact: true })
    view.rerender(<QueryClientProvider client={q}><Probe key="one" /><Probe key="two" /></QueryClientProvider>)
    expect(q.getQueryData(cachedKey)).toEqual(['cached']); expect(signal.aborted).toBe(false)
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2)); await screen.findAllByText('scope-1')
    expect(q.getQueryCache().find({ queryKey: cachedKey, exact: true })).toBe(original); expect(signal.aborted).toBe(false)
    await act(async () => { resolve(['complete']); await Promise.resolve() }); await waitFor(() => expect(pending.getCurrentResult().data).toEqual(['complete']))
    q.setQueryData(cachedKey, ['updated']); expect(cached.getCurrentResult().data).toEqual(['updated'])
    view.rerender(<QueryClientProvider client={q}><Probe key="two" /></QueryClientProvider>)
    expect(q.getQueryData(leaveKeys.context(employeeA, 'current'))).toEqual(context('scope-1'))
  } finally { offCached(); offPending() }
})
test('foreground polling is bounded to sixty seconds', async () => {
  vi.useFakeTimers(); const q = client(); render(<QueryClientProvider client={q}><Probe /></QueryClientProvider>)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) }); mocks.rpc.mockReturnValue(reply('scope-2'))
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000) }); expect(q.getQueryData<LeaveContext>(leaveKeys.context(employeeA, 'current'))?.scopeVersion).toBe('scope-2')
})
test('hidden polling stops and returning visible revalidates', async () => {
  vi.useFakeTimers(); const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden'), q = client()
  render(<QueryClientProvider client={q}><Probe /></QueryClientProvider>); await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  const before = mocks.rpc.mock.calls.length; await act(async () => { await vi.advanceTimersByTimeAsync(120_000) }); expect(mocks.rpc).toHaveBeenCalledTimes(before)
  mocks.rpc.mockReturnValue(reply('scope-2')); visibility.mockReturnValue('visible')
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(1) })
  expect(q.getQueryData<LeaveContext>(leaveKeys.context(employeeA, 'current'))?.scopeVersion).toBe('scope-2'); visibility.mockRestore()
})
test('interaction revalidates before acting and rejects changed scope', async () => {
  const q = client(), action = vi.fn(); mocks.rpc.mockReturnValue(reply('scope-2'))
  await expect(runLeaveInteraction(q, employeeA, 'scope-1', action)).rejects.toThrow(/berubah/); expect(action).not.toHaveBeenCalled()
  await runLeaveInteraction(q, employeeA, 'scope-2', action); expect(action).toHaveBeenCalledWith(context('scope-2'))
})
test('inactive identities cannot issue context calls', () => { mocks.auth.profile.is_active = false; render(<QueryClientProvider client={client()}><Probe /></QueryClientProvider>); expect(mocks.rpc).not.toHaveBeenCalled() })
test('StrictMode remains usable', async () => { const { StrictMode } = await import('react'); render(<StrictMode><QueryClientProvider client={client()}><Probe /></QueryClientProvider></StrictMode>); expect(await screen.findByText('scope-1')).toBeTruthy() })
