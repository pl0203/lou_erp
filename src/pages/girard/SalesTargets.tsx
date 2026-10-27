import { LoadingState } from '../../components/ui/LoadingState'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import GirardNav from '../../components/GirardNav'
import { MainContent } from '../../components/ui/MainContent'
import { PageHeader } from '../../components/ui/PageHeader'
import { TargetWizard } from '../../components/sales/TargetWizard'
import { useAuth, useBeforeSignOut } from '../../lib/AuthContext'
import { useUnsavedChanges } from '../../lib/useUnsavedChanges'
import { clearTargetDrafts } from '../../lib/salesTargets/useTargetDraft'
import { useTargetTransport } from '../../lib/salesTargets/useTargetTransport'
import { TargetPlanInbox } from '../../components/sales/TargetPlanInbox'
import type { TargetTransport } from '../../lib/salesTargets/transport'
/** Default is intentionally unavailable. Reviewed API/permission activation is a separate release. */
export default function SalesTargets({ transport: injected }: { transport?: TargetTransport }) {
  const { user, profile, loading } = useAuth(), [search, setSearch] = useSearchParams()
  const [dirty, setDirty] = useState(false), [inboxRefresh, setInboxRefresh] = useState(0), [planRefresh, setPlanRefresh] = useState(0)
  const protection = useUnsavedChanges(dirty)
  const verified = !loading && !!user && profile?.is_active && user.id === profile.id
  const transport = useTargetTransport(verified ? `${user.id}:${profile.role}` : '', injected)
  useEffect(() => { if (!verified) clearTargetDrafts() }, [verified, user?.id, profile?.role])
  useBeforeSignOut(signal => protection.confirmDiscardDecision({ signal, message: 'Draf belum disimpan. Keluar akan menghapus isian sementara. Simpan draf terlebih dahulu bila ingin melanjutkan nanti.' }), `${user?.id}:${profile?.role}`)
  return <div className="min-h-screen bg-brand-canvas"><GirardNav />
    <MainContent>
      <PageHeader title="Target Penjualan" description="Target bulanan dengan dasar historis dan persetujuan yang terpisah." className="bg-white border-b border-brand-divider px-4 md:px-8 py-5" />
      <div className="space-y-6 px-4 py-6 md:px-8">
      {verified ? <TargetWizard actor={{ id: profile.id, role: profile.role, active: true }} teams={profile.role === 'sales_manager' ? [{ managerId: profile.id, name: `Tim ${profile.full_name}` }] : []} transport={transport} initialPlanId={search.get('plan') ?? undefined} refreshKey={planRefresh} onDirtyChange={setDirty} onPlanSaved={plan => { setInboxRefresh(value => value + 1); const next = new URLSearchParams(search); next.set('plan', plan.id); setSearch(next, { replace: true }) }} /> : <LoadingState title="Memeriksa akses akun…" shape="compact" />}
      {verified && <TargetPlanInbox key={`${user.id}:${profile.role}`} actor={{ id: profile.id, role: profile.role, active: true }} transport={transport} refreshKey={inboxRefresh} onOpen={planId => { setPlanRefresh(value => value + 1); const next = new URLSearchParams(search); next.set('plan', planId); setSearch(next) }} />}
      {protection.dialog}
      </div>
    </MainContent>
  </div>
}
