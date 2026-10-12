import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { useTargetEditorLock, type TargetEditorLock, type TargetEditorLayout } from '../../components/ui/useTargetEditorLock'
import { SalesMetricsPanel } from '../../components/sales/SalesMetricSummary'
import { useEffect, useId, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { usePagedRead } from '../../lib/reads/usePagedRead'
import { fetchSalesPerformancePage, fetchEarliestSalesPerformanceMonth } from '../../lib/reads/reports'
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
  userId, yearMonth, currentTarget, canEdit, onSaved, targetEditors, layout, compact = false,
}: {
  userId: string
  yearMonth: string
  currentTarget: string | null
  canEdit: boolean
  onSaved: (refreshActive: boolean) => void
  compact?: boolean
  layout: TargetEditorLayout
  targetEditors: TargetEditorLock
}) {
  const fieldId = useId()
  const [owner] = useState(() => Symbol())
  const release = targetEditors.release
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const latestValue = useRef('')
  const saving = useRef(false)
  const editor = useRef(0)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; release(owner) }
  }, [owner, release])

  const mutation = useMutation({
    mutationFn: async (submitted: { targetValue: number; editor: number; onSaved: (refreshActive: boolean) => void }) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Tidak terautentikasi')
      await upsertSalesTarget(userId, yearMonth, submitted.targetValue, user.id)
    },
    onSuccess: (_result, submitted) => {
      const currentOwner = mounted.current && editor.current === submitted.editor
      if (currentOwner) { setEditing(false); release(owner) }
      submitted.onSaved(currentOwner)
    },
    onSettled: () => { saving.current = false },
  })

  const save = () => {
    if (saving.current || !editing || !canEdit) return
    saving.current = true
    mutation.mutate({ targetValue: parseFloat(latestValue.current) || 0, editor: editor.current, onSaved })
  }
  const cancel = () => {
    if (saving.current) return
    editor.current++
    setEditing(false)
    release(owner)
  }

  if (!canEdit) return <span className={`text-brand-secondary ${compact ? 'text-sm' : 'text-base'}`}>
    {currentTarget != null ? `Rp ${formatMoney(currentTarget, 'full')}` : '—'}
  </span>

  if (editing) return <div className="flex flex-wrap items-end justify-end gap-2">
    <Field id={fieldId} label="Target penjualan (Rp)" className="w-40 max-w-full">
      {control => <input {...control}
        type="number"
        value={value}
        disabled={mutation.isPending}
        onChange={event => { latestValue.current = event.target.value; setValue(event.target.value) }}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); save() }
          if (event.key === 'Escape') { event.preventDefault(); cancel() }
        }}
        placeholder="0"
        autoFocus
        className="text-base text-right focus:outline-none focus:ring-2 focus:ring-brand-primary"
      />}
    </Field>
    <Button onClick={save} pending={mutation.isPending}>Simpan target</Button>
    <Button variant="secondary" onClick={cancel} disabled={mutation.isPending}>Batal</Button>
    {mutation.isError && <p role="alert" className="basis-full text-sm text-red-700">Penyimpanan target mengalami kendala. Coba simpan lagi atau pilih Batal.</p>}
  </div>

  return <Button variant="secondary" className="w-full" disabled={targetEditors.busy}
    aria-describedby={targetEditors.busy ? targetEditors.descriptionId : undefined} onClick={() => {
    if (saving.current || !targetEditors.claim(owner, layout)) return
    editor.current++
    latestValue.current = currentTarget?.toString() ?? ''
    setValue(latestValue.current)
    mutation.reset()
    setEditing(true)
  }}>
    {currentTarget != null ? `Rp ${formatMoney(currentTarget, 'full')}` : '+ Atur target'}
  </Button>
}

