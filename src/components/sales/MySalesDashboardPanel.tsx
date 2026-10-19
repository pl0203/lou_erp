import { LoadingState } from '../ui/LoadingState'
import { useState, type ReactNode } from 'react'
import { Button } from '../ui/Button'
import { Notice } from '../ui/Feedback'
import { useAuth } from '../../lib/AuthContext'
import type { DashboardScope } from '../../lib/salesDashboard/contracts'
import type { DashboardTransport } from '../../lib/salesDashboard/transport'
import { dashboardFeatureEnabled, useDashboardRead } from '../../lib/salesDashboard/useDashboardRead'
import { MySalesDashboard } from './MySalesDashboard'
import { TeamSalesDashboard } from './TeamSalesDashboard'
function DashboardReadContent({ scope, enabled, transport }: { scope: DashboardScope; enabled?: boolean; transport?: DashboardTransport }) {
  const read = useDashboardRead(scope, enabled, transport)
  const frame = (notice: ReactNode) => <div className="min-w-0 space-y-5"><h1 className="text-2xl font-bold text-brand-primary sm:text-3xl">{scope === 'own' ? 'Ringkasan Saya' : 'Performa Tim'}</h1>{notice}</div>
  if (!read.enabled) return frame(<Notice tone="info" title="Ringkasan baru belum diaktifkan.">Laporan lama tetap terpisah. Belum ada target atau KPI baru yang ditampilkan.</Notice>)
  if (!read.allowed) return frame(<Notice tone="error" title="Ringkasan tidak tersedia untuk cakupan akun ini." />)
  if (!read.valid) return frame(<Notice tone="error" title="Filter ringkasan tidak valid." actions={<Button variant="secondary" size="compact" onClick={read.onReset}>Atur ulang filter</Button>} />)
  if (read.error) return frame(<Notice tone="error" title="Ringkasan baru belum tersedia." actions={<Button variant="secondary" size="compact" onClick={read.onRefresh}>Coba lagi</Button>}>Layanan atau datanya belum siap. Data lama tidak diubah menjadi KPI atau target baru.</Notice>)
  if (!read.data) return frame(<LoadingState title="Memuat ringkasan..." shape="dashboard">Angka hanya ditampilkan setelah cakupan dan kelengkapan respons diperiksa.</LoadingState>)
  return <LoadedDashboard key={`${read.identity}:${read.scope}:${read.month}:${read.search}:${read.data.page}`} read={{ ...read, data: read.data }} />
}
function LoadedDashboard({ read }: { read: ReturnType<typeof useDashboardRead> & { data: NonNullable<ReturnType<typeof useDashboardRead>['data']> } }) {
  const [search, setSearch] = useState(read.search)
  const props = { ...read, search, appliedSearch: read.search, onSearch: setSearch, onSearchCommit: () => read.onSearch(search) }
  return read.scope === 'own' ? <MySalesDashboard {...props} /> : <TeamSalesDashboard {...props} />
}
export function SalesDashboardPanel({ scope, enabled = dashboardFeatureEnabled, transport }: { scope: DashboardScope; enabled?: boolean; transport?: DashboardTransport }) {
  const { user, profile } = useAuth()
  // Local controls and in-flight views never transfer to a new account, role or hierarchy.
  return <DashboardReadContent key={`${user?.id ?? ''}:${profile?.role ?? ''}:${profile?.manager_id ?? ''}:${scope}`} scope={scope} enabled={enabled} transport={transport} />
}
export function MySalesDashboardPanel() { return <SalesDashboardPanel scope="own" /> }
export function TeamSalesDashboardPanel() { const { profile } = useAuth(); return <SalesDashboardPanel scope={profile?.role === 'sales_manager' ? 'team' : 'leadership'} /> }
