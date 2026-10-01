import React from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), navigate: vi.fn() }))
vi.mock('../src/lib/supabase', () => ({ supabase: {
  rpc: mocks.rpc,
  from: (table: string) => ({ select: () => ({ order: async () => ({
    data: table === 'customers' ? [{ id: 'dummy-customer', name: 'Dummy customer', pricing_tier: 'luar_kota' }] : [], error: null,
  }) }) }),
} }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'dummy-actor' } }) }))
vi.mock('../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate, useBlocker: () => ({ state: 'unblocked' }), useBeforeUnload: () => {} }))
import PONew from '../src/pages/athel/PONew'

afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks() })

test.each(['2026-08-31', '2024-02-29'])('manual PO retains selected business date %s after rerenders and sends it to the RPC', async orderDate => {
  mocks.rpc.mockResolvedValue({ data: { id: 'dummy-po' }, error: null })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const { container } = render(<QueryClientProvider client={client}><PONew /></QueryClientProvider>)
  await screen.findByRole('option', { name: 'Dummy customer' })
  const dateInput = container.querySelectorAll<HTMLInputElement>('input[type="date"]')[0]
  fireEvent.change(dateInput, { target: { value: orderDate } })
  fireEvent.blur(dateInput)
  // Later changes rerender the controlled form, exposing DOM-only changes that never reached React state.
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'dummy-customer' } })
  fireEvent.change(screen.getByPlaceholderText('mis. PO-2024-001'), { target: { value: 'DUMMY-DATED-PO' } })
  fireEvent.change(screen.getByPlaceholderText('Nama produk'), { target: { value: 'Dummy product' } })
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
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/athel/po/dummy-po'))
  client.clear()
})
