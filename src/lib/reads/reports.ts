import { calendarDateKey, parseCalendarDate } from '../calendarDate'
import { callRead } from './rpc'
import { chunkIds, IncompleteReadError } from './completeReads'
import { moneyToChartNumber } from './money'
import type { CustomerStatAggregate, DailyBucket, DashboardArgs, DashboardSummary, FulfillmentFilter, POStatusFilter, TeamActivity } from './contracts'

export const REPORT_PAGE_SIZE = 50
const DONUT_COLORS = ['#3b82f6', '#10b981', '#f97316', '#8b5cf6', '#ef4444', '#64748b']
const STATUS_META: Record<string, { label: string; color: string }> = {
  confirm: { label: 'Confirm', color: '#3b82f6' }, in_progress: { label: 'In Progress', color: '#f59e0b' }, complete: { label: 'Complete', color: '#10b981' }, cancelled: { label: 'Cancelled', color: '#94a3b8' },
}
export type DashboardData = Omit<DashboardSummary, 'monthlySeries' | 'customerShare' | 'statusBreakdown'> & {
  monthlySeries: (DashboardSummary['monthlySeries'][number] & { label: string })[]
  customerShare: (DashboardSummary['customerShare'][number] & { color: string })[]
  statusBreakdown: { label: string; value: number; color: string }[]
  dailySeries: (DailyBucket & { label: string })[]
  dailyAsOf: string[]
}
export function displayDay(key: string): string { return parseCalendarDate(key).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) }
export function rangeDays(start: string, end: string): string[] {
  const result: string[] = [], cursor = parseCalendarDate(start), limit = parseCalendarDate(end)
  while (cursor <= limit) { result.push(calendarDateKey(cursor)); cursor.setDate(cursor.getDate() + 1) }
  return result
}
export function rollingMonthKeys(months: number): string[] {
  const now = new Date(), result: string[] = []
  for (let offset = months - 1; offset >= 0; offset--) result.push(calendarDateKey(new Date(now.getFullYear(), now.getMonth() - offset, 1)).slice(0, 7))
  return result
}
function displayMonth(key: string) {
  const [year, month] = key.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('id-ID', { month: 'short', year: 'numeric' })
}
async function fetchDaily(args: DashboardArgs, signal?: AbortSignal) {
  const expectedDays = rangeDays(args.p_from, args.p_to), items: DailyBucket[] = [], snapshots: string[] = []
  for (let page = 1; ; page++) {
    const response = await callRead('pilot_athel_daily_v1', { ...args, p_page: page, p_page_size: 366 }, signal)
    if (response.total !== expectedDays.length) throw new IncompleteReadError('Data harian belum lengkap. Muat ulang laporan.')
    for (const day of response.items) {
      if (day.key !== expectedDays[items.length]) throw new IncompleteReadError('Urutan data harian berubah. Muat ulang laporan.')
      moneyToChartNumber(day.deliveredValue)
      items.push(day)
    }
    snapshots.push(response.as_of)
    if (items.length === response.total) return { items, snapshots }
  }
}
export async function fetchDashboardData(startDate: string, endDate: string, status: POStatusFilter, fulfillment: FulfillmentFilter, signal?: AbortSignal): Promise<DashboardData> {
  const months = rollingMonthKeys(12)
  const args: DashboardArgs = { p_from: startDate, p_to: endDate, p_rolling_from: `${months[0]}-01`, p_status: status, p_fulfillment: fulfillment }
  const [summary, daily] = await Promise.all([callRead('pilot_athel_summary_v1', args, signal), fetchDaily(args, signal)])
  if (summary.monthlySeries.some((month, index) => month.key !== months[index])) throw new IncompleteReadError('Periode ringkasan tidak sesuai. Muat ulang laporan.')
  summary.monthlySeries.forEach(month => { moneyToChartNumber(month.poValue); moneyToChartNumber(month.deliveredValue) })
  summary.customerShare.forEach(customer => moneyToChartNumber(customer.value))
  return { ...summary,
    monthlySeries: summary.monthlySeries.map(month => ({ ...month, label: displayMonth(month.key) })),
    customerShare: summary.customerShare.map((customer, index) => ({ ...customer, color: DONUT_COLORS[index] })),
    statusBreakdown: summary.statusBreakdown.map(row => ({ label: STATUS_META[row.status]?.label ?? row.status, value: row.value, color: STATUS_META[row.status]?.color ?? '#94a3b8' })),
    dailySeries: daily.items.map(day => ({ ...day, label: displayDay(day.key) })), dailyAsOf: daily.snapshots,
  }
}
export async function fetchCustomerStatAggregates(customerIds: string[], cutoff: string, topLimit: number, signal?: AbortSignal): Promise<CustomerStatAggregate[]> {
  const result: CustomerStatAggregate[] = []
  for (const ids of chunkIds(customerIds)) {
    const response = await callRead('pilot_customer_stats_v1', { p_customer_ids: ids, p_cutoff: cutoff, p_top_limit: topLimit }, signal)
    result.push(...response.items)
  }
  return result
}
export function fetchCustomerPerformancePage(managerId: string, role: string, yearMonth: string, page = 1, signal?: AbortSignal) {
  const [year, month] = yearMonth.split('-').map(Number)
  return callRead('pilot_customer_performance_v1', { p_manager_id: role === 'sales_manager' ? managerId : null, p_year_month: yearMonth, p_visit_from: new Date(year, month - 1, 1).toISOString(), p_visit_until: new Date(year, month, 1).toISOString(), p_page: page, p_page_size: REPORT_PAGE_SIZE }, signal)
}
export function fetchRevenuePage(period: string, page = 1, signal?: AbortSignal) {
  const to = new Date(), from = new Date()
  if (period === '30d') from.setDate(from.getDate() - 30)
  else if (period === '90d') from.setDate(from.getDate() - 90)
  else if (period === '1y') from.setFullYear(from.getFullYear() - 1)
  return callRead('pilot_revenue_v1', { p_from: `${from.toISOString().slice(0, 10)}T00:00:00`, p_to: `${to.toISOString().slice(0, 10)}T23:59:59`, p_page: page, p_page_size: REPORT_PAGE_SIZE }, signal)
}
export function fetchSalesPerformancePage(managerId: string, role: string, yearMonth: string, page = 1, signal?: AbortSignal) {
  const [year, month] = yearMonth.split('-').map(Number)
  const from = new Date(year, month - 1, 1).toISOString().slice(0, 10), to = new Date(year, month, 0).toISOString().slice(0, 10)
  return callRead('pilot_sales_performance_v1', { p_manager_id: role === 'sales_manager' ? managerId : null, p_date_from: from, p_date_to: to, p_order_from: `${from}T00:00:00`, p_order_to: `${to}T23:59:59`, p_year_month: yearMonth, p_page: page, p_page_size: REPORT_PAGE_SIZE }, signal)
}
export async function fetchTeamActivity(userIds: string[], signal?: AbortSignal): Promise<TeamActivity[]> {
  const day = new Date().toISOString().slice(0, 10), weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)
  const result: TeamActivity[] = []
  for (const ids of chunkIds(userIds)) {
    const response = await callRead('pilot_team_activity_v1', { p_user_ids: ids, p_day: day, p_order_from: `${day}T00:00:00`, p_order_to: `${day}T23:59:59`, p_week_from: weekAgo.toISOString().slice(0, 10) }, signal)
    if (response.items.length !== ids.length) throw new IncompleteReadError('Aktivitas sebagian anggota tim tidak tersedia.')
    result.push(...response.items)
  }
  return result
}
export async function fetchManagerCustomerPage(managerId: string, page = 1, signal?: AbortSignal) {
  const now = new Date(), from = new Date(now)
  from.setDate(from.getDate() - 30)
  const referenceInstant = now.toISOString()
  const response = await callRead('pilot_manager_customers_v1', { p_manager_id: managerId, p_visit_from: from.toISOString(), p_as_of: referenceInstant, p_page: page, p_page_size: REPORT_PAGE_SIZE }, signal)
  return { ...response, referenceInstant }
}
