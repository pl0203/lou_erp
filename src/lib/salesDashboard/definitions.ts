import { formatMoney, moneyPercentage } from '../reads/money'
import type { DashboardMetric, DashboardTargetMetric, DashboardValue, DashboardTarget } from './contracts'
export const dashboardMetricDefinitions: readonly { key: DashboardMetric; label: string; shortLabel: string; basis: string; unit: 'PO' | 'CO' | 'money'; targetMetric: DashboardTargetMetric | null }[] = [
  { key: 'poOrderCount', label: 'Jumlah PO masuk', shortLabel: 'PO masuk', basis: 'PO tercatat unik · tanggal PO · Dikonfirmasi / Dalam proses / Selesai', unit: 'PO', targetMetric: null },
  { key: 'poOrderValue', label: 'Nilai total PO', shortLabel: 'Nilai PO', basis: 'Nilai pesanan tercatat · tanggal PO · Dikonfirmasi / Dalam proses / Selesai', unit: 'money', targetMetric: 'po_order_value' },
  { key: 'poDeliveryValue', label: 'Nilai PO dikirim', shortLabel: 'PO dikirim', basis: 'Pengiriman tercatat · tanggal SJ tidak batal × harga asli item PO', unit: 'money', targetMetric: 'po_delivery_value' },
  { key: 'coShippedCount', label: 'CO dikirim ke pelanggan', shortLabel: 'CO dikirim', basis: 'CO unik dengan pengiriman tidak batal pada tanggal SJ dalam periode ini', unit: 'CO', targetMetric: null },
  { key: 'coSaleValue', label: 'CO menjadi penjualan', shortLabel: 'CO terjual', basis: 'Barang terjual · bulan laporan diposting × harga dan kredit asli CO', unit: 'money', targetMetric: 'co_sale_value' },
]
export const metricDefinition = (key: DashboardMetric) => dashboardMetricDefinitions.find(item => item.key === key)!
export function metricValueText(value: DashboardValue, metric: DashboardMetric): string {
  if (value.value === null || value.quality === 'missing') return metric === 'coSaleValue' ? 'Belum ada laporan' : 'Belum tersedia'
  return metricDefinition(metric).unit === 'money' ? `Rp ${formatMoney(value.value, 'full')}` : `${value.value.replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ${metricDefinition(metric).unit}`
}
function scaled(value: string, scale: number): bigint {
  const [whole, fraction = ''] = value.split('.'); return BigInt(whole + fraction.padEnd(scale, '0'))
}
/** Exact decimal subtraction for display only; no money passes through a JS Number. */
export function moneyDifference(a: string, b: string): string {
  const scale = Math.max(2, a.split('.')[1]?.length ?? 0, b.split('.')[1]?.length ?? 0)
  const amount = scaled(a, scale) - scaled(b, scale), absolute = (amount < 0n ? -amount : amount).toString().padStart(scale + 1, '0')
  return `${amount < 0n ? '-' : ''}${absolute.slice(0, -scale)}.${absolute.slice(-scale)}`
}
export function targetProgress(actual: DashboardValue, target: DashboardTarget, metric: DashboardTargetMetric, month: string): { percentage: string | null; gap: string | null; status: 'comparable' | 'basis_mismatch' | 'not_published' | 'partial_target' | 'not_applicable' | 'incomplete_actual' | 'zero_target' } {
  const result = (status: ReturnType<typeof targetProgress>['status'], gap: string | null = null, percentage: string | null = null) => ({ percentage, gap, status })
  if (target.metric !== metric || target.month !== month) return result('basis_mismatch')
  if (target.state !== 'published' || target.amount === null) return result(target.state === 'partial' ? 'partial_target' : target.state === 'not_applicable' ? 'not_applicable' : 'not_published')
  if (actual.quality !== 'complete' || actual.value === null) return result('incomplete_actual')
  const gap = moneyDifference(target.amount, actual.value)
  if (/^0+(?:\.0+)?$/.test(target.amount)) return result('zero_target', gap)
  return result('comparable', gap, moneyPercentage(actual.value, target.amount))
}
export function visitProgress(visited: string | null, scheduled: string | null): string | null {
  if (visited === null || scheduled === null || BigInt(scheduled) === 0n) return null
  return moneyPercentage(visited, scheduled)
}
export function currentDashboardMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit' }).formatToParts(now)
  return `${parts.find(part => part.type === 'year')!.value}-${parts.find(part => part.type === 'month')!.value}-01`
}
export function dashboardMonthLabel(month: string) { return new Date(`${month.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }) }
export function previousDashboardMonth(month: string): string { const value = new Date(`${month}T00:00:00Z`); value.setUTCMonth(value.getUTCMonth() - 1); return value.toISOString().slice(0, 10) }
export function compareCompletedMonths(month: string, current: DashboardValue, priorMonth: string, prior: DashboardValue, asOfDate: string): string | null {
  if (month.slice(0, 7) >= asOfDate.slice(0, 7) || previousDashboardMonth(month) !== priorMonth || current.quality !== 'complete' || prior.quality !== 'complete' || current.value === null || prior.value === null || /^0+(?:\.0+)?$/.test(prior.value)) return null
  return moneyPercentage(moneyDifference(current.value, prior.value), prior.value)
}

const dashboardWarnings: Record<string, string> = {
  CURRENT_ACTIVITY_USES_CURRENT_HIERARCHY: 'Prioritas hari ini dan permintaan menunggu mengikuti hierarki saat ini; angka bulanan mengikuti roster periode terpilih.',
  TREND_SAME_SELECTED_COHORT: 'Tren memakai pelanggan/orang dalam hasil filter terpilih, dengan kredit penjualan asli yang tetap.',
  UNVERIFIED_HIERARCHIES_EXCLUDED: 'Hierarki yang belum terverifikasi tidak dimasukkan ke cakupan.',
  PENDING_REQUESTS_UNAVAILABLE: 'Jumlah permintaan menunggu belum tersedia.',
  ACTIVITY_COUNTS_DISTINCT_CUSTOMER_DAYS: 'Kunjungan menghitung pelanggan per sales per hari, bukan jumlah jadwal selesai.',
  FILTERED_CUSTOMERS_NO_COMPARABLE_PERSON_TARGET: 'Target orang tidak dialokasikan per pelanggan; pencarian pelanggan tidak memiliki pembanding target.',
  TARGET_COVERAGE_OR_APPLICABILITY_NOT_COMPARABLE: 'Target tidak sebanding dengan seluruh aktual karena cakupan target belum lengkap atau sebagian tidak berlaku.',
}
export function dashboardWarningText(code: string): string { return dashboardWarnings[code] ?? (/^[A-Z_]+$/.test(code) ? 'Ada informasi kualitas data tambahan yang perlu diperiksa.' : code) }
