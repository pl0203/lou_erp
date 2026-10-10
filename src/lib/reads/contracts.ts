/** Canonical v1 read-only API contract. Changes require SQL/client coordination. */
export const READ_CONTRACT_VERSION = 1 as const
export const ORDINARY_PAGE_SIZE_LIMIT = 100
export const DAILY_PAGE_SIZE_LIMIT = 366
export const COMPLETE_READ_CHUNK = 500
export const RELATED_ID_CHUNK = 100

export type Decimal = string
export type Money = Decimal
export type UUID = string
export type CalendarDate = string
export type Timestamp = string
export const PO_OUTPUT_STATUSES = ['draft', 'confirmed', 'shipped', 'delivered', 'delayed', 'cancelled', 'confirm', 'in_progress', 'complete'] as const
export const PO_FILTER_STATUSES = ['all', 'draft', 'confirm', 'in_progress', 'complete', 'cancelled'] as const
export type POStatus = typeof PO_OUTPUT_STATUSES[number]
export type POStatusFilter = typeof PO_FILTER_STATUSES[number]
export type SalesStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'
export type SalesStatusFilter = SalesStatus | 'all'
export type FulfillmentFilter = 'all' | 'undelivered' | 'partial' | 'complete'
export type ReadEnvelope = { version: 1; as_of: Timestamp }
export type Page<T> = ReadEnvelope & { items: T[]; total: number; page: number; page_size: number }
export type ItemEnvelope<T> = ReadEnvelope & { items: T[] }
export type StatusCounts = Record<SalesStatus, number>

export type POSummary = {
  id: UUID; po_number: string; status: POStatus; order_date: CalendarDate;
  expected_delivery_date: CalendarDate | null; total_value: Money;
  customer_id: UUID; customers: { name: string } | null;
}
export type SalesOrderSummary = {
  id: UUID; status: SalesStatus; total_value: Money; created_at: Timestamp;
  rejection_note: string | null; customers: { name: string } | null;
  users: { full_name: string } | null;
}
export type SalesOrderPage = Page<SalesOrderSummary> & { status_counts: StatusCounts }
export type POLineState = {
  id: UUID; product_id: UUID | null; product_name: string; sku: string | null; quantity: number;
  unit_price: Money; line_total: Money; delivered_quantity: number;
  has_delivery_history: boolean;
}
export type POLinePage = Page<POLineState> & { po_updated_at: Timestamp; po_has_delivery_history: boolean }

export type DailyBucket = { key: CalendarDate; deliveredValue: Money; sjCount: number }
export type MonthBucket = { key: string; poValue: Money; deliveredValue: Money }
export type CustomerShare = { label: string; value: Money }
export type StatusBreakdown = { status: POStatus; value: number }
export type TopCustomer = { rank: number; name: string; poValue: Money; deliveredValue: Money; fulfillmentRate: number }
export type OutstandingItem = { rank: number; sku: string; productName: string; outstandingQty: number; outstandingValue: Money }
export type DashboardSummary = ReadEnvelope & {
  metrics: {
    totalPOCount: number; totalPOValue: Money; deliveredValue: Money;
    outstandingValue: Money; averagePOValue: Money; completedPOCount: number;
  };
  customerShare: CustomerShare[]; monthlySeries: MonthBucket[];
  statusBreakdown: StatusBreakdown[]; topCustomers: TopCustomer[];
  outstandingItems: OutstandingItem[];
}
export type CustomerStatAggregate = {
  customer_id: UUID; first_order_date: CalendarDate | null; order_count: number;
  total_sales: Money; top_items: { name: string; revenue: Money }[];
}
export type CustomerPerformanceRow = {
  id: UUID; name: string; manager_name: string | null; actual_visits: number;
  target_visits: number; last_visit_date: Timestamp | null; order_count: number;
  total_sales: Money; sales_target: Money | null;
}
export type CustomerPerformanceSummary = {
  total_sales: Money; active_customers: number; total_customers: number;
  total_visits: number; total_target_visits: number; visit_percent: number;
  top_customer: CustomerPerformanceRow | null;
}
export type CustomerPerformancePage = Page<CustomerPerformanceRow> & { summary: CustomerPerformanceSummary }
export type CustomerRevenue = {
  customer_id: UUID; customer_name: string; manager_name: string | null;
  order_count: number; total_sales: Money; last_order_date: Timestamp | null;
}
export type RevenueSummary = { total_sales: Money; total_orders: number; active_customers: number; top_customer: CustomerRevenue | null }
export type RevenuePage = Page<CustomerRevenue> & { summary: RevenueSummary }
export type SalesPerformanceRow = {
  id: UUID; full_name: string; scheduled: number; visited: number; missed: number;
  orders: number; total_sales: Money; visit_rate: number; sales_target: Money | null;
}
export type SalesPerformanceSummary = {
  unassigned_orders?: number; unassigned_sales?: Money;
  total_visited: number; total_scheduled: number; total_orders: number;
  total_sales: Money; average_visit_rate: number;
}
export type SalesPerformancePage = Page<SalesPerformanceRow> & { summary: SalesPerformanceSummary }
export type SalesReportMonths = ReadEnvelope & { earliest_schedule_date: CalendarDate | null; earliest_order_at: Timestamp | null }
export type TeamActivity = {
  sales_person_id: UUID; total_scheduled: number; total_visited: number;
  total_orders: number; weekly_visits: number;
}
export type ManagerCustomer = {
  id: UUID; name: string; address: string | null; city: string | null;
  last_visit_date: string | null; visit_frequency_days: number;
  visits_this_period: number; target_visits: number; on_track: boolean;
}
export type ManagerCustomerPage = Page<ManagerCustomer> & { summary: { on_track: number; overdue: number; total: number } }

