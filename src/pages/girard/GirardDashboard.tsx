import { TeamSalesDashboardPanel } from '../../components/sales/MySalesDashboardPanel'
import { dashboardFeatureEnabled } from '../../lib/salesDashboard/useDashboardRead'
import { PageHeader } from '../../components/ui/PageHeader'
import { MainContent } from '../../components/ui/MainContent'
import { useSearchParams } from 'react-router-dom'
import GirardNav from '../../components/GirardNav'
import { CustomerPerformanceContent } from './CustomerPerformance'
import { PerformanceContent } from './GirardPerformance'

type Tab = 'customers' | 'team'

export default function GirardDashboard() {
  const [search] = useSearchParams()
  const requestedTab = search.get('tab')
  const activeTab: Tab = requestedTab === 'team' || requestedTab === 'customers' ? requestedTab : dashboardFeatureEnabled ? 'team' : 'customers'

  return (
    <div className="min-h-screen bg-brand-canvas">
      <GirardNav />
      <MainContent>

      <PageHeader title={activeTab === 'team' ? 'Performa Tim' : 'Performa Toko'} description="Ringkasan performa tim dan toko" className="bg-white border-b border-brand-divider px-4 md:px-8 py-5" />

      <div>
        {activeTab === 'customers' && <CustomerPerformanceContent />}
        {activeTab === 'team' && (dashboardFeatureEnabled ? <div className="px-4 py-6 md:px-8"><TeamSalesDashboardPanel showHeading={false} /></div> : <PerformanceContent />)}
      </div>
      </MainContent>
    </div>
  )
}