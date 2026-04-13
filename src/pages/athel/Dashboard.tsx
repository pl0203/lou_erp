import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import AthelNav from '../../components/AthelNav'

type FilterStatus = 'all' | 'confirm' | 'in_progress' | 'complete' | 'cancelled'
type FulfillmentFilter = 'all' | 'undelivered' | 'partial' | 'complete'

type PurchaseOrder = {
  id: string
  po_number: string
  status: string
  order_date: string
  total_value: number
  customer_id: string | null
}

type Customer = {
  id: string
  name: string | null
}

type POLineItem = {
  id: string
  purchase_order_id: string
  product_name: string
  sku: string | null
  quantity: number
  unit_price: number
  line_total: number | null
}

type SuratJalan = {
  id: string
  purchase_order_id: string
  sj_date: string
}

type SJLineItem = {
  surat_jalan_id: string
  po_line_item_id: string
  quantity_delivered: number
}

type DashboardData = {
  metrics: {
    totalPOCount: number
    totalPOValue: number
    deliveredValue: number
    outstandingValue: number
    averagePOValue: number
    completedPOCount: number
  }
  customerShare: { label: string; value: number; color: string }[]
  monthlySeries: { key: string; label: string; poValue: number; deliveredValue: number }[]
  dailySeries: { key: string; label: string; deliveredValue: number; sjCount: number }[]
  statusBreakdown: { label: string; value: number; color: string }[]
  topCustomers: { rank: number; name: string; poValue: number; deliveredValue: number; fulfillmentRate: number }[]
  outstandingItems: { rank: number; sku: string; productName: string; outstandingQty: number; outstandingValue: number }[]
}

const DONUT_COLORS = ['#3b82f6', '#10b981', '#f97316', '#8b5cf6', '#ef4444', '#64748b']
const STATUS_META: Record<string, { label: string; color: string }> = {
  confirm: { label: 'Confirm', color: '#3b82f6' },
  in_progress: { label: 'In Progress', color: '#f59e0b' },
  complete: { label: 'Complete', color: '#10b981' },
  cancelled: { label: 'Cancelled', color: '#94a3b8' },
}

function formatCurrency(value: number): string {
  return `Rp${value.toLocaleString('id-ID')}`
}