/** Additive Sales v2: protocol version is numeric; every aggregate stays exact text. */
export type SalesMetricOrderType = 'po' | 'co' | 'all'
export type SalesMetricGroup = 'customer' | 'person'
export type SalesMetricScope = 'own' | 'team' | 'leadership'
export type SalesMetricCount = string
export type SalesMetricValues = {
  po_order_value: Money; po_order_count: SalesMetricCount;
  po_delivered_revenue: Money; po_delivered_order_count: SalesMetricCount;
  co_sold_revenue: Money; co_sold_order_count: SalesMetricCount;
}
export type SalesMetricSummary = SalesMetricValues & { co_report_event_count: SalesMetricCount }
export type SalesMetricCustomer = SalesMetricSummary & { customer_id: UUID; customer_name: string }
export type SalesMetricPerson = SalesMetricValues & {
  person_id: UUID | null; person_name: string; is_unassigned: boolean;
  /** Distinct contributing heads for this person; nonadditive across people. */
  co_contributing_report_count: SalesMetricCount;
}
export type SalesMetricMonthsArgs = { p_manager_id: UUID | null; p_order_type: SalesMetricOrderType }
export type SalesMetricsArgs = SalesMetricMonthsArgs & {
  p_month_from: CalendarDate; p_month_until: CalendarDate;
  p_group_by: SalesMetricGroup; p_page: number; p_page_size: number;
}
export type SalesMetricEnvelope = {
  version: 2; as_of: Timestamp; scope: SalesMetricScope;
  manager_id: UUID | null; order_type: SalesMetricOrderType;
}
export type SalesMetricMonths = SalesMetricEnvelope & { earliest_month: CalendarDate | null }
export type SalesMetricsPage = SalesMetricEnvelope & {
  month_from: CalendarDate; month_until: CalendarDate;
  page: number; page_size: number; total: SalesMetricCount; summary: SalesMetricSummary;
} & ({ group_by: 'customer'; items: SalesMetricCustomer[] } | { group_by: 'person'; items: SalesMetricPerson[] })
export type SalesMetricRpcName = 'pilot_sales_metrics_v2' | 'pilot_sales_metric_months_v2'

