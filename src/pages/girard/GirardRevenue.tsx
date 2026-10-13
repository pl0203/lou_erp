import GirardNav from '../../components/GirardNav'
import { SalesMetricsPanel } from '../../components/sales/SalesMetricSummary'

/** Compatibility export only; this view deliberately has no new application route. */
export default function GirardRevenue() {
  return <div className="min-h-screen bg-brand-canvas"><GirardNav /><RevenueContent /></div>
}
export function RevenueContent() {
  return <div className="min-w-0 px-4 py-6 md:px-8"><SalesMetricsPanel /></div>
}
