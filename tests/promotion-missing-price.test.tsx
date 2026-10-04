import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ insert: vi.fn().mockResolvedValue({ error: null }), price: null as number | null }))
vi.mock('../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../src/components/ActivePromotionsBanner', () => ({ default: () => null }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'u' } }) }))
vi.mock('../src/lib/supabase', () => ({ supabase: { from: () => ({ insert: state.insert }) } }))
vi.mock('@tanstack/react-query', async original => ({ ...await original<any>(), useQuery: ({ queryKey }: any) => ({ data: queryKey[0] === 'products' ? [{ id: 'p', name: 'Blank product', sku: 'BLANK', harga_pokok: state.price, luar_kota: state.price, dalam_kota: state.price, depo_bangunan: state.price }] : [] }) }))
import Promotions from '../src/pages/girard/Promotions'
afterEach(() => { cleanup(); state.insert.mockClear(); state.price = null })
test('promotion from blank catalogue requires four explicit overrides and preserves entered zero', async () => {
 state.insert.mockResolvedValue({ error: null })
 const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
 const { container } = render(<QueryClientProvider client={client}><Promotions /></QueryClientProvider>)
 fireEvent.click(screen.getByRole('button', { name: /Tambah Promosi/ }))
 fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p' } })
 fireEvent.change(container.querySelectorAll('input[type="date"]')[1], { target: { value: '2099-12-31' } })
 const prices = (screen.getAllByRole('spinbutton') as HTMLInputElement[]).slice(1)
 expect(prices.map(x => x.value)).toEqual(['','','',''])
 fireEvent.change(screen.getByPlaceholderText('mis. 10'), { target: { value: '10' } })
 expect(prices.map(x => x.value)).toEqual(['','','',''])
 fireEvent.click(screen.getByRole('button', { name: /Simpan/ }))
 await screen.findByText(/Isi harga promosi untuk semua tier/)
 expect(state.insert).not.toHaveBeenCalled()
 prices.forEach(input => fireEvent.change(input, { target: { value: '0' } }))
 fireEvent.click(screen.getByRole('button', { name: /Simpan/ }))
 await waitFor(() => expect(state.insert).toHaveBeenCalledTimes(1))
 expect(state.insert.mock.calls[0][0]).toMatchObject({ harga_pokok: 0, luar_kota: 0, dalam_kota: 0, depo_bangunan: 0 })
 client.clear()
})

test('discount on an existing priced product retains whole-rupiah rounding', () => {
 state.price = 19.99
 const client = new QueryClient()
 render(<QueryClientProvider client={client}><Promotions /></QueryClientProvider>)
 fireEvent.click(screen.getByRole('button', { name: /Tambah Promosi/ }))
 fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p' } })
 fireEvent.change(screen.getByPlaceholderText('mis. 10'), { target: { value: '10' } })
 expect((screen.getAllByRole('spinbutton') as HTMLInputElement[]).slice(1).map(x => x.value)).toEqual(['18','18','18','18'])
 client.clear()
})
