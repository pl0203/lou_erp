import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import GirardNav from '../../components/GirardNav'

type CustomerRevenue = {
  customer_id: string
  customer_name: string
  manager_name: string | null
  order_count: number
  total_sales: number
  last_order_date: string | null
}

function getDateRange(period: string): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  if (period === '30d') from.setDate(from.getDate() - 30)
  else if (period === '90d') from.setDate(from.getDate() - 90)
  else if (period === '1y') from.setFullYear(from.getFullYear() - 1)
  return {
    from: from.toISOString().split('T')[0],
    to: to.toISOString().split('T')[0],
  }
}

async function fetchRevenue(period: string): Promise<CustomerRevenue[]> {
  const { from, to } = getDateRange(period)

  const { data: orders, error } = await supabase
    .from('girard_orders')
    .select('id, customer_id, total_value, created_at, status')
    .gte('created_at', `${from}T00:00:00`)
    .lte('created_at', `${to}T23:59:59`)
    .eq('status', 'approved')
  if (error) throw error

  const { data: customers } = await supabase
    .from('customers')
    .select('id, name')
  
  const { data: assignments } = await supabase
    .from('customer_manager_assignments')
    .select('customer_id, users!customer_manager_assignments_manager_id_fkey(full_name)')

  const customerMap = Object.fromEntries((customers ?? []).map(c => [c.id, c.name]))
  const assignmentMap = Object.fromEntries(
    (assignments ?? []).map(a => [a.customer_id, (a as any).users?.full_name])
  )

  const revenueMap: Record<string, CustomerRevenue> = {}
  for (const order of orders ?? []) {
    if (!revenueMap[order.customer_id]) {
      revenueMap[order.customer_id] = {
        customer_id: order.customer_id,
        customer_name: customerMap[order.customer_id] ?? 'Unknown',
        manager_name: assignmentMap[order.customer_id] ?? null,
        order_count: 0,
        total_sales: 0,
        last_order_date: null,
      }
    }
    revenueMap[order.customer_id].order_count++
    revenueMap[order.customer_id].total_sales += order.total_value ?? 0
    if (!revenueMap[order.customer_id].last_order_date ||
        order.created_at > revenueMap[order.customer_id].last_order_date!) {
      revenueMap[order.customer_id].last_order_date = order.created_at
    }
  }

  return Object.values(revenueMap).sort((a, b) => b.total_sales - a.total_sales)
}

const PERIODS = [
  { value: '30d', label: '30 hari terakhir' },
  { value: '90d', label: '90 hari terakhir' },
  { value: '1y', label: 'Setahun terakhir' },
]

export default function GirardRevenue() {
  const [period, setPeriod] = useState('30d')

  const { data: revenue, isLoading } = useQuery({
    queryKey: ['revenue', period],
    queryFn: () => fetchRevenue(period),
  })

  const totalSales = revenue?.reduce((sum, r) => sum + r.total_sales, 0) ?? 0
  const totalOrders = revenue?.reduce((sum, r) => sum + r.order_count, 0) ?? 0
  const topCustomer = revenue?.[0]

  return (
    <div className="min-h-screen bg-gray-50">
      <GirardNav />

      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Penjualan</h1>
          <p className="text-sm text-gray-500 mt-0.5">Penjualan dari pesanan sales lapangan</p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                period === p.value
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 md:px-8 py-6 space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs text-gray-400 mb-1">Total Penjualan</p>
            <p className="text-2xl font-bold text-gray-900">
              Rp {(totalSales / 1_000_000).toFixed(1)}M
            </p>
            <p className="text-xs text-gray-400 mt-1">dari {totalOrders} pesanan</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs text-gray-400 mb-1">Pelanggan Aktif</p>
            <p className="text-2xl font-bold text-gray-900">{revenue?.length ?? 0}</p>
            <p className="text-xs text-gray-400 mt-1">dengan pesanan dalam periode</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs text-gray-400 mb-1">Pelanggan Teratas</p>
            <p className="text-base font-bold text-gray-900 truncate">
              {topCustomer?.customer_name ?? '—'}
            </p>
            {topCustomer && (
              <p className="text-xs text-gray-400 mt-1">
                Rp {(topCustomer.total_sales / 1_000_000).toFixed(1)}M
              </p>
            )}
          </div>
        </div>

        {/* Penjualan by customer */}
        {isLoading && (
          <div className="text-center text-gray-400 text-sm py-12">Memuat data penjualan...</div>
        )}

        {!isLoading && (!revenue || revenue.length === 0) && (
          <div className="text-center py-12">
            <p className="text-gray-400 text-sm">Tidak ada data penjualan untuk periode ini.</p>
            <p className="text-gray-300 text-xs mt-1">Pesanan perlu disetujui untuk muncul di sini.</p>
          </div>
        )}

        {!isLoading && revenue && revenue.length > 0 && (
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
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Manajer</th>
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
                          i === 0 ? 'text-yellow-500'
                          : i === 1 ? 'text-gray-400'
                          : i === 2 ? 'text-orange-400'
                          : 'text-gray-300'
                        }`}>
                          #{i + 1}
                        </span>
                      </td>
                      <td className="px-5 py-4 font-medium text-gray-900">{r.customer_name}</td>
                      <td className="px-5 py-4 text-gray-600">{r.manager_name ?? '—'}</td>
                      <td className="px-5 py-4 text-center text-gray-700">{r.order_count}</td>
                      <td className="px-5 py-4 text-gray-600 text-xs">
                        {r.last_order_date
                          ? new Date(r.last_order_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
                          : '—'}
                      </td>
                      <td className="px-5 py-4 text-right font-semibold text-gray-900">
                        Rp {(r.total_sales / 1_000_000).toFixed(2)}M
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 bg-gray-100 rounded-full h-1.5">
                            <div
                              className="bg-green-500 h-1.5 rounded-full"
                              style={{ width: `${totalSales > 0 ? (r.total_sales / totalSales) * 100 : 0}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-500 w-8 text-right">
                            {totalSales > 0 ? Math.round((r.total_sales / totalSales) * 100) : 0}%
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
                      Rp {(totalSales / 1_000_000).toFixed(2)}M
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
                          i === 0 ? 'text-yellow-500'
                          : i === 1 ? 'text-gray-400'
                          : i === 2 ? 'text-orange-400'
                          : 'text-gray-300'
                        }`}>#{i + 1}</span>
                        <p className="font-semibold text-gray-900 truncate">{r.customer_name}</p>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{r.manager_name ?? 'No manager'}</p>
                    </div>
                    <p className="font-bold text-gray-900 ml-3 shrink-0">
                      Rp {(r.total_sales / 1_000_000).toFixed(1)}M
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                      <div
                        className="bg-green-500 h-1.5 rounded-full"
                        style={{ width: `${totalSales > 0 ? (r.total_sales / totalSales) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500">
                      {totalSales > 0 ? Math.round((r.total_sales / totalSales) * 100) : 0}%
                    </span>
                    <span className="text-xs text-gray-400">•</span>
                    <span className="text-xs text-gray-400">{r.order_count} orders</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}