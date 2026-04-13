import { useState } from 'react'
import GirardNav from '../../components/GirardNav'
import { CustomerPerformanceContent } from './CustomerPerformance'
import { PerformanceContent } from './GirardPerformance'

type Tab = 'customers' | 'team'

export default function GirardDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('customers')

  const tabs = [
    { key: 'customers' as Tab, label: 'Performa Pelanggan' },
    { key: 'team' as Tab,      label: 'Performa Tim Sales' },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <GirardNav />

      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5">
        <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">Ringkasan performa tim dan pelanggan</p>
      </div>

      <div className="bg-white border-b border-gray-100 px-4 md:px-8">
        <div className="flex gap-1">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-green-600 text-green-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        {activeTab === 'customers' && <CustomerPerformanceContent />}
        {activeTab === 'team'      && <PerformanceContent />}
      </div>
    </div>
  )
}