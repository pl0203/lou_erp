import type { DashboardSummary } from '../../src/lib/reads/contracts'

export type Fixture = { tables: Record<string, any[]>; rpc?: Record<string, (args: any) => any>; cap?: number }
export const AS_OF = '2026-10-01T12:00:00.000Z'
export const fixtureId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const customer = { id: fixtureId(1), name: 'Synthetic customer' }
const po = (i: number, date: string, value: number) => ({ id: fixtureId(1000 + i), po_number: `REF-${i}`, status: 'confirm', order_date: date, expected_delivery_date: null, total_value: value, customer_id: customer.id, created_at: `${date}T00:00:00Z`, customers: { name: customer.name } })
const line = (parent: any, i: number) => ({ id: `${parent.id}-line-${i}`, purchase_order_id: parent.id, product_name: 'Synthetic item', sku: 'SKU', quantity: 1, unit_price: 10, line_total: 10 })

export function emptyDashboardSummary(): DashboardSummary {
  return { version: 1, as_of: AS_OF,
    metrics: { totalPOCount: 0, totalPOValue: '0.00', deliveredValue: '0.00', outstandingValue: '0.00', averagePOValue: '0.00', completedPOCount: 0 },
    customerShare: [], monthlySeries: Array.from({ length: 12 }, (_, i) => ({ key: new Date(Date.UTC(2025, 10 + i, 1)).toISOString().slice(0, 7), poValue: '0.00', deliveredValue: '0.00' })), statusBreakdown: [], topCustomers: [], outstandingItems: [],
  }
}
function withDashboardRpc(fixture: Fixture, summary: DashboardSummary): Fixture {
  fixture.rpc = {
    pilot_athel_summary_v1: () => summary,
    pilot_athel_daily_v1: args => {
      const items: any[] = []
      const day = new Date(`${args.p_from}T00:00:00Z`)
      while (day.toISOString().slice(0, 10) <= args.p_to) {
        items.push({ key: day.toISOString().slice(0, 10), deliveredValue: '0.00', sjCount: 0 })
        day.setUTCDate(day.getUTCDate() + 1)
      }
      const from = (args.p_page - 1) * args.p_page_size
      return { version: 1, as_of: AS_OF, total: items.length, page: args.p_page, page_size: args.p_page_size, items: items.slice(from, from + args.p_page_size) }
    },
  }
  return fixture
}
export function monthlyPOFixture(): Fixture {
  const pos = Array.from({ length: 6000 }, (_, i) => po(i, new Date(Date.UTC(2025, 10 + Math.floor(i / 500), 1)).toISOString().slice(0, 10), 10))
  const summary = emptyDashboardSummary()
  summary.metrics = { ...summary.metrics, totalPOCount: 1500, totalPOValue: '15000.00', outstandingValue: '15000.00', averagePOValue: '10.00' }
  return withDashboardRpc({ tables: { purchase_orders: pos, customers: [customer], po_line_items: pos.map(p => line(p, 0)) } }, summary)
}
export function denseLineFixture(): Fixture {
  const pos = Array.from({ length: 500 }, (_, i) => po(i, '2026-09-15', 100))
  const summary = emptyDashboardSummary()
  summary.metrics = { ...summary.metrics, totalPOCount: 500, totalPOValue: '50000.00', outstandingValue: '50000.00', averagePOValue: '100.00' }
  return withDashboardRpc({ tables: { purchase_orders: pos, customers: [customer], po_line_items: pos.flatMap(p => Array.from({ length: 10 }, (_, i) => line(p, i))) } }, summary)
}
export function broadCustomerFixture(): Fixture {
  const customers = Array.from({ length: 101 }, (_, i) => ({ id: fixtureId(20000 + i), name: `Common synthetic ${i}` }))
  const pos = customers.map((c, i) => ({ ...po(i, '2026-09-15', 10), customer_id: c.id, customers: { name: c.name } }))
  return { tables: { customers, purchase_orders: pos }, rpc: {
    pilot_po_page_v1: args => ({ version: 1, as_of: AS_OF, total: 101, page: args.p_page, page_size: args.p_page_size, items: pos.slice((args.p_page - 1) * args.p_page_size, args.p_page * args.p_page_size).map(p => ({ ...p, total_value: '10.00' })) }),
  } }
}

