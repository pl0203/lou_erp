import { MainContent } from '../../components/ui/MainContent'
import { PageHeader } from '../../components/ui/PageHeader'
import { Button } from '../../components/ui/Button'
import { EmptyState, Notice, StatusBadge } from '../../components/ui/Feedback'
import { RecordList } from '../../components/ui/RecordList'
import { SummaryList } from '../../components/ui/SummaryList'
import { useAuth } from '../../lib/AuthContext'
import { usePagedRead } from '../../lib/reads/usePagedRead'
import { fetchManagerCustomerPage } from '../../lib/reads/reports'
import type { ManagerCustomer as CustomerWithStats } from '../../lib/reads/contracts'
import PaginationControls from '../../components/PaginationControls'
import GirardNav from '../../components/GirardNav'

const FREQUENCY_OPTIONS = [
  { days: 3,  label: '2x per minggu' },
  { days: 7,  label: '1x per minggu' },
  { days: 14, label: '1x per 2 minggu' },
  { days: 15, label: '2x per bulan' },
  { days: 30, label: '1x per bulan' },
]

function frequencyLabel(days: number): string {
  return FREQUENCY_OPTIONS.find(f => f.days === days)?.label ?? `Setiap ${days} hari`
}

function isOverdue(lastVisit: string | null, frequencyDays: number, referenceInstant: string): boolean {
  if (!lastVisit) return true
  const diff = (new Date(referenceInstant).getTime() - new Date(lastVisit).getTime()) / (1000 * 60 * 60 * 24)
  return diff > frequencyDays
}

