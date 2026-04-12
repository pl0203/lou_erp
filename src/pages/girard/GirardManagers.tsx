import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import GirardNav from '../../components/GirardNav'

type ManagerData = {
  id: string
  full_name: string
  email: string
  phone: string | null
  customers: { id: string; name: string }[]
  team: { id: string; full_name: string }[]
}

async function fetchManagersData(): Promise<ManagerData[]> {
  const { data: managers, error } = await supabase
    .from('users')
    .select('id, full_name, email, phone')
    .eq('role', 'sales_manager')
    .eq('is_active', true)
    .order('full_name')
  if (error) throw error
  if (!managers || managers.length === 0) return []

  const managerIds = managers.map(m => m.id)

  const { data: assignments } = await supabase
    .from('customer_manager_assignments')
    .select('manager_id, customers!customer_manager_assignments_customer_id_fkey(id, name)')
    .in('manager_id', managerIds)

  const { data: team } = await supabase
    .from('users')
    .select('id, full_name, manager_id')
    .eq('role', 'sales_person')
    .eq('is_active', true)
    .in('manager_id', managerIds)

  return managers.map(m => ({
    ...m,
    customers: (assignments ?? [])
      .filter(a => a.manager_id === m.id)
      .map(a => (a.customers as any))
      .filter(Boolean),
    team: (team ?? []).filter(t => t.manager_id === m.id),
  }))
}

export default function GirardManagers() {
  const { data: managers, isLoading } = useQuery({
    queryKey: ['managers_data'],
    queryFn: fetchManagersData,
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <GirardNav />

      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5">
        <h1 className="text-xl font-semibold text-gray-900">Manajer</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {managers?.length ?? 0} manajer penjualan
        </p>
      </div>

      <div className="px-4 md:px-8 py-6">
        {isLoading && (
          <div className="text-center text-gray-400 text-sm py-24">Memuat...</div>
        )}

        {!isLoading && (!managers || managers.length === 0) && (
          <div className="text-center py-24">
            <p className="text-gray-400 text-sm">Tidak ada manajer penjualan ditemukan.</p>
          </div>
        )}

        {!isLoading && managers && managers.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {managers.map(m => (
              <div key={m.id} className="bg-white rounded-xl border border-gray-200 p-5">
                {/* Manager info */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-green-100 text-green-700 text-sm font-semibold flex items-center justify-center shrink-0">
                    {m.full_name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{m.full_name}</p>
                    <p className="text-xs text-gray-400 truncate">{m.email}</p>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-400 mb-1">Pelanggan</p>
                    <p className="text-xl font-bold text-gray-900">{m.customers.length}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-400 mb-1">Sales</p>
                    <p className="text-xl font-bold text-gray-900">{m.team.length}</p>
                  </div>
                </div>

                {/* Team list */}
                {m.team.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs text-gray-400 mb-2">Tim</p>
                    <div className="space-y-1">
                      {m.team.map(sp => (
                        <div key={sp.id} className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 text-xs font-semibold flex items-center justify-center shrink-0">
                            {sp.full_name[0]}
                          </div>
                          <p className="text-xs text-gray-700 truncate">{sp.full_name}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Customer list */}
                {m.customers.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 mb-2">Pelanggan Ditugaskan</p>
                    <div className="space-y-1">
                      {m.customers.slice(0, 3).map(c => (
                        <p key={c.id} className="text-xs text-gray-600 truncate">• {c.name}</p>
                      ))}
                      {m.customers.length > 3 && (
                        <p className="text-xs text-gray-400">+{m.customers.length - 3} lainnya</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}