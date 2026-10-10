import type { QueryClient } from '@tanstack/react-query'
import type { UUID } from './contracts'

export const LEAVE_BACKEND = import.meta.env.VITE_SUPABASE_URL ?? 'unconfigured'
/** 'current' is the discovery slot; private rows use a server-issued scope revision. */
export function createLeaveKeys(backend: string) {
  return {
    all: ['leave'] as const,
    identity: (identity: UUID) => ['leave', backend, identity] as const,
    context: (identity: UUID, scopeVersion: string) => ['leave', backend, identity, 'context', scopeVersion] as const,
    private: (identity: UUID, scopeVersion: string, ...parts: readonly unknown[]) => ['leave', backend, identity, 'private', scopeVersion, ...parts] as const,
  }
}
export const leaveKeys = createLeaveKeys(LEAVE_BACKEND)
/** A second observer is not revocation. Only clean up different identities/backends on mount. */
export function synchronizeLeaveIdentity(client: QueryClient, identity: UUID | null) {
  const filters = { queryKey: leaveKeys.all, predicate: (query: { queryKey: readonly unknown[] }) => !identity || query.queryKey[1] !== LEAVE_BACKEND || query.queryKey[2] !== identity }
  void client.cancelQueries(filters); client.removeQueries(filters)
}
/** Cancel before removal, so a transport ignoring abort cannot restore obsolete private rows. */
export function synchronizeLeaveScope(client: QueryClient, identity: UUID | null, scopeVersion?: string) {
  const filters = { queryKey: leaveKeys.all, predicate: (query: { queryKey: readonly unknown[] }) => {
    const key = query.queryKey
    if (!identity || key[1] !== LEAVE_BACKEND || key[2] !== identity) return true
    if (key[3] === 'context' && key[4] === 'current') return false
    return scopeVersion === undefined || key[4] !== scopeVersion
  } }
  void client.cancelQueries(filters); client.removeQueries(filters)
}
