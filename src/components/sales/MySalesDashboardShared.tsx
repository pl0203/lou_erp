import { useId } from 'react'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { formatMoney } from '../../lib/reads/money'
import { formatAuditTimestamp, formatDisplayDate } from '../../lib/displayDate'
import type { DashboardData, DashboardMetric, DashboardRow, DashboardTarget, DashboardValue, DashboardSort, DashboardAttention } from '../../lib/salesDashboard/contracts'
import { compareCompletedMonths, dashboardMetricDefinitions, dashboardMonthLabel, dashboardWarningText, metricDefinition, metricValueText, targetProgress, visitProgress } from '../../lib/salesDashboard/definitions'

export type DashboardViewProps = { data: DashboardData; month: string; search: string; onMonth: (month: string) => void; onSearch: (query: string) => void; onPage: (page: number) => void; onRefresh: () => void; pending?: boolean; onSearchCommit?: () => void; appliedSearch?: string; sort?: DashboardSort; attention?: DashboardAttention; onSort?: (sort: DashboardSort) => void; onAttention?: (attention: DashboardAttention) => void }
export const dashboardCard = 'min-w-0 rounded-xl border border-brand-divider bg-white p-4 sm:p-5'
export const dashboardLink = 'inline-flex min-h-[var(--ui-control-size)] min-w-0 items-center rounded-lg px-3 py-[var(--ui-control-padding-y)] text-[length:var(--ui-text-control)] leading-[var(--ui-line-control)] font-semibold text-brand-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-brand-primary [overflow-wrap:anywhere]'
export const disclosureClass = 'min-h-[var(--ui-control-size-compact)] cursor-pointer rounded-lg py-[var(--ui-control-padding-y-compact)] text-[length:var(--ui-text-control)] leading-[var(--ui-line-control)] font-semibold text-brand-primary focus-visible:outline-2 focus-visible:outline-brand-primary [overflow-wrap:anywhere]'
export function MonthControl({ month, onMonth, pending }: Pick<DashboardViewProps, 'month' | 'onMonth' | 'pending'>) {
  const id = useId()
  return <Field id={id} label="Bulan hasil">{control => <input {...control} aria-label="Bulan hasil" className="ui-control w-full min-w-0" type="month" value={month.slice(0, 7)} disabled={pending} onChange={event => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) onMonth(`${event.target.value}-01`) }} />}</Field>
}
export function DashboardMetricSelect({ metric, onMetric }: { metric: DashboardMetric; onMetric: (metric: DashboardMetric) => void }) {
  const id = useId()
  return <Field id={id} label="Metrik hasil">{control => <select {...control} aria-label="Metrik hasil" className="ui-control w-full min-w-0" value={metric} onChange={event => onMetric(event.target.value as DashboardMetric)}>{dashboardMetricDefinitions.map(definition => <option key={definition.key} value={definition.key}>{definition.label}</option>)}</select>}</Field>
}

export function DashboardListFilters({ own, sort = 'name', attention = 'all', onSort, onAttention }: Pick<DashboardViewProps, 'sort' | 'attention' | 'onSort' | 'onAttention'> & { own: boolean }) {
  const id = useId(), noun = own ? 'pelanggan' : 'sales'
  return <div className="grid min-w-0 gap-3 sm:grid-cols-2">
    <Field id={`${id}-attention`} label={`Fokus ${noun}`}>{control => <select {...control} value={attention} onChange={event => onAttention?.(event.target.value as DashboardAttention)}>
      <option value="all">Semua</option><option value="missing_co">Laporan CO belum lengkap</option>
      {own ? <option value="unvisited">Belum dikunjungi pada bulan hasil</option> : <option value="target_incomplete">Target tiga basis belum lengkap</option>}
    </select>}</Field>
    <Field id={`${id}-sort`} label={`Urutkan ${noun}`}>{control => <select {...control} value={sort} onChange={event => onSort?.(event.target.value as DashboardSort)}>
      <option value="name">Nama A–Z</option><option value="po_order_value_desc">Nilai PO terbesar</option><option value="po_delivery_value_desc">PO dikirim terbesar</option><option value="co_sale_value_desc">CO terjual terbesar</option>
    </select>}</Field>
  </div>
}
export function DashboardTrend({ data, metric, onMetric }: { data: DashboardData; metric: DashboardMetric; onMetric?: (metric: DashboardMetric) => void }) {
  const businessMonth = data.activity.asOfDate.slice(0, 7) + '-01'
  const future = data.month > businessMonth
  const trend = (data.trend ?? []).filter(point => point.month < businessMonth && point.month <= data.month).sort((a, b) => a.month.localeCompare(b.month))
  const current = trend.at(-1), prior = trend.at(-2)
  const comparison = !future && current && prior ? compareCompletedMonths(current.month, current.metrics[metric], prior.month, prior.metrics[metric], data.activity.asOfDate) : null
  return <details className={dashboardCard}><summary className={disclosureClass}>Tren metrik · perbandingan bulan penuh</summary><div className="min-w-0 space-y-3 pt-3">
    {onMetric && <div className="max-w-sm"><DashboardMetricSelect metric={metric} onMetric={onMetric} /></div>}
    {future ? <p className="text-sm text-brand-secondary">Perbandingan belum tersedia untuk periode mendatang.</p> : trend.length === 0 ? <p className="text-sm text-brand-secondary">Riwayat tren belum tersedia. Angka bulan lain tidak diperkirakan.</p> : <>
      <p className="text-sm text-brand-secondary">{metricDefinition(metric).basis} · hanya bulan selesai dengan basis yang sama.</p>
      <p className="text-[13px] text-brand-secondary">Cakupan pelanggan/orang sama dengan hasil filter yang dipilih. Kredit asli dipertahankan; ini bukan perbandingan susunan tim pada setiap bulan.</p>
      <ol className="grid min-w-0 gap-3 sm:grid-cols-2">{trend.map(point => <li key={point.month} className="min-w-0 rounded-lg bg-brand-canvas p-3"><p className="text-[13px] text-brand-secondary">{dashboardMonthLabel(point.month)}</p><p className="mt-1 font-semibold text-brand-primary">{metricValueText(point.metrics[metric], metric)}</p><QualityNote value={point.metrics[metric]} /></li>)}</ol>
      <p className="text-sm text-brand-secondary">{comparison === null ? 'Perbandingan tidak tersedia tanpa dua bulan lengkap berurutan dan pembanding bukan nol.' : `${comparison.startsWith('-') ? '' : '+'}${comparison}% · ${dashboardMonthLabel(current!.month)} dibanding ${dashboardMonthLabel(prior!.month)}`}</p>
    </>}
  </div></details>
}

