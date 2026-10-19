import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../AuthContext'
import { supabase } from '../supabase'
import { createCatalogueBackend } from './backend'
import type { CatalogueBackend } from './backend'
import type { CatalogueIdentity, CatalogueKind, CatalogueMaintainerRole, CatalogueReceipt, CatalogueStatus } from './contracts'
import { catalogueKeys, invalidateCatalogueProjections, synchronizeCatalogueIdentity, validateCatalogueIdentity } from './queryKeys'
import { fetchCatalogueOptions, fetchCataloguePage } from './reads'
import { createCatalogueTransactionSender } from './transactions'
import type { CatalogueTransactionSender } from './transactions'
import { useCatalogueAccess } from './useCatalogueAccess'
import { decodeCatalogueDeleteAccess, invalidCatalogue, parseCatalogueReceipt } from './validation'
import type { CatalogueOwner } from '../../components/catalogue/CatalogueRecovery'

const unavailableBackend: CatalogueBackend = {
  backend: 'unavailable',
  assertCurrent: () => { throw new Error('Backend katalog belum tersedia.') },
  rpc: async () => { throw new Error('Backend katalog belum tersedia.') },
  withExclusiveLock: async () => { throw new Error('Kunci katalog belum tersedia.') },
}
const maintainers = new Set(['co_admin', 'po_admin', 'executive'])
const readers = new Set([...maintainers, 'sales_person', 'sales_manager', 'sales_head'])
function localCommandsAvailable() {
  try { return typeof navigator.locks?.request === 'function' && typeof localStorage.getItem === 'function' && typeof localStorage.setItem === 'function' }
  catch { return false }
}

/** One operation owner for both lists. Pagination, filters and the receipt's kind
 * do not change the durable scope, so navigation never strands a pending request. */
