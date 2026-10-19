/** Decorative placeholders only; the owning page supplies one live status. */
function Line({ className = '' }: { className?: string }) {
  return <div className={`ui-skeleton h-4 rounded ${className}`} />
}
export function POListSkeleton() {
  return <div aria-hidden="true" data-skeleton="po-list">
    <div className="flex justify-between items-center min-h-14 mt-4 mb-2"><Line className="w-28" /><Line className="w-64 max-w-[55%] h-9" /></div>
    <Line className="hidden md:block w-96 max-w-full mb-2" />
    <div className="hidden md:block rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="grid grid-cols-7 gap-4 bg-gray-50 px-5 py-3">{Array.from({ length: 7 }, (_, i) => <Line key={i} />)}</div>
      {Array.from({ length: 6 }, (_, row) => <div key={row} className="grid grid-cols-7 gap-4 px-5 py-5 border-t border-gray-100">{Array.from({ length: 7 }, (_, col) => <Line key={col} />)}</div>)}
    </div>
    <div className="md:hidden space-y-3">{Array.from({ length: 3 }, (_, i) => <div key={i} className="rounded-xl border border-gray-200 bg-white p-4 space-y-4"><Line className="w-2/3" /><Line className="w-1/2" /><div className="grid grid-cols-2 gap-4"><Line /><Line /></div><Line className="w-1/2" /><Line className="h-9 w-40" /></div>)}</div>
  </div>
}
export function DashboardChartsSkeleton() {
  return <div aria-hidden="true" data-skeleton="charts" className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
    {Array.from({ length: 4 }, (_, i) => <div key={i} className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6 space-y-4"><Line className="w-2/3" /><Line /><Line className="w-5/6" /><div className="ui-skeleton rounded-xl h-[300px]" /><Line className="w-24 h-8" /></div>)}
  </div>
}
export function DashboardSkeleton() {
  return <div aria-hidden="true" data-skeleton="dashboard" className="space-y-6">
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3"><Line className="w-2/3" /><Line /><Line className="w-5/6" /></div>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 space-y-3"><Line className="w-1/2" /><Line className="h-9 w-3/4" /><Line /></div>)}</div>
    <Line className="w-64" /><DashboardChartsSkeleton />
  </div>
}