function PerformanceTable({
  performance, yearMonth, editorScope, canEdit, onSaved, targetEditors,
}: {
  performance: PerformanceData[]
  editorScope: string
  targetEditors: TargetEditorLock
  yearMonth: string
  canEdit: boolean
  onSaved: (refreshActive: boolean) => void
}) {
  return (
    <>
      {targetEditors.busy && <p id={targetEditors.descriptionId} className="text-sm text-brand-secondary">Simpan atau batalkan target yang sedang diedit sebelum mengubah target lain.</p>}
      <div className={`${targetEditors.layout === 'desktop' ? 'block' : targetEditors.layout === 'mobile' ? 'hidden' : 'hidden md:block'} bg-white rounded-xl border border-gray-200 overflow-hidden`}>
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-medium text-gray-900">Tim aktif saat ini</h2>
        </div>
        <p className="px-5 py-2 text-[13px] text-brand-secondary">Geser tabel untuk melihat semua kolom.</p>
        <div role="region" aria-label="Tabel aktivitas tim" tabIndex={0} className="max-w-full overflow-x-auto">
        <table className="w-full min-w-[64rem] text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-5 py-3 font-medium text-brand-secondary">Nama</th>
              <th className="text-center px-5 py-3 font-medium text-brand-secondary">Dijadwalkan</th>
              <th className="text-center px-5 py-3 font-medium text-brand-secondary">Dikunjungi</th>
              <th className="text-center px-5 py-3 font-medium text-brand-secondary">Tingkat Kunjungan</th>
              <th className="text-center px-5 py-3 font-medium text-brand-secondary">Pesanan</th>
              <th className="text-right px-5 py-3 font-medium text-brand-secondary">Nilai pembanding target</th>
              <th className="text-right px-5 py-3 font-medium text-brand-secondary">
                Target
                {canEdit && <span className="text-brand-secondary ml-1 font-normal">(klik untuk ubah)</span>}
              </th>
            </tr>
          </thead>
          <tbody>
            {performance.map(p => (
              <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="min-w-[14rem] px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-green-100 text-green-700 text-[13px] font-semibold flex items-center justify-center shrink-0">
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
                      p.visit_rate >= 80 ? 'text-green-800'
                      : p.visit_rate >= 50 ? 'text-yellow-800'
                      : 'text-red-700'
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
                  Rp {formatMoney(p.total_sales, 'full')}
                </td>
                <td className="px-5 py-4 text-right">
                  <InlineSalesTargetEdit key={`${editorScope}:${p.id}`}
                    userId={p.id}
                    yearMonth={yearMonth}
                    currentTarget={p.sales_target}
                    layout="desktop"
                    compact
                    canEdit={canEdit}
                    onSaved={onSaved}
                  targetEditors={targetEditors}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <div className={`${targetEditors.layout === 'mobile' ? 'block' : targetEditors.layout === 'desktop' ? 'hidden' : 'md:hidden'} space-y-3`}>
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
                  <span className={`text-[13px] font-medium ${
                    p.visit_rate >= 80 ? 'text-green-800'
                    : p.visit_rate >= 50 ? 'text-yellow-800'
                    : 'text-red-700'
                  }`}>
                    {p.visit_rate}%
                  </span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-base">
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-[13px] text-brand-secondary mb-1">Kunjungan</p>
                <p className="font-semibold text-gray-900">{p.visited}/{p.scheduled}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-[13px] text-brand-secondary mb-1">Pesanan</p>
                <p className="font-semibold text-gray-900">{p.orders}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-[13px] text-brand-secondary mb-1">Nilai pembanding target</p>
                <p className="font-semibold text-gray-900">
                  Rp {formatMoney(p.total_sales, 'full')}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-[13px] text-brand-secondary mb-1">Target</p>
                <InlineSalesTargetEdit key={`${editorScope}:${p.id}`}
                  userId={p.id}
                  yearMonth={yearMonth}
                  currentTarget={p.sales_target}
                  layout="mobile"
                  canEdit={canEdit}
                  onSaved={onSaved}
                  targetEditors={targetEditors}
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
  avgVisitRate, totalVisited, totalScheduled, totalOrders, totalSales, totalStaff, period
}: {
  avgVisitRate: number
  totalStaff: number
  period: string
  totalVisited: number
  totalScheduled: number
  totalOrders: number
  totalSales: string
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <section aria-label="Rata-rata tingkat kunjungan per orang" className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-[13px] text-brand-secondary mb-1">Rata-rata tingkat kunjungan per orang</p>
        <p className="text-2xl font-bold text-gray-900">{totalStaff > 0 ? `${avgVisitRate}%` : 'Belum tersedia'}</p>
        <p className="text-[13px] text-brand-secondary mt-1">{period} · {totalStaff} anggota aktif, bobot sama.</p>
        <p className="text-[13px] leading-relaxed text-brand-secondary mt-2">Per orang: kunjungan tercatat ÷ jadwal × 100, dibulatkan. Rata-rata dari persentase per orang lalu dibulatkan. Anggota tanpa jadwal dihitung 0%.</p>
      </section>
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-[13px] text-brand-secondary mb-1">Total Kunjungan</p>
        <p className="text-2xl font-bold text-gray-900 [overflow-wrap:anywhere]">{totalVisited}</p>
        <p className="text-[13px] text-brand-secondary mt-1">{totalVisited}/{totalScheduled} kunjungan tercatat dari jadwal</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-[13px] text-brand-secondary mb-1">Pesanan Dibuat</p>
        <p className="text-2xl font-bold text-gray-900 [overflow-wrap:anywhere]">{totalOrders}</p>
        <p className="text-[13px] text-brand-secondary mt-1">tanggal pembuatan pesanan · {period}</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-[13px] text-brand-secondary mb-1">Nilai pembanding target</p>
        <p className="text-2xl font-bold text-gray-900 [overflow-wrap:anywhere]">
          Rp {formatMoney(totalSales, 'full')}
        </p>
        <p className="text-[13px] text-brand-secondary mt-1">tanggal pembuatan pesanan · {period}</p>
      </div>
    </div>
  )
}

export default function GirardPerformance() {
  return <div className="min-h-screen bg-brand-canvas"><GirardNav /><PerformanceContent /></div>
}

export function PerformanceContent() {
  return <div className="min-w-0"><div className="px-4 pt-6 md:px-8"><SalesMetricsPanel group="person" /></div><PerformanceActivityContent /></div>
}

export function PerformanceActivityContent() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const { data: receivedPage, filters, page, setFilters, setPage, isPending, isError, refetch } = usePagedRead('performance', { yearMonth: currentYearMonth() }, (filters, page, signal) => fetchSalesPerformancePage(profile!.id, profile!.role, filters.yearMonth, page, signal))
  const data = isPending ? undefined : receivedPage
  const { data: earliest, isError: monthError, refetch: refetchMonths } = useQuery({ queryKey: ['earliest_sales_report_month', profile?.id, profile?.role], queryFn: ({ signal }) => fetchEarliestSalesPerformanceMonth(profile!.id, profile!.role, signal), enabled: !!profile })
  const monthOptions = buildMonthOptions(earliest ?? currentYearMonth())
  const yearMonth = filters.yearMonth
  const selectedLabel = monthOptions.find(month => month.value === yearMonth)?.label ?? yearMonth
  const canEdit = ['sales_head', 'executive', 'sales_manager'].includes(profile?.role ?? '')
  const readIdentity = `${profile?.id ?? ''}:${profile?.role ?? ''}`
  const editorScope = JSON.stringify([readIdentity, yearMonth, page])
  const targetEditors = useTargetEditorLock(editorScope)
  const invalidate = (refreshActive: boolean) => queryClient.invalidateQueries({
    queryKey: ['performance', readIdentity, { yearMonth }],
    refetchType: refreshActive ? 'active' : 'none',
  })
  return <div className="px-4 md:px-8 py-6 space-y-6">
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div><h2 className="text-lg font-semibold text-gray-900">Aktivitas dan Target Tim</h2><p className="text-sm text-brand-secondary mt-0.5">Periode aktivitas: {selectedLabel}</p></div>
      <select aria-label="Bulan performa sales" value={yearMonth} onChange={event => setFilters({ yearMonth: event.target.value })} className="border border-brand-control-border rounded-lg px-3 py-2 text-base min-h-11 focus:outline-none focus:ring-2 focus:ring-brand-primary">
        {monthOptions.map(month => <option key={month.value} value={month.value}>{month.label}</option>)}
      </select>
    </div>
    <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-brand-secondary">
      <p>Filter bulan aktivitas ini tidak mengubah Metrik Sales. Cakupan: anggota yang kini aktif (tenaga penjualan, manajer Sales, kepala Sales, dan eksekutif) sesuai izin akun; ringkasan mencakup semua halaman.</p>
      <p className="mt-1">Jadwal memakai tanggal kunjungan. Pesanan dan nilai pembanding target memakai tanggal pembuatan pesanan, termasuk riwayat Girard yang belum dikonversi. Basis ini berbeda dari tanggal PO, tanggal SJ, dan bulan laporan CO pada Metrik Sales.</p>
    </div>
    {isError || monthError ? <div role="alert" className="text-red-700">{monthError ? 'Daftar bulan tidak tersedia.' : 'Data performa tidak tersedia.'} <Button variant="secondary" onClick={() => { refetch(); refetchMonths() }}>Coba lagi</Button></div> : !data ? <p className="text-center text-brand-secondary text-sm py-12">Memuat data performa...</p> : <>
      <PaginationControls page={data.page} total={data.total} pageSize={data.page_size} pending={isPending} onPageChange={setPage} />
      {(data.summary.unassigned_orders ?? 0) > 0 && <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="font-medium text-gray-900">Belum ditugaskan</p><p className="text-sm text-brand-secondary">{data.summary.unassigned_orders} pesanan belum memiliki kredit tenaga penjualan. Rp {formatMoney(data.summary.unassigned_sales!, 'full')} termasuk dalam nilai pembanding aktivitas.</p></div>}
      <SummaryCards avgVisitRate={data.summary.average_visit_rate} totalVisited={data.summary.total_visited} totalScheduled={data.summary.total_scheduled} totalOrders={data.summary.total_orders} totalSales={data.summary.total_sales} totalStaff={data.total} period={selectedLabel} />
      {data.items.length === 0 ? <p className="text-center text-brand-secondary text-sm py-12">Tidak ada data performa untuk bulan ini.</p> : <PerformanceTable performance={data.items} yearMonth={yearMonth} editorScope={editorScope} canEdit={canEdit && !isPending} onSaved={invalidate} targetEditors={targetEditors} />}
    </>}
  </div>
}
