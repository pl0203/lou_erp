import TransactionRecovery from '../../components/TransactionRecovery'
import { useTransactionSender } from '../../lib/orderTransactions'
import type { TransactionSender } from '../../lib/orderTransactions'
import { useRef, useState } from 'react'
import PromoStockWarning, { usePromoStockSubmission } from '../../components/PromoStockWarning'
import ReturnedDateDialog from '../../components/ReturnedDateDialog'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usePagedRead } from '../../lib/reads/usePagedRead'
import { fetchSalesOrderPage } from '../../lib/reads/orders'
import { fetchSalesOrderLines } from '../../lib/reads/detailReads'
import type { SalesOrderSummary, SalesStatusFilter } from '../../lib/reads/contracts'
import { formatMoney } from '../../lib/reads/money'
import PaginationControls from '../../components/PaginationControls'
import SalesOrderItems from '../../components/SalesOrderItems'
import AthelNav from '../../components/AthelNav'
import { useNavigate } from 'react-router-dom'

type GirardOrder = SalesOrderSummary

const STATUS_STYLES: Record<string, string> = {
  pending:  'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-700',
}

type ApprovalDraft = { order_id: string; po_number: string; expected_delivery_date: string | null; promo_stock_ack?: Record<string, unknown> }
async function rejectOrder(orderId: string, note: string, send: TransactionSender) {
  return send('reject_sales', { order_id: orderId, reason: note.trim() })
}

