import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TargetWizard } from '../../src/components/sales/TargetWizard'
import { clearTargetDrafts } from '../../src/lib/salesTargets/useTargetDraft'
import type { TargetBaseline, TargetPlan } from '../../src/lib/salesTargets/contracts'
import { TargetTransportError } from '../../src/lib/salesTargets/transport'
import type { TargetTransport } from '../../src/lib/salesTargets/transport'
const manager = '10000000-0000-0000-0000-000000000001', rep = '10000000-0000-0000-0000-000000000002', head = '10000000-0000-0000-0000-000000000003'
const baseline: TargetBaseline = { schemaVersion: 1, month: '2026-11-01', managerId: manager, rosterHash: 'synthetic', currency: 'IDR', warnings: [], people: [{ personId: rep, name: 'Sales Contoh A', ownership: 'direct_report', customers: [{ customerId: '20000000-0000-0000-0000-000000000001', name: 'Toko Contoh', cells: ['po_order_value', 'po_delivery_value', 'co_sale_value'].map((metric, i) => ({ metric: metric as any, months: ['2026-07-01', '2026-08-01', '2026-09-01'].map(month => ({ month, amount: i === 2 ? null : '80.00', quality: i === 2 ? 'missing' as const : 'complete' as const })), contextMonths: [], complete: i !== 2, baseline: i === 2 ? null : '80.00', warningCodes: i === 2 ? ['co_missing'] : [] })) }] }] }
const plan: TargetPlan = { id: '30000000-0000-0000-0000-000000000001', month: baseline.month, managerId: manager, version: 1, state: 'submitted', rosterHash: 'synthetic', currency: 'IDR', lines: ['po_order_value', 'po_delivery_value', 'co_sale_value'].map(metric => ({ personId: rep, metric: metric as any, amount: '80.00', applicability: 'target', reason: 'Tinjauan manual' })), proposedBy: manager, publishedBy: null, publishedAt: null, warnings: [] }
function adapter(overrides: Partial<TargetTransport> = {}): TargetTransport {
  return { scope: 'test-only', capability: { available: true, schemaVersion: 1 }, readBaseline: vi.fn(async () => baseline), readPlans: vi.fn(), readPlan: vi.fn(async () => plan), command: vi.fn(async command => ({ status: 'committed', requestId: command.requestId, plan: { ...plan, state: command.operation === 'submit' ? 'submitted' : 'draft', lines: command.payload.lines ?? plan.lines } })), reconcile: vi.fn(), ...overrides }
}
const actor = { id: manager, role: 'sales_manager', active: true }, teams = [{ managerId: manager, name: 'Tim Manager Contoh' }]
afterEach(() => { cleanup(); clearTargetDrafts() })
it('gates unavailable capability with no reads or actions', () => {
  const transport = adapter({ capability: { available: false, schemaVersion: 1 } })
  render(<TargetWizard actor={actor} teams={teams} transport={transport} />)
  expect(screen.getByText(/belum diaktifkan/i)).toBeTruthy()
  expect(transport.readBaseline).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: /Ajukan target/ })).toBeNull()
})
it('follows three steps, retains Back values, and blocks missing CO until manual reason', async () => {
  const transport = adapter()
  const view = render(<TargetWizard actor={actor} teams={teams} transport={transport} now={new Date(2026, 9, 17)} />)
  expect((screen.getByLabelText('Bulan target') as HTMLInputElement).value).toBe('2026-11')
  fireEvent.click(screen.getByRole('button', { name: 'Periksa usulan' }))
  await screen.findByRole('heading', { name: 'Periksa target yang disarankan' })
  expect((screen.getByLabelText('Nilai CO terjual (Rp) · Sales Contoh A') as HTMLInputElement).value).toBe('')
  fireEvent.click(screen.getByRole('button', { name: 'Lanjut ke tinjauan' }))
  expect(screen.getByText(/Isi target \(Rp\)/)).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Nilai CO terjual (Rp) · Sales Contoh A'), { target: { value: '0' } })
  fireEvent.change(screen.getByLabelText('Alasan Nilai CO terjual · Sales Contoh A'), { target: { value: 'Rencana manual sudah ditinjau' } })
  fireEvent.click(screen.getByRole('button', { name: 'Kembali' }))
  fireEvent.click(screen.getByRole('button', { name: 'Periksa usulan' }))
  expect((screen.getByLabelText('Nilai CO terjual (Rp) · Sales Contoh A') as HTMLInputElement).value).toBe('0')
  view.unmount()
  render(<TargetWizard actor={actor} teams={teams} transport={transport} now={new Date(2026, 9, 17)} />)
  expect((screen.getByLabelText('Nilai CO terjual (Rp) · Sales Contoh A') as HTMLInputElement).value).toBe('0')
  fireEvent.click(screen.getByRole('button', { name: 'Lanjut ke tinjauan' }))
  expect(screen.getByText('Sales Head atau Direktur. Satu persetujuan sudah cukup.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Ajukan target' }))
  await waitFor(() => expect(transport.command).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('button', { name: 'Setujui & terbitkan' })).toBeNull()
})
it('retains input after failure and only offers reconciliation, not duplicate submit', async () => {
  const transport = adapter({ command: vi.fn(async () => { throw Error('Hasil belum terkonfirmasi') }) })
  render(<TargetWizard actor={actor} teams={teams} transport={transport} now={new Date(2026, 9, 17)} />)
  fireEvent.click(screen.getByRole('button', { name: 'Periksa usulan' })); await screen.findByRole('heading', { name: 'Periksa target yang disarankan' })
  fireEvent.change(screen.getByLabelText('Nilai PO masuk (Rp) · Sales Contoh A'), { target: { value: '130' } })
  fireEvent.click(screen.getByRole('button', { name: 'Simpan draf' }))
  await screen.findByRole('button', { name: 'Periksa hasil' })
  expect((screen.getByLabelText('Nilai PO masuk (Rp) · Sales Contoh A') as HTMLInputElement).value).toBe('130')
  fireEvent.click(screen.getByRole('button', { name: 'Simpan draf' }))
  expect(transport.command).toHaveBeenCalledTimes(1)
})
it('allows an executive independent approval but never self-approval and leaves salesperson read-only', async () => {
  const transport = adapter()
  const view = render(<TargetWizard actor={{ id: head, role: 'executive', active: true }} transport={transport} initialPlanId={plan.id} />)
  await screen.findByRole('button', { name: 'Setujui & terbitkan' })
  expect(screen.getByRole('button', { name: 'Kembalikan untuk diperbaiki' })).toBeTruthy()
  view.unmount(); clearTargetDrafts()
  render(<TargetWizard actor={{ ...actor, role: 'executive' }} transport={transport} initialPlanId={plan.id} />)
  await screen.findByText(/Pengaju tidak dapat menyetujui/)
  expect(screen.queryByRole('button', { name: 'Setujui & terbitkan' })).toBeNull()
})
it('restores incomplete saved drafts with all current-roster metric inputs, never omits a new rep', async () => {
  const transport = adapter({ readPlan: async () => ({ ...plan, state: 'draft', lines: [] }) })
  render(<TargetWizard actor={actor} teams={teams} transport={transport} initialPlanId={plan.id} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Pulihkan draf tersimpan' }))
  await screen.findByLabelText('Nilai PO masuk (Rp) · Sales Contoh A')
  expect((screen.getByLabelText('Nilai CO terjual (Rp) · Sales Contoh A') as HTMLInputElement).value).toBe('')
})
it('displays the approver return reason after reopening a saved plan', async () => {
  const transport = adapter({ readPlan: async () => ({ ...plan, state: 'returned', returnReason: 'Periksa rencana CO dan stok warisan' }) })
  render(<TargetWizard actor={actor} teams={teams} transport={transport} initialPlanId={plan.id} />)
  await screen.findByText('Periksa rencana CO dan stok warisan')
})
it('shows recovery after a pending command fails while the route was unmounted', async () => {
  let reject!: (cause: Error) => void
  const transport = adapter({ command: () => new Promise((_resolve, fail) => { reject = fail }) })
  const view = render(<TargetWizard actor={actor} teams={teams} transport={transport} now={new Date(2026, 9, 17)} />)
  fireEvent.click(screen.getByRole('button', { name: 'Periksa usulan' })); await screen.findByRole('heading', { name: 'Periksa target yang disarankan' })
  fireEvent.click(screen.getByRole('button', { name: 'Simpan draf' }))
  view.unmount()
  render(<TargetWizard actor={actor} teams={teams} transport={transport} now={new Date(2026, 9, 17)} />)
  reject(new Error('lost response'))
  await screen.findByRole('button', { name: 'Periksa hasil' })
})
it('never navigates back to the old plan when a save succeeds after moving to another plan', async () => {
  let finish!: (value: any) => void
  const onPlanSaved = vi.fn(), otherId = '30000000-0000-0000-0000-000000000002'
  const transport = adapter({ command: () => new Promise(resolve => { finish = resolve }), readPlan: async () => ({ ...plan, id: otherId }) })
  const view = render(<TargetWizard actor={actor} teams={teams} transport={transport} now={new Date(2026, 9, 17)} onPlanSaved={onPlanSaved} />)
  fireEvent.click(screen.getByRole('button', { name: 'Periksa usulan' })); await screen.findByRole('heading', { name: 'Periksa target yang disarankan' })
  fireEvent.click(screen.getByRole('button', { name: 'Simpan draf' }))
  view.rerender(<TargetWizard actor={actor} teams={teams} transport={transport} initialPlanId={otherId} onPlanSaved={onPlanSaved} />)
  await screen.findByRole('heading', { name: 'Tinjau pengajuan' })
  finish({ status: 'committed', requestId: 'synthetic', plan: { ...plan, state: 'draft' } })
  await waitFor(() => expect(screen.getByRole('link', { name: 'Buka rencana tersimpan' }).getAttribute('href')).toContain(otherId))
  expect(onPlanSaved).not.toHaveBeenCalled()
})
it('explicitly reviews roster drift, preserving unchanged targets and requiring a draft save before submit', async () => {
  const changed = { ...baseline, rosterHash: 'changed-roster', people: [...baseline.people, { personId: '10000000-0000-0000-0000-000000000004', name: 'Sales Baru', ownership: 'direct_report' as const, customers: [] }] }
  const transport = adapter({ readPlan: async () => ({ ...plan, state: 'returned', returnReason: 'Tinjau tim baru' }), readBaseline: async () => changed })
  render(<TargetWizard actor={actor} teams={teams} transport={transport} initialPlanId={plan.id} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Pulihkan draf tersimpan' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Tinjau perubahan tim' }))
  expect((screen.getByLabelText('Nilai PO masuk (Rp) · Sales Contoh A') as HTMLInputElement).value).toBe('80.00')
  expect((screen.getByLabelText('Nilai PO masuk (Rp) · Sales Baru') as HTMLInputElement).value).toBe('')
  expect((screen.getByRole('button', { name: 'Lanjut ke tinjauan' }) as HTMLButtonElement).disabled).toBe(true)
  expect(transport.command).not.toHaveBeenCalled()
})
it('does not send leadership into the salesperson-only summary route', () => {
  render(<TargetWizard actor={{ id: head, role: 'sales_head', active: true }} transport={adapter()} />)
  expect(screen.queryByRole('link', { name: 'Ringkasan Saya' })).toBeNull()
  expect(screen.getByText(/Pilih rencana pada daftar/)).toBeTruthy()
})
it('revalidates a clean saved plan when reopening and shows a later approver return', async () => {
  const transport = adapter()
  const first = render(<TargetWizard actor={actor} teams={teams} transport={transport} initialPlanId={plan.id} />)
  await screen.findByRole('heading', { name: 'Tinjau pengajuan' })
  first.unmount()
  transport.readPlan = vi.fn(async () => ({ ...plan, version: 2, state: 'returned', returnReason: 'Perbarui setelah peninjauan Head' }))
  render(<TargetWizard actor={actor} teams={teams} transport={transport} initialPlanId={plan.id} />)
  await screen.findByText('Perbarui setelah peninjauan Head')
  expect(transport.readPlan).toHaveBeenCalledTimes(1)
})

it('removes cached plan and baseline visibility after a definite scope denial', async () => {
  const transport = adapter()
  const reviewer = { id: head, role: 'sales_head', active: true }
  const first = render(<TargetWizard actor={reviewer} transport={transport} initialPlanId={plan.id} />)
  await screen.findByRole('button', { name: 'Setujui & terbitkan' })
  first.unmount()
  transport.readPlan = vi.fn(async () => { throw new TargetTransportError('Scope no longer permitted', 'rejected', '42501') })
  render(<TargetWizard actor={reviewer} transport={transport} initialPlanId={plan.id} />)
  await screen.findByText('Scope no longer permitted')
  expect(screen.queryByRole('button', { name: 'Setujui & terbitkan' })).toBeNull()
  expect(screen.queryByRole('region', { name: 'Total usulan per metrik' })).toBeNull()
})
