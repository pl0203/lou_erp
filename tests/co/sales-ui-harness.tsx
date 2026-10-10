import { transferableAbortController } from 'node:util'
import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, vi } from 'vitest'
import type { SalesMetricsArgs } from '../../src/lib/reads/contracts'
export const uuid = (n: number) => `10000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const state = vi.hoisted(() => ({ auth: {} as any, revision: 0, listeners: new Set<() => void>(), calls: [] as {name:string;args:any;signal?:AbortSignal}[], handler: null as any, raw: vi.fn(), managers: [] as any[] }))
export { state }
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => { useSyncExternalStore(listener => { state.listeners.add(listener); return () => { state.listeners.delete(listener) } }, () => state.revision); return state.auth } }))
vi.mock('../../src/lib/supabase', () => ({ supabase: {
  from: (...args: any[]) => { state.raw(...args); throw new Error('Raw table access is not a Sales metric source') },
  rpc: (name: string, args: any = {}) => {
    const call = { name, args, signal: undefined as AbortSignal | undefined }; state.calls.push(call)
    let result: Promise<any> | undefined
    const request: any = { abortSignal(signal: AbortSignal) { call.signal = signal; return request }, returns() { return request }, select() { return request }, eq() { return request }, order() { return request }, range() { return request }, then(resolve: any, reject: any) { result ??= Promise.resolve().then(() => state.handler(name, args)); return result.then(resolve, reject) } }
    return request
  },
  auth: { getUser: async () => ({data:{user:state.auth.user}}) },
} }))
vi.mock('../../src/pages/Login', () => ({ default: () => <p>Login boundary</p> }))
vi.mock('../../src/pages/athel/POList', () => ({ default: () => <p>PO home</p> }))
vi.mock('../../src/pages/athel/co/COOrders', () => ({ default: () => <p>CO home</p> }))
vi.mock('../../src/pages/girard/DailySchedule', () => ({ default: () => <p>Sales schedule</p> }))
vi.mock('../../src/pages/girard/ManagerSchedule', () => ({ default: () => <p>Manager schedule</p> }))
export const values = { po_order_value: '1000000.00', po_order_count: '1', po_delivered_revenue: '300000.00', po_delivered_order_count: '1', co_sold_revenue: '720000.00', co_sold_order_count: '2' }
export const zero = { po_order_value: '0.00', po_order_count: '0', po_delivered_revenue: '0.00', po_delivered_order_count: '0', co_sold_revenue: '0.00', co_sold_order_count: '0' }
export function scope() { return state.auth.profile.role === 'sales_person' ? 'own' : state.auth.profile.role === 'sales_manager' ? 'team' : 'leadership' }
export function page(args: SalesMetricsArgs, overrides: any = {}) {
  const v = { ...values }
  if (args.p_order_type === 'po') Object.assign(v, { co_sold_revenue:'0.00',co_sold_order_count:'0' })
  if (args.p_order_type === 'co') Object.assign(v, { po_order_value:'0.00',po_order_count:'0',po_delivered_revenue:'0.00',po_delivered_order_count:'0' })
  const events = args.p_order_type === 'po' ? '0' : '1'
  const items = args.p_group_by === 'customer' ? [{customer_id:uuid(10),customer_name:'CO-only store',...v,co_report_event_count:events}] : [{person_id:uuid(11),person_name:'Original inactive PIC',is_unassigned:false,...v,co_contributing_report_count:events}]
  return {version:2,as_of:'2026-10-10T00:00:00Z',scope:scope(),manager_id:args.p_manager_id,order_type:args.p_order_type,month_from:args.p_month_from,month_until:args.p_month_until,group_by:args.p_group_by,page:args.p_page,page_size:args.p_page_size,total:'1',summary:{...v,co_report_event_count:events},items:args.p_page===1?items:[],...overrides}
}
export function months(args: any, earliest: string | null = '2024-02-01') { return {version:2,as_of:'2026-10-10T00:00:00Z',scope:scope(),manager_id:args.p_manager_id,order_type:args.p_order_type,earliest_month:earliest} }
export function fixture(name: string, args: any) {
  if (name==='pilot_sales_metrics_v2') return {data:page(args),error:null}
  if (name==='pilot_sales_metric_months_v2') return {data:months(args),error:null}
  if (name==='pilot_team_directory') return {data:state.managers,count:state.managers.length,error:null}
  if (name==='pilot_sales_report_months_v1') return {data:{version:1,as_of:'2026-10-10T00:00:00Z',earliest_schedule_date:'2026-01-01',earliest_order_at:null},error:null}
  if (name==='pilot_customer_performance_v1') return {data:{version:1,as_of:'2026-10-10T00:00:00Z',page:args.p_page,page_size:args.p_page_size,total:1,items:[{id:uuid(20),name:'Current activity cohort',manager_name:'Current store owner',actual_visits:2,target_visits:4,last_visit_date:null,order_count:1,total_sales:'500000.00',sales_target:'1000000.00'}],summary:{total_sales:'500000.00',active_customers:1,total_customers:1,total_visits:2,total_target_visits:4,visit_percent:50,top_customer:null}},error:null}
  if (name==='pilot_sales_performance_v1') return {data:{version:1,as_of:'2026-10-10T00:00:00Z',page:args.p_page,page_size:args.p_page_size,total:1,items:[{id:uuid(21),full_name:'Current team cohort',scheduled:4,visited:2,missed:2,orders:1,total_sales:'500000.00',visit_rate:50,sales_target:'1000000.00'}],summary:{total_visited:2,total_scheduled:4,total_orders:1,total_sales:'500000.00',average_visit_rate:50}},error:null}
  throw new Error(`Unexpected RPC ${name}`)
}
export function setAuth(patch: any) { act(() => { state.auth = {...state.auth,...patch}; state.revision++; state.listeners.forEach(listener=>listener()) }) }
export function role(name: string, id = uuid(1)) { setAuth({ user:{id},profile:{id,role:name,is_active:true,full_name:'Sales actor'},loading:false,error:null,signOut:vi.fn() }) }
const clients: QueryClient[] = [], routers: ReturnType<typeof createMemoryRouter>[] = []
beforeEach(() => { vi.stubGlobal('AbortController', class { constructor() { return transferableAbortController() } }); vi.useFakeTimers({toFake:['Date']}); vi.setSystemTime(new Date('2026-10-10T00:00:00Z')); role('sales_person'); state.calls=[]; state.raw.mockClear(); state.handler=fixture; state.managers=[{id:uuid(2),full_name:'Manager B'}] })
afterEach(() => { cleanup(); routers.splice(0).forEach(router=>router.dispose()); clients.splice(0).forEach(client=>client.clear()); vi.useRealTimers(); vi.unstubAllGlobals() })
export function mount(element: ReactNode, path='/girard/my-sales') {
  const client = new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}})
  const router = createMemoryRouter([{path:'*',element}],{initialEntries:[path]})
  clients.push(client); routers.push(router)
  const view=render(<QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider>)
  return {client,router,...view}
}
export const metricsCalls = () => state.calls.filter(call=>call.name==='pilot_sales_metrics_v2')
export function deferred<T=any>() { let resolve!: (v:T)=>void; const promise = new Promise<T>(r=>{resolve=r}); return {promise,resolve} }
