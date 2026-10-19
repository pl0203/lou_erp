import { LoadingState } from '../../components/ui/LoadingState'
import { Notice } from '../../components/ui/Feedback'
import { Dialog } from '../../components/ui/Dialog'
import { Button } from '../../components/ui/Button'
import { MainContent } from '../../components/ui/MainContent'
import { Field } from '../../components/ui/Field'
import { FormActions } from '../../components/ui/FormActions'
import TransactionRecovery from '../../components/TransactionRecovery'
import { useTransactionSender } from '../../lib/orderTransactions'
import type { TransactionSender } from '../../lib/orderTransactions'
import { useEffect, useRef, useState } from 'react'
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
  const latestSender = useRef(sendTransaction)
  const senderGeneration = useRef(0)
  if (latestSender.current !== sendTransaction) senderGeneration.current++
  latestSender.current = sendTransaction
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const dialogEpoch = useRef(0)
  const recoveryEpoch = dialogEpoch.current
  const [recoveredReceipt, setRecoveredReceipt] = useState<{ sender: TransactionSender; reference: string } | null>(null)
  const navigate = useNavigate()
  const approvalTrigger = useRef<HTMLElement | null>(null)
  const rejectionTrigger = useRef<HTMLElement | null>(null)
  const rejectionCommitted = useRef(false)
  const rejectionBusy = useRef(false)
  const successFocus = useRef<HTMLDivElement>(null)
  const [, refreshRecovery] = useState(0)
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
  const closeApproval = () => { if (approveMutation.isPending || sendTransaction.hasUnresolved()) return; dialogEpoch.current++; stockSubmission.cancel(); setApprovingOrder(null); setPoNumber(''); setExpectedDelivery('') }
  const recoveryIsCurrent = () => mounted.current && latestSender.current === sendTransaction && dialogEpoch.current === recoveryEpoch
  const recoverApproval = (result: { id: string }, operation?: string) => {
    queryClient.invalidateQueries()
    if (!recoveryIsCurrent()) {
      if (mounted.current && latestSender.current === sendTransaction) refreshRecovery(value => value + 1)
      return
    }
    setRecoveredReceipt({ sender: sendTransaction, reference: result.id })
    rejectionCommitted.current = true; dialogEpoch.current++; stockSubmission.cancel(); setApprovingOrder(null); setRejectingOrder(null)
    if (operation === 'approve_sales') navigate(`/athel/po/${result.id}`)
  }

  const rejectMutation = useMutation({
    mutationFn: () => rejectOrder(rejectingOrder!.id, rejectionNote, sendTransaction),
    onSuccess: () => {
      rejectionCommitted.current = true
      queryClient.invalidateQueries()
      setRejectingOrder(null)
      setRejectionNote('')
    },
    onSettled: () => { rejectionBusy.current = false },
  })

  const pendingCount = data?.status_counts.pending ?? 0
  const approvalLocked = approveMutation.isPending || sendTransaction.hasUnresolved()
  const rejectionLocked = rejectMutation.isPending || sendTransaction.hasUnresolved()
  const activeModal = !!approvingOrder || !!rejectingOrder || !!stockSubmission.warning
  const closeRejection = () => { if (rejectionLocked || rejectionBusy.current) return; dialogEpoch.current++; setRejectingOrder(null); setRejectionNote('') }
  const currentReceipt = recoveredReceipt?.sender === sendTransaction ? recoveredReceipt.reference : null
  const receipt = currentReceipt ? <Notice tone="success" className="m-4" title={`Periksa hasil tersimpan (referensi ${currentReceipt}).`} /> : null
  const recovery = currentReceipt ? null : <TransactionRecovery key={senderGeneration.current} send={sendTransaction} onAbandoned={() => { if (recoveryIsCurrent()) refreshRecovery(value => value + 1) }} onCommitted={recoverApproval} />

  return (
    <div className="min-h-screen bg-brand-canvas">
      <div ref={approvalBackground} inert={activeModal} aria-hidden={activeModal ? true : undefined}>
      <AthelNav />
      <MainContent>
      {receipt}
      {!activeModal && recovery}

      <div ref={successFocus} tabIndex={-1} className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Antrean pesanan Sales lama</h1>
          <p className="text-sm text-brand-secondary mt-0.5">
            Tinjau pengajuan lama yang masih menunggu. Pesanan baru dibuat melalui Purchase Order di Procurement.
          </p>
        </div>
        {!isLoading && !isError && pendingCount > 0 && statusFilter !== 'pending' && (
          <span className="bg-yellow-100 text-yellow-700 text-[13px] font-medium px-3 py-1.5 rounded-full">
            {pendingCount} menunggu persetujuan
          </span>
        )}
      </div>

      {/* Filter tabs */}
      <div className="bg-white border-b border-gray-100 px-4 md:px-8">
        <div className="flex flex-wrap gap-1">
          {[
            { value: 'pending',  label: 'Pending' },
            { value: 'approved', label: 'Disetujui' },
            { value: 'rejected', label: 'Ditolak' },
            { value: 'cancelled', label: 'Dibatalkan' },
            { value: 'all',      label: 'Semua' },
          ].map(tab => (
            <Button size="compact" variant="quiet"
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`font-medium border-b-2 transition-colors ${
                statusFilter === tab.value
                  ? 'border-brand-primary text-brand-primary underline decoration-brand-primary underline-offset-4'
                  : 'border-transparent text-brand-secondary hover:text-gray-700'
              }`}
            >
              {tab.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="px-4 md:px-8 py-6 space-y-4">
        {!isError && data && <PaginationControls page={data.page} total={data.total} pageSize={data.page_size} pending={isPending} onPageChange={setPage} />}
        {isLoading && (
          <LoadingState title="Memuat PO..." shape="list" className="text-center text-brand-secondary text-sm py-24" />
        )}

        {isError && <div role="alert" className="text-center text-red-700 text-sm py-8">
          <p>Gagal memuat pesanan dari sales. Data belum dapat ditampilkan.</p>
          <Button size="compact" variant="secondary" onClick={() => refetch()} className="mt-2">Coba lagi</Button>
        </div>}

        {!isLoading && !isError && orders?.length === 0 && (
          <div className="text-center py-24">
            <p className="text-brand-secondary text-sm">Tidak ada pesanan yang sesuai dengan filter ini.</p>
          </div>
        )}

        {!isError && orders?.map(order => (
          <div key={order.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Order header */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900">{order.customers?.name}</p>
                  <span className={`text-[13px] px-2.5 py-0.5 rounded-full font-medium capitalize ${STATUS_STYLES[order.status]}`}>
                    {order.status}
                  </span>
                </div>
                <p className="text-[13px] text-brand-secondary mt-0.5">
                  Diajukan oleh {order.users?.full_name} · {new Date(order.created_at).toLocaleString('id-ID')}
                </p>
                {order.rejection_note && (
                  <p className="text-[13px] text-red-700 mt-1">Alasan penolakan: {order.rejection_note}</p>
                )}
              </div>
              <p className="font-semibold text-gray-900 shrink-0">
                Rp {formatMoney(order.total_value, 'full')}
              </p>
            </div>

            <div className="px-5 py-3">
              <Button size="compact" variant="quiet" type="button" aria-expanded={expanded.includes(order.id)} onClick={() => setExpanded(previous => previous.includes(order.id) ? previous.filter(id => id !== order.id) : [...previous, order.id])} >{expanded.includes(order.id) ? 'Sembunyikan barang' : 'Lihat barang'}</Button>
              {expanded.includes(order.id) && <SalesOrderItems orderId={order.id} />}
            </div>

            {/* Actions — only for pending */}
            {order.status === 'pending' && (
              <div className="px-5 py-4 border-t border-gray-100 flex flex-wrap gap-3 justify-end">
                <Button size="compact" variant="danger-quiet"
                  disabled={isPending}
                  onClick={event => { dialogEpoch.current++; setRecoveredReceipt(null); rejectionTrigger.current = event.currentTarget; rejectionCommitted.current = false; rejectMutation.reset(); setRejectionNote(''); setRejectingOrder(order) }}

                >
                  Tolak
                </Button>
                <Button size="compact" variant="primary"
                  disabled={isPending}
                  onClick={event => {
                    dialogEpoch.current++; setRecoveredReceipt(null)
                    approvalTrigger.current = event.currentTarget
                    approveMutation.reset()
                    stockSubmission.cancel()
                    setApprovingOrder(order)
                    setPoNumber('')
                    setExpectedDelivery('')
                  }}

                >
                  Setuju & Buat menjadi PO
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      </MainContent>
      </div>
      {/* Only one active modal: the exact approval draft stays in memory during stock review. */}
      {stockSubmission.warning && <PromoStockWarning warning={stockSubmission.warning} returnFocus={null} fallbackFocus={() => successFocus.current} pending={approveMutation.isPending} onContinue={stockSubmission.continue} onCancel={stockSubmission.cancel} />}
      {approvingOrder && !stockSubmission.warning && (
        <ReturnedDateDialog labelledBy="legacy-approval-title" pending={approvalLocked} onClose={closeApproval} returnFocus={approvalTrigger.current} fallbackFocus={() => successFocus.current}>
          <div className="min-w-0">
            <div className="px-6 py-5 border-b border-gray-100">
              <h3 id="legacy-approval-title" className="text-base font-semibold text-gray-900">Setuju & Buat menjadi PO</h3>
              {recovery}
              <p className="text-[13px] text-brand-secondary mt-0.5">
                Tindakan ini akan membuat PO baru di Procurement untuk {approvingOrder.customers?.name}
              </p>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label htmlFor="legacy-approval-po-number" className="block text-[length:var(--ui-text-label)] leading-[var(--ui-line-control)] font-medium text-gray-600 mb-1">Nomor PO *</label>
                <input
                  id="legacy-approval-po-number"
                  type="text"
                  disabled={approvalLocked}
                  value={poNumber}
                  onChange={e => setPoNumber(e.target.value)}
                  placeholder="e.g. PO-2024-050"
                  className="ui-control"
                />
              </div>
              <div>
                <label htmlFor="legacy-approval-po-expiry" className="block text-[length:var(--ui-text-label)] leading-[var(--ui-line-control)] font-medium text-gray-600 mb-1">
                  Tanggal Kedaluwarsa PO (opsional)
                </label>
                <p id="legacy-approval-po-expiry-help" className="text-[13px] text-brand-secondary mb-1">Jika PO pelanggan memiliki tanggal kedaluwarsa. Bukan tanggal pengiriman.</p>
                <input
                  id="legacy-approval-po-expiry"
                  aria-describedby="legacy-approval-po-expiry-help"
                  type="date"
                  disabled={approvalLocked}
                  value={expectedDelivery}
                  onChange={e => setExpectedDelivery(e.target.value)}
                  className="ui-control"
                />
              </div>

              {/* Order summary */}
              {approvalLines.isError && <p role="alert" className="text-sm text-red-600">Barang pesanan belum dapat dimuat. <Button size="compact" variant="secondary" type="button" onClick={() => approvalLines.refetch()} >Coba lagi</Button></p>}
              {(approvalLines.isPending || approvalLines.isFetching) && <LoadingState title="Memuat semua barang pesanan..." shape="list" className="text-sm text-brand-secondary" />}
              <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                <p className="text-[13px] text-brand-secondary font-medium mb-2">Ringkasan PO</p>
                {(approvalLines.data ?? []).map(item => (
                  <div key={item.id} className="flex justify-between text-[13px] text-gray-600">
                    <span>{item.product_name} x{item.quantity}</span>
                    <span>Rp {(item.quantity * item.unit_price).toLocaleString('id-ID')}</span>
                  </div>
                ))}
                <div className="flex justify-between text-[13px] font-semibold text-gray-900 pt-2 border-t border-gray-200 mt-2">
                  <span>Total</span>
                  <span>Rp {formatMoney(approvingOrder.total_value, 'full')}</span>
                </div>
              </div>
            </div>
            <FormActions className="px-6 py-4 border-t border-gray-100">
              <Button variant="quiet"
                disabled={approvalLocked}
                onClick={closeApproval}

              >
                Batal
              </Button>
              <Button variant="primary" pending={approveMutation.isPending}
                onClick={() => {
                  if (sendTransaction.hasUnresolved() || !approvalLines.data || approvalLines.isPending || approvalLines.isFetching || approvalLines.isError) return
                  if (!poNumber.trim()) return alert('PO number is required.')
                  stockSubmission.run({ order_id: approvingOrder.id, po_number: poNumber, expected_delivery_date: expectedDelivery || null })
                }}
                disabled={sendTransaction.hasUnresolved() || approvalLines.isPending || approvalLines.isFetching || approvalLines.isError || !approvalLines.data || approveMutation.isPending}

              >
                {approveMutation.isPending ? 'Creating PO...' : 'Confirm & Create PO'}
              </Button>
            </FormActions>
            {approveMutation.isError && (
              <p className="text-red-700 text-[13px] px-6 pb-4 text-right">
                {(approveMutation.error as Error).message}
              </p>
            )}
          </div>
        </ReturnedDateDialog>
      )}

      {/* Reject modal */}
      {rejectingOrder && (
        <Dialog labelledBy="legacy-rejection-title" pending={rejectionLocked} onClose={closeRejection} returnFocus={null} fallbackFocus={() => !rejectionCommitted.current && rejectionTrigger.current?.isConnected ? rejectionTrigger.current : successFocus.current}>
          <div className="min-w-0">
            <div className="px-6 py-5 border-b border-gray-100">
              <h3 id="legacy-rejection-title" className="ui-dialog__title">Tolak Pesanan</h3>
              {recovery}
              <p className="text-[13px] text-brand-secondary mt-0.5">
                {rejectingOrder.customers?.name} — diajukan oleh {rejectingOrder.users?.full_name}
              </p>
            </div>
            <div className="px-6 py-4">
              <Field id="legacy-rejection-reason" label="Alasan penolakan (wajib)">{control => <textarea {...control} disabled={rejectionLocked}
                value={rejectionNote}
                onChange={e => setRejectionNote(e.target.value)}
                rows={3}
                placeholder="e.g. Item out of stock, please resubmit next week"
                className="w-full resize-none"
              />}</Field>
            </div>
            {rejectMutation.isError && <p role="alert" className="px-6 pb-3 text-sm text-red-600">{(rejectMutation.error as Error).message}</p>}
            <FormActions className="px-6 py-4 border-t border-gray-100">
              <Button variant="quiet"
                disabled={rejectionLocked} onClick={closeRejection}

              >
                Batal
              </Button>
              <Button variant="danger"
                pending={rejectMutation.isPending} onClick={() => { if (!rejectionLocked && !rejectionBusy.current && rejectionNote.trim()) { rejectionBusy.current = true; rejectMutation.mutate() } }}
                disabled={rejectionLocked || !rejectionNote.trim()}

              >
                {rejectMutation.isPending ? 'Menolak...' : 'Tolak Pesanan'}
              </Button>
            </FormActions>
          </div>
        </Dialog>
      )}
    </div>
  )
}
