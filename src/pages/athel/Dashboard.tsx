import { calendarDateKey } from '../../lib/calendarDate'
import { lazy, Suspense, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchDashboardData } from '../../lib/reads/reports'
export { displayDay, rangeDays, rollingMonthKeys } from '../../lib/reads/reports'
export type { DashboardData } from '../../lib/reads/reports'
import { formatMoney, formatCompactMoney, moneyPercentage } from '../../lib/reads/money'
import AthelNav from '../../components/AthelNav'

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
    <div className="rounded-2xl border border-blue-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-gray-900">{value}</p>
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
    <div className="min-w-0 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
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

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['athel_dashboard', startDate, endDate, status, fulfillment],
    queryFn: ({ signal }) => fetchDashboardData(startDate, endDate, status, fulfillment, signal),
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
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-6 py-20 text-center text-sm text-red-500 shadow-sm">
            Gagal memuat dashboard. <button onClick={() => refetch()} className="underline">Coba lagi</button>
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
                helper={`${moneyPercentage(data.metrics.deliveredValue, data.metrics.totalPOValue, 1)}% dari total nilai PO`}
              />
              <StatCard
                label="Outstanding Value"
                value={formatCurrency(data.metrics.outstandingValue)}
                helper="Nilai item yang masih belum terpenuhi"
              />
              <StatCard
                label="Rata-rata Nilai PO"
                value={formatCurrency(data.metrics.averagePOValue)}
                helper={`${data.metrics.completedPOCount} PO selesai pada filter ini`}
              />
            </div>

            <Suspense fallback={<div role="status" className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">Memuat grafik...</div>}>
              <DashboardCharts key={`${startDate}:${endDate}:${status}:${fulfillment}`} data={data} />
            </Suspense>

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
