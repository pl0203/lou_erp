import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { fetchSalesMetricMonths, fetchSalesMetricsPage } from './reports'
import type { SalesMetricGroup, SalesMetricOrderType, SalesMetricScope, SalesMetricsArgs } from './contracts'

const BACKEND = import.meta.env.VITE_SUPABASE_URL ?? 'unconfigured'
const ROLES = ['sales_person', 'sales_manager', 'sales_head', 'executive']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MONTH = /^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/
export const currentSalesMonth = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` }
/** Calendar components only: no UTC/local-midnight conversion at the month boundary. */
export function followingSalesMonth(month: string) {
  const [year, number] = month.split('-').map(Number)
  return `${String(number === 12 ? year + 1 : year).padStart(4, '0')}-${String(number === 12 ? 1 : number + 1).padStart(2, '0')}`
}
const MONTH_NAMES = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
export const salesMonthLabel = (month: string) => `${MONTH_NAMES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`
export function salesMonthOptions(earliest: string | null | undefined, from: string, through: string) {
  const first = [currentSalesMonth(), from, through, earliest?.slice(0, 7)].filter((v): v is string => !!v && MONTH.test(v)).sort()[0]
  const last = [currentSalesMonth(), from, through].filter(v => MONTH.test(v)).sort().at(-1)!
  const result: string[] = []
  for (let cursor = first; cursor <= last; cursor = followingSalesMonth(cursor)) { result.push(cursor); if (cursor === '9999-12') break }
  return result.reverse()
}

/** Sales-only query isolation. CO operational authority and legacy numeric pages are deliberately separate. */
export function useSalesMetrics(group: SalesMetricGroup) {
  const auth = useAuth(), client = useQueryClient()
  const [params, setParams] = useSearchParams()
  const allowed = !auth.loading && !auth.error && !!auth.user && auth.profile?.id === auth.user.id && auth.profile.is_active && ROLES.includes(auth.profile.role)
  const actor = allowed ? auth.user!.id : '', role = allowed ? auth.profile!.role : ''
  const hierarchy = allowed ? auth.profile!.manager_id ?? null : null
  const identity = `${actor}:${role}:${hierarchy ?? ''}`
  const expectedScope: SalesMetricScope = role === 'sales_person' ? 'own' : role === 'sales_manager' ? 'team' : 'leadership'
  const from = params.get('sales_from') ?? currentSalesMonth(), through = params.get('sales_through') ?? currentSalesMonth()
  const orderType = (params.get('sales_type') ?? 'all') as SalesMetricOrderType
  const manager = params.get('sales_manager') || null
  const pageKey = `sales_${group}_page`, pageText = params.get(pageKey) ?? '1'
  const validPage = /^[1-9]\d{0,9}$/.test(pageText) && BigInt(pageText) <= 2147483647n
  const valid = MONTH.test(from) && MONTH.test(through) && from <= through && through < '9999-12' && ['all','po','co'].includes(orderType) && (manager === null || UUID.test(manager)) && validPage
  const args: SalesMetricsArgs = { p_manager_id: manager, p_month_from: `${from}-01`, p_month_until: `${followingSalesMonth(through)}-01`, p_group_by: group, p_order_type: orderType, p_page: validPage ? Number(pageText) : 1, p_page_size: 20 }
  const key = ['sales-metrics', BACKEND, identity] as const
  useEffect(() => {
    const predicate = (query: {queryKey: readonly unknown[]}) => !actor || query.queryKey[1] !== BACKEND || query.queryKey[2] !== identity
    void client.cancelQueries({queryKey:['sales-metrics'],predicate})
    client.removeQueries({queryKey:['sales-metrics'],predicate})
  }, [actor, identity, client])
  const checkScope = <T extends {scope: SalesMetricScope}>(data: T) => {
    // This is a fail-closed presentation check, not client authorization. The RPC determines actual authority.
    if (data.scope !== expectedScope) throw new Error('Cakupan akun berubah. Muat ulang profil sebelum membuka metrik.')
    return data
  }
  const monthArgs = {p_manager_id:manager,p_order_type:orderType}
  const months = useQuery({queryKey:[...key,'months',monthArgs],queryFn:async({signal})=>checkScope(await fetchSalesMetricMonths(monthArgs,signal)),enabled:allowed && valid,retry:false})
  const metrics = useQuery({queryKey:[...key,'page',args],queryFn:async({signal})=>checkScope(await fetchSalesMetricsPage(args,signal)),enabled:allowed && valid,retry:false})
  const update = useCallback((patch: Record<string,string|null>, resetPage = true) => {
    setParams(previous => {
      const next = new URLSearchParams(previous)
      for (const [key,value] of Object.entries(patch)) { if (value === null) next.delete(key); else next.set(key,value) }
      if (resetPage) { next.delete('sales_customer_page'); next.delete('sales_person_page') }
      return next
    })
  },[setParams])
  const setPage = useCallback((page: number) => {
    if (Number.isInteger(page) && page >= 1 && page <= 2147483647) update({[pageKey]:String(page)},false)
  },[pageKey,update])
  const last = metrics.data ? (BigInt(metrics.data.total) === 0n ? 1n : (BigInt(metrics.data.total)+BigInt(metrics.data.page_size)-1n)/BigInt(metrics.data.page_size)) : null
  const invalidPage = last !== null && BigInt(args.p_page) > last
  useEffect(()=>{if(invalidPage && !metrics.isFetching && !metrics.isError && last !== null) setPage(Number(last))},[invalidPage,metrics.isFetching,metrics.isError,last,setPage])
  const unavailable = metrics.isError || months.isError
  const pending = metrics.isPending || metrics.isFetching || months.isPending || months.isFetching || invalidPage
  return {allowed,role,identity,from,through,orderType,manager,valid,args,key,update,setPage,
    data:allowed && valid && !unavailable && !pending ? metrics.data : undefined,
    months:allowed && valid && !months.isError && !months.isFetching ? months.data : undefined,
    unavailable,pending,refresh:()=>{void metrics.refetch();void months.refetch()},
    reset:()=>update({sales_from:null,sales_through:null,sales_type:null,sales_manager:null}),
  }
}
