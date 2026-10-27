import GirardNav from '../../components/GirardNav'
import ActivePromotionsBanner from '../../components/ActivePromotionsBanner'
import { MainContent } from '../../components/ui/MainContent'
import { PageHeader } from '../../components/ui/PageHeader'

/** Sales roles can view authorized highlights; all administration lives in Procurement. */
export default function Promotions() {
  return <div className="min-h-screen bg-brand-canvas">
    <GirardNav />
    <MainContent>
      <PageHeader title="Promosi" description="Sales · Produk dan stok promosi terkini" className="border-b border-brand-divider bg-white px-4 py-5 md:px-8" />
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8"><ActivePromotionsBanner /></div>
    </MainContent>
  </div>
}
