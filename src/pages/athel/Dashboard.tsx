import { useAuth } from '../../lib/AuthContext'
import { DashboardSkeleton, DashboardChartsSkeleton } from '../../components/ui/LoadingSkeletons'
import { PO_STATUS_LABELS } from '../../lib/orderPresentation'
import { formatDisplayDate } from '../../lib/displayDate'
import { calendarDateKey } from '../../lib/calendarDate'
import { lazy, Suspense, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchDashboardData } from '../../lib/reads/reports'
export { displayDay, rangeDays, rollingMonthKeys } from '../../lib/reads/reports'
export type { DashboardData } from '../../lib/reads/reports'
import { formatMoney, formatCompactMoney, moneyPercentage } from '../../lib/reads/money'
import AthelNav from '../../components/AthelNav'
import { Button } from '../../components/ui/Button'
import { MainContent } from '../../components/ui/MainContent'
import { PageHeader } from '../../components/ui/PageHeader'
import { Field } from '../../components/ui/Field'
import { FilterBar } from '../../components/ui/FilterBar'
import { Notice, StatusBadge } from '../../components/ui/Feedback'

const DashboardCharts = lazy(() => import('../../components/athel/DashboardCharts').catch(() => ({
  default: function ChartsUnavailable() {
    return <p role="status" className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Grafik tidak dapat dimuat. Muat ulang halaman untuk mencoba lagi.</p>
  },
})))

type FilterStatus = 'all' | 'confirm' | 'in_progress' | 'complete' | 'cancelled'
type FulfillmentFilter = 'all' | 'undelivered' | 'partial' | 'complete'

const formatCurrency = (value: string) => `Rp${formatMoney(value, 'full')}`
const formatCompactCurrency = formatCompactMoney
const formatPercent = (value: number) => `${value.toFixed(1)}%`
function getFirstDayOfMonth(offset = 0): string {
  const date = new Date()
  date.setMonth(date.getMonth() + offset, 1)
  date.setHours(0, 0, 0, 0)
  return calendarDateKey(date)
}
function getToday(): string { return calendarDateKey() }

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
    <div className="min-w-0 rounded-2xl border border-brand-control-border bg-white p-4 shadow-sm sm:p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-gray-900 [overflow-wrap:anywhere] sm:text-3xl">{value}</p>
      <p className="mt-2 text-sm text-gray-500">{helper}</p>
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
    <div className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
      </div>
      <p className="mb-2 text-[13px] text-gray-500">Geser tabel untuk melihat semua kolom.</p>
      {children}
    </div>
  )
}

