import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import GirardNav from '../../components/GirardNav'

type MyOrder = {
  id: string
  status: string
  total_value: number
  created_at: string
  rejection_note: string | null
  customers: { name: string }
  girard_order_items: {
    id: string
    product_name: string
    sku: string | null
    quantity: number
    unit_price: number
  }[]
}

const STATUS_STYLES: Record<string, string> = {
  pending:  'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
}

const STATUS_LABELS: Record<string, string> = {
  pending:  'Pending Review',
  approved: 'Approved',
  rejected: 'Rejected',
}

async function fetchMyOrders(userId: string, status: string): Promise<MyOrder[]> {
  let query = supabase
    .from('girard_orders')
    .select(`
      id, status, total_value, created_at, rejection_note,
      customers!girard_orders_customer_id_fkey(name),
      girard_order_items(id, product_name, sku, quantity, unit_price)
    `)
    .eq('submitted_by', userId)
    .order('created_at', { ascending: false })

  if (status !== 'all') query = query.eq('status', status)

  const { data, error } = await query
  if (error) throw error
  return data as MyOrder[]
}

export default function MyOrders() {
  const { profile } = useAuth()
  const [statusFilter, setStatusFilter] = useState('all')

  const { data: orders, isLoading } = useQuery({
    queryKey: ['my_orders', profile?.id, statusFilter],
    queryFn: () => fetchMyOrders(profile!.id, statusFilter),
    enabled: !!profile?.id,
  })

  const pendingCount = orders?.filter(o => o.status === 'pending').length ?? 0
  const approvedCount = orders?.filter(o => o.status === 'approved').length ?? 0
  const rejectedCount = orders?.filter(o => o.status === 'rejected').length ?? 0

  return (
    <div className="min-h-screen bg-gray-50">
      <GirardNav />

      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5">
        <h1 className="text-xl font-semibold text-gray-900">My Orders</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Orders you've submitted from the field
        </p>
      </div>

      {/* Summary pills */}
      <div className="bg-white border-b border-gray-100 px-4 md:px-8 py-3 flex gap-3 flex-wrap">
        <div className="text-xs bg-yellow-100 text-yellow-700 px-3 py-1.5 rounded-full font-medium">
          {pendingCount} pending
        </div>
        <div className="text-xs bg-green-100 text-green-700 px-3 py-1.5 rounded-full font-medium">
          {approvedCount} approved
        </div>
        <div className="text-xs bg-red-100 text-red-600 px-3 py-1.5 rounded-full font-medium">
          {rejectedCount} rejected
        </div>
      </div>

      {/* Filter tabs */}
      <div className="bg-white border-b border-gray-100 px-4 md:px-8">
        <div className="flex gap-1">
          {[
            { value: 'all',      label: 'All' },
            { value: 'pending',  label: 'Pending' },
            { value: 'approved', label: 'Approved' },
            { value: 'rejected', label: 'Rejected' },
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
        {isLoading && (
          <div className="text-center text-gray-400 text-sm py-24">Loading orders...</div>
        )}

        {!isLoading && (!orders || orders.length === 0) && (
          <div className="text-center py-24">
            <p className="text-gray-400 text-sm">No orders found.</p>
            <p className="text-gray-300 text-xs mt-1">
              Orders you place during customer visits will appear here.
            </p>
          </div>
        )}

        {orders?.map(order => (
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
                    Rp {order.total_value.toLocaleString('id-ID')}
                  </p>
                </div>
              </div>

              {/* Rejection note */}
              {order.status === 'rejected' && order.rejection_note && (
                <div className="mt-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  <p className="text-xs text-red-600 font-medium mb-0.5">Reason for rejection</p>
                  <p className="text-xs text-red-500">{order.rejection_note}</p>
                </div>
              )}

              {/* Pending message */}
              {order.status === 'pending' && (
                <div className="mt-3 bg-yellow-50 border border-yellow-100 rounded-lg px-3 py-2">
                  <p className="text-xs text-yellow-700">
                    This order is awaiting review by the PO admin.
                  </p>
                </div>
              )}

              {/* Approved message */}
              {order.status === 'approved' && (
                <div className="mt-3 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                  <p className="text-xs text-green-700">
                    This order has been approved and a PO has been created.
                  </p>
                </div>
              )}
            </div>

            {/* Line items */}
            <div className="px-5 py-3">
              <p className="text-xs text-gray-400 mb-2">Items ordered</p>
              <div className="space-y-1.5">
                {order.girard_order_items.map(item => (
                  <div key={item.id} className="flex items-center justify-between text-sm">
                    <div className="flex-1 min-w-0">
                      <span className="text-gray-900 truncate block">{item.product_name}</span>
                      {item.sku && (
                        <span className="text-xs text-gray-400 font-mono uppercase">{item.sku}</span>
                      )}
                    </div>
                    <div className="text-right ml-4 shrink-0">
                      <p className="text-gray-600 text-xs">x{item.quantity}</p>
                      <p className="text-gray-900 font-medium text-xs">
                        Rp {(item.quantity * item.unit_price).toLocaleString('id-ID')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}