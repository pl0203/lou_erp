import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import GirardNav from '../../components/GirardNav'

type CustomerWithStats = {
  id: string
  name: string
  address: string | null
  city: string | null
  last_visit_date: string | null
  visit_frequency_days: number
  visits_this_period: number
  target_visits: number
  on_track: boolean
}

const FREQUENCY_OPTIONS = [
  { days: 3,  label: '2x per minggu' },
  { days: 7,  label: '1x per minggu' },
  { days: 14, label: '1x per 2 minggu' },
  { days: 15, label: '2x per bulan' },
  { days: 30, label: '1x per bulan' },
]

function frequencyLabel(days: number): string {
  return FREQUENCY_OPTIONS.find(f => f.days === days)?.label ?? `Setiap ${days} hari`
}

function calcTargetVisits(frequencyDays: number, periodDays: number): number {
  return Math.ceil(periodDays / frequencyDays)
}

function isOverdue(lastVisit: string | null, frequencyDays: number): boolean {
  if (!lastVisit) return true
  const diff = (Date.now() - new Date(lastVisit).getTime()) / (1000 * 60 * 60 * 24)
  return diff > frequencyDays
}

async function fetchMyCustomersWithStats(managerId: string): Promise<CustomerWithStats[]> {
  const { data: assignments, error: aError } = await supabase
    .from('customer_manager_assignments')
    .select('customer_id')
    .eq('manager_id', managerId)
  if (aError) throw aError
  if (!assignments || assignments.length === 0) return []

  const customerIds = assignments.map(a => a.customer_id)

  const { data: customers, error: cError } = await supabase
    .from('customers')
    .select('id, name, address, city, last_visit_date, visit_frequency_days')
    .in('id', customerIds)
    .order('name')
  if (cError) throw cError

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const { data: visits, error: vError } = await supabase
    .from('outlet_visits')
    .select('outlet_id, checked_in_at')
    .in('outlet_id', customerIds)
    .gte('checked_in_at', thirtyDaysAgo.toISOString())
  if (vError) throw vError

  const visitCounts: Record<string, number> = {}
  for (const v of visits ?? []) {
    visitCounts[v.outlet_id] = (visitCounts[v.outlet_id] ?? 0) + 1
  }

  return (customers ?? []).map(c => {
    const target = calcTargetVisits(c.visit_frequency_days, 30)
    const actual = visitCounts[c.id] ?? 0
    return {
      ...c,
      visits_this_period: actual,
      target_visits: target,
      on_track: actual >= target,
    }
  })
}

