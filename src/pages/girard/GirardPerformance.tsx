import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import GirardNav from '../../components/GirardNav'

type PerformanceData = {
  id: string
  full_name: string
  scheduled: number
  visited: number
  missed: number
  orders: number
  total_sales: number
  visit_rate: number
}

function getDateRange(period: string): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  if (period === '7d') from.setDate(from.getDate() - 7)
  else if (period === '30d') from.setDate(from.getDate() - 30)
  else if (period === '90d') from.setDate(from.getDate() - 90)
  return {
    from: from.toISOString().split('T')[0],
    to: to.toISOString().split('T')[0],
  }
}

async function fetchPerformance(
  managerId: string,
  role: string,
  period: string
): Promise<PerformanceData[]> {
  const { from, to } = getDateRange(period)

  // Get team members — include all roles not just sales_person
let teamQuery = supabase
  .from('users')
  .select('id, full_name')
  .in('role', ['sales_person', 'sales_manager', 'sales_head', 'executive'])
  .eq('is_active', true)
  .order('full_name')

// Managers only see their own team + themselves
if (role === 'sales_manager') {
  const { data: teamIds } = await supabase
    .from('users')
    .select('id')
    .eq('manager_id', managerId)
    .eq('is_active', true)

  const ids = [...(teamIds ?? []).map(t => t.id), managerId]
  teamQuery = teamQuery.in('id', ids)
}

  const { data: team, error: teamError } = await teamQuery
  if (teamError) throw teamError
  if (!team || team.length === 0) return []

  const teamIds = team.map(t => t.id)

  // Fetch schedules in date range
  const { data: schedules, error: schedError } = await supabase
    .from('sales_schedules')
    .select('id, sales_person_id, status, outlet_visits(id)')
    .in('sales_person_id', teamIds)
    .gte('scheduled_date', from)
    .lte('scheduled_date', to)
  if (schedError) throw schedError

  // Fetch orders in date range
  const { data: orders, error: ordError } = await supabase
    .from('girard_orders')
    .select('id, submitted_by, total_value')
    .in('submitted_by', teamIds)
    .gte('created_at', `${from}T00:00:00`)
    .lte('created_at', `${to}T23:59:59`)
  if (ordError) throw ordError

  return team.map(member => {
    const mySchedules = (schedules ?? []).filter(s => s.sales_person_id === member.id)
    const myVisited = mySchedules.filter(s => (s.outlet_visits as any[]).length > 0)
    const myMissed = mySchedules.filter(s =>
      (s.outlet_visits as any[]).length === 0 && s.status === 'missed'
    )
    const myOrders = (orders ?? []).filter(o => o.submitted_by === member.id)
    const totalSales = myOrders.reduce((sum, o) => sum + (o.total_value ?? 0), 0)
    const visitRate = mySchedules.length > 0
      ? Math.round((myVisited.length / mySchedules.length) * 100)
      : 0

    return {
      id: member.id,
      full_name: member.full_name,
      scheduled: mySchedules.length,
      visited: myVisited.length,
      missed: myMissed.length,
      orders: myOrders.length,
      total_sales: totalSales,
      visit_rate: visitRate,
    }
  })
}

const PERIODS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
]

