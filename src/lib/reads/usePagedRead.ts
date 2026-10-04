import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../AuthContext'

type PageState = { total: number; page: number; page_size: number }

/** Owns filters and page together so a filter never requests the previous page. */
export function usePagedRead<R extends PageState, F>(key: string, initialFilters: F, fetcher: (filters: F, page: number, signal: AbortSignal) => Promise<R>) {
  const { profile } = useAuth()
  const identity = `${profile?.id ?? ''}:${profile?.role ?? ''}`
  const [state, setState] = useState({ filters: initialFilters, page: 1 })
  const query = useQuery({
    queryKey: [key, identity, state.filters, state.page],
    queryFn: ({ signal }) => fetcher(state.filters, state.page, signal),
    enabled: !!profile?.id,
    // Retained rows still carry their original page. Never carry them across identities.
    placeholderData: (previousData, previousQuery) => previousQuery?.queryKey[1] === identity ? previousData : undefined,
  })
  const setFilters = useCallback((filters: F | ((previous: F) => F)) => {
    setState(previous => {
      const next = typeof filters === 'function' ? (filters as (previous: F) => F)(previous.filters) : filters
      return Object.is(next, previous.filters) ? previous : { filters: next, page: 1 }
    })
  }, [])
  const setPage = useCallback((page: number) => {
    if (!Number.isSafeInteger(page) || page < 1) return
    setState(previous => ({ ...previous, page }))
  }, [])
  useEffect(() => {
    if (!query.data || query.isPlaceholderData || query.isFetching || query.isError) return
    const last = Math.max(1, Math.ceil(query.data.total / query.data.page_size))
    if (state.page > last) setPage(last)
  }, [query.data, query.isPlaceholderData, query.isFetching, query.isError, state.page, setPage])
  const invalidPage = !!query.data && query.data.page > Math.max(1, Math.ceil(query.data.total / query.data.page_size))
  return { data: invalidPage ? undefined : query.data, filters: state.filters, page: state.page, setFilters, setPage, isPending: invalidPage || query.isPending || query.isFetching || query.isPlaceholderData, isError: query.isError, refetch: query.refetch }
}
