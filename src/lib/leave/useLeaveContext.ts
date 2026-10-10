import { useCallback, useEffect, useLayoutEffect, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient, UseQueryResult } from '@tanstack/react-query'
import { useAuth } from '../AuthContext'
import type { LeaveContext, UUID } from './contracts'
import { fetchLeaveContext } from './rpc'
import { leaveKeys, synchronizeLeaveIdentity, synchronizeLeaveScope } from './queryKeys'

type ReadReceipt={attempt:number;state:'unvalidated'|'pending'|'ready'}
type AuthorityRead={receipt:ReadReceipt;completed:WeakMap<LeaveContext,number>;listeners:Set<()=>void>}
const authorityReads=new WeakMap<QueryClient,Map<UUID,AuthorityRead>>()
/** Completion evidence stays outside the query's revertible cached status. It holds
 * only counters and weak result references, never a retained private context copy. */
function authorityRead(client:QueryClient,identity:UUID):AuthorityRead{
 let reads=authorityReads.get(client);if(!reads){reads=new Map();authorityReads.set(client,reads)}
 let read=reads.get(identity);if(!read){read={receipt:{attempt:0,state:'unvalidated'},completed:new WeakMap(),listeners:new Set()};reads.set(identity,read)}
 return read
}
function publish(read:AuthorityRead,receipt:ReadReceipt){read.receipt=receipt;read.listeners.forEach(listener=>listener())}
function validated(read:AuthorityRead,context:LeaveContext|undefined,attempt=read.receipt.attempt){
 return !!context&&read.receipt.attempt===attempt&&read.receipt.state==='ready'&&read.completed.get(context)===attempt
}
function contextOptions(client: QueryClient, identity: UUID) {
  return {
    queryKey: leaveKeys.context(identity, 'current'),
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const read=authorityRead(client,identity),attempt=read.receipt.attempt+1
      publish(read,{attempt,state:'pending'})
      const interrupted=()=>{if(read.receipt.attempt===attempt)publish(read,{attempt,state:'unvalidated'})}
      signal.addEventListener('abort',interrupted,{once:true})
      try {
        const context = await fetchLeaveContext(signal)
        signal.throwIfAborted(); synchronizeLeaveScope(client, identity, context.scopeVersion)
        read.completed.set(context,attempt)
        if(read.receipt.attempt===attempt)publish(read,{attempt,state:'ready'})
        return context
      } catch (error) {
        interrupted()
        if (!signal.aborted) synchronizeLeaveScope(client, identity)
        throw error
      }finally{signal.removeEventListener('abort',interrupted)}
    // Authority must attempt a read even offline, so cancellation cannot revert a
    // paused-before-start request to an older receipt. Transport failures stay blocked.
    // Preserve result identity too: equal JSON is not proof of a new completed read.
    }, networkMode:'always', structuralSharing:false, staleTime: 0, retry: false,
  } as const
}
export function useLeaveContext(): UseQueryResult<LeaveContext>&{authorityReady:boolean;authorityPending:boolean} {
  const { user, profile, loading } = useAuth(), client = useQueryClient()
  const identity = !loading && user && profile?.is_active && profile.id === user.id ? user.id : null
  const query = useQuery({ ...contextOptions(client, identity ?? 'signed-out'), enabled: !!identity,
    refetchOnWindowFocus: 'always', refetchInterval: () => document.visibilityState === 'visible' ? 60_000 : false, refetchIntervalInBackground: false })
  const read=authorityRead(client,identity??'signed-out')
  const subscribe=useCallback((listener:()=>void)=>{read.listeners.add(listener);return()=>{read.listeners.delete(listener)}},[read])
  const receipt=useSyncExternalStore(subscribe,()=>read.receipt,()=>read.receipt)
  useLayoutEffect(() => {
    synchronizeLeaveIdentity(client, identity)
    // AuthProvider already clears on identity/sign-out. Unmounting one observer must not evict others.
  }, [client, identity])
  useEffect(() => {
    const refresh = () => { if (identity && document.visibilityState === 'visible') void query.refetch() }
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [identity, query.refetch])
  return {...query,authorityReady:!!identity&&query.isSuccess&&!query.isFetching&&validated(read,query.data),authorityPending:!!identity&&receipt.state==='pending'}
}
/** Later private-detail/decision handlers must enter here; each RPC still authorizes server-side. */
export async function runLeaveInteraction<T>(client: QueryClient, identity: UUID, scopeVersion: string, action: (context: LeaveContext) => Promise<T> | T): Promise<T> {
  const pending=client.fetchQuery(contextOptions(client, identity))
  const read=authorityRead(client,identity),attempt=read.receipt.attempt
  const context = await pending
  if(!validated(read,context,attempt))throw new Error('Akses cuti belum dikonfirmasi. Silakan coba lagi.')
  if (context.scopeVersion !== scopeVersion) throw new Error('Data atau akses cuti berubah. Muat ulang sebelum melanjutkan.')
  return action(context)
}
