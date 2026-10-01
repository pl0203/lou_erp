import { fetchCompletePOLines, fetchAuditPage, fetchDeliveryPage, fetchDeliveryLines, fetchDeliveryForEdit } from '../../lib/reads/detailReads'
import type { DeliveryHeader, DeliveryLine } from '../../lib/reads/detailReads'
import { usePagedRead } from '../../lib/reads/usePagedRead'
import { formatMoney } from '../../lib/reads/money'
import PaginationControls from '../../components/PaginationControls'
import TransactionRecovery from '../../components/TransactionRecovery'
import { useTransactionSender } from '../../lib/orderTransactions'
import type { TransactionSender } from '../../lib/orderTransactions'
import { singleRelation } from '../../lib/relations'
import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import AthelNav from '../../components/AthelNav'

type PO = {
  id: string
  po_number: string
  status: string
  order_date: string
  expected_delivery_date: string | null
  total_value: number
  notes: string | null
  customer_id: string
  customers: { name: string }
  updated_at: string
  completed_at: string | null
}

type LineItem = {
  id: string
  product_name: string
  sku: string | null
  quantity: number
  unit_price: number
  line_total: number
}

type SuratJalan = DeliveryHeader & { sj_line_items: DeliveryLine[] }

type SJFormLine = {
  po_line_item_id: string
  product_name: string
  sku: string | null
  quantity_ordered: number
  quantity_outstanding: number
  quantity_to_deliver: number
}

const STATUS_STYLES: Record<string, string> = {
  confirm:     'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  complete:    'bg-green-100 text-green-700',
}

const STATUS_LABELS: Record<string, string> = {
  confirm:     'Confirm',
  in_progress: 'In Progress',
  complete:    'Complete',
  cancelled:   'Cancelled',
}

async function fetchPO(id: string): Promise<PO> {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('id, po_number, status, order_date, expected_delivery_date, total_value, notes, customer_id, completed_at, updated_at, customers(name)')
    .eq('id', id)
    .single()
  if (error) throw error
  return { ...data, customers: singleRelation(data.customers) }
}

type DeliveryPayload = {
  purchase_order_id: string; expected_updated_at: string; sj_number: string; sj_date: string;
  sj_date_received: string | null; sj_date_returned: string | null;
  lines: { po_line_item_id: string; quantity_delivered: number }[]
}
async function createSJ(payload: DeliveryPayload, send: TransactionSender) {
  const { purchase_order_id, ...rest } = payload
  return send('save_delivery', { po_id: purchase_order_id, ...rest })
}
async function updateSJ(payload: DeliveryPayload & { sj_id: string }, send: TransactionSender) {
  const { purchase_order_id, ...rest } = payload
  return send('save_delivery', { po_id: purchase_order_id, ...rest })
}

export function computeOutstanding(
  lineItems: LineItem[],
  sjList: SuratJalan[]
): Record<string, number> {
  const delivered: Record<string, number> = {}
  for (const sj of sjList) {
    if (sj.voided_at) continue
    for (const sli of sj.sj_line_items) {
      delivered[sli.po_line_item_id] =
        (delivered[sli.po_line_item_id] ?? 0) + sli.quantity_delivered
    }
  }
  const outstanding: Record<string, number> = {}
  for (const li of lineItems) {
    outstanding[li.id] = Math.max(0, li.quantity - (delivered[li.id] ?? 0))
  }
  return outstanding
}

