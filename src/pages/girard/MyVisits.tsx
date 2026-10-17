import { Button } from '../../components/ui/Button'
import { ActionLink } from '../../components/ui/ActionLink'
import { MainContent } from '../../components/ui/MainContent'
import { PageHeader } from '../../components/ui/PageHeader'
import { EmptyState, Notice, StatusBadge } from '../../components/ui/Feedback'
import { RecordList } from '../../components/ui/RecordList'
import { visitCadence, visitDateLabel } from '../../lib/visitUsability'
import ReadFailure from '../../components/ReadFailure'
import { readCompleteQuery } from '../../lib/reads/completeQuery'
import { chunkIds } from '../../lib/reads/completeReads'
import { formatMoney } from '../../lib/reads/money'
import { parseCalendarDate, calendarDayOptions } from '../../lib/calendarDate'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import GirardNav from '../../components/GirardNav'
import { fetchCustomerStatsBatch } from '../../lib/CustomerStats'
import ActivePromotionsBanner from '../../components/ActivePromotionsBanner'

type Schedule = {
  id: string
  scheduled_date: string
  status: string
  notes: string | null
  outlet_id: string
  customers: {
    id: string
    name: string
    address: string | null
    city: string | null
    last_visit_date: string | null
    visit_frequency_days: number
  }
  outlet_visits: {
    id: string
    checked_in_at: string
  }[]
}

const DAY_LABELS = ['Hari Ini', 'Besok', 'Dalam 2 Hari', 'Dalam 3 Hari']

function getDateRange(): string[] {
  return calendarDayOptions(4)
}

async function fetchMyVisitSchedules(userId: string, dates: string[], signal?: AbortSignal): Promise<Schedule[]> {
  const data = await readCompleteQuery((offset, limit) => supabase.from('sales_schedules')
    .select('id, scheduled_date, status, notes, outlet_id, outlet_visits(id, checked_in_at)', { count: 'exact' })
    .eq('sales_person_id', userId).in('scheduled_date', dates)
    .order('scheduled_date').order('created_at').order('id').range(offset, offset + limit - 1), row => row.id, signal)
  const customerMap = new Map<string, Schedule['customers']>()
  for (const ids of chunkIds(data.map(row => row.outlet_id))) {
    const customers = await readCompleteQuery((offset, limit) => supabase.from('customers')
      .select('id, name, address, city, last_visit_date, visit_frequency_days', { count: 'exact' })
      .in('id', ids).order('id').range(offset, offset + limit - 1), row => row.id, signal)
    for (const customer of customers) customerMap.set(customer.id, customer)
  }
  return data.map(row => ({ ...row, customers: customerMap.get(row.outlet_id) ?? null })) as Schedule[]
}


function formatDate(dateStr: string): string {
  return parseCalendarDate(dateStr).toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long'
  })
}

