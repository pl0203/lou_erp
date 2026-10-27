import type { RpcArgsMap, RpcResultMap } from '../../src/lib/reads/contracts'
import { AS_OF, emptyDashboardSummary, fixtureId } from './fixtures'

const c = fixtureId(1), u = fixtureId(2), p = fixtureId(3)
const page = { version: 1 as const, as_of: AS_OF, total: 1, page: 1, page_size: 10 }
const customer = { id: c, name: 'Synthetic customer', manager_name: null, actual_visits: 3, target_visits: 10, last_visit_date: AS_OF, order_count: 1, total_sales: '100.00', sales_target: '200.00' }
const revenue = { customer_id: c, customer_name: 'Synthetic customer', manager_name: null, order_count: 1, total_sales: '100.00', last_order_date: '2026-09-15T12:00:00Z' }
export const RESPONSE_EXAMPLES: RpcResultMap = {
  pilot_po_page_v1: { ...page, items: [{ id: p, po_number: 'SYNTHETIC-PO', status: 'confirmed', order_date: '2026-09-01', expected_delivery_date: null, total_value: '100.00', customer_id: c, customers: null }] },
  pilot_sales_order_page_v1: { ...page, items: [{ id: fixtureId(4), status: 'approved', total_value: '100.00', created_at: AS_OF, rejection_note: null, customers: null, users: null }], status_counts: { pending: 0, approved: 1, rejected: 0, cancelled: 0 } },
  pilot_po_lines_v1: { ...page, items: [{ id: fixtureId(5), product_name: 'Synthetic item', sku: null, quantity: 10, unit_price: '10.00', line_total: '100.00', delivered_quantity: 4, has_delivery_history: true }], po_updated_at: AS_OF, po_has_delivery_history: true },
  pilot_athel_summary_v1: emptyDashboardSummary(),
  pilot_athel_daily_v1: { ...page, page_size: 366, items: [{ key: '2026-10-01', deliveredValue: '0.00', sjCount: 0 }] },
  pilot_customer_stats_v1: { version: 1, as_of: AS_OF, items: [{ customer_id: c, first_order_date: '2025-09-01', order_count: 1, total_sales: '100.00', top_items: [{ name: 'Synthetic item', revenue: '200.00' }] }] },
  pilot_customer_performance_v1: { ...page, items: [customer], summary: { total_sales: '100.00', active_customers: 1, total_customers: 1, total_visits: 3, total_target_visits: 10, visit_percent: 30, top_customer: customer } },
  pilot_revenue_v1: { ...page, items: [revenue], summary: { total_sales: '100.00', total_orders: 1, active_customers: 1, top_customer: revenue } },
  pilot_sales_performance_v1: { ...page, items: [{ id: u, full_name: 'Synthetic salesperson', scheduled: 2, visited: 1, missed: 1, orders: 1, total_sales: '100.00', visit_rate: 50, sales_target: '200.00' }], summary: { total_visited: 1, total_scheduled: 2, total_orders: 1, total_sales: '100.00', average_visit_rate: 50 } },
  pilot_team_activity_v1: { version: 1, as_of: AS_OF, items: [{ sales_person_id: u, total_scheduled: 2, total_visited: 1, total_orders: 1, weekly_visits: 3 }] },
  pilot_manager_customers_v1: { ...page, items: [{ id: c, name: 'Synthetic customer', address: null, city: null, last_visit_date: '2026-09-01', visit_frequency_days: 30, visits_this_period: 1, target_visits: 1, on_track: true }], summary: { on_track: 1, overdue: 1, total: 1 } },
}

const paged = { p_page: 1, p_page_size: 10 }
const dashboard = { p_from: '2026-10-01', p_to: '2026-10-01', p_rolling_from: '2025-11-01', p_status: 'all' as const, p_fulfillment: 'all' as const }
export const RESPONSE_ARGS: RpcArgsMap = {
  pilot_po_page_v1: { ...paged, p_status: 'all', p_search: '' },
  pilot_sales_order_page_v1: { ...paged, p_status: 'all', p_own_only: false },
  pilot_po_lines_v1: { ...paged, p_po_id: p },
  pilot_athel_summary_v1: dashboard,
  pilot_athel_daily_v1: { ...dashboard, p_page: 1, p_page_size: 366 },
  pilot_customer_stats_v1: { p_customer_ids: [c], p_cutoff: '2026-07-01', p_top_limit: 3 },
  pilot_customer_performance_v1: { ...paged, p_manager_id: null, p_year_month: '2026-09', p_visit_from: '2026-09-01T00:00:00Z', p_visit_until: '2026-10-01T00:00:00Z' },
  pilot_revenue_v1: { ...paged, p_from: '2026-09-01T00:00:00Z', p_to: '2026-09-30T23:59:59Z' },
  pilot_sales_performance_v1: { ...paged, p_manager_id: null, p_date_from: '2026-09-01', p_date_to: '2026-09-30', p_order_from: '2026-09-01T00:00:00Z', p_order_to: '2026-09-30T23:59:59Z', p_year_month: '2026-09' },
  pilot_team_activity_v1: { p_user_ids: [u], p_day: '2026-10-01', p_order_from: '2026-10-01T00:00:00Z', p_order_to: '2026-10-01T23:59:59Z', p_week_from: '2026-09-24T00:00:00Z' },
  pilot_manager_customers_v1: { ...paged, p_manager_id: u, p_visit_from: '2026-09-01T12:00:00Z', p_as_of: AS_OF },
}
