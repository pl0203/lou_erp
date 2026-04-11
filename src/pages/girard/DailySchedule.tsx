import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import GirardNav from '../../components/GirardNav'

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

type CustomerStats = {
  customer_id: string
  order_count: number
  total_sales: number
  top_items: string[]
}

const STATUS_STYLES: Record<string, string> = {
  pending:   'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  missed:    'bg-red-100 text-red-700',
}

const DAY_LABELS = ['Today', 'Tomorrow', 'In 2 days', 'In 3 days']

function getDateRange(): string[] {
  return Array.from({ length: 4 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() + i)
    return d.toISOString().split('T')[0]
  })
}

async function fetchSchedules(userId: string, dates: string[]): Promise<Schedule[]> {
  const { data, error } = await supabase
    .from('sales_schedules')
    .select(`
      id, scheduled_date, status, notes, outlet_id,
      outlet_visits(id, checked_in_at)
    `)
    .eq('sales_person_id', userId)
    .in('scheduled_date', dates)
    .order('scheduled_date')
    .order('created_at')
  if (error) throw error
  if (!data || data.length === 0) return []

  // Fetch customer details separately
  const outletIds = [...new Set(data.map((s: any) => s.outlet_id as string))]
  
  if (outletIds.length === 0) return data as Schedule[]

  const { data: customerData, error: customerError } = await supabase
    .from('customers')
    .select('id, name, address, city, last_visit_date, visit_frequency_days')
    .in('id', outletIds)

  if (customerError) throw customerError

  const customerMap = Object.fromEntries(
    (customerData ?? []).map(c => [c.id, c])
  )

  return data.map((s: any) => ({
    ...s,
    customers: customerMap[s.outlet_id] ?? null,
  })) as Schedule[]
}

async function fetchCustomerStats(customerIds: string[]): Promise<CustomerStats[]> {
  if (customerIds.length === 0) return []
  const threeMonthsAgo = new Date()
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
  const cutoff = threeMonthsAgo.toISOString()

  const { data, error } = await supabase
    .from('girard_orders')
    .select('id, customer_id, total_value, girard_order_items(product_name, quantity)')
    .in('customer_id', customerIds)
    .gte('created_at', cutoff)
    .eq('status', 'approved')
  if (error) throw error

  const statsMap: Record<string, CustomerStats> = {}
  for (const order of data ?? []) {
    if (!statsMap[order.customer_id]) {
      statsMap[order.customer_id] = {
        customer_id: order.customer_id,
        order_count: 0,
        total_sales: 0,
        top_items: [],
      }
    }
    statsMap[order.customer_id].order_count++
    statsMap[order.customer_id].total_sales += order.total_value ?? 0
  }

  for (const customerId of customerIds) {
    const orders = (data ?? []).filter(o => o.customer_id === customerId)
    const itemCounts: Record<string, number> = {}
    for (const order of orders) {
      for (const item of order.girard_order_items ?? []) {
        itemCounts[item.product_name] = (itemCounts[item.product_name] ?? 0) + item.quantity
      }
    }
    const top = Object.entries(itemCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => name)
    if (statsMap[customerId]) {
      statsMap[customerId].top_items = top
    }
  }

  return Object.values(statsMap)
}

function isOverdue(lastVisit: string | null, frequencyDays: number): boolean {
  if (!lastVisit) return true
  const diff = (Date.now() - new Date(lastVisit).getTime()) / (1000 * 60 * 60 * 24)
  return diff > frequencyDays
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long'
  })
}

