import { TeamSalesDashboardPanel } from '../../components/sales/MySalesDashboardPanel'
import { dashboardFeatureEnabled } from '../../lib/salesDashboard/useDashboardRead'
import { PageHeader } from '../../components/ui/PageHeader'
import { FilterBar } from '../../components/ui/FilterBar'
import { Button } from '../../components/ui/Button'
import { MainContent } from '../../components/ui/MainContent'
import { useState } from 'react'
import GirardNav from '../../components/GirardNav'
import { CustomerPerformanceContent } from './CustomerPerformance'
import { PerformanceContent } from './GirardPerformance'

type Tab = 'customers' | 'team'

export default function GirardDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>(dashboardFeatureEnabled ? 'team' : 'customers')

  const tabs = [
    { key: 'customers' as Tab, label: 'Performa Pelanggan' },
    { key: 'team' as Tab,      label: dashboardFeatureEnabled ? 'Ringkasan Tim' : 'Performa Tim Sales' },
  ]

  return (
    <div className="min-h-screen bg-brand-canvas">
      <GirardNav />
      <MainContent>

      {!(dashboardFeatureEnabled && activeTab === 'team') && <PageHeader title="Dashboard" description="Ringkasan performa tim dan pelanggan" className="bg-white border-b border-brand-divider px-4 md:px-8 py-5" />}
      <FilterBar label="Tampilan dashboard" className="mx-4 my-4 md:mx-8">
        {tabs.map(tab => <Button size="compact" key={tab.key} variant="quiet" aria-pressed={activeTab === tab.key}
          onClick={() => setActiveTab(tab.key)} className={activeTab === tab.key ? 'border-brand-primary underline decoration-brand-primary underline-offset-4' : undefined}>
          {tab.label}
        </Button>)}
      </FilterBar>

      <div>
        {activeTab === 'customers' && <CustomerPerformanceContent />}
        {activeTab === 'team' && (dashboardFeatureEnabled ? <div className="px-4 py-6 md:px-8"><TeamSalesDashboardPanel /></div> : <PerformanceContent />)}
      </div>
      </MainContent>
    </div>
  )
}