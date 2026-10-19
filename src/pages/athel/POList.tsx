import { POListSkeleton } from '../../components/ui/LoadingSkeletons'
import { Field } from '../../components/ui/Field'
import { Button } from '../../components/ui/Button'
import { ActionLink } from '../../components/ui/ActionLink'
import { MainContent } from '../../components/ui/MainContent'
import { PO_STATUS_LABELS } from '../../lib/orderPresentation'
import { formatDisplayDate } from '../../lib/displayDate'
import { useEffect, useState } from 'react'
import { fetchPOPage } from '../../lib/reads/orders'
import type { POStatusFilter } from '../../lib/reads/contracts'
import { usePagedRead } from '../../lib/reads/usePagedRead'
import { formatMoney } from '../../lib/reads/money'
import PaginationControls from '../../components/PaginationControls'
import AthelNav from '../../components/AthelNav'

const STATUS_STYLES: Record<string, string> = {
  confirm:     'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  complete:    'bg-green-100 text-green-700',
  cancelled:   'bg-gray-200 text-brand-secondary',
}

async function fetchPresentedPOPage(filters: { status: POStatusFilter; search: string }, page: number, signal: AbortSignal) {
  return { ...await fetchPOPage(filters, page, signal), appliedFilters: filters }
}

export default function POList() {
  const [search, setSearch] = useState('')
  const { data, filters, setFilters, setPage, isPending, isError, refetch } = usePagedRead('purchase_orders', { status: 'all' as POStatusFilter, search: '' }, fetchPresentedPOPage)
  useEffect(() => {
    const timer = setTimeout(() => setFilters(previous => previous.search === search ? previous : { ...previous, search }), 300)
    return () => clearTimeout(timer)
  }, [search, setFilters])
  const pos = data?.items ?? []
  const totalItems = data?.total
  const isLoading = !data && isPending

  return (
    <div className="min-h-screen bg-brand-canvas">
      <AthelNav />
      <MainContent>

      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Pesanan Pembelian</h1>
          <p className="text-sm text-brand-secondary mt-0.5">{isError ? 'Data tidak tersedia' : totalItems === undefined ? 'Memuat pesanan…' : `${totalItems} pesanan`}</p>
        </div>
        <ActionLink variant="primary" to={'/athel/po/new'}

        >+ PO Baru</ActionLink>
      </div>

      <div className="px-4 md:px-8 py-3 flex flex-col sm:flex-row gap-2 bg-white border-b border-gray-100">
        <Field id="po-list-search" label="Cari PO" className="w-full sm:w-80">{control => <input {...control}
          type="text"
          placeholder="Cari nomor PO, pelanggan, atau SJ..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full focus:outline-none focus:ring-2 focus:ring-brand-primary"
        />}</Field>
        <Field id="po-list-status" label="Status PO" className="w-full sm:w-48">{control => <select {...control}
          value={filters.status}
          onChange={e => setFilters(previous => ({ ...previous, status: e.target.value as POStatusFilter }))}
          className="focus:outline-none focus:ring-2 focus:ring-brand-primary"
        >
          <option value="all">Semua status</option>
          <option value="confirm">Dikonfirmasi</option>
          <option value="in_progress">Dalam proses</option>
          <option value="complete">Selesai</option>
        </select>}</Field>
      </div>

      <div className="px-4 md:px-8 py-6">
        <p role="status" aria-live="polite" aria-atomic="true" className="min-h-5 text-sm text-brand-secondary">
          {isLoading ? 'Memuat pesanan pembelian...' : !isError && data && isPending ? `Hasil sebelumnya: ${({ all: 'Semua status', ...PO_STATUS_LABELS })[data.appliedFilters.status]} · ${data.appliedFilters.search ? `Pencarian “${data.appliedFilters.search}”` : 'Tanpa pencarian'} · Halaman ${data.page}. Memperbarui…` : ''}
        </p>
        {!isError && data && <PaginationControls page={data.page} total={data.total} pageSize={data.page_size} pending={isPending} announcePending={false} onPageChange={setPage} />}
        {isLoading && (
          <POListSkeleton />
        )}
        {isError && (
          <div role="alert" className="text-center text-red-700 py-24 text-sm">Gagal memuat data. Periksa koneksi Anda. <Button variant="secondary" onClick={() => refetch()} >Coba lagi</Button></div>
        )}
        {!isLoading && !isError && pos.length === 0 && (
          <div className="text-center text-brand-secondary py-24 text-sm">Tidak ada pesanan pembelian ditemukan.</div>
        )}

        {!isLoading && !isError && pos.length > 0 && (
          <>
            {/* Desktop table */}
            <p className="hidden md:block mb-2 text-[13px] text-gray-600">Geser tabel untuk melihat semua kolom; kolom Aksi tetap terlihat di kanan.</p>
            <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-x-auto" role="region" aria-label="Daftar pesanan pembelian" tabIndex={0}>
              <table className="w-full min-w-[56rem] text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-5 py-3 font-medium text-brand-secondary">Nomor PO</th>
                    <th className="text-left px-5 py-3 font-medium text-brand-secondary">Pelanggan</th>
                    <th className="text-left px-5 py-3 font-medium text-brand-secondary">Status</th>
                    <th className="text-left px-5 py-3 font-medium text-brand-secondary">Tanggal Pesanan</th>
                    <th className="text-left px-5 py-3 font-medium text-brand-secondary">Tanggal Kedaluwarsa PO</th>
                    <th className="text-right px-5 py-3 font-medium text-brand-secondary">Total Nilai</th>
                    <th className="sticky right-0 z-10 bg-gray-50 text-right px-5 py-3 font-medium text-gray-700 shadow-[-4px_0_6px_-4px_#9ca3af]">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {pos.map(po => (
                    <tr key={po.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="min-w-36 px-5 py-4 font-medium text-gray-900">{po.po_number}</td>
                      <td className="min-w-48 max-w-72 px-5 py-4 text-gray-700 break-words">{po.customers?.name ?? '—'}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[13px] font-medium ${STATUS_STYLES[po.status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {PO_STATUS_LABELS[po.status] ?? po.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-gray-600">{formatDisplayDate(po.order_date)}</td>
                      <td className="px-5 py-4 text-gray-600">{formatDisplayDate(po.expected_delivery_date)}</td>
                      <td className="px-5 py-4 text-right text-gray-900 font-medium">
                        Rp {formatMoney(po.total_value, 'full')}
                      </td>
                      <td className="sticky right-0 z-10 min-w-48 max-w-52 bg-white px-5 py-4 text-right shadow-[-4px_0_6px_-4px_#9ca3af]">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <ActionLink variant="quiet" size="compact" to={`/athel/po/${po.id}`}>Lihat</ActionLink>
                          {!['confirm', 'in_progress'].includes(po.status) && <span className="text-[13px] text-brand-secondary">{po.status === 'cancelled' ? 'PO dibatalkan: tidak dapat diubah' : po.status === 'complete' ? 'PO selesai: tidak dapat diubah' : 'Status PO tidak dapat diubah'}</span>}
                          {['confirm', 'in_progress'].includes(po.status) && (
                            <ActionLink variant="secondary" size="compact" to={`/athel/po/${po.id}/edit`}>Ubah</ActionLink>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {pos.map(po => (
                <div key={po.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="min-w-0 [overflow-wrap:anywhere]">
                      <p className="font-semibold text-gray-900 text-sm">{po.po_number}</p>
                      <p className="text-[13px] text-brand-secondary mt-0.5">{po.customers?.name ?? '—'}</p>
                    </div>
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[13px] font-medium shrink-0 ${STATUS_STYLES[po.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {PO_STATUS_LABELS[po.status] ?? po.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[13px] mb-3">
                    <div>
                      <p className="text-brand-secondary">Tanggal Pesanan</p>
                      <p className="text-gray-700 font-medium">{formatDisplayDate(po.order_date)}</p>
                    </div>
                    <div>
                      <p className="text-brand-secondary">Tanggal Kedaluwarsa PO</p>
                      <p className="text-gray-700 font-medium">{formatDisplayDate(po.expected_delivery_date)}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-brand-secondary">Total Nilai</p>
                      <p className="text-gray-900 font-semibold [overflow-wrap:anywhere]">Rp {formatMoney(po.total_value, 'full')}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-gray-100">
                    <ActionLink variant="quiet" size="compact" to={`/athel/po/${po.id}`}>Lihat</ActionLink>
                    {!['confirm', 'in_progress'].includes(po.status) && <span className="text-[13px] text-brand-secondary">{po.status === 'cancelled' ? 'PO dibatalkan: tidak dapat diubah' : po.status === 'complete' ? 'PO selesai: tidak dapat diubah' : 'Status PO tidak dapat diubah'}</span>}
                    {['confirm', 'in_progress'].includes(po.status) && (
                      <ActionLink variant="secondary" size="compact" to={`/athel/po/${po.id}/edit`}>Ubah</ActionLink>
                    )}
                  </div>
                </div>
              ))}
            </div>

          </>
        )}
      </div>
      </MainContent>
    </div>
  )
}
