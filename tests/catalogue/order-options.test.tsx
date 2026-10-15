import React from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({ url:'https://catalogue.test', actor: '11111111-1111-4111-8111-111111111111', rpc: vi.fn() }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: state.actor }, profile: { id: state.actor, role: 'po_admin', is_active: true }, loading: false, error: null }) }))
vi.mock('../../src/lib/supabase', () => ({ supabase: {
  get supabaseUrl() { return state.url }, rest: { get url() { return `${state.url}/rest/v1` }, schemaName: 'public' },
  rpc: (name: string, args: any) => { const request = { abortSignal: (_signal: AbortSignal) => request, then: (resolve: any, reject: any) => state.rpc(name, args).then(resolve, reject) }; return request },
} }))
import { invalidateCatalogueProjections } from '../../src/lib/catalogue/queryKeys'
import { useCatalogueOrderOptions } from '../../src/lib/catalogue/useCatalogueOrderOptions'
const clients: QueryClient[] = []
const row = (enabled = true) => ({ id: '22222222-2222-4222-8222-222222222222', name: 'Saved label', sku: 'SKU', size: null, unit_price: null, harga_pokok: 0, luar_kota: 12, dalam_kota: null, depo_bangunan: null, is_enabled: enabled, catalog_version: '9007199254740993' })
function page(args: any, enabled = true, actor = state.actor) {
  return { data: { version: 1, actor_id: actor, role: 'po_admin', kind: args.p_kind, purpose: args.p_purpose, status: args.p_status, search: args.p_search, page: args.p_page, page_size: args.p_page_size, total_count: '1', rows: [row(enabled)] }, error: null }
}
function mount(purpose: 'enabled-for-order' | 'all-for-history' = 'enabled-for-order') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client)
  return renderHook(() => useCatalogueOrderOptions('product', purpose), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> })
}
beforeEach(() => { state.url='https://catalogue.test'; state.actor = '11111111-1111-4111-8111-111111111111'; state.rpc.mockReset().mockImplementation(async (_name, args) => page(args)) })
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()) })
test('real options transport requests enabled choices and preserves exact decimal versions and zero price', async () => {
  const { result } = mount(); await waitFor(() => expect(result.current.data).toHaveLength(1))
  expect(state.rpc).toHaveBeenCalledWith('pilot_catalog_page_v1', expect.objectContaining({ p_kind: 'product', p_purpose: 'enabled-for-order', p_status: 'enabled' }))
  expect(result.current.data![0]).toMatchObject({ catalog_version: '9007199254740993', harga_pokok: 0 })
})
test('disabled rows are rejected from choices rather than silently admitted', async () => {
  state.rpc.mockImplementation(async (_name, args) => page(args, false))
  const { result } = mount(); await waitFor(() => expect(result.current.isError).toBe(true)); expect(result.current.data).toBeUndefined()
})
test('explicit history hydration retains disabled rows and remains a separate purpose', async () => {
  state.rpc.mockImplementation(async (_name, args) => page(args, false))
  const { result } = mount('all-for-history'); await waitFor(() => expect(result.current.data).toHaveLength(1))
  expect(result.current.data![0].is_enabled).toBe(false)
  expect(state.rpc).toHaveBeenCalledWith('pilot_catalog_page_v1', expect.objectContaining({ p_purpose: 'all-for-history', p_status: 'all' }))
})
test('actor change rejects a late former-owner response instead of exposing its options', async () => {
  let release!: (value: unknown) => void
  let oldArgs: any
  state.rpc.mockImplementationOnce((_name, args) => { oldArgs = args; return new Promise(resolve => { release = resolve }) })
  const original = state.actor, { result, rerender } = mount()
  await waitFor(() => expect(release).toBeTypeOf('function'))
  state.actor = '33333333-3333-4333-8333-333333333333'; rerender()
  await act(async () => release(page(oldArgs, true, original)))
  await waitFor(() => expect(result.current.data).toHaveLength(1))
  const keys = clients[0].getQueryCache().getAll().map(query => query.queryKey)
  expect(keys.some(key => key[2] === original)).toBe(false)
})

test('simultaneous consumers of the same purpose both receive owner-validated options', async () => {
 const client = new QueryClient({ defaultOptions:{queries:{retry:false}} }); clients.push(client)
 const {result}=renderHook(()=>({one:useCatalogueOrderOptions('product','enabled-for-order'),two:useCatalogueOrderOptions('product','enabled-for-order')}),{wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>})
 await waitFor(()=>{expect(result.current.one.data).toHaveLength(1);expect(result.current.two.data).toHaveLength(1)})
})
test('actor A to B to A cannot accept the retired first A response', async () => {
 let release!:(value:unknown)=>void;let oldArgs:any
 state.rpc.mockImplementationOnce((_name,args)=>{oldArgs=args;return new Promise(resolve=>{release=resolve})})
 const a=state.actor,{result,rerender}=mount()
 await waitFor(()=>expect(release).toBeTypeOf('function'))
 state.actor='33333333-3333-4333-8333-333333333333';rerender()
 await waitFor(()=>expect(result.current.data).toHaveLength(1))
 state.actor=a;rerender();await waitFor(()=>expect(state.rpc.mock.calls.length).toBe(3))
 await act(async()=>release({...page(oldArgs,true,a),data:{...page(oldArgs,true,a).data,rows:[{...row(),name:'Retired result'}]}}))
 await waitFor(()=>expect(result.current.data?.[0].name).toBe('Saved label'))
})
test('changed backend endpoint fails closed until a new mount binds the actual endpoint', async () => {
 const first=mount();await waitFor(()=>expect(first.result.current.data).toHaveLength(1))
 state.url='https://replacement.test'
 await act(async()=>{await first.result.current.refetch()})
 expect(first.result.current.isError).toBe(true)
 first.unmount();const next=mount();await waitFor(()=>expect(next.result.current.data).toHaveLength(1))
 expect(clients[1].getQueryCache().getAll().some(query=>query.queryKey[1]===state.url)).toBe(true)
})
test('status invalidation refreshes enabled options without replacing saved historical snapshots', async () => {
 const {result}=mount();await waitFor(()=>expect(result.current.data).toHaveLength(1))
 clients[0].setQueryData(['po_line_state','saved','edit'],[{product_name:'Historical snapshot',unit_price:0}])
 state.rpc.mockImplementation(async(_name,args)=>({...page(args),data:{...page(args).data,total_count:'0',rows:[]}}))
 await act(async()=>{await invalidateCatalogueProjections(clients[0],{backend:state.url,actorId:state.actor,role:'po_admin'},'product')})
 await waitFor(()=>expect(result.current.data).toEqual([]))
 expect(clients[0].getQueryData(['po_line_state','saved','edit'])).toEqual([{product_name:'Historical snapshot',unit_price:0}])
})

test('StrictMode effect replay and a later remount both obtain a current complete result', async () => {
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client)
 const wrapper=({children}:React.PropsWithChildren)=><React.StrictMode><QueryClientProvider client={client}>{children}</QueryClientProvider></React.StrictMode>
 const first=renderHook(()=>useCatalogueOrderOptions('product','enabled-for-order'),{wrapper})
 await waitFor(()=>expect(first.result.current.data).toHaveLength(1));first.unmount()
 const next=renderHook(()=>useCatalogueOrderOptions('product','enabled-for-order'),{wrapper})
 await waitFor(()=>expect(next.result.current.data).toHaveLength(1))
 expect(next.result.current.isError).toBe(false)
})
