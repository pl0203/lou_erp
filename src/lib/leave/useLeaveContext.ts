import { useEffect, useLayoutEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient, UseQueryResult } from '@tanstack/react-query'
import { useAuth } from '../AuthContext'
import type { LeaveContext, UUID } from './contracts'
import { fetchLeaveContext } from './rpc'
import { leaveKeys, synchronizeLeaveIdentity, synchronizeLeaveScope } from './queryKeys'
function contextOptions(client: QueryClient, identity: UUID) {
  return {
    queryKey: leaveKeys.context(identity, 'current'),
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      try {
        const context = await fetchLeaveContext(signal)
        signal.throwIfAborted(); synchronizeLeaveScope(client, identity, context.scopeVersion)
        return context
      } catch (error) {
        if (!signal.aborted) synchronizeLeaveScope(client, identity)
        throw error
      }
    }, staleTime: 0, retry: false,
  } as const
}
export function useLeaveContext(): UseQueryResult<LeaveContext> {
  const { user, profile, loading } = useAuth(), client = useQueryClient()
  const identity = !loading && user && profile?.is_active && profile.id === user.id ? user.id : null
  const query = useQuery({ ...contextOptions(client, identity ?? 'signed-out'), enabled: !!identity,
    refetchOnWindowFocus: 'always', refetchInterval: () => document.visibilityState === 'visible' ? 60_000 : false, refetchIntervalInBackground: false })
  useLayoutEffect(() => {
    synchronizeLeaveIdentity(client, identity)
    // AuthProvider already clears on identity/sign-out. Unmounting one observer must not evict others.
  }, [client, identity])
  useEffect(() => {
    const refresh = () => { if (identity && document.visibilityState === 'visible') void query.refetch() }
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [identity, query.refetch])
  return query
}
/** Later private-detail/decision handlers must enter here; each RPC still authorizes server-side. */
export async function runLeaveInteraction<T>(client: QueryClient, identity: UUID, scopeVersion: string, action: (context: LeaveContext) => Promise<T> | T): Promise<T> {
  const context = await client.fetchQuery(contextOptions(client, identity))
  if (context.scopeVersion !== scopeVersion) throw new Error('Data atau akses cuti berubah. Muat ulang sebelum melanjutkan.')
  return action(context)
}
