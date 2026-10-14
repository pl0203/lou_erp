import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { CatalogueIdentity, CatalogueRequestBinding, ProcurementAccessV2 } from './contracts'
import { fetchCatalogueAccess } from './reads'
import type { CatalogueReadTransport } from './reads'
import { catalogueKeys, validateCatalogueIdentity } from './queryKeys'
import { invalidCatalogue, parseCatalogueRequestBinding } from './validation'

type OwnerIncarnation = { entry: Authority; retired: boolean }
type Authority = { epoch: number; revision: number; accepted?: ProcurementAccessV2; acceptedEpoch?: number; listeners: Set<() => void> }
const authorities = new WeakMap<QueryClient, WeakMap<CatalogueReadTransport, Map<string, Authority>>>()
function authority(client: QueryClient, transport: CatalogueReadTransport, key: string): Authority {
  let transports = authorities.get(client)
  if (!transports) { transports = new WeakMap(); authorities.set(client, transports) }
  let entries = transports.get(transport)
  if (!entries) { entries = new Map(); transports.set(transport, entries) }
  let entry = entries.get(key)
  if (!entry) { entry = { epoch: 0, revision: 0, listeners: new Set() }; entries.set(key, entry) }
  return entry
}
function changed(entry: Authority) { entry.revision++; entry.listeners.forEach(fn => fn()) }
function invalidate(entry: Authority) { entry.accepted = undefined; entry.acceptedEpoch = undefined; changed(entry) }
const denied = Object.freeze({ customer_create: false, customer_edit: false, customer_delete: false, product_create: false, product_edit: false,
  product_delete: false, customer_set_enabled: false, product_set_enabled: false, customer_delete_mode: 'none' as const, product_delete_mode: 'none' as const })
export interface CatalogueAccessOptions { identity: CatalogueIdentity | null; transport: CatalogueReadTransport }
/** Supply a stable backend adapter, shared with the transaction sender.
 * Explicit backend/current identity injection keeps this hook independent of ambient configuration and legacy v1 access. */
export function useCatalogueAccess(options: CatalogueAccessOptions) {
  const client = useQueryClient(), identity = options.identity === null ? null : validateCatalogueIdentity(options.identity)
  const key = identity ? catalogueKeys.authority(identity) : ['catalogue', 'unavailable', 2, 'authority'] as const
  const scope = JSON.stringify(key), transport = options.transport, entry = authority(client, transport, scope)
  const owner = useRef<OwnerIncarnation | null>(null)
  if (!owner.current || owner.current.entry !== entry || owner.current.retired) owner.current = { entry, retired: false }
  const incarnation = owner.current
  const [, renderIncarnation] = useState(0)
  const lease = useRef<{ incarnation: OwnerIncarnation; startEpoch: number } | null>(null)
  const subscribe = useCallback((listener: () => void) => { entry.listeners.add(listener); return () => { entry.listeners.delete(listener) } }, [entry])
  useSyncExternalStore(subscribe, () => entry.revision, () => entry.revision)
  useLayoutEffect(() => {
    // Cleanup permanently retires this captured owner. Returning to the same
    // identity/transport must never revive callbacks or pending work from it.
    let token = owner.current
    if (!token || token.entry !== entry || token.retired) owner.current = token = { entry, retired: false }
    lease.current = { incarnation: token, startEpoch: entry.epoch }
    // React StrictMode can replay effects without a render. Publish a distinct
    // incarnation rather than reactivating the one retired by its cleanup.
    if (token !== incarnation) renderIncarnation(value => value + 1)
    return () => {
      token.retired = true
      if (lease.current?.incarnation === token) lease.current = null
      entry.epoch++; invalidate(entry)
    }
  }, [entry])
  const baseCurrent = useCallback(() => !incarnation.retired && owner.current === incarnation && lease.current?.incarnation === incarnation, [incarnation])
  const queryFn = async ({ signal }: { signal: AbortSignal }) => {
    // React Query may invoke an earlier options closure on effect replay. A
    // fresh read captures the CURRENT incarnation once at invocation, then may
    // not borrow any replacement incarnation across its asynchronous boundary.
    const queryOwner = owner.current
    const epoch = ++entry.epoch; invalidate(entry)
    const queryCurrent = () => !!queryOwner && !queryOwner.retired && queryOwner.entry === entry
      && owner.current === queryOwner && lease.current?.incarnation === queryOwner && entry.epoch === epoch
    const refuse = () => { if (entry.epoch === epoch) invalidate(entry) }
    signal.addEventListener('abort', refuse, { once: true })
    try {
      if (!identity) invalidCatalogue('current authority unavailable')
      const access = await fetchCatalogueAccess({ identity, transport, signal, isCurrent: queryCurrent })
      signal.throwIfAborted()
      if (!queryCurrent()) invalidCatalogue('authority epoch')
      entry.accepted = access; entry.acceptedEpoch = epoch; changed(entry)
      return access
    } catch (error) { refuse(); throw error } finally { signal.removeEventListener('abort', refuse) }
  }
  const query = useQuery({ queryKey: key, queryFn, enabled: identity !== null, structuralSharing: false,
    staleTime: 0, retry: false, networkMode: 'always', refetchOnWindowFocus: 'always', refetchOnReconnect: 'always' })
  const isCurrent = useCallback(() => {
    const state = client.getQueryState(key)
    return !!identity && baseCurrent() && entry.accepted !== undefined && entry.acceptedEpoch === entry.epoch && entry.acceptedEpoch > lease.current!.startEpoch
      && state?.status === 'success' && state.fetchStatus === 'idle' && state.data === entry.accepted
  }, [client, scope, baseCurrent, entry])
  const requireBinding = useCallback((raw: CatalogueRequestBinding) => {
    const binding = parseCatalogueRequestBinding(raw)
    if (!isCurrent() || !entry.accepted) invalidCatalogue('fresh current authority')
    if (binding.operation === 'delete_unused') {
      if (entry.accepted.role !== 'co_admin' || entry.accepted[`${binding.kind}_delete_mode`] !== 'guarded') invalidCatalogue('guarded delete authority')
    } else if (!entry.accepted[`${binding.kind}_${binding.operation}`]) invalidCatalogue('operation authority')
  }, [entry, isCurrent])
  const authorize = useCallback(async (binding: CatalogueRequestBinding) => {
    if (!identity || !baseCurrent()) invalidCatalogue('current authority owner')
    const target = parseCatalogueRequestBinding(binding)
    // Do not share an older in-flight fetch or accept a cache revert as a fresh
    // authority result. Cancellation invalidates the non-revertible epoch too.
    await client.cancelQueries({ queryKey: key, exact: true })
    if (!baseCurrent()) invalidCatalogue('current authority owner')
    const result = await client.fetchQuery({ queryKey: key, queryFn, staleTime: 0, retry: false, networkMode: 'always', structuralSharing: false })
    requireBinding(target)
    return result
  }, [client, scope, baseCurrent, requireBinding])
  const ready = isCurrent() && query.isSuccess && !query.isFetching
  return { ...query, ready, capabilities: ready ? entry.accepted! : denied, require: requireBinding, authorize, isCurrent }
}
