import { supabase } from './supabase'

export type CustomerStat = {
  customer_id: string
  order_count: number
  total_sales: number
  top_items: string[]
}

export async function fetchCustomerStatsBatch(
  customerIds: string[],
  periodMonths: number = 3
): Promise<CustomerStat[]> {
  if (customerIds.length === 0) return []

  const from = new Date()
  from.setMonth(from.getMonth() - periodMonths)
  const cutoff = from.toISOString().split('T')[0]

  // All POs any time for sales calculation
  const { data: allPos, error: allError } = await supabase
    .from('purchase_orders')
    .select('id, customer_id, status, order_date')
    .in('customer_id', customerIds)
  if (allError) throw allError

  // Recent POs for order count
  const recentPos = (allPos ?? []).filter(po => po.order_date >= cutoff)
  const allPoIds = (allPos ?? []).map(po => po.id)

  // PO line items for top items and fallback sales
  let poLineItems: any[] = []
  if (allPoIds.length > 0) {
    const { data: poli } = await supabase
      .from('po_line_items')
      .select('purchase_order_id, product_name, quantity, unit_price')
      .in('purchase_order_id', allPoIds)
    poLineItems = poli ?? []
  }

  // SJ delivered quantities in last 3 months for in_progress/complete POs
  const eligiblePoIds = (allPos ?? [])
    .filter(po => ['in_progress', 'complete'].includes(po.status))
    .map(po => po.id)

  let sjData: any[] = []
  if (eligiblePoIds.length > 0) {
    const { data: sjs } = await supabase
      .from('surat_jalan')
      .select('purchase_order_id, sj_date, sj_line_items(quantity_delivered, po_line_items(unit_price))')
      .in('purchase_order_id', eligiblePoIds)
      .gte('sj_date', cutoff)
    sjData = sjs ?? []
  }

  // Build stats per customer
  const statsMap: Record<string, CustomerStat> = {}
  for (const id of customerIds) {
    statsMap[id] = { customer_id: id, order_count: 0, total_sales: 0, top_items: [] }
  }

  // Order count — recent POs only
  for (const po of recentPos) {
    if (statsMap[po.customer_id]) statsMap[po.customer_id].order_count++
  }

  // Sales from SJ deliveries in last 3 months
  for (const sj of sjData) {
    const po = (allPos ?? []).find(p => p.id === sj.purchase_order_id)
    if (!po) continue
    for (const sli of sj.sj_line_items ?? []) {
      statsMap[po.customer_id].total_sales +=
        (sli.quantity_delivered ?? 0) * (sli.po_line_items?.unit_price ?? 0)
    }
  }

  // Fallback: if no SJ data, use PO line items total for in_progress/complete POs in period
  for (const id of customerIds) {
    if (statsMap[id].total_sales === 0) {
      const eligibleRecent = (allPos ?? []).filter(
        po => po.customer_id === id &&
        ['in_progress', 'complete'].includes(po.status) &&
        po.order_date >= cutoff
      )
      statsMap[id].total_sales = eligibleRecent.reduce((sum, po) => {
        const lineTotal = poLineItems
          .filter(li => li.purchase_order_id === po.id)
          .reduce((s, li) => s + li.quantity * li.unit_price, 0)
        return sum + lineTotal
      }, 0)
    }
  }

  // Top items by revenue from all PO line items
  const itemRevenueMap: Record<string, Record<string, number>> = {}
  for (const li of poLineItems) {
    const po = (allPos ?? []).find(p => p.id === li.purchase_order_id)
    if (!po) continue
    const customerId = po.customer_id
    if (!itemRevenueMap[customerId]) itemRevenueMap[customerId] = {}
    itemRevenueMap[customerId][li.product_name] =
      (itemRevenueMap[customerId][li.product_name] ?? 0) + li.quantity * li.unit_price
  }

  for (const id of customerIds) {
    statsMap[id].top_items = Object.entries(itemRevenueMap[id] ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => name)
  }

  return Object.values(statsMap)
}

export type CustomerStatDetail = {
  first_order_date: string | null
  order_count_3mo: number
  total_sales_3mo: number
  top_items: { name: string; revenue: number }[]
}

export async function fetchCustomerStatsDetail(customerId: string): Promise<CustomerStatDetail> {
  const threeMonthsAgo = new Date()
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
  const cutoff = threeMonthsAgo.toISOString().split('T')[0]

  // All POs ever
  const { data: allPOs, error } = await supabase
    .from('purchase_orders')
    .select('id, order_date, status, total_value')
    .eq('customer_id', customerId)
    .order('order_date', { ascending: true })
  if (error) throw error

  if (!allPOs || allPOs.length === 0) {
    return { first_order_date: null, order_count_3mo: 0, total_sales_3mo: 0, top_items: [] }
  }

  const recentPOs = allPOs.filter(po => po.order_date >= cutoff)
  const allPoIds = allPOs.map(po => po.id)

  // All PO line items with price for top items by revenue
  const { data: allLineItems } = await supabase
    .from('po_line_items')
    .select('product_name, quantity, unit_price, purchase_order_id')
    .in('purchase_order_id', allPoIds)

  // Top items by revenue (quantity × unit_price)
  const itemRevenue: Record<string, number> = {}
  for (const item of allLineItems ?? []) {
    itemRevenue[item.product_name] =
      (itemRevenue[item.product_name] ?? 0) + item.quantity * item.unit_price
  }

  const topItems = Object.entries(itemRevenue)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, revenue]) => ({ name, revenue }))

  // Sales from SJ deliveries for in_progress/complete POs
  const eligiblePoIds = allPOs
    .filter(po => ['in_progress', 'complete'].includes(po.status))
    .map(po => po.id)

  let totalSales = 0
  if (eligiblePoIds.length > 0) {
    const { data: sjs } = await supabase
      .from('surat_jalan')
      .select('sj_date, sj_line_items(quantity_delivered, po_line_items(unit_price))')
      .in('purchase_order_id', eligiblePoIds)
      .gte('sj_date', cutoff)

    for (const sj of sjs ?? []) {
      for (const sli of (sj.sj_line_items as any[]) ?? []) {
        totalSales += (sli.quantity_delivered ?? 0) * (sli.po_line_items?.unit_price ?? 0)
      }
    }

    // Fallback if no SJ data
    if (totalSales === 0) {
      const eligibleRecent = allPOs.filter(
        po => ['in_progress', 'complete'].includes(po.status) && po.order_date >= cutoff
      )
      totalSales = eligibleRecent.reduce((sum, po) => {
        const lineTotal = (allLineItems ?? [])
          .filter(li => li.purchase_order_id === po.id)
          .reduce((s, li) => s + li.quantity * li.unit_price, 0)
        return sum + lineTotal
      }, 0)
    }
  }

  return {
    first_order_date: allPOs[0]?.order_date ?? null,
    order_count_3mo: recentPOs.length,
    total_sales_3mo: totalSales,
    top_items: topItems,
  }
}