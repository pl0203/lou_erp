import GirardNav from '../../components/GirardNav'
import ActivePromotionsBanner from '../../components/ActivePromotionsBanner'

/** Sales roles can view authorized highlights; all administration lives in Procurement. */
export default function Promotions() {
  return <div className="min-h-screen bg-brand-canvas">
    <GirardNav />
    <header className="border-b border-gray-200 bg-white px-4 py-5 md:px-8"><h1 className="text-xl font-semibold text-brand-primary">Product Highlight</h1><p className="mt-1 text-sm text-gray-500">Sales · Produk dan stok promosi terkini</p></header>
    <main className="mx-auto max-w-5xl px-4 py-6 md:px-8"><ActivePromotionsBanner /></main>
  </div>
}
