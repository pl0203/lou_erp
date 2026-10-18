import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TargetAuditDetails } from '../../src/components/sales/TargetAuditDetails'
import { decodePlan } from '../../src/lib/salesTargets/contracts'
import type { TargetPlan } from '../../src/lib/salesTargets/contracts'
import { createRpcTargetTransport, TargetTransportError, unavailableTargetTransport } from '../../src/lib/salesTargets/transport'
const manager = '10000000-0000-0000-0000-000000000001', rep = '10000000-0000-0000-0000-000000000002', head = '10000000-0000-0000-0000-000000000003'
const actor = { id: manager, role: 'sales_manager', active: true }
const lines = ['po_order_value', 'po_delivery_value', 'co_sale_value'].map(metric => ({ personId: rep, metric: metric as any, amount: '80.00', applicability: 'target' as const, reason: null }))
const snapshot = { state: 'draft' as const, version: 1, lines, people: [{ personId: rep, name: 'Sales Contoh A' }] }
const audit = [{ id: '1', operation: 'propose_revision' as const, actorId: manager, actorName: 'Manager Contoh', occurredAt: '2026-10-17T12:00:00Z', reason: 'Penyesuaian stok warisan', before: { ...snapshot, state: 'published' as const, version: 2 }, after: snapshot }, { id: '2', operation: 'save_draft' as const, actorId: manager, actorName: 'Manager Contoh', occurredAt: '2026-10-17T12:10:00Z', reason: null, before: snapshot, after: { ...snapshot, version: 2, lines: lines.map((line, i) => i === 0 ? { ...line, amount: '130.00', reason: 'Rencana pelanggan ditinjau ulang' } : line) } }]
const plan: TargetPlan = { id: '30000000-0000-0000-0000-000000000001', month: '2026-11-01', managerId: manager, version: 2, state: 'draft', rosterHash: 'synthetic', currency: 'IDR', lines, proposedBy: manager, publishedBy: null, publishedAt: null, warnings: [], auditEvents: audit, auditEventsTruncated: false }
const transport = () => ({ ...unavailableTargetTransport, capability: { available: true, schemaVersion: 1 as const }, readPlan: vi.fn(async () => plan) })
afterEach(cleanup)
async function openHistory() { fireEvent.click(screen.getByText('Riwayat perubahan & persetujuan')); await screen.findByText('Penyesuaian stok warisan') }
it('loads exact saved history on demand and shows previous/new values, both reasons, actor and time', async () => {
  const api = transport()
  render(<TargetAuditDetails actor={actor} plan={plan} transport={api} />)
  expect(api.readPlan).not.toHaveBeenCalled()
  await openHistory()
  const changed = screen.getByRole('article', { name: 'Simpan draf · versi 2' })
  expect(within(changed).getByText('Sales Contoh A')).toBeTruthy()
  expect(within(changed).getByText('Sebelum: Rp80')).toBeTruthy()
  expect(within(changed).getByText('Sesudah: Rp130')).toBeTruthy()
  expect(within(changed).getByText('Alasan baru: Rencana pelanggan ditinjau ulang')).toBeTruthy()
  expect(within(changed).getByText(/Manager Contoh/)).toBeTruthy()
  expect(within(changed).getByText(/12.10.00 UTC/)).toBeTruthy()
  expect(api.readPlan).toHaveBeenCalledWith(plan.id)
})
it('does not request or expose audit data for salespeople', () => {
  const api = transport()
  render(<TargetAuditDetails actor={{ id: rep, role: 'sales_person', active: true }} plan={plan} transport={api} />)
  expect(screen.queryByText('Riwayat perubahan & persetujuan')).toBeNull()
  expect(api.readPlan).not.toHaveBeenCalled()
})
it('reports unavailable audit projection without inventing audit facts', async () => {
  const api = { ...transport(), readPlan: vi.fn(async () => ({ ...plan, auditEvents: undefined, auditEventsTruncated: undefined })) }
  render(<TargetAuditDetails actor={actor} plan={plan} transport={api} />)
  fireEvent.click(screen.getByText('Riwayat perubahan & persetujuan'))
  await screen.findByText(/Riwayat belum tersedia dari API/)
  expect(screen.queryByText('Manager Contoh')).toBeNull()
})
it('forwards a fresh scope denial and never reuses previously loaded history', async () => {
  const api = transport(), denied = vi.fn()
  const view = render(<TargetAuditDetails actor={{ id: head, role: 'sales_head', active: true }} plan={plan} transport={api} onAccessDenied={denied} />)
  await openHistory()
  api.readPlan.mockRejectedValue(new TargetTransportError('Scope denied', 'rejected', '42501'))
  view.rerender(<TargetAuditDetails actor={{ id: head, role: 'sales_head', active: true }} plan={{ ...plan, version: 3 }} transport={api} onAccessDenied={denied} />)
  await waitFor(() => expect(denied).toHaveBeenCalledTimes(1))
  expect(screen.queryByText('Penyesuaian stok warisan')).toBeNull()
})
it('strictly decodes audit fields and rejects duplicate events, numeric money and invented actor identity', () => {
  expect(decodePlan(plan).auditEvents).toEqual(audit)
  expect(() => decodePlan({ ...plan, auditEvents: [audit[0], audit[0]] })).toThrow()
  expect(() => decodePlan({ ...plan, auditEvents: [{ ...audit[0], actorId: 'not-a-uuid' }] })).toThrow()
  expect(() => decodePlan({ ...plan, auditEvents: [{ ...audit[0], after: { ...snapshot, lines: [{ ...lines[0], amount: 80 }] } }] })).toThrow()
})
it('explicitly discloses a truncated history window without claiming complete history', async () => {
  const api = { ...transport(), readPlan: vi.fn(async () => ({ ...plan, auditEventsTruncated: true })) }
  render(<TargetAuditDetails actor={actor} plan={plan} transport={api} />)
  await openHistory()
  expect(screen.getByText(/Ada catatan lebih lama yang tidak ditampilkan/)).toBeTruthy()
})
it('shows malformed RPC history as a visible error instead of displaying unvalidated facts', async () => {
  const rpc = vi.fn(async () => ({ data: { ...plan, auditEvents: [{ ...audit[0], actorId: 'invalid' }] }, error: null }))
  const api = createRpcTargetTransport({ rpc }, { available: true, schemaVersion: 1 }, 'synthetic')
  render(<TargetAuditDetails actor={actor} plan={plan} transport={api} />)
  fireEvent.click(screen.getByText('Riwayat perubahan & persetujuan'))
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByText('Penyesuaian stok warisan')).toBeNull()
  expect(screen.getByRole('button', { name: 'Coba muat riwayat lagi' })).toBeTruthy()
})
it('links the prior plan through its normal scoped read and displays a server denial without old history', async () => {
  const previousPlanId = '30000000-0000-0000-0000-000000000099', rpc = vi.fn(async () => ({ data: null, error: { code: '42501', message: 'Prior plan scope denied' } }))
  const api = createRpcTargetTransport({ rpc }, { available: true, schemaVersion: 1 }, 'synthetic'), denied = vi.fn()
  const view = render(<TargetAuditDetails actor={actor} plan={{ ...plan, previousPlanId }} transport={api} onAccessDenied={denied} />)
  fireEvent.click(screen.getByText('Riwayat perubahan & persetujuan'))
  expect(screen.getByRole('link', { name: 'Buka rencana sebelumnya dan riwayatnya' }).getAttribute('href')).toBe(`/girard/targets?plan=${previousPlanId}`)
  await screen.findByText('Prior plan scope denied')
  view.rerender(<TargetAuditDetails actor={actor} plan={{ ...plan, id: previousPlanId }} transport={api} onAccessDenied={denied} />)
  await waitFor(() => expect(rpc).toHaveBeenLastCalledWith('pilot_sales_target_plan_v1', { p_plan_id: previousPlanId }))
  await waitFor(() => expect(denied).toHaveBeenCalledTimes(2))
  expect(screen.queryByText('Penyesuaian stok warisan')).toBeNull()
})
it('ignores a pending history response after the disclosure is closed', async () => {
  let complete!: (value: TargetPlan) => void
  const api = { ...transport(), readPlan: vi.fn(() => new Promise<TargetPlan>(resolve => { complete = resolve })) }
  render(<TargetAuditDetails actor={actor} plan={plan} transport={api} />)
  fireEvent.click(screen.getByText('Riwayat perubahan & persetujuan'))
  await waitFor(() => expect(api.readPlan).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByText('Riwayat perubahan & persetujuan'))
  await waitFor(() => expect(screen.getByText('Riwayat perubahan & persetujuan').closest('details')?.open).toBe(false))
  await act(async () => { complete(plan) })
  expect(screen.queryByText('Penyesuaian stok warisan')).toBeNull()
})
it('ignores an old plan response after switching to another plan', async () => {
  let complete!: (value: TargetPlan) => void
  const next = { ...plan, id: '30000000-0000-0000-0000-000000000088', auditEvents: [{ ...audit[0], reason: 'Current plan reason' }] }
  const api = { ...transport(), readPlan: vi.fn((id: string) => id === plan.id ? new Promise<TargetPlan>(resolve => { complete = resolve }) : Promise.resolve(next)) }
  const view = render(<TargetAuditDetails actor={actor} plan={plan} transport={api} />)
  fireEvent.click(screen.getByText('Riwayat perubahan & persetujuan'))
  await waitFor(() => expect(api.readPlan).toHaveBeenCalledWith(plan.id))
  view.rerender(<TargetAuditDetails actor={actor} plan={next} transport={api} />)
  await screen.findByText('Current plan reason')
  await act(async () => { complete(plan) })
  expect(screen.queryByText('Penyesuaian stok warisan')).toBeNull()
  expect(screen.getByText('Current plan reason')).toBeTruthy()
})
