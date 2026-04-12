import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import GirardNav from '../../components/GirardNav'
import { fetchCustomerStatsDetail } from '../../lib/CustomerStats'

type Customer = {
  id: string
  name: string
  address: string | null
  city: string | null
  phone: string | null
  email: string | null
  last_visit_date: string | null
  visit_frequency_days: number
}

type VisitHistory = {
  id: string
  checked_in_at: string
  users: { full_name: string }
}

type OrderHistory = {
  id: string
  po_number: string
  status: string
  total_value: number
  order_date: string
  expected_delivery_date: string | null
}

const FREQUENCY_OPTIONS = [
  { days: 3,  label: '2x per week' },
  { days: 7,  label: '1x per week' },
  { days: 14, label: '1x per 2 weeks' },
  { days: 15, label: '2x per month' },
  { days: 30, label: '1x per month' },
]

function frequencyLabel(days: number): string {
  return FREQUENCY_OPTIONS.find(f => f.days === days)?.label ?? `Every ${days} days`
}

function isOverdue(lastVisit: string | null, frequencyDays: number): boolean {
  if (!lastVisit) return true
  const diff = (Date.now() - new Date(lastVisit).getTime()) / (1000 * 60 * 60 * 24)
  return diff > frequencyDays
}

async function fetchCustomer(id: string): Promise<Customer> {
  const { data, error } = await supabase
    .from('customers')
    .select('id, name, address, city, phone, email, last_visit_date, visit_frequency_days')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

async function fetchVisitHistory(customerId: string): Promise<VisitHistory[]> {
  const { data, error } = await supabase
    .from('outlet_visits')
    .select('id, checked_in_at, users!outlet_visits_sales_person_id_fkey(full_name)')
    .eq('outlet_id', customerId)
    .order('checked_in_at', { ascending: false })
    .limit(10)
  if (error) throw error
  return data as VisitHistory[]
}

async function fetchOrderHistory(customerId: string): Promise<OrderHistory[]> {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('id, po_number, status, total_value, order_date, expected_delivery_date')
    .eq('customer_id', customerId)
    .order('order_date', { ascending: false })
    .limit(20)
  if (error) throw error
  return data as OrderHistory[]
}

export default function GirardCustomerDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'overview' | 'visits' | 'orders'>('overview')

  const { data: customer, isLoading } = useQuery({
    queryKey: ['girard_customer', id],
    queryFn: () => fetchCustomer(id!),
    enabled: !!id,
  })

  const { data: visitHistory } = useQuery({
    queryKey: ['visit_history', id],
    queryFn: () => fetchVisitHistory(id!),
    enabled: !!id,
  })

  const { data: orderHistory } = useQuery({
    queryKey: ['order_history', id],
    queryFn: () => fetchOrderHistory(id!),
    enabled: !!id,
  })

  const { data: stats } = useQuery({
    queryKey: ['customer_stats_detail', id],
    queryFn: () => fetchCustomerStatsDetail(id!),
    enabled: !!id,
  })

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <GirardNav />
        <div className="p-8 text-gray-400 text-sm text-center">Loading...</div>
      </div>
    )
  }

  if (!customer) {
    return (
      <div className="min-h-screen bg-gray-50">
        <GirardNav />
        <div className="p-8 text-red-500 text-sm">Customer not found.</div>
      </div>
    )
  }

  const overdue = isOverdue(customer.last_visit_date, customer.visit_frequency_days)

  return (
    <div className="min-h-screen bg-gray-50">
      <GirardNav />

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex items-center gap-4">
        <button
          onClick={() => navigate(-1)}
          className="text-gray-400 hover:text-gray-600 text-sm shrink-0"
        >
          ← Back
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-gray-900 truncate">{customer.name}</h1>
          <p className="text-sm text-gray-500 mt-0.5 truncate">
            {[customer.address, customer.city].filter(Boolean).join(', ') || 'No address'}
          </p>
        </div>
        {overdue && (
          <span className="text-xs bg-red-100 text-red-600 px-2.5 py-1 rounded-full font-medium shrink-0">
            Visit overdue
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-100 px-4 md:px-8">
        <div className="flex gap-1">
          {[
            { key: 'overview', label: 'Overview' },
            { key: 'visits',   label: 'Visit History' },
            { key: 'orders',   label: 'Orders' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-green-600 text-green-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 md:px-8 py-6 space-y-4">

        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-base font-medium text-gray-900 mb-4">Contact</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-400 text-xs mb-1">Phone</p>
                  <p className="text-gray-900">{customer.phone ?? '—'}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-xs mb-1">Email</p>
                  <p className="text-gray-900">{customer.email ?? '—'}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-xs mb-1">Address</p>
                  <p className="text-gray-900">
                    {[customer.address, customer.city].filter(Boolean).join(', ') || '—'}
                  </p>
                </div>
                <div>
                  <p className="text-gray-400 text-xs mb-1">Visit Frequency</p>
                  <p className="text-gray-900">{frequencyLabel(customer.visit_frequency_days)}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                <p className="text-xs text-gray-400 mb-1">Last Visit</p>
                <p className={`text-sm font-semibold ${overdue ? 'text-red-500' : 'text-gray-900'}`}>
                  {customer.last_visit_date
                    ? new Date(customer.last_visit_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
                    : 'Never'}
                </p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                <p className="text-xs text-gray-400 mb-1">Customer Since</p>
                <p className="text-sm font-semibold text-gray-900">
                  {stats?.first_order_date
                    ? new Date(stats.first_order_date).toLocaleDateString('id-ID', { month: 'short', year: 'numeric' })
                    : '—'}
                </p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                <p className="text-xs text-gray-400 mb-1">Orders (3mo)</p>
                <p className="text-sm font-semibold text-gray-900">{stats?.order_count_3mo ?? 0}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                <p className="text-xs text-gray-400 mb-1">Sales (3mo)</p>
                <p className="text-sm font-semibold text-gray-900">
                  {stats?.total_sales_3mo
                    ? `Rp ${(stats.total_sales_3mo / 1_000_000).toFixed(1)}M`
                    : 'Rp 0'}
                </p>
              </div>
            </div>

            {stats?.top_items && stats.top_items.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-base font-medium text-gray-900 mb-3">Top Ordered Items</h2>
                <div className="space-y-2">
                  {stats.top_items.map((item, i) => (
                    <div key={item.name} className="flex items-center gap-3">
                      <span className="text-xs text-gray-300 font-medium w-4">#{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm text-gray-900 truncate">{item.name}</p>
                          <p className="text-xs text-gray-500 ml-2 shrink-0">
                            Rp {item.revenue.toLocaleString('id-ID')}
                          </p>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-1">
                          <div
                            className="bg-green-500 h-1 rounded-full"
                            style={{
                              width: `${stats.top_items[0].revenue > 0
                                ? (item.revenue / stats.top_items[0].revenue) * 100
                                : 0}%`
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* VISIT HISTORY TAB */}
        {activeTab === 'visits' && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-medium text-gray-900">Visit History</h2>
              <p className="text-xs text-gray-400 mt-0.5">Last 10 visits</p>
            </div>
            {!visitHistory || visitHistory.length === 0 ? (
              <div className="px-5 py-12 text-center text-gray-400 text-sm">
                No visits recorded yet.
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {visitHistory.map(visit => (
                  <div key={visit.id} className="px-5 py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {new Date(visit.checked_in_at).toLocaleDateString('id-ID', {
                            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
                          })}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {new Date(visit.checked_in_at).toLocaleTimeString('id-ID', {
                            hour: '2-digit', minute: '2-digit'
                          })} · {(visit.users as any)?.full_name ?? '—'}
                        </p>
                      </div>
                      <span className="text-xs bg-green-100 text-green-700 px-2.5 py-0.5 rounded-full font-medium">
                        Visited
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ORDERS TAB */}
        {activeTab === 'orders' && (
          <div className="space-y-3">
            {!orderHistory || orderHistory.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 px-5 py-12 text-center text-gray-400 text-sm">
                No purchase orders recorded yet.
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-5 py-3 font-medium text-gray-500">PO Number</th>
                      <th className="text-left px-5 py-3 font-medium text-gray-500 hidden sm:table-cell">Order Date</th>
                      <th className="text-left px-5 py-3 font-medium text-gray-500">Status</th>
                      <th className="text-right px-5 py-3 font-medium text-gray-500">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderHistory.map(po => (
                      <tr key={po.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-5 py-3 font-medium text-gray-900">{po.po_number}</td>
                        <td className="px-5 py-3 text-gray-500 text-xs hidden sm:table-cell">
                          {new Date(po.order_date).toLocaleDateString('id-ID', {
                            day: 'numeric', month: 'short', year: 'numeric'
                          })}
                        </td>
                        <td className="px-5 py-3">
                          <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium capitalize ${
                            po.status === 'complete'     ? 'bg-green-100 text-green-700'
                            : po.status === 'in_progress' ? 'bg-yellow-100 text-yellow-700'
                            : po.status === 'confirm'     ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-500'
                          }`}>
                            {po.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right font-medium text-gray-900">
                          Rp {po.total_value.toLocaleString('id-ID')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

function CheckInPhoto({ storagePath }: { storagePath: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    supabase.storage
      .from('visits')
      .createSignedUrl(storagePath, 3600)
      .then(({ data }) => { if (data) setUrl(data.signedUrl) })
  }, [storagePath])

  if (!url) return null
  return <img src={url} alt="Check-in photo" className="w-full h-48 object-cover rounded-xl" />
}