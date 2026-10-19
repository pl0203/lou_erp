import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

export async function fetchPendingVisitReviewCount(actorId: string, signal?: AbortSignal) {
  // RLS applies pilot_can_schedule(customer_id, requester_id). Exclude the
  // separately visible own requests: reviewers cannot approve themselves.
  let query = supabase.from('visit_requests').select('id', { count: 'exact', head: true })
    .eq('status', 'pending').neq('requester_id', actorId)
  if (signal) query = query.abortSignal(signal)
  const { count, error } = await query
  if (error) throw error
  if (count === null) throw new Error('Jumlah permintaan belum tersedia.')
  return count
}

export function usePendingVisitReviewCount(actorId?: string, role?: string) {
  const enabled = !!actorId && ['sales_manager', 'sales_head', 'executive'].includes(role ?? '')
  const query = useQuery({
    queryKey: ['visit_requests', actorId, role, 'pending-review-count'],
    queryFn: ({ signal }) => fetchPendingVisitReviewCount(actorId!, signal),
    enabled,
    refetchOnWindowFocus: 'always',
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  })
  const { refetch } = query
  useEffect(() => {
    if (!enabled) return
    // React Query v5 observes visibilitychange; window focus also covers
    // switching between windows while this document remains visible.
    const refresh = () => { void refetch() }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [enabled, refetch])
  // Never display a previous actor's number or a stale count after a read error.
  return enabled && query.isSuccess ? query.data : undefined
}
