import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ query: null as any, urls: [] as URL[] }))
vi.mock('../../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: any) => { state.query = options.queryFn; return { isLoading: true } }, useQueryClient: () => ({}), useMutation: () => ({}) }))
vi.mock('../../src/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabase: createClient('https://example.invalid', 'synthetic-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async input => { state.urls.push(new URL(String(input))); return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': '*/0' } }) } },
  }) }
})
import CustomerList from '../../src/pages/athel/CustomerList'
import ProductList from '../../src/pages/athel/ProductList'
beforeEach(() => { state.urls = []; vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers() })
for (const [table, Page] of [['customers', CustomerList], ['products', ProductList]] as const) test(`${table} page uses stable ties and a literal server-side search`, async () => {
  render(<Page />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a%,x*"' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
  const data = await state.query({ signal: new AbortController().signal })
  expect(data.total).toBe(0)
  expect(state.urls).toHaveLength(1)
  expect(state.urls[0].pathname.endsWith(`/${table}`)).toBe(true)
  expect(state.urls[0].searchParams.get('order')).toBe('name.asc,id.asc')
  expect(state.urls[0].searchParams.get('or')).toContain('name.imatch."***=')
  expect(state.urls[0].searchParams.get('limit')).toBe('10')
})
