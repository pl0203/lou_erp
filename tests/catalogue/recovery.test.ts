import { beforeEach, describe, expect, test } from 'vitest'
import { createCatalogueTransactionSender } from '../../src/lib/catalogue/transactions'
import type { CatalogueRequestBinding, CatalogueReceipt, ProcurementAccessV2 } from '../../src/lib/catalogue/contracts'

const actor = '00000000-0000-4000-8000-000000000001'
const target = '00000000-0000-4000-8000-000000000002'
const other = '00000000-0000-4000-8000-000000000009'
const backend = 'https://synthetic.invalid'
const access: ProcurementAccessV2 = { version: 2, as_of: '2026-10-14T05:00:00Z', actor_id: actor, role: 'co_admin',
  customer_create: true, customer_edit: true, customer_delete: true, product_create: true, product_edit: true,
  product_delete: true, customer_set_enabled: true, product_set_enabled: true, customer_delete_mode: 'guarded', product_delete_mode: 'guarded' }
const payload = { kind: 'product', id: target, expected_version: '9007199254740993', is_enabled: false } as const
const makeReceipt = (args: Record<string, any>, actorId = actor): CatalogueReceipt => {
  const p = args.p_payload, operation = args.p_operation
  const before = { catalog_version: p.expected_version ?? '1', is_enabled: true }
  return { version: 1, request_id: args.p_request_id, actor_id: actorId, operation, kind: p.kind, id: p.id ?? target,
    before: operation === 'create' ? null : before,
    after: operation === 'delete_unused' ? null : { catalog_version: operation === 'create' ? '1' : String(BigInt(before.catalog_version) + 1n), is_enabled: operation === 'set_enabled' ? p.is_enabled : true } as any,
    committed_at: '2026-10-14T05:00:00Z' }
}
class MemoryStorage {
  values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}
/** A shared lock authority, separate from sender instances and storage wrappers. */
class ExclusiveLocks {
  keys: string[] = []
  private tails = new Map<string, Promise<void>>()
  run<T>(key: string, action: () => Promise<T>): Promise<T> {
    this.keys.push(key)
    const result = (this.tails.get(key) ?? Promise.resolve()).then(action)
    this.tails.set(key, result.then(() => {}, () => {}))
    return result
  }
}
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }
type Response = { data: unknown; error: unknown }
function setup(storage = new MemoryStorage(), overrides: Record<string, any> = {}, locks = new ExclusiveLocks()) {
  const calls: { name: string; args: Record<string, any> }[] = [], authorities: CatalogueRequestBinding[] = []
  let current = true, handler: (name: string, args: Record<string, any>) => Promise<Response> = async (_name, args) => ({ data: makeReceipt(args), error: null })
  const options = { backend, actorId: actor, role: 'co_admin' as const, scope: 'product-dialog', storage: () => storage,
    authorize: async (binding: CatalogueRequestBinding) => { authorities.push(binding); return access }, isCurrent: () => current, ...overrides }
  const transport = { backend: options.backend, withExclusiveLock: <T,>(key: string, action: () => Promise<T>) => locks.run(key, action),
    rpc: async (name: string, args: Record<string, any>) => { calls.push({ name, args }); return handler(name, args) } }
  const create = () => createCatalogueTransactionSender(options, transport)
  return { storage, calls, authorities, options, transport, locks, create, send: create(), setCurrent: (value: boolean) => { current = value },
    respond: (next: typeof handler) => { handler = next }, saved: () => JSON.parse([...storage.values.values()][0]!) }
}
beforeEach(() => localStorage.clear())

