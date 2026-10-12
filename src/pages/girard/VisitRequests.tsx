import { ActionLink } from '../../components/ui/ActionLink'
import { MainContent } from '../../components/ui/MainContent'
import { PageHeader } from '../../components/ui/PageHeader'
import VisitRequestStatus from '../../components/VisitRequestStatus'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import GirardNav from '../../components/GirardNav'
import VisitRequestInbox from '../../components/VisitRequestInbox'

export default function VisitRequests() {
  const { profile } = useAuth()
  const { hash } = useLocation()
  const focusedRequest = hash.startsWith('#visit-request-') ? hash.slice('#visit-request-'.length) : null
  return (
    <div className="min-h-screen bg-brand-canvas">
      <GirardNav />
      <MainContent>
        <PageHeader className="border-b border-gray-200 bg-white px-4 py-6 md:px-8" title="Permintaan Kunjungan"
          description={profile?.role === 'sales_person' ? 'Pantau pengajuan kunjungan baru dan perubahan jadwal Anda.' : 'Tinjau pengajuan kunjungan baru dan perubahan jadwal dari tim Anda.'}
          actions={<ActionLink variant="secondary" to="/girard/schedule">Lihat Jadwal</ActionLink>} />
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
          {focusedRequest !== null
            ? <VisitRequestStatus key={`${profile?.id}:${profile?.role}:${focusedRequest}`} requestId={focusedRequest} />
            : <VisitRequestInbox key={`${profile?.id}:${profile?.role}`} />}
        </div>
      </MainContent>
    </div>
  )
}