function CustomerTable({ customers }: { customers: CustomerWithStats[] }) {
  return (
    <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100">
            <th className="text-left px-5 py-3 font-medium text-gray-500">Pelanggan</th>
            <th className="text-left px-5 py-3 font-medium text-gray-500">Lokasi</th>
            <th className="text-left px-5 py-3 font-medium text-gray-500">Frekuensi Kunjungan</th>
            <th className="text-center px-5 py-3 font-medium text-gray-500">Target (30hr)</th>
            <th className="text-center px-5 py-3 font-medium text-gray-500">Aktual (30hr)</th>
            <th className="text-left px-5 py-3 font-medium text-gray-500">Kunjungan Terakhir</th>
            <th className="text-center px-5 py-3 font-medium text-gray-500">Status</th>
          </tr>
        </thead>
        <tbody>
          {customers.map(c => {
            const overdue = isOverdue(c.last_visit_date, c.visit_frequency_days)
            return (
              <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-5 py-4 font-medium text-gray-900">{c.name}</td>
                <td className="px-5 py-4 text-gray-500 text-xs">
                  {[c.address, c.city].filter(Boolean).join(', ') || '—'}
                </td>
                <td className="px-5 py-4 text-gray-600 text-xs">
                  {frequencyLabel(c.visit_frequency_days)}
                </td>
                <td className="px-5 py-4 text-center text-gray-700">{c.target_visits}</td>
                <td className="px-5 py-4 text-center">
                  <span className={`font-medium ${c.on_track ? 'text-green-600' : 'text-red-500'}`}>
                    {c.visits_this_period}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <span className={`text-xs ${overdue ? 'text-red-500 font-medium' : 'text-gray-600'}`}>
                    {c.last_visit_date
                      ? new Date(c.last_visit_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
                      : 'Belum pernah'}
                    {overdue && ' ⚠'}
                  </span>
                </td>
                <td className="px-5 py-4 text-center">
                  <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    c.on_track ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                  }`}>
                    {c.on_track ? 'Sesuai target' : 'Tertinggal'}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CustomerCards({ customers }: { customers: CustomerWithStats[] }) {
  return (
    <div className="md:hidden space-y-3">
      {customers.map(c => {
        const overdue = isOverdue(c.last_visit_date, c.visit_frequency_days)
        return (
          <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 text-sm">{c.name}</p>
                {c.city && <p className="text-xs text-gray-400 mt-0.5">{c.city}</p>}
              </div>
              <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ml-3 shrink-0 ${
                c.on_track ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
              }`}>
                {c.on_track ? 'Sesuai target' : 'Tertinggal'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-gray-400">Frekuensi</p>
                <p className="text-gray-700 mt-0.5">{frequencyLabel(c.visit_frequency_days)}</p>
              </div>
              <div>
                <p className="text-gray-400">Kunjungan Terakhir</p>
                <p className={`mt-0.5 ${overdue ? 'text-red-500 font-medium' : 'text-gray-700'}`}>
                  {c.last_visit_date
                    ? new Date(c.last_visit_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
                    : 'Belum pernah'}
                  {overdue && ' ⚠'}
                </p>
              </div>
              <div>
                <p className="text-gray-400">Target (30hr)</p>
                <p className="text-gray-700 mt-0.5">{c.target_visits} kunjungan</p>
              </div>
              <div>
                <p className="text-gray-400">Aktual (30hr)</p>
                <p className={`font-semibold mt-0.5 ${c.on_track ? 'text-green-600' : 'text-red-500'}`}>
                  {c.visits_this_period} kunjungan
                </p>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100">
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all ${
                      c.on_track ? 'bg-green-500' : 'bg-red-400'
                    }`}
                    style={{
                      width: `${Math.min(100, c.target_visits > 0
                        ? (c.visits_this_period / c.target_visits) * 100
                        : 0)}%`
                    }}
                  />
                </div>
                <span className="text-xs text-gray-400">
                  {c.target_visits > 0
                    ? Math.round((c.visits_this_period / c.target_visits) * 100)
                    : 0}%
                </span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SummaryCards({ total, onTrack, overdue }: {
  total: number
  onTrack: number
  overdue: number
}) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
        <p className="text-xs text-gray-400 mb-1">Total Pelanggan</p>
        <p className="text-2xl font-bold text-gray-900">{total}</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
        <p className="text-xs text-gray-400 mb-1">Sesuai Target</p>
        <p className="text-2xl font-bold text-green-600">{onTrack}</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
        <p className="text-xs text-gray-400 mb-1">Kunjungan Terlambat</p>
        <p className="text-2xl font-bold text-red-500">{overdue}</p>
      </div>
    </div>
  )
}

export default function ManagerCustomers() {
  const { profile } = useAuth()

  const { data: customers, isLoading } = useQuery({
    queryKey: ['my_customers', profile?.id],
    queryFn: () => fetchMyCustomersWithStats(profile!.id),
    enabled: !!profile?.id,
  })

  const onTrack = customers?.filter(c => c.on_track).length ?? 0
  const total   = customers?.length ?? 0
  const overdue = customers?.filter(c => isOverdue(c.last_visit_date, c.visit_frequency_days)).length ?? 0

  return (
    <div className="min-h-screen bg-gray-50">
      <GirardNav />

      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5">
        <h1 className="text-xl font-semibold text-gray-900">Pelanggan Saya</h1>
        <p className="text-sm text-gray-500 mt-0.5">Kepatuhan target kunjungan — 30 hari terakhir</p>
      </div>

      <div className="px-4 md:px-8 py-6 space-y-6">
        {!isLoading && total > 0 && (
          <SummaryCards total={total} onTrack={onTrack} overdue={overdue} />
        )}
        {isLoading && (
          <div className="text-center text-gray-400 text-sm py-24">Memuat data pelanggan...</div>
        )}
        {!isLoading && total === 0 && (
          <div className="text-center py-24">
            <p className="text-gray-400 text-sm">Belum ada pelanggan yang ditugaskan.</p>
            <p className="text-gray-300 text-xs mt-1">Hubungi kepala penjualan untuk menugaskan pelanggan.</p>
          </div>
        )}
        {!isLoading && total > 0 && customers && (
          <>
            <CustomerTable customers={customers} />
            <CustomerCards customers={customers} />
          </>
        )}
      </div>
    </div>
  )
}

// ─── Named export for Dashboard ───────────────────────────────────────────────
export function ManagerCustomersContent() {
  const { profile } = useAuth()

  const { data: customers, isLoading } = useQuery({
    queryKey: ['my_customers', profile?.id],
    queryFn: () => fetchMyCustomersWithStats(profile!.id),
    enabled: !!profile?.id,
  })

  const onTrack = customers?.filter(c => c.on_track).length ?? 0
  const total   = customers?.length ?? 0
  const overdue = customers?.filter(c => isOverdue(c.last_visit_date, c.visit_frequency_days)).length ?? 0

  return (
    <div className="px-4 md:px-8 py-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Pelanggan Saya</h2>
        <p className="text-sm text-gray-500 mt-0.5">Kepatuhan target kunjungan — 30 hari terakhir</p>
      </div>

      {!isLoading && total > 0 && (
        <SummaryCards total={total} onTrack={onTrack} overdue={overdue} />
      )}
      {isLoading && (
        <div className="text-center text-gray-400 text-sm py-24">Memuat data pelanggan...</div>
      )}
      {!isLoading && total === 0 && (
        <div className="text-center py-24">
          <p className="text-gray-400 text-sm">Belum ada pelanggan yang ditugaskan.</p>
          <p className="text-gray-300 text-xs mt-1">Hubungi kepala penjualan untuk menugaskan pelanggan.</p>
        </div>
      )}
      {!isLoading && total > 0 && customers && (
        <>
          <CustomerTable customers={customers} />
          <CustomerCards customers={customers} />
        </>
      )}
    </div>
  )
}