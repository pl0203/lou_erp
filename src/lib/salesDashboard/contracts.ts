/** Versioned, scoped read model. This boundary never falls back to legacy targets. */
export type DashboardSort = 'name' | 'po_order_value_desc' | 'po_delivery_value_desc' | 'co_sale_value_desc'
export type DashboardAttention = 'all' | 'missing_co' | 'unvisited' | 'target_incomplete'
export type DashboardScope = 'own' | 'team' | 'leadership'
export type DashboardMetric = 'poOrderCount' | 'poOrderValue' | 'poDeliveryValue' | 'coShippedCount' | 'coSaleValue'
export type DashboardTargetMetric = 'po_order_value' | 'po_delivery_value' | 'co_sale_value'
export type DashboardValue = { value: string | null; quality: 'complete' | 'partial' | 'missing' }
export type DashboardMetrics = Record<DashboardMetric, DashboardValue>
export type DashboardTarget = { metric: DashboardTargetMetric; month: string; state: 'published' | 'not_published' | 'partial' | 'not_applicable'; amount: string | null }
export type DashboardTargets = Record<DashboardTargetMetric, DashboardTarget>
export type DashboardActivity = { scheduled: string | null; visited: string | null; todayScheduled: string | null; todayVisited: string | null; todayMatchedScheduled: string | null; pendingRequests: string | null; asOfDate: string }
export type DashboardRow = { id: string; name: string; kind: 'customer' | 'person'; managerId: string | null; managerName: string | null; metrics: DashboardMetrics; targets: DashboardTargets; activity: DashboardActivity; warnings: string[] }
export type DashboardData = { schemaVersion: 3; scope: DashboardScope; month: string; asOf: string; provisional: boolean; page: number; pageSize: number; total: number; summary: DashboardMetrics; targets: DashboardTargets; activity: DashboardActivity; items: DashboardRow[]; warnings: string[]; trend?: { month: string; metrics: DashboardMetrics }[] }
export type DashboardArgs = { p_month: string; p_scope: DashboardScope; p_manager_id: string | null; p_page: number; p_page_size: number; p_search: string; p_sort?: DashboardSort; p_attention?: DashboardAttention }
const METRICS = ['poOrderCount', 'poOrderValue', 'poDeliveryValue', 'coShippedCount', 'coSaleValue'] as const
const TARGETS = ['po_order_value', 'po_delivery_value', 'co_sale_value'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MONEY = /^(0|[1-9]\d{0,99})(?:\.\d{1,6})?$/
const COUNT = /^(0|[1-9]\d{0,29})$/
function invalid(path: string): never { throw new Error(`Ringkasan Sales tidak lengkap atau tidak valid: ${path}`) }
function object(value: unknown, path: string): Record<string, unknown> { if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(path); return value as Record<string, unknown> }
function date(value: unknown, path: string): string { if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) invalid(path); return value }
function month(value: unknown, path: string): string { const result = date(value, path); if (!result.endsWith('-01')) invalid(path); return result }
function integer(value: unknown, max: number, min: number, path: string): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) invalid(path); return value }
function strings(value: unknown, path: string) { if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || v.length > 1000)) invalid(path) }
function metrics(value: unknown, path: string) {
  const row = object(value, path)
  for (const key of METRICS) {
    const cell = object(row[key], `${path}.${key}`)
    if (!['complete', 'partial', 'missing'].includes(String(cell.quality))) invalid(`${path}.${key}.quality`)
    if (cell.quality === 'missing') { if (cell.value !== null) invalid(`${path}.${key}.missing`); continue }
    const pattern = key === 'poOrderCount' || key === 'coShippedCount' ? COUNT : MONEY
    if (typeof cell.value !== 'string' || !pattern.test(cell.value)) invalid(`${path}.${key}.value`)
  }
}
function targets(value: unknown, expectedMonth: string, path: string) {
  const row = object(value, path)
  for (const key of TARGETS) {
    const cell = object(row[key], `${path}.${key}`)
    if (cell.metric !== key || cell.month !== expectedMonth) invalid(`${path}.${key}.basis`)
    if (!['published', 'not_published', 'partial', 'not_applicable'].includes(String(cell.state))) invalid(`${path}.${key}.state`)
    if (cell.state === 'published') { if (typeof cell.amount !== 'string' || !MONEY.test(cell.amount)) invalid(`${path}.${key}.amount`) }
    else if (cell.amount !== null) invalid(`${path}.${key}.unpublished`)
  }
}
function activity(value: unknown, path: string) {
  const row = object(value, path); date(row.asOfDate, `${path}.asOfDate`)
  for (const key of ['scheduled', 'visited', 'todayScheduled', 'todayVisited', 'todayMatchedScheduled', 'pendingRequests']) if (row[key] !== null && (typeof row[key] !== 'string' || !COUNT.test(row[key] as string))) invalid(`${path}.${key}`)
  if (row.todayMatchedScheduled !== null && (row.todayScheduled === null || BigInt(row.todayMatchedScheduled as string) > BigInt(row.todayScheduled as string))) invalid(`${path}.todayMatchedScheduled`)
}
export function validateDashboardArgs(args: DashboardArgs) {
  month(args.p_month, 'request.month')
  if (!['own', 'team', 'leadership'].includes(args.p_scope)) invalid('request.scope')
  if (args.p_manager_id !== null && !UUID.test(args.p_manager_id)) invalid('request.manager')
  integer(args.p_page, 2147483647, 1, 'request.page'); integer(args.p_page_size, 100, 1, 'request.pageSize')
  if (!['name', 'po_order_value_desc', 'po_delivery_value_desc', 'co_sale_value_desc'].includes(args.p_sort ?? 'name')) invalid('request.sort')
  const attention = args.p_attention ?? 'all'
  if (!['all', 'missing_co', 'unvisited', 'target_incomplete'].includes(attention) || args.p_scope === 'own' && attention === 'target_incomplete' || args.p_scope !== 'own' && attention === 'unvisited') invalid('request.attention')
  if (typeof args.p_search !== 'string' || args.p_search.length > 200) invalid('request.search')
}
export function decodeDashboard(args: DashboardArgs, value: unknown): DashboardData {
  validateDashboardArgs(args)
  const root = object(value, 'dashboard')
  if (root.schemaVersion !== 3) invalid('schemaVersion')
  if (root.scope !== args.p_scope || root.month !== args.p_month || root.page !== args.p_page || root.pageSize !== args.p_page_size) invalid('request binding')
  if (typeof root.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(root.asOf) || !Number.isFinite(Date.parse(root.asOf))) invalid('asOf')
  date(root.asOf.slice(0, 10), 'asOf.date')
  if (typeof root.provisional !== 'boolean') invalid('provisional')
  const total = integer(root.total, Number.MAX_SAFE_INTEGER, 0, 'total')
  metrics(root.summary, 'summary'); targets(root.targets, args.p_month, 'targets'); activity(root.activity, 'activity'); strings(root.warnings, 'warnings')
  if (!Array.isArray(root.items) || root.items.length !== Math.min(args.p_page_size, Math.max(0, total - (args.p_page - 1) * args.p_page_size))) invalid('page completeness')
  const seen = new Set<string>()
  for (const value of root.items) {
    const row = object(value, 'item')
    if (typeof row.id !== 'string' || !UUID.test(row.id) || seen.has(row.id)) invalid('item.id')
    seen.add(row.id)
    if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 1000) invalid('item.name')
    if (row.kind !== (args.p_scope === 'own' ? 'customer' : 'person')) invalid('item.kind')
    if (row.managerId !== null && (typeof row.managerId !== 'string' || !UUID.test(row.managerId))) invalid('item.managerId')
    if (row.managerName !== null && (typeof row.managerName !== 'string' || !row.managerName.trim())) invalid('item.managerName')
    if ((row.managerId === null) !== (row.managerName === null)) invalid('item.manager')
    metrics(row.metrics, 'item.metrics'); targets(row.targets, args.p_month, 'item.targets'); activity(row.activity, 'item.activity'); strings(row.warnings, 'item.warnings')
  }
  if (root.trend !== undefined) {
    if (!Array.isArray(root.trend) || root.trend.length > 12) invalid('trend')
    const seenMonths = new Set<string>()
    for (const value of root.trend) { const row = object(value, 'trend.item'); const period = month(row.month, 'trend.month'); if (seenMonths.has(period)) invalid('trend.duplicate'); seenMonths.add(period); metrics(row.metrics, 'trend.metrics') }
  }
  return value as DashboardData
}
