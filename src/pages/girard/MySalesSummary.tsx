import GirardNav from '../../components/GirardNav'
import { SalesMetricsPanel } from '../../components/sales/SalesMetricSummary'
export default function MySalesSummary() {
  return <div className="min-h-screen bg-brand-canvas"><GirardNav/><main className="min-w-0 space-y-6 px-4 py-6 md:px-8"><div><h1 className="text-xl font-semibold text-gray-900">Penjualan Saya</h1><p className="mt-1 text-sm text-gray-500">Ringkasan kredit penjualan yang diizinkan untuk akun Anda.</p></div><SalesMetricsPanel/></main></div>
}
