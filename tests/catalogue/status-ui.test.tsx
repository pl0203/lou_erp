import { act, fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CatalogueStatusActions } from '../../src/components/catalogue/CatalogueStatusActions'
import type { CatalogueRow, ProcurementAccessV2, DecimalVersion } from '../../src/lib/catalogue/contracts'
import type { CatalogueTransactionSender } from '../../src/lib/catalogue/transactions'

afterEach(cleanup)
const actor = '11111111-1111-4111-8111-111111111111'
const row: CatalogueRow<'customer'> = { id: '22222222-2222-4222-8222-222222222222', name: 'Toko Contoh', address: null, city: null, phone: null, email: null, pricing_tier: 'others', customer_category: null, is_enabled: false, catalog_version: '9007199254740993' as DecimalVersion }
const access: ProcurementAccessV2 = { version: 2, as_of: '2026-10-14T00:00:00Z', actor_id: actor, role: 'co_admin', customer_create: true, customer_edit: true, customer_delete: true, product_create: true, product_edit: true, product_delete: true, customer_set_enabled: true, product_set_enabled: true, customer_delete_mode: 'guarded', product_delete_mode: 'guarded' }
function fixture() {
  let unresolved = false
  const send = Object.assign(vi.fn(async () => { unresolved = true; throw new Error('uncertain') }), { hasUnresolved: () => unresolved, reconcile: vi.fn(), acknowledgeRecovered: vi.fn() }) as unknown as CatalogueTransactionSender
  return { kind: 'customer' as const, row, authority: access, owner: { key: 'customer-owner-1', actorId: actor, role: 'co_admin' as const, isCurrent: () => true }, commandsAvailable: true, sender: send, acceptCanonical: vi.fn(async () => true), onConfirmed: vi.fn(), onEdit: vi.fn() }
}
describe('compact catalogue actions', () => {
  it('keeps disabled records editable and displays unavailable commands without legacy fallback', () => {
    const p = fixture(); render(<CatalogueStatusActions {...p} commandsAvailable={false} />)
    expect(screen.getByText('Nonaktif')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' })); expect(p.onEdit).toHaveBeenCalledOnce()
    expect((screen.getByRole('button', { name: 'Aktifkan' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Hapus bila tidak digunakan' }) as HTMLButtonElement).disabled).toBe(true)
    expect(p.sender).not.toHaveBeenCalled()
  })
  it('captures explicit desired state and exact decimal version, then retains uncertain recovery on Escape', async () => {
    const p = fixture(); render(<CatalogueStatusActions {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Aktifkan' }))
    expect(screen.getByRole('dialog').textContent).toContain(row.catalog_version)
    fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi Aktifkan' }))
    await waitFor(() => expect(p.sender).toHaveBeenCalledWith('set_enabled', { kind: 'customer', id: row.id, expected_version: row.catalog_version, is_enabled: true }))
    await screen.findByText('Hasil belum terkonfirmasi')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeTruthy(); expect(p.onConfirmed).not.toHaveBeenCalled()
  })
  it('denies mismatched or missing authority and never offers customer direct delete', () => {
    const p = fixture(); const view = render(<CatalogueStatusActions {...p} authority={null} />)
    expect((screen.getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(true)
    view.rerender(<CatalogueStatusActions {...p} authority={{ ...access, actor_id: 'other', customer_delete_mode: 'direct' }} />)
    expect((screen.getByRole('button', { name: 'Aktifkan' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Hapus produk langsung' })).toBeNull()
  })
})
it('refuses to silently apply a confirmation to a refreshed version', async () => {
  const p = fixture(); const view = render(<CatalogueStatusActions {...p} />)
  fireEvent.click(screen.getByRole('button', { name: 'Aktifkan' }))
  view.rerender(<CatalogueStatusActions {...p} row={{ ...row, catalog_version: '9007199254740994' as DecimalVersion }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi Aktifkan' }))
  expect(screen.getByText('Data berubah. Batalkan dan periksa versi terbaru sebelum mengonfirmasi lagi.')).toBeTruthy()
  expect(p.sender).not.toHaveBeenCalled()
})
it('keeps direct product deletion separate from guarded commands', () => {
  const p = fixture(); const direct = vi.fn()
  render(<CatalogueStatusActions {...p} kind="product" row={{ id: row.id, name: 'Produk', sku: 'P1', size: null, harga_pokok: null, luar_kota: null, dalam_kota: null, depo_bangunan: null, unit_price: null, is_enabled: true, catalog_version: row.catalog_version }} owner={{ ...p.owner, role: 'po_admin' }} authority={{ ...access, role: 'po_admin', customer_delete: false, customer_delete_mode: 'none', product_delete_mode: 'direct' }} commandsAvailable={false} onDirectProductDelete={direct} />)
  fireEvent.click(screen.getByRole('button', { name: 'Hapus produk langsung' }))
  expect(direct).toHaveBeenCalledOnce(); expect(p.sender).not.toHaveBeenCalled()
  expect((screen.getByRole('button', { name: 'Hapus bila tidak digunakan' }) as HTMLButtonElement).disabled).toBe(true)
})
it('does not accept a recovered receipt for a different target', async () => {
  const p = fixture()
  vi.spyOn(p.sender, 'hasUnresolved').mockReturnValue(true)
  vi.mocked(p.sender.reconcile).mockResolvedValue({ status: 'committed', receipt: { version: 1, request_id: '33333333-3333-4333-8333-333333333333', actor_id: actor, operation: 'set_enabled', kind: 'customer', id: '44444444-4444-4444-8444-444444444444', before: { catalog_version: row.catalog_version, is_enabled: false }, after: { catalog_version: '9007199254740994' as DecimalVersion, is_enabled: true }, committed_at: '2026-10-14T00:00:00Z' } })
  render(<CatalogueStatusActions {...p} />)
  fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil' }))
  await screen.findByText('Data terbaru belum dapat diverifikasi. Periksa hasil kembali.')
  expect(p.acceptCanonical).not.toHaveBeenCalled(); expect(p.sender.acknowledgeRecovered).not.toHaveBeenCalled()
})

it('REVIEW: becomes usable after authority refresh invalidates a predispatch refusal', async () => {
  const p = fixture(); let reject!: (e: Error) => void
  vi.mocked(p.sender).mockImplementationOnce(() => new Promise((_, r) => { reject = r }))
  const view = render(<CatalogueStatusActions {...p} />)
  fireEvent.click(screen.getByRole('button', { name: 'Aktifkan' }))
  fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi Aktifkan' }))
  view.rerender(<CatalogueStatusActions {...p} authority={null} />)
  await act(async () => reject(new Error('authority changed before dispatch')))
  view.rerender(<CatalogueStatusActions {...p} authority={{...access}} />)
  expect(p.sender.hasUnresolved()).toBe(false)
  expect((screen.getByRole('button', {name:'Batal'}) as HTMLButtonElement).disabled).toBe(false)
})


it('does not let a late invalidated send unlock a newer attempt', async () => {
  const p = fixture(); let rejectOld!: (e: Error) => void; let rejectNew!: (e: Error) => void
  vi.mocked(p.sender).mockImplementationOnce(() => new Promise((_, r) => { rejectOld = r })).mockImplementationOnce(() => new Promise((_, r) => { rejectNew = r }))
  const view = render(<CatalogueStatusActions {...p} />)
  fireEvent.click(screen.getByRole('button', { name: 'Aktifkan' }))
  fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi Aktifkan' }))
  view.rerender(<CatalogueStatusActions {...p} authority={null} />)
  view.rerender(<CatalogueStatusActions {...p} authority={{ ...access }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi Aktifkan' }))
  expect(p.sender).toHaveBeenCalledTimes(2)
  await act(async () => rejectOld(new Error('old refusal')))
  expect((screen.getByRole('button', { name: 'Batal' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi Aktifkan' }))
  expect(p.sender).toHaveBeenCalledTimes(2); expect(p.onConfirmed).not.toHaveBeenCalled()
  await act(async () => rejectNew(new Error('new refusal')))
  expect((screen.getByRole('button', { name: 'Batal' }) as HTMLButtonElement).disabled).toBe(false)
})
it('refreshes advisory sender state after stale predispatch refusal without retaining false recovery', async () => {
  const p = fixture(); let reject!: (e: Error) => void; let pending = false
  vi.spyOn(p.sender, 'hasUnresolved').mockImplementation(() => pending)
  vi.mocked(p.sender).mockImplementationOnce(() => { pending = true; return new Promise((_, r) => { reject = r }) })
  const view = render(<CatalogueStatusActions {...p} />)
  fireEvent.click(screen.getByRole('button', { name: 'Aktifkan' }))
  fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi Aktifkan' }))
  view.rerender(<CatalogueStatusActions {...p} authority={null} />)
  view.rerender(<CatalogueStatusActions {...p} authority={{ ...access }} />)
  expect((screen.getByRole('button', { name: 'Batal' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => { pending = false; reject(new Error('pre-persistence refusal')) })
  expect((screen.getByRole('button', { name: 'Batal' }) as HTMLButtonElement).disabled).toBe(false)
  expect(screen.queryByText('Hasil belum terkonfirmasi')).toBeNull()
  expect(p.onConfirmed).not.toHaveBeenCalled()
})
