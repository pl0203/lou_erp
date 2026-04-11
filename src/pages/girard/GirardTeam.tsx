import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import GirardNav from '../../components/GirardNav'

type TeamMember = {
  id: string
  full_name: string
  email: string
  phone: string | null
}

type TodayActivity = {
  sales_person_id: string
  total_scheduled: number
  total_visited: number
  total_orders: number
}

async function fetchTeam(managerId: string): Promise<TeamMember[]> {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, phone')
    .eq('manager_id', managerId)
    .eq('role', 'sales_person')
    .eq('is_active', true)
    .order('full_name')
  if (error) throw error
  return data
}

async function fetchTodayActivity(
  teamIds: string[]
): Promise<TodayActivity[]> {
  if (teamIds.length === 0) return []
  const today = new Date().toISOString().split('T')[0]

  const { data: schedules, error: schedError } = await supabase
    .from('sales_schedules')
    .select('id, sales_person_id, outlet_visits(id)')
    .in('sales_person_id', teamIds)
    .eq('scheduled_date', today)
  if (schedError) throw schedError

  const { data: orders, error: ordError } = await supabase
    .from('girard_orders')
    .select('id, submitted_by, created_at')
    .in('submitted_by', teamIds)
    .gte('created_at', `${today}T00:00:00`)
    .lte('created_at', `${today}T23:59:59`)
  if (ordError) throw ordError

  return teamIds.map(id => {
    const mySchedules = (schedules ?? []).filter(s => s.sales_person_id === id)
    const myVisited = mySchedules.filter(s => (s.outlet_visits as any[]).length > 0)
    const myOrders = (orders ?? []).filter(o => o.submitted_by === id)
    return {
      sales_person_id: id,
      total_scheduled: mySchedules.length,
      total_visited: myVisited.length,
      total_orders: myOrders.length,
    }
  })
}

async function fetchWeeklyStats(teamIds: string[]): Promise<Record<string, number>> {
  if (teamIds.length === 0) return {}
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)
  const cutoff = weekAgo.toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('outlet_visits')
    .select('sales_person_id')
    .in('sales_person_id', teamIds)
    .gte('checked_in_at', cutoff)
  if (error) throw error

  const counts: Record<string, number> = {}
  for (const v of data ?? []) {
    counts[v.sales_person_id] = (counts[v.sales_person_id] ?? 0) + 1
  }
  return counts
}

export default function GirardTeam() {
  const { profile } = useAuth()

  const { data: team, isLoading } = useQuery({
    queryKey: ['manager_team', profile?.id],
    queryFn: () => fetchTeam(profile!.id),
    enabled: !!profile?.id,
  })

  const teamIds = team?.map(t => t.id) ?? []

  const { data: todayActivity } = useQuery({
    queryKey: ['today_activity', teamIds],
    queryFn: () => fetchTodayActivity(teamIds),
    enabled: teamIds.length > 0,
  })

  const { data: weeklyStats } = useQuery({
    queryKey: ['weekly_stats', teamIds],
    queryFn: () => fetchWeeklyStats(teamIds),
    enabled: teamIds.length > 0,
  })

  const activityMap = Object.fromEntries(
    (todayActivity ?? []).map(a => [a.sales_person_id, a])
  )

  const today = new Date().toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long'
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <GirardNav />

      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5">
        <h1 className="text-xl font-semibold text-gray-900">My Team</h1>
        <p className="text-sm text-gray-500 mt-0.5">Today — {today}</p>
      </div>

      <div className="px-4 md:px-8 py-6">
        {isLoading && (
          <div className="text-center text-gray-400 text-sm py-24">Loading team...</div>
        )}

        {!isLoading && (!team || team.length === 0) && (
          <div className="text-center py-24">
            <p className="text-gray-400 text-sm">No team members assigned to you yet.</p>
            <p className="text-gray-300 text-xs mt-1">Contact your sales head to assign sales persons to your team.</p>
          </div>
        )}

        {!isLoading && team && team.length > 0 && (
          <>
            {/* Desktop table */}
            <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Name</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Contact</th>
                    <th className="text-center px-5 py-3 font-medium text-gray-500">Scheduled Today</th>
                    <th className="text-center px-5 py-3 font-medium text-gray-500">Visited Today</th>
                    <th className="text-center px-5 py-3 font-medium text-gray-500">Orders Today</th>
                    <th className="text-center px-5 py-3 font-medium text-gray-500">Visits This Week</th>
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
                        <p className="text-xs text-gray-400 mb-1">Scheduled</p>
                        <p className="font-semibold text-gray-900">{activity?.total_scheduled ?? 0}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-gray-400 mb-1">Visited</p>
                        <p className={`font-semibold ${
                          activity?.total_visited === activity?.total_scheduled && activity?.total_scheduled > 0
                            ? 'text-green-600' : 'text-gray-900'
                        }`}>
                          {activity?.total_visited ?? 0}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-gray-400 mb-1">Orders Today</p>
                        <p className="font-semibold text-gray-900">{activity?.total_orders ?? 0}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-gray-400 mb-1">Visits This Week</p>
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