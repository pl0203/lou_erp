import { Button } from '../../components/ui/Button'
import { ActionLink } from '../../components/ui/ActionLink'
import { MainContent } from '../../components/ui/MainContent'
import { PageHeader } from '../../components/ui/PageHeader'
import { EmptyState, Notice, StatusBadge } from '../../components/ui/Feedback'
import { RecordList } from '../../components/ui/RecordList'
import { Field } from '../../components/ui/Field'
import { FilterBar } from '../../components/ui/FilterBar'
import { FormActions } from '../../components/ui/FormActions'
import PendingVisitRequests from '../../components/PendingVisitRequests'
import { visitCadence, visitDateLabel } from '../../lib/visitUsability'
import { useUnsavedChanges } from '../../lib/useUnsavedChanges'
import { VisitProposalForm } from '../../components/VisitRequestInbox'
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
  version: number
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

async function fetchSchedules(userId: string, dates: string[], signal?: AbortSignal): Promise<Schedule[]> {
  const data = await readCompleteQuery((offset, limit) => supabase.from('sales_schedules')
    .select('id, version, scheduled_date, status, notes, outlet_id, outlet_visits(id, checked_in_at)', { count: 'exact' })
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

export default function DailySchedule() {
  const { profile } = useAuth()
  return <DailyScheduleContent key={`${profile?.id}:${profile?.role}`} />
}
function DailyScheduleContent() {
  const { profile } = useAuth()
  const dates = getDateRange()
  const [requestReceipt, setRequestReceipt] = useState<{id: string; date?: string} | null>(null)
  const [proposalSchedule, setProposalSchedule] = useState<Schedule | null>(null)
  const [showProposal, setShowProposal] = useState(false)
  const [proposalDirty, setProposalDirty] = useState(false)
  const [proposalRevision, setProposalRevision] = useState(0)
  const unsaved = useUnsavedChanges(proposalDirty)
  const replaceProposal = (schedule: Schedule | null) => unsaved.confirmDiscard(() => { setProposalDirty(false); setProposalSchedule(schedule); setProposalRevision(value => value + 1); setShowProposal(true) })
  const [selectedDate, setSelectedDate] = useState(dates[0])
  const readDates = dates.includes(selectedDate) ? dates : [...dates, selectedDate]

  const { data: allSchedules, isLoading, isError, refetch } = useQuery({
    queryKey: ['schedules', profile?.id, profile?.role, readDates],
    queryFn: ({ signal }) => fetchSchedules(profile!.id, readDates, signal),
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

  return (
    <div className="min-h-screen bg-brand-canvas">
      <GirardNav />
      {unsaved.dialog}
      <MainContent>

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5">
        <PageHeader title="Jadwal Saya" description={formatDate(selectedDate)} />
        {!isLoading && !isError && selectedDate === dates[0] && total > 0 && (
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

      <FilterBar label="Tanggal jadwal saya" className="mx-4 my-3 md:mx-8"><Field id="daily-visit-date" label="Lihat tanggal kunjungan">{control => <input {...control} type="date" value={selectedDate} onChange={e => { if (e.target.value) setSelectedDate(e.target.value) }} />}</Field></FilterBar>
      {/* Day tabs */}
      <div className="bg-white border-b border-gray-100 px-4 md:px-8">
        <div className="flex gap-1 overflow-x-auto">
          {dates.map((date, i) => {
            const daySchedules = allSchedules?.filter(s => s.scheduled_date === date) ?? []
            const isSelected = selectedDate === date
            return (
              <Button
                key={date}
                variant="quiet"
                aria-pressed={isSelected}
                onClick={() => setSelectedDate(date)}
                className={`flex flex-col items-center border-b-2 transition-colors whitespace-nowrap ${
                  isSelected
                    ? 'border-brand-primary text-brand-primary underline decoration-brand-primary underline-offset-4'
                    : 'border-transparent text-brand-secondary hover:text-gray-700'
                }`}
              >
                <span className="text-[13px] font-medium">{DAY_LABELS[i]}</span>
                <span className="text-[13px] text-brand-secondary mt-0.5">
                  {isLoading ? 'Memuat…' : isError ? 'Belum tersedia' : `${daySchedules.length} kunjungan`}
                </span>
              </Button>
            )
          })}
        </div>
      </div>

      <div className="px-4 md:px-8 py-6 max-w-2xl mx-auto space-y-4">
        <ActivePromotionsBanner />
        <p className="text-[13px] text-gray-700">Jadwal memakai tanggal tanpa jam. Pengingat interval dihitung dari kunjungan terakhir pelanggan, dengan batas waktu UTC.</p>
        <FormActions className="justify-start"><Button onClick={() => replaceProposal(null)}>Ajukan kunjungan baru</Button><ActionLink size="compact" variant="quiet" to="/girard/visit-history">Riwayat kunjungan saya</ActionLink></FormActions>
        {requestReceipt && <Notice tone="success" title={`Permintaan terkirim${requestReceipt.date ? ` untuk ${visitDateLabel(requestReceipt.date)}` : ''}.`} actions={<ActionLink size="compact" variant="quiet" to={`/girard/visit-requests#visit-request-${requestReceipt.id}`}>Lihat status permintaan</ActionLink>}><p>Status saat pengiriman: Menunggu persetujuan. Jadwal akan tampil setelah disetujui.</p></Notice>}
        {profile?.id && <PendingVisitRequests actorId={profile.id} date={selectedDate} />}
        {showProposal && <VisitProposalForm key={`${proposalSchedule?.id ?? 'new'}:${proposalRevision}`} source={proposalSchedule ?? undefined} onSubmitted={setRequestReceipt} onDirtyChange={setProposalDirty} confirmDiscard={unsaved.confirmDiscard} onDone={() => { setProposalDirty(false); setShowProposal(false) }} />}

        {isLoading && <Notice tone="info" title="Memuat jadwal Anda..." />}
        {isError && <Notice tone="error" title="Gagal memuat jadwal. Data belum dapat ditampilkan." actions={<Button size="compact" variant="secondary" onClick={() => refetch()}>Coba lagi</Button>} />}
        {!isLoading && !isError && schedules.length === 0 && <EmptyState title={`Tidak ada kunjungan dijadwalkan untuk ${visitDateLabel(selectedDate)}.`}><p>Periksa kembali nanti atau hubungi manajer Anda.</p></EmptyState>}

        <RecordList label="Jadwal kunjungan saya">{!isError && schedules.map(schedule => {
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
              {/* Customer header */}
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
                  <p className="text-[13px] text-brand-secondary mb-0.5">Kunjungan Terakhir</p>
                  <p className="text-base font-medium text-gray-900">
                    {customer?.last_visit_date
                      ? parseCalendarDate(customer.last_visit_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
                      : 'Belum pernah'}
                  </p>
                </div>
                <div className="px-4 py-3 text-center">
                  <p className="text-[13px] text-brand-secondary mb-0.5">Pesanan (3bl)</p>
                  <p className="text-base font-medium text-gray-900">
                    {statsError || (!statsLoading && !stats) ? 'Tidak tersedia' : statsLoading || !stats ? 'Memuat...' : stats.order_count}
                  </p>
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

              {/* Top items */}
              {!statsError && stats?.top_items && stats.top_items.length > 0 && (
                <div className="px-5 py-3 border-b border-gray-100">
                  <p className="text-[13px] text-brand-secondary mb-2">Barang terlaris</p>
                  <div className="flex flex-wrap gap-1.5">
                    {stats.top_items.map(item => (
                      <span
                        key={item}
                        className="text-[13px] bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {schedule.notes && (
                <div className="px-5 py-3 border-b border-gray-100">
                  <p className="text-[13px] text-brand-secondary mb-1">Catatan dari manajer</p>
                  <p className="text-base text-gray-600">{schedule.notes}</p>
                </div>
              )}

              {!checkedIn && profile?.role === 'sales_person' && <Button variant="secondary" className="mx-5 mt-3" onClick={() => replaceProposal(schedule)}>Ajukan perubahan</Button>}
              {/* Actions */}
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
