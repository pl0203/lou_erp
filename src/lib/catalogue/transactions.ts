import type {
  CatalogueMaintainerRole, CatalogueOperation, CatalogueOperationPayloads, CatalogueReceipt,
  CatalogueReceiptBinding, CatalogueRecovery, CatalogueRequestBinding,
} from './contracts'
import {
  catalogueEnum, catalogueRecord, decodeProcurementAccessV2, exactCatalogueFields, invalidCatalogue,
  parseCataloguePayload, parseCatalogueReceipt, parseCatalogueRecovery, parseCatalogueRequestBinding,
  parseCatalogueText, parseCatalogueUUID,
} from './validation'

export interface CatalogueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}
export type CatalogueRpcName = 'pilot_catalog_transaction_v1' | 'pilot_reconcile_catalog_v1'
export interface CatalogueTransport {
  /** The adapter must construct this label and its RPC client from the same backend. */
  readonly backend: string
  /** Cross-context exclusive ownership until action settles (e.g. native Web Locks).
   * Fail closed if unavailable; a per-instance/module mutex is not sufficient. */
  withExclusiveLock<T>(key: string, action: () => Promise<T>): Promise<T>
  rpc(name: CatalogueRpcName, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>
}
export interface CatalogueSenderOptions {
  backend: string
  actorId: string
  role: CatalogueMaintainerRole
  /** Stable entity/form scope, reused on reload and changed for a different form owner. */
  scope: string
  storage: () => CatalogueStorage
  /** Obtain fresh v2 authority for this exact binding; never return cached/aborted authority. */
  authorize(binding: Readonly<CatalogueRequestBinding>): Promise<unknown>
  /** Includes mounted form owner, actor, backend, role and current authority epoch. */
  isCurrent(): boolean
}
export type CatalogueTransactionSender = {
  <K extends CatalogueOperation>(operation: K, payload: CatalogueOperationPayloads[K]): Promise<CatalogueReceipt>
  hasUnresolved(): boolean
  reconcile(abandon?: boolean): Promise<CatalogueRecovery>
  /** Call only after the owner has accepted canonical current state, including a deleted target. */
  acknowledgeRecovered(): Promise<void>
}
interface Pending {
  version: 1
  backend: string
  actor_id: string
  role: CatalogueMaintainerRole
  scope: string
  request_id: string
  fingerprint: string
  binding: CatalogueRequestBinding
  receipt?: CatalogueReceipt
}
const unresolved = () => new Error('Hasil penyimpanan sebelumnya belum terkonfirmasi. Pulihkan hasilnya sebelum menyimpan lagi.')
const busy = () => new Error('Penyimpanan atau pemulihan katalog masih berlangsung.')
const domainMessages = {
  CATALOG_VERSION_CONFLICT: 'Data katalog berubah. Muat ulang dan periksa perubahan sebelum menyimpan kembali.',
  CATALOG_DISABLED: 'Referensi katalog dinonaktifkan. Aktifkan kembali sebelum menambah permintaan baru.',
  CATALOG_IDENTITY_CONFLICT: 'Identitas katalog berubah. Muat ulang dan periksa data sebelum melanjutkan.',
  CATALOG_DELETE_BLOCKED: 'Penggunaan atau riwayat data belum dapat dikesampingkan. Gunakan Nonaktifkan bila sesuai.',
  CATALOG_TRACKING_INCOMPLETE: 'Pelacakan riwayat katalog belum lengkap. Penghapusan belum tersedia.',
  CATALOG_GENERATION_RETIRED: 'Pembaruan aplikasi diperlukan sebelum menyimpan. Jangan kirim ulang melalui versi lama.',
} as const
export type CatalogueErrorCode = keyof typeof domainMessages
export class CatalogueCommandError extends Error {
  readonly code: CatalogueErrorCode
  constructor(code: CatalogueErrorCode) {
    super(domainMessages[code])
    this.name = 'CatalogueCommandError'
    this.code = code
  }
}
function knownDetail(value: unknown): CatalogueErrorCode | undefined {
  if (typeof value === 'string' && Object.hasOwn(domainMessages, value)) return value as CatalogueErrorCode
}
function domainCode(details: unknown): CatalogueErrorCode | undefined {
  const plain = knownDetail(details)
  if (plain || typeof details !== 'string') return plain
  try {
    const row = exactCatalogueFields(JSON.parse(details), ['code'])
    return knownDetail(row.code)
  } catch { return undefined }
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]))
  return value
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)) }
async function fingerprint(operation: CatalogueOperation, payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([operation, canonical(payload)]))
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
}
function rpcError(error: unknown): Error {
  const row = catalogueRecord(error)
  const code = domainCode(row.details)
  if (code) return new CatalogueCommandError(code)
  const message = row.code === 'PGRST202' || row.code === '42883'
    ? 'Pembaruan database diperlukan sebelum menyimpan. Jangan kirim ulang melalui versi lama.'
    : typeof row.message === 'string' ? row.message : 'Hasil penyimpanan belum dapat dikonfirmasi.'
  return Object.assign(new Error(message), typeof row.code === 'string' ? { code: row.code } : {})
}

