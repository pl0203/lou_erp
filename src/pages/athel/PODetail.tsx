import { useState } from 'react'
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

type AuditEntry = {
  id: string
  field_changed: string
  old_value: string | null
  new_value: string | null
  changed_at: string
  users: { full_name: string }
}

type SJLineItem = {
  id: string
  po_line_item_id: string
  quantity_delivered: number
}

type SuratJalan = {
  id: string
  sj_number: string
  sj_date: string
  sj_date_received: string | null
  sj_date_returned: string | null
  sj_line_items: SJLineItem[]
}

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
}

async function fetchPO(id: string): Promise<PO> {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('id, po_number, status, order_date, expected_delivery_date, total_value, notes, customer_id, completed_at, customers(name)')
    .eq('id', id)
    .single()
  if (error) throw error
  return data as PO
}

async function fetchLineItems(poId: string): Promise<LineItem[]> {
  const { data, error } = await supabase
    .from('po_line_items')
    .select('id, product_name, sku, quantity, unit_price, line_total')
    .eq('purchase_order_id', poId)
  if (error) throw error
  return data
}

async function fetchAuditLog(poId: string): Promise<AuditEntry[]> {
  const { data, error } = await supabase
    .from('po_audit_log')
    .select('id, field_changed, old_value, new_value, changed_at, users(full_name)')
    .eq('purchase_order_id', poId)
    .order('changed_at', { ascending: false })
  if (error) throw error
  return data as AuditEntry[]
}

async function fetchSuratJalan(poId: string): Promise<SuratJalan[]> {
  const { data, error } = await supabase
    .from('surat_jalan')
    .select('id, sj_number, sj_date, sj_date_received, sj_date_returned, sj_line_items(id, po_line_item_id, quantity_delivered)')
    .eq('purchase_order_id', poId)
    .order('sj_date', { ascending: true })
  if (error) throw error
  return data as SuratJalan[]
}

async function updateStatus(id: string, status: string) {
  const { error } = await supabase
    .from('purchase_orders')
    .update({ status })
    .eq('id', id)
  if (error) throw error
}

async function createSJ(payload: {
  purchase_order_id: string
  sj_number: string
  sj_date: string
  sj_date_received: string | null
  sj_date_returned: string | null
  lines: { po_line_item_id: string; quantity_delivered: number }[]
}) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: sj, error: sjError } = await supabase
    .from('surat_jalan')
    .insert({
      purchase_order_id: payload.purchase_order_id,
      sj_number: payload.sj_number,
      sj_date: payload.sj_date,
      sj_date_received: payload.sj_date_received,
      sj_date_returned: payload.sj_date_returned,
      created_by: user.id,
    })
    .select()
    .single()

  if (sjError) throw sjError

  const { error: lineError } = await supabase
    .from('sj_line_items')
    .insert(
      payload.lines
        .filter(l => l.quantity_delivered > 0)
        .map(l => ({
          surat_jalan_id: sj.id,
          po_line_item_id: l.po_line_item_id,
          quantity_delivered: l.quantity_delivered,
        }))
    )

  if (lineError) throw lineError
}

async function updateSJ(payload: {
  sj_id: string
  sj_number: string
  sj_date: string
  sj_date_received: string | null
  sj_date_returned: string | null
  lines: { po_line_item_id: string; quantity_delivered: number }[]
}) {
  const { error: sjError } = await supabase
    .from('surat_jalan')
    .update({
      sj_number: payload.sj_number,
      sj_date: payload.sj_date,
      sj_date_received: payload.sj_date_received,
      sj_date_returned: payload.sj_date_returned,
    })
    .eq('id', payload.sj_id)
  if (sjError) throw sjError

  const { error: delError } = await supabase
    .from('sj_line_items')
    .delete()
    .eq('surat_jalan_id', payload.sj_id)
  if (delError) throw delError

  const { error: lineError } = await supabase
    .from('sj_line_items')
    .insert(
      payload.lines
        .filter(l => l.quantity_delivered > 0)
        .map(l => ({
          surat_jalan_id: payload.sj_id,
          po_line_item_id: l.po_line_item_id,
          quantity_delivered: l.quantity_delivered,
        }))
    )
  if (lineError) throw lineError
}

async function deleteSJ(sjId: string) {
  const { error } = await supabase
    .from('surat_jalan')
    .delete()
    .eq('id', sjId)
  if (error) throw error
}