export default function SalesOrders() {
  const queryClient = useQueryClient()
  const sendTransaction = useTransactionSender('review-sales')
  const navigate = useNavigate()
  const approvalTrigger = useRef<HTMLElement | null>(null)
  const approvalBackground = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState<string[]>([])
  const { data, filters, setFilters, setPage, isPending, isError, refetch } = usePagedRead('girard_orders', { status: 'pending' as SalesStatusFilter, ownOnly: false }, fetchSalesOrderPage)
  const statusFilter = filters.status
  const setStatusFilter = (status: string) => setFilters({ status: status as SalesStatusFilter, ownOnly: false })
  const orders = data?.items
  const isLoading = !data && isPending
  const [approvingOrder, setApprovingOrder] = useState<GirardOrder | null>(null)
  const [rejectingOrder, setRejectingOrder] = useState<GirardOrder | null>(null)
  const [poNumber, setPoNumber] = useState('')
  const [expectedDelivery, setExpectedDelivery] = useState('')
  const [rejectionNote, setRejectionNote] = useState('')

  const approvalLines = useQuery({ queryKey: ['sales_order_lines', approvingOrder?.id], queryFn: ({ signal }) => fetchSalesOrderLines(approvingOrder!.id, signal), enabled: !!approvingOrder })

  const approveMutation = useMutation({
    mutationFn: (draft: ApprovalDraft) => sendTransaction('approve_sales', draft),
    onSuccess: (po) => {
      queryClient.invalidateQueries()
      setApprovingOrder(null)
      setPoNumber('')
      setExpectedDelivery('')
      navigate(`/athel/po/${po.id}`)
    },
  })

  const stockSubmission = usePromoStockSubmission<ApprovalDraft>(draft => approveMutation.mutateAsync(draft))
  const closeApproval = () => { if (approveMutation.isPending) return; stockSubmission.cancel(); setApprovingOrder(null); setPoNumber(''); setExpectedDelivery('') }
  const recoverApproval = (result: { id: string }, operation?: string) => { queryClient.invalidateQueries(); stockSubmission.cancel(); setApprovingOrder(null); setRejectingOrder(null); if (operation === 'approve_sales') navigate(`/athel/po/${result.id}`) }

  const rejectMutation = useMutation({
    mutationFn: () => rejectOrder(rejectingOrder!.id, rejectionNote, sendTransaction),
    onSuccess: () => {
      queryClient.invalidateQueries()
      setRejectingOrder(null)
      setRejectionNote('')
    },
  })

  const pendingCount = data?.status_counts.pending ?? 0

  return (
    <div className="min-h-screen bg-brand-canvas">
      <div ref={approvalBackground} inert={!!approvingOrder || !!stockSubmission.warning} aria-hidden={approvingOrder || stockSubmission.warning ? true : undefined}>
      <AthelNav />
      {!approvingOrder && <TransactionRecovery send={sendTransaction} onCommitted={recoverApproval} />}

      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Antrean pesanan Sales lama</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Tinjau pengajuan lama yang masih menunggu. Pesanan baru dibuat melalui Purchase Order di Procurement.
          </p>
        </div>
        {!isLoading && !isError && pendingCount > 0 && statusFilter !== 'pending' && (
          <span className="bg-yellow-100 text-yellow-700 text-xs font-medium px-3 py-1.5 rounded-full">
            {pendingCount} menunggu persetujuan
          </span>
        )}
      </div>

      {/* Filter tabs */}
      <div className="bg-white border-b border-gray-100 px-4 md:px-8">
        <div className="flex gap-1">
          {[
            { value: 'pending',  label: 'Pending' },
            { value: 'approved', label: 'Disetujui' },
            { value: 'rejected', label: 'Ditolak' },
            { value: 'cancelled', label: 'Dibatalkan' },
            { value: 'all',      label: 'Semua' },
          ].map(tab => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                statusFilter === tab.value
                  ? 'border-brand-accent text-brand-primary underline decoration-brand-primary underline-offset-4'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 md:px-8 py-6 space-y-4">
        {!isError && data && <PaginationControls page={data.page} total={data.total} pageSize={data.page_size} pending={isPending} onPageChange={setPage} />}
        {isLoading && (
          <div className="text-center text-gray-400 text-sm py-24">Memuat PO...</div>
        )}

        {isError && <div role="alert" className="text-center text-red-600 text-sm py-8">
          <p>Gagal memuat pesanan dari sales. Data belum dapat ditampilkan.</p>
          <button onClick={() => refetch()} className="mt-2 underline">Coba lagi</button>
        </div>}

        {!isLoading && !isError && orders?.length === 0 && (
          <div className="text-center py-24">
            <p className="text-gray-400 text-sm">Tidak ada pesanan yang sesuai dengan filter ini.</p>
          </div>
        )}

        {!isError && orders?.map(order => (
          <div key={order.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Order header */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900">{order.customers?.name}</p>
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium capitalize ${STATUS_STYLES[order.status]}`}>
                    {order.status}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  Diajukan oleh {order.users?.full_name} · {new Date(order.created_at).toLocaleString('id-ID')}
                </p>
                {order.rejection_note && (
                  <p className="text-xs text-red-500 mt-1">Alasan penolakan: {order.rejection_note}</p>
                )}
              </div>
              <p className="font-semibold text-gray-900 shrink-0">
                Rp {formatMoney(order.total_value, 'full')}
              </p>
            </div>

            <div className="px-5 py-3">
              <button type="button" aria-expanded={expanded.includes(order.id)} onClick={() => setExpanded(previous => previous.includes(order.id) ? previous.filter(id => id !== order.id) : [...previous, order.id])} className="text-xs font-medium text-brand-primary">{expanded.includes(order.id) ? 'Sembunyikan barang' : 'Lihat barang'}</button>
              {expanded.includes(order.id) && <SalesOrderItems orderId={order.id} />}
            </div>

            {/* Actions — only for pending */}
            {order.status === 'pending' && (
              <div className="px-5 py-4 border-t border-gray-100 flex gap-3 justify-end">
                <button
                  disabled={isPending}
                  onClick={() => { rejectMutation.reset(); setRejectionNote(''); setRejectingOrder(order) }}
                  className="px-4 py-2 text-sm text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                >
                  Tolak
                </button>
                <button
                  disabled={isPending}
                  onClick={event => {
                    approvalTrigger.current = event.currentTarget
                    approveMutation.reset()
                    stockSubmission.cancel()
                    setApprovingOrder(order)
                    setPoNumber('')
                    setExpectedDelivery('')
                  }}
                  className="px-4 py-2 text-sm font-medium bg-brand-primary text-white rounded-lg hover:bg-brand-hover transition-colors"
                >
                  Setuju & Buat menjadi PO
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      </div>
      {/* Only one active modal: the exact approval draft stays in memory during stock review. */}
      {stockSubmission.warning && <PromoStockWarning warning={stockSubmission.warning} pending={approveMutation.isPending} onContinue={stockSubmission.continue} onCancel={stockSubmission.cancel} />}
      {approvingOrder && !stockSubmission.warning && (
        <ReturnedDateDialog labelledBy="legacy-approval-title" pending={approveMutation.isPending} onClose={closeApproval} returnFocus={approvalTrigger.current} fallbackFocus={() => approvalBackground.current?.querySelector<HTMLElement>('button, a[href]') ?? null}>
          <div className="bg-white rounded-xl w-full max-w-md shadow-xl">
            <div className="px-6 py-5 border-b border-gray-100">
              <h3 id="legacy-approval-title" className="text-base font-semibold text-gray-900">Setuju & Buat menjadi PO</h3>
              <TransactionRecovery send={sendTransaction} onCommitted={recoverApproval} />
              <p className="text-xs text-gray-400 mt-0.5">
                Tindakan ini akan membuat PO baru di Procurement untuk {approvingOrder.customers?.name}
              </p>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label htmlFor="legacy-approval-po-number" className="block text-sm text-gray-600 mb-1">Nomor PO *</label>
                <input
                  id="legacy-approval-po-number"
                  type="text"
                  disabled={approveMutation.isPending || sendTransaction.hasUnresolved()}
                  value={poNumber}
                  onChange={e => setPoNumber(e.target.value)}
                  placeholder="e.g. PO-2024-050"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
                />
              </div>
              <div>
                <label htmlFor="legacy-approval-po-expiry" className="block text-sm text-gray-600 mb-1">
                  Tanggal Kedaluwarsa PO (opsional)
                </label>
                <p id="legacy-approval-po-expiry-help" className="text-xs text-gray-400 mb-1">Jika PO pelanggan memiliki tanggal kedaluwarsa. Bukan tanggal pengiriman.</p>
                <input
                  id="legacy-approval-po-expiry"
                  aria-describedby="legacy-approval-po-expiry-help"
                  type="date"
                  disabled={approveMutation.isPending || sendTransaction.hasUnresolved()}
                  value={expectedDelivery}
                  onChange={e => setExpectedDelivery(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
                />
              </div>

              {/* Order summary */}
              {approvalLines.isError && <p role="alert" className="text-sm text-red-600">Barang pesanan belum dapat dimuat. <button type="button" onClick={() => approvalLines.refetch()} className="underline">Coba lagi</button></p>}
              {(approvalLines.isPending || approvalLines.isFetching) && <p role="status" className="text-sm text-gray-500">Memuat semua barang pesanan...</p>}
              <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                <p className="text-xs text-gray-500 font-medium mb-2">Ringkasan PO</p>
                {(approvalLines.data ?? []).map(item => (
                  <div key={item.id} className="flex justify-between text-xs text-gray-600">
                    <span>{item.product_name} x{item.quantity}</span>
                    <span>Rp {(item.quantity * item.unit_price).toLocaleString('id-ID')}</span>
                  </div>
                ))}
                <div className="flex justify-between text-xs font-semibold text-gray-900 pt-2 border-t border-gray-200 mt-2">
                  <span>Total</span>
                  <span>Rp {formatMoney(approvingOrder.total_value, 'full')}</span>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                disabled={approveMutation.isPending}
                onClick={closeApproval}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                onClick={() => {
                  if (sendTransaction.hasUnresolved() || !approvalLines.data || approvalLines.isPending || approvalLines.isFetching || approvalLines.isError) return
                  if (!poNumber.trim()) return alert('PO number is required.')
                  stockSubmission.run({ order_id: approvingOrder.id, po_number: poNumber, expected_delivery_date: expectedDelivery || null })
                }}
                disabled={sendTransaction.hasUnresolved() || approvalLines.isPending || approvalLines.isFetching || approvalLines.isError || !approvalLines.data || approveMutation.isPending}
                className="px-4 py-2 text-sm font-medium bg-brand-primary text-white rounded-lg hover:bg-brand-hover disabled:opacity-50"
              >
                {approveMutation.isPending ? 'Creating PO...' : 'Confirm & Create PO'}
              </button>
            </div>
            {approveMutation.isError && (
              <p className="text-red-500 text-xs px-6 pb-4 text-right">
                {(approveMutation.error as Error).message}
              </p>
            )}
          </div>
        </ReturnedDateDialog>
      )}

      {/* Reject modal */}
      {rejectingOrder && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-sm shadow-xl">
            <div className="px-6 py-5 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">Tolak Pesanan</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {rejectingOrder.customers?.name} — diajukan oleh {rejectingOrder.users?.full_name}
              </p>
            </div>
            <div className="px-6 py-4">
              <label className="block text-sm text-gray-600 mb-1">
                Alasan penolakan <span className="text-gray-400">(wajib)</span>
              </label>
              <textarea
                value={rejectionNote}
                onChange={e => setRejectionNote(e.target.value)}
                rows={3}
                placeholder="e.g. Item out of stock, please resubmit next week"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
              />
            </div>
            {rejectMutation.isError && <p role="alert" className="px-6 pb-3 text-sm text-red-600">{(rejectMutation.error as Error).message}</p>}
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => { setRejectingOrder(null); setRejectionNote('') }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                onClick={() => { if (rejectionNote.trim()) rejectMutation.mutate() }}
                disabled={rejectMutation.isPending || !rejectionNote.trim()}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {rejectMutation.isPending ? 'Menolak...' : 'Tolak Pesanan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}