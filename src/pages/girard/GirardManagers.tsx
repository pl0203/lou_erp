import ReadFailure from '../../components/ReadFailure'
import { readCompleteQuery } from '../../lib/reads/completeQuery'
import { chunkIds } from '../../lib/reads/completeReads'
import { singleRelation } from '../../lib/relations'
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

async function fetchManagersData(signal?: AbortSignal): Promise<ManagerData[]> {
  const managers = await readCompleteQuery<Omit<ManagerData, 'customers' | 'team'>>((offset, limit) => supabase
    .rpc('pilot_team_directory', {}, { count: 'exact' }).eq('role', 'sales_manager').eq('is_active', true)
    .order('id').range(offset, offset + limit - 1), row => row.id, signal)
  const customerMap = new Map<string, ManagerData['customers']>()
  const teamMap = new Map<string, ManagerData['team']>()
  for (const ids of chunkIds(managers.map(row => row.id))) {
    // A salesperson's current supervisor receives the team view; ownership stays on the salesperson.
    const team = await readCompleteQuery((offset, limit) => supabase.from('users').select('id, full_name, manager_id, is_active', { count: 'exact' })
      .eq('role', 'sales_person').eq('is_active', true).in('manager_id', ids).order('id').range(offset, offset + limit - 1), row => row.id, signal)
    const supervisorByOwner = new Map([...ids.map(id => [id, id] as const), ...team.map(member => [member.id, member.manager_id] as const)])
    for (const ownerIds of chunkIds([...supervisorByOwner.keys()])) {
      const assignments = await readCompleteQuery((offset, limit) => supabase.from('customer_manager_assignments')
        .select('id, manager_id, customers!customer_manager_assignments_customer_id_fkey(id, name)', { count: 'exact' })
        .in('manager_id', ownerIds).order('id').range(offset, offset + limit - 1), row => row.id, signal)
      for (const assignment of assignments) {
        const customer = singleRelation(assignment.customers)
        const supervisorId = supervisorByOwner.get(assignment.manager_id)
        if (customer && supervisorId) {
          const group = customerMap.get(supervisorId) ?? []
          if (!group.some(row => row.id === customer.id)) group.push(customer)
          customerMap.set(supervisorId, group)
        }
      }
    }
    for (const member of team) if (member.manager_id && member.is_active) {
      const group = teamMap.get(member.manager_id) ?? []
      group.push(member)
      teamMap.set(member.manager_id, group)
    }
  }
  return managers.sort((a, b) => a.full_name.localeCompare(b.full_name)).map(manager => ({
    ...manager, customers: customerMap.get(manager.id) ?? [], team: teamMap.get(manager.id) ?? [],
  }))
}

export default function GirardManagers() {
  const { data: managers, isLoading, isError: readError, refetch } = useQuery({
    queryKey: ['managers_data'],
    queryFn: ({ signal }) => fetchManagersData(signal),
  })

  if (readError) return <div className="min-h-screen bg-brand-canvas"><GirardNav /><ReadFailure onRetry={() => { void refetch() }} /></div>

  return (
    <div className="min-h-screen bg-brand-canvas">
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
