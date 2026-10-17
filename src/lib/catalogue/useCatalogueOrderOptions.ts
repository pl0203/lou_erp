import { useId, useLayoutEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../AuthContext'
import { supabase } from '../supabase'
import { createCatalogueBackend } from './backend'
import type { CatalogueIdentity, CatalogueKind, CatalogueRow } from './contracts'
import { catalogueKeys, synchronizeCatalogueIdentity, validateCatalogueIdentity } from './queryKeys'
import { fetchCatalogueOptions } from './reads'

/** Complete, owner-bound choices. Historical hydration must request its own purpose. */
export function useCatalogueOrderOptions<K extends CatalogueKind>(kind: K, purpose: 'enabled-for-order' | 'all-for-history') {
  const auth = useAuth(), client = useQueryClient(), observer = useId()
  const backend = useMemo(() => { try { return createCatalogueBackend(supabase) } catch { return null } }, [supabase])
  const identity = useMemo<CatalogueIdentity | null>(() => {
    if (!backend || auth.loading || auth.error || !auth.user || !auth.profile?.is_active || auth.profile.id !== auth.user.id) return null
    try { return validateCatalogueIdentity({ backend: backend.backend, actorId: auth.user.id, role: auth.profile.role as CatalogueIdentity['role'] }) }
    catch { return null }
  }, [backend, auth.loading, auth.error, auth.user?.id, auth.profile?.id, auth.profile?.role, auth.profile?.is_active])
  const scope = useMemo(() => ({ active: false, epoch: 0, request: 0 }), [identity, backend, kind, purpose])
  const live = useRef(scope); live.current = scope
  const args = { kind, purpose, status: purpose === 'enabled-for-order' ? 'enabled' as const : 'all' as const, search: '', page: 1, page_size: 250 }
  const queryKey = identity ? [...catalogueKeys.read(identity, args), 'complete-options', observer] : ['catalogue', 'unavailable', 'order-options', kind, purpose]
  useLayoutEffect(() => {
    scope.active = true; scope.epoch++
    // Fetch starts before queryFn when offline. Cancellation must not revive the
    // previous accepted envelope even if this attempt never reaches queryFn.
    const unsubscribe = client.getQueryCache().subscribe(event => {
      if (scope.active && live.current === scope && event.type === 'updated' && event.action.type === 'fetch' &&
        event.query === client.getQueryCache().find({ queryKey, exact: true })) scope.request++
    })
    void synchronizeCatalogueIdentity(client, identity)
    return () => { scope.active = false; scope.epoch++; unsubscribe() }
  }, [client, identity, scope])
  const query = useQuery({
    queryKey,
    enabled: identity !== null,
    queryFn: async ({ signal }) => {
      if (!identity || !backend) throw new Error('Identitas katalog belum tersedia.')
      const epoch = scope.epoch, request = ++scope.request
      const isCurrent = () => live.current === scope && scope.active && scope.epoch === epoch && scope.request === request
      const rows = await fetchCatalogueOptions(kind, purpose, { identity, transport: backend, signal, isCurrent })
      return { rows: [...rows].sort((a, b) => a.name.localeCompare(b.name)), scope, epoch, request }
    },
    retry: false, structuralSharing: false,
  })
  const accepted = scope.active && live.current === scope && query.data?.scope === scope && query.data.epoch === scope.epoch && query.data.request === scope.request ? query.data.rows : undefined
  /** Current complete options for event/await boundaries; unavailable or drifted reads fail closed. */
  function getCurrentData(): CatalogueRow<K>[] | undefined {
    if (!identity || !backend || !scope.active || live.current !== scope) return undefined
    try { backend.assertCurrent() } catch { return undefined }
    const state = client.getQueryState<NonNullable<typeof query.data>>(queryKey)
    const data = state?.data
    if (!state || state.status !== 'success' || state.fetchStatus !== 'idle' || state.isInvalidated || state.error ||
      !data || data.scope !== scope || data.epoch !== scope.epoch || data.request !== scope.request) return undefined
    return data.rows
  }
  return { ...query, data: accepted, getCurrentData, isError: query.isError || !auth.loading && !identity }
}
