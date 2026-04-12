import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import AthelNav from '../../components/AthelNav'
import { useNavigate } from 'react-router-dom'

type GirardOrder = {
  id: string
  status: string
  total_value: number
  created_at: string
  rejection_note: string | null
  customers: { name: string }
  users: { full_name: string }
  girard_order_items: {
    id: string
    product_name: string
    sku: string | null
    quantity: number
    unit_price: number
  }[]
}

type ConvertForm = {
  po_number: string
  customer_id: string
  expected_delivery_date: string
}

const STATUS_STYLES: Record<string, string> = {
  pending:  'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
}

async function fetchGirardOrders(status: string): Promise<GirardOrder[]> {
  let query = supabase
    .from('girard_orders')
    .select(`
      id, status, total_value, created_at, rejection_note,
      customers!girard_orders_customer_id_fkey(name),
      users!girard_orders_submitted_by_fkey(full_name),
      girard_order_items(id, product_name, sku, quantity, unit_price)
    `)
    .order('created_at', { ascending: false })

  if (status !== 'all') query = query.eq('status', status)

  const { data, error } = await query
  if (error) throw error
  return data as GirardOrder[]
}

async function approveOrder(orderId: string, poNumber: string, expectedDelivery: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Get order details
  const { data: order, error: orderError } = await supabase
    .from('girard_orders')
    .select('customer_id, girard_order_items(product_name, sku, quantity, unit_price)')
    .eq('id', orderId)
    .single()
  if (orderError) throw orderError

  // Create PO in Athel
  const { data: po, error: poError } = await supabase
    .from('purchase_orders')
    .insert({
      customer_id: order.customer_id,
      created_by: user.id,
      po_number: poNumber,
      status: 'confirm',
      order_date: new Date().toISOString().split('T')[0],
      expected_delivery_date: expectedDelivery || null,
    })
    .select()
    .single()
  if (poError) throw poError

  // Create PO line items
  const { error: lineError } = await supabase
    .from('po_line_items')
    .insert(
      order.girard_order_items.map((item: any) => ({
        purchase_order_id: po.id,
        product_name: item.product_name,
        sku: item.sku || null,
        quantity: item.quantity,
        unit_price: item.unit_price,
      }))
    )
  if (lineError) throw lineError

  // Update girard order status and link to PO
  const { error: updateError } = await supabase
    .from('girard_orders')
    .update({
      status: 'approved',
      reviewed_by: user.id,
      po_id: po.id,
    })
    .eq('id', orderId)
  if (updateError) throw updateError

  return po
}

async function rejectOrder(orderId: string, note: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('girard_orders')
    .update({
      status: 'rejected',
      reviewed_by: user.id,
      rejection_note: note,
    })
    .eq('id', orderId)
  if (error) throw error
}

