import { PageHeader } from '../../components/ui/PageHeader'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { FilterBar } from '../../components/ui/FilterBar'
import { EmptyState, Notice } from '../../components/ui/Feedback'
import { RecordList } from '../../components/ui/RecordList'
import { SummaryList } from '../../components/ui/SummaryList'
import { MainContent } from '../../components/ui/MainContent'
import { useState } from 'react'
import { isVisitDate, visitDateLabel, visitScheduleHref } from '../../lib/visitUsability'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { readComplete } from '../../lib/reads/completeReads'
import { fetchTeamActivity } from '../../lib/reads/reports'
import { useAuth } from '../../lib/AuthContext'
import GirardNav from '../../components/GirardNav'

type TeamMember = {
  id: string
  full_name: string
  email: string
  phone: string | null
}

async function fetchTeam(managerId: string, signal?: AbortSignal): Promise<TeamMember[]> {
  const team = await readComplete<TeamMember>(async (offset, limit) => {
    let query = supabase.rpc('pilot_team_directory', {}, { count: 'exact' }).select('id, full_name, email, phone')
      .eq('manager_id', managerId).eq('role', 'sales_person').eq('is_active', true).order('id').range(offset, offset + limit - 1)
    if (signal) query = query.abortSignal(signal)
    const { data, error, count } = await query
    if (error) throw error
    return { items: (data ?? []) as unknown as TeamMember[], total: count as number }
  }, row => row.id, signal)
  return team.sort((a, b) => a.full_name.localeCompare(b.full_name) || a.id.localeCompare(b.id))
}

