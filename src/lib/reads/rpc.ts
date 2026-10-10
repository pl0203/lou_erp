import { decodeSalesMetrics, decodeSalesMetricMonths } from './salesMetrics'
import { supabase } from '../supabase'
import { isPOConflict, POConflictError } from '../poConflict'
import { PO_OUTPUT_STATUSES, READ_RPC_DEFINITIONS } from './contracts'
import type { ReadRpcName, RpcArgsMap, RpcResultMap } from './contracts'

type Check = (value: unknown, path: string) => void
function fail(path: string): never { throw new Error(`Respons data tidak lengkap atau tidak valid: ${path}`) }
const text: Check = (value, path) => { if (typeof value !== 'string') fail(path) }
const id: Check = (value, path) => { text(value, path); if (!value) fail(path) }
const money: Check = (value, path) => { if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value)) fail(path) }
const count: Check = (value, path) => { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail(path) }
const number: Check = (value, path) => { if (typeof value !== 'number' || !Number.isFinite(value)) fail(path) }
const bool: Check = (value, path) => { if (typeof value !== 'boolean') fail(path) }
const timestamp: Check = (value, path) => { if (typeof value !== 'string' || !value.includes('T') || !Number.isFinite(Date.parse(value))) fail(path) }
const date: Check = (value, path) => { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) fail(path) }
const month: Check = (value, path) => { if (typeof value !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) fail(path) }
const optional = (check: Check): Check => (value, path) => { if (value !== undefined) check(value, path) }
const nullable = (check: Check): Check => (value, path) => { if (value !== null) check(value, path) }
const oneOf = (values: readonly string[]): Check => (value, path) => { if (typeof value !== 'string' || !values.includes(value)) fail(path) }
function object(shape: Record<string, Check>): Check {
  return (value, path) => { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path); for (const [key, check] of Object.entries(shape)) check((value as Record<string, unknown>)[key], `${path}.${key}`) }
}
function array(check: Check, maximum = Infinity): Check {
  return (value, path) => { if (!Array.isArray(value) || value.length > maximum) fail(path); value.forEach((item, index) => check(item, `${path}[${index}]`)) }
}
const po = object({ id, po_number: text, status: oneOf(PO_OUTPUT_STATUSES), order_date: date, expected_delivery_date: nullable(date), total_value: money, customer_id: id, customers: nullable(object({ name: text })) })
const sales = object({ id, status: oneOf(['pending', 'approved', 'rejected', 'cancelled']), total_value: money, created_at: timestamp, rejection_note: nullable(text), customers: nullable(object({ name: text })), users: nullable(object({ full_name: text })) })
const line = object({ id, product_name: text, sku: nullable(text), quantity: count, unit_price: money, line_total: money, delivered_quantity: count, has_delivery_history: bool })
const daily = object({ key: date, deliveredValue: money, sjCount: count })
const customer = object({ id, name: text, manager_name: nullable(text), actual_visits: count, target_visits: count, last_visit_date: nullable(timestamp), order_count: count, total_sales: money, sales_target: nullable(money) })
const revenue = object({ customer_id: id, customer_name: text, manager_name: nullable(text), order_count: count, total_sales: money, last_order_date: nullable(timestamp) })
const performance = object({ id, full_name: text, scheduled: count, visited: count, missed: count, orders: count, total_sales: money, visit_rate: number, sales_target: nullable(money) })
const manager = object({ id, name: text, address: nullable(text), city: nullable(text), last_visit_date: nullable(text), visit_frequency_days: count, visits_this_period: count, target_visits: count, on_track: bool })
const customerStat = object({ customer_id: id, first_order_date: nullable(date), order_count: count, total_sales: money, top_items: array(object({ name: text, revenue: money }), 10) })
const activity = object({ sales_person_id: id, total_scheduled: count, total_visited: count, total_orders: count, weekly_visits: count })
const schema: Record<Exclude<ReadRpcName, 'pilot_sales_metrics_v2' | 'pilot_sales_metric_months_v2'>, Check> = {
  pilot_sales_report_months_v1: object({ earliest_schedule_date: nullable(date), earliest_order_at: nullable(timestamp) }),
  pilot_po_page_v1: object({ items: array(po) }),
  pilot_sales_order_page_v1: object({ items: array(sales), status_counts: object({ pending: count, approved: count, rejected: count, cancelled: count }) }),
  pilot_po_lines_v1: object({ items: array(line), po_updated_at: timestamp, po_has_delivery_history: bool }),
  pilot_athel_daily_v1: object({ items: array(daily) }),
  pilot_athel_summary_v1: object({
    metrics: object({ totalPOCount: count, totalPOValue: money, deliveredValue: money, outstandingValue: money, averagePOValue: money, completedPOCount: count }),
    customerShare: array(object({ label: text, value: money }), 6),
    monthlySeries: array(object({ key: month, poValue: money, deliveredValue: money }), 12),
    statusBreakdown: array(object({ status: oneOf(PO_OUTPUT_STATUSES), value: count }), PO_OUTPUT_STATUSES.length),
    topCustomers: array(object({ rank: count, name: text, poValue: money, deliveredValue: money, fulfillmentRate: number }), 10),
    outstandingItems: array(object({ rank: count, sku: text, productName: text, outstandingQty: count, outstandingValue: money }), 10),
  }),
  pilot_customer_stats_v1: object({ items: array(customerStat, 100) }),
  pilot_customer_performance_v1: object({ items: array(customer), summary: object({ total_sales: money, active_customers: count, total_customers: count, total_visits: count, total_target_visits: count, visit_percent: number, top_customer: nullable(customer) }) }),
  pilot_revenue_v1: object({ items: array(revenue), summary: object({ total_sales: money, total_orders: count, active_customers: count, top_customer: nullable(revenue) }) }),
  pilot_sales_performance_v1: object({ items: array(performance), summary: object({ total_visited: count, total_scheduled: count, total_orders: count, total_sales: money, average_visit_rate: number, unassigned_orders: optional(count), unassigned_sales: optional(money) }) }),
  pilot_team_activity_v1: object({ items: array(activity, 100) }),
  pilot_manager_customers_v1: object({ items: array(manager), summary: object({ on_track: count, overdue: count, total: count }) }),
}

