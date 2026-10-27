import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { useTargetDraftSession } from '../../src/components/sales/useTargetDraftSession'
import { InlineTargetEditor } from '../../src/components/sales/InlineTargetEditor'
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
afterEach(cleanup)
it('keeps the checked draft frozen and does not offer resend or cancel after an uncertain result', async () => {
  const write = vi.fn(async () => { throw Error('uncertain') })
  let blocked = false
  function Probe() {
    const session = useTargetDraftSession({ scope: 'synthetic:2026-10:1', canEdit: true, isPending: false, isError: false, records: [{ id: 'one' }], unresolved: blocked, write, onSaved: vi.fn() })
    return <InlineTargetEditor recordId="one" currentTarget={null} canEdit layout="desktop" targetEditors={session} />
  }
  const q = client(), view = render(<QueryClientProvider client={q}><Probe /></QueryClientProvider>)
  fireEvent.click(screen.getByRole('button', { name: '+ Atur target' }))
  fireEvent.change(screen.getByLabelText('Target penjualan (Rp)'), { target: { value: '42' } })
  fireEvent.click(screen.getByRole('button', { name: 'Simpan target' }))
  await waitFor(() => expect(write).toHaveBeenCalledOnce())
  blocked = true; view.rerender(<QueryClientProvider client={q}><Probe /></QueryClientProvider>)
  expect((screen.getByLabelText('Target penjualan (Rp)') as HTMLInputElement).value).toBe('42')
  expect((screen.getByLabelText('Target penjualan (Rp)') as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Batal' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.keyDown(screen.getByLabelText('Target penjualan (Rp)'), { key: 'Enter' })
  fireEvent.keyDown(screen.getByLabelText('Target penjualan (Rp)'), { key: 'Escape' })
  expect(write).toHaveBeenCalledOnce(); expect(screen.queryByText(/Coba simpan lagi/)).toBeNull()
  expect(screen.getByText(/Gunakan Periksa hasil/)).toBeTruthy()
})
it('only confirmed matching recovery clears the retained draft and releases the editor', async () => {
  let session!: ReturnType<typeof useTargetDraftSession>, blocked = false
  function Probe() {
    session = useTargetDraftSession({ scope: 'synthetic', canEdit: true, isPending: false, isError: false, records: [{ id: 'one' }], unresolved: blocked, write: async () => {}, onSaved: vi.fn() })
    return <InlineTargetEditor recordId="one" currentTarget={null} canEdit layout="desktop" targetEditors={session} />
  }
  const q = client(), view = render(<QueryClientProvider client={q}><Probe /></QueryClientProvider>)
  fireEvent.click(screen.getByRole('button', { name: '+ Atur target' }));blocked = true
  view.rerender(<QueryClientProvider client={q}><Probe /></QueryClientProvider>)
  act(() => session.confirmRecovered('another'));expect(screen.getByLabelText('Target penjualan (Rp)')).toBeTruthy()
  act(() => session.confirmRecovered('one'));expect(screen.queryByLabelText('Target penjualan (Rp)')).toBeNull()
})
