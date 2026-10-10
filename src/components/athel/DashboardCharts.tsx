import { useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { moneyPercentage, moneyToChartNumber } from '../../lib/reads/money'
import type { DashboardData } from '../../pages/athel/Dashboard'
import EChart from '../charts/EChart'
import type { ChartZoomEvent } from '../charts/EChart'
import { CHART_COLORS, count, currency, customerOptions, dailyOptions, monthlyOptions, percent, statusOptions } from './dashboardChartOptions'

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const id = useId()
  return <section aria-labelledby={id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
    <h3 id={id} className="text-base font-semibold tracking-tight text-slate-900">{title}</h3>
    <p className="mt-1 text-xs leading-5 text-slate-500">{subtitle}</p>
    {children}
  </section>
}

function SeriesControls({ items, selected, onToggle }: { items: { name: string; color: string; line?: boolean }[]; selected: Record<string, boolean>; onToggle: (name: string) => void }) {
  return <div className="mt-4 flex flex-wrap gap-2" aria-label="Tampilkan seri grafik">
    {items.map(item => <button key={item.name} type="button" aria-pressed={selected[item.name]} onClick={() => onToggle(item.name)} className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary ${selected[item.name] ? 'border-slate-200 bg-slate-50 text-slate-700' : 'border-dashed border-slate-300 bg-white text-slate-400'}`}>
      <span aria-hidden="true" className={item.line ? 'h-0.5 w-4' : 'h-2.5 w-2.5 rounded-sm'} style={{ backgroundColor: selected[item.name] ? item.color : '#cbd5e1' }} />
      {item.name}
    </button>)}
  </div>
}

function ChartData({ headers, rows, caption }: { headers: string[]; rows: (string | number)[][]; caption: string }) {
  return <details className="mt-3 border-t border-slate-100 pt-3">
    <summary className="w-fit cursor-pointer rounded text-xs font-medium text-slate-500 hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary">Lihat data</summary>
    <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-slate-200" tabIndex={0} role="region" aria-label={`Data ${caption}`}>
      <table className="w-full text-left text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-slate-50 text-slate-600"><tr>{headers.map(header => <th key={header} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{header}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index} className="border-t border-slate-100">{row.map((value, column) => column === 0 ? <th key={column} scope="row" className="min-w-28 break-words px-3 py-2 font-medium text-slate-700">{value}</th> : <td key={column} className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600">{value}</td>)}</tr>)}</tbody>
      </table>
    </div>
  </details>
}

function MonthlyChart({ series }: { series: DashboardData['monthlySeries'] }) {
  const [selected, setSelected] = useState({ 'Total PO': true, 'PO terkirim': true })
  const option = useMemo(() => monthlyOptions(series, selected), [series, selected])
  return <ChartCard title="Nilai PO vs Pengiriman PO Bulanan" subtitle="Khusus PO · rolling 12 bulan · bulan berjalan di sisi kanan">
    <SeriesControls items={[{ name: 'Total PO', color: CHART_COLORS.po }, { name: 'PO terkirim', color: CHART_COLORS.delivered }]} selected={selected} onToggle={name => setSelected(previous => ({ ...previous, [name]: !previous[name as keyof typeof previous] }))} />
    <div className="mt-3"><EChart label="Nilai PO vs Pengiriman PO Bulanan" option={option} height={300} /></div>
    {series.every(item => moneyToChartNumber(item.poValue) === 0 && moneyToChartNumber(item.deliveredValue) === 0) && <p className="mt-1 text-xs text-slate-500">Belum ada nilai PO atau pengiriman pada periode ini.</p>}
    <ChartData caption="Nilai PO vs Pengiriman PO Bulanan" headers={['Bulan', 'Total PO', 'PO terkirim']} rows={series.map(item => [item.label, currency(item.poValue), currency(item.deliveredValue)])} />
  </ChartCard>
}

function DailyChart({ series }: { series: DashboardData['dailySeries'] }) {
  const [selected, setSelected] = useState({ 'Nilai PO terkirim': true, 'Jumlah SJ PO': true })
  const last = Math.max(0, series.length - 1)
  const [window, setWindow] = useState({ start: 0, end: last })
  const start = Math.min(window.start, last)
  const end = Math.min(window.end, last)
  const option = useMemo(() => dailyOptions(series, selected, start, end), [series, selected, start, end])
  const onDataZoom = (event: ChartZoomEvent) => {
    const zoom = event.batch?.[0] ?? event
    if (typeof zoom.start === 'number' && typeof zoom.end === 'number') {
      setWindow({ start: Math.max(0, Math.round(zoom.start / 100 * last)), end: Math.min(last, Math.round(zoom.end / 100 * last)) })
    }
  }
  return <ChartCard title="Tren Pengiriman PO Harian" subtitle="Tanggal SJ PO · nilai item PO terkirim dan jumlah surat jalan PO per hari; tidak mencakup CO">
    <SeriesControls items={[{ name: 'Nilai PO terkirim', color: CHART_COLORS.delivered }, { name: 'Jumlah SJ PO', color: CHART_COLORS.count, line: true }]} selected={selected} onToggle={name => setSelected(previous => ({ ...previous, [name]: !previous[name as keyof typeof previous] }))} />
    <div className="mt-3"><EChart label="Tren Pengiriman PO Harian" option={option} height={300} onDataZoom={onDataZoom} /></div>
    {series.length > 14 && <details className="mt-2 rounded-lg bg-slate-50 px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-slate-600 focus-visible:outline-2 focus-visible:outline-brand-primary">Atur rentang grafik: {series[start]?.label} – {series[end]?.label}</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-slate-600">Mulai: {series[start]?.label}<input type="range" aria-label="Tanggal mulai grafik" aria-valuetext={series[start]?.label} min={0} max={last} value={start} onChange={event => setWindow(previous => ({ ...previous, start: Math.min(Number(event.target.value), end) }))} className="mt-2 block w-full accent-blue-600" /></label>
        <label className="text-xs text-slate-600">Sampai: {series[end]?.label}<input type="range" aria-label="Tanggal akhir grafik" aria-valuetext={series[end]?.label} min={0} max={last} value={end} onChange={event => setWindow(previous => ({ ...previous, end: Math.max(Number(event.target.value), start) }))} className="mt-2 block w-full accent-blue-600" /></label>
      </div>
      <button type="button" onClick={() => setWindow({ start: 0, end: last })} className="mt-3 min-h-9 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 focus-visible:outline-2 focus-visible:outline-brand-primary">Tampilkan semua tanggal</button>
    </details>}
    {series.every(item => moneyToChartNumber(item.deliveredValue) === 0 && item.sjCount === 0) && <p className="mt-2 text-xs text-slate-500">Belum ada pengiriman PO pada periode ini.</p>}
    <ChartData caption="Tren Pengiriman PO Harian" headers={['Tanggal', 'Nilai PO terkirim', 'Jumlah SJ PO']} rows={series.map(item => [item.label, currency(item.deliveredValue), count(item.sjCount)])} />
  </ChartCard>
}

function CustomerChart({ items, total }: { items: DashboardData['customerShare']; total: string }) {
  const option = useMemo(() => customerOptions(items, total), [items, total])
  return <ChartCard title="Kontribusi Customer" subtitle="Proporsi nilai PO · 5 customer teratas dan lainnya">
    {items.length === 0 ? <p className="grid h-80 place-items-center text-sm text-slate-400">Belum ada data pada filter ini.</p> : <>
      <div className="mt-4 flex flex-wrap items-baseline gap-x-2"><span className="min-w-0 max-w-full text-xl font-semibold tracking-tight text-slate-900 [overflow-wrap:anywhere]">{currency(total)}</span><span className="text-xs text-slate-500">total nilai PO</span></div>
      <EChart label="Kontribusi Customer" option={option} height={300} />
      <ChartData caption="Kontribusi Customer" headers={['Customer', 'Total PO', 'Proporsi']} rows={items.map(item => [item.label, currency(item.value), `${moneyPercentage(item.value, total, 1)}%`])} />
    </>}
  </ChartCard>
}

function StatusChart({ items }: { items: DashboardData['statusBreakdown'] }) {
  const option = useMemo(() => statusOptions(items), [items])
  const total = items.reduce((sum, item) => sum + item.value, 0)
  return <ChartCard title="Komposisi Status PO" subtitle="Jumlah purchase order berdasarkan status">
    {items.length === 0 ? <p className="grid h-80 place-items-center text-sm text-slate-400">Belum ada data pada filter ini.</p> : <>
      <div className="relative mx-auto mt-4 max-w-64">
        <EChart label="Komposisi Status PO" option={option} height={232} />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-3xl font-semibold tracking-tight text-slate-900">{count(total)}</span><span className="mt-1 text-xs text-slate-500">Total PO</span></div>
      </div>
      <ul className="mt-4 space-y-2.5">{items.map((item, index) => <li key={`${item.label}-${index}`} className="flex items-center gap-2 text-sm"><span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: item.color }} /><span className="min-w-0 flex-1 break-words text-slate-600">{item.label}</span><span className="font-medium tabular-nums text-slate-900">{count(item.value)} PO</span><span className="w-14 text-right text-xs tabular-nums text-slate-500">{percent(item.value, total)}</span></li>)}</ul>
      <ChartData caption="Komposisi Status PO" headers={['Status', 'Jumlah PO', 'Proporsi']} rows={items.map(item => [item.label, count(item.value), percent(item.value, total)])} />
    </>}
  </ChartCard>
}

export default function DashboardCharts({ data }: { data: DashboardData }) {
  const dailyKey = `${data.dailySeries[0]?.key}:${data.dailySeries.at(-1)?.key}:${data.dailySeries.length}`
  return <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
    <MonthlyChart series={data.monthlySeries} />
    <CustomerChart items={data.customerShare} total={data.metrics.totalPOValue} />
    <DailyChart key={dailyKey} series={data.dailySeries} />
    <StatusChart items={data.statusBreakdown} />
  </div>
}