/** Read-only API boundary simulator: each table query is independently capped. */
export function fixtureClient(getFixture: () => Fixture) {
  function response(resolveData: () => any) {
    const q: any = { abortSignal: () => q, then: (resolve: any, reject: any) => Promise.resolve().then(resolveData).then(resolve, reject) }
    return q
  }
  return {
    rpc(name: string, args: any) { if (name === 'pilot_team_directory') return this.from('users'); return response(() => ({ data: getFixture().rpc?.[name]?.(args) ?? null, error: null })) },
    from(table: string) {
      const filters: ((row: any) => boolean)[] = []; const orders: [string, boolean][] = []
      let offset = 0; let end = Infinity; let limit = Infinity; let orFilter = ''
      const q = response(() => {
        const fixture = getFixture()
        let rows = (fixture.tables[table] ?? []).filter(row => filters.every(filter => filter(row)))
        if (orFilter) {
          const customers = /customer_id\.in\.\(([^)]*)\)/.exec(orFilter)?.[1].split(',') ?? []
          const pos = /(?:^|,)id\.in\.\(([^)]*)\)/.exec(orFilter)?.[1].split(',') ?? []
          const term = /po_number\.ilike\.%(.*?)%/.exec(orFilter)?.[1].toLowerCase() ?? ''
          rows = rows.filter(row => row.po_number.toLowerCase().includes(term) || customers.includes(row.customer_id) || pos.includes(row.id))
        }
        rows.sort((a, b) => { for (const [key, asc] of orders) { const n = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0; if (n) return n * (asc ? 1 : -1) } return 0 })
        const count = rows.length
        return { data: rows.slice(offset, Math.min(end + 1, offset + limit, offset + (fixture.cap ?? 1000))), count, error: null }
      })
      q.select = () => q
      q.eq = (key: string, value: any) => { filters.push(row => row[key] === value); return q }
      q.is = (key: string, value: any) => { filters.push(row => (row[key] ?? null) === value); return q }
      q.gte = (key: string, value: any) => { filters.push(row => row[key] >= value); return q }
      q.lt = (key: string, value: any) => { filters.push(row => row[key] < value); return q }
      q.lte = (key: string, value: any) => { filters.push(row => row[key] <= value); return q }
      q.in = (key: string, values: any[]) => { const ids = new Set(values); filters.push(row => ids.has(row[key])); return q }
      q.ilike = (key: string, value: string) => { filters.push(row => String(row[key]).toLowerCase().includes(value.slice(1, -1).toLowerCase())); return q }
      q.order = (key: string, options = { ascending: true }) => { orders.push([key, options.ascending !== false]); return q }
      q.range = (from: number, to: number) => { offset = from; end = to; return q }
      q.limit = (value: number) => { limit = value; return q }
      q.or = (value: string) => { orFilter = value; return q }
      q.single = () => { const then = q.then; q.then = (resolve: any, reject: any) => then((result: any) => resolve({ ...result, data: result.data[0] ?? null }), reject); return q }
      q.maybeSingle = q.single
      return q
    },
  }
}

export function supportingReadFixture(): Fixture {
  const u = fixtureId(2)
  const customers = Array.from({ length: 1001 }, (_, i) => ({ id: fixtureId(10000 + i), name: `Customer ${String(i).padStart(4, '0')}`, address: null, city: null, phone: null, email: null, pricing_tier: 'luar_kota', visit_frequency_days: 7, last_visit_date: null }))
  const products = customers.map((_, i) => ({ id: fixtureId(30000 + i), name: `Product ${String(i).padStart(4, '0')}`, sku: `SYN-${i}`, size: null, unit_price: 1, harga_pokok: 1, luar_kota: 1, dalam_kota: 1, depo_bangunan: 1 }))
  return { tables: {
    customers, products,
    users: [{ id: u, full_name: 'Manager', role: 'sales_manager', manager_id: u, is_active: true }, ...customers.map((_, i) => ({ id: fixtureId(40000 + i), full_name: `Sales ${i}`, role: 'sales_person', manager_id: u, is_active: true }))],
    customer_manager_assignments: customers.map((c, i) => ({ id: fixtureId(50000 + i), customer_id: c.id, manager_id: u, customers: c, managers: { id: u, full_name: 'Manager' } })),
    sales_schedules: customers.map((c, i) => ({ id: fixtureId(60000 + i), outlet_id: c.id, sales_person_id: u, scheduled_date: '2026-10-01', created_at: AS_OF, status: 'pending', notes: null, customers: c, users: { id: u, full_name: 'Manager' }, outlet_visits: [] })),
    promotions: products.map((p, i) => ({ id: fixtureId(70000 + i), product_id: p.id, start_date: '2026-09-01', end_date: '2026-12-01', is_active: false, created_at: AS_OF, products: p })),
  } }
}