describe('durable catalogue sender', () => {
  test('persists minimal binding before dispatch and retains verified receipt until explicit acknowledgement', async () => {
    const r = setup()
    r.respond(async (_name, args) => {
      const saved = r.saved()
      expect(saved.request_id).toBe(args.p_request_id)
      expect(saved.fingerprint).toMatch(/^[a-f0-9]{64}$/)
      expect(saved.binding).toEqual({ operation: 'set_enabled', ...payload })
      expect(saved.receipt).toBeUndefined()
      return { data: makeReceipt(args), error: null }
    })
    const result = await r.send('set_enabled', payload as any)
    expect(result.before?.catalog_version).toBe('9007199254740993')
    expect(r.saved().receipt).toEqual(result)
    expect(r.send.hasUnresolved()).toBe(true)
    expect(r.calls.map(call => call.name)).toEqual(['pilot_catalog_transaction_v1'])
    r.respond(async () => ({ data: { status: 'committed', receipt: result }, error: null }))
    await r.send.acknowledgeRecovered()
    expect(r.send.hasUnresolved()).toBe(false)
    expect(r.storage.values.size).toBe(0)
  })
  test('stores neither customer form/contact values nor the full payload', async () => {
    const r = setup()
    await r.send('create', { kind: 'customer', values: { name: 'Private Person', address: 'Private Street', city: 'Private City', phone: '5551234', email: 'private@example.invalid', pricing_tier: 'others', customer_category: 'perorangan' } })
    const raw = [...r.storage.values.values()].join('')
    for (const privateValue of ['Private Person', 'Private Street', 'Private City', '5551234', 'private@example.invalid', 'perorangan', 'values', 'p_payload']) expect(raw).not.toContain(privateValue)
    expect(r.saved().binding).toEqual({ operation: 'create', kind: 'customer' })
  })
  test('lost response and reload never resends even identical payload; unknown remains unresolved', async () => {
    const r = setup()
    r.respond(async () => { throw new Error('response lost') })
    await expect(r.send('set_enabled', payload as any)).rejects.toThrow('response lost')
    const saved = r.saved(), reloaded = r.create()
    await expect(reloaded('set_enabled', payload as any)).rejects.toThrow()
    expect(r.calls).toHaveLength(1)
    expect(r.saved()).toEqual(saved)
    r.respond(async () => ({ data: { status: 'unknown' }, error: null }))
    expect(await reloaded.reconcile()).toEqual({ status: 'unknown' })
    expect(r.calls[1]).toEqual({ name: 'pilot_reconcile_catalog_v1', args: { p_request_id: saved.request_id, p_abandon: false } })
    expect(reloaded.hasUnresolved()).toBe(true)
    await expect(reloaded('set_enabled', payload as any)).rejects.toThrow()
    expect(r.calls).toHaveLength(2)
  })
  test('only terminal explicit abandonment permits a new request identity', async () => {
    const r = setup()
    r.respond(async () => ({ data: null, error: { message: 'gateway failed' } }))
    await expect(r.send('set_enabled', payload as any)).rejects.toThrow()
    const old = r.saved().request_id
    r.respond(async () => ({ data: { status: 'abandoned' }, error: null }))
    expect(await r.send.reconcile(true)).toEqual({ status: 'abandoned' })
    expect(r.calls[1].args).toEqual({ p_request_id: old, p_abandon: true })
    expect(r.send.hasUnresolved()).toBe(true)
    await r.send.acknowledgeAbandoned()
    expect(r.send.hasUnresolved()).toBe(false)
    r.respond(async (_name, args) => ({ data: makeReceipt(args), error: null }))
    await r.send('set_enabled', payload as any)
    expect(r.saved().request_id).not.toBe(old)
  })
  test('repeat clicks and reconciliation while dispatch runs cannot start another RPC', async () => {
    const r = setup(), response = deferred<Response>(), started = deferred<void>()
    r.respond(async () => { started.resolve(); return response.promise })
    const first = r.send('set_enabled', payload as any)
    await started.promise
    await expect(r.send('set_enabled', payload as any)).rejects.toThrow()
    await expect(r.send.reconcile(true)).rejects.toThrow()
    expect(r.calls).toHaveLength(1)
    response.resolve({ data: makeReceipt(r.calls[0].args), error: null })
    await first
  })
  test.each(['get throws', 'set throws', 'set silently loses data', 'set corrupts data'])('storage %s blocks dispatch', async fault => {
    const storage = new MemoryStorage()
    if (fault === 'get throws') storage.getItem = () => { throw new Error('storage denied') }
    if (fault === 'set throws') storage.setItem = () => { throw new Error('quota') }
    if (fault === 'set silently loses data') storage.setItem = () => {}
    if (fault === 'set corrupts data') storage.setItem = (key: string) => { storage.values.set(key, '{}') }
    const r = setup(storage)
    await expect(r.send('set_enabled', payload as any)).rejects.toThrow()
    expect(r.calls).toHaveLength(0)
  })
  test('failed receipt persistence does not announce success or discard the original request', async () => {
    const storage = new MemoryStorage(), r = setup(storage)
    const write = storage.setItem.bind(storage); let count = 0
    storage.setItem = (key, value) => { if (++count > 1) throw new Error('quota'); write(key, value) }
    await expect(r.send('set_enabled', payload as any)).rejects.toThrow('quota')
    expect(r.saved().receipt).toBeUndefined()
    expect(r.create().hasUnresolved()).toBe(true)
    expect(r.calls).toHaveLength(1)
  })
  test.each([{ actor_id: other }, { request_id: other }, { id: other }, { kind: 'customer' }, { operation: 'edit' },
    { before: null }, { after: { catalog_version: 9007199254740994, is_enabled: false } }, { extra: true },
  ])('malformed or mismatched result keeps durable uncertainty %#', async patch => {
    const r = setup()
    r.respond(async (_name, args) => ({ data: { ...makeReceipt(args), ...patch }, error: null }))
    await expect(r.send('set_enabled', payload as any)).rejects.toThrow()
    expect(r.saved().receipt).toBeUndefined()
    expect(r.create().hasUnresolved()).toBe(true)
    await expect(r.create()('set_enabled', payload as any)).rejects.toThrow()
    expect(r.calls).toHaveLength(1)
  })
  test('SQL refusal and missing RPC retain recoverable identity without legacy fallback', async () => {
    for (const code of ['42501', 'PGRST202', '42883', '55P03']) {
      const r = setup()
      r.respond(async () => ({ data: null, error: { code, message: 'refused' } }))
      await expect(r.send('set_enabled', payload as any)).rejects.toThrow()
      expect(r.send.hasUnresolved()).toBe(true)
      await expect(r.send('set_enabled', payload as any)).rejects.toThrow()
      expect(r.calls.map(call => call.name)).toEqual(['pilot_catalog_transaction_v1'])
    }
  })
  test.each(['CATALOG_VERSION_CONFLICT', 'CATALOG_DISABLED', 'CATALOG_IDENTITY_CONFLICT', 'CATALOG_DELETE_BLOCKED',
    'CATALOG_TRACKING_INCOMPLETE', 'CATALOG_GENERATION_RETIRED'].flatMap(code => [[code, code], [code, JSON.stringify({ code })]]))('preserves allowlisted structured domain code %s from %s', async (code, details) => {
    const r = setup()
    r.respond(async () => ({ data: null, error: { code: 'P0001', message: 'private database internals',
      details } }))
    const error: any = await r.send('set_enabled', payload as any).catch(value => value)
    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe(code)
    expect(error.message).not.toContain('private database internals')
    expect(error.details).toBeUndefined()
    expect(JSON.stringify(error)).not.toContain('private-order-123')
    expect(r.send.hasUnresolved()).toBe(true)
  })
  test.each(['not json', '{"code":"UNRECOGNIZED","hidden_links":["private-order-123"]}', '["CATALOG_DELETE_BLOCKED"]', '{"code":false}',
    '{"code":"CATALOG_DELETE_BLOCKED","hidden_links":["private-order-123"]}'])('unknown error detail shape stays private %#', async details => {
    const r = setup()
    r.respond(async () => ({ data: null, error: { code: 'P0001', message: 'refused', details } }))
    const error: any = await r.send('set_enabled', payload as any).catch(value => value)
    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe('P0001')
    expect(error.details).toBeUndefined()
    expect(JSON.stringify(error)).not.toContain('private-order-123')
    expect(r.send.hasUnresolved()).toBe(true)
  })
  test('recovery remains bound when target was deleted; no mutable target lookup or mutation replay', async () => {
    const r = setup(); let receipt!: CatalogueReceipt
    r.respond(async (_name, args) => { receipt = makeReceipt(args); throw new Error('lost deletion response') })
    await expect(r.send('delete_unused', { kind: 'product', id: target, expected_version: payload.expected_version } as any)).rejects.toThrow()
    const reloaded = r.create()
    r.respond(async () => ({ data: { status: 'committed', receipt }, error: null }))
    expect(await reloaded.reconcile()).toEqual({ status: 'committed', receipt })
    expect(r.authorities.at(-1)).toEqual({ operation: 'delete_unused', kind: 'product', id: target, expected_version: payload.expected_version })
    expect(r.calls.map(call => call.name)).toEqual(['pilot_catalog_transaction_v1', 'pilot_reconcile_catalog_v1'])
    await reloaded.acknowledgeRecovered()
    expect(reloaded.hasUnresolved()).toBe(false)
  })
  test.each(['actor', 'role', 'backend', 'form'])('%s switch does not expose or clear the old scoped request', async dimension => {
    const storage = new MemoryStorage(), r = setup(storage)
    r.respond(async () => { throw new Error('lost') })
    await expect(r.send('set_enabled', payload as any)).rejects.toThrow()
    const before = [...storage.values]
    const changed = setup(storage, dimension === 'actor' ? { actorId: other } : dimension === 'role' ? { role: 'po_admin' }
      : dimension === 'backend' ? { backend: 'https://another.invalid' } : { scope: 'other-dialog' })
    expect(changed.send.hasUnresolved()).toBe(false)
    expect(await changed.send.reconcile()).toEqual({ status: 'unknown' })
    expect(changed.calls).toHaveLength(0)
    expect([...storage.values]).toEqual(before)
  })
  test('backend dependency mismatch is refused before using the transport', () => {
    const r = setup()
    expect(() => createCatalogueTransactionSender(r.options, { ...r.transport, backend: 'https://wrong.invalid' })).toThrow()
  })
  test('a missing or unavailable exclusive-lock adapter fails closed before storage or RPC', async () => {
    const r = setup()
    const { withExclusiveLock: _lock, ...missing } = r.transport
    expect(() => createCatalogueTransactionSender(r.options, missing as any)).toThrow()
    const unavailable = createCatalogueTransactionSender(r.options, { ...r.transport,
      withExclusiveLock: async () => { throw new Error('Web Locks unavailable') } })
    await expect(unavailable('set_enabled', payload as any)).rejects.toThrow('Web Locks unavailable')
    expect(r.storage.values.size).toBe(0)
    expect(r.calls).toHaveLength(0)
  })
  test('independent sender instances use the same scoped lock and cannot dispatch two first requests', async () => {
    const storage = new MemoryStorage(), locks = new ExclusiveLocks(), first = setup(storage, {}, locks), second = setup(storage, {}, locks)
    const response = deferred<Response>(), started = deferred<void>()
    first.respond(async () => { started.resolve(); return response.promise })
    const pending = first.send('set_enabled', payload as any); await started.promise
    let settled = false
    const competing = second.send('set_enabled', payload as any).finally(() => { settled = true })
    // Attach rejection immediately so the RED implementation's premature rejection is observed safely.
    const outcome = competing.then(() => 'accepted', () => 'blocked')
    await Promise.resolve(); await Promise.resolve()
    expect(locks.keys).toHaveLength(2)
    expect(new Set(locks.keys).size).toBe(1)
    expect(settled).toBe(false)
    const original = first.saved()
    expect(second.calls).toHaveLength(0)
    response.resolve({ data: makeReceipt(first.calls[0].args), error: null })
    await pending
    expect(await outcome).toBe('blocked')
    expect(first.saved().request_id).toBe(original.request_id)
    expect(second.calls).toHaveLength(0)
    expect(first.saved().receipt.request_id).toBe(original.request_id)
  })
  test('storage is not read or written before exclusive-lock ownership is obtained', async () => {
    const r = setup(), gate = deferred<void>(), started = deferred<void>(); let reads = 0
    const read = r.storage.getItem.bind(r.storage)
    r.storage.getItem = key => { reads++; return read(key) }
    const send = createCatalogueTransactionSender(r.options, { ...r.transport, withExclusiveLock: async (_key, action) => {
      started.resolve(); await gate.promise; return action()
    } })
    const pending = send('set_enabled', payload as any); await started.promise
    expect(reads).toBe(0)
    expect(r.calls).toHaveLength(0)
    expect(r.storage.values.size).toBe(0)
    gate.resolve(); await pending
    expect(reads).toBeGreaterThan(0)
  })
  test('payload is captured before waiting for a cross-context lock', async () => {
    const r = setup(), gate = deferred<void>(), started = deferred<void>()
    const send = createCatalogueTransactionSender(r.options, { ...r.transport, withExclusiveLock: async (_key, action) => {
      started.resolve(); await gate.promise; return action()
    } })
    const input: any = { kind: 'product', id: target, expected_version: '1', values: { name: 'Selected before lock' } }
    const pending = send('edit', input); await started.promise
    input.values.name = 'Changed during lock wait'
    gate.resolve(); await pending
    expect(r.calls[0].args.p_payload.values.name).toBe('Selected before lock')
  })
  test.each(['send', 'reconcile'] as const)('identity change while %s lock ownership is released refuses late success', async method => {
    const r = setup(), release = deferred<void>(), actionFinished = deferred<void>()
    if (method === 'reconcile') {
      const receipt = await r.send('set_enabled', payload as any)
      r.respond(async () => ({ data: { status: 'committed', receipt }, error: null }))
    }
    const send = createCatalogueTransactionSender(r.options, { ...r.transport, withExclusiveLock: async (_key, action) => {
      const result = await action()
      actionFinished.resolve()
      await release.promise
      return result
    } })
    const pending = method === 'send' ? send('set_enabled', payload as any) : send.reconcile()
    await actionFinished.promise
    const saved = r.saved()
    expect(saved.receipt).toBeDefined()
    r.setCurrent(false); release.resolve()
    await expect(pending).rejects.toThrow()
    expect(r.saved()).toEqual(saved)
    expect(send.hasUnresolved()).toBe(true)
  })
  test('recovery and acknowledgement share the original scoped lock', async () => {
    const r = setup(), result = await r.send('set_enabled', payload as any)
    r.respond(async () => ({ data: { status: 'committed', receipt: result }, error: null }))
    await r.send.reconcile()
    await r.send.acknowledgeRecovered()
    expect(r.locks.keys).toHaveLength(3)
    expect(new Set(r.locks.keys).size).toBe(1)
  })
  test('identity change during fresh authority check prevents dispatch', async () => {
    const auth = deferred<ProcurementAccessV2>(), started = deferred<void>()
    const r = setup(new MemoryStorage(), { authorize: () => { started.resolve(); return auth.promise } })
    const pending = r.send('set_enabled', payload as any); await started.promise
    r.setCurrent(false); auth.resolve(access)
    await expect(pending).rejects.toThrow()
    expect(r.calls).toHaveLength(0)
    expect(r.storage.values.size).toBe(0)
  })
  test('identity change immediately after dispatch retains old-scope uncertainty and refuses late success', async () => {
    const r = setup()
    r.respond(async (_name, args) => { r.setCurrent(false); return { data: makeReceipt(args), error: null } })
    await expect(r.send('set_enabled', payload as any)).rejects.toThrow()
    expect(r.saved().receipt).toBeUndefined()
    expect(r.send.hasUnresolved()).toBe(true)
  })
  test('stale, denied, wrong-actor and wrong-role capability checks refuse dispatch', async () => {
    for (const authority of [undefined, { ...access, actor_id: other }, { ...access, role: 'po_admin' },
      { ...access, product_edit: false, product_set_enabled: false, product_delete: false, product_delete_mode: 'none' }]) {
      const r = setup(new MemoryStorage(), { authorize: async () => authority })
      await expect(r.send('set_enabled', payload as any)).rejects.toThrow()
      expect(r.calls).toHaveLength(0)
      expect(r.storage.values.size).toBe(0)
    }
  })
  test('PO/Executive direct product delete authority cannot authorize guarded delete or recovery', async () => {
    for (const role of ['po_admin', 'executive']) {
      const r = setup(new MemoryStorage(), { role, authorize: async () => ({ ...access, role, customer_delete: false, customer_delete_mode: 'none', product_delete_mode: 'direct' }) })
      await expect(r.send('delete_unused', { kind: 'product', id: target, expected_version: payload.expected_version } as any)).rejects.toThrow()
      expect(r.calls).toHaveLength(0)
    }
  })
  test('changed committed recovery cannot overwrite receipt or clear uncertainty', async () => {
    const r = setup(), result = await r.send('set_enabled', payload as any)
    const before = r.saved()
    for (const data of [{ status: 'unknown' }, { status: 'abandoned' }, { status: 'committed', receipt: { ...result, committed_at: '2026-10-15T05:00:00Z' } },
      { status: 'committed', receipt: { ...result, actor_id: other } }, { status: 'committed', receipt: result, extra: true }]) {
      r.respond(async () => ({ data, error: null }))
      await expect(r.send.reconcile(true)).rejects.toThrow()
      expect(r.saved()).toEqual(before)
    }
  })
  test('acknowledgement requires verified committed receipt and live exact authority', async () => {
    const r = setup()
    r.respond(async () => { throw new Error('lost') })
    await expect(r.send('set_enabled', payload as any)).rejects.toThrow()
    await expect(r.send.acknowledgeRecovered()).rejects.toThrow()
    expect(r.calls).toHaveLength(1)
    r.respond(async () => ({ data: { status: 'committed', receipt: makeReceipt(r.calls[0].args) }, error: null }))
    await r.send.reconcile()
    const before = r.saved()
    r.setCurrent(false)
    await expect(r.send.acknowledgeRecovered()).rejects.toThrow()
    expect(r.saved()).toEqual(before)
  })
  test('corrupt or copied recovery metadata fails closed', async () => {
    const r = setup()
    await r.send('set_enabled', payload as any)
    const [key, raw] = [...r.storage.values][0], saved = JSON.parse(raw)
    for (const patch of [{ actor_id: other }, { backend: 'other' }, { role: 'po_admin' }, { scope: 'other' }, { fingerprint: 'bad' },
      { binding: { ...saved.binding, id: other } }, { payload: { secret: 'must not exist' } }]) {
      r.storage.setItem(key, JSON.stringify({ ...saved, ...patch }))
      expect(r.create().hasUnresolved()).toBe(true)
      await expect(r.create().reconcile()).rejects.toThrow()
    }
    expect(r.calls).toHaveLength(1)
  })
  test('payload is snapshotted before async authorization and hashed without property-order changes', async () => {
    const auth = deferred<ProcurementAccessV2>(), started = deferred<void>()
    const r = setup(new MemoryStorage(), { authorize: () => { started.resolve(); return auth.promise } })
    const input: any = { kind: 'product', id: target, expected_version: '1', values: { name: 'Before', sku: 'ORIGINAL' } }
    const pending = r.send('edit', input); await started.promise
    input.values.name = 'After'; auth.resolve(access)
    await pending
    expect(r.calls[0].args.p_payload.values.name).toBe('Before')
    const second = setup()
    await second.send('edit', { expected_version: '1', id: target, values: { sku: 'ORIGINAL', name: 'Before' }, kind: 'product' } as any)
    expect(second.saved().fingerprint).toBe(r.saved().fingerprint)
  })
})