/**
 * Shares the CO/PO sender's canonical digest and write-before-dispatch pattern.
 * Its state machine is intentionally narrower: unresolved requests never resend,
 * reconciliation never abandons implicitly, and every success stays durable.
 * No Supabase singleton, ambient backend configuration, target lookup or legacy RPC.
 */
export function createCatalogueTransactionSender(options: CatalogueSenderOptions, transport: CatalogueTransport): CatalogueTransactionSender {
  const backend = parseCatalogueText(options.backend), actorId = parseCatalogueUUID(options.actorId)
  const role = catalogueEnum(['co_admin', 'po_admin', 'executive'] as const, options.role), scope = parseCatalogueText(options.scope)
  if (!backend || !scope || !transport || transport.backend !== backend || typeof transport.rpc !== 'function'
    || typeof transport.withExclusiveLock !== 'function'
    || typeof options.authorize !== 'function' || typeof options.isCurrent !== 'function' || typeof options.storage !== 'function') invalidCatalogue('sender scope')
  const storageProvider = options.storage, authorize = options.authorize, isCurrent = options.isCurrent
  const key = `catalogue-request:${encodeURIComponent(JSON.stringify([backend, actorId, role, 1, scope]))}`
  let inFlight = false, usedStorage: CatalogueStorage | undefined
  function current() {
    if (!isCurrent() || transport.backend !== backend) invalidCatalogue('identity changed')
  }
  function storage(): CatalogueStorage {
    const value = storageProvider()
    if (!value || usedStorage && usedStorage !== value) invalidCatalogue('storage changed')
    usedStorage = value
    return value
  }
  function receiptBinding(request: Pending): CatalogueReceiptBinding {
    return { ...request.binding, actor_id: actorId, request_id: request.request_id }
  }
  function read(): Pending | null {
    const raw = storage().getItem(key)
    if (raw === null) return null
    const row = catalogueRecord(JSON.parse(raw))
    exactCatalogueFields(row, ['version', 'backend', 'actor_id', 'role', 'scope', 'request_id', 'fingerprint', 'binding', ...(Object.hasOwn(row, 'receipt') ? ['receipt'] : [])])
    if (row.version !== 1 || row.backend !== backend || row.actor_id !== actorId || row.role !== role || row.scope !== scope) invalidCatalogue('recovery scope')
    if (typeof row.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(row.fingerprint)) invalidCatalogue('request fingerprint')
    const request: Pending = { version: 1, backend, actor_id: actorId, role, scope,
      request_id: parseCatalogueUUID(row.request_id), fingerprint: row.fingerprint, binding: parseCatalogueRequestBinding(row.binding) }
    if (Object.hasOwn(row, 'receipt')) request.receipt = parseCatalogueReceipt(row.receipt, receiptBinding(request))
    return request
  }
  function unchanged(expected: Pending): Pending {
    const stored = read()
    if (!stored || !same(stored, expected)) invalidCatalogue('recovery changed')
    return stored
  }
  function save(request: Pending) {
    current()
    const target = storage(), raw = JSON.stringify(request)
    target.setItem(key, raw)
    // Storage may throw or silently fail. Neither permits dispatch or confirmed success.
    if (target.getItem(key) !== raw) invalidCatalogue('recovery persistence')
    current()
  }
  function remove(request: Pending) {
    current()
    unchanged(request)
    const target = storage()
    target.removeItem(key)
    if (target.getItem(key) !== null) invalidCatalogue('recovery removal')
    current()
  }
  async function requireAuthority(binding: CatalogueRequestBinding) {
    current()
    const access = decodeProcurementAccessV2(await authorize(Object.freeze({ ...binding })), { actorId, role })
    current()
    if (binding.operation === 'delete_unused') {
      if (role !== 'co_admin' || access[`${binding.kind}_delete_mode`] !== 'guarded') invalidCatalogue('guarded delete authority')
    } else if (!access[`${binding.kind}_${binding.operation}`]) invalidCatalogue('operation authority')
  }
  async function exclusively<T>(action: () => Promise<T>): Promise<T> {
    if (inFlight) throw busy()
    inFlight = true
    try {
      current()
      const result = await transport.withExclusiveLock(key, async () => {
        current()
        return action()
      })
      // Releasing a native lock is another async boundary; the original owner must still be current.
      current()
      return result
    } finally { inFlight = false }
  }
  async function reconcile(abandon: boolean): Promise<CatalogueRecovery> {
    current()
    if (typeof abandon !== 'boolean') invalidCatalogue('abandon')
    const request = read()
    if (!request) return { status: 'unknown' }
    await requireAuthority(request.binding)
    unchanged(request)
    const { data, error } = await transport.rpc('pilot_reconcile_catalog_v1', { p_request_id: request.request_id, p_abandon: abandon })
    current()
    unchanged(request)
    if (error) throw rpcError(error)
    const result = parseCatalogueRecovery(data, receiptBinding(request))
    if (request.receipt && (result.status !== 'committed' || !same(result.receipt, request.receipt))) invalidCatalogue('changed committed recovery')
    if (result.status === 'committed') save({ ...request, receipt: result.receipt })
    else if (result.status === 'abandoned') remove(request)
    return result
  }
  const send = async <K extends CatalogueOperation>(operation: K, input: CatalogueOperationPayloads[K]): Promise<CatalogueReceipt> => {
    if (inFlight) throw busy()
    // Capture before lock acquisition too: a different tab may hold the lock while this form changes.
    const payload = parseCataloguePayload(operation, input)
    const { kind } = payload
    const rawBinding = operation === 'create' ? { operation, kind }
      : { operation, kind, id: (payload as CatalogueOperationPayloads['edit']).id,
        expected_version: (payload as CatalogueOperationPayloads['edit']).expected_version,
        ...(operation === 'set_enabled' ? { is_enabled: (payload as CatalogueOperationPayloads['set_enabled']).is_enabled } : {}) }
    const binding = parseCatalogueRequestBinding(rawBinding)
    return exclusively(async () => {
      if (read()) throw unresolved()
      await requireAuthority(binding)
      const hash = await fingerprint(operation, payload)
      current()
      // Reread under the same cross-context lock immediately before persistence and dispatch.
      if (read()) throw unresolved()
      const request: Pending = { version: 1, backend, actor_id: actorId, role, scope,
        request_id: parseCatalogueUUID(crypto.randomUUID()), fingerprint: hash, binding }
      save(request)
      const { data, error } = await transport.rpc('pilot_catalog_transaction_v1', { p_request_id: request.request_id, p_operation: operation, p_payload: payload })
      current()
      unchanged(request)
      // Even a definitive refusal requires explicit terminal reconciliation before a different request.
      if (error) throw rpcError(error)
      const receipt = parseCatalogueReceipt(data, receiptBinding(request))
      save({ ...request, receipt })
      return receipt
    })
  }
  return Object.assign(send, {
    // Advisory only. All state transitions recheck durable state with exclusive lock ownership.
    hasUnresolved() { try { return inFlight || read() !== null } catch { return true } },
    reconcile(abandon = false) { return exclusively(() => reconcile(abandon)) },
    acknowledgeRecovered() {
      return exclusively(async () => {
        current()
        const request = read()
        if (!request?.receipt) invalidCatalogue('unconfirmed recovery')
        const result = await reconcile(false)
        if (result.status !== 'committed' || !same(result.receipt, request.receipt)) invalidCatalogue('unconfirmed recovery')
        remove(request)
      })
    },
  })
}
