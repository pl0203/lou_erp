import { useLayoutEffect } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ actor: '11111111-1111-4111-8111-111111111111', role: 'sales_head', calls: vi.fn(), mode: 'legacy', source: null as any }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: state.actor }, profile: { id: state.actor, role: state.role, is_active: true }, loading: false, error: null }) }))
vi.mock('../../src/lib/supabase', () => {
  const source = { supabaseUrl: 'https://synthetic.invalid', rest: { url: 'https://synthetic.invalid/rest/v1', schemaName: 'public' }, rpc: async (name: string, args: any) => {
    state.calls(name, args)
    return { data: { version: 1, actor_id: state.actor, mode: state.mode }, error: null }
  } }
  return { get supabase() { return state.source ?? source } }
})
import { useCustomerTargetSave } from '../../src/lib/catalogue/useCustomerTargetSave'
const input = { customerId: '22222222-2222-4222-8222-222222222222', yearMonth: '2026-10', targetValue: 10 }
beforeEach(() => { state.actor = '11111111-1111-4111-8111-111111111111'; state.role = 'sales_head'; state.source = null; state.mode = 'legacy'; state.calls.mockClear(); localStorage.clear() })
afterEach(cleanup)
it('does not revive old target callbacks through actor A-B-A', async () => {
  const hook = renderHook(() => useCustomerTargetSave(async () => true)), old = hook.result.current, legacy = vi.fn(async () => {})
  state.actor = '33333333-3333-4333-8333-333333333333';hook.rerender()
  state.actor = '11111111-1111-4111-8111-111111111111';hook.rerender()
  expect(old.isCurrent()).toBe(false)
  await expect(old.write(input, legacy)).rejects.toThrow()
  expect(state.calls).not.toHaveBeenCalled();expect(legacy).not.toHaveBeenCalled()
  await act(async () => { await hook.result.current.write(input, legacy) })
  expect(legacy).toHaveBeenCalledOnce()
})
it('StrictMode retires the original incarnation rather than reviving callbacks', () => {
  const owners: Array<() => boolean> = []
  const hook = renderHook(() => {
    const target = useCustomerTargetSave(async () => true)
    useLayoutEffect(() => { owners.push(target.isCurrent) }, [])
    return target
  }, { reactStrictMode: true })
  expect(owners.length).toBeGreaterThanOrEqual(2)
  expect(owners[0]()).toBe(false);expect(hook.result.current.isCurrent()).toBe(true)
})
