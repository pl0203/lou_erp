import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ write: vi.fn(), product: { id: '11111111-1111-4111-8111-111111111111', is_enabled: true, catalog_version: '1', name: 'Unset product', sku: 'TEST', size: null, unit_price: 17, harga_pokok: null, luar_kota: null, dalam_kota: null, depo_bangunan: 0 } }))
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
   if (name !== 'pilot_catalog_page_v1' || args.p_kind !== 'product') throw new Error(`Unexpected catalogue RPC ${name}`)
   return { data: { version: 1, actor_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'executive', kind: args.p_kind, purpose: args.p_purpose, status: args.p_status, search: args.p_search, page: args.p_page, page_size: args.p_page_size, total_count: '1', rows: [{ ...state.product }] }, error: null }
  }).then(resolve, reject) }; return q
 }, from: () => {
 const q: any = { then: (resolve: any) => Promise.resolve({ data: [state.product], count: 1, error: null }).then(resolve) }
 q.select = q.order = q.range = q.eq = () => q
 q.update = q.insert = (payload: any) => { state.write(payload); return q }
 return q
} } }))
import ProductList from '../src/pages/athel/ProductList'
afterEach(() => { cleanup(); state.write.mockReset() })
test('null catalog prices render as unset, open blank, save null and preserve legacy price', async () => {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
 render(<QueryClientProvider client={client}><ProductList /></QueryClientProvider>)
 await screen.findAllByText('Unset product')
 expect(screen.getAllByText('Belum diisi').length).toBeGreaterThan(0)
 fireEvent.click(screen.getAllByRole('button', { name: 'Ubah' })[0])
 const fields = screen.getAllByRole('spinbutton') as HTMLInputElement[]
 expect(fields[0].value).toBe(''); expect(fields[3].value).toBe('0')
 fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
 await waitFor(() => expect(state.write).toHaveBeenCalled())
 expect(state.write.mock.calls[0][0]).toMatchObject({ harga_pokok: null, luar_kota: null, dalam_kota: null, depo_bangunan: 0 })
 expect(state.write.mock.calls[0][0]).not.toHaveProperty('unit_price')
 client.clear()
})

test('clearing a known zero saves null and does not round excessive precision', async () => {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
 render(<QueryClientProvider client={client}><ProductList /></QueryClientProvider>)
 await screen.findAllByText('Unset product'); fireEvent.click(screen.getAllByRole('button', { name: 'Ubah' })[0])
 const fields = screen.getAllByRole('spinbutton') as HTMLInputElement[]
 fireEvent.change(fields[3], { target: { value: '' } })
 fireEvent.change(fields[0], { target: { value: '1.001' } })
 fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
 await screen.findByText(/maksimal 2 angka desimal/); expect(state.write).not.toHaveBeenCalled()
 fireEvent.change(fields[0], { target: { value: '12.34' } })
 fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
 await waitFor(() => expect(state.write).toHaveBeenCalled())
 expect(state.write.mock.calls[0][0]).toMatchObject({ harga_pokok: 12.34, depo_bangunan: null })
 client.clear()
})
