import { SalesMetricsPanel } from '../../components/sales/SalesMetricSummary'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { usePagedRead } from '../../lib/reads/usePagedRead'
import { fetchCustomerPerformancePage } from '../../lib/reads/reports'
import { formatMoney, moneyPercentage } from '../../lib/reads/money'
import PaginationControls from '../../components/PaginationControls'
import { useAuth } from '../../lib/AuthContext'

function currentYearMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
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

export const fetchCustomerPerformance = fetchCustomerPerformancePage

function SalesPctBar({ actual, target }: { actual: string; target: string | null }) {
  if (target == null || /^0+(?:\.0+)?$/.test(target)) {
    return <span className="text-gray-300 text-xs">—</span>
  }
  const pctText = moneyPercentage(actual, target)
  const pct = Number(pctText)
  return (
    <div className="flex flex-col items-end gap-1">
      <span className={`text-xs font-medium ${
        pct >= 100 ? 'text-green-600'
        : pct >= 70  ? 'text-yellow-600'
        : 'text-red-500'
      }`}>
        {pctText}%
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
      await upsertCustomerTarget(customerId, yearMonth, parseFloat(value) || 0, user.id)
    },
    onSuccess: () => { setEditing(false); onSaved() },
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
      <span className="text-gray-400 text-xs group-hover:text-brand-primary transition-colors">
        {currentTarget != null ? `Rp ${formatMoney(currentTarget, 'millions')}M` : '+ Set target'}
      </span>
    </button>
  )
}

export function CustomerPerformanceContent() {
  return <div className="min-w-0"><div className="px-4 pt-6 md:px-8"><SalesMetricsPanel group="customer" /></div><CustomerActivityContent /></div>
}

export function CustomerActivityContent() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const { data: receivedPage, filters, setFilters, setPage, isPending, isError, refetch } = usePagedRead('customer_performance', { yearMonth: currentYearMonth() }, (filters, page, signal) => fetchCustomerPerformancePage(profile!.id, profile!.role, filters.yearMonth, page, signal))
  const pageData = isPending ? undefined : receivedPage
  const yearMonth = filters.yearMonth
  const setYearMonth = (yearMonth: string) => setFilters({ yearMonth })
  const isLoading = !pageData && isPending

  const canEditTargets = profile?.role === 'sales_head' || profile?.role === 'executive'

  const data = pageData?.items ?? []

  if (isError) return <div role="alert" className="p-6 text-red-600">Data performa tidak tersedia. <button onClick={() => refetch()} className="underline">Coba lagi</button></div>

  const summary = pageData?.summary
  const totalSales = summary?.total_sales ?? '0'
  const activePelanggan = summary?.active_customers ?? 0
  const totalVisits = summary?.total_visits ?? 0
  const totalTarget = summary?.total_target_visits ?? 0
  const visitPct = summary?.visit_percent ?? 0
  const topCustomer = summary?.top_customer
  const selectedLabel   = yearMonth

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['customer_performance'] })

  const showManagerCol = profile?.role === 'sales_head' || profile?.role === 'executive'

  return (
    <div className="px-4 md:px-8 py-6 space-y-6">

      {/* Header with month picker */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Aktivitas dan Target Pelanggan</h2>
          <p className="text-sm text-gray-500 mt-0.5">{selectedLabel}</p>
        </div>
        <label className="text-sm text-gray-600">Bulan aktivitas pelanggan
          <input aria-label="Bulan aktivitas pelanggan" type="month" value={yearMonth} onChange={e => { if (/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/.test(e.target.value)) setYearMonth(e.target.value) }} className="ml-2 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        </label>
      </div>

      <p className="text-xs text-gray-500">Kunjungan, penanggung jawab toko saat ini, dan target tetap memakai kohort aktivitas pelanggan yang ada. Pembanding target memakai nilai pengiriman PO dengan status in progress atau complete berdasarkan tanggal SJ; basis ini terpisah dari metrik Sales di atas. Filter Sales tidak mengubah bulan atau kohort aktivitas ini.</p>

      {pageData && <PaginationControls page={pageData.page} total={pageData.total} pageSize={pageData.page_size} pending={isPending} onPageChange={setPage} />}

      {/* Top metrics */}
      {pageData && (      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 mb-1">Nilai pembanding target</p>
          <p className="text-xl font-bold text-gray-900">
            Rp {formatMoney(totalSales, 'millions')}M
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 mb-1">Pelanggan Aktif</p>
          <p className="text-xl font-bold text-gray-900">{activePelanggan}</p>
          <p className="text-xs text-gray-400 mt-1">dari {summary?.total_customers} total</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 mb-1">Total Kunjungan</p>
          <p className="text-xl font-bold text-gray-900">{totalVisits}</p>
          <p className="text-xs text-gray-400 mt-1">target {totalTarget}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 mb-1">Teratas pada basis aktivitas</p>
          <p className="text-sm font-bold text-gray-900 truncate">
            {topCustomer?.name ?? '—'}
          </p>
          {topCustomer && !/^0+(?:\.0+)?$/.test(topCustomer.total_sales) && (
            <p className="text-xs text-gray-400 mt-1">
              Rp {formatMoney(topCustomer.total_sales, 'millions')}M
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
      )}

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
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Penanggung Jawab Toko</th>
                  )}
                  <th className="text-center px-5 py-3 font-medium text-gray-500">Kunjungan (Aktual/Target)</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Kunjungan Terakhir</th>
                  <th className="text-center px-5 py-3 font-medium text-gray-500">Pesanan</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">Nilai pembanding target</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">
                    Target Penjualan
                    {canEditTargets && (
                      <span className="text-gray-300 ml-1 font-normal">(klik untuk ubah)</span>
                    )}
                  </th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">% Pembanding target</th>
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
                        {!/^0+(?:\.0+)?$/.test(r.total_sales)
                          ? `Rp ${formatMoney(r.total_sales, 'millions')}M`
                          : '—'}
                      </td>
                      <td className="px-5 py-4 text-right font-medium text-gray-900">
                        <InlineTargetEdit key={`${r.id}:${yearMonth}`}
                          customerId={r.id}
                          yearMonth={yearMonth}
                          currentTarget={r.sales_target}
                          canEdit={canEditTargets && !isPending}
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
                      <p className="text-gray-400">Nilai pembanding target</p>
                      <p className="font-semibold text-gray-900 mt-0.5">
                        {!/^0+(?:\.0+)?$/.test(r.total_sales)
                          ? `Rp ${formatMoney(r.total_sales, 'millions')}M`
                          : '—'}
                      </p>
                    </div>
                  </div>

                  {/* Visit progress bar */}
                  <div className="pt-2 border-t border-gray-100">
                      <p className="text-xs text-gray-400 mb-1">Target Penjualan
                      <InlineTargetEdit key={`${r.id}:${yearMonth}`}
                        customerId={r.id}
                        yearMonth={yearMonth}
                        currentTarget={r.sales_target}
                        canEdit={canEditTargets && !isPending}
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
                    <p className="text-xs text-gray-400 mb-1">% Pembanding target</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full ${
                            onTrack ? 'bg-green-500' : 'bg-red-400'
                          }`}
                          style={{
                            width: `${Math.min(100, Number(moneyPercentage(r.total_sales, r.sales_target ?? '0')))}%`
                          }}
                        />
                      </div>
                      <span className="text-xs text-gray-400">
                        {moneyPercentage(r.total_sales, r.sales_target ?? '0')}%
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