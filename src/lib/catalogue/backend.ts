import type { SupabaseClient } from '@supabase/supabase-js'
import type { CatalogueReadRpcName, CatalogueReadTransport } from './reads'
import type { CatalogueRpcName, CatalogueTransport } from './transactions'
import { catalogueEnum, invalidCatalogue, parseCatalogueText } from './validation'

type RpcName = CatalogueReadRpcName | CatalogueRpcName
export interface CatalogueBackend extends CatalogueTransport, CatalogueReadTransport {
  assertCurrent(): void
  rpc(name: RpcName, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ data: unknown; error: unknown }>
}
/** Bind to a supplied real client. This module never reads environment variables or creates a second client. */
export function createCatalogueBackend(client: SupabaseClient): CatalogueBackend {
  // Supabase keeps its constructor URL as a protected runtime member. Derive the
  // label from that member, not a separately supplied or ambient backend label.
  const source = client as unknown as { supabaseUrl: unknown; rpc: SupabaseClient['rpc']; rest?: { url: unknown; schemaName?: unknown } }
  const raw = parseCatalogueText(source.supabaseUrl), method = source.rpc
  const url = new URL(raw)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || typeof method !== 'function') invalidCatalogue('backend client')
  const backend = url.href.replace(/\/+$/, '')
  const rest = source.rest, restUrl = `${backend}/rest/v1`
  if (!rest || rest.url !== restUrl || rest.schemaName !== 'public') invalidCatalogue('verified public backend endpoint')
  function current() {
    if (source.supabaseUrl !== raw || source.rpc !== method || source.rest !== rest || rest.url !== restUrl || rest.schemaName !== 'public') invalidCatalogue('backend client changed')
  }
  return Object.freeze({
    backend,
    assertCurrent: current,
    async rpc(name: RpcName, args: Record<string, unknown>, signal?: AbortSignal) {
      current(); signal?.throwIfAborted()
      catalogueEnum(['pilot_catalog_page_v1', 'pilot_procurement_access_v2', 'pilot_catalog_transaction_v1', 'pilot_reconcile_catalog_v1'] as const, name)
      let request = method.call(client, name, args)
      if (signal) request = request.abortSignal(signal)
      const result = await request
      current(); signal?.throwIfAborted()
      return { data: result.data, error: result.error }
    },
    async withExclusiveLock<T>(key: string, action: () => Promise<T>): Promise<T> {
      current()
      if (!parseCatalogueText(key) || typeof action !== 'function') invalidCatalogue('lock scope')
      const locks = globalThis.navigator?.locks
      if (!locks || typeof locks.request !== 'function') invalidCatalogue('native cross-context lock unavailable')
      const name = `catalogue-native:${backend}:${key}`
      let started = false, completed = false
      const result = await locks.request(name, { mode: 'exclusive' }, async lock => {
        current()
        if (started || !lock || lock.name !== name || lock.mode !== 'exclusive') invalidCatalogue('native exclusive ownership')
        started = true
        const value = await action()
        completed = true
        return value
      })
      if (!completed) invalidCatalogue('native lock did not own complete action')
      current()
      return result
    },
  })
}