export default function GirardPerformance() {
  const { profile } = useAuth()
  const [period, setPeriod] = useState('30d')

  const { data: performance, isLoading } = useQuery({
    queryKey: ['performance', profile?.id, profile?.role, period],
    queryFn: () => fetchPerformance(profile!.id, profile!.role, period),
    enabled: !!profile?.id,
  })

  const totalVisited = performance?.reduce((sum, p) => sum + p.visited, 0) ?? 0
  const totalScheduled = performance?.reduce((sum, p) => sum + p.scheduled, 0) ?? 0
  const totalOrders = performance?.reduce((sum, p) => sum + p.orders, 0) ?? 0
  const totalSales = performance?.reduce((sum, p) => sum + p.total_sales, 0) ?? 0
  const avgVisitRate = performance?.length
    ? Math.round(performance.reduce((sum, p) => sum + p.visit_rate, 0) / performance.length)
    : 0

  return (
    <div className="min-h-screen bg-gray-50">
      <GirardNav />

      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Performance</h1>
          <p className="text-sm text-gray-500 mt-0.5">Sales team activity and results</p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                period === p.value
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 md:px-8 py-6 space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 mb-1">Visit rate</p>
            <p className="text-2xl font-bold text-gray-900">{avgVisitRate}%</p>
            <p className="text-xs text-gray-400 mt-1">{totalVisited}/{totalScheduled} visits</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 mb-1">Total visits</p>
            <p className="text-2xl font-bold text-gray-900">{totalVisited}</p>
            <p className="text-xs text-gray-400 mt-1">of {totalScheduled} scheduled</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 mb-1">Orders placed</p>
            <p className="text-2xl font-bold text-gray-900">{totalOrders}</p>
            <p className="text-xs text-gray-400 mt-1">from field visits</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 mb-1">Total sales</p>
            <p className="text-2xl font-bold text-gray-900">
              Rp {(totalSales / 1_000_000).toFixed(1)}M
            </p>
            <p className="text-xs text-gray-400 mt-1">from field orders</p>
          </div>
        </div>

        {/* Per-person breakdown */}
        {isLoading && (
          <div className="text-center text-gray-400 text-sm py-12">Loading performance data...</div>
        )}

        {!isLoading && (!performance || performance.length === 0) && (
          <div className="text-center py-12">
            <p className="text-gray-400 text-sm">No performance data available.</p>
          </div>
        )}

        {!isLoading && performance && performance.length > 0 && (
          <>
            {/* Desktop table */}
            <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="text-base font-medium text-gray-900">By Sales Person</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Name</th>
                    <th className="text-center px-5 py-3 font-medium text-gray-500">Scheduled</th>
                    <th className="text-center px-5 py-3 font-medium text-gray-500">Visited</th>
                    <th className="text-center px-5 py-3 font-medium text-gray-500">Visit Rate</th>
                    <th className="text-center px-5 py-3 font-medium text-gray-500">Orders</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500">Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {performance.map(p => (
                    <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-green-100 text-green-700 text-xs font-semibold flex items-center justify-center shrink-0">
                            {p.full_name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                          </div>
                          <span className="font-medium text-gray-900">{p.full_name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-center text-gray-700">{p.scheduled}</td>
                      <td className="px-5 py-4 text-center text-gray-700">{p.visited}</td>
                      <td className="px-5 py-4 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className={`font-medium text-sm ${
                            p.visit_rate >= 80 ? 'text-green-600'
                            : p.visit_rate >= 50 ? 'text-yellow-600'
                            : 'text-red-500'
                          }`}>
                            {p.visit_rate}%
                          </span>
                          <div className="w-16 bg-gray-100 rounded-full h-1">
                            <div
                              className={`h-1 rounded-full ${
                                p.visit_rate >= 80 ? 'bg-green-500'
                                : p.visit_rate >= 50 ? 'bg-yellow-500'
                                : 'bg-red-400'
                              }`}
                              style={{ width: `${p.visit_rate}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-center text-gray-700">{p.orders}</td>
                      <td className="px-5 py-4 text-right font-medium text-gray-900">
                        Rp {(p.total_sales / 1_000_000).toFixed(1)}M
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {performance.map(p => (
                <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-green-100 text-green-700 text-sm font-semibold flex items-center justify-center shrink-0">
                      {p.full_name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900">{p.full_name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${
                              p.visit_rate >= 80 ? 'bg-green-500'
                              : p.visit_rate >= 50 ? 'bg-yellow-500'
                              : 'bg-red-400'
                            }`}
                            style={{ width: `${p.visit_rate}%` }}
                          />
                        </div>
                        <span className={`text-xs font-medium ${
                          p.visit_rate >= 80 ? 'text-green-600'
                          : p.visit_rate >= 50 ? 'text-yellow-600'
                          : 'text-red-500'
                        }`}>
                          {p.visit_rate}%
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-400 mb-1">Visits</p>
                      <p className="font-semibold text-gray-900">{p.visited}/{p.scheduled}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-400 mb-1">Orders</p>
                      <p className="font-semibold text-gray-900">{p.orders}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center col-span-2">
                      <p className="text-xs text-gray-400 mb-1">Total Sales</p>
                      <p className="font-semibold text-gray-900">
                        Rp {(p.total_sales / 1_000_000).toFixed(1)}M
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}