function formatCompactCurrency(value: number): string {
  if (value >= 1_000_000_000) return `Rp${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `Rp${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `Rp${(value / 1_000).toFixed(0)}K`
  return `Rp${value.toLocaleString('id-ID')}`
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

function getFirstDayOfMonth(offset = 0): string {
  const date = new Date()
  date.setMonth(date.getMonth() + offset, 1)
  date.setHours(0, 0, 0, 0)
  return date.toISOString().split('T')[0]
}

function getToday(): string {
  return new Date().toISOString().split('T')[0]
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function subtractMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() - months, 1)
}

function minDate(a: string, b: string): string {
  return a < b ? a : b
}

function monthKey(dateStr: string): string {
  const date = new Date(dateStr)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function dayKey(dateStr: string): string {
  return new Date(dateStr).toISOString().split('T')[0]
}

function displayMonth(key: string): string {
  const [year, month] = key.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('id-ID', { month: 'short', year: 'numeric' })
}

function displayDay(key: string): string {
  return new Date(key).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
}

function rangeMonths(start: string, end: string): string[] {
  const result: string[] = []
  const cursor = new Date(start)
  cursor.setDate(1)
  const limit = new Date(end)
  limit.setDate(1)

  while (cursor <= limit) {
    result.push(monthKey(cursor.toISOString()))
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return result
}

function rollingMonthKeys(months: number): string[] {
  const currentMonth = startOfMonth(new Date())
  const start = subtractMonths(currentMonth, months - 1)
  return rangeMonths(start.toISOString().split('T')[0], currentMonth.toISOString().split('T')[0])
}

function rangeDays(start: string, end: string): string[] {
  const result: string[] = []
  const cursor = new Date(start)
  const limit = new Date(end)
  while (cursor <= limit) {
    result.push(dayKey(cursor.toISOString()))
    cursor.setDate(cursor.getDate() + 1)
  }
  return result
}

function makeDonutBackground(items: { value: number; color: string }[]): string {
  const total = items.reduce((sum, item) => sum + item.value, 0)
  if (total <= 0) return 'conic-gradient(#e5e7eb 0deg 360deg)'

  let current = 0
  const stops = items.map(item => {
    const start = current
    const degrees = (item.value / total) * 360
    current += degrees
    return `${item.color} ${start}deg ${current}deg`
  })
  return `conic-gradient(${stops.join(', ')})`
}

function Tooltip({
  title,
  lines,
}: {
  title: string
  lines: { label: string; value: string; color?: string }[]
}) {
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-3 w-max min-w-40 -translate-x-1/2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-xl">
      <p className="text-xs font-semibold text-gray-900">{title}</p>
      <div className="mt-2 space-y-1.5">
        {lines.map(line => (
          <div key={line.label} className="flex items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-2 text-gray-500">
              {line.color && <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: line.color }} />}
              <span>{line.label}</span>
            </div>
            <span className="font-medium text-gray-900">{line.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

async function fetchDashboardData(
  startDate: string,
  endDate: string,
  status: FilterStatus,
  fulfillment: FulfillmentFilter
): Promise<DashboardData> {
  const rolling12Start = subtractMonths(startOfMonth(new Date()), 11).toISOString().split('T')[0]
  const poFetchStart = minDate(startDate, rolling12Start)

  let poQuery = supabase
    .from('purchase_orders')
    .select('id, po_number, status, order_date, total_value, customer_id')
    .gte('order_date', poFetchStart)
    .lte('order_date', endDate)
    .order('order_date', { ascending: true })

  if (status !== 'all') poQuery = poQuery.eq('status', status)

  const { data: poData, error: poError } = await poQuery
  if (poError) throw poError

  const allPurchaseOrders = (poData ?? []) as PurchaseOrder[]
  const purchaseOrders = allPurchaseOrders.filter(po => po.order_date >= startDate && po.order_date <= endDate)
  const poIds = allPurchaseOrders.map(po => po.id)
  const customerIds = [...new Set(allPurchaseOrders.map(po => po.customer_id).filter(Boolean))] as string[]

  let customers: Customer[] = []
  if (customerIds.length > 0) {
    const { data: customerData, error: customerError } = await supabase
      .from('customers')
      .select('id, name')
      .in('id', customerIds)

    if (customerError) throw customerError
    customers = (customerData ?? []) as Customer[]
  }

  let lineItems: POLineItem[] = []
  let sjList: SuratJalan[] = []
  let sjLineItems: SJLineItem[] = []

  if (poIds.length > 0) {
    const [{ data: liData, error: liError }, { data: sjData, error: sjError }] = await Promise.all([
      supabase
        .from('po_line_items')
        .select('id, purchase_order_id, product_name, sku, quantity, unit_price, line_total')
        .in('purchase_order_id', poIds),
      supabase
        .from('surat_jalan')
        .select('id, purchase_order_id, sj_date')
        .in('purchase_order_id', poIds)
        .order('sj_date', { ascending: true }),
    ])

    if (liError) throw liError
    if (sjError) throw sjError
    lineItems = (liData ?? []) as POLineItem[]
    sjList = (sjData ?? []) as SuratJalan[]

    const sjIds = sjList.map(sj => sj.id)
    if (sjIds.length > 0) {
      const { data: sjiData, error: sjiError } = await supabase
        .from('sj_line_items')
        .select('surat_jalan_id, po_line_item_id, quantity_delivered')
        .in('surat_jalan_id', sjIds)

      if (sjiError) throw sjiError
      sjLineItems = (sjiData ?? []) as SJLineItem[]
    }
  }

  const customerNameById = Object.fromEntries(customers.map(customer => [customer.id, customer.name ?? 'Tanpa Pelanggan']))
  const lineItemById = Object.fromEntries(lineItems.map(item => [item.id, item]))
  const suratJalanById = Object.fromEntries(sjList.map(sj => [sj.id, sj]))

  const deliveredByLineId: Record<string, number> = {}
  const deliveredValueByPO: Record<string, number> = {}
  const deliveredValueByDay: Record<string, number> = {}
  const distinctSJByDay: Record<string, Set<string>> = {}
  const deliveredValueByMonth: Record<string, number> = {}

  for (const line of sjLineItems) {
    const sj = suratJalanById[line.surat_jalan_id]
    const poLineItem = lineItemById[line.po_line_item_id]
    if (!sj || !poLineItem) continue

    const sjDay = dayKey(sj.sj_date)
    const sjMonth = monthKey(sj.sj_date)

    deliveredByLineId[line.po_line_item_id] = (deliveredByLineId[line.po_line_item_id] ?? 0) + (line.quantity_delivered ?? 0)

    const lineValue = (line.quantity_delivered ?? 0) * (poLineItem.unit_price ?? 0)
    deliveredValueByPO[sj.purchase_order_id] = (deliveredValueByPO[sj.purchase_order_id] ?? 0) + lineValue

    if (sj.sj_date >= startDate && sj.sj_date <= endDate) {
      deliveredValueByDay[sjDay] = (deliveredValueByDay[sjDay] ?? 0) + lineValue
      if (!distinctSJByDay[sjDay]) distinctSJByDay[sjDay] = new Set()
      distinctSJByDay[sjDay].add(sj.id)
    }
    if (sj.sj_date >= rolling12Start && sj.sj_date <= endDate) {
      deliveredValueByMonth[sjMonth] = (deliveredValueByMonth[sjMonth] ?? 0) + lineValue
    }
  }

  const poTotalsByLine: Record<string, number> = {}
  const poOutstandingValue: Record<string, number> = {}
  const poOutstandingQty: Record<string, number> = {}
  const outstandingItemMap: Record<string, { sku: string; productName: string; outstandingQty: number; outstandingValue: number }> = {}

  for (const item of lineItems) {
    const orderedQty = item.quantity ?? 0
    const deliveredQty = deliveredByLineId[item.id] ?? 0
    const outstandingQty = Math.max(0, orderedQty - deliveredQty)
    const lineTotal = item.line_total ?? orderedQty * (item.unit_price ?? 0)
    const outstandingValue = outstandingQty * (item.unit_price ?? 0)

    poTotalsByLine[item.purchase_order_id] = (poTotalsByLine[item.purchase_order_id] ?? 0) + lineTotal
    poOutstandingValue[item.purchase_order_id] = (poOutstandingValue[item.purchase_order_id] ?? 0) + outstandingValue
    poOutstandingQty[item.purchase_order_id] = (poOutstandingQty[item.purchase_order_id] ?? 0) + outstandingQty

    if (outstandingQty > 0) {
      const outstandingKey = item.sku ?? item.product_name
      if (!outstandingItemMap[outstandingKey]) {
        outstandingItemMap[outstandingKey] = {
          sku: item.sku ?? '—',
          productName: item.product_name,
          outstandingQty: 0,
          outstandingValue: 0,
        }
      }
      outstandingItemMap[outstandingKey].outstandingQty += outstandingQty
      outstandingItemMap[outstandingKey].outstandingValue += outstandingValue
    }
  }

  const filteredPOs = purchaseOrders.filter(po => {
    const outstandingQty = poOutstandingQty[po.id] ?? 0
    const deliveredValue = deliveredValueByPO[po.id] ?? 0
    const totalValue = po.total_value ?? poTotalsByLine[po.id] ?? 0

    if (fulfillment === 'all') return true
    if (fulfillment === 'undelivered') return deliveredValue === 0
    if (fulfillment === 'complete') return outstandingQty === 0 && totalValue > 0
    return deliveredValue > 0 && outstandingQty > 0
  })

  const totalPOValue = filteredPOs.reduce((sum, po) => sum + (po.total_value ?? 0), 0)
  const deliveredValue = filteredPOs.reduce((sum, po) => sum + (deliveredValueByPO[po.id] ?? 0), 0)
  const outstandingValue = filteredPOs.reduce((sum, po) => sum + (poOutstandingValue[po.id] ?? 0), 0)

  const customerMap: Record<string, { name: string; poValue: number; deliveredValue: number }> = {}
  const statusCounts: Record<string, number> = {}
  const monthlyPOValue: Record<string, number> = {}

  const filteredPOIds = new Set(filteredPOs.map(po => po.id))

  for (const po of filteredPOs) {
    const customerId = po.customer_id ?? po.id
    const customerName = po.customer_id ? (customerNameById[po.customer_id] ?? 'Tanpa Pelanggan') : 'Tanpa Pelanggan'
    if (!customerMap[customerId]) {
      customerMap[customerId] = { name: customerName, poValue: 0, deliveredValue: 0 }
    }
    customerMap[customerId].poValue += po.total_value ?? 0
    customerMap[customerId].deliveredValue += deliveredValueByPO[po.id] ?? 0

    statusCounts[po.status] = (statusCounts[po.status] ?? 0) + 1
  }

  for (const po of allPurchaseOrders) {
    if (!filteredPOIds.has(po.id)) continue
    const poMonth = monthKey(po.order_date)
    if (po.order_date >= rolling12Start && po.order_date <= endDate) {
      monthlyPOValue[poMonth] = (monthlyPOValue[poMonth] ?? 0) + (po.total_value ?? 0)
    }
  }

  const customerEntries = Object.values(customerMap).sort((a, b) => b.poValue - a.poValue)
  const topCustomerTotal = customerEntries.reduce((sum, item) => sum + item.poValue, 0)
  const customerShare = customerEntries.slice(0, 5).map((item, index) => ({
    label: item.name,
    value: item.poValue,
    color: DONUT_COLORS[index],
  }))

  if (customerEntries.length > 5) {
    const otherValue = customerEntries.slice(5).reduce((sum, item) => sum + item.poValue, 0)
    customerShare.push({ label: 'Lainnya', value: otherValue, color: DONUT_COLORS[5] })
  }

  const monthlySeries = rollingMonthKeys(12).map(key => ({
    key,
    label: displayMonth(key),
    poValue: monthlyPOValue[key] ?? 0,
    deliveredValue: deliveredValueByMonth[key] ?? 0,
  }))

  const days = rangeDays(startDate, endDate)
  const sampledDays = days.length > 14 ? days.filter((_, index) => index % Math.ceil(days.length / 14) === 0 || index === days.length - 1) : days
  const dailySeries = sampledDays.map(key => ({
    key,
    label: displayDay(key),
    deliveredValue: deliveredValueByDay[key] ?? 0,
    sjCount: distinctSJByDay[key]?.size ?? 0,
  }))

  const statusBreakdown = Object.entries(statusCounts).map(([key, value]) => ({
    label: STATUS_META[key]?.label ?? key,
    value,
    color: STATUS_META[key]?.color ?? '#94a3b8',
  }))

  const topCustomers = customerEntries.slice(0, 10).map((item, index) => ({
    rank: index + 1,
    name: item.name,
    poValue: item.poValue,
    deliveredValue: item.deliveredValue,
    fulfillmentRate: item.poValue > 0 ? (item.deliveredValue / item.poValue) * 100 : 0,
  }))

  const outstandingItems = Object.values(outstandingItemMap)
    .filter(row => row.outstandingValue > 0)
    .sort((a, b) => b.outstandingValue - a.outstandingValue)
    .slice(0, 10)
    .map((row, index) => ({ ...row, rank: index + 1 }))

  return {
    metrics: {
      totalPOCount: filteredPOs.length,
      totalPOValue,
      deliveredValue,
      outstandingValue,
      averagePOValue: filteredPOs.length > 0 ? totalPOValue / filteredPOs.length : 0,
      completedPOCount: filteredPOs.filter(po => po.status === 'complete').length,
    },
    customerShare: topCustomerTotal > 0 ? customerShare : [],
    monthlySeries,
    dailySeries,
    statusBreakdown,
    topCustomers,
    outstandingItems,
  }
}

function StatCard({
  label,
  value,
  helper,
}: {
  label: string
  value: string
  helper: string
}) {
  return (
    <div className="rounded-2xl border border-blue-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-gray-900">{value}</p>
      <p className="mt-2 text-sm text-gray-500">{helper}</p>
    </div>
  )
}

function DonutCard({
  title,
  items,
  centerLabel,
  centerValue,
}: {
  title: string
  items: { label: string; value: number; color: string }[]
  centerLabel: string
  centerValue?: string
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0)
  const [hovered, setHovered] = useState<string | null>(null)
  const hoveredItem = items.find(item => item.label === hovered) ?? null

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      {items.length === 0 ? (
        <div className="py-16 text-center text-sm text-gray-400">Belum ada data pada filter ini.</div>
      ) : (
        <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-center">
          <div className="mx-auto grid place-items-center">
            <div
              className="relative h-64 w-64 rounded-full"
              style={{ background: makeDonutBackground(items) }}
              onMouseLeave={() => setHovered(null)}
            >
              {hoveredItem && (
                <Tooltip
                  title={hoveredItem.label}
                  lines={[
                    { label: 'Nilai', value: formatCompactCurrency(hoveredItem.value), color: hoveredItem.color },
                    { label: 'Proporsi', value: total > 0 ? formatPercent((hoveredItem.value / total) * 100) : '0%' },
                  ]}
                />
              )}
              <div className="absolute inset-[26%] rounded-full bg-white shadow-inner" />
              <div className="absolute inset-0 grid place-items-center px-10 text-center">
                <div>
                  <p className="text-sm font-medium text-gray-500">{centerLabel}</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-900">{centerValue ?? formatCompactCurrency(total)}</p>
                </div>
              </div>
            </div>
          </div>
          <div className="grid flex-1 gap-3">
            {items.map(item => (
              <div
                key={item.label}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-1 transition-colors hover:bg-gray-50"
                onMouseEnter={() => setHovered(item.label)}
                onMouseLeave={() => setHovered(null)}
              >
                <div className="flex items-center gap-3 text-sm text-gray-700">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                  <span>{item.label}</span>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-900">{formatCompactCurrency(item.value)}</p>
                  <p className="text-xs text-gray-400">{total > 0 ? formatPercent((item.value / total) * 100) : '0%'}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function BarChartCard({
  title,
  subtitle,
  series,
}: {
  title: string
  subtitle: string
  series: { label: string; poValue: number; deliveredValue: number }[]
}) {
  const maxValue = Math.max(...series.flatMap(item => [item.poValue, item.deliveredValue]), 1)
  const [hovered, setHovered] = useState<string | null>(null)

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
        </div>
        <div className="flex gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-blue-600" />Total PO</span>
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-orange-400" />Terkirim</span>
        </div>
      </div>
      <div className="mt-8 flex h-72 items-end gap-3 overflow-x-auto">
        {series.map(item => (
          <div
            key={item.key}
            className="relative flex min-w-20 flex-1 flex-col items-center gap-3"
            onMouseEnter={() => setHovered(item.key)}
            onMouseLeave={() => setHovered(null)}
          >
            {hovered === item.key && (
              <Tooltip
                title={item.label}
                lines={[
                  { label: 'Total PO', value: formatCurrency(item.poValue), color: '#2563eb' },
                  { label: 'Terkirim', value: formatCurrency(item.deliveredValue), color: '#fb923c' },
                ]}
              />
            )}
            <div className="flex h-56 items-end gap-2">
              <div className="flex w-8 flex-col justify-end rounded-t-md bg-blue-600/90" style={{ height: `${(item.poValue / maxValue) * 100}%` }}>
                <span className="px-1 py-1 text-center text-[10px] font-medium text-white">{item.poValue > 0 ? formatCompactCurrency(item.poValue) : ''}</span>
              </div>
              <div className="flex w-8 flex-col justify-end rounded-t-md bg-orange-300" style={{ height: `${(item.deliveredValue / maxValue) * 100}%` }}>
                <span className="px-1 py-1 text-center text-[10px] font-medium text-gray-700">{item.deliveredValue > 0 ? formatCompactCurrency(item.deliveredValue) : ''}</span>
              </div>
            </div>
            <p className="text-center text-xs text-gray-500">{item.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function TrendCard({
  title,
  subtitle,
  series,
}: {
  title: string
  subtitle: string
  series: { label: string; poValue: number; deliveredCount: number }[]
}) {
  const maxDeliveredValue = Math.max(...series.map(item => item.deliveredValue), 1)
  const maxSJ = Math.max(...series.map(item => item.sjCount), 1)
  const [hovered, setHovered] = useState<string | null>(null)

  const linePoints = series.map((item, index) => {
    const x = series.length === 1 ? 0 : (index / (series.length - 1)) * 100
    const y = 100 - (item.sjCount / maxSJ) * 100
    return `${x},${y}`
  }).join(' ')

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
        </div>
        <div className="flex gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-blue-600" />Nilai item terkirim</span>
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" />Nomor SJ</span>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(32px,1fr))] items-end gap-2">
        {series.map(item => (
          <div
            key={item.key}
            className="relative flex flex-col items-center gap-2"
            onMouseEnter={() => setHovered(item.key)}
            onMouseLeave={() => setHovered(null)}
          >
            {hovered === item.key && (
              <Tooltip
                title={item.label}
                lines={[
                  { label: 'Nilai terkirim', value: formatCurrency(item.deliveredValue), color: '#2563eb' },
                  { label: 'Nomor SJ', value: String(item.sjCount), color: '#f59e0b' },
                ]}
              />
            )}
            <div className="h-36 w-full rounded-t-md bg-blue-600/85" style={{ height: `${Math.max((item.deliveredValue / maxDeliveredValue) * 144, 8)}px` }} />
            <p className="text-[11px] text-gray-500">{item.label}</p>
          </div>
        ))}
      </div>
      <div className="-mt-44 h-40">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible">
          <polyline
            fill="none"
            stroke="#f59e0b"
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
            points={linePoints}
          />
        </svg>
      </div>
    </div>
  )
}

function DataTableCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
      </div>
      {children}
    </div>
  )
}

export default function AthelDashboard() {
  const [startDate, setStartDate] = useState(getFirstDayOfMonth(-2))
  const [endDate, setEndDate] = useState(getToday())
  const [status, setStatus] = useState<FilterStatus>('all')
  const [fulfillment, setFulfillment] = useState<FulfillmentFilter>('all')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['athel_dashboard', startDate, endDate, status, fulfillment],
    queryFn: () => fetchDashboardData(startDate, endDate, status, fulfillment),
  })

  return (
    <div className="min-h-screen bg-[#f4f7fb]">
      <AthelNav />

      <div className="border-b border-gray-200 bg-gradient-to-r from-slate-100 via-white to-blue-50 px-4 py-6 md:px-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-gray-900">Dashboard</h1>
            <p className="mt-1 text-sm text-gray-500">Pantau performa PO, pengiriman, customer utama, dan item outstanding.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="rounded-xl border border-blue-200 bg-white px-4 py-3 shadow-sm">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">Tanggal awal</span>
              <input
                type="date"
                value={startDate}
                max={endDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full bg-transparent text-sm text-gray-700 outline-none"
              />
            </label>
            <label className="rounded-xl border border-blue-200 bg-white px-4 py-3 shadow-sm">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">Tanggal akhir</span>
              <input
                type="date"
                value={endDate}
                min={startDate}
                max={getToday()}
                onChange={e => setEndDate(e.target.value)}
                className="w-full bg-transparent text-sm text-gray-700 outline-none"
              />
            </label>
            <label className="rounded-xl border border-blue-200 bg-white px-4 py-3 shadow-sm">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">Status PO</span>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as FilterStatus)}
                className="w-full bg-transparent text-sm text-gray-700 outline-none"
              >
                <option value="all">Semua status</option>
                <option value="confirm">Confirm</option>
                <option value="in_progress">In Progress</option>
                <option value="complete">Complete</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <label className="rounded-xl border border-blue-200 bg-white px-4 py-3 shadow-sm">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">Fulfillment</span>
              <select
                value={fulfillment}
                onChange={e => setFulfillment(e.target.value as FulfillmentFilter)}
                className="w-full bg-transparent text-sm text-gray-700 outline-none"
              >
                <option value="all">Semua</option>
                <option value="undelivered">Belum terkirim</option>
                <option value="partial">Terkirim sebagian</option>
                <option value="complete">Terkirim penuh</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      <div className="px-4 py-6 md:px-8">
        {isLoading && (
          <div className="rounded-2xl border border-gray-200 bg-white px-6 py-20 text-center text-sm text-gray-400 shadow-sm">
            Memuat dashboard Athel...
          </div>
        )}

        {isError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-20 text-center text-sm text-red-500 shadow-sm">
            Gagal memuat dashboard. Periksa koneksi atau struktur data Supabase.
          </div>
        )}

        {!isLoading && !isError && data && (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Total PO"
                value={formatCurrency(data.metrics.totalPOValue)}
                helper={`${data.metrics.totalPOCount} PO dalam periode ini`}
              />
              <StatCard
                label="Nilai Terkirim"
                value={formatCurrency(data.metrics.deliveredValue)}
                helper={`${data.metrics.totalPOValue > 0 ? formatPercent((data.metrics.deliveredValue / data.metrics.totalPOValue) * 100) : '0%'} dari total nilai PO`}
              />
              <StatCard
                label="Outstanding Value"
                value={formatCurrency(data.metrics.outstandingValue)}
                helper="Nilai item yang masih belum terpenuhi"
              />
              <StatCard
                label="Rata-rata Nilai PO"
                value={formatCurrency(Math.round(data.metrics.averagePOValue))}
                helper={`${data.metrics.completedPOCount} PO selesai pada filter ini`}
              />
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.1fr_1.3fr]">
              <DonutCard
                title="Proporsi Customer Berdasarkan Total PO"
                items={data.customerShare}
                centerLabel="Total PO"
              />
              <BarChartCard
                title="PO vs Pengiriman Bulanan"
                subtitle="Rolling 12 bulan dengan bulan berjalan di sisi paling kanan."
                series={data.monthlySeries}
              />
            </div>

            <div className="grid gap-6 xl:grid-cols-[1fr_1.35fr]">
              <DonutCard
                title="Komposisi Status PO"
                items={data.statusBreakdown}
                centerLabel="Jumlah PO"
                centerValue={String(data.metrics.totalPOCount)}
              />
              <TrendCard
                title="Tren Pengiriman Harian"
                subtitle="Batang menunjukkan total delivered items value, garis menunjukkan jumlah distinct Nomor SJ per hari."
                series={data.dailySeries}
              />
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <DataTableCard
                title="Top Customer"
                subtitle="Customer dengan kontribusi nilai PO terbesar pada filter ini."
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                        <th className="px-4 py-3">#</th>
                        <th className="px-4 py-3">Customer</th>
                        <th className="px-4 py-3 text-right">Total PO</th>
                        <th className="px-4 py-3 text-right">Terkirim</th>
                        <th className="px-4 py-3 text-right">% Fulfillment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topCustomers.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">Belum ada customer pada filter ini.</td>
                        </tr>
                      )}
                      {data.topCustomers.map(item => (
                        <tr key={item.rank} className="border-b border-gray-50">
                          <td className="px-4 py-3 text-gray-500">{item.rank}</td>
                          <td className="px-4 py-3 font-medium text-gray-900">{item.name}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{formatCompactCurrency(item.poValue)}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{formatCompactCurrency(item.deliveredValue)}</td>
                          <td className="px-4 py-3 text-right">
                            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                              {formatPercent(item.fulfillmentRate)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </DataTableCard>

              <DataTableCard
                title="Outstanding Item Breakdown"
                subtitle="Item dengan nilai outstanding terbesar dari PO pada periode ini."
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                        <th className="px-4 py-3">#</th>
                        <th className="px-4 py-3">SKU</th>
                        <th className="px-4 py-3">Nama Barang</th>
                        <th className="px-4 py-3 text-right">Outstanding</th>
                        <th className="px-4 py-3 text-right">Nilai</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.outstandingItems.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">Tidak ada outstanding item pada filter ini.</td>
                        </tr>
                      )}
                      {data.outstandingItems.map(item => (
                        <tr key={`${item.sku}-${item.rank}`} className="border-b border-gray-50">
                          <td className="px-4 py-3 text-gray-500">{item.rank}</td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-500">{item.sku}</td>
                          <td className="px-4 py-3 font-medium text-gray-900">{item.productName}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{item.outstandingQty.toLocaleString('id-ID')}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{formatCompactCurrency(item.outstandingValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </DataTableCard>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
