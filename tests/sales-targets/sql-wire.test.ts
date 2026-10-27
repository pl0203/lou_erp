import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeBaseline, decodePlan, decodePlansPage, decodeReceipt } from '../../src/lib/salesTargets/contracts'
import { connectTargetTransport } from '../../src/lib/salesTargets/transport'
// Opt-in evidence from the synthetic PostgreSQL runner, never a hosted database.
const directory = process.env.SALES_TARGETS_WIRE_DIR
const sample = (name: string) => JSON.parse(readFileSync(join(directory!, `${name}.json`), 'utf8'))
describe.skipIf(!directory)('actual synthetic SQL target wire', () => {
  it('decodes baseline amounts, ownership, months and warning semantics', () => { const value = sample('baseline'); expect(decodeBaseline({ month: value.month, managerId: value.managerId }, value)).toEqual(value) })
  it('decodes scoped saved plan and immutable baseline projection', () => { const value = sample('plan'); expect(decodePlan(value)).toEqual(value) })
  it('decodes a real atomic command receipt', () => { const value = sample('receipt'); expect(decodeReceipt(value.requestId, value)).toEqual(value) })
  it('never exposes predecessor baseline evidence or history in the salesperson plan projection', () => { const value = decodePlan(sample('own-plan')); expect(value.state).toBe('published'); expect(value.baselineSnapshot).toBeNull(); expect(value.auditEvents).toBeUndefined(); expect(value.auditEventsTruncated).toBeUndefined(); expect(new Set(value.lines.map(line => line.personId)).size).toBe(1) })
  it('decodes actual revision history with previous and changed values, reasons, actor and time', () => {
    const value = decodePlan(sample('audit-revision-plan'))
    const revision = value.auditEvents!.find(event => event.operation === 'propose_revision')!
    const edit = value.auditEvents!.find(event => event.operation === 'save_draft')!
    expect(value.auditEventsTruncated).toBe(false)
    expect(revision.before?.state).toBe('published')
    expect(revision.before?.lines[0].amount).toBe('120.00')
    expect(revision.after.lines[0].amount).toBe('120.00')
    expect(revision.reason).toBe('Synthetic audit revision rationale')
    expect(revision.actorName).toBe('Manager')
    expect(revision.actorId).toBe(value.managerId)
    expect(Number.isNaN(Date.parse(revision.occurredAt))).toBe(false)
    expect(edit.before?.lines[0].amount).toBe('120.00')
    expect(edit.after.lines[0].amount).toBe('130.00')
    expect(edit.after.lines[0].reason).toBe('Synthetic revised target')
    expect(Object.keys(edit.after).sort()).toEqual(['lines', 'people', 'state', 'version'])
  })
  it('preserves actual approver feedback for a returned plan', () => { const value = decodePlan(sample('returned-plan')); expect(value.state).toBe('returned'); expect(value.returnReason?.trim()).toBeTruthy() })
  it('decodes committed reconciliation while mutation capability is disabled', () => { const value = sample('reconcile-disabled'); expect(decodeReceipt(value.requestId, value).status).toBe('committed') })
  it('connects only when the actual capability projection is enabled', async () => {
    for (const [name, available] of [['capability', true], ['capability-disabled', false]] as const) {
      const result = await connectTargetTransport({ rpc: async () => ({ data: sample(name), error: null }) }, true, 'synthetic-sql')
      expect(result.capability.available).toBe(available)
    }
  })
  it('decodes the discoverable scoped target inbox', () => { const value = sample('plans'); expect(decodePlansPage({ month: value.month, page: value.page, pageSize: value.pageSize }, value)).toEqual(value) })
})