export default function DailySchedule() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const dates = getDateRange()
  const [selectedDate, setSelectedDate] = useState(dates[0])

  const { data: allSchedules, isLoading } = useQuery({
    queryKey: ['schedules', profile?.id, dates],
    queryFn: () => fetchSchedules(profile!.id, dates),
    enabled: !!profile?.id,
  })

  const schedules = allSchedules?.filter(s => s.scheduled_date === selectedDate) ?? []
  const customerIds = [...new Set(allSchedules?.map(s => s.customers.id) ?? [])]

  const { data: statsData } = useQuery({
    queryKey: ['customer_stats', customerIds],
    queryFn: () => fetchCustomerStats(customerIds),
    enabled: customerIds.length > 0,
  })

  const statsMap = Object.fromEntries(
    (statsData ?? []).map(s => [s.customer_id, s])
  )

  const todaySchedules = allSchedules?.filter(s => s.scheduled_date === dates[0]) ?? []
  const completed = todaySchedules.filter(s => s.outlet_visits.length > 0).length
  const total = todaySchedules.length

  return (
    <div className="min-h-screen bg-gray-50">
      <GirardNav />

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5">
        <h1 className="text-xl font-semibold text-gray-900">My Schedule</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {formatDate(selectedDate)}
        </p>
        {selectedDate === dates[0] && total > 0 && (
          <div className="flex items-center gap-2 mt-3">
            <div className="flex-1 bg-gray-100 rounded-full h-1.5">
              <div
                className="bg-green-500 h-1.5 rounded-full transition-all"
                style={{ width: `${(completed / total) * 100}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 whitespace-nowrap">
              {completed}/{total} visited
            </span>
          </div>
        )}
      </div>

      {/* Day tabs */}
      <div className="bg-white border-b border-gray-100 px-4 md:px-8">
        <div className="flex gap-1 overflow-x-auto">
          {dates.map((date, i) => {
            const daySchedules = allSchedules?.filter(s => s.scheduled_date === date) ?? []
            const isSelected = selectedDate === date
            return (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                className={`flex flex-col items-center px-4 py-3 border-b-2 transition-colors whitespace-nowrap ${
                  isSelected
                    ? 'border-green-600 text-green-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <span className="text-xs font-medium">{DAY_LABELS[i]}</span>
                <span className="text-xs text-gray-400 mt-0.5">
                  {daySchedules.length} visit{daySchedules.length !== 1 ? 's' : ''}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="px-4 md:px-8 py-6 max-w-2xl mx-auto space-y-4">
        {isLoading && (
          <div className="text-center text-gray-400 text-sm py-24">
            Loading your schedule...
          </div>
        )}

        {!isLoading && schedules.length === 0 && (
          <div className="text-center py-24">
            <p className="text-gray-400 text-sm">No visits scheduled for {DAY_LABELS[dates.indexOf(selectedDate)].toLowerCase()}.</p>
            <p className="text-gray-300 text-xs mt-1">Check back later or contact your manager.</p>
          </div>
        )}

        {schedules.map(schedule => {
          const customer = schedule.customers
          const stats = statsMap[customer.id]
          const checkedIn = schedule.outlet_visits.length > 0
          const overdue = isOverdue(customer.last_visit_date, customer.visit_frequency_days)
          const isToday = selectedDate === dates[0]

          return (
            <div
              key={schedule.id}
              className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm"
            >
              {/* Customer header */}
              <div className="px-5 py-4 border-b border-gray-100">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-base font-semibold text-gray-900 truncate">
                        {customer.name}
                      </h2>
                      {checkedIn && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                          ✓ Checked in
                        </span>
                      )}
                      {overdue && !checkedIn && isToday && (
                        <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">
                          Overdue
                        </span>
                      )}
                    </div>
                    {(customer.address || customer.city) && (
                      <p className="text-xs text-gray-400 mt-0.5 truncate">
                        {[customer.address, customer.city].filter(Boolean).join(', ')}
                      </p>
                    )}
                  </div>
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium shrink-0 capitalize ${STATUS_STYLES[schedule.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {schedule.status}
                  </span>
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100">
                <div className="px-4 py-3 text-center">
                  <p className="text-xs text-gray-400 mb-0.5">Last visit</p>
                  <p className="text-sm font-medium text-gray-900">
                    {customer.last_visit_date
                      ? new Date(customer.last_visit_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
                      : 'Never'}
                  </p>
                </div>
                <div className="px-4 py-3 text-center">
                  <p className="text-xs text-gray-400 mb-0.5">Orders (3mo)</p>
                  <p className="text-sm font-medium text-gray-900">
                    {stats?.order_count ?? 0}
                  </p>
                </div>
                <div className="px-4 py-3 text-center">
                  <p className="text-xs text-gray-400 mb-0.5">Sales (3mo)</p>
                  <p className="text-sm font-medium text-gray-900">
                    {stats?.total_sales
                      ? `Rp ${(stats.total_sales / 1_000_000).toFixed(1)}M`
                      : 'Rp 0'}
                  </p>
                </div>
              </div>

              {/* Top items */}
              {stats?.top_items && stats.top_items.length > 0 && (
                <div className="px-5 py-3 border-b border-gray-100">
                  <p className="text-xs text-gray-400 mb-2">Top ordered items</p>
                  <div className="flex flex-wrap gap-1.5">
                    {stats.top_items.map(item => (
                      <span
                        key={item}
                        className="text-xs bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {schedule.notes && (
                <div className="px-5 py-3 border-b border-gray-100">
                  <p className="text-xs text-gray-400 mb-1">Note from manager</p>
                  <p className="text-sm text-gray-600">{schedule.notes}</p>
                </div>
              )}

              {/* Actions */}
              <div className="px-5 py-4 flex gap-3">
                {isToday ? (
                  <>
                    {!checkedIn ? (
                      <button
                        onClick={() => navigate(`/girard/visit/${schedule.id}`)}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm font-medium py-2.5 rounded-xl transition-colors"
                      >
                        Check In
                      </button>
                    ) : (
                      <button
                        onClick={() => navigate(`/girard/visit/${schedule.id}`)}
                        className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium py-2.5 rounded-xl transition-colors"
                      >
                        View Visit
                      </button>
                    )}
                  </>
                ) : (
                  <div className="flex-1 text-center text-xs text-gray-400 py-2">
                    Scheduled for {formatDate(schedule.scheduled_date)}
                  </div>
                )}
                <button
                  onClick={() => navigate(`/girard/customer/${customer.id}`)}
                  className="px-4 py-2.5 border border-gray-200 hover:border-gray-300 text-gray-600 text-sm font-medium rounded-xl transition-colors"
                >
                  Customer Info
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}