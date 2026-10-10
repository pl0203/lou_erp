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

  const { data: team, isLoading: teamLoading, isError: teamError, refetch: refetchTeam } = useQuery({
    queryKey: ['manager_team', profile?.id],
    queryFn: ({ signal }) => fetchTeam(profile!.id, signal),
    enabled: !!profile?.id,
  })

  const teamIds = team?.map(t => t.id) ?? []

  const { data: todayActivity, isPending: activityLoading, isError: activityError, refetch: refetchActivity } = useQuery({
    queryKey: ['today_activity', profile?.id, teamIds],
    queryFn: ({ signal }) => fetchTeamActivity(teamIds, signal),
    enabled: teamIds.length > 0,
  })
  const isLoading = teamLoading || (teamIds.length > 0 && activityLoading)
  const isError = teamError || activityError
  const weeklyStats = Object.fromEntries((todayActivity ?? []).map(row => [row.sales_person_id, row.weekly_visits]))

  const activityMap = Object.fromEntries(
    (todayActivity ?? []).map(a => [a.sales_person_id, a])
  )

  const today = new Date().toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long'
  })

  return (
    <div className="min-h-screen bg-brand-canvas">
      <GirardNav />

      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5">
        <h1 className="text-xl font-semibold text-gray-900">Tim Saya</h1>
        <p className="text-sm text-gray-500 mt-0.5">Hari ini — {today}</p>
      </div>

      <div className="px-4 md:px-8 py-6">
        {isError && <div role="alert" className="text-center text-red-600 text-sm py-8">Data tim tidak tersedia. <button onClick={() => { refetchTeam(); if (teamIds.length) refetchActivity() }} className="underline">Coba lagi</button></div>}
        {!isError && isLoading && (
          <div className="text-center text-gray-400 text-sm py-24">Memuat data tim...</div>
        )}

        {!isError && !isLoading && (!team || team.length === 0) && (
          <div className="text-center py-24">
            <p className="text-gray-400 text-sm">Belum ada anggota tim yang ditugaskan.</p>
            <p className="text-gray-300 text-xs mt-1">Hubungi manajer anda untuk menugaskan sales ke tim Anda.</p>
          </div>
        )}

        {!isError && !isLoading && team && team.length > 0 && (
          <>
            {/* Desktop table */}
            <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Nama</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Kontak</th>
                    <th className="text-center px-5 py-3 font-medium text-gray-500">Dijadwalkan Hari Ini</th>
                    <th className="text-center px-5 py-3 font-medium text-gray-500">Dikunjungi Hari Ini</th>
                    <th className="text-center px-5 py-3 font-medium text-gray-500">Pesanan Hari Ini</th>
                    <th className="text-center px-5 py-3 font-medium text-gray-500">Kunjungan Minggu Ini</th>
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
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-green-100 text-green-700 text-xs font-semibold flex items-center justify-center shrink-0">
                              {member.full_name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                            </div>
                            <p className="font-medium text-gray-900">{member.full_name}</p>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <p className="text-gray-600 text-xs">{member.email}</p>
                          {member.phone && <p className="text-gray-400 text-xs mt-0.5">{member.phone}</p>}
                        </td>
                        <td className="px-5 py-4 text-center">
                          <span className="text-gray-900 font-medium">{activity?.total_scheduled ?? 0}</span>
                        </td>
                        <td className="px-5 py-4 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span className={`font-medium ${
                              activity?.total_visited === activity?.total_scheduled && activity?.total_scheduled > 0
                                ? 'text-green-600' : 'text-gray-900'
                            }`}>
                              {activity?.total_visited ?? 0}
                            </span>
                            {visitRate !== null && (
                              <span className="text-xs text-gray-400">{visitRate}%</span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4 text-center">
                          <span className="text-gray-900 font-medium">{activity?.total_orders ?? 0}</span>
                        </td>
                        <td className="px-5 py-4 text-center">
                          <span className="text-gray-900 font-medium">{weekVisits}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {team.map(member => {
                const activity = activityMap[member.id]
                const weekVisits = weeklyStats?.[member.id] ?? 0

                return (
                  <div key={member.id} className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-full bg-green-100 text-green-700 text-sm font-semibold flex items-center justify-center shrink-0">
                        {member.full_name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">{member.full_name}</p>
                        <p className="text-xs text-gray-400">{member.email}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="bg-gray-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-gray-400 mb-1">Dijadwalkan</p>
                        <p className="font-semibold text-gray-900">{activity?.total_scheduled ?? 0}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-gray-400 mb-1">Dikunjungi</p>
                        <p className={`font-semibold ${
                          activity?.total_visited === activity?.total_scheduled && activity?.total_scheduled > 0
                            ? 'text-green-600' : 'text-gray-900'
                        }`}>
                          {activity?.total_visited ?? 0}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-gray-400 mb-1">Pesanan Hari Ini</p>
                        <p className="font-semibold text-gray-900">{activity?.total_orders ?? 0}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-gray-400 mb-1">Kunjungan Minggu Ini</p>
                        <p className="font-semibold text-gray-900">{weekVisits}</p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}