/** Small complete fixture pinning existing populations, including deliberate asymmetries. */
export function metricCharacterizationFixture(): Fixture {
  const c = fixtureId(1), u = fixtureId(2)
  const old = { ...po(0, '2026-08-01', 100), status: 'in_progress' }
  const current = po(1, '2026-10-01', 20)
  const legacy = { ...po(2, '2026-10-01', 50), status: 'delayed' }
  const future = { ...po(3, '2026-11-01', 200), status: 'cancelled' }
  const lines = [
    { ...line(old, 0), id: fixtureId(30), product_name: 'Old item', sku: 'OLD', quantity: 10, line_total: 100 },
    { ...line(current, 0), id: fixtureId(31), product_name: 'Mixed item', sku: 'MIX', quantity: 3, unit_price: 0, line_total: 0 },
    { ...line(current, 1), id: fixtureId(32), product_name: 'Mixed item', sku: 'MIX', quantity: 2, line_total: 20 },
    { ...line(legacy, 0), id: fixtureId(33), product_name: 'Legacy item', sku: 'LEGACY', quantity: 1, unit_price: 50, line_total: 50 },
    { ...line(future, 0), id: fixtureId(34), product_name: 'Future cancelled item', sku: 'FUTURE', quantity: 1, unit_price: 200, line_total: 200 },
  ]
  const shipments = [
    { id: fixtureId(40), purchase_order_id: old.id, sj_date: '2026-09-30', voided_at: null, line: lines[0], qty: 1 },
    { id: fixtureId(41), purchase_order_id: old.id, sj_date: '2026-10-01', voided_at: null, line: lines[0], qty: 2 },
    { id: fixtureId(42), purchase_order_id: current.id, sj_date: '2026-10-01', voided_at: null, line: lines[1], qty: 1 },
    { id: fixtureId(43), purchase_order_id: old.id, sj_date: '2026-10-01', voided_at: '2026-10-01', line: lines[0], qty: 7 },
  ]
  return { tables: {
    customers: [{ ...customer, address: null, city: null, visit_frequency_days: 10, last_visit_date: '2026-09-01' }],
    users: [{ id: u, full_name: 'Synthetic salesperson', role: 'sales_person', is_active: true, manager_id: u }],
    customer_manager_assignments: [{ id: fixtureId(6), customer_id: c, manager_id: u, users: { full_name: 'Synthetic manager' } }],
    purchase_orders: [old, current, legacy, future], po_line_items: lines,
    surat_jalan: shipments.map(sj => ({ ...sj, sj_line_items: [{ quantity_delivered: sj.qty, po_line_items: { unit_price: sj.line.unit_price } }] })),
    sj_line_items: shipments.map(sj => ({ surat_jalan_id: sj.id, po_line_item_id: sj.line.id, quantity_delivered: sj.qty })),
    outlet_visits: ['2026-10-01T12:00:00Z', '2026-10-01T13:00:00Z', '2026-11-02T12:00:00Z'].map((when, i) => ({ id: fixtureId(50 + i), outlet_id: c, sales_person_id: u, checked_in_at: when })),
    customer_targets: [{ customer_id: c, year_month: '2026-09', target_value: 100 }, { customer_id: c, year_month: '2026-10', target_value: 200 }, { customer_id: c, year_month: '2026-11', target_value: 300 }],
    sales_targets: [{ user_id: u, year_month: '2026-09', target_value: 200 }, { user_id: u, year_month: '2026-10', target_value: 300 }],
    sales_schedules: [{ id: fixtureId(60), sales_person_id: u, scheduled_date: '2026-10-01', status: 'completed', outlet_visits: [{ id: fixtureId(50) }] }, { id: fixtureId(61), sales_person_id: u, scheduled_date: '2026-10-01', status: 'missed', outlet_visits: [] }],
    girard_orders: ['approved', 'pending', 'rejected', 'cancelled'].map((status, i) => ({ id: fixtureId(70 + i), customer_id: c, submitted_by: u, status, total_value: [100, 50, 20, 30][i], created_at: '2026-10-01T12:00:00Z' })),
  } }
}