export function QualityNote({ value }: { value: DashboardValue }) {
  return value.quality === 'partial' ? <p className="mt-1 text-[13px] text-amber-800">Hanya data tersedia; kelengkapan belum terverifikasi.</p> : null
}
export function TargetDisplay({ actual, target, metric, month, showProgress = false }: { actual: DashboardValue; target: DashboardTarget | undefined; metric: DashboardMetric; month: string; showProgress?: boolean }) {
  const definition = metricDefinition(metric)
  if (!definition.targetMetric) return <p className="text-[13px] text-brand-secondary">Target hitungan tidak digunakan dalam versi ini.</p>
  if (!target) return <p className="text-[13px] text-brand-secondary">Target belum diterbitkan untuk bulan ini.</p>
  const progress = targetProgress(actual, target, definition.targetMetric, month)
  const explanation = {
    basis_mismatch: 'Basis target tidak cocok; capaian tidak dihitung.',
    not_published: 'Target belum diterbitkan untuk bulan ini.',
    partial_target: 'Target belum lengkap untuk seluruh cakupan; capaian tidak dihitung.',
    not_applicable: 'Target tidak berlaku untuk basis ini.',
    incomplete_actual: 'Capaian belum dapat dihitung; data aktual belum lengkap.',
    zero_target: 'Target nol diterbitkan; persentase capaian tidak dihitung.',
    comparable: '',
  }[progress.status]
  return <div className="min-w-0 space-y-1 text-sm [overflow-wrap:anywhere]">
    {target.state === 'published' && target.amount !== null && progress.status !== 'basis_mismatch' && <p className="text-brand-secondary">Target diterbitkan: <span className="font-semibold text-brand-primary">Rp {formatMoney(target.amount, 'full')}</span></p>}
    {progress.percentage !== null && <p className="font-semibold text-brand-primary">{progress.percentage}%</p>}
    {progress.gap !== null && <p className="text-brand-secondary">{progress.gap.startsWith('-') ? `Melebihi target: Rp ${formatMoney(progress.gap.slice(1), 'full')}` : `Selisih ke target: Rp ${formatMoney(progress.gap, 'full')}`}</p>}
    {explanation && <p className="text-[13px] text-brand-secondary">{explanation}</p>}
    {showProgress && progress.percentage !== null && <div role="progressbar" aria-label={`Capaian ${definition.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Number(progress.percentage))} aria-valuetext={`${progress.percentage}% dari target`} className="mt-3 h-2 overflow-hidden rounded-full bg-emerald-50"><div className="h-full rounded-full bg-brand-primary" style={{ width: `${Math.min(100, Number(progress.percentage))}%` }} /></div>}
  </div>
}
export function DashboardPagination({ data, onPage, pending, noun }: Pick<DashboardViewProps, 'data' | 'onPage' | 'pending'> & { noun: string }) {
  if (data.total <= data.pageSize) return null
  const from = (data.page - 1) * data.pageSize + 1, through = Math.min(data.page * data.pageSize, data.total)
  return <nav aria-label={`Halaman ${noun}`} className="flex min-w-0 flex-wrap items-center justify-between gap-3 pt-3">
    <p className="text-sm text-brand-secondary">{from}–{through} dari {data.total}</p>
    <div className="flex flex-wrap gap-2"><Button size="compact" variant="secondary" disabled={pending || data.page <= 1} onClick={() => onPage(data.page - 1)}>Sebelumnya</Button><Button size="compact" variant="secondary" disabled={pending || through >= data.total} onClick={() => onPage(data.page + 1)}>Berikutnya</Button></div>
  </nav>
}
export function VisitContext({ row }: { row: DashboardRow }) {
  const { visited, scheduled } = row.activity
  const rate = visitProgress(visited, scheduled)
  return <div className="min-w-0 text-sm [overflow-wrap:anywhere]">
    <p>{visited === null || scheduled === null ? 'Aktivitas belum tersedia' : `${visited} / ${scheduled}`}</p>
    <p className="mt-1 text-[13px] text-brand-secondary">{scheduled === '0' ? 'Tanpa jadwal; rasio tidak dihitung' : rate === null ? 'Kelengkapan aktivitas belum diketahui' : `${rate}% · kunjungan / jadwal`}</p>
  </div>
}
export function RowMetricDetails({ row, month }: { row: DashboardRow; month: string }) {
  return <div className="min-w-0 space-y-3 border-t border-brand-divider py-3">
    <dl className="space-y-2">{dashboardMetricDefinitions.map(definition => <div key={definition.key} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 text-sm"><dt className="text-brand-secondary [overflow-wrap:anywhere]">{definition.label}</dt><dd className="min-w-0 text-right font-medium text-brand-primary [overflow-wrap:anywhere]">{metricValueText(row.metrics[definition.key], definition.key)}<QualityNote value={row.metrics[definition.key]} /></dd></div>)}</dl>
    {row.kind === 'person' && <><p className="text-[13px] text-brand-secondary">Target diterbitkan · {dashboardMonthLabel(month)} · setiap basis terpisah</p>{dashboardMetricDefinitions.filter(definition => definition.targetMetric).map(definition => <div key={definition.key}><p className="text-sm font-medium text-brand-primary">{definition.label}</p><TargetDisplay actual={row.metrics[definition.key]} target={row.targets[definition.targetMetric!]} metric={definition.key} month={month} /></div>)}</>}
    {row.warnings.length > 0 && <p className="text-sm text-amber-800">{row.warnings.map(dashboardWarningText).join(' · ')}</p>}
  </div>
}
export function DashboardDefinitions({ data }: { data: DashboardData }) {
  return <details className="min-w-0 border-t border-brand-divider pt-2"><summary className={disclosureClass}>Definisi, sumber angka & waktu pembacaan</summary><div className="space-y-2 pb-3 text-[13px] leading-relaxed text-brand-secondary [overflow-wrap:anywhere]">
    {dashboardMetricDefinitions.map(definition => <p key={definition.key}><strong>{definition.label}:</strong> {definition.basis}.</p>)}
    <p>CO dikirim bukan penjualan dan bukan conversion rate. Tanpa laporan bukan berarti penjualan nol. Nol pada laporan tersedia tetap tidak membuktikan kelengkapan seluruh laporan.</p>
    <p>Kredit penjualan tetap mengikuti PO/CO asli. Penugasan pelanggan saat ini tidak memindahkan penjualan historis ke sales baru. Riwayat portofolio untuk perencanaan target bukan riwayat penjualan penerima penugasan.</p>
    <p>Angka PO dan pengiriman merangkum dokumen tercatat yang memenuhi syarat, bukan jaminan semua transaksi di dunia nyata sudah dimasukkan. Kelengkapan riwayat untuk saran target diperiksa terpisah.</p>
    <p>Target baru hanya berlaku pada bulan dan basis yang diterbitkan. Target lama berbasis tanggal pembuatan pesanan tidak digabungkan. Tidak ada penjumlahan lintas tahap atau skor gabungan orang.</p>
    <p>Aktivitas dibatasi bulan hasil dan sampai {formatDisplayDate(data.activity.asOfDate)}. Jadwal memakai tanggal jadwal. Kunjungan menghitung pelanggan per sales per hari berdasarkan waktu pencatatan di Asia/Jakarta, bukan jadwal selesai; rasio dapat melebihi 100%. Permintaan menunggu memakai semua tanggal, bukan bulan hasil.</p>
    <p>Waktu pembacaan: {formatAuditTimestamp(data.asOf)}. Tanggal kalender sumber dipertahankan; ini bukan bukti seluruh laporan sudah masuk.</p>
    {data.warnings.length > 0 && <p className="text-amber-800">Perlu diperiksa: {data.warnings.map(dashboardWarningText).join(' · ')}</p>}
  </div></details>
}