export default function PODetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const sendTransaction = useTransactionSender(`po:${id}`)
  const [editVersion, setEditVersion] = useState('')
  const [actionVersion, setActionVersion] = useState('')
  const [actionReason, setActionReason] = useState('')

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showSJModal, setShowSJModal] = useState(false)
  const [editingSJ, setEditingSJ] = useState<SuratJalan | null>(null)
  const [deletingSJId, setDeletingSJId] = useState<string | null>(null)

  const [sjNumber, setSjNumber] = useState('')
  const [sjDate, setSjDate] = useState('')
  const [sjDateReceived, setSjDateReceived] = useState('')
  const [sjDateReturned, setSjDateReturned] = useState('')
  const [sjLines, setSjLines] = useState<SJFormLine[]>([])

  const { data: po, isLoading, isError: poError, refetch: refetchPO } = useQuery({
    queryKey: ['po', id], queryFn: () => fetchPO(id!),
  })
  const { data: lineState, isError: linesError, isFetching: linesPending, refetch: refetchLines } = useQuery({
    queryKey: ['po_line_state', id, 'detail', po?.updated_at],
    queryFn: ({ signal }) => fetchCompletePOLines(id!, po!.updated_at, signal), enabled: !!id && !!po,
  })
  const lineItems = lineState?.items
  const lineReady = !!lineState && !linesError && !linesPending && lineState.po_updated_at === po?.updated_at
  const audits = usePagedRead('po_audit_log', { poId: id! }, (filters, page, signal) => fetchAuditPage(filters.poId, page, signal))
  const deliveries = usePagedRead('surat_jalan', { poId: id! }, (filters, page, signal) => fetchDeliveryPage(filters.poId, page, signal))
  const sjList = deliveries.data?.items
  const auditLog = audits.data?.items
  const [selectedSJId, setSelectedSJId] = useState<string | null>(null)
  const [preparingSJ, setPreparingSJ] = useState(false)
  const [preparationError, setPreparationError] = useState(false)
  const preparation = useRef<AbortController | null>(null)
  useEffect(() => () => preparation.current?.abort(), [])
  useEffect(() => {
    audits.setFilters({ poId: id! }); deliveries.setFilters({ poId: id! })
    setSelectedSJId(null); preparation.current?.abort()
    setPreparingSJ(false); setPreparationError(false)
    setShowSJModal(false); setEditingSJ(null); setSjLines([])
    setShowDeleteConfirm(false); setDeletingSJId(null); setActionReason('')
  }, [id, audits.setFilters, deliveries.setFilters])
  const selectedLines = useQuery({
    queryKey: ['sj_lines', selectedSJId], queryFn: ({ signal }) => fetchDeliveryLines(selectedSJId!, signal), enabled: !!selectedSJId,
  })

  const invalidate = () => { queryClient.invalidateQueries() }

  const sjMutation = useMutation({
    mutationFn: (payload: Parameters<typeof createSJ>[0]) => createSJ(payload, sendTransaction),
    onSuccess: () => { invalidate(); closeSJModal() },
  })

  const updateSJMutation = useMutation({
    mutationFn: (payload: Parameters<typeof updateSJ>[0]) => updateSJ(payload, sendTransaction),
    onSuccess: () => { invalidate(); closeSJModal() },
  })

  const deleteSJMutation = useMutation({
    mutationFn: (sjId: string) => sendTransaction('void_delivery', { sj_id: sjId, expected_updated_at: actionVersion, reason: actionReason }),
    onSuccess: () => { invalidate(); setDeletingSJId(null) },
  })

  const deleteMutation = useMutation({
    mutationFn: () => sendTransaction('cancel_po', { po_id: id!, expected_updated_at: actionVersion, reason: actionReason }),
    onSuccess: () => { invalidate(); navigate('/athel/po') },
  })

  const outstanding = Object.fromEntries((lineItems ?? []).map(line => [line.id, Math.max(0, line.quantity - line.delivered_quantity)]))

  const openNewSJModal = () => {
    if (!lineReady || !lineItems) return
    setEditVersion(lineState!.po_updated_at)
    setSjNumber('')
    setSjDate(new Date().toISOString().split('T')[0])
    setSjDateReceived('')
    setSjDateReturned('')
    setSjLines(lineItems.map(li => ({
      po_line_item_id: li.id,
      product_name: li.product_name,
      sku: li.sku,
      quantity_ordered: li.quantity,
      quantity_outstanding: outstanding[li.id] ?? 0,
      quantity_to_deliver: 0,
    })))
    setEditingSJ(null)
    setShowSJModal(true)
  }

  const openEditSJModal = async (header: DeliveryHeader) => {
    if (!lineReady || !lineItems || preparingSJ) return
    preparation.current?.abort()
    const controller = new AbortController(); preparation.current = controller
    setPreparingSJ(true); setPreparationError(false)
    try {
      const items = await fetchDeliveryForEdit(id!, header.id, lineState!.po_updated_at, controller.signal)
      if (controller.signal.aborted) return
      const sj = { ...header, sj_line_items: items }
      setEditVersion(lineState!.po_updated_at)
      setSjNumber(sj.sj_number); setSjDate(sj.sj_date)
      setSjDateReceived(sj.sj_date_received ?? ''); setSjDateReturned(sj.sj_date_returned ?? '')
      setSjLines(lineItems.map(li => {
        const existing = items.find(line => line.po_line_item_id === li.id)
        return { po_line_item_id: li.id, product_name: li.product_name, sku: li.sku,
          quantity_ordered: li.quantity,
          quantity_outstanding: Math.max(0, li.quantity - li.delivered_quantity + (existing?.quantity_delivered ?? 0)),
          quantity_to_deliver: existing?.quantity_delivered ?? 0 }
      }))
      setEditingSJ(sj); setShowSJModal(true)
    } catch { if (!controller.signal.aborted) setPreparationError(true) }
    finally { if (!controller.signal.aborted) setPreparingSJ(false) }
  }

  const closeSJModal = () => {
    setShowSJModal(false)
    setEditingSJ(null)
    setSjNumber('')
    setSjDate('')
    setSjDateReceived('')
    setSjDateReturned('')
    setSjLines([])
  }

  const updateSJLine = (index: number, value: number) => {
    setSjLines(prev => prev.map((l, i) => {
      if (i !== index) return l
      const capped = Math.min(value, l.quantity_outstanding)
      return { ...l, quantity_to_deliver: Math.max(0, capped) }
    }))
  }

  const handleSaveSJ = async () => {
    if (!lineReady || editVersion !== lineState?.po_updated_at) return
    if (!sjNumber.trim()) return alert('SJ number is required.')
    if (!sjDate) return alert('SJ date is required.')
    if (sjLines.every(l => l.quantity_to_deliver === 0))
      return alert('At least one item must have a delivery quantity.')

    if (editingSJ) {
      updateSJMutation.mutate({
        sj_id: editingSJ.id,
        purchase_order_id: id!,
        expected_updated_at: editVersion,
        sj_number: sjNumber,
        sj_date: sjDate,
        sj_date_received: sjDateReceived || null,
        sj_date_returned: sjDateReturned || null,
        lines: sjLines.map(l => ({
          po_line_item_id: l.po_line_item_id,
          quantity_delivered: l.quantity_to_deliver,
        })),
      })
    } else {
      sjMutation.mutate({
        purchase_order_id: id!,
        expected_updated_at: editVersion,
        sj_number: sjNumber,
        sj_date: sjDate,
        sj_date_received: sjDateReceived || null,
        sj_date_returned: sjDateReturned || null,
        lines: sjLines.map(l => ({
          po_line_item_id: l.po_line_item_id,
          quantity_delivered: l.quantity_to_deliver,
        })),
      })
    }
  }

  if (isLoading) return <div className="p-8 text-gray-400 text-sm">Loading...</div>
  if (poError || !po) return <div role="alert" className="p-8 text-red-500 text-sm">Data PO belum tersedia. <button onClick={() => refetchPO()}>Coba lagi</button><TransactionRecovery send={sendTransaction} onCommitted={() => queryClient.invalidateQueries()} /></div>
  
  const isInProgress = po.status === 'in_progress'
  const isComplete = po.status === 'complete'
  const isCancelled = po.status === 'cancelled'
  const sevenDaysAfterComplete = po.completed_at
    ? new Date(po.completed_at).getTime() + 7 * 24 * 60 * 60 * 1000
    : null
  const canAddSJ = !isCancelled && (!isComplete || (sevenDaysAfterComplete !== null && Date.now() <= sevenDaysAfterComplete))
  const deletingSJ = sjList?.find(s => s.id === deletingSJId)

  return (
    <div className="min-h-screen bg-gray-50">
      <AthelNav />
        <TransactionRecovery send={sendTransaction} onCommitted={() => { invalidate(); closeSJModal(); setDeletingSJId(null); setShowDeleteConfirm(false) }} />

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/athel/po')}
            className="text-gray-400 hover:text-gray-600 text-sm"
          >
            ← Kembali
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-gray-900">{po.po_number}</h1>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[po.status] ?? 'bg-gray-100 text-gray-600'}`}>
                {STATUS_LABELS[po.status] ?? po.status}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">{po.customers?.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {!isComplete && !isCancelled && (
            <button
              onClick={() => navigate(`/athel/po/${po.id}/edit`)}
              className="text-sm font-medium text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 px-3 py-1.5 rounded-lg transition-colors"
            >
              Ubah PO
            </button>
          )}
          <button
            disabled={isCancelled}
            onClick={() => { setActionVersion(po.updated_at); setActionReason(''); setShowDeleteConfirm(true) }}
            className="text-sm text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 px-3 py-1.5 rounded-lg transition-colors"
          >
            Batalkan PO
          </button>
        </div>
      </div>

      <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto space-y-6">

        {(!lineReady || preparationError) && <div role={linesError || preparationError ? 'alert' : 'status'} className="text-sm text-red-600">
          {linesError || preparationError ? 'Data barang atau pengiriman belum lengkap. Pengiriman belum dapat diubah.' : 'Memuat seluruh barang PO…'}
          <button className="ml-2 underline" onClick={() => { setPreparationError(false); refetchPO(); refetchLines() }}>Coba lagi</button>
        </div>}
        {/* Status card */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-medium text-gray-900 mb-4">Status</h2>
          <div className="flex items-center gap-3 flex-wrap">
            {['confirm', 'in_progress', 'complete'].map((s, i, arr) => (
              <div key={s} className="flex items-center gap-3">
                <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                  ${po.status === s
                    ? STATUS_STYLES[s]
                    : ['confirm', 'in_progress', 'complete'].indexOf(po.status) > i
                      ? 'bg-gray-100 text-gray-400'
                      : 'bg-gray-50 text-gray-300'
                  }`}
                >
                  {po.status === s && (
                    <span className="w-2 h-2 rounded-full bg-current opacity-70" />
                  )}
                  {STATUS_LABELS[s]}
                </div>
                {i < arr.length - 1 && <span className="text-gray-300">→</span>}
              </div>
            ))}
            {canAddSJ && (
              <button
                disabled={!lineReady || preparingSJ}
                  onClick={openNewSJModal}
                className="ml-auto bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                + Surat Jalan
              </button>
            )}
          </div>
          {isComplete && (
            <p className="text-sm text-green-600 mt-3 font-medium">
              ✓ Semua barang telah terkirim sepenuhnya..
            </p>
          )}
        </div>

        {/* Order Details */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-medium text-gray-900 mb-4">Order Details</h2>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-gray-400 mb-1">Toko/Customer</p>
              <p className="text-gray-900">{po.customers?.name}</p>
            </div>
            <div>
              <p className="text-gray-400 mb-1">Tanggal PO</p>
              <p className="text-gray-900">{po.order_date}</p>
            </div>
            <div>
              <p className="text-gray-400 mb-1">Tanggal Kedaluwarsa PO</p>
              <p className="text-gray-900">{po.expected_delivery_date ?? '—'}</p>
            </div>
            <div>
              <p className="text-gray-400 mb-1">Total</p>
              <p className="text-gray-900 font-semibold">
                Rp {po.total_value.toLocaleString('id-ID')}
              </p>
            </div>
            {po.notes && (
              <div className="col-span-3">
                <p className="text-gray-400 mb-1">Catatan</p>
                <p className="text-gray-900">{po.notes}</p>
              </div>
            )}
          </div>
        </div>

        {/* Line Items */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-base font-medium text-gray-900">Daftar Barang</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-6 py-3 text-gray-500 font-medium">Produk</th>
                <th className="text-left px-6 py-3 text-gray-500 font-medium">SKU</th>
                <th className="text-right px-6 py-3 text-gray-500 font-medium">Dipesan</th>
                {isInProgress && (
                  <th className="text-right px-6 py-3 text-gray-500 font-medium">Outstanding</th>
                )}
                <th className="text-right px-6 py-3 text-gray-500 font-medium">Harga Satuan</th>
                <th className="text-right px-6 py-3 text-gray-500 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {lineItems?.map(item => (
                <tr key={item.id} className="border-b border-gray-50">
                  <td className="px-6 py-3 text-gray-900">{item.product_name}</td>
                  <td className="px-6 py-3 text-gray-500 font-mono text-xs uppercase">
                    {item.sku ?? '—'}
                  </td>
                  <td className="px-6 py-3 text-right text-gray-700">{item.quantity}</td>
                  {isInProgress && (
                    <td className="px-6 py-3 text-right">
                      <span className={`font-medium ${
                        (outstanding[item.id] ?? 0) === 0
                          ? 'text-green-600'
                          : 'text-orange-500'
                      }`}>
                        {outstanding[item.id] ?? 0}
                      </span>
                    </td>
                  )}
                  <td className="px-6 py-3 text-right text-gray-700">
                    Rp {formatMoney(item.unit_price, 'full')}
                  </td>
                  <td className="px-6 py-3 text-right text-gray-900 font-medium">
                    Rp {formatMoney(item.line_total, 'full')}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50">
                <td colSpan={isInProgress ? 5 : 4} className="px-6 py-3 text-right text-sm text-gray-500 font-medium">
                  Total
                </td>
                <td className="px-6 py-3 text-right text-gray-900 font-semibold">
                  Rp {po.total_value.toLocaleString('id-ID')}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Delivery headers are presentation only; quantities come from lineState. */}
        <div role="region" aria-label="Riwayat pengiriman" className="bg-white rounded-xl border border-gray-200 overflow-hidden p-6">
          <h2 className="text-base font-medium text-gray-900">Pengiriman (Daftar Surat Jalan)</h2>
          {deliveries.isError ? <p role="alert">Riwayat pengiriman gagal dimuat. <button onClick={() => deliveries.refetch()}>Coba lagi</button></p>
            : <div aria-busy={deliveries.isPending}>
              {(sjList ?? []).map(sj => <div key={sj.id} className="py-4 border-b border-gray-100">
                <div className="flex justify-between gap-3"><div>
                  <span className="font-medium text-sm">{sj.sj_number}</span>
                  {sj.voided_at && <p className="text-xs text-red-600">Dibatalkan: {sj.void_reason} · {new Date(sj.voided_at).toLocaleString('id-ID')}</p>}
                  <p className="text-xs text-gray-400">Created: {sj.sj_date}</p>
                  {sj.sj_date_received && <p className="text-xs text-gray-400">Diterima Toko: {sj.sj_date_received}</p>}
                  {sj.sj_date_returned && <p className="text-xs text-gray-400">SJ Kembali: {sj.sj_date_returned}</p>}
                </div><div className="flex gap-3">
                  <button disabled={deliveries.isPending} onClick={() => setSelectedSJId(selectedSJId === sj.id ? null : sj.id)} className="text-blue-600 text-xs">{selectedSJId === sj.id ? 'Tutup barang' : 'Lihat barang'}</button>
                  {canAddSJ && !sj.voided_at && <>
                    <button disabled={!lineReady || preparingSJ || deliveries.isPending} onClick={() => openEditSJModal(sj)} className="text-blue-600 text-xs">Ubah</button>
                    <button disabled={deliveries.isPending} onClick={() => { setActionVersion(po.updated_at); setActionReason(''); setDeletingSJId(sj.id) }} className="text-red-500 text-xs">Batalkan</button>
                  </>}
                </div></div>
                {selectedSJId === sj.id && (selectedLines.isError ? <p role="alert">Barang pengiriman gagal dimuat. <button onClick={() => selectedLines.refetch()}>Coba lagi</button></p>
                  : selectedLines.isPending ? <p role="status">Memuat barang…</p> : <table className="w-full mt-3 text-xs"><thead><tr><th className="text-left">Item</th><th>SKU</th><th>Qty Terkirim</th></tr></thead><tbody>
                    {selectedLines.data?.map(sli => { const li = lineItems?.find(line => line.id === sli.po_line_item_id); return <tr key={sli.id}><td>{li?.product_name ?? '—'}</td><td>{li?.sku ?? '—'}</td><td>{sli.quantity_delivered}</td></tr> })}
                  </tbody></table>)}
              </div>)}
              {!deliveries.isPending && sjList?.length === 0 && <p className="text-sm text-gray-400">Belum ada pengiriman.</p>}
              <PaginationControls page={deliveries.page} total={deliveries.data?.total ?? 0} pageSize={20} pending={deliveries.isPending} onPageChange={deliveries.setPage} />
            </div>}
        </div>

        {/* Audit Log */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-medium text-gray-900 mb-4">Riwayat Perubahan</h2>
          {audits.isError ? <p role="alert">Riwayat perubahan gagal dimuat. <button onClick={() => audits.refetch()}>Coba lagi</button></p> : !audits.isPending && auditLog?.length === 0 ? (
            <p className="text-sm text-gray-400">Belum ada perubahan tercatat.</p>
          ) : (
            <div className="space-y-3">
              {auditLog?.map(entry => (
                <div key={entry.id} className="flex gap-4 text-sm">
                  <div className="w-1 rounded-full bg-blue-200 shrink-0" />
                  <div>
                    <p className="text-gray-900">
                      <span className="font-medium">
                        {entry.users?.full_name ?? 'Someone'}
                      </span>
                      {' changed '}
                      <span className="font-medium">{entry.field_changed}</span>
                      {entry.old_value && (
                        <> from <span className="text-gray-500">{entry.old_value}</span></>
                      )}
                      {entry.new_value && (
                        <> to <span className="text-gray-700">{entry.new_value}</span></>
                      )}
                    </p>
                    <p className="text-gray-400 text-xs mt-0.5">
                      {new Date(entry.changed_at).toLocaleString('id-ID')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!audits.isError && <PaginationControls page={audits.page} total={audits.data?.total ?? 0} pageSize={20} pending={audits.isPending} onPageChange={audits.setPage} />}
        </div>

      </div>

      {/* SJ Modal */}
      {showSJModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">
                {editingSJ ? 'Edit Surat Jalan' : 'New Surat Jalan'}
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Masukkan jumlah pengiriman. Dibatasi sesuai sisa per barang.
              </p>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Nomor SJ *</label>
                  <input
                    type="text"
                    value={sjNumber}
                    onChange={e => setSjNumber(e.target.value)}
                    placeholder="e.g. SJ-2024-001"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Tanggal SJ *</label>
                  <input
                    type="date"
                    value={sjDate}
                    onChange={e => setSjDate(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    Tanggal SJ Diterima Toko <span className="text-gray-400"></span>
                  </label>
                  <input
                    type="date"
                    value={sjDateReceived}
                    onChange={e => setSjDateReceived(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    Tanggal SJ Balik <span className="text-gray-400"></span>
                  </label>
                  <input
                    type="date"
                    value={sjDateReturned}
                    onChange={e => setSjDateReturned(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <div className="grid grid-cols-12 gap-2 text-xs text-gray-400 font-medium px-1 mb-2">
                  <div className="col-span-5">Item</div>
                  <div className="col-span-2 text-right">Dipesan</div>
                  <div className="col-span-2 text-right">Outstanding</div>
                  <div className="col-span-3 text-right">Dikirim</div>
                </div>
                <div className="space-y-2">
                  {sjLines.map((line, i) => (
                    <div key={line.po_line_item_id} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-5">
                        <p className="text-sm text-gray-900 truncate">{line.product_name}</p>
                        {line.sku && (
                          <p className="text-xs text-gray-400 font-mono uppercase">{line.sku}</p>
                        )}
                      </div>
                      <div className="col-span-2 text-right text-sm text-gray-500">
                        {line.quantity_ordered}
                      </div>
                      <div className="col-span-2 text-right text-sm font-medium">
                        <span className={line.quantity_outstanding === 0 ? 'text-green-500' : 'text-orange-500'}>
                          {line.quantity_outstanding}
                        </span>
                      </div>
                      <div className="col-span-3">
                        <input
                          type="number"
                          min={0}
                          max={line.quantity_outstanding}
                          value={line.quantity_to_deliver}
                          onChange={e => updateSJLine(i, parseInt(e.target.value) || 0)}
                          disabled={line.quantity_outstanding === 0}
                          className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-300"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={closeSJModal}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                onClick={handleSaveSJ}
                disabled={sjMutation.isPending || updateSJMutation.isPending || !lineReady || editVersion !== lineState?.po_updated_at}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {sjMutation.isPending || updateSJMutation.isPending
                  ? 'Menyimpan...'
                  : editingSJ ? 'Update SJ' : 'Create SJ'}
              </button>
            </div>
            {(!lineReady || editVersion !== lineState?.po_updated_at) && <p className="px-6 pb-4 text-sm text-red-600">Data PO belum lengkap atau berubah. Tutup formulir lalu muat ulang sebelum menyimpan; isian Anda tetap terlihat sampai formulir ditutup.</p>}
            {(sjMutation.isError || updateSJMutation.isError) && (
              <p className="text-red-500 text-xs px-6 pb-4 text-right">
                {((sjMutation.error || updateSJMutation.error) as Error)?.message}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Delete SJ confirmation */}
      {deletingSJId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900 mb-2">Batalkan Surat Jalan?</h3>
            <p className="text-sm text-gray-500 mb-5">
              Apakah Anda yakin ingin membatalkan <strong>{deletingSJ?.sj_number}</strong>?
              Jumlah tidak lagi dihitung sebagai pengiriman aktif. Riwayat tetap disimpan.
            </p>
            <textarea aria-label="Alasan pembatalan" value={actionReason} onChange={e => setActionReason(e.target.value)} placeholder="Alasan pembatalan (wajib)" className="w-full border rounded-lg p-2 mb-3 text-sm" />
            {(deleteSJMutation.isError || deleteMutation.isError) && <p className="text-red-600 text-xs mb-3">{((deleteSJMutation.error || deleteMutation.error) as Error).message}</p>}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeletingSJId(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                onClick={() => deleteSJMutation.mutate(deletingSJId)}
                disabled={deleteSJMutation.isPending || !actionReason.trim()}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteSJMutation.isPending ? 'Membatalkan...' : 'Ya, batalkan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete PO confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900 mb-2">
              Batalkan {po.po_number}?
            </h3>
            <p className="text-sm text-gray-500 mb-5">
             PO <strong>{po.po_number}</strong> dibatalkan tanpa menghapus riwayat. Pengiriman aktif harus diselesaikan melalui koreksi terlebih dahulu.
            </p>
            <textarea aria-label="Alasan pembatalan" value={actionReason} onChange={e => setActionReason(e.target.value)} placeholder="Alasan pembatalan (wajib)" className="w-full border rounded-lg p-2 mb-3 text-sm" />
            {(deleteSJMutation.isError || deleteMutation.isError) && <p className="text-red-600 text-xs mb-3">{((deleteSJMutation.error || deleteMutation.error) as Error).message}</p>}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending || !actionReason.trim()}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Membatalkan...' : 'Ya, batalkan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}