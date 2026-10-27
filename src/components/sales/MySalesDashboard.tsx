import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/Feedback'
import { formatDisplayDate } from '../../lib/displayDate'
import type { DashboardMetric } from '../../lib/salesDashboard/contracts'
import { dashboardMetricDefinitions, dashboardMonthLabel, metricValueText } from '../../lib/salesDashboard/definitions'
import { DashboardDefinitions, DashboardListFilters, DashboardTrend, DashboardPagination, MonthControl, QualityNote, RowMetricDetails, TargetDisplay, dashboardCard, dashboardLink, disclosureClass, type DashboardViewProps } from './MySalesDashboardShared'

/** Presentation-only V3 view; injected reads are used by local synthetic tests. */
export function MySalesDashboard({ data, month, search, onMonth, onSearch, onPage, onRefresh, onSearchCommit, appliedSearch, sort = 'name', attention = 'all', onSort, onAttention, pending = false }: DashboardViewProps) {
  const searchId = useId()
  const [trendMetric, setTrendMetric] = useState<DashboardMetric>('poDeliveryValue')
  const todayKnown = data.activity.todayVisited !== null && data.activity.todayScheduled !== null
  const matchedKnown = data.activity.todayMatchedScheduled !== null && data.activity.todayScheduled !== null
  const remaining = matchedKnown ? (BigInt(data.activity.todayScheduled!) - BigInt(data.activity.todayMatchedScheduled!)).toString() : null
  return <div className="min-w-0 space-y-7 [overflow-wrap:anywhere]">
    <header><h1 className="text-2xl font-bold text-brand-primary sm:text-3xl">Ringkasan Saya</h1><p className="mt-1 text-sm text-brand-secondary">{formatDisplayDate(data.activity.asOfDate)} · Prioritas hari ini</p></header>
    <section aria-label="Prioritas hari ini" className="grid min-w-0 gap-3 md:grid-cols-2">
      <article className={`${dashboardCard} !bg-emerald-50/60`}><h2 className="text-lg font-semibold text-brand-primary">{matchedKnown ? `${data.activity.todayMatchedScheduled} / ${data.activity.todayScheduled} jadwal dikunjungi` : todayKnown ? `${data.activity.todayVisited} pelanggan dikunjungi · ${data.activity.todayScheduled} jadwal` : 'Ringkasan jadwal belum tersedia'}</h2><p className="mt-1 text-sm text-brand-secondary">{remaining === null ? 'Pelanggan dikunjungi dan jadwal hari ini dihitung terpisah; sisa jadwal belum diketahui.' : `${remaining} jadwal belum dikunjungi hari ini`}</p>{matchedKnown && <p className="mt-1 text-[13px] text-brand-secondary">Hanya kunjungan yang terhubung dengan jadwal hari ini; kunjungan tanpa jadwal tidak mengurangi sisa.</p>}<Link className={`${dashboardLink} mt-3 !bg-brand-primary !text-white !no-underline`} to="/girard/schedule">Buka jadwal saya →</Link></article>
      <article className={dashboardCard}><h2 className="text-lg font-semibold text-brand-primary">{data.activity.pendingRequests === null ? 'Status permintaan belum tersedia' : `${data.activity.pendingRequests} permintaan saya menunggu persetujuan`}</h2><p className="mt-1 text-sm text-brand-secondary">Semua tanggal · belum menjadi jadwal disetujui.</p><Link className={`${dashboardLink} mt-3`} to="/girard/visit-requests">Lihat status permintaan →</Link></article>
    </section>
    <section aria-label="Pesanan masuk dan realisasi penjualan" className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-3"><div className="min-w-0"><h2 className="text-xl font-semibold text-brand-primary">Pesanan masuk dan realisasi penjualan</h2><p className="mt-1 text-sm text-brand-secondary">Kredit penjualan saya · Seluruh {data.total} pelanggan dalam hasil filter, bukan hanya halaman ini.</p></div><div className="w-full min-w-0 sm:w-56"><MonthControl month={month} onMonth={onMonth} pending={pending} /></div></div>
      <p className="text-sm text-brand-secondary">{dashboardMonthLabel(data.month)} · {data.provisional ? 'Sementara; bulan belum selesai.' : 'Bulan penuh; kelengkapan setiap sumber tetap perlu diperhatikan.'} Tidak ada penjumlahan lintas tahap.</p>
      <div className="grid min-w-0 gap-3 md:grid-cols-6">{dashboardMetricDefinitions.map((definition, index) => <article key={definition.key} className={`${dashboardCard} ${index < 3 ? 'md:col-span-2' : 'md:col-span-3'}`}><h3 className="font-semibold text-brand-primary"><span className="mr-2 text-[13px] text-brand-secondary" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{definition.label}</h3><p className="mt-3 text-2xl font-bold tabular-nums text-brand-primary">{metricValueText(data.summary[definition.key], definition.key)}</p><p className="mt-2 text-[13px] text-brand-secondary">{definition.basis}</p><QualityNote value={data.summary[definition.key]} />{definition.targetMetric && <div className="mt-3 border-t border-brand-divider pt-3">{((appliedSearch ?? search).length > 0 || attention !== 'all') ? <p className="text-[13px] text-brand-secondary">Capaian tidak dibandingkan untuk hasil pencarian atau filter pelanggan. Target orang tidak dialokasikan per pelanggan.</p> : <TargetDisplay actual={data.summary[definition.key]} target={data.targets[definition.targetMetric]} metric={definition.key} month={data.month} />}</div>}</article>)}</div>
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">CO dikirim ≠ CO terjual. Penjualan dapat berasal dari CO bulan sebelumnya. Tanpa laporan bukan berarti penjualan nol.</p>
    </section>
    <DashboardTrend data={data} metric={trendMetric} onMetric={setTrendMetric} />
    <section aria-label="Pelanggan saya" className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold text-brand-primary">Pelanggan</h2><Button variant="secondary" size="compact" disabled={pending} onClick={onRefresh}>Muat ulang ringkasan</Button></div>
      <form className="min-w-0" onSubmit={event => { event.preventDefault(); onSearchCommit?.() }}><label htmlFor={searchId} className="mb-1 block text-sm font-medium text-brand-primary">Cari pelanggan</label><input id={searchId} className="ui-control w-full min-w-0" type="search" maxLength={200} placeholder="Cari nama pelanggan..." value={search} onChange={event => onSearch(event.target.value)} />{onSearchCommit && <Button type="submit" size="compact" variant="secondary" className="mt-2">Cari</Button>}<p className="mt-2 text-[13px] text-brand-secondary">Pencarian memperbarui KPI dan daftar. Pindah halaman tidak mengubah total.{onSearchCommit ? ' Tekan Cari untuk menerapkan pencarian.' : ''}</p></form>
      <DashboardListFilters own sort={sort} attention={attention} onSort={onSort} onAttention={onAttention} />
      <p className="text-[13px] text-brand-secondary">Fokus memperbarui seluruh KPI dan daftar; urutan dan halaman tidak mengubah total. Data yang belum tersedia selalu di akhir urutan nilai.</p>
      {data.items.length === 0 ? <EmptyState title="Tidak ada pelanggan dalam hasil ini." actions={search ? <Button size="compact" variant="secondary" onClick={() => onSearch('')}>Hapus pencarian</Button> : undefined} /> : <>
        <div className="hidden min-w-0 rounded-xl border border-brand-divider bg-white p-3 lg:block"><table className="w-full table-fixed text-sm"><caption className="sr-only">KPI per pelanggan</caption><thead><tr className="border-b border-brand-divider text-left text-[13px] text-brand-secondary"><th className="w-[25%] px-2 py-3 font-medium">Pelanggan</th>{dashboardMetricDefinitions.map(definition => <th className="px-2 py-3 font-medium" key={definition.key}>{definition.shortLabel}</th>)}</tr></thead><tbody>{data.items.map(row => <tr key={row.id} className="border-b border-brand-divider last:border-0"><th scope="row" className="px-2 py-3 text-left font-semibold text-brand-primary">{row.name}</th>{dashboardMetricDefinitions.map(definition => <td className="px-2 py-3 align-top text-brand-primary" key={definition.key}>{metricValueText(row.metrics[definition.key], definition.key)}<QualityNote value={row.metrics[definition.key]} /></td>)}</tr>)}</tbody></table></div>
        <ul aria-label="Kartu pelanggan" className="space-y-3 lg:hidden">{data.items.map(row => <li key={row.id} className={`${dashboardCard} !py-0`}><details><summary className={disclosureClass}>{row.name}</summary><RowMetricDetails row={row} month={data.month} /></details></li>)}</ul>
      </>}
      <DashboardPagination data={data} onPage={onPage} pending={pending} noun="pelanggan" />
    </section>
    <DashboardDefinitions data={data} />
  </div>
}