export default function AthelDashboard() {
  const [startDate, setStartDate] = useState(getFirstDayOfMonth(-2))
  const [endDate, setEndDate] = useState(getToday())
  const [status, setStatus] = useState<FilterStatus>('all')
  const [fulfillment, setFulfillment] = useState<FulfillmentFilter>('all')

  const { profile } = useAuth()
  const identity = `${profile?.id ?? ''}:${profile?.role ?? ''}`
  const { data: result, isLoading, isError, isFetching, fetchStatus, refetch } = useQuery({
    queryKey: ['athel_dashboard', startDate, endDate, status, fulfillment, identity],
    queryFn: async ({ signal }) => ({
      ...await fetchDashboardData(startDate, endDate, status, fulfillment, signal),
      displayFilters: { startDate, endDate, status, fulfillment },
    }),
    enabled: !!profile?.id,
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[5] === identity ? previous : undefined,
  })

  const data = result
  const shown = result?.displayFilters ?? { startDate, endDate, status, fulfillment }
  const rollingStart = data?.monthlySeries[0]?.key ? `${data.monthlySeries[0].key}-01` : shown.startDate
  const selectedPOPeriod = `${formatDisplayDate(shown.startDate)} – ${formatDisplayDate(shown.endDate)}`
  const sourcePeriod = `${formatDisplayDate(shown.startDate < rollingStart ? shown.startDate : rollingStart)} – ${formatDisplayDate(shown.endDate)}`

  return (
    <div className="min-h-screen bg-brand-canvas">
      <AthelNav />

      <MainContent>
      <div className="border-b border-brand-divider bg-white px-4 py-6 md:px-8 space-y-5">
        <PageHeader title="Dashboard" description="Pantau performa PO, pengiriman, pelanggan utama, dan barang yang belum terkirim." />
        <FilterBar label="Filter dashboard Pengadaan">
          <Field id="procurement-dashboard-start" label="Tanggal awal">{control => <input {...control} type="date" value={startDate} max={endDate} onChange={event => setStartDate(event.target.value)} />}</Field>
          <Field id="procurement-dashboard-end" label="Tanggal akhir">{control => <input {...control} type="date" value={endDate} min={startDate} max={getToday()} onChange={event => setEndDate(event.target.value)} />}</Field>
          <Field id="procurement-dashboard-status" label="Status PO">{control => <select {...control} value={status} onChange={event => setStatus(event.target.value as FilterStatus)}>
            <option value="all">Semua status</option><option value="confirm">{PO_STATUS_LABELS.confirm}</option><option value="in_progress">{PO_STATUS_LABELS.in_progress}</option><option value="complete">{PO_STATUS_LABELS.complete}</option><option value="cancelled">{PO_STATUS_LABELS.cancelled}</option>
          </select>}</Field>
          <Field id="procurement-dashboard-fulfillment" label="Status pengiriman">{control => <select {...control} value={fulfillment} onChange={event => setFulfillment(event.target.value as FulfillmentFilter)}>
            <option value="all">Semua</option><option value="undelivered">Belum terkirim</option><option value="partial">Terkirim sebagian</option><option value="complete">Terkirim penuh</option>
          </select>}</Field>
        </FilterBar>
      </div>
      <div className="px-4 py-6 md:px-8 space-y-4">
        <p role="status" aria-live="polite" aria-atomic="true" className="min-h-5 text-sm text-brand-secondary">
          {isError ? '' : !data ? (fetchStatus === 'paused' ? 'Dashboard Pengadaan tertunda. Menunggu koneksi…' : 'Memuat dashboard Pengadaan...') : (isFetching || fetchStatus === 'paused') ? (fetchStatus === 'paused' ? 'Pembaruan dashboard tertunda. Menunggu koneksi; hasil terakhir tetap ditampilkan.' : 'Memperbarui dashboard… Menampilkan hasil terakhir sampai selesai.') : ''}
        </p>
        {!isError && !data && <DashboardSkeleton />}
        {isError && <Notice tone="error" title="Gagal memuat dashboard." actions={<Button variant="secondary" onClick={() => { void refetch() }}>Coba lagi</Button>} />}
        {!isLoading && !isError && data && (
          <div className="space-y-6 ui-results" aria-busy={isFetching || fetchStatus === 'paused'}>
            <section aria-label="Cakupan ringkasan PO" className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
              <p>Tanggal PO: {formatDisplayDate(shown.startDate)} – {formatDisplayDate(shown.endDate)} · {({ all: 'Semua status', ...PO_STATUS_LABELS })[shown.status]} · {({ all: 'Semua pengiriman', undelivered: 'Belum terkirim', partial: 'Terkirim sebagian', complete: 'Terkirim penuh' })[shown.fulfillment]}</p>
              <p className="mt-1">Khusus PO sesuai izin akun. Nilai terkirim mencakup SJ yang tidak dibatalkan untuk PO terpilih, termasuk pengiriman di luar rentang tanggal PO. Nilai uang dalam rupiah; juta = 1.000.000 dan miliar = 1.000.000.000.</p>
            </section>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Total PO"
                value={formatCurrency(data.metrics.totalPOValue)}
                helper={`${data.metrics.totalPOCount} PO dalam periode ini`}
              />
              <StatCard
                label="Nilai Terkirim"
                value={formatCurrency(data.metrics.deliveredValue)}
                helper={`${moneyPercentage(data.metrics.deliveredValue, data.metrics.totalPOValue, 1)}% dari total nilai PO`}
              />
              <StatCard
                label="Nilai Belum Terkirim"
                value={formatCurrency(data.metrics.outstandingValue)}
                helper="Nilai item yang masih belum terpenuhi"
              />
              <StatCard
                label="Rata-rata Nilai PO"
                value={data.metrics.totalPOCount > 0 ? `Rp${formatMoney(data.metrics.averagePOValue, 'average')}` : 'Belum tersedia'}
                helper={data.metrics.totalPOCount > 0 ? `Total nilai PO ÷ ${data.metrics.totalPOCount} PO pada filter ini` : 'Belum ada PO pada filter ini untuk menghitung rata-rata'}
              />
            </div>

            <p className="text-sm text-gray-600">PO selesai: {data.metrics.completedPOCount} dari {data.metrics.totalPOCount} PO pada filter ini.</p>

            <Suspense fallback={<><span role="status" className="sr-only">Memuat grafik...</span><DashboardChartsSkeleton /></>}>
              <DashboardCharts key={`${shown.startDate}:${shown.endDate}:${shown.status}:${shown.fulfillment}`} data={data} sourcePeriod={sourcePeriod} selectedPOPeriod={selectedPOPeriod} />
            </Suspense>

            <div className="grid gap-6 xl:grid-cols-2">
              <DataTableCard
                title="Pelanggan Teratas"
                subtitle="Pelanggan dengan kontribusi nilai PO terbesar pada filter ini."
              >
                <div className="max-w-full overflow-x-auto" role="region" aria-label="Tabel Pelanggan Teratas" tabIndex={0}>
                  <table className="w-full min-w-[32rem] text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50 text-left text-[13px] uppercase tracking-wide text-gray-500">
                        <th className="px-4 py-3">#</th>
                        <th className="px-4 py-3">Pelanggan</th>
                        <th className="px-4 py-3 text-right">Total PO</th>
                        <th className="px-4 py-3 text-right">Terkirim</th>
                        <th className="px-4 py-3 text-right">% Terkirim</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topCustomers.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-10 text-center text-sm text-brand-secondary">Belum ada pelanggan pada filter ini.</td>
                        </tr>
                      )}
                      {data.topCustomers.map(item => (
                        <tr key={item.rank} className="border-b border-gray-50">
                          <td className="px-4 py-3 text-gray-500">{item.rank}</td>
                          <td className="max-w-[20rem] px-4 py-3 font-medium text-gray-900 [overflow-wrap:anywhere]">{item.name}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{formatCompactCurrency(item.poValue)}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{formatCompactCurrency(item.deliveredValue)}</td>
                          <td className="px-4 py-3 text-right">
                            <StatusBadge tone="neutral">{formatPercent(item.fulfillmentRate)}</StatusBadge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </DataTableCard>

              <DataTableCard
                title="Rincian Barang Belum Terkirim"
                subtitle={`Sisa barang dari sumber PO ${sourcePeriod} sesuai status PO, tanpa filter status pengiriman. Dapat mencakup PO di luar tanggal awal ringkasan.`}
              >
                <div className="max-w-full overflow-x-auto" role="region" aria-label="Tabel Rincian Barang Belum Terkirim" tabIndex={0}>
                  <table className="w-full min-w-[36rem] text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50 text-left text-[13px] uppercase tracking-wide text-gray-500">
                        <th className="px-4 py-3">#</th>
                        <th className="px-4 py-3">SKU</th>
                        <th className="px-4 py-3">Nama Barang</th>
                        <th className="px-4 py-3 text-right">Belum terkirim</th>
                        <th className="px-4 py-3 text-right">Nilai</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.outstandingItems.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-10 text-center text-sm text-brand-secondary">Tidak ada outstanding item pada filter ini.</td>
                        </tr>
                      )}
                      {data.outstandingItems.map(item => (
                        <tr key={`${item.sku}-${item.rank}`} className="border-b border-gray-50">
                          <td className="px-4 py-3 text-gray-500">{item.rank}</td>
                          <td className="max-w-[12rem] px-4 py-3 font-mono text-sm text-gray-500 [overflow-wrap:anywhere]">{item.sku}</td>
                          <td className="max-w-[20rem] px-4 py-3 font-medium text-gray-900 [overflow-wrap:anywhere]">{item.productName}</td>
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
      </MainContent>
    </div>
  )
}
