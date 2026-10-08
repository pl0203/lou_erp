import { formatMoney, moneyToChartNumber } from '../../lib/reads/money'
import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../lib/AuthContext'
import { parseCalendarDate } from '../../lib/calendarDate'
import { fetchCustomerDetail } from '../../lib/reads/customerDetailReads'
import { CustomerVisitHistory, CustomerOrderHistory, NextScheduledVisit } from '../../components/CustomerHistory'
import GirardNav from '../../components/GirardNav'
import { fetchCustomerStatsDetail } from '../../lib/CustomerStats'

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
  const diff = (Date.now() - parseCalendarDate(lastVisit).getTime()) / (1000 * 60 * 60 * 24)
  return diff > frequencyDays
}

export default function GirardCustomerDetail() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  // Remount view state on customer or identity changes; old expanded evidence never crosses scopes.
  const identity = `${profile?.id ?? ''}:${profile?.role ?? ''}`
  return <CustomerDetailView key={`${identity}:${id}`} id={id} identity={identity} enabled={!!id && !!profile?.id} />
}

function CustomerDetailView({ id, identity, enabled }: { id?: string; identity: string; enabled: boolean }) {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'overview' | 'visits' | 'orders'>('overview')
  const customerQuery = useQuery({
    queryKey: ['girard_customer', identity, id],
    queryFn: ({ signal }) => fetchCustomerDetail(id!, signal),
    enabled,
  })
  const { data: customer, isLoading } = customerQuery

  const { data: stats, isError: statsError, isLoading: statsLoading } = useQuery({
    queryKey: ['customer_stats_detail', identity, id],
    queryFn: ({ signal }) => fetchCustomerStatsDetail(id!, signal),
    enabled: enabled && !!customer,
  })

  if (isLoading || (!enabled && id)) {
    return (
      <div className="min-h-screen bg-brand-canvas">
        <GirardNav />
        <div className="p-8 text-gray-400 text-sm text-center">Loading...</div>
      </div>
    )
  }

  if (customerQuery.isError) {
    return <div className="min-h-screen bg-brand-canvas"><GirardNav />
      <div role="alert" className="p-6 text-sm text-red-600"><p>Gagal memuat pelanggan.</p>
        <button type="button" onClick={() => customerQuery.refetch()} className="mt-2 min-h-10 underline">Coba lagi</button>
      </div>
    </div>
  }

  if (!customer) {
    return (
      <div className="min-h-screen bg-brand-canvas">
        <GirardNav />
        <div className="p-8 text-red-500 text-sm">Pelanggan tidak ditemukan atau Anda tidak memiliki akses.</div>
      </div>
    )
  }

  const overdue = isOverdue(customer.last_visit_date, customer.visit_frequency_days)

  return (
    <div className="min-h-screen bg-brand-canvas">
      <GirardNav />

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex flex-wrap items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="text-gray-400 hover:text-gray-600 text-sm shrink-0"
        >
          ← Kembali
        </button>
        <div className="flex-1 min-w-0 basis-48">
          <h1 className="text-xl font-semibold text-gray-900 break-words [overflow-wrap:anywhere]">{customer.name}</h1>
          <p className="text-sm text-gray-500 mt-0.5 break-words [overflow-wrap:anywhere]">
            {[customer.address, customer.city].filter(Boolean).join(', ') || 'No address'}
          </p>
        </div>
        {overdue && (
          <span className="text-xs bg-red-100 text-red-600 px-2.5 py-1 rounded-full font-medium shrink-0">
            Kunjungan Terlambat
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-100 px-4 md:px-8">
        <div className="flex gap-1 overflow-x-auto" aria-label="Bagian pelanggan">
          {[
            { key: 'overview', label: 'Overview' },
            { key: 'visits',   label: 'Riwayat Kunjungan' },
            { key: 'orders',   label: 'Pesanan' },
          ].map(tab => (
            <button
              key={tab.key}
              aria-pressed={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
              className={`shrink-0 px-3 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-brand-accent text-brand-primary underline decoration-brand-primary underline-offset-4'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-5xl min-w-0 px-4 md:px-8 py-6 space-y-4">

        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <>
            <NextScheduledVisit customerId={customer.id} />
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-base font-medium text-gray-900 mb-4">Contact</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm break-words [overflow-wrap:anywhere]">
                <div>
                  <p className="text-gray-400 text-xs mb-1">Nomor Telepon</p>
                  <p className="text-gray-900">{customer.phone ?? '—'}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-xs mb-1">Email</p>
                  <p className="text-gray-900">{customer.email ?? '—'}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-xs mb-1">Alamat</p>
                  <p className="text-gray-900">
                    {[customer.address, customer.city].filter(Boolean).join(', ') || '—'}
                  </p>
                </div>
                <div>
                  <p className="text-gray-400 text-xs mb-1">Frekuensi Kunjungan</p>
                  <p className="text-gray-900">{frequencyLabel(customer.visit_frequency_days)}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="min-w-0 bg-white rounded-xl border border-gray-200 p-4 text-center break-words [overflow-wrap:anywhere]">
                <p className="text-xs text-gray-400 mb-1">Last Visit</p>
                <p className={`text-sm font-semibold ${overdue ? 'text-red-500' : 'text-gray-900'}`}>
                  {customer.last_visit_date
                    ? parseCalendarDate(customer.last_visit_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
                    : 'Never'}
                </p>
              </div>
              <div className="min-w-0 bg-white rounded-xl border border-gray-200 p-4 text-center break-words [overflow-wrap:anywhere]">
                <p className="text-xs text-gray-400 mb-1">Pelanggan Sejak</p>
                <p className="text-sm font-semibold text-gray-900">
                  {statsError || (!statsLoading && !stats) ? 'Tidak tersedia' : statsLoading || !stats ? 'Memuat...' : stats.first_order_date
                    ? parseCalendarDate(stats.first_order_date).toLocaleDateString('id-ID', { month: 'short', year: 'numeric' })
                    : '—'}
                </p>
              </div>
              <div className="min-w-0 bg-white rounded-xl border border-gray-200 p-4 text-center break-words [overflow-wrap:anywhere]">
                <p className="text-xs text-gray-400 mb-1">Pesanan (3bl)</p>
                <p className="text-sm font-semibold text-gray-900">{statsError || (!statsLoading && !stats) ? 'Tidak tersedia' : statsLoading || !stats ? 'Memuat...' : stats.order_count_3mo}</p>
              </div>
              <div className="min-w-0 bg-white rounded-xl border border-gray-200 p-4 text-center break-words [overflow-wrap:anywhere]">
                <p className="text-xs text-gray-400 mb-1">Penjualan (3bl)</p>
                <p className="text-sm font-semibold text-gray-900">
                  {statsError || (!statsLoading && !stats) ? 'Tidak tersedia' : statsLoading || !stats ? 'Memuat...' : !/^0(?:\.0+)?$/.test(String(stats.total_sales_3mo))
                    ? `Rp ${formatMoney(String(stats.total_sales_3mo), 'millions')}M`
                    : 'Rp 0'}
                </p>
              </div>
            </div>

            {!statsError && stats?.top_items && stats.top_items.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-base font-medium text-gray-900 mb-3">Barang Terlaris</h2>
                <div className="space-y-2">
                  {stats.top_items.map((item, i) => (
                    <div key={item.name} className="flex items-center gap-3">
                      <span className="text-xs text-gray-300 font-medium w-4">#{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-1">
                          <p className="text-sm text-gray-900 truncate">{item.name}</p>
                          <p className="min-w-0 text-xs text-gray-500 break-words [overflow-wrap:anywhere]">
                            Rp {formatMoney(String(item.revenue), 'full')}
                          </p>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-1">
                          <div
                            className="bg-green-500 h-1 rounded-full"
                            style={{
                              width: `${moneyToChartNumber(String(stats.top_items[0].revenue)) > 0
                                ? (moneyToChartNumber(String(item.revenue)) / moneyToChartNumber(String(stats.top_items[0].revenue))) * 100
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

        {activeTab === 'visits' && <CustomerVisitHistory customerId={customer.id} />}
        {activeTab === 'orders' && <CustomerOrderHistory customerId={customer.id} />}
      </div>
    </div>
  )
}
