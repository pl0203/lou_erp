import { LoadingState } from '../../components/ui/LoadingState'
import { useLayoutEffect, useRef } from 'react'
import { useCustomerTargetSave } from '../../lib/catalogue/useCustomerTargetSave'
import { Button } from '../../components/ui/Button'
import { useTargetDraftSession } from '../../components/sales/useTargetDraftSession'
import { InlineTargetEditor } from '../../components/sales/InlineTargetEditor'
import { salesMonthLabel } from '../../lib/reads/useSalesMetrics'
import { formatAuditTimestamp } from '../../lib/displayDate'
import { SalesMetricsPanel } from '../../components/sales/SalesMetricSummary'
import { useQueryClient } from '@tanstack/react-query'
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
  setBy: string,
  client = supabase
) {
  const { error } = await client
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
  if (target == null) return <span className="text-brand-secondary text-sm">Target belum ditetapkan</span>
  if (/^0+(?:\.0+)?$/.test(target)) return <span className="text-brand-secondary text-sm">Target nol · rasio tidak dihitung</span>
  const pctText = moneyPercentage(actual, target)
  const pct = Number(pctText)
  return (
    <div className="flex flex-col items-end gap-1">
      <span className={`text-sm font-medium ${
        pct >= 100 ? 'text-green-800'
        : pct >= 70  ? 'text-yellow-800'
        : 'text-red-700'
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

export function CustomerPerformanceContent() {
  return <div className="min-w-0"><div className="px-4 pt-6 md:px-8"><SalesMetricsPanel group="customer" /></div><CustomerActivityContent /></div>
}

export function CustomerActivityContent() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const { data: receivedPage, filters, page, setFilters, setPage, isPending, isError, refetch } = usePagedRead('customer_performance', { yearMonth: currentYearMonth() }, (filters, page, signal) => fetchCustomerPerformancePage(profile!.id, profile!.role, filters.yearMonth, page, signal))
  const pageData = isPending ? undefined : receivedPage
  const yearMonth = filters.yearMonth
  const setYearMonth = (yearMonth: string) => setFilters({ yearMonth })
  const isLoading = !pageData && isPending

  const readIdentity = `${profile?.id ?? ''}:${profile?.role ?? ''}`
  const editorScope = JSON.stringify([readIdentity, yearMonth, page])

  const canEditTargets = profile?.role === 'sales_head' || profile?.role === 'executive'

  const data = pageData?.items ?? []

  const invalidate = (refreshActive: boolean) => queryClient.invalidateQueries({
    queryKey: ['customer_performance', readIdentity, { yearMonth }],
    refetchType: refreshActive ? 'active' : 'none',
  })
  const targetSave = useCustomerTargetSave(async receipt => {
    if (!profile || receipt.actor_id !== profile.id) return false
    // A validated receipt proves the save. Fresh authorized reads refresh display,
    // never infer an outcome from a missing customer or a matching target value.
    await fetchCustomerPerformancePage(profile.id, profile.role, receipt.year_month, 1, new AbortController().signal)
    await queryClient.invalidateQueries({ queryKey: ['customer_performance', readIdentity, { yearMonth: receipt.year_month }], refetchType: 'active' }, { throwOnError: true })
    return true
  })
  const targetEditors = useTargetDraftSession({
    scope: editorScope, canEdit: canEditTargets, isPending, isError, records: pageData?.items, unresolved: targetSave.unresolved,
    write: async (customerId, targetValue) => {
      await targetSave.write({ customerId, yearMonth, targetValue }, async input => {
        const source = supabase
        const { data: { user } } = await source.auth.getUser()
        if (!user || user.id !== profile?.id || !targetSave.isCurrent()) throw new Error('Tidak terautentikasi')
        await upsertCustomerTarget(input.customerId, input.yearMonth, input.targetValue!, user.id, source)
      })
    },
    // A retired backend may complete an already-dispatched legacy write, but
    // cannot refetch the current backend through an unchanged actor/month key.
    onSaved: refreshActive => invalidate(refreshActive && targetSave.isCurrent()),
  })

  const recoveryFocus = useRef<HTMLDivElement>(null), contentFocus = useRef<HTMLDivElement>(null), previouslyUnresolved = useRef(false)
  useLayoutEffect(() => {
    if (targetSave.unresolved && !targetSave.busy && targetSave.available) recoveryFocus.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    else if (previouslyUnresolved.current && !targetSave.unresolved) contentFocus.current?.focus()
    previouslyUnresolved.current = targetSave.unresolved
  }, [targetSave.unresolved, targetSave.busy, targetSave.available])
  const recovery = targetSave.unresolved && !targetSave.busy && <div ref={recoveryFocus} role="status" className="rounded-lg border border-amber-300 p-4 text-sm">
    <p>Hasil target belum terkonfirmasi. Jangan kirim ulang; pemulihan tetap tersedia di halaman dan bulan lain.</p>
    {targetSave.message && <p>{targetSave.message}</p>}
    <Button variant="secondary" pending={targetSave.busy} disabled={!targetSave.available || targetSave.busy} onClick={() => {
      void targetSave.recover().then(result => {
        if (result.status === 'committed' && result.receipt.year_month === yearMonth) targetEditors.confirmRecovered(result.receipt.customer_id)
      }).catch(() => { /* The durable request and recovery message remain visible. */ })
    }}>Periksa hasil target</Button>
  </div>

  if (isError) return <>{recovery}<div role="alert" className="p-6 text-red-700">Data performa tidak tersedia. <Button size="compact" variant="secondary" onClick={() => refetch()}>Coba lagi</Button></div></>

  const summary = pageData?.summary
  const totalSales = summary?.total_sales ?? '0'
  const activePelanggan = summary?.active_customers ?? 0
  const totalVisits = summary?.total_visits ?? 0
  const totalTarget = summary?.total_target_visits ?? 0
  const visitPct = summary?.visit_percent ?? 0
  const topCustomer = summary?.top_customer
  const selectedLabel = salesMonthLabel(yearMonth)

  const showManagerCol = profile?.role === 'sales_head' || profile?.role === 'executive'

  return (
    <div ref={contentFocus} tabIndex={-1} className="px-4 md:px-8 py-6 space-y-6">
      {recovery}

      {/* Header with month picker */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Aktivitas dan Target Pelanggan</h2>
          <p className="text-sm text-brand-secondary mt-0.5">Periode aktivitas: {selectedLabel}</p>
        </div>
        <label className="ui-field__label text-brand-secondary">Bulan aktivitas pelanggan
          <input aria-label="Bulan aktivitas pelanggan" type="month" value={yearMonth} onChange={e => { if (/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/.test(e.target.value)) setYearMonth(e.target.value) }} className="ui-control ml-2 font-normal" />
        </label>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-brand-secondary">
        <p>Filter bulan aktivitas ini tidak mengubah Metrik Sales. Cakupan: pelanggan dan penanggung jawab toko saat ini sesuai izin akun; ringkasan mencakup semua halaman.</p>
        <p className="mt-1">Nilai pembanding target: pengiriman PO berstatus Dalam proses atau Selesai, berdasarkan tanggal SJ pada {selectedLabel}. Jumlah pesanan memakai tanggal PO. Kunjungan memakai waktu pencatatan, dengan batas bulan menurut zona waktu perangkat.</p>
      </div>

      {pageData && <PaginationControls page={pageData.page} total={pageData.total} pageSize={pageData.page_size} pending={isPending} onPageChange={setPage} />}

      {/* Top metrics */}
      {pageData && (      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-[13px] text-brand-secondary mb-1">Nilai pembanding target</p>
          <p className="text-xl font-bold text-gray-900 [overflow-wrap:anywhere]">
            Rp {formatMoney(totalSales, 'full')}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-[13px] text-brand-secondary mb-1">Pelanggan Aktif</p>
          <p className="text-xl font-bold text-gray-900 [overflow-wrap:anywhere]">{activePelanggan}</p>
          <p className="text-[13px] text-brand-secondary mt-1">dari {summary?.total_customers} total</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-[13px] text-brand-secondary mb-1">Total Kunjungan</p>
          <p className="text-xl font-bold text-gray-900 [overflow-wrap:anywhere]">{totalVisits}</p>
          <p className="text-[13px] text-brand-secondary mt-1">target {totalTarget}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-[13px] text-brand-secondary mb-1">Teratas pada basis aktivitas</p>
          <p className="text-base font-bold text-gray-900 [overflow-wrap:anywhere]">
            {topCustomer?.name ?? '—'}
          </p>
          {topCustomer && !/^0+(?:\.0+)?$/.test(topCustomer.total_sales) && (
            <p className="text-[13px] text-brand-secondary mt-1">
              Rp {formatMoney(topCustomer.total_sales, 'full')}
            </p>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-[13px] text-brand-secondary mb-1">Kunjungan %</p>
          <p className={`text-xl font-bold ${
            visitPct >= 80 ? 'text-green-700'
            : visitPct >= 50 ? 'text-yellow-800'
            : 'text-red-700'
          }`}>
            {visitPct}%
          </p>
          <p className="text-[13px] text-brand-secondary mt-1">{totalVisits}/{totalTarget} kunjungan</p>
        </div>
      </div>
      )}

      {isLoading && (
        <LoadingState title="Memuat data..." shape="dashboard" className="text-center text-brand-secondary text-sm py-12" />
      )}

      {!isLoading && data.length === 0 && (
        <div className="text-center py-12">
          <p className="text-brand-secondary text-sm">Tidak ada data untuk bulan ini.</p>
        </div>
      )}

      {!isLoading && data.length > 0 && (
        <>
          {canEditTargets && (
            <p className="text-[13px] text-brand-secondary">
              Klik pada kolom Target Penjualan untuk mengatur target per pelanggan.
            </p>
          )}

          {targetEditors.busy && <p id={targetEditors.descriptionId} className="text-sm text-brand-secondary">{targetEditors.description}</p>}

          {/* Desktop table */}
          <div className={`${targetEditors.layout === 'desktop' ? 'block' : targetEditors.layout === 'mobile' ? 'hidden' : 'hidden md:block'} bg-white rounded-xl border border-gray-200 overflow-hidden`}>
            <p className="px-5 py-2 text-[13px] text-brand-secondary">Geser tabel untuk melihat semua kolom.</p>
            <div role="region" aria-label="Tabel aktivitas pelanggan" tabIndex={0} className="max-w-full overflow-x-auto">
            <table className="w-full min-w-[72rem] text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-5 py-3 font-medium text-brand-secondary">Pelanggan</th>
                  {showManagerCol && (
                    <th className="text-left px-5 py-3 font-medium text-brand-secondary">Penanggung Jawab Toko</th>
                  )}
                  <th className="text-center px-5 py-3 font-medium text-brand-secondary">Kunjungan (Aktual/Target)</th>
                  <th className="text-left px-5 py-3 font-medium text-brand-secondary">Kunjungan Terakhir</th>
                  <th className="text-center px-5 py-3 font-medium text-brand-secondary">Pesanan</th>
                  <th className="text-right px-5 py-3 font-medium text-brand-secondary">Nilai pembanding target</th>
                  <th className="text-right px-5 py-3 font-medium text-brand-secondary">
                    Target Penjualan
                    {canEditTargets && (
                      <span className="text-brand-secondary ml-1 font-normal">(klik untuk ubah)</span>
                    )}
                  </th>
                  <th className="text-right px-5 py-3 font-medium text-brand-secondary">% Pembanding target</th>
                </tr>
              </thead>
              <tbody>
                {data.map(r => {
                  const onTrack = r.actual_visits >= r.target_visits
                  return (
                    <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="min-w-[14rem] px-5 py-4 font-medium text-gray-900">{r.name}</td>
                      {showManagerCol && (
                        <td className="px-5 py-4 text-brand-secondary">{r.manager_name ?? '—'}</td>
                      )}
                      <td className="px-5 py-4 text-center">
                        <span className={`font-medium ${onTrack ? 'text-green-800' : 'text-red-700'}`}>
                          {r.actual_visits}
                        </span>
                        <span className="text-brand-secondary">/{r.target_visits}</span>
                      </td>
                      <td className="px-5 py-4 text-brand-secondary">
                        {r.last_visit_date
                          ? formatAuditTimestamp(r.last_visit_date)
                          : 'Belum pernah'}
                      </td>
                      <td className="px-5 py-4 text-center text-gray-700">{r.order_count}</td>
                      <td className="px-5 py-4 text-right font-medium text-gray-900">
                        {`Rp ${formatMoney(r.total_sales, 'full')}`}
                      </td>
                      <td className="px-5 py-4 text-right font-medium text-gray-900">
                        <InlineTargetEditor key={`${editorScope}:${r.id}`}
                          recordId={r.id}
                          currentTarget={r.sales_target}
                          layout="desktop"
                          compact
                          canEdit={canEditTargets && !isPending}
                          targetEditors={targetEditors}
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
          </div>

          {/* Mobile cards */}
          <div className={`${targetEditors.layout === 'mobile' ? 'block' : targetEditors.layout === 'desktop' ? 'hidden' : 'md:hidden'} space-y-3`}>
            {data.map(r => {
              const onTrack = r.actual_visits >= r.target_visits
              return (
                <div key={r.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 text-base [overflow-wrap:anywhere]">{r.name}</p>
                      {r.manager_name && (
                        <p className="text-[13px] text-brand-secondary mt-0.5">{r.manager_name}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-base mb-3">
                    <div>
                      <p className="text-brand-secondary">Kunjungan</p>
                      <p className="mt-0.5">
                        <span className={`font-semibold ${onTrack ? 'text-green-800' : 'text-red-700'}`}>
                          {r.actual_visits}
                        </span>
                        <span className="text-brand-secondary">/{r.target_visits}</span>
                      </p>
                    </div>
                    <div>
                      <p className="text-brand-secondary">Kunjungan Terakhir</p>
                      <p className="text-gray-700 mt-0.5">
                        {r.last_visit_date
                          ? formatAuditTimestamp(r.last_visit_date)
                          : 'Belum pernah'}
                      </p>
                    </div>
                    <div>
                      <p className="text-brand-secondary">Pesanan</p>
                      <p className="text-gray-700 mt-0.5">{r.order_count}</p>
                    </div>
                    <div>
                      <p className="text-brand-secondary">Nilai pembanding target</p>
                      <p className="font-semibold text-gray-900 mt-0.5">
                        {`Rp ${formatMoney(r.total_sales, 'full')}`}
                      </p>
                    </div>
                  </div>

                  {/* Visit progress bar */}
                  <div className="pt-2 border-t border-gray-100">
                      <p className="text-[13px] text-brand-secondary mb-1">Target Penjualan</p>
                      <InlineTargetEditor key={`${editorScope}:${r.id}`}
                        recordId={r.id}
                        currentTarget={r.sales_target}
                        layout="mobile"
                        canEdit={canEditTargets && !isPending}
                        targetEditors={targetEditors}
                      />
                    </div>
                  <div className="pt-2 border-t border-gray-100">
                    <p className="text-[13px] text-brand-secondary mb-1">% Kunjungan</p>
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
                      <span className="text-[13px] text-brand-secondary">
                        {r.target_visits > 0
                          ? Math.round((r.actual_visits / r.target_visits) * 100)
                          : 0}%
                      </span>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-gray-100">
                    <p className="text-[13px] text-brand-secondary mb-1">% Pembanding target</p>
                    <SalesPctBar actual={r.total_sales} target={r.sales_target} />
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
