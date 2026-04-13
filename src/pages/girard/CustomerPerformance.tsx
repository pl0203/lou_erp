import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

type MonthOption = { value: string; label: string }

type CustomerRow = {
  id: string
  name: string
  manager_name: string | null
  actual_visits: number
  target_visits: number
  last_visit_date: string | null
  order_count: number
  total_sales: number
  sales_target: number | null
}

function getMonthRange(yearMonth: string): { from: string; to: string } {
  const [year, month] = yearMonth.split('-').map(Number)
  const from = new Date(year, month - 1, 1)
  const to = new Date(year, month, 0)
  return {
    from: from.toISOString().split('T')[0],
    to: to.toISOString().split('T')[0],
  }
}

function calcTargetVisits(frequencyDays: number, daysInMonth: number): number {
  return Math.ceil(daysInMonth / frequencyDays)
}

function getDaysInMonth(yearMonth: string): number {
  const [year, month] = yearMonth.split('-').map(Number)
  return new Date(year, month, 0).getDate()
}

function currentYearMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

async function fetchEarliestMonth(): Promise<string> {
  const { data } = await supabase
    .from('purchase_orders')
    .select('order_date')
    .order('order_date', { ascending: true })
    .limit(1)
  if (!data || data.length === 0) return currentYearMonth()
  const d = new Date(data[0].order_date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function buildMonthOptions(earliest: string): MonthOption[] {
  const options: MonthOption[] = []
  const current = currentYearMonth()
  let cursor = current
  while (cursor >= earliest) {
    const [year, month] = cursor.split('-').map(Number)
    const label = new Date(year, month - 1, 1).toLocaleDateString('id-ID', {
      month: 'long', year: 'numeric'
    })
    options.push({ value: cursor, label })
    const prev = new Date(year, month - 2, 1)
    cursor = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`
  }
  return options
}

async function fetchCustomerTargets(
  customerIds: string[],
  yearMonth: string
): Promise<Record<string, number>> {
  if (customerIds.length === 0) return {}
  const { data } = await supabase
    .from('customer_targets')
    .select('customer_id, year_month, target_value')
    .in('customer_id', customerIds)
    .lte('year_month', yearMonth)
    .order('year_month', { ascending: false })
  const result: Record<string, number> = {}
  for (const customerId of customerIds) {
    const records = (data ?? []).filter(r => r.customer_id === customerId)
    if (records.length === 0) continue
    result[customerId] = records[0].target_value
  }
  return result
}

async function upsertCustomerTarget(
  customerId: string,
  yearMonth: string,
  targetValue: number,
  setBy: string
) {
  const { error } = await supabase
    .from('customer_targets')
    .upsert({
      customer_id: customerId,
      year_month: yearMonth,
      target_value: targetValue,
      set_by: setBy,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'customer_id,year_month' })
  if (error) throw error
}

async function fetchCustomerPerformance(
  managerId: string,
  role: string,
  yearMonth: string
): Promise<CustomerRow[]> {
  const { from, to } = getMonthRange(yearMonth)
  const days = getDaysInMonth(yearMonth)

  let customerIds: string[] = []
  const managerMap: Record<string, string> = {}

  if (role === 'sales_manager') {
    const { data: assignments } = await supabase
      .from('customer_manager_assignments')
      .select('customer_id')
      .eq('manager_id', managerId)
    customerIds = (assignments ?? []).map(a => a.customer_id)
  } else {
    const { data: allCustomers } = await supabase
      .from('customers')
      .select('id')
    customerIds = (allCustomers ?? []).map(c => c.id)
    const { data: assignments } = await supabase
      .from('customer_manager_assignments')
      .select('customer_id, users!customer_manager_assignments_manager_id_fkey(full_name)')
    for (const a of assignments ?? []) {
      managerMap[a.customer_id] = (a as any).users?.full_name ?? ''
    }
  }

  if (customerIds.length === 0) return []

  const { data: customers } = await supabase
    .from('customers')
    .select('id, name, visit_frequency_days')
    .in('id', customerIds)
    .order('name')

  const { data: visits } = await supabase
    .from('outlet_visits')
    .select('outlet_id')
    .in('outlet_id', customerIds)
    .gte('checked_in_at', `${from}T00:00:00`)
    .lte('checked_in_at', `${to}T23:59:59`)

  const visitCounts: Record<string, number> = {}
  for (const v of visits ?? []) {
    visitCounts[v.outlet_id] = (visitCounts[v.outlet_id] ?? 0) + 1
  }

  const { data: pos } = await supabase
    .from('purchase_orders')
    .select('id, customer_id, status')
    .in('customer_id', customerIds)
    .gte('order_date', from)
    .lte('order_date', to)

  const poIds = (pos ?? [])
    .filter(po => ['in_progress', 'complete'].includes(po.status))
    .map(po => po.id)

  const sjSalesMap: Record<string, number> = {}
  if (poIds.length > 0) {
    const { data: sjs } = await supabase
      .from('surat_jalan')
      .select('purchase_order_id, sj_line_items(quantity_delivered, po_line_items(unit_price))')
      .in('purchase_order_id', poIds)
      .gte('sj_date', from)
      .lte('sj_date', to)
    for (const sj of sjs ?? []) {
      const po = (pos ?? []).find(p => p.id === sj.purchase_order_id)
      if (!po) continue
      for (const sli of (sj.sj_line_items as any[]) ?? []) {
        sjSalesMap[po.customer_id] = (sjSalesMap[po.customer_id] ?? 0) +
          (sli.quantity_delivered ?? 0) * (sli.po_line_items?.unit_price ?? 0)
      }
    }
  }

  const poLineMap: Record<string, number> = {}
  if (poIds.length > 0) {
    const { data: poli } = await supabase
      .from('po_line_items')
      .select('purchase_order_id, quantity, unit_price')
      .in('purchase_order_id', poIds)
    for (const li of poli ?? []) {
      const po = (pos ?? []).find(p => p.id === li.purchase_order_id)
      if (!po) continue
      poLineMap[po.customer_id] = (poLineMap[po.customer_id] ?? 0) + li.quantity * li.unit_price
    }
  }

  const orderCountMap: Record<string, number> = {}
  for (const po of pos ?? []) {
    orderCountMap[po.customer_id] = (orderCountMap[po.customer_id] ?? 0) + 1
  }

  const targetsMap = await fetchCustomerTargets(customerIds, yearMonth)

  return (customers ?? []).map(c => ({
    id: c.id,
    name: c.name,
    manager_name: managerMap[c.id] ?? null,
    actual_visits: visitCounts[c.id] ?? 0,
    target_visits: calcTargetVisits(c.visit_frequency_days, days),
    last_visit_date: null,
    order_count: orderCountMap[c.id] ?? 0,
    total_sales: sjSalesMap[c.id] ?? poLineMap[c.id] ?? 0,
    sales_target: targetsMap[c.id] ?? null,
  }))
}

async function fetchLastVisitDates(customerIds: string[]): Promise<Record<string, string>> {
  if (customerIds.length === 0) return {}
  const { data } = await supabase
    .from('outlet_visits')
    .select('outlet_id, checked_in_at')
    .in('outlet_id', customerIds)
    .order('checked_in_at', { ascending: false })
  const map: Record<string, string> = {}
  for (const v of data ?? []) {
    if (!map[v.outlet_id]) map[v.outlet_id] = v.checked_in_at
  }
  return map
}

function SalesPctBar({ actual, target }: { actual: number; target: number | null }) {
  if (target == null || target === 0) {
    return <span className="text-gray-300 text-xs">—</span>
  }
  const pct = Math.round((actual / target) * 100)
  return (
    <div className="flex flex-col items-end gap-1">
      <span className={`text-xs font-medium ${
        pct >= 100 ? 'text-green-600'
        : pct >= 70  ? 'text-yellow-600'
        : 'text-red-500'
      }`}>
        {pct}%
      </span>
      <div className="w-16 bg-gray-100 rounded-full h-1">
        <div
          className={`h-1 rounded-full ${
            pct >= 100 ? 'bg-green-500'
            : pct >= 70  ? 'bg-yellow-500'
            : 'bg-red-400'
          }`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  )
}

function InlineTargetEdit({
  customerId, yearMonth, currentTarget, canEdit, onSaved,
}: {
  customerId: string
  yearMonth: string
  currentTarget: number | null
  canEdit: boolean
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  const mutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Tidak terautentikasi')
      await upsertCustomerTarget(customerId, yearMonth, parseFloat(value) || 0, user.id)
    },
    onSuccess: () => { setEditing(false); onSaved() },
  })

  if (!canEdit) {
    return (
      <span className="text-gray-400 text-xs">
        {currentTarget != null ? `Rp ${(currentTarget / 1_000_000).toFixed(1)}M` : '—'}
      </span>
    )
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 justify-end">
        <input
          type="number"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') mutation.mutate()
            if (e.key === 'Escape') setEditing(false)
          }}
          placeholder="0"
          autoFocus
          className="w-24 border border-green-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-500 text-right"
        />
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="text-green-600 hover:text-green-800 text-xs font-medium"
        >
          {mutation.isPending ? '...' : '✓'}
        </button>
        <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-600 text-xs">
          ✕
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => { setValue(currentTarget?.toString() ?? ''); setEditing(true) }}
      className="text-right w-full group"
    >
      <span className="text-gray-400 text-xs group-hover:text-green-600 transition-colors">
        {currentTarget != null ? `Rp ${(currentTarget / 1_000_000).toFixed(1)}M` : '+ Set target'}
      </span>
    </button>
  )
}

export function CustomerPerformanceContent() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [yearMonth, setYearMonth] = useState(currentYearMonth())

  const canEditTargets = profile?.role === 'sales_head' || profile?.role === 'executive'

  const { data: earliestMonth } = useQuery({
    queryKey: ['earliest_month'],
    queryFn: fetchEarliestMonth,
  })

  const monthOptions = earliestMonth ? buildMonthOptions(earliestMonth) : []

  const { data: rows, isLoading } = useQuery({
    queryKey: ['customer_performance', profile?.id, profile?.role, yearMonth],
    queryFn: () => fetchCustomerPerformance(profile!.id, profile!.role, yearMonth),
    enabled: !!profile?.id,
  })

  const customerIds = rows?.map(r => r.id) ?? []

  const { data: lastVisits } = useQuery({
    queryKey: ['last_visits', customerIds],
    queryFn: () => fetchLastVisitDates(customerIds),
    enabled: customerIds.length > 0,
  })

  const data = rows?.map(r => ({
    ...r,
    last_visit_date: lastVisits?.[r.id] ?? null,
  })) ?? []

  const totalSales      = data.reduce((sum, r) => sum + r.total_sales, 0)
  const activePelanggan = data.filter(r => r.order_count > 0).length
  const totalVisits     = data.reduce((sum, r) => sum + r.actual_visits, 0)
  const totalTarget     = data.reduce((sum, r) => sum + r.target_visits, 0)
  const visitPct        = totalTarget > 0 ? Math.round((totalVisits / totalTarget) * 100) : 0
  const topCustomer     = [...data].sort((a, b) => b.total_sales - a.total_sales)[0]
  const selectedLabel   = monthOptions.find(m => m.value === yearMonth)?.label ?? yearMonth

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['customer_performance'] })

  const showManagerCol = profile?.role === 'sales_head' || profile?.role === 'executive'

  return (
    <div className="px-4 md:px-8 py-6 space-y-6">

      {/* Header with month picker */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Performa Pelanggan</h2>
          <p className="text-sm text-gray-500 mt-0.5">{selectedLabel}</p>
        </div>
        <select
          value={yearMonth}
          onChange={e => setYearMonth(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          {monthOptions.map(m => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 mb-1">Total Penjualan</p>
          <p className="text-xl font-bold text-gray-900">
            Rp {(totalSales / 1_000_000).toFixed(1)}M
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 mb-1">Pelanggan Aktif</p>
          <p className="text-xl font-bold text-gray-900">{activePelanggan}</p>
          <p className="text-xs text-gray-400 mt-1">dari {data.length} total</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 mb-1">Total Kunjungan</p>
          <p className="text-xl font-bold text-gray-900">{totalVisits}</p>
          <p className="text-xs text-gray-400 mt-1">target {totalTarget}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 mb-1">Pelanggan Teratas</p>
          <p className="text-sm font-bold text-gray-900 truncate">
            {topCustomer?.name ?? '—'}
          </p>
          {topCustomer && topCustomer.total_sales > 0 && (
            <p className="text-xs text-gray-400 mt-1">
              Rp {(topCustomer.total_sales / 1_000_000).toFixed(1)}M
            </p>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 mb-1">Kunjungan %</p>
          <p className={`text-xl font-bold ${
            visitPct >= 80 ? 'text-green-600'
            : visitPct >= 50 ? 'text-yellow-600'
            : 'text-red-500'
          }`}>
            {visitPct}%
          </p>
          <p className="text-xs text-gray-400 mt-1">{totalVisits}/{totalTarget} kunjungan</p>
        </div>
      </div>

      {isLoading && (
        <div className="text-center text-gray-400 text-sm py-12">Memuat data...</div>
      )}

      {!isLoading && data.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-400 text-sm">Tidak ada data untuk bulan ini.</p>
        </div>
      )}

      {!isLoading && data.length > 0 && (
        <>
          {canEditTargets && (
            <p className="text-xs text-gray-400">
              Klik pada kolom Target Penjualan untuk mengatur target per pelanggan.
            </p>
          )}

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Pelanggan</th>
                  {showManagerCol && (
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Manajer</th>
                  )}
                  <th className="text-center px-5 py-3 font-medium text-gray-500">Kunjungan (Aktual/Target)</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Kunjungan Terakhir</th>
                  <th className="text-center px-5 py-3 font-medium text-gray-500">Pesanan</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">Total Penjualan</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">
                    Target Penjualan
                    {canEditTargets && (
                      <span className="text-gray-300 ml-1 font-normal">(klik untuk ubah)</span>
                    )}
                  </th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">% Penjualan</th>
                </tr>
              </thead>
              <tbody>
                {data.map(r => {
                  const onTrack = r.actual_visits >= r.target_visits
                  return (
                    <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-5 py-4 font-medium text-gray-900">{r.name}</td>
                      {showManagerCol && (
                        <td className="px-5 py-4 text-gray-600 text-xs">{r.manager_name ?? '—'}</td>
                      )}
                      <td className="px-5 py-4 text-center">
                        <span className={`font-medium ${onTrack ? 'text-green-600' : 'text-red-500'}`}>
                          {r.actual_visits}
                        </span>
                        <span className="text-gray-400">/{r.target_visits}</span>
                      </td>
                      <td className="px-5 py-4 text-xs text-gray-600">
                        {r.last_visit_date
                          ? new Date(r.last_visit_date).toLocaleDateString('id-ID', {
                              day: 'numeric', month: 'short', year: 'numeric'
                            })
                          : 'Belum pernah'}
                      </td>
                      <td className="px-5 py-4 text-center text-gray-700">{r.order_count}</td>
                      <td className="px-5 py-4 text-right font-medium text-gray-900">
                        {r.total_sales > 0
                          ? `Rp ${(r.total_sales / 1_000_000).toFixed(1)}M`
                          : '—'}
                      </td>
                      <td className="px-5 py-4 text-right font-medium text-gray-900">
                        <InlineTargetEdit
                          customerId={r.id}
                          yearMonth={yearMonth}
                          currentTarget={r.sales_target}
                          canEdit={canEditTargets}
                          onSaved={invalidate}
                        />
                      </td>
                      <td className="px-5 py-4 text-right">
                        <SalesPctBar actual={r.total_sales} target={r.sales_target} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {data.map(r => {
              const onTrack = r.actual_visits >= r.target_visits
              return (
                <div key={r.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 text-sm truncate">{r.name}</p>
                      {r.manager_name && (
                        <p className="text-xs text-gray-400 mt-0.5">{r.manager_name}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                    <div>
                      <p className="text-gray-400">Kunjungan</p>
                      <p className="mt-0.5">
                        <span className={`font-semibold ${onTrack ? 'text-green-600' : 'text-red-500'}`}>
                          {r.actual_visits}
                        </span>
                        <span className="text-gray-400">/{r.target_visits}</span>
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400">Kunjungan Terakhir</p>
                      <p className="text-gray-700 mt-0.5">
                        {r.last_visit_date
                          ? new Date(r.last_visit_date).toLocaleDateString('id-ID', {
                              day: 'numeric', month: 'short'
                            })
                          : 'Belum pernah'}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400">Pesanan</p>
                      <p className="text-gray-700 mt-0.5">{r.order_count}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Total Penjualan</p>
                      <p className="font-semibold text-gray-900 mt-0.5">
                        {r.total_sales > 0
                          ? `Rp ${(r.total_sales / 1_000_000).toFixed(1)}M`
                          : '—'}
                      </p>
                    </div>
                  </div>

                  {/* Visit progress bar */}
                  <div className="pt-2 border-t border-gray-100">
                      <p className="text-xs text-gray-400 mb-1">Target Penjualan
                      <InlineTargetEdit
                        customerId={r.id}
                        yearMonth={yearMonth}
                        currentTarget={r.sales_target}
                        canEdit={canEditTargets}
                        onSaved={invalidate}
                      />
                      </p>
                    </div>
                  <div className="pt-2 border-t border-gray-100">
                    <p className="text-xs text-gray-400 mb-1">% Kunjungan</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full ${
                            onTrack ? 'bg-green-500' : 'bg-red-400'
                          }`}
                          style={{
                            width: `${Math.min(100, r.target_visits > 0
                              ? (r.actual_visits / r.target_visits) * 100
                              : 0)}%`
                          }}
                        />
                      </div>
                      <span className="text-xs text-gray-400">
                        {r.target_visits > 0
                          ? Math.round((r.actual_visits / r.target_visits) * 100)
                          : 0}%
                      </span>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-gray-100">
                    <p className="text-xs text-gray-400 mb-1">% Penjualan</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full ${
                            onTrack ? 'bg-green-500' : 'bg-red-400'
                          }`}
                          style={{
                            width: `${Math.min(100, r.sales_target > 0
                              ? (r.total_sales / r.sales_target) * 100
                              : 0)}%`
                          }}
                        />
                      </div>
                      <span className="text-xs text-gray-400">
                        {r.target_visits > 0
                          ? Math.round((r.total_sales / r.sales_target) * 100)
                          : 0}%
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}