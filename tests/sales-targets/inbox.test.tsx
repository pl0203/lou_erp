import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TargetPlanInbox } from '../../src/components/sales/TargetPlanInbox'
import { connectTargetTransport, unavailableTargetTransport } from '../../src/lib/salesTargets/transport'
const managerId = '10000000-0000-0000-0000-000000000001', id = '10000000-0000-0000-0000-000000000002'
afterEach(cleanup)
it('lists approved own targets for salesperson and an approval inbox for leadership', async () => {
  const readPlans = vi.fn(async request => ({ schemaVersion: 1 as const, month: request.month, page: request.page, pageSize: request.pageSize, total: 1, items: [{ id, month: request.month, managerId, managerName: 'Manager Contoh', version: 2, state: 'submitted' as const, proposedBy: managerId, publishedAt: null }] }))
  const onOpen = vi.fn()
  render(<TargetPlanInbox actor={{ id: managerId, role: 'sales_head', active: true }} transport={{ ...unavailableTargetTransport, capability: { available: true, schemaVersion: 1 }, readPlans }} onOpen={onOpen} now={new Date(2026, 9, 17)} />)
  await screen.findByText('Manager Contoh')
  fireEvent.click(screen.getByRole('button', { name: 'Tinjau pengajuan' }))
  expect(onOpen).toHaveBeenCalledWith(id)
  expect(readPlans).toHaveBeenCalledWith({ month: '2026-11-01', page: 1, pageSize: 10 })
})
it('uses both explicit rollout flag and verified exact capability before enabling RPC adapter', async () => {
  const rpc = vi.fn(async () => ({ data: { schemaVersion: 1, available: true }, error: null }))
  expect((await connectTargetTransport({ rpc }, false, 'synthetic')).capability.available).toBe(false)
  expect(rpc).not.toHaveBeenCalled()
  expect((await connectTargetTransport({ rpc }, true, 'synthetic')).capability.available).toBe(true)
  expect(rpc).toHaveBeenCalledWith('pilot_sales_targets_capability_v1', {})
  rpc.mockResolvedValue({ data: { schemaVersion: 2, available: true }, error: null })
  expect((await connectTargetTransport({ rpc }, true, 'synthetic')).capability.available).toBe(false)
})
it('refreshes the inbox after a command without changing the selected month', async () => {
  const readPlans = vi.fn(async request => ({ schemaVersion: 1 as const, ...request, total: 0, items: [] })), transport = { ...unavailableTargetTransport, capability: { available: true, schemaVersion: 1 as const }, readPlans }
  const actor = { id: managerId, role: 'sales_head', active: true }, onOpen = vi.fn()
  const view = render(<TargetPlanInbox actor={actor} transport={transport} onOpen={onOpen} refreshKey={0} />)
  await screen.findByText(/Belum ada rencana/)
  view.rerender(<TargetPlanInbox actor={actor} transport={transport} onOpen={onOpen} refreshKey={1} />)
  await screen.findByText(/Belum ada rencana/)
  expect(readPlans).toHaveBeenCalledTimes(2)
})
