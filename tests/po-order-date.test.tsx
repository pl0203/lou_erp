import { beforeEach } from 'vitest'
import { transferableAbortController } from 'node:util'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import React from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), navigate: vi.fn() }))
vi.mock('../src/lib/catalogue/useCatalogueOrderOptions',()=>({useCatalogueOrderOptions:(kind:string)=>({data:kind==='customer'?[{id:'dummy-customer',name:'Dummy customer',pricing_tier:'luar_kota',is_enabled:true}]:[{id:'dummy-product',name:'Dummy product',sku:'DUMMY',luar_kota:10,is_enabled:true}],isError:false,isFetching:false,refetch:vi.fn()})}))
vi.mock('../src/lib/supabase', () => ({ supabase: {
  rpc: mocks.rpc,
  from: (table: string) => {
    const rows = table === 'customers' ? [{ id: 'dummy-customer', name: 'Dummy customer', pricing_tier: 'luar_kota' }] : []
    let from = 0, to = 499
    const q: any = { then: (resolve: any) => Promise.resolve({ data: rows.slice(from, to + 1), count: rows.length, error: null }).then(resolve) }
    q.select = q.order = q.abortSignal = () => q
    q.range = (start: number, end: number) => { from = start; to = end; return q }
    return q
  },
} }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'dummy-actor' } }) }))
vi.mock('../src/components/AthelNav', () => ({ default: () => null }))
import PONew from '../src/pages/athel/PONew'

const routers: ReturnType<typeof createMemoryRouter>[] = []
afterEach(() => { cleanup(); vi.unstubAllGlobals(); routers.splice(0).forEach(router => router.dispose()); localStorage.clear(); vi.clearAllMocks() })

test.each(['2026-08-31', '2024-02-29'])('manual PO retains selected business date %s after rerenders and sends it to the RPC', async orderDate => {
  mocks.rpc.mockResolvedValue({ data: { id: 'dummy-po' }, error: null })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter([{ path: '/athel/po/new', element: <PONew /> }, { path: '*', element: <p>Destination</p> }], { initialEntries: ['/athel/po/new'] }); routers.push(router)
  const { container } = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  await waitFor(() => expect((screen.getByRole('combobox', { name: 'Pelanggan' }) as HTMLInputElement).disabled).toBe(false))
  const dateInput = container.querySelectorAll<HTMLInputElement>('input[type="date"]')[0]
  fireEvent.change(dateInput, { target: { value: orderDate } })
  fireEvent.blur(dateInput)
  // Later changes rerender the controlled form, exposing DOM-only changes that never reached React state.
  fireEvent.change(screen.getByRole('combobox', { name: 'Pelanggan' }), { target: { value: 'Dummy' } })
  fireEvent.click(screen.getByRole('option', { name: 'Dummy customer' }))
  fireEvent.change(screen.getByPlaceholderText('mis. PO-2024-001'), { target: { value: 'DUMMY-DATED-PO' } })
  const lookup = screen.getByRole('combobox', { name: 'Cari SKU atau nama barang' }); fireEvent.change(lookup, { target: { value:'DUMMY' } }); fireEvent.keyDown(lookup, { key:'Enter' })
  fireEvent.change(screen.getByLabelText('Harga satuan'), { target: { value: '0' } })
  expect(dateInput.value).toBe(orderDate)
  fireEvent.click(screen.getByRole('button', { name: 'Simpan PO' }))
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1))
  expect(mocks.rpc).toHaveBeenCalledWith('pilot_order_transaction', expect.objectContaining({
    p_operation: 'create_po', p_payload: expect.objectContaining({ order_date: orderDate }),
  }))
  const payload = mocks.rpc.mock.calls[0][1].p_payload
  expect(payload).not.toHaveProperty('created_at')
  expect(payload).not.toHaveProperty('updated_at')
  expect(payload).not.toHaveProperty('created_by')
  await waitFor(() => expect(router.state.location.pathname).toBe('/athel/po/dummy-po'))
  client.clear()
})

// The real data router uses Node Request, which requires a Node-compatible signal.
beforeEach(() => { vi.stubGlobal('AbortController', class { constructor() { return transferableAbortController() } }) })
