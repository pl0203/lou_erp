import { LoadingState } from '../ui/LoadingState'
import { useId } from 'react'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { FilterBar } from '../ui/FilterBar'
import { EmptyState, Notice } from '../ui/Feedback'
import { RecordList } from '../ui/RecordList'
import { useQuery } from '@tanstack/react-query'
import { COPagination, quantityText } from '../co/COShared'
import type { SalesMetricGroup, SalesMetricOrderType, SalesMetricSummary as Summary, SalesMetricValues } from '../../lib/reads/contracts'
import { formatMoney } from '../../lib/reads/money'
import { formatAuditTimestamp } from '../../lib/displayDate'
import { salesMonthLabel, salesMonthOptions, useSalesMetrics } from '../../lib/reads/useSalesMetrics'
import { IncompleteReadError, readComplete } from '../../lib/reads/completeReads'
import { supabase } from '../../lib/supabase'

function Values({ value, orderType = 'all', noMonths = false, reports = '0', reportBasis = 'events' }: {
  value: SalesMetricValues; orderType?: SalesMetricOrderType; noMonths?: boolean; reports?: string; reportBasis?: 'events' | 'contributions'
}) {
  const cards = [
    { label: 'Nilai pesanan PO', amount: value.po_order_value, count: value.po_order_count, countLabel: 'Jumlah PO', family: 'po', basis: 'Tanggal PO · Dikonfirmasi, Dalam proses, atau Selesai.' },
    { label: 'Nilai pengiriman PO', amount: value.po_delivered_revenue, count: value.po_delivered_order_count, countLabel: 'PO dengan pengiriman', family: 'po', basis: 'Tanggal SJ · kuantitas terkirim × harga asli item PO; SJ batal dikecualikan.' },
    { label: 'Penjualan CO dilaporkan', amount: value.co_sold_revenue, count: value.co_sold_order_count, countLabel: 'CO dengan penjualan', family: 'co', basis: 'Bulan laporan yang sudah diposting · alokasi penjualan × harga asli CO.' },
  ] as const
  return <div className="grid min-w-0 gap-3 md:grid-cols-3">
    {cards.map(({ label, amount, count, countLabel, family, basis }) => {
      const excluded = orderType !== 'all' && orderType !== family
      // Per-person contributions exclude zero-report events; zero contributions do not prove missing reports.
      const noContribution = family === 'co' && reportBasis === 'contributions' && reports === '0'
      const missing = noMonths || (family === 'co' && reportBasis === 'events' && reports === '0')
      const reportedZero = family === 'co' && reports !== '0' && /^0+(?:\.0+)?$/.test(amount)
      return <article key={label} className="min-w-0 rounded-[14px] border border-brand-divider bg-brand-canvas p-4">
        <h3 className="text-sm font-medium text-brand-secondary">{label}</h3>
        <p className="mt-2 text-lg font-semibold tabular-nums text-brand-primary [overflow-wrap:anywhere]">{excluded ? 'Di luar filter' : missing ? 'Belum tersedia' : `Rp ${formatMoney(amount, 'full')}`}</p>
        <p className="mt-1 text-[13px] text-brand-secondary [overflow-wrap:anywhere]">{basis}</p>
        {!excluded && <>
          <p className="mt-2 text-[13px] text-brand-secondary [overflow-wrap:anywhere]">{countLabel}: {quantityText(count)}</p>
          {family === 'co' ? <p className="mt-1 text-[13px] text-brand-secondary">{noContribution ? 'Belum ada kontribusi penjualan CO untuk orang ini. Nilai ini tidak membuktikan bahwa laporan CO belum tersedia; laporan nol hanya dihitung pada ringkasan pelanggan/bulan.' : missing ? 'Belum ada laporan CO diposting dalam cakupan dan periode ini.' : reportedZero ? 'Nol pada laporan yang tersedia; kelengkapan seluruh penjualan belum dapat dipastikan.' : 'Hanya laporan tersedia. Penjualan yang belum dilaporkan belum tercakup.'}</p> : !noMonths && count === '0' && <p className="mt-1 text-[13px] text-brand-secondary">Tidak ada {family === 'po' && label === 'Nilai pesanan PO' ? 'PO' : 'pengiriman PO'} yang memenuhi filter.</p>}
        </>}
      </article>
    })}
  </div>
}
export default function SalesMetricSummary({ summary, orderType = 'all', noMonths = false, period, scope }: {
  summary: Summary; orderType?: SalesMetricOrderType; noMonths?: boolean; period?: string; scope?: string
}) {
  return <section aria-label="Ringkasan seluruh hasil" className="space-y-3">
    <h2 className="font-semibold text-brand-primary">Ringkasan seluruh hasil</h2>
    {period && <p className="text-sm text-brand-secondary">Periode metrik: {period} · {orderType === 'all' ? 'PO dan CO' : orderType.toUpperCase()}</p>}
    {scope && <p className="text-sm text-brand-secondary">Cakupan: {scope}</p>}
    <p className="text-[13px] text-brand-secondary">Seluruh hasil filter yang diizinkan, termasuk halaman lain. Angka CO hanya mencakup laporan diposting; kelengkapan pelaporan belum dapat dipastikan. Bulan berjalan dapat mencakup sebagian bulan.</p>
    {noMonths && <Notice tone="info" title="Belum ada bulan metrik dalam cakupan dan jenis pesanan ini.">Belum tersedia berbeda dari penjualan nol yang sudah dilaporkan.</Notice>}
    <Values value={summary} orderType={orderType} noMonths={noMonths} reports={summary.co_report_event_count}/>
    <p className="text-sm text-brand-secondary [overflow-wrap:anywhere]">Laporan CO (pelanggan/bulan): {quantityText(summary.co_report_event_count)}</p>
  </section>
}
async function fetchManagers(signal: AbortSignal) {
  const rows = await readComplete<{id:string;full_name:string}>(async (offset,limit) => {
    const {data,count,error} = await supabase.rpc('pilot_team_directory',{}, {count:'exact'}).select('id,full_name').eq('role','sales_manager').eq('is_active',true).order('id').range(offset,offset+limit-1).abortSignal(signal)
    if(error) throw error
    if(!Array.isArray(data) || typeof count!=='number') throw new IncompleteReadError()
    return {items:data,total:count}
  },row=>row.id,signal)
  if(rows.some(row=>!(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.id)) || typeof row.full_name!=='string' || !row.full_name.trim())) throw new Error('Daftar manajer tidak lengkap.')
  return rows
}
export function SalesMetricsPanel({group='customer'}: {group?: SalesMetricGroup}) {
  const filterId = useId()
  const read = useSalesMetrics(group)
  const leadership = ['sales_head','executive'].includes(read.role)
  const directory=useQuery({queryKey:[...read.key,'managers'],queryFn:({signal})=>fetchManagers(signal),enabled:read.allowed&&read.valid&&leadership,retry:false})
  const options=salesMonthOptions(read.months?.earliest_month,read.from,read.through)
  const managerOptions=read.allowed&&!directory.isError&&!directory.isFetching ? directory.data : undefined
  const data=read.data
  // The month directory and metric page are separate reads. New records can appear between them.
  const noMetricMonths = read.months?.earliest_month === null && !!data && [data.summary.po_order_count, data.summary.po_delivered_order_count, data.summary.co_sold_order_count, data.summary.co_report_event_count].every(count => count === '0')
  return <section aria-label="Metrik Sales" className="min-w-0 space-y-5 rounded-[14px] border border-brand-divider bg-white p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 className="text-lg font-semibold text-brand-primary">Metrik Sales</h2>
        <p className="text-base text-brand-secondary">Bulan kalender utuh · {group === 'customer' ? 'per pelanggan' : 'per kredit orang'}</p>
        <p className="mt-1 text-[13px] text-brand-secondary">Filter ini hanya mengubah Metrik Sales; bulan aktivitas dan target di bagian lain tetap terpisah.</p>
      </div>
      <Button size="compact" variant="secondary" disabled={!read.allowed || !read.valid || read.pending} onClick={read.refresh}>Muat ulang metrik</Button>
    </div>
    {!read.allowed ? <Notice tone="error" title="Metrik Sales tidak tersedia untuk akun ini." /> : !read.valid ?
      <Notice tone="error" title="Filter metrik tidak valid." actions={<Button size="compact" variant="secondary" onClick={read.reset}>Atur ulang filter</Button>} /> : <>
      <FilterBar label="Filter Metrik Sales">
        <Field id={`${filterId}-from`} label="Dari bulan">{control => <select {...control} value={read.from}
          onChange={event => read.update({ sales_from: event.target.value, ...(event.target.value > read.through ? { sales_through: event.target.value } : {}) })}>
          {options.map(month => <option key={month} value={month}>{salesMonthLabel(month)}</option>)}
        </select>}</Field>
        <Field id={`${filterId}-through`} label="Sampai bulan">{control => <select {...control} value={read.through}
          onChange={event => read.update({ sales_through: event.target.value, ...(event.target.value < read.from ? { sales_from: event.target.value } : {}) })}>
          {options.map(month => <option key={month} value={month}>{salesMonthLabel(month)}</option>)}
        </select>}</Field>
        <Field id={`${filterId}-type`} label="Jenis pesanan">{control => <select {...control} value={read.orderType} onChange={event => read.update({ sales_type: event.target.value })}>
          <option value="all">PO dan CO</option><option value="po">PO</option><option value="co">CO</option>
        </select>}</Field>
        {leadership && <Field id={`${filterId}-manager`} label="Manajer">{control => <select {...control} value={read.manager ?? ''} onChange={event => read.update({ sales_manager: event.target.value || null })}>
          <option value="">Semua cakupan yang diizinkan</option>
          {read.manager && !managerOptions?.some(manager => manager.id === read.manager) && <option value={read.manager}>Manajer terpilih</option>}
          {managerOptions?.map(manager => <option key={manager.id} value={manager.id}>{manager.full_name}</option>)}
        </select>}</Field>}
      </FilterBar>
      {directory.isError && leadership && <Notice tone="error" title="Daftar manajer tidak tersedia."
        actions={<Button size="compact" variant="secondary" onClick={() => void directory.refetch()}>Muat ulang daftar manajer</Button>} />}
      {read.manager&&<p className="text-[13px] text-brand-secondary">Dibatasi ke manajer terpilih, tetap dalam cakupan akun yang diizinkan.</p>}
      {read.unavailable ? <Notice tone="error" title="Data atau daftar bulan metrik Sales tidak tersedia." actions={<Button size="compact" variant="secondary" onClick={read.refresh}>Coba lagi</Button>} /> : !data ? <LoadingState title="Memuat metrik Sales..." shape="dashboard" /> : <>
        <SalesMetricSummary summary={data.summary} orderType={read.orderType} noMonths={noMetricMonths} period={read.from === read.through ? salesMonthLabel(read.from) : `${salesMonthLabel(read.from)} – ${salesMonthLabel(read.through)}`} scope={`${({own:'sendiri',team:'tim',leadership:'pimpinan'} as const)[data.scope]}${read.manager ? ' · manajer terpilih, sesuai izin akun' : ''}`}/>
        <section aria-label={group==='person'?'Kontribusi per orang':'Metrik per pelanggan'} className="space-y-4">
          <h2 className="font-semibold text-brand-primary">{group==='person'?'Kontribusi per orang':'Metrik per pelanggan'}</h2>
          {data.group_by==='person'&&<p className="text-sm text-brand-secondary">Kontribusi laporan CO tidak dapat dijumlahkan antar orang. Satu laporan pelanggan/bulan dapat berkontribusi pada beberapa orang. Kredit mengikuti identitas asli saat CO dibuat, termasuk orang yang kini tidak aktif atau berubah peran; Belum ditugaskan berarti belum memiliki kredit.</p>}
          {data.items.length === 0 && <EmptyState title={group === 'person' ? 'Tidak ada kontribusi orang untuk periode ini. Laporan nol tetap dapat dihitung di ringkasan.' : 'Tidak ada metrik pelanggan untuk periode ini.'} />}
          <RecordList label={group === 'person' ? 'Kontribusi orang' : 'Metrik pelanggan'}>{data.group_by==='customer' ? data.items.map(row=><li key={row.customer_id}><section aria-label={row.customer_name} className="min-w-0 space-y-3 border-t border-brand-divider pt-4"><h3 className="font-medium text-brand-primary [overflow-wrap:anywhere]">{row.customer_name}</h3><Values value={row} orderType={read.orderType} reports={row.co_report_event_count}/><p className="text-[13px] text-brand-secondary">Laporan CO (pelanggan/bulan): {quantityText(row.co_report_event_count)}</p></section></li>) : data.items.map(row=><li key={row.person_id??'unassigned'}><section aria-label={row.is_unassigned ? 'Belum ditugaskan' : row.person_name} className="min-w-0 space-y-3 border-t border-brand-divider pt-4"><h3 className="font-medium text-brand-primary [overflow-wrap:anywhere]">{row.is_unassigned ? 'Belum ditugaskan' : row.person_name}</h3><Values value={row} orderType={read.orderType} reports={row.co_contributing_report_count} reportBasis="contributions"/><p className="text-[13px] text-brand-secondary">Kontribusi laporan CO: {quantityText(row.co_contributing_report_count)}</p></section></li>)}</RecordList>
        </section>
        <COPagination page={data.page} pageSize={data.page_size} total={data.total} pending={read.pending} onPage={read.setPage}/>
        <p className="text-[13px] text-brand-secondary">Waktu pembacaan: {formatAuditTimestamp(data.as_of)}. Ini bukan tanggal cakupan laporan atau snapshot ekspor bersama.</p>
      </>}
    </>}
    <details className="space-y-2 border-t border-brand-divider pt-4 text-[13px] leading-relaxed text-brand-secondary"><summary className="min-h-[var(--ui-control-size-compact)] cursor-pointer rounded py-[var(--ui-control-padding-y-compact)] text-[length:var(--ui-text-control)] leading-[var(--ui-line-control)] font-medium text-brand-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-brand-primary">Definisi dan batasan metrik</summary>
      <p>Nilai pesanan PO: nilai PO Dikonfirmasi, Dalam proses, atau Selesai berdasarkan tanggal PO. Nilai pengiriman PO: kuantitas SJ positif dan tidak dibatalkan × harga asli item PO, berdasarkan tanggal SJ; jumlahnya menghitung PO berbeda, bukan jumlah SJ.</p>
      <p>Penjualan CO dilaporkan mencakup alokasi dari laporan bulanan yang sudah diposting, memakai harga dan kredit asli CO. Penjualan yang belum dilaporkan belum tercakup. Pengiriman CO dan draf bukan pendapatan.</p>
      <p>Laporan bulan berjalan dapat mencakup sebagian bulan. Nol yang dilaporkan berbeda dari laporan yang belum tersedia; angka ini tidak menyatakan seluruh penjualan sudah dilaporkan.</p>
      <p>Ringkasan mencakup seluruh hasil filter, bukan penjumlahan halaman. Jumlah PO, CO, dan laporan berbeda dihitung untuk seluruh rentang; jangan menjumlahkan hitungan bulan atau kontribusi orang.</p>
    </details>
  </section>
}
