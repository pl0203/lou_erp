import { decodeBaseline, decodePlan, decodePlansPage, decodeReceipt, validMonth, validUuid } from './contracts'
import type { CommandReceipt, PlanningRequest, ReconcileReceipt, TargetBaseline, TargetCommand, TargetPlan, TargetPlansPage, TargetPlansRequest } from './contracts'
export type { TargetCommand, TargetPlan } from './contracts'
export type TargetCapability = { available: boolean; schemaVersion: 1; reason?: string }
export interface TargetTransport {
  readonly scope: string
  readonly capability: TargetCapability
  readBaseline(request: PlanningRequest): Promise<TargetBaseline>
  readPlan(planId: string): Promise<TargetPlan>
  readPlans(request: TargetPlansRequest): Promise<TargetPlansPage>
  command(command: TargetCommand): Promise<CommandReceipt>
  reconcile(requestId: string): Promise<ReconcileReceipt>
}
export class TargetTransportError extends Error {
  outcome: 'rejected' | 'unknown'
  code?: string
  constructor(message: string, outcome: 'rejected' | 'unknown', code?: string) { super(message); this.name = 'TargetTransportError'; this.outcome = outcome; this.code = code }
}
export type TargetRpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }
const unavailable = 'Target bulanan baru belum tersedia. API dan izin belum diaktifkan; target lama tidak dikonversi otomatis.'
export const unavailableTargetTransport: TargetTransport = {
  scope: 'targets-unavailable', capability: { available: false, schemaVersion: 1, reason: unavailable },
  async readBaseline() { throw new TargetTransportError(unavailable, 'rejected') },
  async readPlans() { throw new TargetTransportError(unavailable, 'rejected') },
  async readPlan() { throw new TargetTransportError(unavailable, 'rejected') },
  async command() { throw new TargetTransportError(unavailable, 'rejected') },
  async reconcile() { throw new TargetTransportError(unavailable, 'rejected') },
}
function assertCommand(command: TargetCommand) {
  if (!validUuid(command.requestId) || !['save_draft', 'submit', 'return', 'approve_publish', 'propose_revision'].includes(command.operation)) throw new TargetTransportError('Perintah target tidak valid.', 'rejected')
  const payload = command.payload
  if (payload.expectedVersion !== null && (!Number.isSafeInteger(payload.expectedVersion) || payload.expectedVersion < 1)) throw new TargetTransportError('Versi target tidak valid.', 'rejected')
  if (payload.planId !== undefined && !validUuid(payload.planId)) throw new TargetTransportError('Identitas target tidak valid.', 'rejected')
  if ((payload.expectedVersion === null) !== (payload.planId === undefined)) throw new TargetTransportError('Versi dan identitas target tidak cocok.', 'rejected')
  if (['save_draft', 'submit'].includes(command.operation)) {
    if (!validMonth(payload.month) || !validUuid(payload.managerId) || !payload.rosterHash || !Array.isArray(payload.lines)) throw new TargetTransportError('Bulan, tim, dan isi target diperlukan.', 'rejected')
  } else if (!payload.planId || (['return', 'propose_revision'].includes(command.operation) && !payload.reason?.trim())) throw new TargetTransportError('Rencana dan alasan diperlukan.', 'rejected')
}
export function assertReceiptBinding(command: TargetCommand, receipt: CommandReceipt) {
  if (receipt.requestId !== command.requestId) throw new Error('Permintaan hasil target tidak cocok.')
  const { payload, operation } = command, plan = receipt.plan
  if ((payload.planId && operation !== 'propose_revision' && payload.planId !== plan.id) || (payload.month && payload.month !== plan.month) || (payload.managerId && payload.managerId !== plan.managerId) || (operation === 'propose_revision' && (plan.previousPlanId !== payload.planId || plan.id === payload.planId))) throw new Error('Hasil target tidak sesuai permintaan.')
  const expected = operation === 'propose_revision' || payload.expectedVersion === null ? 1 : payload.expectedVersion + 1
  if (plan.version !== expected) throw new Error('Versi hasil target tidak sesuai permintaan.')
  const states = { save_draft: ['draft', 'returned'], submit: ['submitted'], return: ['returned'], approve_publish: ['published'], propose_revision: ['draft'] }
  if (!states[operation].includes(plan.state)) throw new Error('Status hasil target tidak sesuai permintaan.')
}
/** Injection boundary. No environment lookup, authentication change, fallback or automatic capability enabling. */
export function createRpcTargetTransport(client: TargetRpcClient, capability: TargetCapability, scope: string): TargetTransport {
  const config = Object.freeze({ ...capability })
  function ready() { if (!config.available || config.schemaVersion !== 1) throw new TargetTransportError(config.reason || unavailable, 'rejected') }
  async function rpc(name: string, args: Record<string, unknown>, write = false): Promise<unknown> {
    ready()
    let result: { data: unknown; error: unknown }
    try { result = await client.rpc(name, args) } catch { throw new TargetTransportError(write ? 'Hasil belum terkonfirmasi. Periksa hasil sebelum mencoba lagi.' : 'Data target gagal dimuat. Coba lagi.', write ? 'unknown' : 'rejected') }
    if (result.error) {
      const error = result.error as { code?: unknown; message?: unknown }
      // A structured PostgreSQL rejection proves rollback. Gateway/network failures do not.
      const definite = typeof error.code === 'string' && (/^(22|23|40|42|P0)/.test(error.code) || error.code === '55000')
      throw new TargetTransportError(definite && typeof error.message === 'string' ? error.message : 'Hasil belum terkonfirmasi. Periksa hasil sebelum mencoba lagi.', write && !definite ? 'unknown' : 'rejected', typeof error.code === 'string' ? error.code : undefined)
    }
    return result.data
  }
  return {
    scope, capability: config,
    async readBaseline(request) { return decodeBaseline(request, await rpc('pilot_sales_target_baseline_v1', { p_month: request.month, p_manager_id: request.managerId })) },
    async readPlans(request) { return decodePlansPage(request, await rpc('pilot_sales_target_plans_v1', { p_month: request.month, p_page: request.page, p_page_size: request.pageSize })) },
    async readPlan(planId) {
      if (!validUuid(planId)) throw new TargetTransportError('Identitas target tidak valid.', 'rejected')
      const plan = decodePlan(await rpc('pilot_sales_target_plan_v1', { p_plan_id: planId }))
      if (plan.id !== planId) throw new Error('Rencana target tidak sesuai permintaan.')
      return plan
    },
    async command(command) {
      ready(); assertCommand(command)
      const data = await rpc('pilot_sales_target_command_v1', { p_request_id: command.requestId, p_operation: command.operation, p_payload: command.payload }, true)
      try {
        const receipt = decodeReceipt(command.requestId, data)
        if (receipt.status !== 'committed') throw new Error('Hasil belum diketahui.')
        assertReceiptBinding(command, receipt)
        return receipt
      } catch { throw new TargetTransportError('Hasil belum terkonfirmasi. Periksa hasil sebelum mencoba lagi.', 'unknown') }
    },
    async reconcile(requestId) {
      if (!validUuid(requestId)) throw new TargetTransportError('Identitas permintaan tidak valid.', 'rejected')
      return decodeReceipt(requestId, await rpc('pilot_sales_target_reconcile_v1', { p_request_id: requestId }))
    },
  }
}

/** Explicit rollout AND exact server capability are both required; default makes zero RPC calls. */
export async function connectTargetTransport(client: TargetRpcClient, enabled: boolean, scope: string): Promise<TargetTransport> {
  if (!enabled) return unavailableTargetTransport
  try {
    const { data, error } = await client.rpc('pilot_sales_targets_capability_v1', {})
    const capability = data as { schemaVersion?: unknown; available?: unknown } | null
    if (error || !capability || Object.keys(capability).sort().join(',') !== 'available,schemaVersion' || capability.schemaVersion !== 1 || capability.available !== true) return unavailableTargetTransport
    return createRpcTargetTransport(client, { schemaVersion: 1, available: true }, scope)
  } catch { return unavailableTargetTransport }
}
