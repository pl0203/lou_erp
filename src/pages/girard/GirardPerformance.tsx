import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import GirardNav from '../../components/GirardNav'

type PerformanceData = {
  id: string
  full_name: string
  scheduled: number
  visited: number
  missed: number
  orders: number
  total_sales: number
  visit_rate: number
  sales_target: number | null
}

function getMonthRange(yearMonth: string): { from: string; to: string } {
  const [year, month] = yearMonth.split('-').map(Number)
  const from = new Date(year, month - 1, 1)
  const to   = new Date(year, month, 0)
  return {
    from: from.toISOString().split('T')[0],
    to:   to.toISOString().split('T')[0],
  }
}

function currentYearMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

async function fetchEarliestScheduleMonth(): Promise<string> {
  const { data } = await supabase
    .from('sales_schedules')
    .select('scheduled_date')
    .order('scheduled_date', { ascending: true })
    .limit(1)
  if (!data || data.length === 0) return currentYearMonth()
  const d = new Date(data[0].scheduled_date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function buildMonthOptions(earliest: string): { value: string; label: string }[] {
  const options = []
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

async function fetchSalesTargets(
  userIds: string[],
  yearMonth: string
): Promise<Record<string, number>> {
  if (userIds.length === 0) return {}
  const { data } = await supabase
    .from('sales_targets')
    .select('user_id, year_month, target_value')
    .in('user_id', userIds)
    .lte('year_month', yearMonth)
    .order('year_month', { ascending: false })
  const result: Record<string, number> = {}
  for (const userId of userIds) {
    const records = (data ?? []).filter(r => r.user_id === userId)
    if (records.length === 0) continue
    result[userId] = records[0].target_value
  }
  return result
}

async function upsertSalesTarget(
  userId: string,
  yearMonth: string,
  targetValue: number,
  setBy: string
) {
  const { error } = await supabase
    .from('sales_targets')
    .upsert({
      user_id: userId,
      year_month: yearMonth,
      target_value: targetValue,
      set_by: setBy,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,year_month' })
  if (error) throw error
}

async function fetchPerformance(
  managerId: string,
  role: string,
  yearMonth: string
): Promise<PerformanceData[]> {
  const { from, to } = getMonthRange(yearMonth)

  let teamQuery = supabase
    .from('users')
    .select('id, full_name')
    .in('role', ['sales_person', 'sales_manager', 'sales_head', 'executive'])
    .eq('is_active', true)
    .order('full_name')

  if (role === 'sales_manager') {
    const { data: teamIds } = await supabase
      .from('users')
      .select('id')
      .eq('manager_id', managerId)
      .eq('is_active', true)
    const ids = [...(teamIds ?? []).map(t => t.id), managerId]
    teamQuery = teamQuery.in('id', ids)
  }

  const { data: team, error: teamError } = await teamQuery
  if (teamError) throw teamError
  if (!team || team.length === 0) return []

  const teamIds = team.map(t => t.id)

  const { data: schedules, error: schedError } = await supabase
    .from('sales_schedules')
    .select('id, sales_person_id, status, outlet_visits(id)')
    .in('sales_person_id', teamIds)
    .gte('scheduled_date', from)
    .lte('scheduled_date', to)
  if (schedError) throw schedError

  const { data: orders, error: ordError } = await supabase
    .from('girard_orders')
    .select('id, submitted_by, total_value')
    .in('submitted_by', teamIds)
    .gte('created_at', `${from}T00:00:00`)
    .lte('created_at', `${to}T23:59:59`)
  if (ordError) throw ordError

  const targetsMap = await fetchSalesTargets(teamIds, yearMonth)

  return team.map(member => {
    const mySchedules = (schedules ?? []).filter(s => s.sales_person_id === member.id)
    const myVisited = mySchedules.filter(s => (s.outlet_visits as any[]).length > 0)
    const myMissed = mySchedules.filter(s =>
      (s.outlet_visits as any[]).length === 0 && s.status === 'missed'
    )
    const myOrders = (orders ?? []).filter(o => o.submitted_by === member.id)
    const totalSales = myOrders.reduce((sum, o) => sum + (o.total_value ?? 0), 0)
    const visitRate = mySchedules.length > 0
      ? Math.round((myVisited.length / mySchedules.length) * 100)
      : 0

    return {
      id: member.id,
      full_name: member.full_name,
      scheduled: mySchedules.length,
      visited: myVisited.length,
      missed: myMissed.length,
      orders: myOrders.length,
      total_sales: totalSales,
      visit_rate: visitRate,
      sales_target: targetsMap[member.id] ?? null,
    }
  })
}

function InlineSalesTargetEdit({
  userId,
  yearMonth,
  currentTarget,
  canEdit,
  onSaved,
}: {
  userId: string
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
      await upsertSalesTarget(userId, yearMonth, parseFloat(value) || 0, user.id)
    },
    onSuccess: () => {
      setEditing(false)
      onSaved()
    },
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
        <button
          onClick={() => setEditing(false)}
          className="text-gray-400 hover:text-gray-600 text-xs"
        >
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

function PerformanceTable({
  performance, yearMonth, canEdit, onSaved,
}: {
  performance: PerformanceData[]
  yearMonth: string
  canEdit: boolean
  onSaved: () => void
}) {
  return (
    <>
      <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-medium text-gray-900">Per Sales</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-5 py-3 font-medium text-gray-500">Nama</th>
              <th className="text-center px-5 py-3 font-medium text-gray-500">Dijadwalkan</th>
              <th className="text-center px-5 py-3 font-medium text-gray-500">Dikunjungi</th>
              <th className="text-center px-5 py-3 font-medium text-gray-500">Tingkat Kunjungan</th>
              <th className="text-center px-5 py-3 font-medium text-gray-500">Pesanan</th>
              <th className="text-right px-5 py-3 font-medium text-gray-500">Penjualan</th>
              <th className="text-right px-5 py-3 font-medium text-gray-500">
                Target
                {canEdit && <span className="text-gray-300 ml-1 font-normal">(klik untuk ubah)</span>}
              </th>
            </tr>
          </thead>
          <tbody>
            {performance.map(p => (
              <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-green-100 text-green-700 text-xs font-semibold flex items-center justify-center shrink-0">
                      {p.full_name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                    </div>
                    <span className="font-medium text-gray-900">{p.full_name}</span>
                  </div>
                </td>
                <td className="px-5 py-4 text-center text-gray-700">{p.scheduled}</td>
                <td className="px-5 py-4 text-center text-gray-700">{p.visited}</td>
                <td className="px-5 py-4 text-center">
                  <div className="flex flex-col items-center gap-1">
                    <span className={`font-medium text-sm ${
                      p.visit_rate >= 80 ? 'text-green-600'
                      : p.visit_rate >= 50 ? 'text-yellow-600'
                      : 'text-red-500'
                    }`}>
                      {p.visit_rate}%
                    </span>
                    <div className="w-16 bg-gray-100 rounded-full h-1">
                      <div
                        className={`h-1 rounded-full ${
                          p.visit_rate >= 80 ? 'bg-green-500'
                          : p.visit_rate >= 50 ? 'bg-yellow-500'
                          : 'bg-red-400'
                        }`}
                        style={{ width: `${p.visit_rate}%` }}
                      />
                    </div>
                  </div>
                </td>
                <td className="px-5 py-4 text-center text-gray-700">{p.orders}</td>
                <td className="px-5 py-4 text-right font-medium text-gray-900">
                  Rp {(p.total_sales / 1_000_000).toFixed(1)}M
                </td>
                <td className="px-5 py-4 text-right">
                  <InlineSalesTargetEdit
                    userId={p.id}
                    yearMonth={yearMonth}
                    currentTarget={p.sales_target}
                    canEdit={canEdit}
                    onSaved={onSaved}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-3">
        {performance.map(p => (
          <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-green-100 text-green-700 text-sm font-semibold flex items-center justify-center shrink-0">
                {p.full_name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900">{p.full_name}</p>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full ${
                        p.visit_rate >= 80 ? 'bg-green-500'
                        : p.visit_rate >= 50 ? 'bg-yellow-500'
                        : 'bg-red-400'
                      }`}
                      style={{ width: `${p.visit_rate}%` }}
                    />
                  </div>
                  <span className={`text-xs font-medium ${
                    p.visit_rate >= 80 ? 'text-green-600'
                    : p.visit_rate >= 50 ? 'text-yellow-600'
                    : 'text-red-500'
                  }`}>
                    {p.visit_rate}%
                  </span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-400 mb-1">Kunjungan</p>
                <p className="font-semibold text-gray-900">{p.visited}/{p.scheduled}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-400 mb-1">Pesanan</p>
                <p className="font-semibold text-gray-900">{p.orders}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-400 mb-1">Total Penjualan</p>
                <p className="font-semibold text-gray-900">
                  Rp {(p.total_sales / 1_000_000).toFixed(1)}M
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-400 mb-1">Target</p>
                <InlineSalesTargetEdit
                  userId={p.id}
                  yearMonth={yearMonth}
                  currentTarget={p.sales_target}
                  canEdit={canEdit}
                  onSaved={onSaved}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function SummaryCards({
  avgVisitRate, totalVisited, totalScheduled, totalOrders, totalSales
}: {
  avgVisitRate: number
  totalVisited: number
  totalScheduled: number
  totalOrders: number
  totalSales: number
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-xs text-gray-400 mb-1">Tingkat Kunjungan</p>
        <p className="text-2xl font-bold text-gray-900">{avgVisitRate}%</p>
        <p className="text-xs text-gray-400 mt-1">{totalVisited}/{totalScheduled} kunjungan</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-xs text-gray-400 mb-1">Total Kunjungan</p>
        <p className="text-2xl font-bold text-gray-900">{totalVisited}</p>
        <p className="text-xs text-gray-400 mt-1">dari {totalScheduled} dijadwalkan</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-xs text-gray-400 mb-1">Pesanan Dibuat</p>
        <p className="text-2xl font-bold text-gray-900">{totalOrders}</p>
        <p className="text-xs text-gray-400 mt-1">dari tim sales lapangan</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-xs text-gray-400 mb-1">Total Penjualan</p>
        <p className="text-2xl font-bold text-gray-900">
          Rp {(totalSales / 1_000_000).toFixed(1)}M
        </p>
        <p className="text-xs text-gray-400 mt-1">dari tim sales lapangan</p>
      </div>
    </div>
  )
}

export default function GirardPerformance() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [yearMonth, setYearMonth] = useState(currentYearMonth())

  const canEdit = profile?.role === 'sales_head' ||
                  profile?.role === 'executive' ||
                  profile?.role === 'sales_manager'

  const { data: earliest } = useQuery({
    queryKey: ['earliest_schedule_month'],
    queryFn: fetchEarliestScheduleMonth,
  })

  const monthOptions = earliest ? buildMonthOptions(earliest) : []

  const { data: performance, isLoading } = useQuery({
    queryKey: ['performance', profile?.id, profile?.role, yearMonth],
    queryFn: () => fetchPerformance(profile!.id, profile!.role, yearMonth),
    enabled: !!profile?.id,
  })

  const totalVisited   = performance?.reduce((sum, p) => sum + p.visited, 0) ?? 0
  const totalScheduled = performance?.reduce((sum, p) => sum + p.scheduled, 0) ?? 0
  const totalOrders    = performance?.reduce((sum, p) => sum + p.orders, 0) ?? 0
  const totalSales     = performance?.reduce((sum, p) => sum + p.total_sales, 0) ?? 0
  const avgVisitRate   = performance?.length
    ? Math.round(performance.reduce((sum, p) => sum + p.visit_rate, 0) / performance.length)
    : 0

  const selectedLabel = monthOptions.find(m => m.value === yearMonth)?.label ?? yearMonth

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['performance'] })

  return (
    <div className="min-h-screen bg-gray-50">
      <GirardNav />

      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Performa Tim Sales</h1>
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

      <div className="px-4 md:px-8 py-6 space-y-6">
        <SummaryCards
          avgVisitRate={avgVisitRate}
          totalVisited={totalVisited}
          totalScheduled={totalScheduled}
          totalOrders={totalOrders}
          totalSales={totalSales}
        />
        {isLoading && (
          <div className="text-center text-gray-400 text-sm py-12">Memuat data performa...</div>
        )}
        {!isLoading && (!performance || performance.length === 0) && (
          <div className="text-center py-12">
            <p className="text-gray-400 text-sm">Tidak ada data performa untuk bulan ini.</p>
          </div>
        )}
        {!isLoading && performance && performance.length > 0 && (
          <PerformanceTable
            performance={performance}
            yearMonth={yearMonth}
            canEdit={canEdit}
            onSaved={invalidate}
          />
        )}
      </div>
    </div>
  )
}

// ─── Named export for Dashboard ───────────────────────────────────────────────
export function PerformanceContent() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [yearMonth, setYearMonth] = useState(currentYearMonth())

  const canEdit = profile?.role === 'sales_head' ||
                  profile?.role === 'executive' ||
                  profile?.role === 'sales_manager'

  const { data: earliest } = useQuery({
    queryKey: ['earliest_schedule_month'],
    queryFn: fetchEarliestScheduleMonth,
  })

  const monthOptions = earliest ? buildMonthOptions(earliest) : []

  const { data: performance, isLoading } = useQuery({
    queryKey: ['performance', profile?.id, profile?.role, yearMonth],
    queryFn: () => fetchPerformance(profile!.id, profile!.role, yearMonth),
    enabled: !!profile?.id,
  })

  const totalVisited   = performance?.reduce((sum, p) => sum + p.visited, 0) ?? 0
  const totalScheduled = performance?.reduce((sum, p) => sum + p.scheduled, 0) ?? 0
  const totalOrders    = performance?.reduce((sum, p) => sum + p.orders, 0) ?? 0
  const totalSales     = performance?.reduce((sum, p) => sum + p.total_sales, 0) ?? 0
  const avgVisitRate   = performance?.length
    ? Math.round(performance.reduce((sum, p) => sum + p.visit_rate, 0) / performance.length)
    : 0

  const selectedLabel = monthOptions.find(m => m.value === yearMonth)?.label ?? yearMonth

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['performance'] })

  return (
    <div className="px-4 md:px-8 py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Performa Tim Sales</h2>
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

      <SummaryCards
        avgVisitRate={avgVisitRate}
        totalVisited={totalVisited}
        totalScheduled={totalScheduled}
        totalOrders={totalOrders}
        totalSales={totalSales}
      />

      {isLoading && (
        <div className="text-center text-gray-400 text-sm py-12">Memuat data performa...</div>
      )}
      {!isLoading && (!performance || performance.length === 0) && (
        <div className="text-center py-12">
          <p className="text-gray-400 text-sm">Tidak ada data performa untuk bulan ini.</p>
        </div>
      )}
      {!isLoading && performance && performance.length > 0 && (
        <PerformanceTable
          performance={performance}
          yearMonth={yearMonth}
          canEdit={canEdit}
          onSaved={invalidate}
        />
      )}
    </div>
  )
}