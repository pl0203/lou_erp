import { useState } from 'react'
import { usePagedRead } from '../../lib/reads/usePagedRead'
import { fetchSalesOrderPage } from '../../lib/reads/orders'
import type { SalesStatusFilter } from '../../lib/reads/contracts'
import { formatMoney } from '../../lib/reads/money'
import PaginationControls from '../../components/PaginationControls'
import SalesOrderItems from '../../components/SalesOrderItems'
import GirardNav from '../../components/GirardNav'

const STATUS_STYLES: Record<string, string> = {
  pending:  'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-700',
}

const STATUS_LABELS: Record<string, string> = {
  pending:  'Menunggu Persetujuan',
  approved: 'Disetujui',
  rejected: 'Ditolak',
  cancelled: 'PO Dibatalkan',
}

export default function MyOrders() {
  const [expanded, setExpanded] = useState<string[]>([])
  const { data, filters, setFilters, setPage, isPending, isError, refetch } = usePagedRead('my_orders', { status: 'all' as SalesStatusFilter, ownOnly: true }, fetchSalesOrderPage)
  const statusFilter = filters.status
  const setStatusFilter = (status: string) => setFilters({ status: status as SalesStatusFilter, ownOnly: true })
  const orders = data?.items
  const isLoading = !data && isPending
  const pendingCount = data?.status_counts.pending ?? 0
  const approvedCount = data?.status_counts.approved ?? 0
  const rejectedCount = data?.status_counts.rejected ?? 0

  return (
    <div className="min-h-screen bg-gray-50">
      <GirardNav />

      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5">
        <h1 className="text-xl font-semibold text-gray-900">Pesanan Saya</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Pesanan yang Anda ajukan
        </p>
      </div>

      {/* Summary pills */}
      {!isLoading && !isError && <div className="bg-white border-b border-gray-100 px-4 md:px-8 py-3 flex gap-3 flex-wrap">
        <div className="text-xs bg-yellow-100 text-yellow-700 px-3 py-1.5 rounded-full font-medium">
          {pendingCount} menunggu
        </div>
        <div className="text-xs bg-green-100 text-green-700 px-3 py-1.5 rounded-full font-medium">
          {approvedCount} disetujui
        </div>
        <div className="text-xs bg-red-100 text-red-600 px-3 py-1.5 rounded-full font-medium">
          {rejectedCount} ditolak
        </div>
      </div>}

      {/* Filter tabs */}
      <div className="bg-white border-b border-gray-100 px-4 md:px-8">
        <div className="flex gap-1">
          {[
            { value: 'all',      label: 'Semua' },
            { value: 'pending',  label: 'Menunggu' },
            { value: 'approved', label: 'Disetujui' },
            { value: 'rejected', label: 'Ditolak' },
            { value: 'cancelled', label: 'Dibatalkan' },
          ].map(tab => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                statusFilter === tab.value
                  ? 'border-green-600 text-green-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 md:px-8 py-6 max-w-2xl mx-auto space-y-4">
        {!isError && data && <PaginationControls page={data.page} total={data.total} pageSize={data.page_size} pending={isPending} onPageChange={setPage} />}
        {isLoading && (
          <div className="text-center text-gray-400 text-sm py-24">Memuat pesanan...</div>
        )}

        {isError && <div role="alert" className="text-center text-red-600 text-sm py-8">
          <p>Gagal memuat pesanan. Data belum dapat ditampilkan.</p>
          <button onClick={() => refetch()} className="mt-2 underline">Coba lagi</button>
        </div>}

        {!isLoading && !isError && (!orders || orders.length === 0) && (
          <div className="text-center py-24">
            <p className="text-gray-400 text-sm">Tidak ada pesanan ditemukan.</p>
            <p className="text-gray-300 text-xs mt-1">
              Pesanan yang Anda buat saat kunjungan pelanggan akan muncul di sini.
            </p>
          </div>
        )}

        {!isError && orders?.map(order => (
          <div key={order.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 truncate">
                    {order.customers?.name ?? '—'}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(order.created_at).toLocaleDateString('id-ID', {
                      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
                    })}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${STATUS_STYLES[order.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {STATUS_LABELS[order.status] ?? order.status}
                  </span>
                  <p className="text-sm font-semibold text-gray-900">
                    Rp {formatMoney(order.total_value, 'full')}
                  </p>
                </div>
              </div>

              {/* Rejection note */}
              {order.status === 'rejected' && order.rejection_note && (
                <div className="mt-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  <p className="text-xs text-red-600 font-medium mb-0.5">Alasan penolakan</p>
                  <p className="text-xs text-red-500">{order.rejection_note}</p>
                </div>
              )}

              {/* Pending message */}
              {order.status === 'pending' && (
                <div className="mt-3 bg-yellow-50 border border-yellow-100 rounded-lg px-3 py-2">
                  <p className="text-xs text-yellow-700">
                    Pesanan ini sedang menunggu persetujuan dari admin PO.
                  </p>
                </div>
              )}

              {/* Approved message */}
              {order.status === 'approved' && (
                <div className="mt-3 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                  <p className="text-xs text-green-700">
                    Pesanan ini telah disetujui dan PO telah dibuat.
                  </p>
                </div>
              )}
            </div>

            <div className="px-5 py-3">
              <button type="button" aria-expanded={expanded.includes(order.id)} onClick={() => setExpanded(previous => previous.includes(order.id) ? previous.filter(id => id !== order.id) : [...previous, order.id])} className="text-xs font-medium text-green-600">{expanded.includes(order.id) ? 'Sembunyikan barang' : 'Lihat barang'}</button>
              {expanded.includes(order.id) && <SalesOrderItems orderId={order.id} />}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