test('terminal abandonment stays durable until its owner explicitly acknowledges refreshed state', async () => {
  const r = setup()
  r.respond(async () => ({ data: null, error: { details: 'CATALOG_VERSION_CONFLICT' } }))
  await expect(r.send('set_enabled', payload as any)).rejects.toThrow()
  const request = r.saved().request_id
  r.respond(async () => ({ data: { status: 'abandoned' }, error: null }))
  expect(await r.send.reconcile(true)).toEqual({ status: 'abandoned' })
  expect(r.saved().abandoned).toBe(true); expect(r.saved().request_id).toBe(request)
  const reloaded = r.create()
  expect(reloaded.hasUnresolved()).toBe(true)
  await expect(reloaded('set_enabled', payload as any)).rejects.toThrow()
  expect(await reloaded.reconcile(false)).toEqual({ status: 'abandoned' })
  await reloaded.acknowledgeAbandoned()
  expect(reloaded.hasUnresolved()).toBe(false)
})

test('abandonment survives native lock release rejection and remount without reverting to unknown', async () => {
  const r = setup(); r.respond(async () => ({ data: null, error: { message: 'refused' } }))
  await expect(r.send('set_enabled', payload as any)).rejects.toThrow()
  const entered = deferred<void>(), release = deferred<void>()
  r.respond(async () => ({ data: { status: 'abandoned' }, error: null }))
  const sender = createCatalogueTransactionSender(r.options, { ...r.transport, withExclusiveLock: async (_key, action) => {
    const result = await action(); entered.resolve(); await release.promise; return result
  } })
  const pending = sender.reconcile(true); await entered.promise
  expect(r.saved().abandoned).toBe(true)
  r.setCurrent(false); release.resolve(); await expect(pending).rejects.toThrow()
  r.setCurrent(true)
  const reloaded = r.create()
  expect(await reloaded.reconcile(false)).toEqual({ status: 'abandoned' })
  expect(reloaded.hasUnresolved()).toBe(true)
  await reloaded.acknowledgeAbandoned(); expect(reloaded.hasUnresolved()).toBe(false)
})

