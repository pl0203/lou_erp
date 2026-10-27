import { savedPOSalesName } from '../../lib/poSales'
import { LoadingState } from '../../components/ui/LoadingState'
import { Notice } from '../../components/ui/Feedback'
import { Dialog } from '../../components/ui/Dialog'
import { Button } from '../../components/ui/Button'
import { ActionLink } from '../../components/ui/ActionLink'
import { MainContent } from '../../components/ui/MainContent'
import { Field } from '../../components/ui/Field'
import { FormActions } from '../../components/ui/FormActions'
import { PO_STATUS_LABELS, summarizePOAudit } from '../../lib/orderPresentation'
import { formatDisplayDate, formatAuditTimestamp } from '../../lib/displayDate'
import ReturnedDateDialog from '../../components/ReturnedDateDialog'
import { fetchCompletePOLines, fetchAuditPage, fetchDeliveryPage, fetchDeliveryLines, fetchDeliveryForEdit } from '../../lib/reads/detailReads'
import type { DeliveryHeader, DeliveryLine } from '../../lib/reads/detailReads'
import { usePagedRead } from '../../lib/reads/usePagedRead'
import { formatMoney } from '../../lib/reads/money'
import PaginationControls from '../../components/PaginationControls'
import TransactionRecovery from '../../components/TransactionRecovery'
import { useTransactionSender } from '../../lib/orderTransactions'
import type { TransactionSender } from '../../lib/orderTransactions'
import { isPOConflict, retryUnlessPOConflict } from '../../lib/poConflict'
import { singleRelation } from '../../lib/relations'
import { useState, useRef, useEffect, useCallback } from 'react'
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
  sales_person_id_at_creation?: string | null
  sales_assignment_source_id?: string | null
  sales_attributed_at?: string | null
  sales_person_at_creation?: { full_name: string } | null
  sales_attribution_state?: 'assigned' | 'unassigned' | 'legacy' | null
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

const PO_COLUMNS = 'id, po_number, status, order_date, expected_delivery_date, total_value, notes, customer_id, completed_at, updated_at, sales_person_id_at_creation, sales_assignment_source_id, sales_attributed_at, sales_attribution_state, sales_person_at_creation:users!purchase_orders_sales_person_id_at_creation_fkey(full_name), customers(name)'
function normalizePO(data: any): PO { return { ...data, customers: singleRelation(data.customers), sales_person_at_creation: singleRelation(data.sales_person_at_creation) } }
async function fetchPO(id: string): Promise<PO> {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select(PO_COLUMNS)
    .eq('id', id)
    .single()
  if (error) throw error
  return normalizePO(data)
}

type SJDateKind = 'received' | 'returned'
const SJ_DATE_LABELS = {
  received: { field: 'Tanggal SJ Diterima Toko', action: 'Ubah tanggal SJ diterima toko', save: 'Simpan tanggal diterima' },
  returned: { field: 'Tanggal SJ kembali', action: 'Ubah tanggal SJ kembali', save: 'Simpan tanggal kembali' },
} as const