function CustomerTable({ customers, referenceInstant }: { customers: CustomerWithStats[]; referenceInstant: string }) {
  return (
    <div role="region" aria-label="Tabel pelanggan saya" tabIndex={0} className="hidden md:block bg-white rounded-[14px] border border-brand-divider overflow-x-auto">
      <p className="px-4 py-2 text-[13px] text-brand-secondary">Geser tabel untuk melihat semua kolom.</p>
      <table className="w-full min-w-[920px] text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-brand-divider">
            <th className="text-left px-5 py-3 font-medium text-brand-secondary">Pelanggan</th>
            <th className="text-left px-5 py-3 font-medium text-brand-secondary">Lokasi</th>
            <th className="text-left px-5 py-3 font-medium text-brand-secondary">Frekuensi Kunjungan</th>
            <th className="text-center px-5 py-3 font-medium text-brand-secondary">Target (30hr)</th>
            <th className="text-center px-5 py-3 font-medium text-brand-secondary">Aktual (30hr)</th>
            <th className="text-left px-5 py-3 font-medium text-brand-secondary">Kunjungan Terakhir</th>
            <th className="text-center px-5 py-3 font-medium text-brand-secondary">Status</th>
          </tr>
        </thead>
        <tbody>
          {customers.map(c => {
            const overdue = isOverdue(c.last_visit_date, c.visit_frequency_days, referenceInstant)
            return (
              <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-5 py-4 font-medium text-brand-primary [overflow-wrap:anywhere]">{c.name}</td>
                <td className="px-5 py-4 text-brand-secondary text-[13px]">
                  {[c.address, c.city].filter(Boolean).join(', ') || '—'}
                </td>
                <td className="px-5 py-4 text-brand-secondary text-[13px]">
                  {frequencyLabel(c.visit_frequency_days)}
                </td>
                <td className="px-5 py-4 text-center text-brand-secondary">{c.target_visits}</td>
                <td className="px-5 py-4 text-center">
                  <span className={`font-medium ${c.on_track ? 'text-green-700' : 'text-red-700'}`}>
                    {c.visits_this_period}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <span className={`text-[13px] ${overdue ? 'text-red-700 font-medium' : 'text-brand-secondary'}`}>
                    {c.last_visit_date
                      ? new Date(c.last_visit_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
                      : 'Belum pernah'}
                    {overdue && ' ⚠'}
                  </span>
                </td>
                <td className="px-5 py-4 text-center">
                  <StatusBadge tone={c.on_track ? 'success' : 'error'}>
                    {c.on_track ? 'Sesuai target' : 'Tertinggal'}
                  </StatusBadge>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CustomerCards({ customers, referenceInstant }: { customers: CustomerWithStats[]; referenceInstant: string }) {
  return (
    <RecordList label="Pelanggan saya" className="md:hidden">
      {customers.map(c => {
        const overdue = isOverdue(c.last_visit_date, c.visit_frequency_days, referenceInstant)
        return (
          <li key={c.id} className="bg-white rounded-[14px] border border-brand-divider p-4">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-brand-primary [overflow-wrap:anywhere]">{c.name}</p>
                {c.city && <p className="text-[13px] text-brand-secondary mt-0.5">{c.city}</p>}
              </div>
              <StatusBadge tone={c.on_track ? 'success' : 'error'}>
                {c.on_track ? 'Sesuai target' : 'Tertinggal'}
              </StatusBadge>
            </div>
            <SummaryList items={[
              { label: 'Frekuensi', value: frequencyLabel(c.visit_frequency_days) },
              { label: 'Kunjungan Terakhir', value: <span className={overdue ? 'font-medium text-red-700' : undefined}>{c.last_visit_date ? new Date(c.last_visit_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : 'Belum pernah'}{overdue && ' ⚠'}</span> },
              { label: 'Target (30hr)', value: `${c.target_visits} kunjungan` },
              { label: 'Aktual (30hr)', value: <span className={c.on_track ? 'text-green-700' : 'text-red-700'}>{c.visits_this_period} kunjungan</span> },
            ]} />
            <div className="mt-3 pt-3 border-t border-brand-divider">
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all ${
                      c.on_track ? 'bg-green-500' : 'bg-red-400'
                    }`}
                    style={{
                      width: `${Math.min(100, c.target_visits > 0
                        ? (c.visits_this_period / c.target_visits) * 100
                        : 0)}%`
                    }}
                  />
                </div>
                <span className="text-[13px] text-brand-secondary">
                  {c.target_visits > 0
                    ? Math.round((c.visits_this_period / c.target_visits) * 100)
                    : 0}%
                </span>
              </div>
            </div>
          </li>
        )
      })}
    </RecordList>
  )
}

function SummaryCards({ total, onTrack, overdue }: {
  total: number
  onTrack: number
  overdue: number
}) {
  return <section aria-label="Ringkasan pelanggan" className="rounded-[14px] border border-brand-divider bg-white p-4">
    <SummaryList items={[
      { label: 'Total Pelanggan', value: total },
      { label: 'Sesuai Target', value: <span className="text-green-700">{onTrack}</span> },
      { label: 'Kunjungan Terlambat', value: <span className="text-red-700">{overdue}</span> },
    ]} />
  </section>
}

export default function ManagerCustomers() {
  return <div className="min-h-screen bg-brand-canvas"><GirardNav /><MainContent><PageHeader title="Pelanggan Saya" description="Kepatuhan target kunjungan · 30 hari terakhir" className="bg-white border-b border-brand-divider px-4 py-5 md:px-8" /><ManagerCustomersContent /></MainContent></div>
}
export function ManagerCustomersContent() {
  const { profile } = useAuth()
  const { data, setPage, isPending, isError, refetch } = usePagedRead('my_customers', {}, (_filters, page, signal) => fetchManagerCustomerPage(profile!.id, page, signal))
  return <div className="px-4 md:px-8 py-6 space-y-6">
    {isError ? <Notice tone="error" title="Data pelanggan tidak tersedia." actions={<Button variant="secondary" onClick={() => { void refetch() }}>Coba lagi</Button>} /> : !data ? <Notice tone="info" title="Memuat data pelanggan..." /> : <>
      <PaginationControls page={data.page} total={data.total} pageSize={data.page_size} pending={isPending} onPageChange={setPage} />
      <SummaryCards total={data.summary.total} onTrack={data.summary.on_track} overdue={data.summary.overdue} />
      {data.items.length === 0 ? <EmptyState title="Belum ada pelanggan yang ditugaskan.">Hubungi kepala penjualan untuk menugaskan pelanggan.</EmptyState> : <><CustomerTable customers={data.items} referenceInstant={data.referenceInstant} /><CustomerCards customers={data.items} referenceInstant={data.referenceInstant} /></>}
    </>}
  </div>
}
