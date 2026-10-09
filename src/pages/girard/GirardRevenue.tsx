import { usePagedRead } from '../../lib/reads/usePagedRead'
import { fetchRevenuePage } from '../../lib/reads/reports'
import type { CustomerRevenue } from '../../lib/reads/contracts'
import { formatMoney, moneyPercentage } from '../../lib/reads/money'
import PaginationControls from '../../components/PaginationControls'
import GirardNav from '../../components/GirardNav'

const PERIODS = [
  { value: '30d', label: '30 hari terakhir' },
  { value: '90d', label: '90 hari terakhir' },
  { value: '1y',  label: 'Setahun terakhir' },
]

function RevenueSummaryCards({
  totalSales, totalOrders, topCustomer, revenueLength
}: {
  totalSales: string
  totalOrders: number
  topCustomer: CustomerRevenue | null
  revenueLength: number
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-xs text-gray-400 mb-1">Total Penjualan</p>
        <p className="text-2xl font-bold text-gray-900">
          Rp {formatMoney(totalSales, 'millions')}M
        </p>
        <p className="text-xs text-gray-400 mt-1">dari {totalOrders} pesanan</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-xs text-gray-400 mb-1">Pelanggan Aktif</p>
        <p className="text-2xl font-bold text-gray-900">{revenueLength}</p>
        <p className="text-xs text-gray-400 mt-1">dengan pesanan dalam periode</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-xs text-gray-400 mb-1">Pelanggan Teratas</p>
        <p className="text-base font-bold text-gray-900 truncate">
          {topCustomer?.customer_name ?? '—'}
        </p>
        {topCustomer && (
          <p className="text-xs text-gray-400 mt-1">
            Rp {formatMoney(topCustomer.total_sales, 'millions')}M
          </p>
        )}
      </div>
    </div>
  )
}

function RevenueTable({
  revenue, totalSales, offset
}: {
  revenue: CustomerRevenue[]
  offset: number
  totalSales: string
}) {
  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-medium text-gray-900">Penjualan per Pelanggan</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-5 py-3 font-medium text-gray-500">Peringkat</th>
              <th className="text-left px-5 py-3 font-medium text-gray-500">Pelanggan</th>
              <th className="text-left px-5 py-3 font-medium text-gray-500">Penanggung Jawab Toko</th>
              <th className="text-center px-5 py-3 font-medium text-gray-500">Pesanan</th>
              <th className="text-left px-5 py-3 font-medium text-gray-500">Pesanan Terakhir</th>
              <th className="text-right px-5 py-3 font-medium text-gray-500">Total Penjualan</th>
              <th className="text-right px-5 py-3 font-medium text-gray-500">Porsi</th>
            </tr>
          </thead>
          <tbody>
            {revenue.map((r, i) => (
              <tr key={r.customer_id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-5 py-4">
                  <span className={`text-sm font-bold ${
                    i + offset === 0 ? 'text-yellow-500'
                    : i + offset === 1 ? 'text-gray-400'
                    : i + offset === 2 ? 'text-orange-400'
                    : 'text-gray-300'
                  }`}>
                    #{i + offset + 1}
                  </span>
                </td>
                <td className="px-5 py-4 font-medium text-gray-900">{r.customer_name}</td>
                <td className="px-5 py-4 text-gray-600">{r.manager_name ?? '—'}</td>
                <td className="px-5 py-4 text-center text-gray-700">{r.order_count}</td>
                <td className="px-5 py-4 text-gray-600 text-xs">
                  {r.last_order_date
                    ? new Date(r.last_order_date).toLocaleDateString('id-ID', {
                        day: 'numeric', month: 'short', year: 'numeric'
                      })
                    : '—'}
                </td>
                <td className="px-5 py-4 text-right font-semibold text-gray-900">
                  Rp {formatMoney(r.total_sales, 'millions')}M
                </td>
                <td className="px-5 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 bg-gray-100 rounded-full h-1.5">
                      <div
                        className="bg-green-500 h-1.5 rounded-full"
                        style={{ width: `${moneyPercentage(r.total_sales, totalSales, 1)}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 w-8 text-right">
                      {moneyPercentage(r.total_sales, totalSales)}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50">
              <td colSpan={5} className="px-5 py-3 text-right text-sm text-gray-500 font-medium">
                Total
              </td>
              <td className="px-5 py-3 text-right font-bold text-gray-900">
                Rp {formatMoney(totalSales, 'millions')}M
              </td>
              <td className="px-5 py-3 text-right text-xs text-gray-400">100%</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {revenue.map((r, i) => (
          <div key={r.customer_id} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${
                    i + offset === 0 ? 'text-yellow-500'
                    : i + offset === 1 ? 'text-gray-400'
                    : i + offset === 2 ? 'text-orange-400'
                    : 'text-gray-300'
                  }`}>#{i + offset + 1}</span>
                  <p className="font-semibold text-gray-900 truncate">{r.customer_name}</p>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">{r.manager_name ?? 'Belum ditugaskan'}</p>
              </div>
              <p className="font-bold text-gray-900 ml-3 shrink-0">
                Rp {formatMoney(r.total_sales, 'millions')}M
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                <div
                  className="bg-green-500 h-1.5 rounded-full"
                  style={{ width: `${moneyPercentage(r.total_sales, totalSales, 1)}%` }}
                />
              </div>
              <span className="text-xs text-gray-500">
                {moneyPercentage(r.total_sales, totalSales)}%
              </span>
              <span className="text-xs text-gray-400">•</span>
              <span className="text-xs text-gray-400">{r.order_count} pesanan</span>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

export default function GirardRevenue() {
  return <div className="min-h-screen bg-brand-canvas"><GirardNav /><RevenueContent /></div>
}
export function RevenueContent() {
  const { data, filters, setFilters, setPage, isPending, isError, refetch } = usePagedRead('revenue', { period: '30d' }, (filters, page, signal) => fetchRevenuePage(filters.period, page, signal))
  return <div className="px-4 md:px-8 py-6 space-y-6">
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div><h2 className="text-lg font-semibold text-gray-900">Penjualan dari Lapangan</h2><p className="text-sm text-gray-500 mt-0.5">Penjualan dari pesanan sales lapangan</p></div>
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">{PERIODS.map(period => <button key={period.value} onClick={() => setFilters({ period: period.value })} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${filters.period === period.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{period.label}</button>)}</div>
    </div>
    {isError ? <div role="alert" className="text-red-600">Data penjualan tidak tersedia. <button onClick={() => refetch()} className="underline">Coba lagi</button></div> : !data ? <p className="text-center text-gray-400 text-sm py-12">Memuat data penjualan...</p> : <>
      <PaginationControls page={data.page} total={data.total} pageSize={data.page_size} pending={isPending} onPageChange={setPage} />
      <RevenueSummaryCards totalSales={data.summary.total_sales} totalOrders={data.summary.total_orders} topCustomer={data.summary.top_customer} revenueLength={data.summary.active_customers} />
      {data.items.length === 0 ? <div className="text-center py-12"><p className="text-gray-400 text-sm">Tidak ada data penjualan untuk periode ini.</p><p className="text-gray-300 text-xs mt-1">Pesanan perlu disetujui untuk muncul di sini.</p></div> : <RevenueTable revenue={data.items} totalSales={data.summary.total_sales} offset={(data.page - 1) * data.page_size} />}
    </>}
  </div>
}
