import { LoadingState } from '../../components/ui/LoadingState'
import { PageHeader } from '../../components/ui/PageHeader'
import { ActionLink } from '../../components/ui/ActionLink'
import { EmptyState } from '../../components/ui/Feedback'
import { RecordList } from '../../components/ui/RecordList'
import { SummaryList } from '../../components/ui/SummaryList'
import { MainContent } from '../../components/ui/MainContent'
import { calendarDateKey } from '../../lib/calendarDate'
import { visitScheduleHref } from '../../lib/visitUsability'
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
  const { data: managers, isError: readError, refetch } = useQuery({
    queryKey: ['managers_data'],
    queryFn: ({ signal }) => fetchManagersData(signal),
  })
  const isLoading = managers === undefined && !readError

  if (readError) return <div className="min-h-screen bg-brand-canvas"><GirardNav /><MainContent><PageHeader title="Manajer" description="Jumlah manajer belum tersedia" className="bg-white border-b border-brand-divider px-4 md:px-8 py-5" /><ReadFailure onRetry={() => { void refetch() }} /></MainContent></div>

  return (
    <div className="min-h-screen bg-brand-canvas">
      <GirardNav />
      <MainContent>

      <PageHeader title="Manajer" description={isLoading ? 'Memuat jumlah manajer…' : `${managers?.length ?? 0} manajer penjualan`}
        className="bg-white border-b border-brand-divider px-4 md:px-8 py-5" />

      <div className="px-4 md:px-8 py-6">
        {isLoading && (
          <LoadingState title="Memuat..." shape="list" />
        )}

        {!isLoading && managers?.length === 0 && (
          <EmptyState title="Tidak ada manajer penjualan ditemukan." />
        )}

        {!isLoading && managers && managers.length > 0 && (
          <RecordList label="Manajer penjualan" className="grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {managers.map(m => (
              <li key={m.id} className="min-w-0 bg-white rounded-[14px] border border-brand-divider p-5">
                {/* Manager info */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-green-100 text-green-700 text-sm font-semibold flex items-center justify-center shrink-0">
                    {m.full_name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-brand-primary [overflow-wrap:anywhere]">{m.full_name}</p>
                    <p className="text-[13px] text-brand-secondary [overflow-wrap:anywhere]">{m.email}</p>
                  </div>
                </div>

                <ActionLink size="compact" variant="quiet" aria-label={`Lihat jadwal tim ${m.full_name}`} className="mb-4" to={visitScheduleHref(calendarDateKey(), undefined, m.id)}>Lihat jadwal tim</ActionLink>
                {/* Stats */}
                <SummaryList className="mb-4 rounded-lg bg-brand-canvas p-3" items={[
                  { label: 'Pelanggan', value: m.customers.length },
                  { label: 'Sales', value: m.team.length },
                ]} />

                {/* Team list */}
                {m.team.length > 0 && (
                  <div className="mb-3">
                    <p className="text-[13px] text-brand-secondary mb-2">Tim</p>
                    <div className="space-y-1">
                      {m.team.map(sp => (
                        <div key={sp.id} className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 text-[13px] font-semibold flex items-center justify-center shrink-0">
                            {sp.full_name[0]}
                          </div>
                          <a className="text-sm text-brand-primary underline" href={visitScheduleHref(calendarDateKey(), sp.id)}>{sp.full_name}</a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Customer list */}
                {m.customers.length > 0 && (
                  <div>
                    <p className="text-[13px] text-brand-secondary mb-2">Pelanggan Ditugaskan</p>
                    <div className="space-y-1">
                      {m.customers.slice(0, 3).map(c => (
                        <p key={c.id} className="text-[13px] text-brand-secondary [overflow-wrap:anywhere]">• {c.name}</p>
                      ))}
                      {m.customers.length > 3 && (
                        <p className="text-[13px] text-brand-secondary">+{m.customers.length - 3} lainnya</p>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </RecordList>
        )}
      </div>
      </MainContent>
    </div>
  )
}
