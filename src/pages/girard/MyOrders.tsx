import { PageHeader } from '../../components/ui/PageHeader'
import { Button } from '../../components/ui/Button'
import { FilterBar } from '../../components/ui/FilterBar'
import { EmptyState, Notice, StatusBadge } from '../../components/ui/Feedback'
import { RecordList } from '../../components/ui/RecordList'
import { MainContent } from '../../components/ui/MainContent'
import { useState } from 'react'
import { usePagedRead } from '../../lib/reads/usePagedRead'
import { fetchSalesOrderPage } from '../../lib/reads/orders'
import type { SalesStatusFilter } from '../../lib/reads/contracts'
import { formatMoney } from '../../lib/reads/money'
import PaginationControls from '../../components/PaginationControls'
import SalesOrderItems from '../../components/SalesOrderItems'
import GirardNav from '../../components/GirardNav'

const STATUS_TONES = {
  pending: 'warning', approved: 'success', rejected: 'error', cancelled: 'neutral',
} as const

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
    <div className="min-h-screen bg-brand-canvas">
      <GirardNav />
      <MainContent>

      <PageHeader title="Riwayat Pesanan Saya" description="Riwayat pengajuan lama Anda. Pencatatan pesanan baru ditangani oleh Admin PO."
        className="bg-white border-b border-brand-divider px-4 md:px-8 py-5" />

      <section aria-labelledby="order-handoff-title" className="mx-4 md:mx-8 my-4 rounded-xl border border-brand-control-border bg-brand-canvas p-4 text-base text-brand-primary">
        <h2 id="order-handoff-title" className="font-semibold">Pesanan baru: serahkan ke Admin PO</h2>
        <p className="mt-1">Sampaikan detail pesanan kepada Admin PO melalui saluran kerja yang biasa digunakan. Admin PO akan mencatatnya di modul Pengadaan.</p>
        <ul className="mt-2 list-disc pl-5 space-y-1">
          <li>Nama pelanggan dan cabang, nomor atau dokumen PO pelanggan</li>
          <li>Tanggal PO, batas berlaku bila ada, serta catatan pengiriman</li>
          <li>SKU atau nama barang, jumlah, dan harga yang disepakati</li>
        </ul>
        <p className="mt-2">Halaman ini hanya menampilkan riwayat pengajuan lama; detail di atas perlu Anda teruskan sendiri kepada Admin PO.</p>
      </section>

      {/* Counts are the complete authorized status summary, never visible-row counts. */}
      {!isLoading && !isError && <div className="bg-white border-b border-brand-divider px-4 md:px-8 py-3 flex gap-3 flex-wrap">
        <StatusBadge tone="warning">{pendingCount} menunggu</StatusBadge>
        <StatusBadge tone="success">{approvedCount} disetujui</StatusBadge>
        <StatusBadge tone="error">{rejectedCount} ditolak</StatusBadge>
      </div>}

      <FilterBar label="Filter riwayat pesanan" className="mx-4 my-4 md:mx-8">
        {[
          { value: 'all', label: 'Semua' },
          { value: 'pending', label: 'Menunggu' },
          { value: 'approved', label: 'Disetujui' },
          { value: 'rejected', label: 'Ditolak' },
          { value: 'cancelled', label: 'Dibatalkan' },
        ].map(tab => <Button key={tab.value} variant="secondary" aria-pressed={statusFilter === tab.value}
          onClick={() => setStatusFilter(tab.value)} className={statusFilter === tab.value ? 'border-brand-accent underline decoration-brand-primary underline-offset-4' : undefined}>
          {tab.label}
        </Button>)}
      </FilterBar>

      <div className="px-4 md:px-8 py-6 max-w-2xl mx-auto space-y-4">
        {!isError && data && <PaginationControls page={data.page} total={data.total} pageSize={data.page_size} pending={isPending} onPageChange={setPage} />}
        {isLoading && (
          <Notice tone="info" title="Memuat pesanan..." />
        )}

        {isError && <Notice tone="error" title="Gagal memuat pesanan. Data belum dapat ditampilkan."
          actions={<Button variant="secondary" onClick={() => { void refetch() }}>Coba lagi</Button>} />}

        {!isLoading && !isError && (!orders || orders.length === 0) && (
          <EmptyState title="Tidak ada pesanan ditemukan.">Riwayat pesanan dari kunjungan sebelumnya akan muncul di sini.</EmptyState>
        )}

        {!isError && orders && orders.length > 0 && <RecordList label="Riwayat pesanan">{orders.map(order => (
          <li key={order.id} className="bg-white rounded-[14px] border border-brand-divider overflow-hidden shadow-sm">
            {/* Header */}
            <div className="px-5 py-4 border-b border-brand-divider">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-brand-primary [overflow-wrap:anywhere]">
                    {order.customers?.name ?? '—'}
                  </p>
                  <p className="text-[13px] text-brand-secondary mt-0.5">
                    {new Date(order.created_at).toLocaleDateString('id-ID', {
                      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
                    })}
                  </p>
                </div>
                <div className="flex min-w-0 max-w-full flex-col items-end gap-2">
                  <StatusBadge tone={STATUS_TONES[order.status] ?? 'neutral'}>
                    {STATUS_LABELS[order.status] ?? order.status}
                  </StatusBadge>
                  <p className="text-base font-semibold text-brand-primary [overflow-wrap:anywhere]">
                    Rp {formatMoney(order.total_value, 'full')}
                  </p>
                </div>
              </div>

              {/* Rejection note */}
              {order.status === 'rejected' && order.rejection_note && (
                <div className="mt-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  <p className="text-[13px] text-red-700 font-medium mb-0.5">Alasan penolakan</p>
                  <p className="text-[13px] text-red-700">{order.rejection_note}</p>
                </div>
              )}

              {/* Pending message */}
              {order.status === 'pending' && (
                <div className="mt-3 bg-yellow-50 border border-yellow-100 rounded-lg px-3 py-2">
                  <p className="text-[13px] text-yellow-700">
                    Pesanan ini sedang menunggu persetujuan dari admin PO.
                  </p>
                </div>
              )}

              {/* Approved message */}
              {order.status === 'approved' && (
                <div className="mt-3 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                  <p className="text-[13px] text-green-700">
                    Pesanan ini telah disetujui dan PO telah dibuat.
                  </p>
                </div>
              )}
            </div>

            <div className="px-5 py-3">
              <Button variant="secondary" aria-expanded={expanded.includes(order.id)} onClick={() => setExpanded(previous => previous.includes(order.id) ? previous.filter(id => id !== order.id) : [...previous, order.id])} >{expanded.includes(order.id) ? 'Sembunyikan barang' : 'Lihat barang'}</Button>
              {expanded.includes(order.id) && <SalesOrderItems orderId={order.id} />}
            </div>
          </li>
        ))}</RecordList>}
      </div>
      </MainContent>
    </div>
  )
}