export default function SalesOrders() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState('pending')
  const [approvingOrder, setApprovingOrder] = useState<GirardOrder | null>(null)
  const [rejectingOrder, setRejectingOrder] = useState<GirardOrder | null>(null)
  const [poNumber, setPoNumber] = useState('')
  const [expectedDelivery, setExpectedDelivery] = useState('')
  const [rejectionNote, setRejectionNote] = useState('')

  const { data: orders, isLoading } = useQuery({
    queryKey: ['girard_orders', statusFilter],
    queryFn: () => fetchGirardOrders(statusFilter),
  })

  const approveMutation = useMutation({
    mutationFn: () => approveOrder(approvingOrder!.id, poNumber, expectedDelivery),
    onSuccess: (po) => {
      queryClient.invalidateQueries({ queryKey: ['girard_orders'] })
      queryClient.invalidateQueries({ queryKey: ['purchase_orders'] })
      setApprovingOrder(null)
      setPoNumber('')
      setExpectedDelivery('')
      navigate(`/athel/po/${po.id}`)
    },
  })

  const rejectMutation = useMutation({
    mutationFn: () => rejectOrder(rejectingOrder!.id, rejectionNote),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['girard_orders'] })
      setRejectingOrder(null)
      setRejectionNote('')
    },
  })

  const pendingCount = orders?.filter(o => o.status === 'pending').length ?? 0

  return (
    <div className="min-h-screen bg-gray-50">
      <AthelNav />

      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Pesanan dari Sales</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Pesanan yang diajukan tim Sales dari lapangan
          </p>
        </div>
        {pendingCount > 0 && statusFilter !== 'pending' && (
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
            { value: 'all',      label: 'Semua' },
          ].map(tab => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                statusFilter === tab.value
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 md:px-8 py-6 space-y-4">
        {isLoading && (
          <div className="text-center text-gray-400 text-sm py-24">Memuat PO...</div>
        )}

        {!isLoading && orders?.length === 0 && (
          <div className="text-center py-24">
            <p className="text-gray-400 text-sm">Tidak {statusFilter !== 'all' ? statusFilter : ''} ada PO ditemukan.</p>
          </div>
        )}

        {orders?.map(order => (
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
                Rp {order.total_value.toLocaleString('id-ID')}
              </p>
            </div>

            {/* Line items */}
            <div className="px-5 py-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400">
                    <th className="text-left pb-2 font-medium">Produk</th>
                    <th className="text-left pb-2 font-medium hidden sm:table-cell">SKU</th>
                    <th className="text-right pb-2 font-medium">Qty</th>
                    <th className="text-right pb-2 font-medium">Harga Satuan</th>
                    <th className="text-right pb-2 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {order.girard_order_items.map(item => (
                    <tr key={item.id} className="border-t border-gray-50">
                      <td className="py-1.5 text-gray-700">{item.product_name}</td>
                      <td className="py-1.5 text-gray-400 font-mono uppercase hidden sm:table-cell">
                        {item.sku ?? '—'}
                      </td>
                      <td className="py-1.5 text-right text-gray-700">{item.quantity}</td>
                      <td className="py-1.5 text-right text-gray-700">
                        Rp {item.unit_price.toLocaleString('id-ID')}
                      </td>
                      <td className="py-1.5 text-right text-gray-900 font-medium">
                        Rp {(item.quantity * item.unit_price).toLocaleString('id-ID')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Actions — only for pending */}
            {order.status === 'pending' && (
              <div className="px-5 py-4 border-t border-gray-100 flex gap-3 justify-end">
                <button
                  onClick={() => setRejectingOrder(order)}
                  className="px-4 py-2 text-sm text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                >
                  Tolak
                </button>
                <button
                  onClick={() => {
                    setApprovingOrder(order)
                    setPoNumber('')
                    setExpectedDelivery('')
                  }}
                  className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Setuju & Buat menjadi PO
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Approve modal */}
      {approvingOrder && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-xl">
            <div className="px-6 py-5 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">Setuju & Buat menjadi PO</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Tindakan ini akan membuat PO baru di Athel untuk {approvingOrder.customers?.name}
              </p>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Nomor PO *</label>
                <input
                  type="text"
                  value={poNumber}
                  onChange={e => setPoNumber(e.target.value)}
                  placeholder="e.g. PO-2024-050"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Tanggal PO Expired <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  type="date"
                  value={expectedDelivery}
                  onChange={e => setExpectedDelivery(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Order summary */}
              <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                <p className="text-xs text-gray-500 font-medium mb-2">Ringkasan PO</p>
                {approvingOrder.girard_order_items.map(item => (
                  <div key={item.id} className="flex justify-between text-xs text-gray-600">
                    <span>{item.product_name} x{item.quantity}</span>
                    <span>Rp {(item.quantity * item.unit_price).toLocaleString('id-ID')}</span>
                  </div>
                ))}
                <div className="flex justify-between text-xs font-semibold text-gray-900 pt-2 border-t border-gray-200 mt-2">
                  <span>Total</span>
                  <span>Rp {approvingOrder.total_value.toLocaleString('id-ID')}</span>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => { setApprovingOrder(null); setPoNumber('') }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                onClick={() => {
                  if (!poNumber.trim()) return alert('PO number is required.')
                  approveMutation.mutate()
                }}
                disabled={approveMutation.isPending}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
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
        </div>
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
                Alasan penolakan <span className="text-gray-400">(opsional)</span>
              </label>
              <textarea
                value={rejectionNote}
                onChange={e => setRejectionNote(e.target.value)}
                rows={3}
                placeholder="e.g. Item out of stock, please resubmit next week"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
              />
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => { setRejectingOrder(null); setRejectionNote('') }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                onClick={() => rejectMutation.mutate()}
                disabled={rejectMutation.isPending}
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