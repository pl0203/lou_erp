import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import GirardNav from '../../components/GirardNav'
import VisitRequestInbox from '../../components/VisitRequestInbox'

export default function VisitRequests() {
  const { profile } = useAuth()
  return (
    <div className="min-h-screen bg-brand-canvas">
      <GirardNav />
      <header className="border-b border-gray-200 bg-white px-4 py-6 md:px-8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-brand-primary">Permintaan Kunjungan</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-gray-500">
              {profile?.role === 'sales_person'
                ? 'Pantau pengajuan kunjungan baru dan perubahan jadwal Anda.'
                : 'Tinjau pengajuan kunjungan baru dan perubahan jadwal dari tim Anda.'}
            </p>
          </div>
          <Link to="/girard/schedule" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-semibold text-brand-primary transition-colors hover:bg-brand-tint">
            Lihat Jadwal
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
        <VisitRequestInbox key={`${profile?.id}:${profile?.role}`} />
      </main>
    </div>
  )
}
