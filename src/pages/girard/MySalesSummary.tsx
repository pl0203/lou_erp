import { MySalesDashboardPanel } from '../../components/sales/MySalesDashboardPanel'
import { dashboardFeatureEnabled } from '../../lib/salesDashboard/useDashboardRead'
import GirardNav from '../../components/GirardNav'
import { SalesMetricsPanel } from '../../components/sales/SalesMetricSummary'
import { MainContent } from '../../components/ui/MainContent'
import { PageHeader } from '../../components/ui/PageHeader'

export default function MySalesSummary() {
  return <div className="min-h-screen bg-brand-canvas"><GirardNav />
    <MainContent className="space-y-6 px-4 py-6 md:px-8">
      {dashboardFeatureEnabled ? <MySalesDashboardPanel /> : <>
        <PageHeader title="Penjualan Saya" description="Ringkasan kredit penjualan yang diizinkan untuk akun Anda." />
        <p className="text-sm text-brand-secondary">Laporan lama · target lama tidak dikonversi ke basis target bulanan baru.</p>
        <SalesMetricsPanel />
      </>}
    </MainContent>
  </div>
}
