import { useId, useLayoutEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../AuthContext'
import { supabase } from '../supabase'
import { createCatalogueBackend } from './backend'
import type { CatalogueIdentity, CatalogueKind } from './contracts'
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
  const scope = useMemo(() => ({ active: false, epoch: 0 }), [identity, backend])
  const live = useRef(scope); live.current = scope
  useLayoutEffect(() => {
    scope.active = true; scope.epoch++
    void synchronizeCatalogueIdentity(client, identity)
    return () => { scope.active = false; scope.epoch++ }
  }, [client, identity, scope])
  const args = { kind, purpose, status: purpose === 'enabled-for-order' ? 'enabled' as const : 'all' as const, search: '', page: 1, page_size: 250 }
  const query = useQuery({
    queryKey: identity ? [...catalogueKeys.read(identity, args), 'complete-options', observer] : ['catalogue', 'unavailable', 'order-options', kind, purpose],
    enabled: identity !== null,
    queryFn: async ({ signal }) => {
      if (!identity || !backend) throw new Error('Identitas katalog belum tersedia.')
      const epoch = scope.epoch
      const isCurrent = () => live.current === scope && scope.active && scope.epoch === epoch
      const rows = await fetchCatalogueOptions(kind, purpose, { identity, transport: backend, signal, isCurrent })
      return { rows: [...rows].sort((a, b) => a.name.localeCompare(b.name)), scope, epoch }
    },
    retry: false, structuralSharing: false,
  })
  const accepted = scope.active && live.current === scope && query.data?.scope === scope && query.data.epoch === scope.epoch ? query.data.rows : undefined
  return { ...query, data: accepted, isError: query.isError || !auth.loading && !identity }
}
