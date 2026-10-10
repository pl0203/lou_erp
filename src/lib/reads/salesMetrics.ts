import type { SalesMetricMonths, SalesMetricMonthsArgs, SalesMetricsArgs, SalesMetricsPage } from './contracts'

// Pure production boundary: also executed against actual authenticated SQL output.
// No runtime transport imports, CO source identifiers, or JS Number aggregation.
type Row = Record<string, any>
const valueKeys = ['po_order_value', 'po_order_count', 'po_delivered_revenue', 'po_delivered_order_count', 'co_sold_revenue', 'co_sold_order_count'] as const
const moneyKeys = ['po_order_value', 'po_delivered_revenue', 'co_sold_revenue'] as const
const countKeys = ['po_order_count', 'po_delivered_order_count', 'co_sold_order_count'] as const
const envelopeKeys = ['version', 'as_of', 'scope', 'manager_id', 'order_type']
function invalid(path: string): never { throw new Error(`Data metrik Sales tidak lengkap atau tidak valid: ${path}`) }
function exact(v: unknown, keys: readonly string[], path: string): Row {
  if (!v || typeof v !== 'object' || Array.isArray(v)) invalid(path)
  const row = v as Row
  if (Object.keys(row).length !== keys.length || keys.some(k => !Object.hasOwn(row, k))) invalid(`${path}.fields`)
  return row
}
function text(v: unknown, path: string): string { if (typeof v !== 'string' || !v.trim()) invalid(path); return v }
function uuid(v: unknown, path: string): void { if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)) invalid(path) }
function count(v: unknown, path: string): bigint { if (typeof v !== 'string' || !/^(0|[1-9][0-9]*)$/.test(v)) invalid(path); return BigInt(v) }
function money(v: unknown, path: string): bigint { if (typeof v !== 'string' || !/^(0|[1-9][0-9]*)\.[0-9]{2}$/.test(v)) invalid(path); return BigInt(v.replace('.', '')) }
function date(v: unknown, path: string): string {
  if (typeof v !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) invalid(path)
  return v
}
function month(v: unknown, path: string): string { const d = date(v, path); if (!d.endsWith('-01')) invalid(path); return d }
function pageInteger(v: unknown, maximum: number, path: string): number { if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > maximum) invalid(path); return v }
function base(args: SalesMetricMonthsArgs, row: Row): void {
  if (row.version !== 2) invalid('version')
  if (typeof row.as_of !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(row.as_of) || !Number.isFinite(Date.parse(row.as_of))) invalid('as_of')
  date(row.as_of.slice(0, 10), 'as_of.date')
  if (!['own', 'team', 'leadership'].includes(row.scope)) invalid('scope')
  if (args.p_manager_id !== null) uuid(args.p_manager_id, 'args.manager_id')
  if (row.manager_id !== null) uuid(row.manager_id, 'manager_id')
  if (row.manager_id !== args.p_manager_id) invalid('manager_id.binding')
  if (!['po', 'co', 'all'].includes(args.p_order_type) || row.order_type !== args.p_order_type) invalid('order_type.binding')
}
function values(row: Row, orderType: string, reportKey: string): void {
  for (const key of moneyKeys) money(row[key], key)
  for (const key of countKeys) count(row[key], key)
  count(row[reportKey], reportKey)
  if (orderType === 'po' && (row.co_sold_revenue !== '0.00' || row.co_sold_order_count !== '0' || row[reportKey] !== '0')) invalid('excluded CO family')
  if (orderType === 'co' && (row.po_order_value !== '0.00' || row.po_delivered_revenue !== '0.00' || row.po_order_count !== '0' || row.po_delivered_order_count !== '0')) invalid('excluded PO family')
  for (const [amount, quantity] of [['po_order_value', 'po_order_count'], ['po_delivered_revenue', 'po_delivered_order_count'], ['co_sold_revenue', 'co_sold_order_count']]) {
    if (row[quantity] === '0' && money(row[amount], amount) !== 0n) invalid(`${amount}.without contribution`)
  }
  if (row.co_sold_order_count !== '0' && row[reportKey] === '0') invalid('CO contribution without report')
}

