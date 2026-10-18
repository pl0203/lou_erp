import type { DashboardArgs, DashboardData, DashboardMetrics, DashboardTargets, DashboardRow } from '../../src/lib/salesDashboard/contracts'
export const syntheticId = (id: number) => `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`
export const dashboardArgs: DashboardArgs = { p_month: '2026-10-01', p_scope: 'own', p_manager_id: null, p_page: 1, p_page_size: 10, p_search: '' }
export const metricsFixture = (): DashboardMetrics => ({
  poOrderCount: { value: '3', quality: 'complete' }, poOrderValue: { value: '10000000.00', quality: 'complete' },
  poDeliveryValue: { value: '8000000.00', quality: 'complete' }, coShippedCount: { value: '1', quality: 'complete' },
  coSaleValue: { value: null, quality: 'missing' },
})
export const targetsFixture = (): DashboardTargets => ({
  po_order_value: { metric: 'po_order_value', month: '2026-10-01', state: 'not_published', amount: null },
  po_delivery_value: { metric: 'po_delivery_value', month: '2026-10-01', state: 'published', amount: '20000000.00' },
  co_sale_value: { metric: 'co_sale_value', month: '2026-10-01', state: 'not_published', amount: null },
})
export const activityFixture = () => ({ scheduled: '12', visited: '10', todayScheduled: '6', todayVisited: '3', todayMatchedScheduled: '2', pendingRequests: '2', asOfDate: '2026-10-17' })
export function rowFixture(id = 1, kind: 'customer' | 'person' = 'customer'): DashboardRow {
  return { id: syntheticId(id), name: kind === 'customer' ? `Pelanggan Contoh ${id}` : `Sales Contoh ${id}`, kind, managerId: kind === 'person' ? syntheticId(90) : null, managerName: kind === 'person' ? 'Manajer Contoh' : null, metrics: metricsFixture(), targets: targetsFixture(), activity: activityFixture(), warnings: [] }
}
export function dashboardFixture(scope: DashboardData['scope'] = 'own', count = 1): DashboardData {
  return { schemaVersion: 3, scope, month: '2026-10-01', asOf: '2026-10-17T10:00:00Z', provisional: true,
    page: 1, pageSize: 10, total: count, summary: metricsFixture(), targets: targetsFixture(), activity: activityFixture(),
    items: Array.from({ length: Math.min(count, 10) }, (_, i) => rowFixture(i + 1, scope === 'own' ? 'customer' : 'person')), warnings: [],
    trend: [{ month: '2026-08-01', metrics: metricsFixture() }, { month: '2026-09-01', metrics: metricsFixture() }] }
}
