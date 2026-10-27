import { describe, expect, it, vi } from 'vitest'
import { createRpcTargetTransport, unavailableTargetTransport, TargetTransportError } from '../../src/lib/salesTargets/transport'
import { TargetCommandRecovery } from '../../src/lib/salesTargets/recovery'
import { canApprove } from '../../src/lib/salesTargets/definitions'
import type { TargetCommand, TargetPlan, TargetTransport } from '../../src/lib/salesTargets/transport'
const actor = '10000000-0000-0000-0000-000000000001', id = '10000000-0000-0000-0000-000000000002'
const plan: TargetPlan = { id, month: '2026-11-01', managerId: actor, version: 1, state: 'draft', rosterHash: 'synthetic', currency: 'IDR', lines: [], proposedBy: actor, publishedBy: null, publishedAt: null, warnings: [] }
const command: TargetCommand = { requestId: '10000000-0000-0000-0000-000000000003', operation: 'save_draft', payload: { expectedVersion: null, month: plan.month, managerId: actor, rosterHash: plan.rosterHash, lines: [] } }
const committed = { status: 'committed' as const, requestId: command.requestId, plan }
function adapter(overrides: Partial<TargetTransport> = {}): TargetTransport { return { scope: 'synthetic-only', capability: { available: true, schemaVersion: 1 }, readBaseline: vi.fn(), readPlans: vi.fn(), readPlan: vi.fn(), command: vi.fn(async () => committed), reconcile: vi.fn(async () => committed), ...overrides } }
describe('safe target command recovery', () => {
  it('does not send a duplicate command while sending or uncertain', async () => {
    const transport = adapter({ command: vi.fn(async () => { throw Error('lost response') }) }), recovery = new TargetCommandRecovery(transport)
    await expect(recovery.execute(command)).rejects.toThrow()
    expect(recovery.snapshot.phase).toBe('uncertain')
    await expect(recovery.execute(command)).rejects.toThrow(/Periksa hasil/)
    expect(transport.command).toHaveBeenCalledTimes(1)
    expect(await recovery.reconcile()).toEqual(committed)
    expect(recovery.snapshot.phase).toBe('idle')
    expect(transport.command).toHaveBeenCalledTimes(1)
  })
  it('only permits explicit same-request retry after reconciliation proves not_found', async () => {
    let calls = 0
    const transport = adapter({ command: vi.fn(async () => { if (!calls++) throw Error('lost response'); return committed }), reconcile: vi.fn(async () => ({ status: 'not_found', requestId: command.requestId })) })
    const recovery = new TargetCommandRecovery(transport)
    await expect(recovery.execute(command)).rejects.toThrow()
    await recovery.reconcile()
    expect(recovery.snapshot.phase).toBe('retryable')
    expect(transport.command).toHaveBeenCalledTimes(1)
    await recovery.retry()
    expect(transport.command).toHaveBeenNthCalledWith(2, command)
  })
  it('retains frozen command and does not convert malformed receipt into success', async () => {
    const rpc = vi.fn(async () => ({ data: { ...committed, requestId: id }, error: null }))
    const transport = createRpcTargetTransport({ rpc }, { available: true, schemaVersion: 1 }, 'synthetic')
    const recovery = new TargetCommandRecovery(transport)
    const edited = structuredClone(command)
    const pending = recovery.execute(edited); edited.payload.month = '2028-01-01'
    await expect(pending).rejects.toThrow()
    expect(recovery.snapshot.command?.payload.month).toBe('2026-11-01')
    expect(recovery.snapshot.phase).toBe('uncertain')
  })
  it('does not reconcile or block retry for a definite server rejection', async () => {
    const recovery = new TargetCommandRecovery(adapter({ command: async () => { throw new TargetTransportError('Roster berubah', 'rejected') } }))
    await expect(recovery.execute(command)).rejects.toThrow(/Roster/)
    expect(recovery.snapshot.phase).toBe('idle')
  })
  it('fails closed without capability and never calls the transport', async () => {
    const rpc = vi.fn(), transport = createRpcTargetTransport({ rpc }, { available: false, schemaVersion: 1 }, 'synthetic')
    await expect(transport.command(command)).rejects.toThrow(/belum tersedia/)
    await expect(transport.readBaseline({ month: '2026-11-01', managerId: actor })).rejects.toThrow()
    expect(rpc).not.toHaveBeenCalled()
    expect(unavailableTargetTransport.capability.available).toBe(false)
  })
  it('shows independent Head or executive approval and never self-approval', () => {
    const submitted = { ...plan, state: 'submitted' as const }
    expect(canApprove({ id, role: 'sales_head', active: true }, submitted)).toBe(true)
    expect(canApprove({ id, role: 'executive', active: true }, submitted)).toBe(true)
    expect(canApprove({ id: actor, role: 'executive', active: true }, submitted)).toBe(false)
    expect(canApprove({ id, role: 'sales_person', active: true }, submitted)).toBe(false)
  })
})
it('keeps recovery uncertain when reconcile returns a different plan or version', async () => {
  const update = { ...command, payload: { ...command.payload, planId: plan.id, expectedVersion: 1 } }
  const transport = adapter({ command: async () => { throw Error('lost response') }, reconcile: async () => ({ ...committed, plan: { ...plan, id: '10000000-0000-0000-0000-000000000099', version: 2 } }) })
  const recovery = new TargetCommandRecovery(transport)
  await expect(recovery.execute(update)).rejects.toThrow()
  await expect(recovery.reconcile()).rejects.toThrow()
  expect(recovery.snapshot.phase).toBe('uncertain')
})
it('treats a PostgreSQL disabled-capability rejection as definite rollback, not an unknown send', async () => {
  const transport = createRpcTargetTransport({ rpc: async () => ({ data: null, error: { code: '55000', message: 'Sales targets capability disabled' } }) }, { available: true, schemaVersion: 1 }, 'synthetic')
  const recovery = new TargetCommandRecovery(transport)
  await expect(recovery.execute(command)).rejects.toMatchObject({ outcome: 'rejected' })
  expect(recovery.snapshot.phase).toBe('idle')
})
