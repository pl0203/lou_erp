import type { CatalogueStorage } from './transactions'

export type CustomerTargetMode = 'legacy' | 'checked'
export type CustomerTargetRpc = 'pilot_customer_target_write_access_v1' | 'pilot_customer_target_upsert_v1' | 'pilot_reconcile_customer_target_v1'
export interface CustomerTargetInput { customerId: string; yearMonth: string; targetValue: number | null }
export interface CustomerTargetReceipt {
  version: 1
  request_id: string
  actor_id: string
  operation: 'upsert_target'
  customer_id: string
  year_month: string
  target_id: string
  target_value: string | null
  committed_at: string
}
export type CustomerTargetRecovery = { status: 'unknown' } | { status: 'committed'; receipt: CustomerTargetReceipt }
export interface CustomerTargetTransport {
  readonly backend: string
  rpc(name: CustomerTargetRpc, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>
  withExclusiveLock<T>(key: string, action: () => Promise<T>): Promise<T>
}
export interface CustomerTargetSenderOptions {
  backend: string
  actorId: string
  role: 'sales_head' | 'executive'
  /** Stable across customer, month and pagination changes; separate from catalogue requests. */
  scope: string
  storage(): CatalogueStorage
  isCurrent(): boolean
}
type Pending = {
  version: 1; backend: string; actor_id: string; role: string; scope: string
  request_id: string; customer_id: string; year_month: string; fingerprint: string
  receipt?: CustomerTargetReceipt
}
const fail = (): never => { throw new Error('Hasil target belum dapat diverifikasi. Periksa hasil sebelum menyimpan lagi.') }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  return value as Record<string, unknown>
}
function exact(value: unknown, fields: readonly string[]) {
  const row = record(value), keys = Object.keys(row)
  if (keys.length !== fields.length || keys.some(key => !fields.includes(key))) fail()
  return row
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) return fail()
  return value
}
function month(value: unknown): string {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) return fail()
  return value
}
function decimal(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value)) return fail()
  const [whole, fraction = ''] = value.split('.')
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (cents > 99999999999999n) return fail()
  return cents.toString()
}
function inputValue(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fail()
  return decimal(String(value))
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
  return value
}
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
async function fingerprint(customerId: string, yearMonth: string, value: string | null) {
  const bytes = new TextEncoder().encode(JSON.stringify(['upsert_target', customerId, yearMonth, value]))
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('')
}
export function parseCustomerTargetAccess(value: unknown, actorId: string): CustomerTargetMode {
  const row = exact(value, ['version', 'actor_id', 'mode'])
  if (row.version !== 1 || row.actor_id !== uuid(actorId) || row.mode !== 'legacy' && row.mode !== 'checked') return fail()
  return row.mode
}
function receipt(value: unknown, request: Pending): CustomerTargetReceipt {
  const row = exact(value, ['version', 'request_id', 'actor_id', 'operation', 'customer_id', 'year_month', 'target_id', 'target_value', 'committed_at'])
  if (row.version !== 1 || row.request_id !== request.request_id || row.actor_id !== request.actor_id || row.operation !== 'upsert_target'
    || row.customer_id !== request.customer_id || row.year_month !== request.year_month) return fail()
  uuid(row.target_id); decimal(row.target_value)
  if (typeof row.committed_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(row.committed_at) || !Number.isFinite(Date.parse(row.committed_at)) || new Date(`${row.committed_at.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== row.committed_at.slice(0, 10)) return fail()
  return row as unknown as CustomerTargetReceipt
}
function rpcError(error: unknown): never {
  const row = record(error)
  if (row.code === 'PGRST202' || row.code === '42883') throw new Error('Pembaruan database diperlukan. Jangan simpan target melalui jalur lama.')
  // Do not display backend details or dependency information to the form.
  throw new Error('Penyimpanan target belum terkonfirmasi. Periksa hasil sebelum menyimpan lagi.')
}

/** Only verified legacy capability permits the supplied original raw upsert.
 * Once checked dispatch is durable, no error, missing row or mode change resends it.
 * This helper has no target-read, abandon, raw-retry or caller generation interface. */
export function createCustomerTargetSender(options: CustomerTargetSenderOptions, transport: CustomerTargetTransport) {
  const { backend, role, scope } = options, actorId = uuid(options.actorId)
  if (!backend || !scope || !['sales_head', 'executive'].includes(role) || transport.backend !== backend
    || typeof transport.rpc !== 'function' || typeof transport.withExclusiveLock !== 'function') fail()
  const key = `customer-target-request:${encodeURIComponent(JSON.stringify([backend, actorId, role, 1, scope]))}`
  let inFlight = false, usedStorage: CatalogueStorage | undefined, fallback: Pending | undefined
  function current() { if (!options.isCurrent() || transport.backend !== backend) fail() }
  function storage() {
    const value = options.storage()
    if (!value || usedStorage && usedStorage !== value) fail()
    usedStorage = value; return value
  }
  function read(): Pending | null {
    const raw = storage().getItem(key)
    if (raw === null) return null
    const row = record(JSON.parse(raw))
    exact(row, ['version', 'backend', 'actor_id', 'role', 'scope', 'request_id', 'customer_id', 'year_month', 'fingerprint', ...(Object.hasOwn(row, 'receipt') ? ['receipt'] : [])])
    if (row.version !== 1 || row.backend !== backend || row.actor_id !== actorId || row.role !== role || row.scope !== scope
      || typeof row.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(row.fingerprint)) return fail()
    const pending: Pending = { version: 1, backend, actor_id: actorId, role, scope, request_id: uuid(row.request_id), customer_id: uuid(row.customer_id), year_month: month(row.year_month), fingerprint: row.fingerprint }
    if (Object.hasOwn(row, 'receipt')) pending.receipt = receipt(row.receipt, pending)
    return pending
  }
  function unchanged(expected: Pending) { if (!same(read(), expected)) fail() }
  function persist(pending: Pending) {
    current(); const store = storage(), raw = JSON.stringify(pending)
    store.setItem(key, raw)
    if (store.getItem(key) !== raw) fail()
    current()
  }
  async function access() {
    current()
    const { data, error } = await transport.rpc('pilot_customer_target_write_access_v1', {})
    current(); if (error) rpcError(error)
    return parseCustomerTargetAccess(data, actorId)
  }
  async function validateReceipt(value: unknown, request: Pending) {
    const parsed = receipt(value, request)
    if (await fingerprint(parsed.customer_id, parsed.year_month, decimal(parsed.target_value)) !== request.fingerprint) fail()
    current(); return parsed
  }
  async function admitted<T>(action: () => Promise<T>): Promise<T> {
    if (inFlight) throw new Error('Penyimpanan atau pemulihan target masih berlangsung.')
    inFlight = true
    try { current(); return await action() } finally { inFlight = false }
  }
  async function locked<T>(action: () => Promise<T>): Promise<T> {
    current(); const value = await transport.withExclusiveLock(key, async () => { current(); return action() })
    current(); return value
  }
  async function reconcile(request: Pending): Promise<CustomerTargetRecovery> {
    const { data, error } = await transport.rpc('pilot_reconcile_customer_target_v1', { p_request_id: request.request_id })
    current(); if (error) rpcError(error)
    const row = record(data)
    if (row.status === 'unknown') {
      exact(row, ['status']); if (request.receipt) fail()
      return { status: 'unknown' }
    }
    exact(row, ['status', 'receipt']); if (row.status !== 'committed') return fail()
    const parsed = await validateReceipt(row.receipt, request)
    if (request.receipt && !same(parsed, request.receipt)) fail()
    return { status: 'committed', receipt: parsed }
  }
  return {
    hasUnresolved() { try { return inFlight || !!fallback || read() !== null } catch { return true } },
    save(input: CustomerTargetInput, legacy: (input: CustomerTargetInput) => Promise<void>): Promise<'legacy' | CustomerTargetReceipt> {
      // Snapshot before any async boundary. Editing cannot rebind an admitted click.
      const captured = { customerId: input.customerId, yearMonth: input.yearMonth, targetValue: input.targetValue }
      return admitted(async () => {
        if (read() || fallback) fail()
        const mode = await access()
        if (read() || fallback) fail()
        if (mode === 'legacy') {
          current(); await legacy(captured); current(); return 'legacy'
        }
        return locked(async () => {
          if (read() || fallback) fail()
          if (await access() !== 'checked') fail()
          const customerId = uuid(captured.customerId), yearMonth = month(captured.yearMonth)
          const hash = await fingerprint(customerId, yearMonth, inputValue(captured.targetValue))
          current(); if (read() || fallback) fail()
          const pending: Pending = { version: 1, backend, actor_id: actorId, role, scope, request_id: uuid(crypto.randomUUID()), customer_id: customerId, year_month: yearMonth, fingerprint: hash }
          persist(pending)
          const { data, error } = await transport.rpc('pilot_customer_target_upsert_v1', { p_request_id: pending.request_id, p_customer_id: customerId, p_year_month: yearMonth, p_target_value: captured.targetValue })
          current(); unchanged(pending); if (error) rpcError(error)
          const parsed = await validateReceipt(data, pending)
          unchanged(pending); persist({ ...pending, receipt: parsed }); return parsed
        })
      })
    },
    recover(acceptCanonical: (receipt: CustomerTargetReceipt) => Promise<boolean>): Promise<CustomerTargetRecovery> {
      return admitted(async () => {
        const result = await locked(async () => {
          const durable = read(), pending = durable ?? fallback
          if (!pending) return { status: 'unknown' } as const
          const unchangedRecovery = () => { if (durable) unchanged(pending); else if (read() || fallback !== pending) fail() }
          unchangedRecovery()
          const result = await reconcile(pending); unchangedRecovery()
          if (result.status === 'unknown') return result
          const terminal = { ...pending, receipt: result.receipt }
          if (durable) persist(terminal)
          else fallback = terminal
          if (!await acceptCanonical(result.receipt)) fail()
          current()
          if (durable) unchanged(terminal); else if (read() || fallback !== terminal) fail()
          // Reauthorize immutable committed recovery after the canonical refresh.
          const confirmed = await reconcile(terminal)
          if (confirmed.status !== 'committed' || !same(confirmed.receipt, result.receipt)) fail()
          if (durable) unchanged(terminal); else if (read() || fallback !== terminal) fail()
          fallback = terminal
          if (durable) {
            storage().removeItem(key)
            if (storage().getItem(key) !== null) fail()
          }
          current(); return result
        })
        if (result.status === 'committed') { if (read() !== null || !fallback || !same(fallback.receipt, result.receipt)) fail(); fallback = undefined }
        return result
      })
    },
  }
}
export type CustomerTargetSender = ReturnType<typeof createCustomerTargetSender>
