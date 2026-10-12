import { Button } from '../../components/ui/Button'
import { MainContent } from '../../components/ui/MainContent'
import { PageHeader } from '../../components/ui/PageHeader'
import { Section } from '../../components/ui/Section'
import { SummaryList } from '../../components/ui/SummaryList'
import { EmptyState, Notice, StatusBadge } from '../../components/ui/Feedback'
import StorePOContext from '../../components/StorePOContext'
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
        <MainContent className="p-4 md:p-8"><Notice tone="info" title="Memuat pelanggan..." /></MainContent>
      </div>
    )
  }

  if (customerQuery.isError) {
    return <div className="min-h-screen bg-brand-canvas"><GirardNav />
      <MainContent className="p-4 md:p-8"><Notice tone="error" title="Gagal memuat pelanggan." actions={<Button variant="secondary" onClick={() => customerQuery.refetch()}>Coba lagi</Button>} /></MainContent>
    </div>
  }

  if (!customer) {
    return (
      <div className="min-h-screen bg-brand-canvas">
        <GirardNav />
        <MainContent className="p-4 md:p-8"><EmptyState title="Pelanggan tidak ditemukan atau Anda tidak memiliki akses." /></MainContent>
      </div>
    )
  }

  const overdue = isOverdue(customer.last_visit_date, customer.visit_frequency_days)

  return (
    <div className="min-h-screen bg-brand-canvas">
      <GirardNav />
      <MainContent>

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 space-y-3">
        <Button variant="secondary" onClick={() => navigate(-1)}>← Kembali</Button>
        <PageHeader title={customer.name} description={[customer.address, customer.city].filter(Boolean).join(', ') || 'Alamat belum tersedia'} actions={overdue ? <StatusBadge tone="warning">Kunjungan Terlambat</StatusBadge> : undefined} />
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-100 px-4 md:px-8">
        <div className="flex gap-1 overflow-x-auto" aria-label="Bagian pelanggan">
          {[
            { key: 'overview', label: 'Overview' },
            { key: 'visits',   label: 'Riwayat Kunjungan' },
            { key: 'orders',   label: 'Pesanan' },
          ].map(tab => (
            <Button
              variant="secondary"
              key={tab.key}
              aria-pressed={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
              className={`shrink-0 px-3 py-3 text-base font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-brand-accent text-brand-primary underline decoration-brand-primary underline-offset-4'
                  : 'border-transparent text-brand-secondary hover:text-gray-700'
              }`}
            >
              {tab.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-5xl min-w-0 px-4 md:px-8 py-6 space-y-4">

        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <>
            <NextScheduledVisit customerId={customer.id} />
            <StorePOContext customerId={customer.id} />
            <Section title="Contact"><SummaryList className="break-words [overflow-wrap:anywhere]" items={[
              { label: 'Nomor Telepon', value: customer.phone ?? '—' },
              { label: 'Email', value: customer.email ?? '—' },
              { label: 'Alamat', value: [customer.address, customer.city].filter(Boolean).join(', ') || '—' },
              { label: 'Frekuensi Kunjungan', value: frequencyLabel(customer.visit_frequency_days) },
            ]} /></Section>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="min-w-0 bg-white rounded-xl border border-gray-200 p-4 text-center break-words [overflow-wrap:anywhere]">
                <p className="text-[13px] text-brand-secondary mb-1">Last Visit</p>
                <p className={`text-base font-semibold ${overdue ? 'text-red-700' : 'text-gray-900'}`}>
                  {customer.last_visit_date
                    ? parseCalendarDate(customer.last_visit_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
                    : 'Never'}
                </p>
              </div>
              <div className="min-w-0 bg-white rounded-xl border border-gray-200 p-4 text-center break-words [overflow-wrap:anywhere]">
                <p className="text-[13px] text-brand-secondary mb-1">Pelanggan Sejak</p>
                <p className="text-base font-semibold text-gray-900">
                  {statsError || (!statsLoading && !stats) ? 'Tidak tersedia' : statsLoading || !stats ? 'Memuat...' : stats.first_order_date
                    ? parseCalendarDate(stats.first_order_date).toLocaleDateString('id-ID', { month: 'short', year: 'numeric' })
                    : '—'}
                </p>
              </div>
              <div className="min-w-0 bg-white rounded-xl border border-gray-200 p-4 text-center break-words [overflow-wrap:anywhere]">
                <p className="text-[13px] text-brand-secondary mb-1">Pesanan (3bl)</p>
                <p className="text-base font-semibold text-gray-900">{statsError || (!statsLoading && !stats) ? 'Tidak tersedia' : statsLoading || !stats ? 'Memuat...' : stats.order_count_3mo}</p>
              </div>
              <div className="min-w-0 bg-white rounded-xl border border-gray-200 p-4 text-center break-words [overflow-wrap:anywhere]">
                <p className="text-[13px] text-brand-secondary mb-1">Penjualan (3bl)</p>
                <p className="text-base font-semibold text-gray-900">
                  {statsError || (!statsLoading && !stats) ? 'Tidak tersedia' : statsLoading || !stats ? 'Memuat...' : !/^0(?:\.0+)?$/.test(String(stats.total_sales_3mo))
                    ? `Rp ${formatMoney(String(stats.total_sales_3mo), 'full')}`
                    : 'Rp 0'}
                </p>
              </div>
            </div>

            {!statsError && stats?.top_items && stats.top_items.length > 0 && (
              <Section title="Barang Terlaris">
                <div className="space-y-2">
                  {stats.top_items.map((item, i) => (
                    <div key={item.name} className="flex items-center gap-3">
                      <span className="text-[13px] text-brand-secondary font-medium w-4">#{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-1">
                          <p className="text-base text-gray-900 truncate">{item.name}</p>
                          <p className="min-w-0 text-[13px] text-brand-secondary break-words [overflow-wrap:anywhere]">
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
              </Section>
            )}
          </>
        )}

        {activeTab === 'visits' && <CustomerVisitHistory customerId={customer.id} />}
        {activeTab === 'orders' && <CustomerOrderHistory customerId={customer.id} />}
      </div>
      </MainContent>
    </div>
  )
}