for (const terminal of ['committed', 'abandoned'] as const) {
  test(`${terminal} acknowledgement can recover after removal succeeds but native lock release rejects`, async () => {
    const r = setup()
    if (terminal === 'abandoned') r.respond(async () => ({ data: null, error: { message: 'refused' } }))
    const receipt = await r.send('set_enabled', payload as any).catch(() => undefined)
    const outcome = terminal === 'committed' ? { status: terminal, receipt } : { status: terminal }
    r.respond(async () => ({ data: outcome, error: null }))
    if (terminal === 'abandoned') await r.send.reconcile(true)
    const entered = deferred<void>(), release = deferred<void>(); let gate = false
    const sender = createCatalogueTransactionSender(r.options, { ...r.transport, withExclusiveLock: async (_key, action) => {
      const result = await action(); if (gate) { gate = false; entered.resolve(); await release.promise }; return result
    } })
    await sender.reconcile(false); gate = true
    const acknowledge = () => terminal === 'committed' ? sender.acknowledgeRecovered() : sender.acknowledgeAbandoned()
    const pending = acknowledge(); await entered.promise
    expect(r.storage.values.size).toBe(0)
    r.setCurrent(false); release.resolve(); await expect(pending).rejects.toThrow()
    await expect(sender.reconcile(false)).rejects.toThrow()
    r.setCurrent(true)
    expect(await sender.reconcile(false)).toEqual(outcome)
    await acknowledge(); expect(sender.hasUnresolved()).toBe(false)
    expect(r.calls.filter(call => call.name === 'pilot_catalog_transaction_v1')).toHaveLength(1)
  })
  test.each(['throw', 'silent'])(`${terminal} acknowledgement preserves durable terminal metadata when removal is %s`, async fault => {
    const r = setup()
    if (terminal === 'abandoned') r.respond(async () => ({ data: null, error: { message: 'refused' } }))
    const receipt = await r.send('set_enabled', payload as any).catch(() => undefined)
    const outcome = terminal === 'committed' ? { status: terminal, receipt } : { status: terminal }
    r.respond(async () => ({ data: outcome, error: null }))
    if (terminal === 'abandoned') await r.send.reconcile(true)
    const remove = r.storage.removeItem.bind(r.storage)
    r.storage.removeItem = () => { if (fault === 'throw') throw new Error('remove denied') }
    const acknowledge = () => terminal === 'committed' ? r.send.acknowledgeRecovered() : r.send.acknowledgeAbandoned()
    await expect(acknowledge()).rejects.toThrow()
    expect(r.send.hasUnresolved()).toBe(true); expect(await r.send.reconcile(false)).toEqual(outcome)
    r.storage.removeItem = remove; await acknowledge(); expect(r.send.hasUnresolved()).toBe(false)
  })
}

