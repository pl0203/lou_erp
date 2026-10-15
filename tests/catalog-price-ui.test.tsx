import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ write: vi.fn(), calls: [] as any[], receipts: new Map<string, any>(), product: { id: '11111111-1111-4111-8111-111111111111', is_enabled: true, catalog_version: '1', name: 'Unset product', sku: 'TEST', size: null, unit_price: 17, harga_pokok: null, luar_kota: null, dalam_kota: null, depo_bangunan: 0 } }))
vi.mock('../src/lib/procurementAccess', () => ({ useProcurementAccess: () => ({ready:true,capabilities:{customer_create:true,customer_edit:true,customer_delete:false,product_create:true,product_edit:true,product_delete:true},require:()=>{}}) }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, profile: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'executive', is_active: true }, loading: false, error: null }) }))
vi.mock('../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../src/lib/supabase', () => ({ supabase: {
 supabaseUrl: 'https://catalogue.example.invalid', rest: { url: 'https://catalogue.example.invalid/rest/v1', schemaName: 'public' },
 rpc: (name: string, args: any = {}) => {
  const q: any = { abortSignal: () => q, then: (resolve: any, reject: any) => Promise.resolve().then(() => {
   if (name === 'pilot_procurement_access_v2') return { data: { version: 2, as_of: '2026-10-15T00:00:00Z', actor_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'executive',
    customer_create: true, customer_edit: true, customer_delete: false, product_create: true, product_edit: true, product_delete: true,
    customer_set_enabled: true, product_set_enabled: true, customer_delete_mode: 'none', product_delete_mode: 'direct' }, error: null }
   if (name === 'pilot_catalog_transaction_v1') {
    state.calls.push(structuredClone(args))
    if (args.p_operation !== 'edit' || args.p_payload.kind !== 'product' || args.p_payload.id !== state.product.id) throw new Error('Unexpected product command')
    const prior = state.receipts.get(args.p_request_id)
    if (prior) return JSON.stringify(prior.payload) === JSON.stringify(args.p_payload) ? { data: prior.receipt, error: null } : { data: null, error: { message: 'Request differs' } }
    if (args.p_payload.expected_version !== state.product.catalog_version) return { data: null, error: { details: 'CATALOG_VERSION_CONFLICT' } }
    const values = args.p_payload.values
    if (Object.keys(values).some(key => !['name','sku','size','harga_pokok','luar_kota','dalam_kota','depo_bangunan'].includes(key))) throw new Error('Unexpected product field')
    state.write(values)
    const before = { catalog_version: state.product.catalog_version, is_enabled: state.product.is_enabled }
    const changed = Object.entries(values).some(([key, value]) => (state.product as any)[key] !== value)
    Object.assign(state.product, values); state.product.catalog_version = String(BigInt(before.catalog_version) + (changed ? 1n : 0n))
    const receipt = { version: 1, actor_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', request_id: args.p_request_id, operation: 'edit', kind: 'product', id: state.product.id, before,
      after: { catalog_version: state.product.catalog_version, is_enabled: state.product.is_enabled }, committed_at: '2026-10-15T00:00:00Z' }
    state.receipts.set(args.p_request_id, { payload: structuredClone(args.p_payload), receipt })
    return { data: receipt, error: null }
   }
   if (name === 'pilot_reconcile_catalog_v1') {
    const prior = state.receipts.get(args.p_request_id)
    return { data: prior ? { status: 'committed', receipt: prior.receipt } : { status: 'unknown' }, error: null }
   }
   if (name !== 'pilot_catalog_page_v1' || args.p_kind !== 'product') throw new Error(`Unexpected catalogue RPC ${name}`)
   return { data: { version: 1, actor_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'executive', kind: args.p_kind, purpose: args.p_purpose, status: args.p_status, search: args.p_search, page: args.p_page, page_size: args.p_page_size, total_count: '1', rows: [{ ...state.product }] }, error: null }
  }).then(resolve, reject) }; return q
 }, from: () => {
 const q: any = { then: (resolve: any) => Promise.resolve({ data: [state.product], count: 1, error: null }).then(resolve) }
 q.select = q.order = q.range = q.eq = () => q
 q.update = q.insert = () => { throw new Error('Product form must not use raw writes') }
 return q
} } }))
import ProductList from '../src/pages/athel/ProductList'
const initialProduct = structuredClone(state.product)
const nativeLocks = Object.getOwnPropertyDescriptor(navigator, 'locks')
beforeEach(() => {
 Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (name: string, _options: unknown, action: any) => action({ name, mode: 'exclusive' }) } })
 localStorage.clear(); state.write.mockReset(); state.calls = []; state.receipts.clear(); state.product = structuredClone(initialProduct)
})
afterEach(() => { cleanup(); localStorage.clear(); if (nativeLocks) Object.defineProperty(navigator, 'locks', nativeLocks); else Reflect.deleteProperty(navigator, 'locks') })
async function openEditor() {
 const opener = screen.getAllByRole('button', { name: 'Ubah' })[0]
 await waitFor(() => expect((opener as HTMLButtonElement).disabled).toBe(false))
 fireEvent.click(opener)
}
async function assertRecoveredEdit() {
 await screen.findByText('Hasil belum terkonfirmasi')
 const recover = screen.getByRole('button', { name: 'Periksa hasil' })
 await waitFor(() => expect((recover as HTMLButtonElement).disabled).toBe(false))
 fireEvent.click(recover)
 await waitFor(() => expect(localStorage.length).toBe(0))
 expect(state.calls).toHaveLength(1)
 expect(state.calls[0]).toMatchObject({ p_operation: 'edit', p_payload: { kind: 'product', id: state.product.id, expected_version: '1' } })
 expect(state.product.unit_price).toBe(17)
}

test('null catalog prices render as unset, open blank, save null and preserve legacy price', async () => {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
 render(<QueryClientProvider client={client}><ProductList /></QueryClientProvider>)
 await screen.findAllByText('Unset product')
 expect(screen.getAllByText('Belum diisi').length).toBeGreaterThan(0)
 await openEditor()
 const fields = screen.getAllByRole('spinbutton') as HTMLInputElement[]
 expect(fields[0].value).toBe(''); expect(fields[3].value).toBe('0')
 fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
 await waitFor(() => expect(state.write).toHaveBeenCalled())
 expect(state.write.mock.calls[0][0]).toMatchObject({ harga_pokok: null, luar_kota: null, dalam_kota: null, depo_bangunan: 0 })
 expect(state.write.mock.calls[0][0]).not.toHaveProperty('unit_price')
 await assertRecoveredEdit()
 client.clear()
})

test('clearing a known zero saves null and does not round excessive precision', async () => {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
 render(<QueryClientProvider client={client}><ProductList /></QueryClientProvider>)
 await screen.findAllByText('Unset product'); await openEditor()
 const fields = screen.getAllByRole('spinbutton') as HTMLInputElement[]
 fireEvent.change(fields[3], { target: { value: '' } })
 fireEvent.change(fields[0], { target: { value: '1.001' } })
 fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
 await screen.findByText(/maksimal 2 angka desimal/); expect(state.write).not.toHaveBeenCalled()
 fireEvent.change(fields[0], { target: { value: '12.34' } })
 fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
 await waitFor(() => expect(state.write).toHaveBeenCalled())
 expect(state.write.mock.calls[0][0]).toMatchObject({ harga_pokok: 12.34, depo_bangunan: null })
 await assertRecoveredEdit()
 client.clear()
})