export function useCataloguePage<K extends CatalogueKind>(options: { kind: K; search: string; page: number; pageSize: number; status: CatalogueStatus }) {
  const auth = useAuth(), client = useQueryClient()
  const backend = useMemo(() => { try { return createCatalogueBackend(supabase) } catch { return null } }, [supabase])
  const identity = useMemo<CatalogueIdentity | null>(() => {
    if (!backend || auth.loading || auth.error || !auth.user || !auth.profile?.is_active || auth.profile.id !== auth.user.id || !readers.has(auth.profile.role)) return null
    try { return validateCatalogueIdentity({ backend: backend.backend, actorId: auth.user.id, role: auth.profile.role as CatalogueIdentity['role'] }) }
    catch { return null }
  }, [backend, auth.loading, auth.error, auth.user?.id, auth.profile?.id, auth.profile?.is_active, auth.profile?.role])
  const scope = useMemo(() => ({ active: false, epoch: 0 }), [backend, identity])
  const liveScope = useRef(scope); liveScope.current = scope
  useLayoutEffect(() => {
    scope.active = true; scope.epoch++
    void synchronizeCatalogueIdentity(client, identity)
    return () => { scope.active = false; scope.epoch++ }
  }, [client, identity, scope])
  const identityCurrent = useCallback(() => !!identity && liveScope.current === scope && scope.active, [identity, scope])
  const access = useCatalogueAccess({ identity: identity && maintainers.has(identity.role) ? identity : null, transport: backend ?? unavailableBackend })
  const readClient = supabase
  const readiness = useMemo(() => ({ epoch: 0, accepted: null as null | { access: ReturnType<typeof decodeCatalogueDeleteAccess>; scope: typeof scope; epoch: number } }), [scope])
  const deleteAccess = useQuery({
    queryKey: identity ? [...catalogueKeys.authority(identity), 'guarded-delete-readiness'] : ['catalogue', 'unavailable', 'guarded-delete-readiness'],
    enabled: identity?.role === 'co_admin', retry: false, staleTime: 0, structuralSharing: false,
    // Every attempt must invalidate accepted readiness, even if the browser is
    // offline. A paused-then-cancelled query must not revive cached permission.
    networkMode: 'always', refetchOnWindowFocus: 'always', refetchOnReconnect: 'always',
    queryFn: async ({ signal }) => {
      if (!identity || !backend || !identityCurrent() || identity.role !== 'co_admin') invalidCatalogue('guarded delete readiness owner')
      const epoch = scope.epoch, request = ++readiness.epoch
      readiness.accepted = null
      const refuse = () => { if (readiness.epoch === request) readiness.accepted = null }
      signal.addEventListener('abort', refuse, { once: true })
      try {
        backend.assertCurrent(); signal.throwIfAborted()
        const { data, error } = await readClient.rpc('pilot_catalog_delete_access_v1', {}).abortSignal(signal)
        backend.assertCurrent(); signal.throwIfAborted()
        if (!identityCurrent() || scope.epoch !== epoch || readiness.epoch !== request || error) invalidCatalogue('guarded delete readiness unavailable')
        const accepted = { access: decodeCatalogueDeleteAccess(data, identity.actorId), scope, epoch }
        readiness.accepted = accepted
        return accepted
      } catch (error) { refuse(); throw error }
      finally { signal.removeEventListener('abort', refuse) }
    },
  })
  const [pending, setPending] = useState<{ sender: CatalogueTransactionSender; busy: boolean; recovery: boolean } | null>(null)
  const ownerSequence = useRef(0)
  const operation = useMemo(() => {
    if (!backend || !identity || !maintainers.has(identity.role)) return null
    const owner: CatalogueOwner = {
      key: `${JSON.stringify(identity)}:${++ownerSequence.current}`, actorId: identity.actorId, role: identity.role as CatalogueMaintainerRole,
      isCurrent: () => identityCurrent() && access.isCurrent(),
    }
    const core = createCatalogueTransactionSender({ ...identity, role: owner.role, scope: 'catalogue-status-pages',
      storage: () => localStorage, authorize: access.authorize, isCurrent: owner.isCurrent }, backend)
    // Notify the stable page owner, not a row that may have disappeared while sending.
    const sender: CatalogueTransactionSender = Object.assign(async (...args: Parameters<CatalogueTransactionSender>) => {
      if (identityCurrent()) setPending({ sender, busy: true, recovery: true })
      try { return await core(...args) }
      finally { if (identityCurrent()) setPending({ sender, busy: false, recovery: core.hasUnresolved() }) }
    }, { hasUnresolved: core.hasUnresolved, reconcile: core.reconcile, acknowledgeRecovered: core.acknowledgeRecovered, acknowledgeAbandoned: core.acknowledgeAbandoned })
    return { owner, sender }
  }, [backend, identity, identityCurrent, access.isCurrent, access.authorize])
  useLayoutEffect(() => {
    if (operation) setPending({ sender: operation.sender, busy: false, recovery: operation.sender.hasUnresolved() })
  }, [operation])
  const args = { kind: options.kind, purpose: 'catalogue' as const, status: options.status, search: options.search.trim(), page: options.page, page_size: options.pageSize }
  const query = useQuery({
    queryKey: identity ? catalogueKeys.read(identity, args) : ['catalogue', 'unavailable', 'page', options.kind],
    enabled: identity !== null,
    queryFn: async ({ signal }) => {
      if (!identity || !backend) invalidCatalogue('current page identity')
      const epoch = scope.epoch
      const isCurrent = () => identityCurrent() && scope.epoch === epoch
      const page = await fetchCataloguePage(args, { identity, transport: backend, signal, isCurrent })
      // PaginationControls accepts a number. Never silently round a decimal count.
      if (BigInt(page.total_count) > BigInt(Number.MAX_SAFE_INTEGER)) invalidCatalogue('pagination count exceeds safe range')
      return { page, scope, epoch, total: Number(page.total_count) }
    },
    placeholderData: previous => previous?.scope === scope && previous.epoch === scope.epoch ? previous : undefined,
    retry: false, structuralSharing: false,
  })
  const accepted = identityCurrent() && query.data?.scope === scope && query.data.epoch === scope.epoch ? query.data : undefined
  const busy = !!pending && pending.sender === operation?.sender && pending.busy
  // Retain the recovery panel through terminal refresh and acknowledgment, including
  // a failed lock release after storage removal. Only completion releases this hold.
  const unresolved = !!operation && ((pending?.sender === operation.sender && pending.recovery) || operation.sender.hasUnresolved())
  const refresh = useCallback(async () => {
    if (!identity || !identityCurrent()) return false
    await invalidateCatalogueProjections(client, identity, options.kind)
    return identityCurrent()
  }, [client, identity, identityCurrent, options.kind])
  const acceptCanonical = async (raw: CatalogueReceipt) => {
    if (!identity || !backend || !operation?.owner.isCurrent()) return false
    const receipt = parseCatalogueReceipt(raw)
    if (receipt.actor_id !== identity.actorId) return false
    const deleted = receipt.operation === 'delete_unused'
    if (deleted ? !receipt.before || receipt.after !== null : !['create', 'edit', 'set_enabled'].includes(receipt.operation) || !receipt.after) return false
    const current = operation.owner.isCurrent
    // The receipt may belong to the other page or a row outside this filter/page.
    const rows = await fetchCatalogueOptions(receipt.kind, 'all-for-history', { identity, transport: backend, isCurrent: current })
    const row = rows.find(item => item.id === receipt.id)
    // A validated terminal receipt proves the write even if this identity was
    // subsequently deleted. The complete authorized history read establishes
    // canonical absence; it never proves success for an unknown request.
    if (!current()) return false
    // A valid deletion receipt, never a missing row, proves the completed action.
    // A later recreation is canonical only at a strictly newer identity version.
    if (deleted) {
      if (row && BigInt(row.catalog_version) <= BigInt(receipt.before!.catalog_version)) return false
    } else if (row && (BigInt(row.catalog_version) < BigInt(receipt.after!.catalog_version)
      || row.catalog_version === receipt.after!.catalog_version && row.is_enabled !== receipt.after!.is_enabled)) return false
    await invalidateCatalogueProjections(client, identity, receipt.kind)
    if (!current()) return false
    if (receipt.kind === options.kind) await query.refetch({ throwOnError: true })
    // No receipt-derived cache write: a newer canonical row must never be overwritten.
    return current()
  }
  const acceptAbandoned = async () => {
    if (!identity || !operation || !identityCurrent()) return false
    await access.refetch({ throwOnError: true })
    if (!operation.owner.isCurrent()) return false
    await Promise.all((['customer', 'product'] as const).map(kind => invalidateCatalogueProjections(client, identity, kind)))
    await query.refetch({ throwOnError: true })
    return operation.owner.isCurrent()
  }
  const settled = () => {
    if (operation?.owner.isCurrent() && !operation.sender.hasUnresolved()) setPending({ sender: operation.sender, busy: false, recovery: false })
  }
  const locallyAvailable = !!backend && localCommandsAvailable()
  return {
    ...query,
    data: accepted ? { items: accepted.page.rows, total: accepted.total } : undefined,
    isError: query.isError || !auth.loading && !identity,
    owner: operation?.owner ?? null, sender: operation?.sender ?? null,
    authority: access.ready ? access.data! : null,
    commandsAvailable: locallyAvailable && !!accepted && !query.isError && !query.isFetching && !query.isPlaceholderData,
    guardedDeleteAvailable: identity?.role === 'co_admin' && access.ready && deleteAccess.isSuccess && deleteAccess.fetchStatus === 'idle' && deleteAccess.data === readiness.accepted
      && deleteAccess.data?.scope === scope && deleteAccess.data.epoch === scope.epoch && deleteAccess.data.access[`${options.kind}_delete`],
    recoveryAvailable: locallyAvailable && access.ready,
    busy, unresolved, acceptCanonical, acceptAbandoned, onConfirmed: settled, onAbandoned: settled, refresh,
  }
}
