import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { expect, vi } from 'vitest'

// Fresh caches expose missing invalidation even when the default staleTime would hide it.
export function cacheProbe(client: QueryClient) {
  const keys = [
    ['purchase_orders', 'actor:executive', { status: 'all', search: '' }, 1],
    ['my_customers', 'actor:executive', {}, 1],
    ['customer_performance', 'actor:executive', { yearMonth: '2026-10' }, 1],
    ['performance', 'actor:executive', { yearMonth: '2026-10' }, 1],
    ['revenue', 'actor:executive', { period: '30d' }, 1],
    ['today_activity', 'actor', ['sales']],
  ]
  keys.forEach(key => client.setQueryData(key, { before: true }))
  const activeKey = ['athel_dashboard', '2026-10-01', '2026-10-31', 'all', 'all']
  client.setQueryData(activeKey, { before: true })
  const refetch = vi.fn(async () => ({ before: false }))
  const observer = new QueryObserver(client, { queryKey: activeKey, queryFn: refetch, staleTime: Infinity })
  const stop = observer.subscribe(() => {})
  return {
    stop,
    unchanged() {
      keys.forEach(key => expect(client.getQueryState(key)?.isInvalidated).toBe(false))
      expect(refetch).not.toHaveBeenCalled()
    },
    refreshed() {
      keys.forEach(key => expect(client.getQueryState(key)?.isInvalidated).toBe(true))
      expect(refetch).toHaveBeenCalledTimes(1)
      expect(client.getQueryData(activeKey)).toEqual({ before: false })
    },
  }
}