export function decodeSalesMetricMonths(args: SalesMetricMonthsArgs, data: unknown): SalesMetricMonths {
  const row = exact(data, [...envelopeKeys, 'earliest_month'], 'months')
  base(args, row)
  if (row.earliest_month !== null) month(row.earliest_month, 'earliest_month')
  return data as SalesMetricMonths
}

export function decodeSalesMetrics(args: SalesMetricsArgs, data: unknown): SalesMetricsPage {
  const root = exact(data, [...envelopeKeys, 'month_from', 'month_until', 'group_by', 'page', 'page_size', 'total', 'summary', 'items'], 'page')
  base(args, root)
  month(args.p_month_from, 'args.month_from'); month(args.p_month_until, 'args.month_until')
  if (args.p_month_from >= args.p_month_until || root.month_from !== args.p_month_from || root.month_until !== args.p_month_until) invalid('month bounds')
  if (!['customer', 'person'].includes(args.p_group_by) || root.group_by !== args.p_group_by) invalid('group_by.binding')
  pageInteger(args.p_page, 2147483647, 'args.page'); pageInteger(args.p_page_size, 100, 'args.page_size')
  if (root.page !== args.p_page || root.page_size !== args.p_page_size) invalid('page.binding')
  const total = count(root.total, 'total'), offset = (BigInt(root.page) - 1n) * BigInt(root.page_size)
  const remainder = total > offset ? total - offset : 0n
  const expected = remainder < BigInt(root.page_size) ? remainder : BigInt(root.page_size)
  if (!Array.isArray(root.items) || BigInt(root.items.length) !== expected) invalid('items.completeness')
  const summary = exact(root.summary, [...valueKeys, 'co_report_event_count'], 'summary')
  values(summary, root.order_type, 'co_report_event_count')
  const seen = new Set<string>(), sums: Record<string, bigint> = Object.fromEntries([...valueKeys, 'co_report_event_count'].map(k => [k, 0n]))
  for (const item of root.items) {
    const customer = root.group_by === 'customer', reportKey = customer ? 'co_report_event_count' : 'co_contributing_report_count'
    const row = exact(item, [...valueKeys, reportKey, ...(customer ? ['customer_id', 'customer_name'] : ['person_id', 'person_name', 'is_unassigned'])], 'item')
    values(row, root.order_type, reportKey)
    let key: string
    if (customer) { uuid(row.customer_id, 'customer_id'); text(row.customer_name, 'customer_name'); key = row.customer_id }
    else {
      text(row.person_name, 'person_name')
      if (typeof row.is_unassigned !== 'boolean' || row.is_unassigned !== (row.person_id === null)) invalid('person discriminator')
      if (row.is_unassigned) {
        if (row.person_name !== 'Unassigned' || root.scope !== 'leadership' || root.manager_id !== null) invalid('Unassigned scope')
        key = 'unassigned'
      } else { uuid(row.person_id, 'person_id'); key = row.person_id }
      if (count(row.co_contributing_report_count, reportKey) > count(summary.co_report_event_count, 'summary.events')) invalid('person report subset')
      if ((row.co_contributing_report_count === '0') !== (row.co_sold_order_count === '0')) invalid('person report contribution')
    }
    if (seen.has(key)) invalid('duplicate item'); seen.add(key)
    for (const k of moneyKeys) sums[k] += money(row[k], k)
    for (const k of countKeys) sums[k] += count(row[k], k)
    if (customer) sums.co_report_event_count += count(row.co_report_event_count, reportKey)
  }
  // All three amount families and source-order counts partition by customer/person.
  // Report events partition only by customer; person contributions never do.
  const complete = root.page === 1 && total === BigInt(root.items.length)
  for (const k of [...valueKeys, ...(root.group_by === 'customer' ? ['co_report_event_count'] : [])]) {
    const sum = sums[k], declared = (moneyKeys as readonly string[]).includes(k) ? money(summary[k], k) : count(summary[k], k)
    if (sum > declared || (complete && sum !== declared)) invalid(`${k}.summary`)
  }
  return data as SalesMetricsPage
}