/** Captured small-data results from the pre-migration characterization run.
 * SQL population correctness is independently asserted by scalable-report-reads.sql.
 * These responses keep the client adapter/presentation checks on those same values.
 */
export function metricCharacterizationRpcFixture(): Fixture {
  const fixture = metricCharacterizationFixture(), c = fixtureId(1), u = fixtureId(2)
  const customerRow = { id: c, name: 'Synthetic customer', manager_name: 'Synthetic manager', actual_visits: 2, target_visits: 4, last_visit_date: '2026-11-02T12:00:00Z', order_count: 2, total_sales: '20.00', sales_target: '200.00' }
  const revenue = { customer_id: c, customer_name: 'Synthetic customer', manager_name: 'Synthetic manager', order_count: 1, total_sales: '100.00', last_order_date: '2026-10-01T12:00:00Z' }
  const sales = { id: u, full_name: 'Synthetic salesperson', scheduled: 2, visited: 1, missed: 1, orders: 4, total_sales: '200.00', visit_rate: 50, sales_target: '300.00' }
  const page = (args: any, items: any[], summary: any) => ({ version: 1, as_of: AS_OF, items, total: items.length, page: args.p_page, page_size: args.p_page_size, summary })
  fixture.rpc = {
    pilot_athel_summary_v1: () => ({ ...emptyDashboardSummary(), metrics: { totalPOCount: 2, totalPOValue: '70.00', deliveredValue: '0.00', outstandingValue: '70.00', averagePOValue: '35.00', completedPOCount: 0 },
      monthlySeries: emptyDashboardSummary().monthlySeries.map(month => ({ ...month, deliveredValue: month.key === '2026-09' ? '10.00' : month.key === '2026-10' ? '20.00' : '0.00', poValue: month.key === '2026-10' ? '70.00' : '0.00' })),
      statusBreakdown: [{ status: 'confirm', value: 1 }, { status: 'delayed', value: 1 }], customerShare: [{ label: 'Synthetic customer', value: '70.00' }],
      topCustomers: [{ rank: 1, name: 'Synthetic customer', poValue: '70.00', deliveredValue: '0.00', fulfillmentRate: 0 }],
      outstandingItems: [{ rank: 1, sku: 'OLD', productName: 'Old item', outstandingQty: 7, outstandingValue: '70.00' }, { rank: 2, sku: 'LEGACY', productName: 'Legacy item', outstandingQty: 1, outstandingValue: '50.00' }, { rank: 3, sku: 'MIX', productName: 'Mixed item', outstandingQty: 4, outstandingValue: '20.00' }],
    }),
    pilot_athel_daily_v1: args => page(args, [{ key: '2026-10-01', deliveredValue: '20.00', sjCount: 2 }], undefined),
    pilot_customer_stats_v1: args => ({ version: 1, as_of: AS_OF, items: [{ customer_id: c, first_order_date: '2026-08-01', order_count: 4, total_sales: '30.00', top_items: [{ name: 'Future cancelled item', revenue: '200.00' }, { name: 'Old item', revenue: '100.00' }, { name: 'Legacy item', revenue: '50.00' }, { name: 'Mixed item', revenue: '20.00' }].slice(0, args.p_top_limit) }] }),
    pilot_customer_performance_v1: args => page(args, [customerRow], { total_sales: '20.00', active_customers: 1, total_customers: 1, total_visits: 2, total_target_visits: 4, visit_percent: 50, top_customer: customerRow }),
    pilot_revenue_v1: args => page(args, [revenue], { total_sales: '100.00', total_orders: 1, active_customers: 1, top_customer: revenue }),
    pilot_sales_performance_v1: args => page(args, [sales], { total_visited: 1, total_scheduled: 2, total_orders: 4, total_sales: '200.00', average_visit_rate: 50 }),
    pilot_team_activity_v1: () => ({ version: 1, as_of: AS_OF, items: [{ sales_person_id: u, total_scheduled: 2, total_visited: 1, total_orders: 4, weekly_visits: 3 }] }),
    pilot_manager_customers_v1: args => page(args, [{ id: c, name: 'Synthetic customer', address: null, city: null, last_visit_date: '2026-09-01', visit_frequency_days: 10, visits_this_period: 3, target_visits: 3, on_track: true }], { total: 1, on_track: 1, overdue: 1 }),
  }
  return fixture
}