test('terminal fallback refuses a replacement record introduced during fresh authority', async () => {
  const r = setup(), receipt = await r.send('set_enabled', payload as any)
  const [key, raw] = [...r.storage.values][0]
  r.respond(async () => ({ data: { status: 'committed', receipt }, error: null }))
  let replace = false
  const sender = createCatalogueTransactionSender({ ...r.options, authorize: async () => {
    if (replace) r.storage.setItem(key, raw)
    return access
  } }, r.transport)
  await sender.reconcile(false)
  await sender.acknowledgeRecovered(); expect(r.storage.values.size).toBe(0)
  replace = true
  const before = r.calls.length
  await expect(sender.reconcile(false)).rejects.toThrow()
  expect(r.storage.getItem(key)).toBe(raw); expect(r.calls).toHaveLength(before)
})

test('abandoned terminal metadata rejects malformed flags and a conflicting committed receipt', async () => {
  const r = setup(); r.respond(async () => ({ data: null, error: { message: 'refused' } }))
  await expect(r.send('set_enabled', payload as any)).rejects.toThrow()
  r.respond(async () => ({ data: { status: 'abandoned' }, error: null })); await r.send.reconcile(true)
  const [key, raw] = [...r.storage.values][0], saved = JSON.parse(raw)
  for (const patch of [{ abandoned: false }, { abandoned: 'true' }, { receipt: makeReceipt(r.calls[0].args) }]) {
    r.storage.setItem(key, JSON.stringify({ ...saved, ...patch }))
    await expect(r.create().reconcile(false)).rejects.toThrow()
  }
})

