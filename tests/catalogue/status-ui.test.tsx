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
  return { kind: 'customer' as const, row, authority: access, owner: { key: 'customer-owner-1', actorId: actor, role: 'co_admin' as const, isCurrent: () => true }, commandsAvailable: true, sender: send }
}
describe('status-only catalogue actions', () => {
  it('separates unavailable status and unsupported delete, without expanding legacy edit', () => {
    const p = fixture(); render(<CatalogueStatusActions {...p} commandsAvailable={false} />)
    expect(screen.getByText('Nonaktif')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Aktifkan' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Hapus bila tidak digunakan' }) as HTMLButtonElement).disabled).toBe(true)
    expect(p.sender).not.toHaveBeenCalled()
  })
  it('captures exact decimal version and desired status, then yields unresolved recovery to its page owner', async () => {
    const p = fixture(); render(<CatalogueStatusActions {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Aktifkan' }))
    expect(screen.getByRole('dialog').textContent).toContain(row.catalog_version)
    const confirm = screen.getByRole('button', { name: 'Konfirmasi Aktifkan' })
    fireEvent.click(confirm); fireEvent.click(confirm)
    await waitFor(() => expect(p.sender).toHaveBeenCalledWith('set_enabled', { kind: 'customer', id: row.id, expected_version: row.catalog_version, is_enabled: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(p.sender).toHaveBeenCalledOnce(); expect(p.sender.hasUnresolved()).toBe(true)
    expect(screen.queryByRole('button', { name: 'Periksa hasil' })).toBeNull()
  })
  it('denies missing or mismatched authority', () => {
    const p = fixture(); const view = render(<CatalogueStatusActions {...p} authority={null} />)
    expect((screen.getByRole('button', { name: 'Aktifkan' }) as HTMLButtonElement).disabled).toBe(true)
    view.rerender(<CatalogueStatusActions {...p} authority={{ ...access, actor_id: 'other' }} />)
    expect((screen.getByRole('button', { name: 'Aktifkan' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('never sends guarded deletion even when v2 grants it', () => {
    const p = fixture(); render(<CatalogueStatusActions {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Hapus bila tidak digunakan' }))
    expect(p.sender).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('does not expose a direct product delete route through the status sender', () => {
    const p = fixture()
    render(<CatalogueStatusActions {...p} kind="product" row={{ id: row.id, name: 'Produk', sku: 'P1', size: null, harga_pokok: null, luar_kota: null, dalam_kota: null, depo_bangunan: null, unit_price: null, is_enabled: true, catalog_version: row.catalog_version }} owner={{ ...p.owner, role: 'po_admin' }} authority={{ ...access, role: 'po_admin', customer_delete: false, customer_delete_mode: 'none', product_delete_mode: 'direct' }} />)
    expect(screen.queryByRole('button', { name: 'Hapus produk langsung' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Hapus bila tidak digunakan' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
it('refuses to rebase a captured confirmation onto a refreshed version', () => {
  const p = fixture(); const view = render(<CatalogueStatusActions {...p} />)
  fireEvent.click(screen.getByRole('button', { name: 'Aktifkan' }))
  view.rerender(<CatalogueStatusActions {...p} row={{ ...row, catalog_version: '9007199254740994' as DecimalVersion }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi Aktifkan' }))
  expect(screen.getByText('Data berubah. Batalkan dan periksa versi terbaru sebelum mengonfirmasi lagi.')).toBeTruthy()
  expect(p.sender).not.toHaveBeenCalled()
})
it('keeps one send locked while its own authority refresh occurs', async () => {
  const p = fixture(); let reject!: (error: Error) => void
  vi.mocked(p.sender).mockImplementationOnce(() => new Promise((_, no) => { reject = no }))
  const view = render(<CatalogueStatusActions {...p} />)
  fireEvent.click(screen.getByRole('button', { name: 'Aktifkan' })); fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi Aktifkan' }))
  view.rerender(<CatalogueStatusActions {...p} authority={null} />)
  view.rerender(<CatalogueStatusActions {...p} authority={{ ...access }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi Aktifkan' }))
  expect(p.sender).toHaveBeenCalledOnce()
  await act(async () => reject(new Error('predispatch refusal')))
  expect((screen.getByRole('button', { name: 'Batal' }) as HTMLButtonElement).disabled).toBe(false)
})
it('retires a confirmation when the explicit owner changes away and back', () => {
  const p = fixture(); const view = render(<CatalogueStatusActions {...p} />)
  fireEvent.click(screen.getByRole('button', { name: 'Aktifkan' }))
  view.rerender(<CatalogueStatusActions {...p} owner={{ ...p.owner, key: 'other' }} />)
  view.rerender(<CatalogueStatusActions {...p} />)
  expect(screen.queryByRole('dialog')).toBeNull(); expect(p.sender).not.toHaveBeenCalled()
})
