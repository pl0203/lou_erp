import { fetchCustomerStatAggregates } from './reads/reports'
import { IncompleteReadError } from './reads/completeReads'

export type CustomerStat = { customer_id: string; order_count: number; total_sales: string; top_items: string[] }
export async function fetchCustomerStatsBatch(customerIds: string[], periodMonths = 3, signal?: AbortSignal): Promise<CustomerStat[]> {
  const from = new Date()
  from.setMonth(from.getMonth() - periodMonths)
  const rows = await fetchCustomerStatAggregates(customerIds, from.toISOString().split('T')[0], 3, signal)
  return rows.map(row => ({ customer_id: row.customer_id, order_count: row.order_count, total_sales: row.total_sales, top_items: row.top_items.map(item => item.name) }))
}
export type CustomerStatDetail = { first_order_date: string | null; order_count_3mo: number; total_sales_3mo: string; top_items: { name: string; revenue: string }[] }
export async function fetchCustomerStatsDetail(customerId: string, signal?: AbortSignal): Promise<CustomerStatDetail> {
  const from = new Date()
  from.setMonth(from.getMonth() - 3)
  const [row] = await fetchCustomerStatAggregates([customerId], from.toISOString().split('T')[0], 10, signal)
  if (!row) throw new IncompleteReadError('Statistik pelanggan tidak tersedia.')
  return { first_order_date: row.first_order_date, order_count_3mo: row.order_count, total_sales_3mo: row.total_sales, top_items: row.top_items }
}