export default function GirardTeam() {
  const { profile } = useAuth()
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10))
  const recentFrom = new Date()
  recentFrom.setDate(recentFrom.getDate() - 7)
  const recentFromLabel = visitDateLabel(recentFrom.toISOString().slice(0, 10))

  const { data: team, isError: teamError, refetch: refetchTeam } = useQuery({
    queryKey: ['manager_team', profile?.id],
    queryFn: ({ signal }) => fetchTeam(profile!.id, signal),
    enabled: !!profile?.id,
  })

  const teamIds = team?.map(t => t.id) ?? []

  const { data: todayActivity, isPending: activityLoading, isError: activityError, refetch: refetchActivity } = useQuery({
    queryKey: ['today_activity', profile?.id, teamIds, selectedDate],
    queryFn: ({ signal }) => fetchTeamActivity(teamIds, signal, selectedDate),
    enabled: teamIds.length > 0,
  })
  const isLoading = (team === undefined && !teamError) || (teamIds.length > 0 && activityLoading)
  const isError = teamError || activityError
  const weeklyStats = Object.fromEntries((todayActivity ?? []).map(row => [row.sales_person_id, row.weekly_visits]))

  const activityMap = Object.fromEntries(
    (todayActivity ?? []).map(a => [a.sales_person_id, a])
  )


  return (
    <div className="min-h-screen bg-brand-canvas">
      <GirardNav />
      <MainContent>

      <PageHeader title="Tim Saya" description={`Aktivitas tim · ${visitDateLabel(selectedDate)}`}
        className="bg-white border-b border-brand-divider px-4 md:px-8 py-5" />

      <div className="px-4 md:px-8 py-6">
        <FilterBar label="Filter aktivitas tim" className="mb-4" summary={<>
          <p>Jumlah jadwal, kunjungan selesai, dan pesanan mengikuti tanggal di atas. Klik jumlah kunjungan untuk membuka rincian petugas dan tanggal yang sama.</p>
          <p className="mt-2">Kunjungan terbaru dihitung sejak {recentFromLabel} UTC hingga sekarang, terpisah dari tanggal aktivitas. Batas pesanan harian: 00.00–23.59.59 UTC.</p>
        </>}>
          <Field id="team-activity-date" label="Tanggal aktivitas tim">{control => <input {...control} type="date" value={selectedDate}
            onChange={event => { if (isVisitDate(event.target.value)) setSelectedDate(event.target.value) }} />}</Field>
        </FilterBar>
        {isError && <Notice tone="error" title="Data tim tidak tersedia." actions={<Button variant="secondary" onClick={() => { void refetchTeam(); if (teamIds.length) void refetchActivity() }}>Coba lagi</Button>} />}
        {!isError && isLoading && (
          <Notice tone="info" title="Memuat data tim..." />
        )}

        {!isError && !isLoading && team?.length === 0 && (
          <EmptyState title="Belum ada anggota tim yang ditugaskan.">Hubungi manajer Anda untuk menugaskan sales ke tim Anda.</EmptyState>
        )}

        {!isError && !isLoading && team && team.length > 0 && (
          <>
            {/* Desktop table */}
            <div role="region" aria-label="Tabel aktivitas tim" tabIndex={0} className="hidden md:block bg-white rounded-[14px] border border-brand-divider overflow-x-auto">
              <p className="px-4 py-2 text-[13px] text-brand-secondary">Geser ke samping untuk melihat semua kolom.</p>
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-brand-divider">
                    <th className="text-left px-5 py-3 font-medium text-brand-secondary">Nama</th>
                    <th className="text-left px-5 py-3 font-medium text-brand-secondary">Kontak</th>
                    <th className="text-center px-5 py-3 font-medium text-brand-secondary">Jadwal tanggal dipilih</th>
                    <th className="text-center px-5 py-3 font-medium text-brand-secondary">Kunjungan selesai</th>
                    <th className="text-center px-5 py-3 font-medium text-brand-secondary">Pesanan tanggal dipilih</th>
                    <th className="text-center px-5 py-3 font-medium text-brand-secondary">Kunjungan terbaru</th>
                  </tr>
                </thead>
                <tbody>
                  {team.map(member => {
                    const activity = activityMap[member.id]
                    const weekVisits = weeklyStats?.[member.id] ?? 0
                    const visitRate = activity?.total_scheduled
                      ? Math.round((activity.total_visited / activity.total_scheduled) * 100)
                      : null

                    return (
                      <tr key={member.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="min-w-[220px] px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-green-100 text-green-700 text-[13px] font-semibold flex items-center justify-center shrink-0">
                              {member.full_name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                            </div>
                            <a className="inline-flex min-h-11 items-center font-medium text-brand-primary underline [overflow-wrap:anywhere]" href={visitScheduleHref(selectedDate, member.id)}>{member.full_name}</a>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <p className="text-brand-secondary text-[13px]">{member.email}</p>
                          {member.phone && <p className="text-brand-secondary text-[13px] mt-0.5">{member.phone}</p>}
                        </td>
                        <td className="px-5 py-4 text-center">
                          <a aria-label={`Lihat ${activity?.total_scheduled ?? 0} jadwal ${member.full_name}`} className="inline-flex min-h-11 items-center font-medium text-brand-primary underline [overflow-wrap:anywhere]" href={visitScheduleHref(selectedDate, member.id)}>{activity?.total_scheduled ?? 0}</a>
                        </td>
                        <td className="px-5 py-4 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <a aria-label={`Lihat ${activity?.total_visited ?? 0} kunjungan selesai ${member.full_name}`} className="inline-flex min-h-11 items-center font-medium text-brand-primary underline [overflow-wrap:anywhere]" href={visitScheduleHref(selectedDate, member.id, undefined, 'visited')}>{activity?.total_visited ?? 0}</a>
                            {visitRate !== null && (
                              <span className="text-[13px] text-brand-secondary">{visitRate}%</span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4 text-center">
                          <span className="text-brand-primary font-medium">{activity?.total_orders ?? 0}</span>
                        </td>
                        <td className="px-5 py-4 text-center">
                          <span className="text-brand-primary font-medium">{weekVisits}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <RecordList label="Anggota tim" className="md:hidden">
              {team.map(member => {
                const activity = activityMap[member.id]
                const weekVisits = weeklyStats?.[member.id] ?? 0

                return (
                  <li key={member.id} className="bg-white rounded-[14px] border border-brand-divider p-4">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-full bg-green-100 text-green-700 text-sm font-semibold flex items-center justify-center shrink-0">
                        {member.full_name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <a className="inline-flex min-h-11 items-center font-semibold text-brand-primary underline [overflow-wrap:anywhere]" href={visitScheduleHref(selectedDate, member.id)}>{member.full_name}</a>
                        <p className="text-[13px] text-brand-secondary">{member.email}</p>
                      </div>
                    </div>
                    <SummaryList items={[
                      { label: 'Dijadwalkan', value: <a aria-label={`Lihat ${activity?.total_scheduled ?? 0} jadwal ${member.full_name}`} className="inline-flex min-h-11 items-center font-semibold text-brand-primary underline" href={visitScheduleHref(selectedDate, member.id)}>{activity?.total_scheduled ?? 0}</a> },
                      { label: 'Dikunjungi', value: <a aria-label={`Lihat ${activity?.total_visited ?? 0} kunjungan selesai ${member.full_name}`} className="inline-flex min-h-11 items-center font-semibold text-brand-primary underline" href={visitScheduleHref(selectedDate, member.id, undefined, 'visited')}>{activity?.total_visited ?? 0}</a> },
                      { label: 'Pesanan tanggal dipilih', value: activity?.total_orders ?? 0 },
                      { label: 'Kunjungan terbaru', value: weekVisits },
                    ]} />
                  </li>
                )
              })}
            </RecordList>
          </>
        )}
      </div>
      </MainContent>
    </div>
  )
}
