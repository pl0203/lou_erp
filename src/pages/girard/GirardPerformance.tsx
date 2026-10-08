import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { usePagedRead } from '../../lib/reads/usePagedRead'
import { fetchSalesPerformancePage } from '../../lib/reads/reports'
import type { SalesPerformanceRow } from '../../lib/reads/contracts'
import { formatMoney } from '../../lib/reads/money'
import PaginationControls from '../../components/PaginationControls'
import { useAuth } from '../../lib/AuthContext'
import GirardNav from '../../components/GirardNav'

type PerformanceData = SalesPerformanceRow

function currentYearMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

async function fetchEarliestScheduleMonth(): Promise<string> {
  const { data, error } = await supabase
    .from('sales_schedules')
    .select('scheduled_date')
    .order('scheduled_date', { ascending: true }).order('id')
    .limit(1)
  if (error) throw error
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

function InlineSalesTargetEdit({
  userId,
  yearMonth,
  currentTarget,
  canEdit,
  onSaved,
}: {
  userId: string
  yearMonth: string
  currentTarget: string | null
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
        {currentTarget != null ? `Rp ${formatMoney(currentTarget, 'millions')}M` : '—'}
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
          className="w-24 border border-green-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-brand-primary text-right"
        />
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="text-brand-primary hover:text-brand-hover text-xs font-medium"
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
      <span className="text-gray-400 text-xs group-hover:text-brand-primary transition-colors">
        {currentTarget != null ? `Rp ${formatMoney(currentTarget, 'millions')}M` : '+ Set target'}
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
                  Rp {formatMoney(p.total_sales, 'millions')}M
                </td>
                <td className="px-5 py-4 text-right">
                  <InlineSalesTargetEdit key={`${p.id}:${yearMonth}`}
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
                  Rp {formatMoney(p.total_sales, 'millions')}M
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-400 mb-1">Target</p>
                <InlineSalesTargetEdit key={`${p.id}:${yearMonth}`}
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
  totalSales: string
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
          Rp {formatMoney(totalSales, 'millions')}M
        </p>
        <p className="text-xs text-gray-400 mt-1">dari tim sales lapangan</p>
      </div>
    </div>
  )
}

export default function GirardPerformance() {
  return <div className="min-h-screen bg-brand-canvas"><GirardNav /><PerformanceContent /></div>
}

export function PerformanceContent() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const { data, filters, setFilters, setPage, isPending, isError, refetch } = usePagedRead('performance', { yearMonth: currentYearMonth() }, (filters, page, signal) => fetchSalesPerformancePage(profile!.id, profile!.role, filters.yearMonth, page, signal))
  const { data: earliest, isError: monthError, refetch: refetchMonths } = useQuery({ queryKey: ['earliest_schedule_month'], queryFn: fetchEarliestScheduleMonth })
  const monthOptions = buildMonthOptions(earliest ?? currentYearMonth())
  const yearMonth = filters.yearMonth
  const selectedLabel = monthOptions.find(month => month.value === yearMonth)?.label ?? yearMonth
  const canEdit = ['sales_head', 'executive', 'sales_manager'].includes(profile?.role ?? '')
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['performance'] })
  return <div className="px-4 md:px-8 py-6 space-y-6">
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div><h2 className="text-lg font-semibold text-gray-900">Performa Tim Sales</h2><p className="text-sm text-gray-500 mt-0.5">{selectedLabel}</p></div>
      <select aria-label="Bulan performa sales" value={yearMonth} onChange={event => setFilters({ yearMonth: event.target.value })} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary">
        {monthOptions.map(month => <option key={month.value} value={month.value}>{month.label}</option>)}
      </select>
    </div>
    {isError || monthError ? <div role="alert" className="text-red-600">{monthError ? 'Daftar bulan tidak tersedia.' : 'Data performa tidak tersedia.'} <button onClick={() => { refetch(); refetchMonths() }} className="underline">Coba lagi</button></div> : !data ? <p className="text-center text-gray-400 text-sm py-12">Memuat data performa...</p> : <>
      <PaginationControls page={data.page} total={data.total} pageSize={data.page_size} pending={isPending} onPageChange={setPage} />
      <SummaryCards avgVisitRate={data.summary.average_visit_rate} totalVisited={data.summary.total_visited} totalScheduled={data.summary.total_scheduled} totalOrders={data.summary.total_orders} totalSales={data.summary.total_sales} />
      {data.items.length === 0 ? <p className="text-center text-gray-400 text-sm py-12">Tidak ada data performa untuk bulan ini.</p> : <PerformanceTable performance={data.items} yearMonth={yearMonth} canEdit={canEdit && !isPending} onSaved={invalidate} />}
    </>}
  </div>
}