type SJDateRead = { po: PO; sj: { id: string; sj_number: string; date: string | null; voided_at: string | null; void_reason: string | null } }
type SJDateReview = { status: 'needed' | 'loading' | 'ready' | 'failed'; value?: SJDateRead; message?: string }
/** Preserve PostgreSQL microseconds only for this date-correction review's newer-version proof. */
function sjDateVersionMicros(value: unknown): bigint | null {
  if (typeof value !== 'string') return null
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) return null
  const fraction = value.match(/\.(\d{1,6})(?:Z|[+-]\d{2}(?::?\d{2})?)$/i)?.[1] ?? ''
  return BigInt(milliseconds) * 1000n + BigInt(fraction.padEnd(6, '0').slice(3))
}
/** One authorized joined statement pins the selected SJ evidence and its parent version to one snapshot. */
async function fetchSJDateRead(poId: string, sjId: string, kind: SJDateKind, rejectedVersion: string, signal: AbortSignal): Promise<SJDateRead> {
  signal.throwIfAborted()
  const { data, error } = await supabase.from('surat_jalan')
    .select(`id, purchase_order_id, sj_number, sj_date_${kind}, voided_at, void_reason, purchase_orders!inner(${PO_COLUMNS})`)
    .eq('id', sjId).eq('purchase_order_id', poId).abortSignal(signal).single()
  signal.throwIfAborted()
  if (error) throw error
  const parent = singleRelation<any>(data?.purchase_orders)
  const storedDate = data?.[`sj_date_${kind}`]
  const validDate = storedDate === null || (typeof storedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(storedDate) && Number.isFinite(Date.parse(storedDate)) && new Date(`${storedDate}T00:00:00Z`).toISOString().slice(0, 10) === storedDate)
  const currentVersion = sjDateVersionMicros(parent?.updated_at), rejected = sjDateVersionMicros(rejectedVersion)
  if (!data || data.id !== sjId || data.purchase_order_id !== poId || typeof data.sj_number !== 'string' || !parent || parent.id !== poId || currentVersion === null || rejected === null || currentVersion <= rejected || !validDate || (data.voided_at !== null && !Number.isFinite(Date.parse(data.voided_at)))) throw new Error('Data SJ terbaru belum lengkap atau masih memakai versi lama. Muat ulang sebelum melanjutkan.')
  return { po: normalizePO(parent), sj: { id: data.id, sj_number: data.sj_number, date: storedDate, voided_at: data.voided_at, void_reason: data.void_reason } }
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
  const latestSender = useRef(sendTransaction)
  const senderGeneration = useRef(0)
  if (latestSender.current !== sendTransaction) senderGeneration.current++
  latestSender.current = sendTransaction
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
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
  const [dateTarget, setDateTarget] = useState<{ id: string; number: string; version: string; kind: SJDateKind } | null>(null)
  const [correctionDate, setCorrectionDate] = useState('')
  const dateBusy = useRef<symbol | null>(null)
  const dateTrigger = useRef<HTMLElement | null>(null)
  const dialogTrigger = useRef<HTMLElement | null>(null)
  const dialogCommitted = useRef(false)
  const dialogBusy = useRef(false)
  const dialogEpoch = useRef(0)
  const successFocus = useRef<HTMLDivElement>(null)
  const [, refreshRecovery] = useState(0)
  const dateBackground = useRef<HTMLDivElement>(null)
  const [dateReview, setDateReview] = useState<SJDateReview | null>(null)
  const dateReviewRequired = useRef(false)
  const dateReadSequence = useRef(0)
  const dateRead = useRef<AbortController | null>(null)
  const [sjLines, setSjLines] = useState<SJFormLine[]>([])

  const [refreshingPO, setRefreshingPO] = useState(false)
  const activePO = useRef({ id, generation: 0 })
  if (activePO.current.id !== id) activePO.current = { id, generation: activePO.current.generation + 1 }
  const [recoveredReceipt, setRecoveredReceipt] = useState<{ sender: TransactionSender; record: typeof activePO.current; reference: string } | null>(null)
  const refreshSequence = useRef(0)
  const { data: po, isLoading, isError: poError, isFetching: poFetching, refetch: refetchPO } = useQuery({
    queryKey: ['po', id], queryFn: () => fetchPO(id!),
  })
  const { data: lineState, isError: linesError, error: lineError, isFetching: linesPending } = useQuery({
    queryKey: ['po_line_state', id, 'detail', po?.updated_at],
    queryFn: ({ signal }) => fetchCompletePOLines(id!, po!.updated_at, signal), enabled: query => !!id && !!po && !refreshingPO && !isPOConflict(query.state.error),
    retry: (count, error) => retryUnlessPOConflict(count, error, queryClient.getDefaultOptions().queries?.retry),
    refetchOnMount: query => !isPOConflict(query.state.error),
    refetchOnWindowFocus: query => !isPOConflict(query.state.error),
    refetchOnReconnect: query => !isPOConflict(query.state.error),
  })
  const refreshPO = async () => {
    const target = id!
    const generation = activePO.current.generation
    const sequence = ++refreshSequence.current
    const isCurrent = () => activePO.current.id === target && activePO.current.generation === generation && refreshSequence.current === sequence
    setRefreshingPO(true); setPreparationError(false)
    try {
      await queryClient.cancelQueries({ queryKey: ['po_line_state', target, 'detail'] })
      const header = await refetchPO()
      if (header.isError || !header.data || header.data.id !== target || !isCurrent()) return
      await queryClient.fetchQuery({
        queryKey: ['po_line_state', target, 'detail', header.data.updated_at],
        queryFn: ({ signal }) => fetchCompletePOLines(target, header.data!.updated_at, signal), retry: false,
      })
    } catch { /* Retain read failure and keep all delivery actions blocked. */ }
    finally { if (isCurrent()) setRefreshingPO(false) }
  }
  const lineItems = lineState?.items
  const lineReady = !!lineState && !linesError && !linesPending && !poFetching && !refreshingPO && lineState.po_updated_at === po?.updated_at
  const audits = usePagedRead('po_audit_log', { poId: id! }, (filters, page, signal) => fetchAuditPage(filters.poId, page, signal))
  const deliveries = usePagedRead('surat_jalan', { poId: id! }, (filters, page, signal) => fetchDeliveryPage(filters.poId, page, signal))
  const sjList = deliveries.data?.items
  const auditLog = audits.data?.items
  const [selectedSJId, setSelectedSJId] = useState<string | null>(null)
  const [preparingSJ, setPreparingSJ] = useState(false)
  const [preparationError, setPreparationError] = useState(false)
  const preparation = useRef<AbortController | null>(null)
  const supersedePreparation = useCallback(() => {
    preparation.current?.abort(); preparation.current = null
    setPreparingSJ(false); setPreparationError(false)
  }, [])
  const takePresentation = () => {
    dialogEpoch.current++; supersedePreparation(); setRecoveredReceipt(null)
  }
  useEffect(() => () => { preparation.current?.abort(); dateRead.current?.abort() }, [])
  useEffect(() => { supersedePreparation() }, [id, sendTransaction, supersedePreparation])
  useEffect(() => {
    refreshSequence.current++; setRefreshingPO(false); setRecoveredReceipt(null)
    audits.setFilters({ poId: id! }); deliveries.setFilters({ poId: id! })
    setSelectedSJId(null)
    setShowSJModal(false); setEditingSJ(null); setSjLines([])
    setShowDeleteConfirm(false); setDeletingSJId(null); setActionReason(''); setDateTarget(null); setDateReview(null); dateReviewRequired.current = false; dateReadSequence.current++; dateRead.current?.abort()
    // A new authenticated sender cannot inherit another actor's draft, read proof or pending observer.
    dialogEpoch.current++; dateBusy.current = null; setCorrectionDate(''); dateMutation.reset()
  }, [id, sendTransaction, audits.setFilters, deliveries.setFilters])
  useEffect(() => () => { void queryClient.cancelQueries({ queryKey: ['po_line_state', id, 'detail'] }) }, [id, queryClient])
  const selectedLines = useQuery({
    queryKey: ['sj_lines', selectedSJId], queryFn: ({ signal }) => fetchDeliveryLines(selectedSJId!, signal), enabled: !!selectedSJId,
  })

  const invalidate = () => { queryClient.invalidateQueries() }

  const sjMutation = useMutation({
    retry: false,
    mutationFn: (payload: Parameters<typeof createSJ>[0]) => createSJ(payload, sendTransaction),
    onSuccess: () => { dialogCommitted.current = true; invalidate(); closeSJModal() },
    onSettled: () => { dialogBusy.current = false },
  })

  const updateSJMutation = useMutation({
    retry: false,
    mutationFn: (payload: Parameters<typeof updateSJ>[0]) => updateSJ(payload, sendTransaction),
    onSuccess: () => { dialogCommitted.current = true; invalidate(); closeSJModal() },
    onSettled: () => { dialogBusy.current = false },
  })

  const closeCorrectionDate = () => { dialogEpoch.current++; dateReadSequence.current++; dateRead.current?.abort(); dateReviewRequired.current = false; setDateReview(null); setDateTarget(null) }
  const refreshCorrectionDate = async () => {
    if (!dateTarget || dateBusy.current) return
    const target = dateTarget, poId = id!, record = activePO.current, sender = sendTransaction, epoch = dialogEpoch.current, sequence = ++dateReadSequence.current
    dateRead.current?.abort(); const controller = new AbortController(); dateRead.current = controller
    const current = () => mounted.current && !controller.signal.aborted && activePO.current === record && latestSender.current === sender && dialogEpoch.current === epoch && sequence === dateReadSequence.current
    dateReviewRequired.current = true; setDateReview({ status: 'loading' })
    try {
      const value = await fetchSJDateRead(poId, target.id, target.kind, target.version, controller.signal)
      if (!current()) return
      queryClient.setQueryData(['po', poId], value.po)
      setDateReview({ status: 'ready', value })
      void queryClient.invalidateQueries({ queryKey: ['surat_jalan'] })
    } catch (error) { if (current()) setDateReview({ status: 'failed', message: (error as Error).message }) }
  }
  const dateReviewEligible = dateReview?.status === 'ready' && !!dateReview.value && dateReview.value.po.updated_at === po?.updated_at && !poFetching && dateReview.value.sj.voided_at === null && ['confirm', 'in_progress', 'complete'].includes(dateReview.value.po.status) && (dateReview.value.po.status !== 'complete' || Number.isFinite(Date.parse(dateReview.value.po.completed_at ?? '')))
  const adoptSJDateReview = () => {
    if (!dateTarget || !dateReviewEligible || !dateReview?.value || dateBusy.current) return
    setDateTarget({ id: dateReview.value.sj.id, number: dateReview.value.sj.sj_number, version: dateReview.value.po.updated_at, kind: dateTarget.kind })
    dateReviewRequired.current = false; setDateReview(null); dateMutation.reset()
  }

  const dateMutation = useMutation({
    retry: false,
    mutationFn: ({ kind, date, ...payload }: { kind: SJDateKind; date: string | null; sj_id: string; expected_updated_at: string }) => sendTransaction(`edit_sj_${kind}_date`, { ...payload, [`sj_date_${kind}`]: date }),
  })
  const saveCorrectionDate = async () => {
    if (!dateTarget || sendTransaction.hasUnresolved() || dateBusy.current || dateReviewRequired.current || dateTarget.version !== po?.updated_at) return
    const record = activePO.current, sender = sendTransaction, epoch = dialogEpoch.current, token = Symbol('sj-date-save')
    const current = () => mounted.current && activePO.current === record && latestSender.current === sender && dialogEpoch.current === epoch
    dateBusy.current = token
    try {
      await dateMutation.mutateAsync({ sj_id: dateTarget.id, expected_updated_at: dateTarget.version, kind: dateTarget.kind, date: correctionDate || null })
      invalidate()
      if (current()) { dialogCommitted.current = true; closeCorrectionDate() }
    }
    catch (error) { if (current() && isPOConflict(error)) { dateReviewRequired.current = true; setDateReview({ status: 'needed' }) } /* Keep the current owner's exact date draft visible. */ }
    finally { if (dateBusy.current === token) dateBusy.current = null }
  }

  const deleteSJMutation = useMutation({
    retry: false,
    mutationFn: (sjId: string) => sendTransaction('void_delivery', { sj_id: sjId, expected_updated_at: actionVersion, reason: actionReason }),
    onSuccess: () => { dialogCommitted.current = true; invalidate(); setDeletingSJId(null) },
    onSettled: () => { dialogBusy.current = false },
  })

  const deleteMutation = useMutation({
    retry: false,
    mutationFn: () => sendTransaction('cancel_po', { po_id: id!, expected_updated_at: actionVersion, reason: actionReason }),
    onSuccess: () => { dialogCommitted.current = true; invalidate(); navigate('/athel/po') },
    onSettled: () => { dialogBusy.current = false },
  })

  const outstanding = Object.fromEntries((lineItems ?? []).map(line => [line.id, Math.max(0, line.quantity - line.delivered_quantity)]))

  const openNewSJModal = (trigger: HTMLElement) => {
    if (!lineReady || !lineItems) return
    takePresentation(); dialogTrigger.current = trigger; dialogCommitted.current = false
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

  const openEditSJModal = async (header: DeliveryHeader, trigger: HTMLElement) => {
    if (!lineReady || !lineItems || preparingSJ) return
    takePresentation(); dialogTrigger.current = trigger; dialogCommitted.current = false
    const controller = new AbortController(); preparation.current = controller
    const record = activePO.current, epoch = dialogEpoch.current, version = lineState!.po_updated_at
    const current = () => mounted.current && !controller.signal.aborted && preparation.current === controller &&
      activePO.current === record && latestSender.current === sendTransaction && dialogEpoch.current === epoch
    setPreparingSJ(true); setPreparationError(false)
    try {
      const items = await fetchDeliveryForEdit(record.id!, header.id, version, controller.signal)
      if (!current()) return
      const sj = { ...header, sj_line_items: items }
      setEditVersion(version)
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
    } catch { if (current()) setPreparationError(true) }
    finally { if (current()) { preparation.current = null; setPreparingSJ(false) } }
  }

  const closeSJModal = () => {
    dialogEpoch.current++
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

  const deliveryWillComplete = sjLines.some(line => line.quantity_to_deliver > 0) && sjLines.every(line => line.quantity_to_deliver >= line.quantity_outstanding)

  const handleSaveSJ = async () => {
    if (dialogBusy.current || dateBusy.current || transactionLocked || !lineReady || editVersion !== lineState?.po_updated_at) return
    if (!sjNumber.trim()) return alert('Nomor SJ wajib diisi.')
    if (!sjDate) return alert('Tanggal SJ wajib diisi.')
    if (sjLines.every(l => l.quantity_to_deliver === 0))
      return alert('Isi jumlah pengiriman untuk minimal satu barang.')

    dialogBusy.current = true
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

  const writePending = sjMutation.isPending || updateSJMutation.isPending || deleteSJMutation.isPending || deleteMutation.isPending || dateMutation.isPending
  const transactionLocked = writePending || sendTransaction.hasUnresolved()
  const activeModal = showSJModal || !!deletingSJId || showDeleteConfirm || !!dateTarget
  const recoveryRecord = activePO.current, recoveryEpoch = dialogEpoch.current
  const currentReceipt = recoveredReceipt?.sender === sendTransaction && recoveredReceipt.record === recoveryRecord ? recoveredReceipt.reference : null
  const receipt = currentReceipt ? <Notice tone="success" className="m-4" title={`Periksa hasil tersimpan (referensi ${currentReceipt}).`} /> : null
  const recoveryIsCurrent = () => mounted.current && activePO.current === recoveryRecord && latestSender.current === sendTransaction && dialogEpoch.current === recoveryEpoch
  const recovery = currentReceipt ? null : <TransactionRecovery key={`${senderGeneration.current}:${recoveryRecord.generation}`} send={sendTransaction} onAbandoned={() => { if (recoveryIsCurrent()) refreshRecovery(value => value + 1) }} onCommitted={result => {
    invalidate()
    if (!recoveryIsCurrent()) {
      if (mounted.current && latestSender.current === sendTransaction) refreshRecovery(value => value + 1)
      return
    }
    supersedePreparation()
    setRecoveredReceipt({ sender: sendTransaction, record: recoveryRecord, reference: result.id })
    dialogCommitted.current = true; closeSJModal(); setDeletingSJId(null); setShowDeleteConfirm(false); closeCorrectionDate()
  }} />
  const restoreDialogFocus = () => !dialogCommitted.current && dialogTrigger.current?.isConnected ? dialogTrigger.current : successFocus.current
  const restoreDateFocus = () => !dialogCommitted.current && dateTrigger.current?.isConnected ? dateTrigger.current : successFocus.current

  if (isLoading) return <div className="min-h-screen bg-brand-canvas"><AthelNav /><MainContent>{receipt}{recovery}<LoadingState title="Memuat..." shape="detail" className="p-8 text-brand-secondary" /></MainContent></div>
  if (poError || !po) return <div className="min-h-screen bg-brand-canvas"><AthelNav /><MainContent>{receipt}{recovery}<div role="alert" className="p-8 text-red-700">Data PO belum tersedia. <Button variant="secondary" onClick={() => refetchPO()}>Coba lagi</Button></div></MainContent></div>

  const isInProgress = po.status === 'in_progress'
  const isComplete = po.status === 'complete'
  const isCancelled = po.status === 'cancelled'
  const sevenDaysAfterComplete = po.completed_at
    ? new Date(po.completed_at).getTime() + 7 * 24 * 60 * 60 * 1000
    : null
  const canAddSJ = !isCancelled && (!isComplete || (sevenDaysAfterComplete !== null && Date.now() <= sevenDaysAfterComplete))
  const dateDeadline = po.completed_at && Number.isFinite(Date.parse(po.completed_at)) ? Date.parse(po.completed_at) + 14 * 24 * 60 * 60 * 1000 : null
  // This action never grants a browser-clock deadline extension; the server decides eligibility.
  const canEditSJDate = !isCancelled && (!isComplete || dateDeadline !== null)
  const deletingSJ = sjList?.find(s => s.id === deletingSJId)

  return (
    <div className="min-h-screen bg-brand-canvas">
      <div ref={dateBackground} inert={activeModal} aria-hidden={activeModal ? true : undefined}>
      <AthelNav />
      <MainContent>
        {receipt}
        {!activeModal && recovery}

      {/* Header */}
      <div ref={successFocus} tabIndex={-1} className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <ActionLink variant="quiet" to="/athel/po" className="shrink-0">← Kembali</ActionLink>
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold text-gray-900">{po.po_number}</h1>
              <span className={`px-2.5 py-0.5 rounded-full text-[13px] font-medium ${STATUS_STYLES[po.status] ?? 'bg-gray-100 text-gray-600'}`}>
                {PO_STATUS_LABELS[po.status] ?? po.status}
              </span>
            </div>
            <p className="text-sm text-brand-secondary mt-0.5">{po.customers?.name}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 flex-wrap justify-end">
          {!isComplete && !isCancelled && (
            <ActionLink variant="quiet" size="compact" to={`/athel/po/${po.id}/edit`}>Ubah PO</ActionLink>
          )}
          <Button variant="danger-quiet" size="compact"
            disabled={isCancelled}
            onClick={event => { takePresentation(); dialogTrigger.current = event.currentTarget; dialogCommitted.current = false; setActionVersion(po.updated_at); setActionReason(''); setShowDeleteConfirm(true) }}

          >
            Batalkan PO
          </Button>
        </div>
      </div>

      <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto space-y-6">

        {(!lineReady || preparationError) && <div role={linesError || preparationError ? 'alert' : 'status'} className="text-sm text-red-700">
          {isPOConflict(lineError) ? 'PO berubah. Muat ulang sebelum melanjutkan.' : linesError || preparationError ? 'Data barang atau pengiriman belum lengkap. Pengiriman belum dapat diubah.' : 'Memuat seluruh barang PO…'}
          <Button variant="secondary" className="ml-2" onClick={() => void refreshPO()} disabled={refreshingPO}>Coba lagi</Button>
        </div>}
        {/* Status card */}
        <div className="min-w-0 bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="text-base font-medium text-gray-900 mb-4">Status</h2>
          <div className="flex items-center gap-3 flex-wrap">
            {['confirm', 'in_progress', 'complete'].map((s, i, arr) => (
              <div key={s} className="flex items-center gap-3">
                <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                  ${po.status === s
                    ? STATUS_STYLES[s]
                    : ['confirm', 'in_progress', 'complete'].indexOf(po.status) > i
                      ? 'bg-gray-100 text-brand-secondary'
                      : 'bg-gray-50 text-gray-300'
                  }`}
                >
                  {po.status === s && (
                    <span className="w-2 h-2 rounded-full bg-current opacity-70" />
                  )}
                  {PO_STATUS_LABELS[s]}
                </div>
                {i < arr.length - 1 && <span className="text-gray-300">→</span>}
              </div>
            ))}
            {canAddSJ && (
              <Button variant="primary"
                disabled={!lineReady || preparingSJ}
                  onClick={event => openNewSJModal(event.currentTarget)}
                className="ml-auto"
              >
                + Surat Jalan
              </Button>
            )}
          </div>
          <p className="mt-3 text-sm text-gray-600">Dikirim berarti jumlah barang tercatat pada SJ aktif. Selesai berarti seluruh jumlah PO sudah tercatat dikirim, bukan konfirmasi penerimaan toko.</p>
          {isComplete && (
            <p className="text-sm text-green-800 mt-3 font-medium">
              ✓ Semua jumlah barang sudah tercatat dikirim.
            </p>
          )}
        </div>

        {/* Order Details */}
        <div className="min-w-0 bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="text-base font-medium text-gray-900 mb-4">Rincian Pesanan</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm [overflow-wrap:anywhere]">
            <div>
              <p className="text-brand-secondary mb-1">Pelanggan</p>
              <p className="text-gray-900">{po.customers?.name}</p>
              <p className="mt-1 text-sm text-brand-secondary">Sales: <span className="font-medium">{savedPOSalesName(po)}</span></p>
            </div>
            <div>
              <p className="text-brand-secondary mb-1">Tanggal PO</p>
              <p className="text-gray-900">{formatDisplayDate(po.order_date)}</p>
            </div>
            <div>
              <p className="text-brand-secondary mb-1">Tanggal Kedaluwarsa PO</p>
              <p className="text-gray-900">{formatDisplayDate(po.expected_delivery_date)}</p>
            </div>
            <div>
              <p className="text-brand-secondary mb-1">Total</p>
              <p className="text-gray-900 font-semibold">
                Rp {po.total_value.toLocaleString('id-ID')}
              </p>
            </div>
            {po.notes && (
              <div className="sm:col-span-3">
                <p className="text-brand-secondary mb-1">Catatan</p>
                <p className="text-gray-900">{po.notes}</p>
              </div>
            )}
          </div>
        </div>


        {/* Line Items */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-base font-medium text-gray-900">Daftar Barang</h2>
            <p className="mt-1 text-[13px] text-gray-600">Geser tabel untuk melihat semua kolom.</p>
          </div>
          <div className="max-w-full overflow-x-auto" role="region" aria-label="Daftar barang PO" tabIndex={0}>
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-6 py-3 text-brand-secondary font-medium">Produk</th>
                <th className="text-left px-6 py-3 text-brand-secondary font-medium">SKU</th>
                <th className="text-right px-6 py-3 text-brand-secondary font-medium">Dipesan</th>
                {isInProgress && (
                  <th className="text-right px-6 py-3 text-brand-secondary font-medium">Sisa dikirim</th>
                )}
                <th className="text-right px-6 py-3 text-brand-secondary font-medium">Harga Satuan</th>
                <th className="text-right px-6 py-3 text-brand-secondary font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {lineItems?.map(item => (
                <tr key={item.id} className="border-b border-gray-50">
                  <td className="px-6 py-3 text-gray-900">{item.product_name}</td>
                  <td className="px-6 py-3 text-brand-secondary font-mono uppercase">
                    {item.sku ?? '—'}
                  </td>
                  <td className="px-6 py-3 text-right text-gray-700">{item.quantity}</td>
                  {isInProgress && (
                    <td className="px-6 py-3 text-right">
                      <span className={`font-medium ${
                        (outstanding[item.id] ?? 0) === 0
                          ? 'text-green-800'
                          : 'text-orange-700'
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
                <td colSpan={isInProgress ? 5 : 4} className="px-6 py-3 text-right text-sm text-brand-secondary font-medium">
                  Total
                </td>
                <td className="px-6 py-3 text-right text-gray-900 font-semibold">
                  Rp {po.total_value.toLocaleString('id-ID')}
                </td>
              </tr>
            </tfoot>
          </table>
          </div>
        </div>

        {/* Delivery headers are presentation only; quantities come from lineState. */}
        <div role="region" aria-label="Riwayat pengiriman" className="min-w-0 bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="text-base font-medium text-gray-900">Pengiriman (Daftar Surat Jalan)</h2>
          {deliveries.isError ? <p role="alert">Riwayat pengiriman gagal dimuat. <Button variant="secondary" onClick={() => deliveries.refetch()}>Coba lagi</Button></p>
            : <div aria-busy={deliveries.isPending}>
              {(sjList ?? []).map(sj => <div key={sj.id} className="py-4 border-b border-gray-100">
                <div className="flex flex-wrap justify-between gap-3"><div className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="font-medium text-sm">{sj.sj_number}</span>
                  {sj.voided_at && <p className="text-[13px] text-red-600">Dibatalkan: {sj.void_reason} · {formatAuditTimestamp(sj.voided_at)}</p>}
                  <p className="text-[13px] text-brand-secondary">Tanggal SJ: {formatDisplayDate(sj.sj_date)}</p>
                  {sj.sj_date_received && <p className="text-[13px] text-brand-secondary">Diterima Toko: {formatDisplayDate(sj.sj_date_received)}</p>}
                  {sj.sj_date_returned && <p className="text-[13px] text-brand-secondary">SJ Kembali: {formatDisplayDate(sj.sj_date_returned)}</p>}
                </div><div className="flex flex-wrap gap-3">
                  <Button variant="quiet" size="compact" disabled={deliveries.isPending} onClick={() => setSelectedSJId(selectedSJId === sj.id ? null : sj.id)} >{selectedSJId === sj.id ? 'Tutup barang' : 'Lihat barang'}</Button>
                  {canEditSJDate && !sj.voided_at && (['received', 'returned'] as const).map(kind => <Button key={kind} variant="quiet" size="compact" type="button" disabled={poFetching || deliveries.isPending || dateMutation.isPending} onClick={event => { takePresentation(); dateTrigger.current = event.currentTarget; dialogCommitted.current = false; dateReadSequence.current++; dateRead.current?.abort(); dateReviewRequired.current = false; setDateReview(null); setDateTarget({ id: sj.id, number: sj.sj_number, version: po.updated_at, kind }); setCorrectionDate(sj[`sj_date_${kind}`] ?? ''); dateMutation.reset() }} >{SJ_DATE_LABELS[kind].action}</Button>)}
                  {canAddSJ && !sj.voided_at && <>
                    <Button variant="quiet" size="compact" disabled={!lineReady || preparingSJ || deliveries.isPending} onClick={event => void openEditSJModal(sj, event.currentTarget)} >Ubah</Button>
                    <Button variant="danger-quiet" size="compact" disabled={deliveries.isPending} onClick={event => { takePresentation(); dialogTrigger.current = event.currentTarget; dialogCommitted.current = false; setActionVersion(po.updated_at); setActionReason(''); setDeletingSJId(sj.id) }} >Batalkan</Button>
                  </>}
                </div></div>
                {selectedSJId === sj.id && (selectedLines.isError ? <p role="alert">Barang pengiriman gagal dimuat. <Button variant="secondary" onClick={() => selectedLines.refetch()}>Coba lagi</Button></p>
                  : selectedLines.isPending ? <LoadingState title="Memuat barang…" shape="compact" /> : <div className="mt-3 max-w-full overflow-x-auto" role="region" aria-label={`Barang ${sj.sj_number}`} tabIndex={0}><table className="w-full min-w-[24rem] text-sm"><thead><tr><th className="text-left">Item</th><th>SKU</th><th>Qty Terkirim</th></tr></thead><tbody>
                    {selectedLines.data?.map(sli => { const li = lineItems?.find(line => line.id === sli.po_line_item_id); return <tr key={sli.id}><td>{li?.product_name ?? '—'}</td><td>{li?.sku ?? '—'}</td><td>{sli.quantity_delivered}</td></tr> })}
                  </tbody></table></div>)}
              </div>)}
              {!deliveries.isPending && sjList?.length === 0 && <p className="text-sm text-brand-secondary">Belum ada pengiriman.</p>}
              <PaginationControls page={deliveries.page} total={deliveries.data?.total ?? 0} pageSize={20} pending={deliveries.isPending} onPageChange={deliveries.setPage} />
            </div>}
        </div>

        {/* Audit Log */}
        <div className="min-w-0 bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="text-base font-medium text-gray-900 mb-4">Riwayat Perubahan</h2>
          {audits.isError ? <p role="alert">Riwayat perubahan gagal dimuat. <Button variant="secondary" onClick={() => audits.refetch()}>Coba lagi</Button></p> : !audits.isPending && auditLog?.length === 0 ? (
            <p className="text-sm text-brand-secondary">Belum ada perubahan tercatat.</p>
          ) : (
            <div className="space-y-3">
              {auditLog?.map(entry => (
                <div key={entry.id} className="flex gap-4 text-sm">
                  <div className="w-1 rounded-full bg-blue-200 shrink-0" />
                  <div className="min-w-0 [overflow-wrap:anywhere]">
                    <p className="text-gray-900">{summarizePOAudit(entry)}</p>
                    <p className="text-gray-600 text-[13px] mt-0.5">{formatAuditTimestamp(entry.changed_at)}</p>
                    <details className="mt-2 text-[13px] text-gray-600">
                      <summary className="w-fit min-h-[var(--ui-control-size-compact)] cursor-pointer rounded px-3 py-[var(--ui-control-padding-y-compact)] text-[length:var(--ui-text-control)] font-medium text-brand-primary underline underline-offset-4 hover:bg-brand-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary">Detail teknis audit</summary>
                      <dl className="mt-2 space-y-1">
                        <dt>Peristiwa asli</dt><dd>{entry.field_changed}</dd>
                        <dt>Waktu asli</dt><dd>{entry.changed_at}</dd>
                        <dt>Nilai sebelumnya</dt><dd className="whitespace-pre-wrap">{entry.old_value ?? 'null'}</dd>
                        <dt>Nilai sesudahnya</dt><dd className="whitespace-pre-wrap">{entry.new_value ?? 'null'}</dd>
                      </dl>
                    </details>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!audits.isError && <PaginationControls page={audits.page} total={audits.data?.total ?? 0} pageSize={20} pending={audits.isPending} onPageChange={audits.setPage} />}
        </div>

      </div>

      </MainContent>
      </div>
      {/* SJ Modal */}
      {showSJModal && (
        <Dialog labelledBy="sj-dialog-title" pending={transactionLocked} onClose={() => { if (!transactionLocked && !dialogBusy.current) closeSJModal() }} returnFocus={null} fallbackFocus={restoreDialogFocus} className="max-w-lg">
          <div className="min-w-0">
            <div className="px-6 py-5 border-b border-gray-100">
              <h3 id="sj-dialog-title" className="ui-dialog__title">
                {editingSJ ? 'Ubah Surat Jalan' : 'Surat Jalan Baru'}
              </h3>
              {recovery}
              <p className="text-[13px] text-brand-secondary mt-0.5">
                Masukkan jumlah pengiriman. Dibatasi sesuai sisa per barang.
              </p>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 space-y-1">
                <p>Diterima berarti tanggal penerimaan toko sudah dicatat; tanggal ini tidak menentukan status Selesai.</p>
                <p>SJ kembali berarti dokumen surat jalan kembali, bukan retur barang.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field id="sj-number" label="Nomor SJ *">{control => <input {...control} disabled={transactionLocked}
                    type="text"
                    aria-label="Nomor SJ"
                    value={sjNumber}
                    onChange={e => setSjNumber(e.target.value)}
                    placeholder="mis. SJ-2024-001"
                    className="max-w-full focus:outline-none focus:ring-2 focus:ring-brand-primary"
                  />}</Field>
                <Field id="sj-date" label="Tanggal SJ *">{control => <input {...control} type="date" aria-label="Tanggal SJ" disabled={transactionLocked} value={sjDate} onChange={e => setSjDate(e.target.value)} />}</Field>
                <Field id="sj-received" label="Tanggal SJ Diterima Toko">{control => <input {...control} type="date" aria-label="Tanggal SJ Diterima Toko" disabled={transactionLocked} value={sjDateReceived} onChange={e => setSjDateReceived(e.target.value)} />}</Field>
                <Field id="sj-returned" label="Tanggal SJ Kembali">{control => <input {...control} type="date" aria-label="Tanggal SJ Kembali" disabled={transactionLocked} value={sjDateReturned} onChange={e => setSjDateReturned(e.target.value)} />}</Field>
              </div>

              <div>
                <p className="mb-2 text-[13px] text-brand-secondary sm:hidden">Geser untuk melihat dan mengisi jumlah barang.</p>
                <div className="max-w-full overflow-x-auto" role="region" aria-label="Jumlah barang surat jalan" tabIndex={0}>
                  <div className="min-w-[26rem]">
                    <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_5.5rem_5rem] gap-2 text-[13px] text-brand-secondary font-medium px-1 mb-2">
                      <div className="min-w-0">Item</div>
                      <div className="min-w-0 [overflow-wrap:anywhere] text-right">Dipesan</div>
                      <div className="min-w-0 [overflow-wrap:anywhere] text-right">Sisa dikirim</div>
                      <div className="min-w-0 text-right">Dikirim</div>
                    </div>
                    <div className="space-y-2">
                      {sjLines.map((line, i) => (
                        <div key={line.po_line_item_id} className="grid grid-cols-[minmax(0,1fr)_4.5rem_5.5rem_5rem] gap-2 items-center">
                          <div className="min-w-0 [overflow-wrap:anywhere]">
                            <p className="text-sm text-gray-900">{line.product_name}</p>
                            {line.sku && (
                              <p className="text-[13px] text-brand-secondary font-mono uppercase">{line.sku}</p>
                            )}
                          </div>
                          <div className="min-w-0 [overflow-wrap:anywhere] text-right text-sm text-brand-secondary">
                            {line.quantity_ordered}
                          </div>
                          <div className="min-w-0 [overflow-wrap:anywhere] text-right text-sm font-medium">
                            <span className={line.quantity_outstanding === 0 ? 'text-green-800' : 'text-orange-700'}>
                              {line.quantity_outstanding}
                            </span>
                          </div>
                          <Field id={`sj-quantity-${line.po_line_item_id}`} label={<span className="sr-only">Jumlah dikirim {line.product_name}</span>} className="min-w-0">{control => <input {...control}
                              type="number"
                              aria-label={`Jumlah dikirim ${line.product_name}`}
                              min={0}
                              max={line.quantity_outstanding}
                              value={line.quantity_to_deliver}
                              onChange={e => updateSJLine(i, parseInt(e.target.value) || 0)}
                              disabled={transactionLocked || line.quantity_outstanding === 0}
                              className="max-w-full text-right focus:outline-none focus:ring-2 focus:ring-brand-primary disabled:bg-gray-50 disabled:text-gray-300"
                            />}</Field>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div aria-live="polite" className="mx-6 mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
              {!editingSJ && isComplete && sjLines.every(line => line.quantity_outstanding === 0)
                ? <><p>PO saat ini berstatus Selesai.</p><p>Tidak ada sisa jumlah barang untuk surat jalan baru.</p></>
                : deliveryWillComplete ? <><p>Setelah disimpan, PO akan berstatus Selesai karena seluruh jumlah pesanan sudah tercatat dikirim.</p><p>Status Selesai tetap berlaku jika tanggal penerimaan belum diisi. Catat penerimaan toko dan kembalinya dokumen SJ secara terpisah.</p></> : <p>Masih ada sisa barang yang belum tercatat dikirim; PO belum selesai.</p>}
            </div>
            <FormActions className="px-6 py-4 border-t border-gray-100">
              <Button variant="quiet"
                disabled={transactionLocked} onClick={() => { if (!transactionLocked && !dialogBusy.current) closeSJModal() }}

              >
                Batal
              </Button>
              <Button variant="primary"
                pending={sjMutation.isPending || updateSJMutation.isPending} onClick={handleSaveSJ}
                disabled={transactionLocked || !lineReady || editVersion !== lineState?.po_updated_at}

              >
                {sjMutation.isPending || updateSJMutation.isPending
                  ? 'Menyimpan...'
                  : editingSJ ? 'Simpan Perubahan SJ' : 'Simpan SJ'}
              </Button>
            </FormActions>
            {(!lineReady || editVersion !== lineState?.po_updated_at) && <p role="alert" className="px-6 pb-4 text-sm text-red-600">Data PO belum lengkap atau berubah. Tutup formulir lalu muat ulang sebelum menyimpan; isian Anda tetap terlihat sampai formulir ditutup.</p>}
            {(sjMutation.isError || updateSJMutation.isError) && (
              <p className="text-red-700 text-[13px] px-6 pb-4 text-right">
                {((sjMutation.error || updateSJMutation.error) as Error)?.message}
              </p>
            )}
          </div>
        </Dialog>
      )}

      {/* Delete SJ confirmation */}
      {deletingSJId && (
        <Dialog labelledBy="cancel-sj-title" pending={transactionLocked} onClose={() => { if (!transactionLocked && !dialogBusy.current) { dialogEpoch.current++; setDeletingSJId(null) } }} returnFocus={null} fallbackFocus={restoreDialogFocus}>
          <div className="min-w-0">
            <h3 id="cancel-sj-title" className="ui-dialog__title">Batalkan Surat Jalan?</h3>
            {recovery}
            <p className="text-sm text-brand-secondary mb-5">
              Apakah Anda yakin ingin membatalkan <strong>{deletingSJ?.sj_number}</strong>?
              Jumlah tidak lagi dihitung sebagai pengiriman aktif. Riwayat tetap disimpan.
            </p>
            <Field id="cancel-sj-reason" label="Alasan pembatalan">{control => <textarea {...control} disabled={transactionLocked} aria-label="Alasan pembatalan" value={actionReason} onChange={e => setActionReason(e.target.value)} placeholder="Alasan pembatalan (wajib)" />}</Field>
            {(deleteSJMutation.isError || deleteMutation.isError) && <p className="text-red-600 text-[13px] mb-3">{((deleteSJMutation.error || deleteMutation.error) as Error).message}</p>}
            <FormActions className="mt-4">
              <Button variant="quiet"
                disabled={transactionLocked} onClick={() => { if (!transactionLocked && !dialogBusy.current) { dialogEpoch.current++; setDeletingSJId(null) } }}

              >
                Batal
              </Button>
              <Button variant="danger"
                pending={deleteSJMutation.isPending} onClick={() => { if (!transactionLocked && !dialogBusy.current && actionReason.trim()) { dialogBusy.current = true; deleteSJMutation.mutate(deletingSJId) } }}
                disabled={transactionLocked || !actionReason.trim()}

              >
                {deleteSJMutation.isPending ? 'Membatalkan...' : 'Ya, batalkan'}
              </Button>
            </FormActions>
          </div>
        </Dialog>
      )}

      {/* Delete PO confirmation */}
      {showDeleteConfirm && (
        <Dialog labelledBy="cancel-po-title" pending={transactionLocked} onClose={() => { if (!transactionLocked && !dialogBusy.current) { dialogEpoch.current++; setShowDeleteConfirm(false) } }} returnFocus={null} fallbackFocus={restoreDialogFocus}>
          <div className="min-w-0">
            <h3 id="cancel-po-title" className="ui-dialog__title">
              Batalkan {po.po_number}?
            </h3>
            {recovery}
            <p className="text-sm text-brand-secondary mb-5">
             PO <strong>{po.po_number}</strong> dibatalkan tanpa menghapus riwayat. Pengiriman aktif harus diselesaikan melalui koreksi terlebih dahulu.
            </p>
            <Field id="cancel-po-reason" label="Alasan pembatalan">{control => <textarea {...control} disabled={transactionLocked} aria-label="Alasan pembatalan" value={actionReason} onChange={e => setActionReason(e.target.value)} placeholder="Alasan pembatalan (wajib)" />}</Field>
            {(deleteSJMutation.isError || deleteMutation.isError) && <p className="text-red-600 text-[13px] mb-3">{((deleteSJMutation.error || deleteMutation.error) as Error).message}</p>}
            <FormActions className="mt-4">
              <Button variant="quiet"
                disabled={transactionLocked} onClick={() => { if (!transactionLocked && !dialogBusy.current) { dialogEpoch.current++; setShowDeleteConfirm(false) } }}

              >
                Batal
              </Button>
              <Button variant="danger"
                pending={deleteMutation.isPending} onClick={() => { if (!transactionLocked && !dialogBusy.current && actionReason.trim()) { dialogBusy.current = true; deleteMutation.mutate() } }}
                disabled={transactionLocked || !actionReason.trim()}

              >
                {deleteMutation.isPending ? 'Membatalkan...' : 'Ya, batalkan'}
              </Button>
            </FormActions>
          </div>
        </Dialog>
      )}
      {dateTarget && <ReturnedDateDialog labelledBy="sj-date-title" pending={transactionLocked} onClose={() => { if (!transactionLocked && !dateBusy.current) closeCorrectionDate() }} returnFocus={null} fallbackFocus={restoreDateFocus}>
          <h2 id="sj-date-title" className="ui-dialog__title">{SJ_DATE_LABELS[dateTarget.kind].field} · {dateTarget.number}</h2>
          {recovery}
          {isComplete && dateDeadline !== null && <p className="mt-2 text-[13px] text-gray-600">Batas pengubahan: {new Date(dateDeadline).toLocaleString('id-ID')}. Waktu dan izin diperiksa oleh server saat menyimpan.</p>}
          <p className="mt-2 text-sm text-brand-secondary">{dateTarget.kind === 'received' ? 'Hanya mengubah tanggal penerimaan toko, bukan tanggal SJ kembali, jumlah barang, atau status PO.' : 'Hanya mengubah tanggal dokumen SJ kembali, bukan tanggal penerimaan toko atau retur barang.'} Kosongkan untuk menghapus tanggal.</p>
          <label htmlFor="sj-correction-date" className="ui-field__label mt-4 block text-gray-700">{SJ_DATE_LABELS[dateTarget.kind].field}</label>
          <input id="sj-correction-date" type="date" value={correctionDate} disabled={transactionLocked} onChange={event => setCorrectionDate(event.target.value)} className="ui-control mt-1 focus:outline-none focus:ring-2 focus:ring-brand-accent" />
          {dateMutation.isError && <p role="alert" className="mt-3 text-sm text-red-600">{(dateMutation.error as Error).message}</p>}
          {(isPOConflict(dateMutation.error) || dateTarget.version !== po.updated_at || dateReview) && <Button variant="secondary" type="button" onClick={() => void refreshCorrectionDate()} disabled={dateReview?.status === 'loading' || transactionLocked} className="mt-2">Muat ulang PO</Button>}
          {dateReview?.status === 'loading' && <LoadingState title="Memuat SJ dan versi PO terbaru…" shape="compact" className="mt-3 text-sm" />}
          {dateReview?.message && <p role="alert" className="mt-3 text-sm text-red-600">{dateReview.message}</p>}
          {dateReview?.value && <div className="mt-3 space-y-2 text-sm text-gray-600">
            <p>Tanggal tersimpan saat ini: {dateReview.value.sj.date ?? 'Belum diisi'}</p><p>Status SJ saat ini: {dateReview.value.sj.voided_at ? 'Dibatalkan' : 'Aktif'}</p>
            {dateReview.value.sj.void_reason && <p>Alasan pembatalan: {dateReview.value.sj.void_reason}</p>}
            <p>Periksa data tersimpan ini sebelum menggunakan versi baru. Tanggal yang Anda isi tetap dipertahankan.</p>
            {!dateReviewEligible && <p className="text-red-600">SJ tidak dapat diubah atau data berubah lagi. Muat ulang sebelum melanjutkan.</p>}
            <Button variant="secondary" type="button" disabled={!dateReviewEligible || transactionLocked} onClick={adoptSJDateReview} >Gunakan versi PO terbaru</Button>
          </div>}
          <FormActions className="mt-5">
            <Button variant="quiet" type="button" disabled={transactionLocked} onClick={() => { if (!transactionLocked && !dateBusy.current) closeCorrectionDate() }} >Batal</Button>
            <Button variant="primary" type="button" pending={dateMutation.isPending} onClick={() => void saveCorrectionDate()} disabled={transactionLocked || dateReviewRequired.current || poFetching || refreshingPO || dateTarget.version !== po.updated_at} >{dateMutation.isPending ? 'Menyimpan...' : SJ_DATE_LABELS[dateTarget.kind].save}</Button>
          </FormActions>
      </ReturnedDateDialog>}
    </div>
  )
}
