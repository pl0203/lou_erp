import GirardNav from '../../components/GirardNav'
import { MainContent } from '../../components/ui/MainContent'
import { PageHeader } from '../../components/ui/PageHeader'
import { EmptyState } from '../../components/ui/Feedback'

export default function OutletDetail() {
  return <div className="min-h-screen bg-brand-canvas"><GirardNav /><MainContent className="p-4 md:p-8 space-y-4">
    <PageHeader title="Detail Outlet" />
    <EmptyState title="Detail outlet belum tersedia." />
  </MainContent></div>
}