async function deletePO(id: string) {
  const { error } = await supabase
    .from('purchase_orders')
    .delete()
    .eq('id', id)
  if (error) throw error
}

function computeOutstanding(
  lineItems: LineItem[],
  sjList: SuratJalan[]
): Record<string, number> {
  const delivered: Record<string, number> = {}
  for (const sj of sjList) {
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

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showSJModal, setShowSJModal] = useState(false)
  const [editingSJ, setEditingSJ] = useState<SuratJalan | null>(null)
  const [deletingSJId, setDeletingSJId] = useState<string | null>(null)

  const [sjNumber, setSjNumber] = useState('')
  const [sjDate, setSjDate] = useState('')
  const [sjDateReceived, setSjDateReceived] = useState('')
  const [sjDateReturned, setSjDateReturned] = useState('')
  const [sjLines, setSjLines] = useState<SJFormLine[]>([])

  const { data: po, isLoading } = useQuery({
    queryKey: ['po', id],
    queryFn: () => fetchPO(id!),
  })

  const { data: lineItems } = useQuery({
    queryKey: ['po_line_items', id],
    queryFn: () => fetchLineItems(id!),
    enabled: !!id,
  })

  const { data: auditLog } = useQuery({
    queryKey: ['po_audit_log', id],
    queryFn: () => fetchAuditLog(id!),
    enabled: !!id,
  })

  const { data: sjList } = useQuery({
    queryKey: ['surat_jalan', id],
    queryFn: () => fetchSuratJalan(id!),
    enabled: !!id,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['po', id] })
    queryClient.invalidateQueries({ queryKey: ['po_audit_log', id] })
    queryClient.invalidateQueries({ queryKey: ['surat_jalan', id] })
    queryClient.invalidateQueries({ queryKey: ['purchase_orders'] })
  }

  const sjMutation = useMutation({
    mutationFn: (payload: Parameters<typeof createSJ>[0]) => createSJ(payload),
    onSuccess: () => { invalidate(); closeSJModal() },
  })

  const updateSJMutation = useMutation({
    mutationFn: (payload: Parameters<typeof updateSJ>[0]) => updateSJ(payload),
    onSuccess: () => { invalidate(); closeSJModal() },
  })

  const deleteSJMutation = useMutation({
    mutationFn: (sjId: string) => deleteSJ(sjId),
    onSuccess: () => { invalidate(); setDeletingSJId(null) },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deletePO(id!),
    onSuccess: () => navigate('/athel/po'),
  })

  const outstanding = lineItems && sjList
    ? computeOutstanding(lineItems, sjList)
    : {}

  const openNewSJModal = () => {
    if (!lineItems || !sjList) return
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

  const openEditSJModal = (sj: SuratJalan) => {
    if (!lineItems || !sjList) return
    const otherSJs = sjList.filter(s => s.id !== sj.id)
    const outstandingExcluding = computeOutstanding(lineItems, otherSJs)
    setSjNumber(sj.sj_number)
    setSjDate(sj.sj_date)
    setSjDateReceived(sj.sj_date_received ?? '')
    setSjDateReturned(sj.sj_date_returned ?? '')
    setSjLines(lineItems.map(li => {
      const existing = sj.sj_line_items.find(sli => sli.po_line_item_id === li.id)
      return {
        po_line_item_id: li.id,
        product_name: li.product_name,
        sku: li.sku,
        quantity_ordered: li.quantity,
        quantity_outstanding: outstandingExcluding[li.id] ?? 0,
        quantity_to_deliver: existing?.quantity_delivered ?? 0,
      }
    }))
    setEditingSJ(sj)
    setShowSJModal(true)
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
    if (!sjNumber.trim()) return alert('SJ number is required.')
    if (!sjDate) return alert('SJ date is required.')
    if (sjLines.every(l => l.quantity_to_deliver === 0))
      return alert('At least one item must have a delivery quantity.')

    if (editingSJ) {
      updateSJMutation.mutate({
        sj_id: editingSJ.id,
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
      if (po?.status === 'confirm') {
        await updateStatus(id!, 'in_progress')
      }
      sjMutation.mutate({
        purchase_order_id: id!,
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
  if (!po) return <div className="p-8 text-red-500 text-sm">PO not found.</div>
  
  const isInProgress = po.status === 'in_progress'
  const isComplete = po.status === 'complete'
  const sevenDaysAfterComplete = po.completed_at
    ? new Date(po.completed_at).getTime() + 7 * 24 * 60 * 60 * 1000
    : null
  const canAddSJ = !isComplete || (sevenDaysAfterComplete !== null && Date.now() <= sevenDaysAfterComplete)
  const deletingSJ = sjList?.find(s => s.id === deletingSJId)

  return (
    <div className="min-h-screen bg-gray-50">
      <AthelNav />

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
          {!isComplete && (
            <button
              onClick={() => navigate(`/athel/po/${po.id}/edit`)}
              className="text-sm font-medium text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 px-3 py-1.5 rounded-lg transition-colors"
            >
              Ubah PO
            </button>
          )}
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="text-sm text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 px-3 py-1.5 rounded-lg transition-colors"
          >
            Hapus PO
          </button>
        </div>
      </div>

      <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto space-y-6">

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
              <p className="text-gray-400 mb-1">Tanggal PO Expired</p>
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
                    Rp {item.unit_price.toLocaleString('id-ID')}
                  </td>
                  <td className="px-6 py-3 text-right text-gray-900 font-medium">
                    Rp {item.line_total.toLocaleString('id-ID')}
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

        {/* Deliveries */}
        {sjList && sjList.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-medium text-gray-900">Pengiriman (Daftar Surat Jalan)</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {sjList.map(sj => (
                <div key={sj.id} className="px-6 py-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <span className="font-medium text-gray-900 text-sm">{sj.sj_number}</span>
                      <div className="flex gap-4 mt-1 flex-wrap">
                        <span className="text-gray-400 text-xs">Created: {sj.sj_date}</span>
                        {sj.sj_date_received && (
                          <span className="text-gray-400 text-xs">Diterima Toko: {sj.sj_date_received}</span>
                        )}
                        {sj.sj_date_returned && (
                          <span className="text-gray-400 text-xs">SJ Kembali: {sj.sj_date_returned}</span>
                        )}
                      </div>
                    </div>
                    {canAddSJ && (
                      <div className="flex gap-3 shrink-0">
                        <button
                          onClick={() => openEditSJModal(sj)}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                        >
                          Ubah
                        </button>
                        <button
                          onClick={() => setDeletingSJId(sj.id)}
                          className="text-red-400 hover:text-red-600 text-xs font-medium"
                        >
                          Hapus
                        </button>
                      </div>
                    )}
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400">
                        <th className="text-left pb-1 font-medium">Item</th>
                        <th className="text-left pb-1 font-medium">SKU</th>
                        <th className="text-right pb-1 font-medium">Qty Terkirim</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sj.sj_line_items.map(sli => {
                        const li = lineItems?.find(l => l.id === sli.po_line_item_id)
                        return (
                          <tr key={sli.id}>
                            <td className="py-0.5 text-gray-700">{li?.product_name ?? '—'}</td>
                            <td className="py-0.5 text-gray-400 font-mono uppercase">{li?.sku ?? '—'}</td>
                            <td className="py-0.5 text-right text-gray-700 font-medium">
                              {sli.quantity_delivered}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Audit Log */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-medium text-gray-900 mb-4">Riwayat Perubahan</h2>
          {!auditLog || auditLog.length === 0 ? (
            <p className="text-sm text-gray-400">Belum ada perubahan tercatat.</p>
          ) : (
            <div className="space-y-3">
              {auditLog.map(entry => (
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
                disabled={sjMutation.isPending || updateSJMutation.isPending}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {sjMutation.isPending || updateSJMutation.isPending
                  ? 'Menyimpan...'
                  : editingSJ ? 'Update SJ' : 'Create SJ'}
              </button>
            </div>
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
            <h3 className="text-base font-semibold text-gray-900 mb-2">Delete Surat Jalan?</h3>
            <p className="text-sm text-gray-500 mb-5">
              Apakah Anda yakin ingin menghapus <strong>{deletingSJ?.sj_number}</strong>?
              Tindakan ini akan membatalkan jumlah pengiriman.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeletingSJId(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                onClick={() => deleteSJMutation.mutate(deletingSJId)}
                disabled={deleteSJMutation.isPending}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteSJMutation.isPending ? 'Deleting...' : 'Yes, delete'}
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
              Hapus {po.po_number}?
            </h3>
            <p className="text-sm text-gray-500 mb-5">
             Tindakan ini akan menghapus permanen PO <strong>{po.po_number}</strong> beserta semua barangnya. Tindakan ini tidak dapat dibatalkan.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Menghapus...' : 'Ya, hapus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}