type PageArgs = { p_page: number; p_page_size: number }
export type DashboardArgs = { p_from: CalendarDate; p_to: CalendarDate; p_rolling_from: CalendarDate; p_status: POStatusFilter; p_fulfillment: FulfillmentFilter }
export type RpcArgsMap = {
  pilot_sales_metrics_v2: SalesMetricsArgs;
  pilot_sales_metric_months_v2: SalesMetricMonthsArgs;
  pilot_sales_report_months_v1: { p_manager_id: UUID | null };
  pilot_po_page_v1: PageArgs & { p_status: POStatusFilter; p_search: string };
  pilot_sales_order_page_v1: PageArgs & { p_status: SalesStatusFilter; p_own_only: boolean; p_customer_id?: UUID | null; p_visit_id?: UUID | null };
  pilot_po_lines_v1: PageArgs & { p_po_id: UUID; p_expected_updated_at?: Timestamp | null };
  pilot_athel_summary_v1: DashboardArgs;
  pilot_athel_daily_v1: DashboardArgs & PageArgs;
  pilot_customer_stats_v1: { p_customer_ids: UUID[]; p_cutoff: CalendarDate; p_top_limit: number };
  pilot_customer_performance_v1: PageArgs & { p_manager_id: UUID | null; p_year_month: string; p_visit_from: Timestamp; p_visit_until: Timestamp };
  pilot_revenue_v1: PageArgs & { p_from: Timestamp; p_to: Timestamp };
  pilot_sales_performance_v1: PageArgs & { p_manager_id: UUID | null; p_date_from: CalendarDate; p_date_to: CalendarDate; p_order_from: Timestamp; p_order_to: Timestamp; p_year_month: string };
  pilot_team_activity_v1: { p_user_ids: UUID[]; p_day: CalendarDate; p_order_from: Timestamp; p_order_to: Timestamp; p_week_from: Timestamp };
  pilot_manager_customers_v1: PageArgs & { p_manager_id: UUID; p_visit_from: Timestamp; p_as_of: Timestamp };
}
export type RpcResultMap = {
  pilot_sales_metrics_v2: SalesMetricsPage;
  pilot_sales_metric_months_v2: SalesMetricMonths;
  pilot_sales_report_months_v1: SalesReportMonths;
  pilot_po_page_v1: Page<POSummary>;
  pilot_sales_order_page_v1: SalesOrderPage;
  pilot_po_lines_v1: POLinePage;
  pilot_athel_summary_v1: DashboardSummary;
  pilot_athel_daily_v1: Page<DailyBucket>;
  pilot_customer_stats_v1: ItemEnvelope<CustomerStatAggregate>;
  pilot_customer_performance_v1: CustomerPerformancePage;
  pilot_revenue_v1: RevenuePage;
  pilot_sales_performance_v1: SalesPerformancePage;
  pilot_team_activity_v1: ItemEnvelope<TeamActivity>;
  pilot_manager_customers_v1: ManagerCustomerPage;
}
export type ReadRpcName = keyof RpcArgsMap

export const READ_RPC_DEFINITIONS = {
  pilot_sales_metrics_v2: { params: ['p_manager_id', 'p_month_from', 'p_month_until', 'p_group_by', 'p_order_type', 'p_page', 'p_page_size'], result: 'page', pageLimit: 100 },
  pilot_sales_metric_months_v2: { params: ['p_manager_id', 'p_order_type'], result: 'summary', pageLimit: null },
  pilot_sales_report_months_v1: { params: ['p_manager_id'], result: 'summary', pageLimit: null },
  pilot_po_page_v1: { params: ['p_status', 'p_search', 'p_page', 'p_page_size'], result: 'page', pageLimit: 100 },
  pilot_sales_order_page_v1: { params: ['p_status', 'p_own_only', 'p_page', 'p_page_size', 'p_customer_id', 'p_visit_id'], result: 'page', pageLimit: 100 },
  pilot_po_lines_v1: { params: ['p_po_id', 'p_page', 'p_page_size', 'p_expected_updated_at'], result: 'page', pageLimit: 100 },
  pilot_athel_summary_v1: { params: ['p_from', 'p_to', 'p_rolling_from', 'p_status', 'p_fulfillment'], result: 'summary', pageLimit: null },
  pilot_athel_daily_v1: { params: ['p_from', 'p_to', 'p_rolling_from', 'p_status', 'p_fulfillment', 'p_page', 'p_page_size'], result: 'page', pageLimit: 366 },
  pilot_customer_stats_v1: { params: ['p_customer_ids', 'p_cutoff', 'p_top_limit'], result: 'items', pageLimit: null },
  pilot_customer_performance_v1: { params: ['p_manager_id', 'p_year_month', 'p_visit_from', 'p_visit_until', 'p_page', 'p_page_size'], result: 'page', pageLimit: 100 },
  pilot_revenue_v1: { params: ['p_from', 'p_to', 'p_page', 'p_page_size'], result: 'page', pageLimit: 100 },
  pilot_sales_performance_v1: { params: ['p_manager_id', 'p_date_from', 'p_date_to', 'p_order_from', 'p_order_to', 'p_year_month', 'p_page', 'p_page_size'], result: 'page', pageLimit: 100 },
  pilot_team_activity_v1: { params: ['p_user_ids', 'p_day', 'p_order_from', 'p_order_to', 'p_week_from'], result: 'items', pageLimit: null },
  pilot_manager_customers_v1: { params: ['p_manager_id', 'p_visit_from', 'p_as_of', 'p_page', 'p_page_size'], result: 'page', pageLimit: 100 },
} as const satisfies Record<ReadRpcName, { params: readonly string[]; result: 'page' | 'summary' | 'items'; pageLimit: number | null }>
