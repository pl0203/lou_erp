import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { supabase } from '../supabase'
import { currentDashboardMonth, dashboardMetricDefinitions } from './definitions'
import { validateDashboardArgs, type DashboardArgs, type DashboardMetric, type DashboardScope, type DashboardSort, type DashboardAttention } from './contracts'
import { createDashboardTransport, type DashboardTransport } from './transport'
/** Explicit build capability, disabled by default. A valid v3 read is additionally required. */
export const dashboardFeatureEnabled = import.meta.env.VITE_SALES_DASHBOARD_V3 === 'true'
const BACKEND = import.meta.env.VITE_SUPABASE_URL ?? 'unconfigured'
const productionTransport = createDashboardTransport(async (name, args, signal) => {
  const { data, error } = await supabase.rpc(name, args).abortSignal(signal)
  return { data, error }
})
export function useDashboardRead(scope: DashboardScope, enabled = dashboardFeatureEnabled, transport: DashboardTransport = productionTransport) {
  const auth = useAuth(), client = useQueryClient(), [params, setParams] = useSearchParams()
  const role = auth.profile?.role ?? ''
  const allowedRole = scope === 'own' ? ['sales_person', 'sales_manager', 'sales_head', 'executive'].includes(role) : scope === 'team' ? role === 'sales_manager' : ['sales_head', 'executive'].includes(role)
  const allowed = !auth.loading && !auth.error && !!auth.user && auth.profile?.id === auth.user.id && auth.profile.is_active && allowedRole
  const identity = allowed ? `${auth.user!.id}:${role}:${auth.profile!.manager_id ?? ''}` : ''
  const month = params.get('dashboard_month') ?? currentDashboardMonth(), search = params.get('dashboard_search') ?? ''
  const pageText = params.get('dashboard_page') ?? '1', page = /^[1-9]\d{0,9}$/.test(pageText) ? Number(pageText) : 0
  const metricText = params.get('dashboard_metric') ?? 'poDeliveryValue'
  const metric = dashboardMetricDefinitions.some(definition => definition.key === metricText) ? metricText as DashboardMetric : null
  const sort = (params.get('dashboard_sort') ?? 'name') as DashboardSort, attention = (params.get('dashboard_attention') ?? 'all') as DashboardAttention
  const args: DashboardArgs = { p_month: month, p_scope: scope, p_manager_id: null, p_page: page, p_page_size: 10, p_search: search, p_sort: sort, p_attention: attention }
  let valid = !!metric
  try { validateDashboardArgs(args) } catch { valid = false }
  useEffect(() => {
    const predicate = (query: { queryKey: readonly unknown[] }) => !identity || query.queryKey[1] !== BACKEND || query.queryKey[2] !== identity
    void client.cancelQueries({ queryKey: ['sales-dashboard-v3'], predicate })
    client.removeQueries({ queryKey: ['sales-dashboard-v3'], predicate })
  }, [identity, client])
  const query = useQuery({ queryKey: ['sales-dashboard-v3', BACKEND, identity, scope, args], queryFn: ({ signal }) => transport(args, signal), enabled: enabled && allowed && valid, retry: false, refetchOnWindowFocus: true })
  const update = useCallback((patch: Record<string, string | null>, resetPage = true) => {
    setParams(previous => { const next = new URLSearchParams(previous); for (const [key, value] of Object.entries(patch)) { if (value === null || value === '') next.delete(key); else next.set(key, value) }; if (resetPage) next.delete('dashboard_page'); return next })
  }, [setParams])
  const lastPage = query.data ? Math.max(1, Math.ceil(query.data.total / query.data.pageSize)) : null
  const invalidPage = lastPage !== null && page > lastPage
  useEffect(() => { if (invalidPage && !query.isFetching && !query.isError) update({ dashboard_page: String(lastPage) }, false) }, [invalidPage, lastPage, query.isFetching, query.isError, update])
  return { enabled, allowed, valid, identity, scope, month, search, sort, attention, metric: metric ?? 'poDeliveryValue',
    data: enabled && allowed && valid && !query.isError && !query.isFetching && !invalidPage ? query.data : undefined,
    pending: query.isPending || query.isFetching || invalidPage, error: query.isError,
    onMonth: (value: string) => update({ dashboard_month: value }), onSearch: (value: string) => update({ dashboard_search: value }),
    onPage: (value: number) => { if (Number.isInteger(value) && value > 0) update({ dashboard_page: String(value) }, false) },
    onSort: (value: DashboardSort) => update({ dashboard_sort: value }), onAttention: (value: DashboardAttention) => update({ dashboard_attention: value }),
    onMetric: (value: DashboardMetric) => update({ dashboard_metric: value }, false), onRefresh: () => { void query.refetch() },
    onReset: () => update({ dashboard_month: null, dashboard_search: null, dashboard_page: null, dashboard_metric: null, dashboard_sort: null, dashboard_attention: null }),
  }
}