export function decodeRead<N extends ReadRpcName>(name: N, args: RpcArgsMap[N], data: unknown): RpcResultMap[N] {
  if (name === 'pilot_sales_metrics_v2') return decodeSalesMetrics(args as RpcArgsMap['pilot_sales_metrics_v2'], data) as RpcResultMap[N]
  if (name === 'pilot_sales_metric_months_v2') return decodeSalesMetricMonths(args as RpcArgsMap['pilot_sales_metric_months_v2'], data) as RpcResultMap[N]
  object({ version: (value, path) => { if (value !== 1) fail(path) }, as_of: timestamp })(data, name)
  schema[name as keyof typeof schema](data, name)
  const result = data as Record<string, any>
  const definition = READ_RPC_DEFINITIONS[name]
  if (definition.result === 'page') {
    object({ total: count, page: count, page_size: count })(data, name)
    const requested = args as { p_page: number; p_page_size: number }
    if (result.page < 1 || result.page_size < 1 || result.page_size > definition.pageLimit! || result.page !== requested.p_page || result.page_size !== requested.p_page_size) fail(`${name}.page`)
    const offset = (result.page - 1) * result.page_size
    if (!Number.isSafeInteger(offset) || result.items.length !== Math.min(result.page_size, Math.max(0, result.total - offset))) fail(`${name}.items completeness`)
  }
  if (Array.isArray(result.items)) {
    const seen = new Set<string>()
    for (const item of result.items) {
      const key = item.id ?? item.customer_id ?? item.sales_person_id ?? item.key
      if (seen.has(key)) fail(`${name}.duplicate item`)
      seen.add(key)
    }
  }
  if (name === 'pilot_customer_stats_v1' || name === 'pilot_team_activity_v1') {
    const requested = args as { p_customer_ids?: string[]; p_user_ids?: string[]; p_top_limit?: number }
    const ids = new Set(requested.p_customer_ids ?? requested.p_user_ids)
    for (const item of result.items) {
      if (!ids.has(item.customer_id ?? item.sales_person_id)) fail(`${name}.unexpected ID`)
      if (item.top_items && item.top_items.length > requested.p_top_limit!) fail(`${name}.top_items`)
    }
  }
  if (name === 'pilot_sales_performance_v1' && ((result.summary.unassigned_orders === undefined) !== (result.summary.unassigned_sales === undefined) || (result.summary.unassigned_orders ?? 0) > result.summary.total_orders)) fail(`${name}.unassigned summary`)
  if (name === 'pilot_athel_summary_v1' && (result.monthlySeries.length !== 12 || new Set(result.monthlySeries.map((month: any) => month.key)).size !== 12)) fail(`${name}.monthlySeries`)
  return data as RpcResultMap[N]
}

export async function callRead<N extends ReadRpcName>(name: N, args: RpcArgsMap[N], signal?: AbortSignal): Promise<RpcResultMap[N]> {
  signal?.throwIfAborted()
  let request = supabase.rpc(name, args)
  if (signal) request = request.abortSignal(signal)
  const { data, error } = await request
  signal?.throwIfAborted()
  if (error) throw name === 'pilot_po_lines_v1' && isPOConflict(error) ? new POConflictError() : error
  return decodeRead(name, args, data)
}