for (const terminal of ['committed', 'abandoned'] as const) {
  test(`${terminal} acknowledgment refuses a replacement before or during its replay`, async () => {
    const r = setup()
    if (terminal === 'abandoned') r.respond(async () => ({ data: null, error: { message: 'refused' } }))
    const receipt = await r.send('set_enabled', payload as any).catch(() => undefined)
    const outcome = terminal === 'committed' ? { status: terminal, receipt } : { status: terminal }
    r.respond(async () => ({ data: outcome, error: null }))
    if (terminal === 'abandoned') await r.send.reconcile(true)
    const [key, raw] = [...r.storage.values][0], saved = JSON.parse(raw)
    const replacement = JSON.stringify({ ...saved, request_id: other, ...(receipt ? { receipt: { ...receipt, request_id: other } } : {}) })
    const acknowledge = () => terminal === 'committed' ? r.send.acknowledgeRecovered() : r.send.acknowledgeAbandoned()
    const before = r.calls.length
    r.storage.setItem(key, replacement)
    await expect(acknowledge()).rejects.toThrow()
    expect(r.calls).toHaveLength(before); expect(r.storage.getItem(key)).toBe(replacement)
    r.storage.setItem(key, raw)
    r.respond(async () => { r.storage.setItem(key, replacement); return { data: outcome, error: null } })
    await expect(acknowledge()).rejects.toThrow()
    expect(r.storage.getItem(key)).toBe(replacement)
    // Only a separate, fresh reconcile can establish the replacement terminal.
    const nextOutcome = terminal === 'committed' ? { status: terminal, receipt: { ...receipt!, request_id: other } } : outcome
    r.respond(async () => ({ data: nextOutcome, error: null }))
    expect(await r.send.reconcile(false)).toEqual(nextOutcome)
    await acknowledge(); expect(r.storage.values.size).toBe(0)
  })
  test.each(['reconcile', 'acknowledge'])(`${terminal} %s refuses a replacement arriving during native lock release`, async operation => {
    const r = setup()
    if (terminal === 'abandoned') r.respond(async () => ({ data: null, error: { message: 'refused' } }))
    const receipt = await r.send('set_enabled', payload as any).catch(() => undefined)
    const outcome = terminal === 'committed' ? { status: terminal, receipt } : { status: terminal }
    r.respond(async () => ({ data: outcome, error: null }))
    if (terminal === 'abandoned') await r.send.reconcile(true)
    const [key, raw] = [...r.storage.values][0], saved = JSON.parse(raw)
    const replacement = JSON.stringify({ ...saved, request_id: other, ...(receipt ? { receipt: { ...receipt, request_id: other } } : {}) })
    const entered = deferred<void>(), release = deferred<void>(); let gated = false
    const sender = createCatalogueTransactionSender(r.options, { ...r.transport, withExclusiveLock: async (_key, action) => {
      const result = await action(); if (gated) { entered.resolve(); await release.promise }; return result
    } })
    const acknowledge = () => terminal === 'committed' ? sender.acknowledgeRecovered() : sender.acknowledgeAbandoned()
    await sender.reconcile(false)
    if (operation === 'reconcile') await acknowledge()
    gated = true
    const pending = operation === 'reconcile' ? sender.reconcile(false) : acknowledge()
    await entered.promise
    expect(r.storage.values.size).toBe(0)
    r.storage.setItem(key, replacement); release.resolve()
    await expect(pending).rejects.toThrow()
    expect(r.storage.getItem(key)).toBe(replacement)
    expect(r.calls.filter(call => call.name === 'pilot_catalog_transaction_v1')).toHaveLength(1)
  })
}

