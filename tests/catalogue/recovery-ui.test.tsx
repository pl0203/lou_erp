import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CatalogueRecovery } from '../../src/components/catalogue/CatalogueRecovery'
import type { CatalogueTransactionSender } from '../../src/lib/catalogue/transactions'
import type { CatalogueReceipt } from '../../src/lib/catalogue/contracts'

afterEach(cleanup)
const receipt = { version: 1, request_id: '33333333-3333-4333-8333-333333333333', actor_id: '11111111-1111-4111-8111-111111111111', operation: 'set_enabled', kind: 'customer', id: '22222222-2222-4222-8222-222222222222', before: { catalog_version: '1', is_enabled: false }, after: { catalog_version: '2', is_enabled: true }, committed_at: '2026-10-14T00:00:00Z' } as CatalogueReceipt
function fixture() {
  const sender = Object.assign(vi.fn(), { hasUnresolved: () => true, reconcile: vi.fn(async () => ({ status: 'committed', receipt })), acknowledgeRecovered: vi.fn(async () => undefined), acknowledgeAbandoned: vi.fn(async () => undefined) }) as unknown as CatalogueTransactionSender
  return { sender, owner: { key: 'one', actorId: receipt.actor_id, role: 'co_admin' as const, isCurrent: () => true }, available: true, acceptCanonical: vi.fn(async () => true), onConfirmed: vi.fn() }
}
it('does not announce completion until canonical acceptance and acknowledgement both finish; ignores duplicate clicks', async () => {
  const p = fixture(); let resolve!: () => void
  vi.mocked(p.sender.acknowledgeRecovered).mockImplementation(() => new Promise<void>(r => { resolve = r }))
  render(<CatalogueRecovery {...p} />)
  const button = screen.getByRole('button', { name: 'Periksa hasil' }); fireEvent.click(button); fireEvent.click(button)
  await waitFor(() => expect(p.acceptCanonical).toHaveBeenCalledWith(receipt))
  expect(p.sender.reconcile).toHaveBeenCalledTimes(1); expect(p.onConfirmed).not.toHaveBeenCalled()
  await act(async () => resolve()); expect(p.onConfirmed).toHaveBeenCalledWith(receipt)
})
it('retains unknown or canonically rejected results without acknowledging or abandoning', async () => {
  const p = fixture(); p.acceptCanonical.mockResolvedValue(false); render(<CatalogueRecovery {...p} />)
  fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' }))
  await screen.findByText('Data terbaru belum dapat diverifikasi. Periksa hasil kembali.')
  expect(p.sender.acknowledgeRecovered).not.toHaveBeenCalled(); expect(p.onConfirmed).not.toHaveBeenCalled()
})
it('suppresses late receipt after owner changes away and back', async () => {
  const p = fixture(); let resolve!: (value: {status:'committed'; receipt:CatalogueReceipt}) => void
  vi.mocked(p.sender.reconcile).mockImplementation(() => new Promise(r => { resolve = r }))
  const view = render(<CatalogueRecovery {...p} />); fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' }))
  view.rerender(<CatalogueRecovery {...p} owner={{ ...p.owner, key: 'two' }} />)
  view.rerender(<CatalogueRecovery {...p} />)
  await act(async () => resolve({ status: 'committed', receipt }))
  expect(p.acceptCanonical).not.toHaveBeenCalled(); expect(p.sender.acknowledgeRecovered).not.toHaveBeenCalled(); expect(p.onConfirmed).not.toHaveBeenCalled()
})
it('retains unknown recovery and never requests abandonment', async () => {
  const p = fixture(); vi.mocked(p.sender.reconcile).mockResolvedValue({ status: 'unknown' })
  render(<CatalogueRecovery {...p} />); fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' }))
  await screen.findByText('Hasil belum diketahui. Identitas permintaan tetap disimpan; jangan kirim ulang.')
  expect(p.sender.reconcile).toHaveBeenCalledWith(false); expect(p.sender.acknowledgeRecovered).not.toHaveBeenCalled()
})
it('does not complete after failed acknowledgement', async () => {
  const p = fixture(); vi.mocked(p.sender.acknowledgeRecovered).mockRejectedValue(new Error('storage'))
  render(<CatalogueRecovery {...p} />); fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' }))
  await screen.findByText('Pemulihan belum berhasil. Identitas permintaan tetap disimpan; periksa hasil kembali.')
  expect(p.onConfirmed).not.toHaveBeenCalled()
})
it('permits a fresh recovery attempt after an actual authority loss, but suppresses its old result', async () => {
  const p = fixture(); let resolve!: (value: {status:'committed'; receipt:CatalogueReceipt}) => void
  vi.mocked(p.sender.reconcile).mockImplementationOnce(() => new Promise(r => { resolve = r }))
  const view = render(<CatalogueRecovery {...p} />); fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' }))
  p.owner.isCurrent = () => false
  view.rerender(<CatalogueRecovery {...p} available={false} />)
  await act(async () => resolve({ status: 'committed', receipt }))
  p.owner.isCurrent = () => true
  view.rerender(<CatalogueRecovery {...p} />)
  expect((screen.getByRole('button', { name: 'Periksa hasil' }) as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' }))
  await waitFor(() => expect(p.onConfirmed).toHaveBeenCalledOnce())
})

it('does not retire a successful recovery because its own fresh authority read temporarily disables availability', async () => {
  const p = fixture(); let resolve!: (value: {status:'committed'; receipt:CatalogueReceipt}) => void
  vi.mocked(p.sender.reconcile).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const view = render(<CatalogueRecovery {...p} />)
  fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' }))
  view.rerender(<CatalogueRecovery {...p} available={false} />)
  view.rerender(<CatalogueRecovery {...p} available />)
  await act(async () => resolve({ status: 'committed', receipt }))
  expect(p.onConfirmed).toHaveBeenCalledOnce()
})
it('abandons only after explicit confirmation and retains the panel until terminal refresh succeeds', async () => {
  const p = fixture(), acceptAbandoned = vi.fn(async () => false), onAbandoned = vi.fn()
  vi.mocked(p.sender.reconcile).mockResolvedValue({ status: 'abandoned' })
  render(<CatalogueRecovery {...p} acceptAbandoned={acceptAbandoned} onAbandoned={onAbandoned} />)
  expect(p.sender.reconcile).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Batalkan permintaan tersimpan' }))
  expect(p.sender.reconcile).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi pembatalan permintaan' }))
  await waitFor(() => expect(p.sender.reconcile).toHaveBeenCalledWith(true))
  await screen.findByText(/Permintaan telah dibatalkan/)
  expect(onAbandoned).not.toHaveBeenCalled(); expect(p.sender.acknowledgeRecovered).not.toHaveBeenCalled(); expect(p.sender.acknowledgeAbandoned).not.toHaveBeenCalled()
  acceptAbandoned.mockResolvedValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' }))
  await waitFor(() => expect(onAbandoned).toHaveBeenCalledOnce())
  expect(p.sender.reconcile).toHaveBeenCalledTimes(2); expect(p.sender.reconcile).toHaveBeenLastCalledWith(false); expect(p.sender.acknowledgeAbandoned).toHaveBeenCalledOnce()
})