export default function MyVisits() {
  const { profile } = useAuth()
  const dates = getDateRange()
  const [selectedDate, setSelectedDate] = useState(dates[0])

  const { data: allSchedules, isLoading, isError: scheduleReadError, refetch } = useQuery({
    queryKey: ['my_visits', profile?.id, dates],
    queryFn: ({ signal }) => fetchMyVisitSchedules(profile!.id, dates, signal),
    enabled: !!profile?.id,
  })

  const schedules = allSchedules?.filter(s => s.scheduled_date === selectedDate) ?? []
  const customerIds = [...new Set(allSchedules?.map(s => s.customers?.id).filter(Boolean) ?? [])]

  const { data: statsData, isError: statsError, isLoading: statsLoading } = useQuery({
    queryKey: ['customer_stats', customerIds],
    queryFn: () => fetchCustomerStatsBatch(customerIds),
    enabled: customerIds.length > 0,
  })

  const statsMap = Object.fromEntries(
    (statsData ?? []).map(s => [s.customer_id, s])
  )

  const todaySchedules = allSchedules?.filter(s => s.scheduled_date === dates[0]) ?? []
  const completed = todaySchedules.filter(s => s.outlet_visits.length > 0).length
  const total = todaySchedules.length

  if (scheduleReadError) return <div className="min-h-screen bg-brand-canvas"><GirardNav /><MainContent><ReadFailure onRetry={() => { void refetch() }} /></MainContent></div>

  return (
    <div className="min-h-screen bg-brand-canvas">
      <GirardNav />
      <MainContent>

      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5">
        <PageHeader title="Kunjungan Saya" description={formatDate(selectedDate)} />
        {selectedDate === dates[0] && total > 0 && (
          <div className="flex items-center gap-2 mt-3">
            <div className="flex-1 bg-gray-100 rounded-full h-1.5">
              <div
                className="bg-green-500 h-1.5 rounded-full transition-all"
                style={{ width: `${(completed / total) * 100}%` }}
              />
            </div>
            <span className="text-[13px] text-brand-secondary whitespace-nowrap">
              {completed}/{total} dikunjungi
            </span>
          </div>
        )}
      </div>

      {/* Day tabs */}
      <div className="bg-white border-b border-gray-100 px-4 md:px-8">
        <div className="flex items-start gap-1 overflow-x-auto">
          {dates.map((date, i) => {
            const daySchedules = allSchedules?.filter(s => s.scheduled_date === date) ?? []
            const isSelected = selectedDate === date
            return (
              <Button
                key={date}
                variant="quiet"
                aria-pressed={isSelected}
                onClick={() => setSelectedDate(date)}
                className={`flex-none w-max max-w-none flex flex-col items-center border-b-2 transition-colors whitespace-nowrap ${
                  isSelected
                    ? 'border-brand-primary text-brand-primary underline decoration-brand-primary underline-offset-4'
                    : 'border-transparent text-brand-secondary hover:text-gray-700'
                }`}
              >
                <span className="text-[13px] font-medium">{DAY_LABELS[i]}</span>
                <span className="text-[13px] text-brand-secondary mt-0.5">
                  {isLoading ? 'Memuat…' : `${daySchedules.length} kunjungan`}
                </span>
              </Button>
            )
          })}
        </div>
      </div>

      <div className="px-4 md:px-8 py-6 max-w-2xl mx-auto space-y-4">
        <ActivePromotionsBanner />
        <p className="text-[13px] text-gray-700">Jadwal memakai tanggal tanpa jam. Pengingat interval dihitung dari kunjungan terakhir pelanggan, dengan batas waktu UTC.</p>

        {isLoading && <Notice tone="info" title="Memuat kunjungan Anda..." />}
        {!isLoading && schedules.length === 0 && <EmptyState title={`Tidak ada kunjungan dijadwalkan untuk ${visitDateLabel(selectedDate)}.`}><p>Jadwalkan kunjungan untuk diri Anda dari halaman Jadwal.</p></EmptyState>}

        <RecordList label="Kunjungan saya">{schedules.map(schedule => {
          const customer = schedule.customers
          const stats = statsMap[customer?.id]
          const checkedIn = schedule.outlet_visits.length > 0
          const cadence = visitCadence(customer?.last_visit_date, customer?.visit_frequency_days)
          const isToday = selectedDate === dates[0]

          return (
            <li
              key={schedule.id}
              className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm"
            >
              <div className="px-5 py-4 border-b border-gray-100">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-base font-semibold text-gray-900 truncate">
                        {customer?.name}
                      </h2>
                      {checkedIn && (
                        <StatusBadge tone="success">
                          ✓ Sudah Check-in
                        </StatusBadge>
                      )}
                      {cadence && !checkedIn && isToday && (
                        <StatusBadge tone="warning">
                          {cadence.label}
                        </StatusBadge>
                      )}
                    </div>
                    {cadence && !checkedIn && isToday && <p className="mt-2 text-[13px] text-gray-700">{cadence.explanation}</p>}
                    {(customer?.address || customer?.city) && (
                      <p className="text-[13px] text-brand-secondary mt-0.5 truncate">
                        {[customer?.address, customer?.city].filter(Boolean).join(', ')}
                      </p>
                    )}
                  </div>
                  <StatusBadge tone={schedule.status === 'completed' ? 'success' : schedule.status === 'missed' ? 'error' : 'warning'}>
                    {schedule.status === 'completed' ? 'Selesai' : schedule.status === 'missed' ? 'Terlewat' : 'Menunggu kunjungan'}
                  </StatusBadge>
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100">
                <div className="px-4 py-3 text-center">
                  <p className="text-[13px] text-brand-secondary mb-0.5">Kunjungan terakhir</p>
                  <p className="text-base font-medium text-gray-900">
                    {customer?.last_visit_date
                      ? parseCalendarDate(customer.last_visit_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
                      : 'Belum pernah'}
                  </p>
                </div>
                <div className="px-4 py-3 text-center">
                  <p className="text-[13px] text-brand-secondary mb-0.5">Pesanan (3bl)</p>
                  <p className="text-base font-medium text-gray-900">{statsError || (!statsLoading && !stats) ? 'Tidak tersedia' : statsLoading || !stats ? 'Memuat...' : stats.order_count}</p>
                </div>
                <div className="px-4 py-3 text-center">
                  <p className="text-[13px] text-brand-secondary mb-0.5">Penjualan (3bl)</p>
                  <p className="text-base font-medium text-gray-900">
                    {statsError || (!statsLoading && !stats) ? 'Tidak tersedia' : statsLoading || !stats ? 'Memuat...' : !/^0(?:\.0+)?$/.test(String(stats.total_sales))
                      ? `Rp ${formatMoney(String(stats.total_sales), 'full')}`
                      : 'Rp 0'}
                  </p>
                </div>
              </div>

              {!statsError && stats?.top_items && stats.top_items.length > 0 && (
                <div className="px-5 py-3 border-b border-gray-100">
                  <p className="text-[13px] text-brand-secondary mb-2">Barang Terlaris</p>
                  <div className="flex flex-wrap gap-1.5">
                    {stats.top_items.map(item => (
                      <span key={item} className="text-[13px] bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {schedule.notes && (
                <div className="px-5 py-3 border-b border-gray-100">
                  <p className="text-[13px] text-brand-secondary mb-1">Catatan</p>
                  <p className="text-base text-gray-600">{schedule.notes}</p>
                </div>
              )}

              <div className="px-5 py-4 flex flex-wrap gap-3">
                {isToday ? (
                  <>
                    {!checkedIn ? (
                      <ActionLink size="compact"
                        to={`/girard/visit/${schedule.id}`}
                        className="flex-1"
                      >
                        Check-in kunjungan
                      </ActionLink>
                    ) : (
                      <ActionLink size="compact"
                        variant="quiet"
                        to={`/girard/visit/${schedule.id}`}
                        className="flex-1"
                      >
                        Lihat Kunjungan
                      </ActionLink>
                    )}
                  </>
                ) : (
                  <div className="flex-1 text-center text-[13px] text-brand-secondary py-2">
                    Dijadwalkan untuk {formatDate(schedule.scheduled_date)}
                  </div>
                )}
                <ActionLink size="compact"
                  variant="quiet"
                  to={`/girard/customer/${customer?.id}`}
                >
                  Info Pelanggan
                </ActionLink>
              </div>
            </li>
          )
        })}</RecordList>
      </div>
      </MainContent>
    </div>
  )
}

