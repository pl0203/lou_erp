import { useEffect, useState } from 'react'
import { createCatalogueBackend } from './source/src/lib/catalogue/backend'
import { createCatalogueTransactionSender } from './source/src/lib/catalogue/transactions'
import { parseCataloguePayload, decodeProcurementAccessV2 } from './source/src/lib/catalogue/validation'

// Fictional boundary only. No network client, credentials, hosted data or API calls.
const actor = '11111111-1111-4111-8111-111111111111', role = 'co_admin' as const
const backend = 'https://synthetic-catalogue.example.invalid'
const storeKey = 'synthetic-browser-qa:0150feb9:server', eventName = 'synthetic-browser-qa:changed'
type Mode = 'normal' | 'held' | 'lost' | 'unknown'
type Store = { mode: Mode; customers: any[]; receipts: Record<string, { payload: unknown; receipt: any }>; abandoned: string[]; attempts: string[]; rawCalls: string[]; unexpected: string[]; held: string[]; released: string[] }
const initial = (): Store => ({ mode: 'normal', customers: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Fictional Starter Shop', address: 'Synthetic address', city: 'Synthetic city', phone: null, email: null, pricing_tier: 'others', customer_category: 'perorangan', catalog_version: '9007199254740993', is_enabled: true }], receipts: {}, abandoned: [], attempts: [], rawCalls: [], unexpected: [], held: [], released: [] })
function read(): Store { const raw = localStorage.getItem(storeKey); return raw ? JSON.parse(raw) : initial() }
function save(data: Store) { localStorage.setItem(storeKey, JSON.stringify(data)); window.dispatchEvent(new Event(eventName)) }
async function update<T>(action: (data: Store) => T): Promise<T> {
  return navigator.locks.request('synthetic-browser-qa:server', { mode: 'exclusive' }, () => { const data = read(), value = action(data); save(data); return value })
}
const profile = Object.freeze({ id: actor, role, is_active: true })
const auth = Object.freeze({ user: Object.freeze({ id: actor }), profile, loading: false, error: null })
export const useAuth = () => auth
export default function FictionalNav() { return <nav aria-label="Navigasi sintetis" className="p-3 border-b"><strong>Fictional catalogue QA</strong> · public 0150feb9 · no hosted backend</nav> }
function accessV2() { return { version: 2, as_of: '2026-10-16T00:00:00Z', actor_id: actor, role, customer_create: true, customer_edit: true, customer_delete: true, product_create: true, product_edit: true, product_delete: true, customer_set_enabled: true, product_set_enabled: true, customer_delete_mode: 'guarded', product_delete_mode: 'guarded' } }
function awaitRelease(id: string) {
  return new Promise<void>(resolve => {
    const check = () => { if (read().released.includes(id)) { window.removeEventListener('storage', check); window.removeEventListener(eventName, check); resolve() } }
    window.addEventListener('storage', check); window.addEventListener(eventName, check); check()
  })
}
async function operation(name: string, args: any) {
  if (name === 'pilot_procurement_access_v1') return { data: { version: 1, as_of: '2026-10-16T00:00:00Z', actor_id: actor, role, customer_create: false, customer_edit: false, customer_delete: false, product_create: false, product_edit: false, product_delete: false }, error: null }
  if (name === 'pilot_procurement_access_v2') return { data: accessV2(), error: null }
  if (name === 'pilot_catalog_delete_access_v1') return { data: { version: 1, actor_id: actor, customer_delete: true, product_delete: true }, error: null }
  if (name === 'pilot_catalog_page_v1') {
    if (args.p_kind !== 'customer') throw Error('Only fictional customer reads are configured')
    const rows = read().customers.filter(row => (!args.p_search || row.name.includes(args.p_search)) && (args.p_status === 'all' || row.is_enabled === (args.p_status === 'enabled'))).sort((a, b) => a.id.localeCompare(b.id))
    return { data: { version: 1, actor_id: actor, role, kind: args.p_kind, purpose: args.p_purpose, status: args.p_status, search: args.p_search, page: args.p_page, page_size: args.p_page_size, total_count: String(rows.length), rows: rows.slice((args.p_page - 1) * args.p_page_size, args.p_page * args.p_page_size) }, error: null }
  }
  if (name === 'pilot_catalog_transaction_v1') {
    const result = await update(data => {
      data.attempts.push(args.p_request_id)
      const prior = data.receipts[args.p_request_id]
      if (prior) {
        if (JSON.stringify(prior.payload) !== JSON.stringify([args.p_operation, args.p_payload])) throw Error('Synthetic request mismatch')
        return { receipt: prior.receipt, mode: 'normal' as Mode }
      }
      if (data.abandoned.includes(args.p_request_id)) throw Error('Synthetic request abandoned')
      const payload = parseCataloguePayload(args.p_operation, args.p_payload)
      if (payload.kind !== 'customer') throw Error('Only fictional customer commands are configured')
      if (data.mode === 'unknown') return { receipt: null, mode: data.mode }
      let row = data.customers.find(item => item.id === args.p_payload.id)
      if (args.p_operation !== 'create' && (!row || row.catalog_version !== args.p_payload.expected_version)) throw Error('Synthetic version mismatch')
      const before = args.p_operation === 'create' ? null : { catalog_version: row.catalog_version, is_enabled: row.is_enabled }
      if (args.p_operation === 'create') {
        row = { ...args.p_payload.values, id: crypto.randomUUID(), catalog_version: '1', is_enabled: true }; data.customers.push(row)
      } else if (args.p_operation === 'edit') {
        const changed = Object.entries(args.p_payload.values).some(([key, value]) => row[key] !== value)
        Object.assign(row, args.p_payload.values); if (changed) row.catalog_version = String(BigInt(row.catalog_version) + 1n)
      } else if (args.p_operation === 'delete_unused') data.customers.splice(data.customers.indexOf(row), 1)
      else { if (row.is_enabled !== args.p_payload.is_enabled) row.catalog_version = String(BigInt(row.catalog_version) + 1n); row.is_enabled = args.p_payload.is_enabled }
      const receipt = { version: 1, request_id: args.p_request_id, actor_id: actor, operation: args.p_operation, kind: payload.kind, id: row.id, before, after: args.p_operation === 'delete_unused' ? null : { catalog_version: row.catalog_version, is_enabled: row.is_enabled }, committed_at: '2026-10-16T00:00:00Z' }
      data.receipts[args.p_request_id] = { payload: [args.p_operation, args.p_payload], receipt }
      if (data.mode === 'held') data.held.push(args.p_request_id)
      return { receipt, mode: data.mode }
    })
    if (result.mode === 'held') await awaitRelease(args.p_request_id)
    if (result.mode === 'lost') throw Error('Synthetic lost response after commit')
    if (result.mode === 'unknown') return { data: null, error: { code: 'SYNTHETIC_UNKNOWN' } }
    return { data: result.receipt, error: null }
  }
  if (name === 'pilot_reconcile_catalog_v1') return update(data => {
    const prior = data.receipts[args.p_request_id]
    if (prior) return { data: { status: 'committed', receipt: prior.receipt }, error: null }
    if (args.p_abandon && !data.abandoned.includes(args.p_request_id)) data.abandoned.push(args.p_request_id)
    return { data: { status: data.abandoned.includes(args.p_request_id) ? 'abandoned' : 'unknown' }, error: null }
  })
  await update(data => { data.unexpected.push(name) }); throw Error(`Unexpected RPC ${name}`)
}
export const supabase = {
  supabaseUrl: backend, rest: { url: backend + '/rest/v1', schemaName: 'public' },
  rpc(name: string, args: any = {}) {
    let signal: AbortSignal | undefined
    const request = { abortSignal(value: AbortSignal) { signal = value; return request }, then(resolve: any, reject: any) { return Promise.resolve().then(() => { signal?.throwIfAborted(); return operation(name, args) }).then(resolve, reject) } }
    return request
  },
  from(table: string): never { void update(data => { data.rawCalls.push(table) }); throw Error('Raw table access is forbidden in synthetic QA') },
}
export function FixturePanel() {
  const [data, setData] = useState(read), [probe, setProbe] = useState('Not run'), [native, setNative] = useState(''), [locks, setLocks] = useState('')
  useEffect(() => {
    const changed = () => setData(read())
    const diagnostics = () => requestAnimationFrame(() => {
      const dialog = document.querySelector('dialog'), focus = document.activeElement as HTMLElement | null
      const box = dialog?.getBoundingClientRect()
      setNative(JSON.stringify({ secureContext: isSecureContext, nativeLocks: typeof navigator.locks?.request, nativeDialog: typeof HTMLDialogElement.prototype.showModal, modal: dialog?.matches(':modal') ?? false, focus: focus?.id || focus?.textContent?.slice(0, 70), focusInDialog: !!dialog?.contains(focus), viewport: [innerWidth, innerHeight], dialog: box && { x: box.x, y: box.y, width: box.width, height: box.height }, horizontalOverflow: document.documentElement.scrollWidth > innerWidth }))
    })
    window.addEventListener('storage', changed); window.addEventListener(eventName, changed); document.addEventListener('focusin', diagnostics); window.addEventListener('resize', diagnostics); diagnostics()
    // Observe native storage settlement; never wrap or replace its methods.
    const observe = window.setInterval(() => { changed(); void navigator.locks.query().then(value => setLocks(JSON.stringify(value))) }, 250)
    return () => { window.clearInterval(observe); window.removeEventListener('storage', changed); window.removeEventListener(eventName, changed); document.removeEventListener('focusin', diagnostics); window.removeEventListener('resize', diagnostics) }
  }, [])
  const durable = Object.keys(localStorage).filter(key => key.startsWith('catalogue-request:')).length
  return <aside aria-label="Synthetic QA controls" className="border-b border-gray-300 p-3 text-sm space-y-2">
    <p><strong>Test-only boundary.</strong> Native dialog, Web Locks, localStorage and crypto are not replaced.</p>
    <label>Fixture reply mode <select value={data.mode} onChange={event => { const mode = event.target.value as Mode; void update(row => { row.mode = mode }) }}><option value="normal">Normal commit</option><option value="held">Hold after commit</option><option value="lost">Lose response after commit</option><option value="unknown">Unknown without commit</option></select></label>
    <button className="ui-action ui-action--secondary mx-2" onClick={() => { void update(row => { row.released = [...row.held] }) }}>Release held replies</button>
    <button className="ui-action ui-action--secondary" onClick={async () => {
      setProbe('Waiting for native lock')
      const transport = createCatalogueBackend(supabase as any)
      const sender = createCatalogueTransactionSender({ backend, actorId: actor, role, scope: 'catalogue-status-pages', storage: () => localStorage, isCurrent: () => true, authorize: async () => decodeProcurementAccessV2((await supabase.rpc('pilot_procurement_access_v2')).data) }, transport)
      try { await sender('create', { kind: 'customer', values: { name: 'Fictional competing probe', address: null, city: null, phone: null, email: null, pricing_tier: 'others', customer_category: 'perorangan' } }); setProbe('DISPATCHED: inspect count') }
      catch (error) { setProbe(`Refused: ${(error as Error).message}`) }
    }}>Probe competing sender</button>
    <p role="status">Commands: {data.attempts.length}; committed: {Object.keys(data.receipts).length}; rows: {data.customers.length}; raw calls: {data.rawCalls.length}; unexpected RPCs: {data.unexpected.length}; durable requests: {durable}; held replies: {data.held.filter(id => !data.released.includes(id)).length}</p>
    <p>Probe: {probe}</p><pre className="whitespace-pre-wrap break-all text-xs" aria-label="Native lock diagnostics">{locks}</pre><pre className="whitespace-pre-wrap break-all text-xs" aria-label="Native diagnostics">{native}</pre>
  </aside>
}