test('terminal fallback checks replacement after RPC and is cleared only by verified new persistence', async () => {
  const r = setup(), receipt = await r.send('set_enabled', payload as any)
  const [key, raw] = [...r.storage.values][0]
  r.respond(async () => ({ data: { status: 'committed', receipt }, error: null }))
  await r.send.acknowledgeRecovered()
  r.respond(async () => { r.storage.setItem(key, raw); return { data: { status: 'committed', receipt }, error: null } })
  await expect(r.send.reconcile(false)).rejects.toThrow()
  expect(r.storage.getItem(key)).toBe(raw)
  r.storage.removeItem(key)
  r.respond(async () => ({ data: { status: 'committed', receipt }, error: null }))
  expect(await r.send.reconcile(false)).toEqual({ status: 'committed', receipt })
  // A newly persisted unresolved attempt must not inherit the old terminal evidence.
  r.respond(async () => { throw new Error('new response lost') })
  await expect(r.send('set_enabled', payload as any)).rejects.toThrow('new response lost')
  const newRequest = r.saved().request_id
  expect(newRequest).not.toBe(receipt.request_id)
  r.storage.removeItem(key)
  const before = r.calls.length
  expect(await r.send.reconcile(false)).toEqual({ status: 'unknown' })
  expect(r.calls).toHaveLength(before)
})
